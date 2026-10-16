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
