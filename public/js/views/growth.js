// growth.js — 커리큘럼: 오늘 vs 어제, 이번 주 vs 지난주, 집중 시간 대시보드, 티어·레벨·전적.
import {
  h, icon, store, dkey, addDays, fmtShort, fmtDur, mondayOf, fromKey, dayStats, weekStats, levelInfo, tierInfo, tierEmblem, record, barChart, FEATURE_NAMES,
} from '../core.js';

function delta(cur, prev, unit, fmt = v => Math.round(v)) {
  const d = cur - prev;
  const cls = Math.abs(d) < 0.5 ? 'flat' : d > 0 ? 'up' : 'down';
  return h('span', { class: 'delta ' + cls }, icon(cls === 'up' ? 'arrowUp' : cls === 'down' ? 'arrowDown' : 'minus', 14), cls === 'flat' ? '변화 없음' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}${unit}`);
}

export default {
  id: 'growth', title: '커리큘럼', icon: 'chart',
  render(el, ctx) {
    el.classList.add('stagger');
    const paint = () => {
      const s = store.s, k = dkey(), y = addDays(k, -1);
      const t = dayStats(k), p = dayStats(y);
      const mon = mondayOf(k), w = weekStats(mon), lw = weekStats(addDays(mon, -7));
      const isMonday = fromKey(k).getDay() === 1;
      const prevW = weekStats(addDays(mon, -14));

      // same thresholds as the daily tier match: more tasks done, or at least a minute more focus
      const grew = t.done > p.done || t.focus > p.focus + 60;
      const fell = !grew && (t.done < p.done || t.focus + 60 < p.focus);
      const idle = !t.done && t.focus < 60;
      const verdict = h('section', { class: 'verdict glass' }, icon(grew ? 'arrowUp' : fell ? 'arrowDown' : 'minus', 34),
        h('div', { class: 'grow' },
          h('div', { class: 'big' }, idle && !p.done && p.focus < 60 ? '오늘의 첫 할 일을 끝내 보세요' : grew ? '어제의 나보다 성장하고 있어요' : fell ? '아직 어제의 나를 따라잡는 중이에요' : '어제와 같은 속도예요'),
          h('div', { class: 'small muted' }, `오늘 할 일 ${t.done}/${t.total} (${Math.round(t.pct)}%) · 어제 ${p.done}/${p.total} (${Math.round(p.pct)}%) · 집중 ${fmtDur(t.focus)} vs ${fmtDur(p.focus)}`)),
        h('a', { class: 'btn btn-ink btn-sm', href: '#checklist' }, '할 일 보기'));

      const kpi = (label, val, sub, d) => h('div', { class: 'kpi-card glass' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, val, sub ? h('small', null, sub) : null), d);
      const kpis = h('div', { class: 'kpi-grid' },
        kpi('오늘 완료율', Math.round(t.pct), '%', h('span', null, delta(t.pct, p.pct, '%p'), h('span', { class: 'tiny muted' }, ' 어제 대비'))),
        kpi('오늘 집중', Math.round(t.focus / 60), '분', h('span', null, delta(t.focus / 60, p.focus / 60, '분'), h('span', { class: 'tiny muted' }, ' 어제 대비'))),
        kpi('이번 주 완료율', Math.round(w.pct), '%', h('span', null, delta(w.pct, lw.pct, '%p'), h('span', { class: 'tiny muted' }, ' 지난주 대비'))),
        kpi('이번 주 집중', (w.focus / 3600).toFixed(1), '시간', h('span', null, delta(w.focus / 3600, lw.focus / 3600, '시간', v => v.toFixed(1)), h('span', { class: 'tiny muted' }, ' 지난주 대비'))));

      const lastWeekReport = h('section', { class: 'glass card col', style: isMonday ? { boxShadow: 'inset 0 0 0 1.5px var(--fg)' } : null },
        h('div', { class: 'row between wrap' }, h('h2', { class: 'h2' }, isMonday ? '월요일 리포트 · 지난주 결산' : '지난주 결산'), h('span', { class: 'chip sm line' }, `${fmtShort(addDays(mon, -7))} ~ ${fmtShort(addDays(mon, -1))}`)),
        lw.total || lw.focus ? h('div', { class: 'grid-3' },
          h('div', { class: 'kpi' }, h('b', null, `${Math.round(lw.pct)}%`), h('span', null, '완료율'), delta(lw.pct, prevW.pct, '%p')),
          h('div', { class: 'kpi' }, h('b', null, `${lw.done}개`), h('span', null, '끝낸 할 일'), delta(lw.done, prevW.done, '개')),
          h('div', { class: 'kpi' }, h('b', null, fmtDur(lw.focus)), h('span', null, '집중 시간'), delta(lw.focus / 60, prevW.focus / 60, '분')))
          : h('p', { class: 'small muted', style: { margin: 0 } }, '지난주 기록이 없어요. 이번 주 기록은 다음 주 월요일에 결산해 드려요.'),
        h('p', { class: 'tiny muted', style: { margin: 0 } }, '매주 월요일, 지난주를 그 전 주와 비교해요. 이기면 티어가 크게 올라요 (+100 LP).'));

      const days = Array.from({ length: 14 }, (_, i) => addDays(k, i - 13));
      const pctChart = barChart(days.map(d => ({ label: fmtShort(d).replace(/\(.\)/, ''), value: dayStats(d).pct, hl: d === k })), { max: 100, fmt: v => `${Math.round(v)}%`, labelEvery: 2 });
      const focusChart = barChart(days.map(d => ({ label: fmtShort(d).replace(/\(.\)/, ''), value: (s.focus[d] || 0) / 60, hl: d === k })), { fmt: v => `${Math.round(v)}분`, labelEvery: 2 });

      const tr = tierInfo(s.tier.lp), lv = levelInfo(s.xp.total), rc = record();
      const todayXP = s.xp.days[k] || {};
      const hist = s.tier.history.slice(-14).reverse();
      el.replaceChildren(
        h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '커리큘럼'), h('span', { class: 'small muted' }, '매일 어제의 나와, 매주 지난주의 나와 겨뤄요')),
        verdict, kpis, lastWeekReport,
        h('div', { class: 'two-col' },
          h('section', { class: 'glass card col' }, h('h2', { class: 'h2' }, '최근 2주 할 일 완료율'), pctChart),
          h('section', { class: 'glass card col' }, h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '최근 2주 집중 시간'), h('a', { class: 'small', href: '#pomodoro' }, '뽀모도로 기준')), focusChart)),
        h('div', { class: 'two-col' },
          h('section', { class: 'glass card col' },
            h('div', { class: 'tier-card' }, h('span', { class: 'tier-emblem', html: tierEmblem(tr.idx, 72) }),
              h('div', { class: 'grow' }, h('span', { class: 'section-label' }, '티어'), h('div', { class: 'h1' }, tr.label), h('div', { class: 'small muted num' }, tr.to ? `${tr.lp} LP · ${tr.next}까지 ${tr.to - tr.lp} LP` : `${tr.lp} LP · 최고 티어`))),
            h('div', { class: 'bar' }, h('i', { style: { width: tr.pct + '%' } })),
            h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, '어제보다 할 일을 더 하거나 더 오래 집중하면 승리(+20, 둘 다면 +30), 둘 다 줄면 패배(−12). 지난주를 이기면 +100.'),
            h('div', { class: 'section-label' }, `전적 ${rc.w}승 ${rc.l}패 ${rc.d}무${rc.games ? ` · 승률 ${rc.rate}%` : ''}`),
            hist.length ? h('div', null, hist.map(x => h('div', { class: 'hist-row' }, h('span', { class: 'res ' + x.result }, x.result === 'W' ? '승' : x.result === 'L' ? '패' : '무'),
              h('span', { class: 'grow' }, fmtShort(x.date), h('span', { class: 'muted' }, ` · 할 일 ${x.done} vs ${x.pDone} · 집중 ${Math.round(x.focus / 60)}분 vs ${Math.round(x.pFocus / 60)}분`)),
              h('b', { class: 'num' }, `${x.delta >= 0 ? '+' : ''}${x.delta}`)))) : h('p', { class: 'small muted', style: { margin: 0 } }, '첫 대결 결과는 내일 나와요.')),
          h('section', { class: 'glass card col' },
            h('div', { class: 'row' }, h('div', { class: 'grow' }, h('span', { class: 'section-label' }, '레벨'), h('div', { class: 'h1' }, `Lv.${lv.level}`), h('div', { class: 'small muted num' }, `누적 ${s.xp.total} XP · 다음 레벨까지 ${lv.need - lv.cur} XP`)), icon('trophy', 44, 1.3)),
            h('div', { class: 'bar' }, h('i', { style: { width: lv.pct + '%' } })),
            h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, '앱의 기능을 쓸 때마다 경험치가 쌓여요. 처음 쓰는 기능은 +30 보너스.'),
            h('div', { class: 'section-label' }, '오늘 얻은 경험치'),
            Object.keys(todayXP).length ? h('div', { class: 'emo-chips' }, Object.entries(todayXP).map(([f, n]) => h('span', { class: 'chip sm' }, `${FEATURE_NAMES[f] || f} ×${n}`))) : h('p', { class: 'small muted', style: { margin: 0 } }, '오늘은 아직 경험치가 없어요.'),
            h('div', { class: 'section-label' }, '아직 안 써 본 기능'),
            h('div', { class: 'emo-chips' }, Object.entries(FEATURE_NAMES).filter(([f]) => !s.xp.firsts[f]).map(([, n]) => h('span', { class: 'chip sm line' }, `${n} +30`))))));
    };
    paint();
    ctx.on('change', w => { if (['tasks', 'tier', 'pomo'].includes(w)) paint(); });
    ctx.on('xp', paint);
  },
};
