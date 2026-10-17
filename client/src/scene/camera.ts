import * as THREE from 'three';

/** Terceira pessoa para o jogador; vista de cima (arrastar = mover, roda = zoom) para o espectador. */
export class CameraRig {
  yaw = Math.PI / 2; // olha para +x (leste, em direção ao Congresso)
  pitch = 0.35;
  distance = 7;
  spectator = false;
  readonly focus = new THREE.Vector3();
  height = 120;
  onSpectatorMove: (x: number, z: number) => void = () => {};
  private readonly cam: THREE.PerspectiveCamera;
  private drag: { x: number; y: number } | null = null;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.cam = camera;
    dom.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointerup', () => {
      this.drag = null;
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag = { x: e.clientX, y: e.clientY };
      if (this.spectator) {
        const k = this.height / 600;
        this.focus.x -= dx * k;
        this.focus.z -= dy * k;
        this.onSpectatorMove(this.focus.x, this.focus.z);
      } else {
        this.yaw -= dx * 0.005;
        this.pitch = Math.min(1.2, Math.max(0.05, this.pitch + dy * 0.004));
      }
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.001);
      if (this.spectator) this.height = Math.min(600, Math.max(20, this.height * f));
      else this.distance = Math.min(25, Math.max(3, this.distance * f));
    }, { passive: false });
  }

  update(target: { x: number; z: number } | null): void {
    if (this.spectator || !target) {
      this.cam.position.set(this.focus.x, this.height, this.focus.z + this.height * 0.6);
      this.cam.lookAt(this.focus.x, 0, this.focus.z);
      return;
    }
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const horiz = this.distance * Math.cos(this.pitch);
    this.cam.position.set(target.x - fx * horiz, 1.6 + this.distance * Math.sin(this.pitch), target.z - fz * horiz);
    this.cam.lookAt(target.x, 1.4, target.z);
  }
}
