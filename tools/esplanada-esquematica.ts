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
  ];
  // Transversais entre os ministérios (a oeste de cada bloco), ligando a via principal à de serviço.
  for (const u of MINISTRY_U.map((c) => c - 85 / 2)) {
    roads.push({ line: line(u, -150, u, -330), width: 7 });
    roads.push({ line: line(u, 150, u, 330), width: 7 });
  }

  type Block = { u: number; v: number; du: number; dv: number; height: number };
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

  const buildings: Building[] = [];
  for (const b of blocks) {
    const [cx, cz] = toWorld(b.u, b.v);
    if (LANDMARKS.some((l) => Math.hypot(cx - l.center[0], cz - l.center[1]) < l.clearRadius)) continue;
    buildings.push({ outline: localRect(b.u - b.du / 2, b.u + b.du / 2, b.v - b.dv / 2, b.v + b.dv / 2), height: b.height });
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
