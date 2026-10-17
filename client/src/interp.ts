import { TICK_MS } from '../../shared/constants.ts';

/** Converte tick do servidor em tempo local (ms de performance.now). */
export class TickClock {
  private offset: number | null = null;

  update(tick: number, arrivedAt: number): void {
    const sample = arrivedAt - tick * TICK_MS;
    // Fica com a menor latência vista: desce na hora, sobe devagar (acompanha a deriva do relógio).
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.01;
  }

  toLocal(tick: number): number {
    return tick * TICK_MS + (this.offset ?? 0);
  }

  get ready(): boolean {
    return this.offset !== null;
  }
}

export type Sample = { t: number; x: number; z: number; yaw: number };
type Pose = { x: number; z: number; yaw: number };

const MAX_SAMPLES = 40;
const pose = (s: Sample): Pose => ({ x: s.x, z: s.z, yaw: s.yaw });

function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * k;
}

export class Track {
  readonly samples: Sample[] = [];

  push(s: Sample): void {
    const last = this.samples.at(-1);
    if (last && s.t <= last.t) return;
    this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  get lastTime(): number {
    return this.samples.at(-1)?.t ?? -Infinity;
  }

  sample(t: number): Pose | null {
    const s = this.samples;
    if (s.length === 0) return null;
    const last = s[s.length - 1];
    if (t >= last.t) return pose(last);
    if (t <= s[0].t) return pose(s[0]);
    let i = s.length - 1;
    while (s[i - 1].t > t) i--;
    const a = s[i - 1];
    const b = s[i];
    const k = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: lerpAngle(a.yaw, b.yaw, k) };
  }
}
