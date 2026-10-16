import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_CONN_PER_IP, MAX_FRAME_BYTES, TICK_MS } from '../shared/constants.ts';
import type { Collider } from '../shared/map.ts';
import type { ChatEntry } from '../shared/protocol.ts';
import type { VerifyToken } from './auth.ts';
import { Chat } from './chat.ts';
import { clientIp, IpCounter, originAllowed } from './netguard.ts';
import type { ProfileStore } from './profiles.ts';
import { Hub } from './session.ts';
import { createStatic } from './static.ts';
import { World } from './world.ts';

export type AppOptions = {
  port: number;
  host?: string;
  verify: VerifyToken;
  profiles: ProfileStore;
  teams: number;
  allowedOrigins: readonly string[];
  collider: Collider | null;
  staticDir?: string | null;
  maxPlayers?: number;
  maxConnPerIp?: number;
  chatLog?: (e: ChatEntry) => void;
  /** Sorteio do spawn (testes). */
  random?: () => number;
};

export type App = { port: number; hub: Hub; close(): Promise<void> };

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export async function startServer(o: AppOptions): Promise<App> {
  const world = new World(o.collider, o.random);
  const hub = new Hub({
    world, chat: new Chat(o.chatLog), verify: o.verify, profiles: o.profiles, teams: o.teams, maxPlayers: o.maxPlayers,
  });
  const perIp = new IpCounter(o.maxConnPerIp ?? MAX_CONN_PER_IP);
  const serveStatic = o.staticDir ? createStatic(o.staticDir) : null;
  const tickTimes: number[] = [];

  const metrics = () => {
    const s = [...tickTimes].sort((a, b) => a - b);
    const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
    return {
      clients: hub.clients.size, online: world.connectedCount(), tick: world.tick,
      tickMs: { p50: q(0.5), p95: q(0.95), max: s.at(-1) ?? 0 },
    };
  };

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    } else if (path === '/metrics' && LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(metrics()));
    } else if (serveStatic && (req.method === 'GET' || req.method === 'HEAD') && path !== '/metrics') {
      serveStatic(req, res);
    } else {
      res.writeHead(404).end();
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  const attach = (ws: WebSocket) => {
    const client = hub.open({
      send: (d) => ws.send(d),
      close: (code, reason) => ws.close(code, reason),
      bufferedAmount: () => ws.bufferedAmount,
    }, Date.now());
    ws.on('message', (data, isBinary) => {
      hub.message(client, isBinary ? null : data.toString(), Date.now()).catch((err) => console.error('message:', err));
    });
    ws.on('close', () => hub.close(client, Date.now()));
    ws.on('error', () => ws.terminate());
  };

  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/ws' || !originAllowed(req.headers.origin, o.allowedOrigins)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const ip = clientIp(req.socket.remoteAddress, req.headers['cf-connecting-ip']);
    if (!perIp.tryAdd(ip)) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      return;
    }
    socket.once('close', () => perIp.remove(ip)); // vale também quando o handshake falha
    wss.handleUpgrade(req, socket, head, attach);
  });

  const timer = setInterval(() => {
    const t0 = performance.now();
    try {
      hub.tick(Date.now());
    } catch (err) {
      console.error('tick:', err);
    }
    tickTimes.push(performance.now() - t0);
    if (tickTimes.length > 1200) tickTimes.shift();
  }, TICK_MS);

  await new Promise<void>((ok) => server.listen(o.port, o.host ?? '0.0.0.0', ok));

  return {
    port: (server.address() as AddressInfo).port,
    hub,
    async close() {
      clearInterval(timer);
      hub.shutdown();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
