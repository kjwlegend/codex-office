# Local Three.js bundle

Three.js 0.186.1 and its official addons are pinned in package-lock.json: OrbitControls,
GLTFLoader/SkeletonUtils, RoundedBoxGeometry, RoomEnvironment/PMREM, and the
EffectComposer, RenderPass, GTAOPass and OutputPass rendering pipeline.
The MIT license is kept in three-LICENSE.txt and in the compiled bundle's header.

Rebuild with `npm ci --ignore-scripts --no-audit --no-fund && npm run build` from
this directory. Only three.bundle.js is inlined into the generated report.
Node/npm are build-time tools, not dashboard runtime requirements.
No CDN, network model, external image or external font is used by the 3D scene.

Source APIs: https://threejs.org/docs/pages/WebGLRenderer.html
and https://threejs.org/docs/pages/OrbitControls.html.
