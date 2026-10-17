/**
 * Mapa PROVISÓRIO e aproximado da Esplanada dos Ministérios, desenhado à mão (sem dados do OSM).
 * Existe só porque o Overpass não estava acessível quando a Tarefa 11 foi feita.
 * Substitua por `npm run map` (tools/osm-esplanada.ts, dados do OpenStreetMap) assim que houver acesso ao Overpass.
 *
 * Uso: `npm run map:esquematico` grava shared/map.json no mesmo formato MapData.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pt } from '../shared/geometry.ts';
import { LANDMARKS } from '../shared/landmarks.ts';
import { Collider, type Area, type Building, type MapData, type Road } from '../shared/map.ts';
import { sampleAlong, toMapData } from './osm.ts';

const congresso = LANDMARKS.find((l) => l.name === 'Congresso Nacional');
if (!congresso) throw new Error('marco do Congresso não encontrado');

/** Ângulo do eixo da Esplanada: da origem rumo ao Congresso. */
export const AXIS_ANGLE = Math.atan2(congresso.center[1], congresso.center[0]);

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

/** Coordenadas locais (u ao longo do eixo, rumo ao Congresso; v perpendicular, positivo = sul) para o mundo. */
export function toWorld(u: number, v: number, theta = AXIS_ANGLE): Pt {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [r2(u * c - v * s), r2(u * s + v * c)];
}

/** Retângulo [u0,u1]×[v0,v1] em coordenadas locais, convertido para o mundo. */
export function localRect(u0: number, u1: number, v0: number, v1: number): Pt[] {
  return [toWorld(u0, v0), toWorld(u1, v0), toWorld(u1, v1), toWorld(u0, v1)];
}

const line = (u0: number, v0: number, u1: number, v1: number): Pt[] => [toWorld(u0, v0), toWorld(u1, v1)];

/** Centros (em u) dos 8 ministérios de cada lado. */
export const MINISTRY_U = Array.from({ length: 8 }, (_, i) => -260 + 85 * i);
const MINISTRY_W = 25;
const PALACE_U = 420;
const PALACE_SIZE = 85;

/** Sorteio com semente fixa: o mapa sai igual em toda execução. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}

export function buildSchematicMap(): MapData {
  const { bounds } = toMapData({ elements: [] });

  const areas: Area[] = [
    { outline: localRect(-700, 470, -130, 130), kind: 'grass' },
    { outline: localRect(-1300, -720, -130, 130), kind: 'grass' },
    // Praça dos Três Poderes: piso de pedra em volta do Congresso, do Planalto e do STF.
    { outline: localRect(690, 930, -240, 240), kind: 'paved' },
  ];
  // Estacionamentos atrás dos anexos, entre a via de serviço e o fundo do lote.
  for (const side of [-1, 1]) {
    for (const u of MINISTRY_U) {
      areas.push({ outline: localRect(u - 36, u + 36, side * 342, side * 372), kind: 'paved' });
    }
  }

  const roads: Road[] = [
    { line: line(-1350, -150, 760, -150), width: 21 }, // N1
    { line: line(-1350, 150, 760, 150), width: 21 }, // S1
    { line: line(-300, -330, 480, -330), width: 10.5 },
    { line: line(-300, 330, 480, 330), width: 10.5 },
    // Vias dos setores a oeste (grade), dos dois lados do eixo.
    ...[-1, 1].flatMap((side): Road[] => [
      { line: line(-1345, side * 255, -780, side * 255), width: 10.5 },
      { line: line(-1345, side * 360, -780, side * 360), width: 10.5 },
      { line: line(-1345, side * 465, -780, side * 465), width: 7 },
      ...[-1345, -1235, -1125, -1015, -905, -795].map((u): Road => ({ line: line(u, side * 150, u, side * 470), width: 7 })),
    ]),
  ];
  // Transversais entre os ministérios (a oeste de cada bloco), ligando a via principal à de serviço.
  for (const u of MINISTRY_U.map((c) => c - 85 / 2)) {
    roads.push({ line: line(u, -150, u, -330), width: 7 });
    roads.push({ line: line(u, 150, u, 330), width: 7 });
  }

  type Block = { u: number; v: number; du: number; dv: number; height: number; material?: Building['material']; color?: string };
  const blocks: Block[] = [];
  for (const side of [-1, 1]) {
    for (const u of MINISTRY_U) {
      blocks.push({ u, v: side * 220, du: MINISTRY_W, dv: 100, height: 40 });
      blocks.push({ u, v: side * 298, du: 44, dv: 36, height: 21 }); // anexo, atrás do bloco
    }
    // Sul: Palácio do Itamaraty. Norte: Palácio da Justiça.
    blocks.push({ u: PALACE_U, v: side * 215, du: PALACE_SIZE, dv: PALACE_SIZE, height: 20 });
  }
  // Praça dos Três Poderes, depois do Congresso: Palácio do Planalto (norte) e STF (sul).
  blocks.push({ u: 845, v: -175, du: 60, dv: 110, height: 16 });
  blocks.push({ u: 845, v: 175, du: 50, dv: 70, height: 14 });
  // Setores Bancário, Comercial e Hoteleiro (norte e sul), perto da Rodoviária: quadras de prédios altos.
  const r = seeded(7);
  for (const side of [-1, 1]) {
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 3; row++) {
        const u = -1290 + col * 110;
        const v = side * (200 + row * 105);
        const n = 1 + Math.floor(r() * 2); // um ou dois prédios por quadra
        for (let k = 0; k < n; k++) {
          const du = n === 1 ? 44 + r() * 20 : 26 + r() * 10;
          const dv = 30 + r() * 30;
          const cu = u + (n === 1 ? 0 : (k - 0.5) * 42);
          // Fachadas variadas: vidro espelhado, concreto com janelas, tijolo; algumas com cor própria.
          const pick = r();
          const material = pick < 0.45 ? 'glass' : pick < 0.8 ? 'windows' : pick < 0.9 ? 'concrete' : 'brick';
          const colors = ['#dccfb4', '#c7c9cc', '#e8e2d6', '#9fb4c7', '#d9b48a', '#b9c6b0'];
          blocks.push({ u: cu, v, du, dv, height: Math.round(28 + r() * 62), material, color: r() < 0.5 ? colors[Math.floor(r() * colors.length)] : undefined });
        }
      }
    }
    // Setor de Autarquias / anexos: faixa de prédios médios atrás dos estacionamentos dos ministérios.
    for (const u of MINISTRY_U) {
      if (r() < 0.35) continue;
      blocks.push({ u: u + (r() - 0.5) * 20, v: side * (420 + r() * 30), du: 30 + r() * 30, dv: 22 + r() * 16, height: Math.round(14 + r() * 24) });
    }
  }

  const buildings: Building[] = [];
  for (const b of blocks) {
    const [cx, cz] = toWorld(b.u, b.v);
    if (LANDMARKS.some((l) => Math.hypot(cx - l.center[0], cz - l.center[1]) < l.clearRadius)) continue;
    const bd: Building = { outline: localRect(b.u - b.du / 2, b.u + b.du / 2, b.v - b.dv / 2, b.v + b.dv / 2), height: b.height };
    if (b.material) bd.material = b.material;
    if (b.color) bd.color = b.color;
    buildings.push(bd);
  }

  // Fileiras de árvores nos vãos entre os ministérios, dos dois lados do eixo.
  const trees: Pt[] = [];
  for (const side of [-1, 1]) {
    for (const u of MINISTRY_U.map((c) => c + 85 / 2 - 12)) {
      trees.push(...sampleAlong([toWorld(u, side * 165), toWorld(u, side * 310)], 8));
    }
  }

  const solids = LANDMARKS.map((l) => l.footprint.map(([x, z]): Pt => [r2(x), r2(z)]));
  return { version: 1, bounds, roads, buildings, areas, solids, trees };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const map = buildSchematicMap();
  const out = fileURLToPath(new URL('../shared/map.json', import.meta.url));
  writeFileSync(out, JSON.stringify(map));
  console.log(`map.json (esquemático): ${map.buildings.length} prédios, ${map.roads.length} vias, ${map.areas.length} áreas, ${map.solids.length} marcos`);
  if (Collider.fromMap(map).blocked(0, 0)) console.warn('Atenção: a origem (ponto de nascimento) caiu dentro de um prédio.');
}
