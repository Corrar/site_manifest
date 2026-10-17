import { pointInPolygon, pushOutOfPolygon, type Pt } from './geometry.ts';

export type Road = { line: Pt[]; width: number };
/** Materiais de fachada que o cliente sabe desenhar. Sem `material`, ele escolhe pela altura e pelo tamanho. */
export type FacadeMaterial = 'glass' | 'concrete' | 'windows' | 'brick';
export type Building = { outline: Pt[]; height: number; color?: string; material?: FacadeMaterial };
/** paved: praças, estacionamentos e calçadões. wood: mata fechada (o cliente planta árvores dentro). */
export type AreaKind = 'grass' | 'water' | 'paved' | 'wood';
export type Area = { outline: Pt[]; kind: AreaKind };
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type MapData = {
  version: 1;
  bounds: Bounds;
  roads: Road[];
  buildings: Building[];
  areas: Area[];
  solids: Pt[][];
  /** Árvores mapeadas uma a uma no OSM (opcional; o cliente ainda planta as suas ao longo das vias). */
  trees?: Pt[];
};

const GRID = 32;
type Poly = { pts: Pt[]; minX: number; maxX: number; minZ: number; maxZ: number };
const keyOf = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

export class Collider {
  readonly bounds: Bounds;
  private readonly cells = new Map<number, Poly[]>();

  constructor(polys: readonly Pt[][], bounds: Bounds) {
    this.bounds = bounds;
    for (const pts of polys) {
      if (pts.length < 3) continue;
      const p: Poly = { pts, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const [x, z] of pts) {
        p.minX = Math.min(p.minX, x);
        p.maxX = Math.max(p.maxX, x);
        p.minZ = Math.min(p.minZ, z);
        p.maxZ = Math.max(p.maxZ, z);
      }
      for (let cx = Math.floor(p.minX / GRID); cx <= Math.floor(p.maxX / GRID); cx++) {
        for (let cz = Math.floor(p.minZ / GRID); cz <= Math.floor(p.maxZ / GRID); cz++) {
          const k = keyOf(cx, cz);
          const list = this.cells.get(k);
          if (list) list.push(p);
          else this.cells.set(k, [p]);
        }
      }
    }
  }

  static fromMap(map: MapData): Collider {
    return new Collider([...map.buildings.map((b) => b.outline), ...map.solids], map.bounds);
  }

  private nearby(x: number, z: number, r: number): Set<Poly> {
    const found = new Set<Poly>();
    for (let cx = Math.floor((x - r) / GRID); cx <= Math.floor((x + r) / GRID); cx++) {
      for (let cz = Math.floor((z - r) / GRID); cz <= Math.floor((z + r) / GRID); cz++) {
        const list = this.cells.get(keyOf(cx, cz));
        if (list) for (const p of list) found.add(p);
      }
    }
    return found;
  }

  /** Posição corrigida de um círculo de raio r: fora dos polígonos e dentro dos limites. */
  resolve(x: number, z: number, r: number): Pt {
    for (let pass = 0; pass < 2; pass++) {
      for (const p of this.nearby(x, z, r)) {
        if (x + r < p.minX || x - r > p.maxX || z + r < p.minZ || z - r > p.maxZ) continue;
        const out = pushOutOfPolygon(x, z, r, p.pts);
        if (out) [x, z] = out;
      }
    }
    const b = this.bounds;
    return [Math.min(b.maxX - r, Math.max(b.minX + r, x)), Math.min(b.maxZ - r, Math.max(b.minZ + r, z))];
  }

  blocked(x: number, z: number): boolean {
    for (const p of this.nearby(x, z, 0)) if (pointInPolygon(x, z, p.pts)) return true;
    return false;
  }
}
