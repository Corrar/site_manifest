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
