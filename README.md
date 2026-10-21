# Can I Fish Here? California

**Tap a spot on the map and find out whether you can legally fish there.**

**Live:** https://jeremy-lin-11.github.io/ca-fishing-map/

## Why this exists

If you fish the ocean in California, there's an app for that. [FishLegal](https://fishlegal.info/) (iOS and
Android) has all of California's saltwater fishing regulations and maps of every Marine Protected Area. It uses
GPS to show where you are relative to those areas, and works offline.

Freshwater has nothing like it. The rules for lakes, rivers and streams live in a printed pamphlet: the
*Freshwater Sport Fishing Regulations* booklet. Answering "can I fish this creek, and what can I keep?" means doing
several things yourself:

- Working out which of California's fishing districts you're in.
- Searching dozens of pages of special rules for the name of your water. Many waters have their own seasons,
  bag limits or closures.
- Checking whether today falls inside the season.
- Separately working out whether the land you're standing on is public at all.

CDFW does publish map data that links waters to booklet sections. But it isn't combined with land ownership,
it doesn't tell you what applies on a given day, and its text was copied from an older printed booklet.

This tool fills that gap for **freshwater**. It also checks land access, so it says both *whether the rules
allow fishing* and *whether you're allowed to be there*.

## What it tells you

Tap anywhere in California and you get one clear verdict (yes / check first / no), with the reasons:

- **Who owns the land.** For example Bureau of Land Management (BLM), National Forest, National Park, state land,
  city or water district, tribal land, military, or likely private. Most BLM and National Forest land is open to
  the public. Military land and most private land are not.
- **Which fishing rules apply to that water.** The water's special regulations if it has any, the district rules
  for its area, and the statewide default otherwise.
- **Whether it's open today, and the trout limit.** How many trout you can keep per day, and how many you can have
  in total.
- **Warnings** where the rules can't be applied automatically. For example, rules for streams where salmon and
  steelhead run, or a regulation the tool couldn't match to the water with confidence.
- **Estimated fishing pressure** (low / moderate / high) where fishing is allowed. It's based on road access, how many
  people live nearby, CDFW trout stocking, nearby campgrounds and access points, and wilderness, and lists the
  reasons. It's an estimate, not a count of anglers.
- **Ocean basics too:** Marine Protected Areas (no-take or limited-take zones), rockfish depth limits, and depth.

The map can also show public land by owner, waters with special regulations, protected marine areas and depth
charts. You can search for a town or lake, or jump to your current location.

**Works without signal.** Before a trip, save a map area. Inside it, fishing checks still work with no
connection. That's useful in the backcountry, where there usually isn't any.

**Shareable.** "Copy link" gives you a link to exactly what you're looking at (the map view, the spot you checked and
your layers) to send to someone.

**Report a problem.** If an answer looks wrong, tap **Report**. You can include the spot so it can be checked.

**Install it** like an app from your phone's browser ("Add to Home Screen").

### Important

This is **not an official CDFW tool**. It combines public government data, which can be out of date or wrong.
In particular, the regulation text in CDFW's data comes from the 2021–2022 booklet, and the app warns you about
this. Always confirm against the current CDFW
[freshwater](https://wildlife.ca.gov/Fishing/Inland/Regulations) and
[ocean](https://wildlife.ca.gov/Fishing/Ocean/Regulations) regulations before you fish.

---

## System design

### Commands

```
npm install
npm run dev           # http://localhost:5173
npm test              # offline unit tests
npm run test:live     # known points against the live data services (needs network)
npm run build         # type-check + production build to dist/
npm run extract:osm   # one-time (1-3 h, resumable): OpenStreetMap lakes/streams/trails -> public/osm/
npm run build:places  # place-search index -> public/places.json (rerun after the extract)
npm run build:lakes   # OSM lake outlines -> public/lakes/ (rerun after the extract)
```

### Architecture

A static single-page app (React + TypeScript + Vite + Leaflet) with no backend. Everything it knows comes from
public agency data services queried directly from the browser, plus a place-search index generated ahead of time.

```
                                   Browser
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │  React UI (src/components)                                                        │
 │    Sidebar: place search, verdict, offline areas        MapView (Leaflet)         │
 │        │                                                    │                     │
 │        ▼                                                    ▼                     │
 │  lib/analyze.ts  fetchPoint → interpret            esri-leaflet overlays          │
 │  lib/rules.ts, season.ts, regdata.ts, land.ts      (cells clipped to California,  │
 │  lib/offline.ts  saved area → same interpret        PBF queries, response cache)  │
 │        │            lib/ = plain TypeScript: no React, no Leaflet                 │
 │        ▼                                                                          │
 │  lib/http.ts  (one swappable transport; tests use curl)                           │
 │                                                                                   │
 │  Service worker (public/sw.js): app shell + saved basemap tiles                   │
 │  IndexedDB: saved offline areas     Cache Storage: USGS tiles     URL: app state  │
 └───────────────┬───────────────────────────────────────────────┬───────────────────┘
                 │ live queries (ArcGIS REST, image services)    │ static files (same origin)
                 ▼                                               ▼
  CDFW regulations, MPAs, RCA lines · CAL FIRE land ownership    public/places.json
  Esri Living Atlas (unit names, water bodies, counties)         (towns + OSM-named waters)
  NOAA elevation/depth · USGS basemaps
```

### Design principles

- **Logic is plain TypeScript.** Everything in `src/lib/` runs in Node without a browser, so lookups and decisions
  are unit-tested and checked against live services (`npm run test:live`). React components only render.
- **Fetch, then interpret.** `fetchPoint` collects raw service responses. `interpret` is a pure function that turns
  them into the verdict. Changing the water type re-runs only `interpret`, instantly. Offline answers rebuild the
  same raw input from saved data and run the same `interpret`, so online and offline answers can't drift.
- **Unknown is a valid answer.** Unreadable season text, unverified regulation sections and anadromous-only
  district rules are reported as "unclear" or as caveats, never guessed as open.
- **California only.** The basemap shows everywhere, but data is only requested for map cells that touch the state
  and drawn clipped to the state line.
- **No servers, no keys.** Public-domain basemaps (USGS, NOAA), public agency services and static files mean free
  hosting and no secrets.

### The fishing check

`lib/analyze.ts`. One tap fires about a dozen parallel queries; the regulation lookup alone is four map layers plus
the text table. Each query fails soft (`null`) and is listed under "Could not load":

| Query | Service | Used for |
|---|---|---|
| land ownership | CAL FIRE | land type and owner (most restrictive wins) |
| unit names | Esri federal lands / parks | "Inyo National Forest" instead of an agency name |
| water body | Esri USA Detailed Water Bodies | lake vs. stream; lake surfaces are public water |
| MPA | CDFW | no-take or limited-take marine reserves |
| regulations | CDFW regulation viewer layers + text table | special regulations at the point (`regdata.ts`) |
| SF Bay District, coastal bays | CDFW, PMEP (CDFW BIOS) | bay water: ocean rules, not the freshwater booklet |
| county | US Census counties | display, offshore detection |
| elevation/depth | NOAA NCEI DEM | ocean depth, lake surface elevation |
| RCA lines, lake contours | CDFW | groundfish depth lines, Salton Sea depth |
| pressure signals | Caltrans public roads, CDFW stocked waters + planting log, wilderness, Coastal Commission access, USFS recreation sites; town populations from `places.json` | estimated fishing pressure (`pressure.ts`) |

**Estimated pressure** (`lib/pressure.ts`): `fetchPressure` gathers the signals and `estimatePressure` scores them.
Public roads (Caltrans) are counted within ¼, 1 and 3 miles. The total maps to low / moderate / high, and every signal that moved
the score is listed. The card is hidden where fishing isn't allowed or the water is closed today, and offline.

`interpret` then decides the water type and the verdict. It also works out the season and trout limit for today
(`rules.troutRule`) from the season text, which `season.ts` parses into date ranges ("Last Sat. in Apr. through
Nov. 15").

### Map overlays

`components/EsriLayers.tsx` wraps esri-leaflet feature layers, which load features per grid cell:

- **Skip or clip cells outside California.** Cells that miss the state aren't requested. Border cells are queried
  with the cell clipped to the state polygon (`polygon-clipping`), because a plain rectangle pulled 35–59% of its
  vertices from neighbouring states.
- **Share cells across zoom pairs.** Zoom levels share cells in pairs (8–9, 10–11, …): at the odd level a cell
  covers the same ground with the same simplification, so the query is identical. Stock esri-leaflet re-downloads
  every cell at every zoom level.
- **Protobuf with an in-memory cache.** `lib/pbfQuery.ts` requests `f=pbf` with explicit `quantizationParameters`
  (the server's default rounding is off by up to 35 m) and keeps an LRU cache of decoded responses. That's about 3×
  fewer bytes than gzipped GeoJSON (1.0 → 0.31 MB for one Sierra view), and zooming within a pair or panning back is
  instant.
- **Canvas rendering.** Land ownership can put 5,000–29,000 parcels in view, so the map uses canvas
  (`preferCanvas`), display-only layers aren't hit-tested, and land starts at zoom 8 (large holders only at 8–9).

### Offline areas

`lib/offline.ts`, `tiles.ts`, `areaStore.ts`, `public/sw.js`. "Save this map view" (up to 60 km across) stores the
raw inputs an offline check needs in IndexedDB:
- land polygons with their ownership attributes;
- every regulation polygon and its text rows;
- lake and reservoir polygons from the same Esri water-bodies layer the online check uses.

It also caches USGS topo tiles for zoom 8–14 (at most 4,000) in Cache Storage. The service worker serves the app
shell network-first and saved tiles cache-first. It never caches live regulation data, so that can't go silently
stale while online. Areas saved by earlier versions, which stored OpenStreetMap lakes, still load.

### Shareable links

`lib/urlState.ts`. **Copy link** encodes the view, the tapped point, water type, layers and land types into the URL
fragment, and only then puts it in the address bar (`replaceState`). Opening a link re-runs its check. Defaults are
omitted, and malformed or retired parts (the old route-search `tab`, `f`, `route`) are ignored.

### Usage analytics

`src/posthog.ts` sends anonymous usage events to PostHog in production builds only (never `npm run dev`).
Examples: `fishing_check_answered` with water type, verdict and pressure level, `offline_area_saved`,
`shared_link_copied`, `shared_link_opened` (which parts the link had, not their values), `place_selected` with
the place kind, and `locate_used`. Every event carries `entry` (`shared_link` or `direct`), and a shared-link visit's page
URL is shown as `…/ca-fishing-map/#shared-link` (the marker replaces the coordinates). Events carry names and categories
only:
- no coordinates, place names or search text;
- no autocapture and no session replay;
- URL fragments (`#map=…&pt=…`) are cut in `before_send`.

**Problem reports** (`lib/report.ts`, `components/ReportProblem.tsx`) go to PostHog as `bug_report` events. A report
carries the reporter's notes and optional email, the answer they saw, app version and browser. The tapped point,
map view and a reopening link are included only if they keep "Include this map location" checked; the form shows
exactly what's sent. Reports POST straight to the capture API, so a blocked request is detected. The form then offers a pre-filled
GitHub issue (`CONFIG.issuesUrl`), warning that issues are public and leaving out the email, or the report to copy. Read them in PostHog under Activity, filtered by event `bug_report`.

PostHog loads in its own chunk after the page is up, so it doesn't delay the map. Ad blockers simply turn it off.
The public project key is in `.env.production`.

### Data sources and why

| Need | Source | Why this one |
|---|---|---|
| Land ownership | CAL FIRE California Land Ownership | California-only, every owner type incl. LADWP, districts, nonprofits, tribal |
| Regulations | CDFW regulation viewer service (map layers + text table keyed by Title 14 section) | the official data behind CDFW's own viewer |
| Seasons & limits | parsed from that text (`season.ts`, `rules.ts`) | no structured season data exists |
| Lakes | Esri USA Detailed Water Bodies (USGS NHD), then OpenStreetMap lake outlines (`public/lakes/`) | lake vs. stream at a point; NHD types tell salt evaporators and industrial ponds from lakes; OSM fills in reservoirs NHD maps only as unnamed "Inundation Area" (e.g. Stevens Creek Reservoir) and names unnamed lakes |
| Bays | CDFW San Francisco Bay District (§27.00) polygon; PMEP coastal embayments (CDFW BIOS ds2792) | CDFW's inland district polygons also cover bays, so bay outlines decide where ocean rules apply |
| Elevation & depth | NOAA NCEI DEM mosaic | ocean depth and lake surface elevation |
| Basemaps | USGS National Map (topo, imagery), NOAA relief | public domain: fine for public use and offline caching |
| Place search | Census places + OpenStreetMap names → `public/places.json` | no third-party geocoder; works offline |

### Correctness safeguards

- **Section-number check** (`regdata.resolveHit`). About 6% of CDFW map features point at the wrong regulation
  entry. For example, the "Twin Lakes (Mammoth)" polygon is numbered §7.50(b)(157), which is Twelvemile Creek. Each
  hit's water name is matched against the text. Mismatches are re-pointed to the nearby entry that names the water,
  or flagged unverified and never used for trout limits.
- **Rule order** (`rules.troutRule`). The water's special regulation comes first, then district rules for all
  streams (§7.00), then the statewide default (§5.85: 5 daily, 10 in possession). With no possession limit stated,
  possession is one daily bag (§1.17).
- **Bay vs. inland water** (`analyze.interpret`). Inland district polygons extend over the bays, so they can't tell
  bay from inland water. Inside the San Francisco Bay District, or one of 34 other coastal bays and harbors, ocean
  rules apply. Suisun Bay and the Delta stay inland, and so do river-mouth lagoons (Title 14 §1.53). A mapped lake in
  the tidal extent stays a lake. Diked salt ponds within 1.5 km of the bay count as bay water, and are flagged as
  usually closed.
- **District caveats.** §7.00 district polygons cover whole districts, so "anadromous waters" rules can't be
  applied per water. They are shown as caveats.
- **Freshness** (`regdata.regsFreshness`). CDFW's dataset text cites the booklet it was copied from. The UI shows
  that, the dataset's update date, and a warning when it predates the booklet in effect.

### Testing

- `npm test`: unit tests for the season parser, rules engine, regulation parsing and section check, land
  classification, geometry, California clipping, URL state, place search and offline answers.
- `npm run test:live`: known places against the real services (e.g. Crowley Lake's two season periods, the Point
  Lobos MPA). It also compares PBF layer queries against GeoJSON. Node's `fetch` ignores the HTTP proxy in some
  environments, so tests swap the transport for curl via `setHttp`.
- Not automated: in-browser rendering (Leaflet, service worker, IndexedDB, geolocation). Check those manually.

### Code layout

```
src/
  config.ts          every external service URL, overlay list, basemaps
  regs.ts            curated summaries: agencies, MPA types, general water rules, links
  data/california.ts state outline and the app's area (land + coastal waters)
  lib/               plain TypeScript (no React/Leaflet)
    analyze.ts         fishing check: fetchPoint (I/O) → interpret (pure)
    regdata.ts         CDFW regulation lookup, parsing, section-number check, freshness
    season.ts          season text → date ranges
    rules.ts           open/closed and trout limit for a water on given dates
    land.ts            CAL FIRE ownership → land type; SQL per land type
    offline.ts, tiles.ts, areaStore.ts   saved areas, tile cache, IndexedDB
    pbfQuery.ts        protobuf feature queries + response cache (map overlays)
    geo.ts, california.ts, places.ts, urlState.ts, depth.ts, arcgis.ts, http.ts
  components/        React UI: MapView, EsriLayers, Sidebar, ResultPanel, OfflineAreas, LocateControl, About, …
scripts/
  extract-osm.mjs    OSM extract → public/osm/ (resumable, polite to Overpass); feeds the place index
  build-places.mjs   place-search index → public/places.json
  build-lakes.mjs    OSM lake outlines → public/lakes/ (names saying lake/reservoir/pond only; river polygons excluded)
public/
  sw.js, manifest.webmanifest, icon.svg, _headers (Cloudflare only), osm/, places.json, lakes/
.github/workflows/
  pages.yml          test, build and deploy to GitHub Pages on push to main
```

**Pinned internals:** esri-leaflet is pinned to 3.0.19. `EsriLayers.tsx` overrides these private methods:
- `_isValidCell` and `_buildQuery`: skip or clip cells outside California;
- `getCellSize` and `_cellCoordsToNwSe`: share cells across zoom pairs (and `_update`, skipped mid view-reset);
- `Query.run`: replaced with the protobuf query.

`CaliforniaClip.tsx` also uses Leaflet's private `_latLngToNewLayerPoint`. Re-check all of these before upgrading.

**Earlier features:** a backpacking route search (trails near fishable water) and a shore-spot finder (rocky
shoreline for rockfishing) were removed to keep the app focused. They are in git history up to commit `303f96e`.

## Deploying (GitHub Pages)

The site is hosted on GitHub Pages at https://jeremy-lin-11.github.io/ca-fishing-map/. There is no backend, so a
deploy is just the static `dist/` folder.

**How it deploys:**
1. Every push to `main` runs `.github/workflows/pages.yml`.
2. The workflow installs with `npm ci` and runs `npm test`. A failing test stops the deploy.
3. It builds with `BASE_PATH=/ca-fishing-map/` and publishes `dist/`.

To redeploy without a code change, run the workflow from the Actions tab (Run workflow). For progress and logs, use
`gh run list` / `gh run watch`.

**Base path:** Pages serves the site under `/<repo>/`, not the domain root. `vite.config.ts` reads `BASE_PATH`
(default `/`, so `npm run dev` is unaffected), and the place index path in `src/config.ts` is built from
`import.meta.env.BASE_URL`. New same-origin fetches must use `BASE_URL` too, or they'll 404 in production. Check a
production build locally with:

```
BASE_PATH=/ca-fishing-map/ npm run build && npx vite preview --base /ca-fishing-map/
```

**Refreshing data:** `public/osm/` (~32 MB, the source of the place index) and `public/places.json` are committed.
To refresh them, run `npm run extract:osm -- --force`, then `npm run build:places` and `npm run build:lakes`, then
commit all three and push.

**One-time setup** (already done): the repo must be public for free Pages, and Settings > Pages > Source is set to
"GitHub Actions". Renaming the repo changes the URL; the workflow picks up the new name automatically.

**Caching:** GitHub Pages ignores `public/_headers` and serves every file with a ~10-minute cache, including
`sw.js`, so installed apps can take a few minutes to pick up a new release.

**Custom domain (optional):** add it under Settings > Pages > Custom domain. Then change the workflow's
`BASE_PATH` to `/`, since the site moves to the domain root.

**Alternative: Cloudflare Pages.** Connect the repo (Workers & Pages > Create > Pages > Connect to Git). Use build
command `npm run build`, output `dist`, environment variable `NODE_VERSION=22`, and no `BASE_PATH`. Cloudflare
honours `public/_headers` (service worker never cached, hashed assets immutable).

Set `CONFIG.feedbackUrl` (src/config.ts) to show a "Report a problem" link in About, e.g.
`https://github.com/jeremy-lin-11/ca-fishing-map/issues`.

Data credits and licenses are in the app's About panel. OpenStreetMap data is © OpenStreetMap contributors under the
ODbL (see `public/osm/LICENSE.md`).
