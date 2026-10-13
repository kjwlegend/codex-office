/* Visual preferences and attention acknowledgements stay in this browser. */
(() => {
  'use strict';
  const key='codex-office-personal-v1';let revision=0,data={employees:{},projects:{},attention:{}};
  try{const saved=JSON.parse(localStorage.getItem(key)||'{}');for(const k of Object.keys(data))if(saved[k]&&typeof saved[k]==='object'&&!Array.isArray(saved[k]))data[k]=saved[k];}catch(_){}
  const palette=['#426982','#406d5c','#8f4850','#615f86','#916b38','#3f6972'];
  const projectPalette=['#5eaa8b','#719fc4','#c28f71','#a595bd','#a7aa6d','#73b5bd'];
  function get(id){const p=data.employees[id]||{};return {species:['human','cow','horse'].includes(p.species)?p.species:'auto',shirt:palette.includes(p.shirt)?p.shirt:'auto',nickname:typeof p.nickname==='string'?p.nickname.slice(0,32):'',desk:['plant','notebook','coffee'].includes(p.desk)?p.desk:'default'};}
  function persist(){try{localStorage.setItem(key,JSON.stringify(data));return true;}catch(_){return false;}}
  window.CodexOfficePreferences={palette,projectPalette,get,get revision(){return revision;},
    name:n=>get(n.id).nickname||n.agent_name||n.title,
    project:id=>projectPalette.includes(data.projects[id])?data.projects[id]:'auto',
    save(id,project,value,color){data.employees[id]={species:value.species,shirt:value.shirt,nickname:String(value.nickname).trim().slice(0,32),desk:value.desk};if(projectPalette.includes(color))data.projects[project]=color;else delete data.projects[project];const saved=persist();revision++;window.dispatchEvent(new CustomEvent('codex:office-preferences'));return saved;},
    reset(id,project){delete data.employees[id];delete data.projects[project];const saved=persist();revision++;window.dispatchEvent(new CustomEvent('codex:office-preferences'));return saved;},
    attentionKey:n=>n.status+':'+(n.last_activity_at||0),
    attention:n=>{const p=data.attention[n.id];return p&&p.event===n.status+':'+(n.last_activity_at||0)?p:null;},
    mark(n,action){if(action==='clear')delete data.attention[n.id];else data.attention[n.id]={event:n.status+':'+(n.last_activity_at||0),viewed:action==='viewed',until:action==='later'?Date.now()+15*60000:0};const entries=Object.entries(data.attention);if(entries.length>1000)data.attention=Object.fromEntries(entries.slice(-1000));return persist();}
  };
})();
