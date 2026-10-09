# Codex Office

> Watch your agents work. Know what the work costs.

[中文](README.md) · English · [User guide](docs/usage.en.md) · [MIT](LICENSE)

Your agents are already busy. Give them an office you can actually see.

**Codex Office** is a local-first workspace for observing Codex activity: an interactive 3D office for main agents, subagents, and chat delegation, paired with a dashboard for tokens, cache hits, and API-equivalent cost estimates. Go from “who is doing what?” to “where did the tokens go?” in one browser window.

No API key, no sign-in, and no model calls just to display your records. Python's standard library handles indexing and the local service; Three.js puts your AI coworkers at their desks.

![Codex Office virtual office with fictional projects and agents](docs/images/office.en.png)

*All previews use fictional demo data, not real chats, projects, or bills. Character motion illustrates recorded status; it is not a screen recording.*

## Why an office?

When several projects run in parallel, terminals and chat lists make three questions surprisingly hard to answer:

- **Who is still working?** Which main agent has recent activity, which branch is waiting, and which turn has ended?
- **Who belongs together?** Which agents are native in-chat subagents, and which links represent delegation to another independent chat?
- **Where did the usage go?** Which projects, models, and time periods used the most tokens, and how much input hit the cache?

Codex Office brings those views together. It observes and explains local records; it does not take over your agents or invent outcomes.

## Two perspectives, one workspace

### The office: see the collaboration

- **Casual office:** desks, meeting areas, a coffee bar, sofas, plants, and a table-tennis corner. Working characters type, review their screens, and use a mouse, with visible glow and task bubbles.
- **Single cells:** the same agents in a darker, mildly dystopian setting. The theme changes appearance, not identity, permissions, or relationships.
- **Organization graph:** a clearer structural view, and a fallback when WebGL2 is unavailable.
- Multiple projects on one canvas, expanded branches by default, status/search filters, locate-working navigation, hover details, relationship highlighting, and focus mode.
- Separate visual links for native main-agent → subagent relationships and business delegation between independent chats. Edit business hierarchy locally with cycle validation.
- The service observes records approximately every 5 seconds by default. Paused, disconnected, stale, and offline observations stop active effects. System reduced-motion preferences are respected.

### The dashboard: see the investment

![Codex Office usage overview with fictional data](docs/images/overview.en.png)

| Page | What it helps you answer |
| --- | --- |
| Overview | How many tokens and continuations were recorded, at what API-equivalent cost and cache-hit rate? |
| Agent canvas | What is the current organization, who has recent work records, and what usage belongs to each node in the selected range? |
| Projects | Which projects account for the most usage, and which dates and models contribute? |
| Models | How do usage, pricing coverage, and main-agent / subagent activity differ by model? |
| Explore | What changes when you group by time, working directory, role, reasoning effort, or other metadata? |
| Data & methodology | What is unpriced, how are metrics calculated, and what are the limits? |

Date, project, and model filters apply globally, including the headline cost estimate. Daily trends switch between cost, tokens, and continuations; hover or keyboard focus reveals exact values, and clicking a date opens its breakdown. Explore offers 17 dimensions, presets, charts, paginated tables, and a weekday × hour heatmap.

## Quick start

### Requirements

- **Python 3.10+**, with IANA timezone data available.
- A modern browser; **WebGL2** enables the 3D scenes. Use the graph otherwise.
- Existing local Codex records on this computer. Without records, there is no real usage to display.

Node.js, npm, API keys, and a database service are not needed to run the app. Local validation has been performed on macOS. Other systems can use the Python commands, but their Codex record format and browser compatibility still need checking.

Clone the repository and start the workspace:

To get started, send [this repository link](https://github.com/kjwlegend/codex-office) to your Codex Agent and ask it to install and launch the app.

```bash
git clone https://github.com/kjwlegend/codex-office.git
cd codex-office
cp config.example.json config.json
python3 codex_usage.py serve --port 8766
```

**Copy the configuration only on first setup; do not overwrite an existing `config.json`.** The example timezone is `Asia/Shanghai`; change it to your desired reporting timezone before indexing.

Open [the local workspace](http://127.0.0.1:8766/codex-usage-report.html). Every `serve` launch incrementally scans usage and generates a report for the latest 30 days before starting the service; no separate scheduled job is needed for startup updates. The service binds only to `127.0.0.1`. Keep the terminal open and stop it with `Ctrl+C`. The first run scans available historical records and may take a while.

On macOS, after configuring the app, you can also double-click:

- `run-workspace.command`: update usage, start the service, and open the Agent canvas.
- `run-dashboard.command`: update usage and open the offline dashboard.

Double-click behavior depends on file permissions and local security settings. Terminal commands remain the general entry point.

### Your first visit

1. Switch language with **EN / 中** in the navigation rail, then choose a date range.
2. Check total cost, tokens, and pricing coverage. Investigate unpriced usage in Data & methodology.
3. Visit the Agent canvas and use Locate working to find agents with recent work records.
4. Select an employee to inspect the main task, model, native ownership, and business relationships, or open the original chat.
5. Check project rankings and use Explore to understand the distribution from another angle.

See the [English user guide](docs/usage.en.md) / [中文使用指南](docs/usage.zh-CN.md) for controls, configuration, commands, and troubleshooting.

## Updating the data

**Agent observation and token accounting refresh separately.**

- The local service periodically observes agent records.
- `serve` updates the token and cost snapshot at startup. While the service is running, reloading the browser reads the file without re-indexing usage.

Each launch updates the latest 30 days by default; use `serve --days 7` to change the default report range. To use an existing report and skip the startup update:

```bash
python3 codex_usage.py serve --port 8766 --no-refresh
```

If the update fails, the previous report is retained, an error is shown, and this launch stops. Running the default start command while the service is already running also updates the report and reuses that service; reload the page to see the new snapshot.

To update usage while the service keeps running, run this in another terminal:

```bash
python3 codex_usage.py dashboard --days 30
```

Then reload the page. A snapshot includes records already written locally when the command runs; it does not deliberately stop at the previous midnight. Dates use the configured reporting timezone. Today is relative to the snapshot generation date, so regenerate old snapshots after the date changes.

To apply interface or pricing changes without scanning new usage:

```bash
python3 codex_usage.py dashboard --days 30 --no-scan
```

For daily updates while the service keeps running, you can optionally schedule the regular update command with your own Codex automation or local scheduler. This repository does not install a scheduled job automatically, and observation does not run a model on your behalf.

## English and Chinese

Switch instantly between Chinese and English, including in offline HTML. The preference is stored locally and carried in the URL fragment as `lang=zh-CN` / `lang=en`. Dates, project/model filters, routing, and selected agents are preserved.

Only interface copy is translated. Project names, chat titles, task excerpts, and model identifiers keep their original text; no translation service is contacted. English compact numbers use K / M / B, while Chinese uses 万 / 亿.

## What the numbers and motion mean

- **Continuations are not an API request count.** They are positive increments in local cumulative-token records, including model execution after tools. Repeated snapshots and recognized fork-inherited baselines are not counted again.
- **Cache hits are not local cache files.** The app measures recorded `cached_input_tokens`, meaning server-side cache-read tokens, and reports both input-token hit share and the proportion of continuations with a hit.
- **API-equivalent cost is not your subscription bill.** It uses the Standard API price snapshot in local `pricing.json`, in USD. Reasoning tokens are already part of output and are not charged twice. Long-context tiers use actual request input, not window capacity.
- **Unpriced does not mean unused.** Tokens without a matching price still count. Their cost is marked unpriced or partially unpriced rather than guessed. Prices are maintained manually, not fetched automatically; consult [official OpenAI API Pricing](https://developers.openai.com/api/docs/pricing) for sources and current rates.
- **Observation is not runtime confirmation.** Recent unfinished turns can appear working. Records older than 5 minutes, missing observations, or clock discrepancies become unconfirmed. An ended turn does not prove business completion, acceptance, or a code merge.
- **This is neither an agent controller nor a historical replay.** It does not send tasks, start/stop agents, reveal private reasoning, or invent completion percentages. Date filters change node usage, not the current observed organization.

## Local-first and private by design

The default sources are `~/.codex/sessions`, `~/.codex/archived_sessions`, and available local chat/turn databases. `CODEX_HOME` and `--codex-home` are supported. Original Codex databases are always read-only; the app does not rely on an official runtime subscription.

| Local file | Purpose | Safe to publish? |
| --- | --- | --- |
| `config.json` | Personal timezone, grouping, and path aliases | No |
| `.codex-usage/usage.sqlite3` | Incremental usage index and metadata | No |
| `.codex-usage/agent-graph.sqlite3` | Workspace-only business hierarchy; created when saved | No |
| `codex-usage-report.html` | Offline snapshot with personal metadata | No |
| `docs/images/` | Included fictional demo previews | Yes |

The usage index and offline report do not include full conversation bodies. Live observation can expose a best-effort-redacted current-request excerpt of up to 140 characters in memory; it is not persisted in the usage index or offline snapshot. Paths, chat titles, IDs, and usage remain potentially sensitive. Do not publish personal reports, captures, or API responses.

This is an unauthenticated, single-user local service. Host/Origin checks and a local edit token are not a complete multi-user security model. **Do not expose it directly to the public internet or share it with untrusted users.** `.gitignore` excludes local data, configuration, reports, and development artifacts, but always review the actual files before publishing.

## Development and contributions

The core uses Python's standard library and plain HTML / CSS / JavaScript. Pinned Three.js and OrbitControls are bundled locally and inlined; the generated HTML needs no CDN, external fonts, or downloaded 3D models.

```text
codex_usage.py          Usage indexing, deduplication, aggregation, pricing
agent_graph.py          Native ownership, business links, passive observation
workspace_server.py    Loopback-only HTTP service
dashboard_view.py      Inline interface and safe metadata into one HTML file
dashboard/             Six pages, language catalog, navigation, 3D scenes
tests/                 Synthetic unit/browser checks and demo preview tooling
docs/                  Bilingual user guides and public demo images
```

Run unit tests without accessing real account records:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

See [test instructions](tests/README.md) for browser checks and preview generation, and [vendor instructions](dashboard/vendor/README.md) for rebuilding Three.js. Edit source assets and regenerate HTML; do not maintain changes only in a generated report that the next update will overwrite.

Contributions to usability, accessibility, localization, record compatibility, and accounting are welcome. Include OS, Python/browser/Codex versions, redacted reproduction steps, or synthetic examples. Never attach real databases, full chats, or API keys. Behavioral changes should include tests and update both language versions of the documentation.

## Current limits and plans

Project grouping currently uses path aliases, Git roots, and a working-directory fallback; it is not authoritative Codex project membership. No Git repository does not mean no project, and an independent chat is not a subagent.

An **Unassigned workspace**, with separate unassigned and unconfirmed membership, is being designed but is **not implemented**. The app does not cover remote/cloud activity absent from local records and is not an account-wide ChatGPT usage platform. Internal Codex record formats may change, leaving some relationships or statuses unconfirmed. CSV export is not provided.

## License and affiliation

[MIT License](LICENSE). Three.js retains its [upstream MIT license](dashboard/vendor/three-LICENSE.txt).

Codex Office is an independent community project, not an official OpenAI product or an endorsed integration. Codex, OpenAI, and other names belong to their respective owners.
