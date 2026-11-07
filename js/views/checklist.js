// checklist.js — 할 일 (swipe over for 루틴): a dashboard of four boxes — 오늘 할 일 · 계획할 일 · 빨리 끝낼 일 ·
// 안 해도 될 일. Each box adds its own tasks with +, and a task moves between boxes by dragging its handle.
// Tasks still have 매일 vs 한 번, 일반 vs 독촉(밀리면 3·5·10회), 종류(비우면 공통) and 미리 알림.
import {
  h, icon, store, commit, dkey, fmtDay, fmtShort, WEEK, seg, checkEl, toast, desktopNotify,
  isDone, setDone, addTask, visibleTasks, dayStats, overdueDays, nagCount, applies,
} from '../core.js';
import { goalSelect, remindSelect, remindLabel, catInput, usedCats, CAT_EXAMPLES, QUADS, quadOf, editTask } from './edit-item.js';
import routine from './routine.js';
import { pager } from '../pager.js';

const clockOf = ts => new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });

function renderTodo(el, ctx) {
  el.classList.add('stagger');
  const s = store.s;
  const head = h('div', { class: 'page-head' });
  const filterBar = h('div', { class: 'cat-filter' });
  const overdueBox = h('div');
  const board = h('div', { class: 'quads' });
  let filter = '전체';
  const inCat = t => filter === '전체' || (filter === '공통' ? !t.cat : t.cat === filter);

  // ----- add form (all the options; each box's + is the quick way) -----
  const f = { kind: 'once', mode: 'normal', days: [], quad: 'now' };
  const title = h('input', { class: 'input', placeholder: '무엇을 해야 하나요?', 'aria-label': '할 일 제목', onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) add(); } });
  const time = h('input', { class: 'input', type: 'time', 'aria-label': '시간 (선택)', style: { width: '130px' } });
  const date = h('input', { class: 'input', type: 'date', value: dkey(), 'aria-label': '날짜', style: { width: '160px' } });
  const dayChips = h('div', { class: 'row wrap', style: { gap: '6px' }, hidden: true }, WEEK.map((w, i) => {
    const b = h('button', { class: 'chip sm line', 'aria-pressed': 'false', onclick: () => { const on = !f.days.includes(i); f.days = on ? [...f.days, i] : f.days.filter(x => x !== i); b.classList.toggle('ink', on); b.setAttribute('aria-pressed', String(on)); } }, w);
    return b;
  }));
  const quadSeg = seg(QUADS, 'now', v => { f.quad = v; sum(); });
  const kindSeg = seg([['once', '한 번'], ['daily', '매일 반복']], 'once', v => { f.kind = v; dayChips.hidden = v !== 'daily'; date.hidden = v === 'daily'; sum(); });
  const modeSeg = seg([['normal', '일반'], ['nag', '독촉']], 'normal', v => { f.mode = v; modeHint.textContent = v === 'nag' ? '안 하면 할 때까지 알림이 가요. 밀리면 다음 날 3번, 다다음 날 5번, 3일째부터 10번.' : '알림 없이 체크만 해요.'; sum(); });
  const modeHint = h('div', { class: 'small muted' }, '알림 없이 체크만 해요.');
  const goal = goalSelect();
  goal.style.width = 'auto';
  const [cat, catList] = catInput('', '직접 입력');
  cat.style.width = '130px';
  const catChips = h('div', { class: 'row wrap', style: { gap: '6px' } });
  const paintCatChips = () => catChips.replaceChildren([...new Set([...usedCats(), ...CAT_EXAMPLES])].slice(0, 8).map(c =>
    h('button', { class: 'chip sm ' + (cat.value.trim() === c ? 'ink' : 'line'), type: 'button', onclick: () => { cat.value = cat.value.trim() === c ? '' : c; paintCatChips(); sum(); } }, c)));
  cat.addEventListener('input', () => { paintCatChips(); sum(); });
  const remind = remindSelect();
  remind.style.width = 'auto';
  const remindRow = h('label', { class: 'row', style: { gap: '8px' } }, icon('bell', 15), h('span', { class: 'small muted' }, '미리 알림'), remind);
  const syncRemind = () => { remindRow.hidden = !time.value; };
  const optLabel = h('span');
  const optBtn = h('button', { class: 'chip sm line opt-toggle', 'aria-expanded': 'false', onclick: () => { const open = !opts.classList.contains('open'); opts.classList.toggle('open', open); optBtn.setAttribute('aria-expanded', String(open)); } }, optLabel, icon('down', 14));
  const sum = () => {
    const when = f.kind === 'daily' ? '매일' : date.value && date.value !== dkey() ? fmtShort(date.value) : '오늘';
    const lead = remind.value === '' ? s.settings.taskLead ?? 60 : Number(remind.value);
    optLabel.textContent = [QUADS.find(q => q[0] === f.quad)[1], cat.value.trim() || '공통', when, f.mode === 'nag' ? '독촉' : '', time.value ? `${time.value} · 알림 ${remindLabel(lead)}` : '', goal.value ? '목표 연결' : ''].filter(Boolean).join(' · ');
  };
  [date, goal, remind].forEach(x => x.addEventListener('change', sum));
  time.addEventListener('change', () => { syncRemind(); sum(); });
  function add() {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    const made = addTask({ title: t, kind: f.kind, date: date.value || dkey(), mode: f.mode, time: time.value || undefined, days: f.kind === 'daily' ? f.days : undefined, goalId: goal.value || undefined, cat: cat.value, remind: time.value ? remind.value : '', quad: f.quad });
    if (f.mode === 'nag') {
      desktopNotify('독촉 모드 켜짐', `"${t}"을(를) 끝낼 때까지 알려 드릴게요.`);
      if (!s.settings.ntfyTopic) toast('휴대폰으로도 독촉받으려면 설정에서 휴대폰 알림을 연결하세요.', { action: { label: '설정', onClick: () => { location.hash = 'settings'; } }, duration: 6000 });
    } else if (time.value) {
      const lead = remind.value === '' ? s.settings.taskLead ?? 60 : Number(remind.value);
      if (lead >= 0) toast(`${time.value}${lead ? `보다 ${remindLabel(lead).replace(' 전', '')} 먼저` : '에'} 알려 드릴게요.`, { icon: 'bell' });
    }
    title.value = ''; time.value = ''; syncRemind(); sum();
    paint(made.id);
  }
  const opts = h('div', { class: 'fold' }, h('div', { class: 'col' },
    h('div', { class: 'seg-scroll' }, quadSeg),
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

  // ----- the four boxes -----
  // what a box shows: today's 매일 tasks; one-off tasks not done yet (late, today or later); and the ones
  // finished today, crossed out at the bottom until tomorrow
  function itemsOf(q, k) {
    const out = [];
    for (const t of visibleTasks()) {
      if (quadOf(t) !== q || !inCat(t)) continue;
      if (t.kind === 'daily') { if (applies(t, k)) out.push({ t, key: k }); continue; }
      const doneAt = t.done?.[t.date];
      if (doneAt && dkey(new Date(doneAt)) !== k) continue;
      out.push({ t, key: t.date });
    }
    const rank = x => (isDone(x.t, x.key) ? 1 : 0);
    return out.sort((a, b) => rank(a) - rank(b) || (rank(a) ? a.t.done[a.key] - b.t.done[b.key] : a.key.localeCompare(b.key) || (a.t.time || '99').localeCompare(b.t.time || '99')));
  }
  function itemRow({ t, key }, k) {
    const done = isDone(t, key);
    const sub = done ? clockOf(t.done[key])
      : [t.kind === 'daily' ? (t.days?.length ? t.days.map(d => WEEK[d]).join('·') : '매일') : key < k ? `${fmtShort(key)} · ${overdueDays(t, k) || 1}일 밀림` : key > k ? fmtShort(key) : '', t.time || '', t.cat || ''].filter(Boolean).join(' · ');
    const check = checkEl(done, v => { setDone(t, key, v); paint(); }, `${t.title} 완료`);
    check.classList.add('round');
    return h('div', { class: 'qi' + (done ? ' done' : ''), 'data-id': t.id },
      check,
      h('button', { class: 'qi-body', type: 'button', title: '눌러서 수정', onclick: () => editTask(t, () => paint()) }, h('span', { class: 'qi-title' }, t.title), sub ? h('span', { class: 'qi-sub' }, sub) : null),
      t.mode === 'nag' && !done ? h('span', { class: 'qi-ico', title: '독촉' }, icon('bell', 14)) : null,
      t.kind === 'daily' ? h('span', { class: 'qi-ico', title: '매일 반복' }, icon('refresh', 14)) : null,
      h('span', { class: 'qi-grip', 'data-noswipe': '', role: 'button', tabindex: '-1', 'aria-label': '끌어서 다른 칸으로 옮기기', title: '끌어서 다른 칸으로 옮기기', onpointerdown: e => startDrag(e, t) }, icon('menu', 16, 1.6)));
  }
  function quadCard([q, name], k) {
    const list = itemsOf(q, k), left = list.filter(x => !isDone(x.t, x.key)).length;
    const inp = h('input', { class: 'input qa-in', placeholder: `${name} 적고 Enter`, 'aria-label': `${name}에 추가`, onkeydown: e => {
      if (e.key === 'Escape') { inp.value = ''; addBox.classList.remove('open'); return; }
      if (e.key !== 'Enter' || e.isComposing) return;
      const t = inp.value.trim(); if (!t) return;
      const made = addTask({ title: t, kind: 'once', date: k, quad: q, cat: filter !== '전체' && filter !== '공통' ? filter : '' });
      inp.value = '';
      paint(made.id, q); // keep this box's input open for the next one
    } });
    inp.addEventListener('blur', () => { if (!inp.value.trim()) setTimeout(() => addBox.classList.remove('open'), 120); });
    const addBox = h('div', { class: 'fold qa' }, h('div', null, inp));
    return h('section', { class: 'quad glass', 'data-q': q },
      h('div', { class: 'quad-head' }, h('h2', { class: 'quad-title' }, name), left ? h('span', { class: 'quad-count num' }, left) : null,
        h('button', { class: 'btn-icon sm quad-add', 'aria-label': `${name}에 추가`, title: '추가', onclick: () => { addBox.classList.add('open'); setTimeout(() => inp.focus(), 60); } }, icon('plus', 18))),
      addBox,
      list.length ? h('div', { class: 'quad-list' }, list.map(x => itemRow(x, k))) : h('div', { class: 'quad-empty' }, '할 일 없음'));
  }

  // dragging a task by its handle to another box: it lifts and follows the finger, the box under it lights
  // up, and on release it settles into its new place
  function startDrag(e, t) {
    if (e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    const row = e.currentTarget.closest('.qi');
    const r = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('qi-ghost');
    Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
    document.body.append(ghost);
    row.classList.add('lifted');
    const x0 = e.clientX, y0 = e.clientY;
    let over = null;
    const move = m => {
      ghost.style.transform = `translate(${m.clientX - x0}px, ${m.clientY - y0}px) scale(1.03)`;
      const box = document.elementFromPoint(m.clientX, m.clientY)?.closest('.quad');
      if (box !== over) { over?.classList.remove('drop-on'); over = box; over?.classList.add('drop-on'); }
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      over?.classList.remove('drop-on');
      const to = over?.dataset.q;
      if (to && to !== quadOf(t)) {
        if (to === 'now') delete t.quad; else t.quad = to;
        commit('tasks');
        const from = ghost.getBoundingClientRect();
        ghost.remove();
        paint(t.id, null, from);
        return;
      }
      // dropped where it was: glide back into its slot
      row.classList.remove('lifted');
      const back = ghost.animate([{ transform: ghost.style.transform }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.25,.9,.3,1)' });
      back.onfinish = () => ghost.remove();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  // repaint; a just-added or just-moved task eases into its spot (from where it was dropped, if dragged)
  function paint(focusId, keepOpen, from) {
    const k = dkey();
    const st = dayStats(k);
    head.replaceChildren(h('h1', { class: 'h1' }, '할 일'), h('span', { class: 'chip line' }, fmtDay(k)),
      h('span', { class: 'chip ink num' }, `${st.done}/${st.total} · ${Math.round(st.pct)}%`));
    paintFilter();

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

    board.replaceChildren(...QUADS.map(q => quadCard(q, k)));
    if (keepOpen) { const box = board.querySelector(`.quad[data-q="${keepOpen}"]`); box?.querySelector('.qa').classList.add('open'); box?.querySelector('.qa-in')?.focus(); }
    const landed = focusId && board.querySelector(`.qi[data-id="${focusId}"]`);
    if (!landed) return;
    if (from) {
      const to = landed.getBoundingClientRect();
      landed.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`, boxShadow: 'var(--shadow-lg)' }, { transform: 'none', boxShadow: 'none' }], { duration: 380, easing: 'cubic-bezier(.25,.9,.3,1)' });
    } else landed.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.25,.9,.3,1)' });
  }

  paint();
  ctx.on('change', w => { if (w === 'tasks' && !board.contains(document.activeElement)) { paint(); paintCatChips(); } });
  ctx.on('newday', () => paint());
  el.append(head, filterBar, overdueBox, board, form, ladder);
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
