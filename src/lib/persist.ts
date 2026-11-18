// Autosave: each engine's database is kept in IndexedDB so work survives a
// page reload. Works on hosted pages and on pages opened from disk.

const DB_NAME = 'dbify';
const STORE = 'databases';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadSaved(id: string): Promise<Uint8Array | null> {
  try {
    const v = await tx<unknown>('readonly', (s) => s.get(id));
    return v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;
  } catch {
    return null;
  }
}

export async function saveBytes(id: string, bytes: Uint8Array): Promise<boolean> {
  try {
    await tx('readwrite', (s) => s.put(bytes, id));
    return true;
  } catch {
    return false;
  }
}

export async function clearSaved(id: string) {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {}
}

/* Small UI state (tabs, settings) lives in localStorage. */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem('dbify:' + key);
    if (!v) return fallback;
    const parsed = JSON.parse(v);
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? (parsed as T) : fallback;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem('dbify:' + key, JSON.stringify(value));
  } catch {}
}
