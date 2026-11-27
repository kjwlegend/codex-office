"""Unit tests for multi-agent tool usage indexing, pricing, and Agent Office graphs."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import time
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import codex_usage
from agent_graph import AgentGraphCollector
from agent_providers import default_agent_sources


class MultiAgentProviderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.codex_home = self.root / ".codex"
        self.claude_home = self.root / ".claude"
        self.gemini_home = self.root / ".gemini"
        self.agy_home = self.root / ".gemini" / "antigravity"
        self.opencode_home = self.root / ".local" / "share" / "opencode"
        self.cursor_home = self.root / ".cursor"
        self.db_path = self.root / "usage.sqlite3"
        self.tz = ZoneInfo("Asia/Shanghai")

    def _make_claude_fixture(self):
        proj = self.claude_home / "projects" / "-tmp-demo-claude"
        proj.mkdir(parents=True)
        main_file = proj / "sess-claude-1.jsonl"
        records = [
            {
                "type": "user",
                "timestamp": "2026-11-26T02:00:00Z",
                "sessionId": "sess-claude-1",
                "cwd": "/demo/app-web",
                "version": "1.0.42",
                "message": {"role": "user", "content": "Refactor the navigation layout"},
            },
            # Streaming duplicate chunk with lower output tokens (must be deduplicated)
            {
                "type": "assistant",
                "timestamp": "2026-11-26T02:00:05Z",
                "sessionId": "sess-claude-1",
                "cwd": "/demo/app-web",
                "version": "1.0.42",
                "message": {
                    "id": "msg_01",
                    "role": "assistant",
                    "model": "claude-sonnet-4-5-20250929",
                    "stop_reason": None,
                    "content": [{"type": "thinking", "thinking": "..."}],
                    "usage": {
                        "input_tokens": 500,
                        "cache_creation_input_tokens": 1000,
                        "cache_read_input_tokens": 2000,
                        "output_tokens": 50,
                    },
                },
            },
            # Final chunk for same message.id
            {
                "type": "assistant",
                "timestamp": "2026-11-26T02:00:08Z",
                "sessionId": "sess-claude-1",
                "cwd": "/demo/app-web",
                "version": "1.0.42",
                "message": {
                    "id": "msg_01",
                    "role": "assistant",
                    "model": "claude-sonnet-4-5-20250929",
                    "stop_reason": "tool_use",
                    "content": [{"type": "tool_use", "name": "Edit"}],
                    "usage": {
                        "input_tokens": 500,
                        "cache_creation_input_tokens": 1000,
                        "cache_read_input_tokens": 2000,
                        "output_tokens": 300,
                    },
                },
            },
        ]
        main_file.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")

        sub_dir = proj / "sess-claude-1" / "subagents"
        sub_dir.mkdir(parents=True)
        (sub_dir / "agent-ui.meta.json").write_text(json.dumps({"agentType": "UI Reviewer"}), encoding="utf-8")
        sub_file = sub_dir / "agent-ui.jsonl"
        sub_file.write_text(
            json.dumps(
                {
                    "type": "assistant",
                    "timestamp": "2026-11-26T02:01:00Z",
                    "sessionId": "sess-claude-1",
                    "cwd": "/demo/app-web",
                    "isSidechain": True,
                    "message": {
                        "id": "msg_sub_1",
                        "role": "assistant",
                        "model": "claude-haiku-4-5-20251001",
                        "stop_reason": "end_turn",
                        "content": [{"type": "text", "text": "Done"}],
                        "usage": {
                            "input_tokens": 200,
                            "cache_creation_input_tokens": 0,
                            "cache_read_input_tokens": 800,
                            "output_tokens": 120,
                        },
                    },
                }
            )
            + "\n",
            encoding="utf-8",
        )

    def _make_gemini_fixture(self):
        chats = self.gemini_home / "tmp" / "hash1234" / "chats"
        chats.mkdir(parents=True)
        (self.gemini_home / "tmp" / "hash1234" / ".project_root").write_text("/demo/app-web\n", encoding="utf-8")
        session = {
            "sessionId": "gem-sess-1",
            "projectHash": "hash1234",
            "startTime": "2026-11-26T03:00:00Z",
            "lastUpdated": "2026-11-26T03:02:00Z",
            "messages": [
                {"type": "user", "timestamp": "2026-11-26T03:00:00Z", "content": "Audit API latency"},
                {
                    "type": "gemini",
                    "timestamp": "2026-11-26T03:01:00Z",
                    "model": "gemini-2.5-pro",
                    "content": "Checking traces",
                    "tokens": {
                        "input": 4000,
                        "cached": 3000,
                        "output": 400,
                        "thoughts": 150,
                        "total": 4550,
                    },
                },
            ],
        }
        (chats / "session-2026-11-26-gem1.json").write_text(json.dumps(session), encoding="utf-8")

    def _make_antigravity_fixture(self):
        conv_id = "agy-conv-1"
        sub_id = "agy-conv-sub-1"
        self.agy_home.mkdir(parents=True, exist_ok=True)
        db = self.agy_home / "conversation_summaries.db"
        conn = sqlite3.connect(db)
        conn.executescript(
            """
            CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                step_count INTEGER NOT NULL DEFAULT 0,
                last_modified_time DATETIME NOT NULL,
                workspace_uris TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT '',
                project_id TEXT NOT NULL DEFAULT '',
                agent_name TEXT NOT NULL DEFAULT '',
                parent_conversation_id TEXT NOT NULL DEFAULT '',
                nesting_depth INTEGER NOT NULL DEFAULT 0,
                not_fully_idle NUMERIC NOT NULL DEFAULT 0,
                killed NUMERIC NOT NULL DEFAULT 0,
                last_user_input_time DATETIME NOT NULL
            );
            """
        )
        now_iso = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                conv_id,
                "Build Pixel Office",
                12,
                now_iso,
                '["file:///demo/app-web"]',
                "CASCADE_RUN_STATUS_RUNNING",
                "",
                "",
                "Antigravity Lead",
                "",
                0,
                1,
                0,
                now_iso,
            ),
        )
        conn.execute(
            "INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                sub_id,
                "Pixel Sprite Designer",
                5,
                now_iso,
                '["file:///demo/app-web"]',
                "CASCADE_RUN_STATUS_IDLE",
                "",
                "",
                "Sprite Worker",
                conv_id,
                1,
                0,
                0,
                now_iso,
            ),
        )
        conn.commit()
        conn.close()

        tdir = self.agy_home / "brain" / conv_id / ".system_generated" / "logs"
        tdir.mkdir(parents=True)
        lines = [
            {
                "step_index": 0,
                "type": "USER_INPUT",
                "created_at": "2026-11-26T04:00:00Z",
                "content": "Create 2D pixel art office",
            },
            {
                "step_index": 1,
                "source": "MODEL",
                "type": "PLANNER_RESPONSE",
                "status": "DONE",
                "created_at": "2026-11-26T04:01:00Z",
                "model": "gemini-4-neon-high",
                "input_tokens": 2000,
                "cache_read_tokens": 12000,
                "output_tokens": 500,
                "tool_calls": [{"name": "edit_file"}],
            },
        ]
        (tdir / "transcript.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")

    def _make_opencode_fixture(self):
        self.opencode_home.mkdir(parents=True)
        db = self.opencode_home / "opencode.db"
        conn = sqlite3.connect(db)
        conn.executescript(
            """
            CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
            CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
            """
        )
        ts_ms = int(datetime(2026, 11, 26, 5, 0, tzinfo=timezone.utc).timestamp() * 1000)
        conn.execute(
            "INSERT INTO session VALUES (?,?,?,?,?,?)",
            ("oc-1", "", "/demo/app-web", "OpenCode Refactor", ts_ms, ts_ms),
        )
        msg_data = {
            "role": "assistant",
            "modelID": "claude-sonnet-4-6",
            "providerID": "anthropic",
            "tokens": {"input": 1000, "output": 250, "reasoning": 50, "cache": {"read": 3000, "write": 200}},
        }
        conn.execute("INSERT INTO message VALUES (?,?,?,?)", ("m-1", "oc-1", ts_ms, json.dumps(msg_data)))
        conn.commit()
        conn.close()

    def test_all_mainstream_tools_are_scanned_and_priced(self):
        self._make_claude_fixture()
        self._make_gemini_fixture()
        self._make_antigravity_fixture()
        self._make_opencode_fixture()

        sources = default_agent_sources(
            codex_home=self.codex_home,
            claude_home=self.claude_home,
            gemini_home=self.gemini_home,
            antigravity_home=self.agy_home,
            cursor_home=self.cursor_home,
            opencode_home=self.opencode_home,
            include_others=True,
        )
        conn = codex_usage.connect_db(self.db_path)
        stats = codex_usage.scan_usage(conn, self.codex_home, self.tz, quiet=True, sources=sources)
        events = codex_usage.query_events(conn, date(2026, 11, 25), date(2026, 11, 27))
        conn.close()

        self.assertGreaterEqual(stats.events, 5)
        by_tool = {}
        for ev in events:
            by_tool.setdefault(ev["agent_tool"], []).append(ev)

        self.assertIn("claude_code", by_tool)
        self.assertIn("gemini_cli", by_tool)
        self.assertIn("antigravity", by_tool)
        self.assertIn("opencode", by_tool)

        # Verify Claude deduplication & additive input normalization:
        # msg_01: raw_in 500 + cache_read 2000 + cache_write 1000 = 3500 input, 300 output
        claude_main = [e for e in by_tool["claude_code"] if e["agent_type"] == "main"]
        self.assertEqual(len(claude_main), 1)
        self.assertEqual(claude_main[0]["input_tokens"], 3500)
        self.assertEqual(claude_main[0]["cached_input_tokens"], 2000)
        self.assertEqual(claude_main[0]["cache_write_input_tokens"], 1000)
        self.assertEqual(claude_main[0]["output_tokens"], 300)

        # Verify Antigravity additive input normalization:
        # raw_in 2000 + cache_read 12000 = 14000 input, 500 output
        agy_ev = by_tool["antigravity"][0]
        self.assertEqual(agy_ev["input_tokens"], 14000)
        self.assertEqual(agy_ev["cached_input_tokens"], 12000)
        self.assertEqual(agy_ev["output_tokens"], 500)
        self.assertEqual(agy_ev["model"], "gemini-4-neon-high")

        # Verify Gemini CLI tokens including thoughts:
        gem_ev = by_tool["gemini_cli"][0]
        self.assertEqual(gem_ev["input_tokens"], 4000)
        self.assertEqual(gem_ev["cached_input_tokens"], 3000)
        self.assertEqual(gem_ev["reasoning_output_tokens"], 150)

        # Verify pricing resolves all 4 providers cleanly!
        pricing = codex_usage.load_json(Path(__file__).parents[1] / "pricing.json")
        book = codex_usage.PriceBook(pricing)
        for ev in events:
            price = book.cost(ev)
            self.assertTrue(price["known"], f"Unpriced model: {ev['model']}")
            self.assertGreater(price["cost"], 0.0)

        # Verify explorer includes agent_tool dimension
        resolver = codex_usage.ProjectResolver({"project_mode": "cwd"})
        cube = codex_usage.build_explorer_data(events, resolver, book)
        self.assertIn("agent_tool", cube["dimensions"])
        self.assertTrue({"claude_code", "gemini_cli", "antigravity", "opencode"}.issubset(set(cube["dictionaries"]["agent_tool"])))

    def test_multi_agent_graph_collects_sessions_and_subagents(self):
        self._make_claude_fixture()
        self._make_gemini_fixture()
        self._make_antigravity_fixture()
        self._make_opencode_fixture()

        sources = default_agent_sources(
            codex_home=self.codex_home,
            claude_home=self.claude_home,
            gemini_home=self.gemini_home,
            antigravity_home=self.agy_home,
            cursor_home=self.cursor_home,
            opencode_home=self.opencode_home,
            include_others=True,
        )
        collector = AgentGraphCollector(
            self.codex_home,
            codex_usage.ProjectResolver({"project_mode": "cwd"}),
            self.root / "hierarchy.sqlite3",
            include_task_excerpt=True,
            sources=sources,
        )
        graph = collector.snapshot(now=time.time())
        tools_found = {n["agent_tool"] for n in graph["nodes"]}
        self.assertTrue({"claude_code", "gemini_cli", "antigravity", "opencode"}.issubset(tools_found))
        # Antigravity subagent edge linked
        self.assertTrue(
            any(e["source"] == "agy:agy-conv-1" and e["target"] == "agy:agy-conv-sub-1" and e["kind"] == "subagent" for e in graph["edges"])
        )
        # Claude Code subagent edge linked
        self.assertTrue(
            any(e["source"] == "claude:sess-claude-1" and e["target"] == "claude:sess-claude-1:agent-ui" and e["kind"] == "subagent" for e in graph["edges"])
        )
        # Tool summary populated
        self.assertGreaterEqual(len(graph["tools"]), 4)


if __name__ == "__main__":
    unittest.main()
