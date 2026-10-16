import * as THREE from 'three';
import { VEHICLE } from '../../../shared/constants.ts';

// Carro de som e caminhão de som, montados com caixas. Olham para +Z, como os personagens.

type Team = { color: string; accent: string };
const mats = new Map<string, THREE.Material>();
function mat(color: string, opts: { emissive?: string; transparent?: boolean } = {}): THREE.Material {
  const key = `${color}|${opts.emissive ?? ''}|${opts.transparent ?? ''}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: 0.55, metalness: 0.15,
      emissive: opts.emissive ?? '#000000', emissiveIntensity: opts.emissive ? 0.9 : 0,
      transparent: opts.transparent ?? false, opacity: opts.transparent ? 0.55 : 1,
    });
    mats.set(key, m);
  }
  return m;
}

function part(g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rot?: THREE.Euler) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  if (rot) mesh.rotation.copy(rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

function wheels(g: THREE.Group, positions: [number, number][], r: number, w: number) {
  const tire = new THREE.CylinderGeometry(r, r, w, 14);
  const hub = new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.02, 10);
  const rot = new THREE.Euler(0, 0, Math.PI / 2);
  for (const [x, z] of positions) {
    part(g, tire, mat('#151515'), x, r, z, rot);
    part(g, hub, mat('#b8b8b8'), x, r, z, rot);
  }
}

/** Parede de alto-falantes virada para `facing` (+1 = +X, -1 = -X, 0 = traseira -Z). */
function speakerWall(g: THREE.Group, cx: number, cy: number, cz: number, w: number, h: number, facing: -1 | 0 | 1) {
  const along = facing === 0 ? 'x' : 'z';
  const depth = 0.25;
  part(g, facing === 0 ? box(w, h, depth) : box(depth, h, w), mat('#1b1b1d'), cx, cy, cz);
  const cone = new THREE.CylinderGeometry(0.17, 0.12, 0.08, 14);
  const rot = facing === 0 ? new THREE.Euler(Math.PI / 2, 0, 0) : new THREE.Euler(0, 0, Math.PI / 2);
  const cols = Math.max(1, Math.floor(w / 0.48));
  const rows = Math.max(1, Math.floor(h / 0.48));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const u = (i - (cols - 1) / 2) * 0.46;
      const v = (j - (rows - 1) / 2) * 0.46;
      const off = facing === 0 ? -depth / 2 - 0.02 : facing * (depth / 2 + 0.02);
      if (along === 'x') part(g, cone, mat('#3a3a3e'), cx + u, cy + v, cz + off, rot);
      else part(g, cone, mat('#3a3a3e'), cx + off, cy + v, cz + u, rot);
    }
  }
}

function flagPole(g: THREE.Group, x: number, y: number, z: number, h: number, team: Team, brasil: boolean) {
  part(g, new THREE.CylinderGeometry(0.025, 0.025, h, 6), mat('#cfcfcf'), x, y + h / 2, z);
  const fy = y + h - 0.3;
  if (brasil) {
    part(g, box(0.02, 0.6, 0.85), mat('#1f9d55'), x, fy, z + 0.45);
    part(g, box(0.03, 0.42, 0.42), mat('#f7d117'), x, fy, z + 0.45, new THREE.Euler(Math.PI / 4, 0, 0));
    part(g, new THREE.CylinderGeometry(0.13, 0.13, 0.04, 12), mat('#1d4f9c'), x, fy, z + 0.45, new THREE.Euler(0, 0, Math.PI / 2));
  } else {
    part(g, box(0.02, 0.6, 0.85), mat(team.color), x, fy, z + 0.45);
    part(g, box(0.03, 0.16, 0.85), mat(team.accent), x, fy, z + 0.45);
  }
}

function car(team: Team): THREE.Group {
  const g = new THREE.Group();
  const paint = mat(team.color);
  part(g, box(1.75, 0.75, 3.9), paint, 0, 0.75, 0); // carroceria
  part(g, box(1.6, 0.65, 2.1), paint, 0, 1.45, -0.35); // cabine
  part(g, box(1.62, 0.5, 1.9), mat('#9fc3dd', { transparent: true }), 0, 1.5, -0.3); // vidros
  part(g, box(1.77, 0.12, 3.92), mat(team.accent), 0, 0.95, 0); // faixa
  part(g, box(1.6, 0.3, 0.1), mat('#f6f2d0', { emissive: '#fff6c8' }), 0, 0.85, 1.96); // faróis
  part(g, box(1.6, 0.2, 0.1), mat('#b3261e', { emissive: '#7a0f0b' }), 0, 0.85, -1.96);
  // Porta-malas aberto com paredão
  part(g, box(1.6, 0.08, 0.9), paint, 0, 2.05, -1.75, new THREE.Euler(-0.9, 0, 0));
  speakerWall(g, 0, 1.25, -1.5, 1.45, 0.75, 0);
  wheels(g, [[0.85, 1.25], [-0.85, 1.25], [0.85, -1.25], [-0.85, -1.25]], 0.36, 0.26);
  flagPole(g, 0.6, 1.8, -0.9, 1.4, team, true);
  flagPole(g, -0.6, 1.8, -0.9, 1.4, team, false);
  return g;
}

function truck(team: Team): THREE.Group {
  const g = new THREE.Group();
  const paint = mat(team.color);
  // Cabine na frente (+Z)
  part(g, box(2.5, 2.2, 2.1), paint, 0, 1.85, 4.3);
  part(g, box(2.45, 0.9, 0.08), mat('#9fc3dd', { transparent: true }), 0, 2.35, 5.36);
  part(g, box(2.52, 0.25, 2.12), mat(team.accent), 0, 1.25, 4.3);
  part(g, box(2.2, 0.3, 0.1), mat('#f6f2d0', { emissive: '#fff6c8' }), 0, 1.05, 5.37);
  // Carroceria: paredões nas laterais e na traseira
  part(g, box(2.5, 0.5, 8.0), mat('#2a2a2c'), 0, 1.0, -0.9);
  speakerWall(g, 1.15, 2.35, -0.9, 7.6, 2.2, 1);
  speakerWall(g, -1.15, 2.35, -0.9, 7.6, 2.2, -1);
  speakerWall(g, 0, 2.35, -4.8, 2.1, 2.2, 0);
  part(g, box(2.5, 2.2, 0.2), paint, 0, 2.35, 3.05); // fundo do palco
  // Palco no teto com grade e treliça de luzes
  part(g, box(2.6, 0.12, 8.2), mat('#3b3b3e'), 0, 3.5, -0.9);
  const rail = new THREE.CylinderGeometry(0.03, 0.03, 8.0, 6);
  for (const x of [-1.25, 1.25]) {
    part(g, rail, mat('#d0d0d0'), x, 4.3, -0.9, new THREE.Euler(Math.PI / 2, 0, 0));
    for (let i = 0; i < 9; i++) part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), mat('#d0d0d0'), x, 3.95, -4.8 + i);
  }
  for (let i = 0; i < 5; i++) {
    const z = -4.4 + i * 1.9;
    part(g, box(2.6, 0.08, 0.08), mat('#d0d0d0'), 0, 5.2, z);
    for (const x of [-0.9, 0, 0.9]) part(g, new THREE.SphereGeometry(0.09, 8, 6), mat(i % 2 ? team.accent : '#ffffff', { emissive: i % 2 ? team.accent : '#ffffff' }), x, 5.08, z);
  }
  for (const x of [-1.25, 1.25]) for (const z of [-4.8, 3.0]) part(g, box(0.08, 1.7, 0.08), mat('#d0d0d0'), x, 4.35, z);
  wheels(g, [[1.15, 4.0], [-1.15, 4.0], [1.15, -2.6], [-1.15, -2.6], [1.15, -3.8], [-1.15, -3.8]], 0.5, 0.4);
  flagPole(g, 1.1, 5.2, 2.6, 1.6, team, true);
  flagPole(g, -1.1, 5.2, -4.4, 1.6, team, false);
  return g;
}

export const VEHICLE_HEIGHT = [0, 2.6, 6.6];

export function buildVehicle(kind: number, team: Team): THREE.Group {
  return kind === VEHICLE.truck ? truck(team) : car(team);
}
