// NODE_PATH=<bundled node_modules> node tests/agent-canvas.browser.cjs
// Real accounting checks are read-only. Graph mutations use an isolated API fixture.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.CODEX_WORKBENCH_URL || 'http://127.0.0.1:8766/codex-usage-report.html';
const money = n => '$' + Number(n || 0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const passed=[],errors=[];
  const context=await browser.newContext({viewport:{width:1440,height:1080}});
  await context.addInitScript(()=>{if(!localStorage.getItem('codex-agent-canvas-v2')&&!localStorage.getItem('codex-agent-canvas-v1'))localStorage.setItem('codex-agent-canvas-v2',JSON.stringify({scene:'graph'}));});
  function watchErrors(p){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|VALIDATE_STATUS|WebGLProgram/i.test(m.text()))errors.push(m.text());});}
  const page=await context.newPage();watchErrors(page);let diagnosticPage=page;
  async function test(name,fn){try{await fn();passed.push(name);}catch(error){console.error('FAILED:',name,'; passed:',passed.length);await diagnosticPage.screenshot({path:require('node:path').resolve('work/agent-browser-failure.png'),fullPage:true}).catch(()=>{});throw error;}}
  try {
    await page.goto(base);
    const report=JSON.parse(await page.locator('#report-data').textContent());
    let referenceProject='',referenceMain='';
    async function expected(){
      const params=await page.evaluate(()=>Object.fromEntries(new URLSearchParams(location.hash.slice(1))));
      return report.analysis_rows.filter(r=>r.day>=params.start&&r.day<=params.end&&(!params.project||r.project===params.project)&&(!params.model||r.model===params.model)).reduce((a,r)=>({calls:a.calls+r.calls,cost:a.cost+r.estimated_cost_usd,known:a.known+r.known_price_calls}),{calls:0,cost:0,known:0});
    }
    async function checkKpis(){const t=await expected();assert.equal(await page.locator('#overallCalls').innerText(),t.calls.toLocaleString('zh-CN'));assert.equal(await page.locator('#overallSpend').innerText(),t.calls&&!t.known?'未计价':money(t.cost));}
    async function setGlobalFilter(label,value){
      if(!await page.getByLabel(label,{exact:true}).isVisible())await page.locator('#global-filter-menu>summary').click();
      await page.getByLabel(label,{exact:true}).selectOption(value);await page.keyboard.press('Escape');
    }
    async function resetGlobalFilters(){
      if(!await page.locator('#reset-filters').isVisible())await page.locator('#global-filter-menu>summary').click();
      await page.locator('#reset-filters').click();await page.keyboard.press('Escape');
    }
    const pages=['overview','agents','projects','models','explore','methods'];
    const sidebar=page.locator('#app-sidebar');
    await test('All six pages reuse one 64px navigation rail with one current-page state',async()=>{
      const rail=await sidebar.elementHandle();
      for(const key of pages){
        await sidebar.locator(`[data-page="${key}"]`).click();
        assert(await page.locator(`#page-${key}`).isVisible());
        assert.equal(await sidebar.count(),1);
        assert(await rail.evaluate(el=>el===document.getElementById('app-sidebar')),'Page switches must reuse the same component');
        assert.equal((await sidebar.boundingBox()).width,64);
        assert.equal((await page.locator('.main-shell').boundingBox()).x,64);
        assert.equal(await sidebar.locator('[aria-current="page"]').count(),1);
        assert.equal(await sidebar.locator('[aria-current="page"]').getAttribute('data-page'),key);
      }
      await rail.dispose();
      await sidebar.getByRole('button',{name:'总览',exact:true}).click();
    });
    await test('Icon names appear on hover and keyboard focus, including data methods',async()=>{
      for(const key of pages){
        const button=sidebar.locator(`[data-page="${key}"]`),hint=button.locator('.nav-label');
        assert(await button.getAttribute('aria-label'));
        await button.hover();assert(await hint.isVisible());
        const box=await hint.boundingBox();assert(box.x>=0&&box.x+box.width<=1440);
        await page.mouse.move(500,0);
        await page.keyboard.press('Tab');await button.focus();
        assert(await hint.isVisible(),'Keyboard users need the same name hint');
        assert.notEqual(await button.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
      }
      await page.getByLabel('时间范围',{exact:true}).focus();
      assert.equal(await sidebar.locator('.nav-label:visible').count(),0);
    });
    await test('Shared navigation and home logo preserve global project, model and date filters',async()=>{
      const sample=report.analysis_rows[0];
      await page.getByLabel('时间范围',{exact:true}).selectOption('overall');
      await setGlobalFilter('项目筛选',sample.project);
      await setGlobalFilter('模型筛选',sample.model);
      const scope=await page.evaluate(()=>{const p=new URLSearchParams(location.hash.slice(1));return ['start','end','project','model'].map(k=>p.get(k));});
      for(const key of pages){
        await sidebar.locator(`[data-page="${key}"]`).click();
        assert.deepEqual(await page.evaluate(()=>{const p=new URLSearchParams(location.hash.slice(1));return ['start','end','project','model'].map(k=>p.get(k));}),scope);
      }
      await sidebar.getByRole('link',{name:'Codex 工作台首页',exact:true}).click();
      assert(await page.locator('#page-overview').isVisible());await checkKpis();
      assert.deepEqual(await page.evaluate(()=>{const p=new URLSearchParams(location.hash.slice(1));return ['start','end','project','model'].map(k=>p.get(k));}),scope);
      await resetGlobalFilters();
      await page.mouse.move(500,0);
      await page.screenshot({path:require('node:path').resolve('work/shared-sidebar-overview.png'),fullPage:true});
    });
    await test('All six navigation entries fit narrow screens and remain usable after scrolling',async()=>{
      for(const width of [320,390,768]){
        await page.setViewportSize({width,height:844});
        for(const key of pages){
          const button=sidebar.locator(`[data-page="${key}"]`);assert(await button.isVisible());
          await button.click();assert(await page.locator(`#page-${key}`).isVisible());
          const box=await sidebar.boundingBox(),size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
          assert(size.scroll<=size.width,`${key} overflows at ${width}`);
          assert.equal(box.width,width<=680?width:64);
          if(width<=680){assert.equal(box.height,40);assert.equal((await page.locator('.main-shell').boundingBox()).x,0);}
        }
      }
      await page.setViewportSize({width:390,height:844});
      await sidebar.getByRole('button',{name:'数据与口径',exact:true}).click();
      await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
      assert.equal((await sidebar.boundingBox()).y,0,'Navigation should remain accessible while scrolling');
      const methods=sidebar.getByRole('button',{name:'数据与口径',exact:true});
      await methods.hover();const hint=await methods.locator('.nav-label').boundingBox();assert(hint.x>=0&&hint.x+hint.width<=390);
      await sidebar.getByRole('button',{name:'总览',exact:true}).click();await page.evaluate(()=>scrollTo(0,0));await page.mouse.move(200,500);
      await page.screenshot({path:require('node:path').resolve('work/shared-sidebar-mobile.png'),fullPage:true});
      await page.setViewportSize({width:1440,height:1080});
    });
    await test('Existing six date presets preserve accounting totals',async()=>{
      for(const preset of ['today','yesterday','7d','30d','90d','overall']){await page.getByLabel('时间范围',{exact:true}).selectOption(preset);await checkKpis();}
      await resetGlobalFilters();
    });
    await test('GPT-6.1 Sol usage has complete price coverage in overview, models and methods',async()=>{
      const rows=report.analysis_rows.filter(r=>r.model==='gpt-6.1-sol');assert(rows.length>0);
      assert(rows.every(r=>r.known_price_calls===r.calls&&r.unknown_price_calls===0&&r.unknown_price_tokens===0));
      await page.getByLabel('时间范围',{exact:true}).selectOption('overall');
      await setGlobalFilter('模型筛选','gpt-6.1-sol');
      await checkKpis();assert.notEqual(await page.locator('#overallSpend').innerText(),'未计价');
      await sidebar.getByRole('button',{name:'模型',exact:true}).click();
      assert.equal(await page.locator('.model-card').count(),1);
      assert.equal(await page.locator('.model-card .pill').innerText(),'已匹配价格');
      const totals=await expected();assert((await page.locator('.model-amount').innerText()).includes(money(totals.cost)));
      await page.screenshot({path:require('node:path').resolve('work/gpt-6.1-sol-pricing.png'),fullPage:true,animations:'disabled'});
      await sidebar.getByRole('button',{name:'数据与口径',exact:true}).click();
      assert.equal(await page.locator('#unpriced-models').innerText(),'当前范围没有未计价用量。');
      assert((await page.locator('#data-status').innerText()).includes('0 次续跑未计价'));
      await resetGlobalFilters();
      await sidebar.getByRole('button',{name:'总览',exact:true}).click();
    });
    await test('Existing project/model/explorer pages and missing-price states remain usable',async()=>{
      for(const name of ['项目','模型','探索分析']){await page.locator('#primary-navigation').getByRole('button',{name,exact:true}).click();assert(await page.locator('.page-panel:not([hidden])').isVisible());}
      const missing=report.analysis_rows.find(r=>r.unknown_price_calls&&!r.known_price_calls);
      if(missing){await page.getByLabel('时间范围',{exact:true}).selectOption('overall');await setGlobalFilter('模型筛选',missing.model);await page.locator('#primary-navigation').getByRole('button',{name:'总览',exact:true}).click();await checkKpis();assert.equal(await page.locator('#overallSpend').innerText(),'未计价');}
      await resetGlobalFilters();
    });
    await test('Chart hover still contains Token, continuation count and equivalent amount',async()=>{
      await page.locator('#chartStatic .day-group[data-day]').first().hover();
      const text=await page.locator('#chartTooltip').innerText();assert(text.includes('总 Token')&&text.includes('模型续跑')&&text.includes('API 等价金额'));
    });
    await test('Real Agent canvas connects and fits multiple projects within the viewport',async()=>{
      await page.locator('#primary-navigation').getByRole('button',{name:'Agent 画布',exact:true}).click();
      await page.waitForFunction(()=>document.getElementById('agent-connection-label').textContent.includes('秒更新'));
      assert(await page.locator('.agent-node').count()>0);
      const box=await page.locator('#agent-viewport').boundingBox();assert(box.y+box.height<=1080,'Canvas extends beyond the first screen');
      assert(box.height>=1080*.8,'Canvas should occupy at least 80% of the screen height');
      await page.screenshot({path:require('node:path').resolve('work/agent-canvas-desktop.png'),fullPage:true});
    });
    await test('Recent sessions preserve visible organization and expand all default branches',async()=>{
      const live=await (await page.request.get(new URL('/api/agents',base).href)).json();
      const visible=new Set(await page.locator('.agent-node').evaluateAll(nodes=>nodes.map(n=>n.dataset.nodeId)));
      const candidates=live.nodes.filter(n=>visible.has(n.id)&&n.kind==='session');assert(candidates.length>0,'This local check requires a recent primary chat');
      const root=candidates.find(n=>live.nodes.some(c=>!c.archived&&(c.parent_agent_id===n.id||c.business_parent_id===n.id)))||candidates[0];
      referenceProject=root.project;referenceMain=root.id;await setGlobalFilter('项目筛选',referenceProject);
      const ids=new Set(await page.locator('.agent-node').evaluateAll(nodes=>nodes.map(n=>n.dataset.nodeId)));
      for(const button of await page.locator('[data-expand-agent]').all())assert.equal(await button.getAttribute('aria-expanded'),'true');
      for(const n of live.nodes){const parent=n.kind==='subagent'?n.parent_agent_id:n.business_parent_id;if(n.project===referenceProject&&!n.archived&&ids.has(parent))assert(ids.has(n.id),'An uncollapsed child is missing');}
      assert(await page.locator(`[data-node-id="${referenceMain}"]`).isVisible());
      await page.setViewportSize({width:1440,height:900});
      await page.screenshot({path:require('node:path').resolve('work/agent-canvas-project.png'),fullPage:true});
      await page.getByRole('button',{name:'进入专注画布',exact:true}).click();
      await page.screenshot({path:require('node:path').resolve('work/agent-canvas-project-focus.png'),fullPage:true});
      await page.getByRole('button',{name:'退出专注画布',exact:true}).click();
      await page.setViewportSize({width:1440,height:1080});
      await resetGlobalFilters();
    });
    await test('Office, prison and original graph preserve real employees, organization and global filters',async()=>{
      await setGlobalFilter('项目筛选',referenceProject);
      const identities=await page.locator('.agent-node').evaluateAll(nodes=>nodes.map(n=>n.dataset.nodeId).sort());assert(identities.length>0);
      const primaryCount=await page.locator('.agent-node.session').count();
      const businessCount=await page.locator('.agent-edge.delegation').count(),nativeCount=await page.locator('.agent-edge.subagent').count();
      const scope=await page.evaluate(()=>{const p=new URLSearchParams(location.hash.slice(1));return ['start','end','project','model'].map(k=>p.get(k));});
      await page.setViewportSize({width:1440,height:900});
      for(const mode of ['office','prison','graph']){
        await page.locator(`[data-agent-scene="${mode}"]`).click();
        assert.equal(await page.locator('#agent-viewport').getAttribute('data-scene'),mode);
        assert.equal(await page.locator('.agent-scene-switch [aria-pressed="true"]').count(),1);
        assert.deepEqual(await page.locator('.agent-node').evaluateAll(nodes=>nodes.map(n=>n.dataset.nodeId).sort()),identities);
        if(mode==='graph'){
          assert.equal(await page.locator('.agent-edge.delegation').count(),businessCount);assert.equal(await page.locator('.agent-edge.subagent').count(),nativeCount);
          assert.equal(await page.locator('#agent-3d').isVisible(),false);
        }else{
          await page.waitForFunction(()=>document.getElementById('agent-3d').dataset.ready==='true');
          const world=await page.evaluate(()=>window.CodexAgentOffice.debug());
          assert.equal(world.actors.length,identities.length);assert.equal(world.projects.reduce((n,p)=>n+p.teams.length,0),primaryCount);
          assert.equal(world.edges.filter(e=>e.kind==='delegation').length,businessCount);assert.equal(world.edges.filter(e=>e.kind==='subagent').length,nativeCount);
          assert(world.render.triangles>1000&&world.render.calls>20,'The office must be actual rendered geometry');
          assert(world.actors.every(a=>a.meshCount>30));assert.equal(await page.locator('.scene-station').count(),0);
          assert.equal(world.features['articulated-person'],identities.length,'Furniture never creates fictitious agents');
          assert.equal(world.features['ownership-halo'],identities.length);
          if(mode==='office'){
            for(const name of ['coffee-bar','lounge','bookshelf','games-table','meeting-nook'])assert.equal(world.features[name],world.projects.length,`${name} must be real scene geometry`);
            assert.equal(world.features.beanbag,2*world.projects.length);assert.equal(world.features.book,16*world.projects.length);
            assert(world.actors.every(a=>!a.cell));assert.equal(world.lighting.background,'#e8eee6');
          }else{
            assert.equal(world.features['single-cell'],identities.length);assert.equal(world.features['cell-bed'],identities.length);
            assert(world.actors.every(a=>a.cell));assert.equal(world.lighting.background,'#121b24');
            assert(world.lighting.ambient<1&&world.lighting.sun<1&&world.lighting.localLights>0&&world.lighting.localLights<=6);
            assert.equal(world.features['coffee-bar'],undefined,'Prison does not reuse the casual office shell');
            assert.equal(await page.locator('#agent-window').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 51, 64)','Dark theme controls must retain readable contrast');
          }
          assert(world.edges.filter(e=>e.kind==='subagent').every(e=>e.color==='#63b5ca'&&e.apex>1.8));
          assert(world.edges.filter(e=>e.kind==='delegation').every(e=>e.color==='#d4a064'&&e.apex>2.5));
          assert(world.edges.every(e=>e.arrowVisible));assert(world.edges.filter(e=>e.state!=='working').every(e=>!e.flow),'Inactive relationships must not invent activity');
        }
        assert.deepEqual(await page.evaluate(()=>{const p=new URLSearchParams(location.hash.slice(1));return ['start','end','project','model'].map(k=>p.get(k));}),scope);
        await page.locator(`[data-select-agent="${referenceMain}"]`).click();
        assert((await page.locator('#agent-detail').innerText()).includes('独立会话 · 主 Agent'));
        await page.getByRole('button',{name:'关闭代理详情',exact:true}).click();await page.getByRole('button',{name:'适应画布',exact:true}).click();
        await page.mouse.move(1000,20);
        await page.screenshot({path:require('node:path').resolve(`work/agent-${mode}-project.png`),fullPage:true,animations:'disabled'});
      }
      for(const width of [320,390]){
        await page.setViewportSize({width,height:844});
        for(const mode of ['office','prison']){
          await page.locator(`[data-agent-scene="${mode}"]`).click();
          const box=await page.locator('#agent-viewport').boundingBox(),size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(size.scroll<=size.width);assert(box.y+box.height<=844);
          for(const button of await page.locator('.agent-scene-switch button').all()){const b=await button.boundingBox();assert(b.x>=0&&b.x+b.width<=width);}
          assert.equal((await page.evaluate(()=>window.CodexAgentOffice.debug())).actors.length,identities.length);
          if(width===390){await page.mouse.move(width-4,100);await page.screenshot({path:require('node:path').resolve(`work/agent-${mode}-mobile.png`),fullPage:true,animations:'disabled'});}
        }
      }
      await page.locator('[data-agent-scene="graph"]').click();await resetGlobalFilters();await page.setViewportSize({width:1440,height:1080});
    });
    await test('Agent and usage pages have no horizontal overflow on narrow screens',async()=>{
      for(const width of [390,768]){
        await page.setViewportSize({width,height:844});
        for(const name of ['Agent 画布','总览','项目','模型','探索分析']){
          await page.locator('#primary-navigation').getByRole('button',{name,exact:true}).click();
          const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(size.scroll<=size.width,`${name} overflows at ${width}`);
        }
      }
      await page.setViewportSize({width:390,height:844});await page.locator('#primary-navigation').getByRole('button',{name:'Agent 画布',exact:true}).click();
      await page.screenshot({path:require('node:path').resolve('work/agent-canvas-mobile.png'),fullPage:true});
      await page.setViewportSize({width:1440,height:1080});
    });

    await test('Visual theme preserves readable text contrast and unclipped KPI values',async()=>{
      const palette=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return Object.fromEntries(['--ink','--muted','--bg','--surface','--accent','--accent-soft','--amber','--amber-soft'].map(k=>[k,s.getPropertyValue(k).trim()]));});
      const lum=h=>{let hex=h.replace('#','');if(hex.length===3)hex=[...hex].map(x=>x+x).join('');assert(/^[0-9a-f]{6}$/i.test(hex),`Unsupported theme color ${h}`);const a=hex.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;};
      for(const [fg,bg]of [['--ink','--surface'],['--muted','--bg'],['--muted','--surface'],['--accent','--accent-soft'],['--amber','--amber-soft']]){
        const a=lum(palette[fg]),b=lum(palette[bg]),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert(ratio>=4.5,`${fg} against ${bg} contrast is ${ratio}`);
      }
      await sidebar.getByRole('button',{name:'总览',exact:true}).click();
      for(const width of [320,390,768,1440]){
        await page.setViewportSize({width,height:1080});
        assert(await page.locator('.kpi-value').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth)),`KPI amount clips at ${width}px`);
        await checkKpis();
      }
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await sidebar.locator('[aria-current="page"]').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
      await page.emulateMedia({reducedMotion:'no-preference'});
    });
    await test('Trend axes stay readable across overview, project details and explorer when resized',async()=>{
      for(const location of ['overview','project-detail','explore']){
        await sidebar.getByRole('button',{name:location==='overview'?'总览':location==='project-detail'?'项目':'探索分析',exact:true}).click();
        if(location==='project-detail')await page.locator('.project-link').first().click();
        if(location==='explore')await page.locator('.preset-list [data-preset="trend"]').click();
        const selector=location==='overview'?'#chartStatic':location==='project-detail'?'#detail-trend':'#explore-time-chart';
        const bars=await page.locator(selector+' .day-group').count();assert(bars>0);
        for(const width of [390,1440,320]){
          await page.setViewportSize({width,height:1080});
          await page.waitForFunction(s=>{const svg=document.querySelector(s+' .trend-svg');if(!svg)return false;const scale=svg.getScreenCTM().a,box=svg.getBoundingClientRect(),font=parseFloat(getComputedStyle(svg.querySelector('text')).fontSize);return Math.abs(box.width-svg.viewBox.baseVal.width)<1&&Math.abs(scale-1)<.025&&font*scale>=9.5&&box.height>=210;},selector);
          const layout=await page.locator(selector+' .trend-svg').evaluate(svg=>({scale:svg.getScreenCTM().a,font:parseFloat(getComputedStyle(svg.querySelector('text')).fontSize),height:svg.getBoundingClientRect().height}));
          assert(layout.font*layout.scale>=9.5,`${location} labels are too small at ${width}px: ${JSON.stringify(layout)}`);assert(layout.height>=210);
          assert.equal(await page.locator(selector+' .day-group').count(),bars,'Resizing must preserve every date and its hover target');
          await page.locator(selector+' .day-group').first().hover();assert((await page.locator('#chartTooltip').innerText()).includes('API 等价金额'));
        }
        if(location==='project-detail')await page.getByRole('button',{name:'返回项目列表',exact:true}).click();
      }
      await resetGlobalFilters();
      await page.locator('.preset-list [data-preset="project"]').click();
      await page.setViewportSize({width:1440,height:1080});
    });
    await test('Visual review snapshots cover every page on desktop and mobile',async()=>{
      for(const width of [1440,390]){
        await page.setViewportSize({width,height:1080});
        for(const key of pages){
          await sidebar.locator(`[data-page="${key}"]`).click();
          if(key==='agents')await page.waitForFunction(()=>document.getElementById('agent-connection-label').textContent.includes('秒更新'));
          await page.mouse.move(width/2,60);
          await page.screenshot({path:require('node:path').resolve(`work/polish-${key}-${width===1440?'desktop':'mobile'}.png`),fullPage:true,animations:'disabled'});
          const bounds=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));assert(bounds.content<=bounds.viewport);
        }
      }
      await page.setViewportSize({width:1440,height:1080});
    });
    await test('Polished explorer presets, project details, empty state and date dialog stay functional',async()=>{
      await sidebar.getByRole('button',{name:'探索分析',exact:true}).click();
      for(const key of ['cache','trend','heatmap','agents','unknown','project']){
        const preset=page.locator(`.preset-list [data-preset="${key}"]`);await preset.click();
        assert.equal(await preset.getAttribute('aria-pressed'),'true');
        assert.equal(await page.locator('.preset-list [aria-pressed="true"]').count(),1);
        assert.equal(await preset.locator('svg[aria-hidden="true"]').count(),1);
        await page.getByRole('button',{name:'表格',exact:true}).click();assert(await page.locator('#explore-table-wrap').isVisible());
        await page.getByRole('button',{name:'图表',exact:true}).click();assert(await page.locator('#explore-chart').isVisible());
      }
      await sidebar.getByRole('button',{name:'项目',exact:true}).click();
      await page.getByLabel('搜索项目',{exact:true}).fill('__no_matching_project__');assert(await page.locator('#projects-empty').isVisible());
      await page.getByLabel('搜索项目',{exact:true}).fill('');await page.locator('.project-link').first().click();assert(await page.locator('#project-detail').isVisible());
      await page.locator('#detail-trend .day-group').first().click();assert(await page.locator('#day-dialog').isVisible());
      assert(await page.locator('#day-dialog-content .summary-item').count()===3);
      await page.setViewportSize({width:390,height:844});
      const dialog=await page.locator('#day-dialog').boundingBox();assert(dialog.x>=0&&dialog.x+dialog.width<=390);
      await page.mouse.move(200,80);await page.screenshot({path:require('node:path').resolve('work/polish-date-dialog-mobile.png'),fullPage:true,animations:'disabled'});
      await page.getByRole('button',{name:'关闭当日明细',exact:true}).click();assert.equal(await page.locator('#day-dialog').isVisible(),false);
      await page.getByRole('button',{name:'返回项目列表',exact:true}).click();assert(await page.locator('#project-list').isVisible());
      await resetGlobalFilters();await page.setViewportSize({width:1440,height:1080});
    });

    const fixtureContext=await browser.newContext({viewport:{width:1440,height:1080}});
    await fixtureContext.addInitScript(()=>{if(!localStorage.getItem('codex-agent-canvas-v2')&&!localStorage.getItem('codex-agent-canvas-v1'))localStorage.setItem('codex-agent-canvas-v2',JSON.stringify({scene:'graph'}));});
    const fixture=await fixtureContext.newPage();watchErrors(fixture);diagnosticPage=fixture;
    const now=Date.now()/1000,sessionIndex=report.explorer.dimensions.indexOf('session'),dayIndex=report.explorer.dimensions.indexOf('day');
    const row=report.explorer.rows.find(r=>report.explorer.dictionaries.day[r[dayIndex]]>=report.start&&report.explorer.dictionaries.day[r[dayIndex]]<=report.end);
    const session=report.explorer.dictionaries.session[row[sessionIndex]],key=report.explorer.session_keys[session];
    let requestCount=0,unavailable=false;
    const node=(id,title,project,kind='session',parent=null,business=null)=>({id,usage_key:id==='a'?key:id,title,task_summary:title,task_source:'session_title',kind,model:'gpt-6.1-sol',reasoning_effort:'max',agent_name:id,agent_role:'worker',project,project_id:'/fixture/'+project,cwd:'/fixture/'+project,created_at:now-100,last_activity_at:now,status:'working',status_label:'执行中 · 记录观察',status_reason:'Fixture observation',current_activity:'执行测试任务',parent_agent_id:parent,owner_session_id:kind==='session'?id:'b',business_parent_id:business,created_by:id==='b'?'a':null,hierarchy_mode:'automatic',direct_subagent_count:id==='b'||id==='c'?1:0,archived:false});
    const data={observed_at:new Date().toISOString(),refresh_seconds:5,nodes:[node('a','总体编排','项目甲'),node('b','业务专项','项目甲','session',null,'a'),node('c','实现组件 <img src=x onerror="window.graphXss=true">','项目甲','subagent','b'),node('d','测试分支','项目甲','subagent','c'),node('f','并行项目','项目乙')],projects:[{id:'/fixture/项目甲',name:'项目甲'},{id:'/fixture/项目乙',name:'项目乙'}],warnings:[],capabilities:{can_edit:true},edit_token:'fixture-token',edges:[{source:'a',target:'b',kind:'created',provenance:'create_thread'},{source:'a',target:'b',kind:'delegation',provenance:'created_default'},{source:'b',target:'c',kind:'subagent'},{source:'c',target:'d',kind:'subagent'},{source:'a',target:'f',kind:'collaboration'}]};
    await fixture.route('**/api/agents',async route=>{requestCount++;await route.fulfill({status:unavailable?503:200,contentType:'application/json',body:JSON.stringify(unavailable?{error:'fixture disconnected'}:data)});});
    await fixture.route('**/api/hierarchy',async route=>{
      const value=route.request().postDataJSON(),n=data.nodes.find(n=>n.id===value.child_id),parent=value.mode==='automatic'?'a':value.parent_id;
      let cursor=parent,seen=new Set([n.id]);
      while(cursor){if(seen.has(cursor)){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'这会形成循环委托'})});return;}seen.add(cursor);cursor=data.nodes.find(n=>n.id===cursor)?.business_parent_id;}
      n.business_parent_id=parent;n.hierarchy_mode=value.mode;
      data.edges=data.edges.filter(e=>!(e.kind==='delegation'&&e.target===n.id));if(parent)data.edges.push({source:parent,target:n.id,kind:'delegation',provenance:value.mode});
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await fixture.goto(base+'#page=agents');
    await fixture.waitForFunction(()=>Boolean(document.querySelector('[data-node-id="a"]')));
    await test('Multiple projects, primary business sessions and recursively nested subagents',async()=>{
      assert.equal(await fixture.locator('.agent-project-region').count(),2);
      for(const id of ['a','b','c'])assert.equal(await fixture.locator(`[data-expand-agent="${id}"]`).getAttribute('aria-expanded'),'true');
      assert.equal(await fixture.locator('.agent-node').count(),5);
      assert.equal(await fixture.locator('.agent-edge.delegation').count(),1);
      assert.equal(await fixture.locator('.agent-edge.subagent').count(),2);
      await fixture.locator('[data-select-agent="b"]').click();assert((await fixture.locator('#agent-detail').innerText()).includes('独立会话 · 主 Agent'));
      await fixture.locator('[data-select-agent="c"]').click();assert((await fixture.locator('#agent-detail').innerText()).includes('会话内 Subagent'));assert.equal(await fixture.locator('#agent-hierarchy-form').count(),0);
      assert.equal(await fixture.evaluate(()=>Boolean(window.graphXss)),false);assert.equal(await fixture.locator('.agent-node img').count(),0);
      await fixture.getByRole('button',{name:'关闭代理详情'}).click();await fixture.getByRole('button',{name:'适应画布',exact:true}).click();
      await fixture.screenshot({path:require('node:path').resolve('work/agent-canvas-topology-fixture.png'),fullPage:true});
    });
    await test('Scene preference and employee appearance persist without changing primary or subagent identity',async()=>{
      await fixture.locator('[data-agent-scene="prison"]').click();
      await fixture.waitForFunction(()=>document.getElementById('agent-3d').dataset.ready==='true');
      const appearance=await fixture.evaluate(()=>window.CodexAgentOffice.debug().actors.find(a=>a.id==='b').appearance);
      await fixture.reload();await fixture.waitForFunction(()=>window.CodexAgentOffice?.debug().actors.some(a=>a.id==='b'));
      assert.equal(await fixture.locator('#agent-viewport').getAttribute('data-scene'),'prison');
      assert.deepEqual(await fixture.evaluate(()=>window.CodexAgentOffice.debug().actors.find(a=>a.id==='b').appearance),appearance);
      await fixture.locator('[data-select-agent="b"]').click();
      await fixture.locator('[data-agent-scene="graph"]').click();assert.equal(await fixture.locator('.agent-worker').count(),0);
      assert((await fixture.locator('#agent-detail').innerText()).includes('独立会话 · 主 Agent'));
      await fixture.locator('[data-agent-scene="office"]').click();assert.equal((await fixture.evaluate(()=>window.CodexAgentOffice.debug())).actors.length,5);
      assert.equal(await fixture.locator('[data-select-agent="b"]').getAttribute('aria-pressed'),'true');
      assert.equal(await fixture.locator('#agent-3d img').count(),0);assert((await fixture.locator('[data-select-agent="c"]').getAttribute('aria-label')).includes('<img'));
      assert.equal(await fixture.locator('[data-select-agent="c"]').getAttribute('title'),null,'The accessible name replaces duplicate native tooltips');
      assert.equal(await fixture.evaluate(()=>Boolean(window.graphXss)),false);
      await fixture.getByRole('button',{name:'关闭代理详情',exact:true}).click();
      await fixture.locator('[data-agent-scene="graph"]').click();
    });
    await test('Legacy expansion preferences never hide new branches; explicit collapse persists',async()=>{
      await fixture.evaluate(()=>{localStorage.removeItem('codex-agent-canvas-v2');localStorage.setItem('codex-agent-canvas-v1',JSON.stringify({expanded:[],window:'current'}));});
      await fixture.reload();await fixture.waitForFunction(()=>Boolean(document.querySelector('[data-node-id="d"]')));
      assert.equal(await fixture.locator('.agent-node').count(),5);
      await fixture.locator('[data-agent-scene="graph"]').click();
      await fixture.getByRole('button',{name:'折叠分支',exact:true}).click();assert.equal(await fixture.locator('.agent-node').count(),2);
      await fixture.getByRole('button',{name:'展开分支',exact:true}).click();assert.equal(await fixture.locator('.agent-node').count(),5);
      await fixture.locator('[data-expand-agent="b"]').click();assert.equal(await fixture.locator('.agent-node').count(),3);
      await fixture.reload();await fixture.waitForFunction(()=>Boolean(document.querySelector('[data-node-id="b"]')));
      assert.equal(await fixture.locator('[data-expand-agent="b"]').getAttribute('aria-expanded'),'false');
      await fixture.locator('[data-expand-agent="b"]').click();
      const extra=node('new','新发现的分支','项目甲','subagent','c');data.nodes.push(extra);data.edges.push({source:'c',target:'new',kind:'subagent'});
      await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>Boolean(document.querySelector('[data-node-id="new"]')));
      data.nodes.pop();data.edges.pop();await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>!document.querySelector('[data-node-id="new"]'));
      await fixture.locator('[data-agent-scene="graph"]').click();
    });
    await test('Completed organization stays visible; state and search filters keep their meaning',async()=>{
      for(const n of data.nodes){n.status='idle';n.status_label='本轮已结束';}
      await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>document.querySelector('[data-node-id="a"]')?.dataset.status==='idle');
      assert.equal(await fixture.locator('.agent-node').count(),5);assert.equal(await fixture.locator('.agent-edge-flow').count(),0);
      await fixture.getByLabel('代理状态').selectOption('working');assert.equal(await fixture.locator('.agent-node').count(),0);
      await fixture.getByLabel('代理状态').selectOption('');await fixture.getByLabel('搜索 Agent').fill('测试分支');
      assert.equal(await fixture.locator('.agent-node').count(),4,'Search should retain ancestors, not unrelated projects');
      await fixture.getByLabel('搜索 Agent').fill('');
      for(const n of data.nodes){n.status='working';n.status_label='执行中 · 记录观察';}
      await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>document.querySelector('[data-node-id="d"]')?.dataset.status==='working');
    });
    await test('Activity lines follow downstream observations, not the parent being busy',async()=>{
      const b=data.nodes.find(n=>n.id==='b'),c=data.nodes.find(n=>n.id==='c'),d=data.nodes.find(n=>n.id==='d');
      b.status='idle';c.status='idle';d.status='waiting_user';
      await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();
      await fixture.waitForFunction(()=>document.querySelector('[data-edge-target="b"]')?.dataset.activity==='waiting_user');
      assert.equal(await fixture.locator('.agent-edge-flow').count(),0,'A working ancestor must not animate idle descendants');
      assert.equal(await fixture.locator('.agent-edge.waiting_user').count(),3);
      d.status='working';await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();
      await fixture.waitForFunction(()=>document.querySelectorAll('.agent-edge-flow').length===3);
      await fixture.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await fixture.locator('.agent-edge-flow').first().evaluate(el=>getComputedStyle(el).animationName),'none');
      await fixture.emulateMedia({reducedMotion:'no-preference'});
      d.status='failed';await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();
      await fixture.waitForFunction(()=>document.querySelectorAll('.agent-edge.failed').length===3);assert.equal(await fixture.locator('.agent-edge-flow').count(),0);
      for(const n of [b,c,d]){n.status='working';n.status_label='执行中 · 记录观察';}
      await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>document.querySelectorAll('.agent-edge-flow').length===3);
    });
    await test('Employee gestures reflect their own observed status and honor pause and reduced motion',async()=>{
      await fixture.locator('[data-agent-scene="office"]').click();
      const b=data.nodes.find(n=>n.id==='b'),c=data.nodes.find(n=>n.id==='c'),d=data.nodes.find(n=>n.id==='d');
      b.status='idle';c.status='waiting_agents';d.status='failed';
      await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>document.querySelector('[data-node-id="d"]')?.dataset.status==='failed');
      await fixture.waitForFunction(()=>window.CodexAgentOffice?.debug().actors.find(a=>a.id==='a').motion==='typing');
      const world=await fixture.evaluate(()=>window.CodexAgentOffice.debug());
      for(const id of ['b','d'])assert.equal(world.actors.find(a=>a.id===id).motion,'none');
      assert.equal(world.actors.find(a=>a.id==='c').motion,'waiting');
      assert(world.edges.filter(e=>e.target==='b'||e.target==='c').every(e=>e.state==='waiting_agents'),'A working upstream parent must not override downstream waiting');
      assert.equal(world.edges.find(e=>e.target==='d').state,'failed');
      await fixture.emulateMedia({reducedMotion:'reduce'});
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().actors.every(a=>a.motion==='none'));
      assert.equal(await fixture.evaluate(()=>window.CodexAgentOffice.debug().motion),false);
      await fixture.emulateMedia({reducedMotion:'no-preference'});
      await fixture.getByRole('button',{name:'暂停更新',exact:true}).click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().actors.every(a=>a.motion==='none'));
      assert.equal(await fixture.evaluate(()=>window.CodexAgentOffice.debug().motion),false);
      for(const n of [b,c,d]){n.status='working';n.status_label='执行中 · 记录观察';}
      await fixture.getByRole('button',{name:'继续更新',exact:true}).click();await fixture.waitForFunction(()=>document.querySelector('[data-node-id="d"]')?.dataset.status==='working');
      await fixture.locator('[data-agent-scene="graph"]').click();
    });
    await test('Working employees have actual multi-joint motion, pulsing geometry and safe task bubbles',async()=>{
      await fixture.locator('[data-agent-scene="office"]').click();await fixture.mouse.move(1430,30);
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().actors.find(a=>a.id==='a')?.action==='typing');
      const initial=await fixture.evaluate(()=>window.CodexAgentOffice.debug().actors.find(a=>a.id==='a'));
      assert(initial.effects.visible&&initial.effects.strength>0);
      await fixture.waitForFunction(previous=>{const a=window.CodexAgentOffice.debug().actors.find(a=>a.id==='a');return a.action==='typing'&&Math.abs(a.joints.elbow[0]-previous.joints.elbow[0])>.025&&Math.abs(a.joints.wrist[0]-previous.joints.wrist[0])>.025&&Math.abs(a.effects.ringScale-previous.effects.ringScale)>.005;},initial);
      const moved=await fixture.evaluate(()=>window.CodexAgentOffice.debug().actors.find(a=>a.id==='a'));
      assert.notEqual(moved.joints.spine,initial.joints.spine);assert.notDeepEqual(moved.joints.head,initial.joints.head);
      const world=await fixture.evaluate(()=>window.CodexAgentOffice.debug());
      assert.equal(world.features['working-effects'],5);assert.equal(world.features['working-aura'],5);
      assert.equal(world.quality.character,'blender-skinned-glb');
      assert.equal(world.features.rig_elbow_L+world.features.rig_elbow_R,10);
      assert.equal(world.features.rig_wrist_L+world.features.rig_wrist_R,10);
      assert(world.actors.every(a=>a.effects.visible&&a.bubble.kind==='working'));
      for(const action of ['reviewing','using_mouse'])await fixture.waitForFunction(value=>window.CodexAgentOffice.debug().actors.find(a=>a.id==='a').action===value,action);
      assert.equal(await fixture.locator('.agent-bubble-task img').count(),0);assert.equal(await fixture.evaluate(()=>Boolean(window.graphXss)),false);
      assert((await fixture.locator('[data-node-id="c"] .agent-bubble-task').textContent()).includes('<img'));
      assert((await fixture.locator('[data-node-id="a"] .agent-bubble-activity').textContent()).includes('记录观察'));
      assert.equal(await fixture.locator('[data-node-id="a"] .agent-work-indicator i').first().evaluate(el=>getComputedStyle(el).animationName),'agent-work-dot');
      await fixture.getByRole('button',{name:'适应画布',exact:true}).click();
      const captions=await fixture.locator('.agent-3d-person[data-bubble="working"][data-bubble-size="full"]').all();assert(captions.length>0&&captions.length<=4);
      const rects=await Promise.all(captions.map(c=>c.boundingBox()));
      const strip=await fixture.locator('.agent-controls').boundingBox();assert(rects.every(r=>r.y>=strip.y+strip.height),'Task bubbles must remain below the scene controls');
      for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];assert(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y),'Default task bubbles should not overlap');}
      const compact=fixture.locator('.agent-3d-person[data-bubble="working"][data-bubble-size="compact"]').first();assert(await compact.count()>0);
      const id=await compact.getAttribute('data-node-id');await compact.locator('.agent-node-select').hover();
      await fixture.waitForFunction(id=>document.querySelector(`[data-node-id="${id}"]`)?.dataset.bubbleSize==='full',id);
      assert.equal(await fixture.locator(`[data-node-id="${id}"] .agent-bubble-task`).isVisible(),true);
      await fixture.mouse.move(1430,30);
      await fixture.locator(`[data-node-id="${id}"] .agent-node-select`).focus();
      await fixture.waitForFunction(id=>document.querySelector(`[data-node-id="${id}"]`)?.dataset.bubbleSize==='full',id);
      assert.equal(await fixture.locator(`[data-node-id="${id}"] .agent-bubble-task`).isVisible(),true);
      await fixture.locator('#agent-viewport').focus();
    });
    await test('Idle identity is revealed on inspection, while waiting and failed employees never glow green',async()=>{
      const b=data.nodes.find(n=>n.id==='b'),c=data.nodes.find(n=>n.id==='c'),d=data.nodes.find(n=>n.id==='d');
      b.status='idle';b.status_label='本轮已结束';c.status='waiting_agents';d.status='failed';
      await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().actors.find(a=>a.id==='b')?.status==='idle');await fixture.mouse.move(1430,30);
      await fixture.waitForFunction(()=>getComputedStyle(document.querySelector('[data-node-id="b"]')).opacity==='0');
      assert.equal(await fixture.locator('[data-node-id="b"] .agent-person-title').textContent(),'业务专项');
      await fixture.locator('[data-select-agent="b"]').focus();
      await fixture.waitForFunction(()=>getComputedStyle(document.querySelector('[data-node-id="b"]')).opacity==='1');
      assert.equal(await fixture.locator('[data-node-id="b"] .agent-person-title').isVisible(),true);
      await fixture.locator('#agent-viewport').focus();
      const world=await fixture.evaluate(()=>window.CodexAgentOffice.debug());
      for(const id of ['b','c','d'])assert.equal(world.actors.find(a=>a.id===id).effects.visible,false);
      assert.equal(world.actors.find(a=>a.id==='c').bubble.kind,'waiting');assert.equal(world.actors.find(a=>a.id==='d').bubble.kind,'failed');
      assert.equal(await fixture.locator('[data-node-id="c"] .agent-work-indicator').isVisible(),false);
      for(const n of [b,c,d]){n.status='working';n.status_label='执行中 · 记录观察';}
      await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().actors.every(a=>a.status==='working'));
    });
    await test('Reduced motion retains truthful static markers; pause, stale observations and completion stop all effects',async()=>{
      await fixture.emulateMedia({reducedMotion:'reduce'});
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().actors.every(a=>a.motion==='none'));
      let world=await fixture.evaluate(()=>window.CodexAgentOffice.debug());assert(world.actors.every(a=>a.effects.visible&&a.bubble.kind==='working'));
      const pausedJoints=world.actors.map(a=>a.joints);
      assert.equal(await fixture.locator('[data-node-id="a"] .agent-work-indicator i').first().evaluate(el=>getComputedStyle(el).animationName),'none');
      const received=fixture.waitForResponse(r=>r.url().endsWith('/api/agents'));await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await received;
      assert.deepEqual(await fixture.evaluate(()=>window.CodexAgentOffice.debug().actors.map(a=>a.joints)),pausedJoints);
      await fixture.emulateMedia({reducedMotion:'no-preference'});
      await fixture.getByRole('button',{name:'暂停更新',exact:true}).click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().observation==='paused');
      world=await fixture.evaluate(()=>window.CodexAgentOffice.debug());assert(world.actors.every(a=>a.motion==='none'&&!a.effects.visible&&a.bubble.kind==='recorded'));
      assert.equal(await fixture.locator('#agent-locate-working').isDisabled(),true);assert.equal(await fixture.locator('[data-node-id="a"] .agent-bubble-status').textContent(),'暂停观察');
      await fixture.getByRole('button',{name:'继续更新',exact:true}).click();await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().observation==='live');
      data.data_stale=true;await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().observation==='stale');
      assert((await fixture.evaluate(()=>window.CodexAgentOffice.debug())).actors.every(a=>!a.effects.visible&&a.motion==='none'));
      assert.equal(await fixture.locator('[data-node-id="a"] .agent-bubble-status').textContent(),'观察待确认');
      delete data.data_stale;for(const n of data.nodes){n.status='idle';n.status_label='本轮已结束';}
      await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().actors.every(a=>a.status==='idle'));
      world=await fixture.evaluate(()=>window.CodexAgentOffice.debug());assert(world.actors.every(a=>a.motion==='none'&&!a.effects.visible&&a.effects.strength===0&&a.bubble.kind==='none'));
      assert.equal(await fixture.locator('#agent-locate-working').isDisabled(),true);
      for(const n of data.nodes){n.status='working';n.status_label='执行中 · 记录观察';}
      await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().actors.every(a=>a.status==='working'));
    });
    await test('Locate working employees cycles through filtered real workers and expands their ancestors',async()=>{
      const filters=await fixture.evaluate(()=>{const p=new URLSearchParams(location.hash.slice(1));return ['start','end','project','model'].map(k=>p.get(k));});
      await fixture.getByLabel('搜索 Agent').fill('测试分支');
      assert.equal(await fixture.locator('#agent-locate-working').textContent(),'定位执行 · 1');
      await fixture.getByRole('button',{name:'折叠分支',exact:true}).click();
      await fixture.getByRole('button',{name:'定位正在执行的 Agent',exact:true}).click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().selected==='d');
      assert.equal(await fixture.locator('#agent-detail').getAttribute('data-selected-agent'),'d');assert.equal(await fixture.locator('[data-node-id="d"]').count(),1);
      await fixture.getByLabel('搜索 Agent').fill('');
      assert.equal(await fixture.locator('#agent-locate-working').textContent(),'定位执行 · 5');
      const seen=new Set();for(let i=0;i<5;i++){await fixture.getByRole('button',{name:'定位正在执行的 Agent',exact:true}).click();seen.add(await fixture.locator('#agent-detail').getAttribute('data-selected-agent'));}
      assert.deepEqual([...seen].sort(),['a','b','c','d','f']);
      assert.deepEqual(await fixture.evaluate(()=>{const p=new URLSearchParams(location.hash.slice(1));return ['start','end','project','model'].map(k=>p.get(k));}),filters);
      await fixture.getByRole('button',{name:'关闭代理详情',exact:true}).click();await fixture.getByRole('button',{name:'适应画布',exact:true}).click();await fixture.mouse.move(1430,30);
    });
    await test('Active scenes remain usable on narrow screens without overlapping bottom controls',async()=>{
      for(const width of [320,390,768]){
        await fixture.setViewportSize({width,height:844});
        for(const mode of ['office','prison']){
          await fixture.locator(`[data-agent-scene="${mode}"]`).click();await fixture.waitForFunction(mode=>window.CodexAgentOffice.debug().mode===mode&&window.CodexAgentOffice.debug().ready==='true',mode);
          const zoom=await fixture.locator('.agent-zoom').boundingBox(),legend=await fixture.locator('.agent-legend>summary').boundingBox();
          assert(zoom.x>=0&&zoom.x+zoom.width<=width);assert(!(zoom.x<legend.x+legend.width&&zoom.x+zoom.width>legend.x&&zoom.y<legend.y+legend.height&&zoom.y+zoom.height>legend.y),'Bottom controls overlap: '+JSON.stringify({width,mode,zoom,legend}));
          assert(await fixture.locator('#agent-locate-working').isEnabled());
          assert((await fixture.evaluate(()=>window.CodexAgentOffice.debug())).actors.every(a=>a.effects.visible));
          const size=await fixture.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(size.scroll<=size.width);
          if(width===390)await fixture.screenshot({path:require('node:path').resolve(`work/agent-working-${mode}-mobile-fixture.png`),fullPage:true});
        }
      }
      await fixture.setViewportSize({width:1440,height:1080});await fixture.locator('[data-agent-scene="office"]').click();await fixture.mouse.move(1430,30);
    });
    await test('Three-dimensional picking, orbit, keyboard pan and zoom use real scene geometry',async()=>{
      await fixture.locator('[data-agent-scene="office"]').click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice?.debug().actors.find(a=>a.id==='a').motion==='typing');
      const initial=await fixture.evaluate(()=>window.CodexAgentOffice.debug());
      assert.equal(initial.projects.length,2);assert.equal(initial.projects[0].teams.length,2);
      assert.equal(initial.actors.find(a=>a.id==='d').team,'b','A nested native worker belongs to its actual session workgroup');
      assert(initial.render.triangles>10000&&initial.actors.every(a=>a.meshCount>30));
      const point=await fixture.evaluate(()=>window.CodexAgentOffice.screenPoint('b'));assert(point.shown);
      await fixture.mouse.move(point.x,point.y);
      assert(await fixture.locator('#agent-3d-tooltip').isVisible());
      assert((await fixture.locator('#agent-3d-tooltip').innerText()).includes('业务专项'));
      await fixture.mouse.click(point.x,point.y);
      assert.equal(await fixture.locator('#agent-detail').getAttribute('data-selected-agent'),'b');
      await fixture.waitForFunction(()=>{const d=window.CodexAgentOffice.debug();return Math.hypot(...d.camera.map((x,i)=>x-d.target[i]))<=12.001;});
      await fixture.screenshot({path:require('node:path').resolve('work/agent-office-3d-closeup.png'),fullPage:true});
      await fixture.getByRole('button',{name:'关闭代理详情',exact:true}).click();
      await fixture.getByRole('button',{name:'适应画布',exact:true}).click();
      const before=await fixture.evaluate(()=>window.CodexAgentOffice.debug()),canvas=await fixture.locator('.agent-three-canvas').boundingBox();
      await fixture.mouse.move(canvas.x+canvas.width-45,canvas.y+canvas.height*.6);await fixture.mouse.down();
      await fixture.mouse.move(canvas.x+canvas.width-215,canvas.y+canvas.height*.5,{steps:8});await fixture.mouse.up();
      const rotated=await fixture.evaluate(()=>window.CodexAgentOffice.debug());
      assert.notDeepEqual(rotated.camera,before.camera,'Orbit must change the camera, not CSS-transform a picture');
      assert.deepEqual(rotated.actors.map(a=>a.position),before.actors.map(a=>a.position),'Rotating does not move employees or rewrite organization');
      await fixture.locator('#agent-viewport').focus();await fixture.keyboard.press('ArrowRight');
      assert.notDeepEqual((await fixture.evaluate(()=>window.CodexAgentOffice.debug())).target,rotated.target);
      const zoomBefore=await fixture.locator('#agent-zoom-label').innerText();await fixture.getByRole('button',{name:'放大画布'}).click();
      await fixture.waitForFunction(value=>document.getElementById('agent-zoom-label').textContent!==value,zoomBefore);
      const resources=await fixture.evaluate(()=>window.CodexAgentOffice.debug().memory);
      for(let i=0;i<3;i++){const previous=requestCount,received=fixture.waitForResponse(r=>r.url().endsWith('/api/agents'));await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await received;assert(requestCount>previous);}
      assert.deepEqual(await fixture.evaluate(()=>window.CodexAgentOffice.debug().memory),resources,'Unchanged observation updates reuse GPU resources');
      await fixture.getByRole('button',{name:'适应画布',exact:true}).click();
      await fixture.screenshot({path:require('node:path').resolve('work/agent-office-3d-fixture.png'),fullPage:true});
      await fixture.locator('[data-agent-scene="graph"]').click();
    });
    await test('Hover traces native ownership separately from primary-chat delegation, including nested subagents',async()=>{
      await fixture.locator('[data-agent-scene="office"]').click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice?.debug().ready==='true');
      await fixture.locator('#agent-collaboration').check();
      const initial=await fixture.evaluate(()=>window.CodexAgentOffice.debug());
      assert.equal(initial.features['casual-office'],2);assert.equal(initial.features.beanbag,4);
      const smallest=initial.projects.find(r=>r.id==='/fixture/项目乙');
      assert(smallest.width>=12&&smallest.depth>=11.8,'A one-person project still needs clearance for its leisure furniture');
      const b=initial.actors.find(a=>a.id==='b');
      for(const id of ['c','d'])assert.equal(initial.actors.find(a=>a.id===id).teamColor,b.teamColor);
      assert.equal(await fixture.locator('[data-node-id="b"] .agent-role-tag').innerText(),'主');
      assert.equal(await fixture.locator('[data-node-id="c"] .agent-role-tag').innerText(),'Sub');
      await fixture.locator('[data-node-id="c"] .agent-node-select').hover();
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().hovered==='c');
      let world=await fixture.evaluate(()=>window.CodexAgentOffice.debug());
      assert(world.edges.filter(e=>e.kind!=='collaboration').every(e=>e.highlighted&&e.opacity===1));
      const historical=world.edges.find(e=>e.kind==='collaboration');assert(!historical.highlighted&&historical.opacity===.13&&!historical.arrowVisible);
      assert.equal(await fixture.locator('[data-node-id="f"]').evaluate(el=>el.classList.contains('relation-dim')),true);
      assert((await fixture.locator('#agent-3d-tooltip').innerText()).includes('归属主 Agent：业务专项'));
      assert((await fixture.locator('#agent-3d-trace').innerText()).includes('主 Agent · 业务专项 → Subagent · c'));
      assert.equal(await fixture.locator('#agent-3d-trace img').count(),0);assert.equal(await fixture.evaluate(()=>Boolean(window.graphXss)),false);
      await fixture.locator('[data-node-id="d"] .agent-node-select').hover();
      assert((await fixture.locator('#agent-3d-trace').innerText()).includes('主 Agent · 业务专项 → Subagent · c → Subagent · d'));
      await fixture.mouse.move(1430,30);await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().hovered==='');
      assert.equal(await fixture.locator('#agent-3d-trace').isVisible(),false);
      await fixture.locator('#agent-collaboration').uncheck();
      await fixture.locator('[data-agent-scene="graph"]').click();
    });
    await test('Clicking relationship shortcuts locates actual owners, direct subagents and delegated primary chats',async()=>{
      await fixture.locator('[data-agent-scene="office"]').click();
      await fixture.locator('[data-node-id="d"] .agent-node-select').click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().selected==='d'&&window.CodexAgentOffice.debug().hovered==='');
      const panel=fixture.locator('#agent-detail');
      assert.equal(await panel.getAttribute('data-selected-agent'),'d');
      assert.equal(await panel.locator('[data-related-agent="b"][data-relation-kind="native"]').count(),1);
      assert.equal(await panel.locator('[data-related-agent="c"][data-relation-kind="native"]').count(),1);
      await panel.locator('[data-related-agent="b"]').click();
      assert.equal(await panel.getAttribute('data-selected-agent'),'b');
      assert((await panel.innerText()).includes('独立会话 · 主 Agent'));
      assert.equal(await panel.locator('[data-related-agent="a"][data-relation-kind="business"]').count(),1);
      assert.equal(await panel.locator('[data-related-agent="c"][data-relation-kind="native"]').count(),1);
      await panel.locator('[data-related-agent="a"]').click();
      assert.equal(await panel.getAttribute('data-selected-agent'),'a');
      assert.equal(await panel.locator('[data-related-agent="b"][data-relation-kind="business"]').count(),1);
      await fixture.getByRole('button',{name:'关闭代理详情'}).click();
      await fixture.locator('[data-agent-scene="graph"]').click();
    });
    await test('Dark single-person compartments preserve real identity, picking and bounded GPU resources',async()=>{
      await fixture.locator('[data-agent-scene="office"]').click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().ready==='true');
      const office=await fixture.evaluate(()=>window.CodexAgentOffice.debug());
      await fixture.locator('[data-agent-scene="prison"]').click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().mode==='prison'&&window.CodexAgentOffice.debug().ready==='true');
      const prison=await fixture.evaluate(()=>window.CodexAgentOffice.debug());
      assert.equal(prison.features['single-cell'],data.nodes.length);assert.equal(prison.features['cell-bed'],data.nodes.length);
      assert(prison.lighting.ambient<office.lighting.ambient&&prison.lighting.sun<office.lighting.sun);
      assert.deepEqual(prison.actors.map(a=>[a.id,a.team,a.teamColor]),office.actors.map(a=>[a.id,a.team,a.teamColor]));
      assert(prison.edges.every(e=>e.apex>2.8));
      const point=await fixture.evaluate(()=>window.CodexAgentOffice.screenPoint('b'));assert(point.shown);
      await fixture.mouse.click(point.x,point.y);
      assert.equal(await fixture.locator('#agent-detail').getAttribute('data-selected-agent'),'b','Cutaway walls must not intercept a visible employee');
      await fixture.getByRole('button',{name:'关闭代理详情'}).click();
      await fixture.getByRole('button',{name:'适应画布',exact:true}).click();
      await fixture.mouse.move(1430,30);
      await fixture.screenshot({path:require('node:path').resolve('work/agent-single-cells-fixture.png'),fullPage:true,animations:'disabled'});
      // First cycle initializes all shared materials; subsequent cycles must not accumulate textures/geometries.
      await fixture.locator('[data-agent-scene="office"]').click();await fixture.locator('[data-agent-scene="prison"]').click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().mode==='prison'&&window.CodexAgentOffice.debug().ready==='true');
      const memory=await fixture.evaluate(()=>window.CodexAgentOffice.debug().memory);
      for(let i=0;i<3;i++){
        await fixture.locator('[data-agent-scene="office"]').click();await fixture.locator('[data-agent-scene="prison"]').click();
        await fixture.waitForFunction(()=>window.CodexAgentOffice.debug().mode==='prison'&&window.CodexAgentOffice.debug().ready==='true');
        const current=await fixture.evaluate(()=>window.CodexAgentOffice.debug());
        assert.deepEqual(current.memory,memory);assert(current.lighting.localLights<=6);
      }
      await fixture.locator('[data-agent-scene="graph"]').click();
    });
    await test('Canvas focus, Escape, overlay details and world-locked grid maximize usable space',async()=>{
      const before=await fixture.locator('#agent-viewport').boundingBox();
      await fixture.getByRole('button',{name:'进入专注画布',exact:true}).click();
      const focused=await fixture.locator('#agent-viewport').boundingBox();assert(focused.width>before.width&&focused.height>before.height);
      assert(focused.height>1080*.94);assert.equal(await fixture.locator('#app-sidebar').isVisible(),false);
      await fixture.locator('#agent-viewport').focus();const gridBefore=await fixture.locator('#agent-viewport').evaluate(el=>getComputedStyle(el).backgroundPosition);
      await fixture.keyboard.press('ArrowRight');const gridAfter=await fixture.locator('#agent-viewport').evaluate(el=>getComputedStyle(el).backgroundPosition);assert.notEqual(gridBefore,gridAfter);
      const spacing=await fixture.locator('#agent-viewport').evaluate(el=>getComputedStyle(el).backgroundSize);
      await fixture.getByRole('button',{name:'放大画布'}).click();assert.notEqual(await fixture.locator('#agent-viewport').evaluate(el=>getComputedStyle(el).backgroundSize),spacing);
      await fixture.locator('[data-select-agent="b"]').click();const detailBox=await fixture.locator('#agent-viewport').boundingBox();assert.equal(detailBox.width,focused.width,'Details must overlay, not squeeze the canvas');
      await fixture.getByRole('button',{name:'关闭代理详情'}).click();await fixture.keyboard.press('Escape');
      assert.equal(await fixture.getByRole('button',{name:'进入专注画布',exact:true}).getAttribute('aria-pressed'),'false');assert(await fixture.locator('#app-sidebar').isVisible());
    });
    await test('Global period affects costs but never historicalizes current organization',async()=>{
      await fixture.locator('[data-select-agent="a"]').click();
      const assertCost=async()=>{
        const expected=await fixture.evaluate(key=>{const {records}=window.CodexWorkspace.scope(),r=window.CodexWorkspace.report;return records.filter(x=>r.explorer.session_keys[x.session]===key).reduce((v,x)=>({cost:v.cost+x.estimated_cost_usd,tokens:v.tokens+x.total_tokens,calls:v.calls+x.calls,known:v.known+x.known_price_calls}),{cost:0,tokens:0,calls:0,known:0});},key);
        assert((await fixture.locator('#agent-detail').innerText()).includes(expected.calls&&!expected.known?'未计价':money(expected.cost)));
      };
      await assertCost();await fixture.getByLabel('时间范围',{exact:true}).selectOption('today');await assertCost();assert.equal(await fixture.locator('.agent-node').count(),5);
      await fixture.getByRole('button',{name:'关闭代理详情'}).click();
    });
    await test('Collaboration toggles, keyboard pan, zoom, pause and resumption',async()=>{
      await fixture.locator('#agent-collaboration').check();assert.equal(await fixture.locator('.agent-edge.collaboration').count(),1);
      const before=await fixture.locator('#agent-world').getAttribute('style');await fixture.locator('#agent-viewport').focus();await fixture.keyboard.press('ArrowRight');assert.notEqual(await fixture.locator('#agent-world').getAttribute('style'),before);
      const scale=await fixture.locator('#agent-zoom-label').innerText();await fixture.getByRole('button',{name:'放大画布'}).click();assert.notEqual(await fixture.locator('#agent-zoom-label').innerText(),scale);
      await fixture.getByRole('button',{name:'暂停更新',exact:true}).click();assert.equal(await fixture.locator('#agent-pause').getAttribute('aria-pressed'),'true');
      assert.equal(await fixture.locator('.agent-edge-flow').count(),0,'Paused observations must stop the activity motion');
      const count=requestCount;await fixture.getByRole('button',{name:'缩小画布'}).click();await fixture.getByRole('button',{name:'适应画布',exact:true}).click();assert.equal(requestCount,count);
      await fixture.getByRole('button',{name:'继续更新',exact:true}).click();await fixture.waitForFunction(()=>document.getElementById('agent-pause').getAttribute('aria-pressed')==='false');
    });
    await test('Hierarchy editing preserves primary type and original creator; automatic reset works',async()=>{
      await fixture.getByRole('button',{name:'适应画布',exact:true}).click();await fixture.locator('[data-select-agent="b"]').click();
      await fixture.locator('#agent-hierarchy-details summary').click();await fixture.getByLabel('业务上级',{exact:true}).selectOption('f');await fixture.getByRole('button',{name:'保存业务层级'}).click();
      await fixture.waitForFunction(()=>document.getElementById('agent-hierarchy-message')?.textContent.includes('已保存'));
      const text=await fixture.locator('#agent-detail').innerText();assert(text.includes('独立会话 · 主 Agent')&&text.includes('并行项目')&&text.includes('总体编排'));
      await fixture.getByRole('button',{name:'恢复自动',exact:true}).click();await fixture.waitForFunction(()=>document.getElementById('agent-hierarchy-details')?.textContent.includes('按发起记录组织'));
      await fixture.getByRole('button',{name:'关闭代理详情'}).click();
    });
    await test('Stale records and disconnected service retain evidence instead of false running states',async()=>{
      data.nodes.find(n=>n.id==='d').last_activity_at=now-800;await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();
      await fixture.waitForFunction(()=>document.querySelector('[data-node-id="d"]')?.dataset.status==='unknown');
      unavailable=true;await fixture.getByRole('button',{name:'刷新状态',exact:true}).click();await fixture.waitForFunction(()=>document.getElementById('agent-connection-label').textContent.includes('连接中断'));
      assert.equal(await fixture.locator('.agent-node').count(),5);
      assert.equal(await fixture.locator('.agent-edge-flow').count(),0,'Disconnected observations must stop motion');
      await fixture.locator('[data-agent-scene="office"]').click();
      await fixture.waitForFunction(()=>window.CodexAgentOffice?.debug().ready==='true');
      assert.equal(await fixture.evaluate(()=>window.CodexAgentOffice.debug().motion),false);
      assert((await fixture.evaluate(()=>window.CodexAgentOffice.debug())).actors.every(a=>a.motion==='none'));
    });
    await fixtureContext.close();
    const offline=await browser.newContext();const plain=await offline.newPage();watchErrors(plain);diagnosticPage=plain;
    await test('Direct file opens preserve offline graph without external dependencies',async()=>{
      await plain.goto('file://'+require('node:path').resolve('codex-usage-report.html')+'#page=agents');
      assert((await plain.locator('#agent-connection-label').innerText()).includes('离线'));
      await plain.locator('.agent-legend > summary').click();
      assert.equal(await plain.locator('script[src]').count(),0);assert((await plain.locator('#agent-notice').innerText()).includes('run-workspace.command'));
      assert.equal(await plain.locator('.agent-edge-flow').count(),0);
      const controls=await plain.locator('.agent-controls').boundingBox(),legend=await plain.locator('.agent-legend-content').boundingBox();
      assert(legend.y>=controls.y+controls.height,'The scrollable legend must not cover scene controls');
      await plain.locator('[data-agent-scene="prison"]').click();assert.equal(await plain.locator('#agent-viewport').getAttribute('data-scene'),'prison');
      await plain.waitForFunction(()=>window.CodexAgentOffice?.debug().ready==='true');
      assert.equal(await plain.evaluate(()=>window.CodexAgentOffice.debug().motion),false);
      assert((await plain.evaluate(()=>window.CodexAgentOffice.debug())).actors.every(a=>a.motion==='none'&&!a.effects.visible));
    });
    await offline.close();assert.deepEqual(errors,[]);
    const fallbackContext=await browser.newContext();
    await fallbackContext.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /^webgl/.test(type)?null:original.call(this,type,...args);};});
    const fallback=await fallbackContext.newPage();fallback.on('pageerror',e=>errors.push(e.message));diagnosticPage=fallback;
    await test('Browsers without WebGL2 retain a clear, working graph fallback',async()=>{
      await fallback.goto(base+'#page=agents&lang=zh-CN&project='+encodeURIComponent(referenceProject));
      assert(await fallback.locator('#agent-3d-error').isVisible());
      assert((await fallback.locator('#agent-3d-error').innerText()).includes('WebGL2'));
      await fallback.getByRole('button',{name:'打开关系图',exact:true}).click();
      assert.equal(await fallback.locator('#agent-viewport').getAttribute('data-scene'),'graph');
      assert(await fallback.locator('.agent-node').count()>0);
      await fallback.locator(`[data-select-agent="${referenceMain}"]`).click();
      assert(await fallback.locator('#agent-detail').isVisible());
    });
    await fallbackContext.close();assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed,runtimeErrors:errors},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
