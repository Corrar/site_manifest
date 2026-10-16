import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Pt } from '../../../shared/geometry.ts';
import type { MapData } from '../../../shared/map.ts';

// Shape fica no plano XY; rotateX(-π/2) leva (x, -z) do shape para (x, 0, z) no mundo.
const shapeOf = (outline: Pt[]) => new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));

function flat(outline: Pt[], y: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shapeOf(outline));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

function road(line: Pt[], width: number, y: number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const h = width / 2;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const nx = (-(bz - az) / len) * h;
    const nz = ((bx - ax) / len) * h;
    pos.push(
      ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz,
      ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz,
    );
  }
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function addMerged(scene: THREE.Scene, geos: (THREE.BufferGeometry | null)[], material: THREE.Material, castShadow: boolean) {
  const list = geos.filter((g): g is THREE.BufferGeometry => g !== null);
  if (list.length === 0) return;
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!merged) return;
  const mesh = new THREE.Mesh(merged, material);
  mesh.receiveShadow = true;
  mesh.castShadow = castShadow;
  scene.add(mesh);
}

/** Chão, gramados, água, vias e prédios em poucas malhas mescladas (uma por material). */
export function buildMap(map: MapData, scene: THREE.Scene): void {
  const b = map.bounds;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(b.maxX - b.minX + 400, b.maxZ - b.minZ + 400),
    new THREE.MeshLambertMaterial({ color: '#8f9a78' }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const side = THREE.DoubleSide;
  addMerged(scene, map.areas.filter((a) => a.kind === 'grass').map((a) => flat(a.outline, 0.05)),
    new THREE.MeshLambertMaterial({ color: '#6fa84f', side }), false);
  addMerged(scene, map.areas.filter((a) => a.kind === 'water').map((a) => flat(a.outline, 0.1)),
    new THREE.MeshLambertMaterial({ color: '#3d7fb8', side }), false);
  addMerged(scene, map.roads.map((r) => road(r.line, r.width, r.width >= 4 ? 0.15 : 0.2)),
    new THREE.MeshLambertMaterial({ color: '#4a4d52', side }), false);
  addMerged(scene, map.buildings.map((bd) => {
    const g = new THREE.ExtrudeGeometry(shapeOf(bd.outline), { depth: bd.height, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }), new THREE.MeshLambertMaterial({ color: '#d9d4c7' }), true);
}
