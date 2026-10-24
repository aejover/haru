// nap.js (view) — 파워냅: 일어날 시각이 아니라 "얼마나 잘지"를 정하면, 그 시간이 지나 알람이 울려요.
import { h, icon, store, commit, dkey, addDays, pad, fmtClock, seg, switchEl, toast, chime } from '../core.js';
import { SOUNDS, preview, NAP_PRESETS, napLeft, startNap, cancelNap, extendNap } from '../alarm.js';

const LEVELS = [['easy', '쉬움 (덧셈·뺄셈)'], ['normal', '보통 (곱셈 섞기)'], ['hard', '어려움 (두 자리 곱셈)']];
const cfg = () => (store.s.napCfg ||= { min: 20, fall: 5, sound: 'sunrise', math: false, mathLevel: 'normal', mathCount: 2 });
const hm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// a progress ring like the pomodoro one; set(p) takes 0..1
export function makeRing(width = 22) {
  const R = 146, C = 2 * Math.PI * R;
  const ring = h('div', { class: 'ring' });
  ring.innerHTML = `<svg viewBox="0 0 340 340"><circle class="track" cx="170" cy="170" r="${R}" fill="none" stroke-width="${width}"/><circle class="fill" cx="170" cy="170" r="${R}" fill="none" stroke-width="${width}" stroke-dasharray="${C}"/></svg>`;
  const fill = ring.querySelector('.fill');
  const center = h('div', { class: 'ring-center' });
  ring.append(center);
  return { ring, center, set: p => fill.setAttribute('stroke-dashoffset', String(C * (1 - Math.max(0, Math.min(1, p))))) };
}

function advice(hour) {
  if (hour >= 13 && hour < 16) return ['지금이 낮잠 골든타임이에요', '오후 1–3시는 몸이 원래 졸린 시간이라 20분 낮잠이 가장 효과적이에요.'];
  if (hour >= 16 && hour < 19) return ['늦은 오후예요', '지금 길게 자면 밤잠이 늦어질 수 있어요. 10–20분만 자는 걸 추천해요.'];
  if (hour >= 19 || hour < 5) return ['밤이에요', '지금은 낮잠보다 밤잠을 자는 게 좋아요. 건강 탭에서 권장 취침 시각을 확인해 보세요.'];
  return ['짧게 충전하기 좋아요', '오전 낮잠은 10–20분이면 충분해요. 30분을 넘기면 깊은 잠에 들어 깰 때 멍할 수 있어요.'];
}

export default {
  id: 'nap', title: '파워냅', icon: 'moon',
  render(el, ctx) {
    el.classList.add('stagger', 'narrow');
    const s = store.s, c = cfg();
    const main = h('section', { class: 'glass card col nap-main' });
    const opts = h('section', { class: 'glass card col' });
    const history = h('section', { class: 'glass card col' });
    el.append(h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '파워냅')), main, opts, history);

    const { ring, center, set } = makeRing(22);
    const leftEl = h('div', { class: 'ring-time' });
    const subEl = h('div', { class: 'ring-mode' });
    center.append(subEl, leftEl);

    function begin(min) {
      startNap(min + (c.fall || 0), { sleep: min, sound: c.sound, math: c.math, mathLevel: c.mathLevel, mathCount: c.mathCount });
      chime('go');
      paint();
    }

    function paintMain() {
      const n = s.nap;
      if (n) {
        main.replaceChildren(
          ring,
          h('div', { class: 'small muted', style: { textAlign: 'center' } }, `${hm(n.end)}에 깨워 드려요`, n.min !== n.sleep && n.sleep ? ` · 잠 ${n.sleep}분 + 잠들기 ${n.min - n.sleep}분` : ''),
          h('div', { class: 'row', style: { gap: '8px', justifyContent: 'center' } },
            h('button', { class: 'btn btn-ghost', onclick: () => { extendNap(5); toast(`5분 더 잘게요 · ${hm(s.nap.end)}에 깨워요`, { icon: 'moon' }); paint(); } }, icon('plus', 16), '5분 더'),
            h('button', { class: 'btn btn-ink', onclick: () => { cancelNap(); toast('파워냅을 그만뒀어요.'); paint(); } }, icon('stop', 14), '그만 자기')),
          h('p', { class: 'tiny muted', style: { margin: 0, textAlign: 'center' } }, '하루를 열어 둔 창에서 알람이 울려요. 휴대폰 알림(ntfy)을 연결했다면 휴대폰으로도 알려 드려요.'));
        tick();
        return;
      }
      const [title, text] = advice(new Date().getHours());
      const custom = h('input', { class: 'input num', type: 'number', min: 1, max: 180, value: c.min, 'aria-label': '직접 정하기 (분)', style: { width: '90px', textAlign: 'center' } });
      main.replaceChildren(
        h('div', null, h('h2', { class: 'h2' }, '얼마나 잘까요?'), h('div', { class: 'small muted' }, h('b', null, title), ' · ', text)),
        h('div', { class: 'nap-presets' }, NAP_PRESETS.map(([min, name, desc]) => h('button', { class: 'nap-tile' + (min === 20 ? ' best' : ''), onclick: () => { c.min = min; commit('nap'); begin(min); } },
          h('b', { class: 'num' }, min, h('small', null, '분')), h('span', { class: 'nm' }, name), h('span', { class: 'ds' }, desc)))),
        h('div', { class: 'row wrap', style: { gap: '8px' } },
          h('span', { class: 'small muted' }, '직접 정하기'), custom, h('span', { class: 'small muted' }, '분'),
          h('button', { class: 'btn btn-ink', onclick: () => { const m = Math.round(Number(custom.value)); if (!(m >= 1 && m <= 180)) { toast('1–180분 사이로 정해 주세요.'); return; } c.min = m; commit('nap'); begin(m); } }, icon('moon', 16), '자러 가기')));
    }
    function tick() {
      const n = s.nap; if (!n) return;
      const left = napLeft();
      set(left / (n.end - n.start));
      leftEl.textContent = fmtClock(Math.ceil(left / 1000));
      subEl.textContent = left > 0 ? '푹 자는 중' : '일어날 시간';
    }

    function paintOpts() {
      const field = (label, x) => h('label', { class: 'field' }, h('span', null, label), x);
      const sound = h('select', { class: 'select', 'aria-label': '알람음', onchange: () => { c.sound = sound.value; commit('nap'); } }, Object.entries(SOUNDS).map(([k, x]) => h('option', { value: k, selected: k === c.sound }, x.name)));
      opts.replaceChildren(
        h('h2', { class: 'h2' }, '알람 설정'),
        h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, '잠드는 시간 더하기', h('span', { class: 'sub' }, '누워서 잠들 때까지 걸리는 시간만큼 알람을 늦춰요')),
          seg([['0', '없음'], ['5', '5분'], ['10', '10분']], String(c.fall ?? 5), v => { c.fall = Number(v); commit('nap'); })),
        field('알람음', h('div', { class: 'row' }, h('div', { class: 'grow' }, sound), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => preview(sound.value) }, icon('play', 14), '미리 듣기'))),
        h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, '수학 문제를 풀어야 꺼지게', h('span', { class: 'sub' }, '잠결에 끄고 다시 자는 걸 막아 줘요')), switchEl(c.math, on => { c.math = on; commit('nap'); paintOpts(); }, '수학 문제로 끄기')),
        c.math ? h('div', { class: 'grid-2' },
          field('난이도', h('select', { class: 'select', onchange: e => { c.mathLevel = e.target.value; commit('nap'); } }, LEVELS.map(([k, l]) => h('option', { value: k, selected: k === c.mathLevel }, l)))),
          field('문제 수', h('select', { class: 'select', onchange: e => { c.mathCount = Number(e.target.value); commit('nap'); } }, [1, 2, 3, 5].map(n => h('option', { value: n, selected: n === c.mathCount }, `${n}문제`))))) : null);
    }

    function paintHistory() {
      const naps = s.naps || [];
      const k = dkey(), weekAgo = addDays(k, -6);
      const week = naps.filter(n => n.date >= weekAgo);
      const days = Array.from({ length: 7 }, (_, i) => addDays(k, i - 6));
      const max = Math.max(30, ...days.map(d => naps.filter(n => n.date === d).reduce((a, n) => a + n.min, 0)));
      history.replaceChildren(
        h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '최근 7일 낮잠'), h('span', { class: 'small muted num' }, week.length ? `${week.length}번 · 평균 ${Math.round(week.reduce((a, n) => a + n.min, 0) / week.length)}분` : '')),
        h('div', { class: 'nap-week' }, days.map(d => {
          const m = naps.filter(n => n.date === d).reduce((a, n) => a + n.min, 0);
          return h('div', { class: 'nap-day' + (d === k ? ' today' : '') }, h('div', { class: 'nap-bar' }, h('i', { style: { height: (m / max) * 100 + '%' } })), h('span', { class: 'tiny muted num' }, m ? `${m}분` : '–'), h('span', { class: 'tiny' }, '일월화수목금토'[new Date(d + 'T00:00').getDay()]));
        })),
        h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, '낮잠은 하루 한 번, 오후 3시 전에 20분 안쪽이 밤잠에 가장 덜 방해돼요. 밤잠이 모자라 수면 부채가 쌓였다면 90분 한 사이클이 도움이 돼요.'));
    }

    function paint() { paintMain(); paintOpts(); paintHistory(); }
    paint();
    ctx.every(500, () => { if (s.nap) tick(); else if (main.querySelector('.ring')) paint(); });
    ctx.on('change', w => { if (w === 'nap' && !el.contains(document.activeElement)) paint(); });
  },
};
