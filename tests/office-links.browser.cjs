// Work-state connection checks use fictional agents only, never local records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'work');
const fixture=JSON.parse(execFileSync('python3',['-m','tests.render_docs_fixture'],{cwd:root,maxBuffer:32e6,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
let connected=true,browser;
const errors=[],external=[],passed=[];
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.url.startsWith('/api/agents')){res.setHeader('Content-Type','application/json');res.statusCode=connected?200:503;res.end(JSON.stringify(connected?fixture.graph:{error:'Offline fixture'}));}
  else {res.setHeader('Content-Type','text/html');res.end(fixture.html);}
});
const world=page=>page.evaluate(()=>window.CodexAgentOffice.debug());
async function refresh(page){
  fixture.graph.observed_at=new Date().toISOString();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/agents'));
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();await response;
}
async function linkMode(page,value){
  await page.getByText('Display settings',{exact:true}).click();
  await page.getByRole('combobox',{name:'Relationship display',exact:true}).selectOption(value);
  await page.getByText('Display settings',{exact:true}).click();
  await page.mouse.move(1,1);
}
const noneActive=d=>d.edges.every(e=>!e.active&&!e.flow&&!e.glowing&&e.dashed);
(async()=>{try{
  fs.mkdirSync(output,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:process.env.CODEX_TEST_BROWSER_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram|VALIDATE_STATUS/i.test(m.text()))errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==origin)external.push(r.url());});
  await page.goto(origin+'/codex-usage-report.html#page=agents&lang=en');
  await page.waitForFunction(()=>window.CodexAgentOffice?.debug().ready==='true'&&window.CodexAgentOffice.debug().edges.some(e=>e.flow));
  const initial=await world(page),ids=initial.actors.map(a=>a.id);
  assert.equal(initial.linkMode,'active');
  assert.deepEqual(initial.edges.filter(e=>e.active).map(e=>e.target).sort(),['demo-cafe-copy','demo-cafe-ui']);
  assert(initial.edges.filter(e=>e.active).every(e=>e.visible&&e.glowing&&!e.dashed&&e.opacity===1));
  assert(initial.edges.filter(e=>!e.active).every(e=>!e.visible&&e.dashed&&!e.glowing&&!e.flow));
  const endedParent=initial.edges.find(e=>e.target==='demo-cafe-launch');
  assert.equal(endedParent.state,'working','The legacy subtree summary can still include a working descendant');
  assert.equal(endedParent.downstreamStatus,'idle');assert.equal(endedParent.active,false);
  passed.push('Only currently working endpoint agents energize links; inactive relationships start hidden');

  const moving=initial.edges.find(e=>e.flow);
  await page.waitForFunction(({target,position})=>{const e=window.CodexAgentOffice.debug().edges.find(e=>e.target===target);return e.flow&&e.flowPosition.some((v,i)=>Math.abs(v-position[i])>.05);},{target:moving.target,position:moving.flowPosition});
  await page.mouse.move(1,1);await page.screenshot({path:path.join(output,'office-links-active.png'),fullPage:true});
  passed.push('Visible light packets move along high-contrast solid work links');

  await page.locator('[data-node-id="demo-cafe-tests"] .agent-node-select').focus();
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().edges.some(e=>e.target==='demo-cafe-tests'&&e.highlighted&&e.visible));
  const inspected=await world(page);
  assert(inspected.edges.filter(e=>e.highlighted&&!e.active).every(e=>e.visible&&e.dashed&&!e.glowing&&!e.flow));
  await page.screenshot({path:path.join(output,'office-links-inspected.png'),fullPage:true});
  await page.locator('#agent-viewport').focus();
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().edges.every(e=>!e.highlighted));
  await linkMode(page,'all');
  assert((await world(page)).edges.filter(e=>!e.active).every(e=>e.visible&&e.dashed&&!e.glowing&&!e.flow));
  passed.push('Inspection restores inactive dashed ownership; All relationships keeps it visible without fake motion');

  const access=fixture.graph.nodes.find(n=>n.id==='demo-cafe-access');
  access.status='working';await refresh(page);
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().edges.some(e=>e.target==='demo-cafe-access'&&e.active&&e.flow));
  let d=await world(page);
  const waiting=d.edges.find(e=>e.target==='demo-cafe-tests');
  assert.equal(waiting.state,'working');assert.equal(waiting.downstreamStatus,'waiting_agents');
  assert(!waiting.active&&!waiting.flow&&!waiting.glowing&&waiting.dashed);
  assert(d.edges.find(e=>e.target===access.id).flow);
  assert.deepEqual(d.actors.map(a=>a.id),ids);assert.deepEqual(d.camera,initial.camera);
  access.status='idle';await refresh(page);
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().edges.find(e=>e.target==='demo-cafe-access').downstreamStatus==='idle');
  assert(!(await world(page)).edges.find(e=>e.target===access.id).active);
  passed.push('Working grandchildren do not energize waiting ancestors; transitions preserve identities and camera');

  await page.getByRole('button',{name:'Pause updates',exact:true}).click();
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().observation==='paused');
  assert(noneActive(await world(page)));
  await page.getByRole('button',{name:'Resume updates',exact:true}).click();
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().edges.some(e=>e.active));
  connected=false;await refresh(page);
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().observation==='offline');
  assert(noneActive(await world(page)));
  connected=true;fixture.graph.data_stale=true;await refresh(page);
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().observation==='stale');
  assert(noneActive(await world(page)));
  fixture.graph.data_stale=false;await refresh(page);
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().edges.some(e=>e.active));
  passed.push('Paused, offline and stale observations remove both flowing and static work effects');

  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>{const d=window.CodexAgentOffice.debug();return d.edges.every(e=>!e.flow)&&d.actors.every(a=>a.motion==='none');});
  d=await world(page);assert(d.edges.some(e=>e.active&&e.visible&&e.glowing&&!e.dashed));
  assert(d.actors.every(a=>a.motion==='none'));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().edges.some(e=>e.flow));
  passed.push('Reduced motion keeps a truthful static working cue without animated packets');

  const memory=(await world(page)).memory;
  for(let i=0;i<3;i++)await refresh(page);
  assert.deepEqual((await world(page)).memory,memory,'Stable updates reuse line geometry, materials and assets');
  await linkMode(page,'active');
  await page.locator('[data-agent-scene="prison"]').click();
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().mode==='prison'&&window.CodexAgentOffice.debug().ready==='true');
  d=await world(page);assert.deepEqual(d.actors.map(a=>a.id),ids);
  assert(d.edges.filter(e=>e.kind==='subagent').every(e=>e.color==='#79a8ff'));
  assert(d.edges.filter(e=>!e.active).every(e=>!e.flow&&!e.glowing&&e.dashed));
  await page.screenshot({path:path.join(output,'office-links-prison.png'),fullPage:true});
  passed.push('Dark-theme contrast and resource reuse preserve the same relationship semantics');

  await page.locator('[data-agent-scene="office"]').click();
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().mode==='office'&&window.CodexAgentOffice.debug().ready==='true');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,'office-links-mobile.png'),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert((await world(page)).edges.filter(e=>e.kind==='subagent').every(e=>e.color==='#244fe0'));
  await page.getByRole('button',{name:'切换到中文',exact:true}).click();
  assert(await page.getByText('虚线 · 非执行关系',{exact:true}).isVisible());
  assert.equal(await page.locator('#agent-link-mode').inputValue(),'active');
  passed.push('390px layout and Chinese copy retain default work-first connections');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({passed,errors,externalRequests:external.length},null,2));
}finally{if(browser)await browser.close();if(server.listening)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
