import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ANIM } from '../../../shared/constants.ts';
import { HAIR_COLORS, PANTS, SKINS, type Look } from '../../../shared/looks.ts';

// Personagem low-poly gerado em código: peças simples coladas a um esqueleto (cada vértice segue um osso),
// numa única malha com cores por vértice. Uma chamada de desenho por personagem; animações feitas aqui mesmo.
// O personagem olha para +Z; a direita dele é -X.

export type CharacterTemplate = { root: THREE.Group; clips: THREE.AnimationClip[]; height: number };

type Dims = {
  height: number; hips: number; shoulder: number; hipWidth: number; torsoR: number; torsoLen: number;
  armR: number; legR: number; belly: number; headR: number; chest: number;
};

const DIMS: Dims[] = [
  { height: 1.76, hips: 0.93, shoulder: 0.235, hipWidth: 0.105, torsoR: 0.195, torsoLen: 0.22, armR: 0.068, legR: 0.088, belly: 0, headR: 0.138, chest: 0 },
  { height: 1.67, hips: 0.9, shoulder: 0.2, hipWidth: 0.11, torsoR: 0.165, torsoLen: 0.22, armR: 0.056, legR: 0.084, belly: 0, headR: 0.13, chest: 0.04 },
  { height: 1.72, hips: 0.9, shoulder: 0.245, hipWidth: 0.11, torsoR: 0.21, torsoLen: 0.2, armR: 0.07, legR: 0.09, belly: 0.17, headR: 0.14, chest: 0 },
];

const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR',
  'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR',
] as const;
type BoneName = (typeof BONES)[number];
const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;

const BRASIL = { green: '#1f9d55', yellow: '#f7d117', blue: '#1d4f9c', white: '#ffffff' };

class Builder {
  readonly parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, bone: number, color: string, at: THREE.Vector3, opts: { rot?: THREE.Euler; scale?: THREE.Vector3 } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(
      at, new THREE.Quaternion().setFromEuler(opts.rot ?? new THREE.Euler()), opts.scale ?? new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const c = new THREE.Color(color).convertSRGBToLinear();
    const colors = new Float32Array(n * 3);
    const idx = new Uint16Array(n * 4);
    const wts = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      colors.set([c.r, c.g, c.b], i * 3);
      idx[i * 4] = bone;
      wts[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(wts, 4));
    this.parts.push(g);
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const capsule = (r: number, len: number, seg = 7) => new THREE.CapsuleGeometry(r, len, 3, seg);
const sphere = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

function flat(points: [number, number][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Posições dos ossos no modelo (pose de referência, braços para baixo). */
function jointPositions(d: Dims): Record<BoneName, THREE.Vector3> {
  const s = d.height / 1.76;
  const hipsY = d.hips;
  const chestY = hipsY + 0.3 * s;
  const shoulderY = hipsY + 0.47 * s;
  const neckY = shoulderY + 0.03;
  const armLen = 0.28 * s;
  const foreLen = 0.25 * s;
  const legLen = (hipsY - 0.06) / 2;
  return {
    hips: V(0, hipsY, 0),
    spine: V(0, hipsY + 0.12 * s, 0),
    chest: V(0, chestY, 0),
    neck: V(0, neckY, 0),
    head: V(0, neckY + 0.07, 0),
    upperArmL: V(d.shoulder, shoulderY - 0.03, 0),
    foreArmL: V(d.shoulder + 0.02, shoulderY - 0.03 - armLen, 0),
    handL: V(d.shoulder + 0.03, shoulderY - 0.03 - armLen - foreLen, 0),
    upperArmR: V(-d.shoulder, shoulderY - 0.03, 0),
    foreArmR: V(-d.shoulder - 0.02, shoulderY - 0.03 - armLen, 0),
    handR: V(-d.shoulder - 0.03, shoulderY - 0.03 - armLen - foreLen, 0),
    upperLegL: V(d.hipWidth, hipsY - 0.04, 0),
    lowerLegL: V(d.hipWidth, hipsY - 0.04 - legLen, 0),
    footL: V(d.hipWidth, 0.06, 0),
    upperLegR: V(-d.hipWidth, hipsY - 0.04, 0),
    lowerLegR: V(-d.hipWidth, hipsY - 0.04 - legLen, 0),
    footR: V(-d.hipWidth, 0.06, 0),
  };
}

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  upperArmL: 'chest', foreArmL: 'upperArmL', handL: 'foreArmL',
  upperArmR: 'chest', foreArmR: 'upperArmR', handR: 'foreArmR',
  upperLegL: 'hips', lowerLegL: 'upperLegL', footL: 'lowerLegL',
  upperLegR: 'hips', lowerLegR: 'upperLegR', footR: 'lowerLegR',
};

function segment(b: Builder, from: THREE.Vector3, to: THREE.Vector3, r: number, bone: number, color: string) {
  const len = from.distanceTo(to);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const dir = to.clone().sub(from).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
  b.add(capsule(r, Math.max(0.01, len - r)), bone, color, mid, { rot: new THREE.Euler().setFromQuaternion(q) });
}

function shirtColors(look: Look, team: { color: string; accent: string }) {
  switch (look.shirt) {
    case 1: return { body: BRASIL.yellow, trim: BRASIL.green, sleeves: true };
    case 2: return { body: '#f4f4f0', trim: '#d9d9d2', sleeves: true };
    case 3: return { body: team.color, trim: team.accent, sleeves: false };
    case 4: return { body: '#23262d', trim: '#f4f4f0', sleeves: true };
    case 5: return { body: '#b9d3ea', trim: '#ffffff', sleeves: true };
    case 6: return { body: '#7c838c', trim: '#5f656d', sleeves: true };
    default: return { body: team.color, trim: team.accent, sleeves: true };
  }
}

function addFlag(b: Builder, look: Look, hand: THREE.Vector3, team: { color: string; accent: string }) {
  if (look.flag === 0) return;
  const h = B.handR;
  const poleTop = hand.clone().add(V(0, 0.95, 0.04));
  b.add(new THREE.CylinderGeometry(0.012, 0.012, 1.25, 6), h, '#8b6b45', hand.clone().add(V(0, 0.33, 0.04)));
  const cx = poleTop.x - 0.3; // a bandeira fica do lado de fora (direita, -X)
  const cy = poleTop.y - 0.18;
  const z = poleTop.z;
  if (look.flag === 1) {
    b.add(box(0.58, 0.4, 0.012), h, BRASIL.green, V(cx, cy, z));
    b.add(flat([[0, 0.17], [0.25, 0], [0, -0.17], [-0.25, 0]], 0.024), h, BRASIL.yellow, V(cx, cy, z));
    b.add(new THREE.CylinderGeometry(0.095, 0.095, 0.034, 14), h, BRASIL.blue, V(cx, cy, z), { rot: new THREE.Euler(Math.PI / 2, 0, 0) });
  } else if (look.flag === 2) {
    b.add(box(0.58, 0.4, 0.012), h, team.color, V(cx, cy, z));
    b.add(box(0.58, 0.12, 0.022), h, team.accent, V(cx, cy, z));
  } else {
    // Cartaz: placa clara com moldura e "linhas de texto" na cor do time.
    b.add(box(0.62, 0.44, 0.02), h, team.color, V(cx, cy, z));
    b.add(box(0.56, 0.38, 0.03), h, '#f6f2e8', V(cx, cy, z));
    for (let i = 0; i < 3; i++) b.add(box(0.42 - i * 0.08, 0.05, 0.036), h, team.color, V(cx, cy + 0.1 - i * 0.1, z));
  }
}

function addHair(b: Builder, look: Look, head: THREE.Vector3, r: number) {
  const color = HAIR_COLORS[look.hairColor];
  const h = B.head;
  const top = head.clone().add(V(0, r * 0.95, 0));
  // Calota que cobre o alto e a nuca, deixando a testa livre (inclinada para trás).
  const cap = (scale: number) =>
    b.add(new THREE.SphereGeometry(r * scale, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), h, color,
      top.clone().add(V(0, -r * 0.95 + 0.01, -r * 0.06)), { rot: new THREE.Euler(-0.32, 0, 0) });
  switch (look.hair) {
    case 0: cap(1.04); break; // raspado
    case 1: cap(1.1); break; // curto
    case 2: // topete
      cap(1.1);
      b.add(box(r * 1.3, r * 0.45, r * 0.8), h, color, top.clone().add(V(0, 0.02, r * 0.45)), { rot: new THREE.Euler(-0.35, 0, 0) });
      break;
    case 3: // longo
      cap(1.12);
      b.add(box(r * 2.05, r * 2.4, r * 0.7), h, color, head.clone().add(V(0, -r * 0.5, -r * 0.55)));
      break;
    case 4: // rabo de cavalo
      cap(1.12);
      b.add(sphere(r * 0.35), h, color, head.clone().add(V(0, r * 0.35, -r * 1.05)));
      b.add(capsule(r * 0.22, r * 1.2), h, color, head.clone().add(V(0, -r * 0.55, -r * 1.12)));
      break;
    default: // careca: só as laterais
      b.add(new THREE.TorusGeometry(r * 0.98, r * 0.16, 5, 14, Math.PI * 1.15), h, color, head.clone().add(V(0, -r * 0.05, -0.01)), { rot: new THREE.Euler(Math.PI / 2, 0, Math.PI * 0.92) });
  }
}

function addBeard(b: Builder, look: Look, head: THREE.Vector3, r: number) {
  if (look.beard === 0) return;
  const color = HAIR_COLORS[look.hairColor];
  const h = B.head;
  const front = head.clone().add(V(0, -r * 0.35, r * 0.82));
  if (look.beard === 1 || look.beard === 2) b.add(box(r * 0.75, r * 0.13, r * 0.12), h, color, front.clone().add(V(0, r * 0.12, 0.02)));
  if (look.beard === 2) b.add(box(r * 0.4, r * 0.32, r * 0.14), h, color, front.clone().add(V(0, -r * 0.32, 0)));
  if (look.beard >= 3) {
    const k = look.beard === 4 ? 1.07 : 1.02;
    const from = look.beard === 4 ? 0.64 : 0.7;
    b.add(new THREE.SphereGeometry(r * k, 12, 6, Math.PI * 0.12, Math.PI * 0.76, Math.PI * from, Math.PI * (0.97 - from)), h, color, head.clone());
    b.add(box(r * 0.75, r * 0.13, r * 0.12), h, color, head.clone().add(V(0, -r * 0.23, r * 0.84)));
  }
}

function addExtra(b: Builder, look: Look, head: THREE.Vector3, r: number, team: { color: string; accent: string }) {
  const h = B.head;
  const eyes = head.clone().add(V(0, r * 0.12, r * 0.95));
  switch (look.extra) {
    case 1:
    case 2: {
      const lens = look.extra === 2 ? '#111111' : '#cfe3f0';
      for (const x of [-1, 1]) b.add(box(r * 0.42, r * 0.3, 0.012), h, lens, eyes.clone().add(V(x * r * 0.36, 0, 0.01)));
      b.add(box(r * 1.5, r * 0.06, 0.02), h, '#1a1a1a', eyes.clone().add(V(0, r * 0.13, 0.012)));
      for (const x of [-1, 1]) b.add(box(0.01, 0.012, r * 0.9), h, '#1a1a1a', eyes.clone().add(V(x * r * 0.86, r * 0.12, -r * 0.45)));
      break;
    }
    case 3: // boné
      addHair(b, { ...look, hair: Math.min(look.hair, 1) }, head, r);
      b.add(new THREE.SphereGeometry(r * 1.12, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), h, team.color, head.clone().add(V(0, r * 0.18, -0.005)));
      b.add(box(r * 1.5, 0.014, r * 0.9), h, team.accent, head.clone().add(V(0, r * 0.22, r * 1.05)), { rot: new THREE.Euler(0.12, 0, 0) });
      break;
    case 4: // fone
      b.add(new THREE.TorusGeometry(r * 1.08, 0.014, 5, 16, Math.PI), h, '#1f1f1f', head.clone().add(V(0, r * 0.05, 0)));
      for (const x of [-1, 1]) b.add(new THREE.CylinderGeometry(r * 0.32, r * 0.32, 0.05, 10), h, '#2b2b2b', head.clone().add(V(x * r * 1.02, 0, 0)), { rot: new THREE.Euler(0, 0, Math.PI / 2) });
      break;
    case 5: // chapéu de palha
      b.add(new THREE.CylinderGeometry(r * 2.1, r * 2.1, 0.015, 16), h, '#d9b968', head.clone().add(V(0, r * 0.5, 0)));
      b.add(new THREE.CylinderGeometry(r * 0.9, r * 1.02, r * 0.7, 14), h, '#d9b968', head.clone().add(V(0, r * 0.82, 0)));
      b.add(new THREE.CylinderGeometry(r * 1.03, r * 1.03, r * 0.16, 14), h, team.color, head.clone().add(V(0, r * 0.6, 0)));
      break;
  }
}

export function buildCharacter(look: Look, team: { color: string; accent: string }): CharacterTemplate {
  const d = DIMS[look.body] ?? DIMS[0];
  const J = jointPositions(d);
  const b = new Builder();
  const skin = SKINS[look.skin];
  const pants = PANTS[look.pants];
  const shirt = shirtColors(look, team);
  const s = d.height / 1.76;

  // Tronco e quadril
  b.add(capsule(d.torsoR, d.torsoLen, 12), B.chest, shirt.body, J.chest.clone().add(V(0, 0.03, 0)), { scale: V(1.1, 1, 0.78) });
  b.add(capsule(d.torsoR * 0.94, 0.1, 12), B.spine, shirt.body, J.spine.clone(), { scale: V(1.04, 1, 0.78) });
  b.add(new THREE.TorusGeometry(0.06, 0.016, 5, 12), B.chest, shirt.trim, J.neck.clone().add(V(0, -0.025, 0.005)), { rot: new THREE.Euler(Math.PI / 2, 0, 0), scale: V(1.2, 0.9, 1) });
  if (look.shirt === 0) b.add(capsule(d.torsoR * 1.01, 0.02, 10), B.chest, shirt.trim, J.chest.clone().add(V(0, -0.03, 0)), { scale: V(1.08, 1, 0.73) });
  if (look.shirt === 4) {
    // terno: camisa branca, gravata e lapelas
    b.add(box(0.1, 0.24, 0.02), B.chest, '#f4f4f0', J.chest.clone().add(V(0, 0.04, d.torsoR * 0.72)));
    b.add(box(0.035, 0.2, 0.03), B.chest, team.color, J.chest.clone().add(V(0, 0.03, d.torsoR * 0.73)));
  }
  if (look.shirt === 5) for (let i = 0; i < 4; i++) b.add(sphere(0.008, 5, 4), B.chest, '#ffffff', J.chest.clone().add(V(0, 0.12 - i * 0.07, d.torsoR * 0.73)));
  if (look.shirt === 6) b.add(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), B.chest, shirt.trim, J.neck.clone().add(V(0, -0.02, -0.09)), { rot: new THREE.Euler(-1.9, 0, 0) });
  if (look.shirt === 1) b.add(new THREE.CircleGeometry(0.035, 10), B.chest, BRASIL.blue, J.chest.clone().add(V(0.06, 0.07, d.torsoR * 0.73 + 0.003)));
  if (d.belly > 0) b.add(sphere(d.belly, 14, 10), B.spine, shirt.body, J.spine.clone().add(V(0, 0.04, d.torsoR * 0.18)), { scale: V(1.2, 1.05, 1) });
  if (d.chest > 0) {
    for (const x of [-0.065, 0.065]) b.add(sphere(d.chest, 10, 8), B.chest, shirt.body, J.chest.clone().add(V(x, 0.04, d.torsoR * 0.52)), { scale: V(1, 0.9, 0.8) });
  }
  b.add(capsule(d.torsoR * 0.92, 0.06, 12), B.hips, pants, J.hips.clone().add(V(0, -0.02, 0)), { scale: V(1.08, 1, 0.8) });
  b.add(new THREE.CylinderGeometry(d.torsoR * 0.97, d.torsoR * 0.97, 0.035, 14), B.hips, '#3b2a1e', J.hips.clone().add(V(0, 0.045, 0)), { scale: V(1.1, 1, 0.82) }); // cinto

  // Pescoço e cabeça
  const r = d.headR;
  const headC = J.head.clone().add(V(0, r * 0.95, 0.01));
  b.add(new THREE.CylinderGeometry(0.055, 0.062, 0.09, 8), B.neck, skin, J.neck.clone().add(V(0, 0.035, 0)));
  b.add(sphere(r, 14, 10), B.head, skin, headC, { scale: V(0.92, 1.05, 1) });
  b.add(box(r * 0.22, r * 0.32, r * 0.25), B.head, skin, headC.clone().add(V(0, -0.01, r * 0.93))); // nariz
  for (const x of [-1, 1]) {
    b.add(sphere(r * 0.12, 6, 5), B.head, '#1b1b1b', headC.clone().add(V(x * r * 0.36, r * 0.12, r * 0.88)));
    b.add(box(r * 0.38, r * 0.07, r * 0.08), B.head, HAIR_COLORS[look.hairColor], headC.clone().add(V(x * r * 0.36, r * 0.33, r * 0.88))); // sobrancelha
    b.add(sphere(r * 0.18, 6, 5), B.head, skin, headC.clone().add(V(x * r * 0.92, 0, 0)), { scale: V(0.5, 1, 0.8) }); // orelha
  }
  b.add(box(r * 0.42, r * 0.06, r * 0.06), B.head, '#8c3b33', headC.clone().add(V(0, -r * 0.42, r * 0.88))); // boca
  if (look.extra !== 3 && look.extra !== 5) addHair(b, look, headC, r);
  addBeard(b, look, headC, r);
  addExtra(b, look, headC, r, team);

  // Braços
  for (const [side, up, fore, hand] of [['L', B.upperArmL, B.foreArmL, B.handL], ['R', B.upperArmR, B.foreArmR, B.handR]] as const) {
    const pu = J[`upperArm${side}`];
    const pf = J[`foreArm${side}`];
    const ph = J[`hand${side}`];
    b.add(sphere(d.armR * 1.08, 8, 6), up, shirt.sleeves ? shirt.body : skin, pu.clone()); // ombro
    if (shirt.sleeves) {
      const sleeveEnd = pu.clone().lerp(pf, 0.55);
      segment(b, pu, sleeveEnd, d.armR * 1.12, up, shirt.body);
      segment(b, sleeveEnd, pf, d.armR, up, skin);
    } else {
      segment(b, pu, pf, d.armR, up, skin);
    }
    segment(b, pf, ph, d.armR * 0.9, fore, skin);
    b.add(sphere(d.armR * 1.15, 8, 6), hand, skin, ph.clone().add(V(0, -0.045, 0)), { scale: V(0.8, 1.15, 1) });
  }

  // Pernas
  for (const [side, up, low, foot] of [['L', B.upperLegL, B.lowerLegL, B.footL], ['R', B.upperLegR, B.lowerLegR, B.footR]] as const) {
    const pu = J[`upperLeg${side}`];
    const pl = J[`lowerLeg${side}`];
    const pf = J[`foot${side}`];
    if (look.legs === 1) {
      // bermuda e chinelo
      const knee = pu.clone().lerp(pl, 1.12);
      segment(b, pu, knee, d.legR * 1.2, up, pants);
      segment(b, pl, pf, d.legR * 0.75, low, skin);
      b.add(box(0.075, 0.05, 0.17), foot, skin, pf.clone().add(V(0, -0.03, 0.04)));
      b.add(box(0.1, 0.018, 0.25), foot, look.shirt === 1 ? BRASIL.green : '#2c64b8', pf.clone().add(V(0, -0.058, 0.04)));
    } else {
      segment(b, pu, pl, d.legR * 1.05, up, pants);
      segment(b, pl, pf, d.legR * 0.9, low, pants);
      const shoe = look.shirt === 4 ? '#1a1a1a' : '#f2f2f2';
      b.add(box(0.1, 0.07, 0.24), foot, shoe, pf.clone().add(V(0, -0.025, 0.04)));
      b.add(box(0.105, 0.02, 0.25), foot, '#3a3a3a', pf.clone().add(V(0, -0.055, 0.04)));
    }
  }

  addFlag(b, look, J.handR, team);

  const geo = mergeGeometries(b.parts, false)!;
  for (const g of b.parts) g.dispose();
  geo.computeBoundingSphere();

  const bones: THREE.Bone[] = [];
  const byName = new Map<BoneName, THREE.Bone>();
  for (const name of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const parent = PARENT[name];
    const pos = J[name].clone();
    if (parent) pos.sub(J[parent]);
    bone.position.copy(pos);
    bones.push(bone);
    byName.set(name, bone);
    if (parent) byName.get(parent)!.add(bone);
  }
  const mesh = new THREE.SkinnedMesh(geo, MATERIAL);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.add(mesh);
  return { root, clips: clipsFor(look.body, J.hips.y), height: d.height };
}

const MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });

// ---------- animações ----------

type Pose = Partial<Record<BoneName, [number, number, number]>>;
const q = new THREE.Quaternion();
const e = new THREE.Euler();

/** Clip a partir de poses-chave (rotações de Euler por osso) e da altura do quadril em cada chave. */
function clip(name: string, duration: number, keys: Pose[], hipsY: number, bob: number[] = []): THREE.AnimationClip {
  const times = keys.map((_, i) => (i / (keys.length - 1)) * duration);
  const tracks: THREE.KeyframeTrack[] = [];
  const used = new Set<BoneName>();
  for (const k of keys) for (const n of Object.keys(k) as BoneName[]) used.add(n);
  for (const n of used) {
    const values: number[] = [];
    for (const k of keys) {
      const [x, y, z] = k[n] ?? [0, 0, 0];
      q.setFromEuler(e.set(x, y, z));
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, values));
  }
  if (bob.length === keys.length) {
    tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, bob.flatMap((y) => [0, hipsY + y, 0])));
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

function gait(name: string, duration: number, legA: number, kneeA: number, armA: number, elbow: number, lean: number, hipsY: number, bobA: number) {
  // 0: perna esquerda à frente; 2: perna direita à frente.
  const pose = (legL: number, kneeL: number, kneeR: number, bob: number): Pose => ({
    upperLegL: [-legL, 0, 0], upperLegR: [legL, 0, 0],
    lowerLegL: [kneeL, 0, 0], lowerLegR: [kneeR, 0, 0],
    upperArmL: [legL * armA, 0, 0.06], upperArmR: [-legL * armA, 0, -0.06],
    foreArmL: [-elbow, 0, 0], foreArmR: [-elbow, 0, 0],
    spine: [lean, legL * 0.12, 0], hips: [0, -legL * 0.1, 0], head: [-lean * 0.6, 0, 0],
    footL: [kneeL * -0.3, 0, 0], footR: [kneeR * -0.3, 0, 0],
    chest: [0, 0, bob * 0],
  });
  const keys = [
    pose(legA, 0.1, 0.15, 0),
    pose(0, 0.15, kneeA, bobA),
    pose(-legA, 0.15, 0.1, 0),
    pose(0, kneeA, 0.15, bobA),
    pose(legA, 0.1, 0.15, 0),
  ];
  return clip(name, duration, keys, hipsY, [0, bobA, 0, bobA, 0]);
}

const clipCache = new Map<string, THREE.AnimationClip[]>();

function clipsFor(body: number, hipsY: number): THREE.AnimationClip[] {
  const key = `${body}:${hipsY.toFixed(3)}`;
  const cached = clipCache.get(key);
  if (cached) return cached;
  const rest: Pose = { upperArmL: [0, 0, 0.08], upperArmR: [0, 0, -0.08], foreArmL: [-0.15, 0, 0], foreArmR: [-0.15, 0, 0] };
  const idle = clip('idle', 3, [
    { ...rest, chest: [0, 0, 0], head: [0, 0, 0] },
    { ...rest, upperArmL: [0, 0, 0.11], upperArmR: [0, 0, -0.11], chest: [-0.03, 0, 0], head: [0.03, 0.15, 0] },
    { ...rest, chest: [0, 0, 0], head: [0, 0, 0] },
    { ...rest, chest: [-0.02, 0, 0], head: [0.02, -0.15, 0] },
    { ...rest, chest: [0, 0, 0], head: [0, 0, 0] },
  ], hipsY, [0, -0.008, 0, -0.006, 0]);
  const walk = gait('walk', 1.0, 0.42, 0.65, 0.75, 0.25, 0.04, hipsY, 0.03);
  const run = gait('run', 0.62, 0.75, 1.3, 1.1, 1.3, 0.22, hipsY, 0.06);
  const wave = clip('wave', 1.2, [0, 1, 2, 3, 4].map((i): Pose => ({
    ...rest,
    upperArmR: [0, 0, -2.75],
    foreArmR: [0, 0, i % 2 === 0 ? -0.45 : 0.35],
    handR: [0, 0, i % 2 === 0 ? -0.2 : 0.2],
    head: [0.05, -0.2, 0.05],
    spine: [0, 0, 0.04],
  })), hipsY, [0, 0, 0, 0, 0]);
  const dance = clip('dance', 1.0, [0, 1, 2, 3, 4].map((i): Pose => {
    const s = i % 2 === 0 ? 1 : -1;
    const down = i % 2 === 1;
    return {
      hips: [0, s * 0.3, 0],
      spine: [0, -s * 0.15, s * 0.08],
      head: [down ? 0.15 : -0.05, s * 0.15, 0],
      upperArmL: [s > 0 ? -1.4 : -0.3, 0, 0.9],
      upperArmR: [s > 0 ? -0.3 : -1.4, 0, -0.9],
      foreArmL: [-1.3, 0, 0],
      foreArmR: [-1.3, 0, 0],
      upperLegL: [down ? -0.45 : -0.1, 0, 0.08],
      upperLegR: [down ? -0.45 : -0.1, 0, -0.08],
      lowerLegL: [down ? 0.8 : 0.15, 0, 0],
      lowerLegR: [down ? 0.8 : 0.15, 0, 0],
      footL: [down ? -0.35 : 0, 0, 0],
      footR: [down ? -0.35 : 0, 0, 0],
    };
  }), hipsY, [0, -0.09, 0, -0.09, 0]);
  const list: THREE.AnimationClip[] = [];
  list[ANIM.idle] = idle;
  list[ANIM.walk] = walk;
  list[ANIM.run] = run;
  list[ANIM.wave] = wave;
  list[ANIM.dance] = dance;
  clipCache.set(key, list);
  return list;
}
