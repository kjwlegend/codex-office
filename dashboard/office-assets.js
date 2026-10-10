/* Original Blender-authored coworkers; embedded so file:// works offline. */
(() => {
  'use strict';
  const T=window.CodexThree;
  const ids={human:'office-character-data',cow:'office-cow-data',horse:'office-horse-data'},promises=new Map();
  const requiredBones=['rig_root','rig_spine','rig_head','rig_arm_L','rig_arm_R','rig_elbow_L','rig_elbow_R','rig_wrist_L','rig_wrist_R'];
  window.CodexOfficeAssets={load(species='human'){
    if(!Object.prototype.hasOwnProperty.call(ids,species))return Promise.reject(new Error('Unknown office coworker: '+species));
    if(!promises.has(species))promises.set(species,(async()=>{
      const encoded=document.getElementById(ids[species])?.textContent.trim();
      if(!encoded)throw new Error('Office '+species+' asset missing');
      const binary=atob(encoded),bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      const gltf=await new T.GLTFLoader().parseAsync(bytes.buffer,'');
      const bones=new Set(),meshes=new Set(),materials=new Set();
      gltf.scene.traverse(o=>{
        if(o.isBone)bones.add(o.name);
        if(o.isSkinnedMesh){meshes.add(o.name);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m.name);}
      });
      // Reject an incompatible model before the renderer replaces a usable fallback.
      const requiredMeshes=['Skin','Shirt'].flatMap(part=>[0,1].map(lod=>'SM_Employee_'+part+'_LOD'+lod));
      if(requiredBones.some(name=>!bones.has(name))||requiredMeshes.some(name=>!meshes.has(name))||!materials.has('MAT_Shirt'))throw new Error('Office '+species+' asset has an incompatible rig');
      return gltf.scene;
    })());
    return promises.get(species);
  }};
})();
