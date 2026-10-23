// edit-item.js — edit an 일정 (event), 할 일 (once task) or 루틴 (daily task) after it was added.
import { h, store, commit, modal, seg, toast, confirmDialog, removeTask, WEEK, dkey } from '../core.js';

const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);

export function editEvent(ev, onDone) {
  const title = h('input', { class: 'input', value: ev.title });
  const date = h('input', { class: 'input', type: 'date', value: ev.date });
  const time = h('input', { class: 'input', type: 'time', value: ev.time || '' });
  const note = h('input', { class: 'input', value: ev.note || '', placeholder: '장소, 준비물…' });
  modal({
    title: '일정 수정',
    body: h('div', { class: 'col' }, field('제목', title), h('div', { class: 'grid-2' }, field('날짜', date), field('시간 (비우면 종일)', time)), field('메모', note)),
    actions: [
      { label: '삭제', danger: true, onClick: async () => { if (!(await confirmDialog(`"${ev.title}" 일정을 삭제할까요?`, { ok: '삭제', danger: true }))) return false; store.s.events = store.s.events.filter(x => x !== ev); commit('events'); onDone?.(); } },
      { label: '취소' },
      { label: '저장', primary: true, onClick: () => {
        if (!title.value.trim()) { toast('제목을 입력하세요.'); title.focus(); return false; }
        if (!date.value) { toast('날짜를 고르세요.'); return false; }
        Object.assign(ev, { title: title.value.trim(), date: date.value, time: time.value, note: note.value.trim() });
        commit('events'); toast('일정을 고쳤어요.'); onDone?.();
      } },
    ],
  });
}

export function editTask(t, onDone) {
  const v = { kind: t.kind, mode: t.mode || 'normal', days: [...(t.days || [])] };
  const title = h('input', { class: 'input', value: t.title });
  const date = h('input', { class: 'input', type: 'date', value: t.date || dkey() });
  const time = h('input', { class: 'input', type: 'time', value: t.time || '' });
  const dateField = field('날짜', date);
  const dayRow = h('div', { class: 'row wrap', style: { gap: '6px' } });
  const paintDays = () => dayRow.replaceChildren(WEEK.map((w, i) => h('button', {
    class: 'chip sm ' + (v.days.includes(i) ? 'ink' : 'line'), type: 'button',
    onclick: () => { v.days = v.days.includes(i) ? v.days.filter(x => x !== i) : [...v.days, i].sort(); paintDays(); },
  }, w)));
  paintDays();
  const daysField = h('div', { class: 'field' }, h('span', null, '반복 요일 (아무것도 안 고르면 매일)'), dayRow);
  const sync = () => { dateField.hidden = v.kind !== 'once'; daysField.hidden = v.kind !== 'daily'; };
  sync();
  modal({
    title: t.kind === 'daily' ? '루틴 수정' : '할 일 수정',
    body: h('div', { class: 'col' },
      field('제목', title),
      h('div', { class: 'row wrap' }, seg([['once', '할 일 (한 번)'], ['daily', '루틴 (반복)']], v.kind, k => { v.kind = k; sync(); }), seg([['normal', '일반'], ['nag', '독촉']], v.mode, m => { v.mode = m; })),
      h('div', { class: 'grid-2' }, dateField, field('시간 (선택)', time)),
      daysField),
    actions: [
      { label: '삭제', danger: true, onClick: async () => { if (!(await confirmDialog(`"${t.title}"을(를) 삭제할까요?`, { ok: '삭제', danger: true }))) return false; removeTask(t); onDone?.(); } },
      { label: '취소' },
      { label: '저장', primary: true, onClick: () => {
        if (!title.value.trim()) { toast('제목을 입력하세요.'); title.focus(); return false; }
        t.title = title.value.trim();
        t.mode = v.mode;
        if (time.value) t.time = time.value; else delete t.time;
        if (v.kind === 'once') {
          if (t.kind === 'daily') { t.start = date.value || dkey(); delete t.end; }
          t.kind = 'once'; t.date = date.value || dkey(); delete t.days;
        } else {
          if (t.kind === 'once') { t.start = t.date && t.date < dkey() ? t.date : dkey(); delete t.date; }
          t.kind = 'daily';
          if (v.days.length && v.days.length < 7) t.days = v.days; else delete t.days;
        }
        delete t.example;
        commit('tasks'); toast('고쳤어요.'); onDone?.();
      } },
    ],
  });
}
