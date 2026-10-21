#!/usr/bin/env node
// Builds public/lakes/: OpenStreetMap lake outlines, one small file per 0.5° tile of the OSM extract.
// The fishing check falls back to these where Esri/NHD water bodies has no lake at a point (NHD maps some reservoirs,
// e.g. Stevens Creek Reservoir, only as an unnamed "Inundation Area").
//
//   node scripts/build-lakes.mjs      (rerun after `npm run extract:osm`)
//
// Only names that say lake/reservoir/pond/forebay/afterbay/tarn: the extract tags every named natural=water polygon
// as a lake, including river and slough polygons (Sacramento River, Delta sloughs), which must keep stream rules.
// Multipolygon members arrive as separate open lines, so they're joined into closed rings here.
//
// Format: index.json { tile, built, osmBase, tiles: ["x_y", …] }; x_y.json { lakes: [[name, [ring, …]], …] },
// each ring delta-encoded in 1e-5 degrees like the extract ([x0, y0, dx1, dy1, …]).
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OSM = join(ROOT, 'public', 'osm');
const OUT = join(ROOT, 'public', 'lakes');
const LAKE_NAME = /\b(lakes?|reservoirs?|ponds?|forebay|afterbay|tarns?)\b/i;

const decode = enc => { let x = 0, y = 0; const pts = []; for (let i = 0; i < enc.length; i += 2) { x += enc[i]; y += enc[i + 1]; pts.push([x, y]); } return pts; };
const encode = pts => pts.flatMap(([x, y], i) => (i ? [x - pts[i - 1][0], y - pts[i - 1][1]] : [x, y]));
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

// Join open lines that share endpoints into closed rings; lines that never close are dropped.
function rings(lines) {
  const out = [], open = [];
  for (const l of lines) (l.length > 3 && same(l[0], l[l.length - 1]) ? out : open).push(l);
  while (open.length) {
    let ring = open.pop(), grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const l = open[i], end = ring[ring.length - 1];
        if (same(l[0], end)) ring = ring.concat(l.slice(1));
        else if (same(l[l.length - 1], end)) ring = ring.concat(l.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    if (ring.length > 3 && same(ring[0], ring[ring.length - 1])) out.push(ring);
  }
  return out;
}

const index = JSON.parse(readFileSync(join(OSM, 'index.json'), 'utf8'));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const tiles = [];
let lakes = 0, bytes = 0;
for (const file of readdirSync(join(OSM, 't'))) {
  const t = JSON.parse(readFileSync(join(OSM, 't', file), 'utf8'));
  const out = [];
  for (const w of t.waters) {
    if (w.k !== 'lake' || !LAKE_NAME.test(w.n)) continue;
    const rs = rings(w.l.map(decode));
    if (rs.length) out.push([w.n, rs.map(encode)]);
  }
  if (!out.length) continue;
  const key = file.replace(/\.json$/, ''), json = JSON.stringify({ lakes: out });
  writeFileSync(join(OUT, `${key}.json`), json);
  tiles.push(key); lakes += out.length; bytes += json.length;
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ tile: index.tile, built: new Date().toISOString(), osmBase: index.osmBase, tiles: tiles.sort() }));
console.log(`${lakes} lakes in ${tiles.length} tiles, ${(bytes / 1e6).toFixed(1)} MB -> public/lakes/`);
