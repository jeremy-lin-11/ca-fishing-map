declare module 'arcgis-pbf-parser' {
  export default function decode(buffer: Uint8Array): { featureCollection: GeoJSON.FeatureCollection; exceededTransferLimit: boolean };
}
