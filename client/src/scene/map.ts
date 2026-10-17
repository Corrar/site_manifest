import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Pt } from '../../../shared/geometry.ts';
import { pointInPolygon } from '../../../shared/geometry.ts';
import { Collider, type MapData, type Road } from '../../../shared/map.ts';
import type { Building, FacadeMaterial } from '../../../shared/map.ts';
import {
  asphaltTexture, billboardTexture, brickFacadeTexture, concreteTexture, FACADE_TILE, glassFacadeTexture, grassTexture,
  pavingTexture, roofTexture, windowsFacadeTexture,
} from './textures.ts';

// O mapa vem de shared/map.json (esquemático ou do OpenStreetMap). Tudo o que é decoração (calçadas, faixas,
// árvores, postes) é derivado das vias e prédios aqui no cliente, então vale para qualquer um dos dois.

const MAIN_ROAD = 14; // vias com essa largura ou mais ganham calçada, faixa de pedestre, postes e árvores
const ROAD_Y = { main: 0.1, other: 0.07 };
const SIDEWALK = 3.5;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}

/** Camadas planas empilhadas a poucos cm: um deslocamento de profundidade por camada evita o z-fighting de longe. */
const layer = (n: number) => ({ polygonOffset: true, polygonOffsetFactor: -n, polygonOffsetUnits: -n * 2 });

// ---------- geometria auxiliar ----------

/** Faixa ao longo de uma polilinha, entre os afastamentos `a` e `b` (esquerda positiva), com UV em metros/escala. */
function ribbon(line: Pt[], a: number, b: number, y: number, uvScale: number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const uv: number[] = [];
  let along = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    const p = (x: number, z: number, off: number): [number, number, number] => [x + nx * off, y, z + nz * off];
    const q = [p(ax, az, a), p(bx, bz, a), p(bx, bz, b), p(ax, az, b)];
    const v0 = along / uvScale;
    const v1 = (along + len) / uvScale;
    const ua = a / uvScale;
    const ub = b / uvScale;
    // Dois triângulos, sempre virados para cima.
    const order = a > b ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const uvs = [[ua, v0], [ua, v1], [ub, v1], [ub, v0]];
    for (const k of order) {
      pos.push(...q[k]);
      uv.push(...uvs[k]);
    }
    along += len;
  }
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Retângulo deitado com centro (x, z), direção (dx, dz) unitária, comprimento e largura. */
function quad(x: number, z: number, dx: number, dz: number, len: number, wid: number, y: number): THREE.BufferGeometry {
  return ribbon([[x - dx * len / 2, z - dz * len / 2], [x + dx * len / 2, z + dz * len / 2]], wid / 2, -wid / 2, y, 1)!;
}

function flatShape(outline: Pt[], y: number, uvScale: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z))));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / uvScale;
    uv[i * 2 + 1] = p.getZ(i) / uvScale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function addMerged(scene: THREE.Scene, geos: (THREE.BufferGeometry | null)[], material: THREE.Material, shadows: { cast: boolean; receive: boolean }): void {
  const list = geos.filter((g): g is THREE.BufferGeometry => g !== null);
  if (list.length === 0) return;
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!merged) return;
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = shadows.cast;
  mesh.receiveShadow = shadows.receive;
  scene.add(mesh);
}

function distToSegment(px: number, pz: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

function nearRoad(roads: Road[], x: number, z: number, margin: number, except?: Road): boolean {
  for (const r of roads) {
    if (r === except) continue;
    for (let i = 0; i < r.line.length - 1; i++) if (distToSegment(x, z, r.line[i], r.line[i + 1]) < r.width / 2 + margin) return true;
  }
  return false;
}

/** Pontos a cada `step` metros ao longo da polilinha, com a direção local. */
function* walk(line: Pt[], step: number, start = step / 2): Generator<{ x: number; z: number; dx: number; dz: number }> {
  let carry = start;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    for (let d = carry; d < len; d += step) yield { x: ax + dx * d, z: az + dz * d, dx, dz };
    carry = (carry - len) % step;
    if (carry < 0) carry += step;
  }
}

/**
 * Faixa paralela à via (calçada, meio-fio, borda) em pedaços de `step` metros, pulando os pedaços que caem
 * dentro do leito de outra via: assim a calçada abre na boca dos acessos em vez de atravessá-los.
 */
function stripAlong(road: Road, roads: Road[], a: number, b: number, y: number, uvScale: number, step = 2): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const mid = (a + b) / 2;
  for (const s of walk(road.line, step, step / 2)) {
    const x = s.x - s.dz * mid;
    const z = s.z + s.dx * mid;
    if (nearRoad(roads, x, z, 0.3, road)) continue;
    const g = ribbon([[s.x - s.dx * step / 2, s.z - s.dz * step / 2], [s.x + s.dx * step / 2, s.z + s.dz * step / 2]], a, b, y, uvScale);
    if (g) out.push(g);
  }
  return out;
}

// ---------- partes do mapa ----------

function buildGround(map: MapData, scene: THREE.Scene, mobile: boolean): void {
  const b = map.bounds;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 3000;
  const seg = mobile ? 48 : 96;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  // Variação de cor em escala grande (manchas secas e verdes), para a repetição da textura não aparecer.
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const n = 0.5 + 0.25 * Math.sin(x * 0.011 + Math.cos(z * 0.007) * 2) + 0.25 * Math.sin(z * 0.013 - x * 0.004);
    const c = new THREE.Color().setRGB(0.82 + n * 0.25, 0.86 + n * 0.16, 0.7 + n * 0.12);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const tex = grassTexture();
  tex.repeat.set(size / 14, size / 14);
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95 }));
  ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // Gramados cuidados (mais verdes) e água espelhada.
  const lawn = grassTexture();
  addMerged(scene, map.areas.filter((a) => a.kind === 'grass').map((a) => flatShape(a.outline, 0.03, 14)),
    new THREE.MeshStandardMaterial({ map: lawn, color: '#9fc27a', roughness: 0.9, ...layer(1) }), { cast: false, receive: true });
  // Mata fechada: chão mais escuro (as árvores vão por cima, em buildVegetationAndProps).
  addMerged(scene, map.areas.filter((a) => a.kind === 'wood').map((a) => flatShape(a.outline, 0.04, 14)),
    new THREE.MeshStandardMaterial({ map: grassTexture(), color: '#6f8f4e', roughness: 0.95, ...layer(1) }), { cast: false, receive: true });
  // Praças, calçadões e estacionamentos.
  addMerged(scene, map.areas.filter((a) => a.kind === 'paved').map((a) => flatShape(a.outline, 0.05, 6)),
    new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.85, ...layer(2) }), { cast: false, receive: true });
  addMerged(scene, map.areas.filter((a) => a.kind === 'water').map((a) => flatShape(a.outline, 0.08, 8)),
    new THREE.MeshStandardMaterial({ color: '#35617a', roughness: 0.06, metalness: 0.85, ...layer(1) }), { cast: false, receive: true });
}

function buildRoads(map: MapData, scene: THREE.Scene): void {
  const asphalt = asphaltTexture();
  const paving = pavingTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, ...layer(2) });
  const paint = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.7, ...layer(4) });
  const yellow = new THREE.MeshStandardMaterial({ color: '#e6b422', roughness: 0.7, ...layer(4) });
  const roads: THREE.BufferGeometry[] = [];
  const white: THREE.BufferGeometry[] = [];
  const edges: THREE.BufferGeometry[] = [];
  const walks: THREE.BufferGeometry[] = [];
  const curbs: THREE.BufferGeometry[] = [];
  for (const r of map.roads) {
    const main = r.width >= MAIN_ROAD;
    const y = main ? ROAD_Y.main : ROAD_Y.other;
    const h = r.width / 2;
    const g = ribbon(r.line, h, -h, y, 6);
    if (g) roads.push(g);
    if (r.width < 6) continue;
    // Faixas: bordas contínuas, divisões tracejadas entre as faixas de 3,5 m.
    const lanes = Math.max(1, Math.round(r.width / 3.5));
    const lw = r.width / lanes;
    for (const off of [h - 0.35, -h + 0.35]) (main ? white : edges).push(...stripAlong(r, map.roads, off + 0.08, off - 0.08, y + 0.012, 1));
    for (let k = 1; k < lanes; k++) {
      const off = -h + k * lw;
      for (const s of walk(r.line, 9, 2)) white.push(quad(s.x - s.dz * off, s.z + s.dx * off, s.dx, s.dz, 4, 0.14, y + 0.012));
    }
    if (main) {
      // Faixas de pedestre a cada 170 m, atravessando a via.
      for (const s of walk(r.line, 170, 85)) {
        for (let k = -h + 0.6; k < h - 0.4; k += 1.0) {
          white.push(quad(s.x - s.dz * k, s.z + s.dx * k, s.dx, s.dz, 4, 0.5, y + 0.014));
        }
      }
    }
    if (r.width >= 10) {
      for (const side of [1, -1]) {
        walks.push(...stripAlong(r, map.roads, side * (h + 0.25), side * (h + 0.25 + SIDEWALK), 0.09, 6));
        curbs.push(...stripAlong(r, map.roads, side * h, side * (h + 0.25), 0.16, 1));
      }
    }
  }
  addMerged(scene, roads, roadMat, { cast: false, receive: true });
  addMerged(scene, walks, new THREE.MeshStandardMaterial({ map: paving, roughness: 0.85, ...layer(3) }), { cast: false, receive: true });
  addMerged(scene, curbs, new THREE.MeshStandardMaterial({ color: '#cfcac0', roughness: 0.8 }), { cast: false, receive: true });
  addMerged(scene, white, paint, { cast: false, receive: true });
  addMerged(scene, edges, yellow, { cast: false, receive: true });
}

function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

type WallBuckets = Record<FacadeMaterial, number[][]>;
const WHITE = new THREE.Color('#ffffff');

/** Material de cada parede: o que o OSM disser; senão vidro nas fachadas longas dos prédios altos, concreto nas curtas, janelas nos baixos. */
function facadeOf(bd: Building, len: number): FacadeMaterial {
  if (bd.material) return bd.material === 'concrete' && bd.height < 30 ? 'windows' : bd.material;
  return bd.height >= 30 ? (len >= 40 ? 'glass' : 'concrete') : 'windows';
}

/** Paredes de um prédio, separadas por material, com UV em ladrilhos de fachada e cor por vértice (tingimento do OSM). */
function walls(bd: Building, height: number, out: WallBuckets, pick: (len: number) => FacadeMaterial = (len) => facadeOf(bd, len)): void {
  const outline = bd.outline;
  const ccw = signedArea(outline) > 0;
  const n = outline.length;
  const c = bd.color ? new THREE.Color(bd.color) : WHITE;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const bucket = out[pick(len)];
    const [p0, p1] = ccw ? [b, a] : [a, b]; // ordem que deixa a face virada para fora
    const u1 = len / FACADE_TILE.w;
    const v1 = height / FACADE_TILE.h;
    const quadPos = [
      [p0[0], 0, p0[1], 0, 0], [p1[0], 0, p1[1], u1, 0], [p1[0], height, p1[1], u1, v1],
      [p0[0], 0, p0[1], 0, 0], [p1[0], height, p1[1], u1, v1], [p0[0], height, p0[1], 0, v1],
    ];
    for (const q of quadPos) bucket.push([...q, c.r, c.g, c.b]);
  }
}

function wallGeometry(verts: number[][]): THREE.BufferGeometry | null {
  if (verts.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts.flatMap((v) => [v[0], v[1], v[2]]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(verts.flatMap((v) => [v[3], v[4]]), 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(verts.flatMap((v) => [v[5], v[6], v[7]]), 3));
  g.computeVertexNormals();
  return g;
}

function buildBuildings(map: MapData, scene: THREE.Scene): void {
  const buckets: WallBuckets = { glass: [], concrete: [], windows: [], brick: [] };
  const roofs: THREE.BufferGeometry[] = [];
  const parapets: THREE.BufferGeometry[] = [];
  for (const bd of map.buildings) {
    walls(bd, bd.height, buckets);
    roofs.push(flatShape(bd.outline, bd.height, 10));
    // Platibanda: um friso claro no topo.
    const ring: WallBuckets = { glass: [], concrete: [], windows: [], brick: [] };
    walls({ outline: bd.outline, height: bd.height }, 0.9, ring, () => 'concrete');
    const pg = wallGeometry(ring.concrete);
    if (pg) {
      pg.translate(0, bd.height, 0);
      parapets.push(pg);
    }
  }
  const glass = glassFacadeTexture();
  addMerged(scene, [wallGeometry(buckets.glass)],
    new THREE.MeshStandardMaterial({ map: glass, roughness: 0.18, metalness: 0.55, envMapIntensity: 1.3, vertexColors: true }),
    { cast: true, receive: true });
  addMerged(scene, [wallGeometry(buckets.concrete)],
    new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.85, vertexColors: true }), { cast: true, receive: true });
  addMerged(scene, [wallGeometry(buckets.windows)],
    new THREE.MeshStandardMaterial({ map: windowsFacadeTexture(), roughness: 0.7, vertexColors: true }), { cast: true, receive: true });
  addMerged(scene, [wallGeometry(buckets.brick)],
    new THREE.MeshStandardMaterial({ map: brickFacadeTexture(), roughness: 0.9, vertexColors: true }), { cast: true, receive: true });
  addMerged(scene, roofs, new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.95 }), { cast: false, receive: true });
  addMerged(scene, parapets, new THREE.MeshStandardMaterial({ color: '#e7e3d8', roughness: 0.8, side: THREE.DoubleSide }), { cast: false, receive: false });
}

function treeGeometries(): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.16, 0.3, 3.4, 7);
  trunk.translate(0, 1.7, 0);
  const parts: THREE.BufferGeometry[] = [];
  const r = rng(3);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(1.5 + r() * 0.7, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const f = 0.85 + r() * 0.3;
      p.setXYZ(k, p.getX(k) * f, p.getY(k) * f * 0.75, p.getZ(k) * f);
    }
    const a = (i / 4) * Math.PI * 2;
    g.translate(Math.cos(a) * 1.1, 4.3 + r() * 0.8, Math.sin(a) * 1.1);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  const top = new THREE.IcosahedronGeometry(1.9, 1);
  top.scale(1, 0.7, 1);
  top.translate(0, 5.3, 0);
  parts.push(top.index ? top.toNonIndexed() : top);
  const crown = mergeGeometries(parts.map((g) => {
    g.deleteAttribute('uv');
    return g;
  }))!;
  crown.computeVertexNormals();
  return { trunk, crown };
}

function lampGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.07, 0.11, 9, 8);
  pole.translate(0, 4.5, 0);
  const arm = new THREE.BoxGeometry(0.08, 0.08, 2.2);
  arm.translate(0, 8.9, 1.05);
  const head = new THREE.BoxGeometry(0.35, 0.14, 0.8);
  head.translate(0, 8.82, 2.1);
  return mergeGeometries([pole, arm, head].map((g) => {
    const n = g.toNonIndexed();
    n.deleteAttribute('uv');
    return n;
  }))!;
}

function buildVegetationAndProps(map: MapData, scene: THREE.Scene, mobile: boolean): void {
  const collider = Collider.fromMap(map);
  const water = map.areas.filter((a) => a.kind === 'water');
  const r = rng(99);
  const trees: { x: number; z: number; s: number; rot: number }[] = [];
  const free = (x: number, z: number, margin: number) =>
    !collider.blocked(x, z) && !nearRoad(map.roads, x, z, margin) && !water.some((w) => pointInPolygon(x, z, w.outline))
    && collider.resolve(x, z, 2)[0] === x;
  // Fileiras ao longo das avenidas, depois da calçada.
  for (const road of map.roads) {
    if (road.width < 10) continue;
    for (const side of [1, -1]) {
      const off = side * (road.width / 2 + SIDEWALK + 3.5);
      for (const s of walk(road.line, 15, 7 + r() * 6)) {
        const x = s.x - s.dz * off + (r() - 0.5) * 3;
        const z = s.z + s.dx * off + (r() - 0.5) * 3;
        if (free(x, z, 1.5)) trees.push({ x, z, s: 0.8 + r() * 0.6, rot: r() * Math.PI * 2 });
      }
    }
  }
  // Árvores mapeadas no OSM, uma a uma (com um leve desvio para não ficarem em grade perfeita).
  for (const [tx, tz] of map.trees ?? []) {
    const x = tx + (r() - 0.5) * 0.8;
    const z = tz + (r() - 0.5) * 0.8;
    if (!collider.blocked(x, z)) trees.push({ x, z, s: 0.85 + r() * 0.5, rot: r() * Math.PI * 2 });
  }
  // Mata fechada: árvores espalhadas dentro das áreas de mata, até um teto por área.
  for (const w of map.areas) {
    if (w.kind !== 'wood') continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of w.outline) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const want = Math.min(mobile ? 120 : 400, Math.round(((maxX - minX) * (maxZ - minZ)) / 90));
    let planted = 0;
    for (let i = 0; i < want * 3 && planted < want; i++) {
      const x = minX + r() * (maxX - minX);
      const z = minZ + r() * (maxZ - minZ);
      if (pointInPolygon(x, z, w.outline) && free(x, z, 2)) {
        trees.push({ x, z, s: 0.9 + r() * 0.8, rot: r() * Math.PI * 2 });
        planted++;
      }
    }
  }
  // Bosques entre os prédios.
  const b = map.bounds;
  for (let i = 0; i < (mobile ? 250 : 700); i++) {
    const bd = map.buildings[Math.floor(r() * map.buildings.length)];
    if (!bd) break;
    const [cx, cz] = bd.outline[Math.floor(r() * bd.outline.length)];
    const x = cx + (r() - 0.5) * 70;
    const z = cz + (r() - 0.5) * 70;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (free(x, z, 2.5)) trees.push({ x, z, s: 0.7 + r() * 0.7, rot: r() * Math.PI * 2 });
  }

  const { trunk, crown } = treeGeometries();
  const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#5b4632', roughness: 0.95 }), trees.length);
  const crowns = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }), trees.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const greens = ['#3f6b2a', '#4c7a31', '#567f35', '#3a5f27', '#62853b'].map((c) => new THREE.Color(c));
  const ipeYellow = new THREE.Color('#f0c419');
  const ipePink = new THREE.Color('#c45a9e');
  trees.forEach((t, i) => {
    m.compose(new THREE.Vector3(t.x, 0, t.z), q.setFromAxisAngle(up, t.rot), new THREE.Vector3(t.s, t.s, t.s));
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
    const k = r();
    crowns.setColorAt(i, k < 0.1 ? ipeYellow : k < 0.16 ? ipePink : greens[Math.floor(r() * greens.length)]);
  });
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Postes nas duas margens das avenidas, com o braço virado para a pista.
  const lamps: THREE.Matrix4[] = [];
  for (const road of map.roads) {
    if (road.width < MAIN_ROAD) continue;
    for (const side of [1, -1]) {
      const off = side * (road.width / 2 + 0.9);
      for (const s of walk(road.line, 36, side > 0 ? 6 : 24)) {
        const x = s.x - s.dz * off;
        const z = s.z + s.dx * off;
        if (nearRoad(map.roads, x, z, 1, road)) continue; // não planta poste na boca de outra via
        // braço aponta para o centro da via: direção (s.dz, -s.dx) * side
        const yaw = Math.atan2(s.dz * side, -s.dx * side);
        lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(up, yaw), new THREE.Vector3(1, 1, 1)));
      }
    }
  }
  const lampMesh = new THREE.InstancedMesh(lampGeometry(), new THREE.MeshStandardMaterial({ color: '#8d9399', roughness: 0.5, metalness: 0.6 }), lamps.length);
  lamps.forEach((mm, i) => lampMesh.setMatrixAt(i, mm));
  lampMesh.castShadow = true;
  scene.add(lampMesh);
}

/** Telões nas fachadas dos prédios altos viradas para uma avenida: painel 2:1, levemente afastado da parede. */
function buildBillboards(map: MapData, scene: THREE.Scene, mobile: boolean): void {
  const main = map.roads.filter((r) => r.width >= 10);
  type Spot = { a: Pt; b: Pt; nx: number; nz: number; height: number; score: number; owner: Building };
  const spots: Spot[] = [];
  for (const bd of map.buildings) {
    if (bd.height < 24) continue;
    const ccw = signedArea(bd.outline) > 0;
    const n = bd.outline.length;
    for (let i = 0; i < n; i++) {
      const a = bd.outline[i];
      const b = bd.outline[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 18) continue;
      // normal para fora da parede (mesma convenção de walls(): sem ccw, a face (a→b, para cima) olha para (-dz, dx))
      let nx = -(b[1] - a[1]) / len;
      let nz = (b[0] - a[0]) / len;
      if (ccw) {
        nx = -nx;
        nz = -nz;
      }
      const mx = (a[0] + b[0]) / 2 + nx * 12;
      const mz = (a[1] + b[1]) / 2 + nz * 12;
      // a parede precisa estar de frente para uma avenida, a menos de 40 m
      let best = Infinity;
      for (const r of main) for (let k = 0; k < r.line.length - 1; k++) best = Math.min(best, distToSegment(mx, mz, r.line[k], r.line[k + 1]));
      if (best > 40) continue;
      spots.push({ a, b, nx, nz, height: bd.height, score: bd.height - best * 0.3, owner: bd });
    }
  }
  spots.sort((p, q) => q.score - p.score);
  const r = rng(17);
  // No máximo um telão por prédio, nos prédios mais altos e mais perto das avenidas.
  const used = new Set<Building>();
  const chosen: Spot[] = [];
  for (const sp of spots) {
    if (used.has(sp.owner) || chosen.length >= (mobile ? 20 : 60)) continue;
    used.add(sp.owner);
    chosen.push(sp);
  }
  const perArt: THREE.BufferGeometry[][] = [[], [], [], []];
  const frames: THREE.BufferGeometry[] = [];
  chosen.forEach((sp, i) => {
    const len = Math.hypot(sp.b[0] - sp.a[0], sp.b[1] - sp.a[1]);
    const w = Math.min(24, len * 0.7);
    const h = w / 2;
    const y0 = Math.min(sp.height - h - 2, 8 + r() * Math.max(1, sp.height - h - 12));
    const cx = (sp.a[0] + sp.b[0]) / 2 + sp.nx * 0.35;
    const cz = (sp.a[1] + sp.b[1]) / 2 + sp.nz * 0.35;
    const tx = (sp.b[0] - sp.a[0]) / len;
    const tz = (sp.b[1] - sp.a[1]) / len;
    const g = new THREE.PlaneGeometry(w, h);
    // orienta o plano: +Z local vira a normal da parede
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(tx, 0, tz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(sp.nx, 0, sp.nz));
    // se a tangente não bate com a normal (plano espelhado), inverte a tangente
    if (new THREE.Vector3(tx, 0, tz).cross(new THREE.Vector3(0, 1, 0)).dot(new THREE.Vector3(sp.nx, 0, sp.nz)) < 0) {
      m.makeBasis(new THREE.Vector3(-tx, 0, -tz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(sp.nx, 0, sp.nz));
    }
    m.setPosition(cx, y0 + h / 2, cz);
    g.applyMatrix4(m);
    perArt[i % 4].push(g);
    // moldura escura atrás do painel
    const frame = new THREE.PlaneGeometry(w + 0.8, h + 0.8);
    const fm = m.clone();
    fm.setPosition(cx - sp.nx * 0.2, y0 + h / 2, cz - sp.nz * 0.2);
    frame.applyMatrix4(fm);
    frames.push(frame);
  });
  addMerged(scene, frames, new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.6, metalness: 0.3 }), { cast: false, receive: false });
  perArt.forEach((geos, k) => {
    if (!geos.length) return;
    const tex = billboardTexture(k);
    addMerged(scene, geos, new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.6 }),
      { cast: false, receive: false });
  });
}

/** Carros estacionados nas áreas pavimentadas pequenas (estacionamentos): caixas simples, instanciadas. */
function buildParkedCars(map: MapData, scene: THREE.Scene, mobile: boolean): void {
  const lots = map.areas.filter((a) => a.kind === 'paved' && Math.abs(signedArea(a.outline)) < 8000);
  const r = rng(23);
  const cars: { x: number; z: number; yaw: number; color: THREE.Color }[] = [];
  const palette = ['#d9d9d9', '#2b2b2b', '#8a8f96', '#b4432f', '#5f86b5', '#f2f0ea', '#4a4f57', '#1f9d55'].map((c) => new THREE.Color(c));
  const cap = mobile ? 120 : 400;
  for (const lot of lots) {
    // eixo maior do lote: do primeiro vértice ao segundo
    const [a, b] = [lot.outline[0], lot.outline[1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / len;
    const tz = (b[1] - a[1]) / len;
    const nx = -tz;
    const nz = tx;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of lot.outline) {
      const u = (x - a[0]) * tx + (z - a[1]) * tz;
      const v = (x - a[0]) * nx + (z - a[1]) * nz;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    for (let v = minV + 3.5; v < maxV - 2.5; v += 7) {
      for (let u = minU + 2; u < maxU - 1.5; u += 2.9) {
        if (r() < 0.3 || cars.length >= cap) continue;
        const x = a[0] + tx * u + nx * v;
        const z = a[1] + tz * u + nz * v;
        if (!pointInPolygon(x, z, lot.outline)) continue;
        cars.push({ x, z, yaw: Math.atan2(nx, nz) + (r() - 0.5) * 0.06, color: palette[Math.floor(r() * palette.length)] });
      }
    }
  }
  if (!cars.length) return;
  const body = new THREE.BoxGeometry(1.8, 0.6, 4.3);
  body.translate(0, 0.55, 0);
  const cabin = new THREE.BoxGeometry(1.6, 0.55, 2.2);
  cabin.translate(0, 1.1, -0.2);
  const geo = mergeGeometries([body, cabin].map((g) => g.toNonIndexed()))!;
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.4 }), cars.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  cars.forEach((c, i) => {
    m.compose(new THREE.Vector3(c.x, 0, c.z), q.setFromAxisAngle(up, c.yaw), new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.color);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/** Chão, gramados, água, vias com faixas e calçadas, prédios com fachadas, árvores e postes. */
export function buildMap(map: MapData, scene: THREE.Scene, mobile = false): void {
  buildGround(map, scene, mobile);
  buildRoads(map, scene);
  buildBuildings(map, scene);
  buildBillboards(map, scene, mobile);
  buildParkedCars(map, scene, mobile);
  buildVegetationAndProps(map, scene, mobile);
}
