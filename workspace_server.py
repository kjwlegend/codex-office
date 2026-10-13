"""Loopback-only workbench server; Codex databases are always read-only."""

from __future__ import annotations

import json
import secrets
import sqlite3
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from urllib.request import urlopen

from agent_graph import AgentGraphCollector
from app_version import VERSION
from release_status import ReleaseChecker


class WorkspaceServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, collector, report_path: Path, refresh_seconds=5, refresh_usage=None):
        super().__init__(address, WorkspaceHandler)
        self.collector = collector
        self.report_path = report_path
        self.refresh_seconds = refresh_seconds
        self.edit_token = secrets.token_urlsafe(32)
        self.graph_lock = threading.Lock()
        self.cached_graph = None
        self.cached_at = 0
        self.refresh_usage = refresh_usage
        self.usage_lock = threading.Lock()
        self.usage_job = {"status": "idle", "revision": 0}
        self.release_checker = ReleaseChecker()

    def usage_status(self):
        with self.usage_lock:
            return {**self.usage_job, "available": self.refresh_usage is not None,
                    "edit_token": self.edit_token}

    def start_usage_refresh(self):
        with self.usage_lock:
            if self.refresh_usage is None:
                raise ValueError("当前服务不支持更新用量，请重新启动工作台")
            if self.usage_job["status"] == "running":
                return dict(self.usage_job)
            self.usage_job = {"status": "running", "revision": self.usage_job["revision"] + 1,
                              "started_at": time.time()}
            job = dict(self.usage_job)
        def update():
            try:
                self.refresh_usage()
            except Exception as exc:
                result = {"status": "failed", "error": str(exc)[:240]}
            else:
                result = {"status": "succeeded"}
            with self.usage_lock:
                self.usage_job.update(result, finished_at=time.time())
        threading.Thread(target=update, name="office-usage-refresh", daemon=True).start()
        return job

    @property
    def hosts(self):
        port = self.server_address[1]
        return {f"127.0.0.1:{port}", f"localhost:{port}"}

    def graph(self, force=False):
        with self.graph_lock:
            if force or self.cached_graph is None or time.monotonic() - self.cached_at >= self.refresh_seconds:
                observed = self.collector.snapshot()
                if not observed["nodes"] and observed["warnings"] and self.cached_graph and self.cached_graph["nodes"]:
                    self.cached_graph = {**self.cached_graph, "warnings": observed["warnings"] + ["数据源暂不可读，保留上次观察"], "data_stale": True}
                else:
                    self.cached_graph = observed
                self.cached_at = time.monotonic()
            return {**self.cached_graph, "refresh_seconds": self.refresh_seconds,
                    "capabilities": {"can_edit": not self.cached_graph.get("data_stale", False)}, "edit_token": self.edit_token}


class WorkspaceHandler(BaseHTTPRequestHandler):
    server: WorkspaceServer

    def log_message(self, format, *args):
        # API polling is intentionally quiet; no request bodies or node titles are logged.
        if args and str(args[1] if len(args) > 1 else "") not in {"200", "204"}:
            super().log_message(format, *args)

    def respond(self, status, body, content_type="application/json; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def json_response(self, status, value):
        self.respond(status, json.dumps(value, ensure_ascii=False, separators=(",", ":")))

    def valid_host(self):
        return self.headers.get("Host", "").lower() in self.server.hosts

    def do_GET(self):
        if not self.valid_host():
            self.json_response(403, {"error": "仅允许本机工作台地址"})
            return
        path = urlsplit(self.path).path
        try:
            if path in {"/", "/codex-usage-report.html"}:
                self.respond(200, self.server.report_path.read_bytes(), "text/html; charset=utf-8")
            elif path == "/api/agents":
                self.json_response(200, self.server.graph())
            elif path == "/api/health":
                self.json_response(200, {"ok": True, "app": "codex-local-workbench", "version": VERSION, "workspace": str(self.server.report_path.parent), "mode": "local_records", "codex_read_only": True})
            elif path == "/api/usage-refresh":
                self.json_response(200, self.server.usage_status())
            elif path == "/api/release":
                refresh = parse_qs(urlsplit(self.path).query).get("refresh") == ["1"]
                self.json_response(200, self.server.release_checker.status(refresh=refresh))
            elif path == "/favicon.ico":
                self.respond(204, b"", "image/x-icon")
            else:
                self.json_response(404, {"error": "没有这个工作台入口"})
        except (OSError, ValueError) as exc:
            self.json_response(503, {"error": "本地数据暂不可读：" + str(exc)[:180]})

    def do_POST(self):
        # No API sends prompts, resumes threads, interrupts turns, or edits Codex DBs.
        origin = self.headers.get("Origin", "")
        if not self.valid_host() or origin not in {"http://" + h for h in self.server.hosts}:
            self.json_response(403, {"error": "业务编排只允许在本机工作台内修改"})
            return
        if self.headers.get("X-Workspace-Token") != self.server.edit_token:
            self.json_response(403, {"error": "请重新连接工作台后再保存"})
            return
        path = urlsplit(self.path).path
        if path not in {"/api/hierarchy", "/api/usage-refresh"}:
            self.json_response(404, {"error": "没有这个操作"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 8192 or self.headers.get_content_type() != "application/json":
                self.json_response(400, {"error": "请求必须是小于 8 KiB 的 JSON"})
                return
            data = json.loads(self.rfile.read(size))
            if path == "/api/usage-refresh":
                if data != {}:
                    raise ValueError("更新用量不接受额外参数")
                self.json_response(202, self.server.start_usage_refresh())
                return
            if not isinstance(data, dict) or not isinstance(data.get("child_id"), str):
                raise ValueError("缺少会话标识")
            parent = data.get("parent_id")
            if parent is not None and not isinstance(parent, str):
                raise ValueError("业务上级标识格式不正确")
            automatic = data.get("mode") == "automatic"
            if data.get("mode") not in {"manual", "automatic"}:
                raise ValueError("编排方式不正确")
            graph = self.server.graph()
            if graph.get("data_stale"):
                self.json_response(503, {"error": "数据源暂不可读，待状态恢复后再修改业务编排"})
                return
            parents = {n["id"]: n.get("business_parent_id") for n in graph["nodes"]}
            if automatic:
                sessions = {n["id"] for n in graph["nodes"] if n["kind"] == "session"}
                parent = next((e["source"] for e in graph["edges"] if e["kind"] == "created" and e["target"] == data["child_id"] and e["provenance"] == "create_thread" and e["source"] in sessions), None)
            # Validate reset-to-automatic against other manual links, too.
            self.server.collector.hierarchy.save(data["child_id"], parent, automatic, graph["nodes"], parents)
            self.json_response(200, self.server.graph(force=True))
        except (ValueError, UnicodeError) as exc:
            self.json_response(400, {"error": str(exc)[:180]})
        except (OSError, sqlite3.Error) as exc:
            self.json_response(503, {"error": "编排设置未能保存：" + str(exc)[:180]})


def serve(codex_home, resolver, hierarchy_path, report_path, port=8766, refresh_seconds=5, open_browser=False, refresh_usage=None):
    if not 1 <= port <= 65535 or not 2 <= refresh_seconds <= 60:
        raise ValueError("端口应为 1–65535，刷新间隔应为 2–60 秒")
    if not report_path.is_file():
        raise ValueError("请先生成统计看板：python3 codex_usage.py dashboard --days 30")
    collector = AgentGraphCollector(codex_home, resolver, hierarchy_path, include_task_excerpt=True)
    url = f"http://127.0.0.1:{port}/codex-usage-report.html#page=agents"
    try:
        server = WorkspaceServer(("127.0.0.1", port), collector, report_path, refresh_seconds, refresh_usage)
    except OSError:
        # Reopening this same workbench is harmless; never stop another listener.
        try:
            with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
                health = json.load(response)
            if health.get("app") != "codex-local-workbench" or health.get("workspace") != str(report_path.parent):
                raise ValueError("该端口不是当前工作台")
        except (OSError, ValueError):
            raise OSError(f"端口 {port} 已被占用，请选择其他 --port 或关闭原启动窗口")
        print(f"Workbench already running: {url}", flush=True)
        if open_browser:
            webbrowser.open(url)
        return 0
    print(f"Codex workbench: {url}\nAgent observation every {refresh_seconds}s; Codex sources are read-only.\nPress Ctrl+C to stop.", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
