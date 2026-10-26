// sync.js — 기기 연결: 한 기기에서 만든 QR 코드를 다른 기기로 찍으면, 컴퓨터·휴대폰(여러 대)이 같은 기록을 써요.
// Each device keeps working on its own copy (the computer can be off); whenever a device is open it trades an
// encrypted copy through the haru-sync worker and merges per item (할 일, 메모, …) with what the others changed.
// The AES key lives only in the QR code / pairing code on the devices, so the worker can't read anything.
import { h, icon, store, bus, toast, modal, confirmDialog, LOCAL, editingNow, migrate } from './core.js';
import * as local from './local.js';
import { qrNode } from './phone.js';

// localStorage "haru.syncUrl" points a browser at a local `wrangler dev` copy for testing
export const SYNC_URL = (() => { try { return localStorage.getItem('haru.syncUrl') || ''; } catch { return ''; } })() || 'https://haru-sync.ree486555.workers.dev';
const APP_URL = 'https://haru.ree486555.workers.dev/'; // where a phone lands after scanning the QR
const PAIR_KEY = 'haru.sync';
const MAX_FILE = 30 << 20;

// ---------- pairing record (shared by every 하루 window in this browser) ----------
const readPair = () => { try { return JSON.parse(localStorage.getItem(PAIR_KEY)) || null; } catch { return null; } };
let pair = readPair();
const savePair = () => { try { pair ? localStorage.setItem(PAIR_KEY, JSON.stringify(pair)) : localStorage.removeItem(PAIR_KEY); } catch { /* storage blocked */ } };
const baseKey = () => 'syncBase:' + pair.room;
export const syncState = { status: pair ? 'idle' : 'off', at: pair?.at || 0, error: '' };
function setStatus(status, error = '') {
  syncState.status = status; syncState.error = error;
  if (status === 'ok') { syncState.at = Date.now(); if (pair) { pair.at = syncState.at; savePair(); } }
  bus.emit('sync', syncState);
}
export const isPaired = () => !!pair;
const pairCode = () => (pair ? `${pair.room}.${pair.key}` : '');
const pairLink = () => `${APP_URL}#pair=${pairCode()}`;
const validCode = c => /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(c || '');

// ---------- encryption: [1 byte format][12 byte IV][AES-GCM ciphertext]; format 2 = gzip inside ----------
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
const rand = n => crypto.getRandomValues(new Uint8Array(n));
let aesKey = null, aesFor = '';
async function key() {
  if (!aesKey || aesFor !== pair.key) { aesKey = await crypto.subtle.importKey('raw', unb64u(pair.key), 'AES-GCM', false, ['encrypt', 'decrypt']); aesFor = pair.key; }
  return aesKey;
}
const canGzip = typeof CompressionStream === 'function';
const through = async (bytes, Stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('gzip'))).arrayBuffer());
async function seal(bytes, gzip = canGzip) {
  const body = gzip ? await through(bytes, CompressionStream) : bytes;
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), body));
  const out = new Uint8Array(13 + ct.length);
  out[0] = gzip ? 2 : 1; out.set(iv, 1); out.set(ct, 13);
  return out;
}
async function unseal(buf) {
  const a = new Uint8Array(buf);
  let plain;
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: a.slice(1, 13) }, await key(), a.slice(13))); }
  catch { throw Object.assign(new Error('연결 코드가 맞지 않아요'), { code: 'key' }); }
  return a[0] === 2 ? through(plain, DecompressionStream) : plain;
}

// ---------- three-way merge ----------
// base = what every device agreed on last time, mine = this device now, theirs = the newest cloud copy.
// Objects merge key by key, lists of things with an id merge item by item (so a 할 일 added on the phone and a
// memo edited on the computer both survive), deletions stick unless the other side edited the item.
// Counters (XP, LP, goal progress) add both sides' gains; anything else edited on both sides keeps `prefer`.
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const hasIds = a => a.every(x => isObj(x) && (typeof x.id === 'string' || typeof x.id === 'number'));
const COUNTERS = new Set(['total', 'lp', 'current']);
export function merge3(base, mine, theirs, prefer = 'mine', key = '') {
  if (same(mine, theirs)) return mine;
  if (base !== undefined && same(base, mine)) return theirs;
  if (base !== undefined && same(base, theirs)) return mine;
  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      if (k in mine && k in theirs) out[k] = merge3(b[k], mine[k], theirs[k], prefer, k);
      else if (k in mine) { if (!(k in b) || !same(b[k], mine[k])) out[k] = mine[k]; }
      else if (!(k in b) || !same(b[k], theirs[k])) out[k] = theirs[k];
    }
    return out;
  }
  if (Array.isArray(mine) && Array.isArray(theirs) && hasIds(mine) && hasIds(theirs)) {
    const baseArr = Array.isArray(base) && hasIds(base) ? base : null;
    const B = new Map((baseArr || []).map(x => [x.id, x])), M = new Map(mine.map(x => [x.id, x])), T = new Map(theirs.map(x => [x.id, x]));
    // keep the order of whichever side reordered (or added/removed); on a first merge, the preferred side's
    const ids = a => a.map(x => x.id).join('\n');
    const leadMine = baseArr ? ids(mine) !== ids(baseArr) : prefer === 'mine';
    const first = leadMine ? mine : theirs, second = leadMine ? theirs : mine;
    const seen = new Set(first.map(x => x.id));
    const out = [];
    for (const id of [...first.map(x => x.id), ...second.filter(x => !seen.has(x.id)).map(x => x.id)]) {
      const inM = M.has(id), inT = T.has(id), inB = B.has(id);
      if (inM && inT) out.push(merge3(B.get(id), M.get(id), T.get(id), prefer));
      else if (inM) { if (!inB || !same(B.get(id), M.get(id))) out.push(M.get(id)); }
      else if (!inB || !same(B.get(id), T.get(id))) out.push(T.get(id));
    }
    return out;
  }
  if (COUNTERS.has(key) && [base, mine, theirs].every(n => typeof n === 'number')) return base + (mine - base) + (theirs - base);
  return prefer === 'mine' ? mine : theirs;
}

// every new 하루 starts with the same example 할 일·음식 under different ids; when two copies first meet, keep one set
function withoutSharedExamples(mine, theirs) {
  const dedupe = (list, other, name) => (list || []).filter(x => !(x.example && (other || []).some(y => y.example && y[name] === x[name])));
  return { ...mine, tasks: dedupe(mine.tasks, theirs.tasks, 'title'), diet: mine.diet ? { ...mine.diet, foods: dedupe(mine.diet.foods, theirs.diet?.foods, 'name') } : mine.diet };
}

// ---------- the sync cycle ----------
const api = (path, opts = {}) => fetch(`${SYNC_URL}/v1/${pair.room}/${path}`, { cache: 'no-store', ...opts });
let joinMode = null; // 'merge' | 'replace' for the first exchange after scanning a QR
let running = null, again = false;
export function syncNow() {
  if (!pair || !store.s) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    try { do { again = false; await cycle(); } while (again && pair); }
    finally { running = null; }
  })();
  return running;
}
async function cycle() {
  pair = readPair(); // another window may have moved the revision on
  if (!pair) { setStatus('off'); return; }
  setStatus('syncing');
  try {
    const r = await api(`state?have=${pair.rev || 0}`);
    if (r.status === 200) {
      const applied = await absorb(new Uint8Array(await r.arrayBuffer()), Number(r.headers.get('X-Rev')) || 0);
      if (!applied) { setStatus('idle'); return; } // something is being edited here; try again on the next round
    } else if (r.status === 404) {
      if (pair.rev) { forget(); toast('다른 기기에서 기기 연결을 모두 끊었어요. 이 기기의 기록은 그대로 있어요.', { icon: 'sync' }); return; }
    } else if (r.status !== 204) throw new Error('HTTP ' + r.status);

    const json = JSON.stringify(store.s);
    if (!pair.rev || json !== (await local.kvGet(baseKey()))) {
      const res = await api(`state?base=${pair.rev || 0}`, { method: 'PUT', body: await seal(new TextEncoder().encode(json)) });
      if (res.status === 409) { again = true; return; } // another device was quicker: pull and merge first
      if (!res.ok) throw new Error('HTTP ' + res.status);
      pair.rev = (await res.json()).rev; savePair();
      await local.kvSet(baseKey(), json);
    }
    joinMode = null;
    setStatus('ok');
    syncFiles();
  } catch (e) {
    if (e.code === 'key' && joinMode) { forget(); toast('연결 코드가 맞지 않아요. QR을 다시 찍어 주세요.'); return; }
    setStatus('error', navigator.onLine === false ? '인터넷에 연결돼 있지 않아요' : e.message || '동기화하지 못했어요');
  }
}
// take the cloud copy in: merge it with this device's records and redraw
async function absorb(bytes, rev) {
  const theirsJson = new TextDecoder().decode(await unseal(bytes));
  const baseJson = await local.kvGet(baseKey());
  // nothing awaits from here to the swap, so a tap in between can't be lost
  if (store._dirty || editingNow() || store.holds) return false;
  const theirs = JSON.parse(theirsJson);
  const mineJson = JSON.stringify(store.s);
  const merged = joinMode === 'replace' ? theirs
    : joinMode === 'merge' ? merge3(undefined, withoutSharedExamples(store.s, theirs), theirs, 'theirs')
      : merge3(baseJson ? JSON.parse(baseJson) : undefined, store.s, theirs, 'mine');
  pair.rev = rev; savePair();
  const mergedJson = JSON.stringify(merged);
  if (mergedJson !== mineJson) {
    store.s = migrate(merged);
    store.save();
    // a running timer alone shouldn't redraw the whole screen (same rule as the computer's own sync)
    const core = s => JSON.stringify({ ...s, pomo: 0, focus: 0 });
    bus.emit('remote', { minor: core(JSON.parse(mineJson)) === core(merged) });
  }
  await local.kvSet(baseKey(), theirsJson);
  return true;
}

// photos and recordings: referenced as "/files/<id>" in the records; each one crosses over once
const FILE_RE = /\/files\/([A-Za-z0-9._-]{1,80})/g;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf' };
let filesBusy = false;
async function syncFiles() {
  if (filesBusy || !pair) return;
  filesBusy = true;
  const doneKey = 'haru.syncFiles:' + pair.room;
  let done; try { done = new Set(JSON.parse(localStorage.getItem(doneKey)) || []); } catch { done = new Set(); }
  let fetched = 0;
  try {
    for (const id of new Set([...JSON.stringify(store.s).matchAll(FILE_RE)].map(m => m[1]))) {
      if (done.has(id) || !pair) continue;
      try {
        const mine = await localFile(id);
        if (mine) {
          if (mine.size <= MAX_FILE) {
            const res = await api('file/' + id, { method: 'PUT', body: await seal(new Uint8Array(await mine.arrayBuffer()), false) });
            if (!res.ok) continue;
          }
        } else {
          const res = await api('file/' + id);
          if (!res.ok) continue; // the device that has it hasn't sent it yet
          const bytes = await unseal(await res.arrayBuffer());
          await saveFile(id, new Blob([bytes], { type: MIME[id.split('.').pop().toLowerCase()] || '' }));
          fetched++;
        }
        done.add(id);
        try { localStorage.setItem(doneKey, JSON.stringify([...done])); } catch { /* ignore */ }
      } catch { /* try this one again next time */ }
    }
  } finally { filesBusy = false; }
  if (fetched) bus.emit('remote', { minor: false }); // redraw so the new pictures show up
}
async function localFile(id) {
  if (LOCAL) return local.fileBlob(id);
  try { const r = await fetch('/files/' + id, { cache: 'no-store' }); return r.ok ? await r.blob() : null; } catch { return null; }
}
async function saveFile(id, blob) {
  if (LOCAL) return local.putFileAs(id, blob);
  const r = await fetch('/api/files/' + id, { method: 'PUT', body: blob });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}

// ---------- starting, pairing, unpairing ----------
let timer = null;
const schedule = ms => { if (!pair) return; clearTimeout(timer); timer = setTimeout(syncNow, ms); };
export function startSync() {
  bus.on('saved', () => schedule(1500));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(300); });
  window.addEventListener('online', () => schedule(300));
  setInterval(() => { if (!document.hidden) schedule(0); }, 25e3);
  schedule(1000);
}
export async function createPairing() {
  pair = { room: b64u(rand(16)), key: b64u(rand(32)), rev: 0, at: 0 }; savePair();
  joinMode = null;
  await syncNow();
}
// fresh = nothing written by the person yet (only the example 할 일), so joining can simply take the other copy
const isFresh = s => !s || (!(s.memos || []).length && !(s.diary || []).length && !(s.events || []).length && !(s.goals || []).length && !(s.money?.tx || []).length && (s.tasks || []).every(t => t.example));
export function offerJoin(code) {
  code = (code || '').trim();
  if (!validCode(code)) { toast('연결 코드가 올바르지 않아요. QR을 다시 찍거나 코드를 확인해 주세요.'); return; }
  if (pairCode() === code) { toast('이미 연결된 기기예요.'); syncNow(); return; }
  const fresh = isFresh(store.s);
  modal({
    title: '다른 기기와 연결할까요?',
    body: h('div', { class: 'col' },
      h('p', { style: { margin: 0, lineHeight: 1.7 } }, '연결하면 이 기기와 QR을 만든 기기가 같은 기록을 써요. 어느 쪽에서 바꿔도 서로 자동으로 맞춰지고, 한쪽이 꺼져 있어도 각자 쓸 수 있어요.'),
      fresh ? null : h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.7 } }, '이 기기에도 기록이 있어요. "합치기"를 고르면 두 기기의 할 일·메모·일기 등이 모두 남고, "받기"를 고르면 이 기기의 기록은 지우고 다른 기기의 기록으로 바꿔요.')),
    actions: fresh
      ? [{ label: '취소' }, { label: '연결하기', primary: true, onClick: () => { join(code, 'replace'); } }]
      : [{ label: '취소' }, { label: '받기 (이 기기 기록 지우기)', onClick: () => { join(code, 'replace'); } }, { label: '합치기', primary: true, onClick: () => { join(code, 'merge'); } }],
  });
}
async function join(code, mode) {
  const [room, k] = code.split('.');
  pair = { room, key: k, rev: 0, at: 0 }; savePair();
  joinMode = mode;
  toast('연결하는 중이에요…', { icon: 'sync' });
  await syncNow();
  if (syncState.status === 'ok') toast('연결했어요. 이제 기기끼리 기록이 자동으로 맞춰져요.', { icon: 'check', duration: 6000 });
  else if (pair) toast(`아직 연결을 마치지 못했어요: ${syncState.error || '잠시 뒤 다시 시도해요'}`, { duration: 7000 });
}
function forget() {
  if (pair) { local.kvSet(baseKey(), null).catch(() => {}); try { localStorage.removeItem('haru.syncFiles:' + pair.room); } catch { /* ignore */ } }
  pair = null; savePair(); joinMode = null;
  setStatus('off');
}
export async function unpair(everywhere) {
  if (everywhere && pair) { try { await api('room', { method: 'DELETE' }); } catch { /* offline: the cloud copy expires on its own */ } }
  forget();
}

// ---------- 설정 → 기기 연결 ----------
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 10 ? '방금' : s < 60 ? `${s}초 전` : s < 3600 ? `${Math.round(s / 60)}분 전` : `${Math.round(s / 3600)}시간 전`; };
export function syncPanel(ctx) {
  const box = h('div', { class: 'col' });
  const codeIn = h('input', { class: 'input', placeholder: '다른 기기의 연결 코드 붙여넣기', 'aria-label': '연결 코드', autocomplete: 'off' });
  const joinBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: () => offerJoin(codeIn.value) }, '연결');
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') offerJoin(codeIn.value); });
  const status = h('div', { class: 'row wrap', style: { gap: '8px' } });
  const paintStatus = () => {
    const st = syncState;
    status.replaceChildren(
      h('span', { class: 'chip sm ' + (st.status === 'error' ? 'line' : 'ink') }, st.status === 'syncing' ? '맞추는 중…' : st.status === 'error' ? '연결 안 됨' : '연결됨'),
      h('span', { class: 'small muted grow' }, st.status === 'error' ? st.error : st.at ? `마지막으로 맞춘 때 ${ago(st.at)}` : '처음 맞추는 중이에요'),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => syncNow() }, icon('refresh', 14), '지금 맞추기'));
  };
  function paint() {
    if (!pair) {
      box.replaceChildren(
        h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.7 } }, '컴퓨터와 휴대폰을 QR 코드 하나로 연결하면 같은 기록을 함께 써요. 컴퓨터가 꺼져 있어도 휴대폰에서 그대로 쓰고, 다음에 둘 다 열리면 자동으로 맞춰져요. 기록은 연결한 기기들만 가진 열쇠로 암호화해서 주고받아요.'),
        h('button', { class: 'btn btn-ink', style: { alignSelf: 'flex-start' }, onclick: async e => { e.currentTarget.disabled = true; await createPairing(); paint(); } }, icon('qr', 16), '연결 QR 만들기'),
        h('details', { class: 'small' }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '다른 기기에서 만든 코드로 연결하기'),
          h('div', { class: 'row', style: { marginTop: '8px' } }, h('div', { class: 'grow' }, codeIn), joinBtn),
          h('p', { class: 'tiny muted', style: { lineHeight: 1.6 } }, '아이폰에서 홈 화면에 설치한 하루는 Safari와 저장 공간이 따로예요. 설치한 앱을 연결하려면 앱 안에서 이 칸에 코드를 붙여넣으세요.')));
      return;
    }
    const qr = h('div', { class: 'sync-qr' });
    qrNode(pairLink()).then(n => { if (n) qr.replaceChildren(n); });
    const code = pairCode();
    paintStatus();
    box.replaceChildren(
      status,
      h('div', { class: 'row wrap', style: { gap: '16px', alignItems: 'center' } }, qr,
        h('div', { class: 'col', style: { gap: '6px', flex: '1 1 220px', minWidth: 0 } },
          h('b', null, '다른 기기 추가하기'),
          h('span', { class: 'small muted', style: { lineHeight: 1.6 } }, '휴대폰 카메라로 QR을 찍으면 하루가 열리고 바로 연결돼요. 또는 그 기기의 설정 → 기기 연결에 아래 코드를 붙여넣어도 돼요.'),
          h('div', { class: 'row', style: { gap: '6px' } },
            h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('연결 코드를 복사했어요.'); } catch { toast(code); } } }, icon('copy', 14), '코드 복사'),
            h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { try { await navigator.clipboard.writeText(pairLink()); toast('연결 링크를 복사했어요.'); } catch { toast(pairLink()); } } }, icon('link', 14), '링크 복사')),
          h('span', { class: 'tiny muted' }, 'QR과 코드는 기록을 여는 열쇠예요. 다른 사람에게 보여 주지 마세요.'))),
      h('div', { class: 'row wrap' },
        h('details', { class: 'small grow' }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '다른 코드로 바꿔 연결하기'),
          h('div', { class: 'row', style: { marginTop: '8px' } }, h('div', { class: 'grow' }, codeIn), joinBtn)),
        h('button', { class: 'btn btn-ghost btn-sm btn-danger', onclick: () => {
          modal({
            title: '기기 연결 끊기',
            body: h('p', { style: { margin: 0, lineHeight: 1.7 } }, '이 기기의 기록은 그대로 남아요. "모든 기기"를 고르면 다른 기기들의 연결도 끊기고, 암호화된 클라우드 사본도 지워져요.'),
            actions: [{ label: '취소' },
              { label: '모든 기기', danger: true, onClick: async () => { if (!(await confirmDialog('모든 기기의 연결을 끊고 클라우드 사본을 지울까요?', { ok: '모두 끊기', danger: true }))) return false; await unpair(true); paint(); toast('모든 기기의 연결을 끊었어요.'); } },
              { label: '이 기기만', primary: true, onClick: async () => { await unpair(false); paint(); toast('이 기기의 연결을 끊었어요.'); } }],
          });
        } }, '연결 끊기')));
  }
  paint();
  ctx.on('sync', () => { if (!pair || !box.querySelector('.sync-qr')) paint(); else paintStatus(); });
  ctx.every(15e3, () => { if (pair) paintStatus(); });
  return box;
}
