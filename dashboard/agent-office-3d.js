/* Real geometry, not a sprite skin. One employee per observed Agent.
   Shared meshes/materials; render-on-demand when there is no observed activity. */
(() => {
  'use strict';
  const i18n=window.CodexI18n, ui=i18n.ui;
  const T=window.CodexThree;if(!T)return;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hash=v=>{let h=2166136261;for(const c of String(v)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
  const statusColors={working:0x328b6e,waiting_agents:0xb38a3d,waiting_user:0xb38a3d,idle:0x728991,unknown:0x9c937c,failed:0xc46756,interrupted:0x8b8498,archived:0x929b9d};
  const shirts=[0x657f9f,0x688978,0xa67764,0x8584a0,0xb1956d,0x637d86],skins=[0xe5b18b,0xc88d65,0xf0c6a7,0xa97050,0xdbad90],hairs=[0x312723,0x574137,0x23282b,0x837269,0x352c2b];
  const teamPalette=[0x5eaa8b,0x719fc4,0xc28f71,0xa595bd,0xa7aa6d,0x73b5bd];
  const teamColor=id=>teamPalette[hash(id)%teamPalette.length];
  const hex=color=>'#'+color.toString(16).padStart(6,'0');
  const brief=(value,length=40)=>{const chars=Array.from(String(value??'').replace(/\s+/g,' ').trim());return chars.length>length?chars.slice(0,length).join('')+'…':chars.join('');};
  const parent=n=>n.kind==='subagent'?n.parent_agent_id:n.business_parent_id;
  function create(viewport,onSelect){
    const host=$('agent-3d'),labels=$('agent-3d-labels'),tooltip=$('agent-3d-tooltip');let renderer;
    try{renderer=new T.WebGLRenderer({antialias:true,powerPreference:'low-power'});}
    catch(_){host.dataset.ready='unavailable';$('agent-3d-error').hidden=false;return {available:false,setVisible(){},dispose(){},debug:()=>({available:false})};}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=T.SRGBColorSpace;
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;renderer.shadowMap.autoUpdate=false;
    renderer.domElement.className='agent-three-canvas';renderer.domElement.setAttribute('aria-label',ui('可旋转的三维 Agent 办公空间'));host.prepend(renderer.domElement);
    const scene=new T.Scene();scene.background=new T.Color(0xe9eeed);
    const camera=new T.PerspectiveCamera(37,1,.1,3000),controls=new T.OrbitControls(camera,renderer.domElement);
    controls.enableDamping=false;controls.maxPolarAngle=Math.PI*.46;controls.minPolarAngle=.15;
    controls.minDistance=4;controls.maxDistance=3000;controls.screenSpacePanning=false;
    controls.mouseButtons={LEFT:T.MOUSE.ROTATE,MIDDLE:T.MOUSE.DOLLY,RIGHT:T.MOUSE.PAN};
    controls.touches={ONE:T.TOUCH.ROTATE,TWO:T.TOUCH.DOLLY_PAN};
    const ambient=new T.HemisphereLight(0xf5f8ff,0xc4c8b4,2.4);scene.add(ambient);
    const sun=new T.DirectionalLight(0xfff3dc,3.3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0006;sun.shadow.normalBias=.025;scene.add(sun,sun.target);
    const fill=new T.DirectionalLight(0xdbebff,1.3);fill.position.set(12,10,-8);scene.add(fill);
    const architecture=new T.Group(),people=new T.Group(),links=new T.Group();scene.add(architecture,people,links);
    const mats=new Map(),geos=new Map(),actors=new Map(),raycaster=new T.Raycaster(),pointer=new T.Vector2(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let rooms=[],walls=[],edgeObjects=[],projectLabels=[],mode='office',topology='',selected='',hovered='',visible=false,lost=false,motion=false,observation='offline',raf=0,dirty=true,lastFrame=0,fitDistance=1,pointerStart=null;
    let localLightCount=0,localeStamp=i18n.locale;
    const bounds=new T.Box3(),detachedLabels=document.createDocumentFragment(),v=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
    function mat(color,roughness=.65,metalness=0){const k=color+':'+roughness+':'+metalness;if(!mats.has(k))mats.set(k,new T.MeshStandardMaterial({color,roughness,metalness}));return mats.get(k);}
    function geo(type){if(!geos.has(type))geos.set(type,type==='sphere'?new T.SphereGeometry(1,16,12):type==='cylinder'?new T.CylinderGeometry(1,1,1,12):type==='cone'?new T.ConeGeometry(1,1,10):type==='ring'?new T.TorusGeometry(1,.035,6,48):new T.BoxGeometry(1,1,1));return geos.get(type);}
    function mesh(p,type,size,pos,m,name='',shadow=false){const o=new T.Mesh(geo(type),typeof m==='number'?mat(m):m);o.scale.set(...size);o.position.set(...pos);o.name=name;o.castShadow=shadow;o.receiveShadow=true;p.add(o);return o;}
    const box=(p,w,h,d,x,y,z,m,name='',shadow=false)=>mesh(p,'box',[w,h,d],[x,y,z],m,name,shadow);
    const ball=(p,w,h,d,x,y,z,m,name='')=>mesh(p,'sphere',[w,h,d],[x,y,z],m,name);
    const cylinder=(p,r,h,x,y,z,m,name='',shadow=false)=>mesh(p,'cylinder',[r,h,r],[x,y,z],m,name,shadow);
    function segment(p,a,b,r,m,name){const start=v(...a),end=v(...b),mid=start.clone().add(end).multiplyScalar(.5);const o=cylinder(p,r,start.distanceTo(end),mid.x,mid.y,mid.z,m,name);o.quaternion.setFromUnitVectors(v(0,1,0),end.sub(start).normalize());return o;}
    function texture(text,bg='#e9eee7',ink='#35534c'){
      const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');
      ctx.fillStyle=bg;ctx.fillRect(0,0,512,128);ctx.fillStyle=ink;ctx.font='600 38px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,64,480);
      const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
    }
    function sign(p,text,x,y,z,width=3,bg='#e9eee7',ink='#35534c'){
      const label=()=>typeof text==='function'?text():text;
      const o=box(p,width,.7,.025,x,y,z,new T.MeshBasicMaterial({map:texture(label(),bg,ink)}),'sign');o.userData.ownedMaterial=true;
      if(typeof text==='function')o.userData.localize=()=>{o.material.map.dispose();o.material.map=texture(label(),bg,ink);o.material.needsUpdate=true;};
      return o;
    }
    function glow(color){const key='glow:'+color;if(!mats.has(key))mats.set(key,new T.MeshBasicMaterial({color}));return mats.get(key);}
    function localLight(p,x,y,z,color,intensity,range){if(localLightCount>=6)return;const light=new T.PointLight(color,intensity,range,2);light.position.set(x,y,z);light.name='local-illumination';p.add(light);localLightCount++;}
    function setMood(){
      const dark=mode==='prison';scene.background.set(dark?0x121b24:0xe8eee6);
      ambient.color.set(dark?0xaec5dc:0xfff5df);ambient.groundColor.set(dark?0x242933:0xc2c6a6);ambient.intensity=dark?.7:2.25;
      sun.color.set(dark?0xadbdce:0xffedce);sun.intensity=dark?.95:3.1;
      fill.color.set(dark?0x87abca:0xdde9f0);fill.intensity=dark?.62:1.05;
      renderer.toneMappingExposure=dark?1.0:1.12;
    }
    function plant(p,x,z,scale=1){
      const g=new T.Group();g.position.set(x,0,z);g.scale.setScalar(scale);p.add(g);
      cylinder(g,.23,.44,0,.22,0,0xb7a28c,'ceramic-pot',true);cylinder(g,.205,.018,0,.45,0,0x514b38);
      for(let i=0;i<7;i++){const a=i*2.4,y=.8+(i%3)*.16;segment(g,[0,.45,0],[Math.cos(a)*.24,y,Math.sin(a)*.24],.017,0x566b3e,'stem');const leaf=ball(g,.15,.32,.07,Math.cos(a)*.26,y,Math.sin(a)*.26,[0x718e54,0x869c62,0x567248][i%3],'leaf');leaf.rotation.z=Math.cos(a)*.65;leaf.rotation.y=a;}
    }
    function lounge(p,x,z){
      const g=new T.Group();g.name='lounge';g.position.set(x,0,z);p.add(g);box(g,2.8,.3,.95,0,.45,0,0x82948b,'sofa-seat',true);box(g,2.8,.86,.18,0,.79,-.48,0x82948b,'sofa-back',true);
      for(const s of [-1,1]){box(g,.2,.65,1,s*1.35,.67,0,0x82948b,'sofa-arm');for(const zz of [-.35,.35])cylinder(g,.035,.27,s*1.2,.14,zz,0x4f5148);}
      for(const s of [-1,0,1])box(g,.8,.1,.83,s*.87,.65,.04,0xa2b0a4,'cushion');
      box(p,2,.06,1,x,.48,z+1.65,0xc1a77f,'coffee-table',true);for(const s of [-1,1])box(p,.1,.45,.6,x+s*.7,.23,z+1.65,0x655f50);
      box(p,.5,.04,.38,x-.25,.53,z+1.62,0xe8e0c8);cylinder(p,.09,.12,x+.45,.56,z+1.55,0xe9e5dc);
      for(const [xx,color] of [[-.85,0xc28d70],[.85,0xdfc780]]){const cushion=ball(g,.25,.23,.09,xx,.91,-.29,color,'throw-pillow');cushion.rotation.z=xx*.18;}
      box(g,.38,.03,.84,.3,.72,.1,0xd8caa6,'throw-blanket');
      const rug=cylinder(p,1.42,.018,x,.073,z+.83,0xc3b9a1,'lounge-rug');rug.scale.z=1.9;
    }
    function beanbag(p,x,z,color){
      const g=new T.Group();g.name='beanbag';g.position.set(x,0,z);p.add(g);
      ball(g,.62,.32,.64,0,.38,.08,color,'beanbag-seat');ball(g,.53,.5,.35,0,.66,-.23,color,'beanbag-back');
      cylinder(g,.54,.08,0,.09,.02,0x9a8974);ball(g,.24,.055,.19,0,.61,.22,0xdfd5bc,'seat-cushion');
    }
    function bookshelf(p,x,z){
      const g=new T.Group();g.name='bookshelf';g.position.set(x,0,z);p.add(g);
      box(g,.5,1.75,2.25,0,.92,0,0xb39a78,'bookshelf-frame',true);
      for(const y of [.18,.68,1.18,1.72])box(g,.57,.065,2.32,.045,y,0,0xcbb28c,'shelf');
      for(let i=0;i<16;i++){const level=Math.floor(i/8),zz=-.9+(i%8)*.22;box(g,.37,.27+(i%3)*.045,.12,.1,.9+level*.53,zz,[0x8d9c7d,0xc28671,0x7398a3,0xd9c79e][i%4],'book');}
      plant(g,.05,-.55,.7);
    }
    function coffeeBar(p,x,z){
      const g=new T.Group();g.name='coffee-bar';g.position.set(x,0,z);p.add(g);
      box(g,3.2,.9,.72,0,.49,0,0xbba485,'coffee-cabinet',true);box(g,3.35,.07,.84,0,.98,0,0xe1d7c1,'coffee-counter');
      for(const xx of [-1.04,0,1.04]){box(g,.95,.73,.03,xx,.5,.38,0xc9b695);box(g,.22,.02,.03,xx,.67,.404,0x777b65);}
      box(g,.66,.74,.48,-.63,1.39,0,0x4d5c59,'coffee-machine',true);box(g,.53,.27,.032,-.63,1.47,.256,0x344944);
      box(g,.39,.025,.35,-.63,1.13,.19,0x939d93,'coffee-tray');cylinder(g,.055,.12,-.65,1.21,.2,0xe5d9c2,'espresso-cup');
      for(const xx of [.32,.56,.8])cylinder(g,.075,.14,xx,1.1,.05,0xefeadb,'stacked-cup');
      ball(g,.25,.12,.18,1.14,1.09,.09,0xdfbb70,'fruit-bowl');for(const xx of [1.02,1.2,1.32])ball(g,.065,.065,.065,xx,1.21,.06,0xc39449,'fruit');
      sign(g,'COFFEE / TAKE A BREAK',0,1.91,-.23,2.65,'#647d63','#f4eddc');
    }
    function meetingNook(p,x,z){
      const g=new T.Group();g.name='meeting-nook';g.position.set(x,0,z);p.add(g);
      cylinder(g,.9,.08,0,.83,0,0xcbb18b,'meeting-table',true);cylinder(g,.1,.73,0,.45,0,0x748478);
      for(let i=0;i<3;i++){const a=i*Math.PI*2/3+.35,xx=Math.cos(a)*1.34,zz=Math.sin(a)*1.34;
        const seat=new T.Group();seat.position.set(xx,0,zz);seat.rotation.y=-a+Math.PI/2;g.add(seat);
        cylinder(seat,.27,.09,0,.48,0,[0x8caaa0,0xc3957d,0xb8b08b][i],'meeting-chair');box(seat,.56,.44,.08,0,.73,-.22,[0x8caaa0,0xc3957d,0xb8b08b][i]);for(const s of [-1,1])for(const t of [-1,1])segment(seat,[s*.16,.43,t*.16],[s*.2,.07,t*.2],.025,0x6b7769,'chair-leg');
      }box(g,.4,.015,.3,.18,.88,0,0xe3ddc9,'meeting-notebook');
      cylinder(g,.07,.11,-.25,.92,.1,0xeae4d3,'meeting-cup');
    }
    function gamesTable(p,x,z){
      const g=new T.Group();g.name='games-table';g.position.set(x,0,z);p.add(g);
      box(g,2.6,.09,1.55,0,.85,0,0x547e72,'ping-pong-table',true);
      box(g,.025,.008,1.53,0,.902,0,0xdfe4d6);for(const zz of [-.74,.74])box(g,2.56,.008,.023,0,.902,zz,0xdfe4d6);
      for(const xx of [-1.24,1.24])box(g,.023,.008,1.52,xx,.902,0,0xdfe4d6);
      box(g,.025,.14,1.55,0,.98,0,0xb0b6a0,'table-net');
      for(const xx of [-.83,.83])box(g,.08,.76,1.03,xx,.43,0,0x717e70);
      cylinder(g,.13,.025,.71,.94,.23,0xb8755e,'paddle');
      box(g,.055,.025,.2,.71,.92,.4,0xc8ad7f,'paddle-handle');ball(g,.037,.037,.037,.45,.94,-.24,0xf3e2b6,'table-ball');
    }
    function floorLamp(p,x,z){
      cylinder(p,.22,.055,x,.11,z,0x656d56,'floor-lamp-base');cylinder(p,.025,2.3,x,1.28,z,0x6f725f,'floor-lamp');
      mesh(p,'cone',[.3,.42,.3],[x,2.4,z],0xd4c89f,'warm-lampshade');
      cylinder(p,.23,.015,x,2.2,z,glow(0xe6cd83),'lamp-diffuser');
    }
    function roomGeometry(r){
      const g=new T.Group();g.position.set(r.x,0,r.z);architecture.add(g);const prison=mode==='prison';
      g.name=prison?'cell-block':'casual-office';
      box(g,r.width,.28,r.depth,0,-.15,0,prison?0x2c343d:0xb8ac92,'foundation',true);box(g,r.width-.12,.06,r.depth-.12,0,.025,0,prison?0x46515c:0xd4c3a4,'floor');
      for(let z=-r.depth/2+.5;z<r.depth/2;z+=prison?1.1:.56)box(g,r.width-.18,.004,.012,0,.058,z,prison?0x323c47:0xbeab89);
      for(let x=-r.width/2+1;x<r.width/2;x+=prison?1.1:1.6)box(g,.009,.004,r.depth-.18,x,.058,0,prison?0x323c47:0xc2b290);
      for(const side of ['back','left']){
        const m=mat(prison?0x3c4855:0xe4e7df).clone();m.transparent=true;walls.push({m,r,side});
        if(side==='back')box(g,r.width,2.8,.15,0,1.4,-r.depth/2,m,'back-wall',true);else box(g,.15,2.8,r.depth,-r.width/2,1.4,0,m,'side-wall',true);
      }
      box(g,r.width,.15,.19,0,.12,r.depth/2,prison?0x263442:0x948c7b,'cutaway-wall');box(g,.19,.15,r.depth,r.width/2,.12,0,prison?0x263442:0x948c7b,'cutaway-wall');
      const glass=new T.MeshStandardMaterial({color:prison?0x799aa5:0xaecbd0,transparent:true,opacity:.38,roughness:.08,metalness:.1,side:T.DoubleSide});
      let owned=false;
      if(!prison)for(let z=-r.depth/2+1.8;z<r.depth/2-1;z+=2.8){
        box(g,.08,1.65,2.32,-r.width/2+.09,1.66,z,0xf0eee5,'window-frame');
        const pane=box(g,.095,1.48,2.16,-r.width/2+.13,1.66,z,glass,'window-glass');pane.userData.ownedMaterial=!owned;owned=true;
        box(g,.13,1.65,.055,-r.width/2+.18,1.66,z,0xadbeb9,'window-mullion');box(g,.15,.055,2.28,-r.width/2+.18,1.66,z,0xadbeb9);
        box(g,.38,.07,2.48,-r.width/2+.24,.81,z,0xece8dc,'sill',true);box(g,.7,1.4+(Math.abs(z)%2),1.1,-r.width/2-1.1,.7,z,0xc6d4d2,'exterior-building');
      }
      if(!owned)glass.dispose();
      if(prison){
        for(let z=-r.depth/2+2;z<r.depth/2-1;z+=4.2){
          box(g,.16,.47,1.15,-r.width/2+.09,2.13,z,0x1b2a37,'high-window');
          for(const dz of [-.36,0,.36])box(g,.2,.5,.035,-r.width/2+.18,2.13,z+dz,0x61707b,'window-bar');
          box(g,.08,.02,1.02,-r.width/2+.21,1.95,z,glow(0x7599aa),'window-edge');
        }
        sign(g,'SINGLE CELLS / '+r.name,0,2.17,-r.depth/2+.18,4.8,'#1e2a37','#c8d7e0');
        box(g,1.2,2.17,.17,r.width/2-1.4,1.11,-r.depth/2+.2,0x263441,'security-door');
        box(g,.045,.45,.1,r.width/2-1.75,1.06,-r.depth/2+.3,0x899082,'door-handle');
        box(g,1,.08,.12,r.width/2-1.4,2.35,-r.depth/2+.2,glow(0xd89464),'exit-light');
        // A few unshadowed local lights keep shader/light cost bounded across projects.
        localLight(g,0,2.6,-r.depth/2+1.7,0xd8b58b,18,9);
        localLight(g,0,2.3,r.depth/2-1.4,0x91bad3,14,10);
        box(g,r.width-1,.015,.07,0,.085,r.depth/2-3.15,glow(0x627e90),'corridor-guide');
      }else{
        for(let x=-r.width/2+.3;x<-r.width/2+3.6;x+=.18)box(g,.065,2.65,.1,x,1.38,-r.depth/2+.11,0xb2a086,'wood-slat');
        sign(g,'WORK / '+r.name,0,2.1,-r.depth/2+.13,4.2);
        box(g,2.7,1.3,.06,r.width/2-2.2,1.65,-r.depth/2+.13,0xf6f7ee,'whiteboard');
        for(let i=0;i<5;i++)box(g,.34,.27,.013,r.width/2-3.1+i%3*.53,1.65-Math.floor(i/3)*.4,-r.depth/2+.173,[0xd8c985,0x91b4a4,0xb7c8d6][i%3],'sticky-note');
        coffeeBar(g,-.4,-r.depth/2+1.25);
        lounge(g,r.width/2-3,r.depth/2-2.8);
        gamesTable(g,-r.width/2+3.5,r.depth/2-3.5);
        meetingNook(g,-.6,r.depth/2-1.55);
        beanbag(g,r.width/2-1.1,r.depth/2-5,0xb68e72);
        beanbag(g,r.width/2-2.5,r.depth/2-4.5,0xb7b47d);
        floorLamp(g,r.width/2-1.25,r.depth/2-2.65);
        bookshelf(g,-r.width/2+.5,.8);
        plant(g,-r.width/2+1,-r.depth/2+4.8,1.6);
        plant(g,r.width/2-1,-r.depth/2+1.1,1.1);
        sign(g,'MAKE / CONNECT / UNWIND',-r.width/2+2.1,2.1,-r.depth/2+.18,2.7,'#a38968','#f9f2e5');
      }
      if(!prison){plant(g,-r.width/2+1.1,-r.depth/2+1.1,1.4);plant(g,r.width/2-.8,r.depth/2-1,1.1);}
      for(const t of r.teams){
        const color=teamColor(t.main.id),rugColor=new T.Color(color).lerp(new T.Color(prison?0x33404c:0xdce2cc),prison?.72:.65);
        box(g,t.width-.5,.016,t.depth-.3,t.x,.073,t.z,mat(rugColor.getHex()),'workgroup-rug');
        const outline=box(g,t.width-.7,.009,.055,t.x,.091,t.z-t.depth/2+.24,glow(color),'workgroup-border');
        sign(g,()=>(t.main.kind==='session'?ui('主 Agent'):'Subagent')+' · '+brief(t.main.title,16),t.x,.34,t.z-t.depth/2+.12,2.3,prison?'#304350':hex(color),'#ffffff');
      }
    }
    function singleCell(g,n,p){
      const cell=new T.Group();cell.name='single-cell';g.add(cell);const width=3.2,depth=3.7;
      box(cell,width,.055,depth,0,.078,-.25,0x53616d,'cell-floor');
      for(const side of ['left','right','back']){
        const m=mat(0x52606d).clone();m.transparent=true;walls.push({m,r:{x:p.x,z:p.z},side});
        if(side==='back')box(cell,width,2.38,.1,0,1.25,-2.05,m,'cell-back-wall',true);
        else box(cell,.1,2.38,depth,side==='left'?-width/2:width/2,1.25,-.25,m,'cell-side-wall',true);
      }
      box(cell,2.35,.27,.57,-.05,.3,-1.58,0x313a44,'cell-bed',true);
      box(cell,2.28,.1,.53,-.05,.49,-1.58,0x7c8789,'mattress');
      box(cell,.47,.09,.47,-.8,.58,-1.58,0xc0c3b2,'bed-pillow');
      box(cell,1.15,.025,.54,.48,.55,-1.58,0x665f52,'cell-blanket');
      for(const x of [-1.59,1.59])box(cell,.13,2.4,.13,x,1.25,1.61,0x263641,'cell-door-frame',true);
      box(cell,3.28,.15,.17,0,2.47,1.61,0x293945,'cell-lintel',true);
      box(cell,.63,2.2,.07,-1.16,1.19,1.62,0x2e424e,'cell-door');
      for(const xx of [-1.39,-1.19,-.99])box(cell,.027,.45,.09,xx,1.7,1.66,0x81909a,'cell-door-slit');
      box(cell,.12,.035,.13,-.84,1.15,1.69,0xb8b2a0,'cell-lock');
      box(cell,.51,.18,.09,0,2.17,-1.98,0x26313b,'cell-lamp');
      box(cell,.43,.035,.12,0,2.07,-1.93,glow(0xcbb98d),'cell-lamp-diffuser');
      for(let i=0;i<4;i++)box(cell,.31,.028,.025,1.08,1.9+i*.09,-1.985,0x263540,'cell-vent');
      sign(cell,()=>n.kind==='session'?ui('主 Agent'):'Subagent',.45,2.46,1.71,1.45,'#1a2935','#cbd6d9');
    }
    function employee(n,p,simple){
      const h=hash(n.id),prison=mode==='prison',shirt=prison?0xc88350:shirts[h%6],skin=skins[(h>>>4)%5],hair=hairs[(h>>>8)%5];
      const g=new T.Group();g.name='employee:'+n.id;g.position.set(p.x,0,p.z);g.userData.agentId=n.id;people.add(g);
      const body=new T.Group();body.name='articulated-person';g.add(body);
      const uniform=mat(shirt).clone();uniform.emissive.set(0x329a64);uniform.emissiveIntensity=0;
      box(g,n.kind==='session'?2.4:2.18,.1,1.08,0,.93,.58,prison?0x77838a:n.kind==='session'?0xc5a16f:0xd4b78c,'desktop',true);
      for(const x of [-.98,.98])for(const z of [.15,1.02])box(g,.07,.87,.07,x,.46,z,0x8c9994,'desk-leg',true);
      box(g,2,.07,.06,0,.78,.95,0x8c9994,'desk-crossbar');if(!prison)box(g,2.22,.38,.035,0,1.11,1.1,0xc7d0c8,'desk-divider');
      const chair=prison?0x687984:0x4e625e;cylinder(g,.04,.47,0,.33,-.46,0x757d78,'gas-lift');
      for(let i=0;i<5;i++){const a=i*Math.PI*2/5;segment(g,[0,.13,-.46],[Math.cos(a)*.4,.1,-.46+Math.sin(a)*.4],.027,0x6e7772,'chair-base');ball(g,.06,.055,.06,Math.cos(a)*.4,.08,-.46+Math.sin(a)*.4,0x363e3b,'wheel');}
      box(g,.65,.11,.64,0,.61,-.46,chair,'chair-seat',true);ball(g,.36,.37,.09,0,.98,-.76,chair,'chair-back');
      for(const x of [-.37,.37]){segment(g,[x,.64,-.55],[x,.86,-.25],.018,0x616e68,'chair-frame');box(g,.1,.04,.37,x,.86,-.38,chair,'armrest');}
      const trouser=prison?0xb67548:0x454f5b;ball(body,.27,.16,.24,0,.72,-.43,trouser,'hips');
      for(const s of [-1,1]){segment(body,[s*.14,.75,-.38],[s*.19,.67,.02],.09,trouser,'thigh');ball(body,.095,.105,.1,s*.19,.66,.02,trouser,'knee');segment(body,[s*.19,.64,.04],[s*.19,.19,.16],.065,trouser,'shin');ball(body,.09,.065,.17,s*.19,.12,.24,0x343a40,'shoe');}
      const shirtMesh=ball(body,.29,.34,.185,0,1.04,-.42,uniform,'shirt');shirtMesh.userData.ownedMaterial=true;
      box(body,.45,.07,.29,0,.8,-.42,uniform,'shirt-hem');cylinder(body,.09,.13,0,1.34,-.41,skin,'neck');
      for(const s of [-1,1]){const c=box(body,.09,.12,.02,s*.064,1.29,-.23,0xe3e8e5,'collar');c.rotation.z=s*.42;}
      if(!simple)for(const y of [.96,1.08,1.19])ball(body,.011,.011,.01,0,y,-.234,0xe2e4df,'shirt-button');
      const head=new T.Group();head.position.set(0,1.57,-.39);head.name='head';body.add(head);
      const face=ball(head,.17,.215,.168,0,0,0,skin,'face');face.castShadow=true;ball(head,.165,.095,.14,0,-.13,.016,skin,'jaw');
      for(const s of [-1,1]){
        ball(head,.035,.058,.045,s*.173,-.015,0,skin,'ear');
        if(!simple){ball(head,.036,.019,.011,s*.059,.02,.153,0xf3eee6,'eye-white');ball(head,.013,.014,.006,s*.06,.021,.164,0x303636,'eye');const b=box(head,.053,.012,.01,s*.059,.065,.151,hair,'brow');b.rotation.z=s*-.1;}
      }
      ball(head,.025,.039,.035,0,-.035,.172,skin,'nose');if(!simple)box(head,.043,.007,.012,0,-.096,.153,0x996456,'mouth');
      ball(head,.176,.104,.172,0,.145,-.022,hair,'hair');ball(head,.16,.16,.075,0,.051,-.115,hair,'hair-back');const fringe=ball(head,.125,.055,.055,-.044,.128,.12,hair,'fringe');fringe.rotation.z=.23;
      if((h>>>13)%3===0&&!simple){for(const s of [-1,1])mesh(head,'ring',[.04,.032,.04],[s*.059,.022,.174],0x4f4f4b,'glasses');box(head,.035,.009,.01,0,.029,.175,0x4f4f4b);}
      const arms=[],elbows=[],wrists=[];
      for(const s of [-1,1]){
        const arm=new T.Group();arm.position.set(s*.255,1.22,-.4);arm.name=s<0?'left-arm':'right-arm';body.add(arm);arms.push(arm);
        ball(arm,.1,.12,.1,0,0,0,uniform,'shoulder');segment(arm,[0,-.025,0],[s*.045,-.25,.12],.062,uniform,'upper-arm');
        const elbow=new T.Group();elbow.position.set(s*.045,-.25,.12);elbow.name='elbow-joint';arm.add(elbow);elbows.push(elbow);
        ball(elbow,.065,.06,.06,0,0,0,skin,'elbow');segment(elbow,[0,0,0],[-s*.135,.05,.48],.047,skin,'forearm');
        const wrist=new T.Group();wrist.position.set(-s*.135,.05,.51);wrist.name='wrist-joint';elbow.add(wrist);wrists.push(wrist);
        ball(wrist,.063,.03,.065,0,0,0,skin,'hand');
        if(!simple)for(let i=0;i<3;i++)box(wrist,.017,.017,.07,(i-1)*.024,-.005,.065,skin,'finger');
      }
      // Bend the upper body around a seated spine, rather than rotating a rigid whole person.
      const upper=new T.Group();upper.name='seated-spine';upper.position.set(0,.82,-.42);
      for(const part of [...body.children])if(['shirt','shirt-hem','neck','collar','shirt-button','head','left-arm','right-arm'].includes(part.name)){part.position.sub(upper.position);upper.add(part);}body.add(upper);
      cylinder(g,.035,.28,0,1.1,.85,0x717b78,'monitor-stand');box(g,.4,.027,.23,0,.965,.85,0x7a8380,'monitor-base');
      const monitor=new T.Group();monitor.position.set(0,1.32,.85);monitor.rotation.x=-.1;g.add(monitor);box(monitor,1.06,.62,.045,0,0,0,0x343f42,'monitor',true);
      const screenMat=new T.MeshStandardMaterial({map:texture('AGENT / WORKSPACE','#21363b','#80d3aa'),emissive:0x194d40,emissiveIntensity:.1,roughness:.5});
      const screen=box(monitor,.98,.53,.01,0,0,-.028,screenMat,'screen');screen.userData.ownedMaterial=true;box(monitor,.15,.06,.009,0,0,.027,0xa8b6b4,'back-logo');
      box(g,.7,.027,.24,0,.998,.19,0x6f7a77,'keyboard');const keys=[];if(!simple)for(let i=0;i<8;i++)keys.push(box(g,.055,.006,.13,-.28+i*.08,1.015,.19,0xb7c4bf,'key'));
      ball(g,.056,.022,.088,.51,1.004,.24,0x56635f,'mouse');
      if(!simple){cylinder(g,.09,.16,-.81,1.06,.53,0xe4e0d4,'mug');mesh(g,'ring',[.05,.05,.05],[-.7,1.075,.53],0xe4e0d4,'mug-handle').rotation.y=Math.PI/2;cylinder(g,.07,.009,-.81,1.145,.53,0x574f40);box(g,.33,.025,.29,.77,.996,.65,0xe5dfcd,'notebook');cylinder(g,.12,.025,-.91,.997,.97,0x697a72,'lamp-base');segment(g,[-.91,1.01,.97],[-.91,1.55,.97],.015,0x63756d,'lamp-stem');mesh(g,'cone',[.13,.12,.13],[-.88,1.55,.92],0xb9c2b6,'lampshade').rotation.x=-.5;}
      if(prison)singleCell(g,n,p);
      const team=teamColor(p.team);
      const halo=mesh(g,'ring',[n.kind==='session'?.84:.6,n.kind==='session'?.84:.6,n.kind==='session'?.84:.6],[0,.12,-.35],glow(team),'ownership-halo');halo.rotation.x=-Math.PI/2;
      const ring=mesh(g,'ring',[.78,.78,.78],[0,.091,-.35],0x379b79,'selection-ring');ring.rotation.x=-Math.PI/2;ring.visible=false;
      const lamp=cylinder(g,.063,.04,.82,1.034,.84,statusColors[n.status]||statusColors.unknown,'status-lamp');
      const port=cylinder(g,.063,.035,.82,1.1,.84,glow(team),'relationship-port');
      const fx=new T.Group();fx.name='working-effects';fx.userData.nonInteractive=true;g.add(fx);fx.visible=false;
      const auraMat=new T.ShaderMaterial({
        uniforms:{tint:{value:new T.Color(0x57e7ad)},strength:{value:.45}},transparent:true,depthWrite:false,blending:T.AdditiveBlending,
        vertexShader:'varying vec3 surfaceNormal; varying vec3 viewDirection; void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);surfaceNormal=normalize(normalMatrix*normal);viewDirection=-mv.xyz;gl_Position=projectionMatrix*mv;}',
        fragmentShader:'uniform vec3 tint; uniform float strength; varying vec3 surfaceNormal; varying vec3 viewDirection; void main(){float rim=pow(1.0-abs(dot(normalize(surfaceNormal),normalize(viewDirection))),2.2);gl_FragColor=vec4(tint,rim*strength);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'
      });
      const aura=ball(fx,.59,.82,.51,0,1.05,-.36,auraMat,'working-aura');aura.userData.ownedMaterial=true;
      const energyMat=new T.MeshBasicMaterial({color:0x34c995,transparent:true,opacity:.7,depthWrite:false,blending:T.AdditiveBlending});
      const workRing=mesh(fx,'ring',[1.16,1.16,1.16],[0,.13,-.03],energyMat,'working-ring');workRing.rotation.x=-Math.PI/2;workRing.userData.ownedMaterial=true;
      const signal=new T.Group();signal.position.set(0,2.03,-.4);signal.name='working-beacon';fx.add(signal);
      const orbit=mesh(signal,'ring',[.22,.22,.22],[0,0,0],energyMat,'beacon-orbit');orbit.rotation.x=Math.PI/2;
      const sparks=[];for(let i=0;i<3;i++)sparks.push(ball(signal,.052,.052,.052,0,0,0,energyMat,'working-spark'));
      const a={id:n.id,node:n,group:g,head,upper,uniform,arms,elbows,wrists,keys,ring,halo,port,lamp,screenMat,fx,auraMat,energyMat,workRing,signal,sparks,p,appearance:{shirt,skin,hair},label:null,motion:'none',action:'none',activityLive:false};actors.set(n.id,a);return a;
    }
    function plan(nodes){
      const groups=new Map();for(const n of nodes){if(!groups.has(n.project_id))groups.set(n.project_id,[]);groups.get(n.project_id).push(n);}const result=[];
      for(const [id,list] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){
        const byId=new Map(list.map(n=>[n.id,n])),mains=list.filter(n=>n.kind==='session').sort((a,b)=>a.created_at-b.created_at||a.id.localeCompare(b.id));
        const owner=n=>{let x=n;const seen=new Set();while(x&&x.kind!=='session'&&!seen.has(x.id)){seen.add(x.id);x=byId.get(x.parent_agent_id);}return x?.kind==='session'?x.id:null;};
        const pods=mains.map(main=>({main,workers:list.filter(n=>n.kind==='subagent'&&owner(n)===main.id)}));
        for(const n of list)if(n.kind==='subagent'&&!owner(n))pods.push({main:n,workers:[]});
        const cols=Math.min(3,Math.max(1,Math.ceil(Math.sqrt(pods.length)))),teams=[],placements=new Map();let rowZ=0,maxW=0;
        for(let i=0;i<pods.length;i+=cols){let x=0,rowD=0;for(const p of pods.slice(i,i+cols)){
          const dark=mode==='prison',wc=p.workers.length>=3?3:2,pitch=dark?3.7:2.9,rowPitch=dark?4.25:3.4;
          const width=dark?(p.workers.length?wc*pitch+.6:4.6):Math.max(6.1,wc*pitch+.4),depth=(dark?4.1:3.25)+Math.ceil(p.workers.length/wc)*rowPitch,t={...p,width,depth,x:x+width/2,z:rowZ+depth/2};teams.push(t);rowD=Math.max(rowD,depth);
          placements.set(p.main.id,{x:t.x,z:rowZ+(dark?2.3:1.45),team:p.main.id});
          p.workers.forEach((n,j)=>placements.set(n.id,{x:t.x+(j%wc-(wc-1)/2)*pitch,z:rowZ+(dark?6.55:4.8)+Math.floor(j/wc)*rowPitch,team:p.main.id}));x+=width+.65;
        }maxW=Math.max(maxW,x-.65);rowZ+=rowD+.8;}
        for(const p of placements.values()){p.x-=maxW/2;p.z-=rowZ/2+1.1;}for(const t of teams){t.x-=maxW/2;t.z-=rowZ/2+1.1;}
        // Reserve a proper leisure strip even for a one-person project; props must not collide with desks or each other.
        result.push({id,name:list[0].project,width:Math.max(mode==='prison'?8:12,maxW+(mode==='prison'?2.7:3.7)),depth:Math.max(mode==='prison'?8:11.8,rowZ+(mode==='prison'?4.9:6.8)),teams,placements,nodes:list,x:0,z:0});
      }
      const cols=Math.max(1,Math.ceil(Math.sqrt(result.length)));let z=0;
      for(let i=0;i<result.length;i+=cols){const row=result.slice(i,i+cols),d=Math.max(...row.map(r=>r.depth));let x=0;for(const r of row){r.x=x+r.width/2;r.z=z+d/2;x+=r.width+3;}z+=d+3;}return result;
    }
    function clear(group){group.traverse(o=>{if(o.isLight)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();if(o.userData.ownedMaterial){o.material.map?.dispose();o.material.dispose();}});group.clear();}
    function rebuild(nodes){
      host.dataset.ready='loading';
      clear(architecture);clear(people);clear(links);for(const w of walls)w.m.dispose();walls=[];actors.clear();labels.replaceChildren();projectLabels=[];localLightCount=0;hovered='';rooms=plan(nodes);setMood();
      for(const r of rooms){roomGeometry(r);for(const n of r.nodes){
        const local=r.placements.get(n.id);if(!local)continue;const a=employee(n,{...local,x:r.x+local.x,z:r.z+local.z},nodes.length>50);
        const el=document.createElement('article');el.className='agent-node agent-3d-person '+n.kind;el.dataset.nodeId=n.id;const button=document.createElement('button');button.className='agent-node-select';button.dataset.selectAgent=n.id;el.append(button);labels.append(el);a.label=el;
      }const el=document.createElement('div');el.className='agent-project-region agent-3d-project';el.dataset.canvasProject=r.id;el.innerHTML='<strong>'+esc(r.name)+'</strong><small>'+r.nodes.filter(n=>n.kind==='session').length+ui(' 主 Agent / ')+r.nodes.filter(n=>n.kind==='subagent').length+' Subagents</small>';labels.append(el);projectLabels.push({el,room:r,point:v(r.x,3.4,r.z-r.depth/2)});}
      bounds.makeEmpty();for(const r of rooms){bounds.expandByPoint(v(r.x-r.width/2-1.5,-.3,r.z-r.depth/2));bounds.expandByPoint(v(r.x+r.width/2,3.4,r.z+r.depth/2));}if(bounds.isEmpty())bounds.set(v(-4,0,-4),v(4,3,4));
      const center=bounds.getCenter(v()),size=bounds.getSize(v()),extent=Math.max(size.x,size.z,12);sun.target.position.copy(center);sun.position.copy(center).add(v(-extent*.6,extent*1.2,extent*.8));
      Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,far:extent*5});sun.shadow.camera.updateProjectionMatrix();renderer.shadowMap.needsUpdate=true;
      host.dataset.employeeCount=String(actors.size);host.dataset.projectCount=String(rooms.length);host.dataset.mode=mode;
    }
    function edges(data){
      clear(links);edgeObjects=[];
      for(const e of data.edges){
        const a=actors.get(e.source),b=actors.get(e.target);if(!a||!b)continue;
        const state=e.kind==='collaboration'?'recorded':data.states.get(e.target)||'unknown';
        const color=e.kind==='delegation'?0xd4a064:e.kind==='subagent'?0x63b5ca:0xad95c3;
        const p=a.group.position.clone().add(v(.82,1.12,.84)),q=b.group.position.clone().add(v(.82,1.12,.84));
        const apex=e.kind==='delegation'?(mode==='prison'?3.05:2.6):e.kind==='subagent'?(mode==='prison'?2.9:1.86):3.15;
        const first=p.clone().lerp(q,.3),last=p.clone().lerp(q,.7);first.y=apex;last.y=apex;
        const curve=new T.CatmullRomCurve3([p,first,last,q]),group=new T.Group();group.name=e.kind+':'+e.source+'→'+e.target;group.userData.edge=e;
        const radius=e.kind==='delegation'?.042:.032;
        const tubeMat=new T.MeshBasicMaterial({color,transparent:true,opacity:mode==='prison'?.86:.78,depthWrite:false});
        const tube=new T.Mesh(new T.TubeGeometry(curve,36,radius,6,false),tubeMat);tube.userData.ownedGeometry=true;tube.userData.ownedMaterial=true;tube.renderOrder=3;group.add(tube);
        const arrow=mesh(group,'cone',[.1,.27,.1],curve.getPoint(.95).toArray(),glow(statusColors[state]||color),'relationship-arrow');
        arrow.quaternion.setFromUnitVectors(v(0,1,0),curve.getTangent(.95).normalize());
        const pulse=ball(group,.078,.078,.078,0,0,0,glow(0x68d5a4),'activity-flow');pulse.visible=false;links.add(group);
        edgeObjects.push({group,tubeMat,pulse,curve,state,kind:e.kind,color,radius,apex,highlighted:false});
      }
    }
    function emphasize(){
      const id=hovered||selected,chain=new Set(id?[id]:[]);
      if(id){
        const down=[id],up=[id],seenDown=new Set(),seenUp=new Set();
        while(down.length){const current=down.pop();if(seenDown.has(current))continue;seenDown.add(current);for(const e of edgeObjects)if(e.kind!=='collaboration'&&e.group.userData.edge.source===current){chain.add(e.group.userData.edge.target);down.push(e.group.userData.edge.target);}}
        while(up.length){const current=up.pop();if(seenUp.has(current))continue;seenUp.add(current);for(const e of edgeObjects)if(e.kind!=='collaboration'&&e.group.userData.edge.target===current){chain.add(e.group.userData.edge.source);up.push(e.group.userData.edge.source);}}
      }
      for(const e of edgeObjects){
        const edge=e.group.userData.edge;e.highlighted=Boolean(id&&chain.has(edge.source)&&chain.has(edge.target));
        e.tubeMat.opacity=id?(e.highlighted?1:.13):(e.kind==='collaboration'?.42:mode==='prison'?.86:.78);
        e.group.children.find(x=>x.name==='relationship-arrow').visible=!id||e.highlighted;
      }
      for(const a of actors.values()){a.halo.visible=!id||chain.has(a.id);a.ring.visible=a.id===id;a.label.classList.toggle('inspected',a.id===id);a.label.classList.toggle('relation-dim',Boolean(id&&!chain.has(a.id)));}
      const trace=$('agent-3d-trace');trace.hidden=!id;
      if(id&&actors.has(id)){
        const a=actors.get(id),n=a.node,owner=actors.get(a.p.team),incoming=edgeObjects.find(e=>e.group.userData.edge.target===id&&e.kind!=='collaboration');
        const label=x=>x.node.kind==='subagent'?'Subagent · '+x.node.agent_name:ui('主 Agent · ')+x.node.title;
        const start=incoming?actors.get(incoming.group.userData.edge.source):null;
        let text=start?label(start)+' → '+label(a):label(a);
        if(n.kind==='subagent'&&owner&&owner.node.kind==='session'&&start?.id!==owner.id)text=label(owner)+' → '+text;
        if(trace.title!==text)trace.innerHTML='<i class="'+(n.kind==='subagent'?'native':'business')+'"></i><span>'+esc(text)+'</span>';
        trace.title=text;
      }
      invalidate();
    }
    function projection(point){const p=point.clone().project(camera);return {x:(p.x*.5+.5)*host.clientWidth,y:(-p.y*.5+.5)*host.clientHeight,shown:p.z<1&&p.z>-1&&Math.abs(p.x)<1.1&&Math.abs(p.y)<1.1};}
    function projectLabelsToScreen(){
      const positions=[...actors.values()].map(a=>({a,p:projection(a.group.position.clone().add(v(0,mode==='prison'?2.75:2.16,-.4)))}));
      const focusedId=document.activeElement?.closest('.agent-3d-person')?.dataset.nodeId;
      const controlStrip=viewport.querySelector('.agent-controls'),captionTop=(controlStrip?.offsetTop||12)+(controlStrip?.offsetHeight||44)+10;
      const width=Math.min(host.clientWidth<600?156:188,host.clientWidth-24),fullRects=[],heads=positions.map(({a})=>({id:a.id,...projection(a.head.getWorldPosition(v()))})),priority=a=>a.id===hovered||a.id===focusedId?0:a.id===selected?1:a.node.kind==='session'?2:3;
      // A macro canvas cannot fit every sentence. Colliding captions become compact status bubbles, never fake agents.
      for(const {a,p} of positions.sort((x,y)=>priority(x.a)-priority(y.a)||x.a.id.localeCompare(y.a.id))){
        const inspected=a.id===hovered||a.id===focusedId||a.id===selected,isWorking=a.node.status==='working',captionX=Math.max(width/2+8,Math.min(p.x,host.clientWidth-width/2-8)),captionY=Math.max(p.y,captionTop+100),rect={left:captionX-width/2,right:captionX+width/2,top:captionY-100,bottom:captionY};
        const overlap=fullRects.some(r=>rect.left<r.right+8&&rect.right>r.left-8&&rect.top<r.bottom+8&&rect.bottom>r.top-8)||heads.some(h=>h.id!==a.id&&h.shown&&h.x>rect.left-12&&h.x<rect.right+12&&h.y>rect.top-12&&h.y<rect.bottom+12);
        const full=inspected||isWorking&&p.shown&&!overlap&&fullRects.length<4;
        a.label.dataset.bubbleSize=full?'full':'compact';
        if(full&&isWorking)fullRects.push(rect);
        const x=full?captionX:p.x,y=full&&isWorking?captionY:p.y;
        a.label.style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px)';a.label.hidden=!p.shown;
      }
      for(const {el,point} of projectLabels){const p=projection(point);el.style.transform='translate('+p.x.toFixed(1)+'px,'+p.y.toFixed(1)+'px)';el.hidden=!p.shown;}
      $('agent-zoom-label').textContent=Math.round(fitDistance/Math.max(1,controls.getDistance())*100)+'%';
    }
    function pose(a,time,enabled){
      const working=a.activityLive,typing=enabled&&working,waiting=enabled&&['waiting_agents','waiting_user'].includes(a.node.status),phase=time*9+(hash(a.id)%31)*.31,cycle=(time+hash(a.id)%7)%7.8;
      a.motion=typing?'typing':waiting?'waiting':'none';a.action=typing?(cycle>6.8?'using_mouse':cycle>5.7?'reviewing':'typing'):waiting?'waiting':'none';
      a.upper.rotation.set(typing?.055+Math.sin(time*1.5)*.022:0,0,typing?Math.sin(time*.85)*.018:0);
      a.upper.position.y=.82+(typing?Math.sin(time*1.9)*.008:0);
      a.head.rotation.set(typing?(a.action==='reviewing'?.14+Math.sin(time*1.4)*.055:.035+Math.sin(time*1.3)*.035):0,typing?Math.sin(time*.7)*.085:waiting?Math.sin(time*.8)*.17:0,0);
      for(let i=0;i<2;i++){
        const tap=phase+i*Math.PI;
        a.arms[i].rotation.set(typing?Math.sin(tap)*.04:0,typing&&i===1&&a.action==='using_mouse'?.48+Math.sin(time*3)*.045:0,typing?Math.sin(tap*.7)*.025:0);
        a.elbows[i].rotation.x=typing?(a.action==='typing'?-.08-Math.sin(tap)*.08:-.025):0;
        a.wrists[i].rotation.x=typing&&a.action==='typing'?.1+Math.sin(tap)*.09:0;
        a.wrists[i].rotation.z=typing&&a.action==='using_mouse'&&i===1?Math.sin(time*4.5)*.04:0;
      }
      for(let i=0;i<a.keys.length;i++)a.keys[i].position.y=1.015-(typing&&a.action==='typing'&&(i+Math.floor(time*9))%4===0?.005:0);
      const pulse=typing?.65+Math.sin(time*2.4)*.2:.65;
      a.fx.visible=working;a.uniform.emissiveIntensity=working?.22+pulse*.12:0;
      a.auraMat.uniforms.strength.value=working?pulse*.65:0;a.energyMat.opacity=working?.52+pulse*.24:0;
      a.workRing.scale.setScalar(1.16+(typing?Math.sin(time*2.4)*.1:0));
      a.signal.rotation.y=typing?time*.9:0;
      for(let i=0;i<a.sparks.length;i++){const angle=i*Math.PI*2/3+(typing?time*2:0);a.sparks[i].position.set(Math.cos(angle)*.22,typing?Math.sin(time*2+i)*.045:0,Math.sin(angle)*.22);}
      a.screenMat.emissiveIntensity=working?.55+pulse*.25:.1;a.label.dataset.motion=a.motion;a.label.dataset.action=a.action;
    }
    function frame(time=0){
      raf=0;if(!visible||lost||document.hidden)return;const enabled=motion&&!reduced.matches,animate=enabled&&([...actors.values()].some(a=>['working','waiting_agents','waiting_user'].includes(a.node.status))||edgeObjects.some(e=>e.state==='working'));
      if(dirty||!animate||time-lastFrame>32){
        for(const a of actors.values())pose(a,time/1000,enabled);for(const e of edgeObjects){e.pulse.visible=enabled&&e.state==='working';if(e.pulse.visible)e.pulse.position.copy(e.curve.getPoint((time/3500+hash(e.group.name)%19/19)%1));}
        for(const w of walls){const outside=w.side==='back'?camera.position.z<w.r.z:w.side==='right'?camera.position.x>w.r.x:camera.position.x<w.r.x;w.m.opacity=outside?.12:1;w.m.depthWrite=!outside;}
        controls.update();renderer.render(scene,camera);projectLabelsToScreen();dirty=false;lastFrame=time;host.dataset.ready='true';
      }if(animate)raf=requestAnimationFrame(frame);
    }
    function invalidate(){dirty=true;if(!raf&&visible&&!lost)raf=requestAnimationFrame(frame);}
    function resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();invalidate();}
    function fit(){
      resize();const center=bounds.getCenter(v()),direction=v(.72,.88,1).normalize(),inset=viewport.querySelector('.agent-controls')?.offsetHeight||44,usable=Math.max(.35,1-(inset+80)/Math.max(1,host.clientHeight));
      controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,30);camera.lookAt(center);camera.updateMatrixWorld();const tan=Math.tan(camera.fov*Math.PI/360),right=v().setFromMatrixColumn(camera.matrixWorld,0),up=v().setFromMatrixColumn(camera.matrixWorld,1);let distance=8;
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const p=v(x,y,z).sub(center);distance=Math.max(distance,Math.abs(p.dot(right))/(tan*camera.aspect)+p.dot(direction),Math.abs(p.dot(up))/(tan*usable)+p.dot(direction));}
      fitDistance=distance;controls.maxDistance=Math.max(200,distance*5);camera.far=Math.max(1000,distance*10);camera.updateProjectionMatrix();
      controls.target.copy(center).addScaledVector(up,distance*tan*inset/Math.max(1,host.clientHeight)*.2);camera.position.copy(controls.target).addScaledVector(direction,distance);controls.update();controls.saveState();invalidate();
    }
    function zoom(f){controls.dollyIn(f);controls.update();invalidate();}
    function pan(x,y){controls.pan(x,y);controls.update();invalidate();}
    function focus(id){const a=actors.get(id);if(!a)return;tooltip.hidden=true;hovered='';emphasize();const offset=camera.position.clone().sub(controls.target),distance=Math.min(offset.length(),12),target=a.group.position.clone().add(v(0,.65,0));if(!$('agent-detail').hidden)target.addScaledVector(v().setFromMatrixColumn(camera.matrixWorld,0),1.5);controls.target.copy(target);camera.position.copy(target).addScaledVector(offset.normalize(),distance);controls.update();invalidate();}
    function hit(e){const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects([...actors.values()].map(a=>a.group),true);const picked=hits.find(h=>{if(h.object.material?.transparent&&h.object.material.opacity<.3)return false;let o=h.object;while(o){if(o.userData.nonInteractive)return false;o=o.parent;}return true;});if(!picked)return '';let o=picked.object;while(o&&!o.userData.agentId)o=o.parent;return o?.userData.agentId||'';}
    function hint(id,x,y){const a=actors.get(id);if(!a){tooltip.hidden=true;return;}const owner=actors.get(a.p.team),role=a.node.kind==='subagent'?'Subagent · '+a.node.agent_name:ui('独立会话 · 主 Agent');const ownership=a.node.kind==='subagent'?(owner?.node.kind==='session'?ui('归属主 Agent：')+owner.node.title:ui('归属主 Agent 待确认')):ui('独立会话；会话间连接为业务委托');tooltip.innerHTML='<span>'+esc(role)+'</span><strong>'+esc(a.node.task_summary)+'</strong><small>'+esc(ownership)+'</small><small>'+esc(a.node.status_label)+' · '+esc(a.node.model)+'</small>';tooltip.hidden=false;tooltip.style.left=Math.max(10,Math.min(x+16,viewport.clientWidth-260))+'px';tooltip.style.top=Math.max(10,Math.min(y+12,viewport.clientHeight-155))+'px';}
    renderer.domElement.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId};});
    renderer.domElement.addEventListener('pointerup',e=>{if(pointerStart&&pointerStart.id===e.pointerId&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)<6){const id=hit(e);if(id)onSelect(id);}pointerStart=null;});
    renderer.domElement.addEventListener('pointercancel',()=>{pointerStart=null;});
    renderer.domElement.addEventListener('pointermove',e=>{if(e.buttons){tooltip.hidden=true;return;}const id=hit(e),r=host.getBoundingClientRect();if(id!==hovered){hovered=id;emphasize();}renderer.domElement.style.cursor=id?'pointer':'grab';hint(id,e.clientX-r.left,e.clientY-r.top);});
    renderer.domElement.addEventListener('pointerleave',()=>{tooltip.hidden=true;hovered='';emphasize();});
    labels.addEventListener('pointerover',e=>{const el=e.target.closest('[data-node-id]');if(el){const r=el.getBoundingClientRect(),h=host.getBoundingClientRect();hovered=el.dataset.nodeId;emphasize();hint(el.dataset.nodeId,r.x-h.x,r.y-h.y);}});
    labels.addEventListener('pointerout',e=>{if(e.relatedTarget?.closest?.('[data-node-id]')===e.target.closest('[data-node-id]'))return;tooltip.hidden=true;hovered='';emphasize();});controls.addEventListener('change',invalidate);
    labels.addEventListener('focusin',invalidate);labels.addEventListener('focusout',invalidate);
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;cancelAnimationFrame(raf);raf=0;host.dataset.ready='lost';$('agent-3d-error').hidden=false;});
    renderer.domElement.addEventListener('webglcontextrestored',()=>{lost=false;$('agent-3d-error').hidden=true;renderer.shadowMap.needsUpdate=true;invalidate();});
    const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
    const mediaChange=()=>{for(const a of actors.values())pose(a,0,false);host.dataset.motion=motion&&!reduced.matches?'live':'paused';invalidate();};reduced.addEventListener('change',mediaChange);
    const visibilityChange=()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else invalidate();};document.addEventListener('visibilitychange',visibilityChange);
    function update(data){
      const signature=data.mode+'|'+data.nodes.map(n=>[n.id,n.project_id,parent(n)].join(':')).join('|'),changed=signature!==topology;mode=data.mode;selected=data.selected;motion=data.motion;observation=data.observation||'offline';
      if(changed){topology=signature;rebuild(data.nodes);}
      if(localeStamp!==i18n.locale){
        localeStamp=i18n.locale;architecture.traverse(o=>o.userData.localize?.());people.traverse(o=>o.userData.localize?.());
        for(const {el,room:r}of projectLabels)el.querySelector('small').textContent=r.nodes.filter(n=>n.kind==='session').length+ui(' 主 Agent / ')+r.nodes.filter(n=>n.kind==='subagent').length+' Subagents';
        renderer.domElement.setAttribute('aria-label',ui('可旋转的三维 Agent 办公空间'));tooltip.hidden=true;
      }
      const edgeKey=data.edges.map(e=>e.source+':'+e.target+':'+e.kind+':'+data.states.get(e.target)).join('|');if(changed||links.userData.key!==edgeKey){edges(data);links.userData.key=edgeKey;}
      for(const n of data.nodes){
        const a=actors.get(n.id);if(!a)continue;a.node=n;a.activityLive=observation==='live'&&n.status==='working';a.ring.visible=n.id===selected;a.lamp.material=mat(statusColors[n.status]||statusColors.unknown);
        a.label.dataset.status=n.status;a.label.classList.toggle('selected',n.id===selected);a.label.classList.toggle('dim',data.related&&!data.related.has(n.id));a.label.classList.toggle('context',!data.wanted.has(n.id));
        const button=a.label.querySelector('.agent-node-select'),name=n.kind==='subagent'?n.agent_name:brief(n.title,26);
        a.label.dataset.teamId=a.p.team;a.label.style.setProperty('--team-color',hex(teamColor(a.p.team)));
        const isActive=['working','waiting_agents','waiting_user'].includes(n.status);
        const status=observation!=='live'&&isActive?({offline:ui('离线记录'),paused:ui('暂停观察'),stale:ui('观察待确认')}[observation]||ui('最后记录')):n.status==='working'?ui('执行中'):n.status==='waiting_agents'?ui('等待代理'):n.status==='waiting_user'?ui('等待确认'):n.status==='failed'?ui('本轮失败'):n.status_label;
        a.label.dataset.bubble=isActive&&observation!=='live'?'recorded':n.status==='working'?'working':['waiting_agents','waiting_user'].includes(n.status)?'waiting':n.status==='failed'?'failed':'none';
        a.label.dataset.observation=observation;
        const dotColor=isActive&&observation!=='live'?statusColors.unknown:statusColors[n.status]||statusColors.unknown;
        const caption=[i18n.locale,name,n.kind,n.project,status,n.task_summary,n.current_activity].join('|');
        if(caption!==a.caption){
          a.caption=caption;button.innerHTML='<span class="agent-person-header"><i class="agent-person-dot" style="background:'+hex(dotColor)+'"></i><b class="agent-role-tag">'+(n.kind==='subagent'?'Sub':ui('主'))+'</b><span class="agent-person-title">'+esc(name)+'</span><span class="agent-bubble-project">'+esc(brief(n.project,18))+'</span><span class="agent-bubble-status">'+esc(status)+'</span><span class="agent-work-indicator" aria-hidden="true"><i></i><i></i><i></i></span></span><strong class="agent-bubble-task">'+esc(brief(n.task_summary||n.title,54))+'</strong><small class="agent-bubble-activity">'+esc(brief(n.current_activity,32))+ui(' · 记录观察</small>');
        }
        button.setAttribute('aria-label',(n.kind==='subagent'?'Subagent · ':ui('主 Agent · '))+n.title+' · '+status);button.setAttribute('aria-pressed',String(n.id===selected));button.removeAttribute('title');
        const count=data.children.get(n.id)?.filter(x=>x.project_id===n.project_id).length||0;let toggle=a.label.querySelector('[data-expand-agent]');
        if(count){if(!toggle){toggle=document.createElement('button');toggle.className='agent-3d-branch';toggle.dataset.expandAgent=n.id;a.label.append(toggle);}toggle.setAttribute('aria-label',(data.collapsed.has(n.id)?ui('展开'):ui('收起'))+' '+count+ui(' 分支'));toggle.setAttribute('aria-expanded',String(!data.collapsed.has(n.id)));toggle.textContent=(data.collapsed.has(n.id)?'+':'−')+count;}else toggle?.remove();
        pose(a,performance.now()/1000,motion&&!reduced.matches);
      }
      host.dataset.motion=motion&&!reduced.matches?'live':'paused';const workCount=[...actors.values()].filter(a=>a.activityLive).length;
      $('agent-3d-heading').innerHTML='<b>3D / '+(mode==='prison'?ui('单人隔间'):ui('休闲办公室'))+'</b><span>'+actors.size+ui(' 位员工 · ')+rooms.length+ui(' 个项目办公区')+(observation==='live'?' · '+workCount+ui(' 位正在执行'):' · '+(observation==='paused'?ui('观察已暂停'):ui('执行状态待确认')))+ui('</span><div class="agent-3d-link-key"><span><i class="native"></i>主 → Subagent</span><span><i class="business"></i>会话业务委托</span></div>');
      emphasize();
      if(changed||data.fit)fit();else resize();invalidate();
    }
    function setVisible(value){if(value!==visible){if(value)labels.append(detachedLabels);else detachedLabels.append(...labels.childNodes);}visible=value;host.hidden=!value;if(value){resize();invalidate();}else{cancelAnimationFrame(raf);raf=0;tooltip.hidden=true;}}
    function debug(){
      const features={};scene.traverse(o=>{if(o.name)features[o.name]=(features[o.name]||0)+1;});
      return {available:true,revision:T.REVISION,mode,visible,ready:host.dataset.ready,selected,hovered,observation,
        motion:motion&&!reduced.matches&&visible&&!document.hidden,features,
        lighting:{background:hex(scene.background.getHex()),ambient:ambient.intensity,sun:sun.intensity,fill:fill.intensity,exposure:renderer.toneMappingExposure,localLights:localLightCount},
        projects:rooms.map(r=>({id:r.id,width:r.width,depth:r.depth,teams:r.teams.map(t=>t.main.id)})),
        actors:[...actors.values()].map(a=>({id:a.id,status:a.node.status,motion:a.motion,action:a.action,position:a.group.position.toArray(),team:a.p.team,teamColor:hex(teamColor(a.p.team)),appearance:a.appearance,arm:a.arms[0].rotation.x,joints:{elbow:a.elbows.map(e=>e.rotation.x),wrist:a.wrists.map(w=>w.rotation.x),spine:a.upper.rotation.x,head:a.head.rotation.toArray().slice(0,3)},effects:{visible:a.fx.visible,strength:a.auraMat.uniforms.strength.value,ringScale:a.workRing.scale.x,beacon:a.signal.rotation.y},bubble:{kind:a.label.dataset.bubble,size:a.label.dataset.bubbleSize},meshCount:a.group.children.length,cell:Boolean(a.group.getObjectByName('single-cell')),halo:a.halo.visible})),
        edges:edgeObjects.map(e=>({kind:e.kind,state:e.state,flow:e.pulse.visible,source:e.group.userData.edge.source,target:e.group.userData.edge.target,color:hex(e.color),radius:e.radius,apex:e.apex,highlighted:e.highlighted,opacity:e.tubeMat.opacity,arrowVisible:e.group.children.find(x=>x.name==='relationship-arrow').visible})),
        camera:camera.position.toArray(),target:controls.target.toArray(),render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles},memory:{...renderer.info.memory}};
    }
    function screenPoint(id){const a=actors.get(id);if(!a)return null;const p=projection(a.head.getWorldPosition(v())),r=host.getBoundingClientRect();return {x:r.x+p.x,y:r.y+p.y,shown:p.shown};}
    function dispose(){visible=false;cancelAnimationFrame(raf);resizeObserver.disconnect();reduced.removeEventListener('change',mediaChange);document.removeEventListener('visibilitychange',visibilityChange);controls.dispose();clear(architecture);clear(people);clear(links);for(const m of mats.values())m.dispose();for(const g of geos.values())g.dispose();for(const w of walls)w.m.dispose();renderer.dispose();renderer.domElement.remove();}
    return {available:true,update,setVisible,fit,zoom,focus,pan,debug,screenPoint,dispose};
  }
  window.CodexAgentScenes={create,metrics:(_mode,kind)=>({width:kind==='subagent'?220:248,height:kind==='subagent'?136:160})};
})();
