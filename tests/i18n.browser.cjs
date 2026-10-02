// Standalone language regressions using synthetic data only. See tests/README.md.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const fixture=JSON.parse(execFileSync(process.env.PYTHON||'python3',['-m','tests.render_browser_fixture'],{cwd:root,maxBuffer:32*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
const artifacts=path.join(root,'work');fs.mkdirSync(artifacts,{recursive:true});
const errors=[],passed=[];
const server=http.createServer((req,res)=>{
  if(req.url==='/api/agents'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture.graph));}
  else if(req.url.startsWith('/codex-usage-report.html')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture.html);}
  else{res.statusCode=404;res.end();}
});
const money=v=>'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/codex-usage-report.html`;
  const browser=await chromium.launch({channel:process.env.CODEX_TEST_BROWSER_CHANNEL==='chromium'?undefined:process.env.CODEX_TEST_BROWSER_CHANNEL||'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/i.test(m.text()))errors.push(m.text());});
  async function test(name,run){try{await run();passed.push(name);console.log('PASS '+name);}catch(e){await page.screenshot({path:path.join(artifacts,'i18n-failure.png'),fullPage:true}).catch(()=>{});throw e;}}
  const go=key=>page.locator(`#app-sidebar [data-page="${key}"]`).click();
  const language=()=>page.locator('#locale-switch').click();
  const scope=()=>page.evaluate(()=>{const p=new URLSearchParams(location.hash.slice(1));return Object.fromEntries(['page','start','end','project','model','detail','dimension','metric','sort','view','preset'].map(k=>[k,p.get(k)]));});
  try{
    await page.goto(base);
    await test('Chinese is the default and initial totals match synthetic data',async()=>{
      assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');assert.equal(await page.locator('#page-title').textContent(),'用量总览');
      assert.equal(await page.locator('#overallCalls').textContent(),fixture.total.calls.toLocaleString('zh-CN'));assert.equal(await page.locator('#overallSpend').textContent(),money(fixture.total.estimated_cost_usd));
    });
    await test('Switching preserves filters, values, route and untranslated project names',async()=>{
      await page.locator('#project').selectOption('总览');await page.locator('#model').selectOption('gpt-6.1-sol');
      const before=await scope(),cost=await page.locator('#overallSpend').textContent(),calls=await page.locator('#overallCalls').textContent();
      await language();assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.equal(await page.locator('#page-title').textContent(),'Usage overview');
      assert.deepEqual(await scope(),before);assert.equal(await page.locator('#overallSpend').textContent(),cost);assert.equal(await page.locator('#overallCalls').textContent(),calls);
      assert.equal(await page.locator('#project option:checked').textContent(),'总览');assert.equal(await page.locator('#model option:checked').textContent(),'gpt-6.1-sol');
      assert.match(await page.locator('#overallTokens').textContent(),/M$/);assert.equal(await page.locator('#scope option[value="today"]').textContent(),'Today');
      await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.deepEqual(await scope(),before);
      await page.locator('#reset-filters').click();
    });
    await test('English navigation, all pages, methodology and dimension labels are localized',async()=>{
      const titles={overview:'Usage overview',agents:'Agent workspace',projects:'Project spend',models:'Model usage',explore:'Explore',methods:'Data & methodology'};
      for(const [key,title]of Object.entries(titles)){await go(key);assert(await page.locator('#page-'+key).isVisible());assert.equal(await page.locator('#page-title').textContent(),title);}
      assert((await page.locator('.methods-content').textContent()).includes('Cache hit rate = cached input tokens / input tokens'));
      await go('explore');assert.equal(await page.locator('#dimension option[value="hour"]').textContent(),'Hour');assert.equal(await page.locator('#metric option[value="calls"]').textContent(),'Model continuations');
      await page.locator('[data-preset="heatmap"]').click();assert.equal(await page.locator('.heat-cell').count(),168);assert((await page.locator('.heatmap').textContent()).includes('Mon'));
      await page.locator('[data-view="table"]').click();assert((await page.locator('#explore-pagination').textContent()).includes('Previous'));
      await go('projects');await page.locator('#project-rows [data-project="总览"]').click();assert.equal(await page.locator('#page-title').textContent(),'Project details');
      assert.equal(await page.locator('#project-detail h2').first().textContent(),'总览');assert((await page.locator('#project-detail').textContent()).includes('Model contributions'));
      await language();assert.equal(await page.locator('#page-title').textContent(),'项目详情');assert.equal(await page.locator('#project-detail h2').first().textContent(),'总览');await language();
      await page.locator('#back-projects').click();await page.locator('#reset-filters').click();
    });
    await test('Tooltips, daily modal, unpriced states and validation work in both languages',async()=>{
      await go('overview');const bar=page.locator('#chartStatic .day-group[data-day]').last();await bar.hover();assert((await page.locator('#chartTooltip').textContent()).includes('Model continuations'));
      await bar.click();assert(await page.locator('#day-dialog').isVisible());await page.evaluate(()=>window.CodexI18n.setLocale('zh-CN'));assert((await page.locator('#day-dialog-content').textContent()).includes('模型续跑'));
      await page.evaluate(()=>window.CodexI18n.setLocale('en'));assert((await page.locator('#day-dialog-content').textContent()).includes('Model continuations'));await page.locator('#close-day').click();
      await page.locator('#project').selectOption('项目');assert.equal(await page.locator('#overallSpend').textContent(),'Unpriced');await language();assert.equal(await page.locator('#overallSpend').textContent(),'未计价');await language();
      await page.locator('#reset-filters').click();await page.locator('#scope').selectOption('custom');await page.locator('#start').fill('2026-10-03');await page.locator('#end').fill('2026-10-01');await page.locator('#global-filters').evaluate(el=>el.requestSubmit());
      assert.equal(await page.locator('#date-error').textContent(),'Start date cannot be after end date');
      await language();assert.equal(await page.locator('#date-error').textContent(),'开始日期不能晚于结束日期');assert.equal(await page.locator('#start').inputValue(),'2026-10-03');assert.equal(await page.locator('#end').inputValue(),'2026-10-01');
      await language();assert.equal(await page.locator('#date-error').textContent(),'Start date cannot be after end date');await page.locator('#reset-filters').click();
    });
    await test('Office, prison and graph retain selected agents, identities, tasks and organization across languages',async()=>{
      await go('agents');await page.waitForFunction(()=>document.getElementById('agent-connection-label').textContent.includes('Every'));
      assert.equal(await page.locator('#overallRange').evaluate(el=>getComputedStyle(el,'::before').content),'"Node usage · "');
      for(const scene of ['office','prison','graph']){
        await page.locator(`[data-agent-scene="${scene}"]`).click();if(scene!=='graph')await page.waitForFunction(()=>window.CodexAgentOffice?.debug().ready==='true');
        await page.locator('[data-select-agent="demo-main"]').click();
        if(scene!=='graph')await page.waitForFunction(()=>{const d=window.CodexAgentOffice.debug();return Math.hypot(...d.camera.map((x,i)=>x-d.target[i]))<=12.001;});
        const ids=await page.locator('[data-node-id]').evaluateAll(n=>n.map(x=>x.dataset.nodeId).sort()),before=await scope();
        const world=scene==='graph'?null:await page.evaluate(()=>window.CodexAgentOffice.debug());
        assert.equal(await page.locator('.agent-detail-title').textContent(),fixture.graph.nodes[0].title);assert.equal(await page.locator('.agent-detail-task').textContent(),fixture.graph.nodes[0].task_summary);
        assert.equal(await page.locator('#agent-detail img').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.fixtureXss)),false);
        assert((await page.locator('#agent-detail').textContent()).includes('Editing project files'));
        await language();assert.equal(await page.locator('#agent-detail').getAttribute('data-selected-agent'),'demo-main');assert.deepEqual(await scope(),before);
        assert.deepEqual(await page.locator('[data-node-id]').evaluateAll(n=>n.map(x=>x.dataset.nodeId).sort()),ids);assert.equal(await page.locator('.agent-detail-task').textContent(),fixture.graph.nodes[0].task_summary);
        await language();assert.equal(await page.locator('#agent-viewport').getAttribute('data-scene'),scene);
        if(world){const next=await page.evaluate(()=>window.CodexAgentOffice.debug());assert.deepEqual(next.actors.map(a=>a.appearance),world.actors.map(a=>a.appearance));assert(next.camera.every((v,i)=>Math.abs(v-world.camera[i])<1e-8),'Language changes must not reset the camera');}
        await page.locator('#agent-close-detail').click();
      }
      await page.locator('[data-agent-scene="office"]').click();await page.locator('#agent-pause').click();assert.equal(await page.locator('#agent-pause').textContent(),'Resume updates');
      await language();assert.equal(await page.locator('#agent-pause').textContent(),'继续更新');await language();assert.equal(await page.locator('#agent-pause').getAttribute('aria-pressed'),'true');
      await page.screenshot({path:path.join(artifacts,'codex-office-english-agents.png'),fullPage:true,animations:'disabled'});
    });
    await test('Six pages and the language control fit desktop and narrow screens in both languages',async()=>{
      for(const width of [320,390,768,1440])for(const lang of ['en','zh-CN']){
        await page.setViewportSize({width,height:1000});if(await page.locator('html').getAttribute('lang')!==lang)await language();
        for(const key of ['overview','agents','projects','models','explore','methods']){
          await go(key);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${key} overflows at ${width} in ${lang}`);
          if(lang==='en')assert(!/\p{Script=Han}/u.test(await page.locator('#workspace-mode').textContent()),'The shared live/snapshot status must update on every page');
          const b=await page.locator('#locale-switch').boundingBox();assert(b.x>=0&&b.x+b.width<=width,'Language control must remain reachable');
        }
      }
      if(await page.locator('html').getAttribute('lang')!=='en')await language();await go('overview');await page.mouse.move(1400,0);
      await page.screenshot({path:path.join(artifacts,'codex-office-english-overview.png'),fullPage:true});
    });
    await test('URL language overrides preferences, invalid language is ignored, and storage failures do not break switching',async()=>{
      await page.goto(base+'#page=overview&lang=zh-CN');assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');
      await page.goto(base+'#page=overview&lang=en');assert.equal(await page.locator('html').getAttribute('lang'),'en');
      const blocked=await browser.newContext();await blocked.addInitScript(()=>{Storage.prototype.getItem=function(){throw new Error('Storage blocked');};Storage.prototype.setItem=function(){throw new Error('Storage blocked');};});
      const p=await blocked.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'#lang=en');assert.equal(await p.locator('html').getAttribute('lang'),'en');
      await p.locator('#locale-switch').click();assert.equal(await p.locator('html').getAttribute('lang'),'zh-CN');await p.reload();assert.equal(await p.locator('html').getAttribute('lang'),'zh-CN');
      await p.goto(base+'#lang=not-a-language');assert.equal(await p.locator('html').getAttribute('lang'),'zh-CN');await blocked.close();
    });
    await test('Portable offline HTML switches languages without contacting a service',async()=>{
      const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-office-i18n-'));const file=path.join(dir,'report.html');fs.writeFileSync(file,fixture.html);
      const offline=await browser.newContext();const p=await offline.newPage();p.on('pageerror',e=>errors.push(e.message));
      const external=[];p.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
      await p.goto('file://'+file+'#page=overview&lang=en');assert.equal(await p.locator('#page-title').textContent(),'Usage overview');
      await p.locator('#locale-switch').click();assert.equal(await p.locator('#page-title').textContent(),'用量总览');
      await p.locator('#app-sidebar [data-page="agents"]').click();assert((await p.locator('#agent-connection-label').textContent()).includes('离线'));assert.deepEqual(external,[]);
      await offline.close();fs.unlinkSync(file);fs.rmdirSync(dir);
    });
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:passed.length,checks:passed,runtimeErrors:errors},null,2));
  }finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
