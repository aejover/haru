// diary.js — 일기: 제목·날짜·감정(직접 or Claude 추천)·오늘의 평가, 본문, 사진·영상, 월간 통계, 일기 캘린더, 1년 전 오늘.
import {
  h, icon, store, commit, uid, dkey, fromKey, addDays, fmtDay, monthKey, WEEK, toast, upload, pickFiles, gainXP, ai, jsonOf, aiFail, obj, debounce, confirmDialog,
} from '../core.js';

export const RATINGS = [
  [5, '최고의 날', 'face5', '#22A06B'], [4, '좋은 날', 'face4', '#3B82F6'], [3, '보통 날', 'face3', '#E0A82E'], [2, '안 좋은 날', 'face2', '#F07B32'], [1, '최악의 날', 'face1', '#E5484D'],
];
const rateOf = n => RATINGS.find(r => r[0] === n);
const rateColor = n => rateOf(n)?.[3] || 'var(--fg)';

function yearAgo(k) {
  const d = fromKey(k);
  const t = new Date(d.getFullYear() - 1, d.getMonth(), d.getDate());
  return dkey(t);
}

export default {
  id: 'diary', title: '일기', icon: 'diary',
  render(el, ctx, arg) {
    el.classList.add('stagger');
    const s = store.s;
    let date = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : dkey();
    let ym = date.slice(0, 7);
    const left = h('div', { class: 'col', style: { gap: '16px', minWidth: 0 } });
    const right = h('div', { class: 'col', style: { gap: '16px' } });
    el.append(h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '일기')), h('div', { class: 'diary-layout' }, left, right));

    const entryFor = k => s.diary.find(e => e.date === k);

    function paintEditor() {
      let e = entryFor(date);
      const draft = e || { id: uid(), date, title: '', emotion: '', rating: 0, body: '', media: [] };
      const ensure = () => { if (!entryFor(date)) { s.diary.push(draft); e = draft; } return draft; };
      const touch = debounce(() => { if (!draft.title && !draft.body && !draft.emotion && !draft.rating && !draft.media.length) return; ensure(); draft.updatedAt = Date.now(); commit('diary'); paintSide(); }, 700);

      const dateIn = h('input', { class: 'input', type: 'date', value: date, 'aria-label': '날짜', style: { width: '170px' }, onchange: () => { if (dateIn.value) { date = dateIn.value; ym = date.slice(0, 7); paintAll(); } } });
      const title = h('input', { class: 'input bare memo-title', placeholder: '오늘의 제목', value: draft.title, 'aria-label': '일기 제목', oninput: () => { draft.title = title.value; touch(); } });
      const emotion = h('input', { class: 'input', placeholder: '오늘의 감정 (예: 뿌듯함, 설렘)', value: draft.emotion, 'aria-label': '오늘의 감정', oninput: () => { draft.emotion = emotion.value; touch(); } });
      const chips = h('div', { class: 'emo-chips' });
      const suggestBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: suggest }, icon('sparkle', 14), 'Claude 추천');
      const rateRow = h('div', { class: 'rate-row', role: 'radiogroup', 'aria-label': '오늘은 어떤 날이었나요' });
      const paintRate = () => rateRow.replaceChildren(RATINGS.map(([n, label, ic, color]) => h('button', { class: 'rate' + (draft.rating === n ? ' on' : ''), style: { '--rc': color }, role: 'radio', 'aria-checked': String(draft.rating === n), onclick: () => { draft.rating = n; paintRate(); touch(); } }, icon(ic, 28, 1.6), label)));
      paintRate();
      const body = h('textarea', { class: 'textarea diary-body', placeholder: '오늘 있었던 일을 적어 보세요.', 'aria-label': '오늘 있었던 일' });
      body.value = draft.body || '';
      const grow = () => { body.style.height = 'auto'; body.style.height = Math.max(220, body.scrollHeight + 4) + 'px'; };
      body.addEventListener('input', () => { draft.body = body.value; grow(); touch(); });
      requestAnimationFrame(grow);
      const mediaGrid = h('div', { class: 'img-grid' });
      const paintMedia = () => {
        mediaGrid.replaceChildren(draft.media.map(m => h('figure', null,
          m.type === 'video' ? h('video', { src: m.url, controls: true, preload: 'metadata' }) : h('a', { href: m.url, target: '_blank', rel: 'noopener' }, h('img', { src: m.url, alt: '' })),
          h('button', { class: 'btn-icon sm', 'aria-label': '첨부 삭제', onclick: () => { draft.media = draft.media.filter(x => x !== m); touch(); paintMedia(); } }, icon('x', 14)))));
        mediaGrid.hidden = !draft.media.length;
      };
      paintMedia();
      async function attach() {
        const files = await pickFiles({ accept: 'image/*,video/*', multiple: true });
        for (const f of files) {
          try { const up = await upload(f); draft.media.push({ type: f.type.startsWith('video/') ? 'video' : 'image', url: up.url, name: f.name }); }
          catch (err) { toast(err.message); }
        }
        ensure(); touch(); paintMedia();
      }
      async function suggest() {
        const text = [draft.title, draft.body].filter(Boolean).join('\n');
        if (text.length < 10) { toast('오늘 있었던 일을 조금 적으면 감정을 추천해 드릴게요.'); body.focus(); return; }
        suggestBtn.disabled = true; suggestBtn.textContent = '읽는 중…';
        try {
          const resp = await ai({
            effort: 'low', max_tokens: 3000,
            format: obj({ emotions: { type: 'array', items: { type: 'string' } }, rating: { type: 'integer' }, comment: { type: 'string' } }),
            system: '사용자의 일기를 읽고 그날 느꼈을 감정을 한국어 단어로 3~5개 고른다 (예: 뿌듯함, 피곤함, 설렘, 서운함). rating은 1(최악)~5(최고) 중 일기에 어울리는 값. comment는 일기를 읽은 친구처럼 건네는 따뜻한 한 문장.',
            messages: [{ role: 'user', content: text }],
          });
          const d = jsonOf(resp);
          chips.replaceChildren((d.emotions || []).map(w => h('button', { class: 'chip sm', onclick: ev => {
            const list = emotion.value.split(/[,·]/).map(x => x.trim()).filter(Boolean);
            if (!list.includes(w)) list.push(w);
            emotion.value = list.join(', '); draft.emotion = emotion.value; touch(); ev.currentTarget.classList.add('on');
          } }, w)),
          d.rating && !draft.rating ? h('button', { class: 'chip sm line', onclick: () => { draft.rating = d.rating; paintRate(); touch(); } }, `"${rateOf(d.rating)?.[1]}" 선택`) : null,
          d.comment ? h('div', { class: 'small muted', style: { width: '100%', marginTop: '4px' } }, d.comment) : null);
        } catch (err) { aiFail(err); }
        finally { suggestBtn.disabled = false; suggestBtn.replaceChildren(icon('sparkle', 14), 'Claude 추천'); }
      }
      function save() {
        if (!draft.title && !draft.body) { toast('제목이나 내용을 적어 주세요.'); return; }
        ensure(); draft.updatedAt = Date.now();
        const first = !draft.savedOnce; draft.savedOnce = true;
        commit('diary'); paintSide();
        if (first) gainXP('diary');
        toast('일기를 저장했어요.', { icon: 'diary' });
      }

      const ago = entryFor(yearAgo(date));
      left.replaceChildren(
        h('section', { class: 'glass card col' },
          h('div', { class: 'row wrap' }, dateIn, h('span', { class: 'small muted' }, fmtDay(date, true)), h('span', { class: 'spacer' }),
            e ? h('button', { class: 'btn-icon sm', 'aria-label': '일기 삭제', onclick: async () => { if (await confirmDialog('이 날의 일기를 삭제할까요?', { ok: '삭제', danger: true })) { s.diary = s.diary.filter(x => x !== e); commit('diary'); paintAll(); } } }, icon('trash', 16)) : null),
          title,
          h('div', { class: 'field' }, h('span', null, '오늘의 감정'), h('div', { class: 'row' }, h('div', { class: 'grow' }, emotion), suggestBtn), chips),
          h('div', { class: 'field' }, h('span', null, '오늘은 어떤 날이었나요?'), rateRow),
          h('div', { class: 'field' }, h('span', null, '오늘 있었던 일'), body),
          mediaGrid,
          h('div', { class: 'row wrap' }, h('button', { class: 'btn btn-ghost', onclick: attach }, icon('image', 16), '사진 · 영상 첨부'), h('span', { class: 'spacer' }), h('button', { class: 'btn btn-ink', onclick: save }, icon('check', 16), '저장'))),
        h('section', { class: 'year-ago glass' },
          h('div', { class: 'row' }, icon('reset', 18), h('h2', { class: 'h2' }, '1년 전 오늘의 나'), h('span', { class: 'small muted' }, fmtDay(yearAgo(date), true))),
          ago ? [
            h('div', { class: 'row' }, ago.rating ? h('span', { class: 'chip sm', style: { background: rateColor(ago.rating), color: '#fff' } }, icon(rateOf(ago.rating)[2], 14), rateOf(ago.rating)[1]) : null, ago.emotion ? h('span', { class: 'chip sm line' }, ago.emotion) : null),
            h('b', null, ago.title || '제목 없음'),
            h('div', { class: 'quote' }, ago.body),
            ago.media?.length ? h('div', { class: 'img-grid' }, ago.media.filter(m => m.type === 'image').slice(0, 4).map(m => h('figure', null, h('img', { src: m.url, alt: '' })))) : null,
          ] : h('p', { class: 'small muted', style: { margin: 0 } }, '1년 전 이날의 일기는 없어요. 오늘 쓴 일기는 내년 오늘 여기에서 다시 만나요.')));
    }

    function paintSide() {
      const [y, m] = ym.split('-').map(Number);
      const first = new Date(y, m - 1, 1);
      const start = addDays(dkey(first), -first.getDay());
      const grid = h('div', { class: 'cal-grid mood-cal' }, WEEK.map((w, i) => h('div', { class: 'cal-dow' + (i === 0 ? ' sun' : '') }, w)));
      for (let i = 0; i < 42; i++) {
        const k = addDays(start, i), d = fromKey(k);
        if (i >= 35 && d.getMonth() !== m - 1) break;
        const e = entryFor(k);
        grid.append(h('button', { class: 'cal-cell' + (d.getMonth() !== m - 1 ? ' other' : '') + (k === dkey() ? ' today' : '') + (k === date ? ' sel' : ''), onclick: () => { date = k; paintAll(); }, 'aria-label': `${d.getDate()}일${e ? ' 일기 있음' : ''}` },
          h('span', { class: 'd' }, d.getDate()),
          e ? (e.rating ? h('span', { class: 'mood-face', style: { color: rateColor(e.rating) } }, icon(rateOf(e.rating)[2], 20, 1.8)) : h('span', { class: 'dots-row' }, h('i'))) : null));
      }
      // monthly stats
      const month = s.diary.filter(e => e.date.startsWith(ym));
      const rated = month.filter(e => e.rating);
      const avg = rated.length ? rated.reduce((a, e) => a + e.rating, 0) / rated.length : 0;
      const counts = Object.fromEntries(RATINGS.map(r => [r[0], rated.filter(e => e.rating === r[0]).length]));
      const maxC = Math.max(1, ...Object.values(counts));
      const words = {};
      month.forEach(e => (e.emotion || '').split(/[,·\s]+/).map(w => w.trim()).filter(Boolean).forEach(w => { words[w] = (words[w] || 0) + 1; }));
      const top = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const best = rated.slice().sort((a, b) => b.rating - a.rating)[0];
      right.replaceChildren(
        h('section', { class: 'glass card col' },
          h('div', { class: 'row between' },
            h('button', { class: 'btn-icon sm', 'aria-label': '이전 달', onclick: () => { ym = monthKey(new Date(y, m - 2, 1)); paintSide(); } }, icon('left', 18)),
            h('b', null, `${y}년 ${m}월 일기`),
            h('button', { class: 'btn-icon sm', 'aria-label': '다음 달', onclick: () => { ym = monthKey(new Date(y, m, 1)); paintSide(); } }, icon('right', 18))),
          grid,
          h('p', { class: 'tiny muted', style: { margin: 0 } }, '날짜를 누르면 그날의 일기를 열어요.')),
        h('section', { class: 'glass card col' },
          h('div', { class: 'row between' }, h('h2', { class: 'h2' }, `${m}월 통계`), h('span', { class: 'small muted num' }, `일기 ${month.length}편`)),
          rated.length ? [
            h('div', { class: 'row' }, h('div', { class: 'kpi' }, h('b', null, avg.toFixed(1)), h('span', null, '평균 (5점 만점)')), h('span', { class: 'spacer' }), h('span', { style: { color: rateColor(Math.round(avg)), display: 'inline-flex' } }, icon(rateOf(Math.round(avg))[2], 40, 1.6))),
            ...RATINGS.map(([n, label, , color]) => h('div', { class: 'dist-row' }, h('span', null, label), h('div', { class: 'bar' }, h('i', { style: { width: (counts[n] / maxC) * 100 + '%', background: color } })), h('span', { class: 'num muted', style: { textAlign: 'right' } }, `${counts[n]}일`))),
            top.length ? h('div', { class: 'col', style: { gap: '6px' } }, h('span', { class: 'section-label' }, '자주 느낀 감정'), h('div', { class: 'emo-chips' }, top.map(([w, c]) => h('span', { class: 'chip sm' }, `${w} ${c}`)))) : null,
            best ? h('button', { class: 'small', style: { textAlign: 'left' }, onclick: () => { date = best.date; paintAll(); } }, '이번 달 최고의 날: ', h('b', null, `${fromKey(best.date).getDate()}일 · ${best.title || '제목 없음'}`)) : null,
          ] : h('p', { class: 'small muted', style: { margin: 0 } }, '일기에 "오늘은 어떤 날"을 고르면 한 달 동안의 기분 통계가 여기에 쌓여요.')));
    }
    function paintAll() { paintEditor(); paintSide(); }
    paintAll();
  },
};
