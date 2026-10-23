// alarm.js — alarm engine: synthesized alarm sounds, the per-second check, and the ringing screen
// (with optional math problems that must be solved to turn it off).
import { h, icon, store, commit, uid, dkey, addDays, pad, WEEK, desktopNotify, toast } from './core.js';

// ---------- sounds (generated with Web Audio, so they work offline) ----------
export const SOUNDS = {
  bell: { name: '클래식 벨', step: 900, notes: t => [[880, 0, 0.12, 'square'], [880, 0.18, 0.12, 'square'], [880, 0.36, 0.12, 'square']] },
  digital: { name: '디지털 삐삐', step: 700, notes: () => [[1760, 0, 0.07, 'square'], [1760, 0.12, 0.07, 'square'], [1760, 0.24, 0.07, 'square'], [1760, 0.36, 0.07, 'square']] },
  chime: { name: '차임', step: 1600, notes: () => [[523.3, 0, 0.9, 'sine'], [659.3, 0.22, 0.9, 'sine'], [784, 0.44, 0.9, 'sine'], [1046.5, 0.66, 1.1, 'sine']] },
  marimba: { name: '마림바', step: 1400, notes: () => [[784, 0, 0.35, 'triangle'], [988, 0.17, 0.35, 'triangle'], [1175, 0.34, 0.35, 'triangle'], [988, 0.51, 0.35, 'triangle'], [784, 0.68, 0.5, 'triangle']] },
  sunrise: { name: '부드럽게 커지는 소리', step: 1800, rising: true, notes: () => [[392, 0, 1.4, 'sine'], [587.3, 0.35, 1.4, 'sine'], [784, 0.7, 1.4, 'sine']] },
  siren: { name: '사이렌 (강력)', step: 1000, sweep: true, notes: () => [[700, 0, 0.9, 'sawtooth']] },
};
let ac;
const ctx = () => { ac ||= new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; };
function playOnce(key, vol = 0.25) {
  const s = SOUNDS[key] || SOUNDS.bell, a = ctx(), t0 = a.currentTime + 0.02;
  for (const [f, at, len, type] of s.notes()) {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0 + at);
    if (s.sweep) { o.frequency.linearRampToValueAtTime(f * 1.6, t0 + at + len / 2); o.frequency.linearRampToValueAtTime(f, t0 + at + len); }
    const peak = type === 'square' || type === 'sawtooth' ? vol * 0.45 : vol;
    g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(peak, t0 + at + 0.015); g.gain.exponentialRampToValueAtTime(0.0008, t0 + at + len);
    o.connect(g).connect(a.destination); o.start(t0 + at); o.stop(t0 + at + len + 0.05);
  }
}
// loop a sound until stop() is called; "rising" sounds start quiet and grow
export function playLoop(key) {
  const s = SOUNDS[key] || SOUNDS.bell;
  let n = 0;
  const once = () => { try { playOnce(key, s.rising ? Math.min(0.32, 0.05 + n * 0.03) : 0.28); } catch { /* audio blocked */ } n++; };
  once();
  const t = setInterval(once, s.step);
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
  const vib = navigator.vibrate ? setInterval(() => navigator.vibrate([400, 200, 400]), 2500) : 0;
  return () => { clearInterval(t); clearInterval(vib); try { navigator.vibrate?.(0); } catch { /* ignore */ } };
}
export function preview(key) { try { playOnce(key, 0.25); setTimeout(() => playOnce(key, 0.25), SOUNDS[key]?.step || 900); } catch { toast('소리를 재생하지 못했어요.'); } }

// ---------- schedule ----------
export const repeatText = a => a.repeat === 'daily' ? '매일' : a.repeat === 'weekly' ? (a.days?.length ? `매주 ${a.days.slice().sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map(d => WEEK[d]).join('·')}` : '매주') : a.date === dkey() ? '오늘 한 번' : a.date === addDays(dkey(), 1) ? '내일 한 번' : '한 번';
// date of the next ring at or after "now" (YYYY-MM-DD), or null
export function nextRing(a, now = new Date()) {
  if (!a.on) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [hh, mm] = a.time.split(':').map(Number); const at = hh * 60 + mm;
  for (let i = 0; i < 8; i++) {
    const k = addDays(dkey(now), i), d = new Date(now); d.setDate(d.getDate() + i);
    if (i === 0 && at < nowMin) continue;
    if (a.repeat === 'once' && k !== a.date) continue;
    if (a.repeat === 'weekly' && a.days?.length && !a.days.includes(d.getDay())) continue;
    return k;
  }
  return null;
}
export function untilText(a) {
  const k = nextRing(a); if (!k) return '';
  const [hh, mm] = a.time.split(':').map(Number);
  const target = new Date(k + 'T00:00:00'); target.setHours(hh, mm, 0, 0);
  const min = Math.max(0, Math.round((target - Date.now()) / 60000));
  return min < 60 ? `${min}분 뒤 울려요` : `${Math.floor(min / 60)}시간 ${min % 60}분 뒤 울려요`;
}
export const newAlarm = () => {
  const d = new Date(Date.now() + 60 * 60e3);
  return { id: uid(), time: `${pad(d.getHours())}:00`, label: '', on: true, repeat: 'daily', days: [1, 2, 3, 4, 5], date: dkey(), sound: 'bell', math: false, mathLevel: 'normal', mathCount: 3, snooze: 5 };
};
// once-alarms get the right date: today if the time is still ahead, otherwise tomorrow
export function fixDate(a) {
  if (a.repeat !== 'once') return;
  const [hh, mm] = a.time.split(':').map(Number), now = new Date();
  a.date = hh * 60 + mm > now.getHours() * 60 + now.getMinutes() ? dkey() : addDays(dkey(), 1);
}

let ringing = null;
let snoozes = {}; // alarm id -> timestamp when the snoozed alarm rings again
export function tickAlarms() {
  const list = store.s?.alarms; if (!list?.length || ringing) return;
  const now = new Date(), k = dkey(now), hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  for (const a of list) {
    if (snoozes[a.id] && Date.now() >= snoozes[a.id]) { delete snoozes[a.id]; ring(a, true); return; }
    if (!a.on || a.time !== hm || now.getSeconds() > 40) continue;
    if (a.repeat === 'once' && a.date !== k) continue;
    if (a.repeat === 'weekly' && a.days?.length && !a.days.includes(now.getDay())) continue;
    const key = `${k} ${hm}`;
    if (a.lastRang === key) continue;
    a.lastRang = key;
    if (a.repeat === 'once') a.on = false;
    commit('alarms');
    ring(a);
    return;
  }
}

// ---------- math problems ----------
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
function problem(level) {
  if (level === 'easy') { const a = rnd(3, 30), b = rnd(3, 30); return Math.random() < 0.5 ? [`${a} + ${b}`, a + b] : [`${Math.max(a, b)} − ${Math.min(a, b)}`, Math.abs(a - b)]; }
  if (level === 'hard') { const a = rnd(12, 49), b = rnd(12, 39), c = rnd(10, 99); return [`${a} × ${b} + ${c}`, a * b + c]; }
  const a = rnd(12, 79), b = rnd(3, 9), c = rnd(5, 60); return [`${a} × ${b} − ${c}`, a * b - c];
}

// ---------- ringing screen ----------
export function ring(a, snoozed = false) {
  if (ringing) return;
  const stop = playLoop(a.sound);
  desktopNotify(a.label || '알람', `${a.time} 알람이에요`);
  const clock = h('div', { class: 'ring-clock num' });
  const tick = () => { const d = new Date(); clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  tick(); const t = setInterval(tick, 1000);
  const area = h('div', { class: 'ring-area' });
  let solved = 0;
  const close = () => { clearInterval(t); stop(); wrap.classList.add('out'); setTimeout(() => wrap.remove(), 300); ringing = null; };
  const dismiss = () => { close(); toast(snoozed ? '알람을 껐어요.' : '좋은 하루 보내세요!', { icon: 'check' }); };
  const snooze = () => { snoozes[a.id] = Date.now() + (a.snooze || 5) * 60e3; close(); toast(`${a.snooze || 5}분 뒤에 다시 울려요.`, { icon: 'bell' }); };
  function paintArea() {
    if (!a.math) {
      area.replaceChildren(h('button', { class: 'btn btn-ink btn-lg ring-off', onclick: dismiss }, '알람 끄기'));
      return;
    }
    const [q, ans] = problem(a.mathLevel);
    const inp = h('input', { class: 'input ring-answer', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '정답', 'aria-label': '정답 입력' });
    const msg = h('div', { class: 'small', style: { minHeight: '20px' } });
    const check = () => {
      if (inp.value.trim() === '') return;
      if (Number(inp.value.replace(/[^\d-]/g, '')) === ans) {
        solved++;
        if (solved >= (a.mathCount || 3)) dismiss(); else paintArea();
      } else { msg.textContent = '틀렸어요. 다시 풀어 보세요.'; inp.value = ''; area.classList.remove('shake'); void area.offsetWidth; area.classList.add('shake'); inp.focus(); }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
    area.replaceChildren(
      h('div', { class: 'small muted' }, `알람을 끄려면 문제를 풀어 주세요 · ${solved + 1} / ${a.mathCount || 3}`),
      h('div', { class: 'ring-q num' }, q, ' = ?'),
      h('div', { class: 'row', style: { gap: '8px', justifyContent: 'center' } }, inp, h('button', { class: 'btn btn-ink btn-lg', onclick: check }, '확인')),
      msg);
    setTimeout(() => inp.focus(), 50);
  }
  paintArea();
  const wrap = h('div', { class: 'ring-screen', role: 'alertdialog', 'aria-label': '알람' },
    h('div', { class: 'ring-card glass' },
      h('div', { class: 'ring-bell' }, icon('bell', 40, 1.6)),
      clock,
      h('div', { class: 'ring-label' }, a.label || '알람', snoozed ? h('span', { class: 'small muted' }, ' · 다시 알림') : null),
      area,
      h('button', { class: 'btn btn-ghost', onclick: snooze }, icon('reset', 16), `${a.snooze || 5}분 뒤 다시 알림`)));
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  ringing = { a, close };
}
export const isRinging = () => !!ringing;
