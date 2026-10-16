# California Public Land & Fishing Map

A map of California for anglers. Click anywhere to see who owns the land, whether you can fish there,
the CDFW regulations for that water (season and trout limit on a given day), and depth. Three tabs:

- **Fishing check**: land ownership, legality, special regulations, today's season and trout limit, depth.
- **Backpacking routes**: trails in the map view that pass near fishable water, filtered by length, land type,
  trip dates, special regulations and whether trout may be kept.
- **Shore spots**: rocky shoreline near public coastal access for rockfishing, with an access-difficulty rating.

It works as an installable app, offline in saved areas, and every view is a shareable link.

```
npm install
npm run extract:osm   # one-time (1-3 h, resumable): OpenStreetMap trails/lakes/streams -> public/osm/
npm run build:places  # place-search index -> public/places.json (rerun after the extract)
npm run dev           # http://localhost:5173
npm test              # offline unit tests
npm run test:live     # known points/areas against the live data services (needs network)
npm run build         # type-check + production build to dist/
```

Informational only. Always confirm against the current CDFW regulations.

---

## System design

### Architecture

The app is a static single-page app with no backend. Everything it knows comes from public government data
services, queried directly from the browser, plus a few static files generated at build time.

```
                                 Browser
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │  React UI (src/components)                                                            │
 │    Sidebar: Fishing check │ Backpacking routes │ Shore spots      MapView (Leaflet)   │
 │        │                         │                    │              │               │
 │        ▼                         ▼                    ▼              ▼               │
 │  lib/analyze.ts         lib/routeSearch.ts ──► Web Worker        esri-leaflet layers  │
 │  fetchPoint → interpret        (routes.worker.ts)                (grid cells clipped  │
 │        │                 trails.ts · shore.ts · rules.ts           to California)    │
 │        │                         │                                                    │
 │        └──────────┬──────────────┘   lib/ = plain TypeScript: no React, no Leaflet    │
 │                   ▼                                                                   │
 │             lib/http.ts  (one swappable transport; tests use curl)                    │
 │                                                                                       │
 │  Service worker (public/sw.js): app shell + saved basemap tiles                       │
 │  IndexedDB: saved offline areas      Cache Storage: USGS tiles      URL: app state    │
 └───────────────┬──────────────────────────────────────────────────┬────────────────────┘
                 │ live queries (ArcGIS REST, image services)       │ static files (same origin)
                 ▼                                                  ▼
  CDFW regulations, MPAs, shoreline, groundfish areas   public/osm/  OSM trails/lakes/streams tiles
  CAL FIRE land ownership · Coastal Commission access   public/places.json  place-search index
  USFS trails · Esri Living Atlas (names, water, counties)
  NOAA elevation/depth · USGS basemaps
```

### Design principles

- **Logic is plain TypeScript.** Everything in `src/lib/` runs in Node without a browser, so lookups and
  decisions are unit-tested and checked against live services (`npm run test:live`). React components only render.
- **Fetch, then interpret.** Each feature splits into an I/O step that collects raw service responses and a pure
  step that turns them into an answer: `fetchPoint` → `interpret`, `fetchRouteData` → `prepareRouteData` →
  `matchRoutes`. Filters, water-type changes and trip dates re-run only the pure step, instantly. The same
  `interpret` answers offline from saved data, so offline and online answers can't drift.
- **Unknown is a valid answer.** Unreadable season text, unverified regulation sections and anadromous-only
  district rules are reported as "unclear" or as caveats, never guessed as open.
- **California only.** The basemap shows everywhere, but data is only requested for map cells that touch the
  state (border cells are queried with the cell clipped to the state polygon) and drawn clipped to the state line.
- **No servers, no keys.** Public-domain basemaps (USGS, NOAA), public agency services and static files mean
  free hosting and no secrets. Production makes no geocoder or Overpass requests.

### Request flows

**Fishing check** (`lib/analyze.ts`). One click fires about a dozen parallel queries (the regulation lookup alone is four map layers plus the text table). Each one fails soft (`null`)
and is listed under "Could not load":

| Query | Service | Used for |
|---|---|---|
| land ownership | CAL FIRE | land type and owner (most restrictive wins) |
| unit names | Esri federal lands / parks | "Inyo National Forest" instead of an agency name |
| water body | Esri USA Detailed Water Bodies | lake vs. stream; lake surfaces are public water |
| MPA | CDFW | no-take or limited-take marine reserves |
| regulations | CDFW regulation viewer layers + text table | special regulations at the point (`regdata.ts`) |
| county | US Census counties | display, offshore detection |
| elevation/depth | NOAA NCEI DEM | ocean depth, lake surface elevation |
| RCA lines, lake contours | CDFW | groundfish depth lines, Salton Sea depth |

`interpret` then decides the water type, the verdict, and the season and trout limit for today
(`rules.troutRule`). Changing the water type re-interprets without refetching.

**Backpacking routes** (`lib/trails.ts`, in a Web Worker). For the current view (≤60 km):
1. Fetch Forest Service trails (official mileage), OSM trails and waters (static tiles), CAL FIRE land, and CDFW
   regulation polygons and text: about five requests, not one per water.
2. **Prepare once** (~0.5–1 s, off the main thread): find which waters come within 800 m of which trails using
   `geo.nearPairs` (a uniform-grid index over Douglas–Peucker-simplified lines), then assess each water access point
   once: owner, special regulations, district rules.
3. **Filter per change** (~0–20 ms): length, land types, distance, trip dates (seasons and trout limits evaluated per
   day), special regulations, trout possession. The worker's result is plain data (structured-clone safe), so
   seasons are parsed lazily on the main thread (`rules.seasonOf`).

**Shore spots** (`lib/shore.ts`, in the worker). For the current view (≤40 km): Coastal Commission access points
and public-land OSM trails within reach of rocky shoreline (CDFW shoreline types). They're ranked by weighted metres
of rock within 500 m. Each spot gets one NOAA elevation transect inland from the waterline (all spots in one
multipoint request) for bluff height and steepness. Difficulty (easy/moderate/hard) is shown, never used to
exclude a spot by default. No-take MPAs are hidden unless asked for.

**Offline** (`lib/offline.ts`, `tiles.ts`, `areaStore.ts`, `public/sw.js`). "Save this map view" stores a prepared
route search plus the raw inputs an offline fishing check needs (land polygons with attributes, all regulation
polygons and text rows, lake outlines) in IndexedDB, and caches USGS topo tiles for zoom 8–14 (≤4,000) in Cache
Storage. Offline, a check rebuilds the same `Raw` the services would have returned and runs the same `interpret`.
The service worker serves the app shell network-first and saved tiles cache-first, and never caches live
regulation data (so it can't go silently stale while online).

**Shareable links** (`lib/urlState.ts`). The URL fragment always holds the view, tab, clicked point, layers, land
types, filters (with trip dates) and selected route, updated with `replaceState`. Opening a link re-runs its
check or search. Defaults are omitted; malformed parts are ignored.

### Data sources and why

| Need | Source | Why this one |
|---|---|---|
| Land ownership | CAL FIRE California Land Ownership | California-only, every owner type incl. LADWP, districts, nonprofits, tribal |
| Regulations | CDFW regulation viewer service (map layers + text table keyed by Title 14 section) | the official data behind CDFW's own viewer |
| Seasons & limits | parsed from that text (`season.ts`, `rules.ts`) | no structured season data exists |
| Trails | USFS National Forest System Trails + OpenStreetMap | USFS for official mileage; OSM for parks and everything else |
| Lakes & streams | OpenStreetMap (static extract) | named, statewide, geometry suited to proximity |
| Coast | CDFW shoreline types (NOAA ESI codes), Coastal Commission access points, CDFW groundfish areas | rock type, real access details, management areas |
| Elevation & depth | NOAA NCEI DEM mosaic | ocean depth and coastal bluff heights at metre resolution |
| Basemaps | USGS National Map (topo, imagery), NOAA relief | public domain: fine for public use and offline caching |
| Place search | Census places + OSM names → `public/places.json` | no third-party geocoder; works offline |

### Performance safeguards

Each of these came from a real problem:

| Problem | Fix |
|---|---|
| Re-matching every trail against every water on each filter change took 18–23 s and froze the page | prepare once per search with a grid index (2 s → 130 ms for proximity), filter in ~0–20 ms; `perf.live.test.ts` guards it |
| CAL FIRE parcels put 5,000–29,000 shapes in view as SVG elements, locking the page | canvas rendering (`preferCanvas`), display-only layers non-interactive, land from zoom 8, coarse (large holders only) at zoom 8–9 |
| Border map cells downloaded neighbouring states' features (35–59% of vertices) | skip cells outside California; query border cells with the cell ∩ state polygon (`polygon-clipping`) |
| Overpass took 30–90 s and rate-limited | statewide static extract (`scripts/extract-osm.mjs`), loaded per view and trimmed to it |
| Search work blocked the UI | route and shore searches run in a Web Worker |

### Correctness safeguards

- **Section-number check** (`regdata.resolveHit`): ~6% of CDFW map features point at the wrong regulation entry
  (e.g. the "Twin Lakes (Mammoth)" polygon is numbered §7.50(b)(157), which is Twelvemile Creek). Each hit's water
  name is matched against the text; mismatches are re-pointed to the nearby entry that names the water, or flagged
  unverified (and never used for trout limits).
- **Rule order** (`rules.troutRule`): the water's special regulation, then district rules for all streams
  (§7.00), then the statewide default (§5.85). With no possession limit stated, possession is one daily bag (§1.17).
- **Freshness** (`regdata.regsFreshness`): CDFW's dataset text cites the booklet it was copied from; the UI shows
  that, the dataset's update date, and a warning when it predates the booklet in effect.
- **Offline parity**: offline answers use the same `interpret` and were checked identical to online answers on
  real data.

### Testing

- `npm test`: unit tests for the season parser, rules engine, land classification, geometry (incl. a randomized
  check that the grid index equals brute force), URL state, places search, offline answers, shore ratings.
- `npm run test:live`: known places against the real services (e.g. Crowley Lake's two season periods, Point Lobos
  MPA, Mammoth route search, Pacifica shore spots) and a performance guard. Node's `fetch` doesn't use the HTTP
  proxy in some environments, so tests swap the transport for curl via `setHttp`.
- Not automated: in-browser rendering (Leaflet, service worker, IndexedDB). Check those manually.

---

## Code layout

```
src/
  config.ts          every external service URL, overlay list, basemaps
  regs.ts            curated summaries: agencies, MPA types, general water rules, links
  data/california.ts state outline and the app's area (land + coastal waters)
  lib/               plain TypeScript (no React/Leaflet)
    analyze.ts         fishing check: fetchPoint (I/O) → interpret (pure)
    regdata.ts         CDFW regulation lookup, parsing, section-number check, freshness
    season.ts          season text → date ranges ("Last Sat. in Apr. through Nov. 15")
    rules.ts           open/closed and trout limit for a water on given dates
    trails.ts          route search: fetch, prepare (grid proximity), filter
    shore.ts           shore spots: rocky habitat, access, bluff height, difficulty
    land.ts            CAL FIRE ownership → land type; SQL per land type
    geo.ts             distances, point-in-polygon, grid-indexed proximity
    california.ts      "in/touches California", clipped query geometry
    offline.ts, tiles.ts, areaStore.ts   saved areas, tile cache, IndexedDB
    places.ts, urlState.ts, depth.ts, arcgis.ts, http.ts
    routes.worker.ts, routeSearch.ts     Web Worker and its client
  components/        React UI: MapView, Sidebar, ResultPanel, RoutesPanel, ShorePanel, OfflineAreas, About, …
scripts/
  extract-osm.mjs    OSM extract → public/osm/ (resumable, polite to Overpass)
  build-places.mjs   place-search index → public/places.json
public/
  sw.js, manifest.webmanifest, icon.svg, _headers (Cloudflare caching), osm/, places.json
```

**Pinned internals:** esri-leaflet is pinned to 3.0.19 because `EsriLayers.tsx` overrides its private
`_isValidCell` and `_buildQuery` (skip or clip cells outside California), and `CaliforniaClip.tsx` uses Leaflet's
`_latLngToNewLayerPoint`. Re-check both before upgrading.

**Rules quoted by hand:** the shore-angler rockfish rules card (`ShorePanel.tsx`) quotes CDFW's Groundfish Summary
with its date; update it when CDFW changes the rules.

## Deploying (Cloudflare Pages, free)

1. `public/osm/` (~32 MB) and `public/places.json` are committed. To refresh them: `npm run extract:osm -- --force`,
   then `npm run build:places`, commit both and push.
2. Push to `main`.
3. In Cloudflare: Workers & Pages > Create > Pages > Connect to Git > this repo.
   Build command `npm run build`, output directory `dist`, environment variable `NODE_VERSION=22`.
4. Optional: add a custom domain (Cloudflare Registrar sells at cost, ~$10–15/year).

`public/_headers` sets caching (the service worker is never cached; hashed assets are immutable). Set
`CONFIG.feedbackUrl` (src/config.ts) to show a "Report a problem" link in About.

Data credits and licenses are in the app's About panel. OpenStreetMap data is © OpenStreetMap contributors under the
ODbL (see `public/osm/LICENSE.md`).
