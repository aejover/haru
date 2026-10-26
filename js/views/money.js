// money.js — 가계부: 맨 위 빌린 돈·빌려준 돈, 그 아래 수입·지출 기록, 예산, 고정 지출, 분류별·날짜별 통계,
// 영수증 사진 읽기(Claude), 소비 분석(Claude), CSV 내보내기.
import { h, icon, store, commit, uid, dkey, addDays, fromKey, fmtShort, monthKey, modal, seg, toast, confirmDialog, promptDialog, gainXP, ai, jsonOf, textOf, aiFail, obj, pickFiles, fileToBlock, download } from '../core.js';

export const CATS = {
  out: [['food', '식비', '#E07A6B'], ['cafe', '카페 · 간식', '#D9A441'], ['trans', '교통', '#5B8FD6'], ['shop', '쇼핑', '#E57FA8'], ['life', '생활', '#5FB3A3'], ['house', '주거 · 통신', '#9A7BD1'], ['fun', '문화 · 여가', '#E8935A'], ['health', '의료 · 건강', '#9DC25A'], ['edu', '교육', '#4FB0D9'], ['gift', '경조사 · 선물', '#C77DBA'], ['etc', '기타', '#7D8590']],
  in: [['salary', '월급', '#22A06B'], ['allow', '용돈', '#3B82F6'], ['side', '부수입', '#D9A441'], ['fin', '금융 수입', '#5FB3A3'], ['etcin', '기타', '#7D8590']],
};
const CAT = Object.fromEntries([...CATS.out, ...CATS.in].map(([id, name, color]) => [id, { name, color }]));
const METHODS = ['카드', '현금', '계좌이체', '간편결제'];
const won = n => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const toNum = v => Math.round(Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);
const M = () => (store.s.money ||= { tx: [], fixed: [], budget: { total: 0, cats: {} }, debts: [] });
const daysIn = ym => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();
const shiftMonth = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1); return monthKey(d); };
const ymText = ym => `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`;

// fixed income/expenses land in the ledger on their day each month (once per month)
function applyFixed() {
  const m = M(), k = dkey(), ym = k.slice(0, 7);
  let added = 0;
  for (const f of m.fixed) {
    const day = Math.min(f.day, daysIn(ym));
    const date = `${ym}-${String(day).padStart(2, '0')}`;
    if (date > k || f.from > date || m.tx.some(t => t.fixedId === f.id && t.date.startsWith(ym))) continue;
    m.tx.push({ id: uid(), type: f.type, amount: f.amount, cat: f.cat, memo: f.name, date, method: f.method || '계좌이체', fixedId: f.id });
    added++;
  }
  if (added) commit('money');
  return added;
}

function catChips(type, value, onPick) {
  const box = h('div', { class: 'mn-cats' });
  const paint = (t, v) => box.replaceChildren(...CATS[t].map(([id, name, color]) => h('button', { type: 'button', class: 'mn-cat' + (id === v ? ' on' : ''), style: { '--cc': color }, onclick: () => { onPick(id); paint(t, id); } }, h('i'), name)));
  paint(type, value);
  box.repaint = paint;
  return box;
}

function editTx(tx, isNew, onDone) {
  const v = { ...tx };
  const field = (label, x) => h('label', { class: 'field' }, h('span', null, label), x);
  const amount = h('input', { class: 'input mn-amount num', inputmode: 'numeric', value: v.amount ? v.amount.toLocaleString('ko-KR') : '', placeholder: '0', oninput: e => { const n = toNum(e.target.value); e.target.value = n ? n.toLocaleString('ko-KR') : ''; } });
  const memo = h('input', { class: 'input', value: v.memo || '', placeholder: '어디에 썼나요? (예: 점심 김밥, 버스)' });
  const date = h('input', { class: 'input', type: 'date', value: v.date });
  const method = h('select', { class: 'select' }, METHODS.map(x => h('option', { value: x, selected: x === v.method }, x)));
  const cats = catChips(v.type, v.cat, c => { v.cat = c; });
  modal({
    title: isNew ? '기록 추가' : '기록 수정',
    body: h('div', { class: 'col' },
      seg([['out', '지출'], ['in', '수입']], v.type, t => { v.type = t; v.cat = CATS[t][0][0]; cats.repaint(t, v.cat); }),
      field('금액 (원)', amount), h('div', { class: 'field' }, h('span', null, '분류'), cats), field('내용', memo),
      h('div', { class: 'grid-2' }, field('날짜', date), field('결제 수단', method))),
    actions: [
      isNew ? null : { label: '삭제', danger: true, onClick: async () => { if (!(await confirmDialog('이 기록을 지울까요?', { ok: '삭제', danger: true }))) return false; M().tx = M().tx.filter(x => x.id !== tx.id); commit('money'); onDone(); } },
      { label: '취소' },
      { label: isNew ? '추가' : '저장', primary: true, onClick: () => {
        const n = toNum(amount.value);
        if (n <= 0) { toast('금액을 적어 주세요.'); amount.focus(); return false; }
        Object.assign(tx, v, { amount: n, memo: memo.value.trim(), date: date.value || dkey(), method: method.value });
        if (isNew) { M().tx.push(tx); gainXP('money'); }
        commit('money'); onDone();
      } },
    ].filter(Boolean),
  });
}

function editFixed(f, isNew, onDone) {
  const v = { ...f };
  const field = (label, x) => h('label', { class: 'field' }, h('span', null, label), x);
  const name = h('input', { class: 'input', value: v.name || '', placeholder: '예: 월세, 휴대폰 요금, 넷플릭스, 월급' });
  const amount = h('input', { class: 'input num', inputmode: 'numeric', value: v.amount ? v.amount.toLocaleString('ko-KR') : '', placeholder: '0', oninput: e => { const n = toNum(e.target.value); e.target.value = n ? n.toLocaleString('ko-KR') : ''; } });
  const day = h('input', { class: 'input num', type: 'number', min: 1, max: 31, value: v.day || 1 });
  const cats = catChips(v.type, v.cat, c => { v.cat = c; });
  modal({
    title: isNew ? '고정 수입 · 지출 추가' : '고정 수입 · 지출 수정',
    body: h('div', { class: 'col' },
      seg([['out', '고정 지출'], ['in', '고정 수입']], v.type, t => { v.type = t; v.cat = CATS[t][0][0]; cats.repaint(t, v.cat); }),
      field('이름', name), h('div', { class: 'grid-2' }, field('금액 (원)', amount), field('매달 며칠', day)),
      h('div', { class: 'field' }, h('span', null, '분류'), cats),
      h('div', { class: 'tiny muted' }, '매달 그 날짜가 되면 가계부에 자동으로 들어가요.')),
    actions: [
      isNew ? null : { label: '삭제', danger: true, onClick: () => { M().fixed = M().fixed.filter(x => x.id !== f.id); commit('money'); onDone(); } },
      { label: '취소' },
      { label: '저장', primary: true, onClick: () => {
        if (!name.value.trim() || toNum(amount.value) <= 0) { toast('이름과 금액을 적어 주세요.'); return false; }
        Object.assign(f, v, { name: name.value.trim(), amount: toNum(amount.value), day: Math.max(1, Math.min(31, Math.round(Number(day.value) || 1))) });
        if (isNew) M().fixed.push(f);
        commit('money'); applyFixed(); onDone();
      } },
    ].filter(Boolean),
  });
}

function editBudget(onDone) {
  const b = M().budget;
  const field = (label, x) => h('label', { class: 'field' }, h('span', null, label), x);
  const fmt = e => { const n = toNum(e.target.value); e.target.value = n ? n.toLocaleString('ko-KR') : ''; };
  const total = h('input', { class: 'input num', inputmode: 'numeric', value: b.total ? b.total.toLocaleString('ko-KR') : '', placeholder: '예: 800,000', oninput: fmt });
  const per = CATS.out.map(([id, name]) => [id, h('input', { class: 'input num', inputmode: 'numeric', value: b.cats?.[id] ? b.cats[id].toLocaleString('ko-KR') : '', placeholder: '없음', 'aria-label': `${name} 예산`, oninput: fmt })]);
  modal({
    title: '한 달 예산', wide: true,
    body: h('div', { class: 'col' }, field('한 달 전체 예산 (원)', total),
      h('div', { class: 'section-label' }, '분류별 예산 (선택)'),
      h('div', { class: 'mn-budget-grid' }, per.map(([id, inp]) => h('label', { class: 'field' }, h('span', null, CAT[id].name), inp)))),
    actions: [{ label: '취소' }, { label: '저장', primary: true, onClick: () => {
      b.total = toNum(total.value); b.cats = {};
      per.forEach(([id, inp]) => { const n = toNum(inp.value); if (n > 0) b.cats[id] = n; });
      commit('money'); onDone();
    } }],
  });
}

// ---------- 빌린 돈 · 빌려준 돈 ----------
const debtLeft = d => Math.max(0, d.amount - (d.payments || []).reduce((a, p) => a + p.amount, 0));
function debtsCard(paint) {
  const m = M();
  const f = { type: 'borrow' };
  const who = h('input', { class: 'input', placeholder: '누구에게 / 누구한테', 'aria-label': '사람' });
  const amount = h('input', { class: 'input num', inputmode: 'numeric', placeholder: '금액', 'aria-label': '금액', oninput: e => { const n = toNum(e.target.value); e.target.value = n ? n.toLocaleString('ko-KR') : ''; } });
  const date = h('input', { class: 'input', type: 'date', value: dkey(), 'aria-label': '빌린 날' });
  const due = h('input', { class: 'input', type: 'date', 'aria-label': '갚기로 한 날 (선택)' });
  const memo = h('input', { class: 'input', placeholder: '메모 (선택)', 'aria-label': '메모' });
  const typeSeg = seg([['borrow', '빌린 돈'], ['lend', '빌려준 돈']], 'borrow', v => { f.type = v; who.placeholder = v === 'borrow' ? '누구에게 빌렸나요?' : '누구에게 빌려줬나요?'; });
  who.placeholder = '누구에게 빌렸나요?';
  const add = () => {
    const n = toNum(amount.value);
    if (!who.value.trim() || n <= 0) { toast('사람과 금액을 적어 주세요.'); (who.value.trim() ? amount : who).focus(); return; }
    m.debts.push({ id: uid(), type: f.type, who: who.value.trim(), amount: n, date: date.value || dkey(), due: due.value || '', memo: memo.value.trim(), payments: [] });
    gainXP('money'); commit('money');
    toast(f.type === 'borrow' ? `${who.value.trim()}에게 빌린 ${won(n)}을 적었어요.` : `${who.value.trim()}에게 빌려준 ${won(n)}을 적었어요.`, { icon: 'wallet' });
    who.value = ''; amount.value = ''; due.value = ''; memo.value = '';
    paint();
  };
  const pay = async d => {
    const left = debtLeft(d);
    const v = await promptDialog(d.type === 'borrow' ? `얼마를 갚았나요? (남은 돈 ${won(left)})` : `얼마를 받았나요? (남은 돈 ${won(left)})`, { value: String(left), ok: '기록' });
    const n = Math.min(left, toNum(v));
    if (!n) return;
    d.payments.push({ date: dkey(), amount: n });
    if (debtLeft(d) === 0) { d.closed = dkey(); toast(d.type === 'borrow' ? '다 갚았어요!' : '다 받았어요!', { icon: 'check' }); }
    commit('money'); paint();
  };
  const settle = d => { d.payments.push({ date: dkey(), amount: debtLeft(d) }); d.closed = dkey(); commit('money'); toast(d.type === 'borrow' ? '다 갚은 걸로 정리했어요.' : '다 받은 걸로 정리했어요.', { icon: 'check' }); paint(); };
  const row = d => {
    const left = debtLeft(d), paid = d.amount - left;
    const dd = d.due ? Math.round((fromKey(d.due) - fromKey(dkey())) / 864e5) : null;
    return h('div', { class: 'mn-debt' + (d.closed ? ' closed' : '') },
      h('div', { class: 'row between', style: { gap: '8px' } },
        h('div', { style: { minWidth: 0 } }, h('b', null, d.who), d.memo ? h('span', { class: 'small muted' }, ` · ${d.memo}`) : null),
        h('b', { class: 'num' }, won(left))),
      h('div', { class: 'bar thin' }, h('i', { style: { width: (paid / d.amount) * 100 + '%', background: d.type === 'borrow' ? 'var(--bad)' : 'var(--good)' } })),
      h('div', { class: 'row between wrap', style: { gap: '6px' } },
        h('span', { class: 'tiny muted' }, `${fmtShort(d.date)} · ${won(d.amount)}`, paid && !d.closed ? ` 중 ${won(paid)} ${d.type === 'borrow' ? '갚음' : '받음'}` : '',
          d.closed ? ` · ${fmtShort(d.closed)} 정리됨` : dd == null ? '' : dd < 0 ? h('b', { class: 'mn-late' }, ` · ${-dd}일 지남`) : dd === 0 ? h('b', { class: 'mn-late' }, ' · 오늘까지') : ` · D-${dd}`),
        d.closed
          ? h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { if (!(await confirmDialog('이 기록을 지울까요?', { ok: '삭제', danger: true }))) return; m.debts = m.debts.filter(x => x !== d); commit('money'); paint(); } }, icon('trash', 13), '지우기')
          : h('div', { class: 'row', style: { gap: '4px' } },
            h('button', { class: 'btn btn-ghost btn-sm', onclick: () => pay(d) }, d.type === 'borrow' ? '일부 갚음' : '일부 받음'),
            h('button', { class: 'btn btn-ink btn-sm', onclick: () => settle(d) }, d.type === 'borrow' ? '다 갚음' : '다 받음'))));
  };
  const col = (type, title, empty) => {
    const open = m.debts.filter(d => d.type === type && !d.closed).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
    const closed = m.debts.filter(d => d.type === type && d.closed);
    const sum = open.reduce((a, d) => a + debtLeft(d), 0);
    const more = h('div', { class: 'col', hidden: true, style: { gap: '8px' } }, closed.slice(-10).reverse().map(row));
    return h('div', { class: 'mn-debt-col ' + type },
      h('div', { class: 'row between' }, h('span', { class: 'small muted' }, title), h('b', { class: 'mn-debt-sum num' }, won(sum))),
      open.length ? open.map(row) : h('div', { class: 'small muted', style: { padding: '8px 0' } }, empty),
      closed.length ? h('button', { class: 'btn btn-ghost btn-sm', style: { alignSelf: 'flex-start' }, onclick: e => { more.hidden = !more.hidden; e.currentTarget.textContent = more.hidden ? `정리된 거래 ${closed.length}개 보기` : '정리된 거래 숨기기'; } }, `정리된 거래 ${closed.length}개 보기`) : null,
      more);
  };
  // the totals come first; the form folds open from the 적기 button
  const form = h('div', { class: 'fold' }, h('div', { class: 'mn-debt-form' }, typeSeg, h('div', { class: 'mn-debt-inputs' }, who, amount, h('label', { class: 'mn-date' }, h('span', { class: 'tiny muted' }, '날짜'), date), h('label', { class: 'mn-date' }, h('span', { class: 'tiny muted' }, '갚기로 한 날'), due), memo, h('button', { class: 'btn btn-ink', onclick: add }, icon('plus', 16), '적기'))));
  const toggle = h('button', { class: 'btn btn-ghost btn-sm', 'aria-expanded': 'false', onclick: () => {
    const open = form.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.replaceChildren(icon(open ? 'x' : 'plus', 14), open ? '닫기' : '적기');
    if (open) setTimeout(() => who.focus({ preventScroll: true }), 250);
  } }, icon('plus', 14), '적기');
  return h('section', { class: 'glass card col' },
    h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '빌린 돈 · 빌려준 돈'), toggle),
    form,
    h('div', { class: 'mn-debt-cols' },
      col('borrow', '내가 갚을 돈', '빌린 돈이 없어요.'),
      col('lend', '내가 받을 돈', '빌려준 돈이 없어요.')));
}

// ---------- Claude helpers ----------
async function readReceipt(btn, paint) {
  const [file] = await pickFiles({ accept: 'image/*' });
  if (!file) return;
  btn.disabled = true; const label = [...btn.childNodes]; btn.textContent = 'Claude가 읽는 중…';
  try {
    const resp = await ai({
      effort: 'low', max_tokens: 4000,
      format: obj({ items: { type: 'array', items: obj({ date: { type: 'string', description: 'YYYY-MM-DD' }, amount: { type: 'integer' }, type: { type: 'string', enum: ['out', 'in'] }, cat: { type: 'string', enum: Object.keys(CAT) }, memo: { type: 'string' } }) } }),
      system: '너는 영수증·카드 명세서·이체 내역 사진을 읽어 가계부 기록으로 바꾸는 도우미다. 사진에 실제로 있는 결제만 뽑고, 영수증 하나는 합계 금액 하나로 적는다. 명세서처럼 여러 건이면 건마다 적는다. memo는 가게 이름이나 내용을 짧게. 날짜가 없으면 오늘 날짜를 쓴다.',
      messages: [{ role: 'user', content: [await fileToBlock(file), { type: 'text', text: `오늘은 ${dkey()}이다. 이 사진의 결제 내역을 가계부 기록으로 바꿔 줘.` }] }],
    });
    const items = (jsonOf(resp).items || []).filter(x => x.amount > 0);
    if (!items.length) { toast('사진에서 결제 내역을 찾지 못했어요.'); return; }
    const pick = new Set(items.map((_, i) => i));
    modal({
      title: `찾은 기록 ${items.length}개`,
      body: h('div', null, items.map((x, i) => {
        const c = CAT[x.cat] ? x.cat : x.type === 'in' ? 'etcin' : 'etc';
        const cb = h('input', { type: 'checkbox', checked: true, onchange: e => { e.target.checked ? pick.add(i) : pick.delete(i); } });
        return h('label', { class: 'item-row' }, cb, h('span', { class: 'chip sm line num' }, fmtShort(/^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : dkey())), h('span', { class: 'grow' }, x.memo || CAT[c].name, h('span', { class: 'tiny muted' }, ` · ${CAT[c].name}`)), h('b', { class: 'num' + (x.type === 'in' ? ' mn-in' : '') }, (x.type === 'in' ? '+' : '-') + won(x.amount)));
      })),
      actions: [{ label: '취소' }, { label: '가계부에 넣기', primary: true, onClick: () => {
        items.forEach((x, i) => { if (!pick.has(i)) return; M().tx.push({ id: uid(), type: x.type === 'in' ? 'in' : 'out', amount: x.amount, cat: CAT[x.cat] ? x.cat : x.type === 'in' ? 'etcin' : 'etc', memo: x.memo || '', date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : dkey(), method: '카드' }); });
        gainXP('money'); commit('money'); paint(); toast(`${pick.size}개를 넣었어요.`, { icon: 'check' });
      } }],
    });
  } catch (e) { aiFail(e); }
  finally { btn.disabled = false; btn.replaceChildren(...label); }
}

async function analyze(ym, btn) {
  const m = M();
  const tx = m.tx.filter(t => t.date.startsWith(ym));
  if (!tx.length) { toast('이 달에는 기록이 없어요.'); return; }
  const prev = m.tx.filter(t => t.date.startsWith(shiftMonth(ym, -1)));
  const byCat = list => Object.fromEntries(CATS.out.map(([id, name]) => [name, list.filter(t => t.type === 'out' && t.cat === id).reduce((a, t) => a + t.amount, 0)]).filter(([, v]) => v));
  btn.disabled = true; const label = [...btn.childNodes]; btn.textContent = 'Claude가 보는 중…';
  try {
    const resp = await ai({
      effort: 'medium', max_tokens: 3000,
      system: '너는 다정하지만 솔직한 개인 재무 코치다. 한 달 가계부를 보고 한국어로 짧게 정리한다: 1) 한 줄 총평 2) 눈에 띄는 소비 2~3개 3) 다음 달에 바로 해 볼 절약 방법 2~3개. 숫자는 원 단위로. 투자 상품 추천은 하지 않는다. 마크다운 제목 없이 짧은 문단과 "• " 목록만 쓴다.',
      messages: [{ role: 'user', content: JSON.stringify({ 달: ym, 수입: tx.filter(t => t.type === 'in').reduce((a, t) => a + t.amount, 0), 지출: tx.filter(t => t.type === 'out').reduce((a, t) => a + t.amount, 0), 예산: m.budget.total || null, 분류별지출: byCat(tx), 지난달분류별지출: byCat(prev), 큰지출: tx.filter(t => t.type === 'out').sort((a, b) => b.amount - a.amount).slice(0, 8).map(t => `${t.date} ${t.memo || CAT[t.cat]?.name} ${t.amount}원`), 빌린돈남음: m.debts.filter(d => d.type === 'borrow' && !d.closed).reduce((a, d) => a + debtLeft(d), 0) }) }],
    });
    modal({ title: `${ymText(ym)} 소비 분석`, body: h('div', { class: 'mn-analysis' }, textOf(resp)), actions: [{ label: '닫기', primary: true }] });
  } catch (e) { aiFail(e); }
  finally { btn.disabled = false; btn.replaceChildren(...label); }
}

function exportCsv(ym) {
  const rows = M().tx.filter(t => t.date.startsWith(ym)).sort((a, b) => a.date.localeCompare(b.date));
  const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const csv = ['날짜,구분,분류,내용,금액,결제 수단', ...rows.map(t => [t.date, t.type === 'in' ? '수입' : '지출', CAT[t.cat]?.name, t.memo, t.type === 'in' ? t.amount : -t.amount, t.method].map(esc).join(','))].join('\r\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `가계부-${ym}.csv`);
}

export default {
  id: 'money', title: '가계부', icon: 'wallet',
  render(el, ctx) {
    el.classList.add('stagger', 'narrow');
    const m = M();
    applyFixed();
    let ym = dkey().slice(0, 7);
    let filter = { type: 'all', cat: '', q: '' };
    const debtBox = h('div');
    const head = h('div', { class: 'mn-month' });
    const kpis = h('div', { class: 'mn-kpis' });
    const addCard = h('section', { class: 'glass card col' });
    const charts = h('div', { class: 'mn-charts' });
    const listCard = h('section', { class: 'glass card col' });
    const fixedCard = h('section', { class: 'glass card col' });
    el.append(h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '가계부')), debtBox, h('h2', { class: 'h2 mn-section' }, '수입 · 지출'), head, kpis, addCard, charts, listCard, fixedCard);

    // quick add
    const q = { type: 'out', cat: 'food' };
    const qAmount = h('input', { class: 'input mn-amount num', inputmode: 'numeric', placeholder: '0', 'aria-label': '금액', oninput: e => { const n = toNum(e.target.value); e.target.value = n ? n.toLocaleString('ko-KR') : ''; }, onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) quickAdd(); } });
    const qMemo = h('input', { class: 'input', placeholder: '내용 (예: 점심 김밥)', 'aria-label': '내용', onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) quickAdd(); } });
    const qDate = h('input', { class: 'input', type: 'date', value: dkey(), 'aria-label': '날짜' });
    const qMethod = h('select', { class: 'select', 'aria-label': '결제 수단' }, METHODS.map(x => h('option', { value: x }, x)));
    const qCats = catChips('out', 'food', c => { q.cat = c; });
    function quickAdd() {
      const n = toNum(qAmount.value);
      if (n <= 0) { toast('금액을 적어 주세요.'); qAmount.focus(); return; }
      m.tx.push({ id: uid(), type: q.type, amount: n, cat: q.cat, memo: qMemo.value.trim(), date: qDate.value || dkey(), method: qMethod.value });
      gainXP('money'); commit('money');
      toast(`${q.type === 'in' ? '수입' : '지출'} ${won(n)} 기록했어요.`, { icon: 'check' });
      qAmount.value = ''; qMemo.value = '';
      if (!(qDate.value || dkey()).startsWith(ym)) ym = (qDate.value || dkey()).slice(0, 7);
      paintLedger(); qAmount.focus();
    }
    const receiptBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: e => readReceipt(e.currentTarget, paintLedger) }, icon('image', 14), '영수증 사진으로 추가');
    addCard.append(
      h('div', { class: 'row between wrap', style: { gap: '8px' } }, h('h2', { class: 'h2' }, '기록하기'), receiptBtn),
      h('div', { class: 'row wrap', style: { gap: '8px' } },
        seg([['out', '지출'], ['in', '수입']], 'out', t => { q.type = t; q.cat = CATS[t][0][0]; qCats.repaint(t, q.cat); }),
        h('div', { class: 'mn-amount-wrap grow' }, qAmount, h('span', null, '원'))),
      qCats,
      h('div', { class: 'mn-add-row' }, qMemo, qDate, qMethod, h('button', { class: 'btn btn-ink', onclick: quickAdd }, icon('plus', 16), '추가')));

    function monthTx() { return m.tx.filter(t => t.date.startsWith(ym)); }
    function paintHead() {
      head.replaceChildren(
        h('button', { class: 'btn-icon glass-btn', 'aria-label': '지난달', onclick: () => { ym = shiftMonth(ym, -1); paintLedger(); } }, icon('left', 18)),
        h('b', { class: 'mn-ym' }, ymText(ym)),
        h('button', { class: 'btn-icon glass-btn', 'aria-label': '다음 달', onclick: () => { ym = shiftMonth(ym, 1); paintLedger(); } }, icon('right', 18)),
        ym !== dkey().slice(0, 7) ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { ym = dkey().slice(0, 7); paintLedger(); } }, '이번 달') : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => editBudget(paintLedger) }, icon('sliders', 14), '예산'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: e => analyze(ym, e.currentTarget) }, icon('sparkle', 14), 'Claude 분석'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => exportCsv(ym) }, icon('download', 14), 'CSV'));
    }
    function paintKpis() {
      const tx = monthTx();
      const inc = tx.filter(t => t.type === 'in').reduce((a, t) => a + t.amount, 0);
      const out = tx.filter(t => t.type === 'out').reduce((a, t) => a + t.amount, 0);
      const b = m.budget.total;
      const isNow = ym === dkey().slice(0, 7);
      const daysLeft = isNow ? daysIn(ym) - Number(dkey().slice(8)) + 1 : 0;
      kpis.replaceChildren(
        h('div', { class: 'glass kpi-card' }, h('div', { class: 'k' }, '수입'), h('div', { class: 'v num mn-in' }, won(inc))),
        h('div', { class: 'glass kpi-card' }, h('div', { class: 'k' }, '지출'), h('div', { class: 'v num' }, won(out))),
        h('div', { class: 'glass kpi-card' }, h('div', { class: 'k' }, '남은 돈 (수입 − 지출)'), h('div', { class: 'v num ' + (inc - out < 0 ? 'mn-out' : '') }, won(inc - out))),
        h('div', { class: 'glass kpi-card' }, h('div', { class: 'k' }, '예산'),
          b ? h('div', { class: 'v num ' + (out > b ? 'mn-out' : '') }, out > b ? `${won(out - b)} 초과` : `${won(b - out)} 남음`) : h('div', { class: 'v' }, h('small', null, '예산을 정해 보세요')),
          b ? h('div', { class: 'bar thin' }, h('i', { style: { width: Math.min(100, (out / b) * 100) + '%', background: out > b ? 'var(--bad)' : out > b * 0.8 ? '#E0A82E' : 'var(--good)' } })) : null,
          b && isNow && out < b ? h('div', { class: 'tiny muted' }, `남은 ${daysLeft}일 동안 하루 ${won((b - out) / daysLeft)}씩 쓸 수 있어요`) : null));
    }
    function paintCharts() {
      const tx = monthTx().filter(t => t.type === 'out');
      const total = tx.reduce((a, t) => a + t.amount, 0);
      const byCat = CATS.out.map(([id, name, color]) => ({ id, name, color, sum: tx.filter(t => t.cat === id).reduce((a, t) => a + t.amount, 0), budget: m.budget.cats?.[id] || 0 })).filter(c => c.sum || c.budget).sort((a, b) => b.sum - a.sum);
      const n = daysIn(ym);
      const perDay = Array.from({ length: n }, (_, i) => tx.filter(t => Number(t.date.slice(8)) === i + 1).reduce((a, t) => a + t.amount, 0));
      const max = Math.max(1, ...perDay);
      const today = dkey().startsWith(ym) ? Number(dkey().slice(8)) : 0;
      charts.replaceChildren(
        h('section', { class: 'glass card col' },
          h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '분류별 지출'), h('span', { class: 'small muted num' }, won(total))),
          byCat.length ? h('div', { class: 'col', style: { gap: '10px' } }, byCat.map(c => h('button', { class: 'mn-catbar' + (filter.cat === c.id ? ' on' : ''), title: '눌러서 이 분류만 보기', onclick: () => { filter.cat = filter.cat === c.id ? '' : c.id; paintList(); paintCharts(); } },
            h('div', { class: 'row between small' }, h('span', null, h('i', { class: 'mn-dot', style: { background: c.color } }), c.name), h('span', { class: 'num' }, won(c.sum), h('span', { class: 'muted' }, c.budget ? ` / ${won(c.budget)}` : total ? ` · ${Math.round((c.sum / total) * 100)}%` : ''))),
            h('div', { class: 'bar' }, h('i', { style: { width: (c.budget ? Math.min(100, (c.sum / c.budget) * 100) : total ? (c.sum / total) * 100 : 0) + '%', background: c.budget && c.sum > c.budget ? 'var(--bad)' : c.color } }))))) : h('p', { class: 'small muted', style: { margin: 0 } }, '이 달의 지출 기록이 없어요.')),
        h('section', { class: 'glass card col' },
          h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '날짜별 지출'), h('span', { class: 'small muted num' }, tx.length ? `하루 평균 ${won(total / (today || n))}` : '')),
          h('div', { class: 'mn-days' }, perDay.map((v, i) => h('div', { class: 'mn-dayc' + (i + 1 === today ? ' today' : ''), title: `${Number(ym.slice(5))}/${i + 1} · ${won(v)}` }, h('i', { style: { height: (v / max) * 100 + '%' } })))),
          h('div', { class: 'row between tiny muted num' }, h('span', null, '1일'), h('span', null, `${Math.ceil(n / 2)}일`), h('span', null, `${n}일`))));
    }
    function paintList() {
      const all = monthTx().filter(t => (filter.type === 'all' || t.type === filter.type) && (!filter.cat || t.cat === filter.cat) && (!filter.q || `${t.memo} ${CAT[t.cat]?.name} ${t.method}`.toLowerCase().includes(filter.q.toLowerCase())));
      const byDate = {};
      all.sort((a, b) => b.date.localeCompare(a.date)).forEach(t => (byDate[t.date] ||= []).push(t));
      const search = h('input', { class: 'input', value: filter.q, placeholder: '검색 (내용, 분류)', 'aria-label': '검색', style: { maxWidth: '200px', height: '36px' }, oninput: e => { filter.q = e.target.value; clearTimeout(search.t); search.t = setTimeout(() => { paintList(); const s = listCard.querySelector('input'); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }, 250); } });
      listCard.replaceChildren(
        h('div', { class: 'row between wrap', style: { gap: '8px' } },
          h('h2', { class: 'h2' }, '내역'),
          h('div', { class: 'row wrap', style: { gap: '8px' } },
            seg([['all', '전체'], ['out', '지출'], ['in', '수입']], filter.type, v => { filter.type = v; paintList(); }),
            filter.cat ? h('button', { class: 'chip sm ink', onclick: () => { filter.cat = ''; paintList(); paintCharts(); } }, CAT[filter.cat].name, ' ', icon('x', 12)) : null,
            search)),
        Object.keys(byDate).length ? h('div', null, Object.entries(byDate).map(([d, list]) => {
          const o = list.filter(t => t.type === 'out').reduce((a, t) => a + t.amount, 0), i = list.filter(t => t.type === 'in').reduce((a, t) => a + t.amount, 0);
          return h('div', { class: 'mn-day' },
            h('div', { class: 'row between mn-day-head' }, h('b', null, fmtShort(d)), h('span', { class: 'tiny muted num' }, [i ? `+${won(i)}` : '', o ? `-${won(o)}` : ''].filter(Boolean).join(' · '))),
            list.map(t => h('button', { class: 'mn-tx', onclick: () => editTx(t, false, paintLedger) },
              h('i', { class: 'mn-dot', style: { background: CAT[t.cat]?.color } }),
              h('span', { class: 'grow ell' }, t.memo || CAT[t.cat]?.name, h('span', { class: 'tiny muted' }, ` · ${CAT[t.cat]?.name || ''} · ${t.method || ''}${t.fixedId ? ' · 고정' : ''}`)),
              h('b', { class: 'num' + (t.type === 'in' ? ' mn-in' : '') }, (t.type === 'in' ? '+' : '-') + won(t.amount)))));
        })) : h('p', { class: 'small muted', style: { margin: 0 } }, filter.q || filter.cat || filter.type !== 'all' ? '조건에 맞는 기록이 없어요.' : '이 달에 기록이 없어요. 위에서 금액을 적고 추가해 보세요.'));
    }
    function paintFixed() {
      const out = m.fixed.filter(f => f.type === 'out').reduce((a, f) => a + f.amount, 0), inc = m.fixed.filter(f => f.type === 'in').reduce((a, f) => a + f.amount, 0);
      fixedCard.replaceChildren(
        h('div', { class: 'row between wrap', style: { gap: '8px' } }, h('h2', { class: 'h2' }, '고정 수입 · 지출'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => editFixed({ id: uid(), type: 'out', cat: 'house', day: 1, from: dkey().slice(0, 8) + '01', method: '계좌이체' }, true, paintLedger) }, icon('plus', 14), '추가')),
        m.fixed.length ? h('div', null, m.fixed.slice().sort((a, b) => a.day - b.day).map(f => h('button', { class: 'mn-tx', onclick: () => editFixed(f, false, paintLedger) },
          h('span', { class: 'chip sm line num' }, `매달 ${f.day}일`), h('i', { class: 'mn-dot', style: { background: CAT[f.cat]?.color } }),
          h('span', { class: 'grow ell' }, f.name, h('span', { class: 'tiny muted' }, ` · ${CAT[f.cat]?.name}`)),
          h('b', { class: 'num' + (f.type === 'in' ? ' mn-in' : '') }, (f.type === 'in' ? '+' : '-') + won(f.amount))))) : h('p', { class: 'small muted', style: { margin: 0 } }, '월세, 통신비, 구독료, 월급처럼 매달 같은 날 오가는 돈을 넣어 두면 그날 자동으로 기록돼요.'),
        m.fixed.length ? h('div', { class: 'tiny muted num' }, `한 달 고정 지출 ${won(out)}${inc ? ` · 고정 수입 ${won(inc)}` : ''}`) : null);
    }
    function paintLedger() { paintHead(); paintKpis(); paintCharts(); paintList(); paintFixed(); }
    function paint() { debtBox.replaceChildren(debtsCard(paint)); paintLedger(); }
    paint();
    ctx.on('change', w => { if (w === 'money' && !el.contains(document.activeElement)) paint(); });
    ctx.on('newday', () => { applyFixed(); paint(); });
  },
};
