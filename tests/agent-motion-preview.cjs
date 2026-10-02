// Read-only proof from real local observations; never injects workers or running states.
// NODE_PATH=<bundled node_modules> node tests/agent-motion-preview.cjs
const {chromium}=require('playwright');
const path=require('node:path');
const url=(process.env.CODEX_WORKBENCH_URL||'http://127.0.0.1:8766/codex-usage-report.html')+'#page=agents&lang=zh-CN';
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1200,height:800},recordVideo:{dir:path.resolve('work/agent-motion-recordings'),size:{width:1200,height:800}}});
  await context.addInitScript(()=>localStorage.setItem('codex-agent-canvas-v2',JSON.stringify({scene:'office',window:'current'})));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram|VALIDATE_STATUS/i.test(m.text()))errors.push(m.text());});
  let activeId=null;
  try{
    await page.goto(url);await page.waitForFunction(()=>window.CodexAgentOffice?.debug().observation==='live'&&window.CodexAgentOffice.debug().ready==='true');
    await page.mouse.move(1190,20);await page.screenshot({path:path.resolve('work/agent-working-office.png'),fullPage:true});
    activeId=await page.evaluate(()=>window.CodexAgentOffice.debug().actors.find(a=>a.status==='working')?.id);
    if(activeId){
      await page.getByRole('button',{name:'定位正在执行的 Agent',exact:true}).click();
      await page.waitForFunction(()=>{const d=window.CodexAgentOffice.debug();return Math.hypot(...d.camera.map((x,i)=>x-d.target[i]))<=12.001;});
      activeId=await page.locator('#agent-detail').getAttribute('data-selected-agent');
      await page.mouse.move(1190,20);
      for(const action of ['typing','reviewing','using_mouse'])await page.waitForFunction(({id,action})=>window.CodexAgentOffice.debug().actors.find(a=>a.id===id)?.action===action,{id:activeId,action});
      await page.screenshot({path:path.resolve('work/agent-working-office-closeup.png'),fullPage:true});
      await page.getByRole('button',{name:'关闭代理详情',exact:true}).click();
    }
    await page.locator('[data-agent-scene="prison"]').click();await page.waitForFunction(()=>window.CodexAgentOffice.debug().mode==='prison'&&window.CodexAgentOffice.debug().ready==='true');
    await page.mouse.move(1190,20);await page.screenshot({path:path.resolve('work/agent-working-prison.png'),fullPage:true});
    if(activeId){await page.getByRole('button',{name:'定位正在执行的 Agent',exact:true}).click();await page.waitForFunction(()=>{const d=window.CodexAgentOffice.debug();return Math.hypot(...d.camera.map((x,i)=>x-d.target[i]))<=12.001;});await page.mouse.move(1190,20);await page.screenshot({path:path.resolve('work/agent-working-prison-closeup.png'),fullPage:true});}
    console.log(JSON.stringify({activeId,runtimeErrors:errors,world:await page.evaluate(()=>{const d=window.CodexAgentOffice.debug();return {observation:d.observation,employees:d.actors.length,working:d.actors.filter(a=>a.effects.visible).length,triangles:d.render.triangles};})},null,2));
    if(errors.length)throw new Error('Scene runtime errors');
  }finally{const video=page.video();await context.close();console.log('VIDEO:',await video.path());await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
