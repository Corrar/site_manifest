import {
  FAR_HZ, LOBBY_STATS_MS, MAX_INVALID_STREAK, MAX_MSGS_PER_SEC, MAX_PLAYERS, PROTOCOL_VERSION, TICK_HZ, TIMEOUT_MS,
} from '../shared/constants.ts';
import {
  encodeFar, encodeNear, packAnim, parseClientMessage,
  type Account, type ErrorCode, type FarActor, type NearActor, type Person, type ServerMessage,
} from '../shared/protocol.ts';
import type { VerifyToken } from './auth.ts';
import type { Chat } from './chat.ts';
import { pickFar, pickNear } from './interest.ts';
import { RateLimiter } from './rate-limit.ts';
import type { Profile, ProfileStore } from './profiles.ts';
import type { Player, World } from './world.ts';

export interface Conn {
  send(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
  bufferedAmount(): number;
}

type State = 'lobby' | 'joining' | 'player' | 'spectator';

export type Client = {
  conn: Conn;
  state: State;
  player: Player | null;
  account: Account | null;
  viewX: number;
  viewZ: number;
  limiter: RateLimiter;
  invalid: number;
  lastSeen: number;
  known: Map<number, Player>; // id → objeto cujo nome já foi enviado
  phase: number; // espalha os snapshots LONGE entre os ticks
  closed: boolean;
};

export type HubOptions = {
  world: World;
  chat: Chat;
  verify: VerifyToken;
  profiles: ProfileStore;
  teams: number;
  maxPlayers?: number;
};

const ERRORS: Record<ErrorCode, string> = {
  auth_required: 'Faça login para jogar.',
  auth_invalid: 'Sua sessão expirou. Entre de novo.',
  banned: 'Sua conta está suspensa.',
  no_profile: 'Complete seu cadastro para jogar.',
  unavailable: 'Serviço indisponível. Tente de novo em instantes.',
  rate_limited: 'Calma! Espere um pouco antes de mandar outra mensagem.',
  chat_blocked: 'Mensagem bloqueada pelo filtro.',
  not_allowed: 'Ação não permitida.',
};
const BACKPRESSURE_BYTES = 256 * 1024;
const FAR_EVERY = TICK_HZ / FAR_HZ;
const KNOWN_MAX = 5000;

export class Hub {
  readonly clients = new Set<Client>();
  private readonly world: World;
  private readonly chatRoom: Chat;
  private readonly verify: VerifyToken;
  private readonly profiles: ProfileStore;
  private readonly teams: number;
  private readonly maxPlayers: number;
  private readonly owner = new Map<number, Client>(); // id do jogador → conexão que controla
  private lastStats = -Infinity;

  constructor(o: HubOptions) {
    this.world = o.world;
    this.chatRoom = o.chat;
    this.verify = o.verify;
    this.profiles = o.profiles;
    this.teams = o.teams;
    this.maxPlayers = o.maxPlayers ?? MAX_PLAYERS;
  }

  open(conn: Conn, now: number): Client {
    const c: Client = {
      conn, state: 'lobby', player: null, account: null, viewX: 0, viewZ: 0,
      limiter: new RateLimiter(MAX_MSGS_PER_SEC, MAX_MSGS_PER_SEC, now),
      invalid: 0, lastSeen: now, known: new Map(), phase: Math.floor(Math.random() * FAR_EVERY), closed: false,
    };
    this.clients.add(c);
    return c;
  }

  async message(c: Client, raw: string | null, now: number): Promise<void> {
    if (c.closed) return;
    c.lastSeen = now;
    if (!c.limiter.take(now)) return this.kick(c, 4002, 'Muitas mensagens');
    const m = raw === null ? null : parseClientMessage(raw);
    if (!m) {
      if (++c.invalid >= MAX_INVALID_STREAK) this.kick(c, 4003, 'Mensagens inválidas');
      return;
    }
    c.invalid = 0;
    switch (m.t) {
      case 'lobby':
        if (c.state === 'lobby') this.send(c, this.stats());
        return;
      case 'join':
        return this.join(c, m.auth, m.spectate, now);
      case 'input':
        if (c.state === 'player' && c.player) {
          this.world.queueInput(c.player, { dx: m.dx, dz: m.dz, run: m.run, seq: m.seq, emote: m.emote });
        }
        return;
      case 'view':
        if (c.state === 'spectator') {
          c.viewX = m.x;
          c.viewZ = m.z;
        }
        return;
      case 'chat':
        return this.chat(c, m.text, now);
      case 'vehicle':
        if (c.state === 'player' && c.player) this.world.setVehicle(c.player, m.kind);
        return;
      case 'ping':
        return this.send(c, { t: 'pong', at: m.at, now });
    }
  }

  close(c: Client, now: number): void {
    if (!this.clients.delete(c)) return;
    c.closed = true;
    const p = c.player;
    if (p && this.owner.get(p.id) === c) {
      this.owner.delete(p.id);
      this.world.leave(p, now);
    }
    c.player = null;
  }

  tick(now: number): void {
    this.world.step(now);
    for (const c of this.clients) {
      if (c.closed) continue;
      if (now - c.lastSeen > TIMEOUT_MS) {
        this.kick(c, 4000, 'Tempo esgotado');
        continue;
      }
      if (c.state === 'player' || c.state === 'spectator') this.sendSnapshots(c);
    }
    if (now - this.lastStats >= LOBBY_STATS_MS) {
      this.lastStats = now;
      const msg = JSON.stringify(this.stats());
      for (const c of this.clients) if (c.state === 'lobby' && !c.closed) c.conn.send(msg);
    }
  }

  stats(): ServerMessage {
    return { t: 'stats', online: this.world.connectedCount(), teams: this.world.teamCounts(this.teams) };
  }

  shutdown(): void {
    const msg = JSON.stringify({ t: 'restarting' });
    for (const c of this.clients) {
      if (c.closed) continue;
      c.conn.send(msg);
      this.kick(c, 1012, 'Reiniciando');
    }
  }

  private async join(c: Client, auth: string | null, spectate: boolean, now: number): Promise<void> {
    if (c.state !== 'lobby') return;
    c.state = 'joining';
    let profile: Profile | null = null;
    if (auth) {
      try {
        const who = await this.verify(auth);
        if (!who) return this.fail(c, 'auth_invalid');
        profile = await this.profiles.get(who.userId);
      } catch (err) {
        console.error('join:', err);
        return this.fail(c, 'unavailable');
      }
      if (!profile) return this.fail(c, 'no_profile');
      if (profile.bannedUntil !== null && profile.bannedUntil > now) return this.fail(c, 'banned');
      if (profile.team >= this.teams) return this.fail(c, 'no_profile');
    } else if (!spectate) {
      return this.fail(c, 'auth_required');
    }
    if (c.closed) return;

    const wantsToPlay = profile !== null && !spectate;
    let player: Player | null = null;
    if (wantsToPlay && this.world.connectedCount() < this.maxPlayers) player = this.world.join(profile!, now);
    if (player) {
      const other = this.owner.get(player.id);
      if (other && other !== c) {
        other.player = null;
        this.kick(other, 4001, 'Conectado em outra aba');
      }
      this.owner.set(player.id, c);
      c.player = player;
      c.state = 'player';
    } else {
      c.state = 'spectator';
    }
    c.account = profile && { nick: profile.nick, team: profile.team, look: profile.look };
    this.send(c, {
      t: 'welcome', v: PROTOCOL_VERSION, id: player?.id ?? 0, token: player?.token ?? '', serverTime: now,
      spectator: !player, history: this.chatRoom.recent(), full: wantsToPlay && !player, account: c.account,
    });
  }

  private chat(c: Client, text: string, now: number): void {
    const p = c.player;
    if (c.state !== 'player' || !p) return this.error(c, 'not_allowed');
    const r = this.chatRoom.post({ id: p.id, nick: p.nick, team: p.team }, text, now);
    if (!r) return;
    if (!r.ok) return this.error(c, r.code);
    const msg = JSON.stringify({ t: 'chat', ...r.entry });
    for (const o of this.clients) if (!o.closed && (o.state === 'player' || o.state === 'spectator')) o.conn.send(msg);
  }

  private sendSnapshots(c: Client): void {
    if (c.conn.bufferedAmount() > BACKPRESSURE_BYTES) return; // cliente atrasado: pula este tick
    const x = c.player ? c.player.x : c.viewX;
    const z = c.player ? c.player.z : c.viewZ;
    const nearIds = pickNear(this.world.grid, x, z);
    const near: NearActor[] = [];
    const fresh: Person[] = [];
    if (c.known.size > KNOWN_MAX) c.known.clear();
    for (const id of nearIds) {
      const p = this.world.players.get(id);
      if (!p) continue;
      near.push({ id, x: p.x, z: p.z, yaw: p.yaw, anim: packAnim(p.anim, p.vehicle), team: p.team, look: p.look });
      if (c.known.get(id) !== p) {
        c.known.set(id, p);
        fresh.push({ id, nick: p.nick, team: p.team, look: p.look });
      }
    }
    if (fresh.length) this.send(c, { t: 'names', people: fresh });
    const tick = this.world.tick;
    c.conn.send(encodeNear(tick, c.player?.lastSeq ?? 0, near));
    if ((tick + c.phase) % FAR_EVERY !== 0) return;
    const far: FarActor[] = [];
    for (const id of pickFar(this.world.grid, x, z, new Set(nearIds))) {
      const p = this.world.players.get(id);
      if (p) far.push({ id, x: p.x, z: p.z, team: p.team });
    }
    c.conn.send(encodeFar(tick, far));
  }

  private send(c: Client, m: ServerMessage): void {
    if (!c.closed) c.conn.send(JSON.stringify(m));
  }

  private error(c: Client, code: ErrorCode): void {
    this.send(c, { t: 'error', code, message: ERRORS[code] });
  }

  private fail(c: Client, code: ErrorCode): void {
    c.state = 'lobby';
    this.error(c, code);
  }

  private kick(c: Client, code: number, reason: string): void {
    if (c.closed) return;
    c.closed = true;
    c.conn.close(code, reason);
  }
}
