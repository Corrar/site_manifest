import { describe, expect, it } from 'vitest';
import { RUN_SPEED, TICK_DT } from '../../shared/constants.ts';
import { Predictor } from './predict.ts';

const start = { x: 0, z: 0, yaw: 0, anim: 0 };
const right = { dx: 1, dz: 0, run: true };
const step = RUN_SPEED * TICK_DT;

describe('Predictor', () => {
  it('aplica o input na hora e numera em sequência', () => {
    const p = new Predictor(start, null, 0);
    expect(p.apply(right).seq).toBe(1);
    expect(p.apply(right).seq).toBe(2);
    expect(p.state.x).toBeCloseTo(2 * step);
  });
  it('reconcilia reaplicando só os inputs não confirmados', () => {
    const p = new Predictor(start, null, 0);
    for (let i = 0; i < 5; i++) p.apply(right);
    // servidor confirmou o seq 2, mas colocou o jogador 0,1 m mais ao sul
    p.reconcile({ x: 2 * step, z: 0.1 }, 2);
    expect(p.state.x).toBeCloseTo(5 * step);
    expect(p.state.z).toBeCloseTo(0.1);
  });
  it('funciona na virada do seq', () => {
    const p = new Predictor(start, null, 65534);
    expect([p.apply(right).seq, p.apply(right).seq, p.apply(right).seq]).toEqual([65535, 0, 1]);
    p.reconcile({ x: step, z: 0 }, 65535);
    expect(p.state.x).toBeCloseTo(3 * step);
  });
  it('erro pequeno é suavizado; erro grande salta direto', () => {
    const p = new Predictor(start, null, 0);
    p.apply(right);
    p.reconcile({ x: step + 0.5, z: 0 }, 1); // 0,5 m de erro
    expect(p.render(0).x).toBeCloseTo(step); // ainda desenha onde estava
    expect(p.render(500).x).toBeCloseTo(step + 0.5, 2); // converge
    p.reconcile({ x: 50, z: 0 }, 1); // 50 m de erro: salta
    expect(p.render(0).x).toBeCloseTo(50);
  });
});
