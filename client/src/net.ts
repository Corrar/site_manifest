import { PING_MS } from '../../shared/constants.ts';
import {
  decodeSnapshot, type ClientMessage, type FarSnapshot, type NearSnapshot, type ServerMessage,
} from '../../shared/protocol.ts';

export type ConnStatus = 'connecting' | 'open' | 'closed';

export type NetHandlers = {
  message(m: ServerMessage): void;
  snapshot(s: NearSnapshot | FarSnapshot, arrivedAt: number): void;
  status(s: ConnStatus): void;
};

/** O mínimo de WebSocket que GameConnection usa (permite um servidor local no futuro). */
export type SocketLike = Pick<WebSocket, 'readyState' | 'send' | 'close'> & {
  binaryType: BinaryType;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
};

/** WebSocket com reconexão (1, 2, 4, 8… até 15 s). Ao reconectar, refaz o join com token novo. */
export class GameConnection {
  private ws: SocketLike | null = null;
  private retry = 0;
  private intent: { spectate: boolean } | null = null;
  private pingTimer = 0;
  private readonly url: string;
  private readonly h: NetHandlers;
  private readonly getAuth: () => Promise<string | null>;
  private readonly createSocket: (url: string) => SocketLike;

  constructor(
    url: string,
    handlers: NetHandlers,
    getAuth: () => Promise<string | null>,
    createSocket: (url: string) => SocketLike = (u) => new WebSocket(u),
  ) {
    this.url = url;
    this.h = handlers;
    this.getAuth = getAuth;
    this.createSocket = createSocket;
  }

  connect(): void {
    this.h.status('connecting');
    const ws = this.createSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.h.status('open');
      if (this.intent) void this.sendJoin();
      else this.send({ t: 'lobby' });
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', at: Date.now() }), PING_MS);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          this.h.message(JSON.parse(ev.data) as ServerMessage);
        } catch {
          // mensagem malformada: ignora
        }
      } else {
        const s = decodeSnapshot(ev.data as ArrayBuffer);
        if (s) this.h.snapshot(s, performance.now());
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.h.status('closed');
      const delay = Math.min(15_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  async join(spectate: boolean): Promise<void> {
    this.intent = { spectate };
    await this.sendJoin();
  }

  /** Volta para o lobby (ex.: o join foi recusado). */
  resetIntent(): void {
    this.intent = null;
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private async sendJoin(): Promise<void> {
    if (!this.intent) return;
    const auth = await this.getAuth().catch(() => null);
    this.send({ t: 'join', auth, spectate: this.intent.spectate, token: null });
  }
}
