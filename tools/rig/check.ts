/**
 * Conferência de deformação do .glb gerado por rig.ts com as animações do jogo (clipsFor(0, hipsY, false)):
 *
 *   node tools/rig/check.ts <modelo.glb> [quadros por clipe = 24]
 *
 * Por clipe:
 *  - saia: maior esticamento de aresta (comprimento posado ÷ repouso) e quantas passam de 2×, 2,5× e 3×;
 *  - pernas atravessando o pano: vértices de canela/pé cujo caminho quadril → joelho → vértice cruza a saia
 *    (com a barra aberta, a perna que sai por baixo dela não cruza nada);
 *  - canela/pé acima de 0,25 m sem nenhum pano na horizontal para fora (a mesma medida dos avaliadores);
 *  - y mínimo (pés no chão).
 * Sai com código 1 se a saia passar de 2,5× no andar ou de 4× na corrida (pernas atravessando o pano só são
 * relatadas: perto da barra o pano não tem como seguir as duas canelas ao mesmo tempo).
 * MAX_KNEE=<rad> limita a flexão do joelho nas animações; CHECK_DEBUG=1 mostra onde as pernas atravessam o pano.
 */
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import { BONES, PARENT, clipsFor, type BoneName } from '../../client/src/scene/character.ts';
import { ANIM } from '../../shared/constants.ts';

const path = process.argv[2];
const FRAMES = Number(process.argv[3] ?? 24);
/** Flexão máxima do joelho (rad) aplicada às animações; padrão: nenhuma (as animações do jogo como estão). */
const MAX_KNEE = Number(process.env.MAX_KNEE ?? 0);
if (!path) {
  console.error('uso: node tools/rig/check.ts <modelo.glb> [quadros]');
  process.exit(1);
}

const doc = await new NodeIO().registerExtensions([EXTTextureWebP]).read(path);
const meshNode = doc.getRoot().listNodes().find((n) => n.getMesh() && n.getSkin())!;
const extras = meshNode.getExtras() as { hipsY: number; height: number };
const prim = meshNode.getMesh()!.listPrimitives()[0];
const P = prim.getAttribute('POSITION')!.getArray() as Float32Array;
const JI = prim.getAttribute('JOINTS_0')!.getArray() as Uint8Array;
const WT = prim.getAttribute('WEIGHTS_0')!.getArray() as Float32Array;
const I = Uint32Array.from(prim.getIndices()!.getArray()!);
const n = P.length / 3;

// --- SkinnedMesh do three.js com o mesmo esqueleto ---
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(JI), 4));
geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(WT), 4));
geo.setIndex(new THREE.BufferAttribute(I, 1));
const skin = meshNode.getSkin()!;
const jointNodes = skin.listJoints();
const ibm = skin.getInverseBindMatrices()!.getArray() as Float32Array;
const bones = new Map<string, THREE.Bone>();
for (const jn of jointNodes) {
  const b = new THREE.Bone();
  b.name = jn.getName();
  b.position.fromArray(jn.getTranslation());
  b.quaternion.fromArray(jn.getRotation());
  bones.set(b.name, b);
}
const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
for (const name of BONES) {
  const p = PARENT[name];
  (p ? bones.get(p)! : mesh).add(bones.get(name)!);
}
const group = new THREE.Group();
group.add(mesh);
group.updateMatrixWorld(true);
const boneList = jointNodes.map((jn) => bones.get(jn.getName())!);
mesh.bind(new THREE.Skeleton(boneList, boneList.map((_, i) => new THREE.Matrix4().fromArray(ibm, i * 16))), mesh.matrixWorld);
const sameSkeleton = jointNodes.map((j) => j.getName()).join(',') === BONES.join(',');
const identity = jointNodes.every((j) => Math.abs(j.getRotation()[3] - 1) < 1e-6);

// --- classificação dos vértices pelos pesos ---
const boneIdx = (b: BoneName) => BONES.indexOf(b);
const weightOn = (i: number, set: number[]) => {
  let w = 0;
  for (let k = 0; k < 4; k++) if (set.includes(JI[i * 4 + k])) w += WT[i * 4 + k];
  return w;
};
const LEG_BONES = { L: [boneIdx('lowerLegL'), boneIdx('footL')], R: [boneIdx('lowerLegR'), boneIdx('footR')] };
const SKIRT_BONES = ['hips', 'upperLegL', 'lowerLegL', 'upperLegR', 'lowerLegR'].map((b) => boneIdx(b as BoneName));
const legSide = new Int8Array(n); // 0 = não é perna, 1 = L, -1 = R
const isSkirt = new Uint8Array(n);
for (let i = 0; i < n; i++) {
  if (weightOn(i, LEG_BONES.L) > 0.999) legSide[i] = 1;
  else if (weightOn(i, LEG_BONES.R) > 0.999) legSide[i] = -1;
  else if (weightOn(i, SKIRT_BONES) > 0.99 && P[i * 3 + 1] < extras.hipsY) isSkirt[i] = 1;
}
const edges = new Map<number, [number, number]>();
for (let k = 0; k < I.length; k += 3) {
  for (let j = 0; j < 3; j++) {
    const a = I[k + j], b = I[k + ((j + 1) % 3)];
    const key = a < b ? a * n + b : b * n + a;
    if (!edges.has(key)) edges.set(key, [Math.min(a, b), Math.max(a, b)]);
  }
}
const skirtEdges = [...edges.values()].filter(([a, b]) => isSkirt[a] && isSkirt[b]);
const restLen = skirtEdges.map(([a, b]) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]));
const skirtTris: number[] = [];
const clothTris: number[] = []; // tudo que não é perna (para a medida dos avaliadores)
for (let k = 0; k < I.length; k += 3) {
  if (isSkirt[I[k]] && isSkirt[I[k + 1]] && isSkirt[I[k + 2]]) skirtTris.push(k);
  if (!legSide[I[k]] && !legSide[I[k + 1]] && !legSide[I[k + 2]]) clothTris.push(k);
}
const legVerts = [...Array(n).keys()].filter((i) => legSide[i]);

// --- pose ---
const cur = new Float32Array(n * 3);
const v = new THREE.Vector3();
function pose() {
  group.updateMatrixWorld(true);
  for (let i = 0; i < n; i++) {
    mesh.getVertexPosition(i, v);
    cur[i * 3] = v.x, cur[i * 3 + 1] = v.y, cur[i * 3 + 2] = v.z;
  }
}

/** Segmento × triângulo (Möller–Trumbore), com t em (0, 1). */
const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), pv = new THREE.Vector3(), tv = new THREE.Vector3(), qv = new THREE.Vector3();
const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
function hitsTri(o: THREE.Vector3, d: THREE.Vector3, k: number, tMax: number) {
  A.fromArray(cur, I[k] * 3), B.fromArray(cur, I[k + 1] * 3), C.fromArray(cur, I[k + 2] * 3);
  e1.subVectors(B, A), e2.subVectors(C, A), pv.crossVectors(d, e2);
  const det = e1.dot(pv);
  if (Math.abs(det) < 1e-14) return false;
  const id = 1 / det;
  tv.subVectors(o, A);
  const u = tv.dot(pv) * id;
  if (u < 0 || u > 1) return false;
  qv.crossVectors(tv, e1);
  const w = d.dot(qv) * id;
  if (w < 0 || u + w > 1) return false;
  const t = e2.dot(qv) * id;
  return t > 1e-5 && t < tMax;
}

/** Grade uniforme dos triângulos da saia na pose atual. */
const CELL = 0.04;
function gridOf(tris: number[]) {
  const g = new Map<string, number[]>();
  for (const k of tris) {
    const lo = [0, 1, 2].map((j) => Math.floor(Math.min(cur[I[k] * 3 + j], cur[I[k + 1] * 3 + j], cur[I[k + 2] * 3 + j]) / CELL));
    const hi = [0, 1, 2].map((j) => Math.floor(Math.max(cur[I[k] * 3 + j], cur[I[k + 1] * 3 + j], cur[I[k + 2] * 3 + j]) / CELL));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const key = `${x},${y},${z}`;
      const l = g.get(key);
      if (l) l.push(k);
      else g.set(key, [k]);
    }
  }
  return g;
}
let lastHit = -1;
function segmentCrosses(g: Map<string, number[]>, a: THREE.Vector3, b: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(b, a);
  const L = d.length();
  if (L < 1e-6) return false;
  d.divideScalar(L);
  const seen = new Set<number>();
  // células ao longo do segmento (passos de meia célula, com vizinhas)
  const steps = Math.ceil(L / (CELL / 2));
  for (let s = 0; s <= steps; s++) {
    const p = new THREE.Vector3().copy(a).addScaledVector(d, (L * s) / steps);
    const c = [Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL)];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      for (const k of g.get(`${c[0] + x},${c[1] + y},${c[2] + z}`) ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        if (hitsTri(a, d, k, L)) return (lastHit = k), true;
      }
    }
  }
  return false;
}
function rayOut(o: THREE.Vector3, d: THREE.Vector3) {
  for (const k of clothTris) {
    const ys = [cur[I[k] * 3 + 1], cur[I[k + 1] * 3 + 1], cur[I[k + 2] * 3 + 1]];
    if (Math.max(...ys) < o.y || Math.min(...ys) > o.y) continue;
    if (hitsTri(o, d, k, 10)) return true;
  }
  return false;
}

/** Limita a rotação x de lowerLeg (a flexão do joelho) nas trilhas do clipe. */
function clampKnee(clip: THREE.AnimationClip, max: number) {
  const c = clip.clone();
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const t of c.tracks) {
    if (!/^lowerLeg[LR]\.quaternion$/.test(t.name)) continue;
    for (let i = 0; i < t.values.length; i += 4) {
      e.setFromQuaternion(q.fromArray(t.values, i));
      if (e.x > max) q.setFromEuler(e.set(max, e.y, e.z)).toArray(t.values, i);
    }
  }
  return c;
}
const clips = clipsFor(0, extras.hipsY, false).map((c) => (MAX_KNEE > 0 ? clampKnee(c, MAX_KNEE) : c));
if (MAX_KNEE > 0) console.log(`(joelho limitado a ${MAX_KNEE} rad)`);
const mixer = new THREE.AnimationMixer(group);
const LIMITS: Record<string, number> = { andar: 2.5, correr: 4 };
let failed = false;
console.log(`${path}: ${I.length / 3} triângulos; esqueleto ${sameSkeleton ? 'igual a BONES' : 'DIFERENTE'}, repouso ${identity ? 'em rotações identidade' : 'COM ROTAÇÕES'}; ` +
  `${skirtEdges.length} arestas de saia, ${legVerts.length} vértices de canela/pé`);
const jointPos = (b: string) => bones.get(b)!.getWorldPosition(new THREE.Vector3());
for (const [ai, name] of [[-1, 'repouso'], [ANIM.idle, 'parado'], [ANIM.walk, 'andar'], [ANIM.run, 'correr'], [ANIM.wave, 'acenar'], [ANIM.dance, 'dançar']] as const) {
  mixer.stopAllAction();
  for (const b of bones.values()) b.quaternion.identity();
  bones.get('hips')!.position.fromArray(jointNodes[0].getTranslation());
  const clip = ai >= 0 ? clips[ai] : null;
  if (clip) mixer.clipAction(clip).reset().play();
  const frames = clip ? FRAMES : 1;
  let maxS = 0, over2 = 0, over25 = 0, over3 = 0, minY = Infinity, pierceMax = 0, exposedMax = 0;
  let worst: { s: number; t: number; at: string } = { s: 0, t: 0, at: '' };
  const pierceAt: string[] = [];
  const exposedAt: string[] = [];
  for (let f = 0; f < frames; f++) {
    const t = clip ? (f / frames) * clip.duration : 0;
    if (clip) mixer.setTime(t);
    pose();
    for (let i = 0; i < n; i++) minY = Math.min(minY, cur[i * 3 + 1]);
    skirtEdges.forEach(([a, b], k) => {
      if (restLen[k] < 0.002) return;
      const r = Math.hypot(cur[a * 3] - cur[b * 3], cur[a * 3 + 1] - cur[b * 3 + 1], cur[a * 3 + 2] - cur[b * 3 + 2]) / restLen[k];
      if (r > 2) over2++;
      if (r > 2.5) over25++;
      if (r > 3) over3++;
      if (r > maxS) (maxS = r), (worst = { s: r, t: f / frames, at: `(${[P[a * 3], P[a * 3 + 1], P[a * 3 + 2]].map((x) => x.toFixed(3)).join(', ')})` });
    });
    // pernas atravessando o pano
    const g = gridOf(skirtTris);
    let pierce = 0;
    for (const S of ['L', 'R'] as const) {
      const hip = jointPos(`upperLeg${S}`), knee = jointPos(`lowerLeg${S}`);
      const thigh = segmentCrosses(g, hip, knee);
      for (const i of legVerts) {
        if (legSide[i] !== (S === 'L' ? 1 : -1)) continue;
        if (thigh || segmentCrosses(g, knee, new THREE.Vector3().fromArray(cur, i * 3))) {
          pierce++;
          if (process.env.CHECK_DEBUG && pierce % 10 === 1) {
            const c = [0, 1, 2].map((j) => ((P[I[lastHit] * 3 + j] + P[I[lastHit + 1] * 3 + j] + P[I[lastHit + 2] * 3 + j]) / 3).toFixed(3));
            console.log(`  atravessa ${name} t=${(f / frames).toFixed(2)} ${S}${thigh ? ' (coxa)' : ''}: vértice em repouso (${[P[i * 3], P[i * 3 + 1], P[i * 3 + 2]].map((x) => x.toFixed(3)).join(', ')}) → pano em repouso (${c.join(', ')})`);
          }
        }
      }
    }
    if (pierce) pierceAt.push(`${(f / frames).toFixed(2)}:${pierce}`);
    pierceMax = Math.max(pierceMax, pierce);
    // medida dos avaliadores: canela/pé acima de 0,25 m sem pano na horizontal para fora
    let exposed = 0;
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    for (const i of legVerts) {
      if (cur[i * 3 + 1] < 0.25) continue;
      o.fromArray(cur, i * 3);
      d.set(o.x, 0, o.z);
      if (d.lengthSq() < 1e-8) continue;
      if (!rayOut(o, d.normalize())) {
        exposed++;
        if (process.env.CHECK_DEBUG && name === 'repouso') console.log('  exposto', i, [...o.toArray()].map((x) => x.toFixed(3)).join(', '));
      }
    }
    if (exposed) exposedAt.push(`${(f / frames).toFixed(2)}:${exposed}`);
    exposedMax = Math.max(exposedMax, exposed);
  }
  const lim = LIMITS[name];
  const bad = !!lim && maxS > lim;
  if (bad) failed = true;
  console.log(`\n== ${name}${bad ? '  ✗' : ''}`);
  console.log(`  saia: esticamento máx ${maxS.toFixed(2)}× (t=${worst.t.toFixed(2)}, em ${worst.at}${lim ? `; limite ${lim}×` : ''}); arestas×quadros >2×: ${over2}, >2,5×: ${over25}, >3×: ${over3}`);
  console.log(`  pernas atravessando o pano: máx ${pierceMax} vértices${pierceAt.length ? ` (${pierceAt.join(' ')})` : ''}`);
  console.log(`  canela/pé acima de 0,25 m sem pano para fora: máx ${exposedMax}${exposedAt.length ? ` (${exposedAt.join(' ')})` : ''}`);
  console.log(`  y mínimo: ${minY.toFixed(4)}`);
}
if (failed) process.exitCode = 1;
