import { describe, expect, it } from 'vitest';
import { ORIGIN, project } from './geo.ts';
import teams from './teams.json' with { type: 'json' };

describe('project', () => {
  it('leva a origem para (0, 0)', () => {
    expect(project(ORIGIN.lat, ORIGIN.lon)).toEqual([0, 0]);
  });
  it('0,001° a leste ≈ 107 m em x', () => {
    const [x, z] = project(ORIGIN.lat, ORIGIN.lon + 0.001);
    expect(x).toBeCloseTo(107.0, 0);
    expect(z).toBe(0);
  });
  it('0,001° ao sul ≈ +111,2 m em z', () => {
    const [x, z] = project(ORIGIN.lat - 0.001, ORIGIN.lon);
    expect(x).toBe(0);
    expect(z).toBeCloseTo(111.2, 0);
  });
});

describe('teams.json', () => {
  it('tem nome e cores hexadecimais', () => {
    expect(teams.length).toBeGreaterThanOrEqual(2);
    for (const t of teams) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
