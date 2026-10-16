import * as THREE from 'three';
import { LANDMARKS } from '../../../shared/landmarks.ts';
import { brazilFlagTexture, concreteTexture, FACADE_TILE, glassFacadeTexture } from './textures.ts';

// Marcos modelados à mão. A colisão vem dos `footprint` em shared/landmarks.ts.

const white = new THREE.MeshStandardMaterial({ color: '#f4f3ee', roughness: 0.55 });
const water = new THREE.MeshStandardMaterial({ color: '#2f5f7c', roughness: 0.05, metalness: 0.9 });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, opts: { sy?: number; rot?: THREE.Euler } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (opts.sy) m.scale.y = opts.sy;
  if (opts.rot) m.rotation.copy(opts.rot);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Caixa com UV em ladrilhos de fachada (para textura de vidro/concreto na escala certa). */
function facadeBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i));
    const ny = Math.abs(n.getY(i));
    const sx = ny > 0.5 ? w : nx > 0.5 ? d : w;
    const sy = ny > 0.5 ? d : h;
    uv.setXY(i, (uv.getX(i) * sx) / FACADE_TILE.w, (uv.getY(i) * sy) / FACADE_TILE.h);
  }
  return g;
}

function congresso(): THREE.Group {
  const g = new THREE.Group();
  const towerGlass = new THREE.MeshStandardMaterial({ map: glassFacadeTexture(), roughness: 0.15, metalness: 0.6, envMapIntensity: 1.4 });
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.8 });
  // Plataforma (o "prédio horizontal") com rampa de acesso a oeste
  g.add(mesh(facadeBox(70, 9, 200), concrete, 0, 4.5, 0));
  g.add(mesh(new THREE.BoxGeometry(70.4, 0.8, 200.4), white, 0, 9.3, 0));
  const ramp = new THREE.BoxGeometry(12, 0.6, 52);
  g.add(mesh(ramp, white, -52, 4.6, 0, { rot: new THREE.Euler(0, Math.PI / 2, Math.atan2(9, 52)) }));
  // Câmara (sul): tigela virada para cima. Senado (norte): cúpula.
  g.add(mesh(new THREE.SphereGeometry(31, 48, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white, 0, 25, 52, { sy: 0.5 }));
  g.add(mesh(new THREE.CylinderGeometry(6, 9, 6, 24), white, 0, 12, 52));
  g.add(mesh(new THREE.SphereGeometry(20, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), white, 0, 9.6, -52, { sy: 0.62 }));
  // Torres gêmeas (28 andares) a leste, ligadas no meio
  for (const z of [-11, 11]) {
    g.add(mesh(facadeBox(14, 100, 20), towerGlass, 48, 50, z));
    g.add(mesh(new THREE.BoxGeometry(14.6, 1.2, 20.6), white, 48, 100.6, z));
  }
  g.add(mesh(facadeBox(10, 10, 2.5), concrete, 48, 52, 0));
  // Espelhos d'água na frente (oeste)
  for (const z of [-55, 55]) g.add(mesh(new THREE.BoxGeometry(46, 0.25, 80), water, -70, 0.12, z));
  return g;
}

function catedral(): THREE.Group {
  const g = new THREE.Group();
  const profile = [[30, 0], [19, 12], [12, 25], [10.5, 31], [13, 38], [17, 42]].map(([r, y]) => new THREE.Vector2(r, y));
  const glass = new THREE.MeshStandardMaterial({
    color: '#9cc7e0', transparent: true, opacity: 0.5, roughness: 0.1, metalness: 0.3, side: THREE.DoubleSide,
  });
  g.add(mesh(new THREE.LatheGeometry(profile.map((v) => new THREE.Vector2(v.x * 0.97, v.y)), 48), glass, 0, 0, 0));
  for (let i = 0; i < 16; i++) {
    g.add(mesh(new THREE.LatheGeometry(profile, 2, (i / 16) * Math.PI * 2, 0.14), white, 0, 0, 0)); // 16 colunas
  }
  g.add(mesh(new THREE.CylinderGeometry(29, 29, 0.4, 48), white, 0, 0.2, 0)); // laje de base
  // Espelho d'água em volta (anel) e campanário ao lado
  g.add(mesh(new THREE.RingGeometry(31, 44, 64), water, 0, 0.1, 0, { rot: new THREE.Euler(-Math.PI / 2, 0, 0) }));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(mesh(new THREE.BoxGeometry(0.8, 20, 0.8), white, 52 + x * 2.5, 10, -20 + z * 1.2));
  }
  g.add(mesh(new THREE.BoxGeometry(6, 0.8, 3.4), white, 52, 20.4, -20));
  for (let i = 0; i < 4; i++) {
    g.add(mesh(new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8a6a2e', metalness: 0.8, roughness: 0.35 }), 50 + i * 1.3, 17 - i * 2.5, -20, { rot: new THREE.Euler(Math.PI, 0, 0) }));
  }
  return g;
}

/** Mastro da Bandeira, com a bandeira tremulando. Devolve a função que anima o tecido. */
function mastro(): { group: THREE.Group; update(t: number): void } {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#9aa1a8', metalness: 0.8, roughness: 0.3 });
  g.add(mesh(new THREE.CylinderGeometry(0.6, 1.2, 100, 16), steel, 0, 50, 0));
  g.add(mesh(new THREE.CylinderGeometry(4, 5, 2, 24), white, 0, 1, 0));
  const W = 28;
  const H = 19.6;
  const geo = new THREE.PlaneGeometry(W, H, 28, 14);
  geo.translate(W / 2 + 0.6, 0, 0);
  const base = Float32Array.from(geo.attributes.position.array);
  const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: brazilFlagTexture(), side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(0, 100 - H / 2 - 1, 0);
  flag.castShadow = true;
  g.add(flag);
  const pos = geo.attributes.position;
  return {
    group: g,
    update(t: number) {
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        const k = (x - 0.6) / W; // 0 no mastro, 1 na ponta
        pos.setZ(i, Math.sin(x * 0.35 - t * 3.2 + y * 0.05) * 1.4 * k + Math.sin(x * 0.9 - t * 5.1) * 0.25 * k);
        pos.setY(i, y - k * k * 1.5);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

/** Constrói os marcos e devolve a animação (bandeira). */
export function buildLandmarks(scene: THREE.Scene): (t: number) => void {
  let axis = new THREE.Vector2(1, 0);
  for (const l of LANDMARKS) {
    if (l.name === 'Catedral') {
      const obj = catedral();
      obj.position.set(l.center[0], 0, l.center[1]);
      scene.add(obj);
    } else {
      const obj = congresso();
      // Alinhado aos eixos, como o footprint de colisão em shared/landmarks.ts.
      obj.position.set(l.center[0], 0, l.center[1]);
      axis = new THREE.Vector2(l.center[0], l.center[1]).normalize();
      scene.add(obj);
    }
  }
  // Mastro da Bandeira, na Praça dos Três Poderes, depois do Congresso.
  const cong = LANDMARKS.find((l) => l.name !== 'Catedral');
  if (!cong) return () => {};
  const m = mastro();
  m.group.position.set(cong.center[0] + axis.x * 230, 0, cong.center[1] + axis.y * 230);
  m.group.rotation.y = -Math.atan2(axis.y, axis.x) + Math.PI / 2;
  scene.add(m.group);
  let last = -1;
  return (t: number) => {
    if (t - last < 1 / 30) return; // 30 quadros por segundo bastam para o tecido
    last = t;
    m.update(t);
  };
}
