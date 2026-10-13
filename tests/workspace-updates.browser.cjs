// Fictional data: calendar freshness, real refresh action, attention, avatars and Space pan.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const fixture=JSON.parse(execFileSync('python3',['-m','tests.render_docs_fixture'],{cwd:root,maxBuffer:32e6,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
const original=JSON.parse(fixture.html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const now=Date.parse(original.generated_at)+3*86400000;
for(const n of fixture.graph.nodes)n.last_activity_at=now/1000;
Object.assign(fixture.graph.nodes.find(n=>n.id==='demo-cafe-main'),{status:'failed',status_label:'本轮失败',status_reason:'虚构测试失败，需要查看结果',current_activity:'本轮失败'});
Object.assign(fixture.graph.nodes.find(n=>n.id==='demo-cafe-copy'),{status:'interrupted',status_label:'已中断',status_reason:'虚构回合已中断',current_activity:'已中断'});
let job={available:true,status:'idle',revision:0,edit_token:'fixture-token'},updates=0,checks=0;
const errors=[],external=[],passed=[];
const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 if(req.url.startsWith('/api/agents'))res.end(JSON.stringify(fixture.graph));
 else if(req.url==='/api/usage-refresh'){
  if(req.method==='POST'){assert.equal(req.headers['x-workspace-token'],'fixture-token');updates++;checks=0;job={...job,status:'running',revision:job.revision+1};res.statusCode=202;}
  else if(job.status==='running'&&++checks>=2)job.status='succeeded';
  res.end(JSON.stringify(job));
 }else{res.setHeader('Content-Type','text/html');res.end(fixture.html);}
});
const world=page=>page.evaluate(()=>window.CodexAgentOffice.debug());
async function ready(page,mode='office'){await page.waitForFunction(m=>window.CodexAgentOffice?.debug().ready==='true'&&window.CodexAgentOffice.debug().mode===m,mode);}
async function drag(page,space=true){
 const box=await page.locator('.agent-three-canvas').boundingBox(),x=box.x+box.width*.45,y=box.y+box.height*.68;
 await page.mouse.move(x,y);if(space)await page.keyboard.down('Space');
 await page.mouse.down();await page.mouse.move(x+80,y-25,{steps:6});await page.mouse.up();if(space)await page.keyboard.up('Space');
}
(async()=>{let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(({now})=>{const ActualDate=Date;window.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};try{if(!localStorage.getItem('codex-agent-canvas-v2'))localStorage.setItem('codex-agent-canvas-v2',JSON.stringify({scene:'office',window:'current'}));}catch(_){}},{now});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin))external.push(r.url());});
 await page.goto(origin+'/codex-usage-report.html#page=overview&lang=en');
 await page.locator('#scope').selectOption('yesterday');
 const date=new Date(now),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(now-86400000));
 assert.equal(await page.locator('#overallRange').textContent(),day+' — '+day);
 assert(await page.locator('#usage-freshness').isVisible());
 await page.reload();assert.equal(await page.locator('#scope').inputValue(),'yesterday');
 await page.waitForFunction(()=>!document.getElementById('refresh-usage').disabled);
 const loaded=page.waitForEvent('load');await page.locator('#refresh-usage').click();await loaded;
 assert.equal(updates,1);assert.equal(await page.locator('#scope').inputValue(),'yesterday');
 passed.push('Relative dates use the real configured calendar; refresh scans once and reloads while preserving scope');
 await page.getByRole('button',{name:'Agent canvas',exact:true}).click();await ready(page);
 await page.locator('#agent-attention-toggle').click();
 assert.equal(await page.locator('[data-attention-agent]').count(),3);
 const waiting=page.locator('[data-attention-agent="demo-cafe-access"]');await waiting.getByRole('button',{name:'Mark viewed',exact:true}).click();
 assert.equal(await page.locator('[data-attention-agent]').count(),2);
 await page.locator('#attention-scope').selectOption('all');assert.equal(await page.locator('[data-attention-agent]').count(),3);
 await waiting.getByRole('button',{name:'Mark pending',exact:true}).click();await page.locator('#attention-scope').selectOption('pending');
 await page.locator('[data-attention-agent="demo-cafe-main"]').getByRole('button',{name:'Snooze 15 minutes',exact:true}).click();
 assert.equal(await page.locator('[data-attention-agent]').count(),2);
 await page.locator('[data-attention-agent="demo-cafe-copy"]').getByRole('button',{name:'Locate desk',exact:true}).click();
 assert.equal(await page.locator('#agent-detail').getAttribute('data-selected-agent'),'demo-cafe-copy');
 await page.locator('#attention-close').click();
 passed.push('Attention includes waiting-user, failure and interruption; viewed/snoozed records can be restored and located');
 await page.locator('#agent-custom-details>summary').click();
 await page.locator('#custom-species').selectOption('cow');await page.locator('#custom-shirt').selectOption('#8f4850');
 await page.locator('#custom-nickname').fill('Cow QA');await page.locator('#custom-desk').selectOption('plant');await page.locator('#custom-project-color').selectOption('#719fc4');
 await page.getByRole('button',{name:'Save appearance',exact:true}).click();
 await page.waitForFunction(()=>{const a=window.CodexAgentOffice.debug().actors.find(a=>a.id==='demo-cafe-copy');return a.avatarSpecies==='cow'&&a.appearance.nickname==='Cow QA';});
 let a=(await world(page)).actors.find(a=>a.id==='demo-cafe-copy');assert.equal(a.appearance.shirt,0x8f4850);assert.equal(a.teamColor,'#719fc4');assert.equal(a.appearance.desk,'plant');
 assert((await world(page)).features['custom-plant-leaf']>=5);assert.equal((await world(page)).features['custom-desk-name'],1);
 await page.locator('#custom-nickname').focus();await page.keyboard.press('Space');assert.notEqual(await page.locator('#agent-viewport').getAttribute('data-space-pan'),'true');
 await page.getByRole('button',{name:'Close agent details',exact:true}).click();
 for(const mode of ['office','prison']){
  await page.locator('[data-agent-scene="'+mode+'"]').click();await ready(page,mode);
  const before=await world(page);await drag(page);
  const after=await world(page);assert.notDeepEqual(after.target,before.target);
  const offsets=d=>d.camera.map((v,i)=>v-d.target[i]);assert(offsets(after).every((v,i)=>Math.abs(v-offsets(before)[i])<.001),'Space drag pans without rotating');
  assert.equal(await page.locator('#agent-viewport').getAttribute('data-space-pan'),'false');
  assert.equal(after.actors.find(a=>a.id==='demo-cafe-copy').avatarSpecies,'cow');
  const rotation=await world(page);await drag(page,false);assert.deepEqual((await world(page)).target,rotation.target,'Releasing Space restores rotate');
 }
 passed.push('Cow, outfit, nickname, project color and desk props persist in both themes; Space pans without rotating and releases cleanly');
 await page.reload();await ready(page,'prison');assert.equal((await world(page)).actors.find(a=>a.id==='demo-cafe-copy').appearance.nickname,'Cow QA');
 await page.locator('[data-agent-scene="graph"]').click();
 const node=page.locator('[data-node-id="demo-cafe-copy"] .agent-node-select');await node.scrollIntoViewIfNeeded();
 const nb=await node.boundingBox(),beforeGraph=await page.locator('#agent-world').getAttribute('style');
 await page.mouse.move(nb.x+30,nb.y+30);await page.keyboard.down('Space');await page.mouse.down();await page.mouse.move(nb.x+90,nb.y+60,{steps:5});await page.mouse.up();await page.keyboard.up('Space');
 assert.notEqual(await page.locator('#agent-world').getAttribute('style'),beforeGraph);assert(await page.locator('#agent-detail').isHidden());
 passed.push('Appearance survives reload; Space drags graph nodes without selecting them');
 await page.setViewportSize({width:390,height:844});await page.locator('#agent-attention-toggle').click();
 assert(await page.locator('#attention-list').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(root,'work/workspace-updates-attention-mobile.png')});
 await page.locator('#attention-close').click();await page.locator('[data-agent-scene="office"]').click();await ready(page);
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.CodexAgentOffice.focus('demo-cafe-copy'));
 const point=await page.evaluate(()=>window.CodexAgentOffice.screenPoint('demo-cafe-copy'));await page.mouse.click(point.x,point.y);await page.locator('#agent-custom-details>summary').click();
 await page.screenshot({path:path.join(root,'work/workspace-updates-custom-cow.png')});
 passed.push('New controls fit 390px and English/Chinese labels translate');
 await page.locator('#locale-switch').click();assert((await page.locator('#agent-attention-toggle').textContent()).includes('需要我处理'));
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log(JSON.stringify({passed,errors,externalRequests:external.length},null,2));
}catch(e){if(browser){const pages=browser.contexts().flatMap(c=>c.pages());if(pages[0])await pages[0].screenshot({path:path.join(root,'work/workspace-updates-failure.png')});}throw e;}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
