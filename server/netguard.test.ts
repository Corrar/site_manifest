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
