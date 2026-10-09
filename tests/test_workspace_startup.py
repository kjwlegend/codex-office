import contextlib
import io
import json
import re
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.request import urlopen
from zoneinfo import ZoneInfo

import codex_usage
from agent_graph import AgentGraphCollector
from workspace_server import WorkspaceServer


class WorkspaceStartupTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.home = self.root / "source"
        self.now = datetime.now(timezone.utc)
        self.today = self.now.astimezone(ZoneInfo("Asia/Shanghai")).date()
        # An older chat can still produce new tokens today; startup must scan it.
        started = self.now - timedelta(days=60)
        self.rollout = self.home / "sessions" / f"rollout-{started:%Y-%m-%d}T00-00-00-startup.jsonl"
        self.rollout.parent.mkdir(parents=True)
        self.db = self.root / "index" / "usage.sqlite3"
        self.output = self.root / "pages" / "custom-report.html"
        self.config = self.root / "config.json"
        self.pricing = self.root / "pricing.json"
        self.config.write_text(json.dumps({
            "timezone": "Asia/Shanghai", "project_mode": "cwd",
            "project_aliases": {str(self.root / "project"): "Startup fixture"},
        }), encoding="utf-8")
        self.pricing.write_text(json.dumps({
            "as_of": "startup-fixture",
            "models": {"startup-model": {"short": {"input": 1, "output": 2}}},
        }), encoding="utf-8")
        records = [
            {"type": "session_meta", "timestamp": started.isoformat(),
             "payload": {"id": "startup", "cwd": str(self.root / "project")}},
            {"type": "turn_context", "timestamp": started.isoformat(),
             "payload": {"model": "startup-model"}},
        ]
        self.rollout.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")
        self.append_tokens(1000)

    def append_tokens(self, total):
        event = {"type": "event_msg", "timestamp": self.now.isoformat(), "payload": {
            "type": "token_count", "info": {"total_token_usage": {
                "input_tokens": total * 9 // 10, "output_tokens": total // 10,
                "total_tokens": total,
            }},
        }}
        with self.rollout.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event) + "\n")

    def run_command(self, command="serve", *options):
        args = ["--codex-home", str(self.home), "--db", str(self.db),
                "--config", str(self.config), "--pricing", str(self.pricing),
                command, "--output", str(self.output), *options]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return codex_usage.main(args)

    def read_report(self, document=None):
        if document is None:
            document = self.output.read_text(encoding="utf-8")
        return json.loads(re.search(r'<script id="report-data" type="application/json">(.*?)</script>',
                                   document, re.DOTALL).group(1))

    def existing_report(self):
        self.output.parent.mkdir()
        self.output.write_text("previous snapshot", encoding="utf-8")

    def test_first_launch_builds_report_before_serving_with_custom_sources(self):
        def start(home, resolver, hierarchy, output, port, interval, open_browser):
            report = self.read_report()
            self.assertEqual(report["total"]["total_tokens"], 1000)
            self.assertAlmostEqual(report["total"]["estimated_cost_usd"], 0.0011)
            self.assertEqual(report["rows"][0]["project"], "Startup fixture")
            self.assertEqual(report["pricing_as_of"], "startup-fixture")
            self.assertEqual(report["start"], (self.today - timedelta(days=29)).isoformat())
            self.assertEqual(report["end"], self.today.isoformat())
            self.assertEqual(home, self.home)
            self.assertEqual(hierarchy, self.db.parent / "agent-graph.sqlite3")
            self.assertEqual(output, self.output)
            self.assertEqual((port, interval, open_browser), (8766, 5, False))
            return 0

        with patch("workspace_server.serve", side_effect=start) as serve:
            self.assertEqual(self.run_command(), 0)
        serve.assert_called_once()

    def test_repeated_launch_indexes_appended_usage_without_counting_twice(self):
        with patch("workspace_server.serve", return_value=0):
            self.assertEqual(self.run_command(), 0)
            self.append_tokens(2000)
            self.assertEqual(self.run_command(), 0)
            self.assertEqual(self.read_report()["total"]["total_tokens"], 2000)
            self.assertEqual(self.run_command(), 0)
            self.assertEqual(self.read_report()["total"]["total_tokens"], 2000)

    def test_open_serves_requested_range_without_opening_offline_html(self):
        with patch("workspace_server.serve", return_value=0) as serve, \
                patch("codex_usage.webbrowser.open") as browser:
            self.assertEqual(self.run_command("serve", "--days", "7", "--open"), 0)
        self.assertEqual(self.read_report()["start"], (self.today - timedelta(days=6)).isoformat())
        self.assertTrue(serve.call_args.args[-1])
        browser.assert_not_called()

    def test_no_refresh_uses_existing_html_without_creating_usage_index(self):
        self.existing_report()
        with patch("workspace_server.serve", return_value=0) as serve, \
                patch("codex_usage.scan_usage") as scan:
            self.assertEqual(self.run_command("serve", "--no-refresh"), 0)
        self.assertEqual(self.output.read_text(encoding="utf-8"), "previous snapshot")
        self.assertFalse(self.db.exists())
        scan.assert_not_called()
        serve.assert_called_once()

    def test_failed_scan_or_render_retains_report_and_does_not_start_service(self):
        self.existing_report()
        for target, error in (("scan_usage", OSError("unreadable source")),
                              ("dashboard_html", ValueError("cannot render"))):
            with self.subTest(stage=target), patch("codex_usage." + target, side_effect=error), \
                    patch("workspace_server.serve") as serve:
                self.assertEqual(self.run_command(), 2)
                self.assertEqual(self.output.read_text(encoding="utf-8"), "previous snapshot")
                serve.assert_not_called()

    def test_failed_snapshot_replacement_retains_report_and_removes_temporary_file(self):
        self.existing_report()
        with patch.object(Path, "replace", side_effect=OSError("cannot replace")), \
                patch("workspace_server.serve") as serve:
            self.assertEqual(self.run_command(), 2)
        self.assertEqual(self.output.read_text(encoding="utf-8"), "previous snapshot")
        self.assertEqual(list(self.output.parent.iterdir()), [self.output])
        serve.assert_not_called()

    def test_launch_reuses_running_service_and_serves_updated_report(self):
        self.existing_report()
        collector = AgentGraphCollector(self.home, codex_usage.ProjectResolver({}), self.root / "graph.sqlite3")
        server = WorkspaceServer(("127.0.0.1", 0), collector, self.output)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = str(server.server_address[1])
            with patch("workspace_server.webbrowser.open") as browser:
                self.assertEqual(self.run_command("serve", "--port", port, "--open"), 0)
            browser.assert_called_once_with(f"http://127.0.0.1:{port}/codex-usage-report.html#page=agents")
            with urlopen(f"http://127.0.0.1:{port}/codex-usage-report.html", timeout=5) as response:
                self.assertEqual(self.read_report(response.read().decode("utf-8"))["total"]["total_tokens"], 1000)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_dashboard_still_opens_offline_snapshot(self):
        with patch("codex_usage.webbrowser.open") as browser:
            self.assertEqual(self.run_command("dashboard", "--open"), 0)
        browser.assert_called_once_with(self.output.as_uri())


if __name__ == "__main__":
    unittest.main()
