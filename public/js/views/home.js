// home.js — first screen: clock, weather, mail, motto, time-progress, today's tasks ⇄ calendar.
import {
  h, icon, store, commit, bus, dkey, addDays, fromKey, fmtDay, pad, WEEK, monthKey, toast, seg, checkEl,
  tasksOn, isDone, setDone, addTask, removeTask, dayStats, desktopNotify,
} from '../core.js';
import { getWeather } from '../weather.js';
import { editTask, editEvent } from './edit-item.js';
import { googleConfigured, googleLinked, googleSignIn, gmailSummary } from '../google.js';

export function taskRow(t, k, { onChange } = {}) {
  const done = isDone(t, k);
  const row = h('div', { class: 'task-row' + (done ? ' done' : '') },
    checkEl(done, v => { setDone(t, k, v); row.classList.toggle('done', v); onChange?.(); }, `${t.title} 완료`),
    h('span', { class: 't-title editable', role: 'button', tabindex: '0', title: '눌러서 수정', onclick: () => editTask(t, onChange), onkeydown: e => { if (e.key === 'Enter') editTask(t, onChange); } }, t.title),
    h('span', { class: 'meta' },
      t.example ? h('span', { class: 'ex-tag' }, '예시') : null,
      t.time ? h('span', { class: 'chip sm line num' }, t.time) : null,
      t.mode === 'nag' ? h('span', { class: 'nag-badge', title: '독촉 모드: 할 때까지 알림' }, icon('bell', 12), '독촉') : null,
      h('button', { class: 'btn-icon sm del', 'aria-label': `${t.title} 삭제`, onclick: () => { removeTask(t); onChange?.(); } }, icon('x', 15))));
  return row;
}

export function miniMonth(ym, { onPick, selected, big = false } = {}) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startKey = addDays(dkey(first), -first.getDay());
  const today = dkey();
  const grid = h('div', { class: 'cal-grid' + (big ? ' cal-big' : '') }, WEEK.map((w, i) => h('div', { class: 'cal-dow' + (i === 0 ? ' sun' : '') }, w)));
  for (let i = 0; i < 42; i++) {
    const k = addDays(startKey, i);
    const d = fromKey(k);
    if (i >= 35 && d.getMonth() !== m - 1) break;
    const evs = store.s.events.filter(e => e.date === k);
    const once = store.s.tasks.filter(t => t.kind === 'once' && t.date === k);
    grid.append(h('button', {
      class: 'cal-cell' + (d.getMonth() !== m - 1 ? ' other' : '') + (k === today ? ' today' : '') + (k === selected ? ' sel' : ''),
      onclick: () => onPick?.(k), 'aria-label': `${d.getMonth() + 1}월 ${d.getDate()}일, 일정 ${evs.length}개`,
    }, h('span', { class: 'd' }, d.getDate()),
      h('span', { class: 'dots-row' }, evs.slice(0, 3).map(() => h('i')), once.slice(0, 2).map(() => h('i', { class: 'r' })))));
  }
  return grid;
}

export default {
  id: 'home', title: '홈', icon: 'home',
  render(el, ctx) {
    el.classList.add('home', 'stagger');
    const s = store.s;

    // ----- clock & weather -----
    const clock = h('h1', { class: 'clock', 'aria-live': 'off' });
    const dateEl = h('div', { class: 'hero-date' });
    const weather = h('button', { class: 'weather', title: '눌러서 새로고침', onclick: () => loadWeather(true) }, h('span', null, '날씨 불러오는 중…'));
    const tick = () => {
      const d = new Date();
      clock.innerHTML = `${pad(d.getHours())}:${pad(d.getMinutes())}<span class="sec">${pad(d.getSeconds())}</span>`;
      dateEl.textContent = fmtDay(dkey(d), true);
    };
    tick(); ctx.every(1000, tick);
    async function loadWeather(force) {
      try {
        const w = await getWeather(force);
        weather.replaceChildren(icon(w.icon, 18), h('span', { class: 'temp num' }, `${w.temp}°`), h('span', null, `${w.desc} · ${w.place}`),
          h('span', { class: 'num' }, `최고 ${w.max}° 최저 ${w.min}°`),
          w.alert ? h('span', { class: 'alert' }, icon(w.alert.kind, 14), w.alert.text) : null);
      } catch { weather.replaceChildren(icon('cloud', 18), h('span', null, '날씨를 불러오지 못했어요 · 다시 시도')); }
    }
    loadWeather(); ctx.every(20 * 60e3, () => loadWeather(true));

    // ----- mail -----
    const mail = h('div');
    async function loadMail(interactive) {
      if (!googleConfigured()) {
        mail.replaceChildren(h('a', { class: 'mail-strip glass', href: '#settings', style: { textDecoration: 'none' } }, icon('mail', 20), h('span', { class: 'grow small muted' }, 'Gmail을 연동하면 새 메일이 여기에 떠요'), icon('right', 16)));
        return;
      }
      if (!googleLinked()) {
        if (interactive) { try { await googleSignIn(); } catch (e) { toast(e.message); } }
        if (!googleLinked()) {
          mail.replaceChildren(h('button', { class: 'mail-strip glass', onclick: () => loadMail(true) }, icon('mail', 20), h('span', { class: 'grow small' }, 'Gmail 연결하고 새 메일 보기'), h('span', { class: 'chip sm ink' }, '연결')));
          return;
        }
      }
      try {
        const m = await gmailSummary();
        const box = h('div', { class: 'mail-strip glass', style: { flexDirection: 'column', alignItems: 'stretch', gap: '2px' } },
          h('div', { class: 'row' }, icon('mail', 20), h('span', { class: 'grow' }, m.unread ? h('span', null, '읽지 않은 메일 ', h('span', { class: 'count num' }, `${m.unread}통`)) : '새 메일이 없어요'),
            h('button', { class: 'btn-icon sm', 'aria-label': '메일 새로고침', onclick: () => loadMail() }, icon('refresh', 16)),
            h('a', { class: 'btn-icon sm', href: 'https://mail.google.com', target: '_blank', rel: 'noopener', 'aria-label': 'Gmail 열기' }, icon('external', 16))),
          m.recent.length ? h('div', { class: 'mail-list' }, m.recent.slice(0, 3).map(x => h('div', { class: 'mail-item' }, h('b', null, x.from), h('span', null, x.subject)))) : null);
        mail.replaceChildren(box);
        const seen = sessionStorage.getItem('haru.mailSeen');
        if (m.recent[0] && seen && seen !== m.recent[0].id) desktopNotify('새 메일', `${m.recent[0].from}: ${m.recent[0].subject}`);
        if (m.recent[0]) sessionStorage.setItem('haru.mailSeen', m.recent[0].id);
      } catch (e) {
        mail.replaceChildren(h('button', { class: 'mail-strip glass', onclick: () => loadMail(true) }, icon('mail', 20), h('span', { class: 'grow small muted' }, e.message), h('span', { class: 'chip sm' }, '다시 연결')));
      }
    }
    loadMail(); ctx.every(5 * 60e3, () => loadMail());
    ctx.on('google', () => loadMail());

    // ----- motto -----
    const motto = h('div', { class: 'motto-text', contenteditable: 'true', spellcheck: 'false', 'data-placeholder': '나를 움직이는 한마디를 적어 보세요', role: 'textbox', 'aria-label': '동기부여 문구' });
    motto.textContent = s.profile.motivation || '';
    motto.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); motto.blur(); } });
    motto.addEventListener('blur', () => { const v = motto.textContent.trim(); if (v !== s.profile.motivation) { s.profile.motivation = v; commit('profile'); toast('문구를 저장했어요.'); } });
    const mottoBox = h('div', { class: 'motto glass' }, h('span', { class: 'q', 'aria-hidden': 'true' }, '“'), motto, h('button', { class: 'btn-icon sm', 'aria-label': '문구 편집', onclick: () => { motto.focus(); document.getSelection().selectAllChildren(motto); document.getSelection().collapseToEnd(); } }, icon('pen', 16)));

    // ----- time progress -----
    const progress = h('section', { class: 'glass card progress-card', 'aria-label': '시간 진행률' });
    function paintProgress() {
      const n = new Date();
      const dayStart = new Date(n.getFullYear(), n.getMonth(), n.getDate());
      const wStart = new Date(dayStart); wStart.setDate(wStart.getDate() - ((wStart.getDay() + 6) % 7)); // Monday
      const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + 7);
      const yStart = new Date(n.getFullYear(), 0, 1), yEnd = new Date(n.getFullYear() + 1, 0, 1);
      const parts = [
        ['오늘', (n - dayStart) / 864e5],
        ['이번 주', (n - wStart) / (wEnd - wStart)],
        ['올해', (n - yStart) / (yEnd - yStart)],
      ];
      progress.replaceChildren(...parts.map(([lbl, f]) => {
        const p = f * 100;
        return h('div', { class: 'prog' }, h('span', { class: 'lbl' }, lbl),
          h('span', { class: 'pct' }, p.toFixed(1), h('small', null, '% 지남')),
          h('div', { class: 'bar thin' }, h('i', { style: { width: p + '%' } })),
          h('span', { class: 'rem' }, `${(100 - p).toFixed(1)}% 남음`));
      }));
    }
    paintProgress(); ctx.every(30e3, paintProgress);

    // ----- tasks ⇄ calendar -----
    const swipe = h('div', { class: 'swipe' });
    const dots = h('div', { class: 'dots' }, h('i', { class: 'on' }), h('i'));
    const tabs = seg([['0', '오늘 할 일 · 루틴'], ['1', '캘린더']], '0', v => swipe.scrollTo({ left: swipe.clientWidth * Number(v), behavior: 'smooth' }));
    const sum = h('span', { class: 'today-sum num' });
    const pageTasks = h('div', { class: 'swipe-page' });
    const pageCal = h('div', { class: 'swipe-page' });
    swipe.append(pageTasks, pageCal);
    const swipeCard = h('section', { class: 'glass card swipe-wrap' }, h('div', { class: 'swipe-tabs' }, tabs, h('span', { class: 'spacer' }), sum), swipe, dots);

    let calYM = monthKey();
    function paintTasks() {
      const k = dkey();
      const list = tasksOn(k);
      const routines = list.filter(t => t.kind === 'daily'), todos = list.filter(t => t.kind === 'once');
      const events = s.events.filter(e => e.date === k).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
      const st = dayStats(k), y = dayStats(addDays(k, -1));
      const diff = Math.round(st.pct - y.pct);
      sum.textContent = st.total ? `${st.done}/${st.total} 완료 · ${Math.round(st.pct)}%${y.total ? ` · 어제보다 ${diff >= 0 ? '+' : ''}${diff}%p` : ''}` : '';
      const kind = { v: 'once' }, nag = { v: false };
      const inp = h('input', { class: 'input', placeholder: '할 일 추가 (Enter)', 'aria-label': '새 할 일', onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) add(); } });
      const nagBtn = h('button', { class: 'btn-icon', title: '독촉 모드: 안 하면 계속 알림', 'aria-label': '독촉 모드', 'aria-pressed': 'false', onclick: () => { nag.v = !nag.v; nagBtn.classList.toggle('on', nag.v); nagBtn.setAttribute('aria-pressed', String(nag.v)); } }, icon('bell', 18));
      function add() {
        const title = inp.value.trim(); if (!title) return;
        addTask({ title, kind: kind.v, mode: nag.v ? 'nag' : 'normal' });
        if (nag.v) desktopNotify('독촉 모드 켜짐', `"${title}"을(를) 끝낼 때까지 알려 드릴게요.`);
        inp.value = ''; paintTasks(); paintCal();
        setTimeout(() => pageTasks.querySelector('input')?.focus(), 0);
      }
      const group = (label, ic, items) => items.length ? [h('div', { class: 'group-label' }, icon(ic, 14), label), ...items] : [];
      pageTasks.replaceChildren(
        ...group('루틴', 'refresh', routines.map(t => taskRow(t, k, { onChange: () => { paintTasks(); paintCal(); } }))),
        ...group('할 일', 'checklist', todos.map(t => taskRow(t, k, { onChange: () => { paintTasks(); paintCal(); } }))),
        ...group('오늘 일정', 'calendar', events.map(e => h('div', { class: 'task-row' }, h('span', { class: 'type-dot' }), h('span', { class: 't-title editable', role: 'button', tabindex: '0', title: '눌러서 수정', onclick: () => editEvent(e, () => { paintTasks(); paintCal(); }) }, e.title), e.time ? h('span', { class: 'chip sm line num' }, e.time) : null))),
        !list.length && !events.length ? h('div', { class: 'empty' }, icon('checklist', 32), '오늘 할 일이 비어 있어요. 아래에 첫 할 일을 적어 보세요.') : null,
        h('div', { class: 'quick-add' }, inp, seg([['once', '오늘만'], ['daily', '매일']], 'once', v => { kind.v = v; }), nagBtn, h('button', { class: 'btn btn-ink', onclick: add }, icon('plus', 16), '추가')));
    }
    function paintCal() {
      const [y, m] = calYM.split('-').map(Number);
      pageCal.replaceChildren(
        h('div', { class: 'row between', style: { marginBottom: '6px' } },
          h('button', { class: 'btn-icon sm', 'aria-label': '이전 달', onclick: () => { calYM = monthKey(new Date(y, m - 2, 1)); paintCal(); } }, icon('left', 18)),
          h('a', { class: 'h3', href: '#calendar', style: { textDecoration: 'none' } }, `${y}년 ${m}월`),
          h('button', { class: 'btn-icon sm', 'aria-label': '다음 달', onclick: () => { calYM = monthKey(new Date(y, m, 1)); paintCal(); } }, icon('right', 18))),
        miniMonth(calYM, { onPick: k => { location.hash = `calendar/${k}`; } }));
    }
    // ----- unfinished: past to-dos that were never checked off -----
    const pendingCard = h('section', { class: 'glass card col pending-card' });
    function paintPending() {
      const k = dkey();
      const late = s.tasks.filter(t => t.kind === 'once' && t.date && t.date < k && !isDone(t, t.date) && t.date >= addDays(k, -60))
        .sort((a, b) => b.date.localeCompare(a.date));
      pendingCard.replaceChildren(
        h('div', { class: 'row between' }, h('div', { class: 'row', style: { gap: '8px' } }, icon('flame', 18), h('h2', { class: 'h2' }, '아직 끝내지 못한 일')), late.length ? h('span', { class: 'chip sm ink num' }, `${late.length}개`) : null),
        late.length ? h('div', null, late.map(t => {
          const d = fromKey(t.date);
          const ago = Math.round((fromKey(k) - d) / 864e5);
          const row = h('div', { class: 'task-row' },
            checkEl(false, () => { setDone(t, t.date, true); row.classList.add('done', 'leaving'); setTimeout(paintPending, 450); paintTasks(); }, `${t.title} 완료`),
            h('span', { class: 't-title editable', role: 'button', tabindex: '0', title: '눌러서 수정', onclick: () => editTask(t, () => { paintPending(); paintTasks(); paintCal(); }) }, t.title),
            h('span', { class: 'meta' },
              h('span', { class: 'chip sm line num' }, `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]}) · ${ago === 1 ? '어제' : ago + '일 전'}`),
              t.mode === 'nag' ? h('span', { class: 'nag-badge' }, icon('bell', 12), '독촉') : null,
              h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { t.date = k; commit('tasks'); toast('오늘 할 일로 옮겼어요.'); paintPending(); paintTasks(); paintCal(); } }, '오늘로')));
          return row;
        })) : h('p', { class: 'small muted', style: { margin: 0 } }, '밀린 일이 없어요. 지난 날짜의 할 일을 끝내지 못하면 여기에 모여요.'));
    }
    paintTasks(); paintCal(); paintPending();
    ctx.on('change', w => { if (w === 'tasks') paintPending(); });
    ctx.on('newday', paintPending);
    swipe.addEventListener('scroll', () => {
      const i = Math.round(swipe.scrollLeft / Math.max(1, swipe.clientWidth));
      [...dots.children].forEach((d, j) => d.classList.toggle('on', i === j));
      tabs.set(String(i));
    }, { passive: true });
    // mouse drag to swipe on desktop
    let drag = null;
    swipe.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.target.closest('button, input, a, .cal-cell')) return;
      drag = { x: e.clientX, left: swipe.scrollLeft, moved: false }; swipe.classList.add('dragging');
    });
    const moveDrag = e => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; swipe.scrollLeft = drag.left - dx; };
    window.addEventListener('pointermove', moveDrag);
    ctx.cleanup(() => window.removeEventListener('pointermove', moveDrag));
    const endDrag = () => {
      if (!drag) return;
      swipe.classList.remove('dragging');
      const i = Math.round(swipe.scrollLeft / swipe.clientWidth);
      swipe.scrollTo({ left: i * swipe.clientWidth, behavior: 'smooth' });
      drag = null;
    };
    window.addEventListener('pointerup', endDrag);
    ctx.cleanup(() => window.removeEventListener('pointerup', endDrag));
    ctx.on('change', w => { if (['tasks', 'events'].includes(w)) { paintTasks(); paintCal(); } if (w === 'profile' && document.activeElement !== motto) motto.textContent = s.profile.motivation || ''; });
    ctx.on('newday', () => { paintTasks(); paintCal(); });

    el.append(
      h('section', { class: 'hero' }, clock, dateEl, weather),
      mail, mottoBox, progress, swipeCard, pendingCard);
    bus.emit('home-ready');
  },
};
