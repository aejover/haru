// calc.js — 문서 작업의 계산기: 괄호 · % · √ · 거듭제곱(xʸ)을 쓰는 식 계산기. 키보드로도 쓰고, 지난 계산은 기록에 남아요.
import { h, icon, toast } from '../core.js';

// ---------- a small expression parser (no eval) ----------
// grammar: expr = term (('+'|'−') term)* ; term = unary (('×'|'÷') unary)* ;
//          unary = '−' unary | '√' unary | power ; power = post ('^' unary)? ; post = atom '%'* ;
//          atom = number | '(' expr ')'      (so −2^2 = −4, 2^−1 = 0.5, and 2^3^2 = 2^9)
function evaluate(src) {
  const s = src.replace(/\s+/g, '').replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
  let i = 0;
  const peek = () => s[i];
  const fail = () => { throw new Error('식을 확인해 주세요'); };
  function atom() {
    if (peek() === '(') { i++; const v = expr(); if (peek() === ')') i++; return v; } // a missing ")" closes itself
    const m = /^\d*\.?\d+(?:e[+−]?\d+)?|^\d+\./.exec(s.slice(i));
    if (!m) fail();
    i += m[0].length;
    return Number(m[0].replace('−', '-'));
  }
  function post() { let v = atom(); while (peek() === '%') { i++; v /= 100; } return v; }
  function power() {
    const b = post();
    if (peek() !== '^') return b;
    i++;
    const v = Math.pow(b, unary()); // right side may be −2 or another power
    if (Number.isNaN(v)) throw new Error('음수의 분수 거듭제곱은 계산할 수 없어요');
    return v;
  }
  function unary() {
    if (peek() === '−') { i++; return -unary(); }
    if (peek() === '+') { i++; return unary(); }
    if (peek() === '√') { i++; const v = unary(); if (v < 0) throw new Error('음수의 제곱근은 계산할 수 없어요'); return Math.sqrt(v); }
    return power();
  }
  function term() {
    let v = unary();
    for (;;) {
      if (peek() === '×') { i++; v *= unary(); }
      else if (peek() === '÷') { i++; const d = unary(); if (d === 0) throw new Error('0으로 나눌 수 없어요'); v /= d; }
      else if (peek() === '(' || peek() === '√') v *= unary(); // 2(3+4), 2√9
      else return v;
    }
  }
  function expr() { let v = term(); for (;;) { if (peek() === '+') { i++; v += term(); } else if (peek() === '−') { i++; v -= term(); } else return v; } }
  if (!s) return 0;
  const v = expr();
  if (i < s.length) fail();
  if (!Number.isFinite(v)) throw new Error('너무 큰 수예요');
  return Number(v.toPrecision(12)); // 0.1 + 0.2 → 0.3
}
const show = v => (Math.abs(v) >= 1e15 || (v !== 0 && Math.abs(v) < 1e-9) ? v.toExponential(6) : v.toLocaleString('ko-KR', { maximumFractionDigits: 10 }));

export function calculator() {
  let expr = '', justDone = false;
  const history = [];
  const exprEl = h('div', { class: 'calc-expr num', 'aria-live': 'polite' });
  const outEl = h('div', { class: 'calc-out num' });
  const histEl = h('div', { class: 'calc-hist' });
  const preview = () => { try { return expr ? evaluate(expr) : null; } catch { return null; } };
  function paint(err) {
    exprEl.textContent = expr || '0';
    const p = preview();
    outEl.textContent = err || (p != null && /[+−×÷%^√(]/.test(expr) ? '= ' + show(p) : '');
    outEl.classList.toggle('err', !!err);
    histEl.replaceChildren(history.length ? history.slice(0, 8).map(x => h('button', { class: 'calc-hist-item', title: '눌러서 결과 쓰기', onclick: () => { expr = String(x.v); justDone = true; paint(); } }, h('span', { class: 'muted' }, x.e + ' ='), h('b', { class: 'num' }, show(x.v)))) : h('span', { class: 'tiny muted' }, '계산한 기록이 여기에 남아요'));
  }
  const isOp = c => '+−×÷'.includes(c);
  function press(k) {
    if (k === 'AC') { expr = ''; justDone = false; return paint(); }
    if (k === '⌫') { expr = expr.slice(0, -1); justDone = false; return paint(); }
    if (k === '=') {
      if (!expr) return;
      try { const v = evaluate(expr); history.unshift({ e: expr, v }); expr = String(v); justDone = true; paint(); }
      catch (e) { paint(e.message); }
      return;
    }
    if (k === '±') {
      // flip the sign of the last number
      const m = /(\d*\.?\d+)$/.exec(expr);
      if (!m) { expr = expr ? `−(${expr})` : '−'; return paint(); }
      const at = expr.length - m[1].length;
      expr = expr[at - 1] === '−' && (at === 1 || isOp(expr[at - 2]) || expr[at - 2] === '(') ? expr.slice(0, at - 1) + m[1] : expr.slice(0, at) + '−' + m[1];
      return paint();
    }
    if (justDone && /[\d.(√]/.test(k)) expr = ''; // a new number after "=" starts over; an operator keeps the result
    justDone = false;
    if (k === 'xʸ') { if (!expr || /[+−×÷^(]$/.test(expr)) return; k = '^'; } // needs a number to raise
    // 3+× → 3×, but a minus after ^ × ÷ is a negative number (2^−1, 3×−2)
    if ((isOp(k) || k === '^') && /[+−×÷^]$/.test(expr) && !(k === '−' && /[×÷^]$/.test(expr))) expr = expr.slice(0, -1);
    if (k === '.') { const last = /[\d.]*$/.exec(expr)[0]; if (last.includes('.')) return; if (!last) k = '0.'; }
    expr += k;
    paint();
  }
  const KEYS = ['(', ')', '√', 'xʸ', 'AC', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '±', '0', '.', '='];
  const pad = h('div', { class: 'calc-pad' }, KEYS.map(k => h('button', {
    type: 'button', class: 'calc-key' + (k === '=' ? ' calc-eq' : isOp(k) || k === '%' ? ' op' : /^[\d.±]$/.test(k) ? ' num' : ' fn'),
    'aria-label': { '⌫': '지우기', AC: '모두 지우기', '√': '제곱근', 'xʸ': '거듭제곱 (지수 입력)', '±': '부호 바꾸기' }[k] || k,
    onclick: () => press(k),
  }, k === '⌫' ? icon('left', 18) : k)));
  const box = h('div', { class: 'calc', tabindex: '0', 'aria-label': '계산기 (키보드로 입력할 수 있어요)' },
    h('div', { class: 'calc-screen' }, exprEl, outEl,
      h('button', { class: 'btn-icon sm calc-copy', title: '결과 복사', 'aria-label': '결과 복사', onclick: async () => { const v = preview(); if (v == null) return; try { await navigator.clipboard.writeText(String(v)); toast('결과를 복사했어요.'); } catch { toast(String(v)); } } }, icon('copy', 15))),
    pad, histEl);
  box.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const map = { Enter: '=', '=': '=', Backspace: '⌫', Escape: 'AC', Delete: 'AC', '*': '×', x: '×', '/': '÷', '-': '−', '+': '+', '%': '%', '(': '(', ')': ')', '.': '.', ',': '.', '^': 'xʸ' };
    const k = /^\d$/.test(e.key) ? e.key : map[e.key];
    if (!k) return;
    e.preventDefault(); press(k);
    const btn = [...pad.children].find(b => b.textContent === k || (k === '⌫' && b.getAttribute('aria-label') === '지우기'));
    if (btn) { btn.classList.add('hit'); setTimeout(() => btn.classList.remove('hit'), 120); }
  });
  paint();
  return box;
}
