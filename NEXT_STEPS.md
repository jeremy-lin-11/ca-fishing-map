# Next steps (as of 2026-10-14)

## In progress
- **OSM static extract** (`npm run extract:osm`): was at tile ~16/216 when this was written; Overpass is slow
  (504/429). It's resumable — if it stopped, rerun the command and it skips finished tiles. Check
  `public/osm/index.json`; searches in areas without tiles fall back to live Overpass.

## To verify once the extract covers the area
- `npx vitest run routes perf` (Mammoth route search + performance guard) — both should report
  "static extract" in notes and make no Overpass calls.

## Not yet checked in a browser (user runs `npm run dev`)
- Land-type pickers (map Layers > Public land > Land types shown; Routes > Land types for water access)
- CAL FIRE ownership layer colors/tooltips at zoom 7–9 (large holders) and 10+ (all owners)
- Trip date inputs and per-water "Open/Closed on your dates" badges; "Season & trout today" card
- Regulation freshness warning (should say text is 2021–2022, current booklet 2026–2027)
- California clip at the state line during zoom animation; route search running in the Web Worker

## Ideas not started (from the improvements list)
- Offline/PWA mode for the backcountry; multi-day trip stitching from trailheads; shareable URLs
- ESLint, React error boundary, Playwright browser tests (need sandbox approval for a local server)
- Delete the superseded vanilla app in ~/ca-fishing-map

## Done
- Git repo on the user's personal GitHub: https://github.com/jeremy-lin-11/ca-fishing-map (private); see
  CLAUDE.md > Repository for push setup and the lockfile-registry rule.
