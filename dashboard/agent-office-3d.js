/* Real geometry, not a sprite skin. One employee per observed Agent.
   Shared meshes/materials; render-on-demand when there is no observed activity. */
(() => {
  'use strict';
  const i18n=window.CodexI18n, ui=i18n.ui;
  const T=window.CodexThree;if(!T)return;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hash=v=>{let h=2166136261;for(const c of String(v)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
  const coworkerSpecies=['human','cow','horse'];
  const overviewPolicy={enterCount:32,exitCount:24,simplifyBelow:40,detailAbove:60};
  const statusColors={working:0x328b6e,waiting_agents:0xb38a3d,waiting_user:0xb38a3d,idle:0x728991,unknown:0x9c937c,failed:0xc46756,interrupted:0x8b8498,archived:0x929b9d};
  const shirts=[0x426982,0x406d5c,0x8f4850,0x615f86,0x916b38,0x3f6972],skins=[0xe5b18b,0xc88d65,0xf0c6a7,0xa97050,0xdbad90],hairs=[0x312723,0x574137,0x23282b,0x837269,0x352c2b];
  const teamPalette=[0x5eaa8b,0x719fc4,0xc28f71,0xa595bd,0xa7aa6d,0x73b5bd];
  const defaultTeamColor=id=>teamPalette[hash(id)%teamPalette.length];
  const personal=window.CodexOfficePreferences;
  const hex=color=>'#'+color.toString(16).padStart(6,'0');
  const brief=(value,length=40)=>{const chars=Array.from(String(value??'').replace(/\s+/g,' ').trim());return chars.length>length?chars.slice(0,length).join('')+'…':chars.join('');};
  const parent=n=>n.kind==='subagent'?n.parent_agent_id:n.business_parent_id;
  function create(viewport,onSelect){
    const teamProjects=new Map();
    const teamColor=id=>{const c=personal.project(teamProjects.get(id));return c==='auto'?defaultTeamColor(id):parseInt(c.slice(1),16);};
    const host=$('agent-3d'),labels=$('agent-3d-labels'),tooltip=$('agent-3d-tooltip');let renderer;
    try{renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}
    catch(_){host.dataset.ready='unavailable';$('agent-3d-error').hidden=false;return {available:false,setVisible(){},dispose(){},debug:()=>({available:false})};}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=T.SRGBColorSpace;
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
    // One shared portrait fill reveals facial planes in dark close-ups without
    // adding a point light for every employee or brightening the cell background.
    const portraitFill=new T.DirectionalLight(0xe3d1bc,0);scene.add(portraitFill,portraitFill.target);
    const studio=new T.RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer),environment=pmrem.fromScene(studio,.04);
    scene.environment=environment.texture;scene.environmentIntensity=.32;studio.dispose();pmrem.dispose();
    const renderTarget=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,samples:4});
    const composer=new T.EffectComposer(renderer,renderTarget),renderPass=new T.RenderPass(scene,camera);
    const ao=new T.GTAOPass(scene,camera,1,1),outputPass=new T.OutputPass();
    ao.updateGtaoMaterial({radius:.28,thickness:.3,distanceExponent:1.5,samples:8});ao.blendIntensity=.65;
    // Transparent windows, relationship paths and activity glows must not cast
    // solid phantom silhouettes into the contact-shadow buffer.
    const originalVisibility=ao._overrideVisibility.bind(ao);
    ao._overrideVisibility=()=>{originalVisibility();scene.traverse(o=>{if(o.visible&&(o.userData.nonInteractive||o.material?.transparent)){ao._visibilityCache.push(o);o.visible=false;}});};
    composer.addPass(renderPass);composer.addPass(ao);composer.addPass(outputPass);
    renderer.info.autoReset=false;
    const architecture=new T.Group(),people=new T.Group(),links=new T.Group(),overviewPeople=new T.Group();scene.add(architecture,people,links,overviewPeople);
    const mats=new Map(),geos=new Map(),actors=new Map(),raycaster=new T.Raycaster(),pointer=new T.Vector2(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let rooms=[],walls=[],edgeObjects=[],projectLabels=[],mode='office',topology='',selected='',hovered='',visible=false,lost=false,motion=false,observation='offline',raf=0,dirty=true,lastFrame=0,fitDistance=1,pointerStart=null;
    let localLightCount=0,localeStamp=i18n.locale,cameraPreset='iso',userNavigated=false,leaderMarkup='';
    let overviewParts=[],overviewActors=[],overviewCount=0,culledCount=0,renderedFrames=0,architectureBatches=[],crowdedView=false,inViewCount=0;
    const frustum=new T.Frustum(),viewMatrix=new T.Matrix4(),actorSphere=new T.Sphere(),projectedCorner=new T.Vector3(),instanceTransform=new T.Object3D(),instanceColor=new T.Color();
    const viewHistory=[];
    function rememberView(){
      const view={camera:camera.position.toArray(),target:controls.target.toArray(),preset:cameraPreset,distance:fitDistance},last=viewHistory.at(-1);
      if(!last||JSON.stringify(last)!==JSON.stringify(view)){viewHistory.push(view);if(viewHistory.length>12)viewHistory.shift();}
      $('agent-view-back').disabled=!viewHistory.length;
    }
    function previousView(){const view=viewHistory.pop();if(!view)return;userNavigated=true;cameraPreset=view.preset;$('agent-camera').value=cameraPreset;fitDistance=view.distance;camera.position.fromArray(view.camera);controls.target.fromArray(view.target);controls.update();$('agent-view-back').disabled=!viewHistory.length;invalidate();}
    $('agent-view-back').addEventListener('click',previousView);
    viewport.addEventListener('keydown',e=>{
      if(e.target!==viewport||!visible||e.ctrlKey||e.metaKey||e.altKey)return;
      const key=e.key.toLowerCase();
      if(key==='b'){e.preventDefault();previousView();}
      if(key==='v'){e.preventDefault();const values=['iso','top','desk'];setCameraPreset(values[(values.indexOf(cameraPreset)+1)%values.length]);$('agent-camera').value=cameraPreset;}
      if(key==='n'){e.preventDefault();$('agent-roster').open=true;$('agent-roster-search').focus();}
      if(key==='/'){e.preventDefault();$('agent-search').focus();}
    });
    let labelMode='auto';try{const saved=localStorage.getItem('codex-office-labels');if(['auto','quiet','detailed'].includes(saved))labelMode=saved;}catch(_){}
    $('agent-label-mode').value=labelMode;
    $('agent-label-mode').addEventListener('change',e=>{labelMode=e.target.value;try{localStorage.setItem('codex-office-labels',labelMode);}catch(_){}invalidate();});
    let linkMode='all';try{const saved=localStorage.getItem('codex-office-links');if(['all','active','inspect'].includes(saved))linkMode=saved;}catch(_){}
    $('agent-link-mode').value=linkMode;
    $('agent-link-mode').addEventListener('change',e=>{linkMode=e.target.value;try{localStorage.setItem('codex-office-links',linkMode);}catch(_){}emphasize();});
    let rosterKey='',rosterQuery='',rosterScope='all';
    $('agent-roster-search').addEventListener('input',e=>{rosterQuery=e.target.value.trim().toLocaleLowerCase();updateRoster();});
    function updateRoster(){
      const key=JSON.stringify([i18n.locale,observation,selected,rosterQuery,rosterScope,rooms.map(r=>[r.id,r.name]),[...actors.values()].map(a=>[a.id,a.node.title,personal.name(a.node),a.node.status,a.node.status_label,a.node.agent_name,a.node.project_id,a.node.task_summary])]);
      if(key===rosterKey)return;rosterKey=key;
      const panel=$('agent-roster-list'),focused=document.activeElement?.dataset.rosterAgent,scroll=$('agent-roster-panel').scrollTop;
      const matches=a=>(rosterScope==='all'||observation==='live'&&(rosterScope==='working'?a.activityLive:['waiting_user','unknown','failed','interrupted'].includes(a.node.status)))&&[a.node.project,a.node.title,a.node.agent_name,personal.name(a.node),a.node.task_summary].join(' ').toLocaleLowerCase().includes(rosterQuery);
      const matched=[...actors.values()].filter(matches).length;
      $('agent-roster-count').textContent=String(rooms.length);
      for(const b of $('agent-roster-panel').querySelectorAll('[data-roster-scope]'))b.setAttribute('aria-pressed',String(b.dataset.rosterScope===rosterScope));
      panel.innerHTML='<p class="agent-roster-note">'+esc(observation==='live'?ui('可见员工')+' · '+matched+' / '+actors.size:observation==='paused'?ui('观察已暂停，显示最后记录'):ui('当前状态待确认'))+'</p>'+rooms.map(r=>{
        const members=r.nodes.map(n=>actors.get(n.id)).filter(a=>a&&matches(a)),working=members.filter(a=>a.activityLive).length;if(!members.length)return '';
        return '<section><button class="agent-roster-project" data-roster-project="'+esc(r.id)+'" aria-label="'+esc(ui('定位办公区：')+r.name)+'"><strong>'+esc(r.name)+'</strong><span>'+members.length+' · '+esc(ui('可见员工'))+(observation==='live'?' / '+working+' '+esc(ui('执行中')):'')+'</span></button><div class="agent-roster-members">'+members.map(a=>{
          const n=a.node,name=personal.get(n.id).nickname||(n.kind==='subagent'?n.agent_name:n.title),status=observation==='live'?i18n.systemText(n.status_label):ui('最后记录'),color=observation==='live'?statusColors[n.status]||statusColors.unknown:statusColors.unknown;
          return '<button data-roster-agent="'+esc(a.id)+'" aria-current="'+String(a.id===selected)+'" aria-label="'+esc(ui('检查员工：')+name)+'" title="'+esc(n.task_summary||n.title)+'"><i style="background:'+hex(color)+'"></i><span><b>'+esc(n.kind==='subagent'?'Subagent':ui('主 Agent'))+'</b> '+esc(brief(name,32))+'<em>'+esc(brief(n.task_summary||n.title,64))+'</em></span><small>'+esc(status)+'</small></button>';
        }).join('')+'</div></section>';
      }).join('')+(matched?'':'<div class="agent-roster-empty"><p>'+esc(ui('没有匹配的员工'))+'</p><small>'+esc(ui('仅筛选导航列表，不改变画布'))+'</small><button data-roster-clear>'+esc(ui('清除导航筛选'))+'</button></div>');
      $('agent-roster-panel').scrollTop=scroll;
      if(focused)for(const button of panel.querySelectorAll('[data-roster-agent]'))if(button.dataset.rosterAgent===focused)button.focus({preventScroll:true});
    }
    $('agent-roster-panel').addEventListener('click',e=>{
      const scope=e.target.closest('[data-roster-scope]');if(scope){rosterScope=scope.dataset.rosterScope;updateRoster();return;}
      if(e.target.closest('[data-roster-clear]')){rosterScope='all';rosterQuery='';$('agent-roster-search').value='';updateRoster();$('agent-roster-search').focus();return;}
      const project=e.target.closest('[data-roster-project]'),employee=e.target.closest('[data-roster-agent]');
      if(project){focusProject(project.dataset.rosterProject);$('agent-roster').open=false;$('agent-roster').querySelector('summary').focus();}
      if(employee){$('agent-roster').open=false;onSelect(employee.dataset.rosterAgent);$('agent-close-detail')?.focus();}
    });
    for(const id of ['agent-roster','agent-display-controls'])$(id).addEventListener('toggle',()=>{if($(id).open)$(id==='agent-roster'?'agent-display-controls':'agent-roster').open=false;invalidate();});
    viewport.addEventListener('pointerdown',e=>{if(!e.target.closest('#agent-roster,#agent-display-controls')){$('agent-roster').open=false;$('agent-display-controls').open=false;}});
    viewport.addEventListener('keydown',e=>{if(e.key==='Escape'){const panel=['agent-roster','agent-display-controls'].map($).find(p=>p.open);if(panel){e.stopPropagation();panel.open=false;panel.querySelector('summary').focus();}}});
    const prototypes={},assetStates={human:'loading',cow:'loading',horse:'loading'};
    let assetState='loading',disposed=false,quality='auto',effectiveQuality='',renderSize='',pickRaf=0,pendingPick=null;
    try{const saved=localStorage.getItem('codex-office-quality');if(['auto','high','balanced'].includes(saved))quality=saved;}catch(_){}
    function configureQuality(){
      const next=quality==='auto'?(inViewCount>overviewPolicy.exitCount&&controls.getDistance()>(effectiveQuality==='balanced'?20:28)?'balanced':'high'):quality;
      const ratio=Math.min(devicePixelRatio||1,next==='high'?2:quality==='auto'?1.5:1.25);
      if(next!==effectiveQuality||renderer.getPixelRatio()!==ratio){effectiveQuality=next;renderer.setPixelRatio(ratio);composer.setPixelRatio(ratio);ao.enabled=next==='high';renderSize='';}
      if($('agent-quality'))$('agent-quality').value=quality;
    }
    configureQuality();
    $('agent-quality')?.addEventListener('change',e=>{quality=e.target.value;try{localStorage.setItem('codex-office-quality',quality);}catch(_){}configureQuality();resize();});
    const bounds=new T.Box3(),detachedLabels=document.createDocumentFragment(),v=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
    function mat(color,roughness=.65,metalness=0){const k=color+':'+roughness+':'+metalness;if(!mats.has(k))mats.set(k,new T.MeshStandardMaterial({color,roughness,metalness}));return mats.get(k);}
    function geo(type){if(!geos.has(type))geos.set(type,type==='sphere'?new T.SphereGeometry(1,32,24):type==='cylinder'?new T.CylinderGeometry(1,1,1,24):type==='cone'?new T.ConeGeometry(1,1,24):type==='ring'?new T.TorusGeometry(1,.035,8,64):new T.BoxGeometry(1,1,1));return geos.get(type);}
    function mesh(p,type,size,pos,m,name='',shadow=false){const o=new T.Mesh(geo(type),typeof m==='number'?mat(m):m);o.scale.set(...size);o.position.set(...pos);o.name=name;o.castShadow=shadow;o.receiveShadow=true;p.add(o);return o;}
    const woodNames=new Set(['desktop','coffee-table','coffee-cabinet','coffee-counter','shelf','bookshelf-frame','meeting-table','floor']);
    const fabricNames=new Set(['chair-seat','sofa-seat','sofa-back','sofa-arm','cushion','throw-blanket']);
    function surface(base,kind){
      const key='surface:'+base+':'+kind;if(mats.has(key))return mats.get(key);
      const c=document.createElement('canvas');c.width=512;c.height=512;const ctx=c.getContext('2d'),im=ctx.createImageData(512,512);
      for(let y=0;y<512;y++)for(let x=0;x<512;x++){
        const grain=kind==='wood'?Math.sin(y*.24+Math.sin(x*.016)*2)+.4*Math.sin(y*.83+x*.009):Math.sin(x*Math.PI/2)*Math.sin(y*Math.PI/2);
        const value=Math.round(242+grain*(kind==='wood'?6:9)),i=(y*512+x)*4;im.data.set([value,value,value,255],i);
      }ctx.putImageData(im,0,0);
      const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      const m=new T.MeshStandardMaterial({color:base,map,roughness:kind==='wood'?.57:.87});m.userData.ownedMap=true;mats.set(key,m);return m;
    }
    function box(p,w,h,d,x,y,z,m,name='',shadow=false){
      if(typeof m==='number'&&(woodNames.has(name)||fabricNames.has(name)))m=surface(m,woodNames.has(name)?'wood':'fabric');
      if(name&&Math.min(w,h,d)>.025&&!/wall|floor|foundation|window|slat|bar|divider|sticky/.test(name)){
        const radius=Math.min(.055,Math.min(w,h,d)*.23),key='bevel:'+w+':'+h+':'+d;
        if(!geos.has(key))geos.set(key,new T.RoundedBoxGeometry(w,h,d,3,radius));
        const o=new T.Mesh(geos.get(key),typeof m==='number'?mat(m):m);o.position.set(x,y,z);o.name=name;o.castShadow=shadow;o.receiveShadow=true;p.add(o);return o;
      }
      return mesh(p,'box',[w,h,d],[x,y,z],m,name,shadow);
    }
    const ball=(p,w,h,d,x,y,z,m,name='')=>mesh(p,'sphere',[w,h,d],[x,y,z],m,name);
    const cylinder=(p,r,h,x,y,z,m,name='',shadow=false)=>mesh(p,'cylinder',[r,h,r],[x,y,z],m,name,shadow);
    function segment(p,a,b,r,m,name){const start=v(...a),end=v(...b),mid=start.clone().add(end).multiplyScalar(.5);const o=cylinder(p,r,start.distanceTo(end),mid.x,mid.y,mid.z,m,name);o.quaternion.setFromUnitVectors(v(0,1,0),end.sub(start).normalize());return o;}
    // Contoured, indexed meshes: adult jaw/cheek planes and tailored silhouettes,
    // not a stack of scaled spheres. Named profiles are shared between employees.
    function contourGeometry(key,profile,segments=40,sculpt){
      const cache='contour:'+key;if(geos.has(cache))return geos.get(cache);
      const rows=[];
      for(let i=0;i<profile.length-1;i++)for(let j=0;j<3;j++){
        const t=j/3;rows.push(profile[i].map((value,k)=>value+(profile[i+1][k]-value)*t));
      }rows.push(profile.at(-1));
      const positions=[],indices=[];
      for(const [y,rx,rz,zc=0,exponent=2] of rows)for(let j=0;j<segments;j++){
        const angle=j*Math.PI*2/segments,s=Math.sin(angle),c=Math.cos(angle);
        const x=Math.sign(s)*Math.pow(Math.abs(s),2/exponent)*rx;
        let z=Math.sign(c)*Math.pow(Math.abs(c),2/exponent)*rz+zc;
        if(sculpt)z+=sculpt(x,y,Math.max(0,c));positions.push(x,y,z);
      }
      for(let i=0;i<rows.length-1;i++)for(let j=0;j<segments;j++){
        const a=i*segments+j,b=i*segments+(j+1)%segments,c=a+segments,d=b+segments;
        indices.push(a,b,c,b,d,c);
      }
      const bottom=positions.length/3;positions.push(0,rows[0][0],rows[0][3]||0);
      const top=positions.length/3;positions.push(0,rows.at(-1)[0],rows.at(-1)[3]||0);
      for(let j=0;j<segments;j++){indices.push(bottom,(j+1)%segments,j);const a=(rows.length-1)*segments+j,b=(rows.length-1)*segments+(j+1)%segments;indices.push(top,a,b);}
      const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
      geometry.name=key;geos.set(cache,geometry);return geometry;
    }
    function sculpted(p,key,profile,pos,material,name,segments=40,sculpt){
      const o=new T.Mesh(contourGeometry(key,profile,segments,sculpt),typeof material==='number'?mat(material):material);
      o.position.set(...pos);o.name=name;o.castShadow=true;o.receiveShadow=true;p.add(o);return o;
    }
    function tailoredLimb(p,key,a,b,radii,material,name){
      const start=v(...a),end=v(...b),length=start.distanceTo(end);
      const profile=radii.map(([t,rx,rz])=>[t*length,rx,rz]);
      const o=sculpted(p,key,profile,a,material,name,28);o.quaternion.setFromUnitVectors(v(0,1,0),end.sub(start).normalize());return o;
    }
    function fineCurve(p,key,points,radius,material,name){
      const cache='detail:'+key;
      if(!geos.has(cache))geos.set(cache,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(a=>v(...a))),20,radius,6,false));
      const o=new T.Mesh(geos.get(cache),typeof material==='number'?mat(material):material);o.name=name;p.add(o);return o;
    }
    function hairCap(p,style,color){
      const key='hair-cap:'+style;let geometry=geos.get(key);
      if(!geometry){
        const positions=[],indices=[],rings=18,segments=64;
        for(let i=0;i<=rings;i++)for(let j=0;j<segments;j++){
          const angle=j*Math.PI*2/segments,front=Math.max(0,Math.cos(angle)),side=Math.abs(Math.sin(angle));
          const hairline=style===1?1.84-front*.75:1.86-front*.9+side*.08;
          const phi=.015+(hairline-.015)*i/rings,part=style===0?Math.sin(angle+.6)*.014*Math.sin(phi):0;
          positions.push(Math.sin(angle)*Math.sin(phi)*.179,.012+Math.cos(phi)*.251+part,Math.cos(angle)*Math.sin(phi)*.174-.014);
        }
        for(let i=0;i<rings;i++)for(let j=0;j<segments;j++){const a=i*segments+j,b=i*segments+(j+1)%segments,c=a+segments,d=b+segments;indices.push(a,c,b,b,c,d);}
        geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();geos.set(key,geometry);
      }
      const cap=new T.Mesh(geometry,mat(color,.85));cap.name='hair-cap';cap.castShadow=true;p.add(cap);
      if(style===1)sculpted(p,'bob-back',[[-.15,.116,.046],[-.13,.158,.066],[.02,.17,.062],[.12,.138,.044]], [0,0,-.112],color,'bob-hair',48);
      if(style===2){const bun=sculpted(p,'hair-bun',[[-.045,.025,.022],[0,.064,.055],[.055,.068,.06],[.095,.038,.034],[.11,.004,.004]], [0,.035,-.173],color,'tied-hair',40);bun.rotation.x=-.3;}
      const highlight=new T.Color(color).lerp(new T.Color(0xc4a37e),.2).getHex();
      for(let i=0;i<5;i++){
        const x=-.105+i*.045,y=.16-Math.abs(x)*.2;
        fineCurve(p,'hair-strand:'+style+':'+i,[[x,y+.012,.131],[x*.82,.246,.065],[x*.4,.265,-.025],[x*.2,.228,-.107]],.002,highlight,'hair-strand');
      }
    }
    function sculptedHead(p,skin,hair,h){
      const profile=[[-.214,.027,.047,.032],[-.191,.073,.083,.025],[-.153,.114,.107,.011],[-.102,.139,.131,-.003],[-.045,.155,.146,-.009],[.017,.151,.139,-.009],[.065,.148,.144,-.008],[.12,.149,.139,-.014],[.168,.129,.119,-.02],[.206,.087,.08,-.025],[.228,.015,.025,-.026]];
      const gaussian=(x,y,cx,cy,wx,wy)=>Math.exp(-(((x-cx)/wx)**2+((y-cy)/wy)**2));
      const shape=(x,y,front)=>front*(.013*(gaussian(x,y,-.09,-.05,.05,.04)+gaussian(x,y,.09,-.05,.05,.04))-.012*(gaussian(x,y,-.059,.015,.037,.028)+gaussian(x,y,.059,.015,.037,.028))+.014*gaussian(x,y,0,-.155,.06,.045));
      const face=sculpted(p,'adult-face',profile,[0,0,0],mat(skin,.82),'sculpted-face',64,shape);
      const warm=new T.Color(skin).lerp(new T.Color(0xb56f5b),.22).getHex(),lips=new T.Color(skin).lerp(new T.Color(0x934e43),.36).getHex();
      for(const s of [-1,1]){
        const ear=sculpted(p,'ear',[[ -.055,.008,.016],[-.036,.026,.025],[.013,.028,.031],[.049,.015,.016]], [s*.155,-.013,-.005],skin,'ear',28);ear.rotation.z=s*-.14;
        ball(p,.009,.025,.015,s*.178,-.005,.013,warm,'ear-concha');
        const eye=new T.Group();eye.position.set(s*.059,.017,.12);eye.rotation.y=s*.26;p.add(eye);
        ball(eye,.035,.013,.012,0,0,.002,0xebe6dd,'eye-white');
        ball(eye,.010,.010,.0035,-s*.002,-.002,.013,0x536d68,'iris');
        ball(eye,.005,.006,.002,-s*.002,-.002,.016,0x273132,'pupil');
        ball(eye,.0025,.0025,.001,-.003,.002,.018,0xffffff,'eye-highlight');
        for(const upper of [true,false])fineCurve(eye,upper?'upper-lid':'lower-lid',[[-.033,0,.003],[-.018,upper?.014:-.01,.011],[.013,upper?.014:-.01,.011],[.034,0,.003]],upper?.0038:.0028,warm,'eyelid');
        fineCurve(p,'brow:'+s,[[s*.032,.065,.135],[s*.061,.071,.135],[s*.091,.059,.12]],.006,hair,'eyebrow');
      }
      sculpted(p,'nose-bridge',[[-.069,.022,.018,.161],[-.047,.024,.023,.174],[-.018,.018,.025,.163],[.024,.011,.016,.14],[.045,.004,.007,.134]], [0,0,0],skin,'nose-bridge',40);
      for(const s of [-1,1])ball(p,.013,.009,.017,s*.022,-.061,.161,skin,'nose-wing');
      for(const s of [-1,1])ball(p,.006,.003,.004,s*.016,-.069,.174,warm,'nostril');
      fineCurve(p,'upper-lip',[[-.035,-.105,.129],[-.013,-.101,.14],[0,-.105,.145],[.013,-.101,.14],[.035,-.105,.129]],.0035,lips,'upper-lip');
      fineCurve(p,'lower-lip',[[-.033,-.11,.129],[0,-.116,.14],[.033,-.11,.129]],.004,warm,'lower-lip');
      hairCap(p,(h>>>11)%3,hair);
      if((h>>>13)%3===0){
        for(const s of [-1,1]){fineCurve(p,'glasses:'+s,[[s*.023,.035,.156],[s*.036,.048,.159],[s*.085,.043,.147],[s*.096,.017,.14],[s*.084,-.001,.15],[s*.035,.002,.159],[s*.023,.035,.156]],.0042,0x454f51,'glasses');segment(p,[s*.095,.03,.14],[s*.152,.033,-.011],.0037,0x454f51,'glasses-arm');}
        fineCurve(p,'glasses-bridge',[[-.023,.03,.157],[0,.039,.171],[.023,.03,.157]],.0035,0x454f51,'glasses-bridge');
      }
      return face;
    }
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
      ambient.color.set(dark?0xaec5dc:0xfff5e5);ambient.groundColor.set(dark?0x242933:0x9a9b83);ambient.intensity=dark?.38:.85;
      sun.color.set(dark?0xadbdce:0xffe8c8);sun.intensity=dark?.95:3.6;
      fill.color.set(dark?0x87abca:0xd4e6ff);fill.intensity=dark?.38:.6;
      scene.environmentIntensity=dark?.16:.32;renderer.toneMappingExposure=dark?1.05:1.05;
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
      const front=mat(0x293945).clone();front.transparent=true;walls.push({m:front,r:{x:p.x,z:p.z},side:'front'});
      for(const x of [-1.59,1.59])box(cell,.13,2.4,.13,x,1.25,1.61,front,'cell-door-frame',true);
      box(cell,3.28,.15,.17,0,2.47,1.61,front,'cell-lintel',true);
      box(cell,.63,2.2,.07,-1.16,1.19,1.62,front,'cell-door');
      for(const xx of [-1.39,-1.19,-.99])box(cell,.027,.45,.09,xx,1.7,1.66,0x81909a,'cell-door-slit');
      box(cell,.12,.035,.13,-.84,1.15,1.69,0xb8b2a0,'cell-lock');
      box(cell,.51,.18,.09,0,2.17,-1.98,0x26313b,'cell-lamp');
      box(cell,.43,.035,.12,0,2.07,-1.93,glow(0xcbb98d),'cell-lamp-diffuser');
      for(let i=0;i<4;i++)box(cell,.31,.028,.025,1.08,1.9+i*.09,-1.985,0x263540,'cell-vent');
      const roleSign=sign(cell,()=>n.kind==='session'?ui('主 Agent'):'Subagent',.45,2.46,1.71,1.45,'#1a2935','#cbd6d9');roleSign.userData.closeupSign=true;
    }
    function employee(n,p,simple){
      const preference=personal.get(n.id);
      const h=hash(n.id),prison=mode==='prison',shirt=preference.shirt==='auto'?(prison?0xc88350:shirts[h%6]):parseInt(preference.shirt.slice(1),16),skin=skins[(h>>>4)%5],hair=hairs[(h>>>8)%5];
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
      const trouser=prison?0xb67548:0x454f5b;
      sculpted(body,'seated-hips',[[0,.2,.18],[.04,.235,.205],[.1,.225,.2],[.17,.198,.167]],[0,.64,-.43],trouser,'hips');
      for(const s of [-1,1]){
        tailoredLimb(body,'trouser-thigh',[s*.13,.75,-.37],[s*.19,.66,.04],[[0,.1,.112],[.25,.108,.115],[.75,.085,.086],[1,.075,.082]],trouser,'thigh');
        tailoredLimb(body,'trouser-calf',[s*.19,.66,.02],[s*.19,.18,.16],[[0,.081,.087],[.2,.081,.083],[.5,.067,.077],[.93,.055,.06],[1,.058,.063]],trouser,'shin');
        sculpted(body,'shoe',[[0,.082,.178,.045,3],[.025,.084,.182,.045,3],[.043,.074,.169,.05,3],[.088,.064,.126,.015,3],[.12,.049,.082,-.032,3]], [s*.19,.078,.19],mat(0x343e43,.47),'leather-shoe',32);
        sculpted(body,'shoe-sole',[[0,.085,.182,.045,3],[.017,.085,.182,.045,3]], [s*.19,.075,.19],0x242e32,'shoe-sole',32);
      }
      const seatedParts=new Set(body.children);
      const shirtMesh=sculpted(body,'tailored-shirt',[[.79,.196,.137,0,2.7],[.84,.213,.144,.007,2.7],[.96,.218,.153,.015,2.6],[1.1,.243,.159,.008,2.5],[1.21,.28,.157,-.005,2.5],[1.25,.269,.149,-.008,2.5],[1.31,.126,.107,0,2]], [0,0,-.42],uniform,'tailored-shirt',48,(x,y,front)=>front*Math.sin((y-.79)*42+Math.abs(x)*8)*.0035);
      shirtMesh.userData.ownedMaterial=true;
      sculpted(body,'neck',[[0,.061,.055],[.04,.058,.054],[.115,.067,.059]], [0,1.285,-.415],skin,'neck',32);
      const trim=new T.Color(shirt).lerp(new T.Color(0xf3eee0),.42).getHex();
      for(const s of [-1,1]){
        const collar=sculpted(body,'shirt-collar',[[0,.027,.008],[.065,.038,.01],[.102,.02,.007]], [s*.048,1.225,-.285],trim,'collar',16);collar.rotation.z=s*.36;collar.rotation.x=.17;
        fineCurve(body,'shoulder-seam:'+s,[[s*.11,1.303,-.415],[s*.204,1.274,-.378],[s*.276,1.23,-.4]],.0028,trim,'shirt-seam');
      }
      box(body,.019,.29,.009,0,1.071,-.244,trim,'shirt-placket');
      for(const y of [.95,1.065,1.182])ball(body,.006,.006,.004,0,y,-.233,0xdfded3,'shirt-button');
      if(!prison){fineCurve(body,'shirt-pocket',[[-.17,1.16,-.288],[-.17,1.07,-.276],[-.114,1.062,-.264],[-.096,1.148,-.259]],.0025,trim,'shirt-pocket');}
      const head=new T.Group();head.position.set(0,1.57,-.39);head.name='head';body.add(head);
      const face=sculptedHead(head,skin,hair,h);
      const arms=[],elbows=[],wrists=[];
      for(const s of [-1,1]){
        const arm=new T.Group();arm.position.set(s*.255,1.22,-.4);arm.name=s<0?'left-arm':'right-arm';body.add(arm);arms.push(arm);
        tailoredLimb(arm,'shirt-sleeve:'+s,[0,.025,0],[s*.045,-.235,.11],[[0,.087,.098],[.18,.092,.097],[.52,.076,.08],[.93,.058,.06],[1,.058,.06]],uniform,'shirt-sleeve');
        const elbow=new T.Group();elbow.position.set(s*.045,-.25,.12);elbow.name='elbow-joint';arm.add(elbow);elbows.push(elbow);
        tailoredLimb(elbow,'forearm:'+s,[0,0,0],[-s*.135,.05,.48],[[0,.05,.051],[.25,.056,.054],[.7,.035,.038],[1,.028,.03]],skin,'forearm');
        tailoredLimb(elbow,'rolled-cuff:'+s,[0,0,0],[-s*.009,.003,.037],[[0,.059,.061],[.2,.062,.064],[.8,.062,.064],[1,.059,.061]],trim,'rolled-cuff');
        const wrist=new T.Group();wrist.position.set(-s*.135,.05,.51);wrist.name='wrist-joint';elbow.add(wrist);wrists.push(wrist);
        const hand=sculpted(wrist,'palm',[[0,.027,.022],[.032,.047,.024],[.075,.043,.02],[.095,.036,.016]], [0,0,-.025],skin,'palm',28);hand.rotation.x=Math.PI/2;
        for(let i=0;i<4;i++){const x=(i-1.5)*.023,end=.117-Math.abs(i-1.5)*.013;tailoredLimb(wrist,'finger:'+i,[x,-.008,.059],[x,-.021,end],[[0,.009,.009],[.4,.01,.009],[.7,.008,.008],[1,.004,.005]],skin,'finger');}
        tailoredLimb(wrist,'thumb:'+s,[s*.039,-.001,.018],[s*.057,-.016,.055],[[0,.011,.011],[.55,.012,.01],[1,.007,.007]],skin,'thumb');
      }
      // Bend the upper body around a seated spine, rather than rotating a rigid whole person.
      const upper=new T.Group();upper.name='seated-spine';upper.position.set(0,.82,-.42);
      for(const part of [...body.children])if(!seatedParts.has(part)){part.position.sub(upper.position);upper.add(part);}body.add(upper);
      cylinder(g,.035,.28,0,1.1,.85,0x717b78,'monitor-stand');box(g,.4,.027,.23,0,.965,.85,0x7a8380,'monitor-base');
      const monitor=new T.Group();monitor.position.set(0,1.32,.85);monitor.rotation.x=-.1;g.add(monitor);box(monitor,1.06,.62,.045,0,0,0,0x343f42,'monitor',true);
      const screenMat=new T.MeshStandardMaterial({map:texture('AGENT / WORKSPACE','#21363b','#80d3aa'),emissive:0x194d40,emissiveIntensity:.1,roughness:.5});
      const screen=box(monitor,.98,.53,.01,0,0,-.028,screenMat,'screen');screen.userData.ownedMaterial=true;box(monitor,.15,.06,.009,0,0,.027,0xa8b6b4,'back-logo');
      box(g,.7,.027,.24,0,.998,.19,0x6f7a77,'keyboard');const keys=[];if(!simple)for(let i=0;i<8;i++)keys.push(box(g,.055,.006,.13,-.28+i*.08,1.015,.19,0xb7c4bf,'key'));
      ball(g,.056,.022,.088,.51,1.004,.24,0x56635f,'mouse');
      if(!simple){cylinder(g,.09,.16,-.81,1.06,.53,0xe4e0d4,'mug');mesh(g,'ring',[.05,.05,.05],[-.7,1.075,.53],0xe4e0d4,'mug-handle').rotation.y=Math.PI/2;cylinder(g,.07,.009,-.81,1.145,.53,0x574f40,'mug-coffee');box(g,.33,.025,.29,.77,.996,.65,0xe5dfcd,'notebook');cylinder(g,.12,.025,-.91,.997,.97,0x697a72,'lamp-base');segment(g,[-.91,1.01,.97],[-.91,1.55,.97],.015,0x63756d,'lamp-stem');mesh(g,'cone',[.13,.12,.13],[-.88,1.55,.92],0xb9c2b6,'lampshade').rotation.x=-.5;}
      if(preference.desk!=='default'){
        const remove=preference.desk==='notebook'?['mug','mug-handle','mug-coffee']:preference.desk==='coffee'?['notebook']:['mug','mug-handle','mug-coffee'];
        for(const child of [...g.children])if(remove.includes(child.name))g.remove(child);
        if(preference.desk==='plant'){
          cylinder(g,.095,.13,-.80,1.045,.52,0xc38e69,'custom-plant-pot');
          for(let i=0;i<5;i++){const angle=i*Math.PI*2/5;const leaf=ball(g,.06,.12,.035,-.80+Math.cos(angle)*.06,1.18,.52+Math.sin(angle)*.06,0x547b51,'custom-plant-leaf');leaf.rotation.z=Math.cos(angle)*.5;}
        }else if(preference.desk==='notebook'&&simple)box(g,.33,.025,.29,.77,.996,.65,0xe5dfcd,'notebook');
        else if(preference.desk==='coffee'&&simple)cylinder(g,.09,.16,-.81,1.06,.53,0xe4e0d4,'mug');
      }
      if(preference.nickname){const badge=sign(g,()=>personal.name(n),.58,1.06,.75,.38,'#e6dfcc','#3d5950');badge.scale.y=.16;badge.name='custom-desk-name';}
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
      const aura=ball(fx,.43,.73,.32,0,1.05,-.36,auraMat,'working-aura');aura.userData.ownedMaterial=true;
      const energyMat=new T.MeshBasicMaterial({color:0x29a47b,transparent:true,opacity:.45,depthWrite:false});
      const workRing=mesh(fx,'ring',[1.16,1.16,1.16],[0,.13,-.03],energyMat,'working-ring');workRing.rotation.x=-Math.PI/2;workRing.userData.ownedMaterial=true;
      const signal=new T.Group();signal.position.set(0,2.03,-.4);signal.name='working-beacon';fx.add(signal);
      const orbit=mesh(signal,'ring',[.22,.22,.22],[0,0,0],energyMat,'beacon-orbit');orbit.rotation.x=Math.PI/2;
      const sparks=[];for(let i=0;i<3;i++)sparks.push(ball(signal,.052,.052,.052,0,0,0,energyMat,'working-spark'));
      const microDetails=[],microNames=new Set(['hair-strand','eye-highlight','nostril','upper-lip','lower-lip','shirt-seam','shirt-pocket','shirt-button','finger','thumb']);
      g.traverse(o=>{if(microNames.has(o.name))microDetails.push(o);});
      // Identity alone chooses the coworker: status, role and refresh order never change it.
      const species=preference.species==='auto'?coworkerSpecies[h%coworkerSpecies.length]:preference.species;
      const a={id:n.id,node:n,group:g,body,head,upper,uniform,face,shirtMesh,microDetails,detailVisible:true,arms,elbows,wrists,keys,ring,halo,port,lamp,screenMat,fx,auraMat,energyMat,workRing,signal,sparks,p,appearance:{shirt,skin,hair,species,desk:preference.desk,nickname:preference.nickname},label:null,motion:'none',action:'none',activityLive:false};actors.set(n.id,a);installCharacter(a);return a;
    }
    function installCharacter(a){
      const species=prototypes[a.appearance.species]?a.appearance.species:prototypes.human?'human':null;
      if(!species||a.avatar?.species===species)return;
      const model=T.cloneSkeleton(prototypes[species]),materials=new Map(),parts=[],bones={};let sharedSkeleton;
      const h=hash(a.id),style=(h>>>13)%3,glasses=(h>>>8)%3===0;
      model.name='blender-employee';
      model.traverse(o=>{
        if(o.isBone)bones[o.name]=o;
        if(/_LOD[01]$/.test(o.name)){
          const hair=o.name.match(/Hair(\d)/),eligible=(!hair||Number(hair[1])===style)&&(!o.name.includes('Glasses')||glasses);
          parts.push({object:o,lod:o.name.endsWith('LOD0')?0:1,eligible});
          o.visible=eligible&&o.name.endsWith('LOD0');
        }
        if(!o.isMesh)return;
        // GLB primitives and both LODs use one rig. SkeletonUtils clones the
        // skeleton per mesh; reunify compatible clones to update it only once.
        if(o.isSkinnedMesh){if(!sharedSkeleton)sharedSkeleton=o.skeleton;else if(o.skeleton.bones.every((b,i)=>b===sharedSkeleton.bones[i]))o.skeleton=sharedSkeleton;}
        o.castShadow=true;o.receiveShadow=true;
        const tint=original=>{
          if(materials.has(original))return materials.get(original);
          const m=original.clone(),name=original.name;
          if(species==='human'&&name==='MAT_Skin')m.color.set(a.appearance.skin);
          if(name==='MAT_Shirt'){m.color.set(a.appearance.shirt);m.emissive.set(0x329a64);m.emissiveIntensity=0;a.uniform=m;}
          if(name==='MAT_ShirtTrim')m.color.set(a.appearance.shirt).lerp(new T.Color(0xd6d4c7),.18);
          if(name==='MAT_Trousers')m.color.set(mode==='prison'?0x966342:0x344352);
          if(species==='human'&&name==='MAT_Hair')m.color.set(a.appearance.hair);
          if(m.map)m.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
          materials.set(original,m);return m;
        };
        o.material=Array.isArray(o.material)?o.material.map(tint):tint(o.material);
        if(o.name==='SM_Employee_Skin_LOD0')a.face=o;
        if(o.name==='SM_Employee_Shirt_LOD0')a.shirtMesh=o;
      });
      // Dispose only the fallback's owned materials; shared contour geometries
      // remain cached for a later loading failure, never per-employee duplicates.
      if(a.avatar)for(const m of a.avatar.materials.values())m.dispose();
      clear(a.body);a.body.add(model);
      a.avatar={model,materials,parts,bones,lod:0,species};a.microDetails=[];
      a.head=bones.rig_head;a.upper=bones.rig_spine;
      a.arms=['L','R'].map(s=>bones['rig_arm_'+s]);a.elbows=['L','R'].map(s=>bones['rig_elbow_'+s]);a.wrists=['L','R'].map(s=>bones['rig_wrist_'+s]);
      a.signal.position.y=species==='human'?2.03:2.30;
      renderer.shadowMap.needsUpdate=true;
    }
    for(const species of coworkerSpecies)window.CodexOfficeAssets.load(species).then(value=>{
      if(disposed)return;prototypes[species]=value;assetStates[species]='ready';assetState=assetStates.human;
      for(const a of actors.values())installCharacter(a);invalidate();
    }).catch(error=>{
      if(disposed)return;assetStates[species]='fallback';assetState=assetStates.human;
      host.dataset.assetError=species+': '+error.message;invalidate();
    });
    function plan(nodes){
      const groups=new Map();for(const n of nodes){if(!groups.has(n.project_id))groups.set(n.project_id,[]);groups.get(n.project_id).push(n);}const result=[];
      for(const [id,list] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){
        const byId=new Map(list.map(n=>[n.id,n])),mains=list.filter(n=>n.kind==='session').sort((a,b)=>a.created_at-b.created_at||a.id.localeCompare(b.id));
        const owner=n=>{let x=n;const seen=new Set();while(x&&x.kind!=='session'&&!seen.has(x.id)){seen.add(x.id);x=byId.get(x.parent_agent_id);}return x?.kind==='session'?x.id:null;};
        const pods=mains.map(main=>({main,workers:list.filter(n=>n.kind==='subagent'&&owner(n)===main.id)}));
        for(const n of list)if(n.kind==='subagent'&&!owner(n))pods.push({main:n,workers:[]});
        const cols=Math.min(3,Math.max(1,Math.ceil(Math.sqrt(pods.length)))),teams=[],placements=new Map();let rowZ=0,maxW=0;
        for(let i=0;i<pods.length;i+=cols){let x=0,rowD=0;for(const p of pods.slice(i,i+cols)){
          const dark=mode==='prison',pitch=dark?3.7:2.9,rowPitch=dark?4.25:3.4;
          // Large teams form a compact pod rather than a three-seat-wide corridor.
          const wc=p.workers.length<3?2:Math.min(6,Math.max(3,Math.ceil(Math.sqrt(p.workers.length*rowPitch/pitch))));
          const width=dark?(p.workers.length?wc*pitch+.6:4.6):Math.max(6.1,wc*pitch+.4),depth=(dark?4.1:3.25)+Math.ceil(p.workers.length/wc)*rowPitch,t={...p,width,depth,x:x+width/2,z:rowZ+depth/2};teams.push(t);rowD=Math.max(rowD,depth);
          placements.set(p.main.id,{x:t.x,z:rowZ+(dark?2.3:1.45),team:p.main.id});
          p.workers.forEach((n,j)=>placements.set(n.id,{x:t.x+(j%wc-(wc-1)/2)*pitch,z:rowZ+(dark?6.55:4.8)+Math.floor(j/wc)*rowPitch,team:p.main.id}));x+=width+.65;
        }maxW=Math.max(maxW,x-.65);rowZ+=rowD+.8;}
        for(const p of placements.values()){p.x-=maxW/2;p.z-=rowZ/2+1.1;}for(const t of teams){t.x-=maxW/2;t.z-=rowZ/2+1.1;}
        // Reserve a proper leisure strip even for a one-person project; props must not collide with desks or each other.
        result.push({id,name:list[0].project,width:Math.max(mode==='prison'?8:12,maxW+(mode==='prison'?2.7:3.7)),depth:Math.max(mode==='prison'?8:11.8,rowZ+(mode==='prison'?4.9:6.8)),teams,placements,nodes:list,x:0,z:0});
      }
      // Evaluate stable shelf layouts; similarly sized rooms share a row. Do not
      // sort by activity: a status refresh must not move someone's workplace.
      const ordered=[...result].sort((a,b)=>b.depth-a.depth||b.width-a.width||a.id.localeCompare(b.id));
      let best=null;
      for(let cols=1;cols<=Math.max(1,Math.ceil(Math.sqrt(result.length))+1);cols++){
        let z=0,width=0;const placed=[];
        for(let i=0;i<ordered.length;i+=cols){const row=ordered.slice(i,i+cols),depth=Math.max(...row.map(r=>r.depth));let x=0;for(const r of row){placed.push({r,x:x+r.width/2,z:z+r.depth/2});x+=r.width+2.4;}width=Math.max(width,x-2.4);z+=depth+2.4;}
        const depth=Math.max(1,z-2.4),score=width*depth+.25*(width-depth)**2;
        if(!best||score<best.score)best={score,placed};
      }
      for(const {r,x,z}of best.placed){r.x=x;r.z=z;}return result;
    }
    function clear(group){const skeletons=new Set();group.traverse(o=>{if(o.isSkinnedMesh)skeletons.add(o.skeleton);if(o.isLight)o.dispose();if(o.userData.ownedGeometry)o.geometry.dispose();if(o.userData.ownedMaterial){o.material.map?.dispose();o.material.dispose();}});for(const s of skeletons)s.dispose();group.clear();}
    function clearOverview(){for(const part of overviewParts){part.mesh.dispose();part.mesh.material.dispose();}overviewPeople.clear();overviewParts=[];overviewActors=[];}
    function clearArchitectureBatches(){for(const mesh of architectureBatches)mesh.dispose();architectureBatches=[];}
    function batchArchitecture(){
      if(actors.size<48)return;architecture.updateMatrixWorld(true);const batches=new Map();
      architecture.traverse(o=>{
        if(!o.isMesh||o.isSkinnedMesh||Array.isArray(o.material)||o.material.transparent||o.userData.ownedMaterial||o.userData.localize)return;
        const key=[o.geometry.id,o.material.id,o.castShadow,o.receiveShadow,o.renderOrder].join(':');
        if(!batches.has(key))batches.set(key,[]);batches.get(key).push(o);
      });
      for(const objects of batches.values()){
        if(objects.length<4)continue;const first=objects[0],batch=new T.InstancedMesh(first.geometry,first.material,objects.length);
        batch.name='architecture-batch';batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;batch.renderOrder=first.renderOrder;
        objects.forEach((o,i)=>{batch.setMatrixAt(i,o.matrixWorld);o.removeFromParent();});batch.computeBoundingSphere();architecture.add(batch);architectureBatches.push(batch);
      }
    }
    function buildOverview(){
      clearOverview();overviewActors=[...actors.values()];if(actors.size<=overviewPolicy.enterCount)return;
      // One instance per real employee, with shared low-poly furniture and silhouettes.
      // Detailed groups leave the scene graph in wide views, avoiding bone/matrix work too.
      const specs=[
        ['desk',[2.18,.1,1.08],[0,.93,.58],()=>mode==='prison'?0x77838a:0xd4b78c],
        ['leg-left',[.08,.87,.08],[-.9,.46,.58],()=>0x8c9994],
        ['leg-right',[.08,.87,.08],[.9,.46,.58],()=>0x8c9994],
        ['chair',[.65,.15,.64],[0,.61,-.46],()=>0x4e625e],
        ['chair-back',[.65,.5,.12],[0,.92,-.76],()=>0x4e625e],
        ['body',[.44,.6,.32],[0,1.04,-.4],a=>a.appearance.shirt],
        ['head',[.36,.43,.34],[0,1.58,-.39],a=>a.appearance.species==='cow'?0xe8ddc8:a.appearance.species==='horse'?0x9b653e:a.appearance.skin],
        ['snout',[.28,.21,.2],[0,1.51,-.61],a=>a.appearance.species==='cow'?0xd5a999:0x795133,a=>a.appearance.species!=='human'],
        ['ear-left',[.15,.2,.09],[-.23,1.81,-.38],a=>a.appearance.species==='cow'?0xe8ddc8:0x9b653e,a=>a.appearance.species!=='human'],
        ['ear-right',[.15,.2,.09],[.23,1.81,-.38],a=>a.appearance.species==='cow'?0xe8ddc8:0x9b653e,a=>a.appearance.species!=='human'],
        ['monitor',[1.06,.62,.045],[0,1.32,.85],()=>0x343f42],
        ['screen',[.98,.53,.012],[0,1.32,.82],()=>0x508773],
        ['status',[.14,.09,.14],[.82,1.04,.84],a=>statusColors[a.node.status]||statusColors.unknown],
      ];
      if(mode==='prison')specs.push(['cell-floor',[3.2,.055,3.7],[0,.078,-.25],()=>0x53616d],['cell-bed',[2.35,.4,.57],[-.05,.3,-1.58],()=>0x7c8789],['cell-post-left',[.13,2.4,.13],[-1.59,1.25,1.61],()=>0x293945],['cell-post-right',[.13,2.4,.13],[1.59,1.25,1.61],()=>0x293945],['cell-lintel',[3.28,.15,.17],[0,2.47,1.61],()=>0x293945]);
      for(const [name,size,offset,color,eligible=()=>true] of specs){
        const material=new T.MeshStandardMaterial({color:0xffffff,roughness:.8}),instanced=new T.InstancedMesh(geo('box'),material,actors.size);
        instanced.name='overview-'+name;instanced.frustumCulled=false;instanced.userData.overview=true;instanced.receiveShadow=true;overviewPeople.add(instanced);
        overviewParts.push({mesh:instanced,size,offset,color,eligible});
      }
    }
    function inspectedId(){return document.activeElement?.closest('.agent-3d-person')?.dataset.nodeId||hovered||selected;}
    function scaleLevel(){return Math.round(fitDistance/Math.max(1,controls.getDistance())*100);}
    function employeeScreenHeight(a){
      // Project the seated character's stable bounds in CSS pixels. Depth keeps
      // top-down views readable too; framing a project never changes this metric.
      const species=a.avatar?.species||'human',top=species==='human'?1.85:2.4;let low=Infinity,high=-Infinity;
      for(const x of [-.5,.5])for(const y of [.08,top])for(const z of [-.85,.4]){
        projectedCorner.copy(a.group.position);projectedCorner.x+=x;projectedCorner.y+=y;projectedCorner.z+=z;projectedCorner.project(camera);
        low=Math.min(low,projectedCorner.y);high=Math.max(high,projectedCorner.y);
      }
      return (high-low)*host.clientHeight*.5;
    }
    function updateVisibility(){
      viewMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(viewMatrix);
      const inspected=inspectedId();overviewCount=0;culledCount=0;inViewCount=0;
      for(const a of actors.values()){
        actorSphere.center.copy(a.group.position).add(v(0,1,0));actorSphere.radius=mode==='prison'?3:2;
        a.inView=frustum.intersectsSphere(actorSphere);
        a.screenHeight=a.inView?employeeScreenHeight(a):0;if(a.inView)inViewCount++;
      }
      if(inViewCount>overviewPolicy.enterCount)crowdedView=true;else if(inViewCount<=overviewPolicy.exitCount)crowdedView=false;
      for(const a of actors.values()){
        const center=a.group.position.clone().add(v(0,1.57,-.39)),top=projection(center.clone().add(v(0,.24,0))),bottom=projection(center.clone().add(v(0,-.21,0)));
        const pixels=Math.hypot(top.x-bottom.x,top.y-bottom.y);
        if(!crowdedView||!overviewParts.length)a.small=false;
        else if(a.inView){if(a.screenHeight<overviewPolicy.simplifyBelow)a.small=true;else if(a.screenHeight>overviewPolicy.detailAbove)a.small=false;}
        a.overview=Boolean(a.small&&a.id!==inspected);
        const detail=a.inView&&!a.overview;
        if(detail&&!a.group.parent){people.add(a.group);renderer.shadowMap.needsUpdate=true;}
        else if(!detail&&a.group.parent){people.remove(a.group);renderer.shadowMap.needsUpdate=true;}
        a.group.visible=detail;
        if(!a.inView)culledCount++;else if(a.overview)overviewCount++;
        if(!detail){a.label.hidden=true;if(a.motion!=='none')pose(a,0,false);continue;}
        const show=pixels>=(a.detailVisible?21:27);
        if(show!==a.detailVisible){a.detailVisible=show;for(const part of a.microDetails)part.visible=show;}
        if(a.avatar){const lod=show?0:1;if(lod!==a.avatar.lod){a.avatar.lod=lod;for(const part of a.avatar.parts)part.object.visible=part.eligible&&part.lod===lod;renderer.shadowMap.needsUpdate=true;}}
      }
      for(const part of overviewParts){
        let index=0;for(const a of overviewActors){
          if(!a.inView||!a.overview||!part.eligible(a))continue;
          instanceTransform.position.copy(a.group.position).add(v(...part.offset));instanceTransform.scale.set(...part.size);instanceTransform.updateMatrix();
          part.mesh.setMatrixAt(index,instanceTransform.matrix);part.mesh.setColorAt(index,instanceColor.set(part.color(a)));index++;
        }
        part.mesh.count=index;part.mesh.instanceMatrix.needsUpdate=true;if(part.mesh.instanceColor)part.mesh.instanceColor.needsUpdate=true;
        // Raycasting uses the same packed instance ordering as the matrices.
        part.mesh.userData.actorIds=overviewActors.filter(a=>a.inView&&a.overview&&part.eligible(a)).map(a=>a.id);
        part.mesh.computeBoundingSphere();
      }
      host.dataset.overview=overviewCount>0?'true':'false';
      updateEdgeVisibility();
    }
    function updateEdgeVisibility(){
      const inspected=inspectedId();
      for(const e of edgeObjects){const edge=e.group.userData.edge,a=actors.get(edge.source),b=actors.get(edge.target);
        const visibleEndpoints=a?.inView&&b?.inView,inspectedIncoming=e.highlighted&&edge.target===inspected&&b?.inView;
        e.group.visible=e.allowed&&Boolean(visibleEndpoints||inspectedIncoming)&&(!(a?.overview||b?.overview)||e.highlighted);
      }
    }
    function rebuild(nodes){
      host.dataset.ready='loading';
      teamProjects.clear();for(const n of nodes)teamProjects.set(n.id,n.project_id);
      for(const a of actors.values())if(a.avatar)for(const m of a.avatar.materials.values())m.dispose();
      for(const a of actors.values())people.add(a.group);
      clearOverview();clearArchitectureBatches();clear(architecture);clear(people);clear(links);for(const w of walls)w.m.dispose();walls=[];actors.clear();labels.replaceChildren();projectLabels=[];localLightCount=0;hovered='';crowdedView=false;rooms=plan(nodes);setMood();
      for(const r of rooms){roomGeometry(r);for(const n of r.nodes){
        const local=r.placements.get(n.id);if(!local)continue;const a=employee(n,{...local,x:r.x+local.x,z:r.z+local.z},nodes.length>50);
        const el=document.createElement('article');el.className='agent-node agent-3d-person '+n.kind;el.dataset.nodeId=n.id;const button=document.createElement('button');button.className='agent-node-select';button.dataset.selectAgent=n.id;el.append(button);labels.append(el);a.label=el;
      }const el=document.createElement('button');el.type='button';el.className='agent-project-region agent-3d-project';el.dataset.canvasProject=r.id;el.setAttribute('aria-label',ui('定位办公区：')+r.name);el.title=r.name;el.innerHTML='<span class="agent-project-caption">'+ui('项目办公区')+'</span><strong>'+esc(r.name)+'</strong><small>'+r.nodes.filter(n=>n.kind==='session').length+ui(' 主 Agent / ')+r.nodes.filter(n=>n.kind==='subagent').length+' Subagents</small>';el.addEventListener('click',()=>focusProject(r.id));labels.append(el);projectLabels.push({el,room:r,point:v(r.x,.2,r.z+r.depth/2+.7)});}
      buildOverview();
      batchArchitecture();
      bounds.makeEmpty();for(const r of rooms){bounds.expandByPoint(v(r.x-r.width/2-1.5,-.3,r.z-r.depth/2));bounds.expandByPoint(v(r.x+r.width/2,3.4,r.z+r.depth/2));}if(bounds.isEmpty())bounds.set(v(-4,0,-4),v(4,3,4));
      const center=bounds.getCenter(v()),size=bounds.getSize(v()),extent=Math.max(size.x,size.z,12);sun.target.position.copy(center);sun.position.copy(center).add(v(-extent*.6,extent*1.2,extent*.8));
      Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,far:extent*5});sun.shadow.camera.updateProjectionMatrix();renderer.shadowMap.needsUpdate=true;
      host.dataset.employeeCount=String(actors.size);host.dataset.projectCount=String(rooms.length);host.dataset.mode=mode;
    }
    function edges(data){
      clear(links);edgeObjects=[];
      const sorted=[...data.edges].sort((a,b)=>(a.source+':'+a.kind+':'+a.target).localeCompare(b.source+':'+b.kind+':'+b.target));
      const fans=new Map();for(const e of sorted){const key=e.source+':'+e.kind;if(!fans.has(key))fans.set(key,[]);fans.get(key).push(e.target);}
      for(const e of sorted){
        const a=actors.get(e.source),b=actors.get(e.target);if(!a||!b)continue;
        const state=e.kind==='collaboration'?'recorded':data.states.get(e.target)||'unknown';
        const color=e.kind==='delegation'?0xd4a064:e.kind==='subagent'?0x63b5ca:0xad95c3;
        const p=a.group.position.clone().add(v(.82,1.12,.84)),q=b.group.position.clone().add(v(.82,1.12,.84));
        const fan=fans.get(e.source+':'+e.kind),lane=fan.indexOf(e.target)-(fan.length-1)/2;
        const apex=(e.kind==='delegation'?(mode==='prison'?3.05:2.6):e.kind==='subagent'?(mode==='prison'?2.9:1.86):3.15)+Math.min(3,Math.abs(lane))*.085;
        const direction=q.clone().sub(p);direction.y=0;direction.normalize();const side=v(-direction.z,0,direction.x);
        // A stable fan-out and two tangential handles avoid sharp knots and
        // overlapping parallel tubes. Native and cross-chat routes retain their meaning.
        const bend=(e.kind==='subagent'?.22:.34)+lane*.2;
        const first=p.clone().lerp(q,.26).addScaledVector(side,bend),last=p.clone().lerp(q,.74).addScaledVector(side,bend);first.y=apex;last.y=apex;
        const curve=new T.CubicBezierCurve3(p,first,last,q),length=curve.getLength(),group=new T.Group();group.name=e.kind+':'+e.source+'→'+e.target;group.userData.edge=e;group.userData.nonInteractive=true;
        const radius=e.kind==='delegation'?.019:.014;
        const tubeMat=new T.MeshBasicMaterial({color,transparent:true,opacity:e.kind==='collaboration'?.42:mode==='prison'?.8:.64,depthWrite:false});
        const geometry=new T.TubeGeometry(curve,64,radius,8,false);
        const tube=new T.Mesh(geometry,tubeMat);tube.name='relationship-ribbon';tube.userData.ownedGeometry=true;tube.userData.ownedMaterial=true;group.add(tube);
        // A restrained highlight sheath, not a permanently glowing cable.
        const sheenMat=new T.MeshBasicMaterial({color,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending});
        const sheen=new T.Mesh(new T.TubeGeometry(curve,64,radius*2.25,8,false),sheenMat);sheen.name='relationship-sheen';sheen.visible=false;sheen.userData.ownedGeometry=true;sheen.userData.ownedMaterial=true;group.add(sheen);
        const arrow=mesh(group,'cone',[.035,.105,.035],curve.getPointAt(.9).toArray(),glow(color),'relationship-arrow');
        arrow.quaternion.setFromUnitVectors(v(0,1,0),curve.getTangentAt(.9).normalize());
        const pulse=new T.Group();pulse.name='activity-flow';pulse.visible=false;group.add(pulse);
        const flowMat=new T.MeshBasicMaterial({color:0x94edce,transparent:true,opacity:.9,depthWrite:false,blending:T.AdditiveBlending});
        const point=ball(pulse,.023,.023,.023,0,0,0,flowMat,'flow-head');point.userData.ownedMaterial=true;
        const trail=[];for(let i=0;i<3;i++){const m=new T.MeshBasicMaterial({color:0x63caaa,transparent:true,opacity:.48-i*.12,depthWrite:false,blending:T.AdditiveBlending});const dot=ball(pulse,.013-i*.002,.013-i*.002,.013-i*.002,0,0,0,m,'flow-tail');dot.userData.ownedMaterial=true;trail.push(dot);}
        links.add(group);
        edgeObjects.push({group,tubeMat,sheen,sheenMat,pulse,point,trail,curve,length,state,kind:e.kind,color,radius,apex,lane,highlighted:false});
      }
    }
    function emphasize(){
      const id=document.activeElement?.closest('.agent-3d-person')?.dataset.nodeId||hovered||selected,chain=new Set(id?[id]:[]);
      if(id){
        const down=[id],up=[id],seenDown=new Set(),seenUp=new Set();
        while(down.length){const current=down.pop();if(seenDown.has(current))continue;seenDown.add(current);for(const e of edgeObjects)if(e.kind!=='collaboration'&&e.group.userData.edge.source===current){chain.add(e.group.userData.edge.target);down.push(e.group.userData.edge.target);}}
        while(up.length){const current=up.pop();if(seenUp.has(current))continue;seenUp.add(current);for(const e of edgeObjects)if(e.kind!=='collaboration'&&e.group.userData.edge.target===current){chain.add(e.group.userData.edge.source);up.push(e.group.userData.edge.source);}}
      }
      for(const e of edgeObjects){
        const edge=e.group.userData.edge;e.highlighted=Boolean(id&&chain.has(edge.source)&&chain.has(edge.target));
        e.allowed=linkMode==='all'||linkMode==='inspect'&&e.highlighted||linkMode==='active'&&['working','waiting_agents','waiting_user'].includes(e.state);
        e.tubeMat.opacity=id?(e.highlighted?1:.13):(e.kind==='collaboration'?.42:mode==='prison'?.8:.64);
        e.sheen.visible=e.highlighted;e.sheenMat.opacity=e.highlighted?.15:0;
        e.group.children.find(x=>x.name==='relationship-arrow').visible=!id||e.highlighted;
      }
      updateEdgeVisibility();
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
      const positions=[...actors.values()].filter(a=>a.group.visible).map(a=>({a,p:projection(a.group.position.clone().add(v(0,mode==='prison'?2.75:a.avatar&&a.avatar.species!=='human'?2.48:2.16,-.4)))}));
      const focusedId=document.activeElement?.closest('.agent-3d-person')?.dataset.nodeId;
      const controlStrip=viewport.querySelector('.agent-controls'),captionTop=(controlStrip?.offsetTop||12)+(controlStrip?.offsetHeight||44)+10;
      const width=Math.min(host.clientWidth<600?190:224,host.clientWidth-24),height=108,fullRects=[],occupied=[],heads=positions.map(({a})=>({id:a.id,...projection(a.head.getWorldPosition(v()))})),priority=a=>a.id===hovered||a.id===focusedId?0:a.id===selected?1:a.node.kind==='session'?2:3;
      const h=host.getBoundingClientRect(),overlaps=(a,b,gap=6)=>a.left<b.right+gap&&a.right>b.left-gap&&a.top<b.bottom+gap&&a.bottom>b.top-gap;
      const hud=[...viewport.querySelectorAll('.agent-controls,.agent-zoom,.agent-roster>summary,.agent-roster[open]>.agent-roster-panel,.agent-display-controls>summary,.agent-display-controls[open]>.agent-display-panel,.agent-canvas-footer,.agent-3d-heading,#agent-detail:not([hidden])')].filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return{left:r.left-h.left,right:r.right-h.left,top:r.top-h.top,bottom:r.bottom-h.top};});
      const clamped=(x,y)=>{x=Math.max(width/2+8,Math.min(x,host.clientWidth-width/2-8));y=Math.max(captionTop+height,Math.min(y,host.clientHeight-66));return{left:x-width/2,right:x+width/2,top:y-height,bottom:y,x,y};};
      const maxFull=labelMode==='quiet'?0:labelMode==='detailed'?4:controls.getDistance()>35?1:3;
      const leaders=[];
      // A macro canvas cannot fit every sentence. Colliding captions become compact status bubbles, never fake agents.
      for(const {a,p} of positions.sort((x,y)=>priority(x.a)-priority(y.a)||x.a.id.localeCompare(y.a.id))){
        const inspected=a.id===hovered||a.id===focusedId||a.id===selected,isWorking=a.node.status==='working';
        const wantsFull=inspected||isWorking&&p.shown&&fullRects.length<maxFull;
        const candidates=(wantsFull?[[0,0],[-width*.65,0],[width*.65,0],[0,-height-12],[-width,0],[width,0],[0,height+18]]:[[0,0]]).map(([x,y])=>clamped(p.x+x,p.y+y));
        const clear=r=>!hud.some(b=>overlaps(r,b))&&!fullRects.some(b=>overlaps(r,b))&&(inspected||!heads.some(h=>h.id!==a.id&&h.shown&&h.x>r.left-10&&h.x<r.right+10&&h.y>r.top-10&&h.y<r.bottom+10));
        const place=wantsFull?candidates.find(clear):null,rect=place||candidates[0];
        const full=inspected||isWorking&&p.shown&&Boolean(place)&&fullRects.length<maxFull;
        a.label.dataset.bubbleSize=full?'full':'compact';
        if(full&&p.shown)fullRects.push(rect);
        const x=full?rect.x:Math.max(10,Math.min(p.x,host.clientWidth-10)),y=full?rect.y:Math.max(captionTop+16,Math.min(p.y,host.clientHeight-66));
        const compact={left:x-54,right:x+54,top:y-24,bottom:y};
        const collision=occupied.some(r=>overlaps(compact,r))||hud.some(r=>overlaps(compact,r))||p.x<82||p.x>host.clientWidth-82||p.y<captionTop+26||p.y>host.clientHeight-72;
        a.label.dataset.density=!inspected&&!full&&(collision||labelMode==='quiet')?'dot':'label';
        a.label.dataset.labelMode=labelMode;
        if(p.shown&&a.label.dataset.bubble!=='none')occupied.push(full?rect:a.label.dataset.density==='dot'?{left:x-7,right:x+7,top:y-14,bottom:y}:compact);
        a.label.style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px)';a.label.hidden=!p.shown;
        if(full&&p.shown&&Math.hypot(x-p.x,y-p.y)>24){const startY=p.y<rect.top?rect.top:y;leaders.push('<line x1="'+x.toFixed(1)+'" y1="'+startY.toFixed(1)+'" x2="'+p.x.toFixed(1)+'" y2="'+p.y.toFixed(1)+'"/><circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="2"/>');}
      }
      const leaderSvg=$('agent-label-leaders'),markup=leaders.join('');if(leaderMarkup!==markup){leaderMarkup=markup;leaderSvg.innerHTML=markup;}
      const projectRects=[];
      for(const {el,point} of projectLabels){const p=projection(point),w=el.offsetWidth||Math.min(240,host.clientWidth-24),height=el.offsetHeight||66,x=Math.max(w/2+8,Math.min(p.x,host.clientWidth-w/2-8)),r={left:x-w/2,right:x+w/2,top:p.y-height,bottom:p.y};el.style.transform='translate('+x.toFixed(1)+'px,'+p.y.toFixed(1)+'px)';el.hidden=!p.shown||r.top<captionTop||hud.some(b=>overlaps(r,b))||fullRects.some(b=>overlaps(r,b))||projectRects.some(b=>overlaps(r,b));if(!el.hidden)projectRects.push(r);}
      $('agent-zoom-label').textContent=scaleLevel()+'%';
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
      a.fx.visible=working;a.uniform.emissiveIntensity=working?.04+pulse*.055:0;
      a.auraMat.uniforms.strength.value=working?pulse*(controls.getDistance()<10?.07:.18):0;a.energyMat.opacity=working?.3+pulse*.16:0;
      a.workRing.scale.setScalar(1.16+(typing?Math.sin(time*2.4)*.1:0));
      a.signal.rotation.y=typing?time*.9:0;
      for(let i=0;i<a.sparks.length;i++){const angle=i*Math.PI*2/3+(typing?time*2:0);a.sparks[i].position.set(Math.cos(angle)*.22,typing?Math.sin(time*2+i)*.045:0,Math.sin(angle)*.22);}
      a.screenMat.emissiveIntensity=working?.55+pulse*.25:.1;a.label.dataset.motion=a.motion;a.label.dataset.action=a.action;
    }
    function frame(time=0){
      raf=0;if(!visible||lost||document.hidden)return;const enabled=motion&&!reduced.matches,layoutChanged=dirty;
      if(layoutChanged){
        camera.updateMatrixWorld();updateVisibility();
        if(quality==='auto'){const before=effectiveQuality;configureQuality();if(before!==effectiveQuality)resize();}
      }
      const animate=enabled&&([...actors.values()].some(a=>a.group.visible&&['working','waiting_agents','waiting_user'].includes(a.node.status))||edgeObjects.some(e=>e.group.visible&&e.state==='working'));
      if(dirty||!animate||time-lastFrame>32){
        for(const a of actors.values())if(a.group.visible)pose(a,time/1000,enabled);
        for(const e of edgeObjects){
          const inspecting=selected||hovered||document.activeElement?.closest('.agent-3d-person');
          e.pulse.visible=e.group.visible&&enabled&&e.state==='working'&&(!inspecting||e.highlighted);
          if(e.pulse.visible){
            // Arc-length progress keeps speed smooth on both short and long curves.
            const progress=(time/1000*.85/Math.max(1,e.length)+hash(e.group.name)%19/19)%1;
            e.point.position.copy(e.curve.getPointAt(progress));
            for(let i=0;i<e.trail.length;i++){const t=progress-(i+1)*.055/Math.max(1,e.length);e.trail[i].visible=t>=0;if(t>=0)e.trail[i].position.copy(e.curve.getPointAt(t));}
          }
        }
        if(layoutChanged){for(const w of walls){const outside=w.side==='back'?camera.position.z<w.r.z:w.side==='front'?camera.position.z>w.r.z:w.side==='right'?camera.position.x>w.r.x:camera.position.x<w.r.x;w.m.opacity=outside?(controls.getDistance()<12?.035:.12):1;w.m.depthWrite=!outside;}
        if(mode==='prison')people.traverse(o=>{if(o.userData.closeupSign)o.visible=controls.getDistance()>=9;});}
        portraitFill.intensity=mode==='prison'&&controls.getDistance()<10?.85:0;
        portraitFill.position.copy(camera.position);portraitFill.target.position.copy(controls.target);
        // Camera-independent animation does not redo label collision/layout or LOD.
        renderer.info.reset();composer.render();renderedFrames++;if(layoutChanged)projectLabelsToScreen();dirty=false;lastFrame=time;host.dataset.ready=Object.values(assetStates).includes('loading')?'loading':'true';
      }if(animate&&!raf)raf=requestAnimationFrame(frame);
    }
    function invalidate(){dirty=true;if(!raf&&visible&&!lost)raf=requestAnimationFrame(frame);}
    function resize(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;const key=w+':'+h+':'+renderer.getPixelRatio();if(key!==renderSize){renderSize=key;renderer.setSize(w,h,false);composer.setSize(w,h);ao.setSize(Math.round(w),Math.round(h));camera.aspect=w/h;camera.updateProjectionMatrix();}const strip=viewport.querySelector('.agent-controls');const top=(strip?.offsetTop||12)+(strip?.offsetHeight||44)+10;$('agent-roster').style.top=top+'px';viewport.style.setProperty('--office-panel-height',Math.max(100,h-top-100)+'px');invalidate();}
    function fit(framing=bounds){
      if(cameraPreset==='desk'){cameraPreset='iso';$('agent-camera').value=cameraPreset;}
      resize();const center=framing.getCenter(v()),direction=(cameraPreset==='top'?v(0,1,.16):v(.72,.88,1)).normalize(),inset=viewport.querySelector('.agent-controls')?.offsetHeight||44,usable=Math.max(.35,1-(inset+80)/Math.max(1,host.clientHeight));
      controls.target.copy(center);camera.position.copy(center).addScaledVector(direction,30);camera.lookAt(center);camera.updateMatrixWorld();const tan=Math.tan(camera.fov*Math.PI/360),right=v().setFromMatrixColumn(camera.matrixWorld,0),up=v().setFromMatrixColumn(camera.matrixWorld,1);let distance=8;
      for(const x of [framing.min.x,framing.max.x])for(const y of [framing.min.y,framing.max.y])for(const z of [framing.min.z,framing.max.z]){const p=v(x,y,z).sub(center);distance=Math.max(distance,Math.abs(p.dot(right))/(tan*camera.aspect)+p.dot(direction),Math.abs(p.dot(up))/(tan*usable)+p.dot(direction));}
      fitDistance=distance;controls.maxDistance=Math.max(200,distance*5);camera.far=Math.max(1000,distance*10);camera.updateProjectionMatrix();
      controls.target.copy(center).addScaledVector(up,distance*tan*inset/Math.max(1,host.clientHeight)*.2);camera.position.copy(controls.target).addScaledVector(direction,distance);controls.update();controls.saveState();invalidate();
    }
    function zoom(f){userNavigated=true;controls.dollyIn(1/f);controls.update();invalidate();}
    function pan(x,y){userNavigated=true;controls.pan(x,y);controls.update();invalidate();}
    function focusProject(id){const r=rooms.find(r=>r.id===id);if(!r)return;rememberView();userNavigated=true;fit(new T.Box3(v(r.x-r.width/2,-.2,r.z-r.depth/2),v(r.x+r.width/2,3.4,r.z+r.depth/2)));}
    function setCameraPreset(value){
      rememberView();cameraPreset=value;userNavigated=true;
      if(value==='desk'){
        const a=actors.get(selected)||[...actors.values()].find(a=>a.activityLive)||actors.values().next().value;
        if(a){controls.target.copy(a.group.position).add(v(0,1.02,0));camera.position.copy(controls.target).add(v(.72,.54,1).normalize().multiplyScalar(5));controls.update();invalidate();}
      }else fit();
    }
    $('agent-camera')?.addEventListener('change',e=>setCameraPreset(e.target.value));
    controls.addEventListener('start',()=>{userNavigated=true;});
    function focus(id){const a=actors.get(id);if(!a)return;rememberView();userNavigated=true;tooltip.hidden=true;hovered='';emphasize();const offset=camera.position.clone().sub(controls.target),distance=Math.min(offset.length(),12),target=a.group.position.clone().add(v(0,1.02,0));if(!$('agent-detail').hidden)target.addScaledVector(v().setFromMatrixColumn(camera.matrixWorld,0),1.5);controls.target.copy(target);camera.position.copy(target).addScaledVector(offset.normalize(),distance);controls.update();invalidate();}
    function hit(e){
      const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);
      // Preserve the picked silhouette while hover replaces it with a taller animal rig.
      const current=actors.get(hovered);if(current?.small&&current.inView){actorSphere.center.copy(current.group.position).add(v(0,1.58,-.39));actorSphere.radius=.35;if(raycaster.ray.intersectsSphere(actorSphere))return current.id;}
      const targets=[...actors.values()].filter(a=>a.group.visible).map(a=>a.group);for(const part of overviewParts)if(['overview-head','overview-body','overview-desk'].includes(part.mesh.name))targets.push(part.mesh);
      const hits=raycaster.intersectObjects(targets,true),picked=hits.find(h=>{if(h.object.material?.transparent&&h.object.material.opacity<.3)return false;let o=h.object;while(o){if(!o.visible||o.userData.nonInteractive)return false;o=o.parent;}return true;});
      if(!picked)return '';if(picked.object.userData.overview)return picked.object.userData.actorIds[picked.instanceId]||'';let o=picked.object;while(o&&!o.userData.agentId)o=o.parent;return o?.userData.agentId||'';
    }
    function hint(id,x,y){const a=actors.get(id);if(!a){tooltip.hidden=true;return;}const owner=actors.get(a.p.team),role=a.node.kind==='subagent'?'Subagent · '+a.node.agent_name:ui('独立会话 · 主 Agent');const ownership=a.node.kind==='subagent'?(owner?.node.kind==='session'?ui('归属主 Agent：')+owner.node.title:ui('归属主 Agent 待确认')):ui('独立会话；会话间连接为业务委托');tooltip.innerHTML='<span>'+esc(role)+'</span><strong>'+esc(a.node.task_summary)+'</strong><small>'+esc(ownership)+'</small><small>'+esc(a.node.status_label)+' · '+esc(a.node.model)+'</small>';tooltip.hidden=false;tooltip.style.left=Math.max(10,Math.min(x+16,viewport.clientWidth-260))+'px';tooltip.style.top=Math.max(10,Math.min(y+12,viewport.clientHeight-155))+'px';}
    renderer.domElement.addEventListener('pointerdown',e=>{const pan=viewport.dataset.spacePan==='true'||e.shiftKey||e.button!==0;pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId,agent:pan?'':hit(e)||hovered,pan};});
    renderer.domElement.addEventListener('pointerup',e=>{if(pointerStart&&!pointerStart.pan&&pointerStart.id===e.pointerId&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)<6){const id=pointerStart.agent||hit(e);if(actors.has(id))onSelect(id);}pointerStart=null;});
    renderer.domElement.addEventListener('pointercancel',()=>{pointerStart=null;});
    function cancelPick(){cancelAnimationFrame(pickRaf);pickRaf=0;pendingPick=null;}
    renderer.domElement.addEventListener('pointermove',e=>{
      if(e.buttons){cancelPick();tooltip.hidden=true;return;}pendingPick={clientX:e.clientX,clientY:e.clientY};
      // Coalesce high-frequency pointer events without dropping the final hover.
      if(!pickRaf)pickRaf=requestAnimationFrame(()=>{pickRaf=0;const p=pendingPick;pendingPick=null;if(!p||!visible||lost||disposed)return;const id=hit(p),r=host.getBoundingClientRect();if(id!==hovered){hovered=id;emphasize();}renderer.domElement.style.cursor=id?'pointer':'grab';hint(id,p.clientX-r.left,p.clientY-r.top);});
    });
    renderer.domElement.addEventListener('pointerleave',()=>{cancelPick();tooltip.hidden=true;hovered='';emphasize();});
    labels.addEventListener('pointerover',e=>{const el=e.target.closest('[data-node-id]');if(el){const r=el.getBoundingClientRect(),h=host.getBoundingClientRect();hovered=el.dataset.nodeId;emphasize();hint(el.dataset.nodeId,r.x-h.x,r.y-h.y);}});
    labels.addEventListener('click',e=>{const el=e.target.closest('.agent-3d-person');if(el&&!e.target.closest('button,a,input'))onSelect(el.dataset.nodeId);});
    labels.addEventListener('pointerout',e=>{if(e.relatedTarget?.closest?.('[data-node-id]')===e.target.closest('[data-node-id]'))return;tooltip.hidden=true;hovered='';emphasize();});controls.addEventListener('change',invalidate);
    labels.addEventListener('focusin',emphasize);labels.addEventListener('focusout',emphasize);
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;cancelAnimationFrame(raf);raf=0;host.dataset.ready='lost';$('agent-3d-error').hidden=false;});
    renderer.domElement.addEventListener('webglcontextrestored',()=>{lost=false;$('agent-3d-error').hidden=true;renderer.shadowMap.needsUpdate=true;invalidate();});
    const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
    const mediaChange=()=>{for(const a of actors.values())pose(a,0,false);host.dataset.motion=motion&&!reduced.matches?'live':'paused';invalidate();};reduced.addEventListener('change',mediaChange);
    const visibilityChange=()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else invalidate();};document.addEventListener('visibilitychange',visibilityChange);
    function update(data){
      const signature=data.mode+'|'+personal.revision+'|'+data.nodes.map(n=>[n.id,n.project_id,parent(n)].join(':')).join('|'),changed=signature!==topology,first=!topology,sceneChanged=mode!==data.mode;mode=data.mode;selected=data.selected;motion=data.motion;observation=data.observation||'offline';
      if(sceneChanged||changed&&data.fit){viewHistory.length=0;$('agent-view-back').disabled=true;}
      if(changed){topology=signature;rebuild(data.nodes);}
      if(localeStamp!==i18n.locale){
        localeStamp=i18n.locale;architecture.traverse(o=>o.userData.localize?.());for(const a of actors.values())a.group.traverse(o=>o.userData.localize?.());
        for(const {el,room:r}of projectLabels){el.querySelector('.agent-project-caption').textContent=ui('项目办公区');el.querySelector('small').textContent=r.nodes.filter(n=>n.kind==='session').length+ui(' 主 Agent / ')+r.nodes.filter(n=>n.kind==='subagent').length+' Subagents';el.setAttribute('aria-label',ui('定位办公区：')+r.name);}
        renderer.domElement.setAttribute('aria-label',ui('可旋转的三维 Agent 办公空间'));tooltip.hidden=true;
      }
      const edgeKey=data.edges.map(e=>e.source+':'+e.target+':'+e.kind+':'+data.states.get(e.target)).join('|');if(changed||links.userData.key!==edgeKey){edges(data);links.userData.key=edgeKey;}
      for(const n of data.nodes){
        const a=actors.get(n.id);if(!a)continue;a.node=n;a.activityLive=observation==='live'&&n.status==='working';a.ring.visible=n.id===selected;a.lamp.material=mat(statusColors[n.status]||statusColors.unknown);
        a.label.dataset.status=n.status;a.label.classList.toggle('selected',n.id===selected);a.label.classList.toggle('dim',data.related&&!data.related.has(n.id));a.label.classList.toggle('context',!data.wanted.has(n.id));
        const button=a.label.querySelector('.agent-node-select'),name=personal.get(n.id).nickname||(n.kind==='subagent'?n.agent_name:brief(n.title,26));
        a.label.dataset.teamId=a.p.team;a.label.style.setProperty('--team-color',hex(teamColor(a.p.team)));
        const isActive=['working','waiting_agents','waiting_user'].includes(n.status);
        const status=observation!=='live'&&isActive?({offline:ui('离线记录'),paused:ui('暂停观察'),stale:ui('观察待确认')}[observation]||ui('最后记录')):n.status==='working'?ui('执行中'):n.status==='waiting_agents'?ui('等待代理'):n.status==='waiting_user'?ui('等待确认'):n.status==='failed'?ui('本轮失败'):n.status_label;
        a.label.dataset.bubble=isActive&&observation!=='live'?'recorded':n.status==='working'?'working':['waiting_agents','waiting_user'].includes(n.status)?'waiting':n.status==='failed'?'failed':'none';
        a.label.dataset.observation=observation;
        const dotColor=isActive&&observation!=='live'?statusColors.unknown:statusColors[n.status]||statusColors.unknown;
        a.label.style.setProperty('--observed-color',hex(dotColor));
        const caption=[i18n.locale,name,n.kind,n.project,status,n.task_summary,n.current_activity].join('|');
        if(caption!==a.caption){
          a.caption=caption;button.innerHTML='<span class="agent-person-header"><i class="agent-person-dot" style="background:'+hex(dotColor)+'"></i><b class="agent-role-tag">'+(n.kind==='subagent'?'Sub':ui('主'))+'</b><span class="agent-person-title">'+esc(name)+'</span><span class="agent-bubble-project">'+esc(brief(n.project,18))+'</span><span class="agent-bubble-status">'+esc(status)+'</span><span class="agent-work-indicator" aria-hidden="true"><i></i><i></i><i></i></span></span><strong class="agent-bubble-task">'+esc(brief(n.task_summary||n.title,54))+'</strong><small class="agent-bubble-activity">'+esc(brief(n.current_activity,32))+ui(' · 记录观察</small>');
        }
        button.setAttribute('aria-label',(n.kind==='subagent'?'Subagent · ':ui('主 Agent · '))+n.title+' · '+status);button.setAttribute('aria-pressed',String(n.id===selected));button.removeAttribute('title');
        const count=data.children.get(n.id)?.filter(x=>x.project_id===n.project_id).length||0;let toggle=a.label.querySelector('[data-expand-agent]');
        if(count){if(!toggle){toggle=document.createElement('button');toggle.className='agent-3d-branch';toggle.dataset.expandAgent=n.id;a.label.append(toggle);}toggle.setAttribute('aria-label',(data.collapsed.has(n.id)?ui('展开'):ui('收起'))+' '+count+ui(' 分支'));toggle.setAttribute('aria-expanded',String(!data.collapsed.has(n.id)));toggle.textContent=(data.collapsed.has(n.id)?'+':'−')+count;}else toggle?.remove();
        pose(a,performance.now()/1000,a.group.visible&&motion&&!reduced.matches);
      }
      host.dataset.motion=motion&&!reduced.matches?'live':'paused';const workCount=[...actors.values()].filter(a=>a.activityLive).length;
      updateRoster();
      $('agent-3d-heading').innerHTML='<b>3D / '+(mode==='prison'?ui('单人隔间'):ui('休闲办公室'))+'</b><span>'+actors.size+ui(' 位员工 · ')+rooms.length+ui(' 个项目办公区')+(observation==='live'?' · '+workCount+ui(' 位正在执行'):' · '+(observation==='paused'?ui('观察已暂停'):ui('执行状态待确认')))+ui('</span><div class="agent-3d-link-key"><span><i class="native"></i>主 → Subagent</span><span><i class="business"></i>会话业务委托</span></div>');
      emphasize();
      if(first||sceneChanged||data.fit||changed&&!userNavigated)fit();else resize();invalidate();
    }
    function setPanModifier(value){controls.mouseButtons.LEFT=value?T.MOUSE.PAN:T.MOUSE.ROTATE;}
    function setVisible(value){if(value!==visible){if(value)labels.append(detachedLabels);else detachedLabels.append(...labels.childNodes);}visible=value;host.hidden=!value;if(value){resize();invalidate();}else{cancelAnimationFrame(raf);raf=0;tooltip.hidden=true;}}
    function debug(){
      const features={};scene.traverse(o=>{if(o.name)features[o.name]=(features[o.name]||0)+1;});
      return {available:true,revision:T.REVISION,mode,visible,ready:host.dataset.ready,selected,hovered,observation,
        motion:motion&&!reduced.matches&&visible&&!document.hidden,features,
        lighting:{background:hex(scene.background.getHex()),ambient:ambient.intensity,sun:sun.intensity,fill:fill.intensity,exposure:renderer.toneMappingExposure,localLights:localLightCount},
        projects:rooms.map(r=>({id:r.id,x:r.x,z:r.z,width:r.width,depth:r.depth,teams:r.teams.map(t=>t.main.id)})),
        quality:{pixelRatio:renderer.getPixelRatio(),character:assetState==='ready'?'blender-skinned-glb':'contoured-fallback',assetState,assetStates:{...assetStates},preset:quality,effective:effectiveQuality,contactShadows:ao.enabled,msaa:4,relationships:'bezier'},
        rigs:[...actors.values()].filter(a=>a.avatar).map(a=>({id:a.id,lod:a.avatar.lod,bones:Object.keys(a.avatar.bones).length,species:a.avatar.species})),
        actors:[...actors.values()].map(a=>({id:a.id,status:a.node.status,motion:a.motion,action:a.action,renderMode:!a.inView?'culled':a.overview?'overview':'detail',screenHeight:a.screenHeight,position:a.group.position.toArray(),team:a.p.team,teamColor:hex(teamColor(a.p.team)),appearance:a.appearance,avatarSpecies:a.avatar?.species||'procedural',arm:a.arms[0].rotation.x,joints:{elbow:a.elbows.map(e=>e.rotation.x),wrist:a.wrists.map(w=>w.rotation.x),spine:a.upper.rotation.x,head:a.head.rotation.toArray().slice(0,3)},effects:{visible:a.fx.visible,strength:a.auraMat.uniforms.strength.value,ringScale:a.workRing.scale.x,beacon:a.signal.rotation.y},bubble:{kind:a.label.dataset.bubble,size:a.label.dataset.bubbleSize},detail:{faceVertices:a.face.geometry.attributes.position.count,bodyVertices:a.shirtMesh.geometry.attributes.position.count,visible:a.detailVisible},meshCount:a.group.children.length,cell:Boolean(a.group.getObjectByName('single-cell')),halo:a.halo.visible})),
        edges:edgeObjects.map(e=>({kind:e.kind,state:e.state,flow:e.pulse.visible,source:e.group.userData.edge.source,target:e.group.userData.edge.target,color:hex(e.color),radius:e.radius,apex:e.apex,lane:e.lane,route:'bezier',length:e.length,endpointError:Math.max(e.curve.getPoint(0).distanceTo(actors.get(e.group.userData.edge.source).group.position.clone().add(v(.82,1.12,.84))),e.curve.getPoint(1).distanceTo(actors.get(e.group.userData.edge.target).group.position.clone().add(v(.82,1.12,.84)))),highlighted:e.highlighted,opacity:e.tubeMat.opacity,arrowVisible:e.group.children.find(x=>x.name==='relationship-arrow').visible})),
        cameraPreset,labelMode,linkMode,viewHistory:viewHistory.length,visibleRelationships:edgeObjects.filter(e=>e.group.visible).length,camera:camera.position.toArray(),target:controls.target.toArray(),render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frames:renderedFrames,scaleLevel:scaleLevel(),lodPolicy:{...overviewPolicy},inView:inViewCount,crowded:crowdedView,overview:overviewCount,culled:culledCount,details:actors.size-overviewCount-culledCount,labels:[...actors.values()].filter(a=>!a.label.hidden).length,continuous:motion&&!reduced.matches&&([...actors.values()].some(a=>a.group.visible&&['working','waiting_agents','waiting_user'].includes(a.node.status))||edgeObjects.some(e=>e.group.visible&&e.state==='working'))},memory:{...renderer.info.memory}};
    }
    function screenPoint(id){const a=actors.get(id);if(!a)return null;const p=projection(a.overview?a.group.position.clone().add(v(0,1.58,-.39)):a.head.getWorldPosition(v())),r=host.getBoundingClientRect();return {x:r.x+p.x,y:r.y+p.y,shown:p.shown};}
    function dispose(){
      disposed=true;visible=false;cancelAnimationFrame(raf);cancelPick();resizeObserver.disconnect();reduced.removeEventListener('change',mediaChange);document.removeEventListener('visibilitychange',visibilityChange);controls.dispose();
      for(const a of actors.values())if(a.avatar)for(const m of a.avatar.materials.values())m.dispose();
      for(const a of actors.values())people.add(a.group);
      clearOverview();clearArchitectureBatches();clear(architecture);clear(people);clear(links);for(const m of mats.values()){if(m.userData.ownedMap)m.map.dispose();m.dispose();}for(const g of geos.values())g.dispose();for(const w of walls)w.m.dispose();
      ao.dispose();renderPass.dispose();outputPass.dispose();composer.dispose();environment.dispose();renderer.dispose();renderer.domElement.remove();
    }
    return {available:true,update,setVisible,setPanModifier,fit:()=>{rememberView();userNavigated=true;fit();},zoom,focus,pan,debug,screenPoint,dispose};
  }
  window.CodexAgentScenes={create,metrics:(_mode,kind)=>({width:kind==='subagent'?220:248,height:kind==='subagent'?136:160})};
})();
