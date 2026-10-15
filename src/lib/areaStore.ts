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
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const listAreas = () => tx<SavedArea[]>('readonly', s => s.getAll() as IDBRequest<SavedArea[]>)
  .then(a => a.sort((x, y) => y.savedAt.localeCompare(x.savedAt)));
export const putArea = (a: SavedArea) => tx('readwrite', s => s.put(a));
export const deleteArea = (id: string) => tx('readwrite', s => s.delete(id));
