import { project } from './geo.ts';
import type { Pt } from './geometry.ts';

export type Landmark = { name: string; center: Pt; clearRadius: number; footprint: Pt[] };

const rect = (cx: number, cz: number, w: number, d: number): Pt[] => [
  [cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2],
];
const circle = (cx: number, cz: number, r: number, n = 16): Pt[] =>
  Array.from({ length: n }, (_, i): Pt => [cx + Math.cos((i / n) * Math.PI * 2) * r, cz + Math.sin((i / n) * Math.PI * 2) * r]);

const congresso = project(-15.7997, -47.8641);
const catedral = project(-15.7981, -47.8753);

/** Modelados à mão no cliente. O mapa remove os prédios do OSM dentro de clearRadius e usa footprint como colisão. */
export const LANDMARKS: Landmark[] = [
  // Plataforma norte-sul (cúpula do Senado ao norte, tigela da Câmara ao sul) e torres a leste.
  { name: 'Congresso Nacional', center: congresso, clearRadius: 130, footprint: rect(congresso[0] + 15, congresso[1], 110, 200) },
  { name: 'Catedral', center: catedral, clearRadius: 45, footprint: circle(catedral[0], catedral[1], 30) },
];
