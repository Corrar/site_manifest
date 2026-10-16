import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { decodeSnapshot, NEAR_TYPE, type NearSnapshot } from '../shared/protocol.ts';
import { startServer, type App } from './app.ts';
import { createDevVerifier } from './auth.ts';
import { MemoryProfileStore } from './profiles.ts';

const ORIGIN = 'http://teste.local';
let app: App | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function start(maxPlayers?: number): Promise<App> {
  const store = new MemoryProfileStore();
  app = await startServer({
    port: 0, host: '127.0.0.1', verify: createDevVerifier(store), profiles: store, teams: 3,
    allowedOrigins: [ORIGIN], collider: null, maxPlayers,
    random: () => 0.5, // spawn fixo: sorteado (raio 30), dois jogadores podem nascer a até 60 m, fora do "perto" (40 m)
  });
  return app;
}

type Peer = {
  ws: WebSocket;
  texts: any[];
  nears: NearSnapshot[];
  send(m: object): void;
  wait(pred: () => boolean, ms?: number): Promise<void>;
};

function connect(origin = ORIGIN): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${app!.port}/ws`, { origin });
    const peer: Peer = {
      ws, texts: [], nears: [],
      send: (m) => ws.send(JSON.stringify(m)),
      wait: (pred, ms = 3000) => new Promise((ok, fail) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (pred()) {
            clearInterval(iv);
            ok();
          } else if (Date.now() - t0 > ms) {
            clearInterval(iv);
            fail(new Error('tempo esgotado esperando condição'));
          }
        }, 10);
      }),
    };
    ws.on('message', (data, isBinary) => {
      if (!isBinary) peer.texts.push(JSON.parse(data.toString()));
      else {
        const s = decodeSnapshot(new Uint8Array(data as Buffer));
        if (s?.type === NEAR_TYPE) peer.nears.push(s);
      }
    });
    ws.once('open', () => resolve(peer));
    ws.once('error', reject);
  });
}

const lastOf = (p: Peer, t: string) => p.texts.filter((m) => m.t === t).at(-1);
const actorIn = (p: Peer, id: number) => p.nears.at(-1)?.actors.find((a) => a.id === id);

describe('servidor', () => {
  it('recusa Origin desconhecida', async () => {
    await start();
    await expect(connect('http://malicioso.local')).rejects.toThrow(/403/);
  });

  it('espectador sem login entra; jogar sem login é recusado', async () => {
    await start();
    const s = await connect();
    s.send({ t: 'join', spectate: true });
    await s.wait(() => !!lastOf(s, 'welcome'));
    expect(lastOf(s, 'welcome')).toMatchObject({ spectator: true, account: null });
    const p = await connect();
    p.send({ t: 'join', spectate: false });
    await p.wait(() => !!lastOf(p, 'error'));
    expect(lastOf(p, 'error').code).toBe('auth_required');
  });

  it('dois jogadores se veem, um anda e o outro vê; chat chega aos dois', async () => {
    await start();
    const a = await connect();
    const b = await connect();
    a.send({ t: 'join', auth: 'dev:Ana:0' });
    b.send({ t: 'join', auth: 'dev:Bia:1' });
    await a.wait(() => !!lastOf(a, 'welcome'));
    await b.wait(() => !!lastOf(b, 'welcome'));
    const idA = lastOf(a, 'welcome').id;
    await b.wait(() => !!actorIn(b, idA));
    expect(b.texts.some((m) => m.t === 'names' && m.people.some((x: any) => x.nick === 'Ana'))).toBe(true);
    const x0 = actorIn(b, idA)!.x;
    for (let seq = 1; seq <= 10; seq++) a.send({ t: 'input', dx: 1, dz: 0, run: true, seq });
    await b.wait(() => (actorIn(b, idA)?.x ?? x0) > x0 + 1.5);
    a.send({ t: 'chat', text: 'bom dia, Esplanada' });
    await b.wait(() => lastOf(b, 'chat')?.text === 'bom dia, Esplanada');
    await a.wait(() => lastOf(a, 'chat')?.nick === 'Ana');
  });

  it('reconectar devolve o mesmo personagem no mesmo lugar', async () => {
    await start();
    const a = await connect();
    a.send({ t: 'join', auth: 'dev:Ana:0' });
    await a.wait(() => !!lastOf(a, 'welcome'));
    const id = lastOf(a, 'welcome').id;
    await a.wait(() => !!actorIn(a, id));
    const before = actorIn(a, id)!;
    a.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const a2 = await connect();
    a2.send({ t: 'join', auth: 'dev:Ana:0' });
    await a2.wait(() => !!actorIn(a2, id));
    expect(lastOf(a2, 'welcome').id).toBe(id);
    expect(actorIn(a2, id)!.x).toBeCloseTo(before.x, 1);
  });

  it('lotado: o segundo vira espectador com full', async () => {
    await start(1);
    const a = await connect();
    const b = await connect();
    a.send({ t: 'join', auth: 'dev:Ana:0' });
    await a.wait(() => !!lastOf(a, 'welcome'));
    b.send({ t: 'join', auth: 'dev:Bia:0' });
    await b.wait(() => !!lastOf(b, 'welcome'));
    expect(lastOf(b, 'welcome')).toMatchObject({ spectator: true, full: true });
  });

  it('healthz e metrics', async () => {
    await start();
    expect(await (await fetch(`http://127.0.0.1:${app!.port}/healthz`)).text()).toBe('ok');
    const m = await (await fetch(`http://127.0.0.1:${app!.port}/metrics`)).json();
    expect(m).toHaveProperty('tickMs.p95');
  });
});
