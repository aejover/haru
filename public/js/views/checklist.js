// checklist.js — 할 일 (swipe over for 루틴): 매일 vs 오늘만, 일반 vs 독촉(안 하면 할 때까지 알림, 밀리면 3·5·10회),
// 종류(운동·공부… 직접 입력, 비우면 공통), 시간이 있으면 미리 알림.
import {
  h, icon, store, commit, dkey, addDays, fmtDay, fmtShort, WEEK, seg, checkEl, toast, desktopNotify,
  tasksOn, isDone, setDone, addTask, removeTask, visibleTasks, dayStats, overdueDays, nagCount, applies,
} from '../core.js';
import { taskRow } from './home.js';
import { goalSelect, remindSelect, remindLabel, catInput, usedCats, CAT_EXAMPLES } from './edit-item.js';
import routine from './routine.js';
import { pager } from '../pager.js';

function renderTodo(el, ctx) {
  el.classList.add('stagger');
  const s = store.s;
  const head = h('div', { class: 'page-head' });
  const filterBar = h('div', { class: 'cat-filter' });
  const overdueBox = h('div');
  const daily = h('section', { class: 'glass card col' });
  const today = h('section', { class: 'glass card col' });
  const upcoming = h('section', { class: 'glass card col' });
  let filter = '전체';
  const inCat = t => filter === '전체' || (filter === '공통' ? !t.cat : t.cat === filter);

  // ----- add form -----
  const f = { kind: 'once', mode: 'normal', days: [] };
  const title = h('input', { class: 'input', placeholder: '무엇을 해야 하나요?', 'aria-label': '할 일 제목', onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) add(); } });
  const time = h('input', { class: 'input', type: 'time', 'aria-label': '시간 (선택)', style: { width: '130px' } });
  const date = h('input', { class: 'input', type: 'date', value: dkey(), 'aria-label': '날짜', style: { width: '160px' } });
  const dayChips = h('div', { class: 'row wrap', style: { gap: '6px' }, hidden: true }, WEEK.map((w, i) => {
    const b = h('button', { class: 'chip sm line', 'aria-pressed': 'false', onclick: () => { const on = !f.days.includes(i); f.days = on ? [...f.days, i] : f.days.filter(x => x !== i); b.classList.toggle('ink', on); b.setAttribute('aria-pressed', String(on)); } }, w);
    return b;
  }));
  const kindSeg = seg([['once', '오늘만 (한 번)'], ['daily', '매일 반복']], 'once', v => { f.kind = v; dayChips.hidden = v !== 'daily'; date.hidden = v === 'daily'; sum(); });
  const modeSeg = seg([['normal', '일반'], ['nag', '독촉']], 'normal', v => { f.mode = v; modeHint.textContent = v === 'nag' ? '안 하면 할 때까지 알림이 가요. 밀리면 다음 날 3번, 다다음 날 5번, 3일째부터 10번.' : '알림 없이 체크만 해요.'; sum(); });
  const modeHint = h('div', { class: 'small muted' }, '알림 없이 체크만 해요.');
  const goal = goalSelect();
  goal.style.width = 'auto';
  // 종류: type anything, or tap one already used / an example
  const [cat, catList] = catInput('', '직접 입력');
  cat.style.width = '130px';
  const catChips = h('div', { class: 'row wrap', style: { gap: '6px' } });
  const paintCatChips = () => catChips.replaceChildren([...new Set([...usedCats(), ...CAT_EXAMPLES])].slice(0, 8).map(c =>
    h('button', { class: 'chip sm ' + (cat.value.trim() === c ? 'ink' : 'line'), type: 'button', onclick: () => { cat.value = cat.value.trim() === c ? '' : c; paintCatChips(); sum(); } }, c)));
  cat.addEventListener('input', () => { paintCatChips(); sum(); });
  // 미리 알림: only means something once a time is set
  const remind = remindSelect();
  remind.style.width = 'auto';
  const remindRow = h('label', { class: 'row', style: { gap: '8px' } }, icon('bell', 15), h('span', { class: 'small muted' }, '미리 알림'), remind);
  const syncRemind = () => { remindRow.hidden = !time.value; };
  // the options stay folded behind one chip that says what they're set to
  const optLabel = h('span');
  const optBtn = h('button', { class: 'chip sm line opt-toggle', 'aria-expanded': 'false', onclick: () => { const open = !opts.classList.contains('open'); opts.classList.toggle('open', open); optBtn.setAttribute('aria-expanded', String(open)); } }, optLabel, icon('down', 14));
  const sum = () => {
    const when = f.kind === 'daily' ? '매일' : date.value && date.value !== dkey() ? fmtShort(date.value) : '오늘';
    const lead = remind.value === '' ? s.settings.taskLead ?? 60 : Number(remind.value);
    optLabel.textContent = [cat.value.trim() || '공통', when, f.mode === 'nag' ? '독촉' : '일반', time.value ? `${time.value} · 알림 ${remindLabel(lead)}` : '', goal.value ? '목표 연결' : ''].filter(Boolean).join(' · ');
  };
  [date, goal, remind].forEach(x => x.addEventListener('change', sum));
  time.addEventListener('change', () => { syncRemind(); sum(); });
  function add() {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    addTask({ title: t, kind: f.kind, date: date.value || dkey(), mode: f.mode, time: time.value || undefined, days: f.kind === 'daily' ? f.days : undefined, goalId: goal.value || undefined, cat: cat.value, remind: time.value ? remind.value : '' });
    if (f.mode === 'nag') {
      desktopNotify('독촉 모드 켜짐', `"${t}"을(를) 끝낼 때까지 알려 드릴게요.`);
      if (!s.settings.ntfyTopic) toast('휴대폰으로도 독촉받으려면 설정에서 휴대폰 알림을 연결하세요.', { action: { label: '설정', onClick: () => { location.hash = 'settings'; } }, duration: 6000 });
    } else if (time.value) {
      const lead = remind.value === '' ? s.settings.taskLead ?? 60 : Number(remind.value);
      if (lead >= 0) toast(`${time.value}${lead ? `보다 ${remindLabel(lead).replace(' 전', '')} 먼저` : '에'} 알려 드릴게요.`, { icon: 'bell' });
    }
    title.value = ''; time.value = ''; syncRemind(); sum();
    paint();
  }
  const opts = h('div', { class: 'fold' }, h('div', { class: 'col' },
    h('div', { class: 'row wrap' }, kindSeg, modeSeg, date, time, goal),
    dayChips, modeHint,
    h('div', { class: 'row wrap', style: { gap: '8px' } }, h('span', { class: 'small muted' }, '종류 (비우면 공통)'), cat, catList, catChips),
    remindRow));
  const form = h('section', { class: 'glass card col' },
    h('div', { class: 'row' }, h('div', { class: 'grow', style: { minWidth: 0 } }, title), h('button', { class: 'btn btn-ink', onclick: add }, icon('plus', 16), '추가')),
    h('div', { class: 'row' }, optBtn),
    opts);
  paintCatChips(); syncRemind(); sum();

  // ----- nag ladder explanation -----
  const ladder = h('section', { class: 'glass card col' },
    h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '독촉 모드는 이렇게 알려요'), h('a', { class: 'btn btn-ghost btn-sm', href: '#settings' }, icon('sliders', 14), '알림 설정')),
    h('div', { class: 'ladder' },
      h('div', null, h('b', null, `${s.settings.nagInterval}분`), h('span', null, '당일 · 할 때까지 반복')),
      h('div', null, h('b', null, '3회'), h('span', null, '다음 날')),
      h('div', null, h('b', null, '5회'), h('span', null, '다다음 날')),
      h('div', null, h('b', null, '10회'), h('span', null, '3일째부터 매일'))),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } },
      `알림은 ${s.settings.nagStart}시부터 ${s.settings.nagEnd}시 사이에 일정한 간격으로 가요. `,
      s.settings.ntfyTopic ? '휴대폰 알림이 연결되어 있어요.' : '지금은 이 기기에만 알림이 떠요. 휴대폰 알림은 설정에서 연결할 수 있어요.',
      ' 일반 할 일은 시간을 정했을 때만 미리 알림이 가요.'));

  function paintFilter() {
    const cats = usedCats().filter(c => visibleTasks().some(t => t.cat === c));
    if (filter !== '전체' && filter !== '공통' && !cats.includes(filter)) filter = '전체';
    filterBar.replaceChildren(cats.length ? ['전체', '공통', ...cats].map(c => h('button', { class: 'chip sm ' + (c === filter ? 'ink' : 'line'), onclick: () => { filter = c; paint(); } }, c)) : null);
    filterBar.hidden = !cats.length;
  }

  function paint() {
    const k = dkey();
    const list = tasksOn(k).filter(inCat);
    const st = dayStats(k);
    head.replaceChildren(h('h1', { class: 'h1' }, '할 일'), h('span', { class: 'chip line' }, fmtDay(k)),
      h('span', { class: 'chip ink num' }, `${st.done}/${st.total} · ${Math.round(st.pct)}%`));
    paintFilter();

    // overdue nag tasks
    const late = visibleTasks().filter(t => t.mode === 'nag' && overdueDays(t, k) > 0 && !(t.kind === 'daily' && isDone(t, k)));
    overdueBox.replaceChildren(late.length ? h('section', { class: 'overdue glass col' },
      h('div', { class: 'row' }, icon('bell', 20), h('h2', { class: 'h2' }, `밀린 독촉 ${late.length}개`)),
      late.map(t => {
        const d = overdueDays(t, k);
        const doneKey = t.kind === 'once' ? t.date : k;
        return h('div', { class: 'task-row' },
          checkEl(false, () => { setDone(t, doneKey, true); toast(`"${t.title}" 완료! 알림을 멈출게요.`, { icon: 'check' }); paint(); }, `${t.title} 완료`),
          h('span', { class: 't-title' }, t.title, h('span', { class: 'small muted' }, t.kind === 'once' ? ` · ${fmtShort(t.date)}부터` : ' · 매일')),
          h('span', { class: 'nag-badge' }, `${d}일째 · 오늘 ${nagCount(d)}회`));
      })) : null);

    const routines = list.filter(t => t.kind === 'daily');
    const once = list.filter(t => t.kind === 'once');
    const later = visibleTasks().filter(t => t.kind === 'daily' && !applies(t, k) && inCat(t));
    daily.replaceChildren(
      h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '매일 하는 일'), h('span', { class: 'small muted num' }, `${routines.filter(t => isDone(t, k)).length}/${routines.length}`)),
      routines.length ? h('div', null, routines.map(t => withDays(taskRow(t, k, { onChange: paint }), t))) : h('div', { class: 'empty' }, filter === '전체' ? '매일 반복할 일을 추가해 보세요. 예: 약 먹기, 오픈 준비, 마감 정리' : `'${filter}' 종류의 매일 할 일이 없어요.`),
      later.length ? h('div', null, h('div', { class: 'group-label' }, '오늘은 쉬는 요일'), later.map(t => h('div', { class: 'task-row' }, h('span', { class: 't-title muted' }, t.title), h('span', { class: 'chip sm line' }, (t.days || []).map(d => WEEK[d]).join('·')),
        h('button', { class: 'btn-icon sm', 'aria-label': '삭제', onclick: () => { removeTask(t); paint(); } }, icon('x', 15))))) : null);
    today.replaceChildren(
      h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '오늘만 할 일'), h('span', { class: 'small muted num' }, `${once.filter(t => isDone(t, k)).length}/${once.length}`)),
      once.length ? h('div', null, once.map(t => taskRow(t, k, { onChange: paint }))) : h('div', { class: 'empty' }, filter === '전체' ? '오늘 한 번만 하면 되는 일을 적어 보세요.' : `'${filter}' 종류의 오늘 할 일이 없어요.`));

    const future = s.tasks.filter(t => t.kind === 'once' && t.date > k && inCat(t)).sort((a, b) => a.date.localeCompare(b.date));
    const missed = s.tasks.filter(t => t.kind === 'once' && t.date < k && !isDone(t, t.date) && t.mode !== 'nag' && t.date >= addDays(k, -7) && inCat(t));
    upcoming.replaceChildren(h('h2', { class: 'h2' }, '다가오는 할 일'),
      future.length ? h('div', null, future.slice(0, 12).map(t => h('div', { class: 'task-row' }, h('span', { class: 'chip sm line num' }, fmtShort(t.date)), h('span', { class: 't-title' }, t.title),
        t.cat ? h('span', { class: 'cat-tag' }, t.cat) : null,
        t.mode === 'nag' ? h('span', { class: 'nag-badge' }, icon('bell', 12), '독촉') : null,
        h('button', { class: 'btn-icon sm', 'aria-label': '삭제', onclick: () => { removeTask(t); paint(); } }, icon('x', 15))))) : h('p', { class: 'small muted', style: { margin: 0 } }, '예정된 할 일이 없어요. 날짜를 골라 미리 추가할 수 있어요.'),
      missed.length ? h('div', null, h('div', { class: 'group-label' }, '지난주에 못 한 일'), missed.map(t => h('div', { class: 'task-row' },
        h('span', { class: 'chip sm line num' }, fmtShort(t.date)), h('span', { class: 't-title' }, t.title),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { t.date = k; commit('tasks'); paint(); toast('오늘 할 일로 옮겼어요.'); } }, '오늘로')))) : null);
  }
  const withDays = (row, t) => { if (t.days?.length) row.querySelector('.meta').prepend(h('span', { class: 'chip sm line' }, t.days.map(d => WEEK[d]).join('·'))); return row; };

  paint();
  ctx.on('change', w => { if (w === 'tasks') { paint(); paintCatChips(); } });
  ctx.on('newday', paint);
  el.append(head, filterBar, overdueBox, form, h('div', { class: 'ck-layout' }, daily, today), h('div', { class: 'ck-layout' }, upcoming, ladder));
}

export default {
  id: 'checklist', title: '할 일', icon: 'checklist',
  // 할 일 and 루틴 side by side: #checklist, #checklist/routine (#routine still lands here)
  render(el, ctx, arg) {
    const pg = pager(ctx, [
      { id: 'todo', title: '할 일', render: b => renderTodo(b, ctx) },
      { id: 'routine', title: '루틴', render: b => routine.render(b, ctx, arg === 'routine-settings' ? 'settings' : undefined) },
    ], { start: String(arg || '').startsWith('routine') ? 1 : 0, base: 'checklist' });
    el.append(pg.el);
  },
};
