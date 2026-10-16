import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FAR_MAX } from '../../../shared/constants.ts';
import { SKINS } from '../../../shared/looks.ts';
import teams from '../../../shared/teams.json' with { type: 'json' };

const CAPACITY = FAR_MAX + 200;
const GREY = new THREE.Color('#888888');
const SKIN_COLORS = SKINS.map((c) => new THREE.Color(c));

/**
 * Multidão distante: bonecos low-poly instanciados em três partes (camisa na cor do time, pele, calça),
 * três chamadas de desenho para até mil pessoas. Direção e tom de pele saem do id, então não piscam.
 */
export class Crowd {
  private readonly shirts: THREE.InstancedMesh;
  private readonly skin: THREE.InstancedMesh;
  private readonly legs: THREE.InstancedMesh;
  private readonly colors = teams.map((t) => new THREE.Color(t.color));
  private readonly matrix = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    const torso = new THREE.CapsuleGeometry(0.2, 0.32, 2, 7);
    torso.scale(1, 1, 0.7);
    torso.translate(0, 1.18, 0);
    const head = new THREE.SphereGeometry(0.14, 8, 6);
    head.translate(0, 1.62, 0);
    const armL = new THREE.CapsuleGeometry(0.055, 0.5, 2, 5);
    armL.translate(0.25, 1.08, 0);
    const armR = armL.clone();
    armR.translate(-0.5, 0, 0);
    const legL = new THREE.CapsuleGeometry(0.08, 0.72, 2, 5);
    legL.translate(0.1, 0.45, 0);
    const legR = legL.clone();
    legR.translate(-0.2, 0, 0);
    const make = (geo: THREE.BufferGeometry, color: string, tinted: boolean) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), CAPACITY);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      if (tinted) m.setColorAt(0, GREY);
      scene.add(m);
      return m;
    };
    this.shirts = make(torso, '#ffffff', true);
    this.skin = make(mergeGeometries([head, armL, armR])!, '#ffffff', true);
    this.legs = make(mergeGeometries([legL, legR])!, '#2f3b52', false);
  }

  update(people: Iterable<{ id: number; x: number; z: number; team: number }>): void {
    let i = 0;
    for (const p of people) {
      if (i >= CAPACITY) break;
      const h = Math.sin(p.id * 12.9898) * 43758.5453;
      const r = h - Math.floor(h);
      this.q.setFromAxisAngle(this.up, r * Math.PI * 2);
      this.matrix.compose(this.pos.set(p.x, 0, p.z), this.q, this.one);
      this.shirts.setMatrixAt(i, this.matrix);
      this.skin.setMatrixAt(i, this.matrix);
      this.legs.setMatrixAt(i, this.matrix);
      this.shirts.setColorAt(i, this.colors[p.team] ?? GREY);
      this.skin.setColorAt(i, SKIN_COLORS[Math.floor(r * 997) % SKIN_COLORS.length]);
      i++;
    }
    for (const m of [this.shirts, this.skin, this.legs]) {
      m.count = i;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
