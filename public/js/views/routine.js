// routine.js — 루틴: [시작]에서 버튼 하나로 루틴을 시작하고, [설정]에서 아침·저녁 루틴과 할 일·시간을 정해요.
// 시작하면 3초 들숨·3초 날숨 뒤 할 일이 순서대로 하나씩, 정해 둔 시간 안에 하도록 타이머가 돌아요(못 끝내면 연장).
import { h, icon, store, commit, uid, dkey, addDays, fmtClock, seg, toast, chime, confirmDialog, gainXP } from '../core.js';
import { makeRing } from './nap.js';

const WHEN = [['morning', '아침'], ['evening', '저녁'], ['any', '언제나']];
export const PRESETS = [
  { name: '상쾌한 아침 루틴', when: 'morning', note: '몸을 깨우고 하루를 정리해요', items: [['물 한 잔 마시기', 1], ['이불 정리하기', 2], ['창문 열고 햇빛 보기', 2], ['가벼운 스트레칭', 5], ['세수 · 양치', 5], ['오늘 꼭 할 일 3개 정하기', 3]] },
  { name: '편안한 저녁 루틴', when: 'evening', note: '내일을 준비하고 깊이 잠들어요', items: [['내일 준비물 챙기기', 5], ['책상 · 방 정리', 5], ['따뜻한 물로 샤워', 15], ['감사한 일 3가지 적기', 5], ['스트레칭 · 호흡', 5], ['휴대폰 멀리 두기', 1]] },
];
const data = () => (store.s.routines ||= { list: [], log: [], last: '' });
const total = r => r.items.reduce((a, x) => a + (Number(x.min) || 0), 0);
const fromPreset = p => ({ id: uid(), name: p.name, when: p.when, items: p.items.map(([title, min]) => ({ id: uid(), title, min })) });
// the routine that fits right now: a morning one before noon, an evening one from 5 PM, otherwise the last one used
function pickFor(now = new Date()) {
  const { list, last } = data(); const hr = now.getHours();
  const when = hr >= 4 && hr < 12 ? 'morning' : hr >= 17 || hr < 4 ? 'evening' : null;
  return (when && list.find(r => r.when === when && r.items.length)) || list.find(r => r.id === last && r.items.length) || list.find(r => r.items.length) || null;
}
// streak: days in a row (up to today) with at least one finished routine
function streak() {
  const days = new Set(data().log.map(l => l.date));
  let k = days.has(dkey()) ? dkey() : addDays(dkey(), -1), n = 0;
  while (days.has(k)) { n++; k = addDays(k, -1); }
  return n;
}

// ---------- running a routine (full-screen, stays up while you switch tabs) ----------
const BREATH = 3; // seconds in, then the same out
let run = null;
export const routineHint = () => run ? (run.phase === 'step' ? `${run.i + 1}/${run.r.items.length}` : '진행 중') : '';

function startRun(r) {
  if (run) return;
  data().last = r.id; commit('routines');
  run = { r: JSON.parse(JSON.stringify(r)), phase: 'breathe', t0: Date.now(), i: 0, endAt: 0, paused: 0, over: false, ext: 0, done: 0, skipped: 0, startedAt: Date.now() };
  const { ring, center, set } = makeRing(18);
  const wrap = h('div', { class: 'rt-run', role: 'dialog', 'aria-label': `${r.name} 진행 중` });
  const body = h('div', { class: 'rt-body' });
  const close = h('button', { class: 'btn-icon glass-btn rt-close', 'aria-label': '루틴 그만하기', onclick: async () => { if (run.phase === 'done' || await confirmDialog('루틴을 여기서 그만할까요?', { ok: '그만하기' })) finish(true); } }, icon('x', 20));
  wrap.append(h('div', { class: 'rt-top' }, h('div', { class: 'small muted' }, r.name), close), body);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
  let shown = '';

  const left = () => run.paused || run.endAt - Date.now();
  function startStep(i) {
    run.i = i; run.phase = 'step'; run.over = false; run.paused = 0;
    run.endAt = Date.now() + run.r.items[i].min * 60e3;
    shown = ''; chime('go'); paint();
  }
  function next(skipped) {
    if (skipped) run.skipped++; else run.done++;
    if (run.i + 1 < run.r.items.length) startStep(run.i + 1); else finish(false);
  }
  function extend(min) {
    run.endAt = Math.max(run.endAt, Date.now()) + min * 60e3; run.over = false; run.ext++;
    shown = ''; toast(`${min}분 연장했어요.`, { icon: 'timer' }); paint();
  }
  function finish(stopped) {
    const sec = Math.round((Date.now() - run.startedAt) / 1000);
    if (!stopped || run.done) {
      const d = data();
      d.log.push({ date: dkey(), id: run.r.id, name: run.r.name, done: run.done, total: run.r.items.length, sec, ext: run.ext });
      if (d.log.length > 400) d.log.splice(0, d.log.length - 400);
      commit('routines');
    }
    if (stopped) { clearInterval(timer); wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 350); run = null; return; }
    gainXP('routine');
    chime('end');
    run.phase = 'done'; run.sec = sec; shown = ''; paint();
  }

  function paint() {
    if (!run) return;
    if (run.phase === 'breathe') {
      const el = (Date.now() - run.t0) / 1000;
      if (el >= BREATH * 2) { startStep(0); return; }
      const inhale = el < BREATH, n = Math.ceil(BREATH - (el % BREATH));
      const key = 'b' + (inhale ? 'in' : 'out') + n;
      if (key === shown) return;
      // one circle for the whole breath, so it grows for 3 s and shrinks for 3 s instead of jumping
      let circle = body.querySelector('.rt-breath');
      if (!circle) {
        circle = h('div', { class: 'rt-breath' });
        body.replaceChildren(circle, h('div', { class: 'rt-say' }), h('div', { class: 'small muted' }, '호흡을 가다듬고 루틴을 시작할게요'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => startStep(0) }, '바로 시작'));
        void circle.offsetWidth;
      }
      circle.classList.toggle('in', inhale); circle.classList.toggle('out', !inhale);
      circle.replaceChildren(h('span', { class: 'count-num' }, n));
      if (shown.slice(0, 3) !== key.slice(0, 3)) { body.querySelector('.rt-say').textContent = inhale ? '숨을 깊게 들이마셔요' : '천천히 내쉬어요'; chime('count'); }
      shown = key;
      return;
    }
    if (run.phase === 'done') {
      if (shown === 'done') return; shown = 'done';
      const all = run.r.items.length;
      body.replaceChildren(
        h('div', { class: 'rt-done-mark' }, icon('check', 44, 2.4)),
        h('div', { class: 'rt-say' }, run.done === all ? '루틴 완료! 잘했어요' : '루틴을 마쳤어요'),
        h('div', { class: 'rt-stats' },
          h('div', { class: 'kpi' }, h('b', null, `${run.done}/${all}`), h('span', null, '해낸 일')),
          h('div', { class: 'kpi' }, h('b', null, fmtClock(run.sec)), h('span', null, `걸린 시간 · 계획 ${total(run.r)}분`)),
          h('div', { class: 'kpi' }, h('b', null, `${streak()}일`), h('span', null, '연속 기록'))),
        run.ext ? h('div', { class: 'small muted' }, `시간을 ${run.ext}번 연장했어요. 설정에서 시간을 조금 늘려 봐도 좋아요.`) : null,
        h('button', { class: 'btn btn-ink btn-lg', onclick: () => finish(true) }, '닫기'));
      return;
    }
    // a step
    const item = run.r.items[run.i], l = left();
    if (l <= 0 && !run.over && !run.paused) { run.over = true; chime('alarm'); try { navigator.vibrate?.([300, 150, 300]); } catch { /* ignore */ } }
    set(run.over ? 1 : l / (item.min * 60e3));
    ring.classList.toggle('over', run.over);
    const time = run.over ? `+${fmtClock((Date.now() - run.endAt) / 1000)}` : fmtClock(l / 1000);
    const key = `s${run.i}${run.over}${!!run.paused}`;
    if (key === shown) { center.querySelector('.ring-time').textContent = time; return; }
    shown = key;
    center.replaceChildren(h('div', { class: 'ring-mode' }, run.over ? '시간이 다 됐어요' : run.paused ? '잠시 멈춤' : `${item.min}분 안에`), h('div', { class: 'ring-time' }, time));
    const upcoming = run.r.items[run.i + 1];
    body.replaceChildren(
      h('div', { class: 'rt-steps' }, run.r.items.map((_, i) => h('i', { class: i < run.i ? 'done' : i === run.i ? 'on' : '' }))),
      h('div', { class: 'rt-say' }, item.title),
      ring,
      run.over
        ? h('div', { class: 'col', style: { alignItems: 'center', gap: '10px' } },
          h('div', { class: 'small muted' }, '조금 더 필요하면 시간을 늘려요'),
          h('div', { class: 'row', style: { gap: '8px', justifyContent: 'center' } }, [1, 3, 5].map(m => h('button', { class: 'btn btn-ghost', onclick: () => extend(m) }, `+${m}분`))),
          h('button', { class: 'btn btn-ink btn-lg', onclick: () => next(false) }, icon('check', 18), '다 했어요'))
        : h('div', { class: 'row', style: { gap: '10px', justifyContent: 'center' } },
          h('button', { class: 'btn-icon glass-btn', 'aria-label': run.paused ? '계속' : '일시정지', onclick: () => { if (run.paused) { run.endAt = Date.now() + run.paused; run.paused = 0; } else run.paused = Math.max(1, run.endAt - Date.now()); paint(); } }, icon(run.paused ? 'play' : 'pause', 18)),
          h('button', { class: 'btn btn-ink btn-lg', onclick: () => next(false) }, icon('check', 18), '다 했어요'),
          h('button', { class: 'btn-icon glass-btn', 'aria-label': '건너뛰기', title: '건너뛰기', onclick: () => next(true) }, icon('skip', 18))),
      h('div', { class: 'small muted' }, upcoming ? `다음: ${upcoming.title} · ${upcoming.min}분` : '마지막 할 일이에요'));
  }
  const timer = setInterval(paint, 200);
  paint();
}

// ---------- settings ----------
function routineCard(r, repaint) {
  const d = data();
  const save = () => commit('routines');
  const name = h('input', { class: 'input rt-name', value: r.name, 'aria-label': '루틴 이름', onchange: e => { r.name = e.target.value.trim() || r.name; save(); } });
  const sum = h('span', { class: 'chip sm line num' }, `${r.items.length}단계 · ${total(r)}분`);
  const items = h('div', { class: 'rt-items' });
  const paintItems = () => {
    sum.textContent = `${r.items.length}단계 · ${total(r)}분`;
    items.replaceChildren(...r.items.map((x, i) => h('div', { class: 'rt-item' },
      h('span', { class: 'rt-n num' }, i + 1),
      h('input', { class: 'input', value: x.title, 'aria-label': `${i + 1}번째 할 일`, onchange: e => { x.title = e.target.value.trim() || x.title; save(); } }),
      h('label', { class: 'rt-min' }, h('input', { class: 'input num', type: 'number', min: 1, max: 180, value: x.min, 'aria-label': `${x.title} 시간 (분)`, onchange: e => { x.min = Math.max(1, Math.min(180, Math.round(Number(e.target.value) || 1))); e.target.value = x.min; save(); paintItems(); } }), h('span', null, '분')),
      h('button', { class: 'btn-icon sm', 'aria-label': '위로', disabled: i === 0, onclick: () => { [r.items[i - 1], r.items[i]] = [r.items[i], r.items[i - 1]]; save(); paintItems(); } }, icon('up', 15)),
      h('button', { class: 'btn-icon sm', 'aria-label': '아래로', disabled: i === r.items.length - 1, onclick: () => { [r.items[i + 1], r.items[i]] = [r.items[i], r.items[i + 1]]; save(); paintItems(); } }, icon('down', 15)),
      h('button', { class: 'btn-icon sm del', 'aria-label': `${x.title} 삭제`, onclick: () => { r.items.splice(i, 1); save(); paintItems(); } }, icon('x', 15)))));
  };
  paintItems();
  const newTitle = h('input', { class: 'input', placeholder: '해야 할 일 (예: 물 한 잔 마시기)', 'aria-label': '새 할 일' });
  const newMin = h('input', { class: 'input num', type: 'number', min: 1, max: 180, value: 5, 'aria-label': '시간 (분)' });
  const addItem = () => {
    const t = newTitle.value.trim(); if (!t) { newTitle.focus(); return; }
    r.items.push({ id: uid(), title: t, min: Math.max(1, Math.min(180, Math.round(Number(newMin.value) || 5))) });
    save(); newTitle.value = ''; paintItems(); newTitle.focus();
  };
  newTitle.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) addItem(); });
  return h('section', { class: 'glass card col rt-card' },
    h('div', { class: 'row wrap', style: { gap: '8px' } }, h('div', { class: 'grow', style: { minWidth: '160px' } }, name), sum),
    h('div', { class: 'row wrap between', style: { gap: '8px' } },
      seg(WHEN, r.when || 'any', v => { r.when = v; save(); }),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { if (!(await confirmDialog(`"${r.name}" 루틴을 지울까요?`, { ok: '삭제', danger: true }))) return; d.list = d.list.filter(x => x !== r); save(); repaint(); } }, icon('trash', 14), '삭제')),
    items,
    h('div', { class: 'rt-item add' }, h('span', { class: 'rt-n' }, icon('plus', 14)), newTitle, h('label', { class: 'rt-min' }, newMin, h('span', null, '분')), h('button', { class: 'btn btn-ink btn-sm', onclick: addItem }, '추가')),
    h('button', { class: 'btn btn-ghost btn-sm', style: { alignSelf: 'flex-start' }, disabled: !r.items.length, onclick: () => startRun(r) }, icon('play', 13), '이 루틴 시작'));
}

export default {
  id: 'routine', title: '루틴', icon: 'routine',
  render(el, ctx, arg) {
    el.classList.add('stagger', 'narrow');
    const d = data();
    // the start screen always comes first when the tab opens
    let section = arg === 'settings' ? 'settings' : 'start';
    const startBox = h('div', { class: 'col', style: { gap: '16px' } });
    const setBox = h('div', { class: 'col', style: { gap: '16px' } });
    const show = v => { section = v; startBox.hidden = v !== 'start'; setBox.hidden = v !== 'settings'; paint(); };
    const tabs = h('div');
    const paintTabs = () => tabs.replaceChildren(seg([['start', '시작'], ['settings', '설정']], section, show));
    paintTabs();
    el.append(h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '루틴'), tabs), startBox, setBox);
    let chosen = null;

    function paintStart() {
      const ready = d.list.filter(r => r.items.length);
      if (!chosen || !ready.includes(chosen)) chosen = pickFor();
      const r = chosen;
      startBox.replaceChildren(h('section', { class: 'glass card rt-start' },
        h('button', { class: 'rt-go', onclick: () => {
          if (!r) { toast('먼저 설정에서 루틴을 만들어 주세요. 추천 루틴을 바로 넣을 수도 있어요.', { icon: 'routine' }); section = 'settings'; paintTabs(); show('settings'); return; }
          startRun(r);
        } }, h('span', null, '시작하기')),
        r ? h('div', { class: 'rt-which' }, h('b', null, r.name), h('span', { class: 'small muted' }, ` · ${r.items.length}단계 · ${total(r)}분`)) : h('div', { class: 'small muted' }, '아직 루틴이 없어요'),
        ready.length > 1 ? h('div', { class: 'row wrap', style: { gap: '6px', justifyContent: 'center' } }, ready.map(x => h('button', { class: 'chip sm ' + (x === r ? 'ink' : 'line'), onclick: () => { chosen = x; paintStart(); } }, x.name))) : null));
    }

    function paintSettings() {
      const log = d.log.slice(-60);
      const week = d.log.filter(l => l.date >= addDays(dkey(), -6));
      setBox.replaceChildren(
        h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '내 루틴'), h('button', { class: 'btn btn-ink btn-sm', onclick: () => {
          const hr = new Date().getHours();
          d.list.push({ id: uid(), name: hr < 12 ? '아침 루틴' : hr >= 17 ? '저녁 루틴' : '새 루틴', when: hr < 12 ? 'morning' : hr >= 17 ? 'evening' : 'any', items: [] });
          commit('routines'); paintSettings(); setTimeout(() => setBox.querySelectorAll('.rt-card')[d.list.length - 1]?.querySelector('.rt-item.add input')?.focus(), 60);
        } }, icon('plus', 14), '새 루틴')),
        d.list.length ? d.list.map(r => routineCard(r, paintSettings)) : h('section', { class: 'glass card' }, h('div', { class: 'empty' }, icon('routine', 32), '아침 루틴, 저녁 루틴처럼 순서대로 할 일을 묶어 보세요.', h('span', { class: 'small' }, '아래 추천 루틴을 넣고 고쳐 써도 돼요.'))),
        h('h2', { class: 'h2', style: { marginTop: '6px' } }, '추천 루틴'),
        h('div', { class: 'rt-presets' }, PRESETS.map(p => h('section', { class: 'glass card col' },
          h('div', { class: 'row between' }, h('b', null, p.name), h('span', { class: 'chip sm line num' }, `${p.items.reduce((a, x) => a + x[1], 0)}분`)),
          h('div', { class: 'small muted' }, p.note),
          h('ol', { class: 'rt-plist' }, p.items.map(([t, m]) => h('li', null, h('span', null, t), h('span', { class: 'muted num' }, `${m}분`)))),
          h('button', { class: 'btn btn-ghost btn-sm', style: { alignSelf: 'flex-start' }, onclick: () => { d.list.push(fromPreset(p)); commit('routines'); toast(`"${p.name}"을(를) 내 루틴에 넣었어요.`, { icon: 'check' }); paintSettings(); } }, icon('plus', 14), '내 루틴에 넣기')))),
        h('section', { class: 'glass card col' },
          h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '기록'), h('span', { class: 'small muted' }, `연속 ${streak()}일 · 최근 7일 ${week.length}번`)),
          log.length ? h('div', null, log.slice(-6).reverse().map(l => h('div', { class: 'item-row' },
            h('span', { class: 'chip sm line num' }, l.date.slice(5).replace('-', '/')), h('span', { class: 'grow' }, l.name),
            h('span', { class: 'small muted num' }, `${l.done}/${l.total} · ${Math.round(l.sec / 60)}분${l.ext ? ` · 연장 ${l.ext}번` : ''}`)))) : h('p', { class: 'small muted', style: { margin: 0 } }, '루틴을 끝내면 여기에 기록돼요.')));
    }

    function paint() { if (section === 'start') paintStart(); else paintSettings(); }
    show(section);
    ctx.on('change', w => { if (w === 'routines' && section === 'start') paintStart(); });
  },
};
