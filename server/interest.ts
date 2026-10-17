import { CELL_SIZE, FAR_MAX, FAR_RADIUS, NEAR_MAX, NEAR_RADIUS } from '../shared/constants.ts';

export type Hit = { id: number; d2: number };
type Entry = { x: number; z: number; key: number };
const keyOf = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

export class SpatialGrid {
  private readonly cell: number;
  private readonly cells = new Map<number, Set<number>>();
  private readonly where = new Map<number, Entry>();

  constructor(cell = CELL_SIZE) {
    this.cell = cell;
  }

  get size(): number {
    return this.where.size;
  }

  set(id: number, x: number, z: number): void {
    const key = keyOf(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const e = this.where.get(id);
    if (!e) {
      this.where.set(id, { x, z, key });
      this.addTo(key, id);
      return;
    }
    if (e.key !== key) {
      this.removeFrom(e.key, id);
      this.addTo(key, id);
      e.key = key;
    }
    e.x = x;
    e.z = z;
  }

  delete(id: number): void {
    const e = this.where.get(id);
    if (!e) return;
    this.removeFrom(e.key, id);
    this.where.delete(id);
  }

  query(x: number, z: number, r: number, out: Hit[]): Hit[] {
    const r2 = r * r;
    const c = this.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) {
      for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++) {
        const set = this.cells.get(keyOf(cx, cz));
        if (!set) continue;
        for (const id of set) {
          const e = this.where.get(id)!;
          const d2 = (e.x - x) ** 2 + (e.z - z) ** 2;
          if (d2 <= r2) out.push({ id, d2 });
        }
      }
    }
    return out;
  }

  private addTo(key: number, id: number): void {
    const set = this.cells.get(key);
    if (set) set.add(id);
    else this.cells.set(key, new Set([id]));
  }

  private removeFrom(key: number, id: number): void {
    const set = this.cells.get(key);
    if (!set) return;
    set.delete(id);
    if (set.size === 0) this.cells.delete(key);
  }
}

const byDistance = (a: Hit, b: Hit) => a.d2 - b.d2 || a.id - b.id;

/** Os `max` mais próximos dentro de `radius`. Começa com raio pequeno para não ordenar multidões inteiras. */
export function pickNear(grid: SpatialGrid, x: number, z: number, max = NEAR_MAX, radius = NEAR_RADIUS): number[] {
  let hits: Hit[] = [];
  for (const r of [radius / 4, radius / 2, radius]) {
    hits = grid.query(x, z, r, []);
    if (hits.length >= max) break;
  }
  return hits.sort(byDistance).slice(0, max).map((h) => h.id);
}

export function pickFar(
  grid: SpatialGrid, x: number, z: number, exclude: ReadonlySet<number>, max = FAR_MAX, radius = FAR_RADIUS,
): number[] {
  return grid.query(x, z, radius, [])
    .filter((h) => !exclude.has(h.id))
    .sort(byDistance)
    .slice(0, max)
    .map((h) => h.id);
}
