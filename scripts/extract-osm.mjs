#!/usr/bin/env node
// One-time extraction of California's named trails, lakes and streams from OpenStreetMap (via Overpass)
// into static tiles under public/osm/, so route search doesn't query Overpass at runtime.
//
//   node scripts/extract-osm.mjs            # resumable: existing tiles are skipped
//   node scripts/extract-osm.mjs --force    # re-extract everything
//
// Runs one query at a time with pauses, per the Overpass usage policy. ~200 tiles, typically 1-2 hours.
// Output: public/osm/index.json and public/osm/t/<x>_<y>.json (0.5° tiles, see TILE below).
//
// Tile format (compact, all coordinates as integer 1e-5 degrees, delta-encoded per line):
//   { trails: [{ i, n, t, l }], waters: [{ i, n, k, l }] }
//   i = OSM id ("w123" / "r456"), n = name, k = 'lake' | 'stream',
//   t = the few tags the app filters on (foot, bicycle, piste, motor, operator), l = [[x0, y0, dx1, dy1, …], …]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'osm');
const TILE = 0.5;
const FORCE = process.argv.includes('--force');
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const SIMPLIFY_M = 5;

// From the app's data file: CA_VISIBLE = land + coastal waters (the app's area), CA_RINGS = land (mainland + islands).
const caSrc = readFileSync(join(ROOT, 'src', 'data', 'california.ts'), 'utf8');
const CA = JSON.parse(caSrc.match(/CA_VISIBLE[^=]*= (\[.*\]);/)[1]);
const LAND = JSON.parse(caSrc.match(/CA_RINGS[^=]*= (\[.*\]);/)[1]);
const pip = ([x, y], ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const boxTouches = (rings, w, s, e, n) => {
  const corners = [[w, s], [e, s], [e, n], [w, n]];
  return rings.some(r => corners.some(c => pip(c, r)) || r.some(([x, y]) => x >= w && x <= e && y >= s && y <= n));
};

const query = (s, w, n, e) => `[out:json][timeout:240][maxsize:536870912];
(
  way["highway"~"^(path|footway|bridleway)$"]["name"]["footway"!="sidewalk"]["access"!="private"](${s},${w},${n},${e});
  way["natural"="water"]["name"]["water"!~"^(wastewater|basin|canal|fountain|pool)$"](${s},${w},${n},${e});
  relation["natural"="water"]["name"](${s},${w},${n},${e});
  way["waterway"~"^(river|stream)$"]["name"](${s},${w},${n},${e});
);
out geom;`;

// curl, because Node's fetch doesn't use HTTP(S)_PROXY. Overpass returns 406 to generic curl/browser
// User-Agents without a Referer; per its usage policy, identify the client. Overload comes back as 429/504.
function overpass(q) {
  const out = execFileSync('curl', ['-sS', '-m', '300', '-A', 'ca-fishing-map-extract/1.0 (one-time static extract of CA trails and waters)',
    '-H', 'Referer: http://localhost:5173/', '--data-urlencode', `data=${q}`, '-w', '\n%{http_code}', ENDPOINT], { maxBuffer: 2e9 }).toString();
  const nl = out.lastIndexOf('\n'), code = +out.slice(nl + 1), body = out.slice(0, nl);
  if (code !== 200) throw Object.assign(new Error(`HTTP ${code}`), { code });
  const j = JSON.parse(body);
  if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error(`Overpass: ${j.remark}`);
  return j;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Douglas-Peucker in a local equirectangular projection; keeps original vertices.
function simplify(pts, tolM, lat0) {
  if (pts.length < 3) return pts;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const P = pts.map(([x, y]) => [x * kx, y * ky]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); let worst = -1, wi = -1;
    for (let k = i + 1; k < j; k++) { const d = segDist(P[k], P[i], P[j]); if (d > worst) { worst = d; wi = k; } }
    if (worst > tolM) { keep[wi] = 1; stack.push([i, wi], [wi, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const encode = (pts) => { const out = []; let px = 0, py = 0; for (const [x, y] of pts) { const ix = Math.round(x * 1e5), iy = Math.round(y * 1e5); out.push(ix - px, iy - py); px = ix; py = iy; } return out; };

function compact(json, lat0) {
  const trails = [], waters = [];
  for (const el of json.elements) {
    const t = el.tags || {};
    const lines = (el.type === 'way' ? [el.geometry] : (el.members || []).filter(m => m.geometry).map(m => m.geometry))
      .filter(g => g && g.length > 1).map(g => encode(simplify(g.map(p => [p.lon, p.lat]), SIMPLIFY_M, lat0)));
    if (!lines.length || !t.name) continue;
    const i = `${el.type[0]}${el.id}`;
    if (t.highway) {
      const tags = {};
      if (t.foot) tags.foot = t.foot;
      if (t.bicycle) tags.bicycle = t.bicycle;
      if (t['piste:type']) tags.piste = 1;
      if (['motor_vehicle', 'motorcycle', 'atv'].some(k => t[k] === 'yes')) tags.motor = 1;
      if (t.operator) tags.operator = t.operator;
      trails.push({ i, n: t.name, t: tags, l: lines });
    } else {
      waters.push({ i, n: t.name, k: t.waterway ? 'stream' : 'lake', l: lines });
    }
  }
  return { trails, waters };
}

async function main() {
  mkdirSync(join(OUT, 't'), { recursive: true });
  const tiles = [];
  for (let s = 32.5; s < 42.1; s += TILE) for (let w = -124.5; w < -114.0; w += TILE) {
    const n = +(s + TILE).toFixed(3), e = +(w + TILE).toFixed(3);
    if (boxTouches([CA], w, s, e, n)) tiles.push({ x: Math.round((w + 180) / TILE), y: Math.round((s + 90) / TILE), s, w, n, e, land: boxTouches(LAND, w, s, e, n) });
  }
  const indexFile = join(OUT, 'index.json');
  const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : { tile: TILE, tiles: {}, osmBase: null };
  // Open-ocean tiles have no trails or lakes: record them as empty so the app doesn't fall back to live queries there.
  for (const t of tiles) if (!t.land) index.tiles[`${t.x}_${t.y}`] = { s: t.s, w: t.w, n: t.n, e: t.e, empty: true };
  writeFileSync(indexFile, JSON.stringify(index));
  const work = tiles.filter(t => t.land);
  console.log(`${tiles.length} tiles in the app's area; ${work.length} touch land and need a query`);
  let done = 0;
  for (const t of work) {
    const key = `${t.x}_${t.y}`, file = join(OUT, 't', `${key}.json`);
    done++;
    if (!FORCE && existsSync(file) && index.tiles[key]) continue;
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      try {
        const j = overpass(query(t.s, t.w, t.n, t.e));
        const c = compact(j, (t.s + t.n) / 2);
        writeFileSync(file, JSON.stringify(c));
        index.tiles[key] = { s: t.s, w: t.w, n: t.n, e: t.e, trails: c.trails.length, waters: c.waters.length };
        index.osmBase = j.osm3s?.timestamp_osm_base ?? index.osmBase;
        index.extracted = new Date().toISOString();
        writeFileSync(indexFile, JSON.stringify(index));
        console.log(`[${done}/${work.length}] ${key}: ${c.trails.length} trails, ${c.waters.length} waters, ${(JSON.stringify(c).length / 1e3).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        break;
      } catch (err) {
        const wait = Math.min(300, 15 * 2 ** attempt);
        console.log(`[${done}/${work.length}] ${key}: ${err.message}; retry ${attempt + 1} in ${wait} s`);
        if (attempt >= 7) { console.log(`giving up on ${key} for now (rerun to resume)`); break; }
        await sleep(wait * 1000);
      }
    }
    await sleep(5000); // be polite between queries
  }
  const have = work.filter(t => index.tiles[`${t.x}_${t.y}`]).length;
  console.log(`done: ${have}/${work.length} land tiles in ${OUT}${have < work.length ? ' (rerun to fetch the rest)' : ''}`);
}

main().catch(e => { console.error(e); process.exit(1); });
