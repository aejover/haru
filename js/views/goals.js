// goals.js — 목표: 한 달 / 일 년짜리 장기 목표를 이번 주·이번 달 단기 목표로 쪼개서 차근차근 이루는 탭.
import { h, icon, store, commit, uid, dkey, addDays, fromKey, fmtShort, monthKey, mondayOf, modal, seg, toast, confirmDialog, gainXP, checkEl, ai, jsonOf, aiFail, obj } from '../core.js';
import { COLORS } from './timetable.js';

const HORIZON = { month: '1개월 목표', year: '1년 목표' };
const endFor = (start, horizon) => { const d = fromKey(start); if (horizon === 'year') d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1); d.setDate(d.getDate() - 1); return dkey(d); };
const goals = () => (store.s.goals ||= []);
// "9/24(목) ~ 9/24(금)" is ambiguous for a year-long goal, so show the year when the range crosses one
const rangeText = (a, b) => a.slice(0, 4) === b.slice(0, 4) ? `${fmtShort(a)} ~ ${fmtShort(b)}` : `${a.slice(2, 4)}년 ${fmtShort(a)} ~ ${b.slice(2, 4)}년 ${fmtShort(b)}`;

// how far along the goal is: a number target if set, otherwise share of short goals checked off
export function progressOf(g) {
  if (g.target) return Math.min(1, (Number(g.current) || 0) / g.target);
  const steps = g.steps || [];
  return steps.length ? steps.filter(s => s.done).length / steps.length : 0;
}
function timeOf(g) {
  const t0 = fromKey(g.start), t1 = fromKey(g.end); t1.setDate(t1.getDate() + 1);
  return Math.max(0, Math.min(1, (Date.now() - t0) / (t1 - t0)));
}
function pace(g) {
  if (g.achieved) return ['달성!', 'good'];
  const p = progressOf(g), t = timeOf(g);
  if (t < 0.05 && p === 0) return ['막 시작했어요', ''];
  if (p >= t + 0.1) return ['앞서가는 중', 'good'];
  if (p >= t - 0.1) return ['순항 중', ''];
  return ['조금 늦어요', 'bad'];
}

function editGoal(g, isNew, onDone) {
  const v = { ...g };
  const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);
  const title = h('input', { class: 'input', value: v.title, placeholder: '예: 토익 900점, 책 24권 읽기, 5kg 감량' });
  const why = h('input', { class: 'input', value: v.why || '', placeholder: '이 목표를 이루고 싶은 이유 (힘들 때 다시 보게 돼요)' });
  const start = h('input', { class: 'input', type: 'date', value: v.start });
  const end = h('input', { class: 'input', type: 'date', value: v.end });
  const target = h('input', { class: 'input', type: 'number', min: 0, value: v.target ?? '', placeholder: '예: 24 (비우면 단기 목표 체크로 계산)' });
  const unit = h('input', { class: 'input', value: v.unit || '', placeholder: '예: 권, 점, kg, 회' });
  const sw = h('div', { class: 'tt-swatches' });
  const paintSw = () => sw.replaceChildren(COLORS.map(c => h('button', { type: 'button', class: 'swatch' + (v.color === c ? ' on' : ''), style: { background: c }, 'aria-label': '색 ' + c, onclick: () => { v.color = c; paintSw(); } })));
  paintSw();
  modal({
    title: isNew ? '장기 목표 만들기' : '목표 수정',
    body: h('div', { class: 'col' },
      field('목표', title), field('왜 이루고 싶나요?', why),
      h('div', { class: 'field' }, h('span', null, '기간'), seg([['month', '1개월'], ['year', '1년']], v.horizon, x => { v.horizon = x; end.value = endFor(start.value || dkey(), x); })),
      h('div', { class: 'grid-2' }, field('시작', start), field('끝', end)),
      h('div', { class: 'grid-2' }, field('숫자 목표 (선택)', target), field('단위', unit)),
      h('div', { class: 'field' }, h('span', null, '색깔'), sw)),
    actions: [
      isNew ? null : { label: '삭제', danger: true, onClick: async () => { if (!(await confirmDialog(`"${g.title}" 목표와 단기 목표를 모두 지울까요?`, { ok: '삭제', danger: true }))) return false; store.s.goals = goals().filter(x => x.id !== g.id); commit('goals'); onDone(); } },
      { label: '취소' },
      { label: isNew ? '만들기' : '저장', primary: true, onClick: () => {
        if (!title.value.trim()) { toast('목표를 적어 주세요.'); title.focus(); return false; }
        if (!start.value || !end.value || end.value < start.value) { toast('기간을 확인해 주세요.'); return false; }
        Object.assign(g, v, { title: title.value.trim(), why: why.value.trim(), start: start.value, end: end.value, target: target.value === '' ? null : Number(target.value), unit: unit.value.trim() });
        if (isNew) { goals().push(g); gainXP('goal'); }
        commit('goals'); onDone();
        if (isNew) toast('이제 이번 주와 이번 달에 할 단기 목표를 적어 보세요.', { icon: 'target' });
      } },
    ].filter(Boolean),
  });
  setTimeout(() => title.focus(), 80);
}

async function planWithClaude(g, btn, onDone) {
  btn.disabled = true; btn.textContent = 'Claude가 계획 중…';
  try {
    const resp = await ai({
      effort: 'medium', max_tokens: 6000,
      format: obj({ reply: { type: 'string' }, months: { type: 'array', items: obj({ month: { type: 'string', description: 'YYYY-MM' }, title: { type: 'string' } }) }, week: { type: 'array', items: { type: 'string' } } }),
      system: '너는 목표 달성 코치다. 사용자의 장기 목표를 기간 안의 월별 단기 목표(한 달에 1~2개)와, 이번 주에 바로 할 수 있는 구체적인 단기 목표 3~4개로 나눈다. 각 항목은 측정 가능하고 짧은 한국어 문장(25자 안팎)으로 쓴다. 월은 시작~끝 기간 안의 YYYY-MM만 쓴다. reply는 계획의 핵심을 한 문장으로.',
      messages: [{ role: 'user', content: JSON.stringify({ 오늘: dkey(), 목표: g.title, 이유: g.why, 시작: g.start, 끝: g.end, 숫자목표: g.target ? `${g.target}${g.unit || ''} (현재 ${g.current || 0})` : null, 이미있는단기목표: (g.steps || []).map(s => s.title) }) }],
    });
    const plan = jsonOf(resp);
    const months = (plan.months || []).filter(m => /^\d{4}-\d{2}$/.test(m.month));
    const week = plan.week || [];
    const pick = new Set([...months.map((_, i) => 'm' + i), ...week.map((_, i) => 'w' + i)]);
    modal({
      title: 'Claude가 나눈 단기 목표', wide: true,
      body: h('div', { class: 'col' },
        plan.reply ? h('p', { class: 'small muted', style: { margin: 0 } }, plan.reply) : null,
        week.length ? h('div', { class: 'section-label' }, '이번 주') : null,
        week.map((w, i) => h('div', { class: 'item-row' }, checkEl(true, on => { on ? pick.add('w' + i) : pick.delete('w' + i); }, w), h('span', { class: 'grow' }, w))),
        months.length ? h('div', { class: 'section-label' }, '월별') : null,
        months.map((m, i) => h('div', { class: 'item-row' }, checkEl(true, on => { on ? pick.add('m' + i) : pick.delete('m' + i); }, m.title), h('span', { class: 'chip sm line num' }, `${Number(m.month.slice(5))}월`), h('span', { class: 'grow' }, m.title)))),
      actions: [{ label: '취소' }, {
        label: '선택한 목표 추가', primary: true, onClick: () => {
          g.steps ||= [];
          week.forEach((w, i) => { if (pick.has('w' + i)) g.steps.push({ id: uid(), scope: 'week', key: mondayOf(dkey()), title: w, done: false }); });
          months.forEach((m, i) => { if (pick.has('m' + i)) g.steps.push({ id: uid(), scope: 'month', key: m.month, title: m.title, done: false }); });
          commit('goals'); onDone(); toast('단기 목표를 넣었어요.', { icon: 'target' });
        },
      }],
    });
  } catch (e) { aiFail(e); }
  finally { btn.disabled = false; btn.replaceChildren(icon('sparkle', 14), 'Claude로 나누기'); }
}

export default {
  id: 'goals', title: '목표', icon: 'target',
  render(el, ctx) {
    el.classList.add('stagger', 'narrow');
    const summary = h('section', { class: 'glass card goal-summary' });
    const list = h('div', { class: 'col', style: { gap: '16px' } });
    const add = () => { const start = dkey(); editGoal({ id: uid(), title: '', horizon: 'year', start, end: endFor(start, 'year'), color: COLORS[goals().length % COLORS.length], steps: [], current: 0, createdAt: Date.now() }, true, paint); };
    el.append(h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '목표'), h('button', { class: 'btn btn-ink', onclick: add }, icon('plus', 16), '장기 목표')), summary, list);

    function stepRow(g, s) {
      const row = h('div', { class: 'task-row' + (s.done ? ' done' : '') },
        checkEl(s.done, on => { s.done = on; row.classList.toggle('done', on); if (on) gainXP('goal', 5); commit('goals'); setTimeout(paint, 350); }, s.title),
        h('span', { class: 't-title' }, s.title),
        h('button', { class: 'btn-icon sm del', 'aria-label': '삭제', onclick: () => { g.steps = g.steps.filter(x => x !== s); commit('goals'); paint(); } }, icon('x', 15)));
      return row;
    }
    function adder(g, scope, key, placeholder) {
      const inp = h('input', { class: 'input goal-add', placeholder, 'aria-label': placeholder });
      const go = () => { const t = inp.value.trim(); if (!t) return; (g.steps ||= []).push({ id: uid(), scope, key, title: t, done: false }); commit('goals'); paint(); setTimeout(() => list.querySelector(`[data-adder="${g.id}-${scope}"]`)?.focus(), 30); };
      inp.dataset.adder = `${g.id}-${scope}`;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) go(); });
      return h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } }, inp, h('button', { class: 'btn btn-ghost btn-sm', onclick: go }, icon('plus', 14)));
    }
    function card(g) {
      const k = dkey(), wk = mondayOf(k), mk = monthKey();
      const steps = g.steps || [];
      const weekSteps = steps.filter(s => s.scope === 'week' && s.key === wk);
      const monthSteps = steps.filter(s => s.scope === 'month' && s.key === mk);
      const lastWeek = steps.filter(s => s.scope === 'week' && s.key === addDays(wk, -7) && !s.done);
      const p = progressOf(g), t = timeOf(g), [paceText, paceCls] = pace(g);
      const dday = Math.round((fromKey(g.end) - fromKey(k)) / 864e5);
      // last 8 weeks: share of weekly goals done
      const weeks = Array.from({ length: 8 }, (_, i) => { const key = addDays(wk, (i - 7) * 7); const ws = steps.filter(s => s.scope === 'week' && s.key === key); return { key, n: ws.length, r: ws.length ? ws.filter(s => s.done).length / ws.length : 0 }; });
      const planBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: e => planWithClaude(g, e.currentTarget, paint) }, icon('sparkle', 14), 'Claude로 나누기');
      return h('section', { class: 'glass card col goal-card' + (g.achieved ? ' achieved' : ''), style: { '--gc': g.color } },
        h('div', { class: 'row', style: { alignItems: 'flex-start' } },
          h('i', { class: 'goal-dot' }),
          h('div', { class: 'grow', style: { minWidth: 0 } },
            h('div', { class: 'row wrap', style: { gap: '6px' } }, h('span', { class: 'chip sm line' }, HORIZON[g.horizon] || '목표'), h('span', { class: 'chip sm num ' + (dday < 0 ? 'line' : 'ink') }, dday > 0 ? `D-${dday}` : dday === 0 ? 'D-DAY' : '기간 끝'), h('span', { class: 'goal-pace ' + paceCls }, paceText)),
            h('h2', { class: 'h2 goal-title' }, g.title),
            g.why ? h('div', { class: 'small muted' }, g.why) : null),
          h('button', { class: 'btn-icon sm', 'aria-label': '목표 수정', onclick: () => editGoal(g, false, paint) }, icon('pen', 16))),
        h('div', { class: 'goal-bars' },
          h('div', null, h('div', { class: 'row between small' }, h('span', { class: 'muted' }, '달성'), h('b', { class: 'num' }, g.target ? `${g.current || 0} / ${g.target}${g.unit || ''} · ${Math.round(p * 100)}%` : `${Math.round(p * 100)}%`)), h('div', { class: 'bar' }, h('i', { style: { width: p * 100 + '%', background: g.color } }))),
          h('div', null, h('div', { class: 'row between small' }, h('span', { class: 'muted' }, '기간 경과'), h('span', { class: 'num muted' }, `${rangeText(g.start, g.end)} · ${Math.round(t * 100)}%`)), h('div', { class: 'bar thin' }, h('i', { style: { width: t * 100 + '%' } })))),
        g.target ? h('div', { class: 'row wrap', style: { gap: '6px' } },
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { g.current = Math.max(0, (Number(g.current) || 0) - 1); commit('goals'); paint(); } }, icon('minus', 14)),
          h('button', { class: 'btn btn-ink btn-sm', onclick: () => { g.current = (Number(g.current) || 0) + 1; gainXP('goal', 3); if (g.current >= g.target && !g.achieved) { g.achieved = true; toast(`"${g.title}" 목표 달성! 정말 해냈어요.`, { icon: 'trophy', duration: 6000 }); } commit('goals'); paint(); } }, icon('plus', 14), `1${g.unit || ''} 기록`)) : null,
        h('div', { class: 'goal-cols' },
          h('div', { class: 'goal-col' },
            h('div', { class: 'row between' }, h('b', null, '이번 주'), h('span', { class: 'tiny muted num' }, `${fmtShort(wk)} ~ ${fmtShort(addDays(wk, 6))}`)),
            weekSteps.map(s => stepRow(g, s)),
            lastWeek.length ? h('button', { class: 'btn btn-ghost btn-sm', style: { alignSelf: 'flex-start' }, onclick: () => { lastWeek.forEach(s => { s.key = wk; }); commit('goals'); paint(); toast('지난주 못 끝낸 목표를 이번 주로 옮겼어요.'); } }, icon('reset', 14), `지난주 못 끝낸 ${lastWeek.length}개 가져오기`) : null,
            adder(g, 'week', wk, '이번 주 단기 목표')),
          h('div', { class: 'goal-col' },
            h('div', { class: 'row between' }, h('b', null, `이번 달 (${Number(mk.slice(5))}월)`), h('span', { class: 'tiny muted num' }, monthSteps.length ? `${monthSteps.filter(s => s.done).length}/${monthSteps.length}` : '')),
            monthSteps.map(s => stepRow(g, s)),
            adder(g, 'month', mk, '이번 달 단기 목표'))),
        h('div', { class: 'row wrap between' },
          h('div', { class: 'goal-weeks', title: '최근 8주 주간 목표 달성률' }, h('span', { class: 'tiny muted' }, '최근 8주'), weeks.map(w => h('i', { title: `${fmtShort(w.key)} 주: ${w.n ? Math.round(w.r * 100) + '%' : '목표 없음'}`, style: { background: w.n ? g.color : 'var(--tint-2)', opacity: w.n ? 0.25 + w.r * 0.75 : 1 } }))),
          h('div', { class: 'row', style: { gap: '6px' } }, planBtn,
            h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { g.achieved = !g.achieved; if (g.achieved) { gainXP('goal', 20); toast('축하해요! 목표를 이뤘어요.', { icon: 'trophy' }); } commit('goals'); paint(); } }, icon(g.achieved ? 'reset' : 'trophy', 14), g.achieved ? '다시 진행' : '달성 표시'))));
    }
    function paint() {
      const all = goals();
      const wk = mondayOf(dkey());
      const thisWeek = all.flatMap(g => (g.steps || []).filter(s => s.scope === 'week' && s.key === wk));
      const done = thisWeek.filter(s => s.done).length;
      summary.replaceChildren(
        h('div', { class: 'kpi' }, h('b', null, all.filter(g => !g.achieved).length), h('span', null, '진행 중인 장기 목표')),
        h('div', { class: 'kpi' }, h('b', null, `${done}/${thisWeek.length}`), h('span', null, '이번 주 단기 목표')),
        h('div', { class: 'kpi' }, h('b', null, all.filter(g => g.achieved).length), h('span', null, '이룬 목표')));
      const sorted = all.slice().sort((a, b) => (a.achieved ? 1 : 0) - (b.achieved ? 1 : 0) || a.end.localeCompare(b.end));
      list.replaceChildren(sorted.length ? sorted.map(card) : h('section', { class: 'glass card' }, h('div', { class: 'empty' }, icon('target', 34),
        h('div', null, '한 달 또는 일 년 동안 이루고 싶은 목표를 정하고,', h('br'), '이번 주·이번 달에 할 작은 목표로 나눠 보세요.'),
        h('button', { class: 'btn btn-ink', onclick: add }, icon('plus', 16), '첫 장기 목표 만들기'))));
    }
    paint();
    ctx.on('change', w => { if (w === 'goals' && !el.contains(document.activeElement)) paint(); });
    ctx.on('newday', paint);
  },
};
