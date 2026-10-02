/* Small, local vector scenes. Avatars are decorative identities, not real people. */
(() => {
  'use strict';
  const palette=[['#478d81','#f0c9a7','#493c35'],['#6b86aa','#d4a07a','#343c49'],['#997aaf','#f4d6b9','#72614b'],['#be9671','#b77f61','#302f34'],['#748e64','#dfb89a','#8b654b'],['#aa7481','#e8b696','#3b3a43']];
  const stateStyle={working:['#328775','···'],waiting_agents:['#b48840','…'],waiting_user:['#b48840','?'],idle:['#84998c','✓'],interrupted:['#8490a2','Ⅱ'],archived:['#98a09f','−'],failed:['#be685e','!'],unknown:['#a38a57','?']};
  function identity(id){let value=2166136261;for(const c of String(id))value=Math.imul(value^c.charCodeAt(0),16777619);return value>>>0;}
  function metrics(mode,kind){return mode==='graph'?{width:kind==='subagent'?220:248,height:kind==='subagent'?136:160}:{width:kind==='subagent'?220:248,height:kind==='subagent'?184:204};}
  function station(node,mode){
    const hash=identity(node.id),[shirt,skin,hair]=palette[hash%palette.length],prison=mode==='prison',uniform=prison?'#db8651':shirt;
    const [status,mark]=stateStyle[node.status]||stateStyle.unknown;
    const working=node.status==='working',waiting=['waiting_agents','waiting_user'].includes(node.status);
    const hairPath=hash%3===0?'M99 37q-2-28 25-25 23-2 24 26l-11-11-5 8-10-10-14 15Z':hash%3===1?'M98 39q-1-29 26-28 27 0 25 29l-11-17q-23 12-31 2l-7 15Z':'M99 37q-1-29 25-25 24-4 25 25l-10-11-3 7-7-8-18 3-10 15Z';
    const bars=prison?`<g class="scene-cell-bars" fill="none" stroke="#748598" stroke-width="2.4"><path d="M23 22H225V139H23ZM23 41H225M43 22V139M68 22V139M180 22V139M205 22V139"/><path d="M174 22V139M146 22V139" stroke-width="1.3" opacity=".5"/><rect x="182" y="62" width="7" height="10" rx="2" fill="#98a9b5" stroke="none"/></g>`:'';
    return `<svg class="scene-station" viewBox="0 0 248 154" aria-hidden="true" focusable="false">
      ${prison?'<path d="M21 23L124 8 227 23V132L124 153 21 132Z" fill="#dae1e7" stroke="#a9b5c0"/><path d="M21 23L124 8 227 23 124 42Z" fill="#cbd4de"/><path d="M21 132L124 153 227 132 124 111Z" fill="#bfcbd5"/>':'<ellipse class="scene-seat-shadow" cx="126" cy="127" rx="99" ry="18" fill="#6d7252" opacity=".1"/><path d="M116 85v50m-16 1 16-6 18 6" fill="none" stroke="#889490" stroke-width="4" stroke-linecap="round"/>'}
      <rect x="93" y="55" width="64" height="54" rx="18" fill="${prison?'#82939f':'#6c827e'}"/><rect x="99" y="60" width="51" height="40" rx="14" fill="${prison?'#94a5af':'#90a69e'}"/>
      <g class="employee-person">
        <path d="M113 57h22v16h-22Z" fill="${skin}"/><path d="M100 64q24-11 49 0l7 37H93Z" fill="${uniform}"/>
        ${node.kind==='session'&&!prison?'<path d="m115 61 9 10 10-10-6 31h-8Z" fill="#e8efe9"/><path d="m124 72-4 7 4 14 4-14Z" fill="#3d6c61"/>':''}
        ${prison?'<path d="M99 75h52M97 90h56" stroke="#f1b887" stroke-width="4"/><rect x="129" y="72" width="12" height="9" rx="2" fill="#f6d5b5"/>':''}
        <ellipse cx="123" cy="37" rx="23" ry="25" fill="${skin}"/><ellipse cx="99" cy="40" rx="4" ry="6" fill="${skin}"/><ellipse cx="147" cy="40" rx="4" ry="6" fill="${skin}"/><path d="${hairPath}" fill="${hair}"/>
        <path d="M109 36h5m17 0h5" stroke="${hair}" stroke-width="2" stroke-linecap="round"/><circle cx="113" cy="41" r="1.7" fill="#453a35"/><circle cx="133" cy="41" r="1.7" fill="#453a35"/>
        <path d="${node.status==='failed'?'M116 54q7-5 14 0':waiting?'M120 52h7':'M117 51q6 5 12 0'}" fill="none" stroke="#a16d58" stroke-width="1.5" stroke-linecap="round"/>
        ${hash%2===0?'<g fill="none" stroke="#4d5962" stroke-width="1.5"><rect x="106" y="37" width="14" height="10" rx="3"/><rect x="127" y="37" width="14" height="10" rx="3"/><path d="M120 40h7"/></g>':''}
        <g class="employee-arm employee-arm-left"><path d="m100 69-13 19 23 12" fill="none" stroke="${uniform}" stroke-width="12" stroke-linecap="round"/><ellipse cx="111" cy="98" rx="7" ry="4" fill="${skin}"/></g>
        <g class="employee-arm employee-arm-right"><path d="m147 69 13 18-23 12" fill="none" stroke="${uniform}" stroke-width="12" stroke-linecap="round"/><ellipse cx="136" cy="98" rx="7" ry="4" fill="${skin}"/></g>
      </g>
      <g class="scene-desk">
        <path d="M44 103V130m159-26v27" stroke="${prison?'#738794':'#ab9474'}" stroke-width="6" stroke-linecap="round"/>
        <path d="M30 92 173 80 216 100 72 115Z" fill="${prison?'#91a4ad':'#d5b68e'}" stroke="${prison?'#758b98':'#b39978'}"/>
        <path d="M30 92v7l42 23v-7Z" fill="${prison?'#83979f':'#bea077'}"/><path d="M72 115 216 100v7L72 122Z" fill="${prison?'#728791':'#ac8e68'}"/>
        <path d="m85 95 49-6 16 8-51 6Z" fill="#e6ece7" stroke="#b3c4bc"/><path d="m94 95 33-3m-28 6 39-4" stroke="#a8bdb2" stroke-width="1.5"/>
        <path d="M157 90 158 96 184 94 180 89Z" fill="#637c77"/><path d="M162 86v8" stroke="#647f7b" stroke-width="4"/>
        <path d="M144 52 191 57 190 88 143 83Z" fill="#456460" stroke="#39564f" stroke-width="2"/><path d="M147 55 187 59 187 84 147 80Z" fill="${working?'#c3e5d5':'#d6e3de'}"/>
        <g class="employee-monitor-lines" stroke="${working?'#5c9a7d':'#9cafaa'}" stroke-width="2" stroke-linecap="round"><path d="m152 63 15 1m-15 5 26 3m-25 3 19 2"/></g>
        ${prison?'<path d="M47 87 57 86 59 94 49 96Z" fill="#d9e3e8"/>':'<path d="M46 87 58 86 59 98 47 99Z" fill="#f0e9d7"/><path d="M58 88q9-1 6 7h-5" fill="none" stroke="#dacbae" stroke-width="2"/><path d="M44 90q-11-22 0-30 12 15 0 30Zm0-9q-21-10-19-18 15-1 19 18Z" fill="#6c997c"/>'}
      </g>
      ${bars}
      <g class="employee-thought"><path d="M166 18h34q7 0 7 7v10q0 7-7 7h-17l-9 7 2-7h-10q-7 0-7-7V25q0-7 7-7Z" fill="${prison?'#f1f5f6':'#fffdf7'}" stroke="${prison?'#a7b6c1':'#c5d2c6'}"/><text x="183" y="34" text-anchor="middle" fill="${status}" font-family="sans-serif" font-size="14" font-weight="600">${mark}</text></g>
    </svg>`;
  }
  function roomDecor(mode){return mode==='prison'?`<svg viewBox="0 0 242 46" aria-hidden="true"><path d="M5 20h232" stroke="#a4b0b8" stroke-width="2" stroke-dasharray="4 6"/><rect x="88" y="5" width="67" height="31" rx="4" fill="#c7d1d8" stroke="#99aab6"/><path d="M100 9v23m15-23v23m16-23v23m13-23v23" stroke="#8e9fa9" stroke-width="2"/><circle cx="37" cy="21" r="12" fill="#d6dfe4" stroke="#abb9c4"/><path d="M30 18h14m-14 6h14" stroke="#9dabb5"/></svg>`:`<svg viewBox="0 0 242 46" aria-hidden="true"><ellipse cx="27" cy="37" rx="20" ry="4" fill="#8e936f" opacity=".12"/><path d="m15 22 24 1-4 19H20Z" fill="#bc9477"/><path d="M27 27q-21-16-17-27 16 0 18 21Q29 4 40 3q6 17-13 24Z" fill="#659173"/><rect x="75" y="13" width="90" height="22" rx="9" fill="#97b3a3"/><rect x="70" y="20" width="12" height="21" rx="5" fill="#80a493"/><rect x="158" y="20" width="12" height="21" rx="5" fill="#80a493"/><path d="M118 17v16m-32 8h4m61 0h4" stroke="#648b7d" stroke-width="2"/><ellipse cx="205" cy="28" rx="21" ry="9" fill="#d4b994"/><path d="M205 33v10" stroke="#b29671" stroke-width="3"/><path d="m201 17 10 1-1 8-8-1Z" fill="#fffdf2"/></svg>`;}
  window.CodexAgentScenes={metrics,station,roomDecor};
})();
