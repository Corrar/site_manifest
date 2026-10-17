// Visualizador temporário do rig (client/dev-rig.html): carrega o .glb com esqueleto, aplica as animações do jogo
// (clipsFor) e mostra repouso, andar, correr, acenar e dançar lado a lado, de frente e de lado, num instante fixo.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIM } from '../../shared/constants.ts';
import { BONES, clipsFor } from './scene/character.ts';

const q = new URLSearchParams(location.search);
const phase = Number(q.get('t') ?? '0.25');
const showBones = !!q.get('bones') && q.get('bones') !== '0';
const focus = q.get('focus') ?? 'corpo';
const weightView = q.get('w');
const modelUrl = q.get('model') ?? '/models/realista-1.gltf';
/** Modelo original (estático, pose T) para comparar na coluna "original", no mesmo enquadramento (extras.source). */
const refUrl = q.get('ref');

const COLS: Record<string, { label: string; anim: number }> = {
  original: { label: 'original', anim: -2 },
  repouso: { label: 'repouso (bind)', anim: -1 },
  parado: { label: 'parado', anim: ANIM.idle },
  andar: { label: 'andar', anim: ANIM.walk },
  correr: { label: 'correr', anim: ANIM.run },
  acenar: { label: 'acenar', anim: ANIM.wave },
  dancar: { label: 'dançar', anim: ANIM.dance },
};
const VIEWS: Record<string, { label: string; yaw: number; pitch?: number }> = {
  frente: { label: 'frente', yaw: 0 },
  lado: { label: 'lado (esquerdo)', yaw: Math.PI / 2 },
  direito: { label: 'lado (direito)', yaw: -Math.PI / 2 },
  costas: { label: 'costas', yaw: Math.PI },
  tres: { label: '3/4', yaw: Math.PI / 4 },
  cima: { label: 'de cima (câmera do jogo)', yaw: Math.PI * 0.85, pitch: 0.55 },
  baixo: { label: 'de baixo', yaw: Math.PI / 5, pitch: -0.35 },
};
/** Centro (y), altura do enquadramento e centro em x (opcional). */
const FOCUS: Record<string, [number, number, number?]> = {
  corpo: [0.9, 2.0],
  tronco: [1.2, 0.95],
  pernas: [0.45, 1.0],
  maos: [0.95, 0.7],
  cabeca: [1.55, 0.5],
  rosto: [1.58, 0.3],
  nariz: [1.56, 0.14],
  barra: [0.2, 0.42],
  maoE: [0.82, 0.32, 0.27],
};
const cols = (q.get('cols') ?? 'repouso,andar,correr,acenar,dancar').split(',').filter((c) => COLS[c]);
const views = (q.get('views') ?? 'frente,lado').split(',').filter((v) => VIEWS[v]);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.setScissorTest(true);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

type Cell = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; mixer: THREE.AnimationMixer | null; col: string; view: string };
const cells: Cell[] = [];

/** Cores por osso (modo de pesos "dominante"). */
const PALETTE = BONES.map((_, i) => new THREE.Color().setHSL((i * 0.618) % 1, 0.75, 0.55));

function weightMaterial(mesh: THREE.SkinnedMesh) {
  const g = mesh.geometry;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const n = si.count;
  const colors = new Float32Array(n * 3);
  const target = BONES.indexOf(weightView as (typeof BONES)[number]);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.setRGB(0, 0, 0);
    if (target >= 0) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === target) w += sw.getComponent(i, k);
      c.setRGB(w, w * 0.15, 1 - w);
    } else {
      for (let k = 0; k < 4; k++) c.add(PALETTE[si.getComponent(i, k)].clone().multiplyScalar(sw.getComponent(i, k)));
    }
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

async function main() {
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const root = gltf.scene;
  let mesh: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) throw new Error('o modelo não tem SkinnedMesh');
  const skinned = mesh as THREE.SkinnedMesh;
  const node = root.getObjectByName('realista-1') ?? root.children[0];
  const extras = { ...root.userData, ...node?.userData } as { hipsY?: number; height?: number };
  const hipsY = extras.hipsY ?? skinned.skeleton.getBoneByName('hips')!.position.y;
  if (weightView) skinned.material = weightMaterial(skinned);
  // nmap=0: sem o normal map; luz=0: só a textura (sem luz), para separar geometria, normais e textura
  if (q.get('nmap') === '0') (skinned.material as THREE.MeshStandardMaterial).normalMap = null;
  if (q.get('luz') === '0') skinned.material = new THREE.MeshBasicMaterial({ map: (skinned.material as THREE.MeshStandardMaterial).map, side: THREE.DoubleSide });
  if (showBones) {
    const m = skinned.material as THREE.MeshStandardMaterial;
    m.transparent = true;
    m.opacity = 0.45;
    m.depthWrite = false;
  }
  const clips = clipsFor(0, hipsY, false);
  const [cy, fh, cx = 0] = FOCUS[focus] ?? FOCUS.corpo;
  // original: mesma normalização do rig (escala, deslocamento e giro gravados em extras.source)
  let ref: THREE.Object3D | null = null;
  if (refUrl && cols.includes('original')) {
    type Src = { scale: number; offset: [number, number, number]; flip180: boolean };
    let src: Src | undefined;
    root.traverse((o) => (src ??= (o.userData as { source?: Src }).source));
    const g = await new GLTFLoader().loadAsync(refUrl);
    const inner = new THREE.Group();
    inner.add(g.scene);
    if (src) inner.scale.setScalar(src.scale), inner.position.fromArray(src.offset);
    ref = new THREE.Group();
    ref.add(inner);
    if (src?.flip180) ref.rotation.y = Math.PI;
  }

  for (const view of views) {
    for (const col of cols) {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x2a313b);
      scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x4a4036, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(1.5, 3, 2.5);
      scene.add(sun);
      if ((VIEWS[view].pitch ?? 0) >= 0) {
        const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.MeshLambertMaterial({ color: 0x59626e }));
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);
      }
      const anim = COLS[col].anim;
      if (anim === -2 && !ref) continue;
      const inst = anim === -2 ? ref!.clone() : cloneSkinned(root);
      scene.add(inst);
      let mixer: THREE.AnimationMixer | null = null;
      if (anim >= 0) {
        mixer = new THREE.AnimationMixer(inst);
        const clip = clips[anim];
        mixer.clipAction(clip).play();
        mixer.setTime(phase * clip.duration);
      }
      if (showBones) {
        const helper = new THREE.SkeletonHelper(inst);
        (helper.material as THREE.LineBasicMaterial).depthTest = false;
        (helper.material as THREE.LineBasicMaterial).linewidth = 2;
        scene.add(helper);
      }
      const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
      const { yaw, pitch = 0 } = VIEWS[view];
      const dist = fh / 2 / Math.tan(THREE.MathUtils.degToRad(12));
      camera.position.set(cx + Math.sin(yaw) * Math.cos(pitch) * dist, cy + 0.05 * (fh / 2) + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(cx, cy, 0);
      cells.push({ scene, camera, mixer, col, view });
    }
  }

  // rótulos e informações
  const nc = cols.filter((c) => c !== 'original' || ref).length;
  const nr = views.length;
  cells.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = `${COLS[c.col].label} · ${VIEWS[c.view].label}${c.mixer ? ` · t=${phase}` : ''}`;
    el.style.left = `${((i % nc) / nc) * 100}%`;
    el.style.top = `${(Math.floor(i / nc) / nr) * 100}%`;
    el.style.margin = '6px';
    document.body.append(el);
  });
  const tris = (skinned.geometry.index?.count ?? 0) / 3;
  document.getElementById('info')!.textContent =
    `${modelUrl} · ${tris} triângulos · ${skinned.skeleton.bones.length} ossos · hipsY ${hipsY.toFixed(3)} · altura ${extras.height ?? '?'}` +
    (weightView ? ` · pesos: ${weightView}` : '');

  const draw = () => {
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h);
    const cw = w / nc;
    const ch = h / nr;
    cells.forEach((c, i) => {
      const x = (i % nc) * cw;
      const y = h - (Math.floor(i / nc) + 1) * ch;
      renderer.setViewport(x, y, cw, ch);
      renderer.setScissor(x, y, cw, ch);
      c.camera.aspect = cw / ch;
      c.camera.updateProjectionMatrix();
      renderer.render(c.scene, c.camera);
    });
  };
  draw();
  addEventListener('resize', draw);
  (window as unknown as { __rigReady: boolean }).__rigReady = true;
}

main().catch((e: unknown) => {
  document.getElementById('err')!.textContent = String(e instanceof Error ? e.stack : e);
  (window as unknown as { __rigReady: boolean }).__rigReady = true;
});
