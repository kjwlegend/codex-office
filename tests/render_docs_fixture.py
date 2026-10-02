"""Public README demo. All projects, agents and counters are fictional.

This module never opens Codex records, configuration, price files or databases.
It emits an in-memory HTML/API fixture for docs-preview.cjs, not a real report.
"""

import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from agent_graph import STATUS_LABELS
from codex_usage import PriceBook, empty_aggregate, finalize_aggregate, static_cost_chart
from dashboard_view import render_dashboard


def fixture():
    now = datetime.now(ZoneInfo("Asia/Bangkok"))
    projects = {"Coffee Shop": "/demo/coffee-shop", "Orbit Notes": "/demo/orbit-notes"}
    specs = [
        ("demo-cafe-main", "Coffee Shop", "Build the café website", "session", None, None,
         "working", "Milo", "Coordinate the café launch and review the active branches."),
        ("demo-cafe-ui", "Coffee Shop", "Design the menu page", "subagent", "demo-cafe-main", None,
         "working", "Ada", "Refine the menu layout and mobile navigation."),
        ("demo-cafe-tests", "Coffee Shop", "Check the ordering flow", "subagent", "demo-cafe-main", None,
         "waiting_agents", "Noah", "Wait for the accessibility review before the next test pass."),
        ("demo-cafe-access", "Coffee Shop", "Review keyboard access", "subagent", "demo-cafe-tests", None,
         "waiting_user", "Lina", "Confirm the preferred focus style for the ordering buttons."),
        ("demo-cafe-launch", "Coffee Shop", "Prepare the launch plan", "session", None, "demo-cafe-main",
         "idle", "Jun", "The latest planning turn has ended; launch acceptance is still separate."),
        ("demo-cafe-copy", "Coffee Shop", "Write the welcome copy", "subagent", "demo-cafe-launch", None,
         "working", "Remy", "Polish the welcome message and café story."),
        ("demo-orbit-main", "Orbit Notes", "Organize the notes workspace", "session", None, None,
         "working", "Iris", "Create a clearer outline for the notes workspace."),
        ("demo-orbit-index", "Orbit Notes", "Review the note index", "subagent", "demo-orbit-main", None,
         "idle", "Theo", "The index review turn has ended; final acceptance is not implied."),
    ]
    by_spec = {spec[0]: spec for spec in specs}
    nodes = []
    for index, (identity, project, title, kind, parent, business, status, name, task) in enumerate(specs):
        owner = identity
        while by_spec[owner][3] == "subagent":
            owner = by_spec[owner][4]
        nodes.append({
            "id": identity, "usage_key": identity, "project": project, "project_id": projects[project],
            "kind": kind, "parent_agent_id": parent, "owner_session_id": owner,
            "business_parent_id": business, "created_by": business,
            "title": title, "task_summary": task, "task_source": "session_title",
            "status": status, "status_label": STATUS_LABELS[status],
            "status_reason": "最新回合记录；本轮结束不等于整个项目完成",
            "current_activity": {"working": "修改项目文件", "waiting_agents": "等待其他代理返回",
                                 "waiting_user": "等待用户回应", "idle": "整理工作结果"}[status],
            "model": "gpt-6.1-sol", "reasoning_effort": "high", "agent_name": name,
            "agent_role": "default" if kind == "session" else "worker", "cwd": projects[project],
            "archived": False, "created_at": now.timestamp() - 35 * 86400 + index * 60,
            "last_activity_at": now.timestamp(), "hierarchy_mode": "automatic",
            "direct_subagent_count": sum(spec[4] == identity for spec in specs),
        })
    edges = [{"source": n["parent_agent_id"], "target": n["id"], "kind": "subagent", "provenance": "native_spawn"}
             for n in nodes if n["parent_agent_id"]]
    edges += [{"source": n["business_parent_id"], "target": n["id"], "kind": "delegation", "provenance": "created_default"}
              for n in nodes if n["business_parent_id"]]
    graph = {"version": 1, "observation_mode": "local_records", "nodes": nodes, "edges": edges,
             "projects": [{"id": path, "name": name} for name, path in projects.items()],
             "warnings": [], "observed_at": now.isoformat(), "refresh_seconds": 5,
             "capabilities": {"can_edit": False}}

    dimensions = ["day", "project", "project_path", "model", "session", "hour", "workspace",
                  "agent_type", "agent_nickname", "source_surface", "originator", "reasoning_effort",
                  "cli_version", "model_provider", "context_window"]
    numeric = ["calls", "cache_hit_calls", "input_tokens", "uncached_input_tokens", "cached_input_tokens",
               "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens",
               "estimated_cost_usd", "cache_savings_usd", "cache_opportunity_usd", "known_price_calls",
               "unknown_price_calls", "known_price_tokens", "unknown_price_tokens"]
    # Illustrative local price snapshot only; never fetch or claim live rates.
    prices = PriceBook({"models": {"gpt-6.1-sol": {"short": {
        "input": 2, "cached_input": 0.1, "cache_write": 2.5, "output": 10,
    }}}})
    records, daily = [], {}
    total = empty_aggregate()
    for offset in range(30):
        day = (now.date() - timedelta(days=offset)).isoformat()
        daily[day] = empty_aggregate(day)
        for index, n in enumerate(nodes):
            calls = 2 + (offset + index) % 4
            input_tokens = 10000 * calls * (1 + (offset * 3 + index) % 5)
            cached = input_tokens * 82 // 100
            output = 2000 * calls
            row = empty_aggregate(day, n["project"], n["project_id"], n["model"])
            row.update(calls=calls, cache_hit_calls=calls - 1, input_tokens=input_tokens,
                       cached_input_tokens=cached, uncached_input_tokens=input_tokens - cached,
                       output_tokens=output, reasoning_output_tokens=output // 4,
                       total_tokens=input_tokens + output, known_price_calls=calls,
                       known_price_tokens=input_tokens + output)
            price = prices.cost(row)
            row.update(estimated_cost_usd=price["cost"], cache_savings_usd=price["savings"],
                       cache_opportunity_usd=price["potential_additional_savings"],
                       session=index, hour=(offset * 3 + index) % 24, workspace=n["project_id"],
                       agent_type="main" if n["kind"] == "session" else "subagent",
                       agent_nickname="" if n["kind"] == "session" else n["agent_name"],
                       source_surface="demo", originator="fictional-preview", reasoning_effort="high",
                       cli_version="demo-fixture", model_provider="openai", context_window=100000)
            records.append(finalize_aggregate(row))
            for key in numeric:
                total[key] += row[key]
                daily[day][key] += row[key]
    finalize_aggregate(total)
    dictionaries = {key: list(dict.fromkeys(row[key] for row in records)) for key in dimensions}
    explorer = {"dimensions": dimensions, "numeric": numeric, "dictionaries": dictionaries,
                "rows": [[dictionaries[key].index(row[key]) for key in dimensions] + [row[key] for key in numeric] for row in records],
                "session_keys": [n["usage_key"] for n in nodes]}
    payload = {"rows": records, "analysis_rows": records, "explorer": explorer, "total": total,
               "start": (now.date() - timedelta(days=29)).isoformat(), "end": now.date().isoformat(),
               "generated_at": now.isoformat(timespec="seconds"), "pricing_as_of": "Demo price snapshot",
               "pricing_source": "", "agent_graph": graph, "overview": {}}
    chart = static_cost_chart([finalize_aggregate(daily[day]) for day in sorted(daily)])
    return {"html": render_dashboard(payload, chart), "graph": graph, "total": total}


if __name__ == "__main__":
    print(json.dumps(fixture(), ensure_ascii=False))
