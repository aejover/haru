// diet.js — 식단: 신체 정보 → BMR/TDEE/목표 칼로리·영양소, 나만의 음식·레시피, 끼니 기록, 식습관 피드백.
import {
  h, icon, store, commit, uid, dkey, addDays, fmtDay, toast, modal, seg, gainXP, ai, jsonOf, textOf, aiFail, obj, pickFiles, fileToBlock,
} from '../core.js';
import { renderSleep } from './sleep.js';

const MEALS = [['breakfast', '아침'], ['lunch', '점심'], ['dinner', '저녁'], ['snack', '간식']];
const ACTIVITY = [[1.2, '거의 안 움직임 (사무직)'], [1.375, '가벼운 활동 (주 1~3회 운동)'], [1.55, '보통 활동 (주 3~5회 운동)'], [1.725, '많은 활동 (주 6~7회 운동)'], [1.9, '매우 많은 활동 (육체 노동·선수)']];
const GOALS = [['lose', '체중 감량'], ['maintain', '체중 유지'], ['gain', '근육 증가']];
const RATIO = { lose: [40, 35, 25], maintain: [50, 20, 30], gain: [50, 25, 25] };
const r1 = v => Math.round(v * 10) / 10;

export function targets(b) {
  const age = +b.age, hgt = +b.height, wgt = +b.weight;
  if (!age || !hgt || !wgt) return null;
  const bmr = 10 * wgt + 6.25 * hgt - 5 * age + (b.sex === 'male' ? 5 : -161);
  const tdee = bmr * (+b.activity || 1.375);
  const kcal = b.goal === 'lose' ? Math.max(bmr, tdee - 500) : b.goal === 'gain' ? tdee + 300 : tdee;
  const [c, p, f] = RATIO[b.goal] || RATIO.maintain;
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal: Math.round(kcal), carb: Math.round((kcal * c) / 100 / 4), protein: Math.round((kcal * p) / 100 / 4), fat: Math.round((kcal * f) / 100 / 9), ratio: [c, p, f] };
}
const sum = list => list.reduce((a, x) => ({ kcal: a.kcal + x.kcal, carb: a.carb + x.carb, protein: a.protein + x.protein, fat: a.fat + x.fat }), { kcal: 0, carb: 0, protein: 0, fat: 0 });

const NUTRI = obj({ name: { type: 'string' }, serving: { type: 'string' }, kcal: { type: 'number' }, carb: { type: 'number' }, protein: { type: 'number' }, fat: { type: 'number' }, note: { type: 'string' } });

export default {
  id: 'diet', title: '건강', icon: 'diet',
  render(el, ctx, arg) {
    el.classList.add('stagger');
    const D = store.s.diet;
    let day = dkey();
    const left = h('div', { class: 'col', style: { gap: '16px', minWidth: 0 } });
    const right = h('div', { class: 'col', style: { gap: '16px' } });
    // 건강 = 수면·에너지 + 식단 (remembers the last section)
    const sleepBox = h('div', { class: 'col', style: { gap: '16px' } });
    const dietBox = h('div', { class: 'diet-layout' }, left, right);
    let section = arg === 'diet' || arg === 'sleep' ? arg : (() => { try { return localStorage.getItem('haru.health') || 'sleep'; } catch { return 'sleep'; } })();
    const show = v => { section = v; try { localStorage.setItem('haru.health', v); } catch { /* ignore */ } sleepBox.hidden = v !== 'sleep'; dietBox.hidden = v !== 'diet'; };
    el.append(h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '건강'), seg([['sleep', '수면 · 에너지'], ['diet', '식단']], section, show)), sleepBox, dietBox);
    renderSleep(sleepBox, ctx);
    show(section);

    function ring(value, goal) {
      const R = 64, C = 2 * Math.PI * R, f = goal ? Math.min(1, value / goal) : 0;
      const over = goal && value > goal;
      return h('div', { class: 'kcal-ring', html: `<svg viewBox="0 0 150 150"><circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--tint-2)" stroke-width="11"/><circle cx="75" cy="75" r="${R}" fill="none" stroke="var(--fg)" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - f)}" style="transition:stroke-dashoffset .9s var(--ease)"/></svg>` },
        h('div', { class: 'c' }, h('b', null, Math.round(value)), h('span', { class: 'tiny muted' }, goal ? (over ? `${Math.round(value - goal)} kcal 초과` : `/ ${goal} kcal`) : 'kcal')));
    }

    function paintToday() {
      const logs = D.logs[day] || [];
      const tot = sum(logs);
      const tg = targets(D.body);
      const macro = (label, v, goal) => h('div', { class: 'macro' }, h('span', null, label), h('div', { class: 'bar' }, h('i', { style: { width: goal ? Math.min(100, (v / goal) * 100) + '%' : '0%' } })), h('span', { class: 'v' }, `${r1(v)}${goal ? ' / ' + goal : ''} g`));
      left.replaceChildren(
        h('section', { class: 'glass card col' },
          h('div', { class: 'row between wrap' },
            h('div', { class: 'row' },
              h('button', { class: 'btn-icon sm', 'aria-label': '전날', onclick: () => { day = addDays(day, -1); paintAll(); } }, icon('left', 18)),
              h('h2', { class: 'h2' }, day === dkey() ? '오늘' : fmtDay(day)),
              h('button', { class: 'btn-icon sm', 'aria-label': '다음날', onclick: () => { day = addDays(day, 1); paintAll(); } }, icon('right', 18))),
            day !== dkey() ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { day = dkey(); paintAll(); } }, '오늘로') : null),
          h('div', { class: 'row wrap', style: { gap: '20px' } }, ring(tot.kcal, tg?.kcal),
            h('div', { class: 'col grow', style: { minWidth: '220px', gap: '12px' } },
              macro('탄수화물', tot.carb, tg?.carb), macro('단백질', tot.protein, tg?.protein), macro('지방', tot.fat, tg?.fat),
              !tg ? h('a', { class: 'small', href: '#', onclick: e => { e.preventDefault(); right.querySelector('input')?.focus(); } }, '오른쪽에 신체 정보를 넣으면 목표가 계산돼요') : null)),
          MEALS.map(([id, label]) => {
            const items = logs.filter(x => x.meal === id), st = sum(items);
            return h('div', { class: 'meal' },
              h('div', { class: 'meal-head' }, h('b', null, label), h('span', { class: 'small muted num' }, items.length ? `${Math.round(st.kcal)} kcal` : ''), h('span', { class: 'spacer' }),
                h('button', { class: 'btn btn-ghost btn-sm', onclick: () => addToMeal(id) }, icon('plus', 14), '추가')),
              items.map(x => h('div', { class: 'food-row' }, h('span', { class: 'grow' }, x.name, x.qty && x.qty !== 1 ? h('span', { class: 'muted' }, ` × ${x.qty}`) : null),
                h('span', { class: 'k' }, `${Math.round(x.kcal)} kcal · 탄${r1(x.carb)} 단${r1(x.protein)} 지${r1(x.fat)}`),
                h('button', { class: 'btn-icon sm', 'aria-label': '삭제', onclick: () => { D.logs[day] = logs.filter(y => y !== x); commit('diet'); paintAll(); } }, icon('x', 14)))));
          })),
        feedbackCard());
    }

    function feedbackCard() {
      const tg = targets(D.body);
      const days = Array.from({ length: 7 }, (_, i) => addDays(dkey(), -i)).filter(k => (D.logs[k] || []).length);
      const tips = [];
      if (!days.length) tips.push('기록이 쌓이면 식습관을 분석해 드려요. 오늘 먹은 것부터 기록해 보세요.');
      else {
        const avg = sum(days.map(k => sum(D.logs[k])));
        const n = days.length;
        const a = { kcal: avg.kcal / n, protein: avg.protein / n, carb: avg.carb / n, fat: avg.fat / n };
        tips.push(`최근 7일 중 ${n}일 기록했어요. 하루 평균 ${Math.round(a.kcal)} kcal를 먹었어요.`);
        if (tg) {
          const diff = (a.kcal - tg.kcal) / tg.kcal;
          if (diff > 0.1) tips.push(`목표(${tg.kcal} kcal)보다 평균 ${Math.round(a.kcal - tg.kcal)} kcal 많아요. 간식이나 음료부터 줄여 보세요.`);
          else if (diff < -0.15) tips.push(`목표보다 ${Math.round(tg.kcal - a.kcal)} kcal 적게 먹고 있어요. 너무 적게 먹으면 근손실과 폭식이 올 수 있어요.`);
          else tips.push('칼로리는 목표 범위 안이에요. 잘하고 있어요.');
          if (a.protein < tg.protein * 0.8) tips.push(`단백질이 평균 ${Math.round(a.protein)}g으로 목표(${tg.protein}g)보다 부족해요. 달걀, 두부, 닭가슴살, 그릭요거트를 더해 보세요.`);
          const fatPct = (a.fat * 9) / Math.max(1, a.kcal) * 100;
          if (fatPct > 35) tips.push(`지방 비율이 ${Math.round(fatPct)}%로 높은 편이에요. 튀김·볶음 대신 구이·찜을 골라 보세요.`);
        }
        if (n < 4) tips.push('기록한 날이 적어서 분석이 정확하지 않을 수 있어요. 매일 기록하면 더 정확해져요.');
      }
      const out = h('div', { class: 'col', style: { gap: '6px' } });
      const btn = h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
        btn.disabled = true; btn.textContent = 'Claude가 분석 중…';
        try {
          const hist = Array.from({ length: 14 }, (_, i) => addDays(dkey(), -i)).map(k => ({ date: k, meals: (D.logs[k] || []).map(x => `${MEALS.find(m => m[0] === x.meal)?.[1]} ${x.name} ${Math.round(x.kcal)}kcal 탄${r1(x.carb)} 단${r1(x.protein)} 지${r1(x.fat)}`) })).filter(x => x.meals.length);
          const resp = await ai({ effort: 'low', max_tokens: 4000, system: '너는 영양사 겸 코치다. 사용자의 최근 식단 기록과 목표를 보고 한국어로 식습관 피드백을 준다. 잘한 점 1개, 고칠 점 2개, 내일 바로 해볼 구체적 행동 1개를 "- " 목록으로, 전체 8줄 이내로 쓴다. 의학적 진단은 하지 않는다.', messages: [{ role: 'user', content: JSON.stringify({ body: D.body, target: targets(D.body), history: hist }) }] });
          out.replaceChildren(h('div', { class: 'summary att', style: { whiteSpace: 'pre-wrap', display: 'block' } }, textOf(resp)));
        } catch (e) { aiFail(e); }
        finally { btn.disabled = false; btn.replaceChildren(icon('sparkle', 14), 'Claude 피드백 받기'); }
      } }, icon('sparkle', 14), 'Claude 피드백 받기');
      return h('section', { class: 'glass card col' }, h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '식습관 피드백'), btn),
        h('div', { class: 'col', style: { gap: '6px' } }, tips.map(t => h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '8px' } }, h('span', { style: { marginTop: '3px' } }, icon('check', 14)), h('span', { class: 'small', style: { lineHeight: 1.6 } }, t)))), out);
    }

    function paintSide() {
      const b = D.body, tg = targets(b);
      const num = (key, label, unit) => h('label', { class: 'field' }, h('span', null, `${label} (${unit})`), h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: b[key], oninput: e => { b[key] = e.target.value; commit('diet'); paintTargets(); paintToday(); } }));
      const sel = (key, label, opts) => h('label', { class: 'field' }, h('span', null, label), h('select', { class: 'select', onchange: e => { b[key] = isNaN(+e.target.value) ? e.target.value : +e.target.value; commit('diet'); paintTargets(); paintToday(); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(b[key]) === String(v) }, l))));
      const tBox = h('div');
      function paintTargets() {
        const t = targets(b);
        tBox.replaceChildren(t ? h('div', { class: 'col', style: { gap: '10px' } },
          h('div', { class: 'grid-3' }, h('div', { class: 'kpi' }, h('b', null, t.bmr), h('span', null, '기초대사량')), h('div', { class: 'kpi' }, h('b', null, t.tdee), h('span', null, '하루 소모 (TDEE)')), h('div', { class: 'kpi' }, h('b', null, t.kcal), h('span', null, '목표 kcal'))),
          h('div', { class: 'small muted' }, `탄수화물 ${t.carb}g · 단백질 ${t.protein}g · 지방 ${t.fat}g (비율 ${t.ratio.join(' : ')})`),
          h('div', { class: 'tiny muted' }, 'Mifflin-St Jeor 공식으로 계산했어요. 감량은 TDEE −500, 근육 증가는 +300 kcal.'))
          : h('p', { class: 'small muted', style: { margin: 0 } }, '나이, 키, 몸무게를 넣으면 하루 권장 칼로리와 영양소 목표를 계산해 드려요.'));
      }
      paintTargets();
      const q = { v: '' };
      const libList = h('div');
      function paintLib() {
        const items = D.foods.filter(f => !q.v || f.name.includes(q.v));
        libList.replaceChildren(items.length ? items.map(f => h('div', { class: 'lib-item' },
          h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'ell', style: { fontWeight: 600 } }, f.name, f.isRecipe ? h('span', { class: 'chip sm line', style: { marginLeft: '6px' } }, '레시피') : null, f.example ? h('span', { class: 'ex-tag', style: { marginLeft: '6px' } }, '예시') : null),
            h('div', { class: 'tiny muted num' }, `${f.serving || '1회'} · ${Math.round(f.kcal)} kcal · 탄${r1(f.carb)} 단${r1(f.protein)} 지${r1(f.fat)}`)),
          h('button', { class: 'btn-icon sm', 'aria-label': '수정', onclick: () => (f.isRecipe ? recipeForm(f) : foodForm(f)) }, icon('pen', 15)),
          h('button', { class: 'btn-icon sm', 'aria-label': '삭제', onclick: () => { D.foods = D.foods.filter(x => x !== f); commit('diet'); paintLib(); } }, icon('trash', 15))))
          : h('p', { class: 'small muted' }, '저장한 음식이 없어요.'));
      }
      paintLib();
      right.replaceChildren(
        h('section', { class: 'glass card col' }, h('h2', { class: 'h2' }, '내 신체 정보'),
          h('div', { class: 'grid-2' }, num('age', '나이', '세'), sel('sex', '성별', [['female', '여성'], ['male', '남성']]), num('height', '키', 'cm'), num('weight', '몸무게', 'kg')),
          sel('activity', '평소 활동량', ACTIVITY), sel('goal', '목표', GOALS), tBox),
        h('section', { class: 'glass card col' },
          h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '나만의 음식 · 레시피'), h('span', { class: 'small muted num' }, `${D.foods.length}개`)),
          h('input', { class: 'input', placeholder: '음식 검색', 'aria-label': '음식 검색', oninput: e => { q.v = e.target.value.trim(); paintLib(); } }),
          h('div', { class: 'row wrap' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => foodForm() }, icon('plus', 14), '음식'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => recipeForm() }, icon('plus', 14), '레시피'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => estimate() }, icon('sparkle', 14), 'Claude로 영양 추정')),
          libList));
      right.paintLib = paintLib;
    }

    // ----- forms -----
    function foodForm(f, after) {
      const v = f ? { ...f } : { name: '', serving: '1회', kcal: '', carb: '', protein: '', fat: '' };
      const inp = (k, label, type = 'number') => h('label', { class: 'field' }, h('span', null, label), h('input', { class: 'input', type, value: v[k], inputmode: type === 'number' ? 'decimal' : undefined, oninput: e => { v[k] = e.target.value; } }));
      modal({
        title: f?.id ? '음식 수정' : '음식 추가',
        body: h('div', { class: 'col' }, inp('name', '이름', 'text'), inp('serving', '1회 제공량 (예: 1공기, 100g)', 'text'),
          h('div', { class: 'grid-2' }, inp('kcal', '칼로리 (kcal)'), inp('carb', '탄수화물 (g)'), inp('protein', '단백질 (g)'), inp('fat', '지방 (g)')), v.note ? h('p', { class: 'small muted', style: { margin: 0 } }, v.note) : null),
        actions: [{ label: '취소' }, {
          label: '저장', primary: true, onClick: () => {
            if (!String(v.name).trim()) { toast('이름을 입력하세요.'); return false; }
            const food = { id: f?.id || uid(), name: String(v.name).trim(), serving: v.serving, kcal: +v.kcal || 0, carb: +v.carb || 0, protein: +v.protein || 0, fat: +v.fat || 0 };
            const i = D.foods.findIndex(x => x.id === food.id);
            if (i >= 0) D.foods[i] = food; else D.foods.unshift(food);
            commit('diet'); right.paintLib?.(); after?.(food);
          },
        }],
      });
    }
    function recipeForm(f) {
      const r = f ? JSON.parse(JSON.stringify(f)) : { name: '', servings: 1, ingredients: [{ name: '', kcal: '', carb: '', protein: '', fat: '' }] };
      const rows = h('div', { class: 'col', style: { gap: '8px' } });
      const total = h('div', { class: 'small muted num' });
      const calc = () => { const t = sum(r.ingredients.map(x => ({ kcal: +x.kcal || 0, carb: +x.carb || 0, protein: +x.protein || 0, fat: +x.fat || 0 }))); const n = Math.max(1, +r.servings || 1); total.textContent = `1인분: ${Math.round(t.kcal / n)} kcal · 탄${r1(t.carb / n)} 단${r1(t.protein / n)} 지${r1(t.fat / n)}`; return { t, n }; };
      const paintRows = () => { rows.replaceChildren(r.ingredients.map((x, i) => h('div', { class: 'row wrap', style: { gap: '6px' } },
        ...['name', 'kcal', 'carb', 'protein', 'fat'].map(k => h('input', { class: 'input', style: { flex: k === 'name' ? '2 1 120px' : '1 1 60px', height: '36px' }, placeholder: { name: '재료', kcal: 'kcal', carb: '탄', protein: '단', fat: '지' }[k], type: k === 'name' ? 'text' : 'number', value: x[k], oninput: e => { x[k] = e.target.value; calc(); } })),
        h('button', { class: 'btn-icon sm', 'aria-label': '재료 삭제', onclick: () => { r.ingredients.splice(i, 1); paintRows(); calc(); } }, icon('x', 14))))); };
      paintRows(); calc();
      modal({
        title: f ? '레시피 수정' : '레시피 만들기', wide: true,
        body: h('div', { class: 'col' },
          h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', null, '레시피 이름'), h('input', { class: 'input', value: r.name, oninput: e => { r.name = e.target.value; } })),
            h('label', { class: 'field' }, h('span', null, '몇 인분'), h('input', { class: 'input', type: 'number', value: r.servings, oninput: e => { r.servings = e.target.value; calc(); } }))),
          h('span', { class: 'section-label' }, '재료 (재료 전체 양 기준 영양 정보)'), rows,
          h('button', { class: 'btn btn-ghost btn-sm', style: { alignSelf: 'flex-start' }, onclick: () => { r.ingredients.push({ name: '', kcal: '', carb: '', protein: '', fat: '' }); paintRows(); } }, icon('plus', 14), '재료 추가'),
          total),
        actions: [{ label: '취소' }, {
          label: '저장', primary: true, onClick: () => {
            if (!r.name.trim()) { toast('레시피 이름을 입력하세요.'); return false; }
            const { t, n } = calc();
            const food = { id: f?.id || uid(), name: r.name.trim(), isRecipe: true, servings: n, ingredients: r.ingredients, serving: '1인분', kcal: r1(t.kcal / n), carb: r1(t.carb / n), protein: r1(t.protein / n), fat: r1(t.fat / n) };
            const i = D.foods.findIndex(x => x.id === food.id);
            if (i >= 0) D.foods[i] = food; else D.foods.unshift(food);
            commit('diet'); right.paintLib?.(); toast('레시피를 저장했어요.');
          },
        }],
      });
    }
    async function estimate(after) {
      let photo = null;
      const text = h('input', { class: 'input', placeholder: '예: 김치찌개 1인분, 스타벅스 카페라떼 톨', 'aria-label': '음식 설명' });
      const ph = h('span', { class: 'small muted' }, '사진으로도 추정할 수 있어요.');
      const m = modal({
        title: 'Claude로 영양 추정',
        body: h('div', { class: 'col' }, text, h('div', { class: 'row' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { const [f] = await pickFiles({ accept: 'image/*' }); if (f) { photo = f; ph.textContent = `사진: ${f.name}`; } } }, icon('image', 14), '음식 사진'), ph),
          h('p', { class: 'tiny muted', style: { margin: 0 } }, '추정치예요. 포장 식품은 영양성분표 값이 더 정확해요.')),
        actions: [{ label: '취소' }, {
          label: '추정하기', primary: true, onClick: async () => {
            if (!text.value.trim() && !photo) { toast('음식 이름이나 사진을 넣어 주세요.'); return false; }
            m.el.querySelector('.modal-foot .btn-ink').textContent = '추정 중…';
            try {
              const content = [];
              if (photo) content.push(await fileToBlock(photo));
              content.push({ type: 'text', text: text.value.trim() || '사진 속 음식의 1회 제공량 영양 정보를 추정해 줘.' });
              const resp = await ai({ effort: 'low', max_tokens: 3000, format: NUTRI, system: '음식의 1회 제공량 기준 영양 정보를 한국 식품 데이터 기준으로 추정한다. name은 한국어 음식 이름, serving은 제공량(예: 1인분 400g), note에는 추정 근거를 한 문장으로.', messages: [{ role: 'user', content }] });
              const d = jsonOf(resp);
              foodForm({ ...d, id: null }, after);
            } catch (e) { aiFail(e); return false; }
          },
        }],
      });
    }
    function addToMeal(meal) {
      let q = '';
      const qty = { v: 1 };
      const list = h('div', { style: { maxHeight: '320px', overflowY: 'auto' } });
      const add = f => {
        const n = +qty.v || 1;
        (D.logs[day] ||= []).push({ id: uid(), foodId: f.id, name: f.name, meal, qty: n, kcal: f.kcal * n, carb: f.carb * n, protein: f.protein * n, fat: f.fat * n });
        commit('diet'); gainXP('diet'); paintToday(); toast(`${f.name} 기록했어요.`); mm.close();
      };
      const paint = () => list.replaceChildren(D.foods.filter(f => !q || f.name.includes(q)).map(f => h('button', { class: 'lib-item', style: { width: '100%', textAlign: 'left' }, onclick: () => add(f) },
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, f.name), h('div', { class: 'tiny muted' }, `${f.serving || '1회'} · ${Math.round(f.kcal)} kcal`)), icon('plus', 16))));
      paint();
      const mm = modal({
        title: `${MEALS.find(m => m[0] === meal)[1]}에 추가`,
        body: h('div', { class: 'col' },
          h('div', { class: 'row' }, h('input', { class: 'input grow', placeholder: '내 음식에서 찾기', oninput: e => { q = e.target.value.trim(); paint(); } }),
            h('label', { class: 'row', style: { gap: '6px', flex: 'none' } }, h('span', { class: 'small muted' }, '수량'), h('input', { class: 'input', type: 'number', step: '0.5', min: '0.5', value: 1, style: { width: '76px' }, oninput: e => { qty.v = e.target.value; } }))),
          list,
          h('div', { class: 'row wrap' }, h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { mm.close(); foodForm(null, f => add(f)); } }, icon('plus', 14), '새 음식 입력'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { mm.close(); estimate(f => { qty.v = 1; add(f); }); } }, icon('sparkle', 14), 'Claude로 추정해서 추가'))),
      });
    }

    function paintAll() { paintToday(); paintSide(); }
    paintAll();
    ctx.on('change', w => { if (w === 'diet' && !el.contains(document.activeElement)) paintToday(); });
  },
};
