export type Pt = [number, number];

export function pointInPolygon(x: number, z: number, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function closestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): Pt {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return [ax + t * dx, az + t * dz];
}

/** Empurra o círculo (x, z, r) para fora do polígono. null se não há contato. */
export function pushOutOfPolygon(x: number, z: number, r: number, poly: readonly Pt[]): Pt | null {
  let best = Infinity;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [qx, qz] = closestOnSegment(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    const d2 = (qx - x) ** 2 + (qz - z) ** 2;
    if (d2 < best) {
      best = d2;
      cx = qx;
      cz = qz;
    }
  }
  const d = Math.sqrt(best);
  const inside = pointInPolygon(x, z, poly);
  if (!inside && d >= r) return null;
  if (d < 1e-9) return [cx + r, cz]; // exatamente sobre a borda: direção indefinida
  const s = inside ? -1 : 1; // por dentro, a normal (p - c) aponta para dentro
  return [cx + ((x - cx) / d) * s * r, cz + ((z - cz) / d) * s * r];
}
