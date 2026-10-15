// Route search entry point for the UI: runs in a Web Worker so the page never stalls on the
// ~0.5 s of geometry work (or JSON parsing of large responses). Falls back to the main thread
// where workers aren't available or the worker fails to start.
import type { BBox } from './geo';
import { fetchRouteData, prepareRouteData, type Prepared } from './trails';
import { toOffline, type OfflineData } from './offline';

type Reply = { prepared: Prepared; offline?: OfflineData };
type Pending = { resolve: (r: Reply) => void; reject: (e: Error) => void };
let worker: Worker | null = null, broken = false, seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./routes.worker.ts', import.meta.url), { type: 'module' });
    } catch { broken = true; return null; }
    worker.onmessage = (e: MessageEvent<{ id: number; prepared?: Prepared; offline?: OfflineData; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.prepared) p.resolve({ prepared: e.data.prepared, offline: e.data.offline }); else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => { // the worker itself died: fail what's in flight, use the main thread from now on
      broken = true; worker = null;
      for (const p of pending.values()) p.reject(new Error('Route search worker failed; try again'));
      pending.clear();
    };
  }
  return worker;
}

function run(type: 'search' | 'save', bbox: BBox): Promise<Reply> {
  const w = getWorker();
  if (!w) return fetchRouteData(bbox, { allDistricts: type === 'save' })
    .then(d => ({ prepared: prepareRouteData(d), offline: type === 'save' ? toOffline(d) : undefined }));
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, type, bbox }); });
}

export const searchArea = (bbox: BBox): Promise<Prepared> => run('search', bbox).then(r => r.prepared);
// Search plus the extra data an offline area needs.
export const fetchAreaForOffline = (bbox: BBox) => run('save', bbox) as Promise<Required<Reply>>;
