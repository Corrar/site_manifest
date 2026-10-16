import { describe, expect, it } from 'vitest';
import { ANIM, PLAYER_RADIUS, RUN_SPEED, TICK_DT, WALK_SPEED } from './constants.ts';
import { pointInPolygon, pushOutOfPolygon, type Pt } from './geometry.ts';
import { Collider } from './map.ts';
import { stepMove, type MoveState } from './movement.ts';

const square: Pt[] = [[2, -10], [4, -10], [4, 10], [2, 10]];
const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
const start: MoveState = { x: 0, z: 0, yaw: 0, anim: ANIM.idle };

describe('geometria', () => {
  it('pointInPolygon', () => {
    expect(pointInPolygon(3, 0, square)).toBe(true);
    expect(pointInPolygon(1, 0, square)).toBe(false);
  });
  it('empurra para fora um círculo encostado por fora', () => {
    const p = pushOutOfPolygon(1.8, 0, 0.35, square)!;
    expect(p[0]).toBeCloseTo(2 - 0.35);
    expect(p[1]).toBeCloseTo(0);
  });
  it('empurra para fora um ponto dentro, pela borda mais próxima', () => {
    const p = pushOutOfPolygon(2.2, 0, 0.35, square)!;
    expect(p[0]).toBeCloseTo(2 - 0.35);
  });
  it('sem contato devolve null', () => {
    expect(pushOutOfPolygon(0, 0, 0.35, square)).toBeNull();
  });
});

describe('Collider', () => {
  const col = new Collider([square], bounds);
  it('para na parede e desliza ao longo dela', () => {
    let s = start;
    for (let i = 0; i < 60; i++) s = stepMove(s, { dx: 1, dz: 1, run: true }, col);
    expect(s.x).toBeLessThanOrEqual(2 - PLAYER_RADIUS + 1e-6);
    expect(s.z).toBeGreaterThan(5);
  });
  it('não sai dos limites do mapa', () => {
    let s = start;
    for (let i = 0; i < 1000; i++) s = stepMove(s, { dx: -1, dz: 0, run: true }, col);
    expect(s.x).toBeCloseTo(bounds.minX + PLAYER_RADIUS);
  });
  it('blocked indica pontos dentro de prédios', () => {
    expect(col.blocked(3, 0)).toBe(true);
    expect(col.blocked(0, 0)).toBe(false);
  });
});

describe('stepMove', () => {
  it('anda e corre com a velocidade da constante', () => {
    expect(stepMove(start, { dx: 1, dz: 0, run: false }, null).x).toBeCloseTo(WALK_SPEED * TICK_DT);
    expect(stepMove(start, { dx: 0, dz: 1, run: true }, null).z).toBeCloseTo(RUN_SPEED * TICK_DT);
  });
  it('normaliza diagonais e define direção e animação', () => {
    const s = stepMove(start, { dx: 1, dz: 1, run: false }, null);
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(WALK_SPEED * TICK_DT);
    expect(s.yaw).toBeCloseTo(Math.PI / 4);
    expect(s.anim).toBe(ANIM.walk);
  });
  it('input zerado mantém posição e direção, animação parado', () => {
    const s = stepMove({ x: 1, z: 2, yaw: 1, anim: ANIM.run }, { dx: 0, dz: 0, run: true }, null);
    expect(s).toEqual({ x: 1, z: 2, yaw: 1, anim: ANIM.idle });
  });
});
