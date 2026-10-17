import { describe, expect, it } from 'vitest';
import { LANDMARKS } from '../shared/landmarks.ts';
import { Collider } from '../shared/map.ts';
import { AXIS_ANGLE, buildSchematicMap, MINISTRY_U, toWorld } from './esplanada-esquematica.ts';
import { toMapData } from './osm.ts';

describe('mapa esquemático da Esplanada', () => {
  const map = buildSchematicMap();
  const collider = Collider.fromMap(map);

  it('o eixo aponta para o Congresso', () => {
    const [x, z] = toWorld(Math.hypot(...LANDMARKS[0].center), 0);
    expect(x).toBeCloseTo(LANDMARKS[0].center[0], 1);
    expect(z).toBeCloseTo(LANDMARKS[0].center[1], 1);
    expect(AXIS_ANGLE).toBeGreaterThan(0);
  });

  it('tem prédios, vias, gramados e marcos', () => {
    expect(map.version).toBe(1);
    expect(map.buildings.length).toBeGreaterThan(36); // 16 ministérios, 16 anexos, palácios e os setores a oeste
    expect(map.roads.length).toBe(4 + 2 * MINISTRY_U.length + 2 * 9);
    expect(map.areas.filter((a) => a.kind === 'grass').length).toBe(2);
    expect(map.areas.filter((a) => a.kind === 'paved').length).toBe(1 + 2 * MINISTRY_U.length); // praça e estacionamentos
    expect(map.trees!.length).toBeGreaterThan(100);
    expect(map.solids.length).toBe(LANDMARKS.length);
    expect(map.bounds).toEqual(toMapData({ elements: [] }).bounds);
  });

  it('a origem e o gramado são livres; ministérios e palácios bloqueiam', () => {
    expect(collider.blocked(0, 0)).toBe(false);
    for (const [u, v] of [[-400, 0], [200, 100], [-1000, -50], [-500, 120]]) expect(collider.blocked(...toWorld(u, v))).toBe(false);
    expect(collider.blocked(...toWorld(-260, 220))).toBe(true);
    expect(collider.blocked(...toWorld(335, -220))).toBe(true);
    expect(collider.blocked(...toWorld(420, 215))).toBe(true);
    expect(collider.blocked(...toWorld(845, -175))).toBe(true); // Planalto
    expect(collider.blocked(...LANDMARKS[0].center)).toBe(true); // Congresso é sólido
  });

  it('tudo cabe nos limites e no int16 do protocolo (±1638)', () => {
    const b = map.bounds;
    const pts = [
      ...map.roads.flatMap((r) => r.line),
      ...map.buildings.flatMap((x) => x.outline),
      ...map.areas.flatMap((a) => a.outline),
      ...map.solids.flat(),
    ];
    for (const [x, z] of pts) {
      expect(Math.abs(x)).toBeLessThan(1638);
      expect(Math.abs(z)).toBeLessThan(1638);
      expect(x).toBeGreaterThanOrEqual(b.minX);
      expect(x).toBeLessThanOrEqual(b.maxX);
      expect(z).toBeGreaterThanOrEqual(b.minZ);
      expect(z).toBeLessThanOrEqual(b.maxZ);
      expect(Math.round(x * 100) / 100).toBe(x);
    }
  });
});
