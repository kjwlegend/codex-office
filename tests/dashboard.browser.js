// Run this function with the Playwright browser_run_code tool against the local preview.
async (page) => {
  const base = 'http://127.0.0.1:8765/codex-usage-report.html';
  const failures = [], passed = [], runtimeErrors = [];
  const onError = error => runtimeErrors.push(error.message);
  page.on('pageerror', onError);
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const money = value => '$' + Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const integer = value => Math.round(value).toLocaleString('zh-CN');
  const go = name => page.locator('#primary-navigation').getByRole('button',{name,exact:true}).click();
  const reset = () => page.getByRole('button',{name:'重置',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base);
  const report = JSON.parse(await page.locator('#report-data').textContent());
  async function expected() {
    const params = await page.evaluate(() => Object.fromEntries(new URLSearchParams(location.hash.slice(1))));
    const rows = report.analysis_rows.filter(r => r.day >= params.start && r.day <= params.end && (!params.project || r.project === params.project) && (!params.model || r.model === params.model));
    return rows.reduce((t,r) => { for(const k of ['calls','total_tokens','estimated_cost_usd','known_price_calls']) t[k]+=r[k]; return t; },{calls:0,total_tokens:0,estimated_cost_usd:0,known_price_calls:0});
  }
  async function expectKpis() {
    const t=await expected();
    assert(await page.locator('#overallCalls').innerText()===integer(t.calls),'Global call count differs from original daily aggregates');
    assert(await page.locator('#overallSpend').innerText()===(t.calls&&!t.known_price_calls?'未计价':money(t.estimated_cost_usd)),'Global amount differs from original aggregates');
  }
  async function test(name, fn) {
    try { await fn(); passed.push(name); }
    catch(error) { failures.push({name,error:error.message}); await page.goto(base); }
  }
  await test('All six date presets match original accounting totals',async()=>{
    for(const scope of ['today','yesterday','7d','30d','90d','overall']) {
      await page.getByLabel('时间范围',{exact:true}).selectOption(scope); await expectKpis();
    }
    await reset();
  });
  await test('Date, project and model selections propagate through every page and metadata dimension',async()=>{
    const sample=report.analysis_rows.find(r=>r.calls&&r.known_price_calls===r.calls);
    assert(sample,'This optional check requires a fully priced project/model sample');
    await page.getByLabel('项目筛选').selectOption(sample.project);
    await page.getByLabel('模型筛选').selectOption(sample.model);
    await expectKpis();
    const t=await expected();
    await go('项目');assert(await page.locator('#project-rows tr').count()===1,'Project filter did not apply to leaderboard');
    assert((await page.locator('#project-rows').innerText()).includes(money(t.estimated_cost_usd)),'Leaderboard amount is not globally filtered');
    await go('模型');assert(await page.locator('.model-card').count()===1,'Model filter did not apply to model cards');
    await go('探索分析');await page.getByRole('button',{name:'表格',exact:true}).click();
    await page.getByRole('combobox',{name:'衡量指标',exact:true}).selectOption('calls');
    const dimensions=await page.locator('#dimension option').evaluateAll(options=>options.map(o=>o.value));
    for(const dimension of dimensions) {
      await page.getByRole('combobox',{name:'统计维度',exact:true}).selectOption(dimension);
      let sum=0;
      do {
        sum+=await page.locator('#explore-rows tr').evaluateAll(rows=>rows.reduce((n,r)=>n+Number(r.children[1]?.textContent.replaceAll(',','')||0),0));
        if(!await page.getByRole('button',{name:'下一页',exact:true}).isEnabled())break;
        await page.getByRole('button',{name:'下一页',exact:true}).click();
      } while(true);
      assert(sum===t.calls,'Metadata dimension '+dimension+' lost or leaked calls: '+sum+' vs '+t.calls);
    }
    await page.getByRole('button',{name:'数据与口径',exact:true}).click();
    assert((await page.locator('#data-status').innerText()).includes('100.0%'),'Data quality does not reflect filtered pricing coverage');
    await go('总览');await reset();
  });
  await test('Project details preserve the selected period, search and ranking on return',async()=>{
    await go('项目');await page.getByLabel('项目排序').selectOption('total_tokens');
    const sample=report.analysis_rows.find(r=>r.calls).project;
    await page.getByRole('searchbox',{name:'搜索项目'}).fill(sample);
    const before=await page.locator('#overallRange').innerText();
    await page.locator('#project-rows').getByRole('button',{name:sample+' ↗',exact:true}).click();
    assert(await page.locator('#project-detail').isVisible(),'Project detail not visible');
    assert(await page.getByLabel('项目筛选').inputValue()===sample,'Drilldown did not synchronize global project');
    assert(await page.locator('#overallRange').innerText()===before,'Drilldown changed selected period');
    await page.getByRole('button',{name:'返回项目列表'}).click();
    assert(await page.getByLabel('项目排序').inputValue()==='total_tokens','Sort order lost on return');
    assert(await page.getByRole('searchbox',{name:'搜索项目'}).inputValue()===sample,'Search lost on return');
    assert(await page.getByLabel('项目筛选').inputValue()==='','Global project not restored');
    await reset();await go('总览');
  });
  await test('Missing prices are shown as unpriced across overview, project, model and explorer',async()=>{
    const sample=report.analysis_rows.find(r=>r.calls&&!r.known_price_calls);
    assert(sample,'This optional check requires a wholly unpriced model');
    await page.getByLabel('项目筛选').selectOption(sample.project);
    await page.getByLabel('模型筛选').selectOption(sample.model);
    await expectKpis();assert(await page.locator('#overallSpend').innerText()==='未计价','Missing model price was rendered as $0');
    await go('项目');assert((await page.locator('#project-rows').innerText()).includes('未计价'),'Project shows no unpriced state');
    await go('模型');assert((await page.locator('#model-cards').innerText()).includes('未匹配价格'),'Model shows no unpriced state');
    await go('探索分析');await page.getByRole('button',{name:'项目投入',exact:true}).click();await page.getByRole('button',{name:'图表',exact:true}).click();
    assert((await page.locator('#explore-chart').innerText()).includes('未计价'),'Explorer shows no unpriced state');
    await reset();await go('总览');
  });
  await test('Daily chart supports pointer and keyboard details with exact daily totals',async()=>{
    const bar=page.locator('#chartStatic .day-group[data-day]').first();
    const day=await bar.getAttribute('data-day');
    const daily=report.rows.filter(r=>r.day===day).reduce((t,r)=>({calls:t.calls+r.calls,tokens:t.tokens+r.total_tokens}),{calls:0,tokens:0});
    await bar.hover();
    const tooltip=page.locator('#chartTooltip');
    assert(await tooltip.isVisible(),'Chart hover tooltip absent');
    const text=await tooltip.innerText();
    assert(text.includes(integer(daily.tokens))&&text.includes(integer(daily.calls))&&text.includes('API 等价金额'),'Tooltip missing required metrics or incorrect day total');
    await bar.focus();await page.keyboard.press('Enter');
    assert(await page.getByRole('dialog').isVisible(),'Keyboard did not open daily details');
    assert(await page.locator('#day-dialog-title').innerText()===day,'Wrong day opened');
    await page.getByRole('button',{name:'仅查看这一天'}).click();await expectKpis();
    assert(await page.locator('#overallRange').innerText()===`${day} — ${day}`,'Day filter did not apply globally');
    await reset();
  });
  await test('Custom dates validate, persist on reload and handle empty results',async()=>{
    await page.getByLabel('时间范围',{exact:true}).selectOption('custom');
    await page.getByLabel('开始日期',{exact:true}).fill('2026-09-08');await page.getByLabel('结束日期',{exact:true}).fill('2026-09-01');
    await page.getByRole('button',{name:'应用日期'}).click();assert(await page.getByRole('alert').innerText()==='开始日期不能晚于结束日期','Invalid dates accepted');
    await page.getByLabel('开始日期',{exact:true}).fill('2026-09-01');await page.getByLabel('结束日期',{exact:true}).fill('2026-09-03');
    await page.getByRole('button',{name:'应用日期'}).click();await expectKpis();await page.reload();await expectKpis();
    assert(await page.getByLabel('开始日期',{exact:true}).inputValue()==='2026-09-01','Date state did not survive reload');
    await page.getByLabel('开始日期',{exact:true}).fill('2030-01-01');await page.getByLabel('结束日期',{exact:true}).fill('2030-01-02');await page.getByRole('button',{name:'应用日期'}).click();
    assert(await page.locator('#overallCalls').innerText()==='0','Empty range contains calls');assert((await page.locator('#chartStatic').innerText()).includes('暂无用量'),'Empty chart missing explanation');
    await reset();
  });
  await test('Heatmap has 168 accessible cells and table view retains the complete hourly total',async()=>{
    await go('探索分析');await page.getByRole('button',{name:'使用时段',exact:true}).click();await page.getByRole('button',{name:'图表',exact:true}).click();
    assert(await page.locator('.heat-cell').count()===168,'Heatmap must contain 7 × 24 cells');
    await page.locator('.heat-cell').first().focus();assert(await page.locator('#chartTooltip').isVisible(),'Keyboard heatmap tooltip absent');
    await go('总览');
  });
  await test('Narrow screens keep global filters and navigation usable without page overflow',async()=>{
    for(const width of [390,768]) {
      await page.setViewportSize({width,height:844});
      for(const name of ['总览','项目','模型','探索分析']) {
        await go(name);
        const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
        assert(sizes.scroll<=sizes.width,'Horizontal page overflow at '+width+' on '+name);
        assert(await page.getByLabel('时间范围',{exact:true}).isVisible(),'Global date filter hidden on mobile');
      }
    }
    await page.setViewportSize({width:1440,height:1000});await go('总览');
  });
  await test('Snapshot remains readable without JavaScript or network dependencies',async()=>{
    const context=await page.context().browser().newContext({javaScriptEnabled:false});
    try {
      const plain=await context.newPage();await plain.goto(base);
      assert(await plain.locator('#overallCalls').innerText()===integer(report.total.calls),'Static KPI missing without JavaScript');
      assert(await plain.locator('noscript tbody tr').count()>0,'Static detail rows missing');
      assert(await plain.locator('script[src]').count()===0,'Snapshot depends on external scripts');
    } finally {await context.close();}
  });
  page.off('pageerror',onError);
  assert(!failures.length && !runtimeErrors.length,JSON.stringify({failures,runtimeErrors}));
  return {passed, runtimeErrors};
}
