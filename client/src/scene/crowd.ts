import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FAR_MAX } from '../../../shared/constants.ts';
import teams from '../../../shared/teams.json' with { type: 'json' };

const CAPACITY = FAR_MAX + 200;
const GREY = new THREE.Color('#888888');

/** Multidão distante: boneco low-poly instanciado, colorido por time, numa única chamada de desenho. */
export class Crowd {
  private readonly mesh: THREE.InstancedMesh;
  private readonly colors = teams.map((t) => new THREE.Color(t.color));
  private readonly matrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    const body = new THREE.CylinderGeometry(0.25, 0.3, 1.3, 6);
    body.translate(0, 0.65, 0);
    const head = new THREE.SphereGeometry(0.2, 6, 4);
    head.translate(0, 1.55, 0);
    this.mesh = new THREE.InstancedMesh(mergeGeometries([body, head])!, new THREE.MeshLambertMaterial(), CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(people: Iterable<{ x: number; z: number; team: number }>): void {
    let i = 0;
    for (const p of people) {
      if (i >= CAPACITY) break;
      this.matrix.makeTranslation(p.x, 0, p.z);
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i, this.colors[p.team] ?? GREY);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
