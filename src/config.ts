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
  geocoder: 'https://nominatim.openstreetmap.org',

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
    maxSearchKm: 60 // per side; keeps Overpass and geometry queries fast
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
  topo: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  oceanBase: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
  oceanReference: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}'
};

export type OverlayId = 'land' | 'regwaters' | 'mpa' | 'depth' | 'rca';
export const OVERLAYS: { id: OverlayId; label: string; defaultOn: boolean }[] = [
  { id: 'land', label: 'Public land (federal, state, local, utility)', defaultOn: true },
  { id: 'regwaters', label: 'Waters with special regulations', defaultOn: true },
  { id: 'mpa', label: 'Marine Protected Areas', defaultOn: true },
  { id: 'depth', label: 'Depth charts (ocean contours; Tahoe & Salton Sea)', defaultOn: true },
  { id: 'rca', label: 'Rockfish depth limits (RCA lines)', defaultOn: false }
];
