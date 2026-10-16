import {
  ANIM, IDLE_AFTER_TICKS, INPUT_BUDGET_MAX, INPUT_QUEUE_MAX, PLAYER_RADIUS, RESUME_MS, SPAWN_RADIUS,
} from '../shared/constants.ts';
import type { Collider } from '../shared/map.ts';
import { stepMove, type MoveInput } from '../shared/movement.ts';
import { IdAllocator } from './ids.ts';
import { SpatialGrid } from './interest.ts';

export type PlayerIdentity = { userId: string; nick: string; team: number; look: number };
export type QueuedInput = MoveInput & { seq: number };
export type Player = PlayerIdentity & {
  id: number;
  x: number;
  z: number;
  yaw: number;
  anim: number;
  queue: QueuedInput[];
  budget: number;
  lastSeq: number;
  idleTicks: number;
  token: string;
  connected: boolean;
  leftAt: number;
};

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class World {
  readonly players = new Map<number, Player>();
  readonly grid = new SpatialGrid();
  tick = 0;
  private readonly ids = new IdAllocator();
  private readonly byUser = new Map<string, Player>();
  private readonly collider: Collider | null;
  private readonly random: () => number;

  constructor(collider: Collider | null, random: () => number = Math.random) {
    this.collider = collider;
    this.random = random;
  }

  /** Personagem da conta (retomada ou outra aba) ou um novo. null se acabaram os ids. */
  join(who: PlayerIdentity, now: number): Player | null {
    const existing = this.byUser.get(who.userId);
    if (existing) {
      Object.assign(existing, { nick: who.nick, team: who.team, look: who.look, connected: true });
      return existing;
    }
    const id = this.ids.alloc(now);
    if (id === null) return null;
    const [x, z] = this.spawnPoint();
    const p: Player = {
      ...who, id, x, z, yaw: 0, anim: ANIM.idle,
      queue: [], budget: INPUT_BUDGET_MAX, lastSeq: 0, idleTicks: 0,
      token: randomToken(), connected: true, leftAt: 0,
    };
    this.players.set(id, p);
    this.byUser.set(who.userId, p);
    this.grid.set(id, x, z);
    return p;
  }

  /** Conexão caiu: o personagem fica parado no lugar por RESUME_MS. */
  leave(p: Player, now: number): void {
    p.connected = false;
    p.leftAt = now;
    p.queue.length = 0;
    p.anim = ANIM.idle;
  }

  queueInput(p: Player, input: QueuedInput): void {
    if (p.queue.length >= INPUT_QUEUE_MAX) p.queue.shift();
    p.queue.push(input);
  }

  step(now: number): void {
    this.tick++;
    for (const p of this.players.values()) {
      if (!p.connected) {
        if (now - p.leftAt > RESUME_MS) this.remove(p, now);
        continue;
      }
      // Orçamento de inputs: recarga de 1 por tick, máx. INPUT_BUDGET_MAX. Impede andar mais rápido mandando mais inputs.
      p.budget = Math.min(INPUT_BUDGET_MAX, p.budget + 1);
      let moved = false;
      while (p.budget > 0 && p.queue.length > 0) {
        const input = p.queue.shift()!;
        p.budget--;
        const s = stepMove(p, input, this.collider);
        p.x = s.x;
        p.z = s.z;
        p.yaw = s.yaw;
        p.anim = s.anim;
        p.lastSeq = input.seq;
        moved = true;
      }
      if (moved) p.idleTicks = 0;
      else if (++p.idleTicks >= IDLE_AFTER_TICKS) p.anim = ANIM.idle;
      this.grid.set(p.id, p.x, p.z);
    }
  }

  connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  teamCounts(teams: number): number[] {
    const counts = new Array<number>(teams).fill(0);
    for (const p of this.players.values()) if (p.connected && p.team < teams) counts[p.team]++;
    return counts;
  }

  private remove(p: Player, now: number): void {
    this.players.delete(p.id);
    this.byUser.delete(p.userId);
    this.grid.delete(p.id);
    this.ids.release(p.id, now);
  }

  private spawnPoint(): [number, number] {
    for (let i = 0; i < 20; i++) {
      const a = this.random() * Math.PI * 2;
      const r = Math.sqrt(this.random()) * SPAWN_RADIUS;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!this.collider) return [x, z];
      if (!this.collider.blocked(x, z)) return this.collider.resolve(x, z, PLAYER_RADIUS);
    }
    return [0, 0];
  }
}
