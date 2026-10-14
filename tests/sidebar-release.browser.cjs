// Public release states with fictional usage; this suite never contacts GitHub.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const {execFileSync} = require('node:child_process'), {chromium} = require('playwright');
const root = path.resolve(__dirname, '..'), repository = 'https://github.com/kjwlegend/codex-office';
const fixture = JSON.parse(execFileSync('python3', ['-m', 'tests.render_docs_fixture'], {
  cwd: root, maxBuffer: 32e6, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}
}));
const currentVersion=JSON.parse(fixture.html.match(/<script id="app-release-data" type="application\/json">(.*?)<\/script>/)[1]).current_version;
let result = {status: 'no_release'}, responseCode = 200, releaseRequests = 0, hold = false, held;
const errors = [], external = [], passed = [];
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url.startsWith('/api/release')) {
    releaseRequests++; res.statusCode = responseCode; res.setHeader('Content-Type', 'application/json');
    if (hold) held = res;
    else res.end(JSON.stringify({...result, checked_at: new Date().toISOString()}));
  } else if (req.url === '/api/agents') {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture.graph));
  } else if (req.url.startsWith('/api/')) { res.statusCode = 404; res.end('{}'); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(fixture.html); }
});
(async () => {
  let browser, page, directory;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port, url = origin + '/codex-usage-report.html';
    browser = await chromium.launch({channel: process.env.CODEX_TEST_BROWSER_CHANNEL === 'chromium' ? undefined : process.env.CODEX_TEST_BROWSER_CHANNEL || 'chrome', headless: true});
    page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const observe = target => {
      target.on('pageerror', error => errors.push(error.message));
      target.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.push(request.url()); });
    };
    observe(page);
    const status = () => page.locator('#release-panel').getAttribute('data-status');
    const waitStatus = expected => page.waitForFunction(expected => document.getElementById('release-panel').dataset.status === expected, expected);
    await page.goto(url + '#page=overview&lang=en');
    await page.getByRole('heading', {name: 'Usage overview', exact: true}).waitFor();
    const tokens = await page.locator('#overallTokens').textContent(), originalHash = await page.evaluate(() => location.hash);
    const repo = page.getByRole('link', {name: 'Open GitHub repository', exact: true});
    assert.equal(await repo.getAttribute('href'), repository);
    assert.equal(await repo.getAttribute('target'), '_blank');
    assert.match(await repo.getAttribute('rel'), /noopener/);
    assert((await page.locator('#release-toggle').textContent()).includes(currentVersion));
    assert.equal(releaseRequests, 0, 'Normal reporting never checks GitHub');
    passed.push('Repository link and local version are available without network checks');

    hold = true;
    await page.locator('#release-toggle').click();
    await waitStatus('loading');
    assert(await page.getByRole('button', {name: 'Checking…', exact: true}).isDisabled());
    await page.waitForFunction(() => document.getElementById('release-toggle').getAttribute('aria-expanded') === 'true');
    assert.equal(releaseRequests, 1);
    hold = false;
    held.end(JSON.stringify({status: 'update_available', latest_version: 'v0.4.0', release_url: repository + '/releases/tag/v0.4.0', checked_at: new Date().toISOString()}));
    await waitStatus('update_available');
    assert.equal(await page.locator('#release-status').textContent(), 'A new version is available');
    assert.equal(await page.locator('#release-current').textContent(), currentVersion);
    assert.equal(await page.locator('#release-latest').textContent(), 'v0.4.0');
    assert(await page.locator('.release-update-dot').isVisible());
    assert.equal(await page.locator('#release-link').getAttribute('href'), repository + '/releases/tag/v0.4.0');
    passed.push('Opening the version panel checks once and shows loading and an update');

    for (const [value, message, latest] of [
      [{status: 'up_to_date', latest_version: currentVersion}, 'You are up to date', currentVersion],
      [{status: 'local_ahead', latest_version: 'v0.2.9'}, 'Your version is newer than the latest release', 'v0.2.9'],
      [{status: 'uncomparable', latest_version: 'daily', release_url: 'https://example.com/untrusted'}, 'This release tag cannot be compared automatically', 'daily'],
      [{status: 'no_release'}, 'No release published yet', '—'],
      [{status: 'error', reason: 'rate_limit'}, 'GitHub checks are temporarily limited. Try again later.', '—'],
    ]) {
      result = value;
      await page.getByRole('button', {name: 'Check for updates', exact: true}).click();
      await waitStatus(value.status);
      assert.equal(await page.locator('#release-status').textContent(), message);
      assert.equal(await page.locator('#release-latest').textContent(), latest);
      assert.equal(await page.locator('.release-update-dot').isVisible(), false);
      assert.equal(await page.locator('#release-link').getAttribute('href'), repository + '/releases');
    }
    responseCode = 503;
    await page.getByRole('button', {name: 'Check for updates', exact: true}).click();
    await page.waitForFunction(() => document.getElementById('release-status').textContent === 'Could not reach GitHub. Try again later.');
    assert.equal(await page.locator('#release-latest').textContent(), '—');
    responseCode = 404;
    await page.getByRole('button', {name: 'Check for updates', exact: true}).click(); await waitStatus('unavailable');
    assert.equal(await page.locator('#release-status').textContent(), 'Restart the workbench to check for updates');
    responseCode = 200; result = {status: 'no_release'};
    await page.getByRole('button', {name: 'Check for updates', exact: true}).click(); await waitStatus('no_release');
    assert.equal(await page.locator('#overallTokens').textContent(), tokens);
    assert.equal(await page.evaluate(() => location.hash), originalHash);
    passed.push('Same, older, unknown, absent, rate-limited and failed releases preserve report data');

    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#release-panel').isVisible(), false);
    assert.equal(await page.locator('#release-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'release-toggle');
    await page.locator('#release-toggle').click(); await page.locator('#page-title').click();
    assert.equal(await page.locator('#release-panel').isVisible(), false);
    const before = releaseRequests;
    await page.locator('#release-toggle').click();
    assert.equal(releaseRequests, before, 'Opening a checked panel reuses its result');
    passed.push('Escape restores keyboard focus and outside clicks close the panel');

    for (const width of [1440, 850, 680, 390, 320]) {
      await page.setViewportSize({width, height: 1000});
      for (const locale of ['en', 'zh-CN']) {
        await page.evaluate(locale => window.CodexI18n.setLocale(locale), locale);
        for (const name of ['overview', 'agents', 'projects', 'models', 'explore', 'methods']) {
          await page.locator('#app-sidebar [data-page="' + name + '"]').click();
          for (const id of ['repository-link', 'release-toggle', 'locale-switch']) {
            const bounds = await page.locator('#' + id).boundingBox();
            assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, JSON.stringify({id, width, locale, bounds}));
          }
          await page.locator('#release-toggle').click();
          const bounds = await page.getByRole('dialog', {name: locale === 'en' ? 'Version & updates' : '版本与更新', exact: true}).boundingBox();
          assert(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 1000, JSON.stringify({width, locale, bounds}));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' overflows at ' + width);
          assert.equal(await page.locator('#release-status').textContent(), locale === 'en' ? 'No release published yet' : '尚未发布 Release');
          if (locale === 'en') assert(!/\p{Script=Han}/u.test(await page.locator('#release-panel').innerText()));
          if (name === 'overview' && [1440, 390, 320].includes(width)) {
            fs.mkdirSync(path.join(root, 'work'), {recursive: true});
            await page.mouse.move(width - 10, 500);
            await page.screenshot({path: path.join(root, 'work/sidebar-release-' + width + '-' + locale + '.png'), fullPage: false});
          }
          await page.keyboard.press('Escape');
        }
      }
    }
    passed.push('Repository, version and all six pages fit 320–1440px in both languages');

    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-office-release-'));
    const file = path.join(directory, 'report.html'); fs.writeFileSync(file, fixture.html);
    const offline = await browser.newContext(), offlinePage = await offline.newPage(); observe(offlinePage);
    await offlinePage.goto('file://' + file + '#lang=en'); await offlinePage.locator('#release-toggle').click();
    assert.equal(await offlinePage.locator('#release-current').textContent(), currentVersion);
    assert.equal(await offlinePage.locator('#release-status').textContent(), 'Start the local workbench to check for updates');
    assert(await offlinePage.getByRole('button', {name: 'Check for updates', exact: true}).isDisabled());
    await offline.close(); passed.push('Offline HTML retains the version and makes no release requests');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log(JSON.stringify({passed, runtimeErrors: errors, externalRequests: external.length}, null, 2));
  } catch (error) {
    if (page) { fs.mkdirSync(path.join(root, 'work'), {recursive: true}); await page.screenshot({path: path.join(root, 'work/sidebar-release-failure.png')}).catch(() => {}); }
    throw error;
  } finally {
    if (held && !held.writableEnded) held.end('{}');
    if (browser) await browser.close();
    if (directory) fs.rmSync(directory, {recursive: true});
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
