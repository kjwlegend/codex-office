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

`agent-canvas.browser.cjs` is an optional local integration suite. It uses an existing local service (`CODEX_WORKBENCH_URL`, default `http://127.0.0.1:8766/codex-usage-report.html`) for read-only accounting checks. Graph-edit tests are isolated with a synthetic API fixture. Live-data checks need a populated local snapshot and suitable recent sessions; do not mistake their historical preconditions for a clean-clone requirement. Captures are stored in ignored `work/`.

`dashboard.browser.js` is a legacy browser-tool callback for optional local smoke checks, not the portable runner. Never commit generated reports, local database files, screenshots, or captured personal metadata.

## Public README previews

The screenshots in `docs/images/` use fictional Coffee Shop and Orbit Notes projects, invented agents, and synthetic usage counters. They contain no local account records. Regenerate all four English/Chinese overview/office captures with the same Playwright/browser setup:

```bash
node tests/docs-preview.cjs
```

`render_docs_fixture.py` constructs the fixture in memory and never reads Codex databases, personal configuration, or price files. The runner serves it on a temporary loopback port, checks rendered totals and animated 3D actors, rejects external requests and JavaScript/shader errors, and closes the browser/server afterward. It only writes the intentional public demo images in `docs/images/`; it does not generate or overwrite your personal report.

For a development-only Playwright setup, install in a separate directory and set `NODE_PATH` to its `node_modules`, for example:

```bash
codex_office_test_tools="$(mktemp -d)"
npm install --prefix "$codex_office_test_tools" --no-save playwright
NODE_PATH="$codex_office_test_tools/node_modules" node tests/i18n.browser.cjs
NODE_PATH="$codex_office_test_tools/node_modules" node tests/docs-preview.cjs
```

These examples reuse installed Google Chrome. If Chrome is unavailable, install a Playwright Chromium browser with that installation's CLI and use `CODEX_TEST_BROWSER_CHANNEL=chromium`. Development dependencies are not application runtime requirements.
