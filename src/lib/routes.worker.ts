// Runs a route search (downloads + proximity/rules preparation) off the main thread.
import { fetchRouteData, prepareRouteData } from './trails';
import type { BBox } from './geo';

self.onmessage = async (e: MessageEvent<{ id: number; bbox: BBox }>) => {
  const { id, bbox } = e.data;
  try {
    self.postMessage({ id, prepared: prepareRouteData(await fetchRouteData(bbox)) });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message || 'Route search failed' });
  }
};
