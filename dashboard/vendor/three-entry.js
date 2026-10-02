// Pinned, locally bundled Three.js; snapshots never contact a CDN.
import {
  Scene, Color, Fog, WebGLRenderer, PerspectiveCamera, Group, Mesh,
  MeshStandardMaterial, MeshBasicMaterial, ShaderMaterial, AdditiveBlending, BoxGeometry, SphereGeometry,
  CylinderGeometry, ConeGeometry, TorusGeometry, PlaneGeometry, TubeGeometry,
  CatmullRomCurve3, CanvasTexture, Vector2, Vector3, Raycaster, Box3,
  HemisphereLight, DirectionalLight, PointLight, SRGBColorSpace, ACESFilmicToneMapping,
  PCFShadowMap, DoubleSide, MOUSE, TOUCH, REVISION
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
window.CodexThree = {
  Scene, Color, Fog, WebGLRenderer, PerspectiveCamera, Group, Mesh,
  MeshStandardMaterial, MeshBasicMaterial, ShaderMaterial, AdditiveBlending, BoxGeometry, SphereGeometry,
  CylinderGeometry, ConeGeometry, TorusGeometry, PlaneGeometry, TubeGeometry,
  CatmullRomCurve3, CanvasTexture, Vector2, Vector3, Raycaster, Box3,
  HemisphereLight, DirectionalLight, PointLight, SRGBColorSpace, ACESFilmicToneMapping,
  PCFShadowMap, DoubleSide, MOUSE, TOUCH, OrbitControls, REVISION
};
