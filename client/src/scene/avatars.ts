import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIM } from '../../../shared/constants.ts';
import { unpackLook } from '../../../shared/looks.ts';
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

const TEMPLATE_MAX = 200;

/** Até NEAR_MAX personagens animados. Um modelo por combinação de visual e time, reaproveitado por clones. */
export class Avatars {
  private readonly templates = new Map<string, CharacterTemplate>();
  private readonly active = new Map<number, Avatar>();
  private readonly pools = new Map<string, Avatar[]>();
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(visible: Map<number, AvatarPose>, names: Map<number, { nick: string }>, dt: number, selfId: number): void {
    for (const [id, a] of this.active) if (!visible.has(id)) this.release(id, a);
    for (const [id, v] of visible) {
      const key = v.vehicle ? `v${v.vehicle}|${v.team}` : `${v.look}|${v.team}`;
      let a = this.active.get(id);
      if (a && a.key !== key) {
        this.release(id, a);
        a = undefined;
      }
      if (!a) {
        a = this.acquire(key, v);
        a.root.rotation.y = v.yaw;
        this.active.set(id, a);
      }
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

  private template(key: string, v: AvatarPose): CharacterTemplate {
    let t = this.templates.get(key);
    if (!t) {
      if (this.templates.size >= TEMPLATE_MAX) this.templates.clear(); // os clones ativos mantêm a geometria viva
      const team = teams[v.team] ?? teams[0];
      t = v.vehicle
        ? { root: buildVehicle(v.vehicle, team), clips: [], height: VEHICLE_HEIGHT[v.vehicle] ?? 3 }
        : buildCharacter(unpackLook(v.look), team);
      this.templates.set(key, t);
    }
    return t;
  }

  private acquire(key: string, v: AvatarPose): Avatar {
    const pooled = this.pools.get(key)?.pop();
    if (pooled) {
      this.scene.add(pooled.root);
      return pooled;
    }
    const t = this.template(key, v);
    const vehicle = v.vehicle > 0;
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
    let pool = this.pools.get(a.key);
    if (!pool) this.pools.set(a.key, (pool = []));
    if (pool.length < 8) pool.push(a);
  }
}
