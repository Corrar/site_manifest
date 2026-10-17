import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  mobile: boolean;
};

// Sol da tarde em Brasília: alto, vindo do noroeste (o céu do cerrado é limpo e muito azul).
const SUN_ELEVATION = 52; // graus
const SUN_AZIMUTH = 215; // graus
const HAZE = '#c8d9e6'; // cor do horizonte, usada na neblina para o chão sumir no céu
const SHADOW_SPAN = 90; // metros de sombra em volta do foco

export function createStage(container: HTMLElement, onContextLost: () => void): Stage {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = !mobile;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    onContextLost();
  });

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HAZE, 700, 2600);
  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.3, 9000);

  // Céu com dispersão atmosférica, e o mesmo céu como luz de ambiente (reflexo nos vidros e na água).
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1, THREE.MathUtils.degToRad(90 - SUN_ELEVATION), THREE.MathUtils.degToRad(SUN_AZIMUTH),
  );
  const sky = new Sky();
  sky.scale.setScalar(8000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4.5;
  u.rayleigh.value = 1.1;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  envSky.material.uniforms.sunPosition.value.copy(sunDir);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) {
    envSky.material.uniforms[k].value = u[k].value;
  }
  envScene.add(envSky);
  // Chão esverdeado na metade de baixo do ambiente, para o reflexo de baixo não ser céu.
  const envGround = new THREE.Mesh(
    new THREE.SphereGeometry(500, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#5d6b45', side: THREE.BackSide }),
  );
  envScene.add(envGround);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight('#cfe3ff', '#56603f', 0.35));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.7);
  sun.castShadow = !mobile;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_SPAN, right: SHADOW_SPAN, top: SHADOW_SPAN, bottom: -SHADOW_SPAN, near: 10, far: 900,
  });
  scene.add(sun, sun.target);

  addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
  });
  return { renderer, scene, camera, sun, sunDir, mobile };
}

/** A área de sombra acompanha o foco da câmera, na direção do sol. */
export function followSun(stage: Stage, x: number, z: number): void {
  const d = stage.sunDir;
  stage.sun.position.set(x + d.x * 400, d.y * 400, z + d.z * 400);
  stage.sun.target.position.set(x, 0, z);
}
