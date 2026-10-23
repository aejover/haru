// main.js — app shell: router, top bar, menu drawer, profile popover, theme, background engines.
import {
  $, h, icon, iconHTML, store, bus, commit, dkey, fmtDay, fmtDur, fmtClock, toast, modal, ripple, desktopNotify, chime,
  levelInfo, tierInfo, tierEmblem, record, evaluateTier, tasksOn, isDone, apiUrl, REMOTE, API_BASE,
} from './core.js';
import pomodoro, { tickPomo, resumePomo, remaining, durOf, MODES, focusToday, toggle as pomoToggle } from './pomodoro.js';
import youtube, { initYouTubeHost, ytState, togglePlay } from './youtube.js';
import { initAssistant } from './assistant.js';
import { announcePhone } from './phone.js';
import home from './views/home.js';
import memo from './views/memo.js';
import calendar from './views/calendar.js';
import timetable from './views/timetable.js';
import checklist from './views/checklist.js';
import diary from './views/diary.js';
import diet from './views/diet.js';
import growth from './views/growth.js';
import profile from './views/profile.js';
import settings from './views/settings.js';
import docs from './views/docs.js';

const VIEWS = { home, memo, calendar, timetable, pomodoro, youtube, docs, checklist, diary, diet, growth, profile, settings };
const NAV = [
  ['home', '홈'], ['memo', '메모장'], ['calendar', '캘린더'], ['timetable', '시간표'], ['pomodoro', '뽀모도로'], ['youtube', '유튜브 · 라디오'],
  ['docs', '문서 작업'], ['checklist', '오늘 할 일'], ['diary', '일기'], ['diet', '식단'], ['growth', '커리큘럼'],
  '-', ['profile', '프로필'], ['settings', '설정'],
];
export const viewTitle = id => VIEWS[id]?.title || '';
export const currentView = () => current?.id || 'home';

// ---------- theme ----------
export function applyTheme(mode = store.s.settings.theme, animate = false, origin) {
  const set = () => {
    if (mode === 'light' || mode === 'dark') document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('haru.theme', JSON.stringify(mode)); } catch { /* ignore */ }
    bus.emit('theme');
  };
  if (!animate || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return set();
  const x = origin?.x ?? innerWidth / 2, y = origin?.y ?? innerHeight / 2;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.documentElement.classList.add('theme-vt');
  const t = document.startViewTransition(set);
  t.finished.finally(() => document.documentElement.classList.remove('theme-vt'));
  t.ready.then(() => document.documentElement.animate({ clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] }, { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' }));
}
export const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
export function toggleTheme(e) {
  const next = isDark() ? 'light' : 'dark';
  store.s.settings.theme = next; commit('settings');
  applyTheme(next, true, e ? { x: e.clientX, y: e.clientY } : null);
}

// ---------- router ----------
let current = null, ctx = null;
function makeCtx() {
  const offs = [];
  return {
    on(ev, fn) { offs.push(bus.on(ev, fn)); },
    cleanup(fn) { offs.push(fn); },
    every(ms, fn) { const t = setInterval(fn, ms); offs.push(() => clearInterval(t)); },
    dispose() { offs.splice(0).forEach(f => { try { f(); } catch (e) { console.error(e); } }); },
  };
}
export const go = (id, arg) => { location.hash = arg ? `${id}/${encodeURIComponent(arg)}` : id; };
// Tab changes cross-fade through the View Transitions API where the browser has it.
let routeSeq = 0;
function route(animate = true) {
  const html = document.documentElement;
  const seq = ++routeSeq;
  let done = false;
  const run = () => { if (done || seq !== routeSeq) return; done = true; renderRoute(); };
  if (!animate || !current || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return run();
  html.classList.add('vt-running');
  try {
    const t = document.startViewTransition(run);
    t.finished.finally(() => html.classList.remove('vt-running'));
  } catch { run(); }
  // a window that isn't drawing frames never starts the animation; switch anyway
  setTimeout(() => { if (!done) { run(); html.classList.remove('vt-running'); } }, 450);
}
function renderRoute() {
  const [id, ...rest] = location.hash.slice(1).split('/');
  const v = VIEWS[id] || home;
  const arg = rest.length ? decodeURIComponent(rest.join('/')) : undefined;
  ctx?.dispose();
  const host = $('#view');
  const page = h('div', { class: `page page-${v.id}` });
  host.replaceChildren(page);
  host.scrollTop = 0;
  ctx = makeCtx();
  current = v;
  try { v.render(page, ctx, arg); }
  catch (e) { console.error(e); page.append(h('div', { class: 'glass card' }, h('h2', { class: 'h2' }, '화면을 그리지 못했어요'), h('p', { class: 'muted' }, String(e.message || e)))); }
  $('#view-title').textContent = v.id === 'home' ? '' : v.title;
  document.title = v.id === 'home' ? '하루' : `${v.title} · 하루`;
  paintDrawer();
  closeDrawer(); closePopover();
  bus.emit('route', v.id);
}

// ---------- drawer ----------
const drawer = () => $('#drawer');
function paintDrawer() {
  const k = dkey();
  const left = tasksOn(k).filter(t => !isDone(t, k)).length;
  const hints = { checklist: left ? `${left}개 남음` : '', pomodoro: store.s.pomo.running ? fmtClock(remaining()) : '' };
  const ico = { home: 'home', memo: 'memo', calendar: 'calendar', timetable: 'table', pomodoro: 'timer', youtube: 'youtube', docs: 'doc', checklist: 'checklist', diary: 'diary', diet: 'diet', growth: 'chart', profile: 'user', settings: 'sliders' };
  const items = NAV.map((n, i) => n === '-' ? h('div', { class: 'nav-sep' }) :
    h('button', { class: 'nav-item' + (current?.id === n[0] ? ' on' : ''), style: { transitionDelay: `${i * 22}ms` }, onclick: () => go(n[0]) },
      icon(ico[n[0]], 20), h('span', null, n[1]), hints[n[0]] ? h('span', { class: 'hint num' }, hints[n[0]]) : null));
  drawer().replaceChildren(
    h('div', { class: 'drawer-head' }, h('span', { class: 'brand' }, '하루'), h('span', { class: 'date' }, fmtDay(k))),
    ...items,
    h('div', { class: 'drawer-foot' },
      h('button', { class: 'btn btn-ghost btn-sm', onclick: e => toggleTheme(e) }, icon(isDark() ? 'sun' : 'moon', 16), isDark() ? '화이트 모드' : '블랙 모드'),
      h('span', { class: 'spacer' }),
      h('span', { class: 'tiny muted', title: store.serverOk ? '서버에 저장됨' : '서버 연결 안 됨 · 이 브라우저에만 저장 중' }, store.serverOk ? '저장됨' : '오프라인')));
}
function openDrawer() {
  paintDrawer();
  const d = drawer(), sc = $('#scrim');
  sc.hidden = false; requestAnimationFrame(() => { sc.classList.add('in'); d.classList.add('in'); });
  d.setAttribute('aria-hidden', 'false'); $('#menu-btn').setAttribute('aria-expanded', 'true');
  setTimeout(() => d.querySelector('.nav-item.on, .nav-item')?.focus(), 200);
}
function closeDrawer() {
  const d = drawer(), sc = $('#scrim');
  if (!d.classList.contains('in')) return;
  d.classList.remove('in'); sc.classList.remove('in');
  d.setAttribute('aria-hidden', 'true'); $('#menu-btn').setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!d.classList.contains('in')) sc.hidden = true; }, 350);
}

// ---------- top bar ----------
function paintAvatar() {
  const p = store.s.profile;
  const b = $('#avatar-btn');
  b.replaceChildren(p.photo ? h('img', { src: p.photo, alt: '' }) : h('span', { class: 'avatar-fallback' }, (p.name || '나').slice(0, 1)));
}
function paintTopbar() {
  $('#focus-chip').innerHTML = `${iconHTML('flame', 16)}<span><span class="lbl">집중 </span>${fmtDur(focusToday(), true)}</span>`;
  const p = store.s.pomo, chip = $('#pomo-chip');
  const active = p.running || remaining() < durOf(p.mode) - 1;
  chip.hidden = !active;
  if (active) {
    chip.classList.toggle('running', p.running);
    chip.innerHTML = `${iconHTML(p.running ? 'timer' : 'pause', 16)}<span>${MODES[p.mode]} ${fmtClock(remaining())}</span>`;
  }
  const y = ytState(), pill = $('#radio-pill');
  const show = y.loaded && (y.radio || current?.id !== 'youtube') && (y.playing || y.radio);
  pill.hidden = !show;
  if (show) {
    pill.replaceChildren(
      h('button', { class: 'row', style: { gap: '6px', minWidth: 0 }, onclick: () => go('youtube'), title: y.title },
        h('span', { class: 'eq' + (y.playing ? '' : ' paused'), style: { height: '12px' } }, h('i'), h('i'), h('i')), h('span', { class: 'ell' }, y.radio ? (y.title || '라디오') : (y.title || '재생 중'))),
      h('button', { class: 'btn-icon sm', 'aria-label': '재생/일시정지', onclick: togglePlay }, icon(y.playing ? 'pause' : 'play', 14)));
  }
}

// ---------- profile popover ----------
let pop = null;
function closePopover() { pop?.remove(); pop = null; $('#avatar-btn').setAttribute('aria-expanded', 'false'); }
function openPopover() {
  if (pop) return closePopover();
  const p = store.s.profile, lv = levelInfo(store.s.xp.total), tr = tierInfo(store.s.tier.lp), rc = record();
  const last = store.s.tier.history.slice(-12);
  const age = p.birthYear ? new Date().getFullYear() - Number(p.birthYear) + 1 : null;
  pop = h('div', { class: 'popover glass prof-pop', role: 'dialog', 'aria-label': '프로필' },
    h('div', { class: 'prof-top' },
      h('div', { class: 'prof-photo' }, p.photo ? h('img', { src: p.photo, alt: '' }) : (p.name || '나').slice(0, 1)),
      h('div', { class: 'grow' }, h('div', { class: 'prof-name' }, p.name || '이름을 정해 주세요'), h('div', { class: 'prof-goal' }, p.goal || '목표를 적어 보세요'), age ? h('div', { class: 'tiny muted' }, `${p.birthYear}년생 · ${age}세`) : null)),
    h('div', { class: 'prof-stats' },
      h('div', { class: 'stat-box' }, h('span', { class: 'k' }, '레벨'), h('span', { class: 'v num' }, `Lv.${lv.level}`), h('div', { class: 'bar thin' }, h('i', { style: { width: lv.pct + '%' } })), h('span', { class: 'tiny muted num' }, `${lv.cur} / ${lv.need} XP`)),
      h('div', { class: 'stat-box' }, h('span', { class: 'k' }, '티어'), h('div', { class: 'row', style: { gap: '8px' } }, h('span', { class: 'tier-badge', html: tierEmblem(tr.idx, 30) }), h('span', { class: 'v', style: { fontSize: '16px' } }, tr.label)), h('div', { class: 'bar thin' }, h('i', { style: { width: tr.pct + '%' } })), h('span', { class: 'tiny muted num' }, tr.to ? `${tr.lp} LP · ${tr.next}까지 ${tr.to - tr.lp}` : `${tr.lp} LP`)),
      h('div', { class: 'stat-box span2' }, h('div', { class: 'row between' }, h('span', { class: 'k' }, '전적 · 어제의 나와 대결'), h('span', { class: 'tiny muted num' }, rc.games ? `승률 ${rc.rate}%` : '')),
        h('span', { class: 'v num', style: { fontSize: '17px' } }, rc.games ? `${rc.w}승 ${rc.l}패 ${rc.d}무` : '첫 대결은 내일 시작돼요'),
        last.length ? h('div', { class: 'record-dots' }, last.map(x => h('i', { class: x.result, title: `${x.date} ${x.result === 'W' ? '승' : x.result === 'L' ? '패' : '무'} (${x.delta >= 0 ? '+' : ''}${x.delta} LP)` }, x.result === 'W' ? '승' : x.result === 'L' ? '패' : '무'))) : null,
        rc.streak > 1 && rc.streakType === 'W' ? h('span', { class: 'tiny', style: { fontWeight: 700 } }, `${rc.streak}연승 중`) : null)),
    p.roleModel?.name ? h('div', { class: 'small', style: { marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center' } }, icon('target', 16), h('span', null, '동갑 롤모델 ', h('b', null, p.roleModel.name), p.roleModel.note ? ` · ${p.roleModel.note}` : '')) : null,
    h('div', { class: 'row', style: { marginTop: '14px' } },
      h('button', { class: 'btn btn-ink btn-sm grow', onclick: () => go('profile') }, '프로필 편집'),
      h('button', { class: 'btn btn-ghost btn-sm grow', onclick: () => go('growth') }, '성장 기록 보기')));
  $('#popover-root').append(pop);
  $('#avatar-btn').setAttribute('aria-expanded', 'true');
}

// ---------- daily / weekly results ----------
function announceResults(events) {
  const day = events.filter(e => e.type === 'day').pop();
  const week = events.find(e => e.type === 'week');
  if (day) {
    const word = day.result === 'W' ? '승리' : day.result === 'L' ? '패배' : '무승부';
    toast(`어제의 나 vs 그저께의 나: ${word} (${day.delta >= 0 ? '+' : ''}${day.delta} LP)`, { icon: 'trophy', duration: 5000 });
  }
  const t = store.s.tier;
  if (week && t.weekSeen !== t.lastWeek) {
    t.weekSeen = t.lastWeek; commit('tier');
    const w = t.weeks[t.weeks.length - 1];
    const dPct = w.pct - w.pPct;
    modal({
      title: '이번 주 리포트',
      body: h('div', { class: 'col' },
        h('p', { style: { margin: 0, lineHeight: 1.7 } }, `지난주 할 일 완료율은 ${Math.round(w.pct)}%였어요. 그 전 주(${Math.round(w.pPct)}%)보다 ${dPct >= 0 ? Math.round(dPct) + '%p 높아요' : Math.round(-dPct) + '%p 낮아요'}.`),
        h('p', { style: { margin: 0, lineHeight: 1.7 } }, `집중 시간 ${fmtDur(w.focus)} · 그 전 주 ${fmtDur(w.pFocus)}`),
        h('div', { class: 'verdict glass' }, icon(w.better ? 'arrowUp' : w.worse ? 'arrowDown' : 'minus', 28), h('div', null, h('div', { class: 'big' }, w.better ? '저번 주의 나를 이겼어요!' : w.worse ? '저번 주보다 조금 쉬어 갔어요' : '저번 주와 비슷했어요'), h('div', { class: 'small muted' }, `티어 ${w.delta >= 0 ? '+' : ''}${w.delta} LP`)))),
      actions: [{ label: '자세히 보기', onClick: () => go('growth') }, { label: '좋아요', primary: true }],
    });
  }
}

// ---------- notifications from the server ----------
function connectEvents() {
  if (!window.EventSource) return;
  const es = new EventSource(apiUrl('/api/events'));
  es.addEventListener('state', e => {
    const d = JSON.parse(e.data);
    if (d.from !== store.clientId && d.rev !== store.rev) store.pullRemote();
  });
  es.addEventListener('notify', e => {
    const d = JSON.parse(e.data);
    if (d.kind === 'test') return toast(d.message, { title: d.title, icon: 'bell' });
    if (d.kind === 'nag') chime('alarm');
    toast(d.message, { title: d.title, icon: 'bell', duration: 9000, action: d.kind === 'nag' ? { label: '열기', onClick: () => go('checklist') } : null });
    desktopNotify(d.title, d.message);
  });
}

// ---------- phone app: offline screen & install ----------
const onThisComputer = () => !REMOTE && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
// GitHub Pages: ask once for the computer's address (the QR in the computer's 설정 fills it in automatically)
function connectScreen() {
  const inp = h('input', { class: 'input', type: 'url', placeholder: 'https://내컴퓨터.tailxxxx.ts.net', value: API_BASE, 'aria-label': '컴퓨터 주소' });
  const go = () => {
    let v = inp.value.trim().replace(/\/+$/, '');
    if (!v) { inp.focus(); return; }
    if (!/^https?:\/\//.test(v)) v = 'https://' + v;
    try { localStorage.setItem('haru.server', v); } catch { /* ignore */ }
    location.replace(location.pathname);
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  document.body.append(h('div', { class: 'offline-wrap' }, h('div', { class: 'offline glass' },
    h('img', { src: 'icons/icon-192.png', alt: '', width: 72, height: 72, style: { borderRadius: '18px' } }),
    h('h1', { class: 'h2' }, '내 컴퓨터의 하루에 연결하기'),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.7 } }, '기록은 내 컴퓨터에 저장돼요. 컴퓨터의 하루 → 설정 → 휴대폰에서 열기에 있는 GitHub 주소 QR을 찍으면 자동으로 연결돼요. 직접 넣으려면 Tailscale 주소를 입력하세요.'),
    inp,
    h('button', { class: 'btn btn-ink btn-lg', onclick: go }, '연결'))));
}
function offlineScreen() {
  const box = h('div', { class: 'offline glass' },
    h('img', { src: 'icons/icon-192.png', alt: '', width: 72, height: 72, style: { borderRadius: '18px' } }),
    h('h1', { class: 'h2' }, '컴퓨터의 하루에 연결할 수 없어요'),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.7 } }, '하루의 기록은 컴퓨터에 저장돼 있어서, 휴대폰은 컴퓨터에 연결돼야 열 수 있어요.'),
    h('ol', { class: 'small', style: { margin: 0, paddingLeft: '1.2em', lineHeight: 1.9, textAlign: 'left' } },
      h('li', null, '컴퓨터가 켜져 있고 잠자기 상태가 아닌지'),
      h('li', null, '컴퓨터에서 start.bat(검은 창)이 실행 중인지'),
      h('li', null, '휴대폰의 Tailscale 앱이 연결(Connected) 상태인지')),
    h('button', { class: 'btn btn-ink btn-lg', onclick: () => location.reload() }, icon('refresh', 18), '다시 연결'),
    REMOTE ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { try { localStorage.removeItem('haru.server'); } catch { /* ignore */ } location.replace(location.pathname); } }, '컴퓨터 주소 바꾸기') : null);
  document.body.append(h('div', { class: 'offline-wrap' }, box));
  // Chrome asks before a public site (github.io) may reach a device on the private network (Tailscale)
  if (REMOTE && navigator.permissions) {
    navigator.permissions.query({ name: 'local-network-access' }).then(p => {
      if (p.state !== 'denied') return;
      box.querySelector('ol').before(h('div', { class: 'guide', style: { textAlign: 'left' } },
        h('b', null, '브라우저가 내 컴퓨터 연결을 막고 있어요'), h('br'),
        '주소창 왼쪽 아이콘(사이트 정보) → 사이트 설정 → "로컬 네트워크 액세스"를 허용으로 바꾼 뒤 다시 연결을 누르세요.'));
    }).catch(() => { /* browser without this permission: nothing to explain */ });
  }
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; bus.emit('installable'); });
window.addEventListener('appinstalled', () => { installEvt = null; toast('하루를 앱으로 설치했어요. 홈 화면에서 열 수 있어요.', { icon: 'check' }); bus.emit('installable'); });
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const canInstall = () => !!installEvt;
export async function promptInstall() {
  if (!installEvt) return false;
  installEvt.prompt();
  const { outcome } = await installEvt.userChoice;
  installEvt = null; bus.emit('installable');
  return outcome === 'accepted';
}
const isPhone = () => matchMedia('(pointer: coarse)').matches && innerWidth < 900;
function suggestInstall() {
  if (isStandalone() || !isPhone()) return;
  try { if (localStorage.getItem('haru.installTip')) return; localStorage.setItem('haru.installTip', '1'); } catch { return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  toast(ios ? 'Safari 아래쪽 공유 버튼 → "홈 화면에 추가"를 누르면 앱처럼 쓸 수 있어요.' : '홈 화면에 설치하면 앱처럼 쓸 수 있어요.', {
    title: '하루를 앱으로 설치하기', icon: 'download', duration: 10000,
    action: !ios && installEvt ? { label: '설치', onClick: () => promptInstall() } : { label: '방법 보기', onClick: () => go('settings') },
  });
}

// ---------- boot ----------
async function boot() {
  if (REMOTE && !API_BASE) { applyTheme('system'); connectScreen(); return; }
  if (location.hostname.endsWith('github.io') && new URLSearchParams(location.search).has('server')) history.replaceState(null, '', location.pathname + location.hash);
  await store.load();
  if (!store.fromServer && !onThisComputer()) { applyTheme(); offlineScreen(); return; }
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => bus.emit('theme'));
  document.addEventListener('pointerdown', ripple);
  $('#menu-btn').addEventListener('click', openDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  $('#avatar-btn').addEventListener('click', e => { e.stopPropagation(); openPopover(); });
  $('#pomo-chip').addEventListener('click', () => go('pomodoro'));
  document.addEventListener('click', e => { if (pop && !pop.contains(e.target)) closePopover(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDrawer(); closePopover(); }
    if (e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); pomoToggle(); }
  });
  window.addEventListener('hashchange', route);
  bus.on('change', w => { if (w === 'profile') paintAvatar(); });
  // another device saved: redraw with its data, keeping the scroll position
  bus.on('remote', ({ minor } = {}) => {
    if (minor) { paintTopbar(); bus.emit('change', 'pomo'); return; }
    const v = $('#view'), y = v.scrollTop;
    applyTheme(); paintAvatar(); paintTopbar(); route(false);
    requestAnimationFrame(() => { v.scrollTop = y; });
  });
  bus.on('theme', () => { if (drawer().classList.contains('in')) paintDrawer(); });
  bus.on('saved', () => { if (drawer().classList.contains('in')) paintDrawer(); });

  resumePomo();
  initYouTubeHost();
  initAssistant({ go, currentView: () => current?.id || 'home', viewTitle });
  paintAvatar(); paintTopbar();
  route();

  setInterval(() => { tickPomo(); paintTopbar(); }, 1000);
  bus.on('yt', paintTopbar);
  bus.on('change', paintTopbar);

  let lastDay = dkey();
  const daily = () => {
    const evs = evaluateTier();
    if (evs.length) announceResults(evs);
    if (dkey() !== lastDay) { lastDay = dkey(); bus.emit('newday'); if (current?.id === 'home') route(false); }
  };
  setTimeout(daily, 1200);
  setInterval(daily, 60000);

  connectEvents();
  setTimeout(announcePhone, 2500);
  setTimeout(suggestInstall, 3500);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!store.serverOk) toast('하루 서버에 연결하지 못했어요. 지금은 이 브라우저에만 저장돼요.', { icon: 'lock', duration: 7000 });
}
boot();
