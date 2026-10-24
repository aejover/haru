// sleep.js — 수면 · 에너지: 개인 적정 수면 시간, 수면 부채, 오늘의 에너지 그래프(2-프로세스 모델 추정), 수면 기록.
import { h, icon, store, commit, dkey, addDays, fmtShort, pad, toast, gainXP, barChart, esc } from '../core.js';

const hm = t => { const [a, b] = String(t || '0:0').split(':').map(Number); return a + (b || 0) / 60; };
const fmtH = x => { const m = Math.round(Math.abs(x) * 60); return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`; };
const clock = x => { const m = ((Math.round(x * 60) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const S = () => { const s = store.s; s.sleep ||= { logs: {}, wakeGoal: '07:00' }; s.sleep.logs ||= {}; return s.sleep; };
export const durationOf = l => { let d = hm(l.wake) - hm(l.bed); if (d <= 0) d += 24; return d; };

function age() {
  const by = Number(store.s.profile?.birthYear);
  if (by > 1900) return new Date().getFullYear() - by;
  const a = Number(store.s.diet?.body?.age);
  return a > 0 ? a : null;
}
// National Sleep Foundation ranges by age
function ageRange(a) {
  if (a == null) return { lo: 7, hi: 9, base: 8, label: '성인 기준' };
  if (a < 14) return { lo: 9, hi: 11, base: 10, label: `${a}세 (6–13세)` };
  if (a < 18) return { lo: 8, hi: 10, base: 9, label: `${a}세 (14–17세)` };
  if (a < 26) return { lo: 7, hi: 9, base: 8.25, label: `${a}세 (18–25세)` };
  if (a < 65) return { lo: 7, hi: 9, base: 7.75, label: `${a}세 (26–64세)` };
  return { lo: 7, hi: 8, base: 7.5, label: `${a}세 (65세 이상)` };
}
// personal need: age baseline nudged toward how long you slept on nights you felt rested
export function sleepNeed() {
  const r = ageRange(age());
  const rested = Object.entries(S().logs).filter(([k, l]) => k >= addDays(dkey(), -45) && (l.quality || 0) >= 4).map(([, l]) => durationOf(l));
  let need = r.base, basis = '연령 권장';
  if (rested.length >= 4) {
    const avg = rested.reduce((a, b) => a + b, 0) / rested.length;
    need = Math.max(r.lo - 0.5, Math.min(r.hi + 0.5, r.base * 0.4 + avg * 0.6));
    basis = `연령 권장 + 개운했던 ${rested.length}일 기록`;
  }
  return { need, ...r, basis, rested: rested.length };
}
// weighted shortfall over the last 14 nights (recent nights count more; oversleeping repays half)
export function sleepDebt(need = sleepNeed().need) {
  let debt = 0, nights = 0;
  for (let i = 0; i < 14; i++) {
    const l = S().logs[addDays(dkey(), -i)]; if (!l) continue;
    const gap = need - durationOf(l);
    debt += Math.pow(0.92, i) * (gap > 0 ? gap : gap * 0.5);
    nights++;
  }
  return { debt: Math.max(0, debt), nights };
}

// Two-process model (Borbély): sleep pressure S builds while awake (τ≈18.2h) and clears in sleep (τ≈4.2h);
// circadian C peaks late afternoon with a small 12-hour dip after lunch. Energy ≈ C − S, minus inertia and debt.
function energyCurve(wake, dur, debt) {
  const Swake = 0.85 * Math.exp(-dur / 4.2);
  const pts = [];
  for (let t = wake; t <= wake + 18.01; t += 0.25) {
    const awake = t - wake;
    const Sv = 1 - (1 - Swake) * Math.exp(-awake / 18.2);
    const C = 0.25 * Math.cos((2 * Math.PI * (t - 16.5)) / 24) + 0.06 * Math.cos((4 * Math.PI * (t - 8.5)) / 24);
    const inertia = 0.15 * Math.exp(-awake / 0.6);
    const E = C - Sv - inertia - 0.015 * Math.min(debt, 12);
    pts.push({ t, v: Math.max(0, Math.min(100, ((E + 0.95) / 0.85) * 100)) });
  }
  return pts;
}

function energyChart(pts, { peak, dip, bed, now }) {
  const W = 640, H = 220, L = 34, B = 26, T = 14, R = 8;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = t => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = v => H - B - (v / 100) * (H - B - T);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="오늘의 에너지 예측">`;
  svg += `<defs><linearGradient id="eg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--fg)" stop-opacity=".22"/><stop offset="1" stop-color="var(--fg)" stop-opacity="0"/></linearGradient></defs>`;
  [0, 50, 100].forEach(v => { svg += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; });
  if (peak) svg += `<rect x="${x(peak[0])}" y="${T}" width="${x(peak[1]) - x(peak[0])}" height="${H - B - T}" fill="#22A06B" opacity=".13" rx="6"/>`;
  svg += `<path d="${line} L${x(t1)},${y(0)} L${x(t0)},${y(0)} Z" fill="url(#eg)"/><path d="${line}" fill="none" stroke="var(--fg)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (dip) svg += `<circle cx="${x(dip.t)}" cy="${y(dip.v)}" r="5" fill="#E0A82E"/><text x="${x(dip.t)}" y="${y(dip.v) + 18}" text-anchor="middle" style="fill:#C98F14;font-weight:700">졸린 시간</text>`;
  if (bed != null && bed > t0 && bed < t1) svg += `<line x1="${x(bed)}" x2="${x(bed)}" y1="${T}" y2="${H - B}" stroke="#5B8FD6" stroke-dasharray="4 4" stroke-width="1.6"/><text x="${x(bed) - 4}" y="${T + 10}" text-anchor="end" style="fill:#5B8FD6;font-weight:700">취침 권장</text>`;
  if (now != null && now > t0 && now < t1) { const p = pts.reduce((a, b) => (Math.abs(b.t - now) < Math.abs(a.t - now) ? b : a)); svg += `<circle cx="${x(now)}" cy="${y(p.v)}" r="6" fill="var(--bg)" stroke="var(--fg)" stroke-width="3"/><text class="hl" x="${x(now)}" y="${y(p.v) - 12}" text-anchor="middle">지금 ${Math.round(p.v)}</text>`; }
  for (let t = Math.ceil(t0 / 2) * 2; t <= t1; t += 2) svg += `<text x="${x(t)}" y="${H - 8}" text-anchor="middle">${esc(clock(t).slice(0, 2).replace(/^0/, ''))}시</text>`;
  return h('div', { class: 'chart', html: svg + '</svg>' });
}

export function renderSleep(box, ctx) {
  const st = S();
  const formBox = h('section', { class: 'glass card col' });
  const statBox = h('div', { class: 'sleep-kpis' });
  const energyBox = h('section', { class: 'glass card col' });
  const histBox = h('section', { class: 'glass card col' });
  box.replaceChildren(statBox, energyBox, h('div', { class: 'two-col' }, formBox, histBox));

  function paint() {
    const need = sleepNeed(), { debt, nights } = sleepDebt(need.need);
    const today = dkey(), last = st.logs[today] || st.logs[addDays(today, -1)];
    const lastDur = last ? durationOf(last) : null;
    const wakeGoal = hm(st.wakeGoal || '07:00');
    const bedRec = wakeGoal - need.need - 0.25; // ~15 minutes to fall asleep
    const debtTone = debt < 2 ? 'good' : debt < 6 ? '' : 'bad';
    statBox.replaceChildren(
      h('div', { class: 'kpi-card glass' }, h('span', { class: 'k' }, '나의 적정 수면'), h('span', { class: 'v' }, fmtH(need.need)), h('span', { class: 'tiny muted' }, `${need.label} 권장 ${need.lo}–${need.hi}시간 · ${need.basis}`)),
      h('div', { class: 'kpi-card glass' }, h('span', { class: 'k' }, '수면 부채 (최근 2주)'), h('span', { class: 'v ' + debtTone }, nights ? fmtH(debt) : '—'), h('span', { class: 'tiny muted' }, !nights ? '수면을 기록하면 계산돼요' : debt < 2 ? '잘 자고 있어요' : debt < 6 ? '며칠간 30분씩 일찍 자면 갚을 수 있어요' : '피로가 쌓였어요. 주말 몰아 자기보다 매일 조금씩 일찍 자요')),
      h('div', { class: 'kpi-card glass' }, h('span', { class: 'k' }, '어젯밤'), h('span', { class: 'v' }, lastDur ? fmtH(lastDur) : '—'), h('span', { class: 'tiny muted' }, lastDur ? `${last.bed} 취침 · ${last.wake} 기상 · 적정보다 ${lastDur >= need.need ? fmtH(lastDur - need.need) + ' 더' : fmtH(need.need - lastDur) + ' 덜'}` : '아래에서 기록해 주세요')),
      h('div', { class: 'kpi-card glass' }, h('span', { class: 'k' }, '오늘 밤 권장 취침'), h('span', { class: 'v' }, clock(bedRec)), h('span', { class: 'tiny muted' }, `${st.wakeGoal || '07:00'}에 일어나려면`)));

    // energy curve from last night (or a typical night if nothing is logged yet)
    const wake = last ? hm(last.wake) : wakeGoal;
    const dur = last ? lastDur : need.need;
    const pts = energyCurve(wake, dur, debt);
    const awakeEnd = Math.min(wake + 18, (bedRec < wake ? bedRec + 24 : bedRec) + 0.5);
    const day = pts.filter(p => p.t <= awakeEnd + 0.01);
    let peak = null, best = -1;
    for (let i = 0; i + 8 < day.length; i++) { if (day[i].t - wake < 1) continue; const avg = day.slice(i, i + 9).reduce((a, p) => a + p.v, 0) / 9; if (avg > best) { best = avg; peak = [day[i].t, day[i + 8].t]; } }
    const dipCand = day.filter(p => { const c = ((p.t % 24) + 24) % 24; return c >= 13 && c <= 16.5; });
    const dip = dipCand.length ? dipCand.reduce((a, b) => (b.v < a.v ? b : a)) : null;
    let nowT = new Date().getHours() + new Date().getMinutes() / 60; if (nowT < wake) nowT += 24;
    const bedT = bedRec < wake ? bedRec + 24 : bedRec;
    energyBox.replaceChildren(
      h('div', { class: 'row between wrap' }, h('h2', { class: 'h2' }, '오늘의 에너지 예측'), h('span', { class: 'small muted' }, last ? `어젯밤 ${fmtH(lastDur)} 잠 · 수면 부채 ${fmtH(debt)} 반영` : '기록이 없어 적정 수면을 잤다고 가정했어요')),
      energyChart(pts, { peak, dip, bed: bedT, now: nowT }),
      h('div', { class: 'energy-tips' },
        peak ? h('div', null, h('i', { style: { background: '#22A06B' } }), h('b', null, '집중이 잘 되는 시간 '), `${clock(peak[0])}–${clock(peak[1])} · 어려운 일은 이때`) : null,
        dip ? h('div', null, h('i', { style: { background: '#E0A82E' } }), h('b', null, '졸린 시간 '), `${clock(dip.t)} 무렵 · 가벼운 일이나 10–20분 낮잠`) : null,
        h('div', null, h('i', { style: { background: '#5B8FD6' } }), h('b', null, '권장 취침 '), `${clock(bedRec)} · 카페인은 ${clock(bedRec - 8)} 전까지`)),
      h('p', { class: 'tiny muted', style: { margin: 0 } }, '수면 과학의 2-프로세스 모델(수면 압력 + 생체 리듬)로 추정한 그래프예요. 의학적 판단이 아니라 하루를 계획하는 참고용이에요.'));

    // log form
    const date = h('input', { class: 'input', type: 'date', value: today });
    const bed = h('input', { class: 'input', type: 'time', value: last?.bed || clock(bedRec) });
    const wakeIn = h('input', { class: 'input', type: 'time', value: last?.wake || st.wakeGoal || '07:00' });
    let quality = st.logs[today]?.quality || 3;
    const qRow = h('div', { class: 'rate-row' });
    const Q = [[1, '피곤'], [2, '별로'], [3, '보통'], [4, '개운'], [5, '최고']];
    const paintQ = () => qRow.replaceChildren(Q.map(([n, l]) => h('button', { type: 'button', class: 'rate' + (quality === n ? ' on' : ''), style: { '--rc': ['#E5484D', '#F07B32', '#E0A82E', '#3B82F6', '#22A06B'][n - 1] }, onclick: () => { quality = n; paintQ(); } }, icon(`face${n}`, 24, 1.6), l)));
    paintQ();
    const goal = h('input', { class: 'input', type: 'time', value: st.wakeGoal || '07:00', style: { width: '130px' }, onchange: e => { st.wakeGoal = e.target.value || '07:00'; commit('sleep'); paint(); } });
    const field = (l, el) => h('label', { class: 'field' }, h('span', null, l), el);
    formBox.replaceChildren(
      h('h2', { class: 'h2' }, '잠 기록하기'),
      field('일어난 날', date),
      h('div', { class: 'grid-2' }, field('잠든 시각', bed), field('일어난 시각', wakeIn)),
      h('div', { class: 'field' }, h('span', null, '얼마나 개운했나요?'), qRow),
      h('button', { class: 'btn btn-ink', onclick: () => {
        if (!bed.value || !wakeIn.value || !date.value) { toast('시각을 모두 넣어 주세요.'); return; }
        const first = !st.logs[date.value];
        st.logs[date.value] = { bed: bed.value, wake: wakeIn.value, quality };
        if (first) gainXP('sleep');
        commit('sleep'); paint(); toast(`${fmtH(durationOf(st.logs[date.value]))} 잤어요. 기록했어요.`, { icon: 'moon' });
      } }, icon('check', 16), '기록'),
      h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, '목표 기상 시각', h('span', { class: 'sub' }, '권장 취침 시각 계산에 써요')), goal));

    // history
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
    const logged = days.filter(k => st.logs[k]);
    const avg = logged.length ? logged.reduce((a, k) => a + durationOf(st.logs[k]), 0) / logged.length : 0;
    histBox.replaceChildren(
      h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '최근 2주 수면'), h('span', { class: 'small muted' }, logged.length ? `평균 ${fmtH(avg)} · 적정 ${fmtH(need.need)}` : '')),
      logged.length ? barChart(days.map(k => ({ label: fmtShort(k).replace(/\(.\)/, ''), value: st.logs[k] ? durationOf(st.logs[k]) : 0, hl: st.logs[k] ? durationOf(st.logs[k]) >= need.need : false })), { fmt: v => (v ? v.toFixed(1) : ''), labelEvery: 2, max: Math.max(10, ...days.map(k => (st.logs[k] ? durationOf(st.logs[k]) : 0))) }) : h('p', { class: 'small muted', style: { margin: 0 } }, '기록이 쌓이면 여기에 그래프가 생겨요.'),
      logged.length ? h('p', { class: 'tiny muted', style: { margin: 0 } }, '진한 막대는 적정 수면을 채운 날이에요.') : null);
  }
  paint();
  ctx.every(5 * 60e3, paint);
  ctx.on('change', w => { if (w === 'profile') paint(); });
}
