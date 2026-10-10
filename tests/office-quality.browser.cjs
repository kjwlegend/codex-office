// Offline, fictional-data visual proof and regression checks for character/route quality.
// NODE_PATH=<bundled node_modules> node tests/office-quality.browser.cjs
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
const baseline = process.env.CODEX_VISUAL_BASELINE === '1';
if (baseline) {
  // Compare the committed renderer in memory, never overwrite the working tree.
  const current = fs.readFileSync(path.join(root, 'dashboard/agent-office-3d.js'), 'utf8');
  const previous = execFileSync('git', ['show', 'HEAD:dashboard/agent-office-3d.js'], {cwd: root, encoding: 'utf8'});
  assert(fixture.html.includes(current)); fixture.html = fixture.html.replace(current, previous);
}
const tag = baseline ? 'before' : 'after';
const output = path.join(root, 'work');
const errors = [], external = [], captures = [];
let connected = true;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/agents') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = connected ? 200 : 503;
    res.end(JSON.stringify(connected ? fixture.graph : {error: 'Offline fixture'}));
  } else if (url.pathname === '/codex-usage-report.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture.html);
  } else {res.statusCode = 204; res.end();}
});
const world = page => page.evaluate(() => window.CodexAgentOffice.debug());
async function ready(page, mode) {
  await page.waitForFunction(mode => {
    const d = window.CodexAgentOffice?.debug();
    return d?.ready === 'true' && d.mode === mode && d.actors.length === 8;
  }, mode);
}
async function capture(page, name) {
  await page.mouse.move(1, 1);
  const file = path.join(output, `office-quality-${tag}-${name}.png`);
  await page.screenshot({path: file, fullPage: true}); captures.push(file);
}
(async () => {
  let browser;
  try {
    fs.mkdirSync(output, {recursive: true});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({channel: 'chrome', headless: true});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 2});
    await context.addInitScript(() => localStorage.setItem('codex-agent-canvas-v2', JSON.stringify({scene: 'office', window: 'current'})));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', m => {if (m.type() === 'error' && /shader|WebGLProgram|VALIDATE_STATUS/i.test(m.text())) errors.push(m.text());});
    page.on('request', req => {if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== origin) external.push(req.url());});
    await page.goto(origin + '/codex-usage-report.html#page=agents&lang=en');
    await ready(page, 'office');
    await page.waitForFunction(() => window.CodexAgentOffice.debug().actors.some(a => a.motion === 'typing'));
    const initial = await world(page);
    await capture(page, 'wide');
    assert.equal(initial.actors.length, fixture.graph.nodes.length);
    assert.equal(initial.edges.length, fixture.graph.edges.length);
    if (!baseline) {
      assert.equal(initial.quality.character, 'blender-skinned-glb');
      assert.equal(initial.features['blender-employee'], 8);
      assert.equal(initial.features['rig_head'], 8);
      assert.equal(initial.features['rig_wrist_L'], 8);
      assert.equal(initial.quality.contactShadows, true);
      assert(initial.rigs.every(r=>r.bones===9));
      assert(initial.rigs.some(r=>r.lod===1), 'Distant employees use actual low-detail geometry');
      assert(initial.actors.every(a => a.detail.faceVertices > 900 && a.detail.bodyVertices > 300));
      assert.equal(initial.quality.pixelRatio, 2);
      assert(initial.edges.every(e => e.route === 'bezier' && e.radius < .022));
      assert(initial.edges.every(e => e.length > 0 && e.endpointError < 1e-6));
      assert(initial.edges.filter(e => e.state !== 'working').every(e => !e.flow));
    }
    // Focus the rendered figure through real picking, then use the existing zoom controls.
    const point = await page.evaluate(() => window.CodexAgentOffice.screenPoint('demo-cafe-copy'));
    assert(point.shown);
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.locator('#agent-detail').getAttribute('data-selected-agent'), 'demo-cafe-copy');
    await page.getByRole('button', {name: 'Close agent details', exact: true}).click();
    await page.evaluate(() => window.CodexAgentOffice.focus('demo-cafe-copy'));
    for (let i = 0; i < 6; i++) await page.getByRole('button', {name: baseline ? 'Zoom out' : 'Zoom in', exact: true}).click();
    await capture(page, 'closeup');
    const closeup = await world(page);
    assert(Math.hypot(...closeup.camera.map((x, i) => x - closeup.target[i])) < 6);
    const previous = closeup.actors.find(a => a.id === 'demo-cafe-copy');
    if (!baseline) assert(previous.detail.visible, 'Zooming in must reveal the same employee micro-details');
    if (!baseline) assert.equal(closeup.rigs.find(r=>r.id===previous.id).lod,0);
    if (!baseline) {
      await page.getByText('Display settings',{exact:true}).click();
      await page.getByRole('combobox', {name: '3D quality', exact: true}).selectOption('balanced');
      await page.waitForFunction(() => window.CodexAgentOffice.debug().quality.preset === 'balanced');
      const balanced = await world(page);
      assert.equal(balanced.quality.contactShadows, false);
      assert.equal(balanced.quality.pixelRatio, 1.25);
      assert.deepEqual(balanced.camera, closeup.camera);
      assert.deepEqual(balanced.actors.map(a => a.id), closeup.actors.map(a => a.id));
      await page.getByRole('combobox', {name: '3D quality', exact: true}).selectOption('high');
      await page.waitForFunction(() => window.CodexAgentOffice.debug().quality.contactShadows);
      await page.getByText('Display settings',{exact:true}).click();
    }
    await page.waitForFunction(previous => {
      const a = window.CodexAgentOffice.debug().actors.find(a => a.id === previous.id);
      return Math.abs(a.joints.wrist[0] - previous.joints.wrist[0]) > .025;
    }, previous);
    // Reduced motion keeps observed static working cues, but freezes joints/flow.
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.waitForFunction(() => window.CodexAgentOffice.debug().actors.every(a => a.motion === 'none'));
    const still = await world(page);
    assert(still.actors.filter(a => a.status === 'working').every(a => a.effects.visible));
    assert(still.edges.every(e => !e.flow));
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.locator('[data-agent-scene="prison"]').click();
    await ready(page, 'prison');
    assert.deepEqual((await world(page)).actors.map(a => a.id), initial.actors.map(a => a.id));
    await capture(page, 'cells');
    await page.evaluate(baseline => {window.CodexAgentOffice.focus('demo-cafe-ui'); window.CodexAgentOffice.zoom(baseline ? 1/2.8 : 2.8);}, baseline);
    await capture(page, 'cell-closeup');
    // Warm both themes, then ensure rebuilding doesn't retain old geometry/textures.
    await page.locator('[data-agent-scene="office"]').click(); await ready(page, 'office');
    await page.locator('[data-agent-scene="prison"]').click(); await ready(page, 'prison');
    const memory = (await world(page)).memory;
    for (let i = 0; i < 2; i++) {
      await page.locator('[data-agent-scene="office"]').click(); await ready(page, 'office');
      await page.locator('[data-agent-scene="prison"]').click(); await ready(page, 'prison');
      assert.deepEqual((await world(page)).memory, memory);
    }
    if (!baseline) {
      // More than 50 actors used to drop facial detail unconditionally. A
      // crowded workgroup must still provide the same close-up employee.
      for (let i = 0; i < 52; i++) {
        const id = 'demo-crowd-' + i;
        fixture.graph.nodes.push({...fixture.graph.nodes[1], id, usage_key: id,
          title: 'Fictional extra employee ' + i, status: 'idle', status_label: '本轮已结束', agent_name: 'Demo ' + i});
        fixture.graph.edges.push({source: 'demo-cafe-main', target: id, kind: 'subagent'});
      }
      await page.locator('[data-agent-scene="office"]').click();
      await page.getByRole('button', {name: 'Refresh status', exact: true}).click();
      await page.waitForFunction(() => window.CodexAgentOffice.debug().actors.length === 60);
      assert((await world(page)).actors.every(a => a.detail.faceVertices > 900));
      await page.evaluate(() => {window.CodexAgentOffice.focus('demo-cafe-copy'); window.CodexAgentOffice.zoom(2.8);});
      await page.waitForFunction(() => window.CodexAgentOffice.debug().actors.find(a => a.id === 'demo-cafe-copy').detail.visible);
      assert.equal((await world(page)).rigs.find(r=>r.id==='demo-cafe-copy').lod,0);
    }
    connected = false;
    await page.getByRole('button', {name: 'Refresh status', exact: true}).click();
    await page.waitForFunction(() => window.CodexAgentOffice.debug().observation === 'offline');
    const offline = await world(page);
    assert(offline.actors.every(a => !a.effects.visible && a.motion === 'none'));
    assert(offline.edges.every(e => !e.flow));
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    if (!baseline) {
      const offlineFile=path.join(output,'office-quality-offline.html');
      fs.writeFileSync(offlineFile,fixture.html);
      const local=await context.newPage();
      const localErrors=[];local.on('pageerror',e=>localErrors.push(e.message));
      await local.goto('file://'+offlineFile+'#page=agents&lang=en');
      await local.waitForFunction(()=>window.CodexAgentOffice?.debug().quality.assetState==='ready');
      assert.equal((await world(local)).quality.character,'blender-skinned-glb');
      assert((await world(local)).actors.every(a=>!a.effects.visible));
      assert.deepEqual(localErrors,[]);await local.close();
      // Corrupt only a fresh in-memory fixture: the UI must retain a usable
      // procedural employee, not crash or keep a spinner indefinitely.
      fixture.html=fixture.html.replace(/(<script id="office-character-data"[^>]*>)[\s\S]*?(<\/script>)/,'$1invalid$2');
      connected=true;
      await page.goto(origin+'/codex-usage-report.html#page=agents&lang=en');
      await page.reload(); // a hash-only goto can keep the previously loaded asset
      try {await page.waitForFunction(()=>window.CodexAgentOffice?.debug().quality.assetState==='fallback');}
      catch(error){console.error('Fallback diagnostic',await page.evaluate(()=>({state:window.CodexAgentOffice?.debug().quality,asset:document.getElementById('office-character-data')?.textContent.slice(0,30),error:document.getElementById('agent-3d')?.dataset.assetError})),errors);throw error;}
      assert.equal((await world(page)).actors.length,fixture.graph.nodes.length);
      assert.deepEqual(errors, []);
    }
    console.log(JSON.stringify({captures, agents: initial.actors.length, triangles: initial.render.triangles,
      drawCalls: initial.render.calls, errors, externalRequests: external.length}, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
