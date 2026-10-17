import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { TICK_MS } from '../shared/constants.ts';

const N = Number(process.argv[2] ?? 1000);
const SECONDS = Number(process.argv[3] ?? 60);
const WS_URL = process.env.BOTS_URL ?? 'ws://localhost:8787/ws';
const ORIGIN = process.env.BOTS_ORIGIN ?? 'http://localhost:5173';
const METRICS = process.env.BOTS_METRICS ?? 'http://localhost:8787/metrics';

let bytes = 0;
let opened = 0;
let failed = 0;
let welcomed = 0;
const sockets: WebSocket[] = [];

function bot(i: number): void {
  const ws = new WebSocket(WS_URL, { origin: ORIGIN });
  let seq = 0;
  let dir = Math.random() * Math.PI * 2;
  let turnAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  ws.on('open', () => {
    opened++;
    ws.send(JSON.stringify({ t: 'join', auth: `dev:bot${i}:${i % 3}`, spectate: false }));
  });
  ws.on('message', (data, isBinary) => {
    bytes += (data as Buffer).length;
    if (isBinary || timer || !data.toString().startsWith('{"t":"welcome"')) return;
    welcomed++;
    timer = setInterval(() => {
      const now = Date.now();
      if (now > turnAt) {
        dir = Math.random() * Math.PI * 2;
        turnAt = now + 2000 + Math.random() * 3000;
      }
      seq = (seq + 1) & 0xffff;
      ws.send(JSON.stringify({ t: 'input', dx: Math.sin(dir), dz: Math.cos(dir), run: false, seq }));
    }, TICK_MS);
  });
  ws.on('error', () => failed++);
  ws.on('close', () => clearInterval(timer));
  sockets.push(ws);
}

console.log(`Conectando ${N} bots em ${WS_URL}…`);
for (let i = 0; i < N; i++) {
  bot(i);
  if (i % 50 === 49) await sleep(100);
}
await sleep(5000);
bytes = 0;
const t0 = Date.now();
console.log(`Medindo por ${SECONDS} s…`);
await sleep(SECONDS * 1000);
const secs = (Date.now() - t0) / 1000;
const m = (await (await fetch(METRICS)).json()) as { online: number; tickMs: { p50: number; p95: number; max: number } };

const perBot = bytes / Math.max(1, welcomed) / secs / 1024;
console.log(`Bots: ${opened} conectados, ${welcomed} jogando, ${failed} com erro`);
console.log(`Recebido por bot: ${perBot.toFixed(1)} KB/s (meta da spec: até ~27 KB/s no pior caso)`);
console.log(`Tick: p50 ${m.tickMs.p50.toFixed(2)} ms · p95 ${m.tickMs.p95.toFixed(2)} ms · máx ${m.tickMs.max.toFixed(2)} ms`);
console.log(m.tickMs.p95 < 25 ? 'OK: p95 abaixo de 25 ms' : 'ACIMA DA META: p95 ≥ 25 ms');
for (const ws of sockets) ws.terminate();
process.exit(0);
