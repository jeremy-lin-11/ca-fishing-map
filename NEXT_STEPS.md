# Next steps (as of 2026-10-14)

## Done 2026-10-15
- OSM static extract complete (216/216 land tiles), `npm run build:places` rebuilt (43,395 places), and
  `npm run test:live` passes (16 tests); `routes`/`perf` confirm searches use the static extract, not Overpass.

## Not yet checked in a browser (user runs `npm run dev`)
- Land-type pickers (map Layers > Public land > Land types shown; Routes > Land types for water access)
- CAL FIRE ownership layer colors/tooltips at zoom 7–9 (large holders) and 10+ (all owners)
- Trip date inputs and per-water "Open/Closed on your dates" badges; "Season & trout today" card
- Regulation freshness warning (should say text is 2021–2022, current booklet 2026–2027)
- California clip at the state line during zoom animation; route search running in the Web Worker

## Built 2026-10-15, not yet checked in a browser
- Shareable links: URL updates as you use the app; "Copy link"; opening a link restores view/filters/point and
  re-runs a shared route search (route selected if it's in the new search, else a message)
- Offline: `npm run build && npm run preview`, install the app, save an area (Routes tab > Offline areas), then go
  offline (DevTools > Network > Offline): app loads, saved area loads into Routes, fishing checks answer from saved
  data, USGS Topo basemap tiles show for zoom 8-14. Offline vs online answers were verified identical in Node on
  real San Diego data; the service worker and IndexedDB/Cache Storage paths only run in a browser.

## Built 2026-10-15 (UX pass), not yet checked in a browser
- Phone layout (≤700 px wide): full-screen map, panel as a bottom sheet. Drag the handle to resize (snaps to
  min/half/full), tap it to step through sizes; it opens to half on a map tap or search. Check iOS Safari: drag
  doesn't scroll the page, the sheet grows while place search is focused, attribution sits above the min sheet.
- Fishing check: verdict box with land/trout chips at the top; Depth, general summary and Statewide start collapsed.
- Layers button on the map (top right) replaces the sidebar Layers section and Leaflet's basemap control.
- Routes/Shore: secondary filters under "More filters" with a changed-count and Reset; empty-result hints.

## Before sharing publicly (prepared 2026-10-15)
- Verify the About panel's data-source links in a browser (most hosts were blocked in the sandbox; the CDFW ones work)
- Decide the feedback channel and set `CONFIG.feedbackUrl` (a public issues page or form; don't publish an email
  without the user's OK)
- `public/osm/` and `places.json` are committed (2026-10-16); next, connect
  Cloudflare Pages (README > Deploying). The user does the Cloudflare account step.
- Consider emailing CDFW about the stale (2021–2022 booklet) regulation dataset

## Ideas not started (from the improvements list)
- Multi-day trip stitching from trailheads
- ESLint, React error boundary, Playwright browser tests (need sandbox approval for a local server)
- Delete the superseded vanilla app in ~/ca-fishing-map

## Done
- Git repo on the user's personal GitHub: https://github.com/jeremy-lin-11/ca-fishing-map (private); see
  CLAUDE.md > Repository for push setup and the lockfile-registry rule.
