// alarm.js (view) — 알람 목록과 설정: 시간, 반복(한 번/매일/매주), 알람음, 수학 문제로 끄기, 다시 알림.
import { h, icon, store, commit, modal, seg, switchEl, toast, confirmDialog, WEEK } from '../core.js';
import { SOUNDS, preview, repeatText, untilText, newAlarm, fixDate, ring } from '../alarm.js';

const LEVELS = [['easy', '쉬움 (덧셈·뺄셈)'], ['normal', '보통 (곱셈 섞기)'], ['hard', '어려움 (두 자리 곱셈)']];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월 … 일

function editAlarm(a, isNew, onDone) {
  const v = JSON.parse(JSON.stringify(a));
  const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);
  const time = h('input', { class: 'input alarm-time-in num', type: 'time', value: v.time, 'aria-label': '알람 시각' });
  const label = h('input', { class: 'input', value: v.label, placeholder: '예: 기상, 약 먹기, 출근 준비' });
  const dayRow = h('div', { class: 'row wrap', style: { gap: '6px' } });
  const paintDays = () => dayRow.replaceChildren(ORDER.map(d => h('button', { type: 'button', class: 'chip sm ' + (v.days.includes(d) ? 'ink' : 'line'), onclick: () => { v.days = v.days.includes(d) ? v.days.filter(x => x !== d) : [...v.days, d]; paintDays(); } }, WEEK[d])));
  paintDays();
  const daysField = h('div', { class: 'field' }, h('span', null, '반복할 요일'), dayRow);
  daysField.hidden = v.repeat !== 'weekly';
  const sound = h('select', { class: 'select', 'aria-label': '알람음', onchange: () => { v.sound = sound.value; } }, Object.entries(SOUNDS).map(([k, s]) => h('option', { value: k, selected: k === v.sound }, s.name)));
  const mathBox = h('div', { class: 'col', style: { gap: '10px' } });
  const paintMath = () => mathBox.replaceChildren(
    h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, '수학 문제를 풀어야 꺼지게', h('span', { class: 'sub' }, '잠결에 끄고 다시 자는 걸 막아 줘요')), switchEl(v.math, on => { v.math = on; paintMath(); }, '수학 문제로 끄기')),
    v.math ? h('div', { class: 'grid-2' },
      field('난이도', h('select', { class: 'select', onchange: e => { v.mathLevel = e.target.value; } }, LEVELS.map(([k, l]) => h('option', { value: k, selected: k === v.mathLevel }, l)))),
      field('문제 수', h('select', { class: 'select', onchange: e => { v.mathCount = Number(e.target.value); } }, [1, 2, 3, 5].map(n => h('option', { value: n, selected: n === v.mathCount }, `${n}문제`))))) : null);
  paintMath();
  modal({
    title: isNew ? '알람 추가' : '알람 수정',
    body: h('div', { class: 'col' },
      time,
      field('이름', label),
      h('div', { class: 'field' }, h('span', null, '반복'), seg([['once', '한 번'], ['daily', '매일'], ['weekly', '매주']], v.repeat, r => { v.repeat = r; daysField.hidden = r !== 'weekly'; })),
      daysField,
      h('div', { class: 'field' }, h('span', null, '알람음'), h('div', { class: 'row' }, h('div', { class: 'grow' }, sound), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => preview(sound.value) }, icon('play', 14), '미리 듣기'))),
      mathBox,
      field('다시 알림 간격', h('select', { class: 'select', onchange: e => { v.snooze = Number(e.target.value); } }, [3, 5, 10, 15].map(n => h('option', { value: n, selected: n === v.snooze }, `${n}분`))))),
    actions: [
      isNew ? null : { label: '삭제', danger: true, onClick: async () => { if (!(await confirmDialog('이 알람을 지울까요?', { ok: '삭제', danger: true }))) return false; store.s.alarms = store.s.alarms.filter(x => x.id !== a.id); commit('alarms'); onDone(); } },
      { label: '취소' },
      { label: '저장', primary: true, onClick: () => {
        if (!time.value) { toast('시각을 정해 주세요.'); return false; }
        if (v.repeat === 'weekly' && !v.days.length) { toast('반복할 요일을 하나 이상 골라 주세요.'); return false; }
        Object.assign(a, v, { time: time.value, label: label.value.trim(), on: true, lastRang: '' });
        fixDate(a);
        if (isNew) store.s.alarms.push(a);
        commit('alarms'); onDone();
        toast(`${untilText(a) || '알람을 저장했어요.'}`, { icon: 'bell' });
      } },
    ].filter(Boolean),
  });
}

export default {
  id: 'alarm', title: '알람', icon: 'bell',
  render(el, ctx) {
    el.classList.add('stagger', 'narrow');
    const s = store.s;
    s.alarms ||= [];
    const list = h('div', { class: 'col', style: { gap: '12px' } });
    const note = h('section', { class: 'glass card col' });
    el.append(
      h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '알람'), h('button', { class: 'btn btn-ink', onclick: () => editAlarm(newAlarm(), true, paint) }, icon('plus', 16), '알람 추가')),
      list, note);
    function paint() {
      const items = s.alarms.slice().sort((x, y) => x.time.localeCompare(y.time));
      list.replaceChildren(items.length ? items.map(a => h('section', { class: 'alarm-card glass' + (a.on ? '' : ' off') },
        h('button', { class: 'grow alarm-main', onclick: () => editAlarm(a, false, paint) },
          h('div', { class: 'alarm-time num' }, a.time),
          h('div', { class: 'small' }, h('b', null, a.label || '알람'), ` · ${repeatText(a)}`),
          h('div', { class: 'tiny muted' }, [SOUNDS[a.sound]?.name, a.math ? `수학 ${a.mathCount}문제로 끄기` : null, a.on ? untilText(a) : '꺼짐'].filter(Boolean).join(' · '))),
        h('div', { class: 'col', style: { alignItems: 'flex-end', gap: '8px' } },
          switchEl(a.on, on => { a.on = on; if (on) { a.lastRang = ''; fixDate(a); toast(untilText(a), { icon: 'bell' }); } commit('alarms'); paint(); }, `${a.time} 알람 켜기`),
          h('button', { class: 'btn btn-ghost btn-sm', title: '지금 울려 보기', onclick: () => ring(a) }, icon('play', 13), '테스트')))) :
        h('section', { class: 'glass card' }, h('div', { class: 'empty' }, icon('bell', 34), '아직 알람이 없어요. 오른쪽 위 "알람 추가"를 눌러 만들어 보세요.')));
      note.replaceChildren(
        h('h2', { class: 'h3' }, '알아 두세요'),
        h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.7 } },
          '알람 소리는 하루가 열려 있는 창(컴퓨터 또는 휴대폰)에서 울려요. 하루를 닫아 두었을 때도 ',
          s.settings.ntfyTopic ? '휴대폰 ntfy 알림으로 알려 드려요.' : '알려 받으려면 설정에서 휴대폰 알림(ntfy)을 연결하세요.',
          ' 휴대폰은 소리가 나도록 무음 모드를 꺼 두세요. 처음에는 화면을 한 번 눌러야 브라우저가 소리를 허락해요.'));
    }
    paint();
    ctx.every(30e3, paint);
    ctx.on('change', w => { if (w === 'alarms') paint(); });
  },
};
