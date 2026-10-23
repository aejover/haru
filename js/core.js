// core.js — shared state, DOM helpers, dates, icons, notifications, Claude bridge, XP / tier engine.

// ---------- where the computer's server is ----------
// Served by the 하루 server itself → same origin. Opened from GitHub Pages → talk to the computer's
// Tailscale address (given once as ?server=… or typed on the connect screen, then remembered).
const qsServer = new URLSearchParams(location.search).get('server');
if (qsServer) { try { localStorage.setItem('haru.server', qsServer.trim().replace(/\/+$/, '')); } catch { /* ignore */ } }
export const REMOTE = location.hostname.endsWith('github.io') || !!qsServer;
export const API_BASE = REMOTE ? (() => { try { return localStorage.getItem('haru.server') || ''; } catch { return ''; } })() : '';
export const apiUrl = p => (API_BASE && /^\/(api|files)\//.test(p) ? API_BASE + p : p);
if (API_BASE) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => nativeFetch(typeof input === 'string' ? apiUrl(input) : input, init);
  // photos, recordings and files are saved as "/files/…" and live on the computer
  const fix = el => { for (const a of ['src', 'href']) { const v = el.getAttribute?.(a); if (v && /^\/files\//.test(v)) el.setAttribute(a, API_BASE + v); } };
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes') fix(m.target);
      else m.addedNodes.forEach(n => { if (n.nodeType === 1) { fix(n); n.querySelectorAll?.('[src^="/files/"],[href^="/files/"]').forEach(fix); } });
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });
}

// ---------- DOM ----------
// Let append/replaceChildren skip null/false and flatten arrays, the same way h() treats children.
for (const m of ['append', 'replaceChildren']) {
  const native = Element.prototype[m];
  Element.prototype[m] = function (...kids) { return native.apply(this, kids.flat(Infinity).filter(k => k != null && k !== false)); };
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) { if (val == null) continue; if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; }
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled' || k === 'multiple') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- dates ----------
export const pad = n => String(n).padStart(2, '0');
export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dkey(d); };
export const dayDiff = (a, b) => Math.round((fromKey(a) - fromKey(b)) / 86400000);
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export function mondayOf(k) { const d = fromKey(k); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return dkey(d); }
export function fmtDay(k, withYear = false) {
  const d = fromKey(k);
  return `${withYear ? d.getFullYear() + '년 ' : ''}${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`;
}
export function fmtShort(k) { const d = fromKey(k); return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`; }
export function fmtDur(sec, short = false) {
  sec = Math.round(sec || 0);
  const hr = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (short) return hr ? `${hr}h ${pad(m)}m` : `${m}m`;
  if (hr) return `${hr}시간${m ? ' ' + m + '분' : ''}`;
  return `${m}분`;
}
export const fmtClock = sec => { sec = Math.max(0, Math.ceil(sec)); return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`; };
export const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB';

// ---------- icons ----------
const P = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  home: '<path d="M4 11.2 12 4.5l8 6.7V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  memo: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.8l2.4 1.6M9.5 3h5M12 3v3.5"/>',
  play: '<path d="M8 5.5v13a.6.6 0 0 0 .9.5l10.2-6.5a.6.6 0 0 0 0-1L8.9 5a.6.6 0 0 0-.9.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  skip: '<path d="M6 5.5v13l9-6.5zM18 5v14"/>',
  prev: '<path d="M18 5.5v13l-9-6.5zM6 5v14"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10.2 9.2 4.8 2.8-4.8 2.8z" fill="currentColor"/>',
  radio: '<rect x="3" y="8" width="18" height="12" rx="2.5"/><path d="M7 8 16 4"/><circle cx="15.5" cy="14" r="2.5"/><path d="M6.5 12h3M6.5 15.5h3"/>',
  doc: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
  checklist: '<rect x="3.5" y="4" width="6" height="6" rx="1.6"/><path d="m4.8 15.8 1.7 1.7 3-3.2M13 7h7.5M13 16.5h7.5"/>',
  diary: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15.5H6.5A1.5 1.5 0 0 0 5 20z"/><path d="M5 20a1.5 1.5 0 0 0 1.5 1.5H19M9 7.5h6"/>',
  diet: '<path d="M4 11.5h16a8 8 0 0 1-16 0zM8.5 3.5c0 2 1.5 2 1.5 4M13 3.5c0 2 1.5 2 1.5 4"/>',
  chart: '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.3h6.4a1.5 1.5 0 0 0 1.5-1.3L17.5 7"/>',
  pen: '<path d="M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5z"/><path d="M13.8 7l3.2 3.2"/>',
  highlighter: '<path d="m9 15-4 4.5h5l1.5-1.5M8.5 12.5l7-8 4 4-8 7z"/>',
  eraser: '<path d="M8.5 19.5 4 15l9.5-9.5a1.5 1.5 0 0 1 2.1 0l3.4 3.4a1.5 1.5 0 0 1 0 2.1L11 19.5zM8.5 19.5h11"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 3.5 3.5 2.5-2.5 5 5"/>',
  clip: '<path d="m19 11.5-7.4 7.4a4.6 4.6 0 0 1-6.5-6.5l7.8-7.8a3 3 0 0 1 4.3 4.3l-7.7 7.7a1.5 1.5 0 0 1-2.1-2.1l7-7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  left: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  right: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  up: '<path d="m6 14.5 6-6 6 6"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0"/>',
  bellOff: '<path d="M8.5 5.6A6 6 0 0 1 18 11v5M6 10.5v6l-1.5 2H17M10 20.5a2.2 2.2 0 0 0 4 0M4 4l16 16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
  rain: '<path d="M7 15.5h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 15.5zM8.5 18.5l-1 2M12.5 18.5l-1 2M16.5 18.5l-1 2"/>',
  snow: '<path d="M7 15h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 15z"/><circle cx="8.5" cy="19" r=".6" fill="currentColor"/><circle cx="12" cy="20" r=".6" fill="currentColor"/><circle cx="15.5" cy="19" r=".6" fill="currentColor"/>',
  storm: '<path d="M7 15h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 15zM12.5 15l-2 3.5h3l-2 3"/>',
  fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
  partly: '<path d="M8.5 5.5a4 4 0 0 1 6.8 1.7M4 9.5a4 4 0 0 1 1.7-.4"/><path d="M8 19h9a3.5 3.5 0 0 0 .5-7 5 5 0 0 0-9.6 1.4A2.8 2.8 0 0 0 8 19z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  sparkle: '<path d="M12 3.5c.6 4.2 2.3 6 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.5 5.9-2.3 6.5-6.5zM18.5 15.5c.3 1.8 1 2.6 2.8 2.8-1.8.3-2.5 1-2.8 2.8-.3-1.8-1-2.5-2.8-2.8 1.8-.2 2.5-1 2.8-2.8z"/>',
  send: '<path d="M4.5 12 19.5 5l-4.3 14.5-3.4-6.2z M11.8 13.3 19.5 5"/>',
  more: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  flame: '<path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-3.5-2.5-5.5-3.5-8.5-1.5 1.5-2 3-2 4.5-1.5-1-2.5-3.5-2-7C7.5 5.5 5.5 9.5 5.5 14.5A6.5 6.5 0 0 0 12 21z"/>',
  trophy: '<path d="M7.5 4.5h9v5a4.5 4.5 0 0 1-9 0zM7.5 6.5H4.5a3 3 0 0 0 3 4M16.5 6.5h3a3 3 0 0 1-3 4M12 14v3.5M8.5 20.5h7M9.5 17.5h5v3h-5z"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  pin: '<path d="M9 4.5h6l-1 5 3.5 3.5h-11L10 9.5zM12 13v7"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" stroke-width="2.2"/>',
  italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
  underline: '<path d="M7 4.5V11a5 5 0 0 0 10 0V4.5M5.5 20h13"/>',
  strike: '<path d="M4.5 12h15M16 7.5a4 3 0 0 0-4-2.5c-2.5 0-4 1.2-4 3 0 3.6 8 2.6 8 6.6 0 1.9-1.8 3.4-4.2 3.4A4.6 4.6 0 0 1 7.5 16"/>',
  alignL: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  alignC: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignR: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  alignJ: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1" fill="currentColor"/><circle cx="4.8" cy="12" r="1" fill="currentColor"/><circle cx="4.8" cy="17.5" r="1" fill="currentColor"/>',
  olist: '<path d="M10 6.5h10M10 12h10M10 17.5h10M4.5 5l1.2-.6V9M4.2 14.2c.5-.8 2.4-.8 2.4.4 0 1-2.4 1.6-2.4 3h2.6"/>',
  indent: '<path d="M10 6h10M10 10h10M10 14h10M4 18h16M4 8.5l3 2.5-3 2.5"/>',
  outdent: '<path d="M10 6h10M10 10h10M10 14h10M4 18h16M7 8.5 4 11l3 2.5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15"/>',
  type: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  square: '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="7.5"/>',
  hr: '<path d="M4 12h16"/>',
  undo: '<path d="M9 7.5 4.5 12 9 16.5M5 12h9.5a5 5 0 0 1 0 10H12"/>',
  redo: '<path d="M15 7.5 19.5 12 15 16.5M19 12H9.5a5 5 0 0 0 0 10H12"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  present: '<rect x="3.5" y="4.5" width="17" height="11" rx="1.5"/><path d="M12 15.5v4M8.5 20.5h7"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  front: '<rect x="8" y="8" width="11" height="11" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M5 15.5V6a1 1 0 0 1 1-1h9.5"/>',
  back: '<rect x="5" y="5" width="11" height="11" rx="1.5"/><path d="M19 8.5V18a1 1 0 0 1-1 1H8.5" />',
  sigma: '<path d="M17.5 5h-11l6 7-6 7h11"/>',
  sortUp: '<path d="M7 18V6M4 9l3-3 3 3M13 7h7M13 12h5M13 17h3"/>',
  sortDown: '<path d="M7 6v12M4 15l3 3 3-3M13 7h3M13 12h5M13 17h7"/>',
  rowAdd: '<rect x="3.5" y="4.5" width="17" height="6" rx="1.5"/><path d="M12 14v6M9 17h6"/>',
  colAdd: '<rect x="4.5" y="3.5" width="6" height="17" rx="1.5"/><path d="M14 12h6M17 9v6"/>',
  fill: '<path d="m5 11.5 6.5-6.5 7 7-6.5 6.5a1.5 1.5 0 0 1-2.1 0L5 13.6a1.5 1.5 0 0 1 0-2.1zM19.5 15.5s1.5 1.8 1.5 3a1.5 1.5 0 0 1-3 0c0-1.2 1.5-3 1.5-3z"/>',
  text: '<path d="M5 19 10.5 5h3L19 19M7.3 13.5h9.4"/>',
  face5: '<circle cx="12" cy="12" r="8.5"/><path d="M7.8 13.2a4.4 4.4 0 0 0 8.4 0z" fill="currentColor"/><path d="M8 9.5l1.6-1 1.6 1M12.8 9.5l1.6-1 1.6 1"/>',
  face4: '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 13.5a4.3 4.3 0 0 0 7.4 0"/><circle cx="9.2" cy="9.8" r=".9" fill="currentColor"/><circle cx="14.8" cy="9.8" r=".9" fill="currentColor"/>',
  face3: '<circle cx="12" cy="12" r="8.5"/><path d="M8.7 14.5h6.6"/><circle cx="9.2" cy="9.8" r=".9" fill="currentColor"/><circle cx="14.8" cy="9.8" r=".9" fill="currentColor"/>',
  face2: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 15.5a4.3 4.3 0 0 1 7 0"/><circle cx="9.2" cy="9.8" r=".9" fill="currentColor"/><circle cx="14.8" cy="9.8" r=".9" fill="currentColor"/>',
  face1: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 16.3a4.5 4.5 0 0 1 7.6 0M8 8.5l2.4 1.3M16 8.5l-2.4 1.3"/>',
  external: '<path d="M14 4h6v6M20 4l-8 8M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
  video: '<rect x="3.5" y="6" width="12.5" height="12" rx="2"/><path d="m16 10.5 4.5-2.5v8L16 13.5z"/>',
  wave: '<path d="M4 12h1.5M7.5 8v8M11 5v14M14.5 9v6M18 7v10M20.5 11v2"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1 0 1.5-.7 1.5-1.4 0-1.1-1-1.4-1-2.4s.8-1.7 1.8-1.7H16a4.5 4.5 0 0 0 4.5-4.5c0-3.9-3.8-7-8.5-7z"/><circle cx="8" cy="11" r="1" fill="currentColor"/><circle cx="11" cy="7.5" r="1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1" fill="currentColor"/>',
  scale: '<path d="M12 4v16M5 20h14M5.5 8h13M5.5 8 3 14a3 3 0 0 0 5 0zM18.5 8 16 14a3 3 0 0 0 5 0z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
};
export function icon(name, size = 20, sw = 1.7) {
  const s = document.createElement('span');
  s.style.display = 'inline-flex';
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  return s.firstChild;
}
export const iconHTML = (name, size = 20, sw = 1.7) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// Claude's little companion: a square, blocky creature with side arms, four short legs and blinking eyes.
export function clawdSVG(size = 44) {
  return `<svg class="clawd" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">`
    + `<g class="body">`
    + `<rect x="12" y="12" width="40" height="30" rx="6"/>`
    + `<rect class="arm l" x="5" y="23" width="8" height="8" rx="2.5"/><rect class="arm r" x="51" y="23" width="8" height="8" rx="2.5"/>`
    + `<rect x="17" y="45" width="5" height="7" rx="2"/><rect x="26" y="45" width="5" height="7" rx="2"/><rect x="33" y="45" width="5" height="7" rx="2"/><rect x="42" y="45" width="5" height="7" rx="2"/>`
    + `<rect class="eye" x="21" y="21" width="5" height="8" rx="2"/><rect class="eye" x="38" y="21" width="5" height="8" rx="2"/>`
    + `</g></svg>`;
}

// ---------- event bus ----------
const listeners = {};
export const bus = {
  on(ev, fn) { (listeners[ev] ||= new Set()).add(fn); return () => listeners[ev].delete(fn); },
  emit(ev, data) { listeners[ev]?.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },
};

// ---------- store ----------
const LS_KEY = 'haru.state.v1';
const editingNow = () => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
// The computer's server holds the one true copy. Several devices (PC, phone) can be open at once:
// every save bumps a revision, the server tells the other devices, and they reload the data when idle.
export const store = {
  s: null,
  serverOk: false,
  fromServer: false,
  // one id per window (kept across reloads of that window), so two windows on one PC also sync
  clientId: (() => { try { let id = sessionStorage.getItem('haru.window'); if (!id) { id = uid(); sessionStorage.setItem('haru.window', id); } return id; } catch { return uid(); } })(),
  rev: 0,
  savedAt: 0,
  pendingRemote: false,
  async load() {
    let data = null;
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (r.ok) { data = await r.json(); this.serverOk = this.fromServer = true; this.rev = Number(r.headers.get('X-Haru-Rev')) || 0; }
    } catch { /* server not running */ }
    if (!this.fromServer) { try { data = JSON.parse(localStorage.getItem(LS_KEY)); } catch { data = null; } }
    this.s = migrate(data || seed());
    if (!data) this.flush();
  },
  // Another device saved: take its copy, unless something is being typed here right now.
  // Something long-running (a recording) can hold off other devices' updates until it finishes.
  holds: 0,
  hold() {
    this.holds++;
    let done = false;
    return () => {
      if (done) return; done = true;
      this.holds = Math.max(0, this.holds - 1);
      if (!this.holds && this.pendingRemote) setTimeout(() => this.pullRemote(), 300);
    };
  },
  async pullRemote() {
    if (!this.fromServer) return;
    if (this._dirty || editingNow() || this.holds) { this.pendingRemote = true; return; }
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      const data = r.ok ? await r.json() : null;
      if (!data) return;
      if (this._dirty || editingNow() || this.holds) { this.pendingRemote = true; return; }
      this.rev = Number(r.headers.get('X-Haru-Rev')) || this.rev;
      // a running timer saves every few seconds; that alone shouldn't redraw the whole screen
      const core = s => JSON.stringify({ ...s, pomo: 0, focus: 0 });
      const minor = core(this.s) === core(data);
      this.s = migrate(data);
      this.pendingRemote = false;
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.s)); } catch { /* quota */ }
      bus.emit('remote', { minor });
    } catch { /* offline */ }
  },
  async checkRemote() {
    if (!this.fromServer) return;
    try { const { rev } = await (await fetch('/api/rev', { cache: 'no-store' })).json(); if (rev !== this.rev) this.pullRemote(); } catch { /* offline */ }
  },
  // Trailing throttle: a burst of changes is written once, at most 700ms after the first.
  save() {
    this._dirty = true;
    if (!this._t) this._t = setTimeout(() => { this._t = null; this.flush(); }, 700);
  },
  async flush() {
    if (!this.s) return;
    clearTimeout(this._t); this._t = null;
    this._dirty = false;
    const body = JSON.stringify(this.s);
    try { localStorage.setItem(LS_KEY, body); } catch { /* quota or blocked */ }
    // A copy loaded from this browser (computer unreachable) never overwrites the computer's data.
    if (!this.fromServer) { bus.emit('saved', false); return; }
    try {
      const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Haru-Client': this.clientId }, body });
      this.serverOk = r.ok; this.savedAt = Date.now();
      if (r.ok) { const j = await r.json(); if (j.rev) this.rev = j.rev; }
    } catch { this.serverOk = false; }
    bus.emit('saved', this.serverOk);
  },
};
window.addEventListener('pagehide', () => {
  if (!store._dirty || !store.s) return;
  const body = JSON.stringify(store.s);
  try { localStorage.setItem(LS_KEY, body); } catch { /* quota */ }
  if (store.fromServer) { try { navigator.sendBeacon(apiUrl('/api/state'), new Blob([body], { type: 'application/json' })); } catch { /* too large for a beacon */ } }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (store._dirty) store.flush(); }
  else store.checkRemote();
});
document.addEventListener('focusout', () => setTimeout(() => { if (store.pendingRemote && !store._dirty && !editingNow()) store.pullRemote(); }, 400));

export function commit(what = 'change') { store.save(); bus.emit('change', what); }

function seed() {
  const today = dkey();
  return {
    v: 1,
    createdAt: today,
    profile: { name: '', goal: '', birthYear: '', photo: '', roleModel: { name: '', note: '' }, motivation: '' },
    settings: {
      theme: 'system', city: null, ntfyTopic: '', ntfyServer: 'https://ntfy.sh', googleClientId: '',
      nagInterval: 60, nagStart: 9, nagEnd: 22, briefHour: 8, eventLead: 30, sttAuto: true,
    },
    pomoCfg: { focus: 25, short: 5, long: 15, every: 4, auto: true, sound: true },
    pomo: { mode: 'focus', running: false, endAt: 0, remain: 25 * 60, cycle: 0, lastTick: 0 },
    tasks: [
      { id: uid(), title: '물 2L 마시기', kind: 'daily', mode: 'normal', start: today, done: {}, example: true },
      { id: uid(), title: '약 먹기', kind: 'daily', mode: 'nag', time: '09:00', start: today, done: {}, example: true },
      { id: uid(), title: '오늘 계획 세우기', kind: 'once', date: today, mode: 'normal', start: today, done: {}, example: true },
    ],
    events: [],
    calImages: {},
    memos: [],
    diary: [],
    diet: {
      body: { age: '', sex: 'female', height: '', weight: '', activity: 1.375, goal: 'maintain' },
      foods: [
        { id: uid(), name: '현미밥 1공기', serving: '210g', kcal: 330, carb: 70, protein: 7, fat: 2.5, example: true },
        { id: uid(), name: '닭가슴살', serving: '100g', kcal: 165, carb: 0, protein: 31, fat: 3.6, example: true },
        { id: uid(), name: '삶은 달걀', serving: '1개 (50g)', kcal: 72, carb: 0.4, protein: 6.3, fat: 4.8, example: true },
        { id: uid(), name: '바나나', serving: '1개 (120g)', kcal: 105, carb: 27, protein: 1.3, fat: 0.4, example: true },
      ],
      logs: {},
    },
    focus: {},
    docs: [],
    yt: { saved: [], recent: [], alarm: { on: true, every: 30 }, radio: false },
    xp: { total: 0, days: {}, firsts: {} },
    tier: { lp: 0, history: [], weeks: [], lastDay: addDays(today, -1), lastWeek: mondayOf(today), weekSeen: mondayOf(today) },
  };
}
function migrate(s) {
  const d = seed();
  for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
  s.settings = { ...d.settings, ...s.settings };
  s.pomoCfg = { ...d.pomoCfg, ...s.pomoCfg };
  s.yt = { ...d.yt, ...s.yt };
  s.yt.alarm = { ...d.yt.alarm, ...s.yt.alarm };
  s.profile = { ...d.profile, ...s.profile, roleModel: { ...d.profile.roleModel, ...(s.profile?.roleModel || {}) } };
  s.diet.body = { ...d.diet.body, ...s.diet.body };
  s.tier = { ...d.tier, ...s.tier };
  return s;
}

// ---------- tasks & stats ----------
export function applies(t, k) {
  if (t.kind === 'once') return t.date === k;
  if (t.start && k < t.start) return false;
  if (t.end && k >= t.end) return false;
  return !t.days?.length || t.days.includes(fromKey(k).getDay());
}
export const tasksOn = k => store.s.tasks.filter(t => applies(t, k));
export const isDone = (t, k) => !!t.done?.[k];
export function setDone(t, k, on) {
  t.done ||= {};
  if (on) { if (!t.done[k]) { t.done[k] = Date.now(); gainXP('task'); } }
  else delete t.done[k];
  commit('tasks');
}
export function removeTask(t) {
  const today = dkey();
  if (t.kind === 'daily' && t.start < today) t.end = today; // keep its history for past stats
  else store.s.tasks = store.s.tasks.filter(x => x !== t);
  commit('tasks');
}
export const visibleTasks = () => store.s.tasks.filter(t => !t.end || t.end > dkey());
export function addTask(o) {
  const t = { id: uid(), title: o.title.trim(), kind: o.kind || 'once', mode: o.mode || 'normal', start: dkey(), done: {} };
  if (t.kind === 'once') t.date = o.date || dkey();
  if (o.time) t.time = o.time;
  if (o.days?.length) t.days = o.days;
  if (o.note) t.note = o.note;
  store.s.tasks.push(t);
  gainXP('checklist');
  commit('tasks');
  return t;
}
export function dayStats(k) {
  const list = tasksOn(k);
  const done = list.filter(t => isDone(t, k)).length;
  return { total: list.length, done, pct: list.length ? (done / list.length) * 100 : 0, focus: store.s.focus[k] || 0 };
}
export function weekStats(monday) {
  let total = 0, done = 0, focus = 0;
  for (let i = 0; i < 7; i++) { const st = dayStats(addDays(monday, i)); total += st.total; done += st.done; focus += st.focus; }
  return { total, done, pct: total ? (done / total) * 100 : 0, focus };
}
// days a nag task has been missed (0 = due today, not late)
export function overdueDays(t, today = dkey()) {
  if (t.kind === 'once') return t.date && !t.done?.[t.date] && t.date < today ? dayDiff(today, t.date) : 0;
  let streak = 0, k = addDays(today, -1);
  for (let i = 0; i < 14 && (!t.start || k >= t.start); i++, k = addDays(k, -1)) {
    if (!applies(t, k)) continue;
    if (t.done?.[k]) break;
    streak++;
  }
  return streak;
}
export const nagCount = days => (days >= 3 ? 10 : days === 2 ? 5 : days === 1 ? 3 : 0);

// ---------- XP / level ----------
const XP_RULES = {
  task: [10, 30], checklist: [3, 10], memo: [5, 10], record: [8, 5], pomodoro: [15, 16], diary: [20, 2], diet: [5, 12],
  doc: [10, 8], calendar: [3, 15], ai: [2, 20], youtube: [2, 3], profile: [5, 3], weather: [1, 1],
};
export const FEATURE_NAMES = { task: '할 일 완료', checklist: '체크리스트', memo: '메모', record: '녹음', pomodoro: '뽀모도로', diary: '일기', diet: '식단', doc: '문서', calendar: '캘린더', ai: 'Claude', youtube: '유튜브', profile: '프로필' };
export function levelInfo(total) {
  let lv = 1;
  while (50 * lv * (lv + 1) <= total) lv++;
  const base = 50 * (lv - 1) * lv, next = 50 * lv * (lv + 1);
  return { level: lv, cur: total - base, need: next - base, pct: ((total - base) / (next - base)) * 100 };
}
export function gainXP(feature, amount) {
  const x = store.s.xp; const k = dkey();
  x.days[k] ||= {};
  const n = x.days[k][feature] || 0;
  const [base, cap] = XP_RULES[feature] || [2, 10];
  if (n >= cap) return 0;
  x.days[k][feature] = n + 1;
  let g = amount ?? base;
  let first = false;
  if (!x.firsts[feature]) { x.firsts[feature] = k; g += 30; first = true; }
  const before = levelInfo(x.total).level;
  x.total += g;
  const after = levelInfo(x.total).level;
  floatXP(g);
  if (first && FEATURE_NAMES[feature]) toast(`${FEATURE_NAMES[feature]} 첫 사용 보너스 +30 XP`, { icon: 'sparkle' });
  if (after > before) { toast(`레벨 업! Lv.${after}`, { icon: 'trophy' }); bus.emit('levelup', after); }
  store.save(); bus.emit('xp');
  return g;
}
function floatXP(g) {
  const av = document.getElementById('avatar-btn');
  if (!av) return;
  const r = av.getBoundingClientRect();
  const el = h('div', { class: 'xp-float', style: { left: r.left - 30 + 'px', top: r.bottom + 4 + 'px' } }, `+${g} XP`);
  document.body.append(el);
  setTimeout(() => el.remove(), 1400);
}

// ---------- tier ----------
export const TIERS = [
  ['아이언', 0], ['브론즈', 100], ['실버', 250], ['골드', 450], ['플래티넘', 700],
  ['에메랄드', 1000], ['다이아몬드', 1400], ['마스터', 1900], ['그랜드마스터', 2500], ['챌린저', 3200],
];
export function tierInfo(lp) {
  let i = 0;
  while (i < TIERS.length - 1 && lp >= TIERS[i + 1][1]) i++;
  const [name, from] = TIERS[i];
  const to = TIERS[i + 1]?.[1];
  const roman = ['IV', 'III', 'II', 'I'];
  let div = '';
  if (to && i < 7) div = roman[Math.min(3, Math.floor(((lp - from) / (to - from)) * 4))];
  return { idx: i, name, div, label: `${name}${div ? ' ' + div : ''}`, lp, from, to, pct: to ? ((lp - from) / (to - from)) * 100 : 100, next: TIERS[i + 1]?.[0] };
}
export function tierEmblem(idx, size = 34) {
  const sides = 3 + Math.min(idx, 6);
  const pts = Array.from({ length: sides }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    return `${(24 + 18 * Math.cos(a)).toFixed(1)},${(24 + 18 * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  const rings = idx >= 7 ? `<circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".5"/>` : '';
  const crown = idx >= 9 ? `<path d="M15 9l4 4 5-6 5 6 4-4-2 8H17z" fill="currentColor"/>` : '';
  const fillOp = (0.08 + idx * 0.09).toFixed(2);
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">${rings}<polygon points="${pts}" fill="currentColor" fill-opacity="${fillOp}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><text x="24" y="28.5" text-anchor="middle" font-size="12" font-weight="800" fill="currentColor" font-family="inherit">${idx + 1}</text>${crown}</svg>`;
}
export function record() {
  const hist = store.s.tier.history;
  const w = hist.filter(x => x.result === 'W').length, l = hist.filter(x => x.result === 'L').length, d = hist.filter(x => x.result === 'D').length;
  let streak = 0; const last = hist[hist.length - 1]?.result;
  for (let i = hist.length - 1; i >= 0 && hist[i].result === last; i--) streak++;
  return { w, l, d, games: hist.length, rate: hist.length ? Math.round((w / hist.length) * 100) : 0, streak, streakType: last };
}
// Compare each finished day with the one before it, and each finished week with the week before.
export function evaluateTier() {
  const t = store.s.tier; const today = dkey();
  const events = [];
  let k = addDays(t.lastDay, 1);
  let guard = 0;
  while (k < today && guard++ < 120) {
    const a = dayStats(k), b = dayStats(addDays(k, -1));
    if (a.total || a.focus || b.total || b.focus) {
      const moreDone = a.done > b.done, moreFocus = a.focus > b.focus + 60;
      const lessDone = a.done < b.done, lessFocus = a.focus + 60 < b.focus;
      let result, delta;
      if (moreDone || moreFocus) { result = 'W'; delta = 20 + (moreDone && moreFocus ? 10 : 0); }
      else if (lessDone || lessFocus) { result = 'L'; delta = -12; }
      else { result = 'D'; delta = a.done ? 3 : 0; }
      t.lp = Math.max(0, t.lp + delta);
      t.history.push({ date: k, result, delta, done: a.done, total: a.total, focus: a.focus, pDone: b.done, pTotal: b.total, pFocus: b.focus });
      events.push({ type: 'day', date: k, result, delta });
    }
    t.lastDay = k;
    k = addDays(k, 1);
  }
  if (t.history.length > 400) t.history = t.history.slice(-400);
  const thisMon = mondayOf(today);
  if (t.lastWeek < thisMon) {
    const wk = addDays(thisMon, -7), prev = addDays(thisMon, -14);
    const a = weekStats(wk), b = weekStats(prev);
    if (a.total || a.focus) {
      const better = (a.pct > b.pct + 1 && a.done >= b.done) || a.focus > b.focus * 1.05 + 300 || (a.done > b.done && a.pct >= b.pct);
      const worse = a.pct + 1 < b.pct && a.focus < b.focus;
      const delta = better ? 100 : worse ? -40 : 10;
      t.lp = Math.max(0, t.lp + delta);
      t.weeks.push({ week: wk, delta, better, worse, pct: a.pct, pPct: b.pct, focus: a.focus, pFocus: b.focus, done: a.done, pDone: b.done });
      events.push({ type: 'week', week: wk, delta, better });
    }
    t.lastWeek = thisMon;
  }
  if (events.length) commit('tier');
  return events;
}

// ---------- UI feedback ----------
export function toast(msg, { icon: ic, title, action, duration = 3400 } = {}) {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: 'toast', role: 'status' },
    ic ? icon(ic, 18) : null,
    h('div', { class: 't-body' }, title ? h('div', { class: 't-title' }, title) : null, h('div', { class: title ? 't-msg' : '' }, msg)),
    action ? h('button', { onclick: () => { action.onClick(); close(); } }, action.label) : null);
  root.append(el);
  while (root.children.length > 3) root.firstChild.remove();
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  setTimeout(close, duration);
  return close;
}

let modalDepth = 0;
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  let closed = false;
  const close = () => {
    if (closed) return; closed = true; modalDepth--;
    wrap.classList.remove('in'); wrap.classList.add('out');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 280);
    onClose?.();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal glass' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h3', null, title), h('button', { class: 'btn-icon', 'aria-label': '닫기', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('div', { class: 'modal-foot' }, actions.map(a => h('button', {
      class: 'btn ' + (a.primary ? 'btn-ink' : a.danger ? 'btn-ghost btn-danger' : 'btn-ghost'),
      onclick: async () => { const r = await a.onClick?.(); if (r !== false) close(); },
    }, a.label))) : null);
  const wrap = h('div', { class: 'modal-wrap', onmousedown: e => { if (e.target === wrap) close(); } }, box);
  root.append(wrap); modalDepth++;
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => wrap.classList.add('in'));
  setTimeout(() => box.querySelector('input,textarea,select')?.focus(), 80);
  return { close, el: box };
}
export function confirmDialog(message, { ok = '확인', danger = false } = {}) {
  return new Promise(res => {
    let answered = false;
    modal({
      title: '확인', body: h('p', { style: { margin: 0, lineHeight: 1.6 } }, message),
      actions: [{ label: '취소', onClick: () => { answered = true; res(false); } }, { label: ok, primary: !danger, danger, onClick: () => { answered = true; res(true); } }],
      onClose: () => { if (!answered) res(false); },
    });
  });
}
export function promptDialog(title, { value = '', placeholder = '', ok = '확인' } = {}) {
  return new Promise(res => {
    let done = false;
    const inp = h('input', { class: 'input', value, placeholder, onkeydown: e => { if (e.key === 'Enter') { done = true; res(inp.value); m.close(); } } });
    const m = modal({ title, body: inp, actions: [{ label: '취소' }, { label: ok, primary: true, onClick: () => { done = true; res(inp.value); } }], onClose: () => { if (!done) res(null); } });
  });
}

export function ripple(e) {
  const btn = e.target.closest('.btn, .nav-item');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  const rp = h('span', { class: 'ripple', style: { width: size + 'px', height: size + 'px', left: e.clientX - r.left - size / 2 + 'px', top: e.clientY - r.top - size / 2 + 'px' } });
  btn.append(rp);
  setTimeout(() => rp.remove(), 650);
}

export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'tablist' });
  const thumb = h('i', { class: 'seg-thumb' });
  el.append(thumb);
  const btns = options.map(([v, label]) => {
    const b = h('button', { type: 'button', role: 'tab', class: v === value ? 'on' : '', onclick: () => set(v, true) }, label);
    b.dataset.v = v; el.append(b); return b;
  });
  function place() {
    const on = btns.find(b => b.classList.contains('on'));
    if (!on) return;
    thumb.style.left = on.offsetLeft + 'px'; thumb.style.width = on.offsetWidth + 'px';
  }
  function set(v, user) {
    btns.forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
    place();
    if (user) onChange?.(v);
  }
  requestAnimationFrame(place);
  new ResizeObserver(place).observe(el);
  el.set = set;
  return el;
}
export function switchEl(checked, onChange, label) {
  const inp = h('input', { type: 'checkbox', checked, 'aria-label': label || '켜기', onchange: () => onChange(inp.checked) });
  return h('label', { class: 'switch' }, inp, h('i'));
}
export function checkEl(on, onToggle, label = '완료') {
  const b = h('button', { class: 'check' + (on ? ' on' : ''), role: 'checkbox', 'aria-checked': String(!!on), 'aria-label': label, html: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
  b.addEventListener('click', e => { e.stopPropagation(); const v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); onToggle(v); });
  return b;
}

// ---------- sound & notifications ----------
let ac;
export function chime(kind = 'end') {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    const seq = kind === 'end' ? [784, 988, 1175, 988, 1175] : kind === 'alarm' ? [880, 660, 880, 660, 880, 660] : [880];
    seq.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t0 = ac.currentTime + i * 0.2;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.22, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
      o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 0.6);
    });
  } catch { /* audio unavailable */ }
}
export async function desktopNotify(title, body) {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { return false; } }
  if (Notification.permission !== 'granted') return false;
  try { new Notification(title, { body, icon: 'icons/icon-192.png', tag: title + body }); return true; } catch { return false; }
}

// ---------- files & network ----------
export async function upload(blob, name) {
  const n = name || blob.name || 'file';
  const r = await fetch('/api/upload?name=' + encodeURIComponent(n), { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
  if (!r.ok) throw new Error('파일을 저장하지 못했어요. 하루 서버가 켜져 있는지 확인하세요.');
  return r.json();
}
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise(res => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}
export function download(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename, style: { display: 'none' } });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const readAs = (blob, how) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr[how](blob); });
export const toDataURL = blob => readAs(blob, 'readAsDataURL');

// Resize to at most 1600px and re-encode, so images stay small for Claude.
async function imageBase64(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.86).split(',')[1] };
  } finally { URL.revokeObjectURL(url); }
}
export async function fileToBlock(file) {
  if (file.type.startsWith('image/')) {
    const { media_type, data } = await imageBase64(file);
    return { type: 'image', source: { type: 'base64', media_type, data } };
  }
  if (file.type === 'application/pdf') {
    const data = (await toDataURL(file)).split(',')[1];
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  const text = await file.text();
  return { type: 'text', text: `[첨부 파일: ${file.name}]\n${text}` };
}
export async function urlToBlock(url) {
  const blob = await (await fetch(url)).blob();
  return fileToBlock(new File([blob], 'image', { type: blob.type }));
}

// ---------- Claude ----------
export async function ai(req) {
  let r;
  try {
    r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
  } catch {
    throw Object.assign(new Error('하루 서버에 연결하지 못했어요. 서버(start.bat)가 실행 중인지 확인하세요.'), { code: 'offline' });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.message || 'Claude 요청에 실패했어요.'), { code: data.code });
  if (data.stop_reason === 'refusal') throw Object.assign(new Error('Claude가 이 요청에는 답하지 않았어요. 표현을 바꿔 다시 시도해 보세요.'), { code: 'refusal' });
  gainXP('ai');
  return data;
}
export const textOf = resp => resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
export function jsonOf(resp) {
  const t = textOf(resp);
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  throw new Error('Claude 응답을 읽지 못했어요. 다시 시도해 주세요.');
}
export function aiFail(e) {
  const needsKey = ['no_key', 'auth', 'permission'].includes(e.code);
  toast(e.message, { icon: 'sparkle', duration: 6000, action: needsKey ? { label: '설정', onClick: () => { location.hash = 'settings'; } } : null });
}
// JSON-schema helper: every object closed, every key required (structured outputs).
export function obj(props) {
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

// ---------- svg bar chart ----------
export function barChart(series, { height = 180, fmt = v => Math.round(v), labelEvery = 1, max } = {}) {
  const W = 640, H = height, padL = 34, padB = 26, padT = 18;
  const top = max ?? Math.max(1, ...series.map(s => s.value));
  const n = series.length, slot = (W - padL - 8) / n, bw = Math.min(28, slot * 0.6);
  const y = v => H - padB - ((H - padB - padT) * v) / top;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  [0, 0.5, 1].forEach(f => { const yy = y(top * f); svg += `<line class="grid-line" x1="${padL}" x2="${W - 4}" y1="${yy}" y2="${yy}"/><text x="${padL - 6}" y="${yy + 4}" text-anchor="end">${esc(fmt(top * f))}</text>`; });
  series.forEach((s, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const yy = y(s.value), hgt = Math.max(0, H - padB - yy);
    svg += `<rect class="${s.hl ? 'bar-fill' : 'bar-soft'}" x="${x}" y="${yy}" width="${bw}" height="${hgt}" rx="5"><title>${esc(s.label)}: ${esc(fmt(s.value))}</title></rect>`;
    if (s.value > 0 && (s.hl || n <= 10)) svg += `<text class="${s.hl ? 'hl' : ''}" x="${x + bw / 2}" y="${yy - 5}" text-anchor="middle">${esc(fmt(s.value))}</text>`;
    if (i % labelEvery === 0 || s.hl) svg += `<text class="${s.hl ? 'hl' : ''}" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(s.label)}</text>`;
  });
  return h('div', { class: 'chart', html: svg + '</svg>' });
}
