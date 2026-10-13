(() => {
  'use strict';
  const i18n=window.CodexI18n, ui=i18n.ui;
  const bridge = window.CodexWorkspace;
  if (!bridge) return;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = i18n.integer;
  const compact = i18n.compact;
  const money = v => '$' + Number(v || 0).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2});
  const active = new Set(['working','waiting_agents','waiting_user']);
  const scenes = window.CodexAgentScenes,personal=window.CodexOfficePreferences;
  const attentionStates=['waiting_user','failed','interrupted','unknown'];
  const liveOrigin = ['http:','https:'].includes(location.protocol) && ['127.0.0.1','localhost'].includes(location.hostname);
  let graph = bridge.report.agent_graph || {nodes:[],edges:[],projects:[],warnings:['当前快照没有 Agent 数据，请重新生成报表。']};
  let scope = bridge.scope(), connected = false, failed = false, paused = false, fetching = false, timer;
  let selected = '', bounds = {width:1,height:1}, positions = new Map(), costs = new Map(), included = new Set();
  let hasFit = false, needsFit = true, lastTopology = '', transform = {x:24,y:24,scale:1};
  let collapsed = new Set(), observerWindow = 'current', observerState = '', search = '', showCollaboration = false, focusedCanvas = false;
  let sceneMode = scenes ? 'office' : 'graph';
  let office = null;
  let workingTargets=[];
  try {
    const saved = JSON.parse(localStorage.getItem('codex-agent-canvas-v2') || localStorage.getItem('codex-agent-canvas-v1') || '{}');
    if (['current','recent','week','all'].includes(saved.window)) observerWindow = saved.window;
    // New branches are expanded unless explicitly collapsed. The old whitelist
    // only expanded nodes from the embedded snapshot and hid live discoveries.
    collapsed = new Set(Array.isArray(saved.collapsed) ? saved.collapsed.filter(x=>typeof x==='string').slice(0,500) : []);
    showCollaboration = Boolean(saved.collaboration);
    if(scenes && ['office','prison','graph'].includes(saved.scene))sceneMode=saved.scene;
  } catch (_) { /* Preferences are optional in offline/private browsers. */ }
  $('agent-window').value = observerWindow;
  $('agent-collaboration').checked = showCollaboration;

  function savePreferences() {
    try { localStorage.setItem('codex-agent-canvas-v2',JSON.stringify({window:observerWindow,collapsed:[...collapsed].slice(-500),collaboration:showCollaboration,scene:sceneMode})); } catch (_) {}
  }
  function ageText(timestamp) {
    if (!timestamp) return ui('活动时间未知');
    const seconds = Math.max(0,Date.now()/1000-timestamp);
    return seconds < 60 ? ui('刚刚') : seconds < 3600 ? Math.floor(seconds/60)+ui(' 分钟前') : seconds < 86400 ? Math.floor(seconds/3600)+ui(' 小时前') : Math.floor(seconds/86400)+ui(' 天前');
  }
  function observedNodes() {
    const now = Date.now()/1000;
    return graph.nodes.map(n => active.has(n.status) && now-n.last_activity_at>300
      ? {...n,status:'unknown',status_label:'状态待确认',status_reason:'最近活动超过 5 分钟，不能据此确认仍在运行或判断卡住'} : n)
      .map(n=>({...n,status_label:i18n.systemText(n.status_label),status_reason:i18n.systemText(n.status_reason),current_activity:i18n.systemText(n.current_activity)}));
  }
  function account(rows) {
    const total = {total_tokens:0,input_tokens:0,cached_input_tokens:0,calls:0,known_price_calls:0,unknown_price_calls:0,estimated_cost_usd:0};
    for (const r of rows) for (const k of Object.keys(total)) total[k] += Number(r[k] || 0);
    return total;
  }
  function updateCosts() {
    const groups = new Map(), keys = bridge.report.explorer?.session_keys || [];
    const byKey = new Map((graph.nodes||[]).map(n=>[n.usage_key,n.id]));
    for (const row of scope.records) {
      const sid = byKey.get(keys[row.session]);
      if (!sid) continue;
      if (!groups.has(sid)) groups.set(sid,[]);
      groups.get(sid).push(row);
    }
    costs = new Map([...groups].map(([id,rows])=>[id,account(rows)]));
  }
  function spend(total) {return total?.calls && !total.known_price_calls ? ui('未计价') : money(total?.estimated_cost_usd);}
  function childrenMap(nodes) {
    const map = new Map();
    for (const n of nodes) {
      const parent = n.kind==='subagent' ? n.parent_agent_id : n.business_parent_id;
      if (parent) {if(!map.has(parent))map.set(parent,[]);map.get(parent).push(n);}
    }
    for (const list of map.values()) list.sort((a,b)=>a.created_at-b.created_at || a.id.localeCompare(b.id));
    return map;
  }
  function chooseNodes(nodes) {
    const byId = new Map(nodes.map(n=>[n.id,n])), wanted = new Set(), now = Date.now()/1000;
    const inScope = n => (!scope.project || n.project===scope.project) && (!scope.model || n.model===scope.model);
    const currentOrganization=new Set();
    if(observerWindow==='current'){
      const children=childrenMap(nodes),visited=new Set(),stack=nodes.filter(n=>inScope(n)&&!n.archived&&(active.has(n.status)||now-n.last_activity_at<86400&&(n.kind==='session'||['unknown','failed'].includes(n.status)))).map(n=>n.id);
      while(stack.length){
        const id=stack.pop();if(visited.has(id))continue;visited.add(id);
        const n=byId.get(id);if(n&&inScope(n))currentOrganization.add(id);
        for(const child of children.get(id)||[])if(!child.archived)stack.push(child.id);
      }
    }
    for (const n of nodes) {
      if (!inScope(n)) continue;
      // A completed turn is not a completed project: keep recently worked
      // independent sessions as entry points to their organization.
      if (observerWindow==='current' && !currentOrganization.has(n.id)) continue;
      if (observerWindow==='recent' && (n.archived || now-n.last_activity_at>86400)) continue;
      if (observerWindow==='week' && (n.archived || now-n.last_activity_at>604800)) continue;
      if (observerState==='working' && n.status!=='working') continue;
      if (observerState==='waiting' && !['waiting_user','waiting_agents'].includes(n.status)) continue;
      if (observerState==='attention' && !attentionStates.includes(n.status)) continue;
      if (search && ![n.title,n.agent_name,personal.name(n),n.model,n.project,n.current_activity].join(' ').toLowerCase().includes(search.toLowerCase())) continue;
      wanted.add(n.id);
    }
    included = new Set(wanted);
    for (const id of [...included]) {
      let node = byId.get(id), seen = new Set([id]);
      while (node) {
        const parent = node.kind==='subagent' ? node.parent_agent_id : node.business_parent_id;
        if (!parent || seen.has(parent) || !byId.has(parent)) break;
        seen.add(parent);included.add(parent);node=byId.get(parent);
      }
    }
    return {pool:nodes.filter(n=>included.has(n.id)),wanted,byId};
  }
  function relatedIds(nodes) {
    if (!selected) return null;
    const set = new Set([selected]), byId = new Map(nodes.map(n=>[n.id,n])), children = childrenMap(nodes);
    let cursor = byId.get(selected), visited = new Set();
    while (cursor && !visited.has(cursor.id)) {visited.add(cursor.id);set.add(cursor.id);cursor=byId.get(cursor.kind==='subagent'?cursor.parent_agent_id:cursor.business_parent_id);}
    const stack = [...(children.get(selected)||[])];
    while(stack.length){const n=stack.pop();if(set.has(n.id))continue;set.add(n.id);stack.push(...(children.get(n.id)||[]));}
    if(showCollaboration) for(const e of graph.edges)if(e.kind==='collaboration'&&(e.source===selected||e.target===selected)){set.add(e.source);set.add(e.target);}
    return set;
  }
  function visibleChildren(n, level, children, projectId) {
    return (children.get(n.id)||[]).filter(c=>c.project_id===projectId && (!collapsed.has(n.id) || search));
  }
  function layoutDirection(pool, children, orientation) {
    positions = new Map();
    const groups = new Map(), regions = [], width=(scenes?.metrics(sceneMode,'session')||{width:248}).width, xGap=76, yGap=18;
    for(const n of pool){if(!groups.has(n.project_id))groups.set(n.project_id,[]);groups.get(n.project_id).push(n);}
    let projectY=16, maxWidth=1;
    // Project and node ordering depends on identity/creation, never volatile status.
    for(const [projectId,projectNodes] of [...groups].sort((a,b)=>a[1][0].project.localeCompare(b[1][0].project,'zh-CN') || a[0].localeCompare(b[0]))) {
      const byId=new Map(projectNodes.map(n=>[n.id,n]));
      const roots=projectNodes.filter(n=>!byId.has(n.kind==='subagent'?n.parent_agent_id:n.business_parent_id)).sort((a,b)=>a.created_at-b.created_at||a.id.localeCompare(b.id));
      const planned=new Set();
      function measure(n,level,ancestors) {
        if(ancestors.has(n.id)||planned.has(n.id))return null;
        planned.add(n.id);const next=new Set(ancestors);next.add(n.id);
        const kids=visibleChildren(n,level,children,projectId).map(c=>measure(c,level+1,next)).filter(Boolean);
        const size=scenes?.metrics(sceneMode,n.kind)||{width:n.kind==='subagent'?220:248,height:n.kind==='subagent'?136:160},nodeHeight=size.height,nodeWidth=size.width;
        return {node:n,level,kids,nodeHeight,nodeWidth,
          height:orientation==='vertical'?nodeHeight+(kids.length?76+Math.max(...kids.map(c=>c.height)):0):Math.max(nodeHeight,kids.reduce((v,c)=>v+c.height,0)+Math.max(0,kids.length-1)*yGap),
          width:Math.max(nodeWidth,kids.reduce((v,c)=>v+c.width,0)+Math.max(0,kids.length-1)*24)};
      }
      let plans=roots.map(n=>measure(n,0,new Set())).filter(Boolean);
      // Broken or cyclic source metadata never makes the entire project disappear.
      for(const n of projectNodes)if(!planned.has(n.id)){
        const parent=n.kind==='subagent'?n.parent_agent_id:n.business_parent_id;
        if(!included.has(parent))plans.push(measure(n,0,new Set()));
      }
      if(!plans.length&&projectNodes.length)plans=[measure(projectNodes[0],0,new Set())].filter(Boolean);
      let localY=projectY+(sceneMode==='graph'?60:72),maxX=0;
      function place(p,y) {
        const x=38+p.level*(width+xGap),ny=y+(p.height-p.nodeHeight)/2;
        positions.set(p.node.id,{x,y:ny,node:p.node,level:p.level,height:p.nodeHeight,width:p.nodeWidth,orientation});maxX=Math.max(maxX,x+p.nodeWidth+22);
        let childY=y;
        for(const child of p.kids){place(child,childY);childY+=child.height+yGap;}
      }
      if(orientation==='vertical'){
        function placeVertical(p,x,y){
          const nx=x+(p.width-p.nodeWidth)/2;
          positions.set(p.node.id,{x:nx,y,node:p.node,level:p.level,height:p.nodeHeight,width:p.nodeWidth,orientation});
          maxX=Math.max(maxX,nx+p.nodeWidth+22);let childX=x;
          for(const child of p.kids){placeVertical(child,childX,y+p.nodeHeight+76);childX+=child.width+24;}
        }
        let localX=38,forestHeight=0;
        for(const p of plans){placeVertical(p,localX,localY);localX+=p.width+36;forestHeight=Math.max(forestHeight,p.height);}
        localY+=forestHeight+yGap;
      }else for(const p of plans){place(p,localY);localY+=p.height+yGap;}
      const regionHeight=Math.max(270,localY-projectY+(sceneMode==='graph'?4:56)),regionWidth=Math.max(310,maxX);
      regions.push({id:projectId,name:projectNodes[0].project,x:16,y:projectY,width:regionWidth-16,height:regionHeight,nodes:projectNodes});
      maxWidth=Math.max(maxWidth,regionWidth+16);projectY+=regionHeight+24;
    }
    // Pack independent project regions across the available width instead of
    // turning a multi-project workbench into one very long vertical page.
    const available=Math.max(330,$('agent-viewport').clientWidth-28);
    let rowX=16,rowY=16,rowHeight=0,packedWidth=1;
    for(const region of regions) {
      if(rowX>16&&rowX+region.width+16>available){rowX=16;rowY+=rowHeight+24;rowHeight=0;}
      const dx=rowX-region.x,dy=rowY-region.y;
      for(const p of positions.values())if(p.node.project_id===region.id){p.x+=dx;p.y+=dy;}
      region.x=rowX;region.y=rowY;rowX+=region.width+24;rowHeight=Math.max(rowHeight,region.height);packedWidth=Math.max(packedWidth,rowX);
    }
    bounds={width:packedWidth,height:Math.max(1,rowY+rowHeight+16)};
    return regions;
  }
  function layout(pool,children){
    const viewport=$('agent-viewport'),top=(viewport.querySelector('.agent-controls')?.offsetHeight||38)+24,bottom=52;
    const score=()=>Math.min(1,(viewport.clientWidth-32)/bounds.width,Math.max(80,viewport.clientHeight-top-bottom)/bounds.height);
    const horizontal=layoutDirection(pool,children,'horizontal'),horizontalPositions=positions,horizontalBounds=bounds,horizontalScore=score();
    const vertical=layoutDirection(pool,children,'vertical');
    // Choose the orientation that keeps text largest, rather than fitting a
    // tall six-worker tree into a narrow strip in the middle of a wide canvas.
    if(score()>horizontalScore*1.08)return vertical;
    positions=horizontalPositions;bounds=horizontalBounds;return horizontal;
  }
  function nodeMarkup(p, children, wanted, related) {
    const n=p.node,total=costs.get(n.id),kids=children.get(n.id)||[],localKids=kids.filter(c=>c.project_id===n.project_id);
    const branchCount=localKids.length, business=kids.filter(c=>c.kind==='session').length;
    const role=n.kind==='subagent'?`Subagent · ${personal.name(n)}`:business?ui('主 Agent · 编排'):ui('主 Agent');
    const kindIcon=n.kind==='subagent'?'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v8a4 4 0 0 0 4 4h10m-5-5 5 5-5 5"/></svg>':'<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="6" rx="1"/><path d="M12 9v4H5v7m7-7h7v7"/><path d="M3 20h4m10 0h4"/></svg>';
    const count=kids.filter(c=>active.has(c.status)).length;
    return `<article class="agent-node ${n.kind} ${n.id===selected?'selected':''} ${related&&!related.has(n.id)?'dim':''} ${!wanted.has(n.id)?'context':''}" style="left:${p.x}px;top:${p.y}px" data-node-id="${esc(n.id)}" data-status="${esc(n.status)}">
      <button class="agent-node-select" data-select-agent="${esc(n.id)}" aria-pressed="${n.id===selected}" aria-label="${esc(role+' · '+n.title+' · '+n.status_label)}">
        <div class="agent-node-top"><span class="agent-node-kind"><i aria-hidden="true">${kindIcon}</i>${esc(role)}</span><span class="agent-node-status" title="${esc(n.status_reason)}">${esc(n.status_label)}</span></div>
        <div class="agent-node-title">${esc(n.task_summary)}</div>
        <div class="agent-node-meta"><span title="${esc(n.current_activity)}">${esc(n.model)}</span><span>${ageText(n.last_activity_at)}</span></div>
        <div class="agent-node-cost"><span>${total?.calls?compact(total.total_tokens)+' Token · '+number(total.calls)+ui(' 续跑'):ui('当前用量范围暂无记录')}</span><b>${total?.calls?spend(total)+(total.unknown_price_calls&&total.known_price_calls?'*':''):'—'}</b></div>
      </button>
      <div class="agent-node-footer"><span>${n.kind==='subagent'?esc(n.agent_role):ui('独立会话')}${!wanted.has(n.id)?ui(' · 关联结构'):''}</span>${branchCount?ui`<button data-expand-agent="${esc(n.id)}" aria-expanded="${!collapsed.has(n.id)}">${collapsed.has(n.id)?ui('展开'):ui('收起')} ${branchCount} 分支${count?' · '+count+ui(' 活动'):''}</button>`:`<span class="agent-descendants">${n.direct_subagent_count?number(n.direct_subagent_count)+ui(' 个历史 subagents'):ui('无当前分支')}</span>`}</div>
    </article>`;
  }
  function regionMarkup(r){
    return ui`<section class="agent-project-region" data-canvas-project="${esc(r.id)}" style="left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px"><div class="agent-project-caption"><strong>${esc(r.name)}</strong><span>${r.nodes.filter(n=>n.kind==='session').length} 会话 · ${r.nodes.filter(n=>n.kind==='subagent').length} subagents</span><small>${r.nodes.filter(n=>active.has(n.status)).length} 执行 / 等待</small></div></section>`;
  }
  function applyTransform() {
    $('agent-world').style.transform=`translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`;
    const grid=$('agent-viewport').style;
    grid.setProperty('--agent-grid-size',24*transform.scale+'px');
    grid.setProperty('--agent-grid-major-size',120*transform.scale+'px');
    grid.setProperty('--agent-grid-x',transform.x+'px');grid.setProperty('--agent-grid-y',transform.y+'px');
    $('agent-zoom-label').textContent=Math.round(transform.scale*100)+'%';
  }
  function fit() {
    if(sceneMode!=='graph'){office?.available&&office.fit();hasFit=true;needsFit=false;return;}
    const viewport=$('agent-viewport');if(!viewport.clientWidth||!positions.size)return;
    const controls=$('agent-controls') || viewport.querySelector('.agent-controls');
    const top=(controls?.offsetHeight||38)+24,bottom=52;
    transform.scale=Math.max(.08,Math.min(1,(viewport.clientWidth-32)/bounds.width,Math.max(80,viewport.clientHeight-top-bottom)/bounds.height));
    transform.x=Math.max(12,(viewport.clientWidth-bounds.width*transform.scale)/2);transform.y=top;
    hasFit=true;needsFit=false;applyTransform();
  }
  function zoom(factor,x,y) {
    if(sceneMode!=='graph'){office?.available&&office.zoom(factor);return;}
    const v=$('agent-viewport'),cx=x??v.clientWidth/2,cy=y??v.clientHeight/2;
    const previous=transform.scale;transform.scale=Math.max(.08,Math.min(2,previous*factor));
    transform.x=cx-(cx-transform.x)*transform.scale/previous;transform.y=cy-(cy-transform.y)*transform.scale/previous;applyTransform();
  }
  function branchStates(nodes) {
    const children=childrenMap(nodes),byId=new Map(nodes.map(n=>[n.id,n])),states=new Map();
    const priority={working:8,waiting_user:7,waiting_agents:6,failed:5,unknown:4,interrupted:3,idle:2,archived:1};
    function state(id,seen=new Set()) {
      if(states.has(id))return states.get(id);
      const n=byId.get(id);if(!n||seen.has(id))return 'unknown';
      const path=new Set(seen);path.add(id);let result=n.status;
      for(const c of children.get(id)||[]) {
        if(c.archived)continue;
        const child=state(c.id,path);if((priority[child]||0)>(priority[result]||0))result=child;
      }
      states.set(id,result);return result;
    }
    for(const n of nodes)state(n.id);
    return states;
  }
  function setFocus(value) {
    focusedCanvas=value;document.body.dataset.canvasFocus=String(value);
    $('agent-focus').textContent=value?ui('退出专注 ⛶'):ui('专注画布 ⛶');
    $('agent-focus').setAttribute('aria-label',value?ui('退出专注画布'):ui('进入专注画布'));
    $('agent-focus').setAttribute('aria-pressed',String(value));needsFit=true;
  }
  function renderGraph() {
    if(scope.page!=='agents')return;
    $('agent-viewport').dataset.scene=sceneMode;
    $('agent-viewport').setAttribute('aria-label',sceneMode==='office'?ui('Agent 虚拟办公室画布'):sceneMode==='prison'?ui('Agent 趣味监狱画布'):ui('Agent 组织画布'));
    document.querySelectorAll('[data-agent-scene]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.agentScene===sceneMode)));
    const nodes=observedNodes(),{pool,wanted,byId}=chooseNodes(nodes),children=childrenMap(pool),related=relatedIds(nodes);
    if(selected&&!byId.has(selected))selected='';
    $('agent-summary').innerHTML=[[ui('项目'),new Set(pool.map(n=>n.project_id)).size],[ui('会话'),pool.filter(n=>n.kind==='session').length],[ui('活动'),pool.filter(n=>active.has(n.status)).length],[ui('待确认 / 失败'),pool.filter(n=>['unknown','failed'].includes(n.status)).length]].map(([label,value])=>`<div class="agent-summary-item"><span>${label}</span><b>${number(value)}</b></div>`).join('');
    $('agent-connection-label').textContent=connected?(paused?ui('已暂停自动观察'):ui('本地观察 · ')+(graph.refresh_seconds||5)+ui(' 秒更新')):failed?ui('连接中断 · 保留最后观察'):ui('离线观察快照');
    $('agent-observed-at').textContent=graph.observed_at?ui('观察于 ')+new Date(graph.observed_at).toLocaleTimeString(i18n.locale,{hour12:false}):'';
    $('agent-pause').disabled=!connected;
    $('agent-pause').textContent=paused?ui('继续更新'):ui('暂停更新');$('agent-pause').setAttribute('aria-pressed',String(paused));
    const observing=connected&&!paused&&!graph.data_stale;
    workingTargets=observing?pool.filter(n=>wanted.has(n.id)&&n.status==='working').map(n=>n.id):[];
    $('agent-locate-working').disabled=!workingTargets.length;
    $('agent-locate-working').textContent=!observing?ui('执行待确认'):workingTargets.length?ui('定位执行 · ')+workingTargets.length:ui('暂无执行');
    $('agent-locate-working').title=observing?ui('按当前项目、模型和状态筛选，依次定位近期有执行记录的 Agent'):ui('观察已暂停或不可确认，不推断仍在执行');
    $('agent-refresh').textContent=liveOrigin?ui('刷新状态'):ui('重新载入');
    bridge.setObservationConnected(connected);
    const note=connected?ui('状态来自本地回合记录，非运行时订阅。'):failed?ui('观察服务失去连接，保留最后记录；可以点击刷新状态重试。'):ui('离线快照不能持续观察；双击 run-workspace.command 启动本地服务。');
    $('agent-notice').textContent=note+ui(' 日期只筛选节点用量；任务说明为本轮请求短摘录或会话标题。')+(graph.warnings?.length?' '+graph.warnings.map(i18n.systemText).join(i18n.locale==='en'?'; ':'；'):'');
    $('agent-notice').classList.toggle('offline',!connected||Boolean(graph.warnings?.length));
    document.body.dataset.agentConnection=connected?'connected':failed?'failed':'offline';
    $('agent-workspace').classList.toggle('has-detail',Boolean(selected));
    const viewport=$('agent-viewport'),controlStrip=viewport.querySelector('.agent-controls');
    viewport.style.setProperty('--agent-legend-height',Math.max(80,viewport.clientHeight-(controlStrip?.offsetTop||12)-(controlStrip?.offsetHeight||38)-90)+'px');
    const expandable=pool.filter(n=>(children.get(n.id)||[]).some(c=>c.project_id===n.project_id));
    $('agent-collapse-all').textContent=expandable.length&&expandable.every(n=>collapsed.has(n.id))?ui('展开分支'):ui('折叠分支');
    renderAttention(nodes);
    renderDetail(nodes,childrenMap(nodes));
    $('agent-data-note').textContent=ui`节点金额为自身用量，不包含下属；范围 ${scope.start} — ${scope.end}，用量快照 ${bridge.report.generated_at.slice(0,19).replace('T',' ')}。* 表示部分未计价。本轮结束不等于项目完成。`;
    $('agent-instructions').textContent=sceneMode==='graph'?ui('拖动 / 空格 + 拖动平移 · ⌘ / Ctrl + 滚轮缩放 · 0 适应 · 连线活动为记录观察'):ui('左键旋转 · 右键 / Shift / 空格 + 拖动平移 · 滚轮缩放 · 点选人物 · 0 适应');
    const in3d=sceneMode!=='graph'&&Boolean(scenes);
    $('agent-world').hidden=in3d;
    if(in3d){
      $('agent-world').replaceChildren();
      if(!office){office=scenes.create($('agent-viewport'),id=>{selected=id;renderGraph();requestAnimationFrame(centerSelected);});window.CodexAgentOffice=office;}
      $('agent-3d').hidden=false;office.setVisible(true);
      const visible=pool.filter(n=>{
        if(search)return true;
        const visited=new Set([n.id]);let cursor=n;
        while(cursor){
          const pid=cursor.kind==='subagent'?cursor.parent_agent_id:cursor.business_parent_id;
          const p=byId.get(pid);if(!p||p.project_id!==n.project_id||visited.has(pid))break;
          if(collapsed.has(pid))return false;visited.add(pid);cursor=p;
        }return true;
      });
      const ids=new Set(visible.map(n=>n.id)),edges=graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)&&(e.kind==='delegation'||e.kind==='subagent'||e.kind==='collaboration'&&showCollaboration));
      if(office.available)office.update({nodes:visible,edges,states:branchStates(pool),selected,related,wanted,children,collapsed,mode:sceneMode,motion:observing,observation:!connected?'offline':graph.data_stale?'stale':paused?'paused':'live',fit:needsFit});
      $('agent-empty').hidden=Boolean(visible.length)||!office.available;
      if(!visible.length)$('agent-empty').innerHTML=ui('<strong>当前范围没有匹配的工作</strong><span>可以查看最近会话，或调整项目、模型和状态筛选。</span><button id="agent-show-recent">查看最近 24 小时</button>');
      hasFit=true;needsFit=false;return;
    }
    office?.setVisible(false);$('agent-3d').hidden=true;
    const regions=layout(pool,children);
    const topology=[...positions.values()].map(p=>[p.node.id,p.x,p.y,p.height].join(':')).join('|');
    if(topology!==lastTopology){needsFit=true;lastTopology=topology;}
    const states=branchStates(pool),motion=connected&&!paused&&!graph.data_stale;
    const marker='<defs>'+['delegation','subagent','collaboration'].map((k,i)=>`<marker id="agent-arrow-${k}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="${['#3c9489','#a0b4cb','#a396bf'][i]}"/></marker>`).join('')+'</defs>';
    const lines=graph.edges.filter(e=>positions.has(e.source)&&positions.has(e.target)&&(e.kind==='delegation'||e.kind==='subagent'||e.kind==='collaboration'&&showCollaboration)).map(e=>{
      const a=positions.get(e.source),b=positions.get(e.target),vertical=a.orientation==='vertical'&&b.orientation==='vertical'&&e.kind!=='collaboration';
      const sx=a.x+(vertical?a.width/2:a.width),sy=a.y+(vertical?a.height:a.height/2),tx=b.x+(vertical?b.width/2:0),ty=b.y+(vertical?0:b.height/2),mx=(sx+tx)/2,my=(sy+ty)/2;
      const state=e.kind==='collaboration'?'recorded':states.get(e.target)||'unknown';
      const label={working:ui('下游分支近期执行（本地记录观察）'),waiting_agents:ui('下游等待代理'),waiting_user:ui('下游等待确认'),idle:ui('下游本轮已结束，不代表已合并'),failed:ui('下游有失败记录'),unknown:ui('下游状态待确认'),interrupted:ui('下游已中断'),archived:ui('下游已归档'),recorded:ui('历史协作记录，不代表正在传输')}[state];
      const d=vertical?`M${sx},${sy} C${sx},${Math.max(sy+26,my)} ${tx},${Math.min(ty-26,my)} ${tx},${ty}`:`M${sx},${sy} C${Math.max(sx+26,mx)},${sy} ${Math.min(tx-26,mx)},${ty} ${tx},${ty}`;
      const dim=related&&(!related.has(e.source)||!related.has(e.target))?'dim':'';
      return `<g class="agent-link ${dim}" data-edge-source="${esc(e.source)}" data-edge-target="${esc(e.target)}" data-activity="${state}"><title>${e.kind==='delegation'?ui('业务委托'):e.kind==='subagent'?ui('会话内代理'):ui('协作')}：${esc(byId.get(e.source)?.title)} → ${esc(byId.get(e.target)?.title)} · ${label}</title><path class="agent-edge ${e.kind} ${state}" data-edge-kind="${e.kind}" d="${d}" marker-end="url(#agent-arrow-${e.kind})"/>${motion&&state==='working'?`<path class="agent-edge-flow" d="${d}"/>`:''}</g>`;
    }).join('');
    const focused=document.activeElement?.closest('[data-node-id]')?.dataset.nodeId;
    $('agent-world').style.width=bounds.width+'px';$('agent-world').style.height=bounds.height+'px';
    $('agent-world').dataset.motion=motion?'live':'paused';
    $('agent-world').innerHTML=regions.map(regionMarkup).join('')+`<svg class="agent-lines" width="${bounds.width}" height="${bounds.height}" aria-hidden="true">${marker}${lines}</svg>`+[...positions.values()].map(p=>nodeMarkup(p,children,wanted,related)).join('');
    if(focused){const element=[...$('agent-world').querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===focused);element?.querySelector('button')?.focus({preventScroll:true});}
    $('agent-empty').hidden=Boolean(positions.size);
    if(!positions.size)$('agent-empty').innerHTML=ui('<strong>当前范围没有匹配的工作</strong><span>可以查看最近的会话，或调整项目、模型和状态筛选。</span><button id="agent-show-recent">查看最近 24 小时</button>');
    if(needsFit||!hasFit)requestAnimationFrame(fit);else applyTransform();
    $('agent-data-note').textContent=ui`节点金额为自身用量，不包含下属；范围 ${scope.start} — ${scope.end}，用量快照 ${bridge.report.generated_at.slice(0,19).replace('T',' ')}。* 表示部分未计价。本轮结束不等于项目完成。`;
  }
  function renderAttention(nodes) {
    const watching=connected&&!paused&&!graph.data_stale,showAll=$('attention-scope').value==='all',now=Date.now();
    const items=nodes.filter(n=>!n.archived&&attentionStates.includes(n.status)&&now/1000-(n.last_activity_at||0)<604800&&(!scope.project||n.project===scope.project)&&(!scope.model||n.model===scope.model)).sort((a,b)=>attentionStates.indexOf(a.status)-attentionStates.indexOf(b.status)||b.last_activity_at-a.last_activity_at);
    const pending=items.filter(n=>{const mark=personal.attention(n);return !mark||!mark.viewed&&!(mark.until>now);});
    $('agent-attention-toggle').textContent=ui('需要我处理')+' · '+pending.length;
    $('attention-note').textContent=ui(watching?'最近 7 天 · 当前项目和模型筛选 · 待确认不等于执行失败':'观察已暂停或离线，以下为最后记录。');
    if($('agent-attention-panel').hidden)return;
    const visible=(showAll?items:pending).slice(0,200);
    $('attention-list').innerHTML=visible.length?visible.map(n=>{
      const mark=personal.attention(n),label=mark?.viewed?ui('已查看'):mark?.until>now?ui('稍后处理'):ui('未处理');
      return '<article class="attention-row" data-attention-agent="'+esc(n.id)+'"><div><strong>'+esc(personal.name(n))+'</strong><small>'+esc(n.project)+' · '+esc(n.status_label)+' · '+ageText(n.last_activity_at)+'</small><small>'+esc(n.status_reason)+'</small><small>'+label+'</small></div><div class="attention-actions"><button class="preset" data-attention-locate="'+esc(n.id)+'">'+ui('定位工位')+'</button><a href="codex://threads/'+encodeURIComponent(n.id)+'">'+ui('打开原会话 ↗')+'</a><button class="text-button" data-attention-mark="viewed" data-attention-id="'+esc(n.id)+'">'+ui('标记已查看')+'</button><button class="text-button" data-attention-mark="later" data-attention-id="'+esc(n.id)+'">'+ui('稍后 15 分钟')+'</button>'+(mark?'<button class="text-button" data-attention-mark="clear" data-attention-id="'+esc(n.id)+'">'+ui('恢复未处理')+'</button>':'')+'</div></article>';
    }).join(''):'<p class="empty">'+ui('当前没有未处理记录')+'</p>';
  }
  function customForm(n){
    const p=personal.get(n.id),option=(v,label,current)=>'<option value="'+v+'" '+(v===current?'selected':'')+'>'+ui(label)+'</option>';
    const colors=(values,current)=>option('auto','自动',current)+values.map((color,i)=>option(color,(values===personal.projectPalette?['森林绿','海蓝','陶土','紫灰','橄榄','青绿']:['海蓝','森林绿','玫瑰','紫灰','暖金','青绿'])[i],current)).join('');
    return '<details id="agent-custom-details"><summary>'+ui('员工与工位自定义')+'</summary><form class="agent-custom-form" id="agent-custom-form"><label>'+ui('显示昵称')+'<input id="custom-nickname" maxlength="32" aria-label="'+ui('显示昵称')+'" value="'+esc(p.nickname)+'" placeholder="'+esc(n.agent_name||n.title)+'"></label><div class="agent-custom-grid"><label>'+ui('员工形象')+'<select id="custom-species" aria-label="'+ui('员工形象')+'">'+[['auto','自动'],['human','人类'],['cow','奶牛'],['horse','马']].map(([v,t])=>option(v,t,p.species)).join('')+'</select></label><label>'+ui('服装颜色')+'<select id="custom-shirt" aria-label="'+ui('服装颜色')+'">'+colors(personal.palette,p.shirt)+'</select></label><label>'+ui('桌面摆件')+'<select id="custom-desk" aria-label="'+ui('桌面摆件')+'">'+[['default','默认'],['plant','绿植'],['notebook','笔记本'],['coffee','咖啡']].map(([v,t])=>option(v,t,p.desk)).join('')+'</select></label><label>'+ui('项目配色')+'<select id="custom-project-color" aria-label="'+ui('项目配色')+'">'+colors(personal.projectPalette,personal.project(n.project_id))+'</select></label></div><div><button class="primary-button">'+ui('保存外观')+'</button> <button class="text-button" type="button" id="custom-reset">'+ui('恢复默认外观')+'</button></div><small>'+ui('设置保存在当前浏览器，项目配色应用于整个办公区。')+'</small><span id="custom-message" class="agent-custom-message" role="status"></span></form></details>';
  }
  function renderDetail(nodes,children) {
    const panel=$('agent-detail'),n=nodes.find(n=>n.id===selected);panel.hidden=!n;if(!n)return;
    // Do not replace a hierarchy form while the user is choosing/editing it.
    const canEdit=connected&&graph.capabilities?.can_edit===true;
    if(panel.contains(document.activeElement)&&document.activeElement.closest('#agent-hierarchy-form')){
      panel.querySelectorAll('form button,form select').forEach(el=>{el.disabled=!canEdit;});
      if(!canEdit&&$('agent-hierarchy-message'))$('agent-hierarchy-message').textContent=ui('观察数据暂不可确认，恢复连接后再保存。');
      return;
    }
    if(panel.contains(document.activeElement)&&document.activeElement.closest('#agent-custom-form'))return;
    const own=costs.get(n.id)||account([]),ids=new Set(),stack=[n];
    while(stack.length){const x=stack.pop();if(ids.has(x.id))continue;ids.add(x.id);stack.push(...(children.get(x.id)||[]));}
    const branch=account([...ids].map(id=>costs.get(id)||{}));
    const byId=new Map(nodes.map(x=>[x.id,x])),parent=byId.get(n.business_parent_id),creator=byId.get(n.created_by);
    const nativeParent=byId.get(n.parent_agent_id);
    let owner=byId.get(n.owner_session_id);
    if(n.kind==='subagent'&&owner?.kind!=='session'){
      let cursor=nativeParent;const seen=new Set([n.id]);
      while(cursor&&!seen.has(cursor.id)){seen.add(cursor.id);if(cursor.kind==='session'){owner=cursor;break;}cursor=byId.get(cursor.parent_agent_id);}
    }
    const relationLink=(x,kind)=>ui`<button class="agent-relation-link" data-related-agent="${esc(x.id)}" data-relation-kind="${kind}" aria-label="定位 ${esc(x.kind==='subagent'?'Subagent':ui('主 Agent'))} · ${esc(x.title)}"><b>${x.kind==='subagent'?'Sub':ui('主')}</b><span>${esc(x.title)}</span><em>↗</em></button>`;
    const relationGroup=(label,list,kind)=>list.length?`<div><small>${label} · ${list.length}</small>${list.map(x=>relationLink(x,kind)).join('')}</div>`:'';
    const nativeChildren=nodes.filter(x=>x.kind==='subagent'&&x.parent_agent_id===n.id),businessChildren=nodes.filter(x=>x.kind==='session'&&x.business_parent_id===n.id);
    const relationships=n.kind==='subagent'
      ?relationGroup(ui('归属主 Agent'),owner?.kind==='session'?[owner]:[],'native')+relationGroup(ui('直接上级 Subagent'),nativeParent?.kind==='subagent'?[nativeParent]:[],'native')+relationGroup(ui('会话内下属'),nativeChildren,'native')
      :relationGroup(ui('业务上级'),parent?[parent]:[],'business')+relationGroup(ui('会话内下属'),nativeChildren,'native')+relationGroup(ui('委托的独立会话'),businessChildren,'business');
    const last=n.last_activity_at?new Date(n.last_activity_at*1000).toLocaleString(i18n.locale,{hour12:false}):ui('未知');
    const options=nodes.filter(x=>x.kind==='session'&&x.id!==n.id).sort((a,b)=>(a.project===n.project?0:1)-(b.project===n.project?0:1)||(active.has(a.status)?0:1)-(active.has(b.status)?0:1)||b.last_activity_at-a.last_activity_at||a.title.localeCompare(b.title));
    const sameNode=panel.dataset.selectedAgent===n.id;
    const openDetails=sameNode?[...panel.querySelectorAll('details')].map(d=>d.open):[];
    const scroll=sameNode?panel.scrollTop:0;
    panel.dataset.selectedAgent=n.id;
    panel.innerHTML=ui`<div class="agent-detail-head"><h2>${n.kind==='session'?ui('独立会话 · 主 Agent'):ui('会话内 Subagent')}</h2><button class="icon-button" id="agent-close-detail" aria-label="关闭代理详情">×</button></div>
      <h3 class="agent-detail-title">${esc(personal.get(n.id).nickname||n.title)}</h3><span class="agent-detail-label">当前主要任务 · ${n.task_source==='current_request_excerpt'?ui('本轮请求短摘录'):ui('会话标题')}</span><div class="agent-detail-task">${esc(n.task_summary)}</div>
      <p><b>${esc(n.status_label)}</b> · ${esc(n.current_activity)}</p><p>${esc(n.status_reason)}</p>
      ${customForm(n)}
      ${relationships?ui`<nav class="agent-detail-relationships" aria-label="Agent 连接关系">${relationships}</nav>`:''}
      <dl><dt>模型</dt><dd>${esc(n.model)} · ${esc(n.reasoning_effort)}</dd><dt>最近活动</dt><dd>${esc(last)}</dd><dt>项目</dt><dd>${esc(n.project)}</dd><dt>业务上级</dt><dd>${esc(n.kind==='subagent'?ui('不适用；这是会话内代理'):parent?.title||ui('独立编排 / 未指定'))}</dd><dt>发起会话</dt><dd>${esc(creator?.title||ui('没有可确认的发起记录'))}</dd>${n.kind==='subagent'?ui`<dt>归属会话</dt><dd>${esc(byId.get(n.owner_session_id)?.title||ui('归属待确认'))}</dd>`:''}<dt>工作目录</dt><dd>${esc(n.cwd)}</dd></dl>
      <span class="agent-detail-label">自身用量 · ${scope.start} — ${scope.end}</span><div class="agent-detail-stats"><div><b>${compact(own.total_tokens)}</b><small>Token · ${number(own.calls)} 续跑</small></div><div><b>${spend(own)}</b><small>API 等价已计价小计</small></div><div><b>${compact(own.cached_input_tokens)}</b><small>缓存命中 Token</small></div><div><b>${own.input_tokens?(own.cached_input_tokens/own.input_tokens*100).toFixed(1)+'%':'—'}</b><small>缓存命中率</small></div></div>
      <p>当前组织分支合计（含自身）：${compact(branch.total_tokens)} Token · ${spend(branch)}${branch.unknown_price_calls?ui(' · 含未计价用量'):''}。结果返回不代表已经验收或合并。</p>
      <div class="agent-detail-actions"><a href="codex://threads/${encodeURIComponent(n.id)}">打开原会话 ↗</a><button class="text-button" id="agent-project-usage" data-project-name="${esc(n.project)}">查看项目用量 ↗</button></div>
      ${n.kind==='session'?ui`<details id="agent-hierarchy-details"><summary>业务编排 · ${n.hierarchy_mode==='manual'?ui('手动指定'):ui('按发起记录组织')}</summary><p>只修改工作台的业务关系，不修改原会话，不发送任何 Agent 指令。</p><form id="agent-hierarchy-form"><label>业务上级<select id="agent-parent" aria-label="业务上级" ${!canEdit?'disabled':''}><option value="">无上级 · 独立编排</option>${options.map(x=>`<option value="${esc(x.id)}" ${x.id===n.business_parent_id?'selected':''}>${esc(x.project+' · '+x.title.slice(0,65))}</option>`).join('')}</select></label><div class="agent-hierarchy-buttons"><button class="primary-button" ${!canEdit?'disabled':''}>保存业务层级</button><button type="button" class="text-button" id="agent-auto-parent" ${!canEdit?'disabled':''}>恢复自动</button></div><span id="agent-hierarchy-message" class="agent-hierarchy-message" role="status">${canEdit?'':connected?ui('观察数据暂不可确认，恢复后再保存。'):ui('请通过本地服务打开后修改。')}</span></form></details>`:''}
      <details><summary>身份与数据来源</summary><p>会话 ID：<code>${esc(n.id)}</code></p><p>状态来自本地最新回合记录；不是对运行进程的确定性探测。只展示标题、代理组织和安全元数据，不展示完整聊天、思考过程或命令输出。</p></details>`;
    [...panel.querySelectorAll('details')].forEach((d,i)=>{if(openDetails[i])d.open=true;});
    panel.scrollTop=scroll;
  }
  async function refresh() {
    clearTimeout(timer);
    if(!liveOrigin||fetching||paused||scope.page!=='agents'||document.hidden)return;
    fetching=true;
    try {
      const response=await fetch('/api/agents',{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error(ui('本地服务不可用'));
      const data=await response.json();if(!Array.isArray(data.nodes)||!Array.isArray(data.edges))throw new Error(ui('无效的观察数据'));
      graph=data;connected=true;failed=false;bridge.registerGraph(graph);updateCosts();renderGraph();
    } catch(_) {failed=failed||connected;connected=false;renderGraph();}
    finally {fetching=false;if(scope.page==='agents'&&!paused&&!document.hidden)timer=setTimeout(refresh,(graph.refresh_seconds||5)*1000);}
  }
  async function saveHierarchy(automatic) {
    const message=$('agent-hierarchy-message');if(!message||!connected)return;
    const child=selected,parent=$('agent-parent').value||null;
    message.textContent=ui('正在保存…');message.classList.remove('error');
    try {
      const response=await fetch('/api/hierarchy',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':graph.edit_token},body:JSON.stringify({child_id:child,parent_id:parent,mode:automatic?'automatic':'manual'}),signal:AbortSignal.timeout(15000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||ui('保存失败'));
      graph=result;document.activeElement?.blur();needsFit=true;renderGraph();$('agent-hierarchy-details').open=true;$('agent-hierarchy-message').textContent=ui('已保存，仅影响工作台业务层级。');
    } catch(error) {message.textContent=i18n.systemText(error.message);message.classList.add('error');}
  }
  function centerSelected() {
    if(sceneMode!=='graph'){office?.available&&office.focus(selected);return;}
    const p=positions.get(selected),v=$('agent-viewport');if(!p)return;
    const detail=$('agent-detail'),available=v.clientWidth-(detail.hidden?0:detail.offsetWidth+24);
    transform.x=Math.max(130,available/2)-(p.x+p.width/2)*transform.scale;transform.y=v.clientHeight/2-(p.y+p.height/2)*transform.scale;applyTransform();
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.id==='agent-attention-toggle'){const panel=$('agent-attention-panel');panel.hidden=!panel.hidden;target.setAttribute('aria-expanded',String(!panel.hidden));renderAttention(observedNodes());}
    else if(target.id==='attention-close'){$('agent-attention-panel').hidden=true;$('agent-attention-toggle').setAttribute('aria-expanded','false');$('agent-attention-toggle').focus();}
    else if(target.dataset.attentionMark){const n=observedNodes().find(n=>n.id===target.dataset.attentionId);if(n){personal.mark(n,target.dataset.attentionMark);renderAttention(observedNodes());}}
    else if(target.dataset.attentionLocate){selected=target.dataset.attentionLocate;observerState='';search='';$('agent-state').value='';$('agent-search').value='';observerWindow='week';$('agent-window').value='week';collapsed.clear();savePreferences();renderGraph();requestAnimationFrame(centerSelected);}
    else if(target.id==='custom-reset'){const n=graph.nodes.find(n=>n.id===selected);if(n){document.activeElement.blur();const ok=personal.reset(n.id,n.project_id);$('agent-custom-details').open=true;$('custom-message').textContent=ui(ok?'已恢复默认外观':'浏览器无法保存，外观仅在本页生效。');}}
    else if(target.dataset.agentScene&&['office','prison','graph'].includes(target.dataset.agentScene)){sceneMode=target.dataset.agentScene;needsFit=true;savePreferences();renderGraph();}
    else if(target.id==='agent-fallback-graph'){sceneMode='graph';needsFit=true;savePreferences();renderGraph();}
    else if(target.dataset.selectAgent){selected=target.dataset.selectAgent;renderGraph();requestAnimationFrame(centerSelected);}
    else if(target.dataset.relatedAgent){selected=target.dataset.relatedAgent;renderGraph();requestAnimationFrame(centerSelected);}
    else if(target.id==='agent-locate-working'&&workingTargets.length){
      selected=workingTargets[(workingTargets.indexOf(selected)+1)%workingTargets.length];
      const byId=new Map(observedNodes().map(n=>[n.id,n])),seen=new Set();let cursor=byId.get(selected);
      while(cursor&&!seen.has(cursor.id)){seen.add(cursor.id);const pid=cursor.kind==='subagent'?cursor.parent_agent_id:cursor.business_parent_id;collapsed.delete(pid);cursor=byId.get(pid);}
      renderGraph();requestAnimationFrame(centerSelected);
    }
    else if(target.dataset.expandAgent){const id=target.dataset.expandAgent;collapsed.has(id)?collapsed.delete(id):collapsed.add(id);needsFit=true;savePreferences();renderGraph();}
    else if(target.id==='agent-close-detail'){selected='';renderGraph();}
    else if(target.id==='agent-project-usage'){bridge.projectDetail(target.dataset.projectName);}
    else if(target.id==='agent-fit'){fit();}
    else if(target.id==='agent-zoom-in'){zoom(1.2);}
    else if(target.id==='agent-zoom-out'){zoom(1/1.2);}
    else if(target.id==='agent-collapse-all'){
      if(target.textContent===ui('展开分支'))collapsed.clear();
      else for(const n of graph.nodes)if(included.has(n.id))collapsed.add(n.id);
      selected='';needsFit=true;savePreferences();renderGraph();
    }
    else if(target.id==='agent-focus'){setFocus(!focusedCanvas);renderGraph();}
    else if(target.id==='agent-pause'){paused=!paused;clearTimeout(timer);renderGraph();if(!paused)refresh();}
    else if(target.id==='agent-refresh'){if(!liveOrigin){location.reload();return;}paused=false;refresh();}
    else if(target.id==='agent-show-recent'){observerWindow='recent';$('agent-window').value=observerWindow;observerState='';$('agent-state').value='';needsFit=true;savePreferences();renderGraph();}
    else if(target.id==='agent-auto-parent'){saveHierarchy(true);}
  });
  document.addEventListener('submit',event=>{if(event.target.id==='agent-hierarchy-form'){event.preventDefault();saveHierarchy(false);}if(event.target.id==='agent-custom-form'){event.preventDefault();const n=graph.nodes.find(n=>n.id===selected);if(!n)return;const value={species:$('custom-species').value,shirt:$('custom-shirt').value,nickname:$('custom-nickname').value,desk:$('custom-desk').value},color=$('custom-project-color').value;document.activeElement.blur();const ok=personal.save(n.id,n.project_id,value,color);$('agent-custom-details').open=true;$('custom-message').textContent=ui(ok?'外观已保存':'浏览器无法保存，外观仅在本页生效。');}});
  $('attention-scope').addEventListener('change',()=>renderAttention(observedNodes()));
  window.addEventListener('codex:office-preferences',()=>renderGraph());
  $('agent-window').addEventListener('change',()=>{observerWindow=$('agent-window').value;needsFit=true;savePreferences();renderGraph();});
  $('agent-state').addEventListener('change',()=>{observerState=$('agent-state').value;needsFit=true;renderGraph();});
  $('agent-search').addEventListener('input',()=>{search=$('agent-search').value.trim();needsFit=true;renderGraph();});
  $('agent-collaboration').addEventListener('change',()=>{showCollaboration=$('agent-collaboration').checked;savePreferences();renderGraph();});
  const viewport=$('agent-viewport');let drag=null,spacePan=false,suppressClick=false;
  function setSpacePan(value){spacePan=value;viewport.dataset.spacePan=String(value);viewport.classList.toggle('space-pan',value);office?.setPanModifier?.(value);}
  window.addEventListener('keydown',event=>{
    if(event.code!=='Space'||event.ctrlKey||event.metaKey||event.altKey||scope.page!=='agents'||event.target.closest?.('input,textarea,select,[contenteditable]'))return;
    const hovering=viewport.matches(':hover')&&!viewport.querySelector('.agent-controls:hover,.agent-canvas-footer:hover,#agent-roster-panel:hover,#agent-display-controls:hover');
    if(event.target.closest?.('button,a,summary')&&!hovering)return;
    if(!hovering&&event.target!==viewport)return;
    event.preventDefault();setSpacePan(true);
  });
  window.addEventListener('keyup',event=>{if(event.code==='Space'&&spacePan){event.preventDefault();setSpacePan(false);}});
  window.addEventListener('blur',()=>{setSpacePan(false);endDrag();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){setSpacePan(false);endDrag();}});
  viewport.addEventListener('click',e=>{if(spacePan||suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},true);

  viewport.addEventListener('pointerdown',event=>{
    if(sceneMode!=='graph')return;
    if(event.button!==0||event.target.closest('select,input,textarea,summary,.agent-controls,.agent-canvas-footer')||!spacePan&&event.target.closest('button,a,label,.agent-node'))return;
    if(spacePan){event.preventDefault();event.stopPropagation();suppressClick=true;}
    drag={x:event.clientX,y:event.clientY,originX:transform.x,originY:transform.y,id:event.pointerId};viewport.setPointerCapture(event.pointerId);viewport.classList.add('dragging');
  },true);
  viewport.addEventListener('pointermove',event=>{if(!drag)return;transform.x=drag.originX+event.clientX-drag.x;transform.y=drag.originY+event.clientY-drag.y;applyTransform();});
  const endDrag=()=>{if(drag&&viewport.hasPointerCapture(drag.id))viewport.releasePointerCapture(drag.id);drag=null;viewport.classList.remove('dragging');};viewport.addEventListener('pointerup',endDrag);viewport.addEventListener('pointercancel',endDrag);viewport.addEventListener('lostpointercapture',endDrag);
  viewport.addEventListener('wheel',event=>{if(sceneMode!=='graph')return;event.preventDefault();const rect=viewport.getBoundingClientRect();if(event.ctrlKey||event.metaKey)zoom(Math.exp(-event.deltaY*.005),event.clientX-rect.left,event.clientY-rect.top);else{transform.x-=event.deltaX;transform.y-=event.deltaY;applyTransform();}},{passive:false});
  viewport.addEventListener('keydown',event=>{
    if(event.target!==viewport)return;
    const directions={ArrowLeft:[50,0],ArrowRight:[-50,0],ArrowUp:[0,50],ArrowDown:[0,-50]};
    if(directions[event.key]){event.preventDefault();if(sceneMode!=='graph'){office?.available&&office.pan(-directions[event.key][0],-directions[event.key][1]);}else{transform.x+=directions[event.key][0];transform.y+=directions[event.key][1];applyTransform();}}
    if(event.key==='+'||event.key==='='){event.preventDefault();zoom(1.2);}if(event.key==='-'){event.preventDefault();zoom(1/1.2);}if(event.key==='0'){event.preventDefault();fit();}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&focusedCanvas){setFocus(false);renderGraph();$('agent-focus').focus();}});
  window.addEventListener('codex:workspace-view',event=>{
    const previous=scope;
    scope=event.detail;if(scope.page!=='agents')setSpacePan(false);updateCosts();
    if(previous.project!==scope.project||previous.model!==scope.model||previous.page!==scope.page)needsFit=true;
    if(scope.page==='agents'){renderGraph();refresh();}else{clearTimeout(timer);office?.setVisible(false);if(focusedCanvas)setFocus(false);}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else refresh();});
  window.addEventListener('resize',()=>{if(scope.page==='agents'){needsFit=true;renderGraph();}});
  updateCosts();renderGraph();refresh();
})();
