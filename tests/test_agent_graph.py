import hashlib
import http.client
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from pathlib import Path

from agent_graph import AgentGraphCollector, HierarchyStore, observe_status, write_db
from codex_usage import ProjectResolver
from workspace_server import WorkspaceServer


class AgentGraphTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.state = self.home / "state_5.sqlite"
        self.history = self.home / "thread_history_1.sqlite"
        self.hierarchy = self.home / "workbench.sqlite3"
        self.now = time.time()
        with write_db(self.state) as conn:
            conn.executescript("""
                CREATE TABLE threads(id TEXT PRIMARY KEY,cwd TEXT,title TEXT,source TEXT,model TEXT,
                    created_at REAL,updated_at REAL,archived INTEGER,agent_nickname TEXT,agent_role TEXT);
                CREATE TABLE thread_spawn_edges(parent_thread_id TEXT,child_thread_id TEXT PRIMARY KEY,status TEXT);
            """)
        with write_db(self.history) as conn:
            conn.executescript("""
                CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,started_at REAL,completed_at REAL);
                CREATE INDEX turns_by_thread ON thread_turns(thread_id,rollout_ordinal);
                CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,
                    created_at_ms REAL,completed_at_ms REAL,item_type TEXT,item_json TEXT);
                CREATE INDEX items_by_turn ON thread_items(thread_id,turn_id,rollout_ordinal);
            """)
        self.collector = AgentGraphCollector(self.home, ProjectResolver({"project_mode": "cwd"}), self.hierarchy)

    def thread(self, tid, parent=None, archived=False, created=None):
        source = {"subagent": {"thread_spawn": {"parent_thread_id": parent}}} if parent else "appServer"
        with write_db(self.state) as conn:
            conn.execute("INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?)",
                         (tid, "/test/project", "Task " + tid, json.dumps(source), "gpt-6.1-sol",
                          self.now - 120 if created is None else created, self.now, archived, "Worker " + tid, "worker"))
            if parent:
                conn.execute("INSERT INTO thread_spawn_edges VALUES(?,?,?)", (parent, tid, "open"))

    def turn(self, tid, status="inProgress", ordinal=1, age=5):
        turn_id = tid + "-turn-" + str(ordinal)
        with write_db(self.history) as conn:
            conn.execute("INSERT INTO thread_turns VALUES(?,?,?,?,?,?)",
                         (tid, turn_id, ordinal, status, self.now - age, self.now - age if status != "inProgress" else None))
        return turn_id

    def item(self, tid, turn_id, kind, payload, ordinal=1, age=0):
        with write_db(self.history) as conn:
            conn.execute("INSERT INTO thread_items VALUES(?,?,?,?,?,?,?,?)",
                         (tid, turn_id, tid + "-item-" + str(ordinal), ordinal, (self.now - age) * 1000, None, kind, json.dumps(payload)))

    def create_link(self, parent, child, tool="create_thread", age=0):
        turn = self.turn(parent)
        self.item(parent, turn, "mcpToolCall", {"tool": tool, "status": "completed", "arguments": {"prompt": "PRIVATE PROMPT"},
                  "result": {"content": [{"type": "text", "text": json.dumps({"threadId": child})}]}}, age=age)

    def snapshot(self):
        return self.collector.snapshot(self.now)

    def test_business_sessions_remain_primary_and_native_agents_have_ownership(self):
        self.thread("a"); self.thread("b"); self.thread("c", parent="b"); self.thread("d", parent="c")
        self.create_link("a", "b")
        nodes = {n["id"]: n for n in self.snapshot()["nodes"]}
        self.assertEqual(nodes["b"]["kind"], "session")
        self.assertEqual(nodes["b"]["business_parent_id"], "a")
        self.assertEqual(nodes["c"]["kind"], "subagent")
        self.assertEqual(nodes["d"]["owner_session_id"], "b")
        self.assertEqual(nodes["d"]["parent_agent_id"], "c")

    def test_fork_is_creation_not_assumed_business_delegation(self):
        self.thread("a"); self.thread("b"); self.create_link("a", "b", tool="fork_thread")
        b = next(n for n in self.snapshot()["nodes"] if n["id"] == "b")
        self.assertEqual(b["created_by"], "a")
        self.assertIsNone(b["business_parent_id"])

    def test_inherited_creation_history_is_not_a_new_edge(self):
        self.thread("clone", created=self.now + 20); self.thread("b")
        self.create_link("clone", "b", age=20)
        self.assertFalse(any(e["kind"] == "created" for e in self.snapshot()["edges"]))

    def test_message_link_does_not_change_business_parent(self):
        self.thread("a"); self.thread("b")
        turn = self.turn("a")
        self.item("a", turn, "mcpToolCall", {"tool": "send_message_to_thread", "status": "completed", "arguments": {"threadId": "b", "prompt": "PRIVATE PROMPT"}, "result": {}})
        graph = self.snapshot()
        self.assertEqual([e["kind"] for e in graph["edges"]], ["collaboration"])
        self.assertIsNone(next(n for n in graph["nodes"] if n["id"] == "b")["business_parent_id"])
        self.assertNotIn("PRIVATE PROMPT", json.dumps(graph))

    def test_latest_completed_turn_beats_old_in_progress_and_open_spawn_edge(self):
        self.thread("a"); self.thread("worker", parent="a")
        self.turn("worker", age=10000)
        self.turn("worker", status="completed", ordinal=2)
        worker = next(n for n in self.snapshot()["nodes"] if n["id"] == "worker")
        self.assertEqual(worker["status"], "idle")

    def test_old_unfinished_turn_is_unknown_not_working_or_stuck(self):
        self.thread("a"); self.turn("a", age=700)
        self.assertEqual(self.snapshot()["nodes"][0]["status"], "unknown")
        fresh = observe_status(False, {"status": "inProgress", "started_at": self.now},
                               {"status": "inProgress", "tool": "wait", "created_at_ms": self.now * 1000}, self.now)
        self.assertEqual(fresh["status"], "waiting_agents")

    def test_manual_hierarchy_keeps_creation_history_and_native_ownership(self):
        self.thread("a"); self.thread("b"); self.thread("other"); self.thread("worker", parent="b")
        self.create_link("a", "b")
        before = hashlib.sha256(self.state.read_bytes()).hexdigest()
        graph = self.snapshot()
        self.collector.hierarchy.save("b", "other", False, graph["nodes"], {"b": "a"})
        nodes = {n["id"]: n for n in self.snapshot()["nodes"]}
        self.assertEqual(nodes["b"]["business_parent_id"], "other")
        self.assertEqual(nodes["b"]["created_by"], "a")
        self.assertEqual(nodes["worker"]["owner_session_id"], "b")
        self.assertEqual(hashlib.sha256(self.state.read_bytes()).hexdigest(), before)
        self.assertEqual(HierarchyStore(self.hierarchy).read(), {"b": "other"})

    def test_manual_root_suppresses_default_and_automatic_reset_restores_it(self):
        self.thread("a"); self.thread("b"); self.create_link("a", "b")
        graph = self.snapshot()
        self.collector.hierarchy.save("b", None, False, graph["nodes"], {"b": "a"})
        self.assertIsNone(next(n for n in self.snapshot()["nodes"] if n["id"] == "b")["business_parent_id"])
        self.collector.hierarchy.save("b", None, True, graph["nodes"], {})
        self.assertEqual(next(n for n in self.snapshot()["nodes"] if n["id"] == "b")["business_parent_id"], "a")

    def test_cycles_and_subagent_reparenting_are_rejected(self):
        self.thread("a"); self.thread("b"); self.thread("worker", parent="a")
        graph = self.snapshot()
        with self.assertRaisesRegex(ValueError, "循环"):
            self.collector.hierarchy.save("a", "b", False, graph["nodes"], {"b": "a"})
        with self.assertRaisesRegex(ValueError, "subagent"):
            self.collector.hierarchy.save("b", "worker", False, graph["nodes"], {})
        self.assertFalse(self.hierarchy.exists())

    def test_live_excerpt_is_short_redacted_and_not_in_offline_snapshot(self):
        self.thread("a"); turn = self.turn("a")
        self.item("a", turn, "userMessage", {"content": [{"type": "text", "text": '<in-app-browser-context>PRIVATE CONTEXT</in-app-browser-context>\n## My request:\n制作画布 api_key=sk-verysecret123456789 ' + "说明" * 100}]})
        self.item("a", turn, "commandExecution", {"command": "PRIVATE COMMAND", "aggregatedOutput": "PRIVATE OUTPUT", "status": "completed"}, ordinal=2)
        offline = self.snapshot()
        live = AgentGraphCollector(self.home, ProjectResolver({"project_mode": "cwd"}), self.hierarchy, include_task_excerpt=True).snapshot(self.now)
        self.assertEqual(offline["nodes"][0]["task_source"], "session_title")
        self.assertEqual(live["nodes"][0]["task_source"], "current_request_excerpt")
        self.assertLessEqual(len(live["nodes"][0]["task_summary"]), 140)
        for value in ["PRIVATE CONTEXT", "PRIVATE COMMAND", "PRIVATE OUTPUT", "sk-verysecret"]:
            self.assertNotIn(value, json.dumps(live))
        self.assertFalse(self.hierarchy.exists())

    def test_missing_database_degrades_with_explanation(self):
        graph = AgentGraphCollector(self.home / "missing", ProjectResolver({}), self.hierarchy).snapshot()
        self.assertEqual(graph["nodes"], [])
        self.assertTrue(graph["warnings"])

    def test_native_agent_without_known_parent_is_not_mislabeled_primary(self):
        self.thread("orphan")
        with write_db(self.state) as conn:
            conn.execute("UPDATE threads SET source=? WHERE id='orphan'", (json.dumps({"subagent": "review"}),))
        node = self.snapshot()["nodes"][0]
        self.assertEqual(node["kind"], "subagent")
        self.assertIsNone(node["owner_session_id"])

    def test_transient_source_failure_retains_last_snapshot_and_disables_edits(self):
        self.thread("a"); self.turn("a")
        server = self.make_server()
        first = server.graph(force=True)
        with patch.object(self.collector, "snapshot", return_value={"nodes": [], "warnings": ["database locked"]}):
            retained = server.graph(force=True)
            self.assertEqual(retained["nodes"], first["nodes"])
            self.assertEqual(retained["observed_at"], first["observed_at"])
            self.assertFalse(retained["capabilities"]["can_edit"])
            self.assertTrue(retained["data_stale"])

    def make_server(self):
        server = WorkspaceServer(("127.0.0.1", 0), self.collector, self.home / "report.html", 2)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def request(self, server, method, path, data=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
        conn.request(method, path, json.dumps(data) if data is not None else None, headers or {})
        response = conn.getresponse()
        value = json.loads(response.read())
        status = response.status
        conn.close()
        return status, value

    def test_server_blocks_foreign_hosts_origins_and_files(self):
        self.thread("a"); server = self.make_server()
        self.assertEqual(self.request(server, "GET", "/api/agents", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request(server, "GET", "/config.json")[0], 404)
        self.assertEqual(self.request(server, "POST", "/api/hierarchy", {"child_id": "a"}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request(server, "GET", "/api/health")[1]["codex_read_only"], True)
        self.assertFalse(self.hierarchy.exists())

    def test_server_saves_hierarchy_without_agent_actions_and_rejects_reset_cycle(self):
        self.thread("a"); self.thread("b"); self.create_link("a", "b")
        server = self.make_server()
        headers = {"Origin": "http://127.0.0.1:" + str(server.server_address[1]), "Content-Type": "application/json", "X-Workspace-Token": server.edit_token}
        status, _ = self.request(server, "POST", "/api/hierarchy", {"child_id": "b", "parent_id": None, "mode": "manual"}, headers)
        self.assertEqual(status, 200)
        status, _ = self.request(server, "POST", "/api/hierarchy", {"child_id": "a", "parent_id": "b", "mode": "manual"}, headers)
        self.assertEqual(status, 200)
        before = HierarchyStore(self.hierarchy).read()
        status, result = self.request(server, "POST", "/api/hierarchy", {"child_id": "b", "parent_id": None, "mode": "automatic"}, headers)
        self.assertEqual(status, 400)
        self.assertIn("循环", result["error"])
        self.assertEqual(HierarchyStore(self.hierarchy).read(), before)


if __name__ == "__main__":
    unittest.main()
