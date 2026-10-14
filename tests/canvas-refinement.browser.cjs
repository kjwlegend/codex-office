// Second five-round UX acceptance. Only fictional fixtures; no account writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),round=Number(process.argv[2]||10);
const fixture=JSON.parse(execFileSync('python3',['-m','tests.render_docs_fixture'],{cwd:root,maxBuffer:32e6,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
for(let i=0;i<28;i++){
  const n={...fixture.graph.nodes[1],id:'refinement-crew-'+i,usage_key:'refinement-crew-'+i,status:'idle',status_label:'本轮已结束',title:'Fictional crew task '+i,agent_name:'Crew '+i};
  fixture.graph.nodes.push(n);fixture.graph.edges.push({source:n.parent_agent_id,target:n.id,kind:'subagent'});
}
const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url.startsWith('/api/agents')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture.graph));}else{res.setHeader('Content-Type','text/html');res.end(fixture.html);}});
const errors=[],external=[],passed=[];let browser,page;
const state=()=>page.evaluate(()=>window.CodexAgentOffice.debug());
const snapshot=async name=>{fs.mkdirSync(path.join(root,'work'),{recursive:true});await page.screenshot({path:path.join(root,'work',name+'.png'),animations:'disabled'});};
(async()=>{try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:process.env.CODEX_TEST_BROWSER_CHANNEL||'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin))external.push(r.url());});
  await page.goto(origin+'/codex-usage-report.html#page=agents&lang=en');await page.waitForFunction(()=>window.CodexAgentOffice?.debug().ready==='true'&&window.CodexAgentOffice.debug().actors.length===36);
  const initial=await state(),ids=initial.actors.map(a=>a.id).sort();
  const compact=d=>{
    assert.deepEqual(d.actors.map(a=>a.id).sort(),ids);
    const pod=d.actors.filter(a=>a.team==='demo-cafe-main'&&a.id!=='demo-cafe-main');
    assert(new Set(pod.map(a=>a.position[0].toFixed(2))).size>=5);
    assert(new Set(pod.map(a=>a.position[2].toFixed(2))).size<=6);
    for(let i=0;i<d.projects.length;i++)for(const b of d.projects.slice(i+1)){const a=d.projects[i];assert(Math.abs(a.x-b.x)>=(a.width+b.width)/2||Math.abs(a.z-b.z)>=(a.depth+b.depth)/2,'Workspaces overlap');}
  };
  compact(initial);await page.locator('[data-agent-scene="prison"]').click();compact(await state());await page.locator('[data-agent-scene="office"]').click();
  passed.push('R6: compact large-team pods and non-overlapping rooms preserve every employee in both scenes');
  if(round>=7){
    const before=await state();await page.locator('.agent-3d-project').getByText('Orbit Notes',{exact:true}).click();const project=await state();
    assert.notDeepEqual(project.camera,before.camera);await page.getByText('Display settings',{exact:true}).click();await page.getByRole('combobox',{name:'Canvas camera',exact:true}).selectOption('desk');await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Previous view',exact:true}).click();let restored=await state();assert(restored.camera.every((v,i)=>Math.abs(v-project.camera[i])<1e-7));
    await page.getByRole('button',{name:'Previous view',exact:true}).click();restored=await state();assert(restored.camera.every((v,i)=>Math.abs(v-before.camera[i])<1e-7));assert.equal(await page.getByRole('button',{name:'Previous view',exact:true}).isDisabled(),true);
    assert.deepEqual(restored.actors.map(a=>a.id).sort(),ids);
    passed.push('R7: previous view restores nested project/close-up framing without changing identity or filters');
  }
  if(round>=8){
    await page.locator('#agent-roster>summary').click();const search=page.getByRole('searchbox',{name:'Search projects, employees or tasks',exact:true});await search.fill('accessibility');
    assert.equal(await page.locator('[data-roster-agent]').count(),1);assert.equal(await page.locator('[data-roster-agent]').getAttribute('data-roster-agent'),'demo-cafe-tests');assert.equal((await state()).actors.length,36);
    await page.getByRole('button',{name:'Refresh status',exact:true}).click();assert.equal(await search.inputValue(),'accessibility');await search.fill('');
    await page.getByRole('button',{name:'Needs attention',exact:true}).click();assert.deepEqual(await page.locator('[data-roster-agent]').evaluateAll(nodes=>nodes.map(n=>n.dataset.rosterAgent)),['demo-cafe-access']);
    await page.getByRole('button',{name:'Working now',exact:true}).click();assert.equal(await page.locator('[data-roster-agent]').count(),4);
    await search.fill('No fictional employee matches');assert(await page.getByText('No matching employees',{exact:true}).isVisible());await page.getByRole('button',{name:'Clear navigator filters',exact:true}).click();assert.equal(await page.locator('[data-roster-agent]').count(),36);
    await page.getByRole('button',{name:'Pause updates',exact:true}).click();await page.getByRole('button',{name:'Working now',exact:true}).click();assert.equal(await page.locator('[data-roster-agent]').count(),0);assert(await page.getByText('Observation paused; showing last records',{exact:true}).isVisible());
    await page.getByRole('button',{name:'All employees',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Resume updates',exact:true}).click();
    await page.locator('#agent-roster>summary').click();await snapshot('canvas-round-8-navigator');await page.keyboard.press('Escape');
    passed.push('R8: navigator search, attention/working lists and empty states preserve canvas scope and pause truth');
  }
  if(round>=9){
    await page.locator('#agent-roster>summary').click();await page.getByRole('button',{name:'Inspect employee: Lina',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-node-id="demo-cafe-access"]').dataset.bubbleSize==='full');
    await page.getByRole('button',{name:'Close agent details',exact:true}).click();
    await page.getByRole('button',{name:'Fit canvas',exact:true}).click();await page.locator('#agent-roster>summary').click();
    await page.waitForFunction(()=>{const panel=document.querySelector('#agent-roster-panel').getBoundingClientRect();return [...document.querySelectorAll('.agent-3d-person[data-bubble-size="full"]')].filter(n=>!n.hidden).every(n=>{const r=n.getBoundingClientRect();return !(r.left<panel.right&&r.right>panel.left&&r.top<panel.bottom&&r.bottom>panel.top)});});
    await snapshot('canvas-round-9-panels');await page.keyboard.press('Escape');
    for(const width of [390,768,1440]){
      await page.setViewportSize({width,height:1000});await page.getByRole('button',{name:'Fit canvas',exact:true}).click();
      const visible=await page.locator('.agent-3d-person[data-bubble-size="full"]').evaluateAll(nodes=>nodes.filter(n=>!n.hidden).map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom}}));
      assert(visible.every(r=>r.x>=0&&r.right<=width&&r.y>=0&&r.bottom<=1000),JSON.stringify({width,visible}));
    }
    passed.push('R9: task bubbles stay inside the viewport and avoid open panels; waiting employees expand correctly');
  }
  if(round>=10){
    await page.locator('#agent-viewport').focus();await page.keyboard.press('v');assert.equal((await state()).cameraPreset,'top');await page.keyboard.press('b');assert.equal((await state()).cameraPreset,'iso');
    await page.keyboard.press('n');assert.equal(await page.evaluate(()=>document.activeElement.id),'agent-roster-search');await page.keyboard.type('v');assert.equal((await state()).cameraPreset,'iso');await page.getByRole('searchbox',{name:'Search projects, employees or tasks',exact:true}).fill('');await page.keyboard.press('Escape');
    await page.getByText('Display settings',{exact:true}).click();await page.getByRole('combobox',{name:'Relationship display',exact:true}).selectOption('inspect');await page.keyboard.press('Escape');
    await page.locator('#agent-viewport').focus();await page.keyboard.press('n');await page.getByRole('searchbox',{name:'Search projects, employees or tasks',exact:true}).fill('Noah');
    await page.locator('[data-roster-agent="demo-cafe-tests"]').focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Close agent details',exact:true}).click();
    await page.locator('[data-node-id="demo-cafe-tests"] .agent-node-select').focus();await page.waitForFunction(()=>window.CodexAgentOffice.debug().visibleRelationships>0);assert((await page.locator('#agent-3d-trace').textContent()).includes('Noah'));
    await page.locator('#agent-viewport').focus();await page.keyboard.press('/');assert.equal(await page.evaluate(()=>document.activeElement.id),'agent-search');
    await page.locator('#locale-switch').click();await page.locator('#agent-roster>summary').click();assert(await page.getByRole('searchbox',{name:'搜索项目、员工或任务',exact:true}).isVisible());await page.keyboard.press('Escape');await page.locator('#locale-switch').click();
    for(const width of [320,390,768]){
      await page.setViewportSize({width,height:844});
      for(const mode of ['office','prison']){
        await page.locator('[data-agent-scene="'+mode+'"]').click();
        for(const id of ['agent-roster','agent-display-controls']){await page.locator('#'+id+'>summary').click();const box=await page.locator('#'+id+'>div').boundingBox();assert(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=844,JSON.stringify({width,mode,id,box}));await page.keyboard.press('Escape');}
        const zoom=await page.locator('.agent-zoom').boundingBox(),legend=await page.locator('.agent-legend>summary').boundingBox();assert(zoom.y>=legend.y+legend.height||zoom.x>=legend.x+legend.width,'Footer controls overlap');
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      if(width===390)await snapshot('canvas-round-10-mobile');
    }
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>window.CodexAgentOffice.debug().motion===false);await page.emulateMedia({reducedMotion:'no-preference'});
    await page.setViewportSize({width:1440,height:1000});await page.locator('[data-agent-scene="office"]').click();await page.getByText('Display settings',{exact:true}).click();await page.getByRole('combobox',{name:'Relationship display',exact:true}).selectOption('all');await snapshot('canvas-round-10-settings');await page.keyboard.press('Escape');
    passed.push('R10: scoped keyboard shortcuts, focus tracing, bilingual controls and touch-sized navigation fit narrow screens');
  }
  await snapshot('canvas-round-'+round);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({round,passed,errors,externalRequests:external.length},null,2));
}catch(e){if(page)await snapshot('canvas-refinement-failure');throw e;}finally{await browser?.close();if(server.listening)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
