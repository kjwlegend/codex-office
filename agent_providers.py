"""Multi-agent local data collectors (read-only) for mainstream AI coding tools.

Supports:
- Codex (~/.codex)
- Claude Code (~/.claude, ~/.config/claude)
- Gemini CLI (~/.gemini/tmp, ~/.gemini/history)
- Antigravity (~/.gemini/antigravity, ~/.gemini/antigravity-cli)
- Cursor (~/.cursor)
- OpenCode (~/.local/share/opencode)

All external tool databases and logs are opened strictly read-only. Only safe
metadata, token counters, status, and short redacted task excerpts (live API
only) are read. Full prompts, reasoning, commands, and outputs are never
persisted into the local index or exported snapshots.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from zoneinfo import ZoneInfo


AGENT_TOOL_META: dict[str, dict[str, str]] = {
    "codex": {
        "id": "codex",
        "label": "Codex",
        "short": "Codex",
        "provider": "openai",
        "color": "#10a37f",
    },
    "claude_code": {
        "id": "claude_code",
        "label": "Claude Code",
        "short": "Claude",
        "provider": "anthropic",
        "color": "#d97757",
    },
    "gemini_cli": {
        "id": "gemini_cli",
        "label": "Gemini CLI",
        "short": "Gemini",
        "provider": "google",
        "color": "#4285f4",
    },
    "antigravity": {
        "id": "antigravity",
        "label": "Antigravity",
        "short": "AGY",
        "provider": "google",
        "color": "#7c5cff",
    },
    "cursor": {
        "id": "cursor",
        "label": "Cursor",
        "short": "Cursor",
        "provider": "cursor",
        "color": "#0ea5e9",
    },
    "opencode": {
        "id": "opencode",
        "label": "OpenCode",
        "short": "OpenCode",
        "provider": "opencode",
        "color": "#f59e0b",
    },
}

ALL_AGENT_TOOLS = tuple(AGENT_TOOL_META.keys())
FRESH_SECONDS = 300

TOOL_ACTIVITY_MAP = {
    "run_command": "执行本地操作",
    "bash": "执行本地操作",
    "shell": "执行本地操作",
    "terminal": "执行本地操作",
    "execute_command": "执行本地操作",
    "edit_file": "修改项目文件",
    "write_file": "修改项目文件",
    "write_to_file": "修改项目文件",
    "replace_file_content": "修改项目文件",
    "multi_replace_file_content": "修改项目文件",
    "edit": "修改项目文件",
    "write": "修改项目文件",
    "multiedit": "修改项目文件",
    "notebookedit": "修改项目文件",
    "read_file": "阅读项目源码",
    "read": "阅读项目源码",
    "view_file": "阅读项目源码",
    "view_file_outline": "阅读项目源码",
    "grep": "检索代码仓库",
    "grep_search": "检索代码仓库",
    "glob": "检索代码仓库",
    "find_by_name": "检索代码仓库",
    "search_web": "查阅资料",
    "websearch": "查阅资料",
    "webfetch": "查阅资料",
    "read_url_content": "查阅资料",
    "invoke_subagent": "调度子代理协作",
    "agent": "调度子代理协作",
    "task": "调度子代理协作",
    "swarm": "多代理协同调度",
    "ask_question": "等待用户回应",
    "askuserquestion": "等待用户回应",
    "update_steps": "更新工作计划",
    "todowrite": "更新工作计划",
}


def tool_label(tool_id: str) -> str:
    return AGENT_TOOL_META.get(tool_id, {}).get("label", tool_id or "Unknown")


def infer_model_provider(model: str, default: str = "unknown") -> str:
    lower = (model or "").lower()
    if any(tok in lower for tok in ("claude", "sonnet", "opus", "haiku", "anthropic")):
        return "anthropic"
    if any(tok in lower for tok in ("gemini", "gemma", "palm", "google")):
        return "google"
    if any(tok in lower for tok in ("gpt-", "o1", "o3", "o4", "codex", "openai")):
        return "openai"
    if any(tok in lower for tok in ("deepseek",)):
        return "deepseek"
    if any(tok in lower for tok in ("qwen",)):
        return "qwen"
    if any(tok in lower for tok in ("kimi", "moonshot")):
        return "moonshot"
    if any(tok in lower for tok in ("glm", "zhipu")):
        return "zhipu"
    return default


def infer_reasoning_effort(model: str, explicit: str = "") -> str:
    if explicit and explicit != "unknown":
        return explicit
    lower = (model or "").lower()
    for suffix, effort in (
        ("-xhigh", "xhigh"),
        ("-high", "high"),
        ("-medium", "medium"),
        ("-med", "medium"),
        ("-low", "low"),
        ("-minimal", "low"),
    ):
        if lower.endswith(suffix):
            return effort
    return "unknown"


def _brief(value: Any, length: int = 140) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.sub(r"\bsk-[A-Za-z0-9_-]{12,}", "[已隐藏密钥]", text)
    text = re.sub(
        r"(?i)(bearer\s+|(?:api[_ -]?key|password|secret|token)\s*[=:]\s*)[^\s,;]+",
        r"\1[已隐藏]",
        text,
    )
    return text if len(text) <= length else text[: length - 1] + "…"


def _parse_ts(value: Any) -> datetime | None:
    if isinstance(value, (int, float)):
        num = float(value)
        if num <= 0:
            return None
        if num > 100_000_000_000:
            num /= 1000.0
        try:
            return datetime.fromtimestamp(num, tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _local_dims(timestamp_value: Any, tz: ZoneInfo, fallback: date) -> tuple[str, int, int, str]:
    parsed = _parse_ts(timestamp_value)
    if parsed is None:
        return fallback.isoformat(), 0, fallback.weekday(), ""
    localized = parsed.astimezone(tz)
    return (
        localized.date().isoformat(),
        localized.hour,
        localized.weekday(),
        parsed.astimezone(timezone.utc).isoformat(timespec="seconds"),
    )


def _file_uri_to_path(uri: str) -> str:
    if not uri:
        return ""
    if uri.startswith("file://"):
        parsed = urlparse(uri)
        return unquote(parsed.path or "")
    return uri


def _decode_encoded_project_dir(name: str) -> str:
    """Best-effort decode of Claude/Cursor hyphen-encoded directory names."""
    if not name or name in {"empty-window", "unknown"}:
        return "unknown"
    if name.startswith("-"):
        candidate = "/" + name[1:].replace("-", "/")
        if Path(candidate).exists():
            return candidate
        return "/" + name[1:]
    if name.startswith("Users-"):
        # Reconstruct /Users/<user>/... greedily against existing directories.
        parts = name.split("-")
        cur = Path("/")
        i = 0
        while i < len(parts):
            matched = False
            for j in range(len(parts), i, -1):
                seg = "-".join(parts[i:j])
                nxt = cur / seg
                if nxt.exists():
                    cur = nxt
                    i = j
                    matched = True
                    break
            if not matched:
                cur = cur / parts[i]
                i += 1
        return str(cur)
    return name


def _activity_for_tool_name(name: str) -> str:
    if not name:
        return "推进当前工作"
    clean = str(name).rsplit("__", 1)[-1].strip()
    mapped = TOOL_ACTIVITY_MAP.get(clean.lower())
    if mapped:
        return mapped
    return "使用工具 · " + _brief(clean, 45)


@contextmanager
def _read_sqlite(path: Path):
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=1)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    try:
        yield conn
    finally:
        conn.close()


def _safe_int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def default_agent_sources(
    codex_home: Path | None = None,
    claude_home: Path | None = None,
    gemini_home: Path | None = None,
    antigravity_home: Path | None = None,
    cursor_home: Path | None = None,
    opencode_home: Path | None = None,
    config: dict[str, Any] | None = None,
    include_others: bool = True,
) -> dict[str, list[Path]]:
    """Return discovered root directories for each agent tool."""
    cfg_sources = (config or {}).get("agent_sources") or {}
    if not isinstance(cfg_sources, dict):
        cfg_sources = {}

    def expand_paths(explicit: Path | None, cfg_key: str, env_vars: tuple[str, ...], defaults: tuple[str, ...]) -> list[Path]:
        if explicit is not None:
            return [explicit.expanduser()]
        if cfg_key in cfg_sources and cfg_sources[cfg_key]:
            raw = cfg_sources[cfg_key]
            items = [raw] if isinstance(raw, str) else list(raw)
            return [Path(p).expanduser() for p in items if isinstance(p, str) and p]
        for env in env_vars:
            if os.environ.get(env):
                return [Path(os.environ[env]).expanduser()]
        return [Path(p).expanduser() for p in defaults]

    sources: dict[str, list[Path]] = {
        "codex": expand_paths(codex_home, "codex", ("CODEX_HOME",), ("~/.codex",)),
    }
    if not include_others:
        for tool, explicit in (
            ("claude_code", claude_home),
            ("gemini_cli", gemini_home),
            ("antigravity", antigravity_home),
            ("cursor", cursor_home),
            ("opencode", opencode_home),
        ):
            if explicit is not None:
                sources[tool] = [explicit.expanduser()]
        return sources

    sources["claude_code"] = expand_paths(
        claude_home, "claude_code", ("CLAUDE_CONFIG_DIR",), ("~/.claude", "~/.config/claude")
    )
    sources["gemini_cli"] = expand_paths(
        gemini_home, "gemini_cli", ("GEMINI_HOME",), ("~/.gemini",)
    )
    sources["antigravity"] = expand_paths(
        antigravity_home,
        "antigravity",
        ("ANTIGRAVITY_HOME",),
        ("~/.gemini/antigravity", "~/.gemini/antigravity-cli"),
    )
    sources["cursor"] = expand_paths(
        cursor_home, "cursor", ("CURSOR_HOME",), ("~/.cursor",)
    )
    sources["opencode"] = expand_paths(
        opencode_home, "opencode", ("OPENCODE_DATA_DIR",), ("~/.local/share/opencode",)
    )
    return sources


# ---------------------------------------------------------------------------
# Usage Event Insertion Helper
# ---------------------------------------------------------------------------

def _insert_event(
    conn: sqlite3.Connection,
    *,
    file_path: str,
    line_no: int,
    timestamp: str,
    day: str,
    local_hour: int,
    weekday: int,
    cwd: str,
    model: str,
    session_id: str,
    originator: str,
    source_surface: str,
    cli_version: str,
    reasoning_effort: str,
    agent_type: str,
    agent_nickname: str,
    model_provider: str,
    agent_tool: str,
    input_tokens: int,
    cached_input_tokens: int,
    cache_write_input_tokens: int,
    output_tokens: int,
    reasoning_output_tokens: int,
    total_tokens: int,
    context_window: int | None = None,
) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO usage_events (
            file_path, line_no, timestamp, day, local_hour, weekday, cwd, model,
            session_id, originator, source_surface, cli_version,
            reasoning_effort, agent_type, agent_nickname, model_provider, agent_tool,
            input_tokens, cached_input_tokens, cache_write_input_tokens,
            output_tokens, reasoning_output_tokens, total_tokens, context_window
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            file_path,
            line_no,
            timestamp,
            day,
            local_hour,
            weekday,
            cwd or "unknown",
            model or "unknown",
            session_id or "",
            originator or agent_tool,
            source_surface or "unknown",
            cli_version or "unknown",
            reasoning_effort or "unknown",
            agent_type or "main",
            agent_nickname or "",
            model_provider or "unknown",
            agent_tool,
            input_tokens,
            cached_input_tokens,
            cache_write_input_tokens,
            output_tokens,
            reasoning_output_tokens,
            total_tokens,
            context_window,
        ),
    )


def _file_unchanged(conn: sqlite3.Connection, path: Path, scan_version: int) -> tuple[bool, os.stat_result]:
    stat = path.stat()
    stored = conn.execute("SELECT * FROM files WHERE path = ?", (str(path),)).fetchone()
    unchanged = (
        stored is not None
        and stored["scan_version"] == scan_version
        and stored["inode"] == stat.st_ino
        and stored["size"] == stat.st_size
        and stored["mtime_ns"] == stat.st_mtime_ns
    )
    return unchanged, stat


def _save_file_record(
    conn: sqlite3.Connection,
    path: Path,
    stat: os.stat_result,
    offset: int,
    line_no: int,
    state: dict[str, Any],
    scan_version: int,
) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO files
            (path, inode, size, mtime_ns, offset, line_no, state_json, scan_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(path),
            stat.st_ino,
            stat.st_size,
            stat.st_mtime_ns,
            offset,
            line_no,
            json.dumps(state, separators=(",", ":")),
            scan_version,
        ),
    )


# ---------------------------------------------------------------------------
# 1. Claude Code Scanner & Graph Collector
# ---------------------------------------------------------------------------

def _discover_claude_files(roots: list[Path]) -> list[Path]:
    found: set[Path] = set()
    for root in roots:
        proj = root / "projects"
        if not proj.exists():
            continue
        for dirpath, _, filenames in os.walk(proj):
            base = Path(dirpath)
            for name in filenames:
                if name.endswith(".jsonl"):
                    found.add(base / name)
    return sorted(found)


def _claude_subagent_meta(path: Path) -> tuple[bool, str, str]:
    """Return (is_subagent, parent_session_id, nickname)."""
    if path.parent.name == "subagents":
        parent_id = path.parent.parent.name
        meta_path = path.with_suffix(".meta.json")
        nickname = path.stem
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                nickname = str(meta.get("agentType") or meta.get("name") or nickname)
            except (OSError, ValueError):
                pass
        return True, parent_id, nickname
    return False, "", ""


def scan_claude_file(
    conn: sqlite3.Connection, path: Path, tz: ZoneInfo, scan_version: int
) -> tuple[bool, int, int, int]:
    unchanged, stat = _file_unchanged(conn, path, scan_version)
    if unchanged:
        return False, 0, 0, 0

    path_text = str(path)
    conn.execute("DELETE FROM usage_events WHERE file_path = ?", (path_text,))
    is_subagent, parent_session_id, meta_nick = _claude_subagent_meta(path)
    encoded_dir = path.parent.parent.parent.name if is_subagent else path.parent.name
    fallback_cwd = _decode_encoded_project_dir(encoded_dir)
    fallback_day = datetime.fromtimestamp(stat.st_mtime, tz).date()

    # Deduplicate streaming chunks by message.id (or requestId), keeping the final/largest snapshot.
    by_msg: dict[str, tuple[int, dict[str, Any]]] = {}
    session_cwd = fallback_cwd
    session_id = path.stem
    cli_version = "unknown"
    invalid = 0
    bytes_read = 0
    line_no = 0

    with path.open("rb") as handle:
        for raw in handle:
            line_no += 1
            bytes_read += len(raw)
            if b'"usage"' not in raw and b'"cwd"' not in raw and b'"sessionId"' not in raw:
                continue
            try:
                rec = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                invalid += 1
                continue
            if not isinstance(rec, dict):
                continue
            if rec.get("cwd"):
                session_cwd = str(rec["cwd"])
            if rec.get("sessionId"):
                session_id = str(rec["sessionId"])
            if rec.get("version"):
                cli_version = str(rec["version"])
            msg = rec.get("message")
            if not isinstance(msg, dict):
                continue
            usage = msg.get("usage")
            if not isinstance(usage, dict):
                continue
            raw_in = _safe_int(usage.get("input_tokens"))
            cache_read = _safe_int(usage.get("cache_read_input_tokens"))
            cache_write = _safe_int(usage.get("cache_creation_input_tokens"))
            out = _safe_int(usage.get("output_tokens"))
            total_in = raw_in + cache_read + cache_write
            total = total_in + out
            if total <= 0:
                continue
            msg_id = str(msg.get("id") or rec.get("requestId") or f"line-{line_no}")
            sidechain = is_subagent or bool(rec.get("isSidechain"))
            nick = str(rec.get("agentId") or meta_nick or "")
            model = str(msg.get("model") or rec.get("model") or "unknown")
            content = msg.get("content")
            has_thinking = isinstance(content, list) and any(
                isinstance(c, dict) and c.get("type") == "thinking" for c in content
            )
            entry = {
                "timestamp": rec.get("timestamp") or "",
                "cwd": str(rec.get("cwd") or session_cwd or fallback_cwd),
                "model": model,
                "session_id": f"claude:{session_id}" + (f":{path.stem}" if is_subagent else ""),
                "cli_version": str(rec.get("version") or cli_version),
                "reasoning_effort": "high" if has_thinking else "unknown",
                "agent_type": "subagent" if sidechain else "main",
                "agent_nickname": nick,
                "input_tokens": total_in,
                "cached_input_tokens": cache_read,
                "cache_write_input_tokens": cache_write,
                "output_tokens": out,
                "reasoning_output_tokens": 0,
                "total_tokens": total,
            }
            prev = by_msg.get(msg_id)
            if prev is None or entry["total_tokens"] >= prev[1]["total_tokens"]:
                by_msg[msg_id] = (line_no, entry)

    events = 0
    for ln, entry in sorted(by_msg.values(), key=lambda x: x[0]):
        day, local_hour, weekday, ts_norm = _local_dims(entry["timestamp"], tz, fallback_day)
        _insert_event(
            conn,
            file_path=path_text,
            line_no=ln,
            timestamp=ts_norm or str(entry["timestamp"]),
            day=day,
            local_hour=local_hour,
            weekday=weekday,
            cwd=entry["cwd"],
            model=entry["model"],
            session_id=entry["session_id"],
            originator="claude-code",
            source_surface="cli",
            cli_version=entry["cli_version"],
            reasoning_effort=entry["reasoning_effort"],
            agent_type=entry["agent_type"],
            agent_nickname=entry["agent_nickname"],
            model_provider=infer_model_provider(entry["model"], "anthropic"),
            agent_tool="claude_code",
            input_tokens=entry["input_tokens"],
            cached_input_tokens=entry["cached_input_tokens"],
            cache_write_input_tokens=entry["cache_write_input_tokens"],
            output_tokens=entry["output_tokens"],
            reasoning_output_tokens=entry["reasoning_output_tokens"],
            total_tokens=entry["total_tokens"],
        )
        events += 1

    _save_file_record(
        conn,
        path,
        stat,
        stat.st_size,
        line_no,
        {"tool": "claude_code", "session_id": session_id, "parent_id": parent_session_id},
        scan_version,
    )
    return True, events, invalid, bytes_read


def collect_claude_nodes(
    roots: list[Path], resolver, now: float, include_task_excerpt: bool = False
) -> tuple[list[dict], list[dict]]:
    nodes: list[dict] = []
    edges: list[dict] = []
    files = _discover_claude_files(roots)
    # Limit graph inspection to files active within the last 30 days (up to 150 most recent) for fast polling.
    recent_files = sorted(
        (p for p in files if p.exists()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )[:150]

    for path in recent_files:
        try:
            stat = path.stat()
        except OSError:
            continue
        is_subagent, parent_raw_id, meta_nick = _claude_subagent_meta(path)
        encoded_dir = path.parent.parent.parent.name if is_subagent else path.parent.name
        cwd = _decode_encoded_project_dir(encoded_dir)
        session_id = path.stem
        model = "unknown"
        first_user = ""
        last_user = ""
        last_activity = "尚无活动记录"
        last_ts = stat.st_mtime
        created_ts = stat.st_mtime
        last_role = ""
        last_stop_reason = ""
        last_tool_name = ""
        has_thinking = False
        is_sidechain = is_subagent
        agent_nick = meta_nick

        try:
            with path.open("rb") as handle:
                # Read head + tail for speed on huge sessions
                raw_lines = handle.readlines()
        except OSError:
            continue

        sample_indices = list(range(min(30, len(raw_lines))))
        if len(raw_lines) > 60:
            sample_indices.extend(range(len(raw_lines) - 30, len(raw_lines)))
        elif len(raw_lines) > 30:
            sample_indices.extend(range(30, len(raw_lines)))

        for idx in sample_indices:
            try:
                rec = json.loads(raw_lines[idx])
            except (ValueError, UnicodeDecodeError):
                continue
            if not isinstance(rec, dict):
                continue
            if rec.get("cwd"):
                cwd = str(rec["cwd"])
            if rec.get("sessionId"):
                session_id = str(rec["sessionId"])
            if rec.get("isSidechain"):
                is_sidechain = True
            if rec.get("agentId") and not agent_nick:
                agent_nick = str(rec["agentId"])
            ts = _parse_ts(rec.get("timestamp"))
            if ts:
                ts_sec = ts.timestamp()
                created_ts = min(created_ts, ts_sec)
                last_ts = max(last_ts, ts_sec)
            rtype = rec.get("type")
            msg = rec.get("message") if isinstance(rec.get("message"), dict) else {}
            if msg.get("model"):
                model = str(msg["model"])
            if rtype == "user" or msg.get("role") == "user":
                last_role = "user"
                content = msg.get("content")
                text = ""
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
                    text = " ".join(
                        str(c.get("text") or "")
                        for c in content
                        if isinstance(c, dict) and c.get("type") == "text"
                    )
                text = _brief(text, 140)
                if text and not first_user:
                    first_user = text
                if text:
                    last_user = text
            elif rtype == "assistant" or msg.get("role") == "assistant":
                last_role = "assistant"
                last_stop_reason = str(msg.get("stop_reason") or "")
                content = msg.get("content")
                if isinstance(content, list):
                    for block in content:
                        if not isinstance(block, dict):
                            continue
                        btype = block.get("type")
                        if btype == "thinking":
                            has_thinking = True
                        elif btype == "tool_use":
                            last_tool_name = str(block.get("name") or "")
                            last_activity = _activity_for_tool_name(last_tool_name)
                        elif btype == "text" and not last_tool_name:
                            last_activity = "整理工作结果"

        age = now - last_ts
        if last_stop_reason == "end_turn":
            status = "idle"
            reason = "Claude Code 本轮已回复结束；不代表整个项目完成"
        elif age <= FRESH_SECONDS and (last_role == "user" or last_stop_reason == "tool_use"):
            if last_tool_name.lower() in {"askuserquestion", "ask_question"}:
                status = "waiting_user"
                last_activity = "等待用户回应"
                reason = "最近 5 分钟内 Claude Code 等待用户确认"
            elif last_tool_name.lower() in {"agent", "task"}:
                status = "waiting_agents"
                last_activity = "等待其他代理返回"
                reason = "最近 5 分钟内 Claude Code 正在等待子代理返回"
            else:
                status = "working"
                reason = "最近 5 分钟内 Claude Code 有活跃回合记录"
        elif last_stop_reason == "tool_use" and age > FRESH_SECONDS:
            status = "unknown"
            reason = "未结束记录已超过 5 分钟；无法确认是否仍在运行"
        else:
            status = "idle"
            reason = "最新本地会话记录；本轮结束不等于项目完成"

        node_id = f"claude:{session_id}" + (f":{path.stem}" if is_subagent else "")
        parent_id = f"claude:{parent_raw_id}" if is_subagent and parent_raw_id else None
        project_name, project_path = resolver.resolve(cwd)
        title = _brief(first_user or f"Claude Code · {project_name}", 180)
        excerpt = _brief(last_user or title, 140) if include_task_excerpt else title

        nodes.append(
            {
                "id": node_id,
                "usage_key": hashlib.sha256(node_id.encode("utf-8")).hexdigest()[:24],
                "kind": "subagent" if is_sidechain else "session",
                "agent_tool": "claude_code",
                "agent_tool_label": "Claude Code",
                "title": title,
                "task_summary": excerpt or title,
                "task_source": "current_request_excerpt" if include_task_excerpt and last_user else "session_title",
                "agent_name": _brief(agent_nick or ("Claude Subagent" if is_sidechain else "Claude Code"), 45),
                "agent_role": "subagent" if is_sidechain else "default",
                "model": _brief(model, 60),
                "reasoning_effort": "high" if has_thinking else "unknown",
                "project": project_name,
                "project_id": project_path,
                "cwd": cwd,
                "created_at": created_ts,
                "archived": False,
                "parent_agent_id": parent_id,
                "owner_session_id": parent_id if is_subagent else node_id,
                "created_by": None,
                "status": status,
                "status_label": _status_label(status),
                "status_reason": reason,
                "last_activity_at": last_ts,
                "current_activity": last_activity,
                "turn_status": last_stop_reason or None,
                "status_source": "claude_local_transcript",
            }
        )
        if parent_id:
            edges.append(
                {"source": parent_id, "target": node_id, "kind": "subagent", "provenance": "native_spawn"}
            )
    return nodes, edges


# ---------------------------------------------------------------------------
# 2. Gemini CLI Scanner & Graph Collector
# ---------------------------------------------------------------------------

def _gemini_project_map(gemini_root: Path) -> dict[str, str]:
    """Map Gemini CLI project hashes / directory names to real project paths."""
    mapping: dict[str, str] = {}
    projects_file = gemini_root / "projects.json"
    if projects_file.is_file():
        try:
            data = json.loads(projects_file.read_text(encoding="utf-8"))
            projects = data.get("projects") if isinstance(data, dict) else None
            if isinstance(projects, dict):
                for proj_path, name in projects.items():
                    h = hashlib.sha256(str(proj_path).encode("utf-8")).hexdigest()
                    mapping[h] = str(proj_path)
                    if isinstance(name, str) and name:
                        mapping[name] = str(proj_path)
        except (OSError, ValueError):
            pass
    tmp_dir = gemini_root / "tmp"
    if tmp_dir.is_dir():
        for child in tmp_dir.iterdir():
            if not child.is_dir():
                continue
            root_marker = child / ".project_root"
            if root_marker.is_file():
                try:
                    val = root_marker.read_text(encoding="utf-8").strip()
                    if val:
                        mapping[child.name] = val
                except OSError:
                    pass
    return mapping


def _discover_gemini_files(roots: list[Path]) -> list[tuple[Path, Path]]:
    """Return list of (gemini_root, session_file)."""
    found: list[tuple[Path, Path]] = []
    seen: set[Path] = set()
    for root in roots:
        for sub in (root / "tmp", root / "history"):
            if not sub.exists():
                continue
            for dirpath, _, filenames in os.walk(sub):
                base = Path(dirpath)
                if base.name != "chats" and "chats" not in base.parts:
                    continue
                for name in filenames:
                    if not (name.endswith(".json") or name.endswith(".jsonl")):
                        continue
                    if name == "logs.json":
                        continue
                    p = base / name
                    if p not in seen:
                        seen.add(p)
                        found.append((root, p))
    return sorted(found, key=lambda x: str(x[1]))


def _extract_gemini_messages(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Parse either a single JSON session object or JSONL stream from Gemini CLI."""
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        return {}, []
    if path.suffix == ".jsonl":
        meta: dict[str, Any] = {}
        msgs: list[dict[str, Any]] = []
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if not isinstance(obj, dict):
                continue
            if "messages" in obj and isinstance(obj["messages"], list):
                meta.update(obj)
                msgs.extend(m for m in obj["messages"] if isinstance(m, dict))
            else:
                if "sessionId" in obj and not meta.get("sessionId"):
                    meta["sessionId"] = obj["sessionId"]
                if "projectHash" in obj and not meta.get("projectHash"):
                    meta["projectHash"] = obj["projectHash"]
                if "cwd" in obj and not meta.get("cwd"):
                    meta["cwd"] = obj["cwd"]
                msgs.append(obj)
        return meta, msgs
    data = json.loads(text)
    if isinstance(data, dict):
        raw_msgs = data.get("messages")
        return data, [m for m in raw_msgs if isinstance(m, dict)] if isinstance(raw_msgs, list) else []
    if isinstance(data, list):
        return {}, [m for m in data if isinstance(m, dict)]
    return {}, []


def scan_gemini_file(
    conn: sqlite3.Connection,
    gemini_root: Path,
    path: Path,
    proj_map: dict[str, str],
    tz: ZoneInfo,
    scan_version: int,
) -> tuple[bool, int, int, int]:
    unchanged, stat = _file_unchanged(conn, path, scan_version)
    if unchanged:
        return False, 0, 0, 0

    path_text = str(path)
    conn.execute("DELETE FROM usage_events WHERE file_path = ?", (path_text,))
    fallback_day = datetime.fromtimestamp(stat.st_mtime, tz).date()
    try:
        meta, messages = _extract_gemini_messages(path)
    except (OSError, ValueError):
        return True, 0, 1, stat.st_size

    project_hash = str(meta.get("projectHash") or path.parent.parent.name)
    cwd = str(
        meta.get("cwd")
        or meta.get("projectRoot")
        or proj_map.get(project_hash)
        or project_hash
        or "unknown"
    )
    session_id = f"gemini:{meta.get('sessionId') or path.stem}"
    default_model = str(meta.get("model") or "gemini-2.5-pro")
    events = 0

    for idx, msg in enumerate(messages, 1):
        mtype = str(msg.get("type") or msg.get("role") or "").lower()
        if mtype not in {"gemini", "model", "assistant"}:
            continue
        tokens = msg.get("tokens") or msg.get("usageMetadata") or msg.get("usage")
        if not isinstance(tokens, dict):
            continue
        raw_input = _safe_int(tokens.get("input") or tokens.get("promptTokenCount") or tokens.get("input_tokens"))
        cached = _safe_int(tokens.get("cached") or tokens.get("cachedContentTokenCount") or tokens.get("cached_input_tokens"))
        raw_output = _safe_int(tokens.get("output") or tokens.get("candidatesTokenCount") or tokens.get("output_tokens"))
        thoughts = _safe_int(tokens.get("thoughts") or tokens.get("thoughtsTokenCount") or tokens.get("reasoning_output_tokens"))
        tool_toks = _safe_int(tokens.get("tool") or tokens.get("toolUsePromptTokenCount"))
        # Gemini CLI `input` includes cached prompt tokens unless raw_input < cached.
        input_tokens = max(raw_input, cached) + tool_toks if raw_input >= cached else raw_input + cached + tool_toks
        output_tokens = raw_output + thoughts
        total_tokens = _safe_int(tokens.get("total") or tokens.get("totalTokenCount"))
        if total_tokens < input_tokens + output_tokens:
            total_tokens = input_tokens + output_tokens
        if total_tokens <= 0:
            continue

        model = str(msg.get("model") or default_model)
        ts_val = msg.get("timestamp") or meta.get("lastUpdated") or meta.get("startTime")
        day, local_hour, weekday, ts_norm = _local_dims(ts_val, tz, fallback_day)
        _insert_event(
            conn,
            file_path=path_text,
            line_no=idx,
            timestamp=ts_norm,
            day=day,
            local_hour=local_hour,
            weekday=weekday,
            cwd=cwd,
            model=model,
            session_id=session_id,
            originator="gemini-cli",
            source_surface="cli",
            cli_version=str(meta.get("cliVersion") or "unknown"),
            reasoning_effort=infer_reasoning_effort(model, "high" if thoughts > 0 else "unknown"),
            agent_type="main",
            agent_nickname="",
            model_provider=infer_model_provider(model, "google"),
            agent_tool="gemini_cli",
            input_tokens=input_tokens,
            cached_input_tokens=min(cached, input_tokens),
            cache_write_input_tokens=0,
            output_tokens=output_tokens,
            reasoning_output_tokens=thoughts,
            total_tokens=total_tokens,
        )
        events += 1

    _save_file_record(
        conn, path, stat, stat.st_size, len(messages), {"tool": "gemini_cli", "session_id": session_id}, scan_version
    )
    return True, events, 0, stat.st_size


def collect_gemini_nodes(
    roots: list[Path], resolver, now: float, include_task_excerpt: bool = False
) -> tuple[list[dict], list[dict]]:
    nodes: list[dict] = []
    edges: list[dict] = []
    pairs = _discover_gemini_files(roots)
    proj_maps = {r: _gemini_project_map(r) for r in roots}
    recent = sorted(pairs, key=lambda pair: pair[1].stat().st_mtime, reverse=True)[:120]

    for root, path in recent:
        try:
            stat = path.stat()
            meta, messages = _extract_gemini_messages(path)
        except (OSError, ValueError):
            continue
        if not messages:
            continue
        project_hash = str(meta.get("projectHash") or path.parent.parent.name)
        cwd = str(
            meta.get("cwd")
            or meta.get("projectRoot")
            or proj_maps.get(root, {}).get(project_hash)
            or project_hash
            or "unknown"
        )
        node_id = f"gemini:{meta.get('sessionId') or path.stem}"
        model = str(meta.get("model") or "gemini-2.5-pro")
        first_user = ""
        last_user = ""
        last_activity = "整理工作结果"
        last_type = ""
        for msg in messages:
            mtype = str(msg.get("type") or msg.get("role") or "").lower()
            last_type = mtype
            if msg.get("model"):
                model = str(msg["model"])
            content = msg.get("content")
            if isinstance(content, list):
                content = " ".join(str(c.get("text") or "") if isinstance(c, dict) else str(c) for c in content)
            if mtype == "user":
                txt = _brief(content, 140)
                if txt and not first_user:
                    first_user = txt
                if txt:
                    last_user = txt
            elif mtype in {"gemini", "model", "assistant"}:
                tool_calls = msg.get("toolCalls") or msg.get("tool_calls") or []
                if isinstance(tool_calls, list) and tool_calls:
                    last_tc = tool_calls[-1]
                    tname = last_tc.get("name") if isinstance(last_tc, dict) else ""
                    last_activity = _activity_for_tool_name(str(tname))
                else:
                    last_activity = "整理工作结果"

        created_dt = _parse_ts(meta.get("startTime"))
        updated_dt = _parse_ts(meta.get("lastUpdated")) or _parse_ts(messages[-1].get("timestamp"))
        created_ts = created_dt.timestamp() if created_dt else stat.st_mtime
        last_ts = updated_dt.timestamp() if updated_dt else stat.st_mtime
        age = now - last_ts

        if last_type == "user" and age <= FRESH_SECONDS:
            status = "working"
            reason = "最近 5 分钟内 Gemini CLI 有活跃请求"
        elif age <= FRESH_SECONDS and any(
            isinstance(tc, dict) and tc.get("status") in {"scheduled", "executing", "validating"}
            for tc in (messages[-1].get("toolCalls") or [])
        ):
            status = "working"
            reason = "最近 5 分钟内 Gemini CLI 正在执行工具"
        else:
            status = "idle"
            reason = "Gemini CLI 最新本地会话记录；本轮结束不等于项目完成"

        project_name, project_path = resolver.resolve(cwd)
        title = _brief(meta.get("summary") or first_user or f"Gemini CLI · {project_name}", 180)
        excerpt = _brief(last_user or title, 140) if include_task_excerpt else title
        nodes.append(
            {
                "id": node_id,
                "usage_key": hashlib.sha256(node_id.encode("utf-8")).hexdigest()[:24],
                "kind": "session",
                "agent_tool": "gemini_cli",
                "agent_tool_label": "Gemini CLI",
                "title": title,
                "task_summary": excerpt or title,
                "task_source": "current_request_excerpt" if include_task_excerpt and last_user else "session_title",
                "agent_name": "Gemini CLI",
                "agent_role": "default",
                "model": _brief(model, 60),
                "reasoning_effort": infer_reasoning_effort(model),
                "project": project_name,
                "project_id": project_path,
                "cwd": cwd,
                "created_at": created_ts,
                "archived": False,
                "parent_agent_id": None,
                "owner_session_id": node_id,
                "created_by": None,
                "status": status,
                "status_label": _status_label(status),
                "status_reason": reason,
                "last_activity_at": last_ts,
                "current_activity": last_activity,
                "turn_status": None,
                "status_source": "gemini_cli_session",
            }
        )
    return nodes, edges


# ---------------------------------------------------------------------------
# 3. Antigravity (IDE & CLI) Scanner & Graph Collector
# ---------------------------------------------------------------------------

def _load_antigravity_summaries(root: Path) -> dict[str, dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}
    db = root / "conversation_summaries.db"
    if not db.is_file():
        return summaries
    try:
        with _read_sqlite(db) as conn:
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(conversation_summaries)")}
            wanted = [
                "conversation_id",
                "title",
                "step_count",
                "last_modified_time",
                "workspace_uris",
                "status",
                "source",
                "project_id",
                "agent_name",
                "parent_conversation_id",
                "nesting_depth",
                "not_fully_idle",
                "killed",
                "last_user_input_time",
            ]
            selected = [c for c in wanted if c in cols]
            if "conversation_id" not in selected:
                return summaries
            for row in conn.execute("SELECT " + ",".join(selected) + " FROM conversation_summaries"):
                item = dict(row)
                cid = str(item["conversation_id"])
                cwd = "unknown"
                raw_uris = item.get("workspace_uris") or ""
                try:
                    parsed_uris = json.loads(raw_uris) if isinstance(raw_uris, str) and raw_uris.startswith("[") else []
                    if parsed_uris and isinstance(parsed_uris[0], str):
                        cwd = _file_uri_to_path(parsed_uris[0]) or "unknown"
                except ValueError:
                    pass
                item["cwd"] = cwd
                summaries[cid] = item
            # Also check conversation_parents table if present
            has_parents = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE name='conversation_parents'"
            ).fetchone()
            if has_parents:
                for prow in conn.execute("SELECT conversation_id, parent_id FROM conversation_parents"):
                    cid = str(prow["conversation_id"])
                    if cid in summaries and not summaries[cid].get("parent_conversation_id"):
                        summaries[cid]["parent_conversation_id"] = str(prow["parent_id"])
    except (OSError, sqlite3.Error):
        pass
    return summaries


def _discover_antigravity_transcripts(roots: list[Path]) -> list[tuple[Path, str, Path]]:
    found: list[tuple[Path, str, Path]] = []
    seen: set[Path] = set()
    for root in roots:
        brain = root / "brain"
        if not brain.is_dir():
            continue
        for conv_dir in sorted(brain.iterdir()):
            if not conv_dir.is_dir():
                continue
            tf = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
            if tf.is_file() and tf not in seen:
                seen.add(tf)
                found.append((root, conv_dir.name, tf))
    return found


def scan_antigravity_file(
    conn: sqlite3.Connection,
    root: Path,
    conv_id: str,
    path: Path,
    summary: dict[str, Any],
    tz: ZoneInfo,
    scan_version: int,
) -> tuple[bool, int, int, int]:
    stat = path.stat()
    path_text = str(path)
    stored = conn.execute("SELECT * FROM files WHERE path = ?", (path_text,)).fetchone()
    unchanged = (
        stored is not None
        and stored["scan_version"] == scan_version
        and stored["inode"] == stat.st_ino
        and stored["size"] == stat.st_size
        and stored["mtime_ns"] == stat.st_mtime_ns
    )
    if unchanged:
        return False, 0, 0, 0

    append_only = (
        stored is not None
        and stored["scan_version"] == scan_version
        and stored["inode"] == stat.st_ino
        and stat.st_size >= stored["offset"]
    )
    if append_only:
        offset = int(stored["offset"])
        line_no = int(stored["line_no"])
        state = json.loads(stored["state_json"])
    else:
        conn.execute("DELETE FROM usage_events WHERE file_path = ?", (path_text,))
        offset = 0
        line_no = 0
        state = {"tool": "antigravity", "model": "unknown"}

    cwd = str(summary.get("cwd") or "unknown")
    parent_cid = str(summary.get("parent_conversation_id") or "")
    nesting_depth = _safe_int(summary.get("nesting_depth"))
    agent_type = "subagent" if (parent_cid or nesting_depth > 0) else "main"
    agent_nick = str(summary.get("agent_name") or "")
    is_cli = "cli" in root.name.lower() or "CLI" in str(summary.get("source") or "")
    source_surface = "cli" if is_cli else "ide"
    originator = "antigravity-cli" if is_cli else "antigravity"
    session_id = f"agy:{conv_id}"
    fallback_day = datetime.fromtimestamp(stat.st_mtime, tz).date()

    events = 0
    invalid = 0
    bytes_read = 0

    with path.open("rb") as handle:
        handle.seek(offset)
        while True:
            line_start = handle.tell()
            raw = handle.readline()
            if not raw:
                break
            if not raw.endswith(b"\n"):
                handle.seek(line_start)
                break
            line_no += 1
            bytes_read += len(raw)
            if b'"PLANNER_RESPONSE"' not in raw and b'"input_tokens"' not in raw:
                continue
            try:
                rec = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                invalid += 1
                continue
            if not isinstance(rec, dict):
                continue
            if rec.get("type") != "PLANNER_RESPONSE":
                continue
            raw_in = _safe_int(rec.get("input_tokens"))
            cache_read = _safe_int(rec.get("cache_read_tokens"))
            cache_write = _safe_int(rec.get("cache_write_tokens"))
            out = _safe_int(rec.get("output_tokens"))
            # Antigravity `input_tokens` is uncached input; `cache_read_tokens` is additive.
            total_in = raw_in + cache_read + cache_write
            total = total_in + out
            if total <= 0:
                continue
            model = str(rec.get("model") or state.get("model") or "unknown")
            state["model"] = model
            has_thinking = bool(rec.get("thinking"))
            effort = infer_reasoning_effort(model, "high" if has_thinking else "unknown")
            day, local_hour, weekday, ts_norm = _local_dims(rec.get("created_at"), tz, fallback_day)
            _insert_event(
                conn,
                file_path=path_text,
                line_no=line_no,
                timestamp=ts_norm or str(rec.get("created_at") or ""),
                day=day,
                local_hour=local_hour,
                weekday=weekday,
                cwd=cwd,
                model=model,
                session_id=session_id,
                originator=originator,
                source_surface=source_surface,
                cli_version="antigravity",
                reasoning_effort=effort,
                agent_type=agent_type,
                agent_nickname=agent_nick,
                model_provider=infer_model_provider(model, "google"),
                agent_tool="antigravity",
                input_tokens=total_in,
                cached_input_tokens=cache_read,
                cache_write_input_tokens=cache_write,
                output_tokens=out,
                reasoning_output_tokens=0,
                total_tokens=total,
            )
            events += 1
        final_offset = handle.tell()

    _save_file_record(conn, path, stat, final_offset, line_no, state, scan_version)
    return True, events, invalid, bytes_read


def collect_antigravity_nodes(
    roots: list[Path], resolver, now: float, include_task_excerpt: bool = False
) -> tuple[list[dict], list[dict]]:
    nodes: list[dict] = []
    edges: list[dict] = []
    seen_cids: set[str] = set()

    for root in roots:
        if not root.exists():
            continue
        summaries = _load_antigravity_summaries(root)
        brain = root / "brain"
        all_cids = set(summaries.keys())
        if brain.is_dir():
            for d in brain.iterdir():
                if d.is_dir() and (d / ".system_generated" / "logs" / "transcript.jsonl").is_file():
                    all_cids.add(d.name)

        for cid in sorted(all_cids):
            if cid in seen_cids:
                continue
            seen_cids.add(cid)
            summary = summaries.get(cid, {})
            tf = brain / cid / ".system_generated" / "logs" / "transcript.jsonl"
            model = "unknown"
            last_activity = "推进当前工作"
            last_user = ""
            first_user = ""
            created_ts = 0.0
            last_ts = 0.0
            last_step_status = ""
            last_tool_name = ""
            subagent_children: list[str] = []

            if tf.is_file():
                try:
                    tstat = tf.stat()
                    last_ts = tstat.st_mtime
                    with tf.open("rb") as handle:
                        lines = handle.readlines()
                    indices = list(range(min(15, len(lines))))
                    if len(lines) > 40:
                        indices.extend(range(len(lines) - 25, len(lines)))
                    elif len(lines) > 15:
                        indices.extend(range(15, len(lines)))
                    for i in indices:
                        try:
                            rec = json.loads(lines[i])
                        except (ValueError, UnicodeDecodeError):
                            continue
                        if not isinstance(rec, dict):
                            continue
                        dt = _parse_ts(rec.get("created_at"))
                        if dt:
                            sec = dt.timestamp()
                            created_ts = sec if not created_ts else min(created_ts, sec)
                            last_ts = max(last_ts, sec)
                        if rec.get("model"):
                            model = str(rec["model"])
                        rtype = rec.get("type")
                        if rtype == "USER_INPUT":
                            txt = _brief(rec.get("content") or "", 140)
                            if txt and not first_user:
                                first_user = txt
                            if txt:
                                last_user = txt
                        elif rtype == "PLANNER_RESPONSE":
                            last_step_status = str(rec.get("status") or "")
                            tcs = rec.get("tool_calls") or []
                            if isinstance(tcs, list) and tcs:
                                last_tc = tcs[-1]
                                if isinstance(last_tc, dict):
                                    last_tool_name = str(last_tc.get("name") or "")
                                    last_activity = _activity_for_tool_name(last_tool_name)
                            else:
                                last_activity = "整理工作结果"
                except OSError:
                    pass

            mod_dt = _parse_ts(summary.get("last_modified_time"))
            if mod_dt:
                last_ts = max(last_ts, mod_dt.timestamp())
                if not created_ts:
                    created_ts = mod_dt.timestamp()
            if not last_ts:
                continue

            raw_status = str(summary.get("status") or "").upper()
            not_idle = bool(summary.get("not_fully_idle"))
            killed = bool(summary.get("killed"))
            age = now - last_ts

            if killed:
                status = "interrupted"
                reason = "Antigravity 会话已终止"
            elif "WAITING" in raw_status or (age <= FRESH_SECONDS and last_tool_name == "ask_question"):
                status = "waiting_user"
                last_activity = "等待用户回应"
                reason = "Antigravity 正在等待用户确认"
            elif ("RUNNING" in raw_status or not_idle or last_step_status == "RUNNING") and age <= FRESH_SECONDS:
                status = "working"
                reason = "最近 5 分钟内 Antigravity 有活跃执行记录"
            elif ("RUNNING" in raw_status or not_idle) and age > FRESH_SECONDS:
                status = "unknown"
                reason = "未结束记录已超过 5 分钟；无法确认是否仍在运行"
            elif age <= 45 and tf.is_file():
                # Active transcript write within last 45s (e.g., current live session)
                status = "working"
                reason = "最近 45 秒内 Antigravity 日志持续写入中"
            else:
                status = "idle"
                reason = "Antigravity 最新本地会话记录；本轮结束不等于项目完成"

            cwd = str(summary.get("cwd") or "unknown")
            project_name, project_path = resolver.resolve(cwd)
            parent_cid = str(summary.get("parent_conversation_id") or "")
            nesting = _safe_int(summary.get("nesting_depth"))
            is_sub = bool(parent_cid or nesting > 0)
            node_id = f"agy:{cid}"
            parent_id = f"agy:{parent_cid}" if parent_cid else None
            title = _brief(summary.get("title") or first_user or f"Antigravity · {project_name}", 180)
            excerpt = _brief(last_user or title, 140) if include_task_excerpt else title
            agent_name = _brief(
                summary.get("agent_name") or ("Antigravity Subagent" if is_sub else "Antigravity"), 45
            )

            nodes.append(
                {
                    "id": node_id,
                    "usage_key": hashlib.sha256(node_id.encode("utf-8")).hexdigest()[:24],
                    "kind": "subagent" if is_sub else "session",
                    "agent_tool": "antigravity",
                    "agent_tool_label": "Antigravity",
                    "title": title,
                    "task_summary": excerpt or title,
                    "task_source": "current_request_excerpt" if include_task_excerpt and last_user else "session_title",
                    "agent_name": agent_name,
                    "agent_role": "subagent" if is_sub else "default",
                    "model": _brief(model, 60),
                    "reasoning_effort": infer_reasoning_effort(model),
                    "project": project_name,
                    "project_id": project_path,
                    "cwd": cwd,
                    "created_at": created_ts or last_ts,
                    "archived": False,
                    "parent_agent_id": parent_id,
                    "owner_session_id": parent_id if is_sub else node_id,
                    "created_by": None,
                    "status": status,
                    "status_label": _status_label(status),
                    "status_reason": reason,
                    "last_activity_at": last_ts,
                    "current_activity": last_activity,
                    "turn_status": raw_status or None,
                    "status_source": "antigravity_local_records",
                }
            )
            if parent_id:
                edges.append(
                    {"source": parent_id, "target": node_id, "kind": "subagent", "provenance": "native_spawn"}
                )
            for child in subagent_children:
                edges.append(
                    {"source": node_id, "target": f"agy:{child}", "kind": "subagent", "provenance": "native_spawn"}
                )
    return nodes, edges


# ---------------------------------------------------------------------------
# 4. OpenCode Scanner & Graph Collector
# ---------------------------------------------------------------------------

def scan_opencode_sources(
    conn: sqlite3.Connection, roots: list[Path], tz: ZoneInfo, scan_version: int
) -> tuple[int, int, int, int]:
    """Scan OpenCode SQLite DB (`opencode.db`) or legacy JSON storage."""
    scanned = events = invalid = bytes_read = 0
    for root in roots:
        db = root / "opencode.db"
        if db.is_file():
            unchanged, stat = _file_unchanged(conn, db, scan_version)
            if not unchanged:
                path_text = str(db)
                conn.execute("DELETE FROM usage_events WHERE file_path = ?", (path_text,))
                fallback_day = datetime.fromtimestamp(stat.st_mtime, tz).date()
                row_events = 0
                try:
                    with _read_sqlite(db) as oconn:
                        tables = {r[0] for r in oconn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                        sessions: dict[str, dict[str, Any]] = {}
                        if "session" in tables:
                            for s in oconn.execute("SELECT * FROM session"):
                                d = dict(s)
                                sessions[str(d.get("id") or "")] = d
                        if "message" in tables:
                            for idx, m in enumerate(oconn.execute("SELECT * FROM message"), 1):
                                d = dict(m)
                                data = {}
                                if isinstance(d.get("data"), str):
                                    try:
                                        data = json.loads(d["data"])
                                    except ValueError:
                                        data = {}
                                role = str(d.get("role") or data.get("role") or "")
                                if role != "assistant":
                                    continue
                                tokens = data.get("tokens") if isinstance(data.get("tokens"), dict) else {}
                                cache = tokens.get("cache") if isinstance(tokens.get("cache"), dict) else {}
                                raw_in = _safe_int(tokens.get("input") or d.get("input_tokens"))
                                cache_read = _safe_int(cache.get("read") or tokens.get("cache_read"))
                                cache_write = _safe_int(cache.get("write") or tokens.get("cache_write"))
                                out = _safe_int(tokens.get("output") or d.get("output_tokens"))
                                reasoning = _safe_int(tokens.get("reasoning"))
                                total_in = raw_in + cache_read + cache_write
                                total_out = out + reasoning
                                total = total_in + total_out
                                if total <= 0:
                                    continue
                                sid = str(d.get("session_id") or data.get("sessionID") or "")
                                sinfo = sessions.get(sid, {})
                                cwd = str(sinfo.get("directory") or sinfo.get("cwd") or data.get("path", {}).get("cwd") or "unknown")
                                model = str(data.get("modelID") or data.get("model") or d.get("model") or "unknown")
                                provider = str(data.get("providerID") or infer_model_provider(model, "opencode"))
                                ts_val = d.get("time_created") or (data.get("time") or {}).get("created")
                                day, local_hour, weekday, ts_norm = _local_dims(ts_val, tz, fallback_day)
                                is_sub = bool(sinfo.get("parent_id") or sinfo.get("parentID"))
                                _insert_event(
                                    conn,
                                    file_path=path_text,
                                    line_no=idx,
                                    timestamp=ts_norm,
                                    day=day,
                                    local_hour=local_hour,
                                    weekday=weekday,
                                    cwd=cwd,
                                    model=model,
                                    session_id=f"opencode:{sid}",
                                    originator="opencode",
                                    source_surface="cli",
                                    cli_version="opencode",
                                    reasoning_effort="high" if reasoning > 0 else infer_reasoning_effort(model),
                                    agent_type="subagent" if is_sub else "main",
                                    agent_nickname=str(data.get("agent") or ""),
                                    model_provider=provider,
                                    agent_tool="opencode",
                                    input_tokens=total_in,
                                    cached_input_tokens=cache_read,
                                    cache_write_input_tokens=cache_write,
                                    output_tokens=total_out,
                                    reasoning_output_tokens=reasoning,
                                    total_tokens=total,
                                )
                                row_events += 1
                except (OSError, sqlite3.Error):
                    invalid += 1
                _save_file_record(conn, db, stat, stat.st_size, row_events, {"tool": "opencode"}, scan_version)
                scanned += 1
                events += row_events
                bytes_read += stat.st_size
    return scanned, events, invalid, bytes_read


def collect_opencode_nodes(
    roots: list[Path], resolver, now: float, include_task_excerpt: bool = False
) -> tuple[list[dict], list[dict]]:
    nodes: list[dict] = []
    edges: list[dict] = []
    for root in roots:
        db = root / "opencode.db"
        if not db.is_file():
            continue
        try:
            with _read_sqlite(db) as oconn:
                tables = {r[0] for r in oconn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                if "session" not in tables:
                    continue
                for s in oconn.execute("SELECT * FROM session ORDER BY time_updated DESC LIMIT 80"):
                    d = dict(s)
                    sid = str(d.get("id") or "")
                    if not sid:
                        continue
                    cwd = str(d.get("directory") or d.get("cwd") or "unknown")
                    project_name, project_path = resolver.resolve(cwd)
                    parent_raw = str(d.get("parent_id") or d.get("parentID") or "")
                    is_sub = bool(parent_raw)
                    node_id = f"opencode:{sid}"
                    parent_id = f"opencode:{parent_raw}" if is_sub else None
                    updated_dt = _parse_ts(d.get("time_updated") or d.get("time_created"))
                    created_dt = _parse_ts(d.get("time_created"))
                    last_ts = updated_dt.timestamp() if updated_dt else now
                    created_ts = created_dt.timestamp() if created_dt else last_ts
                    status = "working" if now - last_ts <= 90 else "idle"
                    title = _brief(d.get("title") or f"OpenCode · {project_name}", 180)
                    nodes.append(
                        {
                            "id": node_id,
                            "usage_key": hashlib.sha256(node_id.encode("utf-8")).hexdigest()[:24],
                            "kind": "subagent" if is_sub else "session",
                            "agent_tool": "opencode",
                            "agent_tool_label": "OpenCode",
                            "title": title,
                            "task_summary": title,
                            "task_source": "session_title",
                            "agent_name": "OpenCode Subagent" if is_sub else "OpenCode",
                            "agent_role": "subagent" if is_sub else "default",
                            "model": "unknown",
                            "reasoning_effort": "unknown",
                            "project": project_name,
                            "project_id": project_path,
                            "cwd": cwd,
                            "created_at": created_ts,
                            "archived": False,
                            "parent_agent_id": parent_id,
                            "owner_session_id": parent_id if is_sub else node_id,
                            "created_by": None,
                            "status": status,
                            "status_label": _status_label(status),
                            "status_reason": "OpenCode 本地数据库观察记录",
                            "last_activity_at": last_ts,
                            "current_activity": "推进当前工作" if status == "working" else "整理工作结果",
                            "turn_status": None,
                            "status_source": "opencode_local_db",
                        }
                    )
                    if parent_id:
                        edges.append(
                            {"source": parent_id, "target": node_id, "kind": "subagent", "provenance": "native_spawn"}
                        )
        except (OSError, sqlite3.Error):
            pass
    return nodes, edges


# ---------------------------------------------------------------------------
# 5. Cursor Scanner & Graph Collector
# ---------------------------------------------------------------------------

def _discover_cursor_transcripts(roots: list[Path]) -> list[Path]:
    found: set[Path] = set()
    for root in roots:
        proj = root / "projects"
        if not proj.is_dir():
            continue
        for p in proj.glob("*/agent-transcripts/*/*.jsonl"):
            if p.is_file():
                found.add(p)
    return sorted(found)


def scan_cursor_file(
    conn: sqlite3.Connection, path: Path, tz: ZoneInfo, scan_version: int
) -> tuple[bool, int, int, int]:
    """Scan Cursor agent-transcript JSONL for any explicit token usage records."""
    unchanged, stat = _file_unchanged(conn, path, scan_version)
    if unchanged:
        return False, 0, 0, 0

    path_text = str(path)
    conn.execute("DELETE FROM usage_events WHERE file_path = ?", (path_text,))
    fallback_day = datetime.fromtimestamp(stat.st_mtime, tz).date()
    encoded_proj = path.parents[2].name
    cwd = _decode_encoded_project_dir(encoded_proj)
    session_id = f"cursor:{path.stem}"
    events = 0
    invalid = 0
    bytes_read = 0
    line_no = 0

    with path.open("rb") as handle:
        for raw in handle:
            line_no += 1
            bytes_read += len(raw)
            if b"token" not in raw.lower() and b"usage" not in raw.lower():
                continue
            try:
                rec = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                invalid += 1
                continue
            if not isinstance(rec, dict):
                continue
            usage = rec.get("usage") or (rec.get("message") or {}).get("usage")
            if not isinstance(usage, dict):
                continue
            raw_in = _safe_int(usage.get("input_tokens") or usage.get("prompt_tokens"))
            cached = _safe_int(usage.get("cached_input_tokens") or usage.get("cache_read_input_tokens"))
            cache_write = _safe_int(usage.get("cache_creation_input_tokens"))
            out = _safe_int(usage.get("output_tokens") or usage.get("completion_tokens"))
            total_in = max(raw_in, cached) if raw_in >= cached else raw_in + cached + cache_write
            total = _safe_int(usage.get("total_tokens")) or (total_in + out)
            if total <= 0:
                continue
            model = str(rec.get("model") or (rec.get("message") or {}).get("model") or "unknown")
            day, local_hour, weekday, ts_norm = _local_dims(rec.get("timestamp"), tz, fallback_day)
            _insert_event(
                conn,
                file_path=path_text,
                line_no=line_no,
                timestamp=ts_norm,
                day=day,
                local_hour=local_hour,
                weekday=weekday,
                cwd=cwd,
                model=model,
                session_id=session_id,
                originator="cursor",
                source_surface="ide",
                cli_version="cursor",
                reasoning_effort=infer_reasoning_effort(model),
                agent_type="main",
                agent_nickname="",
                model_provider=infer_model_provider(model, "cursor"),
                agent_tool="cursor",
                input_tokens=total_in,
                cached_input_tokens=min(cached, total_in),
                cache_write_input_tokens=cache_write,
                output_tokens=out,
                reasoning_output_tokens=0,
                total_tokens=total,
            )
            events += 1

    _save_file_record(conn, path, stat, stat.st_size, line_no, {"tool": "cursor", "session_id": session_id}, scan_version)
    return True, events, invalid, bytes_read


def collect_cursor_nodes(
    roots: list[Path], resolver, now: float, include_task_excerpt: bool = False
) -> tuple[list[dict], list[dict]]:
    nodes: list[dict] = []
    edges: list[dict] = []
    # Optional model lookup from ~/.cursor/ai-tracking/ai-code-tracking.db
    conv_models: dict[str, str] = {}
    for root in roots:
        cdb = root / "ai-tracking" / "ai-code-tracking.db"
        if cdb.is_file():
            try:
                with _read_sqlite(cdb) as cconn:
                    for r in cconn.execute(
                        "SELECT conversationId, model FROM ai_code_hashes WHERE conversationId IS NOT NULL AND model IS NOT NULL GROUP BY conversationId"
                    ):
                        conv_models[str(r["conversationId"])] = str(r["model"])
            except (OSError, sqlite3.Error):
                pass

    files = _discover_cursor_transcripts(roots)
    recent = sorted(files, key=lambda p: p.stat().st_mtime, reverse=True)[:40]
    for path in recent:
        try:
            stat = path.stat()
        except OSError:
            continue
        encoded_proj = path.parents[2].name
        cwd = _decode_encoded_project_dir(encoded_proj)
        if cwd == "unknown" or cwd.startswith("/var/folders/"):
            continue
        project_name, project_path = resolver.resolve(cwd)
        cid = path.stem
        node_id = f"cursor:{cid}"
        first_user = ""
        last_role = ""
        try:
            with path.open("rb") as handle:
                lines = handle.readlines()
            for raw in lines[:20]:
                try:
                    rec = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    continue
                if not isinstance(rec, dict):
                    continue
                role = rec.get("role") or (rec.get("message") or {}).get("role") or ""
                if role:
                    last_role = str(role)
                if role == "user" and not first_user:
                    msg = rec.get("message") or rec
                    content = msg.get("content")
                    if isinstance(content, list):
                        txt = " ".join(str(c.get("text") or "") for c in content if isinstance(c, dict))
                    else:
                        txt = str(content or "")
                    txt = re.sub(r"<user_query>(.*?)</user_query>", r"\1", txt, flags=re.S)
                    first_user = _brief(txt, 140)
            if lines:
                try:
                    tail = json.loads(lines[-1])
                    if isinstance(tail, dict):
                        last_role = str(tail.get("role") or tail.get("type") or last_role)
                except (ValueError, UnicodeDecodeError):
                    pass
        except OSError:
            continue

        last_ts = stat.st_mtime
        age = now - last_ts
        status = "working" if age <= FRESH_SECONDS and last_role == "user" else "idle"
        model = conv_models.get(cid, "cursor-agent")
        title = _brief(first_user or f"Cursor · {project_name}", 180)
        nodes.append(
            {
                "id": node_id,
                "usage_key": hashlib.sha256(node_id.encode("utf-8")).hexdigest()[:24],
                "kind": "session",
                "agent_tool": "cursor",
                "agent_tool_label": "Cursor",
                "title": title,
                "task_summary": title if include_task_excerpt else _brief(f"Cursor · {project_name}", 140),
                "task_source": "current_request_excerpt" if include_task_excerpt and first_user else "session_title",
                "agent_name": "Cursor Agent",
                "agent_role": "default",
                "model": _brief(model, 60),
                "reasoning_effort": infer_reasoning_effort(model),
                "project": project_name,
                "project_id": project_path,
                "cwd": cwd,
                "created_at": getattr(stat, "st_birthtime", last_ts),
                "archived": False,
                "parent_agent_id": None,
                "owner_session_id": node_id,
                "created_by": None,
                "status": status,
                "status_label": _status_label(status),
                "status_reason": "Cursor 本地会话转录记录观察",
                "last_activity_at": last_ts,
                "current_activity": "推进当前工作" if status == "working" else "整理工作结果",
                "turn_status": None,
                "status_source": "cursor_local_transcript",
            }
        )
    return nodes, edges


def _status_label(status: str) -> str:
    return {
        "working": "执行中 · 记录观察",
        "waiting_agents": "等待代理",
        "waiting_user": "等待确认",
        "idle": "本轮已结束",
        "failed": "本轮失败",
        "interrupted": "已中断",
        "archived": "已归档",
        "unknown": "状态待确认",
    }.get(status, "状态待确认")


# ---------------------------------------------------------------------------
# Unified Orchestration Entrypoints
# ---------------------------------------------------------------------------

def scan_additional_tools(
    conn: sqlite3.Connection,
    sources: dict[str, list[Path]],
    tz: ZoneInfo,
    scan_version: int,
    quiet: bool = False,
) -> tuple[int, int, int, int, int, int, set[str]]:
    """Scan all non-Codex agent tools; return (discovered, scanned, unchanged, events, invalid, bytes_read, paths)."""
    discovered = scanned = unchanged = events = invalid = bytes_read = 0
    discovered_paths: set[str] = set()

    # Claude Code
    claude_files = _discover_claude_files(sources.get("claude_code", []))
    discovered += len(claude_files)
    for path in claude_files:
        discovered_paths.add(str(path))
        try:
            changed, ev, inv, br = scan_claude_file(conn, path, tz, scan_version)
        except OSError:
            continue
        if changed:
            scanned += 1
            events += ev
            invalid += inv
            bytes_read += br
        else:
            unchanged += 1

    # Gemini CLI
    gemini_roots = sources.get("gemini_cli", [])
    gemini_files = _discover_gemini_files(gemini_roots)
    gemini_maps = {r: _gemini_project_map(r) for r in gemini_roots}
    discovered += len(gemini_files)
    for root, path in gemini_files:
        discovered_paths.add(str(path))
        try:
            changed, ev, inv, br = scan_gemini_file(conn, root, path, gemini_maps[root], tz, scan_version)
        except OSError:
            continue
        if changed:
            scanned += 1
            events += ev
            invalid += inv
            bytes_read += br
        else:
            unchanged += 1

    # Antigravity (IDE + CLI)
    agy_roots = sources.get("antigravity", [])
    agy_summaries = {r: _load_antigravity_summaries(r) for r in agy_roots}
    agy_files = _discover_antigravity_transcripts(agy_roots)
    discovered += len(agy_files)
    for root, conv_id, path in agy_files:
        discovered_paths.add(str(path))
        try:
            changed, ev, inv, br = scan_antigravity_file(
                conn, root, conv_id, path, agy_summaries[root].get(conv_id, {}), tz, scan_version
            )
        except OSError:
            continue
        if changed:
            scanned += 1
            events += ev
            invalid += inv
            bytes_read += br
        else:
            unchanged += 1

    # OpenCode
    oc_roots = sources.get("opencode", [])
    for r in oc_roots:
        if (r / "opencode.db").is_file():
            discovered += 1
            discovered_paths.add(str(r / "opencode.db"))
    oc_sc, oc_ev, oc_inv, oc_br = scan_opencode_sources(conn, oc_roots, tz, scan_version)
    scanned += oc_sc
    events += oc_ev
    invalid += oc_inv
    bytes_read += oc_br

    # Cursor
    cursor_files = _discover_cursor_transcripts(sources.get("cursor", []))
    discovered += len(cursor_files)
    for path in cursor_files:
        discovered_paths.add(str(path))
        try:
            changed, ev, inv, br = scan_cursor_file(conn, path, tz, scan_version)
        except OSError:
            continue
        if changed:
            scanned += 1
            events += ev
            invalid += inv
            bytes_read += br
        else:
            unchanged += 1

    return discovered, scanned, unchanged, events, invalid, bytes_read, discovered_paths


def collect_additional_graph_nodes(
    sources: dict[str, list[Path]],
    resolver,
    now: float,
    include_task_excerpt: bool = False,
) -> tuple[list[dict], list[dict]]:
    """Collect read-only Agent Office nodes/edges from Claude Code, Gemini CLI, Antigravity, Cursor, OpenCode."""
    nodes: list[dict] = []
    edges: list[dict] = []

    for collector, key in (
        (collect_claude_nodes, "claude_code"),
        (collect_gemini_nodes, "gemini_cli"),
        (collect_antigravity_nodes, "antigravity"),
        (collect_opencode_nodes, "opencode"),
        (collect_cursor_nodes, "cursor"),
    ):
        roots = sources.get(key) or []
        if not roots:
            continue
        try:
            n, e = collector(roots, resolver, now, include_task_excerpt=include_task_excerpt)
            nodes.extend(n)
            edges.extend(e)
        except Exception:
            continue
    return nodes, edges
