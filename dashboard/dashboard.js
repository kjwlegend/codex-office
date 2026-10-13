(() => {
  'use strict';
  const i18n=window.CodexI18n, ui=i18n.ui;
  const report = JSON.parse(document.getElementById('report-data').textContent);
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const integer = i18n.integer;
  const compact = i18n.compact;
  const money = value => '$' + Number(value || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  const percent = value => (100 * (value || 0)).toFixed(1) + '%';
  const ratio = (a, b) => b ? a / b : 0;
  const shiftDay = (day, amount) => new Date(Date.parse(day + 'T00:00:00Z') + amount * 86400000).toISOString().slice(0, 10);
  const dayCount = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  const weekday = day => (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const weekdays = i18n.dictionary(['周一','周二','周三','周四','周五','周六','周日']);
  const colors = ['#197b68','#7eb49c','#7899b4','#aa9bc0','#c3a46d','#92a59a'];
  const modelIcon = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>';
  const numeric = report.explorer?.numeric || ['calls','cache_hit_calls','input_tokens','uncached_input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens','estimated_cost_usd','cache_savings_usd','cache_opportunity_usd','known_price_calls','unknown_price_calls','known_price_tokens','unknown_price_tokens'];
  const records = report.explorer ? report.explorer.rows.map(values => {
    const row = {};
    report.explorer.dimensions.forEach((key, i) => { row[key] = report.explorer.dictionaries[key][values[i]]; });
    numeric.forEach((key, i) => { row[key] = values[report.explorer.dimensions.length + i]; });
    return row;
  }) : (report.analysis_rows || report.rows).map(row => ({...row, session:null}));
  const latest = report.generated_at.slice(0,10);
  const calendarDay=()=>{try{const p=new Intl.DateTimeFormat('en',{timeZone:report.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=t=>p.find(x=>x.type===t).value;return get('year')+'-'+get('month')+'-'+get('day');}catch(_){return new Date().toISOString().slice(0,10);}};
  let today=calendarDay();
  const earliest = records.reduce((day, r) => r.day < day ? r.day : day, latest);
  const scopes = {
    today:[today,today], yesterday:[shiftDay(today,-1),shiftDay(today,-1)],
    '7d':[shiftDay(today,-6),today], '30d':[shiftDay(today,-29),today],
    '90d':[shiftDay(today,-89),today], overall:[earliest,today]
  };
  const pageNames = i18n.dictionary({overview:'总览',agents:'Agent 画布',projects:'项目',models:'模型',explore:'探索分析',methods:'数据与口径'});
  const pageTitles = i18n.dictionary({overview:'用量总览',agents:'Agent 工作画布',projects:'项目投入',models:'模型使用',explore:'探索分析',methods:'数据与口径'});
  const descriptions = i18n.dictionary({overview:'了解投入，追踪变化，让每一份用量清晰可见。',agents:'跨项目查看会话编排、代理组织与当前工作。',projects:'从投入分布到项目详情，找到用量背后的变化。',models:'查看模型用量、成本构成与代理分工。',explore:'在同一筛选范围内，从更多角度理解你的用量。',methods:'了解数据完整性、计价覆盖与每个指标的含义。'});
  const dimensions = i18n.dictionary({project:'项目',model:'模型',project_model:'项目 × 模型',day:'日期',month:'月份',weekday:'星期',hour:'小时',heatmap:'星期 × 小时',workspace:'工作目录',agent_type:'主 / 子代理',agent_nickname:'子代理角色',source_surface:'来源入口',originator:'发起端',reasoning_effort:'推理等级',cli_version:'Codex 版本',model_provider:'模型供应商',context_window:'上下文窗口'});
  const metrics = i18n.dictionary({estimated_cost_usd:'已计价金额',total_tokens:'总 Token',calls:'模型续跑',token_cache_hit_rate:'缓存命中率',cached_input_tokens:'缓存命中 Token',cache_savings_usd:'缓存节省估算',input_tokens:'输入 Token',uncached_input_tokens:'未缓存输入 Token',cache_write_input_tokens:'缓存写入 Token',output_tokens:'输出 Token',reasoning_output_tokens:'推理 Token',reasoning_ratio:'推理占输出',request_cache_hit_rate:'请求命中率',sessions:'会话数',unknown_price_calls:'未计价续跑',unknown_price_tokens:'未计价 Token',average_tokens_per_call:'平均每次 Token',average_cost_per_call:'每次已计价续跑金额'});
  const rateMetrics = new Set(['token_cache_hit_rate','reasoning_ratio','request_cache_hit_rate']);
  metrics.cache_opportunity_usd = '理论额外节省上限';
  const moneyMetrics = new Set(['estimated_cost_usd','cache_savings_usd','average_cost_per_call','cache_opportunity_usd']);
  const state = {page:'overview',start:report.start,end:report.end,project:'',model:'',scope:Object.keys(scopes).find(k => scopes[k][0] === report.start && scopes[k][1] === report.end) || 'custom',trend:'estimated_cost_usd',projectSort:'estimated_cost_usd',search:'',detail:false,returnProject:'',dimension:'project',metric:'estimated_cost_usd',sort:'desc',view:'chart',preset:'project',pageIndex:0};
  let current = [], currentTotal, projectGroups = [], modelGroups = [], selectedDay = '', lastDayTrigger, tipCounter = 0, projectExpanded = false, dateError='', observationConnected=false,dateEditing=false;
  const tips = new Map();
  // Match the existing report's project-name grouping; work directories stay a separate dimension.
  const projectPath = r => r.project || 'unknown';
  function aggregate(rows) {
    const total = Object.fromEntries(numeric.map(k => [k,0]));
    const sessions = new Set();
    rows.forEach(r => { numeric.forEach(k => { total[k] += Number(r[k] || 0); }); if (r.session !== null && r.session !== undefined) sessions.add(r.session); });
    total.sessions = sessions.size;
    total.token_cache_hit_rate = ratio(total.cached_input_tokens,total.input_tokens);
    total.request_cache_hit_rate = ratio(total.cache_hit_calls,total.calls);
    total.reasoning_ratio = ratio(total.reasoning_output_tokens,total.output_tokens);
    total.average_tokens_per_call = ratio(total.total_tokens,total.calls);
    total.average_cost_per_call = ratio(total.estimated_cost_usd,total.known_price_calls);
    return total;
  }
  function group(rows, dimension) {
    const map = new Map();
    rows.forEach(r => {
      let key = r[dimension], label = key, order = key;
      if (dimension === 'project') {key = projectPath(r); label = r.project;}
      if (dimension === 'project_model') {key = JSON.stringify([projectPath(r),r.model]); label = `${r.project} × ${r.model}`;}
      if (dimension === 'month') key = label = order = r.day.slice(0,7);
      if (dimension === 'weekday') {key = order = weekday(r.day); label = weekdays[key];}
      if (dimension === 'hour') {key = order = r.hour; label = key === undefined ? ui('未知') : `${String(key).padStart(2,'0')}:00`;}
      if (dimension === 'context_window') label = key ? integer(key) + ' Token' : ui('未知');
      if (key === null || key === undefined || key === '') key = label = order = ui('未知');
      if (!map.has(key)) map.set(key,{key,label:label || ui('未知'),order:order ?? key,rows:[]});
      map.get(key).rows.push(r);
    });
    return [...map.values()].map(item => ({...item,...aggregate(item.rows)}));
  }
  function sortGroups(rows, metric, direction='desc') {
    return rows.slice().sort((a,b) => {
      if (direction === 'natural') return typeof a.order === 'number' && typeof b.order === 'number' ? a.order-b.order : String(a.order).localeCompare(String(b.order),'zh-CN',{numeric:true});
      if (moneyMetrics.has(metric)) {
        const priced = Boolean(b.known_price_calls) - Boolean(a.known_price_calls);
        if (priced) return priced;
      }
      return (Number(a[metric]||0) - Number(b[metric]||0)) * (direction === 'asc' ? 1 : -1) || b.total_tokens-a.total_tokens || a.label.localeCompare(b.label);
    });
  }
  const costText = row => row.calls && !row.known_price_calls ? ui('未计价') : money(row.estimated_cost_usd);
  const coverageText = row => row.total_tokens ? percent(ratio(row.known_price_tokens,row.total_tokens)) : '—';
  function metricText(row, metric) {
    if (moneyMetrics.has(metric) && row.calls && !row.known_price_calls) return ui('未计价');
    if (moneyMetrics.has(metric)) return money(row[metric]);
    if (rateMetrics.has(metric)) return percent(row[metric]);
    if (metric === 'sessions' && !report.explorer) return '—';
    if (metric === 'calls' || metric === 'sessions' || metric === 'unknown_price_calls') return integer(row[metric]);
    return compact(row[metric] || 0);
  }
  const partial = row => row.unknown_price_calls && row.known_price_calls ? ui('<small class="unpriced">部分未计价</small>') : '';
  function tip(label, row, extra='') {
    const id = 'tip-' + tipCounter++;
    tips.set(id, {label,row,extra});
    return `data-tip="${id}"`;
  }
  function selectRecords(start=state.start,end=state.end) {
    return records.filter(r => r.day >= start && r.day <= end && (!state.project || projectPath(r) === state.project) && (!state.model || r.model === state.model));
  }
  function options(select, list, empty) {
    select.innerHTML = (empty ? `<option value="">${empty}</option>` : '') + list.map(([key,label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('');
  }
  options($('project'), [...new Map([...records.map(r => [projectPath(r),r.project]),...(report.agent_graph?.projects || []).map(p=>[p.name,p.name])]).entries()].sort((a,b) => a[1].localeCompare(b[1])), ui('全部项目'));
  options($('model'), [...new Set([...records.map(r => r.model),...(report.agent_graph?.nodes || []).map(n=>n.model)])].sort().map(x => [x,x]), ui('全部模型'));
  options($('dimension'), Object.entries(dimensions)); options($('metric'), Object.entries(metrics));

  const hashKeys = ['page','start','end','project','model','trend','projectSort','search','dimension','metric','sort','view','preset'];
  function saveState() {
    const params = new URLSearchParams(); hashKeys.forEach(k => { if(state[k]) params.set(k,state[k]); });
    if (state.detail) {params.set('detail','1'); params.set('returnProject',state.returnProject);}
    params.set('range',state.scope);
    params.set('lang',i18n.locale);
    try { history.replaceState(null,'','#'+params); } catch (_) { /* Offline policy may disable history. */ }
  }
  function restoreState() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (pageNames[params.get('page')]) state.page = params.get('page');
    const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
    if (validDay(params.get('start')) && validDay(params.get('end')) && params.get('start') <= params.get('end') && dayCount(params.get('start'),params.get('end')) <= 36600) {
      state.start = params.get('start'); state.end = params.get('end');
    }
    ['project','model'].forEach(k => { if ([...$(k).options].some(o => o.value === params.get(k))) state[k] = params.get(k); });
    if (['estimated_cost_usd','total_tokens','calls'].includes(params.get('trend'))) state.trend = params.get('trend');
    if (['estimated_cost_usd','total_tokens','calls'].includes(params.get('projectSort'))) state.projectSort = params.get('projectSort');
    if (dimensions[params.get('dimension')]) state.dimension = params.get('dimension');
    if (metrics[params.get('metric')]) state.metric = params.get('metric');
    if (['asc','desc','natural'].includes(params.get('sort'))) state.sort = params.get('sort');
    if (['chart','table'].includes(params.get('view'))) state.view = params.get('view');
    state.search = params.get('search') || ''; if(params.has('preset')) state.preset = params.get('preset');
    state.detail = params.get('detail') === '1' && Boolean(state.project);
    state.returnProject = [...$('project').options].some(o => o.value === params.get('returnProject')) ? params.get('returnProject') : '';
    state.scope = Object.keys(scopes).find(k => scopes[k][0] === state.start && scopes[k][1] === state.end) || 'custom';
    const range=params.get('range');if(scopes[range]){state.scope=range;[state.start,state.end]=scopes[range];}
  }
  function renderWorkspaceMode() {
    $('workspace-mode').innerHTML='<i class="status-dot"></i>'+ui(observationConnected?'本地服务 · 用量快照':'本地快照');
  }
  function syncControls() {
    renderWorkspaceMode();
    document.body.dataset.workspacePage = state.page;
    $('project').options[0].textContent=ui('全部项目');$('model').options[0].textContent=ui('全部模型');
    for(const [id,labels]of [['dimension',dimensions],['metric',metrics]])for(const option of $(id).options)option.textContent=labels[option.value];
    ['project','model','scope'].forEach(k => {$(k).value = state[k];});
    if(!dateEditing){$('start').value = state.start; $('end').value = state.end;}
    if(dateEditing)$('scope').value='custom';
    $('date-error').textContent=ui(dateError);
    $('custom-dates').hidden = !dateEditing;
    $('edit-date-range').setAttribute('aria-expanded',String(dateEditing));
    const filterCount=Number(Boolean(state.project))+Number(Boolean(state.model));
    $('filter-count').textContent=String(filterCount);$('filter-count').hidden=!filterCount;
    $('filter-summary').hidden=!filterCount;
    $('overallRange').textContent = `${state.start} — ${state.end}`;
    $('compact-range').textContent=state.start===state.end?state.start:state.start+' — '+(state.start.slice(0,4)===state.end.slice(0,4)?state.end.slice(5):state.end);
    $('edit-date-range').title=$('overallRange').textContent;
    $('edit-date-range').setAttribute('aria-label',ui('编辑日期范围')+' · '+$('overallRange').textContent);
    $('filter-summary').textContent = [state.project,state.model].filter(Boolean).join(' · ');
    $('filter-summary').title=$('filter-summary').textContent;
    const coverageLabel=currentTotal.total_tokens?ui`已计价 Token ${coverageText(currentTotal)}${currentTotal.unknown_price_calls ? ui(' · 查看缺失') : ''}`:ui('暂无用量 · 查看口径');
    $('coverage-status').title=coverageLabel;$('coverage-status').setAttribute('aria-label',coverageLabel);
    $('coverage-status').textContent = currentTotal.total_tokens ? ui('计价覆盖')+' '+coverageText(currentTotal) : ui('暂无用量');
    $('coverage-status').classList.toggle('complete',!currentTotal.unknown_price_calls);
    $('generated-at').textContent = report.generated_at.slice(0,19).replace('T',' ');
    $('footer-context').textContent = ui`${state.start} — ${state.end} · API 等价估算`;
    $('page-title').textContent = state.detail && state.page === 'projects' ? ui('项目详情') : pageTitles[state.page];
    $('page-description').textContent = descriptions[state.page]; $('breadcrumb-page').textContent = pageNames[state.page];
    $('page-title').title=descriptions[state.page];
    window.WorkspaceSidebar.setActive(state.page);
    document.querySelectorAll('.page-panel').forEach(panel => {panel.hidden = panel.id !== 'page-'+state.page;});
    document.querySelectorAll('[data-trend]').forEach(button => {const active = button.dataset.trend === state.trend; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));});
  }
  function comparison() {
    const previousEnd = shiftDay(state.start,-1), previousStart = shiftDay(state.start,-dayCount(state.start,state.end));
    const previous = aggregate(selectRecords(previousStart,previousEnd));
    let reason = '';
    if (state.start <= today && state.end >= today) reason = ui('含今天，周期尚未结束');
    else if (state.end > latest) reason = ui('所选范围超出快照日期');
    else if (previousStart < earliest) reason = ui('前期历史不足，暂不计算环比');
    else if (!previous.calls) reason = ui('前期无用量，暂无环比');
    const comparable = !reason && Math.abs(ratio(previous.known_price_calls,previous.calls)-ratio(currentTotal.known_price_calls,currentTotal.calls)) <= .02 && Math.abs(ratio(previous.known_price_tokens,previous.total_tokens)-ratio(currentTotal.known_price_tokens,currentTotal.total_tokens)) <= .02;
    return {previous, reason, comparable, label:ui`对比 ${previousStart} — ${previousEnd}`};
  }
  function renderOverview() {
    const t=currentTotal, c=comparison();
    $('overallSpend').textContent=costText(t); $('overallTokens').textContent=compact(t.total_tokens); $('overallCalls').textContent=integer(t.calls); $('overallCacheHitRate').textContent=t.input_tokens ? percent(t.token_cache_hit_rate) : '—';
    $('spend-note').textContent=t.unknown_price_calls ? ui`已知价格部分 · 另有 ${compact(t.unknown_price_tokens)} Token 未计价` : ui('按 API 价格折算 · 非实际账单');
    $('token-note').textContent=ui`输入 ${compact(t.input_tokens)} · 输出 ${compact(t.output_tokens)}`;
    $('calls-note').textContent=report.explorer ? ui`${integer(t.sessions)} 个会话 · ${projectGroups.length} 个项目` : ui('累计 Token 正向变化次数');
    $('cache-note').textContent=ui`命中 ${compact(t.cached_input_tokens)} / 输入 ${compact(t.input_tokens)}`;
    function change(id,key) {
      const previous=c.previous[key];
      $(id).textContent=c.reason || (!previous ? ui('前期为 0，暂无环比') : ui`较前期 ${t[key]>=previous?'+':''}${((t[key]/previous-1)*100).toFixed(1)}%`);
      $(id).title=c.label;
    }
    change('token-change','total_tokens');change('calls-change','calls');
    if(c.reason) {
      $('token-change').textContent=ui`其中推理 ${compact(t.reasoning_output_tokens)} Token`;
      $('calls-change').textContent=ui`所选周期日均 ${integer(t.calls/dayCount(state.start,state.end))} 次续跑`;
    }
    if(c.reason) $('spend-change').textContent=c.reason;
    else if(!t.known_price_calls) $('spend-change').textContent=ui('尚无可计价用量');
    else if(!c.comparable) $('spend-change').textContent=ui('前后期价格覆盖不同，金额暂不比较');
    else change('spend-change','estimated_cost_usd');
    $('cache-change').textContent=t.calls && t.known_price_calls ? ui`缓存折价节省约 ${money(t.cache_savings_usd)}` : ui('缓存读取量已计入输入 Token');
    $('trend-total').textContent=metricText(t,state.trend); $('trend-legend').textContent=metrics[state.trend];
    $('trend-subtitle').textContent=`${state.start} — ${state.end} · ${c.reason || c.label}`;
    $('trend-caption').textContent=state.trend==='estimated_cost_usd' && t.unknown_price_calls ? ui('金额仅含已计价部分；琥珀色标记表示当天存在未计价用量。点击日期查看明细。') : ui('悬浮或聚焦日期查看用量，点击查看当天明细。');
    drawTrend($('chartStatic'),current,state.trend);
    renderInsights(); renderHomeProjects(); renderHomeModels();
  }
  function renderInsights() {
    if(!currentTotal.calls) {$('insights').innerHTML=ui('<div class="empty">当前范围暂无用量。<br>试试扩大日期范围。</div>');return;}
    const top=sortGroups(projectGroups,'total_tokens')[0];
    const peak=sortGroups(group(current,'day'),'total_tokens')[0];
    const items=[ui`<article class="insight"><div class="insight-label"><span class="insight-icon">↗</span>投入集中在哪</div><strong>${esc(top.label)} · ${percent(ratio(top.total_tokens,currentTotal.total_tokens))} 的 Token</strong><p>${compact(top.total_tokens)} Token，${integer(top.calls)} 次续跑。</p><button data-project="${esc(top.key)}">查看项目详情 →</button></article>`];
    if(currentTotal.unknown_price_calls) items.push(ui`<article class="insight amber"><div class="insight-label"><span class="insight-icon">!</span>金额尚不完整</div><strong>${compact(currentTotal.unknown_price_tokens)} Token 尚未计价</strong><p>涉及 ${integer(currentTotal.unknown_price_calls)} 次续跑，估算金额只含已匹配价格的部分。</p><button data-page="methods">查看未计价模型 →</button></article>`);
    else items.push(ui`<article class="insight"><div class="insight-label"><span class="insight-icon">✓</span>缓存使用情况</div><strong>${percent(currentTotal.token_cache_hit_rate)} 的输入命中缓存</strong><p>按当前价格，相比无缓存输入基准节省约 ${money(currentTotal.cache_savings_usd)}。</p><button data-preset="cache">查看项目缓存表现 →</button></article>`);
    items.push(ui`<article class="insight"><div class="insight-label"><span class="insight-icon">⌁</span>用量最高的一天</div><strong>${peak.label} · ${compact(peak.total_tokens)} Token</strong><p>${integer(peak.calls)} 次续跑，${peak.known_price_calls ? ui('已计价 ')+money(peak.estimated_cost_usd) : ui('用量尚未计价')}。</p><button data-day="${peak.label}">查看当天构成 →</button></article>`);
    $('insights').innerHTML=items.join('');
  }
  function rankMarkup(rows, metric, action) {
    if(!rows.length) return ui('<div class="empty">当前范围暂无数据</div>');
    const max=Math.max(...rows.map(r=>r[metric]||0),1);
    return rows.map((r,i)=>`<button class="rank-item" ${action?`${action}="${esc(r.key)}"`:''} ${tip(r.label,r)}><span class="rank-index">${String(i+1).padStart(2,'0')}</span><div><div class="rank-name">${esc(r.label)}</div><div class="rank-track"><div class="rank-fill" style="width:${Math.max(0,(r[metric]||0)/max*100)}%"></div></div></div><div class="rank-value ${moneyMetrics.has(metric)&&!r.known_price_calls?'unpriced':''}">${metricText(r,metric)}<small>${moneyMetrics.has(metric)?compact(r.total_tokens)+' Token':integer(r.calls)+ui(' 次续跑')}</small>${moneyMetrics.has(metric)?partial(r):''}</div></button>`).join('');
  }
  function renderHomeProjects() {$('home-projects').innerHTML=rankMarkup(sortGroups(projectGroups,'estimated_cost_usd').slice(0,5),'estimated_cost_usd','data-project');}
  function renderHomeModels() {
    const rows=sortGroups(modelGroups,'total_tokens');
    if(!rows.length) {$('home-models').innerHTML=ui('<div class="empty">当前范围暂无数据</div>');return;}
    $('home-models').innerHTML=ui`<div class="stacked-bar" aria-label="各模型 Token 占比">${rows.map((r,i)=>`<span style="width:${ratio(r.total_tokens,currentTotal.total_tokens)*100}%;background:${colors[i%colors.length]}" ${tip(r.label,r)}></span>`).join('')}</div>`+rows.slice(0,5).map((r,i)=>`<button class="model-legend-row" style="width:100%;text-align:left;padding:0" data-model="${esc(r.key)}"><i style="background:${colors[i%colors.length]}"></i><strong>${esc(r.label)}<small>${compact(r.total_tokens)} Token${r.unknown_price_calls?ui(' · 含未计价用量'):''}</small></strong><span>${percent(ratio(r.total_tokens,currentTotal.total_tokens))}</span></button>`).join('');
  }
  function trendGroups(rows, start=state.start, end=state.end, forceMonth=false) {
    const monthly=forceMonth || dayCount(start,end)>120, dim=monthly?'month':'day';
    const existing=new Map(group(rows,dim).map(r=>[r.key,r])); const data=[];
    let key=monthly?start.slice(0,7)+'-01':start;
    while(key<=end) {
      const label=monthly?key.slice(0,7):key;
      data.push(existing.get(label)||{...aggregate([]),key:label,label,rows:[],order:label});
      key=monthly?new Date(Date.UTC(Number(key.slice(0,4)),Number(key.slice(5,7)),1)).toISOString().slice(0,10):shiftDay(key,1);
    }
    return {data,monthly};
  }
  const trendLayouts=new Map();
  const trendResizeObserver=typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>{
    for(const {target}of entries){
      const layout=trendLayouts.get(target);
      if(!target.isConnected){trendResizeObserver.unobserve(target);trendLayouts.delete(target);continue;}
      if(layout&&target.clientWidth>0&&target.clientWidth!==layout.width)drawTrend(target,layout.rows,layout.metric,layout.forceMonth);
    }
  });
  function drawTrend(container,rows,metric,forceMonth=false) {
    for(const target of trendLayouts.keys())if(!target.isConnected){trendResizeObserver?.unobserve(target);trendLayouts.delete(target);}
    container.querySelectorAll('[data-tip]').forEach(target=>tips.delete(target.dataset.tip));
    trendLayouts.set(container,{rows,metric,forceMonth,width:container.clientWidth});
    trendResizeObserver?.observe(container);
    const total=aggregate(rows), {data,monthly}=trendGroups(rows,state.start,state.end,forceMonth);
    if(!total.calls){container.innerHTML=ui('<div class="empty">当前范围暂无用量，请调整筛选。</div>');return;}
    if(moneyMetrics.has(metric)&&!total.known_price_calls){container.innerHTML=ui('<div class="empty">当前用量尚未计价。<br>切换到 Token 或续跑次数查看趋势。</div>');return;}
    const style=getComputedStyle(container),w=Math.max(180,Math.round(container.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight))),h=Math.max(160,container.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)),p={l:55,r:10,t:18,b:30},plot=h-p.t-p.b,max=Math.max(...data.map(r=>r[metric]||0),.0001),slot=(w-p.l-p.r)/data.length;
    const labelStep=Math.max(1,Math.ceil(data.length/Math.max(2,Math.min(8,Math.floor((w-p.l-p.r)/(monthly?70:48))))));
    const axis=v=>rateMetrics.has(metric)?percent(v):moneyMetrics.has(metric)?money(v):compact(v);
    const fillId='trend-fill-'+container.id;
    let svg=ui`<svg class="trend-svg" viewBox="0 0 ${w} ${h}" role="group" aria-label="${monthly?ui('每月'):ui('每日')}${esc(metrics[metric])}趋势" style="--chart-fill:url(#${fillId})"><defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#319580"/><stop offset="1" stop-color="#166f60"/></linearGradient></defs>`;
    for(let i=0;i<=4;i++){const y=p.t+plot*i/4;svg+=`<line class="grid-line" x1="${p.l}" y1="${y}" x2="${w-p.r}" y2="${y}"/><text x="${p.l-9}" y="${y+4}" text-anchor="end">${axis(max*(1-i/4))}</text>`;}
    data.forEach((r,i)=>{const barH=Math.max(0,(r[metric]||0)/max*plot),x=p.l+i*slot,bw=Math.max(1,Math.min(32,slot*.65));const action=monthly?`data-month="${r.label}"`:`data-day="${r.label}"`;svg+=`<g class="day-group" role="button" tabindex="0" ${action} ${tip(r.label,r,monthly?ui('点击查看该月'):ui('点击查看当天构成'))} aria-label="${esc(r.label+'，'+metrics[metric]+' '+metricText(r,metric)+ui('，查看明细'))}"><rect class="day-bar" x="${x+(slot-bw)/2}" y="${h-p.b-barH}" width="${bw}" height="${barH}"/>${moneyMetrics.has(metric)&&r.unknown_price_calls?`<circle class="unknown-dot" cx="${x+slot/2}" cy="${h-p.b+5}" r="2"/>`:''}<rect class="day-hit" x="${x}" y="${p.t}" width="${slot}" height="${plot+8}"/></g>`;if(i%labelStep===0)svg+=`<text x="${x+slot/2}" y="${h-6}" text-anchor="middle">${monthly?r.label:r.label.slice(5)}</text>`;});
    container.innerHTML=svg+'</svg>';
  }
  function sparkline(rows) {
    const values=trendGroups(rows).data.map(r=>r.total_tokens), max=Math.max(...values,1);
    const points=values.map((v,i)=>`${4+i*67/Math.max(1,values.length-1)},${22-v/max*19}`).join(' ');
    return ui`<svg class="sparkline" viewBox="0 0 75 25" aria-label="Token 趋势"><polygon points="4,24 ${points} 71,24" fill="#81b99c" opacity=".12"/><polyline points="${points}" fill="none" stroke="#5b9476" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function renderProjects() {
    $('project-list').hidden=state.detail; $('project-detail').hidden=!state.detail;
    if(state.detail){renderProjectDetail();return;}
    $('project-search').value=state.search; $('project-sort').value=state.projectSort;
    const rows=sortGroups(projectGroups,state.projectSort).filter(r=>r.label.toLowerCase().includes(state.search.toLowerCase())||String(r.key).toLowerCase().includes(state.search.toLowerCase()));
    $('project-count').textContent=ui`${rows.length} 个项目`;
    const visible = projectExpanded ? rows : rows.slice(0,10);
    let pagination = $('project-pagination');
    if(!pagination) { pagination=document.createElement('div');pagination.id='project-pagination';pagination.className='pagination';$('project-table').parentElement.after(pagination); }
    pagination.innerHTML=rows.length>10 ? ui`<span>显示 ${visible.length} / ${rows.length} 个项目</span><button id="toggle-projects">${projectExpanded?ui('收起至前 10 项'):ui('查看全部项目')}</button>` : '';
    $('project-rows').innerHTML=visible.map((r,i)=>ui`<tr><td class="muted"><span class="table-rank">${String(i+1).padStart(2,'0')}</span></td><td><button class="project-link" data-project="${esc(r.key)}">${esc(r.label)} ↗</button><small title="${esc([...new Set(r.rows.map(item=>item.project_path))].join('\n'))}">${new Set(r.rows.map(item=>item.model)).size} 个模型 · ${integer(r.sessions)} 个会话</small></td><td class="${!r.known_price_calls?'unpriced':''}">${costText(r)}${partial(r)}</td><td>${compact(r.total_tokens)}</td><td>${integer(r.calls)}</td><td>${percent(r.token_cache_hit_rate)}</td><td ${tip(r.label,r)}>${coverageText(r)}<small>按 Token</small></td><td>${sparkline(r.rows)}</td></tr>`).join('');
    $('projects-empty').hidden=Boolean(rows.length);
  }
  function summaryMarkup(items) {return items.map(([label,value,note])=>`<div class="summary-item"><span>${esc(label)}</span><b>${esc(value)}</b>${note?`<small>${esc(note)}</small>`:''}</div>`).join('');}
  function renderProjectDetail() {
    const project=$('project').selectedOptions[0]?.textContent || ui('项目');
    const t=currentTotal;
    $('project-detail').innerHTML=ui`<div class="detail-head"><button class="icon-button" id="back-projects" aria-label="返回项目列表">←</button><div><h2>${esc(project)}</h2><p>${esc(state.project)}</p></div></div><div class="compact-summary">${summaryMarkup([[ui('已计价金额'),costText(t),ui`计价覆盖 ${coverageText(t)} Token`],[ui('总 Token'),compact(t.total_tokens),ui`${integer(t.calls)} 次续跑`],[ui('缓存命中率'),t.input_tokens?percent(t.token_cache_hit_rate):'—',ui`${compact(t.cached_input_tokens)} 命中 Token`]])}</div><div class="detail-grid"><section class="panel"><div class="panel-header"><h2>项目每日 Token</h2><span class="pill">与全局筛选同步</span></div><div class="chart-area" id="detail-trend"></div><p class="chart-caption">点击日期，查看当日模型贡献。</p></section><section class="panel"><div class="panel-header"><h2>模型贡献</h2><span class="pill">按 Token</span></div><div class="rank-list" id="detail-models"></div></section></div><section class="panel"><div class="panel-header"><div><h2>项目用量明细</h2><p>按日期与模型聚合 · 最近 50 项</p></div><button class="text-button" id="detail-explore">探索全部明细 →</button></div><div class="table-scroll"><table><thead><tr><th>日期</th><th>模型</th><th>续跑</th><th>Token</th><th>缓存命中率</th><th>已计价金额</th></tr></thead><tbody>${detailRows(current)}</tbody></table></div></section>`;
    drawTrend($('detail-trend'),current,'total_tokens'); $('detail-models').innerHTML=rankMarkup(sortGroups(modelGroups,'total_tokens'),'total_tokens','data-model');
  }
  function detailRows(rows) {
    const map=new Map();rows.forEach(r=>{const k=r.day+'|'+r.model;if(!map.has(k))map.set(k,[]);map.get(k).push(r);});
    return [...map.values()].sort((a,b)=>b[0].day.localeCompare(a[0].day)).slice(0,50).map(list=>{const r=aggregate(list);return `<tr><td>${esc(list[0].day)}</td><td>${esc(list[0].model)}</td><td>${integer(r.calls)}</td><td>${compact(r.total_tokens)}</td><td>${percent(r.token_cache_hit_rate)}</td><td>${costText(r)}${partial(r)}</td></tr>`;}).join('')||ui('<tr><td colspan="6">当前筛选下暂无用量</td></tr>');
  }
  function renderModels() {
    const t=currentTotal;
    $('model-summary').innerHTML=summaryMarkup([[ui('使用中的模型'),modelGroups.length,ui`${integer(t.calls)} 次模型续跑`],[ui('已计价金额'),costText(t),ui`Token 覆盖 ${coverageText(t)}`],[ui('未计价 Token'),compact(t.unknown_price_tokens),ui`${integer(t.unknown_price_calls)} 次续跑尚未计价`]]);
    $('model-cards').innerHTML=sortGroups(modelGroups,'total_tokens').map((r,i)=>ui`<article class="panel model-card"><div class="model-card-top"><h2><span class="model-symbol" style="background:${colors[i%colors.length]}">${modelIcon}</span><span class="model-name">${esc(r.label)}</span></h2><span class="pill ${!r.known_price_calls?'unpriced':''}">${!r.known_price_calls?ui('未匹配价格'):r.unknown_price_calls?ui('部分已计价'):ui('已匹配价格')}</span></div><div class="model-amount ${!r.known_price_calls?'unpriced':''}">${costText(r)}<small>${r.known_price_calls?ui('API 等价估算 · Token 占比 ')+percent(ratio(r.total_tokens,t.total_tokens)):ui('当前价格快照未匹配 · 用量仍完整统计')}</small></div><div class="model-stats"><div><span>总 Token</span><b>${compact(r.total_tokens)}</b></div><div><span>模型续跑</span><b>${integer(r.calls)}</b></div><div><span>缓存命中率</span><b>${percent(r.token_cache_hit_rate)}</b></div></div><button class="text-button" data-model="${esc(r.key)}">仅分析此模型 →</button></article>`).join('')||ui('<div class="empty">当前范围暂无模型用量</div>');
    $('agent-distribution').innerHTML=rankMarkup(sortGroups(group(current,'agent_type'),'total_tokens'),'total_tokens');
  }
  function explorerGroups() {
    let rows=group(current,state.dimension==='heatmap'?'weekday':state.dimension);
    if(state.preset==='unknown') rows=rows.filter(r=>r.unknown_price_calls>0);
    return sortGroups(rows,state.metric,state.sort);
  }
  function renderExplore() {
    $('dimension').value=state.dimension; $('metric').value=state.metric; $('explore-sort').value=state.sort;
    document.querySelectorAll('[data-preset]').forEach(button=>{const active=button.dataset.preset===state.preset;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===state.view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
    const rows=explorerGroups(); $('explore-title').textContent=`${dimensions[state.dimension]} · ${metrics[state.metric]}`;
    $('explore-subtitle').textContent=ui`${state.start} — ${state.end} · ${integer(currentTotal.calls)} 次续跑${state.preset==='unknown'?ui(' · 仅显示存在未计价用量的分组'):''}${state.metric==='cache_opportunity_usd'?ui(' · 乐观上限：假设全部输入均命中缓存，不代表实际可节省金额'):''}`;
    $('explore-count').textContent=`${state.dimension==='heatmap'?'7 × 24':rows.length} ${state.dimension==='heatmap'?ui('个时段'):ui('项')}`;
    $('explore-table-wrap').hidden=state.view!=='table'; $('explore-chart').hidden=state.view!=='chart';
    if(state.view==='table') renderExploreTable(state.dimension==='heatmap'?heatGroups():rows);
    else {
      $('explore-pagination').innerHTML='';
      if(state.dimension==='heatmap') drawHeatmap();
      else if(['day','month'].includes(state.dimension)) {
        $('explore-chart').innerHTML=ui('<div class="chart-area" id="explore-time-chart"></div><p class="chart-notice">时间图始终按日期排列；超过 120 天自动按月聚合。可切换表格查看精确数值。</p>');
        drawTrend($('explore-time-chart'),current,state.metric,state.dimension==='month');
      } else renderBars(rows);
    }
  }
  function renderBars(rows) {
    if(!rows.length){$('explore-chart').innerHTML=ui('<div class="empty">当前范围没有匹配的数据</div>');return;}
    const shown=rows.slice(0,24), max=Math.max(...shown.map(r=>r[state.metric]||0),.0001);
    $('explore-chart').innerHTML=`<p class="chart-notice">${rows.length>24?ui('图表展示前 24 项，全部结果见表格。'):ui('悬浮或聚焦查看 Token、续跑次数与金额。')}${moneyMetrics.has(state.metric)?ui(' 未计价不等于零消耗。'):''}</p><div class="bar-list">${shown.map(r=>`<button class="bar-row" ${state.dimension==='project'?`data-project="${esc(r.key)}"`:state.dimension==='model'?`data-model="${esc(r.key)}"`:''} ${tip(r.label,r)}><span>${esc(r.label)}</span><span class="track"><i class="fill" style="width:${Math.max(0,(r[state.metric]||0)/max*100)}%"></i></span><span class="bar-value ${moneyMetrics.has(state.metric)&&!r.known_price_calls?'unpriced':''}">${metricText(r,state.metric)}</span></button>`).join('')}</div>`;
  }
  function heatGroups() {
    const grouped=new Map();current.forEach(r=>{const key=weekday(r.day)+'-'+(r.hour??ui('未知'));if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);});
    return [...grouped.values()].map(rows=>({...aggregate(rows),rows,label:`${weekdays[weekday(rows[0].day)]} · ${String(rows[0].hour??ui('未知')).padStart(2,'0')}:00`,order:weekday(rows[0].day)*24+(rows[0].hour||0)})).sort((a,b)=>a.order-b.order);
  }
  function drawHeatmap() {
    if(!report.explorer){$('explore-chart').innerHTML=ui('<div class="empty">此快照没有小时级数据，请重新生成报表。</div>');return;}
    const rows=heatGroups(), map=new Map(rows.map(r=>[r.order,r])), max=Math.max(...rows.map(r=>r[state.metric]||0),.0001);
    let html=ui('<p class="chart-notice">颜色越深，当前指标越高。同一星期、同一小时的用量合并展示。</p><div class="heatmap-wrap"><div class="heatmap"><span></span>');
    for(let h=0;h<24;h++)html+=`<span class="heat-label">${String(h).padStart(2,'0')}</span>`;
    for(let d=0;d<7;d++){html+=`<span class="heat-label">${weekdays[d]}</span>`;for(let h=0;h<24;h++){const r=map.get(d*24+h)||{...aggregate([]),label:`${weekdays[d]} · ${String(h).padStart(2,'0')}:00`};const unpriced=moneyMetrics.has(state.metric)&&r.calls&&!r.known_price_calls;const opacity=(r[state.metric]||0)/max*.82+.04;html+=`<button class="heat-cell" style="background:${unpriced?'#fbf3e5':`rgba(18,119,106,${opacity})`}" ${tip(r.label,r,metrics[state.metric]+' '+metricText(r,state.metric))} aria-label="${esc(r.label+'，'+metrics[state.metric]+' '+metricText(r,state.metric))}"></button>`;}}
    $('explore-chart').innerHTML=html+ui('</div></div><div class="heat-legend">低<i style="background:#edf6f3"></i><i style="background:#b9d8cf"></i><i style="background:#67a393"></i><i style="background:#197b73"></i>高 · 琥珀色为未计价</div>');
  }
  function renderExploreTable(rows) {
    const keys=[...new Set([state.metric,'calls','total_tokens','token_cache_hit_rate','estimated_cost_usd'])];
    const columns=[['label',ui('统计维度')],...keys.map(key=>[key,metrics[key]])];
    $('explore-head').innerHTML='<tr>'+columns.map(([,label])=>`<th>${esc(label)}</th>`).join('')+'</tr>';
    const pageSize=25,pages=Math.max(1,Math.ceil(rows.length/pageSize));state.pageIndex=Math.min(state.pageIndex,pages-1);
    $('explore-rows').innerHTML=rows.slice(state.pageIndex*pageSize,(state.pageIndex+1)*pageSize).map(r=>'<tr>'+columns.map(([key])=>`<td>${key==='label'?esc(r.label):metricText(r,key)}${key==='estimated_cost_usd'?partial(r):''}</td>`).join('')+'</tr>').join('')||ui`<tr><td colspan="${columns.length}">当前范围没有匹配的数据</td></tr>`;
    $('explore-pagination').innerHTML=ui`<span>共 ${rows.length} 项 · 第 ${state.pageIndex+1} / ${pages} 页</span><div><button id="prev-results" ${state.pageIndex===0?'disabled':''}>上一页</button><button id="next-results" ${state.pageIndex>=pages-1?'disabled':''}>下一页</button></div>`;
  }
  function renderMethods() {
    const t=currentTotal;
    $('data-status').innerHTML=summaryMarkup([[ui('Token 计价覆盖'),coverageText(t),ui`${compact(t.unknown_price_tokens)} Token 未计价`],[ui('续跑计价覆盖'),t.calls?percent(ratio(t.known_price_calls,t.calls)):'—',ui`${integer(t.unknown_price_calls)} 次续跑未计价`],[ui('缓存请求命中率'),t.calls?percent(t.request_cache_hit_rate):'—',ui`${integer(t.cache_hit_calls)} 次续跑命中缓存`]]);
    const unknown=sortGroups(modelGroups.filter(r=>r.unknown_price_calls),'unknown_price_tokens');
    $('unpriced-models').innerHTML=unknown.length?rankMarkup(unknown,'unknown_price_tokens','data-model'):ui('<div class="empty">当前范围没有未计价用量。</div>');
    $('pricing-info').textContent=ui`价格快照版本：${report.pricing_as_of}。报表生成于 ${report.generated_at.replace('T',' ')}。`;
    if(/^https:\/\/(developers\.openai\.com|openai\.com|platform\.openai\.com)\//.test(report.pricing_source||'')) {$('pricing-info').innerHTML+=' <a target="_blank" rel="noreferrer" href="'+esc(report.pricing_source)+ui('">查看价格来源 ↗</a>');}
    $('cache-write-status').textContent=t.cache_write_input_tokens?ui`当前范围记录到 ${integer(t.cache_write_input_tokens)} 个缓存写入 Token。`:ui('当前范围观察到 0 个缓存写入 Token；可能确实无写入，也可能数据源未提供该字段。');
  }
  function render() {
    const next=calendarDay();if(next!==today){today=next;Object.assign(scopes,{today:[today,today],yesterday:[shiftDay(today,-1),shiftDay(today,-1)],'7d':[shiftDay(today,-6),today],'30d':[shiftDay(today,-29),today],'90d':[shiftDay(today,-89),today],overall:[earliest,today]});if(scopes[state.scope])[state.start,state.end]=scopes[state.scope];}
    hideTip(); tips.clear(); tipCounter=0;
    current=selectRecords();currentTotal=aggregate(current);projectGroups=group(current,'project');modelGroups=group(current,'model');
    syncControls();
    // Render only the visible page; metadata aggregates remain shared across all pages.
    if(state.page==='overview')renderOverview();
    else if(state.page==='projects')renderProjects();
    else if(state.page==='models')renderModels();
    else if(state.page==='explore')renderExplore();
    else if(state.page==='methods')renderMethods();
    saveState();
    window.dispatchEvent(new CustomEvent('codex:workspace-view',{detail:{page:state.page,start:state.start,end:state.end,project:state.project,model:state.model,records:current}}));
  }
  function navigate(page) {if(!pageNames[page])return;closeDateEditor(false);$('global-filter-menu').open=false;state.page=page;render();window.scrollTo({top:0});}
  function drillProject(key) {if(!state.detail)state.returnProject=state.project;state.project=key;state.detail=true;state.page='projects';render();window.scrollTo({top:0});}
  function applyPreset(name) {
    const presets={project:['project','estimated_cost_usd','desc'],cache:['project','token_cache_hit_rate','asc'],trend:['day','total_tokens','natural'],heatmap:['heatmap','total_tokens','natural'],agents:['agent_type','total_tokens','desc'],unknown:['model','unknown_price_tokens','desc']};
    if(!presets[name])return;
    [state.dimension,state.metric,state.sort]=presets[name];state.preset=name;state.page='explore';state.pageIndex=0;render();
  }
  function openDay(day,trigger) {
    selectedDay=day;lastDayTrigger=trigger;
    const rows=current.filter(r=>r.day===day),t=aggregate(rows);
    $('day-dialog-title').textContent=day;
    const dim=state.project?'model':'project';
    $('day-dialog-content').innerHTML=ui`<div class="compact-summary">${summaryMarkup([[ui('总 Token'),compact(t.total_tokens)],[ui('模型续跑'),integer(t.calls)],[ui('已计价金额'),costText(t),t.unknown_price_calls?ui('含未计价用量'):'']])}</div><h3>${dim==='model'?ui('模型'):ui('项目')}用量构成</h3><div class="rank-list">${rankMarkup(sortGroups(group(rows,dim),'total_tokens'),'total_tokens')}</div>`;
    if(!$('day-dialog').open)$('day-dialog').showModal();hideTip();
  }
  function hideTip() {$('chartTooltip').hidden=true;}
  function showTip(target,event) {
    const data=tips.get(target.dataset.tip); if(!data)return;
    const {label,row,extra}=data,t=$('chartTooltip');
    t.innerHTML=ui`<strong>${esc(label)}</strong><div><span>总 Token</span><b>${integer(row.total_tokens)}</b></div><div><span>模型续跑</span><b>${integer(row.calls)} 次</b></div><div><span>API 等价金额</span><b>${costText(row)}</b></div><div><span>缓存命中率</span><b>${percent(row.token_cache_hit_rate)}</b></div>${row.unknown_price_calls?ui`<small>${integer(row.unknown_price_calls)} 次续跑未计价</small>`:''}${extra?`<small>${esc(extra)}</small>`:''}`;
    t.hidden=false;
    const rect=target.getBoundingClientRect(),x=event?.clientX??rect.left+rect.width/2,y=event?.clientY??rect.top;
    t.style.left=Math.max(8,Math.min(window.innerWidth-t.offsetWidth-8,x+12))+'px';
    t.style.top=Math.max(8,Math.min(window.innerHeight-t.offsetHeight-8,y-t.offsetHeight-12))+'px';
  }
  document.addEventListener('pointerover',e=>{const target=e.target.closest('[data-tip]');if(target)showTip(target,e);});
  document.addEventListener('pointermove',e=>{const target=e.target.closest('[data-tip]');if(target)showTip(target,e);});
  document.addEventListener('pointerout',e=>{if(e.target.closest('[data-tip]')!==e.relatedTarget?.closest?.('[data-tip]'))hideTip();});
  document.addEventListener('focusin',e=>{const target=e.target.closest('[data-tip]');if(target)showTip(target);});
  document.addEventListener('focusout',hideTip);window.addEventListener('scroll',hideTip,{passive:true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')hideTip();const target=e.target.closest('.day-group');if(target&&(e.key==='Enter'||e.key===' ')){e.preventDefault();target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
  document.addEventListener('click',e=>{
    const target=e.target.closest('button,[role="button"]');if(!target)return;
    if(target.dataset.page){navigate(target.dataset.page);return;}
    if(target.dataset.project){drillProject(target.dataset.project);return;}
    if(target.dataset.model){state.model=target.dataset.model;state.page='models';render();window.scrollTo({top:0});return;}
    if(target.dataset.trend){state.trend=target.dataset.trend;render();return;}
    if(target.dataset.preset){applyPreset(target.dataset.preset);return;}
    if(target.dataset.view){state.view=target.dataset.view;state.pageIndex=0;render();return;}
    if(target.dataset.day){openDay(target.dataset.day,target);return;}
    if(target.dataset.month){const month=target.dataset.month;state.start=month+'-01';state.end=shiftDay(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10),-1);if(state.end>latest)state.end=latest;state.scope='custom';render();return;}
    if(target.id==='back-projects'){state.project=state.returnProject;state.detail=false;render();return;}
    if(target.id==='toggle-projects'){projectExpanded=!projectExpanded;render();return;}
    if(target.id==='detail-explore'){applyPreset('trend');state.view='table';render();return;}
    if(target.id==='prev-results'||target.id==='next-results'){state.pageIndex+=target.id==='prev-results'?-1:1;render();return;}
    if(target.id==='close-day')$('day-dialog').close();
  });
  $('day-dialog').addEventListener('close',()=>lastDayTrigger?.isConnected&&lastDayTrigger.focus());
  $('day-dialog').addEventListener('click',e=>{if(e.target===$('day-dialog')){const r=$('day-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('day-dialog').close();}});
  $('apply-day').addEventListener('click',()=>{$('day-dialog').close();state.start=selectedDay;state.end=selectedDay;state.scope='custom';render();});
  function closeDateEditor(focus=false){dateEditing=false;$('custom-dates').hidden=true;$('edit-date-range').setAttribute('aria-expanded','false');$('scope').value=state.scope;if(focus)$('edit-date-range').focus();}
  function openDateEditor(){dateEditing=true;dateError='';$('date-error').textContent='';$('global-filter-menu').open=false;$('start').value=state.start;$('end').value=state.end;$('custom-dates').hidden=false;$('edit-date-range').setAttribute('aria-expanded','true');$('scope').value='custom';$('start').focus();}
  $('edit-date-range').addEventListener('click',()=>dateEditing?closeDateEditor(true):openDateEditor());
  $('close-date-range').addEventListener('click',()=>closeDateEditor(true));
  $('close-global-filters').addEventListener('click',()=>{$('global-filter-menu').open=false;$('global-filter-menu').querySelector('summary').focus();});
  $('global-filter-menu').addEventListener('toggle',()=>{if($('global-filter-menu').open)closeDateEditor();});
  document.addEventListener('pointerdown',e=>{if(e.target.closest('#locale-switch'))return;if(!$('global-filter-menu').contains(e.target))$('global-filter-menu').open=false;if(dateEditing&&!$('custom-dates').contains(e.target)&&!$('edit-date-range').contains(e.target)&&e.target!==$('scope'))closeDateEditor();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&(dateEditing||$('global-filter-menu').open)){e.preventDefault();e.stopImmediatePropagation();if(dateEditing)closeDateEditor(true);else{$('global-filter-menu').open=false;$('global-filter-menu').querySelector('summary').focus();}}},true);
  $('scope').addEventListener('change',()=>{const choice=$('scope').value;if(scopes[choice]){closeDateEditor();state.scope=choice;[state.start,state.end]=scopes[choice];state.pageIndex=0;render();}else openDateEditor();});
  ['project','model'].forEach(key=>$(key).addEventListener('change',()=>{state[key]=$(key).value;if(key==='project'){state.detail=false;state.returnProject='';}state.pageIndex=0;render();}));
  $('global-filters').addEventListener('submit',e=>{
    e.preventDefault();const start=$('start').value,end=$('end').value;
    if(!start||!end||start>end){dateError='开始日期不能晚于结束日期';$('date-error').textContent=ui(dateError);return;}
    if(dayCount(start,end)>36600){dateError='请选择 100 年以内的日期范围';$('date-error').textContent=ui(dateError);return;}
    dateError='';dateEditing=false;state.start=start;state.end=end;state.scope='custom';state.pageIndex=0;render();$('edit-date-range').focus();
  });
  $('reset-filters').addEventListener('click',()=>{closeDateEditor();$('global-filter-menu').open=false;state.start=report.start;state.end=report.end;state.scope=Object.keys(scopes).find(k=>scopes[k][0]===state.start&&scopes[k][1]===state.end)||'custom';state.project='';state.model='';state.detail=false;state.returnProject='';state.search='';state.pageIndex=0;dateError='';render();$('global-filter-menu').querySelector('summary').focus();});
  $('project-search').addEventListener('input',()=>{state.search=$('project-search').value;renderProjects();saveState();});
  $('project-sort').addEventListener('change',()=>{state.projectSort=$('project-sort').value;render();});
  ['dimension','metric'].forEach(key=>$(key).addEventListener('change',()=>{state[key]=$(key).value;state.preset='';state.pageIndex=0;render();}));
  $('explore-sort').addEventListener('change',()=>{state.sort=$('explore-sort').value;state.pageIndex=0;render();});
  $('reload-snapshot').addEventListener('click',()=>location.reload());
  document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();navigate('overview');});
  window.addEventListener('hashchange',()=>{restoreState();i18n.setLocale(new URLSearchParams(location.hash.slice(1)).get('lang'));render();});
  window.addEventListener('codex:locale-change',()=>{
    // Preserve unapplied dates and an unsaved business-parent selection as well
    // as the active filters. Values are identities, never translated UI copy.
    const drafts=new Map((state.scope==='custom'||dateEditing?['start','end','agent-parent']:['agent-parent']).filter(id=>$(id)).map(id=>[id,$(id).value]));
    render();for(const [id,value]of drafts)if($(id))$(id).value=value;
    if($('day-dialog').open)openDay(selectedDay,lastDayTrigger);
  });
  window.CodexWorkspace = {
    report,calendarDay,
    setObservationConnected:value=>{observationConnected=Boolean(value);renderWorkspaceMode();},
    scope:()=>({page:state.page,start:state.start,end:state.end,project:state.project,model:state.model,records:current}),
    projectDetail:drillProject,
    registerGraph:graph=>{
      for(const [id,values] of [['project',(graph.projects||[]).map(p=>p.name)],['model',(graph.nodes||[]).map(n=>n.model)]]) {
        const select=$(id),existing=new Set([...select.options].map(o=>o.value));
        for(const value of [...new Set(values)].sort())if(value&&!existing.has(value)){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}
      }
    }
  };
  window.addEventListener('focus',()=>render());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
  restoreState();render();
})();
