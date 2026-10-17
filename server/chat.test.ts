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
