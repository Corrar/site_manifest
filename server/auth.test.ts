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
