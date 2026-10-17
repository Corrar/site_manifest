import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIM } from '../../../shared/constants.ts';
import { DEFAULT_LOOK, packLook, unpackLook } from '../../../shared/looks.ts';
import teams from '../../../shared/teams.json' with { type: 'json' };
import { wrapAngle } from '../../../shared/movement.ts';
import { buildCharacter, type CharacterTemplate } from './character.ts';
import { buildVehicle, VEHICLE_HEIGHT } from './vehicles.ts';
import { disposeLabel, makeLabel } from './labels.ts';

export type AvatarPose = { x: number; z: number; yaw: number; anim: number; team: number; look: number; vehicle: number };

type Avatar = {
  key: string;
  vehicle: boolean;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[];
  anim: number;
  height: number;
  label: THREE.Sprite | null;
  labelText: string;
};

type Entry = { tpl: CharacterTemplate; refs: number; used: number };

/** Montar um visual novo custa ~10 ms; mais que isso por quadro vira travada quando a multidão chega perto. */
const BUILDS_PER_FRAME = 2;
const TEMPLATE_KEEP = 96; // modelos guardados sem uso antes de descartar a geometria
const POOL_MAX = 48; // avatares prontos guardados para reaproveitar

const keyOf = (v: AvatarPose) => (v.vehicle ? `v${v.vehicle}|${v.team}` : `${v.look}|${v.team}`);
const DEFAULT_PACKED = packLook(DEFAULT_LOOK);

/**
 * Até NEAR_MAX personagens animados. Um modelo por combinação de visual e time, clonado para cada pessoa.
 * Enquanto o modelo de alguém não fica pronto, ele aparece com o visual padrão do time.
 */
export class Avatars {
  private readonly templates = new Map<string, Entry>();
  private readonly active = new Map<number, Avatar>();
  private readonly pool: Avatar[] = [];
  private readonly scene: THREE.Scene;
  private builds = 0;
  private frame = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(visible: Map<number, AvatarPose>, names: Map<number, { nick: string }>, dt: number, selfId: number): void {
    this.frame++;
    this.builds = 0;
    for (const [id, a] of this.active) if (!visible.has(id)) this.release(id, a);
    // O próprio jogador primeiro, para nunca ficar com o substituto.
    const order = [...visible].sort(([a], [b]) => (a === selfId ? -1 : b === selfId ? 1 : 0));
    for (const [id, v] of order) {
      const want = keyOf(v);
      let a = this.active.get(id);
      if (!a || a.key !== want) {
        const next = this.acquire(want, v, id === selfId);
        if (next) {
          if (a) this.release(id, a);
          a = next;
          a.root.rotation.y = v.yaw;
          this.active.set(id, a);
        }
      }
      if (!a) continue;
      a.root.position.set(v.x, 0, v.z);
      if (a.vehicle) {
        // Veículos giram suave (a direção chega em 8 bits e a predição vira em degraus de tick).
        a.root.rotation.y += wrapAngle(v.yaw - a.root.rotation.y) * Math.min(1, dt * 10);
      } else {
        a.root.rotation.y = v.yaw;
      }
      if (!a.vehicle && v.anim !== a.anim) {
        const from = a.actions[a.anim] ?? a.actions[ANIM.idle];
        const to = a.actions[v.anim] ?? a.actions[ANIM.idle];
        to.reset().play();
        from.crossFadeTo(to, 0.2, false);
        a.anim = v.anim;
      }
      a.mixer.update(dt);
      const nick = id === selfId ? '' : names.get(id)?.nick ?? '';
      if (nick !== a.labelText) this.setLabel(a, nick, v.team);
    }
  }

  /** Avatar com o modelo pedido, ou com o substituto do time se o orçamento do quadro acabou. null se nem isso. */
  private acquire(key: string, v: AvatarPose, urgent: boolean): Avatar | null {
    const i = this.pool.findLastIndex((p) => p.key === key);
    if (i >= 0) {
      const [pooled] = this.pool.splice(i, 1);
      this.scene.add(pooled.root);
      return pooled;
    }
    const entry = this.template(key, v, urgent);
    if (entry) return this.instantiate(key, entry, v.vehicle > 0);
    // Substituto: o visual padrão do time (um por time, montado uma vez).
    const fallback = `${DEFAULT_PACKED}|${v.team}`;
    if (v.vehicle || key === fallback) return null;
    const fb = this.template(fallback, { ...v, look: DEFAULT_PACKED }, true);
    return fb ? this.instantiate(fallback, fb, false) : null;
  }

  private template(key: string, v: AvatarPose, urgent: boolean): Entry | null {
    let e = this.templates.get(key);
    if (!e) {
      if (!urgent && this.builds >= BUILDS_PER_FRAME) return null;
      this.builds++;
      const team = teams[v.team] ?? teams[0];
      const tpl: CharacterTemplate = v.vehicle
        ? { root: buildVehicle(v.vehicle, team), clips: [], height: VEHICLE_HEIGHT[v.vehicle] ?? 3 }
        : buildCharacter(unpackLook(v.look), team);
      e = { tpl, refs: 0, used: this.frame };
      this.templates.set(key, e);
      this.evictTemplates();
    }
    e.used = this.frame;
    return e;
  }

  private instantiate(key: string, e: Entry, vehicle: boolean): Avatar {
    e.refs++;
    const t = e.tpl;
    const root = (vehicle ? t.root.clone() : cloneSkinned(t.root)) as THREE.Group;
    const mixer = new THREE.AnimationMixer(root);
    const actions = t.clips.map((c) => mixer.clipAction(c));
    actions[ANIM.idle]?.play();
    // Cada personagem começa num ponto diferente do ciclo, para a multidão não andar em sincronia.
    mixer.setTime(Math.random() * 2);
    this.scene.add(root);
    return { key, vehicle, root, mixer, actions, anim: ANIM.idle, height: t.height, label: null, labelText: '' };
  }

  private setLabel(a: Avatar, nick: string, team: number): void {
    if (a.label) {
      a.root.remove(a.label);
      disposeLabel(a.label);
      a.label = null;
    }
    if (nick) {
      a.label = makeLabel(nick, teams[team]?.color ?? '#888888');
      a.label.position.y = a.height + 0.3;
      a.root.add(a.label);
    }
    a.labelText = nick;
  }

  private release(id: number, a: Avatar): void {
    this.active.delete(id);
    this.scene.remove(a.root);
    this.setLabel(a, '', 0);
    this.pool.push(a);
    while (this.pool.length > POOL_MAX) this.destroy(this.pool.shift()!);
  }

  /** Descarta um avatar guardado: animações, esqueleto e, se ninguém mais usa, o modelo dele. */
  private destroy(a: Avatar): void {
    a.mixer.stopAllAction();
    a.mixer.uncacheRoot(a.root);
    a.root.traverse((o) => (o as THREE.SkinnedMesh).skeleton?.dispose());
    const e = this.templates.get(a.key); // a geometria é do modelo: só sai quando ele for despejado
    if (e) e.refs--;
    this.evictTemplates();
  }

  /** Mantém no máximo TEMPLATE_KEEP modelos; descarta os sem uso há mais tempo e sem clones vivos. */
  private evictTemplates(): void {
    if (this.templates.size <= TEMPLATE_KEEP) return;
    const idle = [...this.templates].filter(([, e]) => e.refs <= 0).sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of idle) {
      if (this.templates.size <= TEMPLATE_KEEP) break;
      this.templates.delete(key);
      e.tpl.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }
}
