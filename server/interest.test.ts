import { describe, expect, it } from 'vitest';
import { pickFar, pickNear, SpatialGrid, type Hit } from './interest.ts';

describe('SpatialGrid', () => {
  it('move entre células e remove', () => {
    const g = new SpatialGrid(16);
    g.set(1, 0, 0);
    g.set(1, 100, 100);
    expect(g.query(0, 0, 5, [])).toEqual([]);
    expect(g.query(100, 100, 5, []).map((h: Hit) => h.id)).toEqual([1]);
    g.delete(1);
    expect(g.query(100, 100, 5, [])).toEqual([]);
    expect(g.size).toBe(0);
  });
  it('query respeita o raio exato, inclusive com coordenadas negativas', () => {
    const g = new SpatialGrid(16);
    g.set(1, -3, -4); // distância 5
    g.set(2, -3.1, -4);
    expect(g.query(0, 0, 5, []).map((h) => h.id)).toEqual([1]);
  });
});

describe('pickNear', () => {
  it('ordena por distância e limita a quantidade', () => {
    const g = new SpatialGrid(16);
    for (let i = 1; i <= 10; i++) g.set(i, i, 0);
    expect(pickNear(g, 0, 0, 3, 40)).toEqual([1, 2, 3]);
  });
  it('numa multidão densa pega os mais próximos de verdade', () => {
    const g = new SpatialGrid(16);
    for (let i = 1; i <= 200; i++) g.set(i, Math.cos(i) * 4, Math.sin(i) * 4); // todos a 4 m
    g.set(999, 0.5, 0); // o mais próximo de todos
    g.set(1000, 30, 0);
    const near = pickNear(g, 0, 0, 64, 40);
    expect(near.length).toBe(64);
    expect(near[0]).toBe(999);
    expect(near).not.toContain(1000);
  });
});

describe('pickFar', () => {
  it('exclui os de perto, respeita o raio, ordena e limita', () => {
    const g = new SpatialGrid(16);
    g.set(1, 1, 0);
    g.set(2, 50, 0);
    g.set(3, 100, 0);
    g.set(4, 400, 0);
    expect(pickFar(g, 0, 0, new Set([1]), 10, 300)).toEqual([2, 3]);
    expect(pickFar(g, 0, 0, new Set(), 1, 300)).toEqual([1]);
  });
});
