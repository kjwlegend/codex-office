"""Passive local Agent observations. Never resume, message, or modify Codex threads.

Only titles, topology, model metadata and event status are stored in snapshots.
The live service can expose a redacted 140-character current-request excerpt in
memory only. Full conversation, reasoning, commands and outputs stay in Codex.
The optional hierarchy DB belongs to this workbench, not to Codex.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ACTIVE_STATES = {"working", "waiting_agents", "waiting_user"}
FRESH_SECONDS = 300
STATUS_LABELS = {
    "working": "执行中 · 记录观察", "waiting_agents": "等待代理", "waiting_user": "等待确认",
    "idle": "本轮已结束", "failed": "本轮失败", "interrupted": "已中断",
    "archived": "已归档", "unknown": "状态待确认",
}


def json_object(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def brief(value: Any, length: int = 140) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.sub(r"\bsk-[A-Za-z0-9_-]{12,}", "[已隐藏密钥]", text)
    text = re.sub(r"(?i)(bearer\s+|(?:api[_ -]?key|password|secret|token)\s*[=:]\s*)[^\s,;]+", r"\1[已隐藏]", text)
    return text if len(text) <= length else text[:length - 1] + "…"


def epoch(value: Any) -> float:
    try:
        number = float(value or 0)
        return number / 1000 if number > 100_000_000_000 else number
    except (ValueError, TypeError):
        return 0


def task_excerpt(item: Any) -> str:
    value = json_object(item)
    content = value.get("content") or []
    text = "\n".join(str(c.get("text") or "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    if "<heartbeat>" in text:
        match = re.search(r"<instructions>(.*?)</instructions>", text, re.S)
        text = match.group(1) if match else "定时任务更新"
    else:
        text = re.sub(r"<(in-app-browser-context|environment_context|external_codex_apps_open_page)\b[^>]*>.*?</\1>", "", text, flags=re.S)
        for marker in ("## My request:", "## My request for Codex:"):
            if marker in text:
                text = text.rsplit(marker, 1)[-1]
    text = brief(text)
    return "" if text.lower() in {"继续", "好的", "好", "可以", "开始", "继续执行", "ok", "go"} else text


@contextmanager
def read_db(path: Path):
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=1)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def write_db(path: Path):
    conn = sqlite3.connect(path)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def newest_db(home: Path, prefix: str) -> Path | None:
    candidates = list(home.glob(prefix + "_*.sqlite"))
    def version(path):
        match = re.search(r"_(\d+)\.sqlite$", path.name)
        return int(match[1]) if match else -1
    return max(candidates, key=version) if candidates else None


def observe_status(archived: bool, turn: dict | None, item: dict | None, now: float) -> dict:
    turn, item = turn or {}, item or {}
    observed = max(epoch(turn.get("started_at")), epoch(turn.get("completed_at")),
                   epoch(item.get("created_at_ms")), epoch(item.get("completed_at_ms")))
    state, reason = "unknown", "没有可确认的当前回合状态"
    activity = "尚无活动记录"
    kinds = {"commandExecution": "执行本地操作", "fileChange": "修改项目文件",
             "reasoning": "推进当前工作", "agentMessage": "整理工作结果",
             "webSearch": "查阅资料", "imageGeneration": "生成图像",
             "imageView": "查看图像", "contextCompaction": "整理会话上下文",
             "subAgentActivity": "处理代理分支动态", "plan": "更新工作计划"}
    activity = kinds.get(item.get("item_type"), "推进当前工作" if observed else activity)
    tool = str(item.get("tool") or "").rsplit("__", 1)[-1]
    if item.get("item_type") == "mcpToolCall":
        activity = "使用工具 · " + brief(tool, 45)
    if archived:
        state, reason = "archived", "会话已归档；不代表业务目标完成"
    elif turn.get("status") in {"completed", "failed", "interrupted"}:
        state = {"completed": "idle", "failed": "failed", "interrupted": "interrupted"}[turn["status"]]
        reason = "最新回合记录；本轮结束不等于整个项目完成"
    elif turn.get("status") in {"inProgress", "in_progress", "active"}:
        age = now - observed
        if observed and -30 <= age <= FRESH_SECONDS:
            state, reason = "working", "最近 5 分钟内有未结束回合的活动记录；不是运行时订阅确认"
            pending = item.get("status") in {"inProgress", "in_progress", "started", "running"}
            if pending and tool in {"wait", "wait_agent", "wait_threads"}:
                state, activity = "waiting_agents", "等待其他代理返回"
            elif pending and tool in {"request_user_input", "request_user_input_async", "request_permissions"}:
                state, activity = "waiting_user", "等待用户回应"
        else:
            reason = "未结束记录已超过 5 分钟或存在时钟差异；无法确认是否仍在运行，不据此判断卡住"
    return {"status": state, "status_label": STATUS_LABELS[state], "status_reason": reason,
            "last_activity_at": observed, "current_activity": activity,
            "turn_status": turn.get("status"), "status_source": "local_turn_history"}


class HierarchyStore:
    def __init__(self, path: Path):
        self.path = path

    def read(self) -> dict[str, str | None]:
        if not self.path.exists():
            return {}
        with read_db(self.path) as conn:
            return {r["child_id"]: r["parent_id"] for r in conn.execute("SELECT child_id,parent_id FROM hierarchy")}

    def save(self, child: str, parent: str | None, automatic: bool, nodes: list[dict], parents: dict):
        sessions = {n["id"] for n in nodes if n["kind"] == "session"}
        if child not in sessions or (parent is not None and parent not in sessions):
            raise ValueError("业务上下级只能选择存在的独立会话，不能选择 subagent")
        cursor, seen = parent, {child}
        while cursor:
            if cursor in seen:
                raise ValueError("这会形成循环委托，请选择其他业务上级")
            seen.add(cursor)
            cursor = parents.get(cursor)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with write_db(self.path) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS hierarchy (child_id TEXT PRIMARY KEY,parent_id TEXT,updated_at REAL NOT NULL)")
            if automatic:
                conn.execute("DELETE FROM hierarchy WHERE child_id=?", (child,))
            else:
                conn.execute("INSERT INTO hierarchy VALUES (?,?,?) ON CONFLICT(child_id) DO UPDATE SET parent_id=excluded.parent_id,updated_at=excluded.updated_at", (child, parent, time.time()))


class AgentGraphCollector:
    def __init__(self, codex_home: Path, resolver, hierarchy_path: Path, include_task_excerpt=False):
        self.home = codex_home.expanduser()
        self.resolver = resolver
        self.hierarchy = HierarchyStore(hierarchy_path)
        self.include_task_excerpt = include_task_excerpt

    def snapshot(self, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        result = {"version": 1, "observed_at": datetime.fromtimestamp(now, timezone.utc).isoformat(timespec="seconds"),
                  "observation_mode": "local_records", "refresh_seconds": 5, "nodes": [], "edges": [],
                  "projects": [], "warnings": [], "capabilities": {"can_edit": False},
                  "status_note": "只读观察本地记录，不是 Codex 运行时订阅；超过 5 分钟的未结束记录显示为待确认。"}
        state_path = newest_db(self.home, "state")
        history_path = newest_db(self.home, "thread_history")
        if state_path is None:
            result["warnings"].append("没有找到本地 Codex 会话数据库")
            return result
        try:
            with read_db(state_path) as conn:
                columns = {r["name"] for r in conn.execute("PRAGMA table_info(threads)")}
                wanted = ["id", "cwd", "title", "name", "source", "model", "model_provider", "reasoning_effort",
                          "agent_nickname", "agent_role", "agent_path", "archived", "created_at", "updated_at",
                          "created_at_ms", "updated_at_ms", "cli_version"]
                rows = [dict(r) for r in conn.execute("SELECT " + ",".join(k for k in wanted if k in columns) + " FROM threads ORDER BY created_at,id")]
                has_edges = conn.execute("SELECT 1 FROM sqlite_master WHERE name='thread_spawn_edges'").fetchone()
                spawn_rows = [dict(r) for r in conn.execute("SELECT * FROM thread_spawn_edges")] if has_edges else []
        except (OSError, sqlite3.Error) as exc:
            result["warnings"].append("读取会话元数据失败：" + brief(exc))
            return result
        metadata = {r["id"]: r for r in rows}
        native_parents, native_ids = {}, set()
        for row in rows:
            source = json_object(row.get("source"))
            if "subagent" in source or str(row.get("source") or "").lower().startswith("subagent"):
                native_ids.add(row["id"])
            spawn = source.get("subagent", {})
            spawn = spawn.get("thread_spawn", {}) if isinstance(spawn, dict) else {}
            if isinstance(spawn.get("parent_thread_id"), str) and spawn["parent_thread_id"]:
                native_parents[row["id"]] = spawn["parent_thread_id"]
        for edge in spawn_rows:
            # The native spawn table describes subagents, never business session types.
            native_parents.setdefault(edge["child_thread_id"], edge["parent_thread_id"])
            native_ids.add(edge["child_thread_id"])
        statuses, created, collaboration, tasks = {}, {}, {}, {}
        if history_path is not None:
            try:
                with read_db(history_path) as conn:
                    for row in rows:
                        tid = row["id"]
                        turn_row = conn.execute("SELECT turn_id,status,started_at,completed_at FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1", (tid,)).fetchone()
                        turn = dict(turn_row) if turn_row else {}
                        item = None
                        if turn:
                            item_row = conn.execute("SELECT item_type,created_at_ms,completed_at_ms,json_extract(item_json,'$.status') AS status,json_extract(item_json,'$.tool') AS tool FROM thread_items WHERE thread_id=? AND turn_id=? ORDER BY rollout_ordinal DESC LIMIT 1", (tid, turn["turn_id"])).fetchone()
                            item = dict(item_row) if item_row else None
                        statuses[tid] = observe_status(bool(row.get("archived")), turn, item, now)
                        if self.include_task_excerpt and turn and not row.get("archived") and statuses[tid]["last_activity_at"] >= now - 86400:
                            user_row = conn.execute("SELECT item_json FROM thread_items WHERE thread_id=? AND turn_id=? AND item_type='userMessage' ORDER BY rollout_ordinal DESC LIMIT 1", (tid, turn["turn_id"])).fetchone()
                            if user_row:
                                tasks[tid] = task_excerpt(user_row[0])
                    link_rows = conn.execute("SELECT thread_id,created_at_ms,json_extract(item_json,'$.tool') AS tool,json_extract(item_json,'$.status') AS status,json_extract(item_json,'$.arguments.threadId') AS receiver,json_extract(item_json,'$.result') AS result FROM thread_items WHERE item_type='mcpToolCall' AND (json_extract(item_json,'$.tool') LIKE '%create_thread' OR json_extract(item_json,'$.tool') LIKE '%fork_thread' OR json_extract(item_json,'$.tool') LIKE '%send_message_to_thread') ORDER BY created_at_ms")
                    for link in link_rows:
                        sender = link["thread_id"]
                        if sender not in metadata or link["status"] != "completed":
                            continue
                        # Forks can copy old tool history; copied creation is not a new delegation.
                        if epoch(link["created_at_ms"]) + 3 < epoch(metadata[sender].get("created_at_ms") or metadata[sender].get("created_at")):
                            continue
                        tool = str(link["tool"]).rsplit("__", 1)[-1]
                        if tool == "send_message_to_thread":
                            receiver = link["receiver"]
                            if receiver in metadata and receiver != sender:
                                collaboration[(sender, receiver)] = {"source": sender, "target": receiver, "kind": "collaboration", "provenance": "recorded_message"}
                        else:
                            output = json_object(link["result"])
                            values = [output.get("structuredContent") or {}]
                            values.extend(json_object(c.get("text")) for c in (output.get("content") or []) if isinstance(c, dict) and c.get("type") == "text")
                            for value in values:
                                if not isinstance(value, dict):
                                    continue
                                child = value.get("threadId")
                                if isinstance(child, str) and child in metadata and child != sender and child not in native_ids:
                                    created.setdefault(child, {"source": sender, "target": child, "kind": "created", "provenance": tool})
            except (OSError, sqlite3.Error) as exc:
                result["warnings"].append("回合或关系记录读取不完整：" + brief(exc))
        else:
            result["warnings"].append("没有回合历史库，无法判断当前执行状态")
        nodes = []
        for row in rows:
            tid = row["id"]
            name, project_path = self.resolver.resolve(str(row.get("cwd") or "unknown"))
            parent = native_parents.get(tid)
            owner, seen = tid, set()
            while owner in native_parents and owner not in seen:
                seen.add(owner)
                owner = native_parents[owner]
            if owner in seen or owner not in metadata or tid in native_ids and tid not in native_parents:
                owner = None
            observation = statuses.get(tid) or observe_status(bool(row.get("archived")), None, None, now)
            last_activity = observation["last_activity_at"] or epoch(row.get("updated_at_ms") or row.get("updated_at"))
            title = brief(row.get("name") or row.get("title") or "未命名会话", 180)
            nodes.append({"id": tid, "usage_key": hashlib.sha256(tid.encode("utf-8")).hexdigest()[:24],
                          "kind": "subagent" if tid in native_ids else "session",
                          "title": title, "task_summary": tasks.get(tid) or title,
                          "task_source": "current_request_excerpt" if tasks.get(tid) else "session_title",
                          "agent_name": brief(row.get("agent_nickname") or ("Subagent" if tid in native_ids else "主 Agent"), 45),
                          "agent_role": brief(row.get("agent_role") or "default", 40),
                          "model": brief(row.get("model") or "unknown", 60), "reasoning_effort": brief(row.get("reasoning_effort") or "unknown", 20),
                          "project": name, "project_id": project_path, "cwd": str(row.get("cwd") or ""),
                          "created_at": epoch(row.get("created_at_ms") or row.get("created_at")),
                          "archived": bool(row.get("archived")), "parent_agent_id": parent,
                          "owner_session_id": owner, "created_by": created.get(tid, {}).get("source"),
                          **observation, "last_activity_at": last_activity})
        by_id = {n["id"]: n for n in nodes}
        parents = {child: edge["source"] for child, edge in created.items()
                   if edge["provenance"] == "create_thread" and by_id.get(edge["source"], {}).get("kind") == "session"}
        try:
            overrides = self.hierarchy.read()
        except (OSError, sqlite3.Error) as exc:
            overrides = {}
            result["warnings"].append("业务编排配置读取失败：" + brief(exc))
        for child, parent in overrides.items():
            if by_id.get(child, {}).get("kind") == "session" and (parent is None or by_id.get(parent, {}).get("kind") == "session"):
                if parent:
                    parents[child] = parent
                else:
                    parents.pop(child, None)
        for child in list(parents):
            seen, cursor = {child}, parents[child]
            while cursor:
                if cursor in seen:
                    parents.pop(child, None)
                    result["warnings"].append("忽略循环业务关系，相关会话保持独立")
                    break
                seen.add(cursor)
                cursor = parents.get(cursor)
        edges = [{"source": p, "target": c, "kind": "subagent", "provenance": "native_spawn"}
                 for c, p in native_parents.items() if p in by_id and c in by_id]
        edges += list(created.values()) + list(collaboration.values())
        edges += [{"source": p, "target": c, "kind": "delegation", "provenance": "manual" if c in overrides else "created_default"}
                  for c, p in parents.items()]
        for node in nodes:
            node["business_parent_id"] = parents.get(node["id"])
            node["hierarchy_mode"] = "manual" if node["id"] in overrides else "automatic"
            descendants = [n for n in nodes if n["parent_agent_id"] == node["id"]]
            node["direct_subagent_count"] = len(descendants)
            node["direct_active_subagents"] = sum(n["status"] in ACTIVE_STATES for n in descendants)
        projects = {}
        for node in nodes:
            p = projects.setdefault(node["project_id"], {"id": node["project_id"], "name": node["project"], "sessions": 0, "subagents": 0, "active": 0})
            p["sessions" if node["kind"] == "session" else "subagents"] += 1
            p["active"] += node["status"] in ACTIVE_STATES
        result.update(nodes=nodes, edges=edges, projects=list(projects.values()))
        return result
