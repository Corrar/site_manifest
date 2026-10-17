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
