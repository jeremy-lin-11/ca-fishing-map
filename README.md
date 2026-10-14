# California Public Land & Fishing Map

Click anywhere in California to see whether it's public land, whether fishing is legal there,
CDFW special regulations for that water, and depth. The **Backpacking routes** tab finds trails in the
current map view that pass near fishable water, filtered by trail length, public land, special
regulations and whether trout may be kept.

The basemap shows everywhere; data layers and searches only load where they touch California.

```
npm install
npm run extract:osm  # one-time (1-3 h, resumable): OpenStreetMap trails/lakes/streams -> public/osm/
npm run dev        # http://localhost:5173
npm test           # offline unit tests
npm run test:live  # checks known points against the live data services (needs network)
npm run build      # type-check + production build to dist/
```

## Layout

- `src/config.ts`: every external data source (ArcGIS layers, NOAA, geocoder) and the overlay list
- `src/regs.ts`: curated rule summaries (agencies, MPA types, general water rules)
- `src/lib/`: data lookups and decision logic, plain TypeScript with no React or Leaflet
  - `analyze.ts`: `fetchPoint()` gets the raw service data; `interpret()` turns it into the result shown
  - `regdata.ts`: CDFW freshwater regulation lookup and parsing, including a check that corrects
    map features whose section number doesn't match the regulation text (CDFW data has ~6% of these)
  - `trails.ts`: route search (USFS trails + OpenStreetMap trails/waters), water matching, trout limits
  - `california.ts` / `src/data/california.ts`: the state outline and the "touches California" tests
  - `land.ts`, `depth.ts`, `arcgis.ts`, `http.ts`
- `src/components/`: `MapView` (react-leaflet + esri-leaflet layers), `Sidebar`, `ResultPanel`, `RoutesPanel`, `RouteLayers`

esri-leaflet is pinned to 3.0.19: `EsriLayers.tsx` overrides its internal `_isValidCell` to skip grid
cells outside California. Re-check that override before upgrading.

## Data notes

- **Land**: CAL FIRE California Land Ownership (federal, state, CDFW, city/county incl. LADWP, special districts,
  nonprofits, tribal). Esri federal/parks layers only supply unit names. Clicks on lake surfaces use Esri USA
  Detailed Water Bodies (lakebeds aren't ownership parcels).
- **Seasons and trout limits** (`lib/season.ts`, `lib/rules.ts`): season text is parsed into date ranges (89% of
  CDFW season cells; the rest are cross-references, not seasons) and evaluated per day. Order: the water's
  special regulation, then §7.00 district rules for all streams, then the statewide default (§5.85). §7.00 rules
  for anadromous waters only appear as caveats, since which streams are anadromous isn't mapped.
- **Regulation freshness**: the panels show the dataset's last-update date and the booklet its text cites, and
  warn when that's older than the booklet in effect (CDFW booklets run Mar 1 - end of Feb).
- **OpenStreetMap**: route search reads static tiles from `npm run extract:osm` (`public/osm/`). For areas
  without tiles it falls back to the live Overpass API, which is slow and rate-limited. Re-run with `--force` to
  refresh the extract.
- Route search runs in a Web Worker (`lib/routes.worker.ts`); filters are applied on the main thread instantly.

Informational only. Always confirm against the current CDFW regulation booklets.
