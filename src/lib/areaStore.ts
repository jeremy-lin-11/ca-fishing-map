// Saved offline areas in IndexedDB (one object store, keyed by id).
import type { SavedArea } from './offline';

const DB = 'ca-fishing-map', STORE = 'areas';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  // Resolve when the transaction commits, not when the request succeeds: a full disk (quota) aborts the
  // transaction after the request has "succeeded", and the save must then fail, not report success.
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error ?? req.error ?? new Error('Saving to this device failed')); };
  });
}

export const listAreas = () => tx<SavedArea[]>('readonly', s => s.getAll() as IDBRequest<SavedArea[]>)
  .then(a => a.sort((x, y) => y.savedAt.localeCompare(x.savedAt)));
export const putArea = (a: SavedArea) => tx('readwrite', s => s.put(a));
export const deleteArea = (id: string) => tx('readwrite', s => s.delete(id));
