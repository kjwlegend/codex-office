/* Usage snapshots update independently from the five-second Agent observation. */
(() => {
  'use strict';
  const {ui}=window.CodexI18n,report=window.CodexWorkspace.report;
  const button=document.getElementById('refresh-usage'),note=document.getElementById('usage-freshness');
  const live=['http:','https:'].includes(location.protocol)&&['127.0.0.1','localhost'].includes(location.hostname);
  let token='',available=false,pending=false,error='',revision=0,timer;
  function render(){
    const time=new Date(report.generated_at),age=Math.max(0,Date.now()-time.getTime()),old=age>86400000||report.generated_at.slice(0,10)<window.CodexWorkspace.calendarDay();
    note.classList.toggle('stale',old);note.hidden=!old&&!pending&&!error;
    note.textContent=error|| (pending?ui('正在增量扫描并更新用量，原报表仍可查看。'):ui('用量快照早于今天，请更新后查看今天或昨天。'));
    button.hidden=!live;button.disabled=pending||!available;button.textContent=ui(pending?'正在更新用量…':'更新用量');
    button.title=ui(available?'扫描新增本地记录并更新报表':live?'请重新启动工作台以启用用量更新':'离线快照需通过本地工作台更新');
  }
  async function check(){
    try{
      const res=await fetch('/api/usage-refresh',{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!res.ok)throw Error();const job=await res.json();
      available=job.available===true;token=job.edit_token||'';
      if(pending&&job.revision===revision&&job.status==='succeeded'){location.reload();return;}
      if(pending&&job.revision===revision&&job.status==='failed'){pending=false;error=ui('用量更新失败，已保留原报表。')+(job.error?' '+job.error:'');}
      if(job.status==='running'){pending=true;revision=job.revision;}
    }catch(_){if(pending){error=ui('暂时无法确认更新状态，请重试连接。');}}
    render();if(pending)timer=setTimeout(check,1500);
  }
  button.addEventListener('click',async()=>{
    if(pending)return;error='';pending=true;render();
    try{
      const res=await fetch('/api/usage-refresh',{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Token':token},body:'{}',signal:AbortSignal.timeout(15000)});
      const job=await res.json();if(!res.ok)throw Error(job.error||ui('用量更新失败，已保留原报表。'));
      revision=job.revision;clearTimeout(timer);check();
    }catch(e){pending=false;error=e.message;render();}
  });
  window.addEventListener('codex:locale-change',render);
  window.addEventListener('focus',()=>{render();if(live&&!pending)check();});
  window.addEventListener('pagehide',()=>clearTimeout(timer));
  render();if(live)check();
})();
