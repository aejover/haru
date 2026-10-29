// edit-item.js — edit an 일정 (event), 할 일 (once task) or 루틴 (daily task) after it was added.
import { h, store, commit, modal, seg, toast, confirmDialog, removeTask, WEEK, dkey } from '../core.js';

const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);

// pick which 목표 a task belongs to (goals still in progress, plus the one it's already on)
export function goalSelect(value = '') {
  const list = (store.s.goals || []).filter(g => g.id === value || (!g.achieved && g.end >= dkey()));
  const sel = h('select', { class: 'select', 'aria-label': '연결할 목표' }, h('option', { value: '' }, '목표 없음'), list.map(g => h('option', { value: g.id, selected: g.id === value }, g.title)));
  sel.hidden = !list.length;
  return sel;
}

// 미리 알림: how long before a timed 할 일 to send a reminder. '' = the default from 설정 (1시간 전 out of the box)
export const REMINDS = [[0, '정시'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전'], [120, '2시간 전'], [-1, '알림 없음']];
export const remindLabel = m => REMINDS.find(r => r[0] === Number(m))?.[1] || `${m}분 전`;
export function remindSelect(value) {
  const def = store.s.settings.taskLead ?? 60;
  return h('select', { class: 'select', 'aria-label': '미리 알림' },
    h('option', { value: '', selected: value == null }, `기본 (${remindLabel(def)})`),
    REMINDS.map(([v, l]) => h('option', { value: v, selected: value != null && Number(value) === v }, l)));
}
// 할 일 종류: typed freely (운동, 공부, 일, 개인…); left empty, the task is 공통
export const CAT_EXAMPLES = ['운동', '공부', '일', '개인'];
export const usedCats = () => [...new Set(store.s.tasks.map(t => t.cat).filter(Boolean))];
export function catInput(value = '', placeholder = '예: 운동 · 비우면 공통') {
  const id = 'cats-' + Math.random().toString(36).slice(2, 8);
  const list = h('datalist', { id }, [...new Set([...usedCats(), ...CAT_EXAMPLES])].map(c => h('option', { value: c })));
  const inp = h('input', { class: 'input', value, list: id, maxlength: 12, placeholder, 'aria-label': '할 일 종류' });
  return [inp, list]; // put both in the form: the list offers the kinds already used
}

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
  const goal = goalSelect(t.goalId || '');
  const [cat, catList] = catInput(t.cat || '');
  const remind = remindSelect(t.remind);
  modal({
    title: t.kind === 'daily' ? '반복 할 일 수정' : '할 일 수정',
    body: h('div', { class: 'col' },
      field('제목', title),
      h('div', { class: 'row wrap' }, seg([['once', '할 일 (한 번)'], ['daily', '매일 반복']], v.kind, k => { v.kind = k; sync(); }), seg([['normal', '일반'], ['nag', '독촉']], v.mode, m => { v.mode = m; })),
      h('div', { class: 'grid-2' }, dateField, field('시간 (선택)', time)),
      daysField,
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', null, '종류'), cat, catList), field('미리 알림 (시간이 있을 때)', remind)),
      goal.hidden ? null : field('목표와 연결', goal)),
    actions: [
      { label: '삭제', danger: true, onClick: async () => { if (!(await confirmDialog(`"${t.title}"을(를) 삭제할까요?`, { ok: '삭제', danger: true }))) return false; removeTask(t); onDone?.(); } },
      { label: '취소' },
      { label: '저장', primary: true, onClick: () => {
        if (!title.value.trim()) { toast('제목을 입력하세요.'); title.focus(); return false; }
        t.title = title.value.trim();
        t.mode = v.mode;
        if (time.value) t.time = time.value; else delete t.time;
        if (goal.value) t.goalId = goal.value; else delete t.goalId;
        if (cat.value.trim()) t.cat = cat.value.trim(); else delete t.cat;
        if (remind.value !== '') t.remind = Number(remind.value); else delete t.remind;
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
