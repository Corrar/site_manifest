import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_BODIES } from '../../../shared/looks.ts';

// Personagens de modelo .glb pronto (gerados por tools/rig): mesmo esqueleto e mesmas animações do jogo.

export type LoadedModel = { scene: THREE.Group; hipsY: number; height: number };

const loaded = new Map<number, LoadedModel>();
const listeners: (() => void)[] = [];
let started = false;

export function loadedModel(body: number): LoadedModel | null {
  return loaded.get(body) ?? null;
}

/** Avisa quando um modelo termina de carregar (para trocar o substituto pelo modelo de verdade). */
export function onModelsLoaded(cb: () => void): void {
  listeners.push(cb);
}

/** Carrega todos os modelos em segundo plano. Pode ser chamada mais de uma vez. */
export function loadModels(): void {
  if (started) return;
  started = true;
  const loader = new GLTFLoader();
  for (const [body, url] of Object.entries(MODEL_BODIES)) {
    loader.loadAsync(url).then((gltf) => {
      const extras = (gltf.scene.userData ?? {}) as { hipsY?: number; height?: number };
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false; // a caixa da malha não acompanha a animação
        // O GLTFLoader engole a falha de uma textura e deixa o material sem mapa (personagem branco).
        // Causa típica: a CSP sem `blob:` em connect-src (o loader busca a imagem do .glb por URL blob:).
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat?.isMeshStandardMaterial && !mat.map) console.error(`modelo ${url}: textura não carregou; confira a Content-Security-Policy (connect-src blob:)`);
      });
      loaded.set(Number(body), { scene: gltf.scene, hipsY: extras.hipsY ?? 0.94, height: extras.height ?? 1.75 });
      for (const cb of listeners) cb();
    }).catch((err) => console.error(`modelo ${url}:`, err));
  }
}
