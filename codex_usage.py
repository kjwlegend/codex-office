#!/usr/bin/env python3
"""Local Codex usage indexer and cost-estimation dashboard.

Only session metadata and token-usage counters are persisted. Prompt and
response bodies are never written to the index or exported reports.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
import re
import sqlite3
import sys
import webbrowser
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo


APP_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG = APP_DIR / "config.json"
DEFAULT_PRICING = APP_DIR / "pricing.json"
DEFAULT_DB = APP_DIR / ".codex-usage" / "usage.sqlite3"
SCAN_VERSION = 5
FORK_BOOTSTRAP_GAP_SECONDS = 3.0
TOKEN_FIELDS = (
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "output_tokens",
    "reasoning_output_tokens",
    "total_tokens",
)
INTERESTING_MARKERS = (b'"session_meta"', b'"turn_context"', b'"token_count"')
ROLLOUT_DATE_RE = re.compile(r"rollout-(\d{4}-\d{2}-\d{2})T")
DATED_MODEL_RE = re.compile(r"^(.*)-\d{4}-\d{2}-\d{2}$")


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return value


def ensure_parent(path: Path) -> None:
    path.expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


def connect_db(path: Path) -> sqlite3.Connection:
    path = path.expanduser()
    ensure_parent(path)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS files (
            path TEXT PRIMARY KEY,
            inode INTEGER NOT NULL,
            size INTEGER NOT NULL,
            mtime_ns INTEGER NOT NULL,
            offset INTEGER NOT NULL,
            line_no INTEGER NOT NULL,
            state_json TEXT NOT NULL,
            scan_version INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usage_events (
            file_path TEXT NOT NULL,
            line_no INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            day TEXT NOT NULL,
            local_hour INTEGER NOT NULL DEFAULT 0,
            weekday INTEGER NOT NULL DEFAULT 0,
            cwd TEXT NOT NULL,
            model TEXT NOT NULL,
            session_id TEXT NOT NULL DEFAULT '',
            originator TEXT NOT NULL DEFAULT 'unknown',
            source_surface TEXT NOT NULL DEFAULT 'unknown',
            cli_version TEXT NOT NULL DEFAULT 'unknown',
            reasoning_effort TEXT NOT NULL DEFAULT 'unknown',
            agent_type TEXT NOT NULL DEFAULT 'main',
            agent_nickname TEXT NOT NULL DEFAULT '',
            model_provider TEXT NOT NULL DEFAULT 'unknown',
            input_tokens INTEGER NOT NULL,
            cached_input_tokens INTEGER NOT NULL,
            cache_write_input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            reasoning_output_tokens INTEGER NOT NULL,
            total_tokens INTEGER NOT NULL,
            context_window INTEGER,
            PRIMARY KEY (file_path, line_no)
        );

        CREATE INDEX IF NOT EXISTS usage_events_day_idx
            ON usage_events(day);
        CREATE INDEX IF NOT EXISTS usage_events_model_idx
            ON usage_events(model);
        """
    )
    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(usage_events)")}
    migrations = {
        "local_hour": "INTEGER NOT NULL DEFAULT 0",
        "weekday": "INTEGER NOT NULL DEFAULT 0",
        "session_id": "TEXT NOT NULL DEFAULT ''",
        "originator": "TEXT NOT NULL DEFAULT 'unknown'",
        "source_surface": "TEXT NOT NULL DEFAULT 'unknown'",
        "cli_version": "TEXT NOT NULL DEFAULT 'unknown'",
        "reasoning_effort": "TEXT NOT NULL DEFAULT 'unknown'",
        "agent_type": "TEXT NOT NULL DEFAULT 'main'",
        "agent_nickname": "TEXT NOT NULL DEFAULT ''",
        "model_provider": "TEXT NOT NULL DEFAULT 'unknown'",
    }
    for column, definition in migrations.items():
        if column not in existing_columns:
            conn.execute(f"ALTER TABLE usage_events ADD COLUMN {column} {definition}")
    conn.commit()
    return conn


def initial_state() -> dict[str, Any]:
    return {
        "session_id": "",
        "root_session_id": "",
        "cwd": "",
        "model": "unknown",
        "originator": "unknown",
        "source_surface": "unknown",
        "cli_version": "unknown",
        "reasoning_effort": "unknown",
        "agent_type": "main",
        "agent_nickname": "",
        "model_provider": "unknown",
        "previous_total": None,
        "counter_cycle": 0,
        "fork_bootstrap": False,
        "last_interesting_timestamp": "",
    }


def normalize_usage(value: Any) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    result: dict[str, int] = {}
    for field in TOKEN_FIELDS:
        raw = value.get(field, 0)
        try:
            result[field] = max(0, int(raw or 0))
        except (TypeError, ValueError):
            result[field] = 0
    if result["total_tokens"] == 0:
        result["total_tokens"] = result["input_tokens"] + result["output_tokens"]
    return result


def usage_delta(current: dict[str, int], previous: dict[str, int] | None) -> tuple[dict[str, int] | None, bool]:
    """Return a new-call delta and whether the cumulative counter reset.

    Codex emits duplicate token_count snapshots. A real model call is counted
    only when cumulative total_tokens increases. If the counter decreases, a
    new cumulative cycle is assumed and the current snapshot becomes the delta.
    """
    if previous is None:
        return (current if current["total_tokens"] > 0 else None), False
    current_total = current["total_tokens"]
    previous_total = previous["total_tokens"]
    if current_total == previous_total:
        return None, False
    if current_total < previous_total:
        return (current if current_total > 0 else None), True
    delta = {field: max(0, current[field] - previous.get(field, 0)) for field in TOKEN_FIELDS}
    if delta["total_tokens"] == 0:
        delta["total_tokens"] = delta["input_tokens"] + delta["output_tokens"]
    return (delta if delta["total_tokens"] > 0 else None), False


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def local_day(timestamp_value: Any, tz: ZoneInfo, fallback: date) -> str:
    parsed = parse_timestamp(timestamp_value)
    if parsed is None:
        return fallback.isoformat()
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(tz).date().isoformat()


def local_time_dimensions(timestamp_value: Any, tz: ZoneInfo, fallback: date) -> tuple[str, int, int]:
    parsed = parse_timestamp(timestamp_value)
    if parsed is None:
        return fallback.isoformat(), 0, fallback.weekday()
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    localized = parsed.astimezone(tz)
    return localized.date().isoformat(), localized.hour, localized.weekday()


def normalize_source_surface(source: Any) -> str:
    if isinstance(source, str) and source:
        return source
    if isinstance(source, dict):
        if isinstance(source.get("subagent"), dict):
            return "subagent"
        for key in source:
            if key:
                return str(key)
    return "unknown"


def rollout_file_date(path: Path) -> date | None:
    match = ROLLOUT_DATE_RE.search(path.name)
    if not match:
        return None
    try:
        return date.fromisoformat(match.group(1))
    except ValueError:
        return None


def discover_files(codex_home: Path, start: date | None = None, end: date | None = None) -> list[Path]:
    roots = (codex_home / "sessions", codex_home / "archived_sessions")
    result: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        for dirpath, _, filenames in os.walk(root):
            base = Path(dirpath)
            for filename in filenames:
                if not filename.endswith(".jsonl"):
                    continue
                path = base / filename
                file_day = rollout_file_date(path)
                if start and file_day and file_day < start:
                    continue
                if end and file_day and file_day > end:
                    continue
                result.append(path)
    return sorted(result)


@dataclass
class ScanStats:
    discovered: int = 0
    scanned: int = 0
    unchanged: int = 0
    events: int = 0
    invalid_lines: int = 0
    bytes_read: int = 0
    removed: int = 0


def scan_one_file(conn: sqlite3.Connection, path: Path, tz: ZoneInfo) -> tuple[bool, int, int, int]:
    stat = path.stat()
    path_text = str(path)
    stored = conn.execute("SELECT * FROM files WHERE path = ?", (path_text,)).fetchone()

    unchanged = (
        stored is not None
        and stored["scan_version"] == SCAN_VERSION
        and stored["inode"] == stat.st_ino
        and stored["size"] == stat.st_size
        and stored["mtime_ns"] == stat.st_mtime_ns
    )
    if unchanged:
        return False, 0, 0, 0

    append_only = (
        stored is not None
        and stored["scan_version"] == SCAN_VERSION
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
        state = initial_state()

    file_fallback_day = rollout_file_date(path) or datetime.fromtimestamp(stat.st_mtime, tz).date()
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
            if not any(marker in raw for marker in INTERESTING_MARKERS):
                continue
            try:
                record = json.loads(raw)
            except (json.JSONDecodeError, UnicodeDecodeError):
                invalid += 1
                continue
            record_type = record.get("type")
            payload = record.get("payload")
            if not isinstance(payload, dict):
                continue

            timestamp_value = record.get("timestamp") or payload.get("timestamp")
            timestamp_parsed = parse_timestamp(timestamp_value)
            previous_timestamp = parse_timestamp(state.get("last_interesting_timestamp"))
            if (
                state.get("fork_bootstrap")
                and timestamp_parsed is not None
                and previous_timestamp is not None
                and (timestamp_parsed - previous_timestamp).total_seconds() > FORK_BOOTSTRAP_GAP_SECONDS
            ):
                state["fork_bootstrap"] = False
            if isinstance(timestamp_value, str):
                state["last_interesting_timestamp"] = timestamp_value

            if record_type == "session_meta":
                session_id = str(payload.get("id") or state.get("session_id") or "")
                state["session_id"] = session_id
                if not state.get("root_session_id"):
                    state["root_session_id"] = session_id
                    source = payload.get("source")
                    is_subagent = isinstance(source, dict) and isinstance(source.get("subagent"), dict)
                    state["originator"] = str(payload.get("originator") or "unknown")
                    state["source_surface"] = normalize_source_surface(source)
                    state["cli_version"] = str(payload.get("cli_version") or "unknown")
                    state["model_provider"] = str(payload.get("model_provider") or "unknown")
                    state["agent_type"] = (
                        "subagent"
                        if payload.get("forked_from_id") or payload.get("parent_thread_id") or is_subagent
                        else "main"
                    )
                    state["agent_nickname"] = str(payload.get("agent_nickname") or "")
                    state["fork_bootstrap"] = bool(
                        payload.get("forked_from_id") or payload.get("parent_thread_id") or is_subagent
                    )
                if payload.get("cwd"):
                    state["cwd"] = str(payload["cwd"])
                continue

            if record_type == "turn_context":
                if payload.get("cwd"):
                    state["cwd"] = str(payload["cwd"])
                if payload.get("model"):
                    state["model"] = str(payload["model"])
                if payload.get("effort"):
                    state["reasoning_effort"] = str(payload["effort"])
                continue

            if record_type != "event_msg" or payload.get("type") != "token_count":
                continue
            info = payload.get("info")
            if not isinstance(info, dict):
                continue
            total = normalize_usage(info.get("total_token_usage"))
            if total is None:
                # Very old records may expose only a per-request usage value.
                total = normalize_usage(info.get("last_token_usage"))
                state["previous_total"] = None
            delta, reset = usage_delta(total, state.get("previous_total")) if total else (None, False)
            if total is not None:
                state["previous_total"] = total
            if reset:
                state["counter_cycle"] = int(state.get("counter_cycle", 0)) + 1
            if delta is None or state.get("fork_bootstrap"):
                continue

            timestamp_text = str(timestamp_value or "")
            day, local_hour, weekday = local_time_dimensions(timestamp_value, tz, file_fallback_day)
            context_window = info.get("model_context_window")
            try:
                context_window = int(context_window) if context_window is not None else None
            except (TypeError, ValueError):
                context_window = None
            conn.execute(
                """
                INSERT OR REPLACE INTO usage_events (
                    file_path, line_no, timestamp, day, local_hour, weekday, cwd, model,
                    session_id, originator, source_surface, cli_version,
                    reasoning_effort, agent_type, agent_nickname, model_provider,
                    input_tokens, cached_input_tokens, cache_write_input_tokens,
                    output_tokens, reasoning_output_tokens, total_tokens, context_window
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    path_text,
                    line_no,
                    timestamp_text,
                    day,
                    local_hour,
                    weekday,
                    str(state.get("cwd") or "unknown"),
                    str(state.get("model") or "unknown"),
                    str(state.get("root_session_id") or state.get("session_id") or ""),
                    str(state.get("originator") or "unknown"),
                    str(state.get("source_surface") or "unknown"),
                    str(state.get("cli_version") or "unknown"),
                    str(state.get("reasoning_effort") or "unknown"),
                    str(state.get("agent_type") or "main"),
                    str(state.get("agent_nickname") or ""),
                    str(state.get("model_provider") or "unknown"),
                    delta["input_tokens"],
                    delta["cached_input_tokens"],
                    delta["cache_write_input_tokens"],
                    delta["output_tokens"],
                    delta["reasoning_output_tokens"],
                    delta["total_tokens"],
                    context_window,
                ),
            )
            events += 1

        final_offset = handle.tell()

    conn.execute(
        """
        INSERT OR REPLACE INTO files
            (path, inode, size, mtime_ns, offset, line_no, state_json, scan_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            path_text,
            stat.st_ino,
            stat.st_size,
            stat.st_mtime_ns,
            final_offset,
            line_no,
            json.dumps(state, separators=(",", ":")),
            SCAN_VERSION,
        ),
    )
    return True, events, invalid, bytes_read


def prune_missing_files(conn: sqlite3.Connection, discovered: set[str]) -> int:
    removed = 0
    for row in conn.execute("SELECT path FROM files"):
        path = row["path"]
        if path not in discovered and not Path(path).exists():
            conn.execute("DELETE FROM usage_events WHERE file_path = ?", (path,))
            conn.execute("DELETE FROM files WHERE path = ?", (path,))
            removed += 1
    return removed


def scan_usage(
    conn: sqlite3.Connection,
    codex_home: Path,
    tz: ZoneInfo,
    quick_start: date | None = None,
    quick_end: date | None = None,
    quiet: bool = False,
) -> ScanStats:
    files = discover_files(codex_home, quick_start, quick_end)
    stats = ScanStats(discovered=len(files))
    for index, path in enumerate(files, 1):
        try:
            changed, events, invalid, bytes_read = scan_one_file(conn, path, tz)
        except (OSError, json.JSONDecodeError) as exc:
            if not quiet:
                print(f"Warning: skipped {path}: {exc}", file=sys.stderr)
            continue
        if changed:
            stats.scanned += 1
            stats.events += events
            stats.invalid_lines += invalid
            stats.bytes_read += bytes_read
        else:
            stats.unchanged += 1
        if not quiet and index % 50 == 0:
            print(
                f"Indexed {index}/{len(files)} files; "
                f"new calls {stats.events:,}; read {stats.bytes_read / 1024**3:.2f} GiB",
                file=sys.stderr,
            )
        if index % 25 == 0:
            conn.commit()
    if quick_start is None and quick_end is None:
        stats.removed = prune_missing_files(conn, {str(path) for path in files})
    conn.commit()
    return stats


class ProjectResolver:
    def __init__(self, config: dict[str, Any]):
        self.mode = str(config.get("project_mode", "git"))
        aliases = config.get("project_aliases", {})
        self.aliases = aliases if isinstance(aliases, dict) else {}
        self.cache: dict[str, tuple[str, str]] = {}

    def resolve(self, cwd: str) -> tuple[str, str]:
        if cwd in self.cache:
            return self.cache[cwd]
        normalized = str(Path(cwd).expanduser()) if cwd and cwd != "unknown" else "unknown"
        for prefix, name in sorted(self.aliases.items(), key=lambda item: len(item[0]), reverse=True):
            expanded = str(Path(prefix).expanduser())
            if normalized == expanded or normalized.startswith(expanded.rstrip(os.sep) + os.sep):
                value = (str(name), expanded)
                self.cache[cwd] = value
                return value

        path = Path(normalized)
        project_path = path
        if self.mode == "git" and path.exists():
            if path.is_file():
                path = path.parent
            for candidate in (path, *path.parents):
                git_marker = candidate / ".git"
                if git_marker.exists():
                    project_path = self._canonical_git_root(candidate, git_marker)
                    break
        name = project_path.name or str(project_path)
        value = (name or "unknown", str(project_path))
        self.cache[cwd] = value
        return value

    @staticmethod
    def _canonical_git_root(worktree_root: Path, git_marker: Path) -> Path:
        """Collapse Codex/Git worktrees back to the original repository."""
        if not git_marker.is_file():
            return worktree_root
        try:
            with git_marker.open("r", encoding="utf-8", errors="replace") as handle:
                first_line = handle.readline().strip()
        except OSError:
            return worktree_root
        if not first_line.lower().startswith("gitdir:"):
            return worktree_root
        git_dir = Path(first_line.split(":", 1)[1].strip()).expanduser()
        marker = f"{os.sep}.git{os.sep}worktrees{os.sep}"
        git_dir_text = str(git_dir)
        if marker in git_dir_text:
            return Path(git_dir_text.split(marker, 1)[0])
        if git_dir.name == ".git":
            return git_dir.parent
        return worktree_root


class PriceBook:
    def __init__(self, data: dict[str, Any]):
        self.data = data
        self.models = data.get("models", {})
        self.aliases = data.get("aliases", {})
        self.long_threshold = int(data.get("long_context_threshold_tokens", 272000))

    def resolve(self, model: str) -> tuple[str | None, dict[str, Any] | None, str]:
        candidate = (model or "unknown").lower()
        if "/" in candidate:
            candidate = candidate.rsplit("/", 1)[-1]
        candidate = str(self.aliases.get(candidate, candidate))
        if candidate in self.models:
            return candidate, self.models[candidate], "exact" if candidate == model.lower() else "alias"
        dated = DATED_MODEL_RE.match(candidate)
        if dated and dated.group(1) in self.models:
            key = dated.group(1)
            return key, self.models[key], "version_alias"
        return None, None, "unknown"

    def cost(self, event: dict[str, Any]) -> dict[str, Any]:
        resolved, entry, status = self.resolve(str(event.get("model", "unknown")))
        if entry is None:
            return {
                "known": False,
                "resolved_model": None,
                "pricing_status": status,
                "cost": 0.0,
                "savings": 0.0,
                "potential_additional_savings": 0.0,
                "uncached_input_tokens": max(0, int(event.get("input_tokens", 0)) - int(event.get("cached_input_tokens", 0))),
            }
        # Long-context pricing depends on request input, not model capacity.
        request_input_tokens = int(event.get("input_tokens", 0))
        tier = "long" if request_input_tokens > self.long_threshold and entry.get("long") else "short"
        rates = entry.get(tier) or entry.get("short")
        input_tokens = int(event.get("input_tokens", 0))
        cached_tokens = min(input_tokens, int(event.get("cached_input_tokens", 0)))
        write_tokens = min(max(0, input_tokens - cached_tokens), int(event.get("cache_write_input_tokens", 0)))
        uncached_tokens = max(0, input_tokens - cached_tokens - write_tokens)
        output_tokens = int(event.get("output_tokens", 0))
        input_cost = uncached_tokens * float(rates["input"]) / 1_000_000
        cached_cost = cached_tokens * float(rates.get("cached_input", rates["input"])) / 1_000_000
        write_rate = float(rates.get("cache_write", rates["input"]))
        write_cost = write_tokens * write_rate / 1_000_000
        output_cost = output_tokens * float(rates["output"]) / 1_000_000
        baseline_input_cost = input_tokens * float(rates["input"]) / 1_000_000
        actual_input_cost = input_cost + cached_cost + write_cost
        all_cached_input_cost = input_tokens * float(rates.get("cached_input", rates["input"])) / 1_000_000
        return {
            "known": True,
            "resolved_model": resolved,
            "pricing_status": status,
            "pricing_tier": tier,
            "uncached_input_tokens": uncached_tokens,
            "cost": input_cost + cached_cost + write_cost + output_cost,
            "input_cost": input_cost,
            "cached_cost": cached_cost,
            "cache_write_cost": write_cost,
            "output_cost": output_cost,
            "savings": baseline_input_cost - actual_input_cost,
            "potential_additional_savings": max(0.0, actual_input_cost - all_cached_input_cost),
        }


def query_events(conn: sqlite3.Connection, start: date, end: date) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT timestamp, day, local_hour, weekday, cwd, model, session_id,
               originator, source_surface, cli_version, reasoning_effort,
               agent_type, agent_nickname, model_provider,
               input_tokens, cached_input_tokens, cache_write_input_tokens,
               output_tokens, reasoning_output_tokens, total_tokens, context_window
        FROM usage_events
        WHERE day >= ? AND day <= ?
        ORDER BY day, timestamp
        """,
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    return [dict(row) for row in rows]


def query_day_range(conn: sqlite3.Connection) -> tuple[date | None, date | None]:
    row = conn.execute("SELECT MIN(day) AS first_day, MAX(day) AS last_day FROM usage_events").fetchone()
    if row is None or not row["first_day"] or not row["last_day"]:
        return None, None
    return date.fromisoformat(row["first_day"]), date.fromisoformat(row["last_day"])


def empty_aggregate(day: str = "", project: str = "", project_path: str = "", model: str = "") -> dict[str, Any]:
    return {
        "day": day,
        "project": project,
        "project_path": project_path,
        "model": model,
        "calls": 0,
        "cache_hit_calls": 0,
        "input_tokens": 0,
        "uncached_input_tokens": 0,
        "cached_input_tokens": 0,
        "cache_write_input_tokens": 0,
        "output_tokens": 0,
        "reasoning_output_tokens": 0,
        "total_tokens": 0,
        "estimated_cost_usd": 0.0,
        "cache_savings_usd": 0.0,
        "cache_opportunity_usd": 0.0,
        "known_price_calls": 0,
        "unknown_price_calls": 0,
        "known_price_tokens": 0,
        "unknown_price_tokens": 0,
    }


def add_event(target: dict[str, Any], event: dict[str, Any], price: dict[str, Any]) -> None:
    target["calls"] += 1
    if int(event.get("cached_input_tokens", 0)) > 0:
        target["cache_hit_calls"] += 1
    for field in (
        "input_tokens",
        "cached_input_tokens",
        "cache_write_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
        "total_tokens",
    ):
        target[field] += int(event.get(field, 0))
    target["uncached_input_tokens"] += int(price.get("uncached_input_tokens", 0))
    target["estimated_cost_usd"] += float(price.get("cost", 0.0))
    target["cache_savings_usd"] += float(price.get("savings", 0.0))
    target["cache_opportunity_usd"] += float(price.get("potential_additional_savings", 0.0))
    if price.get("known"):
        target["known_price_calls"] += 1
        target["known_price_tokens"] += int(event.get("total_tokens", 0))
    else:
        target["unknown_price_calls"] += 1
        target["unknown_price_tokens"] += int(event.get("total_tokens", 0))


def finalize_aggregate(row: dict[str, Any]) -> dict[str, Any]:
    calls = row["calls"]
    input_tokens = row["input_tokens"]
    row["request_cache_hit_rate"] = row["cache_hit_calls"] / calls if calls else 0.0
    row["token_cache_hit_rate"] = row["cached_input_tokens"] / input_tokens if input_tokens else 0.0
    row["estimated_cost_usd"] = round(row["estimated_cost_usd"], 10)
    row["cache_savings_usd"] = round(row["cache_savings_usd"], 10)
    row["cache_opportunity_usd"] = round(row["cache_opportunity_usd"], 10)
    return row


def aggregate_events(
    events: Iterable[dict[str, Any]],
    resolver: ProjectResolver,
    price_book: PriceBook,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    total = empty_aggregate()
    for event in events:
        project, project_path = resolver.resolve(str(event.get("cwd") or "unknown"))
        key = (str(event["day"]), project, str(event.get("model") or "unknown"))
        if key not in grouped:
            grouped[key] = empty_aggregate(key[0], key[1], project_path, key[2])
        price = price_book.cost(event)
        add_event(grouped[key], event, price)
        add_event(total, event, price)
    rows = [finalize_aggregate(row) for row in grouped.values()]
    rows.sort(key=lambda row: (row["day"], row["project"], row["model"]), reverse=True)
    return rows, finalize_aggregate(total)


def project_leaderboard(rows: Iterable[dict[str, Any]], total: dict[str, Any]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    additive_fields = (
        "calls",
        "cache_hit_calls",
        "input_tokens",
        "uncached_input_tokens",
        "cached_input_tokens",
        "cache_write_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
        "total_tokens",
        "estimated_cost_usd",
        "cache_savings_usd",
        "cache_opportunity_usd",
        "known_price_calls",
        "unknown_price_calls",
        "known_price_tokens",
        "unknown_price_tokens",
    )
    for row in rows:
        project = str(row.get("project") or "unknown")
        if project not in grouped:
            grouped[project] = empty_aggregate(
                project=project,
                project_path=str(row.get("project_path") or "unknown"),
            )
        target = grouped[project]
        for field in additive_fields:
            target[field] += row.get(field, 0)
    ranking = [finalize_aggregate(row) for row in grouped.values()]
    ranking.sort(
        key=lambda row: (row["estimated_cost_usd"], row["total_tokens"], row["calls"]),
        reverse=True,
    )
    total_value = float(total.get("estimated_cost_usd", 0.0))
    total_tokens = int(total.get("total_tokens", 0))
    for index, row in enumerate(ranking, 1):
        row["rank"] = index
        row["value_share"] = row["estimated_cost_usd"] / total_value if total_value else 0.0
        row["token_share"] = row["total_tokens"] / total_tokens if total_tokens else 0.0
    return ranking


WEEKDAY_LABELS = ("周一", "周二", "周三", "周四", "周五", "周六", "周日")


def quick_dimension_values(
    event: dict[str, Any], project: str, project_path: str
) -> list[tuple[str, str, Any]]:
    """Return every safe metadata dimension exposed by the local usage index."""
    day_value = str(event.get("day") or "未知")
    try:
        weekday = max(0, min(6, int(event.get("weekday", 0))))
    except (TypeError, ValueError):
        weekday = 0
    try:
        hour = max(0, min(23, int(event.get("local_hour", 0))))
    except (TypeError, ValueError):
        hour = 0
    context_window = int(event.get("context_window") or 0)
    agent_type = str(event.get("agent_type") or "main")
    agent_label = "子代理" if agent_type == "subagent" else "主代理"
    nickname = str(event.get("agent_nickname") or "未命名")
    model = str(event.get("model") or "unknown")
    cwd = str(event.get("cwd") or "unknown")
    return [
        ("project", project, project.lower()),
        ("model", model, model.lower()),
        ("project_model", f"{project} × {model}", f"{project.lower()}|{model.lower()}"),
        ("day", day_value, day_value),
        ("month", day_value[:7], day_value[:7]),
        ("weekday", WEEKDAY_LABELS[weekday], weekday),
        ("hour", f"{hour:02d}:00–{hour:02d}:59", hour),
        ("workspace", cwd, cwd.lower()),
        ("source_surface", str(event.get("source_surface") or "unknown"), str(event.get("source_surface") or "unknown")),
        ("originator", str(event.get("originator") or "unknown"), str(event.get("originator") or "unknown")),
        ("reasoning_effort", str(event.get("reasoning_effort") or "unknown"), str(event.get("reasoning_effort") or "unknown")),
        ("agent_type", agent_label, 1 if agent_type == "subagent" else 0),
        ("agent_nickname", nickname, nickname.lower()),
        ("cli_version", str(event.get("cli_version") or "unknown"), str(event.get("cli_version") or "unknown")),
        ("model_provider", str(event.get("model_provider") or "unknown"), str(event.get("model_provider") or "unknown")),
        (
            "context_window",
            f"{context_window:,} tokens" if context_window else "未知",
            context_window,
        ),
    ]


def build_quick_stats(
    events: Iterable[dict[str, Any]],
    resolver: ProjectResolver,
    price_book: PriceBook,
) -> dict[str, list[dict[str, Any]]]:
    """Aggregate one event set across every dashboard quick-stat dimension."""
    groups: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for event in events:
        project, project_path = resolver.resolve(str(event.get("cwd") or "unknown"))
        price = price_book.cost(event)
        session_id = str(event.get("session_id") or "")
        for dimension, label, order in quick_dimension_values(event, project, project_path):
            target = groups[dimension].get(label)
            if target is None:
                target = empty_aggregate()
                target.update(
                    {
                        "dimension": dimension,
                        "label": label,
                        "order": order,
                        "project_path": project_path if dimension == "project" else "",
                        "_session_ids": set(),
                    }
                )
                groups[dimension][label] = target
            add_event(target, event, price)
            if session_id:
                target["_session_ids"].add(session_id)

    result: dict[str, list[dict[str, Any]]] = {}
    for dimension, dimension_groups in groups.items():
        dimension_rows: list[dict[str, Any]] = []
        for target in dimension_groups.values():
            session_ids = target.pop("_session_ids")
            finalize_aggregate(target)
            target["sessions"] = len(session_ids)
            calls = int(target["calls"])
            output_tokens = int(target["output_tokens"])
            total_tokens = int(target["total_tokens"])
            target["reasoning_ratio"] = (
                target["reasoning_output_tokens"] / output_tokens if output_tokens else 0.0
            )
            target["average_tokens_per_call"] = total_tokens / calls if calls else 0.0
            target["average_cost_per_call"] = (
                target["estimated_cost_usd"] / calls if calls else 0.0
            )
            target["price_coverage"] = (
                target["known_price_calls"] / calls if calls else 0.0
            )
            dimension_rows.append(target)
        dimension_rows.sort(
            key=lambda row: (
                row["estimated_cost_usd"],
                row["total_tokens"],
                row["calls"],
            ),
            reverse=True,
        )
        result[dimension] = dimension_rows
    return result


def build_quick_scopes(
    events: list[dict[str, Any]],
    today: date,
    resolver: ProjectResolver,
    price_book: PriceBook,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, list[dict[str, Any]]]]]:
    overall_start = min((str(event["day"]) for event in events), default=today.isoformat())
    scope_ranges = {
        "today": (today, today, "今天"),
        "yesterday": (today - timedelta(days=1), today - timedelta(days=1), "昨天"),
        "7d": (today - timedelta(days=6), today, "近 7 天"),
        "30d": (today - timedelta(days=29), today, "近 30 天"),
        "90d": (today - timedelta(days=89), today, "近 90 天"),
        "overall": (date.fromisoformat(overall_start), today, "全部历史"),
    }
    scope_meta: dict[str, dict[str, Any]] = {}
    scope_stats: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for key, (scope_start, scope_end, label) in scope_ranges.items():
        scoped_events = [
            event
            for event in events
            if scope_start.isoformat() <= str(event.get("day") or "") <= scope_end.isoformat()
        ]
        scope_meta[key] = {
            "label": label,
            "start": scope_start.isoformat(),
            "end": scope_end.isoformat(),
            "calls": len(scoped_events),
        }
        scope_stats[key] = build_quick_stats(scoped_events, resolver, price_book)
    return scope_meta, scope_stats


def ratio_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return None if current else 0.0
    return (current - previous) / previous


def management_summary(
    events: list[dict[str, Any]],
    today: date,
    resolver: ProjectResolver,
    price_book: PriceBook,
) -> dict[str, Any]:
    def select(period_start: date, period_end: date) -> list[dict[str, Any]]:
        start_text, end_text = period_start.isoformat(), period_end.isoformat()
        return [event for event in events if start_text <= str(event.get("day") or "") <= end_text]

    def aggregate_period(period_start: date, period_end: date) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        return aggregate_events(select(period_start, period_end), resolver, price_book)

    comparison_end = today - timedelta(days=1)
    current_7_start = comparison_end - timedelta(days=6)
    previous_7_end = current_7_start - timedelta(days=1)
    previous_7_start = previous_7_end - timedelta(days=6)
    current_30_start = comparison_end - timedelta(days=29)
    previous_30_end = current_30_start - timedelta(days=1)
    previous_30_start = previous_30_end - timedelta(days=29)

    _, current_7 = aggregate_period(current_7_start, comparison_end)
    _, previous_7 = aggregate_period(previous_7_start, previous_7_end)
    current_rows, current_30 = aggregate_period(current_30_start, comparison_end)
    previous_rows, previous_30 = aggregate_period(previous_30_start, previous_30_end)
    current_projects = project_leaderboard(current_rows, current_30)
    previous_project_rows = project_leaderboard(previous_rows, previous_30)
    previous_projects = {row["project"]: row for row in previous_project_rows}

    growth_rows = []
    for row in current_projects:
        previous = previous_projects.get(row["project"], {})
        previous_cost = float(previous.get("estimated_cost_usd", 0.0))
        current_cost = float(row["estimated_cost_usd"])
        growth_rows.append(
            {
                "project": row["project"],
                "current_cost": current_cost,
                "previous_cost": previous_cost,
                "cost_increase": current_cost - previous_cost,
                "cost_change": ratio_change(current_cost, previous_cost),
                "is_new": previous_cost == 0 and current_cost > 0,
            }
        )
    positive_growth = [row for row in growth_rows if row["cost_increase"] > 0]
    positive_increase_total = sum(row["cost_increase"] for row in positive_growth)
    for row in growth_rows:
        row["growth_contribution"] = (
            row["cost_increase"] / positive_increase_total
            if positive_increase_total and row["cost_increase"] > 0
            else 0.0
        )
    new_project = max(
        (row for row in positive_growth if row["is_new"]),
        key=lambda row: row["cost_increase"],
        default=None,
    )
    existing_growth = max(
        (row for row in positive_growth if not row["is_new"]),
        key=lambda row: row["cost_increase"],
        default=None,
    )
    growth_contributors = sorted(
        positive_growth, key=lambda row: row["cost_increase"], reverse=True
    )[:5]

    meaningful_input = max(1_000_000, int(current_30["input_tokens"] * 0.001))
    cache_candidates = [
        row for row in current_projects if int(row["input_tokens"]) >= meaningful_input
    ]
    cache_risk_row = max(
        cache_candidates,
        key=lambda row: (row["cache_opportunity_usd"], -row["token_cache_hit_rate"]),
        default=None,
    )
    cache_risk = None
    if cache_risk_row:
        previous_cache = previous_projects.get(cache_risk_row["project"])
        previous_cache_rate = (
            float(previous_cache["token_cache_hit_rate"]) if previous_cache else None
        )
        cache_risk = {
            **cache_risk_row,
            "previous_cache_hit_rate": previous_cache_rate,
            "cache_rate_change": (
                float(cache_risk_row["token_cache_hit_rate"]) - previous_cache_rate
                if previous_cache_rate is not None
                else None
            ),
        }
    cost_candidates = [row for row in current_projects if int(row["calls"]) >= 30]
    high_unit_cost = max(
        cost_candidates,
        key=lambda row: row["estimated_cost_usd"] / row["calls"] if row["calls"] else 0,
        default=None,
    )
    if high_unit_cost:
        high_unit_cost = {
            "project": high_unit_cost["project"],
            "average_cost": high_unit_cost["estimated_cost_usd"] / high_unit_cost["calls"],
            "calls": high_unit_cost["calls"],
            "cost_per_million_tokens": (
                high_unit_cost["estimated_cost_usd"] / high_unit_cost["total_tokens"] * 1_000_000
                if high_unit_cost["total_tokens"]
                else 0.0
            ),
        }
    top3_share = sum(float(row["value_share"]) for row in current_projects[:3])
    previous_top3_share = sum(float(row["value_share"]) for row in previous_project_rows[:3])
    hhi = sum(float(row["value_share"]) ** 2 for row in current_projects)
    previous_hhi = sum(float(row["value_share"]) ** 2 for row in previous_project_rows)

    def comparison(current: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
        current_coverage = current["known_price_calls"] / current["calls"] if current["calls"] else 0.0
        previous_coverage = previous["known_price_calls"] / previous["calls"] if previous["calls"] else 0.0
        current_token_coverage = (
            current["known_price_tokens"] / current["total_tokens"] if current["total_tokens"] else 0.0
        )
        previous_token_coverage = (
            previous["known_price_tokens"] / previous["total_tokens"] if previous["total_tokens"] else 0.0
        )
        return {
            "current": current,
            "previous": previous,
            "cost_change": ratio_change(
                float(current["estimated_cost_usd"]), float(previous["estimated_cost_usd"])
            ),
            "token_change": ratio_change(
                float(current["total_tokens"]), float(previous["total_tokens"])
            ),
            "call_change": ratio_change(float(current["calls"]), float(previous["calls"])),
            "cache_rate_change": float(current["token_cache_hit_rate"])
            - float(previous["token_cache_hit_rate"]),
            "current_price_coverage": current_coverage,
            "previous_price_coverage": previous_coverage,
            "price_coverage_change": current_coverage - previous_coverage,
            "current_token_price_coverage": current_token_coverage,
            "previous_token_price_coverage": previous_token_coverage,
            "token_price_coverage_change": current_token_coverage - previous_token_coverage,
            "cost_comparable": (
                abs(current_coverage - previous_coverage) <= 0.02
                and abs(current_token_coverage - previous_token_coverage) <= 0.02
            ),
        }

    return {
        "periods": {
            "7d": {
                "start": current_7_start.isoformat(),
                "end": comparison_end.isoformat(),
                **comparison(current_7, previous_7),
            },
            "30d": {
                "start": current_30_start.isoformat(),
                "end": comparison_end.isoformat(),
                **comparison(current_30, previous_30),
            },
        },
        "as_of_complete_day": comparison_end.isoformat(),
        "new_project": new_project,
        "existing_growth": existing_growth,
        "growth_contributors": growth_contributors,
        "cache_risk": cache_risk,
        "high_unit_cost": high_unit_cost,
        "top3_share": top3_share,
        "previous_top3_share": previous_top3_share,
        "hhi": hhi,
        "previous_hhi": previous_hhi,
        "known_cost_lower_bound": current_30["estimated_cost_usd"],
        "no_cache_baseline": current_30["estimated_cost_usd"] + current_30["cache_savings_usd"],
        "price_coverage": (
            current_30["known_price_calls"] / current_30["calls"] if current_30["calls"] else 0.0
        ),
        "token_price_coverage": (
            current_30["known_price_tokens"] / current_30["total_tokens"]
            if current_30["total_tokens"]
            else 0.0
        ),
        "data_quality": {
            "sessions": len({str(event.get("session_id")) for event in events if event.get("session_id")}),
            "subagent_sessions": len(
                {
                    str(event.get("session_id"))
                    for event in events
                    if event.get("session_id") and event.get("agent_type") == "subagent"
                }
            ),
            "cache_write_input_tokens": sum(
                int(event.get("cache_write_input_tokens", 0)) for event in events
            ),
        },
    }


def format_tokens(value: int) -> str:
    return f"{value:,}"


def format_cost(value: float) -> str:
    if value == 0:
        return "$0.00"
    if value < 0.01:
        return f"${value:.4f}"
    return f"${value:,.2f}"


def format_compact_number(value: int) -> str:
    absolute = abs(value)
    if absolute >= 1_000_000_000:
        return f"{value / 1_000_000_000:.2f}B"
    if absolute >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    if absolute >= 1_000:
        return f"{value / 1_000:.1f}K"
    return f"{value:,}"


def format_change(value: float | None) -> str:
    if value is None:
        return "新增"
    if abs(value) < 0.0005:
        return "基本持平"
    return f"{'↑' if value > 0 else '↓'} {abs(value):.1%}"


def static_cost_chart(rows: list[dict[str, Any]]) -> str:
    daily: dict[str, float] = defaultdict(float)
    for row in rows:
        daily[str(row["day"])] += float(row["estimated_cost_usd"])
    days = sorted(daily)
    if not days:
        return '<div class="empty-chart">所选日期范围内没有数据</div>'
    width, height = 1000, 230
    left, right, top, bottom = 62, 18, 16, 38
    plot_width = width - left - right
    plot_height = height - top - bottom
    maximum = max(max(daily.values()), 0.0001)
    slot = plot_width / len(days)
    bar_width = max(2.0, slot * 0.64)
    parts = [f'<svg class="static-chart" viewBox="0 0 {width} {height}" role="img" aria-label="每日 API 等价成本">']
    for index in range(5):
        y = top + plot_height * index / 4
        amount = maximum * (4 - index) / 4
        parts.append(f'<line x1="{left}" y1="{y:.2f}" x2="{width-right}" y2="{y:.2f}" stroke="#263751"/>')
        parts.append(f'<text x="4" y="{y+4:.2f}" fill="#93a6c1" font-size="11">{html.escape(format_cost(amount))}</text>')
    label_step = 1 if len(days) <= 14 else max(1, math.ceil(len(days) / 10))
    for index, day_value in enumerate(days):
        bar_height = plot_height * daily[day_value] / maximum
        x = left + index * slot + (slot - bar_width) / 2
        y = height - bottom - bar_height
        parts.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{bar_width:.2f}" height="{bar_height:.2f}" rx="2" fill="#4de1d2"/>')
        if index % label_step == 0:
            parts.append(f'<text x="{x + bar_width/2:.2f}" y="{height-14}" text-anchor="middle" fill="#93a6c1" font-size="11">{html.escape(day_value[5:])}</text>')
    parts.append("</svg>")
    return "".join(parts)


def render_table(rows: list[dict[str, Any]], total: dict[str, Any]) -> str:
    headers = ["日期", "项目", "模型", "续跑", "输入", "缓存读取", "缓存占输入", "输出", "推理", "API估算"]
    values: list[list[str]] = []
    for row in rows:
        cost_text = format_cost(row["estimated_cost_usd"])
        if row["unknown_price_calls"]:
            cost_text += "*"
        values.append(
            [
                row["day"],
                row["project"],
                row["model"],
                str(row["calls"]),
                format_tokens(row["input_tokens"]),
                format_tokens(row["cached_input_tokens"]),
                f"{row['token_cache_hit_rate']:.1%}",
                format_tokens(row["output_tokens"]),
                format_tokens(row["reasoning_output_tokens"]),
                cost_text,
            ]
        )
    widths = [len(header) for header in headers]
    for values_row in values:
        for index, value in enumerate(values_row):
            widths[index] = max(widths[index], len(value))
    lines = ["  ".join(header.ljust(widths[index]) for index, header in enumerate(headers))]
    lines.append("  ".join("-" * width for width in widths))
    for values_row in values:
        lines.append("  ".join(value.ljust(widths[index]) for index, value in enumerate(values_row)))
    lines.append("")
    lines.append(
        "合计："
        f"{total['calls']:,} 次模型续跑，输入 {total['input_tokens']:,}，"
        f"缓存命中 {total['cached_input_tokens']:,} ({total['token_cache_hit_rate']:.1%})，"
        f"输出 {total['output_tokens']:,}，API 等价估算 {format_cost(total['estimated_cost_usd'])}"
    )
    if total["unknown_price_calls"]:
        lines.append(f"* {total['unknown_price_calls']:,} 次续跑没有匹配到公开价格，未计入金额。")
    return "\n".join(lines)


def build_explorer_data(events, resolver, price_book):
    """Compact, lossless-for-filtering daily metadata aggregates (no conversation text)."""
    dimensions = [
        "day", "project", "project_path", "model", "session", "hour", "workspace",
        "source_surface", "originator", "reasoning_effort", "agent_type",
        "agent_nickname", "cli_version", "model_provider", "context_window",
    ]
    numeric = [key for key, value in empty_aggregate().items() if isinstance(value, (int, float))]
    dictionaries = {key: [] for key in dimensions}
    indexes = {key: {} for key in dimensions}
    sessions = {}
    groups = {}
    for event in events:
        project, project_path = resolver.resolve(str(event.get("cwd") or "unknown"))
        sid = str(event.get("session_id") or "")
        session = sessions.setdefault(sid, len(sessions)) if sid else None
        values = [
            event["day"], project, project_path, str(event.get("model") or "unknown"),
            session, int(event.get("local_hour") or 0), str(event.get("cwd") or "unknown"),
            str(event.get("source_surface") or "unknown"), str(event.get("originator") or "unknown"),
            str(event.get("reasoning_effort") or "unknown"),
            "子代理" if event.get("agent_type") == "subagent" else "主代理",
            str(event.get("agent_nickname") or "未命名"), str(event.get("cli_version") or "unknown"),
            str(event.get("model_provider") or "unknown"), int(event.get("context_window") or 0),
        ]
        key = []
        for dimension, value in zip(dimensions, values):
            if value not in indexes[dimension]:
                indexes[dimension][value] = len(dictionaries[dimension])
                dictionaries[dimension].append(value)
            key.append(indexes[dimension][value])
        key = tuple(key)
        if key not in groups:
            groups[key] = empty_aggregate()
        add_event(groups[key], event, price_book.cost(event))
    return {
        "dimensions": dimensions, "numeric": numeric, "dictionaries": dictionaries,
        "session_keys": [hashlib.sha256(sid.encode("utf-8")).hexdigest()[:24] for sid in sessions],
        "rows": [list(key) + [row[field] for field in numeric] for key, row in groups.items()],
    }


def dashboard_html(
    rows: list[dict[str, Any]],
    total: dict[str, Any],
    start: date,
    end: date,
    pricing: dict[str, Any],
    overview: dict[str, Any] | None = None,
    agent_graph: dict[str, Any] | None = None,
) -> str:
    from dashboard_view import render_dashboard

    overview = overview or {
        "overall": {"start": start.isoformat(), "end": end.isoformat(), "total": total},
        "analysis_rows": rows,
    }
    payload = {
        "rows": rows,
        "analysis_rows": overview.get("analysis_rows", rows),
        "total": total,
        "overview": {key: value for key, value in overview.items()
                     if key not in ("analysis_rows", "explorer", "quick_stats")},
        "explorer": overview.get("explorer"),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "pricing_as_of": pricing.get("as_of", "unknown"),
        "pricing_source": pricing.get("source_url", ""),
        "agent_graph": agent_graph,
    }
    return render_dashboard(payload, static_cost_chart(rows))


def resolve_range(days: int | None, start_text: str | None, end_text: str | None, tz: ZoneInfo) -> tuple[date, date]:
    today = datetime.now(tz).date()
    end = date.fromisoformat(end_text) if end_text else today
    if start_text:
        start = date.fromisoformat(start_text)
    else:
        effective_days = days if days is not None else 30
        start = end - timedelta(days=max(1, effective_days) - 1)
    if start > end:
        raise ValueError("start date must not be after end date")
    return start, end


def add_common_report_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--days", type=int, default=30, help="Report the latest N days (default: 30)")
    parser.add_argument("--start", help="Start date in YYYY-MM-DD")
    parser.add_argument("--end", help="End date in YYYY-MM-DD")
    parser.add_argument("--no-scan", action="store_true", help="Use the existing index without scanning source files")
    parser.add_argument("--quick-scan", action="store_true", help="Scan only rollout files started in the report date range")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Codex local usage, cache-hit, and API-equivalent cost statistics")
    parser.add_argument("--codex-home", type=Path, default=Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser())
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--pricing", type=Path, default=DEFAULT_PRICING)
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="Update the local usage index")
    scan.add_argument("--days", type=int, help="Quick scan: only rollout files started in the latest N days")
    scan.add_argument("--quiet", action="store_true")

    report = sub.add_parser("report", help="Print or export an aggregated report")
    add_common_report_args(report)
    report.add_argument("--format", choices=("table", "json"), default="table")
    report.add_argument("--output", type=Path)

    dashboard = sub.add_parser("dashboard", help="Generate a local interactive HTML dashboard")
    add_common_report_args(dashboard)
    dashboard.add_argument("--output", type=Path, default=APP_DIR / "codex-usage-report.html")
    dashboard.add_argument("--open", action="store_true", help="Open the generated dashboard in the default browser")

    server = sub.add_parser("serve", help="Serve the usage dashboard and passive Agent canvas on localhost")
    server.add_argument("--port", type=int, default=8766)
    server.add_argument("--refresh-seconds", type=int, default=5)
    server.add_argument("--output", type=Path, default=APP_DIR / "codex-usage-report.html")
    server.add_argument("--open", action="store_true")
    return parser


def print_scan_stats(stats: ScanStats) -> None:
    print(
        f"Scan complete: {stats.discovered:,} files found, {stats.scanned:,} changed, "
        f"{stats.unchanged:,} unchanged, {stats.events:,} model calls indexed, "
        f"{stats.bytes_read / 1024**3:.2f} GiB read.",
        file=sys.stderr,
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config = load_json(args.config)
        pricing = load_json(args.pricing)
        tz = ZoneInfo(str(config.get("timezone", "Asia/Shanghai")))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    if args.command == "serve":
        from workspace_server import serve
        try:
            return serve(args.codex_home, ProjectResolver(config), args.db.parent / "agent-graph.sqlite3",
                         args.output.expanduser().resolve(), args.port, args.refresh_seconds, args.open)
        except (OSError, ValueError) as exc:
            print(f"Workbench error: {exc}", file=sys.stderr)
            return 2

    conn = connect_db(args.db)
    try:
        if args.command == "scan":
            quick_start = None
            if args.days:
                quick_start = datetime.now(tz).date() - timedelta(days=max(1, args.days) - 1)
            stats = scan_usage(conn, args.codex_home, tz, quick_start=quick_start, quiet=args.quiet)
            if not args.quiet:
                print_scan_stats(stats)
            return 0

        try:
            start, end = resolve_range(args.days, args.start, args.end, tz)
        except ValueError as exc:
            print(f"Date error: {exc}", file=sys.stderr)
            return 2

        if not args.no_scan:
            quick_start = start if args.quick_scan else None
            quick_end = end if args.quick_scan else None
            stats = scan_usage(conn, args.codex_home, tz, quick_start=quick_start, quick_end=quick_end)
            print_scan_stats(stats)

        events = query_events(conn, start, end)
        rows, total = aggregate_events(events, ProjectResolver(config), PriceBook(pricing))

        if args.command == "report":
            if args.format == "table":
                content = render_table(rows, total)
                if args.output:
                    ensure_parent(args.output)
                    args.output.write_text(content + "\n", encoding="utf-8")
                else:
                    print(content)
            elif args.format == "json":
                content = json.dumps(
                    {"start": start.isoformat(), "end": end.isoformat(), "rows": rows, "total": total},
                    ensure_ascii=False,
                    indent=2,
                )
                if args.output:
                    ensure_parent(args.output)
                    args.output.write_text(content + "\n", encoding="utf-8")
                else:
                    print(content)
            return 0

        overall_start, overall_end = query_day_range(conn)
        if overall_start is None or overall_end is None:
            overall_start, overall_end = start, end
        overall_events = query_events(conn, overall_start, overall_end)
        overall_rows, overall_total = aggregate_events(
            overall_events, ProjectResolver(config), PriceBook(pricing)
        )
        month_end = datetime.now(tz).date()
        month_start = month_end - timedelta(days=29)
        month_events = query_events(conn, month_start, month_end)
        _, month_total = aggregate_events(
            month_events, ProjectResolver(config), PriceBook(pricing)
        )
        quick_scopes, quick_stats = build_quick_scopes(
            overall_events,
            month_end,
            ProjectResolver(config),
            PriceBook(pricing),
        )
        manager_summary = management_summary(
            overall_events,
            month_end,
            ProjectResolver(config),
            PriceBook(pricing),
        )
        overview = {
            "overall": {
                "start": overall_start.isoformat(),
                "end": overall_end.isoformat(),
                "total": overall_total,
            },
            "month": {
                "start": month_start.isoformat(),
                "end": month_end.isoformat(),
                "total": month_total,
            },
            "leaderboard": project_leaderboard(overall_rows, overall_total),
            "analysis_rows": overall_rows,
            "quick_scopes": quick_scopes,
            "quick_stats": quick_stats,
            "management_summary": manager_summary,
            "explorer": build_explorer_data(overall_events, ProjectResolver(config), PriceBook(pricing)),
        }

        output = args.output.expanduser().resolve()
        ensure_parent(output)
        from agent_graph import AgentGraphCollector
        agent_graph = AgentGraphCollector(args.codex_home, ProjectResolver(config), args.db.parent / "agent-graph.sqlite3").snapshot()
        output.write_text(
            dashboard_html(rows, total, start, end, pricing, overview=overview, agent_graph=agent_graph),
            encoding="utf-8",
        )
        print(f"Dashboard written to {output}")
        if args.open:
            webbrowser.open(output.as_uri())
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
