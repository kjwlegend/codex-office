// Offline, fictional-data coverage for the Blender cow and horse coworkers.
// NODE_PATH=<bundled node_modules> node tests/office-animals.browser.cjs
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
// The standard demo IDs exercise stable employee identity. Set each fictional
// agent working so both animal species must visibly animate at their desks.
for (const node of fixture.graph.nodes) {
  node.status = 'working'; node.status_label = '执行中'; node.current_activity = '修改项目文件';
}
let html = fixture.html;
const output = path.join(root, 'work');
const captures = [], errors = [], external = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/agents') {
    fixture.graph.observed_at = new Date().toISOString();
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture.graph));
  } else if (url.pathname === '/codex-usage-report.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
  } else {res.statusCode = 204; res.end();}
});
const world = page => page.evaluate(() => window.CodexAgentOffice.debug());
const identities = snapshot => Object.fromEntries(snapshot.actors.map(a => [a.id, a.appearance.species]));
async function ready(page, mode = 'office') {
  await page.waitForFunction(({mode, count}) => {
    const d = window.CodexAgentOffice?.debug();
    return d?.ready === 'true' && d.mode === mode && d.actors.length === count &&
      Object.values(d.quality.assetStates).every(s => s !== 'loading');
  }, {mode, count: fixture.graph.nodes.length});
}
async function capture(page, name) {
  await page.mouse.move(1, 1);
  const file = path.join(output, `office-animals-${name}.png`);
  await page.screenshot({path: file, fullPage: true}); captures.push(file);
}
async function closeup(page, id) {
  await page.locator('#agent-fit').click();
  await page.evaluate(id => {window.CodexAgentOffice.focus(id); window.CodexAgentOffice.zoom(2.8);}, id);
  await page.waitForFunction(id => window.CodexAgentOffice.debug().rigs.find(r => r.id === id)?.lod === 0, id);
}
function assertLoadedSpecies(snapshot) {
  assert.deepEqual(snapshot.quality.assetStates, {human: 'ready', cow: 'ready', horse: 'ready'});
  assert.deepEqual([...new Set(snapshot.actors.map(a => a.appearance.species))].sort(), ['cow', 'horse', 'human']);
  assert.equal(snapshot.rigs.length, fixture.graph.nodes.length);
  for (const a of snapshot.actors) {
    assert.equal(a.avatarSpecies, a.appearance.species, `${a.id} must use the requested coworker model`);
    assert.equal(snapshot.rigs.find(r => r.id === a.id).species, a.appearance.species);
  }
  assert(snapshot.rigs.every(r => r.bones === 9));
}

(async () => {
  let browser;
  try {
    fs.mkdirSync(output, {recursive: true});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({channel: 'chrome', headless: true});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 2});
    await context.addInitScript(() => {
      // Browser-created opaque documents do not expose storage. The fixture
      // itself retains its office default when storage is unavailable.
      try {localStorage.setItem('codex-agent-canvas-v2', JSON.stringify({scene: 'office', window: 'current'}));} catch (_) {}
    });
    context.on('page', page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error' && /shader|WebGLProgram|VALIDATE_STATUS/i.test(message.text())) errors.push(message.text());
      });
      page.on('request', req => {
        if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== origin) external.push(req.url());
      });
    });
    const page = await context.newPage();
    await page.goto(origin + '/codex-usage-report.html#page=agents&lang=en');
    await ready(page);
    await page.waitForFunction(() => window.CodexAgentOffice.debug().actors.every(a => a.status === 'working' && a.effects.visible));
    const initial = await world(page), stable = identities(initial);
    assertLoadedSpecies(initial);
    assert.equal(initial.quality.character, 'blender-skinned-glb');
    await capture(page, 'mixed-office');

    const representatives = {};
    for (const species of ['cow', 'horse']) {
      const id = initial.actors.find(a => a.appearance.species === species).id;
      representatives[species] = id;
      // An animal must use the full low-detail mesh at office scale and the
      // detailed mesh when inspecting the same employee at a desk.
      await page.locator('#agent-fit').click();
      await page.evaluate(() => window.CodexAgentOffice.zoom(.45));
      await page.waitForFunction(id => window.CodexAgentOffice.debug().rigs.find(r => r.id === id)?.lod === 1, id);
      await closeup(page, id);
      await page.waitForFunction(id => {
        const a = window.CodexAgentOffice.debug().actors.find(a => a.id === id);
        return a.motion === 'typing' && a.action === 'typing';
      }, id);
      const before = (await world(page)).actors.find(a => a.id === id);
      await page.waitForFunction(before => {
        const a = window.CodexAgentOffice.debug().actors.find(a => a.id === before.id);
        return a.action === 'typing' && a.joints.wrist.some((value, i) => Math.abs(value - before.joints.wrist[i]) > .025);
      }, before);
      await capture(page, `${species}-typing`);
      const point = await page.evaluate(id => window.CodexAgentOffice.screenPoint(id), id);
      assert(point.shown);
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.locator('#agent-detail').getAttribute('data-selected-agent'), id, 'Animal coworker remains selectable');
      await page.getByRole('button', {name: 'Close agent details', exact: true}).click();
    }

    // Refreshing, reordering the API response, and rebuilding another room
    // style must keep species attached to the same agent, not its list index.
    fixture.graph.nodes.reverse();
    const refreshedCow = fixture.graph.nodes.find(n => n.id === representatives.cow);
    refreshedCow.status = 'idle'; refreshedCow.status_label = '本轮已结束';
    await page.getByRole('button', {name: 'Refresh status', exact: true}).click();
    await page.waitForFunction(id => window.CodexAgentOffice.debug().actors.find(a => a.id === id)?.status === 'idle', representatives.cow);
    assert.deepEqual(identities(await world(page)), stable);
    refreshedCow.status = 'working'; refreshedCow.status_label = '执行中';
    await page.getByRole('button', {name: 'Refresh status', exact: true}).click();
    await page.waitForFunction(() => window.CodexAgentOffice.debug().actors.every(a => a.status === 'working'));
    for (const mode of ['prison', 'office']) {
      await page.locator(`[data-agent-scene="${mode}"]`).click();
      await ready(page, mode);
      const rebuilt = await world(page);
      assertLoadedSpecies(rebuilt);
      assert.deepEqual(identities(rebuilt), stable);
      if (mode === 'prison') {
        await closeup(page, representatives.cow);
        await capture(page, 'cow-cell');
      }
    }

    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.waitForFunction(() => window.CodexAgentOffice.debug().actors.every(a => a.motion === 'none'));
    const still = await world(page);
    assert(still.actors.every(a => a.effects.visible), 'Static working indicators remain useful with reduced motion');
    assert(still.edges.every(e => !e.flow));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual((await world(page)).actors.map(a => a.joints), still.actors.map(a => a.joints));
    await page.setViewportSize({width: 390, height: 844});
    await closeup(page, representatives.horse);
    assertLoadedSpecies(await world(page));
    await capture(page, 'horse-mobile');
    await page.setViewportSize({width: 1440, height: 1000});

    // Embedded animal assets must also load from a standalone saved HTML file.
    const offlineFile = path.join(output, 'office-animals-offline.html');
    fs.writeFileSync(offlineFile, fixture.html);
    const local = await context.newPage();
    await local.goto('file://' + offlineFile + '#page=agents&lang=en');
    await ready(local);
    assertLoadedSpecies(await world(local));
    await local.close();

    // Damage only the cow model in memory. Cow IDs retain their assignment but
    // receive the human fallback; healthy horses continue using their own rig.
    html = fixture.html.replace(/(<script id="office-cow-data"[^>]*>)[\s\S]*?(<\/script>)/, '$1invalid$2');
    assert.notEqual(html, fixture.html);
    await page.reload();
    await ready(page);
    const fallback = await world(page);
    assert.deepEqual(fallback.quality.assetStates, {human: 'ready', cow: 'fallback', horse: 'ready'});
    assert.deepEqual(identities(fallback), stable);
    assert.equal(fallback.rigs.length, initial.rigs.length);
    for (const a of fallback.actors) {
      const actual = a.appearance.species === 'cow' ? 'human' : a.appearance.species;
      assert.equal(a.avatarSpecies, actual);
      assert.equal(fallback.rigs.find(r => r.id === a.id).species, actual);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(JSON.stringify({agents: initial.actors.length,
      species: Object.fromEntries(['human', 'cow', 'horse'].map(s => [s, initial.actors.filter(a => a.appearance.species === s).length])),
      representatives, captures, errors, externalRequests: external.length}, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
