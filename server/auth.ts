import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { normalizeLook } from '../shared/looks.ts';
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

const DEV_TOKEN = /^dev:([^:]{2,20}):(\d{1,2})(?::(\d{1,9}))?$/;

/** Só para desenvolvimento e bots (DEV_AUTH=1). O app recusa iniciar com isso em produção. */
export function createDevVerifier(store: MemoryProfileStore): VerifyToken {
  return async (token) => {
    const m = DEV_TOKEN.exec(token);
    if (!m) return null;
    const userId = `dev-${m[1].toLowerCase()}`;
    store.put({ userId, nick: m[1], team: Number(m[2]), look: normalizeLook(Number(m[3] ?? 0)), bannedUntil: null });
    return { userId };
  };
}
