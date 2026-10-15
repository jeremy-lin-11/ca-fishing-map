#!/usr/bin/env node
// Builds public/places.json: the place-search index (California towns + OSM-named lakes, streams and trails).
// Search runs in the browser against this file, so there's no third-party geocoder and it works offline.
//
//   node scripts/build-places.mjs      (rerun after `npm run extract:osm` to pick up new tiles)
//
// Format: { built, osmBase, places: [[name, kind, lat, lng, population?], …] }, kind = town | lake | stream | trail.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OSM = join(ROOT, 'public', 'osm');
const OUT = join(ROOT, 'public', 'places.json');
const PLACES = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Populated_Places/FeatureServer/0/query';

const decodeFirst = enc => { let x = 0, y = 0; const pts = []; for (let i = 0; i < enc.length; i += 2) { x += enc[i]; y += enc[i + 1]; pts.push([x / 1e5, y / 1e5]); } return pts; };
const r4 = n => Math.round(n * 1e4) / 1e4;

// Towns (US Census places, incl. small census-designated places).
const q = new URLSearchParams({ where: "ST='CA'", outFields: 'NAME,CLASS,POPULATION', returnCentroid: 'true', returnGeometry: 'false', outSR: '4326', f: 'json', resultRecordCount: '5000' });
const towns = JSON.parse(execFileSync('curl', ['-sS', '-m', '120', '--data', q.toString(), PLACES], { maxBuffer: 1e8 }).toString());
if (towns.error) throw new Error(JSON.stringify(towns.error));
const places = towns.features.filter(f => f.centroid).map(f => [f.attributes.NAME, 'town', r4(f.centroid.y), r4(f.centroid.x), f.attributes.POPULATION || 0]);
console.log(`${places.length} towns`);

// Named waters and trails from the static OSM tiles. A name repeats along a long trail or river (and across tiles);
// keep one entry per name and kind per ~10 km cell, so distinct same-named places (many "Bear Creek"s) survive.
const seen = new Set();
let osmBase = null, tiles = 0;
if (existsSync(join(OSM, 'index.json'))) {
  osmBase = JSON.parse(readFileSync(join(OSM, 'index.json'), 'utf8')).osmBase;
  for (const file of readdirSync(join(OSM, 't'))) {
    const t = JSON.parse(readFileSync(join(OSM, 't', file), 'utf8'));
    tiles++;
    for (const [list, kindOf] of [[t.waters, e => e.k], [t.trails, () => 'trail']]) {
      for (const e of list) {
        const line = decodeFirst(e.l[0]);
        const [lng, lat] = line[Math.floor(line.length / 2)];
        const kind = kindOf(e), key = `${e.n.toLowerCase()}|${kind}|${Math.round(lat * 10)}|${Math.round(lng * 10)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        places.push([e.n, kind, r4(lat), r4(lng)]);
      }
    }
  }
}
console.log(`${places.length} places in total (OSM tiles read: ${tiles})`);
writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString(), osmBase, places }));
console.log(`wrote ${OUT} (${(readFileSync(OUT).length / 1e6).toFixed(1)} MB)`);
