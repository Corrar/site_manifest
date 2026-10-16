import { describe, expect, it } from 'vitest';
import { ANIM, RESUME_MS, SPAWN_RADIUS, TICK_DT, WALK_SPEED } from '../shared/constants.ts';
import { IdAllocator } from './ids.ts';
import { World } from './world.ts';

const ana = { userId: 'u-ana', nick: 'Ana', team: 0, look: 0 };
const bia = { userId: 'u-bia', nick: 'Bia', team: 1, look: 2 };
const step = WALK_SPEED * TICK_DT;

describe('IdAllocator', () => {
  it('só reaproveita um id 60 s depois de liberado', () => {
    const ids = new IdAllocator();
    expect(ids.alloc(0)).toBe(1);
    expect(ids.alloc(0)).toBe(2);
    ids.release(1, 0);
    expect(ids.alloc(1000)).toBe(3);
    expect(ids.alloc(60_000)).toBe(1);
  });
  it('acaba em 65535', () => {
    const ids = new IdAllocator();
    for (let i = 0; i < 65535; i++) ids.alloc(0);
    expect(ids.alloc(0)).toBeNull();
  });
});

describe('World', () => {
  it('cria jogador perto da origem, com token de 22 caracteres', () => {
    const w = new World(null);
    const p = w.join(ana, 0)!;
    expect(p.id).toBe(1);
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(SPAWN_RADIUS);
    expect(p.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(w.connectedCount()).toBe(1);
  });
  it('a mesma conta recebe o mesmo personagem', () => {
    const w = new World(null);
    const p = w.join(ana, 0)!;
    w.leave(p, 1000);
    expect(w.join(ana, 2000)).toBe(p);
    expect(p.connected).toBe(true);
  });
  it('aplica um input por tick e registra o seq', () => {
    const w = new World(null);
    const p = w.join(ana, 0)!;
    const x0 = p.x;
    w.queueInput(p, { dx: 1, dz: 0, run: false, seq: 7 });
    w.step(50);
    expect(p.x).toBeCloseTo(x0 + step);
    expect(p.lastSeq).toBe(7);
    expect(p.anim).toBe(ANIM.walk);
  });
  it('limita inputs por tick (anti speed hack)', () => {
    const w = new World(null);
    const p = w.join(ana, 0)!;
    const x0 = p.x;
    for (let i = 1; i <= 10; i++) w.queueInput(p, { dx: 1, dz: 0, run: false, seq: i });
    for (let t = 1; t <= 5; t++) w.step(t * 50);
    // 3 no primeiro tick (orçamento cheio) e 1 por tick depois
    expect(p.x).toBeCloseTo(x0 + 7 * step);
    expect(p.lastSeq).toBe(7);
  });
  it('fila cheia descarta os inputs mais antigos', () => {
    const w = new World(null);
    const p = w.join(ana, 0)!;
    for (let i = 1; i <= 15; i++) w.queueInput(p, { dx: 1, dz: 0, run: false, seq: i });
    expect(p.queue.length).toBe(10);
    expect(p.queue[0].seq).toBe(6);
  });
  it('sem input por 3 ticks volta para parado', () => {
    const w = new World(null);
    const p = w.join(ana, 0)!;
    w.queueInput(p, { dx: 1, dz: 0, run: true, seq: 1 });
    w.step(50);
    expect(p.anim).toBe(ANIM.run);
    for (let t = 2; t <= 4; t++) w.step(t * 50);
    expect(p.anim).toBe(ANIM.idle);
  });
  it('remove quem saiu há mais de RESUME_MS e libera o id', () => {
    const w = new World(null);
    const p = w.join(ana, 0)!;
    w.leave(p, 0);
    w.step(RESUME_MS + 1);
    expect(w.players.size).toBe(0);
    expect(w.grid.size).toBe(0);
    expect(w.join(ana, RESUME_MS + 2)!.id).toBe(2);
  });
  it('conta jogadores conectados por time', () => {
    const w = new World(null);
    w.join(ana, 0);
    const b = w.join(bia, 0)!;
    expect(w.teamCounts(3)).toEqual([1, 1, 0]);
    w.leave(b, 0);
    expect(w.teamCounts(3)).toEqual([1, 0, 0]);
  });
});

describe('World: emotes', () => {
  it('emote parado vale até o jogador andar', () => {
    const w = new World(null);
    const p = w.join(ana, 0)!;
    w.queueInput(p, { dx: 0, dz: 0, run: false, seq: 1, emote: ANIM.dance });
    w.step(50);
    expect(p.anim).toBe(ANIM.dance);
    for (let t = 2; t <= 5; t++) w.step(t * 50);
    expect(p.anim).toBe(ANIM.dance);
    w.queueInput(p, { dx: 1, dz: 0, run: false, seq: 2 });
    w.step(300);
    expect(p.anim).toBe(ANIM.walk);
    for (let t = 7; t <= 10; t++) w.step(t * 50);
    expect(p.anim).toBe(ANIM.idle);
  });
});
