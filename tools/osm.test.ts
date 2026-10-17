import { describe, expect, it } from 'vitest';
import { ORIGIN } from '../shared/geo.ts';
import { LANDMARKS } from '../shared/landmarks.ts';
import {
  areaKind, buildingColor, buildingHeight, buildingMaterial, outerRings, overpassQuery, roadWidth, sampleAlong, toMapData,
  type OsmElement, type OsmRelation,
} from './osm.ts';

const square = (lat: number, lon: number, d = 0.0001) => [
  { lat, lon }, { lat, lon: lon + d }, { lat: lat + d, lon: lon + d }, { lat: lat + d, lon }, { lat, lon },
];

describe('tags', () => {
  it('altura do prédio', () => {
    expect(buildingHeight({ height: '45 m' })).toBe(45);
    expect(buildingHeight({ 'building:levels': '10' })).toBeCloseTo(32);
    expect(buildingHeight({})).toBe(12);
  });
  it('largura da via', () => {
    expect(roadWidth({ highway: 'primary', width: '8' })).toBe(8);
    expect(roadWidth({ highway: 'primary', lanes: '3' })).toBeCloseTo(10.5);
    expect(roadWidth({ highway: 'trunk_link' })).toBe(10.5);
    expect(roadWidth({ highway: 'footway' })).toBe(2.5);
    expect(roadWidth({ highway: 'desconhecida' })).toBe(5);
  });
  it('a consulta pede geometria, árvores e relações', () => {
    const q = overpassQuery();
    expect(q).toContain('out geom;');
    expect(q).toContain('node["natural"="tree"]');
    expect(q).toContain('relation["leisure"~"^(park|garden)$"]');
  });
  it('cor e material da fachada', () => {
    expect(buildingColor({ 'building:colour': '#AABBCC' })).toBe('#aabbcc');
    expect(buildingColor({ 'building:colour': '#abc' })).toBe('#aabbcc');
    expect(buildingColor({ 'building:colour': 'white' })).toBe('#f2f0ea');
    expect(buildingColor({ 'building:colour': 'roxo-esquisito' })).toBeUndefined();
    expect(buildingColor({})).toBeUndefined();
    expect(buildingMaterial({ 'building:material': 'glass' })).toBe('glass');
    expect(buildingMaterial({ 'building:facade:material': 'brick' })).toBe('brick');
    expect(buildingMaterial({ 'building:material': 'concrete' })).toBe('concrete');
    expect(buildingMaterial({})).toBeUndefined();
  });
  it('tipo de área', () => {
    expect(areaKind({ amenity: 'parking' })).toBe('paved');
    expect(areaKind({ highway: 'pedestrian', area: 'yes' })).toBe('paved');
    expect(areaKind({ landuse: 'forest' })).toBe('wood');
    expect(areaKind({ leisure: 'garden' })).toBe('grass');
    expect(areaKind({ natural: 'water' })).toBe('water');
    expect(areaKind({ shop: 'bakery' })).toBeNull();
  });
  it('amostra pontos ao longo de uma linha', () => {
    const pts = sampleAlong([[0, 0], [40, 0]], 8);
    expect(pts.length).toBe(5);
    expect(pts[0]).toEqual([4, 0]);
    expect(pts[4]).toEqual([36, 0]);
  });
  it('encadeia os membros outer de uma relação num anel', () => {
    const rel: OsmRelation = { type: 'relation', id: 9, members: [
      { type: 'way', ref: 1, role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }] },
      { type: 'way', ref: 2, role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 0, lon: 1 }] }, // invertida
      { type: 'way', ref: 3, role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 0 }, { lat: 0, lon: 0 }] },
      { type: 'way', ref: 4, role: 'inner', geometry: [{ lat: 0.4, lon: 0.4 }, { lat: 0.6, lon: 0.6 }] },
    ] };
    const rings = outerRings(rel);
    expect(rings.length).toBe(1);
    expect(rings[0].map((p) => `${p.lat},${p.lon}`)).toEqual(['0,0', '0,1', '1,1', '1,0', '0,0']);
  });
});

describe('toMapData', () => {
  const elements: OsmElement[] = [
    { type: 'way', id: 1, tags: { building: 'yes', 'building:levels': '10' }, geometry: square(ORIGIN.lat + 0.001, ORIGIN.lon) },
    { type: 'way', id: 2, tags: { building: 'yes' }, geometry: square(-15.7981, -47.8753, 0.00005) }, // dentro da Catedral
    { type: 'way', id: 3, tags: { highway: 'trunk', lanes: '3' }, geometry: [{ lat: -15.8, lon: -47.87 }, { lat: -15.8, lon: -47.86 }] },
    { type: 'way', id: 4, tags: { natural: 'water' }, geometry: square(-15.801, -47.865) },
    { type: 'way', id: 5, tags: { leisure: 'park' }, geometry: square(-15.797, -47.872) },
    { type: 'way', id: 6, tags: { building: 'yes' } }, // sem geometria
    { type: 'way', id: 7, tags: { building: 'office', 'building:colour': 'beige', 'building:material': 'glass', height: '30' }, geometry: square(ORIGIN.lat + 0.002, ORIGIN.lon) },
    { type: 'way', id: 8, tags: { amenity: 'parking' }, geometry: square(-15.802, -47.866) },
    { type: 'way', id: 9, tags: { natural: 'tree_row' }, geometry: [{ lat: -15.8, lon: -47.875 }, { lat: -15.8, lon: -47.8748 }] }, // ~21 m
    { type: 'node', id: 10, lat: -15.7995, lon: -47.87, tags: { natural: 'tree' } },
    { type: 'node', id: 11, lat: -15.7981, lon: -47.8753, tags: { natural: 'tree' } }, // dentro da Catedral: fora
    { type: 'node', id: 12, lat: -15.7996, lon: -47.871, tags: { amenity: 'bench' } },
    { type: 'relation', id: 13, tags: { leisure: 'park' }, members: [
      { type: 'way', ref: 1, role: 'outer', geometry: square(-15.803, -47.87) },
    ] },
  ];
  const map = toMapData({ elements });

  it('converte prédios, vias e áreas; remove prédios dentro dos marcos', () => {
    expect(map.buildings.length).toBe(2);
    expect(map.buildings[0].outline.length).toBe(4); // ponto repetido de fechamento removido
    expect(map.buildings[0].height).toBe(32);
    expect(map.buildings[0].color).toBeUndefined();
    expect(map.buildings[1]).toMatchObject({ height: 30, color: '#dccfb4', material: 'glass' });
    expect(map.roads).toEqual([expect.objectContaining({ width: 10.5 })]);
    expect(map.areas.map((a) => a.kind).sort()).toEqual(['grass', 'grass', 'paved', 'water']);
  });
  it('árvores: nós, fileiras amostradas, e nenhuma dentro dos marcos', () => {
    expect(map.trees?.length).toBe(1 + 3);
    expect(map.trees).toContainEqual(expect.arrayContaining([expect.any(Number)]));
  });
  it('áreas maiores vêm primeiro (desenhadas por baixo)', () => {
    const sizes = map.areas.map((a) => Math.abs(a.outline.reduce((acc, [x, z], i, arr) => {
      const [nx, nz] = arr[(i + 1) % arr.length];
      return acc + x * nz - nx * z;
    }, 0)));
    expect(sizes).toEqual([...sizes].sort((p, q) => q - p));
  });
  it('limites envolvem a origem e marcos viram sólidos', () => {
    const b = map.bounds;
    expect(b.minX).toBeLessThan(0);
    expect(b.maxX).toBeGreaterThan(0);
    expect(b.minZ).toBeLessThan(0);
    expect(b.maxZ).toBeGreaterThan(0);
    expect(Math.max(-b.minX, b.maxX, -b.minZ, b.maxZ)).toBeLessThan(1638); // cabe no int16 do protocolo
    expect(map.solids.length).toBe(LANDMARKS.length);
  });
});
