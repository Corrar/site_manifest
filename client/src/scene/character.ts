import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadedModel } from './models.ts';
import { ANIM } from '../../../shared/constants.ts';
import { MODEL_BODIES, HAIR_COLORS, PANTS, SKINS, type Look } from '../../../shared/looks.ts';

// Personagem semi-realista gerado em código. Tronco, membros e cabeça são superfícies contínuas (anéis de seção
// elíptica varridos ao longo dos ossos), com pesos divididos entre dois ossos perto das articulações para dobrar
// sem quebrar. Roupas são cascas um pouco maiores que o corpo. Uma malha com esqueleto e cores por vértice e até
// três materiais (pele, tecido e bandeira): no máximo três chamadas de desenho. Animações feitas aqui mesmo.
// O personagem olha para +Z; a direita dele é -X.

/** `shared`: a geometria pertence a um modelo carregado e é reaproveitada; quem usa o template não deve descartá-la. */
export type CharacterTemplate = { root: THREE.Group; clips: THREE.AnimationClip[]; height: number; shared?: boolean };

type Team = { color: string; accent: string };
type V3 = THREE.Vector3;
/** Pares (osso, peso); normalizados na hora de gravar. */
type W = [number, number][];

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR',
  'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR',
] as const;
export type BoneName = (typeof BONES)[number];
const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;

export const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  upperArmL: 'chest', foreArmL: 'upperArmL', handL: 'foreArmL',
  upperArmR: 'chest', foreArmR: 'upperArmR', handR: 'foreArmR',
  upperLegL: 'hips', lowerLegL: 'upperLegL', footL: 'lowerLegL',
  upperLegR: 'hips', lowerLegR: 'upperLegR', footR: 'lowerLegR',
};

const BRASIL = { green: '#1f9d55', yellow: '#f7d117', blue: '#1d4f9c', white: '#ffffff' };

// Materiais (grupos da malha): pele e partes lisas, tecido (com textura de trama) e bandeiras (dupla face).
const SKIN = 0;
const CLOTH = 1;
const FLAG = 2;

// ---------- utilidades ----------

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gauss = (x: number, s: number) => Math.exp(-(x * x) / (s * s));
const parsed = new Map<string, THREE.Color>();
/** Cor nova (cópia), com as strings já convertidas guardadas: a conversão é a parte cara. */
const col = (c: string | THREE.Color) => {
  if (typeof c !== 'string') return c.clone();
  let p = parsed.get(c);
  if (!p) parsed.set(c, (p = new THREE.Color(c)));
  return p.clone();
};
const mix = (a: string | THREE.Color, b: string | THREE.Color, t: number) => col(a).lerp(col(b), t);
const shade = (c: string | THREE.Color, k: number) => col(c).multiplyScalar(k);
/** Ruído determinístico por posição (variação de cor de tecido, fios de cabelo, palha). */
function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 1271.1 + y * 3117.7 + z * 747.3) * 43758.5453;
  return h - Math.floor(h);
}
/** Interpolação linear numa tabela [x, y] ordenada por x. */
function table(t: [number, number][], x: number): number {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) return lerp(t[i - 1][1], t[i][1], (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]));
  }
  return t[t.length - 1][1];
}

type ColorArg = string | THREE.Color | ((p: V3, i: number) => THREE.Color);
type WeightArg = number | W | ((p: V3, i: number) => W);

/** Junta as peças por material; cada peça já sai com cor, UV e pesos por vértice. */
class Builder {
  readonly parts: THREE.BufferGeometry[][] = [[], [], []];

  add(geo: THREE.BufferGeometry, mat: number, color: ColorArg, weights: WeightArg, opts: { m?: THREE.Matrix4; smooth?: boolean } = {}) {
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    const n = geo.attributes.position.count;
    if (!geo.index) geo.setIndex([...Array(n).keys()]);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (opts.m) geo.applyMatrix4(opts.m);
    if (opts.smooth !== false || !geo.attributes.normal) {
      geo.computeVertexNormals();
      weldNormals(geo);
    }
    const pos = geo.attributes.position;
    const colors = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const p = new THREE.Vector3();
    const fixedC = typeof color === 'function' ? null : col(color);
    const fixedW: W | null = typeof weights === 'function' ? null : typeof weights === 'number' ? [[weights, 1]] : weights;
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      const c = fixedC ?? (color as (p: V3, i: number) => THREE.Color)(p, i);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      writeWeights(si, sw, i, fixedW ?? (weights as (p: V3, i: number) => W)(p, i));
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.parts[mat].push(geo);
  }
}

const wb = [0, 0, 0, 0, 0, 0, 0, 0];
const ww = [0, 0, 0, 0, 0, 0, 0, 0];

/** Soma pesos de ossos repetidos, fica com os quatro maiores e normaliza. */
function writeWeights(si: Uint16Array, sw: Float32Array, i: number, w: W) {
  let n = 0;
  for (const [b, x] of w) {
    if (x <= 1e-4) continue;
    let k = 0;
    while (k < n && wb[k] !== b) k++;
    if (k === n) {
      if (n === wb.length) continue;
      wb[n] = b;
      ww[n++] = 0;
    }
    ww[k] += x;
  }
  if (!n) {
    sw[i * 4] = 1;
    return;
  }
  let sum = 0;
  for (let slot = 0; slot < 4 && slot < n; slot++) {
    let best = slot;
    for (let k = slot + 1; k < n; k++) if (ww[k] > ww[best]) best = k;
    [wb[slot], wb[best]] = [wb[best], wb[slot]];
    [ww[slot], ww[best]] = [ww[best], ww[slot]];
    sum += ww[slot];
  }
  for (let slot = 0; slot < 4 && slot < n; slot++) {
    si[i * 4 + slot] = wb[slot];
    sw[i * 4 + slot] = ww[slot] / sum;
  }
}

/** Normais suaves também nas costuras (vértices repetidos na mesma posição). */
function weldNormals(g: THREE.BufferGeometry) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const groups = new Map<number, number[]>();
  const q = (v: number) => Math.round(v * 1e4) + 32768; // décimo de milímetro, cabe em 16 bits
  for (let i = 0; i < pos.count; i++) {
    const key = (q(pos.getX(i)) * 65536 + q(pos.getY(i))) * 65536 + q(pos.getZ(i));
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const n = new THREE.Vector3();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    n.set(0, 0, 0);
    for (const i of list) n.x += nrm.getX(i), n.y += nrm.getY(i), n.z += nrm.getZ(i);
    n.normalize();
    for (const i of list) nrm.setXYZ(i, n.x, n.y, n.z);
  }
}

// ---------- varredura de anéis (tronco, membros, dedos, sapatos, cabelo) ----------

/** Anel de seção superelíptica: rx no eixo lateral, rz para a frente (rzB para trás); k é um valor livre por anel. */
type Ring = { c: V3; rx: number; rz: number; rzB?: number; n?: number; k?: number };
type Tube = { geo: THREE.BufferGeometry; k: Float32Array; a: Float32Array };

const UV_SCALE = 0.22; // metros por repetição da trama

function tube(rings: Ring[], segs: number, o: {
  front?: V3; capStart?: number; capEnd?: number; a0?: number;
  shape?: (ring: number, x: number, z: number, a: number) => [number, number];
} = {}): Tube {
  const front = o.front ?? V(0, 0, 1);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const kk: number[] = [];
  const aa: number[] = [];
  const S = segs + 1;
  const frames = rings.map((_, i) => {
    const a = rings[Math.max(0, i - 1)].c;
    const b = rings[Math.min(rings.length - 1, i + 1)].c;
    const t = b.clone().sub(a).normalize();
    let f = front;
    if (Math.abs(t.dot(f)) > 0.97) f = Math.abs(t.y) > 0.9 ? V(0, 0, 1) : V(0, 1, 0);
    const s = new THREE.Vector3().crossVectors(f, t).normalize();
    const fr = new THREE.Vector3().crossVectors(t, s).normalize();
    return { t, s, fr };
  });
  let len = 0;
  rings.forEach((r, i) => {
    if (i > 0) len += r.c.distanceTo(rings[i - 1].c);
    const { s, fr } = frames[i];
    const e = 2 / (r.n ?? 2);
    const per = Math.PI * (r.rx + (r.rz + (r.rzB ?? r.rz)) / 2);
    for (let j = 0; j <= segs; j++) {
      const a = (o.a0 ?? 0) + (j / segs) * Math.PI * 2;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      let x = r.rx * Math.sign(cs) * Math.abs(cs) ** e;
      let z = (sn >= 0 ? r.rz : r.rzB ?? r.rz) * Math.sign(sn) * Math.abs(sn) ** e;
      if (o.shape) [x, z] = o.shape(i, x, z, a);
      pos.push(r.c.x + s.x * x + fr.x * z, r.c.y + s.y * x + fr.y * z, r.c.z + s.z * x + fr.z * z);
      uv.push(((j / segs) * per) / UV_SCALE, len / UV_SCALE);
      kk.push(r.k ?? i);
      aa.push(a);
    }
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * S + j;
      idx.push(a, a + 1, a + S + 1, a, a + S + 1, a + S);
    }
  }
  const cap = (ring: number, ext: number, end: boolean) => {
    const r = rings[ring];
    const c = r.c.clone().addScaledVector(frames[ring].t, end ? ext : -ext);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    uv.push(0, len / UV_SCALE);
    kk.push(r.k ?? ring);
    aa.push(0);
    const base = ring * S;
    for (let j = 0; j < segs; j++) {
      if (end) idx.push(base + j, base + j + 1, ci);
      else idx.push(ci, base + j + 1, base + j);
    }
  };
  if (o.capStart !== undefined) cap(0, o.capStart, false);
  if (o.capEnd !== undefined) cap(rings.length - 1, o.capEnd, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return { geo, k: new Float32Array(kk), a: new Float32Array(aa) };
}

/** Tubo fino ao longo de pontos (sobrancelha, alça, cordão, armação de óculos). */
function cord(points: V3[], r: number | ((t: number) => [number, number]), segs = 6, caps = true): THREE.BufferGeometry {
  const rings = points.map((c, i): Ring => {
    const t = i / (points.length - 1);
    const [rx, rz] = typeof r === 'number' ? [r, r] : r(t);
    return { c, rx, rz };
  });
  return tube(rings, segs, caps ? { capStart: 0, capEnd: 0 } : {}).geo;
}

// ---------- texturas ----------

let fabricTex: THREE.DataTexture | null = null;
let flagTex: THREE.DataTexture | null = null;

/** Trama sutil de tecido (multiplica as cores por vértice), repetida e sem emendas. */
function fabricTexture(): THREE.DataTexture {
  if (fabricTex) return fabricTex;
  const N = 128;
  const G = 8;
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grid = Array.from({ length: G * G }, rnd);
  const g = (i: number, j: number) => grid[(j % G) * G + (i % G)];
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const gx = (x / N) * G;
      const gy = (y / N) * G;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const sx = smooth(0, 1, gx - x0);
      const sy = smooth(0, 1, gy - y0);
      const low = lerp(lerp(g(x0, y0), g(x0 + 1, y0), sx), lerp(g(x0, y0 + 1), g(x0 + 1, y0 + 1), sx), sy);
      const weave = ((x >> 1) + (y >> 1)) % 2;
      const v = 0.9 + 0.05 * low + 0.035 * rnd() + 0.015 * weave;
      const b = Math.round(Math.min(1, v) * 255);
      data.set([b, b, b, 255], (y * N + x) * 4);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return (fabricTex = t);
}

// A textura das bandeiras tem uma faixa branca embaixo (bandeira do time e mastro usam só a cor por vértice)
// e a bandeira do Brasil em cima.
const FLAG_W = 256;
const FLAG_H = 192;
const FLAG_WHITE = 16;
const FLAG_UV_WHITE = 0.03;
const flagUV = (u: number, v: number) => [u, (FLAG_WHITE + 2 + v * (FLAG_H - FLAG_WHITE - 4)) / FLAG_H] as const;

function flagTexture(): THREE.DataTexture {
  if (flagTex) return flagTex;
  const data = new Uint8Array(FLAG_W * FLAG_H * 4);
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const green = hex(BRASIL.green);
  const yellow = hex(BRASIL.yellow);
  const blue = hex(BRASIL.blue);
  const white = [255, 255, 255];
  // estrelas em posições fixas dentro do círculo, abaixo da faixa
  const stars: [number, number][] = [];
  let seed = 99;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  while (stars.length < 22) {
    const x = 10 + (rnd() - 0.5) * 6.4;
    const y = 7 + (rnd() - 0.5) * 6.4;
    if (Math.hypot(x - 10, y - 7) < 3.1 && Math.hypot(x - 8, y - 15.5) < 8.0) stars.push([x, y]);
  }
  const at = (fx: number, fy: number): number[] => {
    // unidades oficiais: 20 x 14, y para baixo
    const inRhombus = Math.abs(fx - 10) / 8.3 + Math.abs(fy - 7) / 5.3 <= 1;
    const dc = Math.hypot(fx - 10, fy - 7);
    if (dc <= 3.5) {
      const db = Math.hypot(fx - 8, fy - 15.5);
      if (db >= 8.0 && db <= 8.5) return white;
      for (const [sx, sy] of stars) if (Math.hypot(fx - sx, fy - sy) < 0.12) return white;
      return blue;
    }
    return inRhombus ? yellow : green;
  };
  for (let y = 0; y < FLAG_H; y++) {
    for (let x = 0; x < FLAG_W; x++) {
      let c = white;
      if (y >= FLAG_WHITE) {
        const acc = [0, 0, 0];
        for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const fx = ((x + ox) / FLAG_W) * 20;
          const fy = (1 - (y - FLAG_WHITE + oy) / (FLAG_H - FLAG_WHITE)) * 14;
          const s = at(fx, fy);
          acc[0] += s[0] / 4;
          acc[1] += s[1] / 4;
          acc[2] += s[2] / 4;
        }
        c = acc.map(Math.round);
      }
      data.set([c[0], c[1], c[2], 255], (y * FLAG_W + x) * 4);
    }
  }
  const t = new THREE.DataTexture(data, FLAG_W, FLAG_H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return (flagTex = t);
}

let materials: THREE.Material[] | null = null;

function getMaterials(): THREE.Material[] {
  if (materials) return materials;
  materials = [
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, map: fabricTexture() }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, map: flagTexture(), side: THREE.DoubleSide }),
  ];
  return materials;
}

// ---------- proporções ----------

type HeadDims = { w: number; top: number; chin: number; front: number; back: number; jaw: number; fem: boolean };

type Body = {
  height: number;
  s: number; // escala vertical em relação ao homem de 1,76 m
  shoulderX: number; elbowX: number; wristX: number; hipX: number; kneeIn: number;
  /** [y na escala de 1,76 m, meia largura, profundidade à frente, profundidade atrás, expoente da seção] */
  torso: number[][];
  neck: number; arm: number; thigh: number; calf: number; hand: number;
  bust: number;
  head: HeadDims;
};

// Cabeça ≈ 1/7,5 da altura; ombros, cintura e quadril em medidas de adulto.
const BODY: Body[] = [
  { // homem
    height: 1.76, s: 1, shoulderX: 0.178, elbowX: 0.22, wristX: 0.238, hipX: 0.092, kneeIn: 0,
    torso: [
      [0.8, 0.07, 0.06, 0.06, 2], [0.84, 0.14, 0.094, 0.1, 2.3], [0.89, 0.169, 0.098, 0.112, 2.3], [0.95, 0.17, 0.093, 0.106, 2.3],
      [1.01, 0.152, 0.092, 0.094, 2.3], [1.08, 0.145, 0.094, 0.088, 2.3], [1.15, 0.151, 0.1, 0.088, 2.4], [1.22, 0.161, 0.112, 0.095, 2.4],
      [1.29, 0.167, 0.118, 0.102, 2.4], [1.35, 0.166, 0.117, 0.106, 2.4], [1.41, 0.162, 0.103, 0.104, 2.4],
      [1.455, 0.145, 0.08, 0.09, 2.3], [1.485, 0.1, 0.06, 0.072, 2.1], [1.505, 0.06, 0.05, 0.055, 2],
    ],
    neck: 0.056, arm: 1, thigh: 1, calf: 1, hand: 1, bust: 0,
    head: { w: 0.077, top: 0.114, chin: 0.116, front: 0.093, back: 0.102, jaw: 0.9, fem: false },
  },
  { // mulher: ombros mais estreitos, cintura fina, quadril largo
    height: 1.67, s: 1.67 / 1.76, shoulderX: 0.16, elbowX: 0.2, wristX: 0.222, hipX: 0.09, kneeIn: 0.012,
    torso: [
      [0.8, 0.075, 0.06, 0.065, 2], [0.84, 0.15, 0.094, 0.11, 2.3], [0.89, 0.183, 0.099, 0.124, 2.3], [0.95, 0.178, 0.09, 0.114, 2.3],
      [1.01, 0.15, 0.082, 0.094, 2.3], [1.08, 0.127, 0.078, 0.08, 2.2], [1.15, 0.132, 0.084, 0.082, 2.3], [1.22, 0.142, 0.094, 0.088, 2.3],
      [1.29, 0.146, 0.1, 0.094, 2.3], [1.35, 0.146, 0.098, 0.096, 2.3], [1.41, 0.143, 0.088, 0.094, 2.3],
      [1.455, 0.128, 0.072, 0.082, 2.2], [1.485, 0.09, 0.055, 0.064, 2.1], [1.505, 0.052, 0.045, 0.048, 2],
    ],
    neck: 0.047, arm: 0.84, thigh: 1.04, calf: 0.9, hand: 0.88, bust: 0.034,
    head: { w: 0.071, top: 0.11, chin: 0.104, front: 0.088, back: 0.098, jaw: 0.8, fem: true },
  },
  { // tiozão: barriga integrada ao tronco, ombros caídos
    height: 1.72, s: 1.72 / 1.76, shoulderX: 0.183, elbowX: 0.24, wristX: 0.258, hipX: 0.095, kneeIn: 0,
    torso: [
      [0.8, 0.075, 0.065, 0.065, 2], [0.84, 0.15, 0.104, 0.105, 2.3], [0.89, 0.18, 0.12, 0.115, 2.2], [0.95, 0.188, 0.152, 0.11, 2.1],
      [1.01, 0.19, 0.18, 0.105, 2.05], [1.08, 0.192, 0.188, 0.1, 2.05], [1.15, 0.187, 0.172, 0.1, 2.1], [1.22, 0.18, 0.148, 0.104, 2.2],
      [1.29, 0.176, 0.13, 0.108, 2.3], [1.35, 0.174, 0.122, 0.11, 2.3], [1.41, 0.17, 0.108, 0.108, 2.3],
      [1.455, 0.152, 0.086, 0.094, 2.2], [1.485, 0.108, 0.065, 0.076, 2.1], [1.505, 0.066, 0.055, 0.058, 2],
    ],
    neck: 0.062, arm: 1.06, thigh: 1.05, calf: 1.02, hand: 1.04, bust: 0,
    head: { w: 0.079, top: 0.106, chin: 0.118, front: 0.095, back: 0.102, jaw: 0.97, fem: false },
  },
];

type Joints = Record<BoneName, V3>;

/** Posições dos ossos no modelo (pose de referência: braços soltos, levemente afastados do corpo). */
function jointPositions(b: Body): Joints {
  const s = b.s;
  const J = {
    hips: V(0, 0.965 * s, 0),
    spine: V(0, 1.085 * s, -0.01),
    chest: V(0, 1.245 * s, -0.012),
    neck: V(0, 1.49 * s, -0.022),
    head: V(0, 1.588 * s, -0.008),
  } as Joints;
  for (const [g, L] of [[1, 'L'], [-1, 'R']] as const) {
    J[`upperArm${L}`] = V(g * b.shoulderX, 1.435 * s, -0.02);
    J[`foreArm${L}`] = V(g * b.elbowX, 1.14 * s, -0.045);
    J[`hand${L}`] = V(g * b.wristX, 0.885 * s, -0.01);
    J[`upperLeg${L}`] = V(g * b.hipX, 0.905 * s, 0);
    J[`lowerLeg${L}`] = V(g * (b.hipX + 0.004 - b.kneeIn), 0.49 * s, 0.008);
    J[`foot${L}`] = V(g * (b.hipX + 0.008 - b.kneeIn * 0.6), 0.078 * s, -0.025);
  }
  return J;
}

const side = (g: number) => (g > 0
  ? { up: B.upperArmL, fore: B.foreArmL, hand: B.handL, thigh: B.upperLegL, shin: B.lowerLegL, foot: B.footL }
  : { up: B.upperArmR, fore: B.foreArmR, hand: B.handR, thigh: B.upperLegR, shin: B.lowerLegR, foot: B.footR });

// ---------- pesos ----------

/** Tronco: quadril → lombar → peito em degradê; perto dos ombros parte vai para o braço, embaixo para as coxas. */
function torsoWeights(J: Joints, p: V3): W {
  const y = p.y;
  let wh = 0;
  let wsp = 0;
  let wc = 0;
  if (y <= J.hips.y) wh = 1;
  else if (y <= J.spine.y) wsp = smooth(J.hips.y, J.spine.y, y), wh = 1 - wsp;
  else if (y <= J.chest.y) wc = smooth(J.spine.y, J.chest.y, y), wsp = 1 - wc;
  else wc = 1;
  let arm = 0;
  let armBone: number = B.upperArmL;
  for (const g of [1, -1]) {
    if (p.x * g <= 0) continue;
    const S = g > 0 ? J.upperArmL : J.upperArmR;
    const a = clamp01(1 - p.distanceTo(S) / 0.13) * 0.55 * smooth(0.06, 0.13, Math.abs(p.x));
    if (a > arm) arm = a, armBone = side(g).up;
  }
  const leg = clamp01((J.upperLegL.y + 0.04 - y) / 0.12) * 0.75;
  const wl = leg * clamp01(0.5 + p.x / 0.08);
  const wr = leg * clamp01(0.5 - p.x / 0.08);
  const rest = 1 - arm - wl - wr;
  return [[B.hips, wh * rest], [B.spine, wsp * rest], [B.chest, wc * rest], [armBone, arm], [B.upperLegL, wl], [B.upperLegR, wr]];
}

/** Braço: k < 0 é a cúpula do ombro (presa em parte ao peito), 0–1 braço, 1–2 antebraço, 2 punho. */
function armWeights(g: number, k: number): W {
  const sd = side(g);
  const c = k <= 0 ? 0.18 + 0.37 * Math.min(1, -k / 0.2) : 0.18 * (1 - smooth(0, 0.25, k));
  const tf = smooth(0.85, 1.15, k);
  const th = 0.45 * smooth(1.8, 2.0, k);
  const r = 1 - c;
  return [[B.chest, c], [sd.up, r * (1 - tf)], [sd.fore, r * tf * (1 - th)], [sd.hand, r * tf * th]];
}

/** Perna: k < 0 dentro da pelve, 0–1 coxa, 1–2 canela, 2 tornozelo. */
function legWeights(g: number, k: number): W {
  const sd = side(g);
  const h = k <= 0 ? 0.35 + 0.4 * Math.min(1, -k / 0.2) : 0.35 * (1 - smooth(0, 0.18, k));
  const tl = smooth(0.85, 1.15, k);
  const tf = 0.45 * smooth(1.8, 2.0, k);
  const r = 1 - h;
  return [[B.hips, h], [sd.thigh, r * (1 - tl)], [sd.shin, r * tl * (1 - tf)], [sd.foot, r * tl * tf]];
}

// ---------- roupa ----------

type Garment = {
  main: string; trim: string;
  sleeve: 0 | 1 | 2; // sem manga, curta, comprida
  hem: number; // altura da barra (escala de 1,76 m)
  loose: number; // folga sobre o corpo
  tucked: boolean; // por dentro da calça, com cinto à mostra
};

function garment(look: Look, team: Team): Garment {
  switch (look.shirt) {
    case 1: return { main: BRASIL.yellow, trim: BRASIL.green, sleeve: 1, hem: 0.925, loose: 0.007, tucked: false };
    case 2: return { main: '#f2f2ee', trim: '#d6d6cf', sleeve: 1, hem: 0.925, loose: 0.006, tucked: false };
    case 3: return { main: team.color, trim: team.accent, sleeve: 0, hem: 0.93, loose: 0.005, tucked: false };
    case 4: return { main: '#262a33', trim: '#f4f4f0', sleeve: 2, hem: 0.875, loose: 0.013, tucked: false };
    case 5: return { main: '#b9d3ea', trim: '#f6f8fa', sleeve: 2, hem: 0.9, loose: 0.007, tucked: true };
    case 6: return { main: '#7c838c', trim: '#676d75', sleeve: 2, hem: 0.905, loose: 0.017, tucked: false };
    default: return { main: team.color, trim: team.accent, sleeve: 1, hem: 0.925, loose: 0.007, tucked: false };
  }
}

/**
 * Calça: jeans tem desbotado na frente da coxa e no joelho; as outras, só variação leve. Calculado pela posição em
 * relação ao eixo da perna mais próxima, para o tronco e as pernas terem a mesma cor onde se encontram.
 */
function pantsAt(look: Look, J: Joints, p: V3): THREE.Color {
  const L = p.x >= 0 ? 'L' : 'R';
  const H = J[`upperLeg${L}`];
  const K = J[`lowerLeg${L}`];
  const A = J[`foot${L}`];
  const k = p.y >= K.y ? (H.y - p.y) / (H.y - K.y) : 1 + (K.y - p.y) / (K.y - A.y);
  const axis = k <= 1 ? H.clone().lerp(K, Math.max(0, k)) : K.clone().lerp(A, Math.min(1, k - 1));
  const front = Math.max(-1, Math.min(1, (p.z - axis.z) / 0.08));
  return pantsShade(look, PANTS[look.pants] ?? PANTS[0], front, k, p);
}

function pantsShade(look: Look, base: string, front: number, k: number, p: V3): THREE.Color {
  const n = (hash3(p.x, p.y, p.z) - 0.5) * 0.03;
  if (look.pants !== 0) return shade(base, 1 + 0.04 * front + n);
  const f = Math.max(0, front);
  const k1 = 1 + 0.2 * f * gauss(k - 0.45, 0.32) + 0.12 * f * gauss(k - 1.02, 0.1) - 0.07 * (1 - Math.abs(front)) + n;
  return shade(base, k1);
}

// ---------- tronco e pescoço ----------

/** Medidas do tronco na altura yn (escala de 1,76 m), com spline pelas linhas da tabela. */
function torsoAt(b: Body, yn: number): number[] {
  const t = b.torso;
  if (yn <= t[0][0]) return t[0].slice(1);
  if (yn >= t[t.length - 1][0]) return t[t.length - 1].slice(1);
  let i = 0;
  while (t[i + 1][0] < yn) i++;
  const p0 = t[Math.max(0, i - 1)];
  const p1 = t[i];
  const p2 = t[i + 1];
  const p3 = t[Math.min(t.length - 1, i + 2)];
  const h = p2[0] - p1[0];
  const u = (yn - p1[0]) / h;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
  const h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2;
  const h11 = u ** 3 - u ** 2;
  return [1, 2, 3, 4].map((c) => {
    const m1 = ((p2[c] - p0[c]) / Math.max(1e-6, p2[0] - p0[0])) * h;
    const m2 = ((p3[c] - p1[c]) / Math.max(1e-6, p3[0] - p1[0])) * h;
    return h00 * p1[c] + h10 * m1 + h01 * p2[c] + h11 * m2;
  });
}

/** Volume do busto (mulher): somado à frente do tronco. */
function bustAt(b: Body, yn: number, x: number): number {
  if (!b.bust) return 0;
  return b.bust * gauss(yn - 1.27, 0.07) * (0.78 + 0.22 * gauss(Math.abs(x) - 0.058, 0.035)) * gauss(x, 0.105);
}

/** Ponto da superfície da frente do tronco (para colar detalhes: escudo, botões, gravata). */
function torsoFront(b: Body, y: number, x: number, d: number): number {
  const yn = y / b.s;
  const [rx, rzF, , n] = torsoAt(b, yn);
  const u = Math.min(0.98, Math.abs(x) / (rx + d));
  return (rzF + d) * (1 - u ** n) ** (1 / n) + bustAt(b, yn, x);
}

function buildTorso(bd: Builder, b: Body, J: Joints, look: Look, g: Garment, skin: string, team: Team) {
  const s = b.s;
  const y0 = b.torso[0][0];
  const y1 = b.torso[b.torso.length - 1][0];
  const waist = 0.985; // cós da calça
  const belt = g.tucked ? [0.965, 0.995] : null;
  // anéis: amostragem regular mais pares de anéis nas emendas (barra, cinto) para a cor mudar sem degradê
  const ks: { yn: number; d: number }[] = [];
  const loose = (yn: number) => (yn < (g.tucked ? waist : g.hem) ? 0.004 : g.loose);
  for (let yn = y0; yn <= y1 + 1e-6; yn += (y1 - y0) / 14) ks.push({ yn, d: loose(yn) });
  const split = (yn: number, below: number, above: number) => {
    ks.push({ yn: yn - 0.0006, d: below }, { yn: yn + 0.0006, d: above });
  };
  if (belt) {
    split(belt[0], 0.004, 0.008);
    split(belt[1], 0.008, g.loose + 0.004);
  } else {
    split(g.hem, 0.004, g.loose + 0.008);
  }
  const bands = look.shirt === 0 ? [1.255, 1.29] : look.shirt === 6 ? [g.hem + 0.045] : look.shirt === 3 ? [REGATA_TOP] : [];
  for (const yn of bands) split(yn, g.loose, g.loose);
  ks.sort((a, c) => a.yn - c.yn);
  const filtered = ks.filter((r, i) => i === 0 || r.yn - ks[i - 1].yn > 0.0009 || Math.abs(r.d - ks[i - 1].d) > 1e-4);
  const rings: Ring[] = filtered.map(({ yn, d }) => {
    const [rx, rzF, rzB, n] = torsoAt(b, yn);
    return { c: V(0, yn * s, 0), rx: rx + d, rz: rzF + d, rzB: rzB + d, n, k: yn };
  });
  const t = tube(rings, 22, {
    capStart: 0.02, capEnd: 0,
    shape: (ri, x, z) => {
      const yn = rings[ri].k!;
      if (z > 0) z += bustAt(b, yn, x);
      return [x, z];
    },
  });
  const trim = g.trim;
  const color = (p: V3, i: number): THREE.Color => {
    const yn = t.k[i];
    if (belt && yn < belt[1] && yn > belt[0]) return col('#2b1f17');
    if (yn < (belt ? belt[0] : g.hem)) return pantsAt(look, J, p);
    switch (look.shirt) {
      case 3: // regata: acima do peito é pele (as alças vêm à parte)
        return yn > REGATA_TOP ? col(skin) : col(g.main);
      case 6: // moletom: barra canelada
        return yn < g.hem + 0.045 ? col(g.trim) : col(g.main);
      case 0: // camisa do time: faixa no peito
        return yn > 1.255 && yn < 1.29 ? col(trim) : col(g.main);
      default:
        return col(g.main);
    }
  };
  // sombra de contato pintada nas cores: axilas, base do pescoço e embaixo da barra
  const ao = (p: V3, i: number) => {
    const yn = t.k[i];
    const [rx] = torsoAt(b, yn);
    let f = 1 - 0.16 * smooth(0.72, 0.98, Math.abs(p.x) / rx) * gauss(yn - 1.33, 0.06);
    if (!belt && yn < g.hem) f -= 0.2 * smooth(g.hem - 0.035, g.hem, yn);
    f -= 0.08 * smooth(1.47, 1.505, yn);
    return color(p, i).multiplyScalar(f);
  };
  bd.add(t.geo, CLOTH, ao, (p) => torsoWeights(J, p));

  // Pescoço: preso ao peito embaixo e à cabeça em cima.
  const nr = b.neck;
  const neck: Ring[] = [
    { c: V(0, 1.455 * s, -0.018), rx: nr * 1.1, rz: nr * 1.05, k: 0 },
    { c: V(0, 1.5 * s, -0.016), rx: nr, rz: nr * 0.95, k: 0.25 },
    { c: V(0, 1.54 * s, -0.01), rx: nr * 0.94, rz: nr * 0.9, k: 0.55 },
    { c: V(0, J.head.y + 0.015, -0.004), rx: nr * 0.92, rz: nr * 0.9, k: 0.8 },
    { c: V(0, J.head.y + 0.06, 0.0), rx: nr * 0.8, rz: nr * 0.75, k: 1 },
  ];
  const nt = tube(neck, 12, { capEnd: 0 });
  bd.add(nt.geo, SKIN, (p, i) => shade(skin, 1 - 0.2 * smooth(0.5, 1, nt.k[i]) * clamp01((p.z + 0.01) / 0.05)), (_p, i) => {
    const k = nt.k[i];
    if (k < 0.25) return [[B.chest, 1 - k / 0.25 * 0.5], [B.neck, k / 0.25 * 0.5]];
    if (k < 0.55) return [[B.chest, 0.5 * (1 - (k - 0.25) / 0.3)], [B.neck, 0.5 + 0.5 * ((k - 0.25) / 0.3)]];
    return [[B.neck, 1 - smooth(0.55, 1, k)], [B.head, smooth(0.55, 1, k)]];
  });

  buildCollar(bd, b, J, look, g, team);
}

const REGATA_TOP = 1.37;

/** Ponto da superfície das costas do tronco. */
function torsoBack(b: Body, y: number, x: number, d: number): number {
  const [rx, , rzB, n] = torsoAt(b, y / b.s);
  const u = Math.min(0.98, Math.abs(x) / (rx + d));
  return -(rzB + d) * (1 - u ** n) ** (1 / n);
}

/** Retalho colado na frente do tronco (camisa sob o paletó, bolso): faixa de y com meia largura variável. */
function frontPatch(b: Body, y0: number, y1: number, half: (yn: number) => number, d: number, off: number, nx = 6, ny = 8): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= ny; j++) {
    const yn = lerp(y0, y1, j / ny);
    const y = yn * b.s;
    const hw = half(yn);
    for (let i = 0; i <= nx; i++) {
      const x = lerp(-hw, hw, i / nx);
      pos.push(x, y, torsoFront(b, y, x, d) + off);
      uv.push(x / UV_SCALE, y / UV_SCALE);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Gola, gravata, botões, capuz e escudo: detalhes presos à superfície do tronco. */
function buildCollar(bd: Builder, b: Body, J: Joints, look: Look, g: Garment, team: Team) {
  const s = b.s;
  const tw = (p: V3) => torsoWeights(J, p);
  // anel em volta da base do pescoço, mais baixo na frente
  const loop = (rx: number, rz: number, yBack: number, yFront: number, n = 16) => {
    const pts: V3[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const fz = Math.sin(a);
      pts.push(V(Math.cos(a) * rx, lerp(yBack, yFront, (fz + 1) / 2) * s, -0.016 + fz * rz));
    }
    return pts;
  };
  const nr = b.neck;
  switch (look.shirt) {
    case 3: // regata: alças largas por cima dos ombros
      for (const x of [-1, 1]) {
        const pts: V3[] = [];
        for (const yn of [REGATA_TOP - 0.01, 1.42, 1.462]) pts.push(V(x * lerp(0.075, 0.092, (yn - 1.36) / 0.1), yn * s, torsoFront(b, yn * s, x * 0.08, g.loose) + 0.002));
        pts.push(V(x * 0.096, 1.497 * s, -0.016));
        for (const yn of [1.462, 1.42, REGATA_TOP - 0.01]) pts.push(V(x * lerp(0.075, 0.092, (yn - 1.36) / 0.1), yn * s, torsoBack(b, yn * s, x * 0.08, g.loose) - 0.002));
        bd.add(cord(pts, () => [0.021, 0.0026], 6), CLOTH, g.main, tw);
      }
      break;
    case 4: { // terno: camisa branca no V, lapelas, colarinho, gravata na cor do time, botões
      const vw = (yn: number) => 0.052 * smooth(1.2, 1.47, yn) + 0.003;
      bd.add(frontPatch(b, 1.21, 1.475, vw, g.loose, 0.0025, 4, 8), CLOTH, '#f4f4f0', tw);
      for (const x of [-1, 1]) {
        const pts: V3[] = [];
        for (let i = 0; i <= 6; i++) {
          const yn = lerp(1.205, 1.47, i / 6);
          const xx = x * (vw(yn) + 0.008);
          pts.push(V(xx, yn * s, torsoFront(b, yn * s, xx, g.loose) + 0.0035));
        }
        bd.add(cord(pts, (t) => [0.006 + 0.008 * smooth(0, 0.6, t), 0.0028], 4), CLOTH, shade(g.main, 1.18), tw);
      }
      bd.add(cord(loop(nr + 0.006, nr + 0.004, 1.51, 1.49), 0.009, 4, false), CLOTH, '#f4f4f0', tw);
      const knotY = 1.475 * s;
      const tie: V3[] = [];
      for (let i = 0; i <= 6; i++) {
        const y = lerp(knotY, 1.12 * s, i / 6);
        tie.push(V(0, y, torsoFront(b, y, 0, g.loose) + 0.006));
      }
      bd.add(cord(tie, (t) => [0.012 + 0.012 * smooth(0, 0.9, t), 0.003], 4), CLOTH, team.color, tw);
      bd.add(new THREE.SphereGeometry(0.013, 8, 6), CLOTH, shade(team.color, 0.85), tw,
        { m: new THREE.Matrix4().compose(V(0, knotY, torsoFront(b, knotY, 0, 0) + 0.006), new THREE.Quaternion(), V(1, 0.9, 0.7)) });
      for (const y of [1.17, 1.08]) {
        const yy = y * s;
        bd.add(new THREE.SphereGeometry(0.007, 6, 4), SKIN, '#111111', tw, { m: new THREE.Matrix4().makeTranslation(0, yy, torsoFront(b, yy, 0, g.loose)) });
      }
      break;
    }
    case 5: { // social: colarinho com pontas, vista e botões
      bd.add(cord(loop(nr + 0.006, nr + 0.004, 1.515, 1.49), 0.01, 4, false), CLOTH, shade(g.main, 1.04), tw);
      const placket: V3[] = [];
      for (let i = 0; i <= 6; i++) {
        const y = lerp(1.47, 1.0, i / 6) * s;
        placket.push(V(0, y, torsoFront(b, y, 0, g.loose) + 0.0008));
      }
      bd.add(cord(placket, () => [0.011, 0.0012], 4), CLOTH, shade(g.main, 0.95), tw);
      for (const x of [-1, 1]) {
        const top = V(x * 0.02, 1.49 * s, torsoFront(b, 1.49 * s, 0.02, g.loose) + 0.002);
        const tip = V(x * 0.045, 1.445 * s, torsoFront(b, 1.445 * s, 0.045, g.loose) + 0.004);
        bd.add(cord([top, tip], (t) => [0.012 - t * 0.008, 0.0025], 4), CLOTH, shade(g.main, 1.04), tw);
      }
      for (let i = 0; i < 5; i++) {
        const y = (1.43 - i * 0.095) * s;
        bd.add(new THREE.SphereGeometry(0.0045, 6, 4), SKIN, '#f4f4f0', tw, { m: new THREE.Matrix4().makeTranslation(0, y, torsoFront(b, y, 0, g.loose) + 0.0025) });
      }
      break;
    }
    case 6: { // moletom: capuz dobrado nas costas e cordões
      const hood: V3[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = lerp(-0.3, Math.PI + 0.3, i / 10);
        const back = Math.max(0, Math.sin(a));
        hood.push(V(Math.cos(a) * (nr + 0.045), (1.49 - 0.04 * back) * s, -0.016 - Math.sin(a) * (nr + 0.05) - 0.02 * back));
      }
      bd.add(cord(hood, (t) => [0.03 + 0.012 * Math.sin(t * Math.PI), 0.024], 8), CLOTH, shade(g.main, 0.95), tw);
      for (const x of [-0.032, 0.032]) {
        const top = V(x, 1.47 * s, torsoFront(b, 1.47 * s, x, g.loose) + 0.004);
        const bot = V(x * 1.1, 1.33 * s, torsoFront(b, 1.33 * s, x, g.loose) + 0.004);
        bd.add(cord([top, bot], 0.0028, 4), CLOTH, '#e8e8e4', tw);
      }
      bd.add(cord(loop(nr + 0.012, nr + 0.01, 1.505, 1.485), 0.009, 4, false), CLOTH, g.trim, tw);
      bd.add(frontPatch(b, 0.975, 1.1, (yn) => 0.1 - (yn - 0.975) * 0.3, g.loose, 0.003, 6, 4), CLOTH, shade(g.main, 0.92), tw);
      break;
    }
    default: { // camisetas: gola redonda na cor de acabamento
      bd.add(cord(loop(nr + 0.012, nr + 0.011, 1.505, 1.475), 0.0075, 4, false), CLOTH, g.trim, tw);
      if (look.shirt === 1) {
        // escudo no peito esquerdo
        const y = 1.36 * s;
        const x = 0.078;
        const z = torsoFront(b, y, x, g.loose);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.08, 0.32, 0));
        bd.add(new THREE.BoxGeometry(0.034, 0.04, 0.004), CLOTH, BRASIL.green, tw, { m: new THREE.Matrix4().compose(V(x, y, z), q, V(1, 1, 1)), smooth: false });
        bd.add(new THREE.BoxGeometry(0.026, 0.031, 0.006), CLOTH, BRASIL.blue, tw, { m: new THREE.Matrix4().compose(V(x, y + 0.002, z), q, V(1, 1, 1)), smooth: false });
        bd.add(new THREE.BoxGeometry(0.016, 0.004, 0.008), CLOTH, BRASIL.yellow, tw, { m: new THREE.Matrix4().compose(V(x, y + 0.006, z), q, V(1, 1, 1)), smooth: false });
      }
    }
  }
  if (g.tucked) {
    // fivela do cinto
    const y = 0.98 * s;
    bd.add(new THREE.BoxGeometry(0.04, 0.03, 0.008), SKIN, '#b8b8b0', tw, { m: new THREE.Matrix4().makeTranslation(0, y, torsoFront(b, y, 0, 0.008) + 0.002), smooth: false });
  }
}

// ---------- braços e mãos ----------

/** [k, raio lateral, raio frente-trás] do braço do homem; k como em armWeights. */
const ARM: [number, number, number][] = [
  [-0.2, 0.024, 0.028], [-0.13, 0.04, 0.045], [-0.06, 0.05, 0.054], [0, 0.054, 0.057], [0.2, 0.05, 0.053], [0.42, 0.045, 0.048],
  [0.65, 0.041, 0.043], [0.88, 0.037, 0.037], [1, 0.036, 0.036], [1.12, 0.038, 0.037], [1.3, 0.038, 0.037], [1.6, 0.031, 0.031],
  [1.85, 0.023, 0.027], [2, 0.019, 0.026],
];
const ARM_KS = [-0.2, -0.12, -0.05, 0.05, 0.3, 0.6, 0.86, 1, 1.13, 1.35, 1.65, 1.88, 2];

function armPoint(J: Joints, g: number, k: number): V3 {
  const L = g > 0 ? 'L' : 'R';
  const S = J[`upperArm${L}`];
  const E = J[`foreArm${L}`];
  const Wr = J[`hand${L}`];
  if (k < 0) {
    const t = -k / 0.2;
    return S.clone().add(V(-g * 0.016 * t, 0.034 * t, 0));
  }
  return k <= 1 ? S.clone().lerp(E, k) : E.clone().lerp(Wr, k - 1);
}

function armRadius(b: Body, k: number): [number, number] {
  const rx = table(ARM.map(([a, r]) => [a, r]), k) * b.arm;
  const rz = table(ARM.map(([a, , r]) => [a, r]), k) * b.arm;
  return [rx, rz];
}

function buildArm(bd: Builder, b: Body, J: Joints, g: number, look: Look, gm: Garment, skin: string) {
  const long = gm.sleeve === 2;
  const cuffA = 1.83;
  const cuffB = 1.94;
  const ks = long ? [...ARM_KS.filter((k) => k < cuffA), cuffA - 0.001, cuffA + 0.001, cuffB - 0.001, cuffB + 0.001, 2] : ARM_KS;
  const extra = (k: number) => (!long ? 0 : k < cuffA ? gm.loose * 0.9 : k < cuffB ? gm.loose * 0.6 + 0.004 : 0);
  const rings: Ring[] = ks.map((k) => {
    const [rx, rz] = armRadius(b, k);
    const d = extra(k);
    return { c: armPoint(J, g, k), rx: rx + d, rz: rz + d, k };
  });
  const t = tube(rings, 10, { capStart: 0.004, capEnd: 0.008 });
  const cuff = look.shirt === 4 ? '#f4f4f0' : look.shirt === 6 ? gm.trim : shade(gm.main, 1.03);
  const color = (_p: V3, i: number) => {
    const k = t.k[i];
    const a = t.a[i];
    const c = !long || k > cuffB ? col(skin) : k > cuffA ? col(cuff) : col(gm.main);
    return c.multiplyScalar(1 - 0.14 * gauss(k - 1, 0.08) * Math.max(0, Math.sin(a)) - 0.16 * smooth(0.35, 0, k) * Math.max(0, -g * Math.cos(a)));
  };
  bd.add(t.geo, long ? CLOTH : SKIN, color, (_p, i) => armWeights(g, t.k[i]));
  // Mangas curtas: casca mais larga com barra virada na cor de acabamento.
  if (gm.sleeve === 1) {
    const end = 0.5;
    const sk = [-0.2, -0.12, -0.05, 0.05, 0.25, end - 0.07, end - 0.068, end];
    const sr: Ring[] = sk.map((k, i) => {
      const [rx, rz] = armRadius(b, k);
      const d = 0.007 + 0.007 * smooth(0, end, k) + (i >= sk.length - 2 ? 0.003 : 0);
      return { c: armPoint(J, g, k), rx: rx + d, rz: rz + d, k };
    });
    const [rx, rz] = armRadius(b, end);
    sr.push({ c: armPoint(J, g, end), rx: rx + 0.004, rz: rz + 0.004, k: end + 0.01 });
    const st = tube(sr, 10, { capStart: 0.004, capEnd: 0 });
    bd.add(st.geo, CLOTH, (_p, i) => (st.k[i] > end - 0.069 ? col(gm.trim) : col(gm.main)), (_p, i) => armWeights(g, Math.min(end, st.k[i])));
  }
  buildHand(bd, b, J, g, skin, g < 0 && look.flag > 0);
}

/** Mão com palma, quatro dedos e polegar, rígida no osso da mão. `grip` fecha o punho em volta do mastro. */
function buildHand(bd: Builder, b: Body, J: Joints, g: number, skin: string, grip: boolean) {
  const L = g > 0 ? 'L' : 'R';
  const Wr = J[`hand${L}`];
  const dir = Wr.clone().sub(J[`foreArm${L}`]).normalize();
  const m = new THREE.Matrix4().compose(Wr, new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dir), V(b.hand, b.hand, b.hand));
  const bone = side(g).hand;
  const palm: Ring[] = [
    { c: V(0, 0.012, 0.004), rx: 0.016, rz: 0.024 },
    { c: V(0, -0.012, 0.004), rx: 0.0175, rz: 0.032 },
    { c: V(-g * 0.001, -0.045, 0.003), rx: 0.0165, rz: 0.04 },
    { c: V(-g * 0.002, -0.077, 0.001), rx: 0.0145, rz: 0.04 },
    { c: V(-g * 0.003, -0.091, 0.0), rx: 0.011, rz: 0.035 },
  ];
  bd.add(tube(palm, 6, { capStart: 0, capEnd: 0.006 }).geo, SKIN, skin, bone, { m });
  // dedos: indicador, médio, anelar, mínimo (o polegar fica à frente, +Z)
  const fingers: [number, number, number][] = [[0.0245, 0.071, -0.002], [0.0082, 0.079, 0], [-0.0082, 0.074, 0.001], [-0.0235, 0.059, 0.003]];
  const curl = grip ? [1.45, 1.65, 1.0] : [0.3, 0.48, 0.3];
  fingers.forEach(([z, len, spread], fi) => {
    const extra = grip ? 0 : fi * 0.06;
    const angles = [curl[0] + extra, curl[1] + extra, curl[2]];
    const parts = [0.47, 0.29, 0.24];
    const pts = [V(-g * 0.002, -0.083, z)];
    let a = 0;
    for (let k = 0; k < 3; k++) {
      a += angles[k];
      const p = pts[pts.length - 1];
      pts.push(p.clone().add(V(-g * Math.sin(a), -Math.cos(a), spread / 3).multiplyScalar(len * parts[k])));
    }
    const r0 = fi === 3 ? 0.0079 : 0.0091;
    const rings = pts.map((c, i): Ring => ({ c, rx: r0 * (1 - i * 0.08), rz: r0 * (1 - i * 0.08) * 0.95 }));
    bd.add(tube(rings, 4, { capStart: 0, capEnd: 0.005 }).geo, SKIN, skin, bone, { m });
  });
  const thumbDirs = grip
    ? [V(-g * 0.45, -0.7, 0.55), V(-g * 0.85, -0.45, 0.05), V(-g * 0.7, -0.2, -0.45)]
    : [V(-g * 0.35, -0.8, 0.45), V(-g * 0.42, -0.86, 0.25), V(-g * 0.42, -0.9, 0.1)];
  const tl = [0.034, 0.029, 0.024];
  const tp = [V(-g * 0.008, -0.018, 0.026)];
  thumbDirs.forEach((d, i) => tp.push(tp[tp.length - 1].clone().addScaledVector(d.normalize(), tl[i])));
  const tr = [0.0118, 0.0106, 0.0095, 0.008];
  bd.add(tube(tp.map((c, i) => ({ c, rx: tr[i], rz: tr[i] * 0.92 })), 4, { capStart: 0, capEnd: 0.006 }).geo, SKIN, skin, bone, { m });
}

// ---------- pernas e pés ----------

/** [k, raio lateral, frente, trás] da perna do homem; k como em legWeights. */
const LEG: [number, number, number, number][] = [
  [-0.2, 0.055, 0.06, 0.065], [-0.1, 0.07, 0.072, 0.08], [0, 0.084, 0.086, 0.093], [0.15, 0.087, 0.088, 0.092], [0.4, 0.077, 0.078, 0.08],
  [0.7, 0.064, 0.066, 0.066], [0.88, 0.054, 0.056, 0.054], [1, 0.05, 0.054, 0.05], [1.1, 0.047, 0.047, 0.052], [1.3, 0.049, 0.041, 0.062],
  [1.55, 0.042, 0.035, 0.048], [1.8, 0.032, 0.029, 0.033], [2, 0.028, 0.032, 0.03],
];
const LEG_KS = [-0.2, -0.1, 0, 0.2, 0.5, 0.8, 0.93, 1.03, 1.15, 1.35, 1.6, 1.85, 2];

function legPoint(J: Joints, g: number, k: number): V3 {
  const L = g > 0 ? 'L' : 'R';
  const H = J[`upperLeg${L}`];
  const K = J[`lowerLeg${L}`];
  const A = J[`foot${L}`];
  if (k < 0) {
    const t = -k / 0.2;
    return H.clone().add(V(-g * 0.026 * t, 0.06 * t, -0.008 * t));
  }
  return k <= 1 ? H.clone().lerp(K, k) : K.clone().lerp(A, k - 1);
}

function legRadius(b: Body, k: number): [number, number, number] {
  const m = k < 0.8 ? b.thigh : k > 1.1 ? b.calf : lerp(b.thigh, b.calf, (k - 0.8) / 0.3);
  return [1, 2, 3].map((c) => table(LEG.map((r) => [r[0], r[c]]), k) * m) as [number, number, number];
}

function buildLeg(bd: Builder, b: Body, J: Joints, g: number, look: Look, skin: string) {
  const shorts = look.legs === 1;
  const hemK = 2.07 + (look.shirt === 4 ? -0.02 : 0);
  const ks = shorts ? LEG_KS : [...LEG_KS, hemK - 0.03, hemK];
  const rings: Ring[] = ks.map((k) => {
    let [rx, rf, rb] = legRadius(b, Math.min(2, k));
    if (!shorts) {
      // calça reta: folga na coxa e cano quase reto da canela para baixo
      const lo = b.bust ? 0.045 : 0.05;
      const st = smooth(0.6, 1.05, k);
      rx = Math.max(rx + 0.009, lerp(0, lo, st));
      rf = Math.max(rf + 0.009, lerp(0, lo + 0.003, st));
      rb = Math.max(rb + 0.009, lerp(0, lo + 0.003, st));
    }
    return { c: legPoint(J, g, k), rx, rz: rf, rzB: rb, k };
  });
  if (!shorts) {
    const last = rings[rings.length - 1];
    rings.push({ ...last, rx: last.rx - 0.006, rz: last.rz - 0.006, rzB: last.rzB! - 0.006, k: hemK + 0.01 });
  }
  const t = tube(rings, 12, { capStart: 0.004, capEnd: shorts ? 0.01 : 0 });
  const wf = (_p: V3, i: number) => legWeights(g, Math.min(2, t.k[i]));
  const ao = (i: number) => {
    const k = t.k[i];
    const a = t.a[i];
    return 1 - 0.14 * gauss(k - 1, 0.1) * Math.max(0, -Math.sin(a));
  };
  if (shorts) {
    bd.add(t.geo, SKIN, (_p, i) => shade(skin, ao(i)), wf);
    // bermuda: casca larga até acima do joelho, com barra
    const end = 0.66;
    const sk = [-0.2, -0.1, 0, 0.2, 0.45, end - 0.05, end - 0.048, end];
    const sr: Ring[] = sk.map((k, i) => {
      const [rx, rf, rb] = legRadius(b, k);
      const d = 0.016 + 0.01 * smooth(0, end, k) + (i >= sk.length - 2 ? 0.003 : 0);
      return { c: legPoint(J, g, k), rx: rx + d, rz: rf + d, rzB: rb + d, k };
    });
    const [rx, rf, rb] = legRadius(b, end);
    sr.push({ c: legPoint(J, g, end), rx: rx + 0.006, rz: rf + 0.006, rzB: rb + 0.006, k: end + 0.01 });
    const st = tube(sr, 12, { capStart: 0.004, capEnd: 0 });
    bd.add(st.geo, CLOTH, (p, i) => shade(pantsAt(look, J, p), st.k[i] > end - 0.049 ? 0.9 : 1),
      (_p, i) => legWeights(g, Math.min(end, st.k[i])));
  } else {
    bd.add(t.geo, CLOTH, (p, i) => {
      const k = t.k[i];
      const c = pantsAt(look, J, p).multiplyScalar(ao(i));
      return k > hemK - 0.032 ? shade(c, k > hemK ? 0.5 : 0.92) : c;
    }, wf);
  }
  buildFoot(bd, J, g, look, skin);
}

/** Calçado em coordenadas do pé: [z, meia largura, base, topo]. */
const SNEAKER: number[][] = [
  [-0.064, 0.022, 0.02, 0.07], [-0.058, 0.034, 0.018, 0.094], [-0.035, 0.042, 0.018, 0.104], [0.005, 0.045, 0.018, 0.1],
  [0.055, 0.047, 0.018, 0.08], [0.105, 0.049, 0.018, 0.064], [0.15, 0.047, 0.018, 0.054], [0.182, 0.04, 0.018, 0.046], [0.2, 0.027, 0.02, 0.037],
];
const DRESS: number[][] = [
  [-0.062, 0.022, 0.014, 0.06], [-0.056, 0.034, 0.013, 0.078], [-0.03, 0.04, 0.013, 0.085], [0.01, 0.043, 0.013, 0.08],
  [0.06, 0.045, 0.013, 0.066], [0.11, 0.046, 0.013, 0.054], [0.155, 0.042, 0.013, 0.046], [0.19, 0.032, 0.014, 0.038], [0.212, 0.016, 0.016, 0.03],
];
const BAREFOOT: number[][] = [
  [-0.058, 0.02, 0.016, 0.05], [-0.05, 0.03, 0.014, 0.07], [-0.02, 0.034, 0.014, 0.08], [0.03, 0.038, 0.014, 0.064],
  [0.09, 0.043, 0.014, 0.045], [0.14, 0.045, 0.014, 0.033], [0.172, 0.043, 0.014, 0.027], [0.192, 0.034, 0.015, 0.023], [0.203, 0.02, 0.016, 0.02],
];

function shoeRings(prof: number[][], grow: number, y0?: number, y1?: number): Ring[] {
  return prof.map(([z, hw, yb, yt]) => {
    const b0 = y0 ?? yb;
    const b1 = y1 ?? yt;
    return { c: V(0, (b0 + b1) / 2, z), rx: hw + grow, rz: (b1 - b0) / 2, n: 2.8, k: z };
  });
}

function buildFoot(bd: Builder, J: Joints, g: number, look: Look, skin: string) {
  const A = g > 0 ? J.footL : J.footR;
  const bone = side(g).foot;
  const m = new THREE.Matrix4().compose(V(A.x, 0, A.z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), g * 0.08), V(1, 1, 1));
  const up = V(0, 1, 0);
  if (look.legs === 1) {
    // pé descalço no chinelo
    const strap = look.shirt === 1 ? BRASIL.green : '#2c64b8';
    const foot = tube(shoeRings(BAREFOOT, 0), 10, { front: up, capStart: 0.006, capEnd: 0.008 });
    bd.add(foot.geo, SKIN, (p) => (p.y < 0.017 ? shade(skin, 0.9) : col(skin)), bone, { m });
    const sole = tube(shoeRings(BAREFOOT.filter((_, i) => i % 2 === 0), 0.008, 0, 0.013).map((r) => ({ ...r, n: 5 })), 10, { front: up, capStart: 0.008, capEnd: 0.012 });
    bd.add(sole.geo, CLOTH, (p) => (p.y > 0.011 ? col('#f1f1ec') : col(strap)), bone, { m });
    const post = V(-g * 0.012, 0.016, 0.152);
    for (const sgn of [1, -1]) {
      const pts = [post, V(-g * 0.01, 0.045, 0.118), V(sgn * g * 0.03 - g * 0.006, 0.044, 0.072), V(sgn * g * 0.044 - g * 0.002, 0.016, 0.056)];
      bd.add(cord(pts, () => [0.005, 0.0028], 4), CLOTH, strap, bone, { m });
    }
    return;
  }
  const dress = look.shirt === 4;
  const prof = dress ? DRESS : SNEAKER;
  const solTop = dress ? 0.014 : 0.022;
  const upper = tube(shoeRings(prof.filter((_, i) => i !== 3 && i !== 5), 0), 10, { front: up, capStart: 0.005, capEnd: 0.008 });
  const white = '#f4f4f2';
  bd.add(upper.geo, dress ? SKIN : CLOTH, (p) => {
    if (dress) return col('#16171b');
    const z = p.z - A.z;
    const x = Math.abs(p.x - A.x);
    if (z < -0.05 && p.y > 0.05) return col('#cfd1d3');
    if (x < 0.017 && z > -0.005 && z < 0.11 && p.y > 0.06) return col('#e0e0dc');
    if (x > 0.03 && p.y > 0.032 && p.y < 0.058 && z > -0.03 && z < 0.12) return col('#c4c9ce');
    return col(white);
  }, bone, { m });
  const sole = tube(shoeRings(prof.filter((_, i) => i % 2 === 0), 0.005, 0, solTop).map((r, i, all) => ({ ...r, n: 5, c: r.c.clone().add(V(0, i === all.length - 1 ? 0.004 : 0, 0)) })), 8,
    { front: up, capStart: 0.008, capEnd: 0.01 });
  bd.add(sole.geo, CLOTH, (p) => (dress ? col('#2a211c') : p.y < 0.005 ? col('#8f908c') : col('#f7f7f4')), bone, { m });
}

// ---------- cabeça ----------

/**
 * Forma da cabeça a partir de uma direção da esfera unitária: crânio em cima, rosto achatado na frente,
 * mandíbula estreitando até o queixo (o polo de baixo vira a ponta do queixo). Coordenadas locais da cabeça:
 * origem entre as orelhas, na altura dos olhos.
 */
function headShape(u: V3, H: HeadDims, out: V3, detail = true): V3 {
  const up = Math.max(0, u.y);
  const low = Math.max(0, -u.y);
  const rh = Math.hypot(u.x, u.z) || 1e-6;
  const cx = u.x / rh;
  const cz = u.z / rh;
  const e = 2 / (cz >= 0 ? lerp(2.5, 2.15, up) : 2.15);
  const hx = Math.sign(cx) * Math.abs(cx) ** e;
  const hz = Math.sign(cz) * Math.abs(cz) ** e;
  // raio horizontal por altura: topo levemente achatado; embaixo mais "quadrado" que a esfera (mandíbula)
  const R = u.y >= 0 ? (1 - up ** 2.3) ** (1 / 2.3) : (1 - low ** 2.8) ** (1 / 2.8);
  let w = H.w * (1 - 0.07 * Math.max(0, cz) * up);
  w *= 1 - (1 - H.jaw) * smooth(0.2, 0.75, low) - 0.3 * smooth(0.7, 1, low);
  let d = cz >= 0 ? H.front : H.back;
  d *= cz >= 0 ? 1 - 0.08 * smooth(0.35, 1, low) : 1 - 0.4 * smooth(0.1, 0.9, low);
  const y = u.y >= 0 ? u.y * H.top : u.y * H.chin;
  let x = R * hx * w;
  let z = R * hz * d + H.front * 0.42 * smooth(0.3, 1, low);
  if (detail && z > 0) {
    const ex = H.w * 0.41;
    z += 0.0035 * gauss(y - 0.021, 0.011) * gauss(x, 0.05); // arco das sobrancelhas
    for (const s of [-1, 1]) z -= 0.005 * gauss(x - s * ex, 0.017) * gauss(y + 0.002, 0.013); // órbitas
    z += 0.003 * gauss(x, 0.011) * gauss(y + 0.004, 0.018); // raiz do nariz
    z += 0.004 * gauss(x, 0.026) * gauss(y + 0.615 * H.chin, 0.016); // boca
    z += 0.004 * gauss(x, 0.022) * gauss(y + 0.9 * H.chin, 0.016); // queixo
    x += Math.sign(x) * 0.003 * gauss(y + 0.03, 0.02) * gauss(z - 0.06, 0.03); // maçãs do rosto
  }
  return out.set(x, y, z);
}

/** Ponto da frente do rosto em (x, y) locais, com a normal. */
function faceAt(H: HeadDims, x: number, y: number, detail = true): { p: V3; n: V3 } {
  const sy = (yy: number) => (yy >= 0 ? H.top : H.chin);
  let ux = x / H.w;
  let uy = y / sy(y);
  const u = new THREE.Vector3();
  const p = new THREE.Vector3();
  const dir = (a: number, b: number) => u.set(a, b, Math.sqrt(Math.max(1e-4, 1 - a * a - b * b))).normalize();
  for (let i = 0; i < 14; i++) {
    headShape(dir(ux, uy), H, p, detail);
    ux = Math.max(-0.99, Math.min(0.99, ux + ((x - p.x) / H.w) * 0.7));
    uy = Math.max(-0.99, Math.min(0.99, uy + ((y - p.y) / sy(y)) * 0.7));
  }
  headShape(dir(ux, uy), H, p, detail);
  const a = headShape(dir(ux + 0.01, uy), H, new THREE.Vector3(), detail).sub(p);
  const b = headShape(dir(ux, uy + 0.01), H, new THREE.Vector3(), detail).sub(p);
  const n = new THREE.Vector3().crossVectors(a, b).normalize();
  if (n.z < 0) n.negate();
  return { p: p.clone(), n };
}

type HeadBase = { O: V3 };

const headDir = (phi: number, el: number, out: V3) => out.set(Math.sin(phi) * Math.cos(el), Math.sin(el), Math.cos(phi) * Math.cos(el));

/**
 * Grade sobre a cabeça presa a uma borda (linha do cabelo, contorno da barba): colunas por azimute (0 = frente),
 * linhas da borda y0 até y1 (ou até uma elevação fixa). Como a borda é uma curva da própria grade, ela sai lisa;
 * `thick` dá a espessura (t = 0 na borda, 1 no fim).
 */
function headGrid(H: HeadDims, O: V3, cols: number, rows: number, phi0: number, phi1: number,
  y0: (phi: number) => number, y1: ((phi: number) => number) | number,
  thick: (u: V3, p: V3, t: number, phi: number) => number): THREE.BufferGeometry {
  const elOf = (y: number) => Math.asin(Math.max(-1, Math.min(1, y / (y >= 0 ? H.top : H.chin))));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const u = new THREE.Vector3();
  const p = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (let c = 0; c <= cols; c++) {
    const phi = lerp(phi0, phi1, c / cols);
    const e0 = elOf(y0(phi));
    const e1 = typeof y1 === 'number' ? y1 : elOf(y1(phi));
    for (let r = 0; r <= rows; r++) {
      const t = (r / rows) ** 1.35;
      const el = lerp(e0, e1, t);
      headShape(headDir(phi, el, u), H, p);
      headShape(headDir(phi + 0.01, el, tmp), H, a).sub(p);
      headShape(headDir(phi, el + 0.01, tmp), H, b).sub(p);
      n.crossVectors(a, b);
      if (n.lengthSq() < 1e-14) n.copy(p);
      n.normalize();
      if (n.dot(p) < 0) n.negate();
      const th = thick(headDir(phi, el, u), p, t, phi);
      pos.push(p.x + n.x * th + O.x, p.y + n.y * th + O.y, p.z + n.z * th + O.z);
      uv.push((phi * 0.08) / UV_SCALE, (el * 0.1) / UV_SCALE);
    }
  }
  const S = rows + 1;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const i = c * S + r;
      idx.push(i, i + S, i + S + 1, i, i + S + 1, i + 1);
    }
  }
  // orientação: a face do meio da grade tem de olhar para fora
  const mid = (Math.floor(cols / 2) * S + Math.floor(rows / 2)) * 3;
  const P = (k: number) => V(pos[k], pos[k + 1], pos[k + 2]);
  const fa = P(mid);
  const fn = P(mid + S * 3).sub(fa).cross(P(mid + S * 3 + 3).sub(fa));
  if (fn.dot(fa.clone().sub(O)) < 0) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Linha do cabelo (altura local por ângulo em volta da cabeça: 0 = frente, π = nuca), contornando a orelha.
const HAIRLINE: [number, number][] = [
  [0, 0.06], [0.5, 0.062], [0.85, 0.054], [1.05, 0.04], [1.25, 0.02], [1.4, 0.014], [1.95, 0.014], [2.15, -0.035], [2.6, -0.066], [3.2, -0.076],
];

function buildHead(bd: Builder, b: Body, J: Joints, look: Look, skin: string, team: Team) {
  const H = b.head;
  const O = V(0, J.head.y + 0.055 * b.s, 0.004);
  const at = (x: number, y: number, z: number) => V(x, y, z).add(O);
  const hb = B.head;
  const hairC = HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0];
  const ex = H.w * 0.41;
  const noseY = -0.41 * H.chin;
  const mouthY = -0.615 * H.chin;

  // crânio e rosto
  const geo = new THREE.SphereGeometry(1, 32, 20);
  const pa = geo.attributes.position;
  const u = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) {
    u.fromBufferAttribute(pa, i);
    headShape(u, H, p).add(O);
    pa.setXYZ(i, p.x, p.y, p.z);
  }
  const blush = col('#c9655a');
  bd.add(geo, SKIN, (q) => {
    const l = q.clone().sub(O);
    const c = col(skin);
    if (l.z > 0.02) {
      c.lerp(blush, 0.13 * gauss(Math.abs(l.x) - 0.042, 0.018) * gauss(l.y + 0.03, 0.02));
      c.multiplyScalar(1 - 0.08 * gauss(Math.abs(l.x) - ex, 0.012) * gauss(l.y + 0.012, 0.007));
    }
    return c;
  }, hb);
  const base: HeadBase = { O };

  // olhos: esclera, íris, pupila e pálpebras
  const iris = look.hairColor === 3 && look.skin <= 1 ? '#4f6f88' : look.hairColor === 2 && look.skin <= 1 ? '#5d5a32' : '#4a2e1c';
  const lidC = shade(skin, 0.94);
  const lash = shade(hairC, 0.6);
  const toFront = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2);
  for (const s of [-1, 1]) {
    const f = faceAt(H, s * ex, 0, false);
    const E = at(s * ex, 0.001, f.p.z - 0.0118);
    const m = (q = new THREE.Quaternion()) => new THREE.Matrix4().compose(E, q, V(1, 1, 1));
    // só a metade da frente do olho aparece
    bd.add(new THREE.SphereGeometry(0.0118, 10, 6, 0, Math.PI, 0, Math.PI), SKIN, '#e6e0d8', hb, { m: m() });
    bd.add(new THREE.SphereGeometry(0.0119, 10, 2, 0, Math.PI * 2, 0, 0.5), SKIN, iris, hb, { m: m(toFront) });
    bd.add(new THREE.SphereGeometry(0.01195, 7, 1, 0, Math.PI * 2, 0, 0.22), SKIN, '#0b0b0b', hb, { m: m(toFront) });
    const lidT = Math.PI * (H.fem ? 0.35 : 0.37);
    const lashC = H.fem ? col('#141010') : lash;
    bd.add(new THREE.SphereGeometry(0.0129, 10, 3, 0, Math.PI, 0, lidT), SKIN, (q) => (q.y - E.y < 0.0129 * Math.cos(lidT) + 0.0004 ? lashC : lidC), hb, { m: m() });
    bd.add(new THREE.SphereGeometry(0.0126, 10, 2, 0, Math.PI, Math.PI * 0.68, Math.PI * 0.32), SKIN, lidC, hb, { m: m() });
    // sobrancelha
    const brow = H.fem
      ? [[0.012, 0.021], [0.026, 0.028], [0.04, 0.029], [0.053, 0.022]]
      : [[0.011, 0.019], [0.026, 0.0245], [0.04, 0.025], [0.054, 0.019]];
    const bp = brow.map(([x, y]) => {
      const fa = faceAt(H, s * x, y);
      return fa.p.addScaledVector(fa.n, 0.0012).add(O);
    });
    const bw = H.fem ? 0.0022 : 0.003;
    bd.add(cord(bp, (t) => [bw * (1 - 0.5 * t), 0.0015], 4), CLOTH, shade(hairC, look.hairColor >= 3 ? 0.7 : 1), hb);
    // orelha
    const ear = new THREE.Matrix4().compose(at(s * (H.w + 0.003), -0.014, -0.014),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, s * 0.5, 0)), V(0.0078, 0.029, 0.018));
    bd.add(new THREE.SphereGeometry(1, 8, 5), SKIN, shade(skin, 0.97), hb, { m: ear });
    const concha = new THREE.Matrix4().compose(at(s * (H.w + 0.0075), -0.016, -0.011),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, s * 0.5, 0)), V(0.004, 0.016, 0.0095));
    bd.add(new THREE.SphereGeometry(1, 6, 3), SKIN, shade(skin, 0.78), hb, { m: concha });
  }

  // nariz: dorso, ponta e asas
  const fz = (y: number) => faceAt(H, 0, y).p.z;
  const nk = H.fem ? 0.85 : 1;
  const nose: Ring[] = [
    { c: at(0, -0.006, fz(-0.006) - 0.007), rx: 0.0058 * nk, rz: 0.005 },
    { c: at(0, -0.018, fz(-0.018) - 0.0015), rx: 0.006 * nk, rz: 0.0056 },
    { c: at(0, -0.031, fz(-0.031) + 0.005 * nk), rx: 0.0068 * nk, rz: 0.0075 },
    { c: at(0, noseY + 0.009, fz(noseY + 0.009) + 0.0105 * nk), rx: 0.0094 * nk, rz: 0.009 },
    { c: at(0, noseY + 0.002, fz(noseY + 0.002) + 0.0075 * nk), rx: 0.0078 * nk, rz: 0.0068 },
  ];
  bd.add(tube(nose, 8, { capStart: 0, capEnd: 0.004 }).geo, SKIN, skin, hb);
  for (const s of [-1, 1]) {
    const z = fz(noseY + 0.004);
    bd.add(new THREE.SphereGeometry(1, 6, 4), SKIN, skin, hb, { m: new THREE.Matrix4().compose(at(s * 0.0105 * nk, noseY + 0.0045, z + 0.002), new THREE.Quaternion(), V(0.0062 * nk, 0.0058, 0.007)) });
    bd.add(new THREE.SphereGeometry(1, 5, 3), SKIN, shade(skin, 0.35), hb, { m: new THREE.Matrix4().compose(at(s * 0.0052 * nk, noseY + 0.0012, z + 0.0058), new THREE.Quaternion(), V(0.0028, 0.0014, 0.0036)) });
  }

  // boca: lábios com volume e a linha entre eles
  const lipC = mix(skin, H.fem ? '#b03a4a' : '#a4474f', H.fem ? 0.55 : 0.35);
  const mw = H.fem ? 0.023 : 0.0245;
  const lip = (dy: (t: number) => number, rv: (t: number) => number, rd: (t: number) => number, dz: number, segs = 5) => {
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = lerp(-mw, mw, t);
      const y = mouthY + dy(x / mw);
      pts.push(at(x, y, faceAt(H, x, y).p.z + dz));
    }
    return cord(pts, (t) => {
      const c = 1 - (2 * t - 1) ** 2;
      return [rv(c), rd(c)];
    }, segs);
  };
  bd.add(lip((x) => 0.0034 + 0.0008 * gauss(Math.abs(x) - 0.25, 0.15) - 0.0016 * x * x, (c) => 0.0011 + 0.0026 * c, (c) => 0.0026 + 0.0016 * c, 0.0008), SKIN, lipC, hb);
  bd.add(lip((x) => -0.0045 + 0.0016 * x * x, (c) => 0.001 + (H.fem ? 0.0042 : 0.0034) * c, (c) => 0.003 + 0.0016 * c, 0.0006), SKIN, lipC, hb);
  bd.add(lip((x) => 0.0002 * x * x, () => 0.0011, () => 0.0012, -0.0004, 3), SKIN, shade(lipC, 0.35), hb);

  buildHair(bd, base, H, look, hairC, skin);
  buildBeard(bd, base, H, look, hairC, noseY, mouthY);
  buildExtra(bd, base, H, look, team, ex);
}

function hairColorFn(c: string) {
  return (p: V3) => shade(c, 0.9 + 0.16 * hash3(p.x, p.y, p.z));
}

function buildHair(bd: Builder, h: HeadBase, H: HeadDims, look: Look, hairC: string, skin: string) {
  const hb = B.head;
  const covered = look.extra === 3 || look.extra === 5; // boné e chapéu cobrem o alto
  const k = H.top / 0.114;
  const az = (phi: number) => Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi)));
  const hairline = (phi: number) => table(HAIRLINE, az(phi)) * k - (H.fem ? 0.004 : 0);
  const color = hairColorFn(hairC);
  // espessura: cresce a partir da borda (sem degrau de capacete), com leve ondulação de mechas
  const body = (t: number, u: V3, phi: number, base: number, tufts = 0.0012) => {
    const v = covered && u.y > 0.05 ? Math.min(base, 0.006) : base + tufts * Math.sin(phi * 11 + u.y * 7);
    return t === 0 ? -0.001 : v * smooth(0, 0.22, t);
  };
  const full = (thick: (u: V3, p: V3, t: number, phi: number) => number, edge = hairline) =>
    bd.add(headGrid(H, h.O, 32, 7, -Math.PI, Math.PI, edge, Math.PI / 2 - 1e-4, thick), CLOTH, color, hb);
  switch (look.hair) {
    case 0: // raspado: quase rente, a cor mistura com a pele
      bd.add(headGrid(H, h.O, 32, 5, -Math.PI, Math.PI, hairline, Math.PI / 2 - 1e-4, (u, _p, t, phi) => body(t, u, phi, 0.0024, 0)),
        CLOTH, (p) => mix(color(p), skin, 0.3), hb);
      return;
    case 1: // curto
      full((u, _p, t, phi) => body(t, u, phi, 0.005 + 0.009 * smooth(-0.1, 0.6, u.y) + 0.004 * smooth(0.2, 0.8, u.z) * smooth(0.2, 0.7, u.y)));
      return;
    case 2: // topete: laterais baixas, volume para cima e para a frente
      full((u, _p, t, phi) => body(t, u, phi,
        0.003 + 0.007 * smooth(-0.1, 0.5, u.y) * (1 - 0.6 * Math.abs(u.x)) + 0.022 * smooth(0.4, 0.85, u.y) * smooth(-0.4, 0.5, u.z) * (1 - 0.5 * Math.abs(u.x))));
      return;
    case 3: // longo: cobre as orelhas e cai nas costas
      full((u, _p, t, phi) => body(t, u, phi, 0.008 + 0.006 * smooth(-0.2, 0.6, u.y) + 0.007 * smooth(0.5, 0.9, Math.abs(u.x)), 0.0018),
        (phi) => {
          const a = az(phi);
          return lerp(hairline(phi), -0.045 - 0.03 * smooth(1.6, 2.4, a), smooth(1.0, 1.35, a));
        });
      buildLongHair(bd, H, h.O, hairC);
      return;
    case 4: // rabo de cavalo: preso rente e o rabo atrás
      full((u, _p, t, phi) => body(t, u, phi, 0.004 + 0.004 * smooth(0, 0.6, u.y), 0.0006));
      buildPonytail(bd, H, h.O, hairC);
      return;
    default: { // careca: só a coroa das laterais e da nuca
      const top = (phi: number) => 0.03 + 0.035 * smooth(1.6, 3.0, az(phi));
      bd.add(headGrid(H, h.O, 26, 5, 1.3, Math.PI * 2 - 1.3, hairline, top, (_u, _p, t, phi) => {
        const ends = smooth(1.3, 1.7, az(phi));
        return t === 0 || t === 1 ? -0.001 : 0.0045 * Math.sin(t * Math.PI) * ends;
      }), CLOTH, color, hb);
    }
  }
}

/** Cabelo longo: cortina de seção em meia-lua que contorna a nuca e desce até as costas. */
function buildLongHair(bd: Builder, H: HeadDims, O: V3, hairC: string) {
  const bottom = H.fem ? -0.25 : -0.17;
  const ys = [0.03, 0, -0.04, -0.08, -0.12, -0.16, -0.2, -0.25].filter((y) => y >= bottom);
  if (ys[ys.length - 1] > bottom) ys.push(bottom);
  const rings: Ring[] = ys.map((y) => ({ c: V(0, y, 0).add(O), rx: 1, rz: 1, k: y }));
  const T = 0.016;
  const t = tube(rings, 20, {
    front: V(0, 0, 1),
    shape: (ri, _x, _z, a) => {
      const y = rings[ri].k!;
      const below = smooth(-0.03, -0.12, y);
      // abertura: na altura do rosto a mecha vem até a frente da orelha; embaixo fica só nas costas
      const open = lerp(0.3, -0.55, below);
      const tt = a / (Math.PI * 2);
      const half = tt < 0.5;
      const f = half ? tt / 0.5 : 1 - (tt - 0.5) / 0.5;
      const phi = lerp(Math.PI - open, 2 * Math.PI + open, f);
      const head = y > -0.06 ? Math.sqrt(Math.max(0, 1 - (y / (y > 0 ? H.top : H.chin)) ** 2)) : 0;
      const wy = lerp(H.w * Math.max(head, 0.92), H.w * 0.95 + 0.012 * smooth(-0.12, bottom, y), below);
      const dy = lerp(H.back * Math.max(head, 0.85), H.back * 0.7, below);
      const th = T * Math.sqrt(Math.sin(f * Math.PI)) + 0.002;
      const r = half ? 1 : 1 - th / Math.max(wy, dy);
      const zc = -0.03 * below - 0.012 * smooth(-0.1, bottom, y);
      return [Math.cos(phi) * (wy + T * 0.6) * r, zc + Math.sin(phi) * (dy + T * 0.6 + 0.012 * below) * r];
    },
  });
  const ylow = O.y - 0.06;
  bd.add(t.geo, CLOTH, hairColorFn(hairC), (p) => {
    const k = smooth(ylow, ylow - 0.15, p.y) * 0.7;
    return [[B.head, 1 - k], [B.neck, k * 0.5], [B.chest, k * 0.5]];
  });
}

function buildPonytail(bd: Builder, H: HeadDims, O: V3, hairC: string) {
  const bk = H.back;
  const pts = [V(0, 0.045, -bk * 0.9), V(0, 0.035, -bk - 0.012), V(0, 0.0, -bk - 0.032), V(0, -0.06, -bk - 0.034), V(0, -0.12, -bk - 0.024), V(0, -0.165, -bk - 0.014)];
  const rr = [0.013, 0.017, 0.02, 0.017, 0.012, 0.005];
  const rings = pts.map((c, i): Ring => ({ c: c.add(O), rx: rr[i], rz: rr[i] * 0.85 }));
  bd.add(tube(rings, 10, { capStart: 0, capEnd: 0.008 }).geo, CLOTH, hairColorFn(hairC), (p) => {
    const k = smooth(O.y - 0.05, O.y - 0.16, p.y) * 0.5;
    return [[B.head, 1 - k], [B.neck, k]];
  });
  const tie = new THREE.TorusGeometry(0.014, 0.004, 5, 12);
  bd.add(tie, CLOTH, '#1c1c1c', B.head, { m: new THREE.Matrix4().compose(V(0, 0.038, -bk - 0.008).add(O), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 0)), V(1, 1, 1)) });
}

function buildBeard(bd: Builder, h: HeadBase, H: HeadDims, look: Look, hairC: string, noseY: number, mouthY: number) {
  if (look.beard === 0) return;
  const hb = B.head;
  const color = hairColorFn(hairC);
  const lips = (p: V3) => (p.x / 0.027) ** 2 + ((p.y - mouthY) / 0.009) ** 2 < 1;
  // bigode por cima do lábio
  const ms: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const x = lerp(-0.031, 0.031, t);
    const y = mouthY + 0.0075 - 0.008 * (2 * t - 1) ** 2;
    ms.push(faceAt(H, x, y).p.add(V(0, 0, 0.003)).add(h.O));
  }
  bd.add(cord(ms, (t) => [0.0018 + 0.0035 * Math.sin(t * Math.PI), 0.0032], 5), CLOTH, color, hb);
  if (look.beard === 1) return;
  const under = -Math.PI / 2 - 0.55; // passa do queixo e entra embaixo da mandíbula
  if (look.beard === 2) {
    // cavanhaque: queixo e contorno da boca
    bd.add(headGrid(H, h.O, 12, 7, -0.42, 0.42, (phi) => mouthY + 0.002 - 0.03 * smooth(0.25, 0.42, Math.abs(phi)), -Math.PI / 2 - 0.2, (u, p, t) => {
      if (t === 0 || lips(p)) return -0.001;
      return (0.004 + 0.006 * smooth(-0.75, -1, u.y)) * (0.35 + 0.65 * smooth(0, 0.12, t));
    }), CLOTH, color, hb);
    return;
  }
  const fullB = look.beard === 4;
  const upper: [number, number][] = [[0, noseY - 0.004], [0.3, noseY - 0.008], [0.5, -0.046], [0.9, -0.04], [1.15, -0.026], [1.42, -0.012]];
  bd.add(headGrid(H, h.O, 22, 8, -1.42, 1.42, (phi) => table(upper, Math.abs(phi)), under, (u, p, t, phi) => {
    if (t === 0 || lips(p) || (p.z < -0.012 && p.y > -0.085)) return -0.001;
    const f = (0.35 + 0.65 * smooth(0, 0.12, t)) * smooth(1.42, 1.25, Math.abs(phi));
    return (fullB ? 0.007 + 0.016 * smooth(-0.7, -1, u.y) * smooth(-0.2, 0.6, u.z) : 0.0038) * f;
  }), CLOTH, color, hb);
}

function buildExtra(bd: Builder, h: HeadBase, H: HeadDims, look: Look, team: Team, ex: number) {
  const hb = B.head;
  const O = h.O;
  const at = (x: number, y: number, z: number) => V(x, y, z).add(O);
  /** Ponto da cabeça na direção d, afastado `off` para fora. */
  const over = (d: V3, off: number) => {
    const p = headShape(d.clone().normalize(), H, new THREE.Vector3(), false);
    return p.addScaledVector(p.clone().normalize(), off).add(O);
  };
  switch (look.extra) {
    case 1:
    case 2: { // óculos (só armação) e óculos escuros (lentes escuras)
      const sun = look.extra === 2;
      const frame = sun ? '#141414' : '#2b2420';
      const r = sun ? 0.0021 : 0.0015;
      const hw = 0.022;
      const hh = sun ? 0.0165 : 0.0152;
      const cz = faceAt(H, ex, 0, false).p.z + 0.011;
      for (const s of [-1, 1]) {
        const loop: V3[] = [];
        for (let i = 0; i <= 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          const c = Math.cos(a);
          const sn = Math.sin(a);
          const x = hw * Math.sign(c) * Math.abs(c) ** 0.55;
          const y = hh * Math.sign(sn) * Math.abs(sn) ** 0.55;
          loop.push(at(s * ex + x, -0.002 + y, cz - 0.006 * ((x * s) / hw + 1) ** 2 / 4));
        }
        bd.add(cord(loop, r, 5, false), SKIN, frame, hb);
        if (sun) {
          bd.add(new THREE.SphereGeometry(1, 14, 8), SKIN, '#0d0f12', hb,
            { m: new THREE.Matrix4().compose(at(s * ex, -0.002, cz - 0.0025), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * 0.12, 0)), V(hw * 0.97, hh * 0.97, 0.0032)) });
        }
        const temple = [at(s * (ex + hw), 0.004, cz - 0.006), at(s * (H.w + 0.006), 0.006, 0.045), at(s * (H.w + 0.007), 0.007, 0.0), at(s * (H.w + 0.004), -0.01, -0.022)];
        bd.add(cord(temple, r * 0.9, 4), SKIN, frame, hb);
      }
      bd.add(cord([at(-(ex - hw), 0.004, cz), at(0, 0.006, cz + 0.003), at(ex - hw, 0.004, cz)], r, 4), SKIN, frame, hb);
      break;
    }
    case 3: { // boné na cor do time, aba na cor de acabamento
      const tilt = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -0.33);
      const crown = new THREE.SphereGeometry(1, 28, 9, 0, Math.PI * 2, 0, 1.45);
      const pa = crown.attributes.position;
      const d = new THREE.Vector3();
      const edge: V3[] = [];
      for (let i = 0; i < pa.count; i++) {
        d.fromBufferAttribute(pa, i).applyQuaternion(tilt);
        const q = over(d, 0.016);
        pa.setXYZ(i, q.x, q.y, q.z);
      }
      const W1 = 29;
      for (let i = 0; i < W1; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pa, 9 * W1 + i);
        if (v.z - O.z > 0.03) edge.push(v);
      }
      bd.add(crown, CLOTH, team.color, hb);
      edge.sort((a, b) => a.x - b.x);
      const fwd = V(0, -0.2, 0.98).normalize();
      const xs = edge.map((e) => (e.x - O.x) / (H.w + 0.016));
      const brim: Ring[] = edge.map((e, i) => {
        const L = 0.07 * Math.sqrt(Math.max(0, 1 - xs[i] ** 2)) + 0.012;
        return { c: e.clone().addScaledVector(fwd, L / 2 - 0.004).add(V(0, -0.004, 0)), rx: 0.003, rz: L / 2, n: 4 };
      });
      bd.add(tube(brim, 10, { front: fwd, capStart: 0, capEnd: 0 }).geo, CLOTH, team.accent, hb);
      bd.add(new THREE.SphereGeometry(0.007, 8, 5), CLOTH, team.accent, hb, { m: new THREE.Matrix4().makeTranslation(over(V(0, 0.946, -0.324), 0.017)) });
      break;
    }
    case 4: { // fone de ouvido
      const band: V3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = lerp(-1.42, 1.42, i / 12);
        band.push(over(V(Math.sin(t), Math.cos(t), -0.08), 0.021));
      }
      bd.add(cord(band, () => [0.004, 0.011], 6), SKIN, '#1d1d1f', hb);
      for (const s of [-1, 1]) {
        const rot = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2);
        bd.add(new THREE.CylinderGeometry(0.029, 0.029, 0.022, 18), SKIN, '#242426', hb,
          { m: new THREE.Matrix4().compose(at(s * (H.w + 0.02), -0.014, -0.012), rot, V(1, 1, 1)), smooth: false });
        bd.add(new THREE.CylinderGeometry(0.027, 0.028, 0.012, 16), CLOTH, '#3a3a3c', hb,
          { m: new THREE.Matrix4().compose(at(s * (H.w + 0.008), -0.014, -0.012), rot, V(1, 1, 1)), smooth: false });
      }
      break;
    }
    case 5: { // chapéu de palha com fita na cor do time
      const D = (H.front + H.back) / 2;
      const sx = H.w * 0.98 + 0.012;
      const sz = D * 0.98 + 0.012;
      const zc = (H.front - H.back) / 2;
      const prof: [number, number][] = [
        [0, 0.03], [1.0, 0.03], [1.9, 0.016], [2.0, 0.021], [1.9, 0.027], [1.01, 0.041], [1.0, 0.07], [0.99, 0.12], [0.88, 0.146], [0.6, 0.157], [0, 0.161],
      ];
      const lathe = (pts: [number, number][], seg: number) => {
        const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
        g.applyMatrix4(new THREE.Matrix4().compose(V(0, 0, zc).add(O), new THREE.Quaternion(), V(sx, 1, sz)));
        return g;
      };
      bd.add(lathe(prof, 28), CLOTH, (p) => shade('#d9b968', 0.86 + 0.24 * hash3(p.x, p.y, p.z)), hb);
      bd.add(lathe([[1.014, 0.041], [1.012, 0.064]], 28), CLOTH, team.color, hb);
      break;
    }
  }
}

// ---------- bandeira, mastro e cartaz ----------

function handMatrix(b: Body, J: Joints, g: number): THREE.Matrix4 {
  const L = g > 0 ? 'L' : 'R';
  const Wr = J[`hand${L}`];
  const dir = Wr.clone().sub(J[`foreArm${L}`]).normalize();
  return new THREE.Matrix4().compose(Wr, new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), dir), V(b.hand, b.hand, b.hand));
}

/**
 * Na pose de referência o mastro fica deitado ao longo de +Z, atravessando o punho fechado; as animações giram o
 * punho para que +Z da mão aponte para cima. Por isso tudo aqui é montado em coordenadas "finais" (x, cima, frente)
 * e convertido: (x, y, z) final -> (x, -z, y) na pose de referência.
 */
function buildFlag(bd: Builder, b: Body, J: Joints, look: Look, team: Team) {
  const hb = B.handR;
  const G = V(0.02, -0.072, 0.002).applyMatrix4(handMatrix(b, J, -1));
  const P = (x: number, up: number, fwd: number) => V(G.x + x, G.y - fwd, G.z + up);
  const sign = look.flag === 3;
  const lo = sign ? -0.22 : -0.3;
  const hi = sign ? 0.64 : 1.0;
  const pole = new THREE.CylinderGeometry(0.011, 0.012, hi - lo, 8);
  bd.add(pole, CLOTH, '#8b6b45', hb, {
    m: new THREE.Matrix4().compose(P(0, (hi + lo) / 2, 0), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2), V(1, 1, 1)),
  });
  if (sign) {
    // cartaz: placa clara com moldura e "linhas de texto" na cor do time, centrada no mastro
    const box = (w: number, h: number, t: number, c: string, up: number, fwd = 0) =>
      bd.add(new THREE.BoxGeometry(w, t, h), CLOTH, c, hb, { m: new THREE.Matrix4().makeTranslation(P(0, up, fwd)), smooth: false });
    box(0.62, 0.44, 0.02, team.color, 0.84);
    box(0.56, 0.38, 0.03, '#f6f2e8', 0.84);
    for (let i = 0; i < 3; i++) box(0.42 - i * 0.08, 0.05, 0.034, team.color, 0.94 - i * 0.1);
    return;
  }
  bd.add(new THREE.SphereGeometry(0.02, 8, 6), SKIN, '#cfa94a', hb, { m: new THREE.Matrix4().makeTranslation(P(0, hi + 0.012, 0)) });
  // pano ondulado: sai do mastro para a direita do personagem (-X), com a ponta caindo um pouco
  const FW = 0.62;
  const FH = 0.42;
  const cloth = (v0: number, v1: number, color: string, uvOf: (u: number, v: number) => readonly [number, number]) => {
    const nx = 12;
    const ny = Math.max(2, Math.round((v1 - v0) * 7));
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const v = lerp(v0, v1, j / ny);
        const wave = 0.045 * Math.sin(u * Math.PI * 2.4 + 0.4) * smooth(0, 0.35, u) + 0.012 * Math.sin(v * 5 + u * 3);
        const p = P(-0.012 - u * FW * (1 - 0.03 * Math.sin(u * 7)), hi - 0.03 - v * FH - 0.05 * u * u, wave);
        pos.push(p.x, p.y, p.z);
        uv.push(...uvOf(u, v));
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    bd.add(g, FLAG, color, hb);
  };
  const white = () => [0.5, FLAG_UV_WHITE] as const;
  if (look.flag === 1) {
    cloth(0, 1, '#ffffff', (u, v) => flagUV(1 - u, 1 - v));
  } else {
    cloth(0, 0.34, team.color, white);
    cloth(0.34, 0.66, team.accent, white);
    cloth(0.66, 1, team.color, white);
  }
}

// ---------- montagem ----------

/** Template de um corpo de modelo .glb (null se ainda não carregou). A geometria é compartilhada. */
function modelTemplate(body: number): CharacterTemplate | null {
  const m = loadedModel(body);
  if (!m) return null;
  const root = new THREE.Group();
  root.add(cloneSkinned(m.scene));
  return { root, clips: clipsFor(0, m.hipsY, false), height: m.height, shared: true };
}

export function buildCharacter(look: Look, team: Team): CharacterTemplate {
  if (MODEL_BODIES[look.body]) {
    // Modelo .glb pronto; enquanto não carregou, um corpo gerado com o mesmo visual segura o lugar.
    const m = modelTemplate(look.body);
    if (m) return m;
    look = { ...look, body: 0 };
  }
  const b = BODY[look.body] ?? BODY[0];
  const J = jointPositions(b);
  const bd = new Builder();
  const skin = SKINS[look.skin] ?? SKINS[0];
  const gm = garment(look, team);
  buildTorso(bd, b, J, look, gm, skin, team);
  for (const g of [1, -1]) {
    buildArm(bd, b, J, g, look, gm, skin);
    buildLeg(bd, b, J, g, look, skin);
  }
  buildHead(bd, b, J, look, skin, team);
  if (look.flag > 0) buildFlag(bd, b, J, look, team);

  const all = getMaterials();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  bd.parts.forEach((list, i) => {
    if (!list.length) return;
    geos.push(mergeGeometries(list, false)!);
    for (const g of list) g.dispose();
    mats.push(all[i]);
  });
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, true)!;
  if (geos.length > 1) for (const g of geos) g.dispose();
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
  const mesh = new THREE.SkinnedMesh(geo, mats.length === 1 ? mats[0] : mats);
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const root = new THREE.Group();
  root.add(mesh);
  return { root, clips: clipsFor(look.body, J.hips.y, look.flag > 0), height: b.height };
}

// ---------- animações ----------

type Pose = Partial<Record<BoneName, [number, number, number]>>;
type Frame = { pose: Pose; hips?: [number, number, number] };

const TAU = Math.PI * 2;
const qa = new THREE.Quaternion();
const ea = new THREE.Euler();
/** Sino periódico em torno de c (fase de 0 a 1). */
const bump = (p: number, c: number, w: number) => gauss(p - c - Math.round(p - c), w);

/** Clip amostrado de uma função da fase (0–1); a última chave repete a primeira para o ciclo fechar. */
function sampled(name: string, duration: number, n: number, hipsY: number, fn: (p: number) => Frame): THREE.AnimationClip {
  const frames = Array.from({ length: n + 1 }, (_, i) => fn((i % n) / n));
  const times = frames.map((_, i) => (i / n) * duration);
  const used = new Set<BoneName>();
  for (const f of frames) for (const k of Object.keys(f.pose) as BoneName[]) used.add(k);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const bone of used) {
    const values: number[] = [];
    const prev = new THREE.Quaternion();
    frames.forEach((f, i) => {
      const [x, y, z] = f.pose[bone] ?? [0, 0, 0];
      qa.setFromEuler(ea.set(x, y, z));
      if (i > 0 && prev.dot(qa) < 0) qa.set(-qa.x, -qa.y, -qa.z, -qa.w);
      prev.copy(qa);
      values.push(qa.x, qa.y, qa.z, qa.w);
    });
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, frames.flatMap((f) => {
    const [x, y, z] = f.hips ?? [0, 0, 0];
    return [x, hipsY + y, z];
  })));
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Rotação do punho direito para o mastro (eixo +Z da mão) apontar para `target` no mundo. */
function holdHand(pose: Pose, target: V3 = V(0, 1, 0)): [number, number, number] {
  const q = new THREE.Quaternion();
  for (const n of ['hips', 'spine', 'chest', 'upperArmR', 'foreArmR'] as BoneName[]) {
    const [x, y, z] = pose[n] ?? [0, 0, 0];
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
  }
  const local = target.clone().normalize().applyQuaternion(q.invert());
  const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), local));
  return [e.x, e.y, e.z];
}

const clipCache = new Map<string, THREE.AnimationClip[]>();

/** Animações (índices ANIM) para o esqueleto padrão; também usadas pelos modelos .glb com o mesmo esqueleto. */
export function clipsFor(body: number, hipsY: number, hold: boolean): THREE.AnimationClip[] {
  const key = `${body}:${hipsY.toFixed(3)}:${hold ? 1 : 0}`;
  const cached = clipCache.get(key);
  if (cached) return cached;
  const fem = body === 1;
  const big = body === 2;
  const legLen = hipsY * 0.9;
  const out = big ? 0.07 : fem ? -0.01 : 0; // abertura extra dos braços (barriga do tiozão)
  const sway = fem ? 1.35 : big ? 0.8 : 1;

  /** Braço direito com o mastro: antebraço à frente e punho girado para o mastro ficar em pé. */
  const holdArm = (pose: Pose, lift = 0, target?: V3) => {
    if (!hold) return pose;
    pose.upperArmR = [-0.2 - lift, 0, -0.06 - out];
    pose.foreArmR = [-1.15 + lift * 0.35, 0, 0];
    pose.handR = holdHand(pose, target);
    return pose;
  };
  /** Pés parados no chão quando o quadril desloca de lado e inclina. */
  const plant = (pose: Pose, dx: number, tilt: number) => {
    const z = -Math.asin(dx / legLen) - tilt;
    for (const s of ['L', 'R'] as const) {
      const up = pose[`upperLeg${s}`] ?? [0, 0, 0];
      const lo = pose[`lowerLeg${s}`] ?? [0, 0, 0];
      pose[`upperLeg${s}`] = [up[0], up[1], up[2] + z];
      const f = pose[`foot${s}`] ?? [0, 0, 0];
      pose[`foot${s}`] = [f[0] - up[0] - lo[0], f[1], f[2] - z - tilt];
    }
    return pose;
  };

  // Parado: respira, troca o peso de perna devagar e olha em volta.
  const idle = sampled('idle', 6, 48, hipsY, (p) => {
    const ws = Math.sin(TAU * p);
    const br = Math.sin(TAU * p * 2);
    const look = Math.sin(TAU * p + 1.2);
    const dx = 0.016 * ws * sway;
    const tilt = 0.03 * ws * sway;
    const freeL = Math.max(0, -ws);
    const freeR = Math.max(0, ws);
    const pose: Pose = {
      hips: [0, 0.03 * ws, tilt],
      spine: [0.01 * br, -0.015 * ws, -tilt * 0.6],
      chest: [-0.015 * br, -0.01 * ws, -tilt * 0.35],
      neck: [0.02, 0.05 * look, 0],
      head: [0.02 + 0.02 * Math.sin(TAU * p * 3), 0.1 * look, -tilt * 0.3],
      upperLegL: [-0.07 * freeL, 0, 0], upperLegR: [-0.07 * freeR, 0, 0],
      lowerLegL: [0.15 * freeL, 0, 0], lowerLegR: [0.15 * freeR, 0, 0],
      footL: [0, 0, 0], footR: [0, 0, 0],
      upperArmL: [0.04, 0, 0.02 + out + 0.012 * br], upperArmR: [0.04, 0, -0.02 - out - 0.012 * br],
      foreArmL: [-0.2, 0, 0], foreArmR: [-0.2, 0, 0],
      handL: [0.05, -0.15, 0.04], handR: [0.05, 0.15, -0.04],
    };
    plant(pose, dx, tilt);
    return { pose: holdArm(pose), hips: [dx, -0.004 - 0.004 * Math.abs(ws), 0] };
  });

  /** Andar e correr: perna e braço opostos, giro do quadril contra o do peito, sobe e desce. */
  const gait = (name: string, duration: number, run: boolean) => sampled(name, duration, 24, hipsY, (p) => {
    const s = Math.sin(TAU * p);
    const c = Math.cos(TAU * p);
    const sa = Math.sin(TAU * (p - 0.03));
    const legs = (q: number) => {
      const th = run ? 0.2 + 0.62 * Math.sin(TAU * q) : 0.42 * Math.sin(TAU * q);
      const knee = run
        ? 0.25 + 1.45 * bump(q, 0.9, 0.15) + 0.3 * bump(q, 0.38, 0.07)
        : 0.06 + 0.72 * bump(q, 0.97, 0.12) + 0.16 * bump(q, 0.36, 0.07);
      const pitch = run
        ? -0.15 * bump(q, 0.3, 0.05) + 0.6 * bump(q, 0.62, 0.08) + 0.2 * bump(q, 0.85, 0.1)
        : -0.25 * bump(q, 0.24, 0.06) + 0.5 * bump(q, 0.82, 0.07) - 0.1 * bump(q, 0.05, 0.12);
      return { th, knee, foot: pitch + th - knee };
    };
    const l = legs(p);
    const r = legs(p + 0.5);
    const yaw = (run ? 0.15 : 0.12) * s;
    const list = 0.045 * c * sway;
    const arm = run ? 0.62 : 0.36;
    const pose: Pose = {
      hips: [run ? 0.06 : 0, -yaw, -list],
      spine: [run ? 0.14 : 0.04, yaw * 0.8, list * 0.7],
      chest: [(run ? 0.06 : 0) + 0.015 * Math.cos(2 * TAU * p), yaw * (run ? 1.0 : 0.75), list * 0.25],
      neck: [run ? -0.06 : -0.01, -yaw * 0.4, 0],
      head: [run ? -0.16 : -0.03, -yaw * 0.4, list * 0.1],
      upperLegL: [-l.th, 0, 0.0], upperLegR: [-r.th, 0, 0.0],
      lowerLegL: [l.knee, 0, 0], lowerLegR: [r.knee, 0, 0],
      footL: [l.foot, 0, 0], footR: [r.foot, 0, 0],
      upperArmL: [arm * sa, run ? -0.1 : 0, (run ? 0.12 : 0.03) + out], upperArmR: [-arm * sa, run ? 0.1 : 0, -(run ? 0.12 : 0.03) - out],
      foreArmL: [run ? -1.35 - 0.25 * Math.max(0, -sa) : -0.24 - 0.3 * Math.max(0, -sa), 0, 0],
      foreArmR: [run ? -1.35 - 0.25 * Math.max(0, sa) : -0.24 - 0.3 * Math.max(0, sa), 0, 0],
      handL: [0.1, -0.1, 0.05], handR: [0.1, 0.1, -0.05],
    };
    const bob = run ? 0.035 * Math.cos(2 * TAU * (p - 0.17)) - 0.04 : 0.02 * Math.cos(2 * TAU * p) - 0.012;
    holdArm(pose, 0.08 * s, V(0.1 * s, 1, 0));
    return { pose, hips: [-(run ? 0.012 : 0.018) * c * sway, bob, 0] };
  });

  // Aceno: braço direito no alto, antebraço indo e voltando, mão aberta para a frente.
  // Com bandeira, levanta o mastro e balança a bandeira de um lado para o outro.
  const wave = sampled('wave', 1.2, 24, hipsY, (p) => {
    const w = Math.sin(TAU * 2 * p);
    const bob = Math.sin(TAU * 2 * p - 0.6);
    const pose: Pose = {
      hips: [0, 0.03, 0.02], spine: [0, 0.02, 0.04], chest: [0, 0.04, 0.03],
      neck: [0, -0.06, 0], head: [-0.02, -0.12, 0.05 + 0.02 * bob],
      upperLegL: [0, 0, 0], upperLegR: [-0.04, 0, 0], lowerLegL: [0.02, 0, 0], lowerLegR: [0.1, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0],
      upperArmL: [0.03, 0, 0.03 + out], foreArmL: [-0.22, 0, 0], handL: [0.05, -0.15, 0.04],
      upperArmR: [-0.3, 0.2, -2.3], foreArmR: [-0.3, 0, -0.35 + 0.45 * w], handR: [0.1, -1.3, 0.25 * Math.sin(TAU * 2 * p - 0.8)],
    };
    plant(pose, 0, 0.02);
    if (hold) {
      pose.upperArmR = [-2.55, 0, -0.25 + 0.2 * w];
      pose.foreArmR = [-0.25, 0, 0];
      pose.handR = holdHand(pose, V(-0.45 * w - 0.15, 1, 0.05));
    }
    return { pose, hips: [0, -0.004, 0] };
  });

  // Dança: passo para os lados no tempo, quadril balançando, braços dobrados subindo alternados, cabeça marcando o ritmo.
  const dance = sampled('dance', 2, 48, hipsY, (p) => {
    const sw = Math.sin(TAU * p);
    const beat = 0.5 - 0.5 * Math.cos(TAU * 4 * p); // 0 em cima, 1 embaixo, quatro por ciclo
    const twist = Math.sin(TAU * 2 * p);
    const pumpL = 0.5 + 0.5 * Math.sin(TAU * 4 * p);
    const pumpR = 1 - pumpL;
    const dx = 0.05 * sw;
    const tilt = 0.08 * sw;
    const freeL = Math.max(0, -sw);
    const freeR = Math.max(0, sw);
    const pose: Pose = {
      hips: [0.05 * beat, 0.25 * twist, tilt],
      spine: [0.04 + 0.04 * beat, -0.12 * twist, -tilt * 0.8],
      chest: [0.04 * beat, -0.1 * twist, -tilt * 0.4],
      neck: [0.06 * beat, 0.05 * twist, 0],
      head: [0.1 * beat - 0.04, 0.1 * twist, 0.05 * sw],
      upperLegL: [-0.25 * beat - 0.35 * freeL, 0, 0.04], upperLegR: [-0.25 * beat - 0.35 * freeR, 0, -0.04],
      lowerLegL: [0.45 * beat + 0.7 * freeL, 0, 0], lowerLegR: [0.45 * beat + 0.7 * freeR, 0, 0],
      footL: [-0.2 * beat * 0 + 0.25 * freeL, 0, 0], footR: [0.25 * freeR, 0, 0],
      upperArmL: [-0.35 - 0.7 * pumpL, -0.2, 0.55 + 0.3 * pumpL + out], upperArmR: [-0.35 - 0.7 * pumpR, 0.2, -0.55 - 0.3 * pumpR - out],
      foreArmL: [-1.5 + 0.3 * pumpL, 0, 0.2], foreArmR: [-1.5 + 0.3 * pumpR, 0, -0.2],
      handL: [0.2, 0, 0.1], handR: [0.2, 0, -0.1],
    };
    plant(pose, dx, tilt);
    holdArm(pose, 0.5 * pumpR, V(0.2 * twist, 1, 0));
    return { pose, hips: [dx, -0.05 * beat - 0.01, 0] };
  });

  const list: THREE.AnimationClip[] = [];
  list[ANIM.idle] = idle;
  list[ANIM.walk] = gait('walk', 1.0, false);
  list[ANIM.run] = gait('run', 0.62, true);
  list[ANIM.wave] = wave;
  list[ANIM.dance] = dance;
  clipCache.set(key, list);
  return list;
}
