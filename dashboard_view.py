"""Inline the dashboard assets into a portable, prepopulated HTML snapshot."""

import html
import json
from pathlib import Path


ASSETS = Path(__file__).resolve().parent / "dashboard"


def render_dashboard(payload, static_chart):
    total = payload["total"]
    esc = lambda value: html.escape(str(value), quote=True)

    def cost(row):
        if row.get("calls") and not row.get("known_price_calls"):
            return "未计价"
        return f"${row.get('estimated_cost_usd', 0):,.2f}"

    def compact(value):
        return f"{value / 100_000_000:,.2f}亿" if value >= 100_000_000 else (f"{value / 10_000:,.2f}万" if value >= 10_000 else f"{value:,}")

    rows = "".join(
        f"<tr><td>{esc(row['day'])}</td><td>{esc(row['project'])}</td>"
        f"<td>{esc(row['model'])}</td><td>{row['calls']:,}</td>"
        f"<td>{compact(row['total_tokens'])}</td><td>{cost(row)}</td></tr>"
        for row in payload["rows"][:50]
    )
    coverage = total.get("known_price_tokens", 0) / total["total_tokens"] if total["total_tokens"] else 0
    values = {
        "SIDEBAR": (ASSETS / "sidebar.html").read_text(encoding="utf-8"),
        "STYLE": "\n".join((ASSETS / name).read_text(encoding="utf-8") for name in ("theme.css", "dashboard.css", "sidebar.css", "agent-canvas.css", "agent-office-3d.css")),
        "SCRIPT": "\n".join((ASSETS / name).read_text(encoding="utf-8") for name in ("i18n.js", "sidebar.js", "dashboard.js", "vendor/three.bundle.js", "agent-office-3d.js", "agent-canvas.js")),
        "DATA": json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"),
        "SPEND": cost(total),
        "TOKENS": compact(total["total_tokens"]),
        "CALLS": f"{total['calls']:,}",
        "CACHE": f"{total.get('token_cache_hit_rate', 0):.1%}",
        "COVERAGE": f"{coverage:.1%}",
        "RANGE": esc(f"{payload['start']} — {payload['end']}"),
        "GENERATED": esc(payload["generated_at"][:19].replace("T", " ")),
        "CHART": '<div class="empty">当前用量尚未计价，Token 仍完整统计。</div>' if total["calls"] and not total["known_price_calls"] else static_chart,
        "ROWS": rows,
    }
    template = (ASSETS / "dashboard.html").read_text(encoding="utf-8")
    # Replace only template markers, never interpret markers embedded in user metadata.
    import re
    return re.sub(r"@@([A-Z]+)@@", lambda match: values[match[1]], template)
