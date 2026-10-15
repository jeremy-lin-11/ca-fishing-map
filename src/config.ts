// All external data sources live here. If a service moves, fix the URL here only.
// Polygon layers are ArcGIS REST layer URLs (FeatureServer/N or MapServer/N).
export const CONFIG = {
  center: [37.3, -119.5] as [number, number],
  zoom: 6,
  bounds: [[32.4, -124.6], [42.1, -114.0]] as [[number, number], [number, number]],
  layers: {
    // CAL FIRE California land ownership (federal, state, local, special district, nonprofit, tribal; CA only).
    // Fields: Own_Level, Own_Group, Own_Agency. No unit names, so federal/parks below supply those.
    ownership: {
      label: 'Public land',
      url: 'https://jUJYIo9tSA7EHvfZ.svcs1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/Public_Land_Ownership_view/FeatureServer/0',
      // At low zoom, only the large holders (dense city/district parcels would hit the 2,000-feature limit).
      coarseWhere: "Own_Level IN ('Federal','State','Tribal') OR Own_Agency LIKE '%Water and Power%'"
    },
    // Esri USA Detailed Water Bodies: a click on a lake surface (lakebeds aren't ownership parcels).
    waterBodies: {
      label: 'Water bodies',
      url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Detailed_Water_Bodies/FeatureServer/0'
    },
    // Unit names only (e.g. "Inyo National Forest").
    federal: {
      label: 'Federal lands',
      url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Federal_Lands/FeatureServer/0'
    },
    parks: {
      label: 'State / local parks',
      url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Parks/FeatureServer/0',
      // National parks/forests are already covered (with agency) by the federal layer.
      where: "FEATTYPE <> 'National park or forest'"
    },
    // CDFW Marine Protected Areas (fields: name, fullname, type, regulation_text, regulations_url).
    mpa: {
      label: 'Marine Protected Areas',
      url: 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/ArcGIS/rest/services/California_Marine_Protected_Areas/FeatureServer/1'
    }
  },
  // County for the fishing check (Esri Living Atlas, US Census counties). Whether a point is in California is
  // answered locally from the state outline (lib/california.ts).
  counties: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Counties_Generalized_Boundaries/FeatureServer/0',
  // Place search index (towns + OSM-named lakes, streams, trails), built by `npm run build:places`; works offline.
  places: '/places.json',
  // Optional "Report a problem" link shown in About (e.g. a public issues page or form). Empty = hidden.
  feedbackUrl: '',

  // CDFW freshwater regulations (official regulation viewer data). Layer ids inside this service.
  regs: {
    url: 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/ArcGIS/rest/services/regLinkFishing/FeatureServer',
    layers: { districts: 0, lakes: 1, streams: 2, tributary: 3, table: 8 }
  },

  trails: {
    // USFS National Forest System trails (segments; `trail_cn` groups segments into one trail).
    usfs: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0',
    // OpenStreetMap: trails outside national forests (national/state parks) and named lakes/streams.
    overpass: 'https://overpass-api.de/api/interpreter',
    // Static tiles from `npm run extract:osm` (public/osm/). Used first; live Overpass is the fallback.
    staticOsm: '/osm',
    // Query Overpass live where static tiles are missing: development only. A public deployment shouldn't send
    // visitors' browsers to the shared Overpass servers.
    liveFallback: import.meta.env.DEV,
    maxSearchKm: 60 // per side; keeps Overpass and geometry queries fast
  },

  // Shore fishing (rockfish) spots.
  shore: {
    // California Coastal Commission public access points (stairs, paths, parking, closures; updated regularly).
    access: 'https://services9.arcgis.com/wwVnNW92ZHUIr0V0/arcgis/rest/services/AccessPoints/FeatureServer/0',
    // CDFW BIOS ds3115 shoreline types (NOAA ESI codes: rocky cliffs, wave-cut platforms, riprap…).
    shoreline: 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds3115_fnu/FeatureServer/0',
    // CDFW BIOS ds3143 recreational groundfish management areas.
    groundfish: 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds3143_fpu/FeatureServer/0',
    groundfishSummary: 'https://wildlife.ca.gov/Fishing/Ocean/Regulations/Groundfish-Summary',
    maxSearchKm: 40
  },

  depth: {
    // NOAA NCEI elevation mosaic. Negative = depth below sea level. Lakes are flat water surface (no lake bottoms).
    dem: 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer',
    // GEBCO 2019 ocean contours (meters, labeled), drawn as a transparent overlay.
    oceanContours: 'https://gis.ngdc.noaa.gov/arcgis/rest/services/wgs84/gebco_2019_contours/MapServer',
    // CDFW Rockfish Conservation Area depth lines: the regulatory groundfish depth limits.
    rca: 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/ArcGIS/rest/services/FishingRegulationsV1/FeatureServer/5',
    // Freshwater: there is no statewide lake bathymetry, only individual surveys.
    // Only sources in web-mercator (or re-projectable) form can go here. Clear Lake and Mono Lake
    // surveys exist on ArcGIS Online but are UTM-only tile caches, which Leaflet can't overlay.
    lakeTiles: [
      { name: 'Lake Tahoe', source: 'Keep Tahoe Blue', legend: 'shaded 0–500 m',
        url: 'https://tiles.arcgis.com/tiles/D185ZRnjyHiHoq7r/arcgis/rest/services/Bathymetry/MapServer',
        bounds: [[38.93, -120.17], [39.32, -119.93]] as [[number, number], [number, number]], maxZoom: 16 }
    ],
    lakeContours: [
      { name: 'Salton Sea', source: 'CDFW BIOS ds386 (USBR survey)', legend: '5 ft contours, bottom elevation in ft',
        url: 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds386_fnu/FeatureServer/0',
        where: "SHORE <> 'Y'", field: 'CONTOUR' }
    ]
  }
};

export const BASEMAPS = {
  // USGS National Map topo (public domain): trails and contours, and the basemap saved for offline use.
  usgsTopo: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
  // All public domain (US government), so they're fine for a public app without API keys.
  usgsImagery: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',
  // NOAA NCEI global relief (seafloor + land hillshade), an image service drawn per view.
  noaaRelief: 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic_hillshade/ImageServer'
};

export type OverlayId = 'land' | 'regwaters' | 'mpa' | 'depth' | 'rca';
export const OVERLAYS: { id: OverlayId; label: string; defaultOn: boolean }[] = [
  { id: 'land', label: 'Public land (federal, state, local, utility)', defaultOn: true },
  { id: 'regwaters', label: 'Waters with special regulations', defaultOn: true },
  { id: 'mpa', label: 'Marine Protected Areas', defaultOn: true },
  { id: 'depth', label: 'Depth charts (ocean contours; Tahoe & Salton Sea)', defaultOn: true },
  { id: 'rca', label: 'Rockfish depth limits (RCA lines)', defaultOn: false }
];
