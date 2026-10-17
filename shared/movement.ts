import { ANIM, PLAYER_RADIUS, RUN_SPEED, TICK_DT, VEHICLE_SPECS, WALK_SPEED } from './constants.ts';
import type { Collider } from './map.ts';

export type MoveInput = { dx: number; dz: number; run: boolean };
export type MoveState = { x: number; z: number; yaw: number; anim: number; vehicle?: number };

const TWO_PI = Math.PI * 2;
export const wrapAngle = (a: number) => a - TWO_PI * Math.round(a / TWO_PI);
const REVERSE_ANGLE = 2.2; // pedir para ir quase para trás vira marcha a ré

/** Um passo de movimento. Roda igual no servidor e na predição do cliente. */
export function stepMove(s: MoveState, input: MoveInput, collider: Collider | null, dt = TICK_DT): MoveState {
  let { dx, dz } = input;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return { x: s.x, z: s.z, yaw: s.yaw, anim: ANIM.idle, vehicle: s.vehicle };
  if (len > 1) {
    dx /= len;
    dz /= len;
  }
  const spec = s.vehicle ? VEHICLE_SPECS[s.vehicle] : null;
  if (spec) {
    // Veículo: anda para onde aponta e vira com velocidade limitada (curvas abertas no caminhão).
    let diff = wrapAngle(Math.atan2(dx, dz) - s.yaw);
    let dir = 1;
    if (Math.abs(diff) > REVERSE_ANGLE) {
      dir = -1;
      diff = wrapAngle(diff + Math.PI);
    }
    const turn = spec.turn * dt;
    const yaw = wrapAngle(s.yaw + Math.max(-turn, Math.min(turn, diff)));
    const speed = (input.run ? spec.boost : spec.speed) * (dir < 0 ? 0.4 : 1) * dir;
    let x = s.x + Math.sin(yaw) * speed * dt;
    let z = s.z + Math.cos(yaw) * speed * dt;
    if (collider) [x, z] = collider.resolve(x, z, spec.radius);
    return { x, z, yaw, anim: ANIM.walk, vehicle: s.vehicle };
  }
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  let x = s.x + dx * speed * dt;
  let z = s.z + dz * speed * dt;
  if (collider) [x, z] = collider.resolve(x, z, PLAYER_RADIUS);
  return { x, z, yaw: Math.atan2(dx, dz), anim: input.run ? ANIM.run : ANIM.walk, vehicle: s.vehicle };
}

/** Raio de colisão de quem está a pé ou num veículo. */
export function bodyRadius(vehicle = 0): number {
  return VEHICLE_SPECS[vehicle]?.radius ?? PLAYER_RADIUS;
}
