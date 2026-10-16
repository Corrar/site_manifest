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
