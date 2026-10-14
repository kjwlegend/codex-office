# Tests

Public documentation links, bilingual command parity, and CLI argument examples can be checked without scanning local account data or installing Playwright:

```bash
node tests/docs-check.cjs
```

Python unit tests use temporary synthetic records, not your real Codex data:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

For portable bilingual browser tests, install Playwright in a temporary development directory or use an existing installation. Set `NODE_PATH` to that installation's `node_modules` directory if it is not locally resolvable. The runner uses installed Google Chrome by default; set `CODEX_TEST_BROWSER_CHANNEL` to `chromium` to use Playwright's installed Chromium.

```bash
node tests/i18n.browser.cjs
```

This suite starts a temporary loopback server with synthetic usage and agent records, exercises English/Chinese, filters, all six pages, 3D scenes, mobile layout, offline HTML, and storage fallback, then closes the server. It does not read, scan, or modify your Codex account records.

Character and relationship quality has a separate fictional-data browser check:

```bash
node tests/office-quality.browser.cjs
```

It captures the office, close-up employees, and dark cells in ignored `work/`; checks the Blender GLB skeleton, high-DPI/contact-shadow rendering, curved routes, actual zoom direction, animated wrists, reduced motion, offline states, quality switching, and bounded GPU resource reuse. Full character geometry reappears based on projected size when zooming in, even in a crowded workspace. The Python suite also checks that the GLB is self-contained, skin/UV attributes exist, both LODs are shipped, and geometry validation stays within budget. See [asset authoring](../assets/blender/README.md) for rebuilding the editable Blender source. The legacy `CODEX_VISUAL_BASELINE=1` mode substitutes only the committed renderer in memory and is not a complete old-render-pipeline benchmark.

`agent-canvas.browser.cjs` is an optional local integration suite. It uses an existing local service (`CODEX_WORKBENCH_URL`, default `http://127.0.0.1:8766/codex-usage-report.html`) for read-only accounting checks. Graph-edit tests are isolated with a synthetic API fixture. Live-data checks need a populated local snapshot and suitable recent sessions; do not mistake their historical preconditions for a clean-clone requirement. Captures are stored in ignored `work/`.

`dashboard.browser.js` is a legacy browser-tool callback for optional local smoke checks, not the portable runner. Never commit generated reports, local database files, screenshots, or captured personal metadata.

## Five-round canvas acceptance

```bash
node tests/canvas-iterations.browser.cjs
```

This fictional-data runner checks camera presets and refresh stability, adaptive task labels and keyboard inspection, relationship visibility, workspace navigation, crowded-scene adaptive quality and 320/390/768px layouts in both office and prison scenes. Pass `1` through `5` to run a cumulative subset. It rejects external requests and runtime errors, writes only screenshots to ignored `work/`, and never reads or modifies account records. Camera and display preferences are isolated in a fresh browser context.

The second five refinement rounds have an additional cumulative runner:

```bash
node tests/canvas-refinement.browser.cjs
```

It checks compact large-team layouts, view-history navigation, searchable/attention-filtered employee lists, panel-safe task captions, keyboard relationship tracing and bilingual controls at 320/390/768px. Pass `6` through `10` for a cumulative subset. All projects and employees are fictional, and screenshots stay in ignored `work/`.

## Public README previews

The screenshots in `docs/images/` use fictional Coffee Shop and Orbit Notes projects, invented agents, and synthetic usage counters. They contain no local account records. Regenerate all four English/Chinese overview/office captures with the same Playwright/browser setup:

```bash
node tests/docs-preview.cjs
```

Use `node tests/docs-preview.cjs --office-only` to refresh just the two office previews after a character/scene change, keeping overview images unchanged.

`render_docs_fixture.py` constructs the fixture in memory and never reads Codex databases, personal configuration, or price files. The runner serves it on a temporary loopback port, checks rendered totals and animated 3D actors, rejects external requests and JavaScript/shader errors, and closes the browser/server afterward. It only writes the intentional public demo images in `docs/images/`; it does not generate or overwrite your personal report.

For a development-only Playwright setup, install in a separate directory and set `NODE_PATH` to its `node_modules`, for example:

```bash
codex_office_test_tools="$(mktemp -d)"
npm install --prefix "$codex_office_test_tools" --no-save playwright
NODE_PATH="$codex_office_test_tools/node_modules" node tests/i18n.browser.cjs
NODE_PATH="$codex_office_test_tools/node_modules" node tests/docs-preview.cjs
```

These examples reuse installed Google Chrome. If Chrome is unavailable, install a Playwright Chromium browser with that installation's CLI and use `CODEX_TEST_BROWSER_CHANNEL=chromium`. Development dependencies are not application runtime requirements.

## Cow and horse coworkers

```bash
node tests/office-animals.browser.cjs
```

This focused fictional-data check covers mixed human/cow/horse desks, both animal wrist animations and selection, actual geometry LOD changes, stable agent identity after refresh/reordering and scene changes, reduced motion, 390px layout, portable offline HTML, and isolated cow-model failure with human fallback. It rejects page/WebGL errors and external requests. The Python asset test checks all three embedded models, including exact exported triangle counts against the build reports. Screenshots remain in ignored `work/`.

## Dense office rendering

```bash
node tests/office-performance.browser.cjs
```

A 300-employee fictional fixture checks batched distant desks, a bounded drawing budget, idle rendering, actual canvas picking, project signs, full close-up recovery, offscreen culling, stable selection after refresh, reduced motion and 390px layouts in both office themes. All employee identities remain available in the navigator. It rejects browser/WebGL errors and external requests. Captures and renderer counters remain in ignored `work/`.

Before changing the renderer, optionally run `CODEX_VISUAL_BASELINE=1 node tests/office-performance.browser.cjs` to capture the committed renderer and CSS without overwriting source. The normal run reports the comparison when that local baseline exists; counters measure drawing cost, not a guaranteed browser frame rate.

## Workspace updates

```bash
node tests/workspace-updates.browser.cjs
```

The fictional-data test checks real calendar dates with an older snapshot, browser-triggered usage refresh and preserved filters, viewed/snoozed attention records, avatar and project preferences across reload/themes, and Space-drag panning in all scenes without accidental selection or input interference. It also checks 390px layout. Backend tests cover a single asynchronous refresh job, request guards, custom source paths and report retention on failure.

## Compact report layout

```bash
node tests/report-layout.browser.cjs
```

Fictional records verify that saved custom dates keep the editor closed, first data appears near the top at 1440/850/390/320px, both filter popovers fit every page in Chinese/English, and project/model/date filtering preserves totals and state across reloads. Captures and before/after measurements stay in ignored `work/`.

## Sidebar repository and release comparison

```bash
node tests/sidebar-release.browser.cjs
```

Fictional reports and mocked release responses cover the repository link, v0.3.1, on-demand loading, newer/same/older/unknown releases, no release, rate limits and failures, keyboard/outside dismissal, both languages across all six pages at 320–1440px, and offline snapshots. Python tests check SemVer precedence, the fixed public GitHub request, cached concurrent checks and the local API. No test contacts GitHub or reads account records; captures stay in ignored `work/`.
