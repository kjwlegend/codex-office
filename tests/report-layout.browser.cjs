// Compact report chrome with fictional records, both languages and narrow widths.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),baseline=process.env.CODEX_LAYOUT_BASELINE==='1';
const fixture=JSON.parse(execFileSync('python3',['-m','tests.render_docs_fixture'],{cwd:root,maxBuffer:32e6,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
const report=JSON.parse(fixture.html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]),day=new Date(Date.parse(report.end+'T00:00:00Z')-3*86400000).toISOString().slice(0,10);
const errors=[],metrics=[],captures=[];
const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url.startsWith('/api/agents')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture.graph));}else if(req.url.startsWith('/api/')){res.statusCode=404;res.end('{}');}else{res.setHeader('Content-Type','text/html');res.end(fixture.html);}});
(async()=>{let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/codex-usage-report.html';
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,850,390,320]){
  await page.setViewportSize({width,height:1000});
  for(const name of ['overview','models']){
   await page.goto(url+'#page='+name+'&start='+day+'&end='+day+'&lang=en');await page.waitForFunction(name=>document.body.dataset.workspacePage===name&&!document.getElementById('page-'+name).hidden,name);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const m=await page.evaluate(name=>{const panel=document.getElementById('page-'+name),r=panel.getBoundingClientRect(),f=document.getElementById('global-filters').getBoundingClientRect();return {page:name,width:innerWidth,dataTop:Math.round(r.top),filtersHeight:Math.round(f.height),overflow:document.documentElement.scrollWidth>innerWidth};},name);
   metrics.push(m);const file=path.join(root,'work/report-layout-'+(baseline?'before':'after')+'-'+name+'-'+width+'.png');await page.screenshot({path:file,fullPage:false});captures.push(file);
   if(!baseline){assert.equal(m.overflow,false);assert(m.dataTop<=(width>=681?220:280),JSON.stringify(m));assert.equal(await page.locator('#custom-dates').isVisible(),false,'A saved custom range does not open the editor');}
  }
 }
 if(!baseline){
  await page.setViewportSize({width:1440,height:1000});await page.goto(url+'#page=overview&lang=en');
  const original=await page.locator('#overallTokens').textContent();
  await page.locator('#global-filter-menu>summary').click();await page.locator('#project').selectOption('Coffee Shop');
  assert.notEqual(await page.locator('#overallTokens').textContent(),original);assert((await page.locator('#filter-summary').textContent()).includes('Coffee Shop'));
  await page.locator('#close-global-filters').click();assert.equal(await page.locator('#global-filter-menu').getAttribute('open'),null);
  await page.locator('#global-filter-menu>summary').click();await page.locator('#model').selectOption('gpt-6.1-sol');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#global-filter-menu').getAttribute('open'),null);assert.equal(await page.locator('#filter-count').textContent(),'2');
  await page.locator('#edit-date-range').click();await page.locator('#start').fill(day);await page.locator('#end').fill(day);await page.getByRole('button',{name:'Apply dates',exact:true}).click();
  assert.equal(await page.locator('#custom-dates').isVisible(),false);assert.equal(await page.locator('#overallRange').textContent(),day+' — '+day);
  await page.reload();assert.equal(await page.locator('#custom-dates').isVisible(),false);assert.equal(await page.locator('#filter-count').textContent(),'2');
  await page.locator('#scope').selectOption('custom');assert(await page.locator('#custom-dates').isVisible());await page.keyboard.press('Escape');assert.equal(await page.locator('#custom-dates').isVisible(),false);
  await page.locator('#global-filter-menu>summary').click();await page.locator('#reset-filters').click();assert.equal(await page.locator('#filter-count').textContent(),'0');
  for(const width of [320,390,850,1440]){
   await page.setViewportSize({width,height:1000});
   for(const locale of ['en','zh-CN']){
    await page.evaluate(locale=>window.CodexI18n.setLocale(locale),locale);
    for(const name of ['overview','projects','models','explore','methods','agents']){
     await page.locator('#app-sidebar [data-page="'+name+'"]').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     await page.locator('#global-filter-menu>summary').click();const box=await page.locator('.global-filter-panel').boundingBox();assert(box.x>=0&&box.x+box.width<=width,JSON.stringify({width,name,box}));
     await page.keyboard.press('Escape');await page.locator('#edit-date-range').click();const dateBox=await page.locator('#custom-dates').boundingBox();assert(dateBox.x>=0&&dateBox.x+dateBox.width<=width);await page.keyboard.press('Escape');
    }
   }
  }
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({baseline,metrics,captures,errors},null,2));
}catch(e){if(browser){const p=browser.contexts()[0]?.pages()[0];if(p)await p.screenshot({path:path.join(root,'work/report-layout-failure.png')});}throw e;}
finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
