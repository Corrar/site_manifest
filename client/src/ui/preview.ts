import * as THREE from 'three';
import { ANIM } from '../../../shared/constants.ts';
import { packLook, type Look } from '../../../shared/looks.ts';
import teams from '../../../shared/teams.json' with { type: 'json' };
import { buildCharacter } from '../scene/character.ts';

/** Personagem girando num palco próprio (tela inicial e loja). Arrastar gira. */
export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private readonly holder = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions: THREE.AnimationAction[] = [];
  private current: THREE.Object3D | null = null;
  private anim: number = ANIM.idle;
  private key = '';
  private currentShared = false;
  private lastLook: { look: Look; team: number } | null = null;
  private spin = 0.35;
  private targetSpin = 0.35;
  private last = performance.now();
  private dragging: number | null = null;
  private visible = true;

  /** Refaz o personagem atual (ex.: um modelo .glb terminou de carregar e substitui o corpo provisório). */
  refresh(): void {
    if (!this.lastLook) return;
    this.key = '';
    this.setLook(this.lastLook.look, this.lastLook.team);
  }

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.canvas = this.renderer.domElement;
    container.append(this.canvas);
    this.scene.add(new THREE.HemisphereLight('#f3f6ff', '#2a3a2c', 1.6));
    const key = new THREE.DirectionalLight('#fff3dc', 2.4);
    key.position.set(2, 4, 3);
    const rim = new THREE.DirectionalLight('#b5f0c8', 1.2);
    rim.position.set(-3, 2, -2);
    this.scene.add(key, rim, this.holder);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 40),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    this.scene.add(floor);

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging === null) return;
      this.targetSpin += (e.clientX - this.dragging) * 0.012;
      this.dragging = e.clientX;
    });
    const stop = () => (this.dragging = null);
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  setVisible(on: boolean): void {
    this.visible = on;
  }

  rotate(by: number): void {
    this.targetSpin += by;
  }

  setLook(look: Look, team: number): void {
    const key = `${packLook(look)}|${team}`;
    if (key === this.key) return;
    this.key = key;
    const t = teams[team] ?? teams[0];
    const tpl = buildCharacter(look, t);
    if (this.current) {
      this.holder.remove(this.current);
      if (!this.currentShared) this.current.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.current = tpl.root;
    this.currentShared = !!tpl.shared;
    this.lastLook = { look, team };
    this.holder.add(tpl.root);
    this.mixer = new THREE.AnimationMixer(tpl.root);
    this.actions = tpl.clips.map((c) => this.mixer!.clipAction(c));
    this.actions[this.anim]?.play();
    const h = tpl.height + (look.flag ? 0.5 : 0);
    this.camera.position.set(0, h * 0.55, h * 2.35);
    this.camera.lookAt(0, h * 0.5, 0);
  }

  setAnim(anim: number): void {
    if (anim === this.anim) return;
    const from = this.actions[this.anim];
    const to = this.actions[anim];
    this.anim = anim;
    if (!to) return;
    to.reset().play();
    from?.crossFadeTo(to, 0.25, false);
  }

  /** Retrato (rosto e ombros) para os cards, como data URL. */
  portrait(look: Look, team: number, size = 160): string {
    const t = teams[team] ?? teams[0];
    const tpl = buildCharacter({ ...look, flag: 0 }, t);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#f3f6ff', '#2a3a2c', 1.7));
    const l = new THREE.DirectionalLight('#fff3dc', 2.2);
    l.position.set(1.5, 3, 3);
    scene.add(l, tpl.root);
    const mixer = new THREE.AnimationMixer(tpl.root);
    mixer.clipAction(tpl.clips[ANIM.idle]).play();
    mixer.update(0);
    tpl.root.rotation.y = 0.25;
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
    const hy = tpl.height * 0.885;
    cam.position.set(0, hy, 0.98);
    cam.lookAt(0, hy - 0.025, 0);
    const prev = new THREE.Vector2();
    this.renderer.getSize(prev);
    this.renderer.setSize(size, size, false);
    this.renderer.render(scene, cam);
    const url = this.canvas.toDataURL('image/png');
    this.renderer.setSize(prev.x, prev.y, false);
    if (!tpl.shared) tpl.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    return url;
  }

  private resize(): void {
    const box = this.canvas.parentElement!.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return; // tela escondida: mantém o tamanho anterior
    const w = box.width;
    const h = box.height;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.visible) return;
    if (this.dragging === null) this.targetSpin += dt * 0.15;
    this.spin += (this.targetSpin - this.spin) * Math.min(1, dt * 8);
    this.holder.rotation.y = this.spin;
    this.mixer?.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
