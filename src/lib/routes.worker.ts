// Runs route searches (downloads + proximity/rules preparation) off the main thread.
// 'save' also returns the data an offline area needs (land, all regulation polygons and text, lakes).
import { fetchRouteData, prepareRouteData } from './trails';
import { toOffline } from './offline';
import { findShoreSpots } from './shore';
import type { BBox } from './geo';

self.onmessage = async (e: MessageEvent<{ id: number; type?: 'search' | 'save' | 'shore'; bbox: BBox }>) => {
  const { id, type = 'search', bbox } = e.data;
  try {
    if (type === 'shore') { self.postMessage({ id, shore: await findShoreSpots(bbox) }); return; }
    const data = await fetchRouteData(bbox, { allDistricts: type === 'save' });
    const prepared = prepareRouteData(data);
    self.postMessage(type === 'save' ? { id, prepared, offline: toOffline(data) } : { id, prepared });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message || 'Route search failed' });
  }
};
