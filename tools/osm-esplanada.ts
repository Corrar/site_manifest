import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Collider } from '../shared/map.ts';
import { overpassQuery, toMapData, type OverpassResult } from './osm.ts';

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    // O Overpass recusa requisições sem User-Agent identificável.
    'user-agent': 'manifest-map-tool/0.1 (gerador de mapa do jogo)',
  },
  body: new URLSearchParams({ data: overpassQuery() }),
});
if (!res.ok) {
  console.error(`Overpass respondeu ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const map = toMapData((await res.json()) as OverpassResult);
const out = fileURLToPath(new URL('../shared/map.json', import.meta.url));
writeFileSync(out, JSON.stringify(map));
console.log(`map.json: ${map.buildings.length} prédios, ${map.roads.length} vias, ${map.areas.length} áreas, ${map.solids.length} marcos`);
if (Collider.fromMap(map).blocked(0, 0)) console.warn('Atenção: a origem (ponto de nascimento) caiu dentro de um prédio.');
