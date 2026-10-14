// Route search entry point for the UI: runs in a Web Worker so the page never stalls on the
// ~0.5 s of geometry work (or JSON parsing of large responses). Falls back to the main thread
// where workers aren't available or the worker fails to start.
import type { BBox } from './geo';
import { fetchRouteData, prepareRouteData, type Prepared } from './trails';

type Pending = { resolve: (p: Prepared) => void; reject: (e: Error) => void };
let worker: Worker | null = null, broken = false, seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./routes.worker.ts', import.meta.url), { type: 'module' });
    } catch { broken = true; return null; }
    worker.onmessage = (e: MessageEvent<{ id: number; prepared?: Prepared; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.prepared) p.resolve(e.data.prepared); else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => { // the worker itself died: fail what's in flight, use the main thread from now on
      broken = true; worker = null;
      for (const p of pending.values()) p.reject(new Error('Route search worker failed; try again'));
      pending.clear();
    };
  }
  return worker;
}

export function searchArea(bbox: BBox): Promise<Prepared> {
  const w = getWorker();
  if (!w) return fetchRouteData(bbox).then(prepareRouteData);
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, bbox }); });
}
