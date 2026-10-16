import { describe, expect, it } from 'vitest';
import { TICK_MS } from '../../shared/constants.ts';
import { TickClock, Track } from './interp.ts';

describe('Track', () => {
  const tr = new Track();
  tr.push({ t: 100, x: 0, z: 0, yaw: 0 });
  tr.push({ t: 200, x: 10, z: -10, yaw: 1 });

  it('interpola entre amostras', () => {
    expect(tr.sample(150)).toEqual({ x: 5, z: -5, yaw: 0.5 });
  });
  it('segura a primeira e a última amostra fora do intervalo', () => {
    expect(tr.sample(50)).toEqual({ x: 0, z: 0, yaw: 0 });
    expect(tr.sample(999)).toEqual({ x: 10, z: -10, yaw: 1 });
  });
  it('ignora amostra fora de ordem', () => {
    tr.push({ t: 150, x: 99, z: 99, yaw: 0 });
    expect(tr.sample(150)).toEqual({ x: 5, z: -5, yaw: 0.5 });
  });
  it('gira pelo menor caminho', () => {
    const t2 = new Track();
    t2.push({ t: 0, x: 0, z: 0, yaw: Math.PI * 2 - 0.1 });
    t2.push({ t: 100, x: 0, z: 0, yaw: 0.1 });
    const y = t2.sample(50)!.yaw;
    expect(Math.abs(Math.sin(y))).toBeLessThan(0.01); // passa por 0, não por π
  });
  it('vazio devolve null', () => {
    expect(new Track().sample(0)).toBeNull();
  });
});

describe('TickClock', () => {
  it('adota na hora uma latência menor e sobe devagar com latência maior', () => {
    const c = new TickClock();
    expect(c.ready).toBe(false);
    c.update(10, 1000);
    expect(c.toLocal(10)).toBe(1000);
    c.update(11, 1000 + TICK_MS - 20); // chegou mais cedo
    expect(c.toLocal(11)).toBe(1000 + TICK_MS - 20);
    c.update(12, 1000 + 2 * TICK_MS + 500); // atrasado
    expect(c.toLocal(12)).toBeLessThan(1000 + 2 * TICK_MS);
  });
});
