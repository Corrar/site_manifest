import { ID_REUSE_MS } from '../shared/constants.ts';

/** Ids u16 (1..65535). Um id liberado só volta depois de ID_REUSE_MS, para não herdar nomes em cache. */
export class IdAllocator {
  private next = 1;
  private readonly released: { id: number; at: number }[] = [];

  alloc(now: number): number | null {
    const first = this.released[0];
    if (first && now - first.at >= ID_REUSE_MS) return this.released.shift()!.id;
    if (this.next <= 65535) return this.next++;
    return null;
  }

  release(id: number, now: number): void {
    this.released.push({ id, at: now });
  }
}
