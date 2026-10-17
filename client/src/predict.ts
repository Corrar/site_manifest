import { TICK_DT } from '../../shared/constants.ts';
import type { Collider } from '../../shared/map.ts';
import { stepMove, type MoveInput, type MoveState } from '../../shared/movement.ts';
import { seqNewer } from '../../shared/protocol.ts';

const SNAP_DISTANCE = 2;
const SMOOTH_MS = 100;

/** Predição do próprio jogador: move na hora e corrige com o servidor sem tranco. */
export class Predictor {
  state: MoveState;
  private seq: number;
  private pending: { seq: number; input: MoveInput }[] = [];
  private readonly collider: Collider | null;
  private offX = 0;
  private offZ = 0;

  constructor(start: MoveState, collider: Collider | null, startSeq: number) {
    this.state = start;
    this.collider = collider;
    this.seq = startSeq & 0xffff;
  }

  apply(input: MoveInput): MoveInput & { seq: number } {
    this.seq = (this.seq + 1) & 0xffff;
    this.state = stepMove(this.state, input, this.collider, TICK_DT);
    this.pending.push({ seq: this.seq, input });
    if (this.pending.length > 120) this.pending.shift();
    return { ...input, seq: this.seq };
  }

  reconcile(server: { x: number; z: number; yaw?: number }, ackSeq: number): void {
    this.pending = this.pending.filter((p) => seqNewer(p.seq, ackSeq));
    // Num veículo a direção faz parte da física, então parte da direção do servidor.
    const yaw = this.state.vehicle && server.yaw !== undefined ? server.yaw : this.state.yaw;
    let s: MoveState = { x: server.x, z: server.z, yaw, anim: this.state.anim, vehicle: this.state.vehicle };
    for (const p of this.pending) s = stepMove(s, p.input, this.collider, TICK_DT);
    const ex = this.state.x - s.x;
    const ez = this.state.z - s.z;
    if (Math.hypot(ex, ez) > SNAP_DISTANCE) {
      this.offX = 0;
      this.offZ = 0;
    } else {
      this.offX += ex;
      this.offZ += ez;
    }
    this.state = { x: s.x, z: s.z, yaw: this.state.vehicle ? s.yaw : this.state.yaw, anim: this.state.anim, vehicle: this.state.vehicle };
  }

  setVehicle(kind: number): void {
    this.state = { ...this.state, vehicle: kind };
  }

  /** Posição para desenhar: previsto + erro que decai em ~SMOOTH_MS. */
  render(dtMs: number): { x: number; z: number } {
    const k = Math.exp(-dtMs / (SMOOTH_MS / 3));
    this.offX *= k;
    this.offZ *= k;
    return { x: this.state.x + this.offX, z: this.state.z + this.offZ };
  }
}
