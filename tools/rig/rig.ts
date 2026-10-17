/**
 * Rig automático: personagem estático em pose T (GLB gerado por IA) → GLB com o esqueleto padrão do jogo.
 *
 *   node tools/rig/rig.ts <entrada.glb> <saída.glb>
 *   node tools/rig/check.ts <saída.glb>            (deformação da saia e das pernas nas animações do jogo)
 *
 * 1. Carrega e solda; normaliza (1,75 m, pés em y = 0, quadril em x = z = 0, olhando para +Z).
 * 2. Acha as juntas na própria malha (linha dos braços em pose T, pés, pescoço) e completa com proporções.
 * 3. Na malha original: apaga o fundo da saia (o "chão" que fecha a barra e encosta nas canelas); assim as pernas
 *    viram peças soltas e a saia, um tubo aberto como uma saia de verdade.
 * 4. Simplifica (meshoptimizer) para ~19 mil triângulos com orçamento por região: cabeça e mãos entram ampliadas
 *    na medida de erro, então ficam com bem mais triângulos que o resto; costuras de UV não abrem.
 * 5. Canelas: prolonga cada uma, fechada, para dentro da saia até perto do joelho, com a cor da pele.
 * 6. Pesos de pele por região (braços, tronco, cabeça, saia, canelas e pés), suavizados pelos vizinhos da malha,
 *    até 4 ossos por vértice. A saia acompanha as duas pernas de forma contínua (sem rasgar no meio) e o painel de
 *    trás, abaixo do joelho, acompanha a canela (o chute da corrida levanta o pano em vez de atravessá-lo).
 * 7. Normal map em espaço tangente cozido da malha original (relevo do rosto, mãos, dobras e bordados).
 * 8. Abaixa os braços (pose T → braços ao lado do corpo) girando cada vértice pela própria pele e grava o bind
 *    nessa pose, com o esqueleto em rotações identidade: as animações de `clipsFor` funcionam direto.
 * 9. Texturas em WebP (cor 2048², normais 1024²), sem animações; extras.hipsY e extras.height no nó raiz.
 *
 * Os nomes e a hierarquia dos ossos vêm do próprio jogo (client/src/scene/character.ts).
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BONES, PARENT, type BoneName } from '../../client/src/scene/character.ts';
import { areaNormals, bakeNormalMap, vertexTangents } from './bake.ts';

const HEIGHT = 1.75;
const TARGET_TRIS = 19300;
const TEX_SIZE = 2048;
const NORMAL_SIZE = 1024;
/** Ampliação da cabeça e das mãos na medida de erro da simplificação (mais triângulos onde o olho repara). */
const HEAD_ZOOM = 2.6;
const HAND_ZOOM = 2.8;
/** Idem para canelas e pés abaixo da barra (só no plano horizontal: a seção da canela fica redonda). */
const LEG_ZOOM = 1.8;
/** Peso da UV na simplificação (contra escorregar a textura nas costuras). */
const UV_WEIGHT = 0.5;
/** Abertura dos braços em repouso (graus a partir da vertical): a bata é larga, então um pouco mais que o boneco do jogo. */
const ARM_OUT_DEG = 11;

type Vec = [number, number, number];
type Joints = Record<BoneName, Vec>;

const BI = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;
const NB = BONES.length;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec): Vec => scale(a, 1 / (len(a) || 1));
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const fmt = (v: Vec) => `(${v.map((x) => x.toFixed(3)).join(', ')})`;
const mix3 = (a: Vec, b: Vec, t: number): Vec => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Rotação de `p` em torno do eixo unitário `k` (Rodrigues). */
function rotate(p: Vec, k: Vec, ang: number): Vec {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const kxp = cross(k, p);
  const kdp = dot(k, p) * (1 - c);
  return [p[0] * c + kxp[0] * s + k[0] * kdp, p[1] * c + kxp[1] * s + k[1] * kdp, p[2] * c + kxp[2] * s + k[2] * kdp];
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Leitura e solda
// ---------------------------------------------------------------------------------------------------------------

type Mesh = { pos: Float32Array<ArrayBuffer>; uv: Float32Array<ArrayBuffer>; idx: Uint32Array<ArrayBuffer> };
type MatInfo = { color: [number, number, number, number]; roughness: number; metallic: number; doubleSided: boolean };

async function load(path: string): Promise<{ hi: Mesh; image: Uint8Array | null; mat: MatInfo }> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path);
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  if (!prims.length) throw new Error('nenhuma malha na entrada');
  const prim = prims.reduce((a, b) => ((b.getIndices()?.getCount() ?? 0) > (a.getIndices()?.getCount() ?? 0) ? b : a));
  if (prims.length > 1) console.warn(`aviso: ${prims.length} primitivas; usando a maior`);
  // Transformação do nó (em geral identidade) aplicada direto nas posições.
  const node = doc.getRoot().listNodes().find((n) => n.getMesh()?.listPrimitives().includes(prim));
  const m = node?.getWorldMatrix() ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const tri0 = (prim.getIndices()?.getCount() ?? 0) / 3;
  const v0 = prim.getAttribute('POSITION')!.getCount();
  await doc.transform(weld());
  const posA = prim.getAttribute('POSITION')!;
  const uvA = prim.getAttribute('TEXCOORD_0');
  const n = posA.getCount();
  const pos = new Float32Array(n * 3);
  const el: number[] = [];
  for (let i = 0; i < n; i++) {
    posA.getElement(i, el);
    pos[i * 3] = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
    pos[i * 3 + 1] = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
    pos[i * 3 + 2] = m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14];
  }
  const uv = new Float32Array(n * 2);
  if (uvA) for (let i = 0; i < n; i++) uvA.getElement(i, el), (uv[i * 2] = el[0]), (uv[i * 2 + 1] = el[1]);
  const idx = Uint32Array.from(prim.getIndices()!.getArray()!);
  console.log(`entrada: ${tri0} triângulos, ${v0} vértices (${n} após solda)`);
  const material = prim.getMaterial();
  const tex = material?.getBaseColorTexture();
  const mat: MatInfo = {
    color: (material?.getBaseColorFactor() ?? [1, 1, 1, 1]) as [number, number, number, number],
    roughness: material?.getRoughnessFactor() ?? 0.8,
    metallic: material?.getMetallicFactor() ?? 0,
    doubleSided: material?.getDoubleSided() ?? false,
  };
  return { hi: { pos, uv, idx }, image: tex?.getImage() ?? null, mat };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Normalização (altura, pés no chão, frente em +Z)
// ---------------------------------------------------------------------------------------------------------------

type Frame = { s: number; off: Vec; flip: boolean };

function applyFrame(src: Float32Array, f: Frame): Float32Array<ArrayBuffer> {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    let x = src[i] * f.s + f.off[0];
    let z = src[i + 2] * f.s + f.off[2];
    if (f.flip) (x = -x), (z = -z);
    out[i] = x;
    out[i + 1] = src[i + 1] * f.s + f.off[1];
    out[i + 2] = z;
  }
  return out;
}

function bounds(p: Float32Array) {
  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
  return { min, max };
}

/**
 * Escala para HEIGHT, pés em y = 0, centro da caixa em x = z = 0; vira 180° se os dedos dos pés apontarem para -Z.
 * Medido na malha original (os vértices extremos ficam travados na simplificação).
 */
function normalize(src: Float32Array): Frame {
  const { min, max } = bounds(src);
  const s = HEIGHT / (max[1] - min[1]);
  const f: Frame = { s, off: [-(min[0] + max[0]) / 2 * s, -min[1] * s, -(min[2] + max[2]) / 2 * s], flip: false };
  const p = applyFrame(src, f);
  // Frente: a ponta dos pés passa bem mais à frente do tornozelo do que o calcanhar passa para trás.
  let zs: number[] = [];
  let za: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 1] < 0.03) zs.push(p[i + 2]);
    else if (p[i + 1] > 0.09 && p[i + 1] < 0.13) za.push(p[i + 2]);
  }
  zs = zs.sort((a, b) => a - b);
  za = za.sort((a, b) => a - b);
  const ankle = (za[0] + za[za.length - 1]) / 2;
  const toe = zs[zs.length - 1] - ankle;
  const heel = ankle - zs[0];
  f.flip = toe < heel;
  console.log(`normalização: escala ${s.toFixed(4)}, pés: frente ${toe.toFixed(3)} m, trás ${heel.toFixed(3)} m${f.flip ? ' → girado 180°' : ''}`);
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// 2b. Juntas a partir da malha
// ---------------------------------------------------------------------------------------------------------------

type Slice = { n: number; min: Vec; max: Vec; c: Vec };

/** Fatia de vértices perto de `v` no eixo `axis`, com filtro opcional. */
function slice(p: Float32Array, axis: number, v: number, h: number, keep?: (x: number, y: number, z: number) => boolean): Slice {
  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i + axis] - v) > h) continue;
    if (keep && !keep(p[i], p[i + 1], p[i + 2])) continue;
    n++;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
  return { n, min, max, c: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

type Detect = {
  J: Joints;
  /** Altura da barra da saia, raio das canelas, meia largura do pescoço no ponto mais fino, raio do braço. */
  hemY: number; shinR: number; neckR: number; armR: number;
};

function detect(p: Float32Array, quiet = false): Detect {
  const H = HEIGHT;
  const log: string[] = [];

  // --- pés e canelas ---
  // Barra da saia: subindo dos pés, primeira altura em que a fatia fica bem mais larga que as duas canelas.
  // (largura lateral ou profundidade bem maiores que as das duas canelas logo acima dos pés)
  const shinS = slice(p, 1, 0.11, 0.01);
  const shinOuter = Math.max(-shinS.min[0], shinS.max[0]);
  const shinDepth = shinS.max[2] - shinS.min[2];
  let hemY = 0.11;
  for (let y = 0.11; y < 0.6 * H; y += 0.0025) {
    const s = slice(p, 1, y, 0.002);
    if (s.n && (Math.max(-s.min[0], s.max[0]) > shinOuter * 1.35 || s.max[2] - s.min[2] > shinDepth * 1.6)) {
      hemY = y;
      break;
    }
  }
  const legC = (g: number) => {
    // centro e raio da canela entre o tornozelo e a barra (sem encostar no fundo da saia)
    const ys = [0.1, (0.1 + hemY) / 2, hemY - 0.02];
    const cs = ys.map((y) => slice(p, 1, y, 0.004, (x) => x * g > 0.01));
    const c: Vec = [0, 0, 0];
    for (const s of cs) for (let k = 0; k < 3; k++) c[k] += s.c[k] / cs.length;
    const r = cs.reduce((a, s) => a + (s.max[0] - s.min[0] + s.max[2] - s.min[2]) / 4, 0) / cs.length;
    return { c, r };
  };
  const shinL = legC(1);
  const shinR = legC(-1);
  // Tornozelo: onde o peito do pé começa a avançar (z máx. da fatia salta em relação à canela), limitado a 4–5% da
  // altura (o peito do pé sobe acima do maléolo).
  let ankleY = 0.08;
  for (let y = 0.14; y > 0.02; y -= 0.0025) {
    const s = slice(p, 1, y, 0.002, (x) => x > 0.01);
    if (s.n && s.max[2] > shinL.c[2] + shinL.r * 1.6) {
      ankleY = y;
      break;
    }
  }
  ankleY = Math.min(Math.max(ankleY, 0.04 * H), 0.05 * H);
  log.push(`barra da saia y=${hemY.toFixed(3)}; canelas ${fmt(shinL.c)} r=${shinL.r.toFixed(3)} / ${fmt(shinR.c)}; tornozelo y=${ankleY.toFixed(3)}`);

  // --- braços (pose T) ---
  const armSide = (g: number) => {
    let reach = 0;
    for (let i = 0; i < p.length; i += 3) if (p[i + 1] > 0.5 * H) reach = Math.max(reach, p[i] * g);
    const upper = (x: number, y: number) => y > 0.5 * H && x * g > 0;
    // perfil ao longo do braço: centro e espessuras
    const prof: { x: number; s: Slice }[] = [];
    for (let x = 0.1; x <= reach - 0.003; x += 0.005) prof.push({ x, s: slice(p, 0, x * g, 0.0025, (xx, y) => upper(xx, y)) });
    // linha do braço: regressão dos centros entre 50% e 72% do alcance (braço e antebraço sem manga nem mão)
    const fit = prof.filter((q) => q.s.n > 0 && q.x > 0.5 * reach && q.x < 0.72 * reach);
    const mx = fit.reduce((a, q) => a + q.x, 0) / fit.length;
    const my = fit.reduce((a, q) => a + q.s.c[1], 0) / fit.length;
    const mz = fit.reduce((a, q) => a + q.s.c[2], 0) / fit.length;
    let sxx = 0, sxy = 0, sxz = 0;
    for (const q of fit) (sxx += (q.x - mx) ** 2), (sxy += (q.x - mx) * (q.s.c[1] - my)), (sxz += (q.x - mx) * (q.s.c[2] - mz));
    const ky = sxy / sxx;
    const kz = sxz / sxx;
    const line = (x: number): Vec => [x * g, my + ky * (x - mx), mz + kz * (x - mx)];
    const armR = fit.reduce((a, q) => a + (q.s.max[1] - q.s.min[1] + q.s.max[2] - q.s.min[2]) / 4, 0) / fit.length;
    // borda do tronco embaixo do braço (axila): vindo de fora para dentro, a primeira fatia com vértices numa faixa
    // logo abaixo do braço (a barra larga da bata, mais embaixo, não conta)
    let torsoX = 0.15;
    for (let x = 0.5 * reach; x > 0.05; x -= 0.005) {
      const y0 = line(x)[1];
      const s = slice(p, 0, x * g, 0.0025, (_, y) => y > y0 - armR - 0.2 && y < y0 - armR - 0.08);
      if (s.n) {
        torsoX = x;
        break;
      }
    }
    // a junta do ombro fica um pouco para dentro da axila
    const shoulderX = torsoX - 0.025;
    // punho: menor seção (largura × altura) entre 62% e 85% do comprimento ombro→ponta; depois avança enquanto
    // a seção não cresce (pulseiras) até começar a mão (polegar)
    const area = (q: { s: Slice }) => (q.s.max[1] - q.s.min[1]) * (q.s.max[2] - q.s.min[2]);
    const L = reach - shoulderX;
    const win = prof.filter((q) => q.s.n && q.x > shoulderX + 0.62 * L && q.x < shoulderX + 0.85 * L);
    let iMin = 0;
    for (let k = 1; k < win.length; k++) if (area(win[k]) < area(win[iMin])) iMin = k;
    let wristX = win[iMin].x;
    const aMin = area(win[iMin]);
    for (let k = iMin + 1; k < win.length && area(win[k]) < aMin * 1.25; k++) wristX = win[k].x;
    // cotovelo: proporção braço/antebraço de adulto (≈ 0,55 do ombro ao punho)
    const elbowX = shoulderX + 0.55 * (wristX - shoulderX);
    return { reach, line, armR, torsoX, shoulderX, wristX, elbowX };
  };
  const aL = armSide(1);
  const aR = armSide(-1);

  // --- pescoço e cabeça ---
  const halfW = (y: number) => {
    const s = slice(p, 1, y, 0.003, (x) => Math.abs(x) < aL.torsoX + 0.1);
    return s.n ? Math.max(-s.min[0], s.max[0]) : 0;
  };
  const armY = (aL.line(aL.shoulderX)[1] + aR.line(aR.shoulderX)[1]) / 2;
  const chestW = halfW(armY - 0.15);
  let neckY = armY + 0.1;
  for (let y = armY; y < H; y += 0.0025) {
    if (halfW(y) < chestW * 0.55) {
      neckY = y - 0.005;
      break;
    }
  }
  let neckMinY = neckY;
  let wMin = Infinity;
  for (let y = neckY; y < neckY + 0.12; y += 0.0025) {
    const w = halfW(y);
    if (w < wMin) (wMin = w), (neckMinY = y);
  }
  let headY = neckMinY + 0.03;
  for (let y = neckMinY; y < neckMinY + 0.12; y += 0.0025) {
    if (halfW(y) > wMin * 1.12) {
      headY = y;
      break;
    }
  }
  const zMid = (y: number) => slice(p, 1, y, 0.004, (x) => Math.abs(x) < wMin * 1.2).c[2];
  log.push(`braço: linha y=${armY.toFixed(3)}, raio ${aL.armR.toFixed(3)}, borda do tronco x=${aL.torsoX.toFixed(3)}, alcance ${aL.reach.toFixed(3)}`);
  log.push(`pescoço: base y=${neckY.toFixed(3)}, mais fino y=${neckMinY.toFixed(3)} (meia largura ${wMin.toFixed(3)}), cabeça y=${headY.toFixed(3)}`);

  // --- coluna e pernas por proporção (mesmas frações do boneco do jogo entre o tornozelo e a base do pescoço) ---
  const span = neckY - ankleY;
  const at = (f: number) => ankleY + f * span;
  const hipsY = at(0.628);
  const torsoZ = (y: number) => slice(p, 1, y, 0.006, (x) => Math.abs(x) < 0.12).c[2];
  const J = {} as Joints;
  J.hips = [0, hipsY, torsoZ(hipsY)];
  J.spine = [0, at(0.713), torsoZ(at(0.713))];
  J.chest = [0, at(0.826), torsoZ(at(0.826))];
  J.neck = [0, neckY, zMid(neckY)];
  J.head = [0, headY, zMid(headY)];
  const hipX = Math.min(Math.max(0.52 * aL.shoulderX, 0.6 * shinL.c[0]), shinL.c[0]);
  for (const [g, S, a, shin] of [[1, 'L', aL, shinL], [-1, 'R', aR, shinR]] as const) {
    J[`upperArm${S}`] = a.line(a.shoulderX);
    J[`foreArm${S}`] = a.line(a.elbowX);
    J[`hand${S}`] = a.line(a.wristX);
    const hip: Vec = [g * hipX, at(0.586), J.hips[2]];
    const ankle: Vec = [shin.c[0], ankleY, shin.c[2]];
    J[`upperLeg${S}`] = hip;
    J[`lowerLeg${S}`] = mix3(hip, ankle, (hip[1] - at(0.292)) / (hip[1] - ankleY));
    J[`foot${S}`] = ankle;
  }
  if (!quiet) for (const l of log) console.log(l);
  return {
    J,
    hemY, shinR: (shinL.r + shinR.r) / 2, neckR: wMin, armR: aL.armR,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Fundo da saia e pernas (na malha original)
// ---------------------------------------------------------------------------------------------------------------

/** Distância de p ao segmento ab e parâmetro t (0–1) da projeção. */
function segDist(p: Vec, a: Vec, b: Vec): { d: number; t: number } {
  const ab = sub(b, a);
  const t = clamp01(dot(sub(p, a), ab) / dot(ab, ab));
  return { d: len(sub(p, add(a, scale(ab, t)))), t };
}

/** Triângulo vizinho por cada aresta (pela posição, então costuras de UV não separam; -1 = borda). */
function triNeighbors(pos: Float32Array, idx: Uint32Array): Int32Array {
  const remap = MeshoptSimplifier.generatePositionRemap(pos as Float32Array<ArrayBuffer>, 3);
  const n = pos.length / 3;
  const nt = idx.length / 3;
  const nbr = new Int32Array(nt * 3).fill(-1);
  const open = new Map<number, number>();
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = remap[idx[t * 3 + k]];
      const b = remap[idx[t * 3 + ((k + 1) % 3)]];
      const key = a < b ? a * n + b : b * n + a;
      const o = open.get(key);
      if (o === undefined) open.set(key, t * 3 + k);
      else {
        nbr[t * 3 + k] = (o / 3) | 0;
        nbr[o] = t;
        open.delete(key);
      }
    }
  }
  return nbr;
}

/**
 * A malha gerada por IA é uma casca fechada: a barra da saia é fechada por um "chão" plano em que as canelas entram
 * por dois furos. Ligado às pernas, esse chão vira membrana a cada passo; erguido, vira uma tenda que aparece por
 * baixo da barra. Aqui ele sai inteiro, ainda na malha original: as pernas (pés + canelas até a barra) são achadas
 * por inundação a partir das solas e o chão por inundação a partir da borda das pernas, só por triângulos virados
 * para baixo logo acima da barra (para na dobra da barra, onde a normal vira para fora). O material é de dois lados:
 * de baixo se vê o avesso do pano, como numa saia de verdade.
 */
function cleanHigh(m: Mesh, d: Detect): { idx: Uint32Array<ArrayBuffer>; legVert: Uint8Array<ArrayBuffer> } {
  const { pos: p, idx: I } = m;
  const { J, hemY } = d;
  const nt = I.length / 3;
  const nbr = triNeighbors(p, I);
  const ny = new Float32Array(nt);
  const cy = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const u: Vec = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const v: Vec = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    ny[t] = norm(cross(u, v))[1];
    cy[t] = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
  }
  const P = (i: number): Vec => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
  const nearShin = (i: number) => {
    const q = P(i);
    const S = q[0] >= 0 ? 'L' : 'R';
    return segDist(q, J[`lowerLeg${S}`], J[`foot${S}`]).d < d.shinR + 0.02;
  };
  const legOk = (t: number) => {
    for (let k = 0; k < 3; k++) {
      const i = I[t * 3 + k];
      const y = p[i * 3 + 1];
      if (y > hemY + 0.03 || (y > hemY - 0.03 && !nearShin(i))) return false;
    }
    // perto da barra, nada virado para baixo (isso já é o chão em volta do furo)
    return !(cy[t] > hemY - 0.04 && ny[t] < -0.6);
  };
  const leg = new Uint8Array(nt);
  const stack: number[] = [];
  for (let t = 0; t < nt; t++) {
    if ([0, 1, 2].every((k) => p[I[t * 3 + k] * 3 + 1] < J.footL[1] * 0.6)) (leg[t] = 1), stack.push(t);
  }
  while (stack.length) {
    const t = stack.pop()!;
    for (let k = 0; k < 3; k++) {
      const o = nbr[t * 3 + k];
      if (o >= 0 && !leg[o] && legOk(o)) (leg[o] = 1), stack.push(o);
    }
  }
  const floor = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    if (!leg[t]) continue;
    for (let k = 0; k < 3; k++) {
      const o = nbr[t * 3 + k];
      if (o >= 0 && !leg[o] && !floor[o]) (floor[o] = 1), stack.push(o);
    }
  }
  while (stack.length) {
    const t = stack.pop()!;
    for (let k = 0; k < 3; k++) {
      const o = nbr[t * 3 + k];
      if (o >= 0 && !leg[o] && !floor[o] && cy[o] < hemY + 0.03 && ny[o] < -0.6) (floor[o] = 1), stack.push(o);
    }
  }
  // sem o chão, as pernas não podem mais encostar no corpo
  const seen = Uint8Array.from(leg);
  for (let t = 0; t < nt; t++) if (leg[t]) stack.push(t);
  let touch = 0;
  while (stack.length) {
    const t = stack.pop()!;
    for (let k = 0; k < 3; k++) {
      const o = nbr[t * 3 + k];
      if (o >= 0 && !seen[o] && !floor[o]) (seen[o] = 1), stack.push(o), touch++;
    }
  }
  const keep: number[] = [];
  const legVert = new Uint8Array(p.length / 3);
  let nLeg = 0, nFloor = 0;
  for (let t = 0; t < nt; t++) {
    if (floor[t]) {
      nFloor++;
      continue;
    }
    keep.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
    if (leg[t]) for (let k = 0; k < 3; k++) (legVert[I[t * 3 + k]] = 1), nLeg++;
  }
  console.log(`fundo da saia removido: ${nFloor} triângulos; pernas soltas: ${nLeg / 3} triângulos${touch ? ` (aviso: ${touch} triângulos ainda ligam pernas e corpo)` : ''}`);
  return { idx: Uint32Array.from(keep), legVert };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Simplificação com orçamento por região
// ---------------------------------------------------------------------------------------------------------------

type Region = 'cabeça' | 'mãos' | 'pernas' | 'resto';

function regionOf(p: Vec, leg: boolean, d: Detect): Region {
  if (leg) return 'pernas';
  if (p[1] > d.J.neck[1] - 0.02) return 'cabeça';
  if (p[1] > 0.5 * HEIGHT && Math.abs(p[0]) > Math.abs(d.J.handL[0])) return 'mãos';
  return 'resto';
}

/**
 * Simplificação com orçamento por região sem costuras entre elas: a medida de erro do meshoptimizer vê a cabeça e as
 * mãos ampliadas em volta do próprio centro (com transição suave no pescoço e no punho), então elas ficam com
 * várias vezes mais triângulos que o resto; a saída usa os índices da malha original, com as posições originais.
 * Os vértices mais alto e mais baixo ficam travados (a altura normalizada não muda).
 */
function simplify(m: Mesh, idx: Uint32Array<ArrayBuffer>, legVert: Uint8Array, d: Detect): { low: Mesh; legVert: Uint8Array<ArrayBuffer> } {
  const { J } = d;
  const p = m.pos;
  const n = p.length / 3;
  const zp = new Float32Array(p);
  let reach = 0;
  for (let i = 0; i < n; i++) reach = Math.max(reach, Math.abs(p[i * 3]));
  const headC: Vec = [0, (J.neck[1] + HEIGHT) / 2, J.head[2]];
  const zoom = (i: number, c: Vec, k: number) => {
    for (let j = 0; j < 3; j++) zp[i * 3 + j] = c[j] + (p[i * 3 + j] - c[j]) * k;
  };
  for (let i = 0; i < n; i++) {
    const x = p[i * 3], y = p[i * 3 + 1];
    // canelas e pés (peças soltas abaixo da barra): ampliados em volta do eixo da canela, para a seção ficar redonda
    // (12+ lados) em vez de uma caixa
    if (legVert[i]) {
      const S = x >= 0 ? 'L' : 'R';
      zoom(i, [J[`foot${S}`][0], y, J[`foot${S}`][2]], LEG_ZOOM);
      continue;
    }
    const wH = smooth(J.neck[1] - 0.05, J.neck[1] - 0.01, y);
    if (wH > 0) zoom(i, headC, 1 + (HEAD_ZOOM - 1) * wH);
    if (y < 0.5 * HEIGHT) continue;
    for (const [g, S] of [[1, 'L'], [-1, 'R']] as const) {
      const wr = J[`hand${S}`];
      const wx = Math.abs(wr[0]);
      // a mão inteira e as pulseiras (que vão até ~2 cm além da junta do punho) com ampliação total
      const wHd = smooth(wx - 0.06, wx - 0.02, x * g);
      if (wHd > 0) zoom(i, [g * (wx + reach) / 2, wr[1], wr[2]], 1 + (HAND_ZOOM - 1) * wHd);
    }
  }
  const lock = new Uint8Array(n);
  let top = 0, bottom = 0;
  for (let i = 0; i < n; i++) {
    if (p[i * 3 + 1] > p[top * 3 + 1]) top = i;
    if (p[i * 3 + 1] < p[bottom * 3 + 1]) bottom = i;
  }
  lock[top] = lock[bottom] = 1;
  let target = TARGET_TRIS * 3;
  let out: Uint32Array<ArrayBufferLike> = idx;
  for (let k = 0; k < 8; k++) {
    const [res] = MeshoptSimplifier.simplifyWithAttributes(idx, zp, 3, m.uv, 2, [UV_WEIGHT, UV_WEIGHT], lock, target, 1, []);
    out = res;
    const tris = res.length / 3;
    if (Math.abs(tris - TARGET_TRIS) < 250) break;
    target = Math.round(target * (TARGET_TRIS / tris));
  }
  // compacta: só os vértices usados
  const remap = new Int32Array(n).fill(-1);
  let nv = 0;
  for (const i of out) if (remap[i] < 0) remap[i] = nv++;
  const low: Mesh = { pos: new Float32Array(nv * 3), uv: new Float32Array(nv * 2), idx: new Uint32Array(out.length) };
  const lowLeg = new Uint8Array(nv);
  for (let i = 0; i < n; i++) {
    const j = remap[i];
    if (j < 0) continue;
    low.pos.set(p.subarray(i * 3, i * 3 + 3), j * 3);
    low.uv.set(m.uv.subarray(i * 2, i * 2 + 2), j * 2);
    lowLeg[j] = legVert[i];
  }
  for (let k = 0; k < out.length; k++) low.idx[k] = remap[out[k]];
  const count = (pp: Float32Array, ii: Uint32Array, leg: Uint8Array) => {
    const c: Record<Region, number> = { cabeça: 0, mãos: 0, pernas: 0, resto: 0 };
    for (let t = 0; t < ii.length; t += 3) {
      const q: Vec = [0, 0, 0];
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) q[j] += pp[ii[t + k] * 3 + j] / 3;
      c[regionOf(q, !!leg[ii[t]], d)]++;
    }
    return Object.entries(c).map(([r, v]) => `${r} ${v}`).join(', ');
  };
  console.log(`simplificada: ${low.idx.length / 3} triângulos, ${nv} vértices (${count(low.pos, low.idx, lowLeg)}; original: ${count(p, idx, legVert)})`);
  return { low, legVert: lowLeg };
}

/**
 * Lascas no UV: triângulo com os três vértices quase alinhados na textura, mas não no espaço — a textura vira uma
 * listra esticada ao longo de uma linha (eram as lascas dentro das narinas). Quando uma aresta dele é interna à ilha
 * de UV (o vizinho usa os mesmos dois vértices), troca a diagonal se os dois triângulos novos ficarem melhores no UV,
 * com a mesma orientação e sem dobrar no espaço.
 */
function fixUvSlivers(m: Mesh): number {
  const { pos, uv, idx } = m;
  const n = pos.length / 3;
  const nt = idx.length / 3;
  const P = (i: number): Vec => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const uvArea = (a: number, b: number, c: number) =>
    ((uv[b * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1]) - (uv[c * 2] - uv[a * 2]) * (uv[b * 2 + 1] - uv[a * 2 + 1])) / 2;
  const nrm3 = (a: number, b: number, c: number) => cross(sub(P(b), P(a)), sub(P(c), P(a)));
  const ratio = (a: number, b: number, c: number) => Math.abs(uvArea(a, b, c)) / (len(nrm3(a, b, c)) / 2 || 1e-12);
  const rs: number[] = [];
  for (let t = 0; t < nt; t++) rs.push(ratio(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]));
  const med = rs.sort((x, y) => x - y)[nt >> 1];
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
  const edgeTri = new Map<number, number[]>();
  const link = (t: number, on: boolean) => {
    for (let k = 0; k < 3; k++) {
      const kk = key(idx[t * 3 + k], idx[t * 3 + ((k + 1) % 3)]);
      const l = edgeTri.get(kk) ?? [];
      if (on) l.push(t);
      else l.splice(l.indexOf(t), 1);
      edgeTri.set(kk, l);
    }
  };
  for (let t = 0; t < nt; t++) link(t, true);
  let fixed = 0;
  for (let pass = 0; pass < 4; pass++)
  for (let t = 0; t < nt; t++) {
    const [a0, b0, c0] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    // lasca: bem abaixo da mediana geral ou dos vizinhos (a densidade de texels varia muito entre regiões)
    let nb = 0;
    for (let k = 0; k < 3; k++) {
      for (const o of edgeTri.get(key(idx[t * 3 + k], idx[t * 3 + ((k + 1) % 3)])) ?? []) {
        if (o !== t) nb = Math.max(nb, ratio(idx[o * 3], idx[o * 3 + 1], idx[o * 3 + 2]));
      }
    }
    if (ratio(a0, b0, c0) >= Math.max(med, nb) / 20) continue;
    let best: { o: number; t1: [number, number, number]; t2: [number, number, number]; q: number } | null = null;
    for (let k = 0; k < 3; k++) {
      const a = idx[t * 3 + k], b = idx[t * 3 + ((k + 1) % 3)], c = idx[t * 3 + ((k + 2) % 3)];
      const o = (edgeTri.get(key(a, b)) ?? []).find((x) => x !== t);
      if (o === undefined) continue;
      const d = [idx[o * 3], idx[o * 3 + 1], idx[o * 3 + 2]].find((v) => v !== a && v !== b);
      if (d === undefined) continue;
      const t1: [number, number, number] = [a, d, c];
      const t2: [number, number, number] = [d, b, c];
      // orientação da ilha: a do vizinho (a lasca pode estar até invertida no UV)
      const s0 = Math.sign(uvArea(idx[o * 3], idx[o * 3 + 1], idx[o * 3 + 2]));
      const nT = norm(nrm3(a, b, c)), nO = norm(nrm3(idx[o * 3], idx[o * 3 + 1], idx[o * 3 + 2]));
      if (Math.sign(uvArea(...t1)) !== s0 || Math.sign(uvArea(...t2)) !== s0) continue;
      if (dot(norm(nrm3(...t1)), nT) < 0.3 || dot(norm(nrm3(...t2)), nO) < 0.3) continue;
      const q = Math.min(ratio(...t1), ratio(...t2));
      const q0 = Math.min(ratio(a, b, c), ratio(idx[o * 3], idx[o * 3 + 1], idx[o * 3 + 2]));
      if (q > q0 && (!best || q > best.q)) best = { o, t1, t2, q };
    }
    if (!best) continue;
    link(t, false);
    link(best.o, false);
    idx.set(best.t1, t * 3);
    idx.set(best.t2, best.o * 3);
    link(t, true);
    link(best.o, true);
    fixed++;
  }
  return fixed;
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Canelas fechadas dentro da saia
// ---------------------------------------------------------------------------------------------------------------

/**
 * Vértices na mesma posição (costuras de UV) viram um só para pesos, vizinhança e normais. `part` separa peças que
 * se tocam sem estar ligadas (canela × saia).
 */
function positionGroups(pos: Float32Array, part?: Uint8Array): { rep: Int32Array; count: number } {
  const n = pos.length / 3;
  const rep = new Int32Array(n);
  const map = new Map<string, number>();
  let count = 0;
  for (let i = 0; i < n; i++) {
    const key = `${pos[i * 3].toFixed(6)},${pos[i * 3 + 1].toFixed(6)},${pos[i * 3 + 2].toFixed(6)},${part ? part[i] : 0}`;
    let r = map.get(key);
    if (r === undefined) map.set(key, (r = count++));
    rep[i] = r;
  }
  return { rep, count };
}

const BODY = 0;
const LEG = 1;

type Parted = Mesh & { part: Uint8Array<ArrayBuffer> };

/** Baricêntricas (de a, b, c) do ponto do triângulo mais perto de p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestBary(p: Vec, a: Vec, b: Vec, c: Vec): Vec {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [1 - v, v, 0];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [1 - w, 0, w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [0, 1 - w, w];
  }
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return [1 - v - w, v, w];
}

/** Raio horizontal da perna no prolongamento, em múltiplos do raio do anel (panturrilha, joelho, coxa). */
function legProfile(y: number, ringY: number, kneeY: number, topY: number): number {
  const knots: [number, number][] = [
    [ringY, 1], [ringY + 0.05, 1.04], [kneeY - 0.15, 1.2], [kneeY - 0.02, 1.08], [kneeY + 0.1, 1.2], [topY, 1.38],
  ];
  if (y <= knots[0][0]) return knots[0][1];
  for (let k = 1; k < knots.length; k++) {
    const [y0, f0] = knots[k - 1], [y1, f1] = knots[k];
    if (y <= y1) return lerp(f0, f1, smooth(y0, y1, y));
  }
  return knots[knots.length - 1][1];
}

/**
 * Sem o fundo da saia, cada canela termina num anel aberto logo acima da barra. O anel é prolongado por um tubo
 * redondo (16 colunas em volta do eixo) que sobe pela canela, panturrilha e joelho até a coxa, perto da junta do
 * quadril, e fecha numa calota: quando a barra abre (andar, correr) aparece perna de verdade, e o joelho dobra com
 * a pele (pesos lowerLeg → upperLeg em volta dele), em vez de uma peça rígida com a ponta cortada.
 *
 * Textura: cada coluna nasce num ponto do anel, com a UV dele (sem emenda no anel), e sobe espelhando a canela de
 * baixo: na altura y ela usa a UV da canela original no mesmo ângulo e na altura refletida no anel (ida e volta entre
 * o anel e o tornozelo), achada por um raio do eixo e restrita à mesma ilha de UV da coluna (as quadras nunca
 * interpolam entre ilhas). Cor, poros e o normal map continuam sem emenda.
 */
function shinTubes(m: Mesh, legVert: Uint8Array, d: Detect, color: (u: number, v: number) => Vec): Parted {
  const { J } = d;
  const n0 = m.pos.length / 3;
  const nt = m.idx.length / 3;
  const P = (i: number): Vec => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
  const { rep } = positionGroups(m.pos);
  const pos = Array.from(m.pos);
  const uv = Array.from(m.uv);
  const idx = Array.from(m.idx);
  const part = Array.from(legVert, (l) => (l ? LEG : BODY));
  const key = (a: number, b: number) => (rep[a] < rep[b] ? rep[a] * n0 + rep[b] : rep[b] * n0 + rep[a]);
  const use = new Map<number, number>();
  for (let t = 0; t < nt; t++) {
    if (!legVert[m.idx[t * 3]]) continue;
    for (let k = 0; k < 3; k++) {
      const kk = key(m.idx[t * 3 + k], m.idx[t * 3 + ((k + 1) % 3)]);
      use.set(kk, (use.get(kk) ?? 0) + 1);
    }
  }
  const border: [number, number][] = [];
  for (let t = 0; t < nt; t++) {
    if (!legVert[m.idx[t * 3]]) continue;
    for (let k = 0; k < 3; k++) {
      const a = m.idx[t * 3 + k], b = m.idx[t * 3 + ((k + 1) % 3)];
      if (use.get(key(a, b)) === 1) border.push([a, b]);
    }
  }
  // ilhas de UV (vizinhança pelo índice: costuras de UV separam)
  const island = new Int32Array(n0).map((_, i) => i);
  const find = (i: number): number => {
    while (island[i] !== i) i = island[i] = island[island[i]];
    return i;
  };
  for (let t = 0; t < nt; t++) {
    const a = find(m.idx[t * 3]);
    for (let k = 1; k < 3; k++) {
      const b = find(m.idx[t * 3 + k]);
      if (a !== b) island[b] = a;
    }
  }
  const push = (p: Vec, t: [number, number]) => {
    pos.push(...p);
    uv.push(...t);
    part.push(LEG);
    return part.length - 1;
  };
  const upLegY = J.upperLegL[1];
  const kneeY = J.lowerLegL[1];
  const topY = upLegY - 0.1;
  const COLS = 16;
  let added = 0;
  const report: string[] = [];
  for (const [g, S] of [[1, 'L'], [-1, 'R']] as const) {
    const edges = border.filter(([a]) => m.pos[a * 3] * g > 0);
    if (!edges.length) continue;
    const ring = [...new Set(edges.flat())];
    const foot = J[`foot${S}`], knee = J[`lowerLeg${S}`], hip = J[`upperLeg${S}`];
    /** Ponto do eixo (osso) na altura y: canela abaixo do joelho, coxa acima. */
    const bone = (y: number): Vec => (y <= knee[1] ? mix3(foot, knee, (y - foot[1]) / (knee[1] - foot[1])) : mix3(knee, hip, (y - knee[1]) / (hip[1] - knee[1])));
    let ringY = 0, ringMin = Infinity;
    const c: Vec = [0, 0, 0];
    for (const i of ring) {
      for (let k = 0; k < 3; k++) c[k] += m.pos[i * 3 + k] / ring.length;
      ringY = Math.max(ringY, m.pos[i * 3 + 1]);
      ringMin = Math.min(ringMin, m.pos[i * 3 + 1]);
    }
    // o centro do anel pode não estar exatamente no osso: o desvio some até o joelho
    const off0 = sub(c, bone(c[1]));
    off0[1] = 0;
    const center = (y: number) => add(bone(y), scale(off0, 1 - smooth(c[1], knee[1], y)));
    const horiz = (p: Vec, y: number): Vec => {
      const q = sub(p, center(y));
      return [q[0], 0, q[2]];
    };
    const r0 = ring.reduce((a, i) => a + len(horiz(P(i), m.pos[i * 3 + 1])), 0) / ring.length;

    // triângulos da canela original deste lado (para amostrar a UV espelhada)
    const legTris: number[] = [];
    for (let t = 0; t < nt; t++) {
      const a = m.idx[t * 3];
      if (legVert[a] && m.pos[a * 3] * g > 0) legTris.push(t);
    }
    const yLo = foot[1] + 0.035;
    const corner = (t: number, k: number): Vec => P(m.idx[t * 3 + k]);
    /** UV da canela original na direção `dir` (horizontal) e altura y, dentro da ilha `isl`. */
    const sampleUv = (dir: Vec, y: number, isl: number): [number, number] => {
      const o = center(y);
      // raio do eixo para fora: primeiro triângulo da canela atingido
      let best = -1, bestT = Infinity, bb: Vec = [1, 0, 0];
      for (const t of legTris) {
        const A = corner(t, 0), B = corner(t, 1), C = corner(t, 2);
        if (Math.min(A[1], B[1], C[1]) > y + 0.001 || Math.max(A[1], B[1], C[1]) < y - 0.001) continue;
        const e1 = sub(B, A), e2 = sub(C, A), pv = cross(dir, e2);
        const det = dot(e1, pv);
        if (Math.abs(det) < 1e-14) continue;
        const tv = sub(o, A);
        const u = dot(tv, pv) / det;
        if (u < -1e-6 || u > 1 + 1e-6) continue;
        const qv = cross(tv, e1);
        const v = dot(dir, qv) / det;
        if (v < -1e-6 || u + v > 1 + 1e-6) continue;
        const tt = dot(e2, qv) / det;
        if (tt > 0 && tt < bestT) (bestT = tt), (best = t), (bb = [1 - u - v, u, v]);
      }
      let hit: Vec = add(o, scale(dir, r0));
      if (best >= 0) {
        hit = add(o, scale(dir, bestT));
        if (find(m.idx[best * 3]) !== isl) best = -1;
      }
      if (best < 0) {
        // atravessou para outra ilha: ponto mais perto do acerto dentro da ilha da coluna
        let bd = Infinity;
        for (const t of legTris) {
          if (find(m.idx[t * 3]) !== isl) continue;
          const A = corner(t, 0), B = corner(t, 1), C = corner(t, 2);
          const w = closestBary(hit, A, B, C);
          const q = add(add(scale(A, w[0]), scale(B, w[1])), scale(C, w[2]));
          const dd = len(sub(q, hit));
          if (dd < bd) (bd = dd), (best = t), (bb = w);
        }
      }
      const [a, b, c2] = [m.idx[best * 3], m.idx[best * 3 + 1], m.idx[best * 3 + 2]];
      return [uv[a * 2] * bb[0] + uv[b * 2] * bb[1] + uv[c2 * 2] * bb[2], uv[a * 2 + 1] * bb[0] + uv[b * 2 + 1] * bb[1] + uv[c2 * 2 + 1] * bb[2]];
    };

    // alturas das linhas do tubo: duas logo acima do anel (o anel vira círculo), canela, 4 em volta do joelho, coxa
    const rows: number[] = [ringY + 0.02, ringY + 0.05];
    const span = (a: number, b: number, step: number) => {
      const k = Math.max(1, Math.round((b - a) / step));
      for (let j = 1; j <= k; j++) rows.push(a + ((b - a) * j) / k);
    };
    span(ringY + 0.05, kneeY - 0.09, 0.06);
    rows.push(kneeY - 0.045, kneeY, kneeY + 0.045, kneeY + 0.09);
    span(kneeY + 0.09, topY, 0.07);
    const R = (y: number) => r0 * legProfile(y, ringY, kneeY, topY);
    const rTop = R(topY);
    // calota: dois anéis que fecham e o polo
    const capAng = [Math.PI / 6, Math.PI / 3];

    type Col = { dir: Vec; base: Vec; baseUv: [number, number]; isl: number; vs: number[] };
    const makeCol = (base: Vec, baseUv: [number, number], isl: number): Col => {
      const h = horiz(base, base[1]);
      const rb = len(h);
      const dir = scale(h, 1 / (rb || 1));
      const vs = [push(base, baseUv)];
      for (const y of rows) {
        // do formato do anel para o círculo em 5 cm
        const b = smooth(base[1], base[1] + 0.05, y);
        const p = add(center(y), scale(dir, lerp(rb, R(y), b)));
        vs.push(push(p, sampleUv(dir, mirror(y, base[1]), isl)));
      }
      for (const a of capAng) {
        const y = topY + rTop * Math.sin(a);
        const p = add(center(topY), add(scale(dir, rTop * Math.cos(a)), [0, rTop * Math.sin(a), 0]));
        vs.push(push(p, sampleUv(dir, mirror(y, base[1]), isl)));
      }
      return { dir, base, baseUv, isl, vs };
    };
    /** Altura refletida (ida e volta entre o anel e o tornozelo). */
    const mirror = (y: number, y0: number) => {
      const per = Math.max(0.02, y0 - 0.005 - yLo);
      const u = (y - y0) % (2 * per);
      return u < per ? y0 - 0.005 - u : yLo + (u - per);
    };
    const colOf = new Map<number, Col>();
    const col = (i: number) => {
      let cc = colOf.get(i);
      if (!cc) colOf.set(i, (cc = makeCol(P(i), [uv[i * 2], uv[i * 2 + 1]], find(i))));
      return cc;
    };
    const apex = new Map<number, number>();
    let nCols = 0;
    for (const [a, b] of edges) {
      const ca = col(a), cb = col(b);
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(ca.dir, cb.dir))));
      const k = Math.max(1, Math.round(ang / ((2 * Math.PI) / COLS)));
      const cs: Col[] = [ca];
      for (let j = 1; j < k; j++) {
        const s = j / k;
        const base = mix3(ca.base, cb.base, s);
        cs.push(makeCol(base, [lerp(ca.baseUv[0], cb.baseUv[0], s), lerp(ca.baseUv[1], cb.baseUv[1], s)], ca.isl));
      }
      cs.push(cb);
      nCols += k;
      for (let j = 0; j < k; j++) {
        const A = cs[j].vs, B = cs[j + 1].vs;
        for (let r = 0; r + 1 < A.length; r++) idx.push(B[r], A[r], A[r + 1], B[r], A[r + 1], B[r + 1]), (added += 2);
        let ap = apex.get(ca.isl);
        if (ap === undefined) {
          const y = topY + rTop;
          apex.set(ca.isl, (ap = push(add(center(topY), [0, rTop, 0]), sampleUv(cs[j].dir, mirror(y, cs[j].base[1]), ca.isl))));
        }
        idx.push(B[B.length - 1], A[A.length - 1], ap), added++;
      }
    }
    // conferência: cor média da textura logo acima (tubo, 2 primeiras linhas) e logo abaixo do anel (canela)
    const mean = (l: [number, number][]) => {
      const s: Vec = [0, 0, 0];
      for (const [u, v] of l) {
        const q = color(u, v);
        for (let k = 0; k < 3; k++) s[k] += q[k] / l.length;
      }
      return s;
    };
    const above: [number, number][] = [];
    for (const cc of colOf.values()) for (const vi of cc.vs.slice(1, 3)) above.push([uv[vi * 2], uv[vi * 2 + 1]]);
    const below: [number, number][] = [];
    for (let i = 0; i < n0; i++) {
      if (legVert[i] && m.pos[i * 3] * g > 0 && m.pos[i * 3 + 1] > ringMin - 0.04 && m.pos[i * 3 + 1] < ringMin) below.push([uv[i * 2], uv[i * 2 + 1]]);
    }
    const ma = mean(above), mb = mean(below);
    report.push(`${S}: anel ${ring.length} vértices (y ${ringMin.toFixed(3)}–${ringY.toFixed(3)}, raio ${r0.toFixed(3)}), ${nCols} colunas, ` +
      `${rows.length + 3} linhas; cor acima ${fmt(ma)} × abaixo ${fmt(mb)} (Δ ${len(sub(ma, mb)).toFixed(1)})`);
  }
  console.log(`canelas prolongadas dentro da saia até a coxa: +${added} triângulos`);
  for (const l of report) console.log(`  ${l}`);
  return { pos: Float32Array.from(pos), uv: Float32Array.from(uv), idx: Uint32Array.from(idx), part: Uint8Array.from(part) };
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Pesos de pele
// ---------------------------------------------------------------------------------------------------------------

function computeWeights(m: Parted, d: Detect): Float32Array {
  const { J } = d;
  const { pos, idx, part } = m;
  const { rep, count } = positionGroups(pos, part);
  const n = pos.length / 3;
  const P: Vec[] = new Array(count);
  const partOf = new Uint8Array(count);
  for (let i = 0; i < n; i++) (P[rep[i]] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]), (partOf[rep[i]] = part[i]);
  const W = new Float32Array(count * NB);
  const put = (v: number, b: BoneName, w: number) => (W[v * NB + BI[b]] += w);
  const upLegY = J.upperLegL[1];
  const kneeY = J.lowerLegL[1];
  /** Eixo da perna esquerda (|x|, z) na altura y: coxa acima do joelho, canela abaixo. */
  const legAxis = (y: number): [number, number] => {
    const [a, b] = y > kneeY ? [J.upperLegL, J.lowerLegL] : [J.lowerLegL, J.footL];
    const t = clamp01((a[1] - y) / (a[1] - b[1]));
    return [lerp(a[0], b[0], t), lerp(a[2], b[2], t)];
  };

  /**
   * Saia (e barra da bata). Logo abaixo do tronco é quadril; descendo, as pernas mandam (até ~90% na frente e atrás,
   * ~60% nas laterais, que balançam como sino). A divisão entre as pernas é contínua em x (tanh): metade/metade no
   * meio, mais larga na frente (o joelho tem folga até o pano) e mais estreita atrás, onde o painel atrás de cada
   * canela precisa seguir a canela dela: abaixo do joelho esse painel vai quase todo para lowerLeg, então o chute da
   * corrida levanta o pano junto com a perna em vez de atravessá-lo. Abaixo da coxa o quadril vira a média das duas
   * coxas (no passo elas giram em sentidos opostos), para ficar em no máximo 4 ossos sem cortes.
   */
  const skirt = (v: number, x: number, y: number, z: number, amount: number) => {
    const [lx, lz] = legAxis(y);
    const down = smooth(upLegY + 0.02, upLegY - 0.22, y);
    // transições largas (14–18 cm): a inclinação dos pesos vezes o deslocamento entre os ossos é o que estica o pano
    const back = smooth(lz + 0.03, lz - 0.11, z);
    const near = 1 - smooth(0.08, 0.24, Math.abs(Math.abs(x) - lx));
    // atrás da perna a canela manda desde um pouco acima do joelho: no chute da corrida (joelho a ~1,8 rad) a
    // canela varre o espaço logo atrás e acima do joelho
    const kneeTop = kneeY + lerp(0.04, 0.12, back * near);
    const knee = smooth(kneeTop, kneeTop - 0.16, y);
    const outside = smooth(lx + 0.06, lx + 0.24, Math.abs(x));
    const legs = down * lerp(lerp(0.9, 0.97, back), 0.62, outside);
    // rampa linear (a menor inclinação máxima para a mesma largura): metade/metade no meio, uma perna só a partir
    // de 15–16 cm do meio (atrás: o painel atrás da canela segue a canela dela)
    const side = 0.5 + 0.5 * Math.max(-1, Math.min(1, x / lerp(0.16, 0.15, back)));
    // até 95% da parte da perna (o pano nunca fica só com canela e pé)
    const shin = knee * lerp(0.25, lerp(0.5, 0.95, near), back);
    const hip = amount * (1 - legs);
    const toThighs = smooth(upLegY - 0.12, upLegY - 0.26, y);
    put(v, 'hips', hip * (1 - toThighs));
    put(v, 'upperLegL', amount * legs * side * (1 - shin) + hip * toThighs * 0.5);
    put(v, 'lowerLegL', amount * legs * side * shin);
    put(v, 'upperLegR', amount * legs * (1 - side) * (1 - shin) + hip * toThighs * 0.5);
    put(v, 'lowerLegR', amount * legs * (1 - side) * shin);
  };

  for (let v = 0; v < count; v++) {
    const p = P[v];
    const [x, y, z] = p;
    const S = x >= 0 ? 'L' : 'R';

    // --- canelas e pés (soltos da saia): canela → pé no tornozelo; dedos à frente seguem o pé ---
    if (partOf[v] === LEG) {
      const ankle = J[`foot${S}`];
      const foot = 1 - smooth(ankle[1] - 0.02, ankle[1] + 0.02, y);
      const toes = smooth(0.04, 0.08, z - ankle[2]) * (1 - smooth(ankle[1], ankle[1] + 0.03, y));
      const fw = Math.max(foot, toes);
      put(v, `foot${S}`, fw);
      put(v, `lowerLeg${S}`, 1 - fw);
      continue;
    }

    // --- braço (pose T): coordenada ao longo dos ossos a partir do ombro e distância ao segmento do braço ---
    const sh = J[`upperArm${S}`];
    const el = J[`foreArm${S}`];
    const wr = J[`hand${S}`];
    const dir = norm(sub(wr, sh));
    const u = dot(sub(p, sh), dir);
    const r = segDist(p, sh, el).d;
    // entra no braço entre 5 cm para dentro e 7,5 cm para fora do ombro; perto do tronco, só o que está perto do
    // osso (a lateral do tronco embaixo da axila fica com o peito)
    let arm = smooth(-0.05, 0.075, u);
    if (u < 0.14) arm *= 1 - smooth(d.armR + 0.05, d.armR + 0.14, r);
    if (y < J.chest[1] - 0.12) arm = 0;
    if (arm > 0) {
      const aE = len(sub(el, sh));
      const aW = len(sub(wr, sh));
      const f = smooth(aE - 0.04, aE + 0.04, u); // cotovelo
      const h = smooth(aW - 0.012, aW + 0.025, u); // punho (pulseiras dividem; mão e dedos todos na mão)
      put(v, `upperArm${S}`, arm * (1 - f));
      put(v, `foreArm${S}`, arm * f * (1 - h));
      put(v, `hand${S}`, arm * f * h);
    }
    const body = 1 - arm;
    if (body <= 0) continue;

    // --- cabeça e pescoço: turbante, rosto e barba com a cabeça (a divisão desce na frente, pelo queixo);
    // o pescoço só no cilindro do pescoço — colares e guias em volta dele ficam com o peito ---
    if (y > J.neck[1]) {
      const zf = clamp01((z - J.head[2]) / 0.1);
      const hw = smooth(J.head[1] - 0.025 - 0.035 * zf, J.head[1] + 0.02 - 0.03 * zf, y);
      const rNeck = Math.hypot(x, z - J.neck[2]);
      const neckW = smooth(J.neck[1] + 0.005, J.neck[1] + 0.045, y) * (1 - smooth(d.neckR * 1.5, d.neckR * 2.4, rNeck));
      const nw = Math.max(0, Math.min(1 - hw, neckW * (1 - hw)));
      put(v, 'head', body * hw);
      put(v, 'neck', body * nw);
      put(v, 'chest', body * (1 - hw - nw));
      continue;
    }

    // --- tronco: quadril → lombar → peito pela altura entre as juntas da coluna ---
    let wh = 0, wsp = 0, wc = 0;
    if (y <= J.hips[1]) wh = 1;
    else if (y <= J.spine[1]) (wsp = smooth(J.hips[1], J.spine[1], y)), (wh = 1 - wsp);
    else if (y <= J.chest[1]) (wc = smooth(J.spine[1], J.chest[1], y)), (wsp = 1 - wc);
    else wc = 1;
    // abaixo da junta da coxa começa a saia
    const t = smooth(upLegY + 0.03, upLegY - 0.03, y);
    put(v, 'hips', body * (1 - t) * wh);
    put(v, 'spine', body * (1 - t) * wsp);
    put(v, 'chest', body * (1 - t) * wc);
    if (t > 0) skirt(v, x, y, z, body * t);
  }

  // --- suavização pelos vizinhos da malha (por posição: costuras de UV não abrem) ---
  const nbr: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (let k = 0; k < idx.length; k += 3) {
    const a = rep[idx[k]], b = rep[idx[k + 1]], c = rep[idx[k + 2]];
    nbr[a].add(b), nbr[a].add(c), nbr[b].add(a), nbr[b].add(c), nbr[c].add(a), nbr[c].add(b);
  }
  // Só ossos plausíveis para a região e o lado: a suavização não leva o braço para o tronco longe do ombro, não
  // passa peso de um braço para o outro e não põe pé na saia nem cabeça no peito. Na saia as duas pernas valem dos
  // dois lados: a divisão contínua de skirt() não pode ser cortada no meio (era isso que rasgava a costura).
  const allowed = (v: number, b: number) => {
    const name = BONES[b];
    const [x, y] = P[v];
    if (partOf[v] === LEG) {
      // o pé só perto do tornozelo (sem isso a suavização subia peso de pé pela canela até o prolongamento)
      return name === `lowerLeg${x >= 0 ? 'L' : 'R'}` || (name === `foot${x >= 0 ? 'L' : 'R'}` && y < J.footL[1] + 0.06);
    }
    const legBone = name.startsWith('upperLeg') || name.startsWith('lowerLeg');
    if (!(legBone && y < upLegY + 0.03)) {
      if (name.endsWith('L') && x < -0.02) return false;
      if (name.endsWith('R') && x > 0.02) return false;
    }
    if ((name.startsWith('upperArm') || name.startsWith('foreArm') || name.startsWith('hand')) && y < J.chest[1] - 0.15) return false;
    if (name.startsWith('lowerLeg') && y > kneeY + 0.13) return false;
    if (name === 'hips' && y < kneeY + 0.06) return false;
    if (name.startsWith('foot')) return false;
    if ((name === 'head' || name === 'neck') && y < J.neck[1] - 0.02) return false;
    return true;
  };
  // A saia não passa pela suavização: skirt() já é contínua no espaço, e a média pelos vizinhos da malha deixava
  // vértices a 2–3 mm um do outro (na dobra da barra) com pesos diferentes, que no passo viravam pontas.
  const analytic = (v: number) => partOf[v] === BODY && P[v][1] < upLegY + 0.03;
  const tmp = new Float32Array(count * NB);
  for (let it = 0; it < 8; it++) {
    for (let v = 0; v < count; v++) {
      if (analytic(v)) {
        tmp.set(W.subarray(v * NB, v * NB + NB), v * NB);
        continue;
      }
      const ns = nbr[v];
      for (let b = 0; b < NB; b++) {
        let s = 0;
        for (const q of ns) s += W[q * NB + b];
        const avg = ns.size ? s / ns.size : W[v * NB + b];
        tmp[v * NB + b] = allowed(v, b) ? 0.5 * W[v * NB + b] + 0.5 * avg : 0;
      }
    }
    W.set(tmp);
  }

  // --- até 4 ossos, normalizados; copia para os vértices duplicados das costuras ---
  for (let v = 0; v < count; v++) {
    const row = Array.from(W.subarray(v * NB, v * NB + NB), (w, b) => ({ w, b })).sort((a, b) => b.w - a.w);
    const top = row.slice(0, 4).filter((e) => e.w > 0.01);
    const sum = top.reduce((a, e) => a + e.w, 0);
    W.fill(0, v * NB, v * NB + NB);
    for (const e of top) W[v * NB + e.b] = e.w / sum;
  }
  const out = new Float32Array(n * NB);
  for (let i = 0; i < n; i++) out.set(W.subarray(rep[i] * NB, rep[i] * NB + NB), i * NB);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 8. Braços para baixo
// ---------------------------------------------------------------------------------------------------------------

type ArmRot = { pivot: Vec; axis: Vec; angle: number };

function armRotation(J: Joints, g: number): ArmRot {
  const S = g > 0 ? 'L' : 'R';
  const sh = J[`upperArm${S}`];
  const from = norm(sub(J[`hand${S}`], sh));
  const a = (ARM_OUT_DEG * Math.PI) / 180;
  const to: Vec = [g * Math.sin(a), -Math.cos(a), 0];
  const axis = norm(cross(from, to));
  const angle = Math.acos(Math.min(1, Math.max(-1, dot(from, to))));
  return { pivot: sh, axis, angle };
}

/** Gira cada vértice em torno do ombro pelo ângulo × (peso total da cadeia do braço): a pele faz a transição. */
function lowerArms(pos: Float32Array, W: Float32Array, J: Joints): Joints {
  const rots = { L: armRotation(J, 1), R: armRotation(J, -1) };
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    for (const S of ['L', 'R'] as const) {
      const w = W[i * NB + BI[`upperArm${S}`]] + W[i * NB + BI[`foreArm${S}`]] + W[i * NB + BI[`hand${S}`]];
      if (w <= 0) continue;
      const r = rots[S];
      const p: Vec = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      const q = add(r.pivot, rotate(sub(p, r.pivot), r.axis, r.angle * w));
      pos[i * 3] = q[0], pos[i * 3 + 1] = q[1], pos[i * 3 + 2] = q[2];
    }
  }
  const out = { ...J };
  for (const S of ['L', 'R'] as const) {
    const r = rots[S];
    for (const b of [`foreArm${S}`, `hand${S}`] as const) out[b] = add(r.pivot, rotate(sub(J[b], r.pivot), r.axis, r.angle));
    console.log(`braço ${S}: abaixado ${((r.angle * 180) / Math.PI).toFixed(1)}° em torno de ${fmt(r.axis)}`);
  }
  return out;
}

/** Normais suaves pela área, juntando as costuras de UV (mas não as peças descoladas). */
function computeNormals(pos: Float32Array, idx: Uint32Array, part: Uint8Array): Float32Array<ArrayBuffer> {
  const { rep, count } = positionGroups(pos, part);
  const n = pos.length / 3;
  const acc = new Float64Array(count * 3);
  const own = new Float64Array(n * 3); // só deste vértice, para quando o grupo se anula (folhas finas)
  for (let k = 0; k < idx.length; k += 3) {
    const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]];
    const pa: Vec = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
    const pb: Vec = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    const pc: Vec = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    const nrm = cross(sub(pb, pa), sub(pc, pa)); // comprimento = 2 × área: média ponderada pela área
    for (const v of [a, b, c]) for (let j = 0; j < 3; j++) (acc[rep[v] * 3 + j] += nrm[j]), (own[v * 3 + j] += nrm[j]);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = rep[i];
    let v: Vec = [acc[r * 3], acc[r * 3 + 1], acc[r * 3 + 2]];
    if (len(v) < 1e-10) v = [own[i * 3], own[i * 3 + 1], own[i * 3 + 2]];
    if (len(v) < 1e-10) v = [0, 1, 0];
    out.set(norm(v), i * 3);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Conferências (pose T)
// ---------------------------------------------------------------------------------------------------------------

/** Distâncias de cada ponto à superfície formada pelos triângulos (grade de 1 cm; acima de ~2 cm satura). */
function surfaceDistances(points: Vec[], tris: [Vec, Vec, Vec][]): number[] {
  const cell = 0.01;
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;
  tris.forEach((t, ti) => {
    const lo = [0, 1, 2].map((k) => Math.floor((Math.min(t[0][k], t[1][k], t[2][k]) - 0.003) / cell));
    const hi = [0, 1, 2].map((k) => Math.floor((Math.max(t[0][k], t[1][k], t[2][k]) + 0.003) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) {
          const k = keyOf(x, y, z);
          const l = grid.get(k);
          if (l) l.push(ti);
          else grid.set(k, [ti]);
        }
      }
    }
  });
  return points.map((p) => {
    const c = p.map((v) => Math.floor(v / cell));
    let best = Infinity;
    for (let r = 1; r <= 2 && best === Infinity; r++) {
      for (let a = -r; a <= r; a++) {
        for (let b = -r; b <= r; b++) {
          for (let e = -r; e <= r; e++) {
            for (const ti of grid.get(keyOf(c[0] + a, c[1] + b, c[2] + e)) ?? []) best = Math.min(best, pointTri(p, tris[ti]));
          }
        }
      }
    }
    return Math.min(Math.sqrt(best), 0.02);
  });
}

/** Distância² de p ao triângulo (Ericson, Real-Time Collision Detection 5.1.5). */
function pointTri(p: Vec, [a, b, c]: [Vec, Vec, Vec]): number {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const q = sub(add(a, scale(ab, d1 / (d1 - d3))), p);
    return dot(q, q);
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const q = sub(add(a, scale(ac, d2 / (d2 - d6))), p);
    return dot(q, q);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const q = sub(add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)))), p);
    return dot(q, q);
  }
  const den = 1 / (va + vb + vc);
  const q = sub(add(a, add(scale(ab, vb * den), scale(ac, vc * den))), p);
  return dot(q, q);
}

/**
 * Cabeça: nenhum triângulo com a textura muito esticada (área no UV ÷ área 3D abaixo de 1/20 da mediana — eram as
 * lascas listradas dentro das narinas). Mãos: distância da malha original à simplificada, p99 abaixo de 2 mm.
 */
function checks(high: Mesh, highIdx: Uint32Array, low: Mesh, d: Detect): string[] {
  const fails: string[] = [];
  const LP = (i: number): Vec => [low.pos[i * 3], low.pos[i * 3 + 1], low.pos[i * 3 + 2]];
  const ratios: { r: number; c: Vec; a: number; t: number }[] = [];
  for (let t = 0; t < low.idx.length; t += 3) {
    const [a, b, c] = [low.idx[t], low.idx[t + 1], low.idx[t + 2]];
    const [pa, pb, pc] = [LP(a), LP(b), LP(c)];
    if (Math.min(pa[1], pb[1], pc[1]) < d.J.neck[1] - 0.02 || Math.max(Math.abs(pa[0]), Math.abs(pb[0]), Math.abs(pc[0])) > 0.16) continue;
    const a3 = len(cross(sub(pb, pa), sub(pc, pa))) / 2;
    const u = low.uv;
    const a2 = Math.abs((u[b * 2] - u[a * 2]) * (u[c * 2 + 1] - u[a * 2 + 1]) - (u[c * 2] - u[a * 2]) * (u[b * 2 + 1] - u[a * 2 + 1])) / 2;
    if (a3 > 1e-9) ratios.push({ r: a2 / a3, c: scale(add(pa, add(pb, pc)), 1 / 3), a: a3, t });
  }
  const med = ratios.map((q) => q.r).sort((x, y) => x - y)[ratios.length >> 1];
  const bad = ratios.filter((q) => q.r < med / 20);
  console.log(`conferência cabeça: ${ratios.length} triângulos, UV/3D mediana ${med.toFixed(2)}, abaixo de 1/20: ${bad.length}` +
    (bad.length ? ` em ${bad.slice(0, 6).map((q) => `${fmt(q.c)} ${(q.a * 1e4).toFixed(2)} cm²`).join(', ')}` : ''));
  if (bad.length) fails.push(`cabeça: ${bad.length} triângulos com a textura esticada`);

  for (const [g, S] of [[1, 'L'], [-1, 'R']] as const) {
    // da mão para fora, sem as pulseiras (até ~2 cm além da junta do punho)
    const wx = Math.abs(d.J[`hand${S}`][0]) + 0.02;
    const inHand = (p: Vec) => p[1] > 0.5 * HEIGHT && p[0] * g > wx;
    const tris: [Vec, Vec, Vec][] = [];
    for (let t = 0; t < low.idx.length; t += 3) {
      const q: [Vec, Vec, Vec] = [LP(low.idx[t]), LP(low.idx[t + 1]), LP(low.idx[t + 2])];
      if (q.some((p) => p[1] > 0.5 * HEIGHT && p[0] * g > wx - 0.03)) tris.push(q);
    }
    const handTris = tris.filter((q) => inHand(scale(add(q[0], add(q[1], q[2])), 1 / 3))).length;
    const pts: Vec[] = [];
    const used = new Uint8Array(high.pos.length / 3);
    for (const i of highIdx) used[i] = 1;
    for (let i = 0; i < used.length; i++) {
      if (!used[i]) continue;
      const p: Vec = [high.pos[i * 3], high.pos[i * 3 + 1], high.pos[i * 3 + 2]];
      if (inHand(p)) pts.push(p);
    }
    const ds = surfaceDistances(pts, tris).sort((x, y) => x - y);
    const q = (f: number) => ds[Math.floor(f * (ds.length - 1))] * 1000;
    console.log(`conferência mão ${S}: ${handTris} triângulos da mão (além das pulseiras); distância da original: p50 ${q(0.5).toFixed(2)} mm, p90 ${q(0.9).toFixed(2)} mm, p99 ${q(0.99).toFixed(2)} mm, máx ${q(1).toFixed(1)} mm`);
    if (q(0.99) > 2) fails.push(`mão ${S}: p99 ${q(0.99).toFixed(2)} mm`);
  }
  return fails;
}

// ---------------------------------------------------------------------------------------------------------------
// 10. Gravação
// ---------------------------------------------------------------------------------------------------------------

type Extras = { hipsY: number; height: number; source: { scale: number; offset: Vec; flip180: boolean } };

async function write(path: string, m: Parted, W: Float32Array, J: Joints, image: Uint8Array | null, normalRgb: Uint8Array, mat: MatInfo, extras: Extras) {
  const { pos, uv, idx } = m;
  const n = pos.length / 3;
  const nrm = computeNormals(pos, idx, m.part);
  const tan = vertexTangents(pos, nrm, uv, idx);
  const joints = new Uint8Array(n * 4);
  const weights = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const row = Array.from(W.subarray(i * NB, i * NB + NB), (w, b) => ({ w, b })).sort((a, b) => b.w - a.w).slice(0, 4);
    const sum = row.reduce((a, e) => a + e.w, 0) || 1;
    row.forEach((e, k) => {
      joints[i * 4 + k] = e.w > 0 ? e.b : 0;
      weights[i * 4 + k] = e.w / sum;
    });
  }

  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', arr: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) =>
    doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', pos))
    .setAttribute('NORMAL', acc('VEC3', nrm))
    .setAttribute('TANGENT', acc('VEC4', tan))
    .setAttribute('TEXCOORD_0', acc('VEC2', uv))
    .setAttribute('JOINTS_0', acc('VEC4', joints))
    .setAttribute('WEIGHTS_0', acc('VEC4', weights))
    .setIndices(acc('SCALAR', n < 65536 ? Uint16Array.from(idx) : idx));
  const material = doc.createMaterial('realista-1')
    .setBaseColorFactor(mat.color)
    .setRoughnessFactor(mat.roughness)
    .setMetallicFactor(mat.metallic)
    .setDoubleSided(mat.doubleSided);
  doc.createExtension(EXTTextureWebP).setRequired(true);
  let texBytes = 0;
  if (image) {
    const webp = await sharp(image).resize(TEX_SIZE, TEX_SIZE, { fit: 'fill' }).webp({ quality: 82, effort: 6 }).toBuffer();
    texBytes += webp.byteLength;
    material.setBaseColorTexture(doc.createTexture('baseColor').setImage(new Uint8Array(webp)).setMimeType('image/webp'));
  }
  const nmap = await sharp(normalRgb, { raw: { width: NORMAL_SIZE, height: NORMAL_SIZE, channels: 3 } }).webp({ quality: 88, effort: 6 }).toBuffer();
  texBytes += nmap.byteLength;
  material.setNormalTexture(doc.createTexture('normal').setImage(new Uint8Array(nmap)).setMimeType('image/webp'));
  prim.setMaterial(material);
  const mesh = doc.createMesh('realista-1').addPrimitive(prim);

  // Nó raiz = a própria malha com pele (como o boneco do jogo: os ossos ficam embaixo dela), com os extras.
  const root = doc.createNode('realista-1').setMesh(mesh).setExtras(extras);
  const nodes = new Map<BoneName, ReturnType<Document['createNode']>>();
  for (const name of BONES) {
    const parent = PARENT[name];
    const t = parent ? sub(J[name], J[parent]) : J[name];
    const node = doc.createNode(name).setTranslation(t);
    nodes.set(name, node);
    (parent ? nodes.get(parent)! : root).addChild(node);
  }
  const ibm = new Float32Array(NB * 16);
  BONES.forEach((name, i) => {
    const [x, y, z] = J[name];
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
  });
  const skin = doc.createSkin('esqueleto').setSkeleton(nodes.get('hips')!).setInverseBindMatrices(acc('MAT4', ibm));
  for (const name of BONES) skin.addJoint(nodes.get(name)!);
  root.setSkin(skin);
  doc.createScene('realista-1').addChild(root).setExtras({ hipsY: extras.hipsY, height: extras.height });

  const io = new NodeIO().registerExtensions([EXTTextureWebP]);
  await io.write(path, doc);
  return { texBytes, normalBytes: nmap.byteLength };
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error('uso: node tools/rig/rig.ts <entrada.glb> <saída.glb>');
    process.exit(1);
  }
  const t0 = Date.now();
  await MeshoptSimplifier.ready;
  const { hi, image, mat } = await load(inPath);
  const frame = normalize(hi.pos);
  let hp = applyFrame(hi.pos, frame);
  let det = detect(hp, true);
  // Quadril em x = z = 0 (a trilha 'hips.position' das animações grava x/z absolutos a partir de 0).
  const dz = -det.J.hips[2];
  frame.off[2] += frame.flip ? -dz : dz;
  hp = applyFrame(hi.pos, frame);
  det = detect(hp);
  console.log('juntas (pose T):');
  for (const b of BONES) console.log(`  ${b.padEnd(10)} ${fmt(det.J[b])}`);

  const high: Mesh = { pos: hp, uv: hi.uv, idx: hi.idx };
  const clean = cleanHigh(high, det);
  const { low, legVert } = simplify(high, clean.idx, clean.legVert, det);
  console.log(`lascas no UV corrigidas por troca de diagonal: ${fixUvSlivers(low)}`);

  // Normal map na pose T, com a malha baixa exatamente como vai (mesmas normais e tangentes do arquivo; o referencial
  // tangente acompanha a pele quando os braços abaixam).
  const lowN = computeNormals(low.pos, low.idx, legVert);
  const lowT = vertexTangents(low.pos, lowN, low.uv, low.idx);
  const hiN = areaNormals(hp, clean.idx, MeshoptSimplifier.generatePositionRemap(hp, 3));
  const bake = bakeNormalMap({ pos: hp, uv: hi.uv, idx: clean.idx, nrm: hiN }, { ...low, nrm: lowN, tan: lowT }, NORMAL_SIZE);
  console.log(`normal map ${NORMAL_SIZE}²: ${(bake.coverage * 100).toFixed(1)}% dos texels cobertos, ${bake.flipped} texels limitados (normal da original virada)`);
  const fails = checks(high, clean.idx, low, det);

  const tex = image ? await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true }) : null;
  const color = (u: number, v: number): Vec => {
    if (!tex) return [255, 255, 255];
    const { width: w, height: h } = tex.info;
    const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
    const o = (y * w + x) * 3;
    return [tex.data[o], tex.data[o + 1], tex.data[o + 2]];
  };
  const mesh = shinTubes(low, legVert, det, color);
  const W = computeWeights(mesh, det);
  const J = lowerArms(mesh.pos, W, det.J);
  console.log('juntas (repouso, braços para baixo):');
  for (const b of BONES) console.log(`  ${b.padEnd(10)} ${fmt(J[b])}`);
  const box = bounds(mesh.pos);
  console.log(`caixa final: ${fmt(box.min)} – ${fmt(box.max)}`);

  const extras: Extras = { hipsY: J.hips[1], height: HEIGHT, source: { scale: frame.s, offset: frame.off, flip180: frame.flip } };
  const { texBytes, normalBytes } = await write(outPath, mesh, W, J, image, bake.rgb, mat, extras);
  const size = statSync(outPath).size;
  console.log(`saída: ${outPath}`);
  console.log(`  ${mesh.idx.length / 3} triângulos, ${mesh.pos.length / 3} vértices, texturas ${(texBytes / 1024).toFixed(0)} KB (normais ${(normalBytes / 1024).toFixed(0)} KB), arquivo ${(size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  extras: hipsY=${J.hips[1].toFixed(4)} height=${HEIGHT}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (size > 2.5 * 1024 * 1024) fails.push(`arquivo com ${(size / 1024 / 1024).toFixed(2)} MB (limite 2,5 MB)`);
  if (fails.length) {
    console.error(`CONFERÊNCIAS FALHARAM:\n  ${fails.join('\n  ')}`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

export { load, normalize, applyFrame, detect, bounds, positionGroups, segDist, type Detect };
