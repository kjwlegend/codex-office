// Pinned, locally bundled Three.js; snapshots never contact a CDN.
import {
  Scene, Color, Fog, WebGLRenderer, PerspectiveCamera, Group, Mesh, InstancedMesh, Object3D, Matrix4, Frustum, Sphere,
  MeshStandardMaterial, MeshBasicMaterial, ShaderMaterial, AdditiveBlending, BoxGeometry, SphereGeometry,
  CylinderGeometry, ConeGeometry, TorusGeometry, PlaneGeometry, TubeGeometry, BufferGeometry, Float32BufferAttribute,
  CatmullRomCurve3, CubicBezierCurve3, CanvasTexture, Vector2, Vector3, Raycaster, Box3,
  HemisphereLight, DirectionalLight, PointLight, SRGBColorSpace, ACESFilmicToneMapping,
  PCFShadowMap, DoubleSide, MOUSE, TOUCH, REVISION, WebGLRenderTarget, HalfFloatType, PMREMGenerator, RepeatWrapping
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
window.CodexThree = {
  Scene, Color, Fog, WebGLRenderer, PerspectiveCamera, Group, Mesh, InstancedMesh, Object3D, Matrix4, Frustum, Sphere,
  MeshStandardMaterial, MeshBasicMaterial, ShaderMaterial, AdditiveBlending, BoxGeometry, SphereGeometry,
  CylinderGeometry, ConeGeometry, TorusGeometry, PlaneGeometry, TubeGeometry, BufferGeometry, Float32BufferAttribute,
  CatmullRomCurve3, CubicBezierCurve3, CanvasTexture, Vector2, Vector3, Raycaster, Box3,
  HemisphereLight, DirectionalLight, PointLight, SRGBColorSpace, ACESFilmicToneMapping,
  PCFShadowMap, DoubleSide, MOUSE, TOUCH, OrbitControls, REVISION,
  WebGLRenderTarget, HalfFloatType, PMREMGenerator, RepeatWrapping,
  GLTFLoader, cloneSkeleton, RoundedBoxGeometry, RoomEnvironment,
  EffectComposer, RenderPass, GTAOPass, OutputPass
};
