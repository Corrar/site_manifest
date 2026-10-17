import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, normalizeLook, packLook, randomLook, unpackLook } from './looks.ts';

describe('looks', () => {
  it('ida e volta preserva todos os campos', () => {
    const l = { body: 2, skin: 4, hair: 5, hairColor: 3, beard: 4, shirt: 6, pants: 2, flag: 3, legs: 1, extra: 5 };
    expect(unpackLook(packLook(l))).toEqual(l);
  });
  it('valores inválidos viram o padrão', () => {
    expect(unpackLook(-1)).toEqual(DEFAULT_LOOK);
    expect(unpackLook(1.5)).toEqual(DEFAULT_LOOK);
    expect(unpackLook(7).body).toBe(DEFAULT_LOOK.body); // corpo 7 não existe
    expect(packLook({ ...DEFAULT_LOOK, skin: 99 })).toBe(packLook({ ...DEFAULT_LOOK, skin: 4 }));
  });
  it('cabe em 30 bits e normalizeLook é idempotente', () => {
    for (let i = 0; i < 50; i++) {
      const n = packLook(randomLook());
      expect(n).toBeLessThan(2 ** 30);
      expect(normalizeLook(n)).toBe(n);
    }
  });
});
