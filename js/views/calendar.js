// calendar.js — 시간표 first, swipe over for the month: 일정 · 할 일 · 루틴 · 디데이, the month swipes sideways,
// plus the "이미지 캘린더": drop a schedule photo above the grid and Claude reads it into events.
import {
  h, icon, store, commit, uid, dkey, addDays, fromKey, fmtDay, fmtShort, monthKey, WEEK, seg, checkEl, toast, modal, upload, pickFiles,
  tasksOn, isDone, setDone, addTask, removeTask, gainXP, ai, jsonOf, aiFail, urlToBlock, obj, ddayLabel, ddayN,
} from '../core.js';
import { editEvent, editTask } from './edit-item.js';
import { openViewer } from '../viewer.js';
import timetable from './timetable.js';
import { pager } from '../pager.js';

function bigMonth(ym, sel, onPick) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = addDays(dkey(first), -first.getDay());
  const today = dkey();
  const s = store.s;
  const grid = h('div', { class: 'cal-grid cal-big' }, WEEK.map((w, i) => h('div', { class: 'cal-dow' + (i === 0 ? ' sun' : '') }, w)));
  for (let i = 0; i < 42; i++) {
    const k = addDays(start, i), d = fromKey(k);
    if (i >= 35 && d.getMonth() !== m - 1) break;
    const evs = s.events.filter(e => e.date === k).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    const todos = s.tasks.filter(t => t.kind === 'once' && t.date === k);
    const routines = tasksOn(k).filter(t => t.kind === 'daily');
    const dds = (s.ddays || []).filter(x => x.date === k);
    // tapping an item in the month grid opens its editor (tapping the empty part of the day selects it)
    const open = fn => ev => { ev.stopPropagation(); onPick(k); fn(); };
    const items = [
      ...dds.map(x => h('div', { class: 'cal-ev dday' }, `${x.title}`)),
      ...evs.map(e => h('div', { class: 'cal-ev' + (e.source === 'image' ? ' ai' : ''), title: '눌러서 수정', onclick: open(() => editEvent(e, () => onPick(k))) }, (e.time ? e.time + ' ' : '') + e.title)),
      ...todos.map(t => h('div', { class: 'cal-ev todo', title: '눌러서 수정', onclick: open(() => editTask(t, () => onPick(k))) }, (isDone(t, k) ? '✓ ' : '') + t.title)),
    ];
    const max = 3;
    grid.append(h('button', {
      class: 'cal-cell' + (d.getMonth() !== m - 1 ? ' other' : '') + (k === today ? ' today' : '') + (k === sel ? ' sel' : '') + (dds.length ? ' has-dday' : ''),
      onclick: () => onPick(k), 'aria-label': `${d.getMonth() + 1}월 ${d.getDate()}일`,
    }, h('span', { class: 'd' }, d.getDate()), items.slice(0, max),
      items.length > max ? h('div', { class: 'cal-more' }, `+${items.length - max}`) : null,
      // phones show dots instead of squeezed titles; the day panel below lists them
      evs.length || todos.length ? h('span', { class: 'cal-dots' }, evs.slice(0, 3).map(() => h('i')), todos.slice(0, 2).map(() => h('i', { class: 'r' }))) : null,
      routines.length && items.length < max ? h('div', { class: 'cal-ev routine' }, `루틴 ${routines.filter(t => isDone(t, k)).length}/${routines.length}`) : null));
  }
  return grid;
}

const EXTRACT = obj({
  summary: { type: 'string', description: '이미지에서 무엇을 읽었는지 한 문장 요약' },
  items: {
    type: 'array', items: obj({
      title: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD. 매주 반복이면 첫 날짜' },
      time: { type: 'string', description: 'HH:MM, 없으면 빈 문자열' },
      kind: { type: 'string', enum: ['event', 'todo', 'routine'] },
      days: { type: 'array', items: { type: 'integer' }, description: 'routine일 때 반복 요일(0=일…6=토), 아니면 빈 배열' },
      note: { type: 'string' },
    }),
  },
});

export default {
  id: 'calendar', title: '캘린더', icon: 'calendar',
  // 시간표 comes first and the month is one swipe over: #calendar, #calendar/month, #calendar/<date>
  // (#timetable still lands here)
  render(el, ctx, arg) {
    const toMonth = arg === 'month' || /^\d{4}-\d{2}-\d{2}$/.test(arg || '');
    const pg = pager(ctx, [
      { id: 'timetable', title: '시간표', render: b => timetable.render(b, ctx) },
      { id: 'month', title: '캘린더', render: b => renderMonth(b, ctx, arg) },
    ], { start: toMonth ? 1 : 0, base: 'calendar' });
    el.append(pg.el);
  },
};

function renderMonth(el, ctx, arg) {
  {
    el.classList.add('stagger');
    const s = store.s;
    s.ddays ||= [];
    let sel = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : dkey();
    let ym = sel.slice(0, 7);

    const head = h('div', { class: 'cal-head' });
    const imgBox = h('div', { class: 'cal-img' });
    // the month moves sideways with a finger or the mouse; the tab's own page swipe leaves it alone
    const gridBox = h('section', { class: 'glass card cal-swipe', 'data-noswipe': '' });
    const panel = h('aside', { class: 'day-panel' });

    // slide the month out one way and the next one in from the other side
    const EASE = 'cubic-bezier(.2, .9, .3, 1)';
    function slideMonth(dir, from = 0) {
      const [y, m] = ym.split('-').map(Number);
      const old = gridBox.firstChild;
      const swap = () => {
        ym = monthKey(new Date(y, m - 1 + dir, 1));
        paintHead(); paintImage(); paintGrid();
        gridBox.firstChild?.animate([{ transform: `translateX(${dir * 28}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: EASE });
      };
      if (!old || matchMedia('(prefers-reduced-motion: reduce)').matches) return swap();
      const a = old.animate([{ transform: `translateX(${from}px)`, opacity: Math.max(0.4, 1 - Math.abs(from) / 500) }, { transform: `translateX(${-dir * 28}%)`, opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = swap;
    }
    let sw = null;
    gridBox.addEventListener('pointerdown', e => { if (e.button > 0) return; sw = { x: e.clientX, y: e.clientY, t: Date.now(), on: false, dead: false }; });
    const swMove = e => {
      if (!sw || sw.dead) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      if (!sw.on) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw.dead = true; return; }
        if (Math.abs(dx) < 10) return;
        sw.on = true; gridBox.classList.add('dragging'); getSelection().removeAllRanges();
      }
      const g = gridBox.firstChild;
      if (g) { g.style.transform = `translateX(${dx}px)`; g.style.opacity = String(Math.max(0.4, 1 - Math.abs(dx) / 500)); }
    };
    const swEnd = e => {
      if (!sw) return;
      const d = sw; sw = null;
      if (!d.on) return;
      gridBox.classList.remove('dragging');
      const g = gridBox.firstChild, dx = e.type === 'pointercancel' ? 0 : e.clientX - d.x;
      const fast = Math.abs(dx) / Math.max(1, Date.now() - d.t) > 0.5;
      if (g) { g.style.transform = ''; g.style.opacity = ''; }
      if (Math.abs(dx) > 60 || (fast && Math.abs(dx) > 20)) slideMonth(dx < 0 ? 1 : -1, dx);
      else g?.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 450, easing: EASE });
      // the drag shouldn't also pick the day it started on
      const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
      gridBox.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => gridBox.removeEventListener('click', stop, { capture: true }), 50);
    };
    window.addEventListener('pointermove', swMove); window.addEventListener('pointerup', swEnd); window.addEventListener('pointercancel', swEnd);
    ctx.cleanup(() => { window.removeEventListener('pointermove', swMove); window.removeEventListener('pointerup', swEnd); window.removeEventListener('pointercancel', swEnd); });

    function paintHead() {
      const [y, m] = ym.split('-').map(Number);
      head.replaceChildren(
        h('button', { class: 'btn-icon glass-btn', 'aria-label': '이전 달', onclick: () => slideMonth(-1) }, icon('left')),
        h('span', { class: 'month num' }, `${y}년 ${m}월`),
        h('button', { class: 'btn-icon glass-btn', 'aria-label': '다음 달', onclick: () => slideMonth(1) }, icon('right')),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { sel = dkey(); ym = monthKey(); paintAll(); } }, '오늘'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'small muted' }, s.settings.ntfyTopic ? `일정 당일 ${s.settings.briefHour}시에 휴대폰으로 알려 드려요` : '휴대폰 알림은 설정에서 연결할 수 있어요'));
    }

    // ----- image calendar -----
    function paintImage() {
      const img = s.calImages[ym];
      if (!img) {
        const dz = h('div', { class: 'dropzone', role: 'button', tabindex: '0', onclick: () => pick(), onkeydown: e => { if (e.key === 'Enter') pick(); } },
          icon('image', 28), h('div', { class: 'grow' }, h('b', { style: { color: 'var(--fg)' } }, '이 달의 캘린더 이미지 넣기'), h('div', { class: 'small' }, '학사일정, 근무표, 시간표 사진을 넣으면 달력 위에 보이고, Claude가 읽어서 일정으로 만들어 줘요.')),
          h('span', { class: 'chip' }, '이미지 선택'));
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('over'));
        dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (f) setImage(f); });
        imgBox.replaceChildren(dz);
        return;
      }
      imgBox.replaceChildren(h('div', { class: 'img-cal glass' },
        h('img', { src: img.url, alt: '이 달의 캘린더 이미지', title: '눌러서 크게 보기', onclick: () => openViewer(img.url, { alt: '이 달의 캘린더 이미지' }) }),
        h('button', { class: 'btn btn-glass btn-sm img-zoom', onclick: () => openViewer(img.url, { alt: '이 달의 캘린더 이미지' }) }, icon('search', 15), '크게 보기'),
        h('div', { class: 'img-actions' },
          h('button', { class: 'btn btn-ink btn-sm', onclick: e => analyze(e.currentTarget) }, icon('sparkle', 15), img.analyzed ? 'Claude로 다시 읽기' : 'Claude로 일정 읽기'),
          h('button', { class: 'btn btn-glass btn-sm', onclick: () => pick() }, '바꾸기'),
          h('button', { class: 'btn btn-glass btn-sm', onclick: () => { delete s.calImages[ym]; commit('calimg'); paintImage(); } }, '삭제'))));
    }
    async function pick() { const [f] = await pickFiles({ accept: 'image/*' }); if (f) setImage(f); }
    async function setImage(file) {
      try {
        const up = await upload(file);
        s.calImages[ym] = { url: up.url, name: file.name, analyzed: false };
        commit('calimg'); gainXP('calendar'); paintImage();
        toast('이미지를 넣었어요. "Claude로 일정 읽기"를 누르면 일정으로 만들어 줘요.', { icon: 'image' });
      } catch (e) { toast(e.message); }
    }
    async function analyze(btn) {
      const img = s.calImages[ym];
      btn.disabled = true; const label = btn.innerHTML; btn.textContent = 'Claude가 읽는 중…';
      try {
        const [y, m] = ym.split('-');
        const resp = await ai({
          effort: 'medium', max_tokens: 12000, format: EXTRACT,
          system: '너는 캘린더·시간표·일정표 이미지를 읽어 일정 데이터로 바꾸는 도우미다. 이미지에 실제로 적힌 일정만 뽑고, 없는 일정을 지어내지 않는다. 연도가 없으면 보고 있는 달의 연도를 쓴다. 매주 반복되는 수업·근무는 routine, 마감·제출처럼 해야 할 일은 todo, 나머지 약속·행사는 event로 분류한다.',
          messages: [{ role: 'user', content: [await urlToBlock(img.url), { type: 'text', text: `오늘은 ${dkey()}이고, 사용자는 ${y}년 ${Number(m)}월 달력을 보고 있다. 이 이미지에서 일정을 모두 찾아 줘.` }] }],
        });
        const data = jsonOf(resp);
        img.analyzed = true; commit('calimg');
        review(data);
      } catch (e) { aiFail(e); }
      finally { btn.disabled = false; btn.innerHTML = label; }
    }
    function review(data) {
      const items = (data.items || []).filter(x => x.title && /^\d{4}-\d{2}-\d{2}$/.test(x.date));
      if (!items.length) { toast('이미지에서 일정을 찾지 못했어요.'); return; }
      const picked = new Set(items.map((_, i) => i));
      const kindName = { event: '일정', todo: '할 일', routine: '루틴' };
      modal({
        title: `일정 ${items.length}개를 찾았어요`, wide: true,
        body: h('div', { class: 'col' },
          data.summary ? h('p', { class: 'small muted', style: { margin: 0 } }, data.summary) : null,
          h('div', null, items.map((x, i) => h('div', { class: 'item-row' },
            checkEl(true, v => { v ? picked.add(i) : picked.delete(i); }, x.title),
            h('span', { class: 'chip sm line num' }, x.date.slice(5).replace('-', '/') + (x.time ? ' ' + x.time : '')),
            h('span', { class: 'grow' }, x.title, x.note ? h('span', { class: 'small muted' }, ` · ${x.note}`) : null),
            h('span', { class: 'chip sm' }, kindName[x.kind] + (x.kind === 'routine' && x.days?.length ? ` ${x.days.map(d => WEEK[d]).join('')}` : ''))))),
          h('p', { class: 'small muted', style: { margin: 0 } }, '체크한 항목만 캘린더에 추가돼요. 일정이 있는 날 아침에 휴대폰으로 알림이 가요.')),
        actions: [{ label: '취소' }, {
          label: '선택한 일정 추가', primary: true, onClick: () => {
            let n = 0;
            items.forEach((x, i) => {
              if (!picked.has(i)) return;
              if (x.kind === 'event') s.events.push({ id: uid(), title: x.title, date: x.date, time: x.time || '', note: x.note || '', source: 'image' });
              else addTask({ title: x.title, kind: x.kind === 'routine' ? 'daily' : 'once', date: x.date, time: x.time || undefined, days: x.kind === 'routine' ? x.days : undefined });
              n++;
            });
            commit('events'); gainXP('calendar');
            toast(`${n}개를 캘린더에 넣었어요.`, { icon: 'calendar' });
            paintAll();
          },
        }],
      });
    }

    // ----- grid & day panel -----
    function paintGrid() { gridBox.replaceChildren(bigMonth(ym, sel, k => { sel = k; if (k.slice(0, 7) !== ym) ym = k.slice(0, 7); paintAll(); })); }
    function paintPanel() {
      const k = sel;
      const evs = s.events.filter(e => e.date === k).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
      const list = tasksOn(k);
      const f = { type: 'event', mode: 'normal', days: [fromKey(k).getDay()] };
      const title = h('input', { class: 'input', placeholder: '제목', 'aria-label': '제목', onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) add(); } });
      const time = h('input', { class: 'input', type: 'time', 'aria-label': '시간', style: { width: '130px' } });
      const note = h('input', { class: 'input', placeholder: '메모 (장소, 준비물…)', 'aria-label': '메모' });
      const dayRow = h('div', { class: 'row wrap', style: { gap: '6px' }, hidden: true }, WEEK.map((w, i) => {
        const b = h('button', { class: 'chip sm ' + (f.days.includes(i) ? 'ink' : 'line'), onclick: () => { f.days = f.days.includes(i) ? f.days.filter(x => x !== i) : [...f.days, i]; b.className = 'chip sm ' + (f.days.includes(i) ? 'ink' : 'line'); } }, w);
        return b;
      }));
      const nagSeg = seg([['normal', '일반'], ['nag', '독촉']], 'normal', v => { f.mode = v; });
      nagSeg.hidden = true;
      const typeSeg = seg([['event', '일정'], ['todo', '할 일'], ['routine', '루틴']], 'event', v => { f.type = v; dayRow.hidden = v !== 'routine'; nagSeg.hidden = v === 'event'; note.hidden = v !== 'event'; });
      function add() {
        const t = title.value.trim(); if (!t) { title.focus(); return; }
        if (f.type === 'event') { s.events.push({ id: uid(), title: t, date: k, time: time.value, note: note.value.trim(), source: 'manual' }); commit('events'); gainXP('calendar'); }
        else addTask({ title: t, kind: f.type === 'routine' ? 'daily' : 'once', date: k, time: time.value || undefined, mode: f.mode, days: f.type === 'routine' && f.days.length < 7 ? f.days : undefined });
        toast('추가했어요.', { icon: 'check' });
        paintAll();
      }
      const dds = s.ddays.filter(x => x.date === k);
      panel.replaceChildren(
        h('section', { class: 'glass card col' },
          h('div', { class: 'row between' }, h('h2', { class: 'h2' }, fmtDay(k)), k === dkey() ? h('span', { class: 'chip sm ink' }, '오늘') : null),
          dds.map(x => h('div', { class: 'dday-line' }, icon('flag', 15), h('b', null, x.title), h('span', { class: 'chip sm ink num' }, ddayLabel(x.date)))),
          evs.length || list.length ? h('div', null,
            evs.map(e => h('div', { class: 'item-row' }, h('span', { class: 'type-dot' }), h('span', { class: 'chip sm line num' }, e.time || '종일'),
              h('button', { class: 'grow item-edit', title: '눌러서 수정', onclick: () => editEvent(e, paintAll) }, e.title, e.note ? h('div', { class: 'small muted' }, e.note) : null, e.source === 'image' ? h('div', { class: 'tiny muted' }, '이미지에서 읽은 일정') : null),
              h('button', { class: 'btn-icon sm', 'aria-label': '일정 수정', title: '수정', onclick: () => editEvent(e, paintAll) }, icon('pen', 15)),
              h('button', { class: 'btn-icon sm', 'aria-label': '일정 삭제', onclick: () => { s.events = s.events.filter(x => x !== e); commit('events'); paintAll(); } }, icon('trash', 15)))),
            list.map(t => h('div', { class: 'item-row' },
              checkEl(isDone(t, k), v => { setDone(t, k, v); paintGrid(); }, t.title),
              h('button', { class: 'grow item-edit', title: '눌러서 수정', onclick: () => editTask(t, paintAll) }, t.title, h('span', { class: 'small muted' }, t.kind === 'daily' ? ' · 루틴' : ' · 할 일')),
              t.mode === 'nag' ? h('span', { class: 'nag-badge' }, icon('bell', 11), '독촉') : null,
              t.time ? h('span', { class: 'chip sm line num' }, t.time) : null,
              h('button', { class: 'btn-icon sm', 'aria-label': '수정', title: '수정', onclick: () => editTask(t, paintAll) }, icon('pen', 15)),
              h('button', { class: 'btn-icon sm', 'aria-label': '삭제', onclick: () => { removeTask(t); paintAll(); } }, icon('trash', 15)))))
            : h('div', { class: 'empty' }, icon('calendar', 28), '이 날은 비어 있어요.')),
        h('section', { class: 'glass card col' },
          h('h3', { class: 'h3' }, '추가하기'), typeSeg, title, h('div', { class: 'row wrap' }, time, nagSeg), dayRow, note,
          h('button', { class: 'btn btn-ink', onclick: add }, icon('plus', 16), '이 날에 추가')),
        ddayCard(k));
    }

    // ----- 디데이: count down to (or up from) a date; the nearest ones also show on 홈 under the weather -----
    function ddayCard(k) {
      const name = h('input', { class: 'input', placeholder: '예: 수능, 여행, 기념일', 'aria-label': '디데이 이름', maxlength: 20, onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) addDday(); } });
      const date = h('input', { class: 'input', type: 'date', value: k, 'aria-label': '디데이 날짜', style: { width: '160px' } });
      function addDday() {
        const t = name.value.trim();
        if (!t) { name.focus(); return; }
        if (!date.value) { toast('날짜를 고르세요.'); return; }
        s.ddays.push({ id: uid(), title: t, date: date.value });
        commit('ddays'); toast(`${t} ${ddayLabel(date.value)}를 만들었어요. 홈에서도 보여요.`, { icon: 'flag' });
        paintGrid(); paintPanel();
      }
      // upcoming first (nearest on top), then the ones already past
      const list = [...s.ddays].sort((a, b) => (ddayN(a.date) < 0) - (ddayN(b.date) < 0) || Math.abs(ddayN(a.date)) - Math.abs(ddayN(b.date)));
      return h('section', { class: 'glass card col' },
        h('div', { class: 'row between' }, h('h3', { class: 'h3' }, '디데이'), h('span', { class: 'small muted' }, '홈 화면에도 보여요')),
        list.length ? h('div', null, list.map(x => h('div', { class: 'item-row' },
          h('span', { class: 'chip sm ' + (ddayN(x.date) === 0 ? 'ink' : 'line') + ' num' }, ddayLabel(x.date)),
          h('button', { class: 'grow item-edit', title: '이 날로 가기', onclick: () => { sel = x.date; ym = x.date.slice(0, 7); paintAll(); } }, x.title, h('div', { class: 'tiny muted' }, fmtShort(x.date))),
          h('button', { class: 'btn-icon sm', 'aria-label': `${x.title} 디데이 삭제`, onclick: () => { s.ddays = s.ddays.filter(y => y !== x); commit('ddays'); paintGrid(); paintPanel(); } }, icon('trash', 15))))) : null,
        h('div', { class: 'row wrap' }, h('div', { class: 'grow', style: { minWidth: '140px' } }, name), date),
        h('button', { class: 'btn btn-ghost', onclick: addDday }, icon('flag', 16), '디데이 만들기'));
    }
    function paintAll() { paintHead(); paintImage(); paintGrid(); paintPanel(); }
    paintAll();
    ctx.on('change', w => { if (['tasks', 'events', 'ddays'].includes(w)) { paintGrid(); paintPanel(); } });

    el.append(h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '캘린더')), head,
      h('div', { class: 'cal-layout' }, h('div', { class: 'col', style: { gap: '12px', minWidth: 0 } }, imgBox, gridBox), panel));
  }
}
