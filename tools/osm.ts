import { project } from '../shared/geo.ts';
import type { Pt } from '../shared/geometry.ts';
import { LANDMARKS } from '../shared/landmarks.ts';
import type { Area, Building, MapData, Road } from '../shared/map.ts';

/** Da Rodoviária do Plano Piloto à Praça dos Três Poderes. */
export const BBOX = { south: -15.806, west: -47.884, north: -15.79, east: -47.858 } as const;

export type OsmWay = { type: 'way'; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] };
export type OverpassResult = { elements: OsmWay[] };

export function overpassQuery(b = BBOX): string {
  const box = `(${b.south},${b.west},${b.north},${b.east})`;
  return `[out:json][timeout:90];(way["building"]${box};way["highway"]${box};way["natural"="water"]${box};`
    + `way["landuse"="grass"]${box};way["leisure"="park"]${box};);out geom;`;
}

const num = (s?: string) => (s ? parseFloat(s.replace(',', '.')) : NaN);

export function buildingHeight(tags: Record<string, string>): number {
  const h = num(tags.height);
  if (h > 0) return h;
  const levels = num(tags['building:levels']);
  if (levels > 0) return levels * 3.2;
  return 12;
}

const ROAD_DEFAULT: Record<string, number> = {
  motorway: 14, trunk: 10.5, primary: 10.5, secondary: 7, tertiary: 7, residential: 6, unclassified: 6,
  service: 4, pedestrian: 4, footway: 2.5, cycleway: 2.5, path: 2, steps: 2,
};

export function roadWidth(tags: Record<string, string>): number {
  const w = num(tags.width);
  if (w > 0) return w;
  const lanes = num(tags.lanes);
  if (lanes > 0) return lanes * 3.5;
  return ROAD_DEFAULT[(tags.highway ?? '').replace(/_link$/, '')] ?? 5;
}

function ring(geometry: { lat: number; lon: number }[]): Pt[] {
  const pts = geometry.map((g) => project(g.lat, g.lon));
  const last = pts.at(-1);
  if (pts.length > 1 && last && pts[0][0] === last[0] && pts[0][1] === last[1]) pts.pop();
  return pts;
}

function centroid(pts: Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

export function toMapData(osm: OverpassResult, b = BBOX): MapData {
  const [minX, maxZ] = project(b.south, b.west);
  const [maxX, minZ] = project(b.north, b.east);
  const roads: Road[] = [];
  const buildings: Building[] = [];
  const areas: Area[] = [];
  for (const el of osm.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const t = el.tags ?? {};
    if (t.building) {
      const outline = ring(el.geometry);
      if (outline.length < 3) continue;
      const [cx, cz] = centroid(outline);
      if (LANDMARKS.some((l) => Math.hypot(cx - l.center[0], cz - l.center[1]) < l.clearRadius)) continue;
      buildings.push({ outline, height: Math.round(buildingHeight(t) * 10) / 10 });
    } else if (t.highway && t.area !== 'yes') {
      roads.push({ line: el.geometry.map((g) => project(g.lat, g.lon)), width: roadWidth(t) });
    } else if (t.natural === 'water' || t.landuse === 'grass' || t.leisure === 'park') {
      const outline = ring(el.geometry);
      if (outline.length >= 3) areas.push({ outline, kind: t.natural === 'water' ? 'water' : 'grass' });
    }
  }
  return { version: 1, bounds: { minX, maxX, minZ, maxZ }, roads, buildings, areas, solids: LANDMARKS.map((l) => l.footprint) };
}
