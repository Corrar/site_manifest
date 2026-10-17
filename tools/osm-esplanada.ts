/**
 * Gera shared/map.json a partir do OpenStreetMap.
 *
 *   npm run map                       baixa do Overpass e converte
 *   npm run map -- --from dados.json  converte um arquivo já baixado (exportação JSON do overpass-turbo.eu)
 *   npm run map -- --consulta         só imprime a consulta, para colar no overpass-turbo.eu
 *   npm run map -- --salvar bruto.json  além de converter, guarda a resposta do Overpass nesse arquivo
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Collider } from '../shared/map.ts';
import { overpassQuery, toMapData, type OverpassResult } from './osm.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes('--consulta')) {
  console.log(overpassQuery());
  process.exit(0);
}

async function download(): Promise<OverpassResult> {
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
    console.error('Sem acesso ao Overpass? Rode `npm run map -- --consulta`, cole a consulta em https://overpass-turbo.eu,');
    console.error('exporte os dados brutos em JSON e rode `npm run map -- --from arquivo.json`.');
    process.exit(1);
  }
  return (await res.json()) as OverpassResult;
}

const from = flag('--from');
let osm: OverpassResult;
if (from) {
  osm = JSON.parse(readFileSync(from, 'utf8')) as OverpassResult;
  if (!Array.isArray(osm.elements)) {
    console.error(`${from}: não parece uma resposta do Overpass (sem "elements"). Exporte como JSON, não GeoJSON/GPX.`);
    process.exit(1);
  }
  if (!osm.elements.some((e) => e.type === 'way' && 'geometry' in e && e.geometry)) {
    console.error(`${from}: as vias vieram sem geometria. A consulta precisa terminar em "out geom;" (veja npm run map -- --consulta).`);
    process.exit(1);
  }
} else {
  osm = await download();
}
const save = flag('--salvar');
if (save) writeFileSync(save, JSON.stringify(osm));

const map = toMapData(osm);
const out = fileURLToPath(new URL('../shared/map.json', import.meta.url));
writeFileSync(out, JSON.stringify(map));
const kinds = map.areas.reduce<Record<string, number>>((acc, a) => ((acc[a.kind] = (acc[a.kind] ?? 0) + 1), acc), {});
console.log(`map.json: ${map.buildings.length} prédios, ${map.roads.length} vias, ${map.areas.length} áreas (${JSON.stringify(kinds)}), `
  + `${map.trees?.length ?? 0} árvores mapeadas, ${map.solids.length} marcos`);
if (Collider.fromMap(map).blocked(0, 0)) console.warn('Atenção: a origem (ponto de nascimento) caiu dentro de um prédio.');
