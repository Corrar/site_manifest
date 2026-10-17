import { project } from '../shared/geo.ts';
import type { Pt } from '../shared/geometry.ts';
import { LANDMARKS } from '../shared/landmarks.ts';
import type { Area, AreaKind, Building, FacadeMaterial, MapData, Road } from '../shared/map.ts';

/** Da Rodoviária do Plano Piloto à Praça dos Três Poderes. */
export const BBOX = { south: -15.806, west: -47.884, north: -15.79, east: -47.858 } as const;

type LatLon = { lat: number; lon: number };
export type OsmNode = { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> };
export type OsmWay = { type: 'way'; id: number; tags?: Record<string, string>; geometry?: LatLon[] };
/** Relação com `out geom`: cada membro `way` traz a própria geometria. */
export type OsmRelation = {
  type: 'relation'; id: number; tags?: Record<string, string>;
  members?: { type: string; ref: number; role: string; geometry?: LatLon[] }[];
};
export type OsmElement = OsmNode | OsmWay | OsmRelation;
export type OverpassResult = { elements: OsmElement[] };

/**
 * Consulta do Overpass. Pede geometria (`out geom`) porque o conversor não resolve referências a nós.
 * Pode ser colada no overpass-turbo.eu: Exportar → dados brutos (raw data) → JSON, e passada a `npm run map -- --from`.
 */
export function overpassQuery(b = BBOX): string {
  const box = `(${b.south},${b.west},${b.north},${b.east})`;
  const ways = [
    '"building"', '"highway"', '"natural"="water"', '"natural"="wood"', '"natural"="tree_row"', '"natural"="scrub"',
    '"landuse"~"^(grass|forest|meadow|village_green|recreation_ground|cemetery)$"',
    '"leisure"~"^(park|garden|pitch|playground)$"', '"amenity"="parking"', '"place"="square"',
  ];
  const relations = ['"natural"="water"', '"natural"="wood"', '"landuse"~"^(grass|forest|meadow)$"', '"leisure"~"^(park|garden)$"'];
  return `[out:json][timeout:120];(${ways.map((w) => `way[${w}]${box};`).join('')}`
    + `${relations.map((r) => `relation[${r}]${box};`).join('')}node["natural"="tree"]${box};);out geom;`;
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

/** Cores com nome comuns no OSM; o resto só passa se for hexadecimal. */
const COLOR_NAMES: Record<string, string> = {
  white: '#f2f0ea', black: '#2b2b2b', grey: '#9a9a9a', gray: '#9a9a9a', silver: '#c7c9cc', red: '#b4432f', brown: '#7a5538',
  beige: '#dccfb4', cream: '#efe6cf', yellow: '#e0c04c', orange: '#d98b3a', green: '#6f8f5a', blue: '#5f86b5', tan: '#cdb68d',
};

export function buildingColor(tags: Record<string, string>): string | undefined {
  const raw = (tags['building:colour'] ?? tags['building:color'] ?? '').trim().toLowerCase();
  if (!raw) return undefined;
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  return COLOR_NAMES[raw];
}

export function buildingMaterial(tags: Record<string, string>): FacadeMaterial | undefined {
  const m = (tags['building:material'] ?? tags['building:facade:material'] ?? tags['building:cladding'] ?? '').toLowerCase();
  if (/glass|mirror/.test(m)) return 'glass';
  if (/brick|tile/.test(m)) return 'brick';
  if (/concrete|stone|plaster|cement|marble/.test(m)) return 'concrete';
  if (/metal|steel|panel/.test(m)) return 'windows';
  return undefined;
}

export function areaKind(tags: Record<string, string>): AreaKind | null {
  if (tags.natural === 'water' || tags.water) return 'water';
  if (tags.natural === 'wood' || tags.landuse === 'forest') return 'wood';
  if (tags.amenity === 'parking' || tags.place === 'square' || (tags.highway === 'pedestrian' && tags.area === 'yes')) return 'paved';
  if (['grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery'].includes(tags.landuse ?? '')) return 'grass';
  if (['park', 'garden', 'pitch', 'playground'].includes(tags.leisure ?? '')) return 'grass';
  if (tags.natural === 'scrub') return 'grass';
  return null;
}

function ring(geometry: LatLon[]): Pt[] {
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

const same = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon;

/** Junta os membros `outer` de uma relação em anéis fechados, encadeando pelas pontas. */
export function outerRings(rel: OsmRelation): LatLon[][] {
  const open = (rel.members ?? [])
    .filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '') && m.geometry && m.geometry.length >= 2)
    .map((m) => [...m.geometry!]);
  const rings: LatLon[][] = [];
  while (open.length) {
    const cur = open.shift()!;
    let grew = true;
    while (grew && !same(cur[0], cur[cur.length - 1])) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i];
        const tail = cur[cur.length - 1];
        if (same(w[0], tail)) cur.push(...w.slice(1));
        else if (same(w[w.length - 1], tail)) cur.push(...w.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length >= 4) rings.push(cur);
  }
  return rings;
}

/** Pontos a cada `step` metros ao longo de uma linha (para fileiras de árvores). */
export function sampleAlong(line: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  let carry = step / 2;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    for (let d = carry; d <= len; d += step) {
      const t = d / len;
      out.push([Math.round((ax + (bx - ax) * t) * 100) / 100, Math.round((az + (bz - az) * t) * 100) / 100]);
      carry = d + step - len;
    }
    if (carry > len) carry -= len;
  }
  return out;
}

export function toMapData(osm: OverpassResult, b = BBOX): MapData {
  const [minX, maxZ] = project(b.south, b.west);
  const [maxX, minZ] = project(b.north, b.east);
  const roads: Road[] = [];
  const buildings: Building[] = [];
  const areas: Area[] = [];
  const trees: Pt[] = [];
  const inLandmark = ([cx, cz]: Pt) => LANDMARKS.some((l) => Math.hypot(cx - l.center[0], cz - l.center[1]) < l.clearRadius);
  const pushArea = (outline: Pt[], kind: AreaKind) => {
    if (outline.length >= 3) areas.push({ outline, kind });
  };
  for (const el of osm.elements) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (t.natural === 'tree') trees.push(project(el.lat, el.lon));
      continue;
    }
    if (el.type === 'relation') {
      const kind = areaKind(t);
      if (kind) for (const r of outerRings(el)) pushArea(ring(r), kind);
      continue;
    }
    if (!el.geometry || el.geometry.length < 2) continue;
    if (t.building) {
      const outline = ring(el.geometry);
      if (outline.length < 3 || inLandmark(centroid(outline))) continue;
      const bd: Building = { outline, height: Math.round(buildingHeight(t) * 10) / 10 };
      const color = buildingColor(t);
      const material = buildingMaterial(t);
      if (color) bd.color = color;
      if (material) bd.material = material;
      buildings.push(bd);
    } else if (t.natural === 'tree_row') {
      trees.push(...sampleAlong(el.geometry.map((g) => project(g.lat, g.lon)), 8));
    } else if (t.highway && t.area !== 'yes') {
      roads.push({ line: el.geometry.map((g) => project(g.lat, g.lon)), width: roadWidth(t) });
    } else {
      const kind = areaKind(t);
      if (kind) pushArea(ring(el.geometry), kind);
    }
  }
  // Água e mata por cima do gramado no desenho: deixa as áreas pequenas por último.
  areas.sort((p, q) => Math.abs(signedArea(q.outline)) - Math.abs(signedArea(p.outline)));
  const map: MapData = { version: 1, bounds: { minX, maxX, minZ, maxZ }, roads, buildings, areas, solids: LANDMARKS.map((l) => l.footprint) };
  if (trees.length) map.trees = trees.filter((p) => !inLandmark(p));
  return map;
}

function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}
