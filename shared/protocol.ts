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
