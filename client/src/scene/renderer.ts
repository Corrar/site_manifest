import * as THREE from 'three';

export type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  mobile: boolean;
};

export function createStage(container: HTMLElement, onContextLost: () => void): Stage {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = !mobile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    onContextLost();
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9ec9ea');
  scene.fog = new THREE.Fog('#9ec9ea', 400, 1600);
  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 3000);

  scene.add(new THREE.HemisphereLight('#dcecff', '#4d5a3a', 1.2));
  const sun = new THREE.DirectionalLight('#fff4dd', 2.2);
  sun.castShadow = !mobile;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 600 });
  scene.add(sun, sun.target);

  addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
  });
  return { renderer, scene, camera, sun, mobile };
}

/** A área de sombra acompanha o foco da câmera. */
export function followSun(stage: Stage, x: number, z: number): void {
  stage.sun.position.set(x - 120, 220, z - 80);
  stage.sun.target.position.set(x, 0, z);
}
