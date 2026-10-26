// local.js — "이 기기에서만" mode: when 하루 is opened from the web without a computer to connect to,
// the records and the photos/recordings live in this browser's IndexedDB instead of on a 하루 server.
// No imports from core.js: core.js loads this first.

const DB = 'haru', KV = 'kv', FILES = 'files';
let dbp = null;
function db() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(KV); r.result.createObjectStore(FILES); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function run(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}

export const kvGet = key => run(KV, 'readonly', s => s.get(key));
export const kvSet = (key, value) => run(KV, 'readwrite', s => s.put(value, key));

// files keep the server's "/files/<id>" addresses, so the rest of the app doesn't need to know where they are
export async function putFile(blob, name = 'file') {
  const ext = ((/\.[a-z0-9]{1,8}$/i.exec(name) || [''])[0]).toLowerCase();
  const id = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('') + ext;
  await run(FILES, 'readwrite', s => s.put(blob, id));
  return { url: '/files/' + id, name, size: blob.size, type: blob.type || '' };
}
export const fileBlob = id => run(FILES, 'readonly', s => s.get(id)).catch(() => null);
// a file that arrived from another paired device keeps its id, so the records that point at it still work
export const putFileAs = (id, blob) => run(FILES, 'readwrite', s => s.put(blob, id));
const urls = new Map();
export async function fileURL(id) {
  if (urls.has(id)) return urls.get(id);
  const b = await fileBlob(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}
export const cachedFileURL = id => urls.get(id) || null;

// backups carry the files too (as data URLs), so a backup moved to another device is complete
export async function exportFiles() {
  const out = {};
  const d = await db();
  await new Promise((res, rej) => {
    const tx = d.transaction(FILES, 'readonly');
    const cur = tx.objectStore(FILES).openCursor();
    const pending = [];
    cur.onsuccess = () => {
      const c = cur.result; if (!c) return;
      const id = c.key, blob = c.value;
      pending.push(new Promise(r => { const fr = new FileReader(); fr.onload = () => { out[id] = fr.result; r(); }; fr.onerror = () => r(); fr.readAsDataURL(blob); }));
      c.continue();
    };
    tx.oncomplete = () => Promise.all(pending).then(res);
    tx.onerror = () => rej(tx.error);
  });
  return out;
}
export async function importFiles(map = {}) {
  for (const [id, dataUrl] of Object.entries(map)) {
    const blob = await (await fetch(dataUrl)).blob();
    await run(FILES, 'readwrite', s => s.put(blob, id));
  }
}
export async function wipe() {
  await run(KV, 'readwrite', s => s.clear());
  await run(FILES, 'readwrite', s => s.clear());
}
// ask the browser not to evict this site's storage when space runs low
export function persist() { try { navigator.storage?.persist?.(); } catch { /* not supported */ } }
