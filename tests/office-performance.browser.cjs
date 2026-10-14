// Dense, fictional office: rendering cost, real identity, picking and close-up recovery.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),baseline=process.env.CODEX_VISUAL_BASELINE==='1',tag=baseline?'before':'after';
const fixture=JSON.parse(execFileSync('python3',['-m','tests.render_docs_fixture'],{cwd:root,maxBuffer:32e6,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
for(let i=0;i<292;i++){
  const n={...fixture.graph.nodes[1],id:'dense-crew-'+i,usage_key:'dense-crew-'+i,status:i%3?'idle':'working',status_label:i%3?'本轮已结束':'执行中',title:'Fictional dense task '+i,agent_name:'Crew '+i};
  fixture.graph.nodes.push(n);fixture.graph.edges.push({source:n.parent_agent_id,target:n.id,kind:'subagent'});
}
fixture.graph.refresh_seconds=3600;
if(baseline)for(const file of ['dashboard/agent-office-3d.js','dashboard/agent-office-3d.css']){
  const current=fs.readFileSync(path.join(root,file),'utf8'),previous=execFileSync('git',['show','HEAD:'+file],{cwd:root,encoding:'utf8'});
  assert(fixture.html.includes(current));fixture.html=fixture.html.replace(current,previous);
}
const output=path.join(root,'work'),errors=[],external=[],checks=[];let browser,page;
const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url.startsWith('/api/agents')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture.graph));}else if(req.url.startsWith('/codex-usage-report.html')){res.setHeader('Content-Type','text/html');res.end(fixture.html);}else{res.statusCode=204;res.end();}});
const state=()=>page.evaluate(()=>window.CodexAgentOffice.debug());
const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
const capture=async name=>{await page.mouse.move(1,1);await frames();await page.screenshot({path:path.join(output,'office-dense-'+tag+'-'+name+'.png'),animations:'disabled'});};
(async()=>{try{
  fs.mkdirSync(output,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:process.env.CODEX_TEST_BROWSER_CHANNEL||'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin))external.push(r.url());});
  await page.goto(origin+'/codex-usage-report.html#page=agents&lang=en');await page.waitForFunction(()=>window.CodexAgentOffice?.debug().ready==='true'&&window.CodexAgentOffice.debug().actors.length===300,null,{timeout:90000});
  await page.getByRole('button',{name:'Fit canvas',exact:true}).click();await frames();await capture('overview');
  const wide=await state(),ids=wide.actors.map(a=>a.id).sort();fs.writeFileSync(path.join(output,'office-dense-'+tag+'.json'),JSON.stringify({agents:ids.length,render:wide.render,quality:wide.quality,visibleRelationships:wide.visibleRelationships},null,2));
  if(baseline){console.log(JSON.stringify({baseline:true,agents:ids.length,render:wide.render},null,2));return;}
  assert(wide.render.overview>280,'Wide view should batch almost all employees');assert(wide.render.labels<=8,'Wide view should not lay out hundreds of bubbles');
  assert(wide.render.calls<600,'Dense wide view must have a bounded draw-call budget');assert.equal(wide.visibleRelationships,0);
  const previous=path.join(output,'office-dense-before.json'),before=fs.existsSync(previous)?JSON.parse(fs.readFileSync(previous,'utf8')):null;
  const staticFrames=wide.render.frames;await page.evaluate(()=>new Promise(r=>{let n=0;const tick=()=>++n===12?r():requestAnimationFrame(tick);requestAnimationFrame(tick);}));
  assert.equal((await state()).render.frames,staticFrames,'Static overview must stop continuous rendering despite many working records');
  checks.push('300 real identities; batched overview; bounded labels; static rendering stops');
  const sign=page.locator('.agent-3d-project:visible').first();assert(await sign.locator('.agent-project-caption').isVisible());assert.equal(await sign.locator('.agent-project-caption').textContent(),'Workspace');
  const styles=await sign.evaluate(el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderLeftWidth}));assert.equal(styles.border,'4px');assert.notEqual(styles.background,'rgba(245, 248, 240, 0.91)');
  const oldCamera=wide.camera;await sign.click();await frames();assert.notDeepEqual((await state()).camera,oldCamera);await page.getByRole('button',{name:'Previous view',exact:true}).click();await frames();
  checks.push('Distinct project signs still frame rooms and restore camera history');
  // Pick a real instanced silhouette with the actual canvas raycaster.
  const pick=await page.evaluate(()=>{const d=window.CodexAgentOffice.debug(),h=document.getElementById('agent-3d').getBoundingClientRect();return d.actors.filter(a=>a.renderMode==='overview').map(a=>({id:a.id,...window.CodexAgentOffice.screenPoint(a.id)})).find(p=>p.shown&&p.x>h.x+150&&p.x<h.right-320&&p.y>h.y+150&&p.y<h.bottom-160&&document.elementFromPoint(p.x,p.y)?.classList.contains('agent-three-canvas'));});
  assert(pick,'A wide-view employee should be pickable');await page.mouse.move(pick.x,pick.y);await frames();const hovered=(await state()).hovered;assert(ids.includes(hovered),'Hover must resolve an actual employee');
  const target=await page.evaluate(p=>({element:document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,250),hovered:window.CodexAgentOffice.debug().hovered}),pick);
  await page.mouse.click(pick.x,pick.y);await frames();const selected=await state();assert(ids.includes(selected.selected),JSON.stringify({pick,target,hovered:selected.hovered,selected:selected.selected}));assert.equal(selected.actors.find(a=>a.id===selected.selected).renderMode,'detail');
  checks.push('Instanced hover and click preserve real employee identity');
  await page.getByRole('button',{name:'Close agent details',exact:true}).click();
  await page.locator('#agent-roster>summary').click();const search=page.getByRole('searchbox',{name:'Search projects, employees or tasks',exact:true});await search.fill('Fictional dense task 17');
  await page.locator('[data-roster-agent="dense-crew-17"]').click();await frames();
  assert.equal((await state()).selected,'dense-crew-17');
  await page.getByRole('button',{name:'Close agent details',exact:true}).click();
  await page.evaluate(()=>{window.CodexAgentOffice.focus('dense-crew-17');window.CodexAgentOffice.zoom(2.8);});await frames();
  await page.locator('[data-select-agent="dense-crew-17"]').click();await frames();
  await page.waitForFunction(()=>window.CodexAgentOffice.debug().rigs.find(a=>a.id==='dense-crew-17').lod===0);
  const near=await state(),employee=near.actors.find(a=>a.id==='dense-crew-17');assert.equal(employee.renderMode,'detail');assert(employee.detail.visible);assert.equal(employee.bubble.size,'full');assert(near.render.culled>100);assert(near.visibleRelationships>0);assert.deepEqual(near.actors.map(a=>a.id).sort(),ids);
  await capture('closeup');checks.push('Navigator finds every employee; close-up restores Blender detail, branches and task while culling offscreen peers');
  const camera=near.camera;await page.getByRole('button',{name:'Refresh status',exact:true}).click();await frames();assert.deepEqual((await state()).camera,camera);assert.equal((await state()).selected,'dense-crew-17');
  const chosen=fixture.graph.nodes.find(n=>n.id==='dense-crew-17');chosen.status='working';chosen.status_label='执行中';await page.getByRole('button',{name:'Refresh status',exact:true}).click();await frames();assert.equal((await state()).actors.find(a=>a.id===chosen.id).motion,'typing');
  await page.emulateMedia({reducedMotion:'reduce'});await frames();assert.equal((await state()).motion,false);assert.equal((await state()).actors.find(a=>a.id===chosen.id).motion,'none');await page.emulateMedia({reducedMotion:'no-preference'});
  checks.push('Refresh preserves selection/camera and visible activity; reduced motion stops animation');
  await page.getByRole('button',{name:'Close agent details',exact:true}).click();
  await page.locator('[data-agent-scene="prison"]').click();await page.getByRole('button',{name:'Fit canvas',exact:true}).click();await frames();const cells=await state();assert(cells.render.overview>280);assert.deepEqual(cells.actors.map(a=>a.id).sort(),ids);await capture('prison');
  await page.locator('[data-agent-scene="office"]').click();await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Fit canvas',exact:true}).click();await frames();
  const mobile=await state();assert(mobile.render.overview>280);assert.deepEqual(mobile.actors.map(a=>a.id).sort(),ids);await capture('mobile');
  const bounds=await page.locator('.agent-3d-project:visible').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right};}));assert(bounds.length);for(const r of bounds)assert(r.left>=0&&r.right<=390);
  await page.locator('#locale-switch').click();await frames();assert.equal(await page.locator('.agent-3d-project:visible .agent-project-caption').first().textContent(),'项目办公区');
  checks.push('Office/prison and 390px layout preserve all identities and bilingual project signs');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({checks,agents:ids.length,before:before?.render,after:wide.render,drawCallReduction:before?1-wide.render.calls/before.render.calls:undefined,errors,externalRequests:external.length},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(output,'office-dense-'+tag+'-failure.png')}).catch(()=>{});console.error(error);process.exitCode=1;}
finally{await browser?.close();server.close();}})();
