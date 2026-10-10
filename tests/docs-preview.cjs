// Generate public README previews from fictional data, never a local account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-m', 'tests.render_docs_fixture'], {
  cwd: root, maxBuffer: 32 * 1024 * 1024, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'},
}));
const images = path.join(root, 'docs', 'images');
const officeOnly = process.argv.includes('--office-only');
const errors = [], external = [], captures = [];
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {res.statusCode = 405; res.end(); return;}
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/agents') {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture.graph));
  } else if (url.pathname === '/codex-usage-report.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture.html);
  } else if (url.pathname === '/favicon.ico') {res.statusCode = 204; res.end();}
  else {res.statusCode = 404; res.end();}
});

(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const channel = process.env.CODEX_TEST_BROWSER_CHANNEL || 'chrome';
    browser = await chromium.launch({channel: channel === 'chromium' ? undefined : channel, headless: true});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text());
    });
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.push(request.url());
    });
    fs.mkdirSync(images, {recursive: true});
    for (const locale of ['zh-CN', 'en']) {
      await page.goto(origin + '/codex-usage-report.html#page=overview&lang=' + locale);
      await page.waitForFunction(() => window.CodexI18n && document.getElementById('overallTokens').textContent !== '');
      assert.equal(await page.locator('html').getAttribute('lang'), locale);
      assert.equal(await page.locator('#overallCalls').textContent(), fixture.total.calls.toLocaleString(locale));
      if (!officeOnly) {
        const overview = path.join(images, 'overview.' + locale + '.png');
        await page.screenshot({path: overview, fullPage: true, animations: 'disabled'});
        captures.push(path.relative(root, overview));
      }

      await page.locator('#app-sidebar [data-page="agents"]').click();
      await page.locator('[data-agent-scene="office"]').click();
      await page.waitForFunction(count => {
        const scene = window.CodexAgentOffice?.debug();
        return scene?.ready === 'true' && scene.actors.length === count;
      }, fixture.graph.nodes.length);
      await page.waitForFunction(() => window.CodexAgentOffice.debug().actors.some(a => a.motion === 'typing'));
      await page.mouse.move(1, 1);
      const office = path.join(images, 'office.' + locale + '.png');
      await page.screenshot({path: office, fullPage: true, animations: 'disabled'});
      captures.push(path.relative(root, office));
    }
    assert.deepEqual(external, [], 'Public demos must not contact external services');
    assert.deepEqual(errors, [], 'Demo pages must have no JavaScript/shader errors');
    console.log(JSON.stringify({captures, fictionalAgents: fixture.graph.nodes.length, externalRequests: external.length}, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
