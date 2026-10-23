// pomodoro.js — global timer engine (keeps running on every tab) and the 뽀모도로 view.
import { h, icon, store, commit, bus, dkey, addDays, fmtClock, fmtDur, fmtShort, gainXP, chime, desktopNotify, toast, seg, switchEl, barChart } from './core.js';

export const MODES = { focus: '집중', short: '짧은 휴식', long: '긴 휴식' };
const cfg = () => store.s.pomoCfg;
const P = () => store.s.pomo;
export const durOf = m => (Number(cfg()[m]) || 25) * 60;

export function remaining() {
  const p = P();
  return p.running ? Math.max(0, (p.endAt - Date.now()) / 1000) : p.remain;
}
// The device that pressed start keeps the time; other open devices only show it.
const mine = () => !P().owner || P().owner === store.clientId;
// Add focused seconds since the last tick to today's total.
function credit() {
  const p = P();
  if (!mine()) return;
  if (!p.running || p.mode !== 'focus') { p.lastTick = Date.now(); return; }
  const now = Math.min(Date.now(), p.endAt);
  const dt = Math.max(0, (now - (p.lastTick || now)) / 1000);
  if (dt > 0) { const k = dkey(); store.s.focus[k] = (store.s.focus[k] || 0) + dt; }
  p.lastTick = now;
}
export function start() {
  const p = P(); if (p.running) return;
  if (p.remain <= 0) p.remain = durOf(p.mode);
  p.running = true; p.endAt = Date.now() + p.remain * 1000; p.lastTick = Date.now(); p.owner = store.clientId;
  chime('tick');
  commit('pomo');
}
export function pause() {
  const p = P(); if (!p.running) return;
  credit(); p.remain = remaining(); p.running = false;
  commit('pomo');
}
export const toggle = () => (P().running ? pause() : start());
export function reset() { const p = P(); credit(); p.running = false; p.remain = durOf(p.mode); commit('pomo'); }
export function setMode(m) { const p = P(); credit(); p.mode = m; p.running = false; p.remain = durOf(m); commit('pomo'); }
export const skip = () => complete(true);

function complete(skipped) {
  const p = P();
  credit();
  const was = p.mode;
  if (was === 'focus' && !skipped) { p.cycle++; p.sessions ||= {}; const k = dkey(); p.sessions[k] = (p.sessions[k] || 0) + 1; gainXP('pomodoro'); }
  const next = was === 'focus' ? (p.cycle > 0 && p.cycle % (Number(cfg().every) || 4) === 0 ? 'long' : 'short') : 'focus';
  p.mode = next; p.remain = durOf(next);
  p.running = !skipped && !!cfg().auto;
  if (p.running) { p.endAt = Date.now() + p.remain * 1000; p.lastTick = Date.now(); }
  if (!skipped) {
    if (cfg().sound) { chime('end'); setTimeout(() => chime('end'), 1300); }
    const title = was === 'focus' ? '집중 시간 끝!' : '휴식 끝!';
    const body = was === 'focus' ? `${MODES[next]} ${cfg()[next]}분을 시작해요.` : '다시 집중할 시간이에요.';
    desktopNotify(title, body);
    toast(body, { title, icon: 'timer', duration: 6000 });
  }
  commit('pomo');
}

let lastSave = 0;
export function tickPomo() {
  const p = P();
  if (!p.running) return;
  if (!mine()) {
    // the starting window went quiet (it saves every 10s while running): take over
    if (Date.now() - (p.lastTick || 0) > 30000 || Date.now() >= p.endAt + 5000) { p.owner = store.clientId; p.lastTick = Math.min(Date.now(), p.endAt); }
    else { bus.emit('pomo-tick'); return; }
  }
  credit();
  if (Date.now() >= p.endAt) { complete(false); return; }
  if (Date.now() - lastSave > 10000) { lastSave = Date.now(); store.save(); }
  bus.emit('pomo-tick');
}
// On startup: finish a session that ran out while the app was closed.
export function resumePomo() {
  const p = P();
  if (p.running && Date.now() >= p.endAt) { p.owner = store.clientId; complete(false); }
}
export const focusToday = () => store.s.focus[dkey()] || 0;

// ---------- view ----------
function stepper(value, min, max, step, onChange, unit = '분') {
  const b = h('b', null, `${value}${unit}`);
  const set = v => { value = Math.min(max, Math.max(min, v)); b.textContent = `${value}${unit}`; onChange(value); };
  return h('div', { class: 'stepper' },
    h('button', { class: 'btn-icon', 'aria-label': '줄이기', onclick: () => set(value - step) }, icon('minus', 16)),
    b,
    h('button', { class: 'btn-icon', 'aria-label': '늘리기', onclick: () => set(value + step) }, icon('plus', 16)));
}

export default {
  id: 'pomodoro', title: '뽀모도로', icon: 'timer',
  render(el, ctx) {
    el.classList.add('stagger');
    const R = 146, C = 2 * Math.PI * R, W = 24;
    const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const ring = h('div', { class: 'ring' });
    ring.innerHTML = `<svg viewBox="0 0 340 340"><circle class="track" cx="170" cy="170" r="${R}" fill="none" stroke-width="${W}"/></svg>`;
    Object.entries({ class: 'fill', cx: 170, cy: 170, r: R, fill: 'none', 'stroke-width': W, 'stroke-dasharray': C }).forEach(([k, v]) => fill.setAttribute(k, v));
    ring.firstChild.append(fill);
    const timeEl = h('div', { class: 'ring-time' });
    const modeEl = h('div', { class: 'ring-mode' });
    const dots = h('div', { class: 'cycle-dots' });
    ring.append(h('div', { class: 'ring-center' }, modeEl, timeEl, dots));

    const modeSeg = seg(Object.entries(MODES), P().mode, m => setMode(m));
    const playBtn = h('button', { class: 'btn btn-ink play', 'aria-label': '시작/일시정지', onclick: toggle });
    const main = h('section', { class: 'glass card pomo-main' },
      modeSeg, ring,
      h('div', { class: 'pomo-ctrl' },
        h('button', { class: 'btn-icon glass-btn', 'aria-label': '처음부터', title: '처음부터', onclick: reset }, icon('reset')),
        playBtn,
        h('button', { class: 'btn-icon glass-btn', 'aria-label': '건너뛰기', title: '다음 단계로', onclick: skip }, icon('skip'))),
      h('p', { class: 'small muted', style: { margin: 0, textAlign: 'center' } }, '다른 탭으로 이동해도 타이머는 계속 돌아가요. 남은 시간은 오른쪽 위에 보여요.'));

    const todayFocus = h('div', { class: 'kpi' });
    const sessions = h('div', { class: 'kpi' });
    const c = cfg();
    const settings = h('section', { class: 'glass card col' },
      h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '오늘'), h('span', { class: 'chip sm line' }, fmtShort(dkey()))),
      h('div', { class: 'grid-2' }, todayFocus, sessions),
      h('div', { class: 'nav-sep', style: { margin: '6px 0' } }),
      h('h3', { class: 'h3' }, '시간 설정'),
      h('div', null,
        row('집중 시간', null, stepper(c.focus, 5, 120, 5, v => { c.focus = v; if (!P().running && P().mode === 'focus') P().remain = v * 60; commit('pomo'); })),
        row('짧은 휴식', null, stepper(c.short, 1, 30, 1, v => { c.short = v; if (!P().running && P().mode === 'short') P().remain = v * 60; commit('pomo'); })),
        row('긴 휴식', null, stepper(c.long, 5, 60, 5, v => { c.long = v; if (!P().running && P().mode === 'long') P().remain = v * 60; commit('pomo'); })),
        row('긴 휴식 간격', '집중 몇 번마다 긴 휴식을 할지', stepper(c.every, 2, 8, 1, v => { c.every = v; commit('pomo'); }, '회')),
        row('자동으로 다음 단계 시작', null, switchEl(c.auto, v => { c.auto = v; commit('pomo'); })),
        row('종료 알람 소리', null, switchEl(c.sound, v => { c.sound = v; commit('pomo'); if (v) chime('end'); }))));

    const chartBox = h('div');
    const weekCard = h('section', { class: 'glass card col' }, h('h2', { class: 'h2' }, '최근 7일 집중 시간'), chartBox);

    el.append(h('div', { class: 'pomo-wrap' }, main, h('div', { class: 'col', style: { gap: '16px' } }, settings, weekCard)));

    function row(label, sub, ctrl) { return h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, label, sub ? h('span', { class: 'sub' }, sub) : null), ctrl); }

    function paint() {
      const p = P(); const rem = remaining(); const total = durOf(p.mode);
      fill.setAttribute('stroke-dashoffset', String(C * (1 - rem / total)));
      timeEl.textContent = fmtClock(rem);
      modeEl.textContent = MODES[p.mode];
      playBtn.replaceChildren(icon(p.running ? 'pause' : 'play', 28));
      const every = Number(cfg().every) || 4, inCycle = p.cycle % every;
      dots.replaceChildren(...Array.from({ length: every }, (_, i) => h('i', { class: i < inCycle ? 'on' : '' })));
      todayFocus.replaceChildren(h('b', null, fmtDur(focusToday())), h('span', null, '오늘 집중한 시간'));
      sessions.replaceChildren(h('b', null, `${p.sessions?.[dkey()] || 0}회`), h('span', null, '완료한 집중 세션'));
    }
    function paintChart() {
      const today = dkey();
      const series = Array.from({ length: 7 }, (_, i) => { const k = addDays(today, i - 6); return { label: fmtShort(k).replace(/\(.\)/, ''), value: (store.s.focus[k] || 0) / 60, hl: k === today }; });
      chartBox.replaceChildren(barChart(series, { fmt: v => `${Math.round(v)}분` }));
    }
    paint(); paintChart();
    ctx.on('pomo-tick', paint);
    ctx.on('change', w => { if (w === 'pomo') { paint(); modeSeg.set(P().mode); paintChart(); } });
  },
};
