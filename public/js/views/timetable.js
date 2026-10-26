// timetable.js — 시간표: 하루 24시간 주간 시간표, 색깔 블록(일정), 이번 주만 휴강, 시간표 사진을 Claude가 읽어 블록으로.
import { h, icon, store, commit, uid, modal, toast, seg, confirmDialog, promptDialog, gainXP, pad, dkey, mondayOf, switchEl, checkEl, upload, pickFiles, ai, jsonOf, aiFail, urlToBlock, obj } from '../core.js';
import { openViewer } from '../viewer.js';

export const COLORS = ['#E07A6B', '#D9A441', '#9DC25A', '#5FB3A3', '#5B8FD6', '#9A7BD1', '#E57FA8', '#E8935A', '#4FB0D9', '#7D8590'];
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const HOUR = 60; // px per hour
const toMin = t => { const [a, b] = String(t || '0:0').split(':').map(Number); return a * 60 + (b || 0); };
const toTime = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
// 휴강 is per week: block.off holds the Monday of each week it's cancelled, so it comes back the week after
const thisWeek = () => mondayOf(dkey());
const isOff = b => !!b.off?.[thisWeek()];
function setOff(b, on) {
  const wk = thisWeek();
  b.off = Object.fromEntries(Object.entries(b.off || {}).filter(([k]) => k >= wk)); // forget past weeks
  if (on) b.off[wk] = true; else delete b.off[wk];
  if (!Object.keys(b.off).length) delete b.off;
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
  const swatches = h('div', { class: 'tt-swatches' });
  const paintSw = () => swatches.replaceChildren(COLORS.map(c => h('button', { type: 'button', class: 'swatch' + (v.color === c ? ' on' : ''), style: { background: c }, 'aria-label': '색 ' + c, onclick: () => { v.color = c; paintSw(); } })));
  paintSw();
  // reuse a schedule's color when its name is typed again
  title.addEventListener('change', () => { const same = t.blocks.find(b => b.title === title.value.trim() && b !== block); if (same && isNew) { v.color = same.color; place.value ||= same.place || ''; paintSw(); } });
  const daySeg = seg(DAYS.slice(0, Math.max(5, t.days)).map((d, i) => [String(i), d]), String(v.day), d => { v.day = Number(d); });
  let off = isOff(block);
  const offRow = isNew ? null : h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, '이번 주 휴강', h('span', { class: 'sub' }, '이번 주에만 시간표에서 사라지고, 다음 주에는 다시 나타나요')), switchEl(off, on => { off = on; }, '이번 주 휴강'));
  const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);
  modal({
    title: isNew ? '일정 추가' : '일정 수정',
    body: h('div', { class: 'col' }, titles, field('일정 이름', title), field('장소', place), h('div', { class: 'field' }, h('span', null, '요일'), daySeg),
      h('div', { class: 'grid-2' }, field('시작', start), field('끝', end)), h('div', { class: 'field' }, h('span', null, '색깔'), swatches), offRow),
    actions: [
      isNew ? null : { label: '삭제', danger: true, onClick: async () => { if (!(await confirmDialog(`"${block.title}" 일정을 지울까요?`, { ok: '삭제', danger: true }))) return false; t.blocks = t.blocks.filter(b => b !== block); commit('timetable'); onDone(); } },
      { label: '취소' },
      { label: isNew ? '추가' : '저장', primary: true, onClick: () => {
        const name = title.value.trim();
        if (!name) { toast('일정 이름을 입력하세요.'); title.focus(); return false; }
        if (toMin(end.value) <= toMin(start.value)) { toast('끝나는 시간이 시작보다 늦어야 해요.'); return false; }
        Object.assign(block, { title: name, place: place.value.trim(), day: v.day, start: start.value, end: end.value, color: v.color });
        if (!isNew && off !== isOff(block)) { setOff(block, off); toast(off ? `"${name}" 이번 주는 휴강으로 표시했어요. 다음 주에 다시 나타나요.` : '휴강을 취소했어요.', { icon: 'calendar' }); }
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
    const imgBox = h('div');
    el.append(head, gridBox, imgBox);

    // ----- timetable photo: shown under the grid, and Claude reads it into blocks -----
    function paintImage() {
      const t = current(), img = t.image;
      if (!img) {
        const dz = h('div', { class: 'dropzone', role: 'button', tabindex: '0', onclick: () => pickImage(), onkeydown: e => { if (e.key === 'Enter') pickImage(); } },
          icon('image', 28), h('div', { class: 'grow' }, h('b', { style: { color: 'var(--fg)' } }, '시간표 이미지 넣기'), h('div', { class: 'small' }, '학교 포털이나 에브리타임 시간표를 캡처해 넣으면 여기 보이고, Claude가 읽어서 시간표 블록으로 만들어 줘요.')),
          h('span', { class: 'chip' }, '이미지 선택'));
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('over'));
        dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (f) setImage(f); });
        imgBox.replaceChildren(dz);
        return;
      }
      imgBox.replaceChildren(h('div', { class: 'img-cal glass' },
        h('img', { src: img.url, alt: '시간표 이미지', title: '눌러서 크게 보기', onclick: () => openViewer(img.url, { alt: '시간표 이미지' }) }),
        h('button', { class: 'btn btn-glass btn-sm img-zoom', onclick: () => openViewer(img.url, { alt: '시간표 이미지' }) }, icon('search', 15), '크게 보기'),
        h('div', { class: 'img-actions' },
          h('button', { class: 'btn btn-ink btn-sm', onclick: e => readImage(e.currentTarget) }, icon('sparkle', 15), img.analyzed ? 'Claude로 다시 읽기' : 'Claude로 시간표 읽기'),
          h('button', { class: 'btn btn-glass btn-sm', onclick: () => pickImage() }, '바꾸기'),
          h('button', { class: 'btn btn-glass btn-sm', onclick: () => { delete current().image; commit('timetable'); paintImage(); } }, '삭제'))));
    }
    async function pickImage() { const [f] = await pickFiles({ accept: 'image/*' }); if (f) setImage(f); }
    async function setImage(file) {
      try {
        const up = await upload(file);
        current().image = { url: up.url, name: file.name, analyzed: false };
        commit('timetable'); gainXP('calendar'); paintImage();
        toast('이미지를 넣었어요. "Claude로 시간표 읽기"를 누르면 블록으로 만들어 줘요.', { icon: 'image' });
      } catch (e) { toast(e.message); }
    }
    async function readImage(btn) {
      const t = current();
      btn.disabled = true; const label = [...btn.childNodes]; btn.textContent = 'Claude가 읽는 중…';
      try {
        const resp = await ai({
          effort: 'medium', max_tokens: 12000,
          format: obj({ summary: { type: 'string' }, items: { type: 'array', items: obj({ title: { type: 'string' }, place: { type: 'string' }, day: { type: 'integer', description: '0=월 1=화 2=수 3=목 4=금 5=토 6=일' }, start: { type: 'string', description: 'HH:MM (24시간)' }, end: { type: 'string', description: 'HH:MM (24시간)' } }) } }),
          system: '너는 주간 시간표 이미지(대학 수강 시간표, 근무표, 학원 시간표)를 읽어 블록 목록으로 바꾸는 도우미다. 이미지에 실제로 있는 칸만 뽑고 지어내지 않는다. 한 과목이 여러 요일에 있으면 요일마다 따로 적는다. 시각은 24시간제 HH:MM으로, 교시만 있으면 칸의 위치와 표의 시각 눈금으로 시각을 추정한다. 장소가 없으면 빈 문자열. summary는 무엇을 읽었는지 한 문장.',
          messages: [{ role: 'user', content: [await urlToBlock(t.image.url), { type: 'text', text: '이 시간표의 모든 칸을 블록으로 바꿔 줘.' }] }],
        });
        const data = jsonOf(resp);
        t.image.analyzed = true; commit('timetable');
        reviewImage(t, data);
      } catch (e) { aiFail(e); }
      finally { btn.disabled = false; btn.replaceChildren(...label); }
    }
    function reviewImage(t, data) {
      const ok = x => x.title && x.day >= 0 && x.day <= 6 && /^\d{1,2}:\d{2}$/.test(x.start) && /^\d{1,2}:\d{2}$/.test(x.end) && toMin(x.end) > toMin(x.start);
      const items = (data.items || []).filter(ok).map(x => ({ ...x, start: toTime(toMin(x.start)), end: toTime(toMin(x.end)) }));
      if (!items.length) { toast('이미지에서 시간표 칸을 찾지 못했어요.'); return; }
      const dup = x => t.blocks.some(b => b.title === x.title && b.day === x.day && b.start === x.start);
      const picked = new Set(items.map((x, i) => (dup(x) ? -1 : i)).filter(i => i >= 0));
      modal({
        title: `시간표 칸 ${items.length}개를 찾았어요`, wide: true,
        body: h('div', { class: 'col' },
          data.summary ? h('p', { class: 'small muted', style: { margin: 0 } }, data.summary) : null,
          h('div', null, items.map((x, i) => h('div', { class: 'item-row' },
            checkEl(picked.has(i), v => { v ? picked.add(i) : picked.delete(i); }, x.title),
            h('span', { class: 'chip sm line num' }, `${DAYS[x.day]} ${x.start}–${x.end}`),
            h('span', { class: 'grow' }, x.title, x.place ? h('span', { class: 'small muted' }, ` · ${x.place}`) : null, dup(x) ? h('span', { class: 'tiny muted' }, ' · 이미 있어요') : null)))),
          h('p', { class: 'small muted', style: { margin: 0 } }, '체크한 칸만 지금 시간표에 추가돼요. 같은 이름은 같은 색으로 묶여요.')),
        actions: [{ label: '취소' }, {
          label: '선택한 칸 추가', primary: true, onClick: () => {
            let n = 0;
            items.forEach((x, i) => {
              if (!picked.has(i)) return;
              const same = t.blocks.find(b => b.title === x.title);
              const color = same?.color || COLORS[new Set([...t.blocks.map(b => b.title), x.title]).size % COLORS.length];
              t.blocks.push({ id: uid(), title: x.title, place: x.place || '', day: x.day, start: x.start, end: x.end, color, source: 'image' });
              n++;
            });
            if (n) { commit('timetable'); gainXP('calendar'); }
            toast(`${n}개를 시간표에 넣었어요.`, { icon: 'table' });
            paint();
          },
        }],
      });
    }

    function paintHead() {
      const d = data(), t = current();
      const sel = h('select', { class: 'tt-semester', 'aria-label': '시간표 선택', onchange: e => { if (e.target.value === '__new') return newTable(); d.cur = e.target.value; commit('timetable'); paint(); } },
        d.list.map(x => h('option', { value: x.id, selected: x.id === t.id }, x.name)), h('option', { value: '__new' }, '+ 새 시간표'));
      const offs = t.blocks.filter(isOff);
      head.replaceChildren(
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'small muted' }, t.name), h('div', { class: 'row', style: { gap: '4px' } }, h('h1', { class: 'h1', style: { flex: 'none' } }, '시간표'), h('label', { class: 'tt-pick' }, icon('down', 20), sel))),
        offs.length ? h('button', { class: 'chip sm line', title: '이번 주 휴강 보기', onclick: () => showOffs(t) }, `이번 주 휴강 ${offs.length}`) : null,
        h('button', { class: 'btn-icon glass-btn', 'aria-label': '일정 추가', title: '일정 추가', onclick: () => {
          const hr = Math.min(22, new Date().getHours() + 1);
          editBlock(t, { id: uid(), day: (new Date().getDay() + 6) % 7 < t.days ? (new Date().getDay() + 6) % 7 : 0, start: `${pad(hr)}:00`, end: `${pad(hr + 1)}:30`, color: COLORS[t.blocks.length % COLORS.length] }, paint);
        } }, icon('plus', 22)),
        h('button', { class: 'btn-icon glass-btn', 'aria-label': '시간표 설정', title: '시간표 설정', onclick: settings }, icon('sliders', 20)));
    }
    // cancelled blocks are hidden from the grid, so this is where they can be brought back
    function showOffs(t) {
      const list = h('div');
      const paintList = () => list.replaceChildren(t.blocks.filter(isOff).map(b => h('div', { class: 'item-row' },
        h('i', { class: 'tt-dot', style: { background: b.color } }), h('span', { class: 'grow' }, h('b', null, b.title), h('span', { class: 'small muted' }, ` · ${DAYS[b.day]} ${b.start}–${b.end}`)),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { setOff(b, false); commit('timetable'); paint(); paintList(); if (!t.blocks.some(isOff)) m.close(); } }, '휴강 취소'))));
      paintList();
      const m = modal({ title: '이번 주 휴강', body: h('div', { class: 'col' }, list, h('p', { class: 'small muted', style: { margin: 0 } }, '다음 주가 되면 자동으로 시간표에 다시 나타나요.')), actions: [{ label: '닫기', primary: true }] });
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
      let days = t.days;
      const field = (label, x) => h('label', { class: 'field' }, h('span', null, label), x);
      modal({
        title: '시간표 설정',
        body: h('div', { class: 'col' }, field('이름', name), h('div', { class: 'field' }, h('span', null, '요일'), seg([['5', '월–금'], ['6', '월–토'], ['7', '월–일']], String(days), v => { days = Number(v); })),
          h('div', { class: 'grid-2' }, field('시작 시각 (시)', from), field('끝 시각 (시)', to))),
        actions: [
          d.list.length > 1 ? { label: '이 시간표 삭제', danger: true, onClick: async () => { if (!(await confirmDialog(`"${t.name}" 시간표를 지울까요?`, { ok: '삭제', danger: true }))) return false; d.list = d.list.filter(x => x !== t); d.cur = d.list[0].id; commit('timetable'); paint(); } } : null,
          { label: '취소' },
          { label: '저장', primary: true, onClick: () => {
            const f = Math.max(0, Math.min(22, Number(from.value) || 9)), e = Math.max(f + 1, Math.min(24, Number(to.value) || 18));
            Object.assign(t, { name: name.value.trim() || t.name, days, from: f, to: e });
            commit('timetable'); paint();
          } },
        ].filter(Boolean),
      });
    }

    function paintGrid() {
      const t = current();
      const blocks = t.blocks.filter(b => !isOff(b));
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

    function paint() { paintHead(); paintGrid(); paintImage(); }
    paint();
    ctx.every(60e3, paintGrid);
    ctx.on('remote', paint);
  },
};
