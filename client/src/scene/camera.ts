import * as THREE from 'three';

type Keys = Set<string>;

/**
 * Câmera livre nos três eixos, nos dois modos.
 * - Jogador: orbita em volta do personagem (arrastar gira e inclina, roda aproxima). Teclas Q/E giram.
 * - Espectador: orbita em volta de um foco no chão que pode ser arrastado (botão esquerdo), girado e inclinado
 *   (botão direito, ou Shift + arrastar, ou dois dedos), com zoom pela roda, pelos botões +/- e pela pinça.
 *   Setas (ou WASD) deslocam o foco, Q/E giram, R/F inclinam, +/- aproximam.
 */
export class CameraRig {
  yaw = Math.PI / 2; // olha para +x (leste, em direção ao Congresso)
  pitch = 0.35;
  distance = 7;
  spectator = false;
  readonly focus = new THREE.Vector3();
  /** Espectador: distância do foco (o nome ficou por compatibilidade com o HUD). */
  height = 160;
  spectatorPitch = 0.9;
  onSpectatorMove: (x: number, z: number) => void = () => {};
  private readonly cam: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly keys: Keys = new Set();
  private drag: { x: number; y: number; orbit: boolean } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.cam = camera;
    this.dom = dom;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dom.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.drag = null;
        return;
      }
      this.drag = { x: e.clientX, y: e.clientY, orbit: e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey };
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = 0;
      if (this.pointers.size === 0) this.drag = null;
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (prev) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2 && prev) {
        // Dois dedos: pinça aproxima; mover os dois juntos gira (espectador) ou gira a câmera (jogador).
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0) this.zoomBy(Math.exp((this.pinch - d) * 0.004));
        this.pinch = d;
        this.orbit((e.clientX - prev.x) * 0.5, (e.clientY - prev.y) * 0.5);
        return;
      }
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (!this.spectator || this.drag.orbit) this.orbit(dx, dy);
      else this.pan(dx, dy);
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(Math.exp(e.deltaY * 0.001));
    }, { passive: false });
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** Gira (dx) e inclina (dy) em pixels de arrasto. */
  orbit(dx: number, dy: number): void {
    this.yaw -= dx * 0.005;
    if (this.spectator) this.spectatorPitch = Math.min(1.5, Math.max(0.2, this.spectatorPitch + dy * 0.004));
    else this.pitch = Math.min(1.45, Math.max(-0.15, this.pitch + dy * 0.004));
  }

  /** Desloca o foco do espectador em pixels de arrasto, no sentido do que se vê na tela. */
  pan(dx: number, dy: number): void {
    const k = this.height / 600;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    // Arrastar para a direita empurra o mundo para a direita: o foco anda para a esquerda da câmera.
    this.focus.x -= (-fz * dx + fx * dy) * k;
    this.focus.z -= (fx * dx + fz * dy) * k;
    this.onSpectatorMove(this.focus.x, this.focus.z);
  }

  /** Fator > 1 afasta, < 1 aproxima. */
  zoomBy(f: number): void {
    if (this.spectator) this.height = Math.min(900, Math.max(12, this.height * f));
    else this.distance = Math.min(60, Math.max(2.5, this.distance * f));
  }

  /** Teclas seguradas: deslocamento, giro e inclinação suaves. Chamar a cada quadro. */
  tick(dt: number, moveKeysFree: boolean): void {
    const k = this.keys;
    const has = (...codes: string[]) => codes.some((c) => k.has(c));
    const rot = (has('KeyQ') ? 1 : 0) - (has('KeyE') ? 1 : 0);
    if (rot) this.yaw += rot * dt * 1.6;
    if (this.spectator) {
      const tilt = (has('KeyR') ? 1 : 0) - (has('KeyF') ? 1 : 0);
      if (tilt) this.spectatorPitch = Math.min(1.5, Math.max(0.2, this.spectatorPitch + tilt * dt * 1.2));
      const zoom = (has('Equal', 'NumpadAdd') ? 1 : 0) - (has('Minus', 'NumpadSubtract') ? 1 : 0);
      if (zoom) this.zoomBy(Math.exp(-zoom * dt * 1.5));
      if (moveKeysFree) {
        const fw = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
        const rt = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
        if (fw || rt) {
          const speed = this.height * 0.9 * dt;
          const fx = Math.sin(this.yaw);
          const fz = Math.cos(this.yaw);
          this.focus.x += (fx * fw - fz * rt) * speed;
          this.focus.z += (fz * fw + fx * rt) * speed;
          this.onSpectatorMove(this.focus.x, this.focus.z);
        }
      }
    }
  }

  update(target: { x: number; z: number } | null): void {
    if (this.spectator || !target) {
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const horiz = this.height * Math.cos(this.spectatorPitch);
      this.cam.position.set(this.focus.x - fx * horiz, this.height * Math.sin(this.spectatorPitch), this.focus.z - fz * horiz);
      this.cam.lookAt(this.focus.x, 0, this.focus.z);
      return;
    }
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const horiz = this.distance * Math.cos(this.pitch);
    const y = Math.max(0.4, 1.6 + this.distance * Math.sin(this.pitch));
    this.cam.position.set(target.x - fx * horiz, y, target.z - fz * horiz);
    this.cam.lookAt(target.x, 1.4, target.z);
  }
}
