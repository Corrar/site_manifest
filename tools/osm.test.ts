import { describe, expect, it } from 'vitest';
import { ORIGIN } from '../shared/geo.ts';
import { LANDMARKS } from '../shared/landmarks.ts';
import { buildingHeight, overpassQuery, roadWidth, toMapData, type OsmWay } from './osm.ts';

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
  it('a consulta pede geometria', () => {
    expect(overpassQuery()).toContain('out geom;');
  });
});

describe('toMapData', () => {
  const elements: OsmWay[] = [
    { type: 'way', id: 1, tags: { building: 'yes', 'building:levels': '10' }, geometry: square(ORIGIN.lat + 0.001, ORIGIN.lon) },
    { type: 'way', id: 2, tags: { building: 'yes' }, geometry: square(-15.7981, -47.8753, 0.00005) }, // dentro da Catedral
    { type: 'way', id: 3, tags: { highway: 'trunk', lanes: '3' }, geometry: [{ lat: -15.8, lon: -47.87 }, { lat: -15.8, lon: -47.86 }] },
    { type: 'way', id: 4, tags: { natural: 'water' }, geometry: square(-15.801, -47.865) },
    { type: 'way', id: 5, tags: { leisure: 'park' }, geometry: square(-15.797, -47.872) },
    { type: 'way', id: 6, tags: { building: 'yes' } }, // sem geometria
  ];
  const map = toMapData({ elements });

  it('converte prédios, vias e áreas; remove prédios dentro dos marcos', () => {
    expect(map.buildings.length).toBe(1);
    expect(map.buildings[0].outline.length).toBe(4); // ponto repetido de fechamento removido
    expect(map.buildings[0].height).toBe(32);
    expect(map.roads).toEqual([expect.objectContaining({ width: 10.5 })]);
    expect(map.areas.map((a) => a.kind).sort()).toEqual(['grass', 'water']);
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
