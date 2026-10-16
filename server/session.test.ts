import { describe, expect, it } from 'vitest';
import { LOBBY_STATS_MS, MAX_INVALID_STREAK, MAX_MSGS_PER_SEC, TIMEOUT_MS } from '../shared/constants.ts';
import { decodeSnapshot, FAR_TYPE, NEAR_TYPE, type NearSnapshot } from '../shared/protocol.ts';
import { createDevVerifier, type VerifyToken } from './auth.ts';
import { Chat } from './chat.ts';
import { MemoryProfileStore } from './profiles.ts';
import { Hub, type Conn } from './session.ts';
import { World } from './world.ts';

class FakeConn implements Conn {
  texts: any[] = [];
  bins: Uint8Array[] = [];
  closed: [number, string] | null = null;
  send(d: string | Uint8Array) {
    if (typeof d === 'string') this.texts.push(JSON.parse(d));
    else this.bins.push(d);
  }
  close(code: number, reason: string) {
    this.closed = [code, reason];
  }
  bufferedAmount() {
    return 0;
  }
  last(t: string) {
    return this.texts.filter((m) => m.t === t).at(-1);
  }
  lastNear(): NearSnapshot {
    const s = this.bins.map((b) => decodeSnapshot(b)).filter((x) => x?.type === NEAR_TYPE).at(-1);
    return s as NearSnapshot;
  }
}

function setup(opts: { maxPlayers?: number; verify?: VerifyToken } = {}) {
  const store = new MemoryProfileStore();
  const world = new World(null, () => 0.5);
  const hub = new Hub({
    world, chat: new Chat(), profiles: store, teams: 3, maxPlayers: opts.maxPlayers,
    verify: opts.verify ?? createDevVerifier(store),
  });
  const connect = (now = 0) => {
    const conn = new FakeConn();
    return { conn, client: hub.open(conn, now) };
  };
  const msg = (c: ReturnType<typeof connect>, m: object, now = 0) => hub.message(c.client, JSON.stringify(m), now);
  return { hub, world, store, connect, msg };
}

describe('Hub: lobby e join', () => {
  it('manda stats ao pedir lobby e periodicamente', async () => {
    const { hub, connect, msg } = setup();
    const a = connect();
    await msg(a, { t: 'lobby' });
    expect(a.conn.last('stats')).toEqual({ t: 'stats', online: 0, teams: [0, 0, 0] });
    a.conn.texts = [];
    hub.tick(LOBBY_STATS_MS);
    expect(a.conn.last('stats')).toBeTruthy();
  });

  it('espectador sem login é aceito', async () => {
    const { connect, msg } = setup();
    const a = connect();
    await msg(a, { t: 'join', spectate: true });
    expect(a.conn.last('welcome')).toMatchObject({ spectator: true, account: null, id: 0, full: false });
  });

  it('jogar sem login dá auth_required e volta ao lobby', async () => {
    const { connect, msg } = setup();
    const a = connect();
    await msg(a, { t: 'join', spectate: false });
    expect(a.conn.last('error').code).toBe('auth_required');
    expect(a.client.state).toBe('lobby');
  });

  it('jogador logado recebe welcome com a conta, snapshot com ele mesmo e o próprio nome', async () => {
    const { hub, connect, msg } = setup();
    const a = connect();
    await msg(a, { t: 'join', auth: 'dev:Ana:1' });
    const w = a.conn.last('welcome');
    expect(w).toMatchObject({ spectator: false, id: 1, account: { nick: 'Ana', team: 1, look: 0 }, full: false });
    expect(w.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    hub.tick(50);
    expect(a.conn.lastNear().actors.map((x) => x.id)).toEqual([1]);
    expect(a.conn.last('names').people).toEqual([{ id: 1, nick: 'Ana', team: 1, look: 0 }]);
  });

  it('recusa token inválido, sem perfil, banido e time inexistente', async () => {
    const verify: VerifyToken = async (t) => (t === 'ruim' ? null : { userId: t });
    const { store, connect, msg } = setup({ verify });
    store.put({ userId: 'ban', nick: 'Ban', team: 0, look: 0, bannedUntil: Date.now() + 60_000 });
    store.put({ userId: 'time9', nick: 'Nove', team: 9, look: 0, bannedUntil: null });
    const codes: string[] = [];
    for (const auth of ['ruim', 'sem-perfil', 'ban', 'time9']) {
      const a = connect();
      await msg(a, { t: 'join', auth }, Date.now());
      codes.push(a.conn.last('error')?.code);
    }
    expect(codes).toEqual(['auth_invalid', 'no_profile', 'banned', 'no_profile']);
  });

  it('servidor lotado vira espectador com full', async () => {
    const { connect, msg } = setup({ maxPlayers: 1 });
    await msg(connect(), { t: 'join', auth: 'dev:Ana:0' });
    const b = connect();
    await msg(b, { t: 'join', auth: 'dev:Bia:0' });
    expect(b.conn.last('welcome')).toMatchObject({ spectator: true, full: true, account: { nick: 'Bia' } });
  });

  it('a mesma conta em outra aba derruba a primeira e assume o personagem', async () => {
    const { connect, msg } = setup();
    const a = connect();
    await msg(a, { t: 'join', auth: 'dev:Ana:0' });
    const b = connect();
    await msg(b, { t: 'join', auth: 'dev:Ana:0' });
    expect(a.conn.closed?.[0]).toBe(4001);
    expect(b.conn.last('welcome').id).toBe(a.conn.last('welcome').id);
  });
});

describe('Hub: jogo', () => {
  it('input move o jogador e o snapshot confirma o seq', async () => {
    const { hub, connect, msg } = setup();
    const a = connect();
    await msg(a, { t: 'join', auth: 'dev:Ana:0' });
    hub.tick(50);
    const x0 = a.conn.lastNear().actors[0].x;
    await msg(a, { t: 'input', dx: 1, dz: 0, run: true, seq: 42 }, 60);
    hub.tick(100);
    const s = a.conn.lastNear();
    expect(s.ackSeq).toBe(42);
    expect(s.actors[0].x).toBeGreaterThan(x0);
  });

  it('chat de jogador chega a todos; espectador não pode falar', async () => {
    const { connect, msg } = setup();
    const a = connect();
    const s = connect();
    await msg(a, { t: 'join', auth: 'dev:Ana:0' });
    await msg(s, { t: 'join', spectate: true });
    await msg(a, { t: 'chat', text: 'oi' });
    expect(s.conn.last('chat')).toMatchObject({ nick: 'Ana', text: 'oi', team: 0 });
    expect(a.conn.last('chat')).toMatchObject({ text: 'oi' });
    await msg(s, { t: 'chat', text: 'eu' });
    expect(s.conn.last('error').code).toBe('not_allowed');
  });

  it('snapshot LONGE chega a cada 10 ticks com quem está fora do PERTO', async () => {
    const { hub, world, connect, msg } = setup();
    const a = connect();
    const b = connect();
    await msg(a, { t: 'join', auth: 'dev:Ana:0' });
    await msg(b, { t: 'join', auth: 'dev:Bia:1' });
    const pb = world.players.get(2)!;
    pb.x += 100;
    world.grid.set(pb.id, pb.x, pb.z);
    for (let t = 1; t <= 10; t++) hub.tick(t * 50);
    const fars = a.conn.bins.map((x) => decodeSnapshot(x)).filter((x) => x?.type === FAR_TYPE);
    expect(fars.length).toBe(1);
    expect(fars[0]!.actors.map((x) => x.id)).toEqual([2]);
  });

  it('pong responde ao ping', async () => {
    const { connect, msg } = setup();
    const a = connect();
    await msg(a, { t: 'ping', at: 123 }, 500);
    expect(a.conn.last('pong')).toEqual({ t: 'pong', at: 123, now: 500 });
  });
});

describe('Hub: proteções e ciclo de vida', () => {
  it('derruba quem manda mensagens demais', async () => {
    const { connect, msg } = setup();
    const a = connect();
    for (let i = 0; i <= MAX_MSGS_PER_SEC; i++) await msg(a, { t: 'ping', at: i });
    expect(a.conn.closed?.[0]).toBe(4002);
  });
  it('derruba após uma sequência de mensagens inválidas', async () => {
    const { hub, connect } = setup();
    const a = connect();
    for (let i = 0; i < MAX_INVALID_STREAK; i++) await hub.message(a.client, '{lixo', i * 100);
    expect(a.conn.closed?.[0]).toBe(4003);
  });
  it('derruba por silêncio', () => {
    const { hub, connect } = setup();
    const a = connect(0);
    hub.tick(TIMEOUT_MS + 1);
    expect(a.conn.closed?.[0]).toBe(4000);
  });
  it('ao fechar, o personagem fica desconectado no mundo', async () => {
    const { hub, world, connect, msg } = setup();
    const a = connect();
    await msg(a, { t: 'join', auth: 'dev:Ana:0' });
    hub.close(a.client, 100);
    expect(world.players.get(1)!.connected).toBe(false);
    expect(hub.clients.size).toBe(0);
  });
  it('shutdown avisa e fecha com 1012', async () => {
    const { hub, connect, msg } = setup();
    const a = connect();
    await msg(a, { t: 'join', spectate: true });
    hub.shutdown();
    expect(a.conn.last('restarting')).toEqual({ t: 'restarting' });
    expect(a.conn.closed?.[0]).toBe(1012);
  });
});
