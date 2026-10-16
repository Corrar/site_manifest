// Modo demonstração: o servidor do jogo (Hub + World + Chat) roda dentro do navegador, com bots.
// Serve para hospedagem estática (ex.: Vercel), que não mantém um servidor WebSocket.
// Nada sai do navegador: cada visitante vê a sua própria Esplanada simulada.
import { TICK_MS } from '../../../shared/constants.ts';
import type { Collider } from '../../../shared/map.ts';
import { Chat } from '../../../server/chat.ts';
import type { Profile, ProfileStore } from '../../../server/profiles.ts';
import { Hub, type Client, type Conn } from '../../../server/session.ts';
import { World } from '../../../server/world.ts';
import type { SocketLike } from '../net.ts';

const BOTS = 300;
const WANDER_RADIUS = 220;
const KEEPALIVE_MS = 5000;
const NICKS = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabi', 'Heitor', 'Iara', 'João', 'Kátia', 'Lucas',
  'Marina', 'Nando', 'Olívia', 'Paulo', 'Quésia', 'Rafa', 'Sônia', 'Tiago', 'Úrsula', 'Vítor', 'Wanda', 'Yuri',
];
const PHRASES = [
  'Bom dia, Esplanada!', 'Que calor hoje', 'Alguém viu a Catedral?', 'Chegando pelo Eixo agora',
  'Muita gente por aqui', 'Bora andar até o Congresso', 'Água, gente, hidratem-se', 'Que sol!',
  'Cheguei de ônibus pela Rodoviária', 'Olha o tamanho dessa multidão', 'Alguém de Taguatinga?',
];

/** SocketLike com readyState gravável (no WebSocket ele é só leitura). */
type LocalSocket = Omit<SocketLike, 'readyState'> & { readyState: SocketLike['readyState'] };

type Bot = { client: Client; dir: number; turnAt: number; idleUntil: number; seq: number; pingAt: number };

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** Perfis em memória. Humanos: `dev:<apelido>:<time>`; bots: `bot:<n>`. */
function demoAuth(teams: number) {
  const profiles = new Map<string, Profile>();
  const store: ProfileStore = { get: async (id) => profiles.get(id) ?? null };
  const verify = async (token: string) => {
    let m = /^bot:(\d+)$/.exec(token);
    if (m) {
      const n = Number(m[1]);
      const userId = `bot-${n}`;
      profiles.set(userId, { userId, nick: `${NICKS[n % NICKS.length]}${n}`, team: n % teams, look: 0, bannedUntil: null });
      return { userId };
    }
    m = /^dev:([^:]{2,20}):(\d{1,2})$/.exec(token);
    if (!m) return null;
    const userId = `dev-${m[1].toLowerCase()}`;
    profiles.set(userId, { userId, nick: m[1], team: Number(m[2]), look: 0, bannedUntil: null });
    return { userId };
  };
  return { store, verify };
}

/** Sobe o servidor local e devolve a fábrica de sockets para o GameConnection. */
export function startLocalServer(collider: Collider, teams: number): (url: string) => SocketLike {
  const { store, verify } = demoAuth(teams);
  const world = new World(collider);
  const hub = new Hub({ world, chat: new Chat(), verify, profiles: store, teams });
  const bots: Bot[] = [];
  const send = (c: Client, m: object, now: number) => {
    hub.message(c, JSON.stringify(m), now).catch((err) => console.error('demo:', err));
  };

  // Bots não recebem snapshots: um buffer "cheio" faz o Hub pular o trabalho de montá-los.
  const botConn: Conn = { send: () => {}, close: () => {}, bufferedAmount: () => Infinity };
  const now0 = Date.now();
  for (let i = 0; i < BOTS; i++) {
    const client = hub.open(botConn, now0);
    send(client, { t: 'join', auth: `bot:${i}`, spectate: false }, now0);
    bots.push({ client, dir: Math.random() * Math.PI * 2, turnAt: 0, idleUntil: 0, seq: 0, pingAt: now0 });
  }

  let nextChat = now0 + 3000;
  const moveBots = (now: number) => {
    for (const b of bots) {
      const p = b.client.player;
      if (!p) continue;
      if (now - b.pingAt > KEEPALIVE_MS) {
        b.pingAt = now;
        send(b.client, { t: 'ping', at: now }, now);
      }
      if (now < b.idleUntil) continue; // parado, conversando
      if (now > b.turnAt) {
        b.dir = Math.hypot(p.x, p.z) > WANDER_RADIUS ? Math.atan2(-p.x, -p.z) : Math.random() * Math.PI * 2;
        b.turnAt = now + 2000 + Math.random() * 4000;
        if (Math.random() < 0.35) b.idleUntil = now + 2000 + Math.random() * 6000;
      }
      b.seq = (b.seq + 1) & 0xffff;
      world.queueInput(p, { dx: Math.sin(b.dir), dz: Math.cos(b.dir), run: Math.random() < 0.002, seq: b.seq });
    }
    if (now > nextChat) {
      nextChat = now + 3000 + Math.random() * 5000;
      send(pick(bots).client, { t: 'chat', text: pick(PHRASES) }, now);
    }
  };

  setInterval(() => {
    const now = Date.now();
    try {
      moveBots(now);
      hub.tick(now);
    } catch (err) {
      console.error('demo tick:', err);
    }
  }, TICK_MS);

  return () => createLocalSocket(hub);
}

function createLocalSocket(hub: Hub): SocketLike {
  let client: Client | null = null;
  const sock: LocalSocket = {
    readyState: WebSocket.CONNECTING,
    binaryType: 'arraybuffer',
    onopen: null,
    onmessage: null,
    onclose: null,
    send(data) {
      if (client && sock.readyState === WebSocket.OPEN && typeof data === 'string') {
        hub.message(client, data, Date.now()).catch((err) => console.error('demo:', err));
      }
    },
    close() {
      if (client) hub.close(client, Date.now());
      shut();
    },
  };
  const shut = () => {
    if (sock.readyState === WebSocket.CLOSED) return;
    sock.readyState = WebSocket.CLOSED;
    sock.onclose?.(new CloseEvent('close'));
  };
  const conn: Conn = {
    send(d) {
      if (sock.readyState !== WebSocket.OPEN) return;
      const data = typeof d === 'string' ? d : d.slice().buffer;
      sock.onmessage?.(new MessageEvent('message', { data }));
    },
    close() {
      if (client) hub.close(client, Date.now());
      shut();
    },
    bufferedAmount: () => 0,
  };
  setTimeout(() => {
    sock.readyState = WebSocket.OPEN;
    client = hub.open(conn, Date.now());
    sock.onopen?.(new Event('open'));
  }, 0);
  return sock;
}
