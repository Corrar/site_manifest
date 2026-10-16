# Núcleo multiplayer — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIO: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** jogo 3D multiplayer no navegador em que o jogador logado anda pela Esplanada vendo os outros, com chat, e quem não tem conta pode assistir.

**Arquitetura:** servidor Node autoritativo a 20 Hz num único processo (HTTP + WebSocket `/ws`). Posições trafegam em snapshots binários "perto" (20 Hz) e "longe" (2 Hz), escolhidos por uma grade espacial. O cliente Vite + Three.js interpola os outros jogadores e prevê o próprio. Movimento e colisão ficam em `shared/` e rodam igual nos dois lados.

**Stack:** Node 24 (TypeScript direto, sem build), `ws`, `jose`, `@supabase/supabase-js`, Vite, Three.js, Vitest.

**Specs:** [núcleo](../specs/2026-10-16-nucleo-multiplayer-design.md) e [contas/economia](../specs/2026-10-16-contas-economia-p2w-design.md). Leia as duas antes de começar.

**Execução escolhida (2026-10-16):** um agente por tarefa (superpowers:subagent-driven-development). **Não iniciar sem autorização explícita do dono do projeto.**

## Restrições globais

- Node ≥ 24. O servidor roda `.ts` direto (`node server/index.ts`). Por isso:
  - só sintaxe apagável (sem `enum`, `namespace` ou parameter properties no construtor);
  - imports relativos sempre com extensão `.ts`;
  - imports só de tipo com `import type`;
  - JSON importado com `with { type: 'json' }`.
- Constantes exatamente como em `shared/constants.ts` (Tarefa 1), copiadas da spec.
- Tudo o que vem do cliente é validado no servidor. O cliente nunca envia posição.
- Textos de interface em português. Identificadores de código em inglês.
- Chat e apelidos são exibidos sempre como texto (`textContent`), nunca como HTML.
- Segredos só em `.env` (que já está no `.gitignore`).
- Commits pequenos, um por tarefa no mínimo, terminando com:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Ajustes técnicos em relação à spec

1. **Um único `package.json`** na raiz, em vez de npm workspaces. As pastas `shared/`, `server/`, `client/` e `tools/` se importam por caminho relativo. O resultado é o mesmo, com menos configuração.
2. **Input por tick.** Enquanto o jogador se move, o cliente envia um `input` por tick (20/s, cada um com `seq` novo). Ao parar, envia um último input zerado.
   - O servidor aplica cada input como um passo fixo de 50 ms, limitado por um orçamento de no máximo 3 por tick (recarga de 1 por tick), o que impede speed hack.
   - Sem input por 3 ticks, a animação do jogador volta a "parado".
   - É o que permite predição e reconciliação exatas. Na spec, o input era enviado só na mudança, mais 1/s.
3. **Multidão "longe"** em `InstancedMesh` de um boneco low-poly 3D colorido por time, em vez de um atlas de sprites. É uma única chamada de desenho, sem shader próprio e sem pré-renderização.
4. **Personagem provisório:** RobotExpressive (CC0, de Tomás Laulhé/Quaternius, do repositório do three.js). Tem os materiais `Main`/`Grey`/`Black`, as animações `Idle`/`Walking`/`Running`/`Wave` e 3.237 triângulos (464 KB). Os personagens definitivos virão no subprojeto de skins.
5. **Marcos (Congresso e Catedral):** a colisão vem de `solids` em `map.json`, que são polígonos só de colisão. Os prédios do OSM que caem dentro do raio de cada marco são removidos.
6. **Login de desenvolvimento:** com `DEV_AUTH=1`, o servidor aceita tokens `dev:<apelido>:<time>` e cria o perfil em memória. O servidor **se recusa a iniciar** com `DEV_AUTH=1` e `NODE_ENV=production`. O login real (Supabase) entra no subprojeto de contas, que substitui `client/src/auth.ts`. O lado servidor do Supabase (verificação JWT e leitura de `profiles`) já fica pronto aqui.

## Mapa de arquivos

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts
shared/
  constants.ts      constantes da spec
  teams.json        times (nome, cor)
  geo.ts            origem e projeção lat/lon → metros
  protocol.ts       tipos JSON, validação de mensagens do cliente, codificação binária
  geometry.ts       ponto em polígono, empurrar círculo para fora de polígono
  map.ts            tipos do mapa + Collider (índice espacial de polígonos)
  movement.ts       passo de movimento (servidor e predição do cliente)
  landmarks.ts      posição e área dos marcos
  map.json          gerado pela Tarefa 11
server/
  interest.ts       SpatialGrid, pickNear, pickFar
  ids.ts            IdAllocator (u16, reuso após 60 s)
  world.ts          World: jogadores, fila de inputs, tick, retomada
  chat.ts           Chat (filtro, intervalo, histórico)
  chat-log.ts       log diário em arquivo, apaga após 7 dias
  blocked-words.json
  auth.ts           verificador JWT do Supabase e login de desenvolvimento
  profiles.ts       ProfileStore (memória e Supabase)
  netguard.ts       RateLimiter, IpCounter, IP real via Cloudflare, Origin
  session.ts        Hub: mensagens, join, snapshots, stats, timeouts
  static.ts         arquivos estáticos de client/dist
  app.ts            startServer(): HTTP + WS + tick + /metrics
  index.ts          ponto de entrada (lê o ambiente)
supabase/migrations/0001_profiles.sql
tools/
  osm.ts            funções puras de conversão OSM → MapData
  osm-esplanada.ts  baixa os dados do OSM e grava shared/map.json
  bots.ts           teste de carga
client/
  index.html
  public/models/robot.glb
  src/env.d.ts, main.ts, style.css
  src/auth.ts       login de desenvolvimento (trocado no subprojeto de contas)
  src/net.ts        GameConnection
  src/interp.ts     TickClock, Track
  src/predict.ts    Predictor
  src/input.ts      teclado e joystick
  src/scene/        renderer.ts, map.ts, landmarks.ts, avatars.ts, crowd.ts, labels.ts, camera.ts
  src/ui/           lobby.ts, chat.ts, hud.ts
```

---

### Tarefa 1: Base do projeto, constantes, times e projeção

**Arquivos:**
- Criar: `package.json`, `tsconfig.json`, `vitest.config.ts`, `vite.config.ts`, `shared/constants.ts`, `shared/teams.json`, `shared/geo.ts`
- Teste: `shared/geo.test.ts`

**Interfaces:**
- Produz:
  - todas as constantes de `shared/constants.ts`;
  - `teams.json` com o formato `{ name: string; color: string; accent: string }[]` (índice do array = número do time);
  - `ORIGIN` e `project(lat, lon): [x, z]` em `shared/geo.ts`.

- [ ] **Passo 1: criar `package.json`**

```json
{
  "name": "manifest",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev:server": "node --watch --env-file-if-exists=.env server/index.ts",
    "dev:client": "vite",
    "build": "vite build",
    "start": "node --env-file-if-exists=.env server/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "map": "node tools/osm-esplanada.ts",
    "bots": "node tools/bots.ts"
  }
}
```

- [ ] **Passo 2: instalar dependências**

Rodar:
```bash
npm i ws jose @supabase/supabase-js three
npm i -D vite vitest typescript @types/ws @types/three @types/node
```
Esperado: `package.json` ganha `dependencies` e `devDependencies`, e `package-lock.json` é criado.

- [ ] **Passo 3: criar `tsconfig.json`, `vitest.config.ts` e `vite.config.ts`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["es2023", "dom", "dom.iterable"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["shared", "server", "client/src", "tools", "*.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'client/src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  envDir: '..',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
});
```

- [ ] **Passo 4: criar `shared/constants.ts`**

```ts
export const PROTOCOL_VERSION = 1;
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
export const TICK_DT = 1 / TICK_HZ;
export const WALK_SPEED = 1.6;
export const RUN_SPEED = 4.0;
export const PLAYER_RADIUS = 0.35;
export const CELL_SIZE = 16;
export const NEAR_RADIUS = 40;
export const NEAR_MAX = 64;
export const FAR_RADIUS = 300;
export const FAR_MAX = 1000;
export const FAR_HZ = 2;
export const POS_SCALE = 20;
export const MAX_PLAYERS = 1500;
export const LOBBY_STATS_MS = 2000;
export const PING_MS = 5000;
export const TIMEOUT_MS = 20000;
export const RESUME_MS = 30000;
export const ID_REUSE_MS = 60000;
export const MAX_FRAME_BYTES = 4096;
export const MAX_MSGS_PER_SEC = 30;
export const MAX_INVALID_STREAK = 10;
export const MAX_CONN_PER_IP = 10;
export const CHAT_MIN_INTERVAL_MS = 1500;
export const CHAT_MAX_LEN = 200;
export const CHAT_HISTORY = 40;
export const CHAT_LOG_DAYS = 7;
export const NICK_MIN = 2;
export const NICK_MAX = 20;
export const INTERP_DELAY_MS = 100;
export const INPUT_BUDGET_MAX = 3;
export const INPUT_QUEUE_MAX = 10;
export const IDLE_AFTER_TICKS = 3;
export const SPAWN_RADIUS = 30;
export const ANIM = { idle: 0, walk: 1, run: 2, wave: 3 } as const;
```

- [ ] **Passo 5: criar `shared/teams.json`**

```json
[
  { "name": "Bolsonarista", "color": "#1f9d55", "accent": "#f2c200" },
  { "name": "Petista", "color": "#d62828", "accent": "#ffffff" },
  { "name": "Terceira via", "color": "#2b6cb0", "accent": "#ffffff" }
]
```

- [ ] **Passo 6: escrever o teste que falha (`shared/geo.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { ORIGIN, project } from './geo.ts';
import teams from './teams.json' with { type: 'json' };

describe('project', () => {
  it('leva a origem para (0, 0)', () => {
    expect(project(ORIGIN.lat, ORIGIN.lon)).toEqual([0, 0]);
  });
  it('0,001° a leste ≈ 107 m em x', () => {
    const [x, z] = project(ORIGIN.lat, ORIGIN.lon + 0.001);
    expect(x).toBeCloseTo(107.0, 0);
    expect(z).toBe(0);
  });
  it('0,001° ao sul ≈ +111,2 m em z', () => {
    const [x, z] = project(ORIGIN.lat - 0.001, ORIGIN.lon);
    expect(x).toBe(0);
    expect(z).toBeCloseTo(111.2, 0);
  });
});

describe('teams.json', () => {
  it('tem nome e cores hexadecimais', () => {
    expect(teams.length).toBeGreaterThanOrEqual(2);
    for (const t of teams) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
```

- [ ] **Passo 7: rodar e ver falhar**

Rodar: `npx vitest run shared/geo.test.ts`
Esperado: FALHA ("Failed to load ./geo.ts").

- [ ] **Passo 8: criar `shared/geo.ts`**

```ts
// Centro do Eixo Monumental entre a Catedral e o Congresso. X = leste, Z = sul, em metros.
export const ORIGIN = { lat: -15.799, lon: -47.8698 } as const;

const R = 6371008.8;
const DEG = Math.PI / 180;

export function project(lat: number, lon: number): [number, number] {
  const x = (lon - ORIGIN.lon) * DEG * R * Math.cos(ORIGIN.lat * DEG);
  const z = -(lat - ORIGIN.lat) * DEG * R;
  return [Math.round(x * 100) / 100 + 0, Math.round(z * 100) / 100 + 0];
}
```
(O `+ 0` transforma `-0` em `0`, para o `toEqual([0, 0])` passar.)

- [ ] **Passo 9: rodar e ver passar**

Rodar: `npx vitest run shared/geo.test.ts`
Esperado: 4 testes PASSAM.

- [ ] **Passo 10: commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts vite.config.ts shared/
git commit -m "chore: base do projeto, constantes, times e projeção geográfica

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 2: Protocolo (mensagens JSON e snapshots binários)

**Arquivos:**
- Criar: `shared/protocol.ts`
- Teste: `shared/protocol.test.ts`

**Interfaces:**
- Consome: constantes da Tarefa 1.
- Produz:
  - Constantes: `NEAR_TYPE = 0x01`, `FAR_TYPE = 0x02`.
  - Tipos de ator e snapshot:
    - `NearActor { id, x, z, yaw, anim, team, look }`
    - `FarActor { id, x, z, team }`
    - `NearSnapshot { type: 0x01, tick, ackSeq, actors: NearActor[] }`
    - `FarSnapshot { type: 0x02, tick, actors: FarActor[] }`
  - Codificação: `encodeNear(tick, ackSeq, actors): Uint8Array`, `encodeFar(tick, actors): Uint8Array`, `decodeSnapshot(data: ArrayBuffer | Uint8Array): NearSnapshot | FarSnapshot | null`.
  - Mensagens JSON: `ClientMessage`, `ServerMessage`, `Account`, `ChatEntry`, `Person`, `ErrorCode`, `parseClientMessage(raw: string): ClientMessage | null`.
  - Utilitário: `seqNewer(a, b): boolean` (comparação circular de 16 bits).

- [ ] **Passo 1: escrever o teste que falha (`shared/protocol.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import {
  decodeSnapshot, encodeFar, encodeNear, FAR_TYPE, NEAR_TYPE, parseClientMessage, seqNewer,
  type NearActor,
} from './protocol.ts';

const actor: NearActor = { id: 513, x: -1234.56, z: 87.25, yaw: Math.PI / 2, anim: 2, team: 1, look: 7 };

describe('snapshot PERTO', () => {
  it('ida e volta preserva os campos (posição com 5 cm de precisão)', () => {
    const buf = encodeNear(123456, 65535, [actor]);
    expect(buf.byteLength).toBe(8 + 10);
    const s = decodeSnapshot(buf);
    expect(s?.type).toBe(NEAR_TYPE);
    if (s?.type !== NEAR_TYPE) return;
    expect(s.tick).toBe(123456);
    expect(s.ackSeq).toBe(65535);
    const a = s.actors[0];
    expect(a.id).toBe(513);
    expect(Math.abs(a.x - actor.x)).toBeLessThanOrEqual(0.025);
    expect(Math.abs(a.z - actor.z)).toBeLessThanOrEqual(0.025);
    expect(Math.abs(a.yaw - actor.yaw)).toBeLessThan((2 * Math.PI) / 256);
    expect([a.anim, a.team, a.look]).toEqual([2, 1, 7]);
  });
  it('satura posições fora do alcance de int16', () => {
    const s = decodeSnapshot(encodeNear(1, 0, [{ ...actor, x: 99999, z: -99999 }]));
    if (s?.type !== NEAR_TYPE) throw new Error('tipo errado');
    expect(s.actors[0].x).toBeCloseTo(32767 / 20);
    expect(s.actors[0].z).toBeCloseTo(-32768 / 20);
  });
  it('lê corretamente a partir de um Uint8Array com offset', () => {
    const inner = encodeNear(9, 1, [actor]);
    const outer = new Uint8Array(inner.byteLength + 4);
    outer.set(inner, 4);
    expect(decodeSnapshot(outer.subarray(4))?.type).toBe(NEAR_TYPE);
  });
  it('rejeita tamanho inconsistente', () => {
    const buf = encodeNear(1, 0, [actor]);
    expect(decodeSnapshot(buf.subarray(0, buf.byteLength - 1))).toBeNull();
  });
});

describe('snapshot LONGE', () => {
  it('ida e volta', () => {
    const buf = encodeFar(77, [{ id: 2, x: 10, z: -20, team: 2 }, { id: 3, x: 0.05, z: 0, team: 0 }]);
    expect(buf.byteLength).toBe(7 + 2 * 7);
    const s = decodeSnapshot(buf);
    if (s?.type !== FAR_TYPE) throw new Error('tipo errado');
    expect(s.tick).toBe(77);
    expect(s.actors).toEqual([{ id: 2, x: 10, z: -20, team: 2 }, { id: 3, x: 0.05, z: 0, team: 0 }]);
  });
  it('tipo desconhecido vira null', () => {
    expect(decodeSnapshot(new Uint8Array([9, 0, 0]))).toBeNull();
  });
});

describe('parseClientMessage', () => {
  it('aceita mensagens válidas', () => {
    expect(parseClientMessage('{"t":"lobby"}')).toEqual({ t: 'lobby' });
    expect(parseClientMessage('{"t":"join","auth":"abc","spectate":false,"token":null}'))
      .toEqual({ t: 'join', auth: 'abc', spectate: false, token: null });
    expect(parseClientMessage('{"t":"join","spectate":true}'))
      .toEqual({ t: 'join', auth: null, spectate: true, token: null });
    expect(parseClientMessage('{"t":"input","dx":0.5,"dz":-1,"run":true,"seq":65535}'))
      .toEqual({ t: 'input', dx: 0.5, dz: -1, run: true, seq: 65535 });
    expect(parseClientMessage('{"t":"view","x":10,"z":-5}')).toEqual({ t: 'view', x: 10, z: -5 });
    expect(parseClientMessage('{"t":"chat","text":"olá"}')).toEqual({ t: 'chat', text: 'olá' });
    expect(parseClientMessage('{"t":"ping","at":5}')).toEqual({ t: 'ping', at: 5 });
  });
  it('rejeita mensagens inválidas', () => {
    for (const raw of [
      'não é json', '[]', 'null', '{"t":"voar"}',
      '{"t":"input","dx":2,"dz":0,"run":false,"seq":1}',
      '{"t":"input","dx":0,"dz":0,"run":"sim","seq":1}',
      '{"t":"input","dx":0,"dz":0,"run":false,"seq":70000}',
      '{"t":"view","x":1e9,"z":0}',
      `{"t":"chat","text":"${'a'.repeat(201)}"}`,
      '{"t":"join","spectate":"x"}',
      '{"t":"join","token":"curto"}',
      `{"t":"ping","at":1,"x":"${'a'.repeat(5000)}"}`,
    ]) expect(parseClientMessage(raw), raw.slice(0, 40)).toBeNull();
  });
});

describe('seqNewer', () => {
  it('compara de forma circular', () => {
    expect(seqNewer(5, 4)).toBe(true);
    expect(seqNewer(4, 5)).toBe(false);
    expect(seqNewer(0, 65535)).toBe(true);
    expect(seqNewer(65535, 0)).toBe(false);
    expect(seqNewer(7, 7)).toBe(false);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run shared/protocol.test.ts`
Esperado: FALHA ("Failed to load ./protocol.ts").

- [ ] **Passo 3: criar `shared/protocol.ts`**

```ts
import { CHAT_MAX_LEN, MAX_FRAME_BYTES, POS_SCALE } from './constants.ts';

export const NEAR_TYPE = 0x01;
export const FAR_TYPE = 0x02;
const NEAR_HEADER = 8; // u8 type, u32 tick, u16 ackSeq, u8 count
const NEAR_ENTRY = 10;
const FAR_HEADER = 7; // u8 type, u32 tick, u16 count
const FAR_ENTRY = 7;
const TWO_PI = Math.PI * 2;

export type NearActor = { id: number; x: number; z: number; yaw: number; anim: number; team: number; look: number };
export type FarActor = { id: number; x: number; z: number; team: number };
export type NearSnapshot = { type: typeof NEAR_TYPE; tick: number; ackSeq: number; actors: NearActor[] };
export type FarSnapshot = { type: typeof FAR_TYPE; tick: number; actors: FarActor[] };

export type Account = { nick: string; team: number; look: number };
export type ChatEntry = { id: number; nick: string; team: number; text: string; at: number };
export type Person = { id: number; nick: string; team: number; look: number };
export type ErrorCode =
  | 'auth_required' | 'auth_invalid' | 'banned' | 'no_profile' | 'unavailable'
  | 'rate_limited' | 'chat_blocked' | 'not_allowed';

export type ClientMessage =
  | { t: 'lobby' }
  | { t: 'join'; auth: string | null; spectate: boolean; token: string | null }
  | { t: 'input'; dx: number; dz: number; run: boolean; seq: number }
  | { t: 'view'; x: number; z: number }
  | { t: 'chat'; text: string }
  | { t: 'ping'; at: number };

export type ServerMessage =
  | { t: 'stats'; online: number; teams: number[] }
  | { t: 'welcome'; v: number; id: number; token: string; serverTime: number; spectator: boolean;
      history: ChatEntry[]; full: boolean; account: Account | null }
  | { t: 'names'; people: Person[] }
  | ({ t: 'chat' } & ChatEntry)
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong'; at: number; now: number }
  | { t: 'restarting' };

const quantPos = (m: number) => Math.max(-32768, Math.min(32767, Math.round(m * POS_SCALE)));
const quantYaw = (rad: number) => Math.round(((((rad % TWO_PI) + TWO_PI) % TWO_PI) / TWO_PI) * 256) & 255;

export function encodeNear(tick: number, ackSeq: number, actors: readonly NearActor[]): Uint8Array {
  if (actors.length > 255) throw new RangeError('near: mais de 255 atores');
  const buf = new Uint8Array(NEAR_HEADER + actors.length * NEAR_ENTRY);
  const v = new DataView(buf.buffer);
  v.setUint8(0, NEAR_TYPE);
  v.setUint32(1, tick >>> 0, true);
  v.setUint16(5, ackSeq & 0xffff, true);
  v.setUint8(7, actors.length);
  let o = NEAR_HEADER;
  for (const a of actors) {
    v.setUint16(o, a.id, true);
    v.setInt16(o + 2, quantPos(a.x), true);
    v.setInt16(o + 4, quantPos(a.z), true);
    v.setUint8(o + 6, quantYaw(a.yaw));
    v.setUint8(o + 7, a.anim);
    v.setUint8(o + 8, a.team);
    v.setUint8(o + 9, a.look);
    o += NEAR_ENTRY;
  }
  return buf;
}

export function encodeFar(tick: number, actors: readonly FarActor[]): Uint8Array {
  if (actors.length > 65535) throw new RangeError('far: atores demais');
  const buf = new Uint8Array(FAR_HEADER + actors.length * FAR_ENTRY);
  const v = new DataView(buf.buffer);
  v.setUint8(0, FAR_TYPE);
  v.setUint32(1, tick >>> 0, true);
  v.setUint16(5, actors.length, true);
  let o = FAR_HEADER;
  for (const a of actors) {
    v.setUint16(o, a.id, true);
    v.setInt16(o + 2, quantPos(a.x), true);
    v.setInt16(o + 4, quantPos(a.z), true);
    v.setUint8(o + 6, a.team);
    o += FAR_ENTRY;
  }
  return buf;
}

export function decodeSnapshot(data: ArrayBuffer | Uint8Array): NearSnapshot | FarSnapshot | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 1) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = v.getUint8(0);
  if (type === NEAR_TYPE) {
    if (bytes.byteLength < NEAR_HEADER) return null;
    const count = v.getUint8(7);
    if (bytes.byteLength !== NEAR_HEADER + count * NEAR_ENTRY) return null;
    const actors: NearActor[] = [];
    for (let i = 0, o = NEAR_HEADER; i < count; i++, o += NEAR_ENTRY) {
      actors.push({
        id: v.getUint16(o, true),
        x: v.getInt16(o + 2, true) / POS_SCALE,
        z: v.getInt16(o + 4, true) / POS_SCALE,
        yaw: (v.getUint8(o + 6) / 256) * TWO_PI,
        anim: v.getUint8(o + 7),
        team: v.getUint8(o + 8),
        look: v.getUint8(o + 9),
      });
    }
    return { type: NEAR_TYPE, tick: v.getUint32(1, true), ackSeq: v.getUint16(5, true), actors };
  }
  if (type === FAR_TYPE) {
    if (bytes.byteLength < FAR_HEADER) return null;
    const count = v.getUint16(5, true);
    if (bytes.byteLength !== FAR_HEADER + count * FAR_ENTRY) return null;
    const actors: FarActor[] = [];
    for (let i = 0, o = FAR_HEADER; i < count; i++, o += FAR_ENTRY) {
      actors.push({
        id: v.getUint16(o, true),
        x: v.getInt16(o + 2, true) / POS_SCALE,
        z: v.getInt16(o + 4, true) / POS_SCALE,
        team: v.getUint8(o + 6),
      });
    }
    return { type: FAR_TYPE, tick: v.getUint32(1, true), actors };
  }
  return null;
}

/** true se `a` é mais novo que `b` na sequência circular de 16 bits. */
export function seqNewer(a: number, b: number): boolean {
  const d = (a - b) & 0xffff;
  return d !== 0 && d < 0x8000;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inRange = (v: unknown, lim: number): v is number => isNum(v) && Math.abs(v) <= lim;

/** string | null válida, ou undefined se inválida. Ausente vira null. */
function nullableString(v: unknown, ok: (s: string) => boolean): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === 'string' && ok(v) ? v : undefined;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_FRAME_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'lobby':
      return { t: 'lobby' };
    case 'join': {
      const auth = nullableString(o.auth, (s) => s.length <= 4096);
      const token = nullableString(o.token, (s) => /^[A-Za-z0-9_-]{22}$/.test(s));
      const spectate = o.spectate ?? false;
      if (auth === undefined || token === undefined || typeof spectate !== 'boolean') return null;
      return { t: 'join', auth, spectate, token };
    }
    case 'input':
      if (!inRange(o.dx, 1) || !inRange(o.dz, 1) || typeof o.run !== 'boolean') return null;
      if (!Number.isInteger(o.seq) || (o.seq as number) < 0 || (o.seq as number) > 0xffff) return null;
      return { t: 'input', dx: o.dx, dz: o.dz, run: o.run, seq: o.seq as number };
    case 'view':
      if (!inRange(o.x, 5000) || !inRange(o.z, 5000)) return null;
      return { t: 'view', x: o.x, z: o.z };
    case 'chat':
      if (typeof o.text !== 'string' || o.text.length > CHAT_MAX_LEN) return null;
      return { t: 'chat', text: o.text };
    case 'ping':
      if (!isNum(o.at)) return null;
      return { t: 'ping', at: o.at };
    default:
      return null;
  }
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run shared/protocol.test.ts`
Esperado: todos PASSAM.

- [ ] **Passo 5: commit**

```bash
git add shared/protocol.ts shared/protocol.test.ts
git commit -m "feat(shared): protocolo JSON e snapshots binários PERTO/LONGE

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3: Geometria, mapa (Collider) e movimento

**Arquivos:**
- Criar: `shared/geometry.ts`, `shared/map.ts`, `shared/movement.ts`
- Teste: `shared/movement.test.ts`

**Interfaces:**
- Consome: constantes (`PLAYER_RADIUS`, `WALK_SPEED`, `RUN_SPEED`, `TICK_DT`, `ANIM`).
- Produz:
  - `geometry.ts`: `Pt = [number, number]`, `pointInPolygon(x, z, poly)`, `pushOutOfPolygon(x, z, r, poly): Pt | null`.
  - `map.ts`, tipos do mapa:
    - `Road { line: Pt[]; width }`
    - `Building { outline: Pt[]; height }`
    - `Area { outline: Pt[]; kind: 'grass' | 'water' }`
    - `Bounds { minX, maxX, minZ, maxZ }`
    - `MapData { version: 1; bounds; roads; buildings; areas; solids: Pt[][] }`
  - `map.ts`, classe `Collider`: `new Collider(polys, bounds)`, `Collider.fromMap(map)`, `resolve(x, z, r): Pt`, `blocked(x, z): boolean`.
  - `movement.ts`: `MoveInput { dx, dz, run }`, `MoveState { x, z, yaw, anim }`, `stepMove(state, input, collider | null, dt = TICK_DT): MoveState`.

- [ ] **Passo 1: escrever o teste que falha (`shared/movement.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { ANIM, PLAYER_RADIUS, RUN_SPEED, TICK_DT, WALK_SPEED } from './constants.ts';
import { pointInPolygon, pushOutOfPolygon, type Pt } from './geometry.ts';
import { Collider } from './map.ts';
import { stepMove, type MoveState } from './movement.ts';

const square: Pt[] = [[2, -10], [4, -10], [4, 10], [2, 10]];
const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
const start: MoveState = { x: 0, z: 0, yaw: 0, anim: ANIM.idle };

describe('geometria', () => {
  it('pointInPolygon', () => {
    expect(pointInPolygon(3, 0, square)).toBe(true);
    expect(pointInPolygon(1, 0, square)).toBe(false);
  });
  it('empurra para fora um círculo encostado por fora', () => {
    const p = pushOutOfPolygon(1.8, 0, 0.35, square)!;
    expect(p[0]).toBeCloseTo(2 - 0.35);
    expect(p[1]).toBeCloseTo(0);
  });
  it('empurra para fora um ponto dentro, pela borda mais próxima', () => {
    const p = pushOutOfPolygon(2.2, 0, 0.35, square)!;
    expect(p[0]).toBeCloseTo(2 - 0.35);
  });
  it('sem contato devolve null', () => {
    expect(pushOutOfPolygon(0, 0, 0.35, square)).toBeNull();
  });
});

describe('Collider', () => {
  const col = new Collider([square], bounds);
  it('para na parede e desliza ao longo dela', () => {
    let s = start;
    for (let i = 0; i < 200; i++) s = stepMove(s, { dx: 1, dz: 1, run: true }, col);
    expect(s.x).toBeLessThanOrEqual(2 - PLAYER_RADIUS + 1e-6);
    expect(s.z).toBeGreaterThan(5);
  });
  it('não sai dos limites do mapa', () => {
    let s = start;
    for (let i = 0; i < 1000; i++) s = stepMove(s, { dx: -1, dz: 0, run: true }, col);
    expect(s.x).toBeCloseTo(bounds.minX + PLAYER_RADIUS);
  });
  it('blocked indica pontos dentro de prédios', () => {
    expect(col.blocked(3, 0)).toBe(true);
    expect(col.blocked(0, 0)).toBe(false);
  });
});

describe('stepMove', () => {
  it('anda e corre com a velocidade da constante', () => {
    expect(stepMove(start, { dx: 1, dz: 0, run: false }, null).x).toBeCloseTo(WALK_SPEED * TICK_DT);
    expect(stepMove(start, { dx: 0, dz: 1, run: true }, null).z).toBeCloseTo(RUN_SPEED * TICK_DT);
  });
  it('normaliza diagonais e define direção e animação', () => {
    const s = stepMove(start, { dx: 1, dz: 1, run: false }, null);
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(WALK_SPEED * TICK_DT);
    expect(s.yaw).toBeCloseTo(Math.PI / 4);
    expect(s.anim).toBe(ANIM.walk);
  });
  it('input zerado mantém posição e direção, animação parado', () => {
    const s = stepMove({ x: 1, z: 2, yaw: 1, anim: ANIM.run }, { dx: 0, dz: 0, run: true }, null);
    expect(s).toEqual({ x: 1, z: 2, yaw: 1, anim: ANIM.idle });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run shared/movement.test.ts`
Esperado: FALHA ("Failed to load ./geometry.ts").

- [ ] **Passo 3: criar `shared/geometry.ts`**

```ts
export type Pt = [number, number];

export function pointInPolygon(x: number, z: number, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function closestOnSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): Pt {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return [ax + t * dx, az + t * dz];
}

/** Empurra o círculo (x, z, r) para fora do polígono. null se não há contato. */
export function pushOutOfPolygon(x: number, z: number, r: number, poly: readonly Pt[]): Pt | null {
  let best = Infinity;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [qx, qz] = closestOnSegment(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    const d2 = (qx - x) ** 2 + (qz - z) ** 2;
    if (d2 < best) {
      best = d2;
      cx = qx;
      cz = qz;
    }
  }
  const d = Math.sqrt(best);
  const inside = pointInPolygon(x, z, poly);
  if (!inside && d >= r) return null;
  if (d < 1e-9) return [cx + r, cz]; // exatamente sobre a borda: direção indefinida
  const s = inside ? -1 : 1; // por dentro, a normal (p - c) aponta para dentro
  return [cx + ((x - cx) / d) * s * r, cz + ((z - cz) / d) * s * r];
}
```

- [ ] **Passo 4: criar `shared/map.ts`**

```ts
import { pointInPolygon, pushOutOfPolygon, type Pt } from './geometry.ts';

export type Road = { line: Pt[]; width: number };
export type Building = { outline: Pt[]; height: number };
export type Area = { outline: Pt[]; kind: 'grass' | 'water' };
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type MapData = {
  version: 1;
  bounds: Bounds;
  roads: Road[];
  buildings: Building[];
  areas: Area[];
  solids: Pt[][];
};

const GRID = 32;
type Poly = { pts: Pt[]; minX: number; maxX: number; minZ: number; maxZ: number };
const keyOf = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

export class Collider {
  readonly bounds: Bounds;
  private readonly cells = new Map<number, Poly[]>();

  constructor(polys: readonly Pt[][], bounds: Bounds) {
    this.bounds = bounds;
    for (const pts of polys) {
      if (pts.length < 3) continue;
      const p: Poly = { pts, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const [x, z] of pts) {
        p.minX = Math.min(p.minX, x);
        p.maxX = Math.max(p.maxX, x);
        p.minZ = Math.min(p.minZ, z);
        p.maxZ = Math.max(p.maxZ, z);
      }
      for (let cx = Math.floor(p.minX / GRID); cx <= Math.floor(p.maxX / GRID); cx++) {
        for (let cz = Math.floor(p.minZ / GRID); cz <= Math.floor(p.maxZ / GRID); cz++) {
          const k = keyOf(cx, cz);
          const list = this.cells.get(k);
          if (list) list.push(p);
          else this.cells.set(k, [p]);
        }
      }
    }
  }

  static fromMap(map: MapData): Collider {
    return new Collider([...map.buildings.map((b) => b.outline), ...map.solids], map.bounds);
  }

  private nearby(x: number, z: number, r: number): Set<Poly> {
    const found = new Set<Poly>();
    for (let cx = Math.floor((x - r) / GRID); cx <= Math.floor((x + r) / GRID); cx++) {
      for (let cz = Math.floor((z - r) / GRID); cz <= Math.floor((z + r) / GRID); cz++) {
        const list = this.cells.get(keyOf(cx, cz));
        if (list) for (const p of list) found.add(p);
      }
    }
    return found;
  }

  /** Posição corrigida de um círculo de raio r: fora dos polígonos e dentro dos limites. */
  resolve(x: number, z: number, r: number): Pt {
    for (let pass = 0; pass < 2; pass++) {
      for (const p of this.nearby(x, z, r)) {
        if (x + r < p.minX || x - r > p.maxX || z + r < p.minZ || z - r > p.maxZ) continue;
        const out = pushOutOfPolygon(x, z, r, p.pts);
        if (out) [x, z] = out;
      }
    }
    const b = this.bounds;
    return [Math.min(b.maxX - r, Math.max(b.minX + r, x)), Math.min(b.maxZ - r, Math.max(b.minZ + r, z))];
  }

  blocked(x: number, z: number): boolean {
    for (const p of this.nearby(x, z, 0)) if (pointInPolygon(x, z, p.pts)) return true;
    return false;
  }
}
```

- [ ] **Passo 5: criar `shared/movement.ts`**

```ts
import { ANIM, PLAYER_RADIUS, RUN_SPEED, TICK_DT, WALK_SPEED } from './constants.ts';
import type { Collider } from './map.ts';

export type MoveInput = { dx: number; dz: number; run: boolean };
export type MoveState = { x: number; z: number; yaw: number; anim: number };

/** Um passo de movimento. Roda igual no servidor e na predição do cliente. */
export function stepMove(s: MoveState, input: MoveInput, collider: Collider | null, dt = TICK_DT): MoveState {
  let { dx, dz } = input;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return { x: s.x, z: s.z, yaw: s.yaw, anim: ANIM.idle };
  if (len > 1) {
    dx /= len;
    dz /= len;
  }
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  let x = s.x + dx * speed * dt;
  let z = s.z + dz * speed * dt;
  if (collider) [x, z] = collider.resolve(x, z, PLAYER_RADIUS);
  return { x, z, yaw: Math.atan2(dx, dz), anim: input.run ? ANIM.run : ANIM.walk };
}
```

- [ ] **Passo 6: rodar e ver passar**

Rodar: `npx vitest run shared/movement.test.ts`
Esperado: todos PASSAM.

- [ ] **Passo 7: commit**

```bash
git add shared/geometry.ts shared/map.ts shared/movement.ts shared/movement.test.ts
git commit -m "feat(shared): colisão com prédios e passo de movimento compartilhado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4: Grade de interesse (quem está perto e longe)

**Arquivos:**
- Criar: `server/interest.ts`
- Teste: `server/interest.test.ts`

**Interfaces:**
- Consome: `CELL_SIZE`, `NEAR_MAX`, `NEAR_RADIUS`, `FAR_MAX`, `FAR_RADIUS`.
- Produz:
  - `class SpatialGrid { set(id, x, z); delete(id); query(x, z, r, out: Hit[]): Hit[]; size }`, com `Hit = { id: number; d2: number }`;
  - `pickNear(grid, x, z, max = NEAR_MAX, radius = NEAR_RADIUS): number[]`: os mais próximos primeiro;
  - `pickFar(grid, x, z, exclude: ReadonlySet<number>, max = FAR_MAX, radius = FAR_RADIUS): number[]`: os mais próximos primeiro, sem os excluídos.

- [ ] **Passo 1: escrever o teste que falha (`server/interest.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { pickFar, pickNear, SpatialGrid, type Hit } from './interest.ts';

describe('SpatialGrid', () => {
  it('move entre células e remove', () => {
    const g = new SpatialGrid(16);
    g.set(1, 0, 0);
    g.set(1, 100, 100);
    expect(g.query(0, 0, 5, [])).toEqual([]);
    expect(g.query(100, 100, 5, []).map((h: Hit) => h.id)).toEqual([1]);
    g.delete(1);
    expect(g.query(100, 100, 5, [])).toEqual([]);
    expect(g.size).toBe(0);
  });
  it('query respeita o raio exato, inclusive com coordenadas negativas', () => {
    const g = new SpatialGrid(16);
    g.set(1, -3, -4); // distância 5
    g.set(2, -3.1, -4);
    expect(g.query(0, 0, 5, []).map((h) => h.id)).toEqual([1]);
  });
});

describe('pickNear', () => {
  it('ordena por distância e limita a quantidade', () => {
    const g = new SpatialGrid(16);
    for (let i = 1; i <= 10; i++) g.set(i, i, 0);
    expect(pickNear(g, 0, 0, 3, 40)).toEqual([1, 2, 3]);
  });
  it('numa multidão densa pega os mais próximos de verdade', () => {
    const g = new SpatialGrid(16);
    for (let i = 1; i <= 200; i++) g.set(i, Math.cos(i) * 4, Math.sin(i) * 4); // todos a 4 m
    g.set(999, 0.5, 0); // o mais próximo de todos
    g.set(1000, 30, 0);
    const near = pickNear(g, 0, 0, 64, 40);
    expect(near.length).toBe(64);
    expect(near[0]).toBe(999);
    expect(near).not.toContain(1000);
  });
});

describe('pickFar', () => {
  it('exclui os de perto, respeita o raio, ordena e limita', () => {
    const g = new SpatialGrid(16);
    g.set(1, 1, 0);
    g.set(2, 50, 0);
    g.set(3, 100, 0);
    g.set(4, 400, 0);
    expect(pickFar(g, 0, 0, new Set([1]), 10, 300)).toEqual([2, 3]);
    expect(pickFar(g, 0, 0, new Set(), 1, 300)).toEqual([1]);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run server/interest.test.ts`
Esperado: FALHA ("Failed to load ./interest.ts").

- [ ] **Passo 3: criar `server/interest.ts`**

```ts
import { CELL_SIZE, FAR_MAX, FAR_RADIUS, NEAR_MAX, NEAR_RADIUS } from '../shared/constants.ts';

export type Hit = { id: number; d2: number };
type Entry = { x: number; z: number; key: number };
const keyOf = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

export class SpatialGrid {
  private readonly cell: number;
  private readonly cells = new Map<number, Set<number>>();
  private readonly where = new Map<number, Entry>();

  constructor(cell = CELL_SIZE) {
    this.cell = cell;
  }

  get size(): number {
    return this.where.size;
  }

  set(id: number, x: number, z: number): void {
    const key = keyOf(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const e = this.where.get(id);
    if (!e) {
      this.where.set(id, { x, z, key });
      this.addTo(key, id);
      return;
    }
    if (e.key !== key) {
      this.removeFrom(e.key, id);
      this.addTo(key, id);
      e.key = key;
    }
    e.x = x;
    e.z = z;
  }

  delete(id: number): void {
    const e = this.where.get(id);
    if (!e) return;
    this.removeFrom(e.key, id);
    this.where.delete(id);
  }

  query(x: number, z: number, r: number, out: Hit[]): Hit[] {
    const r2 = r * r;
    const c = this.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) {
      for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++) {
        const set = this.cells.get(keyOf(cx, cz));
        if (!set) continue;
        for (const id of set) {
          const e = this.where.get(id)!;
          const d2 = (e.x - x) ** 2 + (e.z - z) ** 2;
          if (d2 <= r2) out.push({ id, d2 });
        }
      }
    }
    return out;
  }

  private addTo(key: number, id: number): void {
    const set = this.cells.get(key);
    if (set) set.add(id);
    else this.cells.set(key, new Set([id]));
  }

  private removeFrom(key: number, id: number): void {
    const set = this.cells.get(key);
    if (!set) return;
    set.delete(id);
    if (set.size === 0) this.cells.delete(key);
  }
}

const byDistance = (a: Hit, b: Hit) => a.d2 - b.d2 || a.id - b.id;

/** Os `max` mais próximos dentro de `radius`. Começa com raio pequeno para não ordenar multidões inteiras. */
export function pickNear(grid: SpatialGrid, x: number, z: number, max = NEAR_MAX, radius = NEAR_RADIUS): number[] {
  let hits: Hit[] = [];
  for (const r of [radius / 4, radius / 2, radius]) {
    hits = grid.query(x, z, r, []);
    if (hits.length >= max) break;
  }
  return hits.sort(byDistance).slice(0, max).map((h) => h.id);
}

export function pickFar(
  grid: SpatialGrid, x: number, z: number, exclude: ReadonlySet<number>, max = FAR_MAX, radius = FAR_RADIUS,
): number[] {
  return grid.query(x, z, radius, [])
    .filter((h) => !exclude.has(h.id))
    .sort(byDistance)
    .slice(0, max)
    .map((h) => h.id);
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run server/interest.test.ts`
Esperado: todos PASSAM.

- [ ] **Passo 5: commit**

```bash
git add server/interest.ts server/interest.test.ts
git commit -m "feat(server): grade espacial e seleção de interesse perto/longe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Tarefa 5: Ids e mundo (jogadores, inputs, tick, retomada)

**Arquivos:**
- Criar: `server/ids.ts`, `server/world.ts`
- Teste: `server/world.test.ts`

**Interfaces:**
- Consome: `stepMove`, `MoveInput` (Tarefa 3); `SpatialGrid` (Tarefa 4); `Collider` (Tarefa 3).
- Produz:
  - `class IdAllocator { alloc(now): number | null; release(id, now) }`: ids de 1 a 65535, e um id liberado só volta 60 s depois.
  - Tipos:
    - `PlayerIdentity = { userId: string; nick: string; team: number; look: number }`
    - `QueuedInput = MoveInput & { seq: number }`
    - `Player = PlayerIdentity & { id, x, z, yaw, anim, queue: QueuedInput[], budget, lastSeq, idleTicks, token: string, connected: boolean, leftAt: number }`
  - `class World`:
    - estado: `players: Map<number, Player>`, `grid: SpatialGrid`, `tick: number`;
    - métodos: `join(who, now): Player | null`, `leave(p, now)`, `queueInput(p, input)`, `step(now)`, `connectedCount(): number`, `teamCounts(n): number[]`.

**Decisão:** com login obrigatório, a retomada é **pela conta**. Se a mesma conta entrar de novo enquanto o personagem ainda existe (até `RESUME_MS` depois da queda, ou em outra aba), ela recebe o mesmo personagem. O `token` continua sendo gerado e enviado no `welcome`, como diz a spec, mas não é necessário para retomar.

- [ ] **Passo 1: escrever o teste que falha (`server/world.test.ts`)**

```ts
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
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run server/world.test.ts`
Esperado: FALHA ("Failed to load ./ids.ts").

- [ ] **Passo 3: criar `server/ids.ts`**

```ts
import { ID_REUSE_MS } from '../shared/constants.ts';

/** Ids u16 (1..65535). Um id liberado só volta depois de ID_REUSE_MS, para não herdar nomes em cache. */
export class IdAllocator {
  private next = 1;
  private readonly released: { id: number; at: number }[] = [];

  alloc(now: number): number | null {
    const first = this.released[0];
    if (first && now - first.at >= ID_REUSE_MS) return this.released.shift()!.id;
    if (this.next <= 65535) return this.next++;
    return null;
  }

  release(id: number, now: number): void {
    this.released.push({ id, at: now });
  }
}
```

- [ ] **Passo 4: criar `server/world.ts`**

```ts
import { randomBytes } from 'node:crypto';
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
      token: randomBytes(16).toString('base64url'), connected: true, leftAt: 0,
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
```

- [ ] **Passo 5: rodar e ver passar**

Rodar: `npx vitest run server/world.test.ts`
Esperado: todos PASSAM.

- [ ] **Passo 6: commit**

```bash
git add server/ids.ts server/world.ts server/world.test.ts
git commit -m "feat(server): mundo autoritativo com fila de inputs, orçamento por tick e retomada

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 6: Chat e log do chat

**Arquivos:**
- Criar: `server/chat.ts`, `server/chat-log.ts`, `server/blocked-words.json`
- Teste: `server/chat.test.ts`

**Interfaces:**
- Consome: `ChatEntry` (Tarefa 2), as constantes de chat.
- Produz:
  - `cleanText(s): string`, `normalizeWord(s): string`, `hasBlockedWord(s): boolean`. A validação de apelido (subprojeto de contas) também vai usar.
  - `class Chat`:
    - `new Chat(log?)`;
    - `post(from: { id, nick, team }, raw, now)` devolve `{ ok: true; entry } | { ok: false; code: 'rate_limited' | 'chat_blocked' } | null` (null = mensagem vazia, ignorar);
    - `recent(): ChatEntry[]`, `forget(id)`.
  - `createChatLog(dir, now?): (e: ChatEntry) => void`: grava `chat-AAAA-MM-DD.jsonl` (dia em UTC) e apaga os arquivos com mais de `CHAT_LOG_DAYS` dias. Não grava IP.

- [ ] **Passo 1: criar `server/blocked-words.json`** (lista inicial, editável; as palavras ficam já sem acento e em minúsculas)

```json
[
  "porra", "caralho", "buceta", "puta", "puto", "fdp", "pqp", "vsf", "vtnc",
  "viado", "viadinho", "bicha", "sapatao", "traveco", "macaco", "crioulo",
  "retardado", "mongoloide", "vagabunda", "piranha", "arrombado", "cuzao",
  "estupro", "estuprador"
]
```

- [ ] **Passo 2: escrever o teste que falha (`server/chat.test.ts`)**

```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHAT_HISTORY, CHAT_MIN_INTERVAL_MS } from '../shared/constants.ts';
import type { ChatEntry } from '../shared/protocol.ts';
import { Chat, cleanText, hasBlockedWord } from './chat.ts';
import { createChatLog } from './chat-log.ts';

const ana = { id: 1, nick: 'Ana', team: 0 };

describe('texto', () => {
  it('limpa espaços e caracteres de controle', () => {
    expect(cleanText('  oi \n\t  gente\u0000 ')).toBe('oi gente');
  });
  it('detecta palavra bloqueada ignorando acento e maiúsculas', () => {
    expect(hasBlockedWord('que PÓRRA é essa')).toBe(true);
    expect(hasBlockedWord('Esplanada lotada hoje')).toBe(false);
    expect(hasBlockedWord('caralhinho')).toBe(false); // só palavra inteira
  });
});

describe('Chat', () => {
  it('publica e respeita o intervalo mínimo', () => {
    const chat = new Chat();
    const r = chat.post(ana, '  bom   dia ', 1000);
    expect(r).toEqual({ ok: true, entry: { id: 1, nick: 'Ana', team: 0, text: 'bom dia', at: 1000 } });
    expect(chat.post(ana, 'de novo', 1000 + CHAT_MIN_INTERVAL_MS - 1)).toEqual({ ok: false, code: 'rate_limited' });
    expect(chat.post(ana, 'de novo', 1000 + CHAT_MIN_INTERVAL_MS)?.ok).toBe(true);
  });
  it('bloqueia palavrão sem consumir o intervalo', () => {
    const chat = new Chat();
    expect(chat.post(ana, 'porra', 0)).toEqual({ ok: false, code: 'chat_blocked' });
    expect(chat.post(ana, 'ok', 1)?.ok).toBe(true);
  });
  it('ignora mensagem vazia', () => {
    expect(new Chat().post(ana, '   ', 0)).toBeNull();
  });
  it('guarda só as últimas CHAT_HISTORY e chama o log', () => {
    const logged: ChatEntry[] = [];
    const chat = new Chat((e) => logged.push(e));
    for (let i = 0; i < CHAT_HISTORY + 5; i++) chat.post({ ...ana, id: i }, `m${i}`, i);
    expect(chat.recent().length).toBe(CHAT_HISTORY);
    expect(chat.recent()[0].text).toBe('m5');
    expect(logged.length).toBe(CHAT_HISTORY + 5);
  });
});

describe('createChatLog', () => {
  it('grava uma linha JSON por mensagem no arquivo do dia', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlog-'));
    const at = Date.UTC(2026, 9, 30, 12);
    const log = createChatLog(dir, () => at);
    log({ id: 1, nick: 'Ana', team: 0, text: 'oi', at });
    const lines = readFileSync(join(dir, 'chat-2026-10-30.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(lines[0])).toEqual({ id: 1, nick: 'Ana', team: 0, text: 'oi', at });
  });
  it('apaga arquivos com mais de 7 dias', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatlog-'));
    writeFileSync(join(dir, 'chat-2026-10-01.jsonl'), '');
    writeFileSync(join(dir, 'chat-2026-10-29.jsonl'), '');
    createChatLog(dir, () => Date.UTC(2026, 9, 30, 12));
    expect(existsSync(join(dir, 'chat-2026-10-01.jsonl'))).toBe(false);
    expect(existsSync(join(dir, 'chat-2026-10-29.jsonl'))).toBe(true);
  });
});
```

- [ ] **Passo 3: rodar e ver falhar**

Rodar: `npx vitest run server/chat.test.ts`
Esperado: FALHA ("Failed to load ./chat.ts").

- [ ] **Passo 4: criar `server/chat.ts`**

```ts
import { CHAT_HISTORY, CHAT_MAX_LEN, CHAT_MIN_INTERVAL_MS } from '../shared/constants.ts';
import type { ChatEntry } from '../shared/protocol.ts';
import blockedList from './blocked-words.json' with { type: 'json' };

export function normalizeWord(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const BLOCKED = new Set(blockedList.map(normalizeWord));

export function cleanText(s: string): string {
  return s.replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Compara palavras inteiras, sem acento e sem diferenciar maiúsculas. */
export function hasBlockedWord(s: string): boolean {
  for (const w of normalizeWord(s).split(/[^\p{L}\p{N}]+/u)) if (w && BLOCKED.has(w)) return true;
  return false;
}

export type ChatSender = { id: number; nick: string; team: number };
export type PostResult = { ok: true; entry: ChatEntry } | { ok: false; code: 'rate_limited' | 'chat_blocked' };

export class Chat {
  private readonly history: ChatEntry[] = [];
  private readonly lastAt = new Map<number, number>();
  private readonly log: (e: ChatEntry) => void;

  constructor(log: (e: ChatEntry) => void = () => {}) {
    this.log = log;
  }

  /** null = mensagem vazia (ignorar sem erro). */
  post(from: ChatSender, raw: string, now: number): PostResult | null {
    const text = cleanText(raw).slice(0, CHAT_MAX_LEN);
    if (!text) return null;
    const last = this.lastAt.get(from.id);
    if (last !== undefined && now - last < CHAT_MIN_INTERVAL_MS) return { ok: false, code: 'rate_limited' };
    if (hasBlockedWord(text)) return { ok: false, code: 'chat_blocked' };
    this.lastAt.set(from.id, now);
    const entry: ChatEntry = { id: from.id, nick: from.nick, team: from.team, text, at: now };
    this.history.push(entry);
    if (this.history.length > CHAT_HISTORY) this.history.shift();
    this.log(entry);
    return { ok: true, entry };
  }

  recent(): ChatEntry[] {
    return [...this.history];
  }

  forget(id: number): void {
    this.lastAt.delete(id);
  }
}
```

- [ ] **Passo 5: criar `server/chat-log.ts`**

```ts
import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CHAT_LOG_DAYS } from '../shared/constants.ts';
import type { ChatEntry } from '../shared/protocol.ts';

const DAY_MS = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Log do chat para prova em denúncias: um arquivo por dia (UTC), sem IP, apagado após CHAT_LOG_DAYS. */
export function createChatLog(dir: string, now: () => number = Date.now): (e: ChatEntry) => void {
  mkdirSync(dir, { recursive: true });
  const prune = () => {
    const oldest = dayOf(now() - CHAT_LOG_DAYS * DAY_MS);
    for (const f of readdirSync(dir)) {
      const m = /^chat-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1] < oldest) unlinkSync(join(dir, f));
    }
  };
  prune();
  let lastDay = dayOf(now());
  return (e) => {
    const day = dayOf(e.at);
    if (day !== lastDay) {
      lastDay = day;
      prune();
    }
    try {
      appendFileSync(join(dir, `chat-${day}.jsonl`), JSON.stringify(e) + '\n');
    } catch (err) {
      console.error('chat log:', err);
    }
  };
}
```

- [ ] **Passo 6: rodar e ver passar**

Rodar: `npx vitest run server/chat.test.ts`
Esperado: todos PASSAM.

- [ ] **Passo 7: commit**

```bash
git add server/chat.ts server/chat-log.ts server/blocked-words.json server/chat.test.ts
git commit -m "feat(server): chat com filtro, intervalo, histórico e log de 7 dias

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Tarefa 7: Autenticação (JWT do Supabase e login de desenvolvimento) e perfis

**Arquivos:**
- Criar: `server/auth.ts`, `server/profiles.ts`, `supabase/migrations/0001_profiles.sql`
- Teste: `server/auth.test.ts`

**Interfaces:**
- Produz:
  - `profiles.ts`:
    - tipo `Profile = { userId; nick; team; look; bannedUntil: number | null }` (estruturalmente compatível com `PlayerIdentity` da Tarefa 5);
    - `interface ProfileStore { get(userId): Promise<Profile | null> }`;
    - `class MemoryProfileStore implements ProfileStore { put(p) }`;
    - `createSupabaseProfileStore(url, serviceRoleKey): ProfileStore`.
  - `auth.ts`:
    - `type VerifyToken = (token: string) => Promise<{ userId: string } | null>`;
    - `createSupabaseVerifier(supabaseUrl, keys?)`, em que `keys` é opcional e só serve para testes;
    - `createDevVerifier(store: MemoryProfileStore)`: aceita `dev:<apelido>:<time>` e cria o perfil `dev-<apelido em minúsculas>`.

- [ ] **Passo 1: escrever o teste que falha (`server/auth.test.ts`)**

```ts
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createDevVerifier, createSupabaseVerifier } from './auth.ts';
import { MemoryProfileStore } from './profiles.ts';

const URL_ = 'https://exemplo.supabase.co';
const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
const verify = createSupabaseVerifier(URL_, createLocalJWKSet({ keys: [jwk] }));

function token(opts: { aud?: string; iss?: string; exp?: string | number } = {}) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject('user-1')
    .setIssuer(opts.iss ?? `${URL_}/auth/v1`)
    .setAudience(opts.aud ?? 'authenticated')
    .setExpirationTime(opts.exp ?? '1h')
    .sign(privateKey);
}

describe('createSupabaseVerifier', () => {
  it('aceita token válido', async () => {
    expect(await verify(await token())).toEqual({ userId: 'user-1' });
  });
  it('recusa audiência, emissor ou validade errados e lixo', async () => {
    expect(await verify(await token({ aud: 'anon' }))).toBeNull();
    expect(await verify(await token({ iss: 'https://outro.supabase.co/auth/v1' }))).toBeNull();
    expect(await verify(await token({ exp: Math.floor(Date.now() / 1000) - 60 }))).toBeNull();
    expect(await verify('não-é-jwt')).toBeNull();
  });
});

describe('createDevVerifier', () => {
  it('cria perfil em memória a partir do token dev', async () => {
    const store = new MemoryProfileStore();
    const dev = createDevVerifier(store);
    expect(await dev('dev:Ana:1')).toEqual({ userId: 'dev-ana' });
    expect(await store.get('dev-ana')).toEqual({ userId: 'dev-ana', nick: 'Ana', team: 1, look: 0, bannedUntil: null });
  });
  it('recusa formatos inválidos', async () => {
    const dev = createDevVerifier(new MemoryProfileStore());
    expect(await dev('dev:A:1')).toBeNull();
    expect(await dev('qualquer')).toBeNull();
  });
  it('perfil desconhecido é null', async () => {
    expect(await new MemoryProfileStore().get('x')).toBeNull();
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run server/auth.test.ts`
Esperado: FALHA ("Failed to load ./auth.ts").

- [ ] **Passo 3: criar `server/profiles.ts`**

```ts
import { createClient } from '@supabase/supabase-js';

export type Profile = { userId: string; nick: string; team: number; look: number; bannedUntil: number | null };

export interface ProfileStore {
  get(userId: string): Promise<Profile | null>;
}

export class MemoryProfileStore implements ProfileStore {
  private readonly map = new Map<string, Profile>();

  put(p: Profile): void {
    this.map.set(p.userId, p);
  }

  async get(userId: string): Promise<Profile | null> {
    return this.map.get(userId) ?? null;
  }
}

type Row = { id: string; nick: string; team: number; look: number; banned_until: string | null };

/** Lê `profiles` com a service role. Só o servidor usa esta chave. */
export function createSupabaseProfileStore(url: string, serviceRoleKey: string): ProfileStore {
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async get(userId) {
      const { data, error } = await db
        .from('profiles')
        .select('id,nick,team,look,banned_until')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw new Error(`profiles: ${error.message}`);
      const row = data as Row | null;
      if (!row) return null;
      return {
        userId: row.id, nick: row.nick, team: row.team, look: row.look,
        bannedUntil: row.banned_until ? Date.parse(row.banned_until) : null,
      };
    },
  };
}
```

- [ ] **Passo 4: criar `server/auth.ts`**

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { MemoryProfileStore } from './profiles.ts';

export type VerifyToken = (token: string) => Promise<{ userId: string } | null>;

/** Valida o access token do Supabase pelas chaves públicas (JWKS) do projeto. */
export function createSupabaseVerifier(supabaseUrl: string, keys?: JWTVerifyGetKey): VerifyToken {
  const issuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const getKey = keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, getKey, { issuer, audience: 'authenticated' });
      return typeof payload.sub === 'string' && payload.sub ? { userId: payload.sub } : null;
    } catch {
      return null;
    }
  };
}

const DEV_TOKEN = /^dev:([^:]{2,20}):(\d{1,2})$/;

/** Só para desenvolvimento e bots (DEV_AUTH=1). O app recusa iniciar com isso em produção. */
export function createDevVerifier(store: MemoryProfileStore): VerifyToken {
  return async (token) => {
    const m = DEV_TOKEN.exec(token);
    if (!m) return null;
    const userId = `dev-${m[1].toLowerCase()}`;
    store.put({ userId, nick: m[1], team: Number(m[2]), look: 0, bannedUntil: null });
    return { userId };
  };
}
```

- [ ] **Passo 5: criar `supabase/migrations/0001_profiles.sql`**

```sql
-- Perfis de jogador. Escrita só pelo nosso servidor (service role).
-- RLS ligado e sem políticas: anon/authenticated não leem nem escrevem.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nick text not null check (char_length(nick) between 2 and 20),
  nick_key text not null unique,
  team smallint not null check (team >= 0),
  look smallint not null default 0 check (look >= 0),
  birth_date date,
  role text not null default 'player' check (role in ('player', 'staff')),
  banned_until timestamptz,
  team_changed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
```

- [ ] **Passo 6: rodar e ver passar**

Rodar: `npx vitest run server/auth.test.ts`
Esperado: todos PASSAM.

- [ ] **Passo 7: commit**

```bash
git add server/auth.ts server/profiles.ts server/auth.test.ts supabase/
git commit -m "feat(server): verificação de JWT do Supabase, login dev e leitura de perfis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 8: Proteções de rede

**Arquivos:**
- Criar: `server/netguard.ts`
- Teste: `server/netguard.test.ts`

**Interfaces:**
- Produz:
  - `class RateLimiter`: `new RateLimiter(ratePerSec, burst, now)` e `take(now): boolean`;
  - `class IpCounter`: `new IpCounter(max)`, `tryAdd(ip): boolean` e `remove(ip)`;
  - `clientIp(remoteAddress, cfConnectingIp): string`;
  - `isCloudflare(ip): boolean`;
  - `originAllowed(origin, allowed): boolean`.

- [ ] **Passo 1: escrever o teste que falha (`server/netguard.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { clientIp, IpCounter, isCloudflare, originAllowed, RateLimiter } from './netguard.ts';

describe('RateLimiter', () => {
  it('permite rajada e depois recarrega com o tempo', () => {
    const r = new RateLimiter(1, 3, 0);
    expect([r.take(0), r.take(0), r.take(0), r.take(0)]).toEqual([true, true, true, false]);
    expect(r.take(900)).toBe(false);
    expect(r.take(1001)).toBe(true);
  });
});

describe('IpCounter', () => {
  it('limita conexões simultâneas por IP', () => {
    const c = new IpCounter(2);
    expect([c.tryAdd('1.1.1.1'), c.tryAdd('1.1.1.1'), c.tryAdd('1.1.1.1')]).toEqual([true, true, false]);
    c.remove('1.1.1.1');
    expect(c.tryAdd('1.1.1.1')).toBe(true);
  });
});

describe('clientIp', () => {
  it('confia no CF-Connecting-IP só se a conexão veio do Cloudflare', () => {
    expect(isCloudflare('173.245.48.5')).toBe(true);
    expect(isCloudflare('8.8.8.8')).toBe(false);
    expect(clientIp('173.245.48.5', '200.1.2.3')).toBe('200.1.2.3');
    expect(clientIp('::ffff:173.245.48.5', '200.1.2.3')).toBe('200.1.2.3');
    expect(clientIp('8.8.8.8', '200.1.2.3')).toBe('8.8.8.8');
    expect(clientIp('173.245.48.5', 'lixo')).toBe('173.245.48.5');
    expect(clientIp('::ffff:10.0.0.1', undefined)).toBe('10.0.0.1');
  });
});

describe('originAllowed', () => {
  it('exige Origin exatamente igual a um da lista', () => {
    expect(originAllowed('https://jogo.com', ['https://jogo.com'])).toBe(true);
    expect(originAllowed('https://jogo.com.evil.io', ['https://jogo.com'])).toBe(false);
    expect(originAllowed(undefined, ['https://jogo.com'])).toBe(false);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run server/netguard.test.ts`
Esperado: FALHA ("Failed to load ./netguard.ts").

- [ ] **Passo 3: criar `server/netguard.ts`**

```ts
import { BlockList, isIP } from 'node:net';

export class RateLimiter {
  private tokens: number;
  private last: number;
  private readonly rate: number;
  private readonly burst: number;

  constructor(ratePerSec: number, burst: number, now: number) {
    this.rate = ratePerSec;
    this.burst = burst;
    this.tokens = burst;
    this.last = now;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class IpCounter {
  private readonly counts = new Map<string, number>();
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  tryAdd(ip: string): boolean {
    const n = this.counts.get(ip) ?? 0;
    if (n >= this.max) return false;
    this.counts.set(ip, n + 1);
    return true;
  }

  remove(ip: string): void {
    const n = (this.counts.get(ip) ?? 0) - 1;
    if (n <= 0) this.counts.delete(ip);
    else this.counts.set(ip, n);
  }
}

// Faixas publicadas em https://www.cloudflare.com/ips/ (manter em dia).
const CF_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CF_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];
const cloudflare = new BlockList();
for (const c of CF_V4) {
  const [addr, len] = c.split('/');
  cloudflare.addSubnet(addr, Number(len), 'ipv4');
}
for (const c of CF_V6) {
  const [addr, len] = c.split('/');
  cloudflare.addSubnet(addr, Number(len), 'ipv6');
}

function normalizeIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

export function isCloudflare(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return cloudflare.check(ip, 'ipv4');
  if (v === 6) return cloudflare.check(ip, 'ipv6');
  return false;
}

/** IP real do jogador. CF-Connecting-IP só vale se a conexão veio de um IP do Cloudflare. */
export function clientIp(remote: string | undefined, cfHeader: string | string[] | undefined): string {
  const ip = normalizeIp(remote);
  const cf = (Array.isArray(cfHeader) ? cfHeader[0] : cfHeader)?.trim();
  if (cf && isIP(cf) && isCloudflare(ip)) return normalizeIp(cf);
  return ip;
}

export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  return origin !== undefined && allowed.includes(origin);
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run server/netguard.test.ts`
Esperado: todos PASSAM.

- [ ] **Passo 5: commit**

```bash
git add server/netguard.ts server/netguard.test.ts
git commit -m "feat(server): limite de taxa, conexões por IP, IP real via Cloudflare e Origin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Tarefa 9: Hub de sessões (mensagens, join, snapshots, stats, timeouts)

**Arquivos:**
- Criar: `server/session.ts`
- Teste: `server/session.test.ts`

**Interfaces:**
- Consome:
  - `World`, `Player` (Tarefa 5);
  - `Chat` (Tarefa 6);
  - `VerifyToken`, `createDevVerifier` (Tarefa 7);
  - `ProfileStore`, `MemoryProfileStore`, `Profile` (Tarefa 7);
  - `RateLimiter` (Tarefa 8);
  - `pickNear`, `pickFar` (Tarefa 4);
  - protocolo (Tarefa 2).
- Produz:
  - `interface Conn { send(data: string | Uint8Array): void; close(code: number, reason: string): void; bufferedAmount(): number }`;
  - tipo `Client` (estado de uma conexão);
  - `class Hub`, criada com `new Hub({ world, chat, verify, profiles, teams, maxPlayers? })`. Métodos:
    - `open(conn, now): Client`;
    - `message(client, raw: string | null, now): Promise<void>` (`raw = null` para frame binário, que é inválido);
    - `close(client, now)`;
    - `tick(now)`;
    - `stats()`;
    - `shutdown()`.

**Códigos de fechamento:**

| Código | Motivo |
|---|---|
| 4000 | tempo esgotado |
| 4001 | conectado em outra aba |
| 4002 | muitas mensagens |
| 4003 | mensagens inválidas |
| 1012 | reiniciando |

- [ ] **Passo 1: escrever o teste que falha (`server/session.test.ts`)**

```ts
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
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run server/session.test.ts`
Esperado: FALHA ("Failed to load ./session.ts").

- [ ] **Passo 3: criar `server/session.ts`**

```ts
import {
  FAR_HZ, LOBBY_STATS_MS, MAX_INVALID_STREAK, MAX_MSGS_PER_SEC, MAX_PLAYERS, PROTOCOL_VERSION, TICK_HZ, TIMEOUT_MS,
} from '../shared/constants.ts';
import {
  encodeFar, encodeNear, parseClientMessage,
  type Account, type ErrorCode, type FarActor, type NearActor, type Person, type ServerMessage,
} from '../shared/protocol.ts';
import type { VerifyToken } from './auth.ts';
import type { Chat } from './chat.ts';
import { pickFar, pickNear } from './interest.ts';
import { RateLimiter } from './netguard.ts';
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
          this.world.queueInput(c.player, { dx: m.dx, dz: m.dz, run: m.run, seq: m.seq });
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
      near.push({ id, x: p.x, z: p.z, yaw: p.yaw, anim: p.anim, team: p.team, look: p.look });
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
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `npx vitest run server/session.test.ts`
Esperado: todos PASSAM.

- [ ] **Passo 5: commit**

```bash
git add server/session.ts server/session.test.ts
git commit -m "feat(server): hub de sessões com join autenticado, snapshots, chat e proteções

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Tarefa 10: Servidor HTTP/WebSocket, ponto de entrada e teste de integração

**Arquivos:**
- Criar: `server/static.ts`, `server/app.ts`, `server/index.ts`, `.env.example`
- Teste: `server/app.test.ts`

**Interfaces:**
- Consome: `Hub`, `Conn` (Tarefa 9); `World` (Tarefa 5); `Chat` (Tarefa 6); `createChatLog` (Tarefa 6); verificadores e stores (Tarefa 7); `IpCounter`, `clientIp`, `originAllowed` (Tarefa 8); `Collider` (Tarefa 3).
- Produz:
  - `createStatic(dir)`;
  - `startServer(opts: AppOptions): Promise<App>`, com `App = { port; hub; close(): Promise<void> }`;
  - `GET /healthz`;
  - `GET /metrics`, só de loopback: `{ clients, online, tick, tickMs: { p50, p95, max } }`;
  - entrada `node server/index.ts`, configurada por variáveis de ambiente.

- [ ] **Passo 1: escrever o teste que falha (`server/app.test.ts`)**

```ts
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
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run server/app.test.ts`
Esperado: FALHA ("Failed to load ./app.ts").

- [ ] **Passo 3: criar `server/static.ts`**

```ts
import { createReadStream, statSync, type Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws: wss: https://*.supabase.co", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'",
].join('; ');

function statOrNull(file: string): Stats | null {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

/** Serve client/dist. Rotas sem extensão caem no index.html. */
export function createStatic(dir: string) {
  const root = resolve(dir);
  return (req: IncomingMessage, res: ServerResponse): void => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = resolve(join(root, normalize(path)));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    let st = statOrNull(file);
    if (st?.isDirectory()) {
      file = join(file, 'index.html');
      st = statOrNull(file);
    }
    if (!st && !extname(path)) {
      file = join(root, 'index.html');
      st = statOrNull(file);
    }
    if (!st) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    const ext = extname(file);
    const headers: Record<string, string | number> = {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    };
    if (ext === '.html') {
      headers['content-security-policy'] = CSP;
      headers['x-frame-options'] = 'DENY';
      headers['referrer-policy'] = 'strict-origin-when-cross-origin';
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  };
}
```

- [ ] **Passo 4: criar `server/app.ts`**

```ts
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
};

export type App = { port: number; hub: Hub; close(): Promise<void> };

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export async function startServer(o: AppOptions): Promise<App> {
  const world = new World(o.collider);
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
```

- [ ] **Passo 5: rodar o teste de integração**

Rodar: `npx vitest run server/app.test.ts`
Esperado: todos PASSAM.

- [ ] **Passo 6: criar `server/index.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Collider, type MapData } from '../shared/map.ts';
import teams from '../shared/teams.json' with { type: 'json' };
import { startServer } from './app.ts';
import { createDevVerifier, createSupabaseVerifier, type VerifyToken } from './auth.ts';
import { createChatLog } from './chat-log.ts';
import { createSupabaseProfileStore, MemoryProfileStore, type ProfileStore } from './profiles.ts';

const env = process.env;
const devAuth = env.DEV_AUTH === '1';
if (devAuth && env.NODE_ENV === 'production') {
  console.error('DEV_AUTH=1 não é permitido em produção.');
  process.exit(1);
}

let verify: VerifyToken;
let profiles: ProfileStore;
if (devAuth) {
  const store = new MemoryProfileStore();
  verify = createDevVerifier(store);
  profiles = store;
  console.warn('Atenção: login de desenvolvimento ativo (DEV_AUTH=1).');
} else if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  verify = createSupabaseVerifier(env.SUPABASE_URL);
  profiles = createSupabaseProfileStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
} else {
  console.error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY, ou use DEV_AUTH=1 em desenvolvimento.');
  process.exit(1);
}

const mapFile = fileURLToPath(new URL('../shared/map.json', import.meta.url));
const collider = existsSync(mapFile) ? Collider.fromMap(JSON.parse(readFileSync(mapFile, 'utf8')) as MapData) : null;
if (!collider) console.warn('shared/map.json não encontrado: sem colisão (gere com npm run map).');

const distDir = fileURLToPath(new URL('../client/dist', import.meta.url));

const app = await startServer({
  port: Number(env.PORT ?? 8787),
  verify,
  profiles,
  teams: teams.length,
  collider,
  allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:8787')
    .split(',').map((s) => s.trim()).filter(Boolean),
  staticDir: existsSync(distDir) ? distDir : null,
  maxConnPerIp: env.MAX_CONN_PER_IP ? Number(env.MAX_CONN_PER_IP) : undefined,
  chatLog: createChatLog(env.CHAT_LOG_DIR ?? 'logs'),
});
console.log(`Servidor no ar: http://localhost:${app.port}`);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    console.log('Encerrando…');
    app.close().then(() => process.exit(0));
  });
}
```

- [ ] **Passo 7: criar `.env.example` e acrescentar `logs/` ao `.gitignore`**

`.env.example`:
```bash
# Servidor
PORT=8787
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8787
# Desenvolvimento sem Supabase (NUNCA em produção):
DEV_AUTH=1
# Produção (deixe DEV_AUTH vazio):
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
# Só para o teste de carga:
# MAX_CONN_PER_IP=2000
CHAT_LOG_DIR=logs
```

Acrescentar ao `.gitignore`:
```
logs/
```

- [ ] **Passo 8: verificar à mão que o servidor sobe**

Rodar: `cp .env.example .env` e depois `npm run start`
Esperado: o log mostra "Atenção: login de desenvolvimento ativo", o aviso de `map.json` ausente (o mapa vem na Tarefa 11) e "Servidor no ar: http://localhost:8787". Em seguida, `curl http://localhost:8787/healthz` responde `ok`. Encerre com Ctrl+C.

- [ ] **Passo 9: rodar todos os testes e fazer commit**

Rodar: `npm test`
Esperado: todos PASSAM.

```bash
git add server/static.ts server/app.ts server/index.ts server/app.test.ts .env.example .gitignore
git commit -m "feat(server): servidor HTTP/WS com tick, métricas, estáticos e entrada configurável

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Tarefa 11: Mapa da Esplanada (OpenStreetMap → `shared/map.json`)

**Arquivos:**
- Criar: `shared/landmarks.ts`, `tools/osm.ts`, `tools/osm-esplanada.ts`
- Gerar: `shared/map.json`
- Teste: `tools/osm.test.ts`

**Interfaces:**
- Consome: `project` (Tarefa 1); `MapData`, `Collider` (Tarefa 3).
- Produz:
  - `LANDMARKS: Landmark[]`, com `Landmark = { name; center: Pt; clearRadius; footprint: Pt[] }`. Hoje são o Congresso e a Catedral, e o cliente os usa na Tarefa 13;
  - `BBOX`, `overpassQuery()`, `buildingHeight(tags)`, `roadWidth(tags)`, `toMapData(osm): MapData`;
  - o arquivo `shared/map.json`.

- [ ] **Passo 1: criar `shared/landmarks.ts`**

```ts
import { project } from './geo.ts';
import type { Pt } from './geometry.ts';

export type Landmark = { name: string; center: Pt; clearRadius: number; footprint: Pt[] };

const rect = (cx: number, cz: number, w: number, d: number): Pt[] => [
  [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
];
const circle = (cx: number, cz: number, r: number, n = 16): Pt[] =>
  Array.from({ length: n }, (_, i): Pt => [cx + Math.cos((i / n) * Math.PI * 2) * r, cz + Math.sin((i / n) * Math.PI * 2) * r]);

const congresso = project(-15.7997, -47.8641);
const catedral = project(-15.7981, -47.8753);

/** Modelados à mão no cliente. O mapa remove os prédios do OSM dentro de clearRadius e usa footprint como colisão. */
export const LANDMARKS: Landmark[] = [
  // Plataforma norte-sul (cúpula do Senado ao norte, tigela da Câmara ao sul) e torres a leste.
  { name: 'Congresso Nacional', center: congresso, clearRadius: 130, footprint: rect(congresso[0] + 15, congresso[1], 110, 200) },
  { name: 'Catedral', center: catedral, clearRadius: 45, footprint: circle(catedral[0], catedral[1], 30) },
];
```

- [ ] **Passo 2: escrever o teste que falha (`tools/osm.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { ORIGIN } from '../shared/geo.ts';
import { LANDMARKS } from '../shared/landmarks.ts';
import { buildingHeight, overpassQuery, roadWidth, toMapData, type OsmWay } from './osm.ts';

const square = (lat: number, lon: number, d = 0.0001) => [
  { lat, lon }, { lat, lon: lon + d }, { lat: lat + d, lon: lon + d }, { lat: lat + d, lon }, { lat, lon },
];

describe('tags', () => {
  it('altura do prédio', () => {
    expect(buildingHeight({ height: '45 m' })).toBe(45);
    expect(buildingHeight({ 'building:levels': '10' })).toBeCloseTo(32);
    expect(buildingHeight({})).toBe(12);
  });
  it('largura da via', () => {
    expect(roadWidth({ highway: 'primary', width: '8' })).toBe(8);
    expect(roadWidth({ highway: 'primary', lanes: '3' })).toBeCloseTo(10.5);
    expect(roadWidth({ highway: 'trunk_link' })).toBe(10.5);
    expect(roadWidth({ highway: 'footway' })).toBe(2.5);
    expect(roadWidth({ highway: 'desconhecida' })).toBe(5);
  });
  it('a consulta pede geometria', () => {
    expect(overpassQuery()).toContain('out geom;');
  });
});

describe('toMapData', () => {
  const elements: OsmWay[] = [
    { type: 'way', id: 1, tags: { building: 'yes', 'building:levels': '10' }, geometry: square(ORIGIN.lat + 0.001, ORIGIN.lon) },
    { type: 'way', id: 2, tags: { building: 'yes' }, geometry: square(-15.7981, -47.8753, 0.00005) }, // dentro da Catedral
    { type: 'way', id: 3, tags: { highway: 'trunk', lanes: '3' }, geometry: [{ lat: -15.8, lon: -47.87 }, { lat: -15.8, lon: -47.86 }] },
    { type: 'way', id: 4, tags: { natural: 'water' }, geometry: square(-15.801, -47.865) },
    { type: 'way', id: 5, tags: { leisure: 'park' }, geometry: square(-15.797, -47.872) },
    { type: 'way', id: 6, tags: { building: 'yes' } }, // sem geometria
  ];
  const map = toMapData({ elements });

  it('converte prédios, vias e áreas; remove prédios dentro dos marcos', () => {
    expect(map.buildings.length).toBe(1);
    expect(map.buildings[0].outline.length).toBe(4); // ponto repetido de fechamento removido
    expect(map.buildings[0].height).toBe(32);
    expect(map.roads).toEqual([expect.objectContaining({ width: 10.5 })]);
    expect(map.areas.map((a) => a.kind).sort()).toEqual(['grass', 'water']);
  });
  it('limites envolvem a origem e marcos viram sólidos', () => {
    const b = map.bounds;
    expect(b.minX).toBeLessThan(0);
    expect(b.maxX).toBeGreaterThan(0);
    expect(b.minZ).toBeLessThan(0);
    expect(b.maxZ).toBeGreaterThan(0);
    expect(Math.max(-b.minX, b.maxX, -b.minZ, b.maxZ)).toBeLessThan(1638); // cabe no int16 do protocolo
    expect(map.solids.length).toBe(LANDMARKS.length);
  });
});
```

- [ ] **Passo 3: rodar e ver falhar**

Rodar: `npx vitest run tools/osm.test.ts`
Esperado: FALHA ("Failed to load ./osm.ts").

- [ ] **Passo 4: criar `tools/osm.ts`**

```ts
import { project } from '../shared/geo.ts';
import type { Pt } from '../shared/geometry.ts';
import { LANDMARKS } from '../shared/landmarks.ts';
import type { Area, Building, MapData, Road } from '../shared/map.ts';

/** Da Rodoviária do Plano Piloto à Praça dos Três Poderes. */
export const BBOX = { south: -15.806, west: -47.884, north: -15.79, east: -47.858 } as const;

export type OsmWay = { type: 'way'; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] };
export type OverpassResult = { elements: OsmWay[] };

export function overpassQuery(b = BBOX): string {
  const box = `(${b.south},${b.west},${b.north},${b.east})`;
  return `[out:json][timeout:90];(way["building"]${box};way["highway"]${box};way["natural"="water"]${box};`
    + `way["landuse"="grass"]${box};way["leisure"="park"]${box};);out geom;`;
}

const num = (s?: string) => (s ? parseFloat(s.replace(',', '.')) : NaN);

export function buildingHeight(tags: Record<string, string>): number {
  const h = num(tags.height);
  if (h > 0) return h;
  const levels = num(tags['building:levels']);
  if (levels > 0) return levels * 3.2;
  return 12;
}

const ROAD_DEFAULT: Record<string, number> = {
  motorway: 14, trunk: 10.5, primary: 10.5, secondary: 7, tertiary: 7, residential: 6, unclassified: 6,
  service: 4, pedestrian: 4, footway: 2.5, cycleway: 2.5, path: 2, steps: 2,
};

export function roadWidth(tags: Record<string, string>): number {
  const w = num(tags.width);
  if (w > 0) return w;
  const lanes = num(tags.lanes);
  if (lanes > 0) return lanes * 3.5;
  return ROAD_DEFAULT[(tags.highway ?? '').replace(/_link$/, '')] ?? 5;
}

function ring(geometry: { lat: number; lon: number }[]): Pt[] {
  const pts = geometry.map((g) => project(g.lat, g.lon));
  const last = pts.at(-1);
  if (pts.length > 1 && last && pts[0][0] === last[0] && pts[0][1] === last[1]) pts.pop();
  return pts;
}

function centroid(pts: Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

export function toMapData(osm: OverpassResult, b = BBOX): MapData {
  const [minX, maxZ] = project(b.south, b.west);
  const [maxX, minZ] = project(b.north, b.east);
  const roads: Road[] = [];
  const buildings: Building[] = [];
  const areas: Area[] = [];
  for (const el of osm.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const t = el.tags ?? {};
    if (t.building) {
      const outline = ring(el.geometry);
      if (outline.length < 3) continue;
      const [cx, cz] = centroid(outline);
      if (LANDMARKS.some((l) => Math.hypot(cx - l.center[0], cz - l.center[1]) < l.clearRadius)) continue;
      buildings.push({ outline, height: Math.round(buildingHeight(t) * 10) / 10 });
    } else if (t.highway && t.area !== 'yes') {
      roads.push({ line: el.geometry.map((g) => project(g.lat, g.lon)), width: roadWidth(t) });
    } else if (t.natural === 'water' || t.landuse === 'grass' || t.leisure === 'park') {
      const outline = ring(el.geometry);
      if (outline.length >= 3) areas.push({ outline, kind: t.natural === 'water' ? 'water' : 'grass' });
    }
  }
  return { version: 1, bounds: { minX, maxX, minZ, maxZ }, roads, buildings, areas, solids: LANDMARKS.map((l) => l.footprint) };
}
```

- [ ] **Passo 5: rodar e ver passar**

Rodar: `npx vitest run tools/osm.test.ts`
Esperado: todos PASSAM.

- [ ] **Passo 6: criar `tools/osm-esplanada.ts`**

```ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Collider } from '../shared/map.ts';
import { overpassQuery, toMapData, type OverpassResult } from './osm.ts';

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    // O Overpass recusa requisições sem User-Agent identificável.
    'user-agent': 'manifest-map-tool/0.1 (gerador de mapa do jogo)',
  },
  body: new URLSearchParams({ data: overpassQuery() }),
});
if (!res.ok) {
  console.error(`Overpass respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const map = toMapData((await res.json()) as OverpassResult);
const out = fileURLToPath(new URL('../shared/map.json', import.meta.url));
writeFileSync(out, JSON.stringify(map));
console.log(`map.json: ${map.buildings.length} prédios, ${map.roads.length} vias, ${map.areas.length} áreas, ${map.solids.length} marcos`);
if (Collider.fromMap(map).blocked(0, 0)) console.warn('Atenção: a origem (ponto de nascimento) caiu dentro de um prédio.');
```

- [ ] **Passo 7: gerar o mapa**

Rodar: `npm run map`
Esperado: uma linha `map.json: N prédios, M vias, …` com N > 50 e M > 100, sem o aviso de origem bloqueada. Conferir que `shared/map.json` tem menos de 3 MB (`ls -la shared/map.json`).
Se o Overpass responder 429 ou 504, espere 1 minuto e rode de novo.

- [ ] **Passo 8: conferir que o servidor carrega o mapa**

Rodar: `npm run start`
Esperado: o aviso "shared/map.json não encontrado" **não** aparece. Encerre com Ctrl+C.

- [ ] **Passo 9: rodar todos os testes e fazer commit**

Rodar: `npm test`
Esperado: todos PASSAM.

```bash
git add shared/landmarks.ts tools/osm.ts tools/osm-esplanada.ts tools/osm.test.ts shared/map.json
git commit -m "feat(map): mapa da Esplanada gerado do OpenStreetMap, com marcos e colisão

Dados do mapa © colaboradores do OpenStreetMap (ODbL).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Tarefa 12: Cliente: interpolação, predição, conexão e login de desenvolvimento

**Arquivos:**
- Criar: `client/src/interp.ts`, `client/src/predict.ts`, `client/src/net.ts`, `client/src/auth.ts`, `client/src/env.d.ts`
- Teste: `client/src/interp.test.ts`, `client/src/predict.test.ts`

**Interfaces:**
- Consome: `stepMove`, `MoveInput`, `MoveState` (Tarefa 3); `seqNewer`, `decodeSnapshot` e tipos do protocolo (Tarefa 2); `TICK_MS`, `TICK_DT`, `PING_MS`.
- Produz:
  - `interp.ts`:
    - `class TickClock { update(tick, arrivedAt); toLocal(tick): number; ready }`;
    - `class Track { push(sample); sample(t): { x, z, yaw } | null; lastTime }`, com `Sample = { t, x, z, yaw }`.
  - `predict.ts`: `class Predictor`:
    - `new Predictor(start: MoveState, collider, startSeq)`;
    - `apply(input): { dx, dz, run, seq }`;
    - `reconcile(server, ackSeq)`;
    - `render(dtMs): { x, z }`;
    - `state`.
  - `net.ts`: `class GameConnection`:
    - `new GameConnection(url, handlers, getAuth)`;
    - `connect()`, `join(spectate)`, `send(msg)`, `resetIntent()`;
    - tipos `NetHandlers` e `ConnStatus`.
  - `auth.ts`: `getAccessToken(): Promise<string | null>`, `getDevLogin()`, `setDevLogin({ nick, team })`, `clearDevLogin()`. O subprojeto de contas troca a implementação e mantém a assinatura de `getAccessToken`.

- [ ] **Passo 1: escrever os testes que falham**

`client/src/interp.test.ts`:
```ts
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
```

`client/src/predict.test.ts`:
```ts
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
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `npx vitest run client/src`
Esperado: FALHA ("Failed to load ./interp.ts" e "./predict.ts").

- [ ] **Passo 3: criar `client/src/interp.ts`**

```ts
import { TICK_MS } from '../../shared/constants.ts';

/** Converte tick do servidor em tempo local (ms de performance.now). */
export class TickClock {
  private offset: number | null = null;

  update(tick: number, arrivedAt: number): void {
    const sample = arrivedAt - tick * TICK_MS;
    // Fica com a menor latência vista: desce na hora, sobe devagar (acompanha a deriva do relógio).
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.01;
  }

  toLocal(tick: number): number {
    return tick * TICK_MS + (this.offset ?? 0);
  }

  get ready(): boolean {
    return this.offset !== null;
  }
}

export type Sample = { t: number; x: number; z: number; yaw: number };
type Pose = { x: number; z: number; yaw: number };

const MAX_SAMPLES = 40;
const pose = (s: Sample): Pose => ({ x: s.x, z: s.z, yaw: s.yaw });

function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * k;
}

export class Track {
  readonly samples: Sample[] = [];

  push(s: Sample): void {
    const last = this.samples.at(-1);
    if (last && s.t <= last.t) return;
    this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  get lastTime(): number {
    return this.samples.at(-1)?.t ?? -Infinity;
  }

  sample(t: number): Pose | null {
    const s = this.samples;
    if (s.length === 0) return null;
    const last = s[s.length - 1];
    if (t >= last.t) return pose(last);
    if (t <= s[0].t) return pose(s[0]);
    let i = s.length - 1;
    while (s[i - 1].t > t) i--;
    const a = s[i - 1];
    const b = s[i];
    const k = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: lerpAngle(a.yaw, b.yaw, k) };
  }
}
```

- [ ] **Passo 4: criar `client/src/predict.ts`**

```ts
import { TICK_DT } from '../../shared/constants.ts';
import type { Collider } from '../../shared/map.ts';
import { stepMove, type MoveInput, type MoveState } from '../../shared/movement.ts';
import { seqNewer } from '../../shared/protocol.ts';

const SNAP_DISTANCE = 2;
const SMOOTH_MS = 100;

/** Predição do próprio jogador: move na hora e corrige com o servidor sem tranco. */
export class Predictor {
  state: MoveState;
  private seq: number;
  private pending: { seq: number; input: MoveInput }[] = [];
  private readonly collider: Collider | null;
  private offX = 0;
  private offZ = 0;

  constructor(start: MoveState, collider: Collider | null, startSeq: number) {
    this.state = start;
    this.collider = collider;
    this.seq = startSeq & 0xffff;
  }

  apply(input: MoveInput): MoveInput & { seq: number } {
    this.seq = (this.seq + 1) & 0xffff;
    this.state = stepMove(this.state, input, this.collider, TICK_DT);
    this.pending.push({ seq: this.seq, input });
    if (this.pending.length > 120) this.pending.shift();
    return { ...input, seq: this.seq };
  }

  reconcile(server: { x: number; z: number }, ackSeq: number): void {
    this.pending = this.pending.filter((p) => seqNewer(p.seq, ackSeq));
    let s: MoveState = { x: server.x, z: server.z, yaw: this.state.yaw, anim: this.state.anim };
    for (const p of this.pending) s = stepMove(s, p.input, this.collider, TICK_DT);
    const ex = this.state.x - s.x;
    const ez = this.state.z - s.z;
    if (Math.hypot(ex, ez) > SNAP_DISTANCE) {
      this.offX = 0;
      this.offZ = 0;
    } else {
      this.offX += ex;
      this.offZ += ez;
    }
    this.state = { x: s.x, z: s.z, yaw: this.state.yaw, anim: this.state.anim };
  }

  /** Posição para desenhar: previsto + erro que decai em ~SMOOTH_MS. */
  render(dtMs: number): { x: number; z: number } {
    const k = Math.exp(-dtMs / (SMOOTH_MS / 3));
    this.offX *= k;
    this.offZ *= k;
    return { x: this.state.x + this.offX, z: this.state.z + this.offZ };
  }
}
```

- [ ] **Passo 5: rodar e ver passar**

Rodar: `npx vitest run client/src`
Esperado: todos PASSAM.

- [ ] **Passo 6: criar `client/src/env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Passo 7: criar `client/src/auth.ts`**

```ts
// Login de desenvolvimento (servidor com DEV_AUTH=1). O subprojeto de contas troca por Supabase
// mantendo a assinatura de getAccessToken().
const KEY = 'manifest-dev-login';

export type DevLogin = { nick: string; team: number };

export function getDevLogin(): DevLogin | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DevLogin) : null;
  } catch {
    return null;
  }
}

export function setDevLogin(login: DevLogin): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(login));
  } catch {
    // navegação privada: o login vale só para esta aba
  }
  current = login;
}

export function clearDevLogin(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  current = null;
}

let current: DevLogin | null = getDevLogin();

export async function getAccessToken(): Promise<string | null> {
  return current ? `dev:${current.nick}:${current.team}` : null;
}
```

- [ ] **Passo 8: criar `client/src/net.ts`**

```ts
import { PING_MS } from '../../shared/constants.ts';
import {
  decodeSnapshot, type ClientMessage, type FarSnapshot, type NearSnapshot, type ServerMessage,
} from '../../shared/protocol.ts';

export type ConnStatus = 'connecting' | 'open' | 'closed';

export type NetHandlers = {
  message(m: ServerMessage): void;
  snapshot(s: NearSnapshot | FarSnapshot, arrivedAt: number): void;
  status(s: ConnStatus): void;
};

/** WebSocket com reconexão (1, 2, 4, 8… até 15 s). Ao reconectar, refaz o join com token novo. */
export class GameConnection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private intent: { spectate: boolean } | null = null;
  private pingTimer = 0;
  private readonly url: string;
  private readonly h: NetHandlers;
  private readonly getAuth: () => Promise<string | null>;

  constructor(url: string, handlers: NetHandlers, getAuth: () => Promise<string | null>) {
    this.url = url;
    this.h = handlers;
    this.getAuth = getAuth;
  }

  connect(): void {
    this.h.status('connecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.h.status('open');
      if (this.intent) void this.sendJoin();
      else this.send({ t: 'lobby' });
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', at: Date.now() }), PING_MS);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          this.h.message(JSON.parse(ev.data) as ServerMessage);
        } catch {
          // mensagem malformada: ignora
        }
      } else {
        const s = decodeSnapshot(ev.data as ArrayBuffer);
        if (s) this.h.snapshot(s, performance.now());
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.h.status('closed');
      const delay = Math.min(15_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  async join(spectate: boolean): Promise<void> {
    this.intent = { spectate };
    await this.sendJoin();
  }

  /** Volta para o lobby (ex.: o join foi recusado). */
  resetIntent(): void {
    this.intent = null;
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private async sendJoin(): Promise<void> {
    if (!this.intent) return;
    const auth = await this.getAuth().catch(() => null);
    this.send({ t: 'join', auth, spectate: this.intent.spectate, token: null });
  }
}
```

- [ ] **Passo 9: rodar todos os testes e fazer commit**

Rodar: `npm test`
Esperado: todos PASSAM.

```bash
git add client/src/
git commit -m "feat(client): interpolação, predição com reconciliação, conexão e login dev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Tarefa 13: Cliente: cena 3D (mapa, marcos, avatares, multidão, câmera)

**Arquivos:**
- Criar:
  - `client/public/models/robot.glb` (baixado) e `client/public/models/CREDITS.txt`;
  - `client/src/scene/renderer.ts`, `map.ts`, `landmarks.ts`, `labels.ts`, `avatars.ts`, `crowd.ts`, `camera.ts`.
- Verificação: `npx tsc --noEmit`. A verificação visual fica para a Tarefa 14, que liga tudo.

**Interfaces:**
- Consome: `MapData` (Tarefa 3); `LANDMARKS` (Tarefa 11); `teams.json`; `ANIM`, `FAR_MAX`.
- Produz:
  - `renderer.ts`: `createStage(container, onContextLost): Stage`, com `Stage = { renderer, scene, camera, sun, mobile }`, e `followSun(stage, x, z)`;
  - `map.ts`: `buildMap(map, scene)`;
  - `landmarks.ts`: `buildLandmarks(scene)`;
  - `labels.ts`: `makeLabel(text, color): THREE.Sprite`, `disposeLabel(sprite)`;
  - `avatars.ts`: `class Avatars`:
    - `new Avatars(scene)`, `load(url): Promise<void>`;
    - `sync(visible: Map<number, AvatarPose>, names: Map<number, { nick: string }>, dt: number, selfId: number)`;
    - `AvatarPose = { x, z, yaw, anim, team }`;
  - `crowd.ts`: `class Crowd`: `new Crowd(scene)`, `update(people: Iterable<{ x, z, team }>)`;
  - `camera.ts`: `class CameraRig`:
    - `new CameraRig(camera, dom)`;
    - estado: `yaw`, `spectator`, `focus`;
    - `update(target: { x, z } | null)`;
    - `onSpectatorMove: (x, z) => void`.

- [ ] **Passo 1: baixar o personagem provisório (CC0)**

Rodar:
```bash
mkdir -p client/public/models
curl -L -o client/public/models/robot.glb https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb
```
Esperado: arquivo com ~464 KB.

Criar `client/public/models/CREDITS.txt`:
```
robot.glb — "RobotExpressive" por Tomás Laulhé (Quaternius), licença CC0 1.0.
Modificações de Don McCurdy. Fonte: repositório three.js (examples/models/gltf/RobotExpressive).
```

- [ ] **Passo 2: criar `client/src/scene/renderer.ts`**

```ts
import * as THREE from 'three';

export type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  mobile: boolean;
};

export function createStage(container: HTMLElement, onContextLost: () => void): Stage {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = !mobile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    onContextLost();
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9ec9ea');
  scene.fog = new THREE.Fog('#9ec9ea', 400, 1600);
  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 3000);

  scene.add(new THREE.HemisphereLight('#dcecff', '#4d5a3a', 1.2));
  const sun = new THREE.DirectionalLight('#fff4dd', 2.2);
  sun.castShadow = !mobile;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 600 });
  scene.add(sun, sun.target);

  addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
  });
  return { renderer, scene, camera, sun, mobile };
}

/** A área de sombra acompanha o foco da câmera. */
export function followSun(stage: Stage, x: number, z: number): void {
  stage.sun.position.set(x - 120, 220, z - 80);
  stage.sun.target.position.set(x, 0, z);
}
```

- [ ] **Passo 3: criar `client/src/scene/map.ts`**

```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Pt } from '../../../shared/geometry.ts';
import type { MapData } from '../../../shared/map.ts';

// Shape fica no plano XY; rotateX(-π/2) leva (x, -z) do shape para (x, 0, z) no mundo.
const shapeOf = (outline: Pt[]) => new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));

function flat(outline: Pt[], y: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shapeOf(outline));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

function road(line: Pt[], width: number, y: number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const h = width / 2;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const nx = (-(bz - az) / len) * h;
    const nz = ((bx - ax) / len) * h;
    pos.push(
      ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz,
      ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz,
    );
  }
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function addMerged(scene: THREE.Scene, geos: (THREE.BufferGeometry | null)[], material: THREE.Material, castShadow: boolean) {
  const list = geos.filter((g): g is THREE.BufferGeometry => g !== null);
  if (list.length === 0) return;
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!merged) return;
  const mesh = new THREE.Mesh(merged, material);
  mesh.receiveShadow = true;
  mesh.castShadow = castShadow;
  scene.add(mesh);
}

/** Chão, gramados, água, vias e prédios em poucas malhas mescladas (uma por material). */
export function buildMap(map: MapData, scene: THREE.Scene): void {
  const b = map.bounds;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(b.maxX - b.minX + 400, b.maxZ - b.minZ + 400),
    new THREE.MeshLambertMaterial({ color: '#8f9a78' }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const side = THREE.DoubleSide;
  addMerged(scene, map.areas.filter((a) => a.kind === 'grass').map((a) => flat(a.outline, 0.05)),
    new THREE.MeshLambertMaterial({ color: '#6fa84f', side }), false);
  addMerged(scene, map.areas.filter((a) => a.kind === 'water').map((a) => flat(a.outline, 0.1)),
    new THREE.MeshLambertMaterial({ color: '#3d7fb8', side }), false);
  addMerged(scene, map.roads.map((r) => road(r.line, r.width, r.width >= 4 ? 0.15 : 0.2)),
    new THREE.MeshLambertMaterial({ color: '#4a4d52', side }), false);
  addMerged(scene, map.buildings.map((bd) => {
    const g = new THREE.ExtrudeGeometry(shapeOf(bd.outline), { depth: bd.height, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }), new THREE.MeshLambertMaterial({ color: '#d9d4c7' }), true);
}
```

- [ ] **Passo 4: criar `client/src/scene/landmarks.ts`**

```ts
import * as THREE from 'three';
import { LANDMARKS } from '../../../shared/landmarks.ts';

const white = new THREE.MeshLambertMaterial({ color: '#f2f2ee', side: THREE.DoubleSide });

function congresso(): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, sy = 1) => {
    const m = new THREE.Mesh(geo, white);
    m.position.set(x, y, z);
    m.scale.y = sy;
    g.add(m);
  };
  add(new THREE.BoxGeometry(80, 10, 200), 0, 5, 0); // plataforma
  add(new THREE.SphereGeometry(30, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0, 25, 50, 0.5); // tigela da Câmara (sul)
  add(new THREE.SphereGeometry(20, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0, 10, -50, 0.6); // cúpula do Senado (norte)
  add(new THREE.BoxGeometry(14, 100, 24), 50, 50, -10); // torres
  add(new THREE.BoxGeometry(14, 100, 24), 50, 50, 14);
  add(new THREE.BoxGeometry(14, 6, 8), 50, 70, 2); // passarela entre as torres
  return g;
}

function catedral(): THREE.Group {
  const g = new THREE.Group();
  const profile = [[30, 0], [19, 12], [12, 25], [10.5, 31], [13, 38], [17, 42]].map(([r, y]) => new THREE.Vector2(r, y));
  const glass = new THREE.MeshLambertMaterial({ color: '#7fb3d5', transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.LatheGeometry(profile.map((v) => new THREE.Vector2(v.x * 0.97, v.y)), 32), glass));
  for (let i = 0; i < 16; i++) {
    g.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 1, (i / 16) * Math.PI * 2, 0.14), white)); // 16 colunas
  }
  return g;
}

export function buildLandmarks(scene: THREE.Scene): void {
  for (const l of LANDMARKS) {
    const obj = l.name === 'Catedral' ? catedral() : congresso();
    obj.position.set(l.center[0], 0, l.center[1]);
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(obj);
  }
}
```

- [ ] **Passo 5: criar `client/src/scene/labels.ts`**

```ts
import * as THREE from 'three';

/** Apelido desenhado em canvas (texto puro, nunca HTML). */
export function makeLabel(text: string, color: string): THREE.Sprite {
  const pad = 8;
  const size = 28;
  const font = `600 ${size}px system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  canvas.height = size + pad * 2;
  ctx.font = font; // redimensionar o canvas reseta o contexto
  ctx.fillStyle = 'rgba(15, 20, 25, 0.65)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(0, canvas.height - 4, canvas.width, 4);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  const h = 0.32;
  sprite.scale.set((h * canvas.width) / canvas.height, h, 1);
  return sprite;
}

export function disposeLabel(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}
```

- [ ] **Passo 6: criar `client/src/scene/avatars.ts`**

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIM } from '../../../shared/constants.ts';
import teams from '../../../shared/teams.json' with { type: 'json' };
import { disposeLabel, makeLabel } from './labels.ts';

const CLIPS = ['Idle', 'Walking', 'Running', 'Wave']; // índice = valor de ANIM
const HEIGHT = 1.75;

export type AvatarPose = { x: number; z: number; yaw: number; anim: number; team: number };

type Avatar = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[];
  anim: number;
  team: number;
  label: THREE.Sprite | null;
  labelText: string;
};

/** Até NEAR_MAX personagens animados, reaproveitados de um pool. */
export class Avatars {
  private template: THREE.Object3D | null = null;
  private clips: THREE.AnimationClip[] = [];
  private scale = 1;
  private footOffset = 0;
  private mainMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly teamMaterials = new Map<number, THREE.Material>();
  private readonly active = new Map<number, Avatar>();
  private readonly pool: Avatar[] = [];
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.template = gltf.scene;
    this.clips = CLIPS.map((name) => {
      const clip = THREE.AnimationClip.findByName(gltf.animations, name);
      if (!clip) throw new Error(`animação ${name} não encontrada no modelo`);
      return clip;
    });
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name === 'Main') this.mainMaterial = m.material as THREE.MeshStandardMaterial;
    });
    // Mede a altura já com os ossos aplicados, para escalar a 1,75 m com os pés no chão.
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.update();
    });
    const box = new THREE.Box3().setFromObject(gltf.scene, true);
    const h = box.max.y - box.min.y;
    this.scale = h > 0.01 ? HEIGHT / h : 1;
    this.footOffset = -box.min.y * this.scale;
  }

  sync(visible: Map<number, AvatarPose>, names: Map<number, { nick: string }>, dt: number, selfId: number): void {
    if (!this.template) return;
    for (const [id, a] of this.active) if (!visible.has(id)) this.release(id, a);
    for (const [id, v] of visible) {
      let a = this.active.get(id);
      if (!a) {
        a = this.acquire();
        this.active.set(id, a);
      }
      this.paint(a, v.team);
      a.root.position.set(v.x, 0, v.z);
      a.root.rotation.y = v.yaw;
      if (v.anim !== a.anim) {
        const from = a.actions[a.anim] ?? a.actions[ANIM.idle];
        const to = a.actions[v.anim] ?? a.actions[ANIM.idle];
        to.reset().play();
        from.crossFadeTo(to, 0.2, false);
        a.anim = v.anim;
      }
      a.mixer.update(dt);
      const nick = id === selfId ? '' : names.get(id)?.nick ?? '';
      if (nick !== a.labelText) this.setLabel(a, nick, v.team);
    }
  }

  private acquire(): Avatar {
    const pooled = this.pool.pop();
    if (pooled) {
      this.scene.add(pooled.root);
      return pooled;
    }
    const model = cloneSkinned(this.template!);
    model.scale.setScalar(this.scale);
    model.position.y = this.footOffset;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false; // a caixa do SkinnedMesh não acompanha a animação
        if ((m.material as THREE.Material).name === 'Main') m.userData.main = true;
      }
    });
    const root = new THREE.Group();
    root.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const actions = this.clips.map((c) => mixer.clipAction(c));
    actions[ANIM.idle].play();
    this.scene.add(root);
    return { root, mixer, actions, anim: ANIM.idle, team: -1, label: null, labelText: '' };
  }

  private paint(a: Avatar, team: number): void {
    if (a.team === team) return;
    a.team = team;
    let mat = this.teamMaterials.get(team);
    if (!mat) {
      const m = (this.mainMaterial?.clone() ?? new THREE.MeshStandardMaterial()) as THREE.MeshStandardMaterial;
      m.color.set(teams[team]?.color ?? '#888888');
      this.teamMaterials.set(team, m);
      mat = m;
    }
    a.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.main) m.material = mat!;
    });
  }

  private setLabel(a: Avatar, nick: string, team: number): void {
    if (a.label) {
      a.root.remove(a.label);
      disposeLabel(a.label);
      a.label = null;
    }
    if (nick) {
      a.label = makeLabel(nick, teams[team]?.color ?? '#888888');
      a.label.position.y = HEIGHT + 0.35;
      a.root.add(a.label);
    }
    a.labelText = nick;
  }

  private release(id: number, a: Avatar): void {
    this.active.delete(id);
    this.scene.remove(a.root);
    this.setLabel(a, '', a.team);
    this.pool.push(a);
  }
}
```

- [ ] **Passo 7: criar `client/src/scene/crowd.ts`**

```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FAR_MAX } from '../../../shared/constants.ts';
import teams from '../../../shared/teams.json' with { type: 'json' };

const CAPACITY = FAR_MAX + 200;
const GREY = new THREE.Color('#888888');

/** Multidão distante: boneco low-poly instanciado, colorido por time, numa única chamada de desenho. */
export class Crowd {
  private readonly mesh: THREE.InstancedMesh;
  private readonly colors = teams.map((t) => new THREE.Color(t.color));
  private readonly matrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    const body = new THREE.CylinderGeometry(0.25, 0.3, 1.3, 6);
    body.translate(0, 0.65, 0);
    const head = new THREE.SphereGeometry(0.2, 6, 4);
    head.translate(0, 1.55, 0);
    this.mesh = new THREE.InstancedMesh(mergeGeometries([body, head])!, new THREE.MeshLambertMaterial(), CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(people: Iterable<{ x: number; z: number; team: number }>): void {
    let i = 0;
    for (const p of people) {
      if (i >= CAPACITY) break;
      this.matrix.makeTranslation(p.x, 0, p.z);
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i, this.colors[p.team] ?? GREY);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
```

- [ ] **Passo 8: criar `client/src/scene/camera.ts`**

```ts
import * as THREE from 'three';

/** Terceira pessoa para o jogador; vista de cima (arrastar = mover, roda = zoom) para o espectador. */
export class CameraRig {
  yaw = Math.PI / 2; // olha para +x (leste, em direção ao Congresso)
  pitch = 0.35;
  distance = 7;
  spectator = false;
  readonly focus = new THREE.Vector3();
  height = 120;
  onSpectatorMove: (x: number, z: number) => void = () => {};
  private readonly cam: THREE.PerspectiveCamera;
  private drag: { x: number; y: number } | null = null;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.cam = camera;
    dom.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointerup', () => {
      this.drag = null;
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag = { x: e.clientX, y: e.clientY };
      if (this.spectator) {
        const k = this.height / 600;
        this.focus.x -= dx * k;
        this.focus.z -= dy * k;
        this.onSpectatorMove(this.focus.x, this.focus.z);
      } else {
        this.yaw -= dx * 0.005;
        this.pitch = Math.min(1.2, Math.max(0.05, this.pitch + dy * 0.004));
      }
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.001);
      if (this.spectator) this.height = Math.min(600, Math.max(20, this.height * f));
      else this.distance = Math.min(25, Math.max(3, this.distance * f));
    }, { passive: false });
  }

  update(target: { x: number; z: number } | null): void {
    if (this.spectator || !target) {
      this.cam.position.set(this.focus.x, this.height, this.focus.z + this.height * 0.6);
      this.cam.lookAt(this.focus.x, 0, this.focus.z);
      return;
    }
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const horiz = this.distance * Math.cos(this.pitch);
    this.cam.position.set(target.x - fx * horiz, 1.6 + this.distance * Math.sin(this.pitch), target.z - fz * horiz);
    this.cam.lookAt(target.x, 1.4, target.z);
  }
}
```

- [ ] **Passo 9: checar tipos**

Rodar: `npx tsc --noEmit`
Esperado: sem erros. Se o TypeScript reclamar de `teams.json` com `with { type: 'json' }` no cliente, confira se `resolveJsonModule` está no `tsconfig.json` (Tarefa 1).

- [ ] **Passo 10: commit**

```bash
git add client/public client/src/scene
git commit -m "feat(client): cena 3D com mapa, Congresso e Catedral, avatares animados e multidão instanciada

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---


### Tarefa 14: Cliente: interface, controles e `main.ts` (o jogo funcionando de ponta a ponta)

**Arquivos:**
- Criar: `client/index.html`, `client/src/style.css`, `client/src/input.ts`, `client/src/ui/lobby.ts`, `client/src/ui/chat.ts`, `client/src/ui/hud.ts`, `client/src/main.ts`

**Interfaces:**
- Consome: tudo das Tarefas 2, 3, 11, 12 e 13.
- Produz:
  - `Input`: `new Input(joystickZone | null)`, `read(cameraYaw): MoveInput` e `enabled`;
  - `Lobby`: `new Lobby({ play, watch })`, `stats(online, counts)`, `show(on)`, `error(msg)`;
  - `ChatPanel`: `new ChatPanel(send)`, `show(on, canTalk)`, `add(entry)`, `system(text)`, `clear()`;
  - `Hud`: `show(on)`, `ping(ms)`, `banner(text | null)`, `fatal(text)`.

- [ ] **Passo 1: criar `client/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Manifest · manifestação online na Esplanada</title>
    <meta name="description" content="Manifestação online na Esplanada dos Ministérios. Entre com sua conta, escolha seu time e vá para a Esplanada." />
  </head>
  <body>
    <div id="stage"></div>

    <div id="hud" hidden><span id="ping"></span></div>

    <section id="lobby" class="panel">
      <h1>Manifest</h1>
      <p class="sub">Manifestação online na Esplanada dos Ministérios</p>
      <ul id="lobby-teams"></ul>
      <form id="login-form" hidden>
        <label>Apelido <input id="login-nick" maxlength="20" minlength="2" required autocomplete="off" /></label>
        <fieldset id="login-teams"><legend>Seu time</legend></fieldset>
        <p class="hint">Login de desenvolvimento. O login com Google e e-mail chega no subprojeto de contas.</p>
        <button type="submit" class="primary">Entrar na Esplanada</button>
      </form>
      <div class="actions">
        <button id="btn-play" class="primary">Entrar</button>
        <button id="btn-watch">Só quero assistir</button>
      </div>
      <p id="lobby-error" role="alert"></p>
    </section>

    <section id="chat" class="panel" hidden>
      <ol id="chat-log" aria-live="polite"></ol>
      <form id="chat-form">
        <input id="chat-input" maxlength="200" autocomplete="off" />
        <button>Enviar</button>
      </form>
    </section>

    <div id="joystick" hidden><div class="knob"></div></div>
    <div id="banner" role="status" hidden></div>
    <footer id="credits">mapa © colaboradores do OpenStreetMap</footer>

    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Passo 2: criar `client/src/style.css`**

```css
:root {
  --bg: #12171c;
  --panel: rgba(18, 23, 28, 0.88);
  --text: #f1f3f5;
  --muted: #9aa5b1;
  --accent: #f2c200;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--text);
  background: var(--bg);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; }
#stage { position: fixed; inset: 0; touch-action: none; }
.panel { position: fixed; background: var(--panel); border-radius: 12px; padding: 16px; backdrop-filter: blur(6px); }
button { font: inherit; padding: 10px 16px; border-radius: 8px; border: 1px solid #3a4550; background: #1f2830; color: var(--text); cursor: pointer; }
button.primary { background: var(--accent); color: #111; border-color: var(--accent); font-weight: 700; }
input { font: inherit; padding: 8px 10px; border-radius: 8px; border: 1px solid #3a4550; background: #0e1317; color: var(--text); }

#lobby { top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(420px, calc(100vw - 32px)); }
#lobby h1 { margin: 0; letter-spacing: 0.04em; }
#lobby .sub { margin: 4px 0 16px; color: var(--muted); }
#lobby-teams { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 6px; }
#lobby-teams li { display: flex; justify-content: space-between; padding: 8px 10px; border-radius: 8px; background: #1a2229; border-left: 4px solid var(--team); }
#login-form { display: grid; gap: 10px; margin-bottom: 12px; }
#login-form label { display: grid; gap: 4px; }
#login-form fieldset { border: 1px solid #3a4550; border-radius: 8px; display: flex; gap: 12px; flex-wrap: wrap; }
.hint { color: var(--muted); font-size: 0.85em; margin: 0; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
#lobby-error { color: #ff8a80; min-height: 1.2em; margin: 10px 0 0; }

#chat { right: 16px; bottom: 16px; width: min(360px, calc(100vw - 32px)); padding: 10px; }
#chat-log { list-style: none; margin: 0 0 8px; padding: 0; max-height: 30vh; overflow-y: auto; font-size: 0.92em; }
#chat-log li { padding: 2px 0; overflow-wrap: anywhere; }
#chat-log li.system { color: var(--muted); font-style: italic; }
#chat-form { display: flex; gap: 6px; }
#chat-form input { flex: 1; min-width: 0; }

#hud { position: fixed; top: 12px; right: 16px; color: var(--muted); font-size: 0.85em; }
#banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: #b3261e; color: #fff; padding: 8px 14px; border-radius: 8px; }
#banner button { margin-left: 10px; padding: 4px 10px; }
#credits { position: fixed; left: 8px; bottom: 6px; font-size: 0.72em; color: #fff; text-shadow: 0 1px 2px #000; }
#joystick { position: fixed; left: 24px; bottom: 40px; width: 120px; height: 120px; border-radius: 50%; background: rgba(255, 255, 255, 0.12); touch-action: none; }
#joystick .knob { position: absolute; left: 35px; top: 35px; width: 50px; height: 50px; border-radius: 50%; background: rgba(255, 255, 255, 0.45); }

@media (max-width: 600px) {
  #chat { left: 16px; right: auto; bottom: 170px; }
  #chat-log { max-height: 20vh; }
}
```

- [ ] **Passo 3: criar `client/src/input.ts`**

```ts
import type { MoveInput } from '../../shared/movement.ts';

const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** WASD/setas + Shift no computador; joystick virtual no celular. Saída já no espaço do mundo. */
export class Input {
  enabled = true;
  private readonly keys = new Set<string>();
  private stick = { x: 0, y: 0 };

  constructor(joystickZone: HTMLElement | null) {
    addEventListener('keydown', (e) => {
      if (!isTyping(e)) this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    if (joystickZone) this.joystick(joystickZone);
  }

  read(cameraYaw: number): MoveInput {
    if (!this.enabled) return { dx: 0, dz: 0, run: false };
    const k = (...codes: string[]) => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
    const fw = clamp1(k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + this.stick.y);
    const rt = clamp1(k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + this.stick.x);
    const fx = Math.sin(cameraYaw);
    const fz = Math.cos(cameraYaw);
    // frente = (fx, fz); direita = (-fz, fx)
    return {
      dx: clamp1(fx * fw - fz * rt),
      dz: clamp1(fz * fw + fx * rt),
      run: k('ShiftLeft', 'ShiftRight') === 1 || Math.hypot(this.stick.x, this.stick.y) > 0.9,
    };
  }

  private joystick(zone: HTMLElement): void {
    const knob = zone.querySelector<HTMLElement>('.knob');
    const R = 50;
    let origin: { x: number; y: number; id: number } | null = null;
    zone.addEventListener('pointerdown', (e) => {
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
      zone.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    zone.addEventListener('pointermove', (e) => {
      if (!origin || e.pointerId !== origin.id) return;
      let dx = (e.clientX - origin.x) / R;
      let dy = (e.clientY - origin.y) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      this.stick = { x: dx, y: -dy };
      if (knob) knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
    });
    const end = () => {
      origin = null;
      this.stick = { x: 0, y: 0 };
      if (knob) knob.style.transform = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
}
```

- [ ] **Passo 4: criar `client/src/ui/lobby.ts`**

```ts
import teams from '../../../shared/teams.json' with { type: 'json' };
import { getDevLogin, setDevLogin } from '../auth.ts';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Lobby {
  private readonly el = byId<HTMLElement>('lobby');
  private readonly list = byId<HTMLUListElement>('lobby-teams');
  private readonly err = byId<HTMLParagraphElement>('lobby-error');

  constructor(actions: { play(): void; watch(): void }) {
    const form = byId<HTMLFormElement>('login-form');
    const nick = byId<HTMLInputElement>('login-nick');
    const fieldset = byId<HTMLFieldSetElement>('login-teams');
    teams.forEach((t, i) => {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'team';
      radio.value = String(i);
      radio.checked = i === 0;
      label.append(radio, ` ${t.name}`);
      fieldset.append(label);
    });
    byId<HTMLButtonElement>('btn-play').onclick = () => {
      this.error('');
      if (getDevLogin()) actions.play();
      else {
        form.hidden = false;
        nick.focus();
      }
    };
    byId<HTMLButtonElement>('btn-watch').onclick = () => {
      this.error('');
      actions.watch();
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = nick.value.replace(/:/g, '').trim();
      const team = Number(form.querySelector<HTMLInputElement>('input[name=team]:checked')?.value ?? 0);
      if (name.length < 2) return;
      setDevLogin({ nick: name, team });
      form.hidden = true;
      actions.play();
    };
    this.stats(0, teams.map(() => 0));
  }

  stats(online: number, counts: number[]): void {
    this.list.replaceChildren(...teams.map((t, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--team', t.color);
      const name = document.createElement('span');
      name.textContent = t.name;
      const n = document.createElement('span');
      n.textContent = `${counts[i] ?? 0} online`;
      li.append(name, n);
      return li;
    }));
    this.list.title = `${online} pessoas na Esplanada`;
  }

  show(on: boolean): void {
    this.el.hidden = !on;
  }

  error(msg: string): void {
    this.err.textContent = msg;
  }
}
```

- [ ] **Passo 5: criar `client/src/ui/chat.ts`**

```ts
import teams from '../../../shared/teams.json' with { type: 'json' };
import type { ChatEntry } from '../../../shared/protocol.ts';

const MAX_LINES = 100;

export class ChatPanel {
  private readonly panel = document.getElementById('chat') as HTMLElement;
  private readonly log = document.getElementById('chat-log') as HTMLOListElement;
  private readonly input = document.getElementById('chat-input') as HTMLInputElement;

  constructor(send: (text: string) => void) {
    (document.getElementById('chat-form') as HTMLFormElement).onsubmit = (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      send(text);
      this.input.value = '';
    };
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.input.blur();
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.activeElement !== this.input && !this.panel.hidden && !this.input.disabled) {
        e.preventDefault();
        this.input.focus();
      }
    });
  }

  show(on: boolean, canTalk: boolean): void {
    this.panel.hidden = !on;
    this.input.disabled = !canTalk;
    this.input.placeholder = canTalk ? 'Diga algo… (Enter)' : 'Entre com sua conta para conversar';
  }

  add(e: ChatEntry): void {
    const li = document.createElement('li');
    const who = document.createElement('b');
    who.textContent = e.nick; // texto puro, nunca HTML
    who.style.color = teams[e.team]?.color ?? '#cccccc';
    li.append(who, ' ', e.text);
    this.push(li);
  }

  system(text: string): void {
    const li = document.createElement('li');
    li.className = 'system';
    li.textContent = text;
    this.push(li);
  }

  clear(): void {
    this.log.replaceChildren();
  }

  private push(li: HTMLLIElement): void {
    this.log.append(li);
    while (this.log.children.length > MAX_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
```

- [ ] **Passo 6: criar `client/src/ui/hud.ts`**

```ts
export class Hud {
  private readonly el = document.getElementById('hud') as HTMLElement;
  private readonly pingEl = document.getElementById('ping') as HTMLElement;
  private readonly bannerEl = document.getElementById('banner') as HTMLElement;

  show(on: boolean): void {
    this.el.hidden = !on;
  }

  ping(ms: number): void {
    this.pingEl.textContent = `${Math.round(ms)} ms`;
  }

  banner(text: string | null): void {
    this.bannerEl.hidden = text === null;
    this.bannerEl.textContent = text ?? '';
  }

  /** Erro que exige recarregar a página (ex.: placa de vídeo perdeu o contexto). */
  fatal(text: string): void {
    this.banner(text);
    const btn = document.createElement('button');
    btn.textContent = 'Recarregar';
    btn.onclick = () => location.reload();
    this.bannerEl.append(btn);
  }
}
```

- [ ] **Passo 7: criar `client/src/main.ts`**

```ts
import './style.css';
import { FAR_HZ, INTERP_DELAY_MS, TICK_MS } from '../../shared/constants.ts';
import { Collider, type MapData } from '../../shared/map.ts';
import mapJson from '../../shared/map.json' with { type: 'json' };
import { NEAR_TYPE, type FarSnapshot, type NearSnapshot, type ServerMessage } from '../../shared/protocol.ts';
import { clearDevLogin, getAccessToken } from './auth.ts';
import { Input } from './input.ts';
import { TickClock, Track } from './interp.ts';
import { GameConnection, type ConnStatus } from './net.ts';
import { Predictor } from './predict.ts';
import { Avatars, type AvatarPose } from './scene/avatars.ts';
import { CameraRig } from './scene/camera.ts';
import { Crowd } from './scene/crowd.ts';
import { buildLandmarks } from './scene/landmarks.ts';
import { buildMap } from './scene/map.ts';
import { createStage, followSun } from './scene/renderer.ts';
import { ChatPanel } from './ui/chat.ts';
import { Hud } from './ui/hud.ts';
import { Lobby } from './ui/lobby.ts';

const FAR_DELAY_MS = 1000 / FAR_HZ + INTERP_DELAY_MS;
const map = mapJson as unknown as MapData; // o tipo inferido do JSON não tem as tuplas [x, z]
const collider = Collider.fromMap(map);

const hud = new Hud();
const stage = createStage(document.getElementById('stage')!, () => hud.fatal('A placa de vídeo reiniciou.'));
buildMap(map, stage.scene);
buildLandmarks(stage.scene);
const avatars = new Avatars(stage.scene);
avatars.load('/models/robot.glb').catch((err) => {
  console.error(err);
  hud.banner('Não foi possível carregar os personagens.');
});
const crowd = new Crowd(stage.scene);
const rig = new CameraRig(stage.camera, stage.renderer.domElement);
const joystick = document.getElementById('joystick')!;
const input = new Input(stage.mobile ? joystick : null);
const clock = new TickClock();

const nearTracks = new Map<number, { track: Track; anim: number; team: number }>();
const farTracks = new Map<number, { track: Track; team: number }>();
const names = new Map<number, { nick: string; team: number }>();
let nearIds = new Set<number>();
let joined = false;
let spectator = true;
let selfId = 0;
let myTeam = 0;
let predictor: Predictor | null = null;

const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
const net = new GameConnection(wsUrl, { message: onMessage, snapshot: onSnapshot, status: onStatus }, getAccessToken);
const lobby = new Lobby({ play: () => void net.join(false), watch: () => void net.join(true) });
const chat = new ChatPanel((text) => net.send({ t: 'chat', text }));

let lastView = 0;
rig.onSpectatorMove = (x, z) => {
  const now = performance.now();
  if (now - lastView < 200) return; // no máximo 5/s
  lastView = now;
  net.send({ t: 'view', x, z });
};

function onMessage(m: ServerMessage): void {
  switch (m.t) {
    case 'stats':
      lobby.stats(m.online, m.teams);
      break;
    case 'welcome':
      joined = true;
      selfId = m.id;
      spectator = m.spectator;
      myTeam = m.account?.team ?? 0;
      predictor = null;
      rig.spectator = m.spectator;
      input.enabled = !m.spectator;
      joystick.hidden = !(stage.mobile && !m.spectator);
      lobby.show(false);
      hud.show(true);
      chat.show(true, !m.spectator);
      chat.clear();
      for (const e of m.history) chat.add(e);
      if (m.full) chat.system('A Esplanada está lotada: você está assistindo por enquanto.');
      break;
    case 'names':
      for (const p of m.people) names.set(p.id, { nick: p.nick, team: p.team });
      break;
    case 'chat':
      chat.add(m);
      break;
    case 'error':
      if (joined) {
        chat.system(m.message);
        break;
      }
      lobby.error(m.message);
      net.resetIntent();
      if (m.code === 'auth_invalid' || m.code === 'no_profile') clearDevLogin();
      break;
    case 'pong':
      hud.ping(Date.now() - m.at);
      break;
    case 'restarting':
      hud.banner('O servidor está reiniciando…');
      break;
  }
}

function onStatus(s: ConnStatus): void {
  if (s === 'open') hud.banner(null);
  if (s === 'closed') hud.banner('Reconectando…');
}

function onSnapshot(s: NearSnapshot | FarSnapshot, arrivedAt: number): void {
  clock.update(s.tick, arrivedAt);
  const t = clock.toLocal(s.tick);
  if (s.type === NEAR_TYPE) {
    nearIds = new Set();
    for (const a of s.actors) {
      nearIds.add(a.id);
      if (a.id === selfId && !spectator) {
        if (!predictor) predictor = new Predictor({ x: a.x, z: a.z, yaw: a.yaw, anim: a.anim }, collider, s.ackSeq);
        else predictor.reconcile(a, s.ackSeq);
        continue;
      }
      let n = nearTracks.get(a.id);
      if (!n) nearTracks.set(a.id, (n = { track: new Track(), anim: a.anim, team: a.team }));
      n.track.push({ t, x: a.x, z: a.z, yaw: a.yaw });
      n.anim = a.anim;
      n.team = a.team;
    }
    return;
  }
  for (const a of s.actors) {
    let f = farTracks.get(a.id);
    if (!f) farTracks.set(a.id, (f = { track: new Track(), team: a.team }));
    f.track.push({ t, x: a.x, z: a.z, yaw: 0 });
    f.team = a.team;
  }
}

let last = performance.now();
let acc = 0;
let wasMoving = false;

function frame(now: number): void {
  const dtMs = Math.min(250, now - last);
  last = now;

  // Inputs em passo fixo de 20 Hz, iguais ao servidor. Ao parar, manda um último input zerado.
  if (predictor && !spectator) {
    acc += dtMs;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      const mv = input.read(rig.yaw);
      const moving = Math.hypot(mv.dx, mv.dz) >= 0.05;
      if (moving || wasMoving) net.send({ t: 'input', ...predictor.apply(mv) });
      wasMoving = moving;
    }
  }

  const visible = new Map<number, AvatarPose>();
  for (const [id, n] of nearTracks) {
    if (!nearIds.has(id)) {
      if (now - n.track.lastTime > 1000) nearTracks.delete(id);
      continue;
    }
    const p = n.track.sample(now - INTERP_DELAY_MS);
    if (p) visible.set(id, { ...p, anim: n.anim, team: n.team });
  }
  let self: { x: number; z: number } | null = null;
  if (predictor && !spectator) {
    self = predictor.render(dtMs);
    visible.set(selfId, { ...self, yaw: predictor.state.yaw, anim: predictor.state.anim, team: myTeam });
  }
  avatars.sync(visible, names, dtMs / 1000, selfId);

  const people: { x: number; z: number; team: number }[] = [];
  for (const [id, f] of farTracks) {
    if (now - f.track.lastTime > 2500) {
      farTracks.delete(id);
      continue;
    }
    if (nearIds.has(id) || id === selfId) continue;
    const p = f.track.sample(now - FAR_DELAY_MS);
    if (p) people.push({ x: p.x, z: p.z, team: f.team });
  }
  crowd.update(people);

  rig.update(self);
  followSun(stage, self?.x ?? rig.focus.x, self?.z ?? rig.focus.z);
  stage.renderer.render(stage.scene, stage.camera);
  requestAnimationFrame(frame);
}

net.connect();
requestAnimationFrame(frame);
```

- [ ] **Passo 8: checar tipos e build**

Rodar: `npx tsc --noEmit && npm run build`
Esperado: sem erros de tipo, e o build gera `client/dist/` com `index.html`, `assets/*.js` e `models/robot.glb`.

- [ ] **Passo 9: verificação manual de ponta a ponta** (com navegador; o agente pode usar o claude-in-chrome)

1. Terminal 1: `npm run dev:server` (`.env` com `DEV_AUTH=1`). Terminal 2: `npm run dev:client`. Abrir `http://localhost:5173`.
2. O lobby mostra os 3 times com "0 online".
3. "Entrar" mostra o formulário. Com o apelido `Ana` e um time, o robô aparece na cor do time no gramado do Eixo Monumental, com o Congresso a leste e a Catedral a oeste.
4. Os controles funcionam: WASD anda, Shift corre, arrastar o mouse gira a câmera e a roda dá zoom. Os prédios bloqueiam a passagem e o personagem desliza ao longo das paredes.
5. Numa janela anônima, entrar como `Bia` em outro time. Cada um vê o outro andando suave, com o apelido em cima, e o chat funciona nos dois sentidos.
6. Numa terceira aba, "Só quero assistir": a câmera vê de cima, arrastar move a vista, os jogadores aparecem e o chat fica só de leitura.
7. No DevTools da aba da Ana, pôr a rede em *Offline* por 5 s e depois voltar. A faixa "Reconectando…" aparece e some, e a Ana volta no mesmo lugar.
8. No DevTools, ativar a emulação de celular (touch) e recarregar: o joystick aparece e move a Ana.
9. Produção local: `npm run build`, depois `npm run start`, abrir `http://localhost:8787`. Tudo funciona servido pelo próprio servidor.

Se algum item falhar, corrija antes do commit (use superpowers:systematic-debugging).

- [ ] **Passo 10: rodar todos os testes e fazer commit**

Rodar: `npm test`
Esperado: todos PASSAM.

```bash
git add client/
git commit -m "feat(client): lobby, chat, HUD, controles e laço principal com predição e interpolação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 15: Teste de carga com 1000 bots

**Arquivos:**
- Criar: `tools/bots.ts`

**Interfaces:**
- Consome: o servidor rodando (Tarefa 10) e `/metrics`.
- Produz: `npm run bots -- [N=1000] [segundos=60]`. O comando imprime as conexões, a média de bytes recebidos por bot e o tempo de tick (p50/p95/máx).

- [ ] **Passo 1: criar `tools/bots.ts`**

```ts
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
```

- [ ] **Passo 2: rodar o teste de carga**

Terminal 1:
```bash
DEV_AUTH=1 MAX_CONN_PER_IP=2000 node server/index.ts
```
(No PowerShell: `$env:DEV_AUTH='1'; $env:MAX_CONN_PER_IP='2000'; node server/index.ts`.)

Terminal 2:
```bash
npm run bots -- 1000 60
```
Esperado:
- "1000 jogando";
- recebido por bot ≤ ~27 KB/s;
- "OK: p95 abaixo de 25 ms".

Se o p95 passar da meta, **não otimize às cegas**. Rode `node --cpu-prof server/index.ts` durante o teste, abra o `.cpuprofile` no DevTools do Chrome e ataque o maior consumidor. Os suspeitos prováveis são `pickNear`/`pickFar` (alocação de `Hit`) e o `JSON.parse` dos inputs.

- [ ] **Passo 3: commit com o resultado medido**

```bash
git add tools/bots.ts
git commit -m "test(load): bots de carga; resultado: <cole aqui p50/p95/máx e KB/s por bot>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Verificação final

- [ ] `npm test`: todos os testes passam.
- [ ] `npx tsc --noEmit`: sem erros.
- [ ] `npm run build`: o build gera `client/dist`.
- [ ] Teste de carga (Tarefa 15) dentro da meta, ou desvio registrado no commit.
- [ ] Verificação manual da Tarefa 14 completa, incluindo o celular a ~30 fps (DevTools → Rendering → FPS meter num celular intermediário, ou num aparelho real na mesma rede usando o IP da máquina em `ALLOWED_ORIGINS`).

## Cobertura da spec

| Requisito da spec | Tarefa |
|---|---|
| Constantes | 1 |
| Protocolo JSON e binário PERTO/LONGE, validação | 2 |
| Movimento, colisão com prédios, limites | 3 |
| Grade espacial, perto (64) e longe (1000, 2 Hz) | 4, 9 |
| Ids u16 com reuso após 60 s, retomada em 30 s, tick 20 Hz | 5 |
| Chat: filtro, intervalo, tamanho, histórico de 40, log de 7 dias sem IP | 6 |
| Login obrigatório para jogar (JWT do Supabase), perfil, banimento | 7, 9 |
| Taxa por conexão, conexões por IP, IP via Cloudflare, Origin, 4 KB | 8, 10 |
| Lobby com stats, welcome, names, lotação → espectador, reinício (1012) | 9, 10 |
| Mapa do OSM, marcos, atribuição | 11, 13, 14 |
| Interpolação 100 ms, predição e reconciliação | 12, 14 |
| Avatares animados com apelido, multidão, câmera, WASD/joystick, celular | 13, 14 |
| Reconexão com espera crescente, faixa, contexto WebGL perdido | 12, 14 |
| Testes unitários, de integração e de carga | todas, 10, 15 |
