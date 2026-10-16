// Stockage local (IndexedDB) : partitions, prises (avec l'audio) et réglages.
const NAME = 'voix-juste';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('scores', { keyPath: 'id' });
      const t = db.createObjectStore('takes', { keyPath: 'id' });
      t.createIndex('scoreId', 'scoreId');
      db.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const all = (store) => tx(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
export const put = (store, obj) => tx(store, 'readwrite', (s) => s.put(obj));
export const del = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
export const clear = (store) => tx(store, 'readwrite', (s) => s.clear());
export const kvGet = async (k, def) => { const v = await tx('kv', 'readonly', (s) => s.get(k)); return v === undefined ? def : v; };
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* facultatif */ }
  return false;
}
