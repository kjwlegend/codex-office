import contextlib
import io
import json
import re
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

import codex_usage


def write_rollout(path: Path, records: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record) + "\n")


def token_event(ts: str, total: dict, last: dict | None = None) -> dict:
    return {
        "timestamp": ts,
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": total,
                "last_token_usage": last or total,
                "model_context_window": 258400,
            },
        },
    }


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.codex_home = self.root / ".codex"
        session_dir = self.codex_home / "sessions" / "2026" / "08" / "05"
        session_dir.mkdir(parents=True)
        self.rollout = session_dir / "rollout-2026-08-05T10-00-00-test.jsonl"
        self.db_path = self.root / "usage.sqlite3"

    def tearDown(self):
        self.temp.cleanup()

    def records(self):
        first = {
            "input_tokens": 1000,
            "cached_input_tokens": 200,
            "cache_write_input_tokens": 0,
            "output_tokens": 100,
            "reasoning_output_tokens": 40,
            "total_tokens": 1100,
        }
        second_total = {
            "input_tokens": 2500,
            "cached_input_tokens": 700,
            "cache_write_input_tokens": 300,
            "output_tokens": 300,
            "reasoning_output_tokens": 100,
            "total_tokens": 2800,
        }
        third_total = {
            "input_tokens": 3000,
            "cached_input_tokens": 800,
            "cache_write_input_tokens": 300,
            "output_tokens": 350,
            "reasoning_output_tokens": 110,
            "total_tokens": 3350,
        }
        return [
            {
                "timestamp": "2026-08-05T01:59:00Z",
                "type": "session_meta",
                "payload": {
                    "id": "test",
                    "cwd": str(self.root / "project-a"),
                    "originator": "codex-app",
                    "source": "vscode",
                    "cli_version": "0.999.0-test",
                    "model_provider": "openai",
                },
            },
            {
                "timestamp": "2026-08-05T02:00:00Z",
                "type": "turn_context",
                "payload": {
                    "cwd": str(self.root / "project-a"),
                    "model": "gpt-5.6-sol",
                    "effort": "high",
                },
            },
            token_event("2026-08-05T02:01:00Z", first),
            token_event("2026-08-05T02:01:01Z", first),
            token_event("2026-08-05T02:02:00Z", second_total),
            {"timestamp": "2026-08-05T02:03:00Z", "type": "turn_context", "payload": {"cwd": str(self.root / "project-b"), "model": "gpt-5.6-luna"}},
            token_event("2026-08-05T02:03:01Z", second_total),
            token_event("2026-08-05T02:04:00Z", third_total),
        ]

    def test_duplicate_snapshots_are_not_calls(self):
        write_rollout(self.rollout, self.records())
        conn = codex_usage.connect_db(self.db_path)
        stats = codex_usage.scan_usage(conn, self.codex_home, ZoneInfo("Asia/Shanghai"), quiet=True)
        events = codex_usage.query_events(conn, date(2026, 8, 5), date(2026, 8, 5))
        conn.close()
        self.assertEqual(stats.events, 3)
        self.assertEqual(len(events), 3)
        self.assertEqual(sum(event["input_tokens"] for event in events), 3000)
        self.assertEqual(sum(event["cached_input_tokens"] for event in events), 800)
        self.assertEqual(events[-1]["model"], "gpt-5.6-luna")
        self.assertEqual(events[0]["local_hour"], 10)
        self.assertEqual(events[0]["weekday"], 2)
        self.assertEqual(events[0]["session_id"], "test")
        self.assertEqual(events[0]["originator"], "codex-app")
        self.assertEqual(events[0]["source_surface"], "vscode")
        self.assertEqual(events[0]["cli_version"], "0.999.0-test")
        self.assertEqual(events[0]["reasoning_effort"], "high")
        self.assertEqual(events[0]["model_provider"], "openai")

    def test_quick_stats_cover_metadata_dimensions(self):
        write_rollout(self.rollout, self.records())
        conn = codex_usage.connect_db(self.db_path)
        codex_usage.scan_usage(conn, self.codex_home, ZoneInfo("Asia/Shanghai"), quiet=True)
        events = codex_usage.query_events(conn, date(2026, 8, 5), date(2026, 8, 5))
        conn.close()
        resolver = codex_usage.ProjectResolver(
            {"project_mode": "git", "project_aliases": {str(self.root / "project-a"): "project-a"}}
        )
        pricing = codex_usage.load_json(Path(__file__).parents[1] / "pricing.json")
        scopes, stats = codex_usage.build_quick_scopes(
            events, date(2026, 8, 5), resolver, codex_usage.PriceBook(pricing)
        )
        self.assertEqual(scopes["today"]["calls"], 3)
        self.assertIn("project", stats["today"])
        self.assertIn("reasoning_effort", stats["today"])
        self.assertIn("cli_version", stats["today"])
        self.assertEqual(stats["today"]["source_surface"][0]["label"], "vscode")
        self.assertEqual(stats["today"]["agent_type"][0]["label"], "主代理")
        self.assertEqual(stats["today"]["project"][0]["sessions"], 1)

    def test_append_scan_is_incremental(self):
        records = self.records()[:3]
        write_rollout(self.rollout, records)
        conn = codex_usage.connect_db(self.db_path)
        first = codex_usage.scan_usage(conn, self.codex_home, ZoneInfo("Asia/Shanghai"), quiet=True)
        with self.rollout.open("a", encoding="utf-8") as handle:
            for record in self.records()[3:]:
                handle.write(json.dumps(record) + "\n")
        second = codex_usage.scan_usage(conn, self.codex_home, ZoneInfo("Asia/Shanghai"), quiet=True)
        events = codex_usage.query_events(conn, date(2026, 8, 5), date(2026, 8, 5))
        conn.close()
        self.assertEqual(first.events, 1)
        self.assertEqual(second.events, 2)
        self.assertEqual(len(events), 3)

    def test_gpt56_cost_separates_cached_and_writes(self):
        pricing = codex_usage.load_json(Path(__file__).parents[1] / "pricing.json")
        price = codex_usage.PriceBook(pricing).cost(
            {
                "model": "gpt-5.6-sol",
                "input_tokens": 1_000_000,
                "cached_input_tokens": 200_000,
                "cache_write_input_tokens": 100_000,
                "output_tokens": 100_000,
                "context_window": 258400,
            }
        )
        expected = 700_000 * 10 / 1_000_000 + 200_000 * 1 / 1_000_000 + 100_000 * 12.5 / 1_000_000 + 100_000 * 45 / 1_000_000
        self.assertAlmostEqual(price["cost"], expected)
        self.assertEqual(price["uncached_input_tokens"], 700_000)
        self.assertGreater(price["potential_additional_savings"], 0)

    def test_astra_pricing_uses_request_input_threshold(self):
        book = codex_usage.PriceBook(codex_usage.load_json(Path(__file__).parents[1] / "pricing.json"))
        event = {"model": "gpt-6-astra", "input_tokens": 272000,
                 "cached_input_tokens": 200000, "output_tokens": 1000,
                 "context_window": 1050000}
        short = book.cost(event)
        self.assertEqual(short["pricing_tier"], "short")
        self.assertAlmostEqual(short["cost"], 0.72 + 0.2 + 0.05)
        event["input_tokens"] = 272001
        long = book.cost(event)
        self.assertEqual(long["pricing_tier"], "long")
        self.assertAlmostEqual(long["cost"], 72001 * 20 / 1000000 + 0.4 + 0.075)

    def test_gpt61_pricing_separates_cache_and_uses_request_input_threshold(self):
        pricing = codex_usage.load_json(Path(__file__).parents[1] / "pricing.json")
        book = codex_usage.PriceBook(pricing)
        model = pricing["models"]["gpt-6.1-sol"]
        self.assertEqual(model["source_url"], "https://developers.openai.com/api/docs/models/gpt-6.1-sol")
        event = {"model": "gpt-6.1-sol", "cached_input_tokens": 200_000,
                 "cache_write_input_tokens": 10_000, "output_tokens": 1_000,
                 "reasoning_output_tokens": 500, "context_window": 1_050_000}
        for input_tokens, tier, rates in (
            (272_000, "short", (2.0, 0.1, 2.5, 10.0)),
            (272_001, "long", (4.0, 0.2, 5.0, 15.0)),
            (1_000_000, "long", (4.0, 0.2, 5.0, 15.0)),
        ):
            with self.subTest(input_tokens=input_tokens):
                price = book.cost({**event, "input_tokens": input_tokens})
                uncached = input_tokens - 200_000 - 10_000
                self.assertTrue(price["known"])
                self.assertEqual(price["resolved_model"], "gpt-6.1-sol")
                self.assertEqual(price["pricing_tier"], tier)
                self.assertEqual(price["uncached_input_tokens"], uncached)
                self.assertAlmostEqual(price["input_cost"], uncached * rates[0] / 1_000_000)
                self.assertAlmostEqual(price["cached_cost"], 200_000 * rates[1] / 1_000_000)
                self.assertAlmostEqual(price["cache_write_cost"], 10_000 * rates[2] / 1_000_000)
                self.assertAlmostEqual(price["output_cost"], 1_000 * rates[3] / 1_000_000)
                self.assertAlmostEqual(price["cost"], (uncached * rates[0] + 200_000 * rates[1] +
                                                     10_000 * rates[2] + 1_000 * rates[3]) / 1_000_000)
                self.assertAlmostEqual(price["savings"], input_tokens * rates[0] / 1_000_000 -
                                       price["input_cost"] - price["cached_cost"] - price["cache_write_cost"])
        # The older Sol is a different model, especially for cached input pricing.
        self.assertNotEqual(book.resolve("gpt-6-sol")[0], "gpt-6.1-sol")

    def test_csv_report_format_is_not_available(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                codex_usage.build_parser().parse_args(["report", "--format", "csv"])

    def test_codex_worktrees_collapse_to_original_project(self):
        repo = self.root / "workspace" / "demo-project"
        git_dir = repo / ".git" / "worktrees" / "demo-project2"
        git_dir.mkdir(parents=True)
        worktree = self.root / ".codex" / "worktrees" / "005c" / "demo-project"
        worktree.mkdir(parents=True)
        (worktree / ".git").write_text(f"gitdir: {git_dir}\n", encoding="utf-8")
        project, project_path = codex_usage.ProjectResolver({"project_mode": "git"}).resolve(str(worktree))
        self.assertEqual(project, "demo-project")
        self.assertEqual(project_path, str(repo))

    def test_forked_history_is_baseline_not_new_usage(self):
        inherited = {
            "input_tokens": 1_000_000,
            "cached_input_tokens": 900_000,
            "cache_write_input_tokens": 0,
            "output_tokens": 10_000,
            "reasoning_output_tokens": 2_000,
            "total_tokens": 1_010_000,
        }
        after_call = {
            "input_tokens": 1_020_000,
            "cached_input_tokens": 915_000,
            "cache_write_input_tokens": 0,
            "output_tokens": 10_500,
            "reasoning_output_tokens": 2_100,
            "total_tokens": 1_030_500,
        }
        records = [
            {
                "timestamp": "2026-08-05T02:00:00.000Z",
                "type": "session_meta",
                "payload": {
                    "id": "child",
                    "cwd": str(self.root / "project-a"),
                    "forked_from_id": "parent",
                    "parent_thread_id": "parent",
                },
            },
            {"timestamp": "2026-08-05T02:00:00.010Z", "type": "session_meta", "payload": {"id": "parent", "cwd": str(self.root / "project-a")}},
            {"timestamp": "2026-08-05T02:00:00.020Z", "type": "turn_context", "payload": {"cwd": str(self.root / "project-a"), "model": "gpt-5.6-sol"}},
            token_event("2026-08-05T02:00:00.030Z", inherited),
            {"timestamp": "2026-08-05T02:00:10.000Z", "type": "turn_context", "payload": {"cwd": str(self.root / "project-a"), "model": "gpt-5.6-luna"}},
            token_event("2026-08-05T02:00:20.000Z", after_call),
        ]
        write_rollout(self.rollout, records)
        conn = codex_usage.connect_db(self.db_path)
        stats = codex_usage.scan_usage(conn, self.codex_home, ZoneInfo("Asia/Shanghai"), quiet=True)
        events = codex_usage.query_events(conn, date(2026, 8, 5), date(2026, 8, 5))
        conn.close()
        self.assertEqual(stats.events, 1)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["input_tokens"], 20_000)
        self.assertEqual(events[0]["cached_input_tokens"], 15_000)
        self.assertEqual(events[0]["model"], "gpt-5.6-luna")

    def test_explorer_preserves_filtered_totals_and_metadata(self):
        write_rollout(self.rollout, self.records())
        conn = codex_usage.connect_db(self.db_path)
        codex_usage.scan_usage(conn, self.codex_home, ZoneInfo("Asia/Shanghai"), quiet=True)
        events = codex_usage.query_events(conn, date(2026, 8, 5), date(2026, 8, 5))
        conn.close()
        resolver = codex_usage.ProjectResolver({"project_mode": "git"})
        price_book = codex_usage.PriceBook(codex_usage.load_json(Path(__file__).parents[1] / "pricing.json"))
        cube = codex_usage.build_explorer_data(events, resolver, price_book)
        decoded = []
        for values in cube["rows"]:
            row = {key: cube["dictionaries"][key][values[i]] for i, key in enumerate(cube["dimensions"])}
            row.update(dict(zip(cube["numeric"], values[len(cube["dimensions"]):])))
            decoded.append(row)
        _, expected = codex_usage.aggregate_events(events, resolver, price_book)
        for field in cube["numeric"]:
            self.assertAlmostEqual(sum(row[field] for row in decoded), expected[field])
        luna = [row for row in decoded if row["model"] == "gpt-5.6-luna"]
        self.assertEqual(sum(row["calls"] for row in luna), 1)
        self.assertEqual(sum(row["total_tokens"] for row in luna), 550)
        self.assertEqual({row["hour"] for row in decoded}, {10})
        self.assertEqual({row["agent_type"] for row in decoded}, {"主代理"})
        self.assertEqual(len({row["session"] for row in decoded}), 1)
        self.assertNotIn('"test"', json.dumps(cube))

    def test_unpriced_and_escaped_snapshot(self):
        name = '</script><img src=x onerror=alert(1)>@@STYLE@@'
        row = codex_usage.empty_aggregate("2026-08-05", name, "/safe/path", "unknown-model")
        row.update(calls=1, input_tokens=100, total_tokens=100, unknown_price_calls=1, unknown_price_tokens=100)
        codex_usage.finalize_aggregate(row)
        document = codex_usage.dashboard_html([row], row, date(2026, 8, 5), date(2026, 8, 5), {})
        self.assertIn('id="overallSpend">未计价</div>', document)
        self.assertNotIn('</script><img src=x', document)
        self.assertIn('&lt;img src=x onerror=alert(1)&gt;@@STYLE@@', document)
        self.assertEqual(document.count('<script'), 6)  # Usage, version metadata, three models, and inline code.
        for asset in ('office-character-data', 'office-cow-data', 'office-horse-data'):
            self.assertEqual(document.count(f'id="{asset}" type="application/octet-stream"'), 1)

    def test_dashboard_is_prepopulated_and_javascript_is_valid(self):
        pricing = codex_usage.load_json(Path(__file__).parents[1] / "pricing.json")
        event = {
            "day": "2026-08-05",
            "cwd": str(self.root / "project-a"),
            "model": "gpt-5.6-sol",
            "input_tokens": 10_000,
            "cached_input_tokens": 8_000,
            "cache_write_input_tokens": 0,
            "output_tokens": 500,
            "reasoning_output_tokens": 100,
            "total_tokens": 10_500,
            "context_window": 258400,
        }
        resolver = codex_usage.ProjectResolver(
            {"project_mode": "git", "project_aliases": {str(self.root / "project-a"): "project-a"}}
        )
        rows, total = codex_usage.aggregate_events([event], resolver, codex_usage.PriceBook(pricing))
        document = codex_usage.dashboard_html(
            rows, total, date(2026, 8, 5), date(2026, 8, 5), pricing
        )
        self.assertIn('id="overallCalls">1</div>', document)
        self.assertIn('id="chartStatic" class="chart-area"><svg', document)
        self.assertIn('id="global-filters"', document)
        self.assertIn('id="overallSpend"', document)
        self.assertIn('id="project-detail"', document)
        self.assertIn('id="chartTooltip"', document)
        self.assertIn('id="day-dialog"', document)
        self.assertIn('id="page-models"', document)
        self.assertIn('id="page-methods"', document)
        self.assertEqual(document.count('id="app-sidebar"'), 1)
        self.assertEqual(document.count('class="nav-label"'), 8)  # Six pages, locale control, and repository link.
        self.assertIn('id="locale-switch"', document)
        metadata = json.loads(re.search(r'<script id="app-release-data" type="application/json">(.*?)</script>', document).group(1))
        self.assertEqual(metadata["current_version"], "v0.3.2")
        self.assertEqual(metadata["repository_url"], "https://github.com/kjwlegend/codex-office")
        sidebar = re.search(r'<aside class="sidebar" id="app-sidebar".*?</aside>', document, re.DOTALL).group(0)
        for page in ("overview", "agents", "projects", "models", "explore", "methods"):
            self.assertEqual(sidebar.count(f'data-page="{page}"'), 1)
        self.assertIn("window.WorkspaceSidebar", document)
        self.assertIn("--workspace-rail-width:64px", document)
        self.assertIn("--surface-soft:", document)
        self.assertIn('class="kpi-caption"', document)
        self.assertIn('class="ui-icon"', document)
        self.assertIn("window.CodexAgentScenes", document)
        for scene in ("office", "prison", "graph"):
            self.assertEqual(document.count(f'data-agent-scene="{scene}"'), 1)
        self.assertIn("window.CodexThree", document)
        self.assertIn("articulated-person", document)
        self.assertIn('id="agent-3d"', document)
        self.assertIn("场景与员工", document)
        self.assertNotIn('<link rel="stylesheet"', document)
        self.assertNotIn("@@SIDEBAR@@", document)
        self.assertIn("探索分析", document)
        self.assertIn("project-a", document)
        self.assertIn("<noscript>", document)
        self.assertNotIn("下载 CSV", document)
        self.assertNotIn("<script src=", document)
        self.assertNotIn("@@STYLE@@", document)
        payload_text = re.search(r'<script id="report-data" type="application/json">(.*?)</script>', document, re.DOTALL).group(1)
        payload = json.loads(payload_text)
        self.assertEqual(payload["total"]["calls"], 1)
        self.assertEqual(payload["rows"][0]["total_tokens"], 10500)
        scripts = re.findall(r"<script(?: [^>]*)?>(.*?)</script>", document, flags=re.DOTALL)
        self.assertGreaterEqual(len(scripts), 2)
        node = shutil.which("node")
        if node:
            result = subprocess.run(
                [node, "--check", "-"], input=scripts[-1], text=True, capture_output=True, check=False
            )
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
