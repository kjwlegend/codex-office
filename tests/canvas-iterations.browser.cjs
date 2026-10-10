// Five iterative UX acceptance passes; fictional data, no account writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),round=Number(process.argv[2]||5);
const fixture=JSON.parse(execFileSync('python3',['-m','tests.render_docs_fixture'],{cwd:root,maxBuffer:32e6,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url.startsWith('/api/agents')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture.graph));}else{res.setHeader('Content-Type','text/html');res.end(fixture.html);}});
const errors=[],external=[],passed=[];let browser;
const state=p=>p.evaluate(()=>window.CodexAgentOffice.debug());
(async()=>{try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:process.env.CODEX_TEST_BROWSER_CHANNEL||'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin))external.push(r.url());});
  await page.goto(origin+'/codex-usage-report.html#page=agents&lang=en');await page.waitForFunction(()=>window.CodexAgentOffice?.debug().ready==='true');
  const initial=await state(page),ids=initial.actors.map(a=>a.id);
  await page.getByText('Display settings',{exact:true}).click();
  await page.getByRole('combobox',{name:'Canvas camera',exact:true}).selectOption('top');
  let d=await state(page);assert.equal(d.cameraPreset,'top');assert(d.camera[1]-d.target[1]>Math.abs(d.camera[2]-d.target[2])*3);
  await page.getByRole('combobox',{name:'Canvas camera',exact:true}).selectOption('desk');
  d=await state(page);assert(Math.hypot(...d.camera.map((v,i)=>v-d.target[i]))<5.1);
  await page.getByText('Display settings',{exact:true}).click();await page.getByRole('button',{name:'Fit canvas',exact:true}).click();
  assert.equal((await state(page)).cameraPreset,'iso');assert.equal(await page.locator('#agent-camera').inputValue(),'iso');
  await page.getByText('Display settings',{exact:true}).click();
  await page.getByRole('combobox',{name:'Canvas camera',exact:true}).selectOption('iso');
  await page.getByText('Display settings',{exact:true}).click();
  await page.locator('.agent-3d-project').getByText('Coffee Shop',{exact:true}).click();
  d=await state(page);assert.notDeepEqual(d.camera,initial.camera);assert.deepEqual(d.actors.map(a=>a.id),ids);
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();assert.deepEqual((await state(page)).camera,d.camera);
  passed.push('R1: three camera presets and project framing preserve identities and survive refresh');
  await page.getByRole('button',{name:'Fit canvas',exact:true}).click();
  if(round>=2){
    await page.getByText('Display settings',{exact:true}).click();
    await page.getByRole('combobox',{name:'Task labels',exact:true}).selectOption('quiet');
    await page.waitForFunction(()=>window.CodexAgentOffice.debug().labelMode==='quiet'&&[...document.querySelectorAll('.agent-3d-person')].every(n=>n.dataset.labelMode==='quiet'));
    assert.equal(await page.locator('.agent-3d-person[data-bubble-size="full"]').count(),0);
    await page.getByRole('combobox',{name:'Task labels',exact:true}).selectOption('auto');
    await page.getByText('Display settings',{exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.agent-3d-person[data-bubble-size="full"]'));
    assert((await page.locator('.agent-3d-person[data-bubble-size="full"]').count())<=3);
    const label=page.locator('[data-node-id="demo-cafe-ui"] .agent-node-select');await label.focus();
    await page.waitForFunction(()=>document.querySelector('[data-node-id="demo-cafe-ui"]').dataset.bubbleSize==='full');
    await page.locator('#agent-viewport').focus();
    passed.push('R2: adaptive/quiet labels reduce clutter while keyboard inspection reveals the task');
  }
  if(round>=3){
    await page.getByText('Display settings',{exact:true}).click();
    await page.getByRole('combobox',{name:'Relationship display',exact:true}).selectOption('inspect');
    assert.equal((await state(page)).visibleRelationships,0);
    const point=await page.evaluate(()=>window.CodexAgentOffice.screenPoint('demo-cafe-copy'));
    await page.mouse.move(point.x,point.y);await page.waitForFunction(()=>window.CodexAgentOffice.debug().visibleRelationships>0);
    await page.mouse.move(5,5);
    await page.getByRole('combobox',{name:'Relationship display',exact:true}).selectOption('active');
    d=await state(page);assert.equal(d.visibleRelationships,d.edges.filter(e=>['working','waiting_agents','waiting_user'].includes(e.state)).length);
    await page.getByRole('combobox',{name:'Relationship display',exact:true}).selectOption('all');
    assert.equal((await state(page)).visibleRelationships,initial.edges.length);
    await page.getByText('Display settings',{exact:true}).click();
    passed.push('R3: relationship layers change visibility, not identity or downstream activity semantics');
  }
  if(round>=4){
    await page.locator('#agent-roster>summary').click();
    assert.equal(await page.locator('[data-roster-agent]').count(),ids.length);
    await page.getByRole('button',{name:'Inspect employee: Remy',exact:true}).click();
    assert.equal(await page.locator('#agent-detail').getAttribute('data-selected-agent'),'demo-cafe-copy');
    assert.equal(await page.locator('#agent-roster').getAttribute('open'),null);
    await page.getByRole('button',{name:'Close agent details',exact:true}).click();
    await page.locator('#agent-roster>summary').click();await page.locator('#agent-roster-panel').getByRole('button',{name:'Frame workspace: Orbit Notes',exact:true}).click();
    assert.deepEqual((await state(page)).actors.map(a=>a.id),ids);
    await page.locator('#agent-roster>summary').click();await page.keyboard.press('Escape');assert.equal(await page.locator('#agent-roster').getAttribute('open'),null);
    await page.getByRole('button',{name:'Fit canvas',exact:true}).click();
    passed.push('R4: workspace navigator locates projects and opens real employee details, with Escape support');
  }
  if(round>=5){
    await page.getByText('Display settings',{exact:true}).click();await page.getByRole('combobox',{name:'3D quality',exact:true}).selectOption('auto');await page.getByText('Display settings',{exact:true}).click();
    for(let i=0;i<28;i++)fixture.graph.nodes.push({...fixture.graph.nodes[1],id:'round5-crowd-'+i,usage_key:'round5-crowd-'+i,status:'idle',status_label:'本轮已结束',title:'Fictional crowd member '+i,agent_name:'Crew '+i});
    await page.getByRole('button',{name:'Refresh status',exact:true}).click();await page.waitForFunction(()=>window.CodexAgentOffice.debug().actors.length===36);
    await page.getByRole('button',{name:'Fit canvas',exact:true}).click();await page.waitForFunction(()=>window.CodexAgentOffice.debug().quality.effective==='balanced');
    const adaptive=await state(page);assert.equal(adaptive.quality.contactShadows,false);
    await page.getByText('Display settings',{exact:true}).click();await page.getByRole('combobox',{name:'3D quality',exact:true}).selectOption('high');await page.getByText('Display settings',{exact:true}).click();
    await page.waitForFunction(()=>window.CodexAgentOffice.debug().quality.contactShadows);
    const high=await state(page);assert.deepEqual(high.camera,adaptive.camera);
    await page.getByText('Display settings',{exact:true}).click();await page.getByRole('combobox',{name:'3D quality',exact:true}).selectOption('auto');await page.getByRole('combobox',{name:'Canvas camera',exact:true}).selectOption('desk');await page.getByText('Display settings',{exact:true}).click();
    await page.waitForFunction(()=>window.CodexAgentOffice.debug().quality.effective==='high');
    for(const width of [320,390,768]){
      await page.setViewportSize({width,height:844});
      for(const mode of ['office','prison']){
        await page.locator('[data-agent-scene="'+mode+'"]').click();await page.waitForFunction(mode=>window.CodexAgentOffice.debug().mode===mode,mode);
        for(const id of ['agent-roster','agent-display-controls']){
          await page.locator('#'+id+'>summary').click();const box=await page.locator('#'+id+' > div').boundingBox();assert(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=844,JSON.stringify({width,mode,id,box}));await page.keyboard.press('Escape');
        }
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
    }
    await page.setViewportSize({width:1440,height:1000});await page.locator('[data-agent-scene="office"]').click();
    await page.getByText('Display settings',{exact:true}).click();await page.getByRole('combobox',{name:'Canvas camera',exact:true}).selectOption('iso');await page.getByText('Display settings',{exact:true}).click();
    passed.push('R5: adaptive crowd rendering restores close-up fidelity; both popovers fit 320/390/768px in both scenes');
    console.log('Render sample',JSON.stringify({adaptive:adaptive.render,high:high.render}));
  }
  fs.mkdirSync(path.join(root,'work'),{recursive:true});await page.screenshot({path:path.join(root,`work/canvas-round-${round}.png`)});
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({round,passed,errors,externalRequests:external.length},null,2));
}finally{await browser?.close();if(server.listening)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
