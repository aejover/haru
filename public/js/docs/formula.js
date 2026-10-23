// formula.js — a small Excel-style formula engine: refs, ranges, operators and common functions.
export class FErr { constructor(code) { this.code = code; } toString() { return this.code; } }
const E = code => new FErr(code);

export const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export const colIdx = s => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const refOf = (r, c) => colName(c) + (r + 1);
export const parseRef = s => { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(s); return m ? { c: colIdx(m[1]), r: +m[2] - 1 } : null; };

function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const rest = src.slice(i), ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1, s = '';
      while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
      if (j >= src.length) throw E('#ERROR!');
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    let m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(rest);
    if (m) { out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    m = /^[A-Za-z_][A-Za-z0-9_.]*(?=\s*\()/.exec(rest);
    if (m) { out.push({ t: 'fn', v: m[0].toUpperCase() }); i += m[0].length; continue; }
    m = /^\$?[A-Za-z]{1,3}\$?\d+(:\$?[A-Za-z]{1,3}\$?\d+)?/.exec(rest);
    if (m) { out.push({ t: 'ref', v: m[0].toUpperCase().replace(/\$/g, '') }); i += m[0].length; continue; }
    m = /^[A-Za-z_]+/.exec(rest);
    if (m) { const u = m[0].toUpperCase(); out.push(u === 'TRUE' || u === 'FALSE' ? { t: 'bool', v: u === 'TRUE' } : { t: 'name', v: u }); i += m[0].length; continue; }
    m = /^(<=|>=|<>|[-+*/^&=<>%(),])/.exec(rest);
    if (m) { out.push({ t: 'op', v: m[0] }); i += m[0].length; continue; }
    throw E('#ERROR!');
  }
  return out;
}

function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const isOp = v => peek()?.t === 'op' && peek().v === v;
  const next = () => tokens[p++];
  const bin = (sub, ops) => () => { let l = sub(); while (peek()?.t === 'op' && ops.includes(peek().v)) { const o = next().v; l = { k: 'bin', o, l, r: sub() }; } return l; };
  const primary = () => {
    const tk = next();
    if (!tk) throw E('#ERROR!');
    if (tk.t === 'num' || tk.t === 'str' || tk.t === 'bool') return { k: 'lit', v: tk.v };
    if (tk.t === 'ref') return tk.v.includes(':') ? { k: 'range', v: tk.v } : { k: 'ref', v: tk.v };
    if (tk.t === 'fn') {
      if (!isOp('(')) throw E('#ERROR!'); next();
      const args = [];
      if (!isOp(')')) { args.push(expr()); while (isOp(',')) { next(); args.push(expr()); } }
      if (!isOp(')')) throw E('#ERROR!'); next();
      return { k: 'fn', name: tk.v, args };
    }
    if (tk.t === 'op' && tk.v === '(') { const e = expr(); if (!isOp(')')) throw E('#ERROR!'); next(); return e; }
    if (tk.t === 'name') throw E('#NAME?');
    throw E('#ERROR!');
  };
  const postfix = () => { let e = primary(); while (isOp('%')) { next(); e = { k: 'pct', e }; } return e; };
  const unary = () => { if (isOp('-')) { next(); return { k: 'neg', e: unary() }; } if (isOp('+')) { next(); return unary(); } return postfix(); };
  const power = bin(unary, ['^']);
  const mult = bin(power, ['*', '/']);
  const add = bin(mult, ['+', '-']);
  const concat = bin(add, ['&']);
  const expr = bin(concat, ['=', '<>', '<', '>', '<=', '>=']);
  const ast = expr();
  if (p < tokens.length) throw E('#ERROR!');
  return ast;
}

export function literal(v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?(e[-+]?\d+)?%?$/i.test(t) && /\d/.test(t)) {
    const n = parseFloat(t.replace(/,/g, '').replace('%', ''));
    return t.endsWith('%') ? n / 100 : n;
  }
  if (/^(true|false)$/i.test(t)) return t.toUpperCase() === 'TRUE';
  return v;
}
const num = v => {
  if (v instanceof FErr) throw v;
  if (v && v.range) { if (v.rows.length === 1 && v.rows[0].length === 1) return num(v.rows[0][0]); throw E('#VALUE!'); }
  if (v === '' || v == null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = literal(v); if (typeof n === 'number') return n;
  throw E('#VALUE!');
};
export const fmtGeneral = n => (Number.isInteger(n) ? String(n) : String(parseFloat(n.toPrecision(10))));
const str = v => {
  if (v instanceof FErr) throw v;
  if (v && v.range) return str(v.rows[0]?.[0]);
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return fmtGeneral(v);
  return String(v);
};
const truthy = v => (typeof v === 'string' && /^(true|false)$/i.test(v) ? v.toUpperCase() === 'TRUE' : num(v) !== 0);
function cmp(a, b) {
  if (a === '' && typeof b === 'number') a = 0;
  if (b === '' && typeof a === 'number') b = 0;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
  return str(a).toLowerCase().localeCompare(str(b).toLowerCase());
}
const flat = list => list.flatMap(v => (v && v.range ? v.rows.flat() : [v]));
const numbers = list => list.flatMap(v => (v && v.range ? v.rows.flat().filter(x => typeof x === 'number') : [num(v)]));
function matcher(crit) {
  if (typeof crit === 'number') return v => typeof v === 'number' && v === crit;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(str(crit));
  const op = m[1] || '=', rhs = m[2];
  const rn = literal(rhs);
  const re = new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  return v => {
    if (typeof rn === 'number' && typeof v === 'number') {
      return { '=': v === rn, '<>': v !== rn, '<': v < rn, '>': v > rn, '<=': v <= rn, '>=': v >= rn }[op];
    }
    const s = str(v);
    if (op === '=') return re.test(s);
    if (op === '<>') return !re.test(s);
    const c = s.toLowerCase().localeCompare(rhs.toLowerCase());
    return { '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op];
  };
}
const round = (x, d, mode) => { const f = 10 ** d; const v = x * f; return (mode === 'up' ? Math.sign(v) * Math.ceil(Math.abs(v) - 1e-9) : mode === 'down' ? Math.trunc(v) : Math.round(v + Math.sign(v) * 1e-9)) / f; };
const pad = n => String(n).padStart(2, '0');

const FN = {
  SUM: a => numbers(a).reduce((x, y) => x + y, 0),
  AVERAGE: a => { const n = numbers(a); if (!n.length) throw E('#DIV/0!'); return n.reduce((x, y) => x + y, 0) / n.length; },
  MIN: a => { const n = numbers(a); return n.length ? Math.min(...n) : 0; },
  MAX: a => { const n = numbers(a); return n.length ? Math.max(...n) : 0; },
  COUNT: a => flat(a).filter(x => typeof x === 'number').length,
  COUNTA: a => flat(a).filter(x => x !== '' && x != null).length,
  COUNTBLANK: a => flat(a).filter(x => x === '' || x == null).length,
  PRODUCT: a => numbers(a).reduce((x, y) => x * y, 1),
  ROUND: ([x, d]) => round(num(x), num(d ?? 0)),
  ROUNDUP: ([x, d]) => round(num(x), num(d ?? 0), 'up'),
  ROUNDDOWN: ([x, d]) => round(num(x), num(d ?? 0), 'down'),
  INT: ([x]) => Math.floor(num(x)),
  ABS: ([x]) => Math.abs(num(x)),
  SQRT: ([x]) => { const v = num(x); if (v < 0) throw E('#NUM!'); return Math.sqrt(v); },
  POWER: ([x, y]) => num(x) ** num(y),
  MOD: ([x, y]) => { const d = num(y); if (d === 0) throw E('#DIV/0!'); const v = num(x); return v - d * Math.floor(v / d); },
  AND: a => flat(a).every(truthy),
  OR: a => flat(a).some(truthy),
  NOT: ([x]) => !truthy(x),
  CONCAT: a => flat(a).map(str).join(''),
  CONCATENATE: a => flat(a).map(str).join(''),
  LEN: ([s]) => str(s).length,
  UPPER: ([s]) => str(s).toUpperCase(),
  LOWER: ([s]) => str(s).toLowerCase(),
  TRIM: ([s]) => str(s).trim().replace(/\s+/g, ' '),
  LEFT: ([s, n]) => str(s).slice(0, num(n ?? 1)),
  RIGHT: ([s, n]) => { const t = str(s), k = num(n ?? 1); return k ? t.slice(-k) : ''; },
  MID: ([s, st, n]) => str(s).substr(num(st) - 1, num(n)),
  TODAY: () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
  NOW: () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; },
  SUMIF: ([range, crit, sumRange]) => { const m = matcher(crit); const keys = range.rows.flat(); const vals = (sumRange || range).rows.flat(); return keys.reduce((s, k, i) => (m(k) && typeof vals[i] === 'number' ? s + vals[i] : s), 0); },
  COUNTIF: ([range, crit]) => { const m = matcher(crit); return range.rows.flat().filter(m).length; },
  AVERAGEIF: ([range, crit, avgRange]) => { const m = matcher(crit); const keys = range.rows.flat(); const vals = (avgRange || range).rows.flat(); const hit = keys.map((k, i) => (m(k) ? vals[i] : null)).filter(v => typeof v === 'number'); if (!hit.length) throw E('#DIV/0!'); return hit.reduce((a, b) => a + b, 0) / hit.length; },
  VLOOKUP: ([key, table, col, approx]) => {
    if (!table?.range) throw E('#VALUE!');
    const c = num(col) - 1; if (c < 0 || c >= (table.rows[0]?.length || 0)) throw E('#REF!');
    const exact = approx !== undefined && !truthy(approx);
    if (exact) { const row = table.rows.find(r => cmp(r[0], key) === 0); if (!row) throw E('#N/A'); return row[c]; }
    let hit = null; for (const r of table.rows) { if (r[0] === '') continue; if (cmp(r[0], key) <= 0) hit = r; else break; }
    if (!hit) throw E('#N/A'); return hit[c];
  },
  RANK: ([x, range, order]) => { const v = num(x); const list = range.rows.flat().filter(n => typeof n === 'number'); return (order && truthy(order) ? list.filter(n => n < v) : list.filter(n => n > v)).length + 1; },
};
const LAZY = {
  IF: (args, ev) => { const c = ev(args[0]); return truthy(c) ? (args[1] ? ev(args[1]) : true) : (args[2] ? ev(args[2]) : false); },
  IFERROR: (args, ev) => { try { const v = ev(args[0]); if (v instanceof FErr) return ev(args[1]); return v; } catch (e) { if (e instanceof FErr) return ev(args[1]); throw e; } },
};
export const FUNCTION_HELP = [
  ['SUM(A1:A10)', '합계'], ['AVERAGE(A1:A10)', '평균'], ['MAX / MIN', '가장 큰 값 / 가장 작은 값'], ['COUNT / COUNTA', '숫자 개수 / 비어 있지 않은 칸 개수'],
  ['IF(A1>=60,"합격","불합격")', '조건에 따라 다른 값'], ['SUMIF(A1:A9,"사과",B1:B9)', '조건에 맞는 값만 합계'], ['COUNTIF(A1:A10,">=80")', '조건에 맞는 칸 개수'],
  ['VLOOKUP(값,A1:C10,2,FALSE)', '표에서 값을 찾아 옆 칸 가져오기'], ['ROUND(A1,1)', '반올림 (소수 첫째 자리)'], ['RANK(A1,A1:A10)', '순위'],
  ['A1&" "&B1', '글자 이어 붙이기'], ['TODAY()', '오늘 날짜'], ['IFERROR(식,0)', '오류가 나면 대신 보일 값'],
];

function evaluate(ast, ctx) {
  switch (ast.k) {
    case 'lit': return ast.v;
    case 'ref': { const v = ctx.get(ast.v); if (v instanceof FErr) throw v; return v; }
    case 'range': return ctx.range(ast.v);
    case 'neg': return -num(evaluate(ast.e, ctx));
    case 'pct': return num(evaluate(ast.e, ctx)) / 100;
    case 'bin': {
      const a = evaluate(ast.l, ctx), b = evaluate(ast.r, ctx);
      switch (ast.o) {
        case '+': return num(a) + num(b);
        case '-': return num(a) - num(b);
        case '*': return num(a) * num(b);
        case '/': { const d = num(b); if (d === 0) throw E('#DIV/0!'); return num(a) / d; }
        case '^': return num(a) ** num(b);
        case '&': return str(a) + str(b);
        case '=': return cmp(a, b) === 0;
        case '<>': return cmp(a, b) !== 0;
        case '<': return cmp(a, b) < 0;
        case '>': return cmp(a, b) > 0;
        case '<=': return cmp(a, b) <= 0;
        case '>=': return cmp(a, b) >= 0;
      }
      throw E('#ERROR!');
    }
    case 'fn': {
      if (LAZY[ast.name]) return LAZY[ast.name](ast.args, a => evaluate(a, ctx));
      const f = FN[ast.name];
      if (!f) throw E('#NAME?');
      return f(ast.args.map(a => evaluate(a, ctx)));
    }
  }
  throw E('#ERROR!');
}

// Evaluate every formula on a sheet. cells: { A1: { v } }. Returns get(ref) -> value.
export function makeEvaluator(sheet) {
  const memo = new Map(), visiting = new Set();
  const get = ref => {
    if (memo.has(ref)) return memo.get(ref);
    const raw = sheet.cells[ref]?.v;
    let v;
    if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
      if (visiting.has(ref)) return E('#CYCLE!');
      visiting.add(ref);
      try { v = evaluate(parse(tokenize(raw.slice(1))), ctx); if (v && v.range) v = v.rows.length === 1 && v.rows[0].length === 1 ? v.rows[0][0] : E('#VALUE!'); if (typeof v === 'number' && !isFinite(v)) v = E('#NUM!'); }
      catch (e) { v = e instanceof FErr ? e : E('#ERROR!'); }
      visiting.delete(ref);
    } else v = literal(raw);
    memo.set(ref, v);
    return v;
  };
  const range = s => {
    let [a, b] = s.split(':');
    const A = parseRef(a), B = parseRef(b);
    if (!A || !B) throw E('#REF!');
    const r0 = Math.min(A.r, B.r), r1 = Math.min(Math.max(A.r, B.r), sheet.rows - 1), c0 = Math.min(A.c, B.c), c1 = Math.min(Math.max(A.c, B.c), sheet.cols - 1);
    const rows = [];
    for (let r = r0; r <= r1; r++) { const row = []; for (let c = c0; c <= c1; c++) { const v = get(refOf(r, c)); if (v instanceof FErr) throw v; row.push(v); } rows.push(row); }
    return { range: true, rows };
  };
  const ctx = { get, range };
  return get;
}

// Shift references in a formula when rows/columns are inserted or deleted.
export function shiftFormula(f, axis, at, delta) {
  return f.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g, (m, d1, col, d2, row) => {
    let c = colIdx(col), r = +row - 1;
    if (axis === 'r' && r >= at) r += delta;
    if (axis === 'c' && c >= at) c += delta;
    if (r < 0 || c < 0) return '#REF!';
    return `${d1}${colName(c)}${d2}${r + 1}`;
  });
}
