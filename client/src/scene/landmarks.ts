import * as THREE from 'three';
import { LANDMARKS } from '../../../shared/landmarks.ts';

const white = new THREE.MeshLambertMaterial({ color: '#f2f2ee', side: THREE.DoubleSide });

function congresso(): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, sy = 1) => {
    const m = new THREE.Mesh(geo, white);
    m.position.set(x, y, z);
    m.scale.y = sy;
    g.add(m);
  };
  add(new THREE.BoxGeometry(80, 10, 200), 0, 5, 0); // plataforma
  add(new THREE.SphereGeometry(30, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0, 25, 50, 0.5); // tigela da Câmara (sul)
  add(new THREE.SphereGeometry(20, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0, 10, -50, 0.6); // cúpula do Senado (norte)
  add(new THREE.BoxGeometry(14, 100, 24), 50, 50, -10); // torres
  add(new THREE.BoxGeometry(14, 100, 24), 50, 50, 14);
  add(new THREE.BoxGeometry(14, 6, 8), 50, 70, 2); // passarela entre as torres
  return g;
}

function catedral(): THREE.Group {
  const g = new THREE.Group();
  const profile = [[30, 0], [19, 12], [12, 25], [10.5, 31], [13, 38], [17, 42]].map(([r, y]) => new THREE.Vector2(r, y));
  const glass = new THREE.MeshLambertMaterial({ color: '#7fb3d5', transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.LatheGeometry(profile.map((v) => new THREE.Vector2(v.x * 0.97, v.y)), 32), glass));
  for (let i = 0; i < 16; i++) {
    g.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 1, (i / 16) * Math.PI * 2, 0.14), white)); // 16 colunas
  }
  return g;
}

export function buildLandmarks(scene: THREE.Scene): void {
  for (const l of LANDMARKS) {
    const obj = l.name === 'Catedral' ? catedral() : congresso();
    obj.position.set(l.center[0], 0, l.center[1]);
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    scene.add(obj);
  }
}
