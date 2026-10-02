"""Emit a synthetic bilingual browser fixture; never read local Codex records."""
import json
from datetime import datetime, timedelta

from codex_usage import empty_aggregate, finalize_aggregate, static_cost_chart
from dashboard_view import render_dashboard


def fixture():
    now = datetime.now().astimezone()
    projects = ["总览", "项目", "Demo Website"]
    dimensions = ["day", "project", "project_path", "model", "session", "hour", "workspace",
                  "agent_type", "agent_nickname", "source_surface", "originator", "reasoning_effort",
                  "cli_version", "model_provider", "context_window"]
    numeric = ["calls", "cache_hit_calls", "input_tokens", "uncached_input_tokens", "cached_input_tokens",
               "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens",
               "estimated_cost_usd", "cache_savings_usd", "cache_opportunity_usd", "known_price_calls",
               "unknown_price_calls", "known_price_tokens", "unknown_price_tokens"]
    records = []
    for offset in range(30):
        day = (now.date() - timedelta(days=offset)).isoformat()
        for index, project in enumerate(projects):
            row = empty_aggregate(day, project, "/demo/" + project, "test-unpriced" if index == 1 else "gpt-6.1-sol")
            factor = (index + 1) * (offset % 4 + 1)
            row.update(calls=3 * factor, cache_hit_calls=2 * factor, input_tokens=120000 * factor,
                       cached_input_tokens=90000 * factor, uncached_input_tokens=30000 * factor,
                       output_tokens=10000 * factor, reasoning_output_tokens=4000 * factor, total_tokens=130000 * factor)
            row.update(known_price_calls=0 if index == 1 else row["calls"], unknown_price_calls=row["calls"] if index == 1 else 0,
                       known_price_tokens=0 if index == 1 else row["total_tokens"], unknown_price_tokens=row["total_tokens"] if index == 1 else 0,
                       estimated_cost_usd=0 if index == 1 else 0.25 * factor, cache_savings_usd=0 if index == 1 else 0.1 * factor)
            row.update(session=index, hour=offset % 24, workspace=row["project_path"], agent_type="main" if index < 2 else "subagent",
                       agent_nickname="Demo worker" if index == 2 else "", source_surface="vscode", originator="demo",
                       reasoning_effort="high", cli_version="0.0.0-test", model_provider="openai", context_window=100000)
            records.append(finalize_aggregate(row))
    total = empty_aggregate()
    for row in records:
        for key in numeric:
            total[key] += row[key]
    finalize_aggregate(total)
    dictionaries = {key: list(dict.fromkeys(row[key] for row in records)) for key in dimensions}
    explorer = {"dimensions": dimensions, "numeric": numeric, "dictionaries": dictionaries,
                "rows": [[dictionaries[key].index(row[key]) for key in dimensions] + [row[key] for key in numeric] for row in records],
                "session_keys": ["demo-main", "demo-standalone", "demo-subagent"]}
    def node(identity, project, kind="session", parent=None, status="working"):
        return {"id": identity, "usage_key": identity, "project": project, "project_id": project,
                "kind": kind, "parent_agent_id": parent if kind == "subagent" else None,
                "owner_session_id": parent if kind == "subagent" else identity,
                "business_parent_id": parent if kind == "session" else None, "created_by": parent,
                "title": "总览 <img src=x onerror=window.fixtureXss=1>" if identity == "demo-main" else "项目 · 中文会话",
                "task_summary": "模型续跑：核对中文项目，不翻译任务正文。", "task_source": "session_title",
                "status": status, "status_label": "执行中 · 记录观察" if status == "working" else "本轮已结束",
                "status_reason": "最新回合记录；本轮结束不等于整个项目完成", "current_activity": "修改项目文件",
                "model": "gpt-6.1-sol", "reasoning_effort": "high", "agent_name": "Demo worker", "agent_role": "worker",
                "cwd": "/demo/" + project, "archived": False, "created_at": now.timestamp() - 3600,
                "last_activity_at": now.timestamp(), "direct_subagent_count": 1 if identity == "demo-branch" else 0,
                "hierarchy_mode": "automatic"}
    graph = {"nodes": [node("demo-main", projects[0]), node("demo-branch", projects[0], parent="demo-main", status="idle"),
                       node("demo-subagent", projects[0], "subagent", "demo-branch"), node("demo-standalone", projects[1], status="idle")],
             "edges": [{"source": "demo-main", "target": "demo-branch", "kind": "delegation"},
                       {"source": "demo-branch", "target": "demo-subagent", "kind": "subagent"}],
             "projects": [{"id": name, "name": name} for name in projects[:2]], "warnings": [],
             "observed_at": now.isoformat(), "refresh_seconds": 5, "capabilities": {"can_edit": False}}
    payload = {"rows": records, "analysis_rows": records, "explorer": explorer, "total": total,
               "start": (now.date() - timedelta(days=29)).isoformat(), "end": now.date().isoformat(),
               "generated_at": now.isoformat(timespec="seconds"), "pricing_as_of": "synthetic-fixture-not-a-bill",
               "pricing_source": "", "agent_graph": graph, "overview": {}}
    return {"html": render_dashboard(payload, static_cost_chart(records)), "graph": graph, "total": total}


if __name__ == "__main__":
    print(json.dumps(fixture(), ensure_ascii=False))
