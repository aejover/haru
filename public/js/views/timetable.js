// timetable.js — 시간표: 하루 24시간 주간 시간표, 색깔 블록(일정), 학점 계산기.
import { h, icon, store, commit, uid, modal, toast, seg, confirmDialog, promptDialog, gainXP, pad } from '../core.js';

export const COLORS = ['#E07A6B', '#D9A441', '#9DC25A', '#5FB3A3', '#5B8FD6', '#9A7BD1', '#E57FA8', '#E8935A', '#4FB0D9', '#7D8590'];
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const GRADES = [['', '성적 미정'], ['A+', 'A+'], ['A0', 'A0'], ['B+', 'B+'], ['B0', 'B0'], ['C+', 'C+'], ['C0', 'C0'], ['D+', 'D+'], ['D0', 'D0'], ['F', 'F'], ['P', 'P (패스)']];
const GP = { 'A+': 4.5, A0: 4, 'B+': 3.5, B0: 3, 'C+': 2.5, C0: 2, 'D+': 1.5, D0: 1, F: 0 };
const HOUR = 60; // px per hour
const toMin = t => { const [a, b] = String(t || '0:0').split(':').map(Number); return a * 60 + (b || 0); };
const toTime = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
// one entry per course name; its credit comes from whichever of its blocks has one
function courseList(blocks) {
  const map = new Map();
  for (const b of blocks) {
    const c = map.get(b.title);
    if (!c) map.set(b.title, { title: b.title, color: b.color, credit: b.credit ?? null });
    else if (c.credit == null && b.credit != null) c.credit = b.credit;
  }
  return [...map.values()];
}

function semesterName(d = new Date()) { const m = d.getMonth() + 1; return m >= 3 && m <= 8 ? `${d.getFullYear()}년 1학기` : `${m <= 2 ? d.getFullYear() - 1 : d.getFullYear()}년 2학기`; }
function data() {
  const s = store.s;
  if (!s.timetables?.list?.length) {
    const t = { id: uid(), name: semesterName(), days: 5, from: 0, to: 24, h24: true, target: 150, blocks: [] };
    s.timetables = { cur: t.id, list: [t] };
  }
  // timetables now cover the whole day (12 AM – 12 AM)
  s.timetables.list.forEach(t => { if (!t.h24) { t.from = 0; t.to = 24; t.h24 = true; } });
  return s.timetables;
}
const current = () => { const d = data(); return d.list.find(t => t.id === d.cur) || d.list[0]; };

// split overlapping blocks on the same day into side-by-side lanes
function lanes(blocks) {
  const sorted = blocks.slice().sort((a, b) => toMin(a.start) - toMin(b.start));
  const out = new Map(); let cluster = [], end = -1;
  const flush = () => {
    const ends = [];
    cluster.forEach(b => { let i = ends.findIndex(e => e <= toMin(b.start)); if (i < 0) { i = ends.length; ends.push(0); } ends[i] = toMin(b.end); out.set(b, { lane: i }); });
    cluster.forEach(b => { out.get(b).of = ends.length; });
    cluster = [];
  };
  sorted.forEach(b => { if (toMin(b.start) >= end && cluster.length) { flush(); end = -1; } cluster.push(b); end = Math.max(end, toMin(b.end)); });
  if (cluster.length) flush();
  return out;
}

function editBlock(t, block, onDone) {
  const isNew = !t.blocks.includes(block);
  const v = { ...block };
  const title = h('input', { class: 'input', value: v.title || '', placeholder: '일정 이름 (예: 일반화학, 아르바이트, 운동)', list: 'tt-titles' });
  const titles = h('datalist', { id: 'tt-titles' }, [...new Set(t.blocks.map(b => b.title))].map(x => h('option', { value: x })));
  const place = h('input', { class: 'input', value: v.place || '', placeholder: '장소 (예: N17-227)' });
  const start = h('input', { class: 'input', type: 'time', step: 300, value: v.start });
  const end = h('input', { class: 'input', type: 'time', step: 300, value: v.end });
  const credit = h('input', { class: 'input', type: 'number', min: 0, max: 9, step: 0.5, value: v.credit ?? '', placeholder: '예: 3' });
  const swatches = h('div', { class: 'tt-swatches' });
  const paintSw = () => swatches.replaceChildren(COLORS.map(c => h('button', { type: 'button', class: 'swatch' + (v.color === c ? ' on' : ''), style: { background: c }, 'aria-label': '색 ' + c, onclick: () => { v.color = c; paintSw(); } })));
  paintSw();
  // reuse a course's color when its name is typed again
  title.addEventListener('change', () => { const same = t.blocks.find(b => b.title === title.value.trim() && b !== block); if (same && isNew) { v.color = same.color; place.value ||= same.place || ''; credit.value ||= same.credit ?? ''; paintSw(); } });
  const daySeg = seg(DAYS.slice(0, Math.max(5, t.days)).map((d, i) => [String(i), d]), String(v.day), d => { v.day = Number(d); });
  const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);
  modal({
    title: isNew ? '일정 추가' : '일정 수정',
    body: h('div', { class: 'col' }, titles, field('일정 이름', title), field('장소', place), h('div', { class: 'field' }, h('span', null, '요일'), daySeg),
      h('div', { class: 'grid-2' }, field('시작', start), field('끝', end)), h('div', { class: 'field' }, h('span', null, '색깔'), swatches), field('학점', credit)),
    actions: [
      isNew ? null : { label: '삭제', danger: true, onClick: async () => { if (!(await confirmDialog(`"${block.title}" 일정을 지울까요?`, { ok: '삭제', danger: true }))) return false; t.blocks = t.blocks.filter(b => b !== block); commit('timetable'); onDone(); } },
      { label: '취소' },
      { label: isNew ? '추가' : '저장', primary: true, onClick: () => {
        const name = title.value.trim();
        if (!name) { toast('일정 이름을 입력하세요.'); title.focus(); return false; }
        if (toMin(end.value) <= toMin(start.value)) { toast('끝나는 시간이 시작보다 늦어야 해요.'); return false; }
        const known = t.blocks.find(b => b.title === name && b !== block && b.credit != null)?.credit ?? null;
        Object.assign(block, { title: name, place: place.value.trim(), day: v.day, start: start.value, end: end.value, color: v.color, credit: credit.value === '' ? known : Number(credit.value) });
        if (block.credit != null) t.blocks.filter(b => b.title === name).forEach(b => { b.credit = block.credit; });
        if (isNew) { t.blocks.push(block); gainXP('calendar'); }
        commit('timetable'); onDone();
      } },
    ].filter(Boolean),
  });
  setTimeout(() => title.focus(), 80);
}

export default {
  id: 'timetable', title: '시간표', icon: 'table',
  render(el, ctx) {
    el.classList.add('stagger', 'narrow');
    const head = h('div', { class: 'tt-head' });
    const gridBox = h('section', { class: 'tt-wrap' });
    const calc = h('section', { class: 'glass card col' });
    el.append(head, gridBox, calc);

    function paintHead() {
      const d = data(), t = current();
      const sel = h('select', { class: 'tt-semester', 'aria-label': '시간표 선택', onchange: e => { if (e.target.value === '__new') return newTable(); d.cur = e.target.value; commit('timetable'); paint(); } },
        d.list.map(x => h('option', { value: x.id, selected: x.id === t.id }, x.name)), h('option', { value: '__new' }, '+ 새 시간표'));
      head.replaceChildren(
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'small muted' }, t.name), h('div', { class: 'row', style: { gap: '4px' } }, h('h1', { class: 'h1', style: { flex: 'none' } }, '시간표'), h('label', { class: 'tt-pick' }, icon('down', 20), sel))),
        h('button', { class: 'btn-icon glass-btn', 'aria-label': '일정 추가', title: '일정 추가', onclick: () => {
          const hr = Math.min(22, new Date().getHours() + 1);
          editBlock(t, { id: uid(), day: (new Date().getDay() + 6) % 7 < t.days ? (new Date().getDay() + 6) % 7 : 0, start: `${pad(hr)}:00`, end: `${pad(hr + 1)}:30`, color: COLORS[t.blocks.length % COLORS.length] }, paint);
        } }, icon('plus', 22)),
        h('button', { class: 'btn-icon glass-btn', 'aria-label': '시간표 설정', title: '시간표 설정', onclick: settings }, icon('sliders', 20)));
    }
    async function newTable() {
      const name = await promptDialog('새 시간표 이름', { value: semesterName(), ok: '만들기' });
      const d = data();
      if (name?.trim()) { const t = { id: uid(), name: name.trim(), days: 5, from: 0, to: 24, h24: true, target: current().target || 150, blocks: [] }; d.list.push(t); d.cur = t.id; commit('timetable'); }
      paint();
    }
    function settings() {
      const t = current(), d = data();
      const name = h('input', { class: 'input', value: t.name });
      const from = h('input', { class: 'input', type: 'number', min: 0, max: 22, value: t.from });
      const to = h('input', { class: 'input', type: 'number', min: 1, max: 24, value: t.to });
      const target = h('input', { class: 'input', type: 'number', min: 1, max: 300, value: t.target || 150 });
      let days = t.days;
      const field = (label, x) => h('label', { class: 'field' }, h('span', null, label), x);
      modal({
        title: '시간표 설정',
        body: h('div', { class: 'col' }, field('이름', name), h('div', { class: 'field' }, h('span', null, '요일'), seg([['5', '월–금'], ['6', '월–토'], ['7', '월–일']], String(days), v => { days = Number(v); })),
          h('div', { class: 'grid-2' }, field('시작 시각 (시)', from), field('끝 시각 (시)', to)), field('졸업 학점 (학점계산기)', target)),
        actions: [
          d.list.length > 1 ? { label: '이 시간표 삭제', danger: true, onClick: async () => { if (!(await confirmDialog(`"${t.name}" 시간표를 지울까요?`, { ok: '삭제', danger: true }))) return false; d.list = d.list.filter(x => x !== t); d.cur = d.list[0].id; commit('timetable'); paint(); } } : null,
          { label: '취소' },
          { label: '저장', primary: true, onClick: () => {
            const f = Math.max(0, Math.min(22, Number(from.value) || 9)), e = Math.max(f + 1, Math.min(24, Number(to.value) || 18));
            Object.assign(t, { name: name.value.trim() || t.name, days, from: f, to: e, target: Math.max(1, Number(target.value) || 150) });
            commit('timetable'); paint();
          } },
        ].filter(Boolean),
      });
    }

    function paintGrid() {
      const t = current();
      const blocks = t.blocks;
      // stretch the visible hours so no class is cut off
      const from = Math.min(t.from, ...blocks.map(b => Math.floor(toMin(b.start) / 60)));
      const to = Math.max(t.to, ...blocks.map(b => Math.ceil(toMin(b.end) / 60)));
      const nDays = Math.max(t.days, ...blocks.map(b => b.day + 1));
      const hours = Array.from({ length: to - from }, (_, i) => from + i);
      const height = (to - from) * HOUR;
      const today = (new Date().getDay() + 6) % 7;
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const grid = h('div', { class: 'tt-grid', style: { gridTemplateColumns: `34px repeat(${nDays}, minmax(0, 1fr))` } },
        h('div', { class: 'tt-corner' }),
        DAYS.slice(0, nDays).map((d, i) => h('div', { class: 'tt-day' + (i === today ? ' today' : '') }, d)),
        h('div', { class: 'tt-times', style: { height: height + 'px' } }, hours.map(hr => h('span', { style: { height: HOUR + 'px' } },
          hr === 0 || hr === 12 ? h('small', null, hr === 0 ? '오전' : '오후') : null, hr % 12 === 0 ? 12 : hr % 12))),
        DAYS.slice(0, nDays).map((_, day) => {
          const col = h('div', { class: 'tt-col', style: { height: height + 'px', backgroundSize: `100% ${HOUR}px` }, title: '빈 곳을 누르면 일정을 추가해요' });
          col.addEventListener('click', e => {
            if (e.target !== col) return;
            const y = e.clientY - col.getBoundingClientRect().top;
            const startMin = from * 60 + Math.floor((y / HOUR) * 2) * 30;
            editBlock(t, { id: uid(), day, start: toTime(startMin), end: toTime(Math.min(24 * 60 - 5, startMin + 90)), color: COLORS[t.blocks.length % COLORS.length] }, paint);
          });
          const mine = blocks.filter(b => b.day === day);
          const lay = lanes(mine);
          mine.forEach(b => {
            const top = ((toMin(b.start) - from * 60) / 60) * HOUR, hgt = ((toMin(b.end) - toMin(b.start)) / 60) * HOUR;
            const { lane, of } = lay.get(b);
            col.append(h('button', {
              class: 'tt-block', style: { top: top + 'px', height: Math.max(18, hgt - 1) + 'px', left: `calc(${(100 / of) * lane}% + 1px)`, width: `calc(${100 / of}% - 2px)`, background: b.color },
              onclick: () => editBlock(t, b, paint), title: `${b.title} ${b.start}–${b.end}`,
            }, h('b', null, b.title), b.place ? h('span', null, b.place) : null));
          });
          if (day === today && nowMin >= from * 60 && nowMin <= to * 60) col.append(h('i', { class: 'tt-now', style: { top: ((nowMin - from * 60) / 60) * HOUR + 'px' } }));
          return col;
        }));
      // 24 hours don't fit on screen: scroll inside the sheet, opening around the current time
      const keep = scroller?.scrollTop;
      scroller = h('div', { class: 'tt-scroll' }, grid);
      gridBox.replaceChildren(scroller, blocks.length ? null : h('div', { class: 'tt-empty' }, '빈 칸을 누르거나 위의 + 를 눌러 일정을 추가하세요'));
      requestAnimationFrame(() => {
        if (keep != null) { scroller.scrollTop = keep; return; }
        const firstToday = blocks.filter(b => b.day === today).map(b => toMin(b.start)).sort((a, b) => a - b)[0];
        const focusMin = Math.max(from * 60, Math.min(nowMin - 60, firstToday ?? nowMin - 60));
        scroller.scrollTop = Math.max(0, ((focusMin - from * 60) / 60) * HOUR);
      });
    }
    let scroller = null;

    function paintCalc() {
      const t = current();
      const courses = courseList(t.blocks);
      t.grades ||= {};
      let sum = 0, graded = 0, earned = 0;
      courses.forEach(c => {
        const cr = Number(c.credit) || 0, g = t.grades[c.title] || '';
        if (g && g !== 'F') earned += cr;
        if (g in GP) { sum += GP[g] * cr; graded += cr; }
      });
      const avg = graded ? sum / graded : 0;
      const otherEarned = data().list.filter(x => x !== t).reduce((acc, x) => acc + courseList(x.blocks).reduce((a, c) => a + ((x.grades?.[c.title] && x.grades[c.title] !== 'F') ? Number(c.credit) || 0 : 0), 0), 0);
      calc.replaceChildren(
        h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '학점계산기'), h('span', { class: 'small muted' }, `${t.name} · ${courses.reduce((a, c) => a + (Number(c.credit) || 0), 0)}학점 수강`)),
        h('div', { class: 'tt-gpa' },
          h('div', null, h('span', { class: 'muted' }, '평균 학점 '), h('b', { class: 'num' }, graded ? avg.toFixed(2) : '-'), h('span', { class: 'muted' }, ' / 4.5')),
          h('div', null, h('span', { class: 'muted' }, '취득 학점 '), h('b', { class: 'num' }, earned + otherEarned), h('span', { class: 'muted' }, ` / ${t.target || 150}`))),
        courses.length ? h('div', null, courses.map(c => h('div', { class: 'tt-course' },
          h('i', { class: 'dot', style: { background: c.color } }), h('span', { class: 'grow ell' }, c.title),
          h('span', { class: 'small muted num' }, c.credit != null ? `${c.credit}학점` : '학점 미정'),
          h('select', { class: 'tb-select', 'aria-label': `${c.title} 성적`, onchange: e => { t.grades[c.title] = e.target.value; commit('timetable'); paintCalc(); } }, GRADES.map(([v, l]) => h('option', { value: v, selected: (t.grades[c.title] || '') === v }, l))))))
          : h('p', { class: 'small muted', style: { margin: 0 } }, '수업 일정에 학점을 넣으면, 성적을 골라 평균 학점을 계산할 수 있어요.'));
    }

    function paint() { paintHead(); paintGrid(); paintCalc(); }
    paint();
    ctx.every(60e3, paintGrid);
    ctx.on('remote', paint);
  },
};
