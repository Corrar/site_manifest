import { ANIM, PLAYER_RADIUS, RUN_SPEED, TICK_DT, WALK_SPEED } from './constants.ts';
import type { Collider } from './map.ts';

export type MoveInput = { dx: number; dz: number; run: boolean };
export type MoveState = { x: number; z: number; yaw: number; anim: number };

/** Um passo de movimento. Roda igual no servidor e na predição do cliente. */
export function stepMove(s: MoveState, input: MoveInput, collider: Collider | null, dt = TICK_DT): MoveState {
  let { dx, dz } = input;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return { x: s.x, z: s.z, yaw: s.yaw, anim: ANIM.idle };
  if (len > 1) {
    dx /= len;
    dz /= len;
  }
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  let x = s.x + dx * speed * dt;
  let z = s.z + dz * speed * dt;
  if (collider) [x, z] = collider.resolve(x, z, PLAYER_RADIUS);
  return { x, z, yaw: Math.atan2(dx, dz), anim: input.run ? ANIM.run : ANIM.walk };
}
