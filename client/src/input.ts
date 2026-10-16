import type { MoveInput } from '../../shared/movement.ts';

const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** WASD/setas + Shift no computador; joystick virtual no celular. Saída já no espaço do mundo. */
export class Input {
  enabled = true;
  private readonly keys = new Set<string>();
  private stick = { x: 0, y: 0 };

  constructor(joystickZone: HTMLElement | null) {
    addEventListener('keydown', (e) => {
      if (!isTyping(e)) this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    if (joystickZone) this.joystick(joystickZone);
  }

  read(cameraYaw: number): MoveInput {
    if (!this.enabled) return { dx: 0, dz: 0, run: false };
    const k = (...codes: string[]) => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
    const fw = clamp1(k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + this.stick.y);
    const rt = clamp1(k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + this.stick.x);
    const fx = Math.sin(cameraYaw);
    const fz = Math.cos(cameraYaw);
    // frente = (fx, fz); direita = (-fz, fx)
    return {
      dx: clamp1(fx * fw - fz * rt),
      dz: clamp1(fz * fw + fx * rt),
      run: k('ShiftLeft', 'ShiftRight') === 1 || Math.hypot(this.stick.x, this.stick.y) > 0.9,
    };
  }

  private joystick(zone: HTMLElement): void {
    const knob = zone.querySelector<HTMLElement>('.knob');
    const R = 50;
    let origin: { x: number; y: number; id: number } | null = null;
    zone.addEventListener('pointerdown', (e) => {
      origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
      zone.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    zone.addEventListener('pointermove', (e) => {
      if (!origin || e.pointerId !== origin.id) return;
      let dx = (e.clientX - origin.x) / R;
      let dy = (e.clientY - origin.y) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      this.stick = { x: dx, y: -dy };
      if (knob) knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
    });
    const end = () => {
      origin = null;
      this.stick = { x: 0, y: 0 };
      if (knob) knob.style.transform = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
}
