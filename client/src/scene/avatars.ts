import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ANIM } from '../../../shared/constants.ts';
import teams from '../../../shared/teams.json' with { type: 'json' };
import { disposeLabel, makeLabel } from './labels.ts';

const CLIPS = ['Idle', 'Walking', 'Running', 'Wave']; // índice = valor de ANIM
const HEIGHT = 1.75;

export type AvatarPose = { x: number; z: number; yaw: number; anim: number; team: number };

type Avatar = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: THREE.AnimationAction[];
  anim: number;
  team: number;
  label: THREE.Sprite | null;
  labelText: string;
};

/** Até NEAR_MAX personagens animados, reaproveitados de um pool. */
export class Avatars {
  private template: THREE.Object3D | null = null;
  private clips: THREE.AnimationClip[] = [];
  private scale = 1;
  private footOffset = 0;
  private mainMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly teamMaterials = new Map<number, THREE.Material>();
  private readonly active = new Map<number, Avatar>();
  private readonly pool: Avatar[] = [];
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.template = gltf.scene;
    this.clips = CLIPS.map((name) => {
      const clip = THREE.AnimationClip.findByName(gltf.animations, name);
      if (!clip) throw new Error(`animação ${name} não encontrada no modelo`);
      return clip;
    });
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material).name === 'Main') this.mainMaterial = m.material as THREE.MeshStandardMaterial;
    });
    // Mede a altura já com os ossos aplicados, para escalar a 1,75 m com os pés no chão.
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.update();
    });
    const box = new THREE.Box3().setFromObject(gltf.scene, true);
    const h = box.max.y - box.min.y;
    this.scale = h > 0.01 ? HEIGHT / h : 1;
    this.footOffset = -box.min.y * this.scale;
  }

  sync(visible: Map<number, AvatarPose>, names: Map<number, { nick: string }>, dt: number, selfId: number): void {
    if (!this.template) return;
    for (const [id, a] of this.active) if (!visible.has(id)) this.release(id, a);
    for (const [id, v] of visible) {
      let a = this.active.get(id);
      if (!a) {
        a = this.acquire();
        this.active.set(id, a);
      }
      this.paint(a, v.team);
      a.root.position.set(v.x, 0, v.z);
      a.root.rotation.y = v.yaw;
      if (v.anim !== a.anim) {
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

  private acquire(): Avatar {
    const pooled = this.pool.pop();
    if (pooled) {
      this.scene.add(pooled.root);
      return pooled;
    }
    const model = cloneSkinned(this.template!);
    model.scale.setScalar(this.scale);
    model.position.y = this.footOffset;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false; // a caixa do SkinnedMesh não acompanha a animação
        if ((m.material as THREE.Material).name === 'Main') m.userData.main = true;
      }
    });
    const root = new THREE.Group();
    root.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const actions = this.clips.map((c) => mixer.clipAction(c));
    actions[ANIM.idle].play();
    this.scene.add(root);
    return { root, mixer, actions, anim: ANIM.idle, team: -1, label: null, labelText: '' };
  }

  private paint(a: Avatar, team: number): void {
    if (a.team === team) return;
    a.team = team;
    let mat = this.teamMaterials.get(team);
    if (!mat) {
      const m = (this.mainMaterial?.clone() ?? new THREE.MeshStandardMaterial()) as THREE.MeshStandardMaterial;
      m.color.set(teams[team]?.color ?? '#888888');
      this.teamMaterials.set(team, m);
      mat = m;
    }
    a.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.main) m.material = mat!;
    });
  }

  private setLabel(a: Avatar, nick: string, team: number): void {
    if (a.label) {
      a.root.remove(a.label);
      disposeLabel(a.label);
      a.label = null;
    }
    if (nick) {
      a.label = makeLabel(nick, teams[team]?.color ?? '#888888');
      a.label.position.y = HEIGHT + 0.35;
      a.root.add(a.label);
    }
    a.labelText = nick;
  }

  private release(id: number, a: Avatar): void {
    this.active.delete(id);
    this.scene.remove(a.root);
    this.setLabel(a, '', a.team);
    this.pool.push(a);
  }
}
