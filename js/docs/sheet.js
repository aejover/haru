// sheet.js — 엑셀 편집기: grid, formula bar, formats, sheets, sort, autosum, chart, xlsx/csv.
import { h, icon, toast, modal, promptDialog, confirmDialog, pickFiles, download, barChart, obj } from '../core.js';
import { loadScript, LIBS, safeName, tb, group, colorBtn, ribbon } from './util.js';
import { makeEvaluator, FErr, colName, refOf, parseRef, fmtGeneral, shiftFormula, FUNCTION_HELP } from './formula.js';

const ROWS = 100, COLS = 26;
const newSheet = name => ({ name, cells: {}, rows: ROWS, cols: COLS, colW: {} });
const NF = [['gen', '일반'], ['num', '숫자 (0.00)'], ['int', '쉼표 (1,000)'], ['cur', '통화 (₩)'], ['pct', '백분율 (%)']];

function display(v, nf) {
  if (v instanceof FErr) return { text: v.code, err: true };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', num: true };
  if (typeof v === 'number') {
    let text;
    switch (nf) {
      case 'num': text = v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); break;
      case 'int': text = Math.round(v).toLocaleString('ko-KR'); break;
      case 'cur': text = '₩' + Math.round(v).toLocaleString('ko-KR'); break;
      case 'pct': text = (v * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '%'; break;
      default: text = Math.abs(v) >= 1e15 ? v.toExponential(4) : fmtGeneral(v);
    }
    return { text, num: true };
  }
  return { text: v ?? '' };
}

export function mountSheet(host, doc, { onChange }) {
  const c = doc.content ||= { sheets: [newSheet('Sheet1')], active: 0 };
  let sh = c.sheets[c.active] || c.sheets[0];
  let sel = { r0: 0, c0: 0, r1: 0, c1: 0 }, act = { r: 0, c: 0 };
  let get = makeEvaluator(sh);
  const undo = [], redo = [];
  let editing = null;
  let clipRaw = null;

  const refBox = h('span', { class: 'ref' }, 'A1');
  const fx = h('input', { 'aria-label': '수식 입력줄', spellcheck: 'false' });
  const scroll = h('div', { class: 'grid-scroll', 'aria-label': '시트' });
  const sink = h('input', { class: 'cell-editor', spellcheck: 'false', autocomplete: 'off', 'aria-label': '셀 입력' });
  const tabs = h('div', { class: 'sheet-tabs' });
  const wrap = h('div', { class: 'sheet-wrap' }, h('div', { class: 'fx-bar' }, refBox, h('span', { class: 'fx' }, 'fx'), fx), scroll, tabs);
  const status = h('div', { class: 'statusbar' });

  let table, cellEls, colEls, headEls, rowHeads;
  function build() {
    const colgroup = h('colgroup', null, h('col', { style: { width: '46px' } }));
    colEls = [];
    for (let i = 0; i < sh.cols; i++) { const col = h('col', { style: { width: (sh.colW[i] || 96) + 'px' } }); colEls.push(col); colgroup.append(col); }
    headEls = [];
    const head = h('tr', null, h('th', { class: 'rh corner', onclick: () => { setSel(0, 0, sh.rows - 1, sh.cols - 1, false); } }));
    for (let i = 0; i < sh.cols; i++) {
      const rs = h('span', { class: 'col-resizer' });
      rs.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        const x0 = e.clientX, w0 = sh.colW[i] || 96;
        const move = ev => { const w = Math.max(30, w0 + ev.clientX - x0); sh.colW[i] = w; colEls[i].style.width = w + 'px'; sizeTable(); placeSink(); };
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); onChange(); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      });
      const th = h('th', { onmousedown: e => { if (e.target === rs) return; setSel(0, i, sh.rows - 1, i, e.shiftKey); } }, colName(i), rs);
      headEls.push(th); head.append(th);
    }
    const tbody = h('tbody');
    cellEls = []; rowHeads = [];
    for (let r = 0; r < sh.rows; r++) {
      const rh = h('th', { class: 'rh', onmousedown: () => setSel(r, 0, r, sh.cols - 1, false) }, r + 1);
      rowHeads.push(rh);
      const tr = h('tr', null, rh); const row = [];
      for (let col = 0; col < sh.cols; col++) { const td = h('td'); td.dataset.r = r; td.dataset.c = col; row.push(td); tr.append(td); }
      cellEls.push(row); tbody.append(tr);
    }
    table = h('table', { class: 'sgrid' }, colgroup, h('thead', null, head), tbody);
    sizeTable();
    scroll.replaceChildren(table, sink);
    paintCells(); paintSel(); paintTabs();
  }

  // table-layout: fixed only honours <col> widths when the table itself has a width
  function sizeTable() {
    let w = 46;
    for (let i = 0; i < sh.cols; i++) w += sh.colW[i] || 96;
    table.style.width = w + 'px';
  }
  function paintCells() {
    get = makeEvaluator(sh);
    for (let r = 0; r < sh.rows; r++) for (let col = 0; col < sh.cols; col++) {
      const td = cellEls[r][col], cell = sh.cells[refOf(r, col)];
      if (!cell) { if (td.textContent || td.style.cssText) { td.textContent = ''; td.className = ''; td.style.cssText = ''; } continue; }
      const d = display(get(refOf(r, col)), cell.s?.nf);
      td.textContent = d.text;
      const s = cell.s || {};
      td.className = (d.num && !s.al ? 'num' : '') + (d.err ? ' err' : '');
      td.style.fontWeight = s.b ? '700' : ''; td.style.fontStyle = s.i ? 'italic' : ''; td.style.textDecoration = s.u ? 'underline' : '';
      td.style.textAlign = s.al === 'c' ? 'center' : s.al === 'r' ? 'right' : s.al === 'l' ? 'left' : '';
      td.style.background = s.bg || ''; td.style.color = s.fg || '';
    }
    paintStatus();
  }
  const inSel = (r, col) => r >= Math.min(sel.r0, sel.r1) && r <= Math.max(sel.r0, sel.r1) && col >= Math.min(sel.c0, sel.c1) && col <= Math.max(sel.c0, sel.c1);
  const bounds = () => ({ r0: Math.min(sel.r0, sel.r1), r1: Math.max(sel.r0, sel.r1), c0: Math.min(sel.c0, sel.c1), c1: Math.max(sel.c0, sel.c1) });
  function paintSel() {
    for (let r = 0; r < sh.rows; r++) for (let col = 0; col < sh.cols; col++) {
      const td = cellEls[r][col];
      td.classList.toggle('in-sel', inSel(r, col) && !(r === act.r && col === act.c));
      td.classList.toggle('active', r === act.r && col === act.c);
    }
    const b = bounds();
    headEls.forEach((th, i) => th.classList.toggle('sel-h', i >= b.c0 && i <= b.c1));
    rowHeads.forEach((th, i) => th.classList.toggle('sel-h', i >= b.r0 && i <= b.r1));
    const multi = b.r0 !== b.r1 || b.c0 !== b.c1;
    refBox.textContent = multi ? `${refOf(b.r0, b.c0)}:${refOf(b.r1, b.c1)}` : refOf(act.r, act.c);
    if (document.activeElement !== fx) fx.value = sh.cells[refOf(act.r, act.c)]?.v ?? '';
    placeSink();
    paintStatus();
  }
  function paintStatus() {
    const b = bounds(); const nums = [];
    for (let r = b.r0; r <= b.r1; r++) for (let col = b.c0; col <= b.c1; col++) { const v = get(refOf(r, col)); if (typeof v === 'number') nums.push(v); }
    const sum = nums.reduce((a, x) => a + x, 0);
    status.replaceChildren(h('span', null, sh.name), nums.length > 1 ? [h('span', null, `합계 ${fmtGeneral(sum)}`), h('span', null, `평균 ${fmtGeneral(sum / nums.length)}`), h('span', null, `개수 ${nums.length}`)] : null, h('span', { class: 'spacer' }), h('span', null, '셀을 두 번 누르거나 바로 입력하세요 · 수식은 = 로 시작'));
  }
  function paintTabs() {
    tabs.replaceChildren(c.sheets.map((s, i) => h('button', { class: i === c.active ? 'on' : '', onclick: () => switchSheet(i), ondblclick: async () => { const n = await promptDialog('시트 이름', { value: s.name }); if (n) { s.name = n.trim() || s.name; paintTabs(); onChange(); } } }, s.name)),
      h('button', { title: '시트 추가', 'aria-label': '시트 추가', onclick: () => { c.sheets.push(newSheet(`Sheet${c.sheets.length + 1}`)); switchSheet(c.sheets.length - 1); onChange(); } }, '+'),
      c.sheets.length > 1 ? h('button', { title: '현재 시트 삭제', onclick: async () => { if (await confirmDialog(`"${sh.name}" 시트를 삭제할까요?`, { ok: '삭제', danger: true })) { c.sheets.splice(c.active, 1); switchSheet(Math.max(0, c.active - 1)); onChange(); } } }, '시트 삭제') : null,
      h('span', { class: 'spacer' }), h('span', { class: 'tiny', style: { color: '#777' } }, '시트 이름을 두 번 누르면 바꿀 수 있어요'));
  }
  function switchSheet(i) { commitEdit(); c.active = i; sh = c.sheets[i]; sel = { r0: 0, c0: 0, r1: 0, c1: 0 }; act = { r: 0, c: 0 }; build(); }

  // ----- selection -----
  function setSel(r0, c0, r1, c1, extend) {
    if (extend) { sel.r1 = r1; sel.c1 = c1; } else { sel = { r0, c0, r1, c1 }; act = { r: r0, c: c0 }; }
    paintSel();
  }
  function moveAct(dr, dc, extend) {
    if (extend) { sel.r1 = Math.max(0, Math.min(sh.rows - 1, sel.r1 + dr)); sel.c1 = Math.max(0, Math.min(sh.cols - 1, sel.c1 + dc)); }
    else { act = { r: Math.max(0, Math.min(sh.rows - 1, act.r + dr)), c: Math.max(0, Math.min(sh.cols - 1, act.c + dc)) }; sel = { r0: act.r, c0: act.c, r1: act.r, c1: act.c }; }
    paintSel();
    const td = cellEls[extend ? sel.r1 : act.r][extend ? sel.c1 : act.c];
    const sr = scroll.getBoundingClientRect(), tr = td.getBoundingClientRect();
    if (tr.bottom > sr.bottom) scroll.scrollTop += tr.bottom - sr.bottom + 4;
    if (tr.top < sr.top + 26) scroll.scrollTop -= sr.top + 26 - tr.top;
    if (tr.right > sr.right) scroll.scrollLeft += tr.right - sr.right + 4;
    if (tr.left < sr.left + 46) scroll.scrollLeft -= sr.left + 46 - tr.left;
  }

  // One invisible input sits over the active cell and receives every keystroke, so typing
  // (including Korean IME composition) starts editing exactly like Excel.
  let dragging = false;
  scroll.addEventListener('mousedown', e => {
    if (e.target === sink && editing) return;
    const td = e.target.closest('td'); if (!td) return;
    e.preventDefault();
    commitEdit();
    const r = +td.dataset.r, col = +td.dataset.c;
    if (e.shiftKey) setSel(0, 0, r, col, true); else setSel(r, col, r, col, false);
    dragging = true; focusSink();
  });
  scroll.addEventListener('mouseover', e => { if (!dragging) return; const td = e.target.closest('td'); if (td) setSel(0, 0, +td.dataset.r, +td.dataset.c, true); });
  const stopDrag = () => { dragging = false; };
  window.addEventListener('mouseup', stopDrag);
  scroll.addEventListener('dblclick', e => { if (e.target.closest('td') || e.target === sink) startEdit(); });

  // ----- editing -----
  function snapshot() { undo.push(JSON.stringify({ i: c.active, cells: sh.cells })); if (undo.length > 60) undo.shift(); redo.length = 0; }
  function setCell(ref, v) {
    const cell = sh.cells[ref];
    if ((v === '' || v == null) && !cell?.s) { delete sh.cells[ref]; return; }
    sh.cells[ref] = { ...(cell || {}), v };
  }
  function placeSink() {
    if (!cellEls || editing) return;
    const td = cellEls[act.r][act.c];
    Object.assign(sink.style, { left: td.offsetLeft - 1 + 'px', top: td.offsetTop - 1 + 'px', width: td.offsetWidth + 2 + 'px', height: td.offsetHeight + 2 + 'px' });
  }
  const focusSink = () => sink.focus({ preventScroll: true });
  function startEdit(keepTyping) {
    if (editing) return;
    editing = { ref: refOf(act.r, act.c) };
    sink.classList.add('on');
    sink.style.width = Math.max(cellEls[act.r][act.c].offsetWidth + 2, 140) + 'px';
    if (!keepTyping) { sink.value = sh.cells[editing.ref]?.v ?? ''; focusSink(); sink.setSelectionRange(sink.value.length, sink.value.length); }
  }
  function commitEdit(value) {
    if (!editing && value === undefined) return;
    const ref = editing?.ref ?? refOf(act.r, act.c);
    const v = value ?? sink.value;
    endEdit();
    if ((sh.cells[ref]?.v ?? '') === v) { paintSel(); return; }
    snapshot(); setCell(ref, v); paintCells(); paintSel(); onChange();
  }
  function endEdit() { editing = null; sink.value = ''; sink.classList.remove('on'); placeSink(); }
  function cancelEdit() { endEdit(); paintSel(); }

  sink.addEventListener('compositionstart', () => { if (!editing) startEdit(true); });
  sink.addEventListener('input', () => { if (!editing) startEdit(true); fx.value = sink.value; });
  sink.addEventListener('blur', () => setTimeout(() => { if (editing && document.activeElement !== fx && document.activeElement !== sink) commitEdit(); }, 0));
  sink.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if (editing) {
      if (k === 'Enter') { e.preventDefault(); commitEdit(); moveAct(e.shiftKey ? -1 : 1, 0); }
      else if (k === 'Tab') { e.preventDefault(); commitEdit(); moveAct(0, e.shiftKey ? -1 : 1); }
      else if (k === 'Escape') { e.preventDefault(); cancelEdit(); }
      return;
    }
    if (k === 'ArrowUp') { e.preventDefault(); moveAct(-1, 0, e.shiftKey); }
    else if (k === 'ArrowDown') { e.preventDefault(); moveAct(1, 0, e.shiftKey); }
    else if (k === 'ArrowLeft') { e.preventDefault(); moveAct(0, -1, e.shiftKey); }
    else if (k === 'ArrowRight') { e.preventDefault(); moveAct(0, 1, e.shiftKey); }
    else if (k === 'Enter') { e.preventDefault(); moveAct(e.shiftKey ? -1 : 1, 0); }
    else if (k === 'Tab') { e.preventDefault(); moveAct(0, e.shiftKey ? -1 : 1); }
    else if (k === 'F2') { e.preventDefault(); startEdit(); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearSel(); }
    else if (mod && k.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
    else if (mod && k.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    else if (mod && k.toLowerCase() === 'b') { e.preventDefault(); toggleStyle('b'); }
    else if (mod && k.toLowerCase() === 'i') { e.preventDefault(); toggleStyle('i'); }
    else if (mod && k.toLowerCase() === 'a') { e.preventDefault(); setSel(0, 0, sh.rows - 1, sh.cols - 1, false); }
  });
  fx.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); const v = fx.value; endEdit(); commitEdit(v); moveAct(1, 0); focusSink(); }
    if (e.key === 'Escape') { fx.value = sh.cells[refOf(act.r, act.c)]?.v ?? ''; cancelEdit(); focusSink(); }
  });
  fx.addEventListener('input', () => { if (!editing) { startEdit(true); } sink.value = fx.value; });

  scroll.addEventListener('copy', e => { if (editing) return; e.preventDefault(); const t = copyText(); e.clipboardData.setData('text/plain', t); clipRaw = { text: t, rows: rawRows() }; });
  scroll.addEventListener('cut', e => { if (editing) return; e.preventDefault(); const t = copyText(); e.clipboardData.setData('text/plain', t); clipRaw = { text: t, rows: rawRows() }; clearSel(); });
  scroll.addEventListener('paste', e => {
    if (editing) return; e.preventDefault();
    const t = e.clipboardData.getData('text/plain'); if (!t) return;
    const rows = clipRaw && clipRaw.text === t ? clipRaw.rows : t.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
    snapshot();
    rows.forEach((row, i) => row.forEach((v, j) => { const r = act.r + i, col = act.c + j; if (r < sh.rows && col < sh.cols) setCell(refOf(r, col), v); }));
    sel = { r0: act.r, c0: act.c, r1: Math.min(sh.rows - 1, act.r + rows.length - 1), c1: Math.min(sh.cols - 1, act.c + Math.max(...rows.map(r => r.length)) - 1) };
    paintCells(); paintSel(); onChange();
  });
  const rawRows = () => { const b = bounds(), out = []; for (let r = b.r0; r <= b.r1; r++) { const row = []; for (let col = b.c0; col <= b.c1; col++) row.push(sh.cells[refOf(r, col)]?.v ?? ''); out.push(row); } return out; };
  const copyText = () => { const b = bounds(), out = []; for (let r = b.r0; r <= b.r1; r++) { const row = []; for (let col = b.c0; col <= b.c1; col++) row.push(display(get(refOf(r, col)), sh.cells[refOf(r, col)]?.s?.nf).text); out.push(row.join('\t')); } return out.join('\n'); };

  function eachSel(fn) { const b = bounds(); for (let r = b.r0; r <= b.r1; r++) for (let col = b.c0; col <= b.c1; col++) fn(refOf(r, col), r, col); }
  function clearSel() { snapshot(); eachSel(ref => { if (sh.cells[ref]) { if (sh.cells[ref].s) sh.cells[ref].v = ''; else delete sh.cells[ref]; } }); paintCells(); paintSel(); onChange(); }
  function styleSel(fn) { snapshot(); eachSel(ref => { const cell = sh.cells[ref] ||= { v: '' }; cell.s ||= {}; fn(cell.s); }); paintCells(); onChange(); focusSink(); }
  function toggleStyle(k) { const on = !sh.cells[refOf(act.r, act.c)]?.s?.[k]; styleSel(s => { s[k] = on; }); }
  function doUndo() { const u = undo.pop(); if (!u) return; const st = JSON.parse(u); redo.push(JSON.stringify({ i: st.i, cells: c.sheets[st.i].cells })); c.sheets[st.i].cells = st.cells; if (st.i !== c.active) switchSheet(st.i); paintCells(); paintSel(); onChange(); }
  function doRedo() { const u = redo.pop(); if (!u) return; const st = JSON.parse(u); undo.push(JSON.stringify({ i: st.i, cells: c.sheets[st.i].cells })); c.sheets[st.i].cells = st.cells; paintCells(); paintSel(); onChange(); }

  // ----- structure -----
  function shift(axis, at, delta) {
    snapshot();
    const out = {};
    for (const [ref, cell] of Object.entries(sh.cells)) {
      const p = parseRef(ref);
      let { r, c: col } = p;
      if (axis === 'r') { if (delta < 0 && r === at) continue; if (r >= at + (delta < 0 ? 1 : 0)) r += delta; }
      else { if (delta < 0 && col === at) continue; if (col >= at + (delta < 0 ? 1 : 0)) col += delta; }
      if (r < 0 || col < 0 || r >= sh.rows || col >= sh.cols) continue;
      const v = typeof cell.v === 'string' && cell.v.startsWith('=') ? shiftFormula(cell.v, axis, delta < 0 ? at + 1 : at, delta) : cell.v;
      out[refOf(r, col)] = { ...cell, v };
    }
    sh.cells = out; paintCells(); paintSel(); onChange();
  }
  function sortSel(desc) {
    const b = bounds();
    if (b.r0 === b.r1) { toast('정렬할 범위(여러 행)를 먼저 선택하세요.'); return; }
    snapshot();
    const rows = [];
    for (let r = b.r0; r <= b.r1; r++) { const row = []; for (let col = b.c0; col <= b.c1; col++) row.push(sh.cells[refOf(r, col)]); rows.push({ key: get(refOf(r, act.c)), row }); }
    rows.sort((x, y) => { const a = x.key, bb = y.key; const res = typeof a === 'number' && typeof bb === 'number' ? a - bb : a === '' ? 1 : bb === '' ? -1 : String(a).localeCompare(String(bb), 'ko'); return desc ? -res : res; });
    rows.forEach((item, i) => item.row.forEach((cell, j) => { const ref = refOf(b.r0 + i, b.c0 + j); if (cell) sh.cells[ref] = cell; else delete sh.cells[ref]; }));
    paintCells(); paintSel(); onChange();
  }
  function autoSum() {
    const b = bounds();
    snapshot();
    if (b.r0 !== b.r1 || b.c0 !== b.c1) {
      if (b.r1 + 1 < sh.rows) for (let col = b.c0; col <= b.c1; col++) setCell(refOf(b.r1 + 1, col), `=SUM(${refOf(b.r0, col)}:${refOf(b.r1, col)})`);
    } else {
      let r = act.r - 1; while (r >= 0 && typeof get(refOf(r, act.c)) === 'number') r--;
      if (r === act.r - 1) { toast('위쪽에 숫자가 있는 칸에서 눌러 주세요.'); undo.pop(); return; }
      setCell(refOf(act.r, act.c), `=SUM(${refOf(r + 1, act.c)}:${refOf(act.r - 1, act.c)})`);
    }
    paintCells(); paintSel(); onChange();
  }
  function chart() {
    const b = bounds();
    const series = [];
    for (let r = b.r0; r <= b.r1; r++) {
      const label = b.c0 === b.c1 ? refOf(r, b.c0) : display(get(refOf(r, b.c0)), null).text;
      const v = get(refOf(r, b.c0 === b.c1 ? b.c0 : b.c0 + 1));
      if (typeof v === 'number') series.push({ label: String(label).slice(0, 8), value: v, hl: true });
    }
    if (!series.length) { toast('차트로 만들 범위를 선택하세요. 첫 열은 이름, 다음 열은 숫자예요.'); return; }
    modal({ title: '세로 막대 차트', wide: true, body: h('div', { class: 'col' }, barChart(series, { height: 260, fmt: v => fmtGeneral(Math.round(v * 100) / 100) }), h('p', { class: 'tiny muted', style: { margin: 0 } }, `범위 ${refBox.textContent}`)) });
  }
  function fnHelp() {
    modal({ title: '자주 쓰는 함수', wide: true, body: h('div', { class: 'col' },
      h('p', { class: 'small muted', style: { margin: 0 } }, '칸에 = 를 먼저 쓰고 함수를 입력하세요. 예: =SUM(B2:B10)'),
      h('div', { class: 'fn-help' }, FUNCTION_HELP.map(([f, d]) => [h('code', null, '=' + f.replace(/^=/, '')), h('span', null, d)]))) });
  }

  const rb = ribbon([
    ['홈', () => h('div', { class: 'row wrap', style: { gap: '4px' } },
      group(tb('undo', '실행 취소', doUndo), tb('redo', '다시 실행', doRedo)),
      group(tb('bold', '굵게', () => toggleStyle('b')), tb('italic', '기울임', () => toggleStyle('i')), tb('underline', '밑줄', () => toggleStyle('u'))),
      group(tb('alignL', '왼쪽', () => styleSel(s => { s.al = 'l'; })), tb('alignC', '가운데', () => styleSel(s => { s.al = 'c'; })), tb('alignR', '오른쪽', () => styleSel(s => { s.al = 'r'; }))),
      group(colorBtn('fill', '채우기 색', '#fff3a8', v => styleSel(s => { s.bg = v; })), colorBtn('text', '글자 색', '#c0392b', v => styleSel(s => { s.fg = v; })), tb('eraser', '서식 지우기', () => styleSel(s => { Object.keys(s).forEach(k => delete s[k]); }))),
      group(h('select', { class: 'tb-select', 'aria-label': '표시 형식', onchange: e => styleSel(s => { s.nf = e.target.value; }) }, NF.map(([v, l]) => h('option', { value: v }, l)))),
      group(tb('sigma', '자동 합계', autoSum, { text: '자동 합계' }), tb('trash', '내용 지우기', clearSel)))],
    ['삽입', () => h('div', { class: 'row wrap', style: { gap: '4px' } },
      group(tb('rowAdd', '위에 행 삽입', () => shift('r', bounds().r0, 1), { text: '행 삽입' }), h('button', { class: 'tb', onclick: () => shift('r', bounds().r0, -1) }, '행 삭제')),
      group(tb('colAdd', '왼쪽에 열 삽입', () => shift('c', bounds().c0, 1), { text: '열 삽입' }), h('button', { class: 'tb', onclick: () => shift('c', bounds().c0, -1) }, '열 삭제')),
      group(tb('chart', '차트', chart, { text: '차트' })))],
    ['데이터', () => h('div', { class: 'row wrap', style: { gap: '4px' } },
      group(tb('sortUp', '오름차순 정렬', () => sortSel(false), { text: '오름차순' }), tb('sortDown', '내림차순 정렬', () => sortSel(true), { text: '내림차순' })),
      group(tb('sigma', '함수 도움말', fnHelp, { text: '함수 도움말' })))],
  ]);

  host.append(rb, wrap, status);
  build();
  setTimeout(focusSink, 50);

  // ----- files -----
  async function exportXLSX() {
    await loadScript(LIBS.xlsx);
    const X = window.XLSX, wb = X.utils.book_new();
    c.sheets.forEach(s => {
      const g = makeEvaluator(s), ws = {};
      let maxR = 0, maxC = 0;
      for (const [ref, cell] of Object.entries(s.cells)) {
        if (cell.v === '' || cell.v == null) continue;
        const p = parseRef(ref); maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c);
        const val = g(ref);
        const out = typeof cell.v === 'string' && cell.v.startsWith('=') ? { f: cell.v.slice(1) } : {};
        if (val instanceof FErr) Object.assign(out, { t: 'e', v: 0, w: val.code });
        else if (typeof val === 'number') Object.assign(out, { t: 'n', v: val, z: { num: '0.00', int: '#,##0', cur: '"₩"#,##0', pct: '0.0%' }[cell.s?.nf] });
        else if (typeof val === 'boolean') Object.assign(out, { t: 'b', v: val });
        else Object.assign(out, { t: 's', v: String(val) });
        ws[ref] = out;
      }
      ws['!ref'] = `A1:${refOf(maxR, maxC)}`;
      ws['!cols'] = Array.from({ length: maxC + 1 }, (_, i) => ({ wpx: s.colW[i] || 96 }));
      X.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    });
    const buf = X.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), safeName(doc.title) + '.xlsx');
  }
  async function importFile() {
    const [f] = await pickFiles({ accept: '.xlsx,.xls,.csv' }); if (!f) return;
    try {
      await loadScript(LIBS.xlsx);
      const X = window.XLSX;
      const wb = /\.csv$/i.test(f.name) ? X.read(await f.text(), { type: 'string' }) : X.read(await f.arrayBuffer(), { type: 'array' });
      c.sheets = wb.SheetNames.map(name => {
        const ws = wb.Sheets[name], s = newSheet(name);
        for (const [ref, cell] of Object.entries(ws)) {
          if (ref.startsWith('!')) continue;
          const p = parseRef(ref); if (!p) continue;
          if (p.r >= s.rows) s.rows = Math.min(1000, p.r + 20);
          if (p.c >= s.cols) s.cols = Math.min(52, p.c + 2);
          s.cells[ref] = { v: cell.f ? '=' + cell.f : cell.v instanceof Date ? cell.w : String(cell.v ?? '') };
        }
        return s;
      });
      c.active = 0; sh = c.sheets[0]; build(); onChange();
      if (/제목 없는/.test(doc.title)) api.onTitle?.(f.name.replace(/\.(xlsx|xls|csv)$/i, ''));
      toast('파일을 불러왔어요.');
    } catch (e) { toast(e.message || '파일을 열지 못했어요.'); }
  }
  function exportCSV() {
    let maxR = 0, maxC = 0;
    Object.keys(sh.cells).forEach(ref => { const p = parseRef(ref); maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c); });
    const lines = [];
    for (let r = 0; r <= maxR; r++) { const row = []; for (let col = 0; col <= maxC; col++) { const t = display(get(refOf(r, col)), null).text; row.push(/[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t); } lines.push(row.join(',')); }
    download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), safeName(doc.title) + '.csv');
  }

  const api = {
    exports: [
      { label: 'Excel 파일로 저장 (.xlsx)', run: () => exportXLSX().catch(e => toast(e.message)) },
      { label: 'CSV로 저장 (현재 시트)', run: exportCSV },
      { label: 'Excel · CSV 파일 열기', icon: 'upload', run: importFile },
    ],
    aiPlaceholder: '예: "이번 달 가계부 표 만들어줘", "C열에 합계 수식 넣어줘", "성적표에 평균과 등수 추가"',
    aiHello: '엑셀 시트를 함께 만들어요. 표를 새로 만들거나, 지금 시트에 수식·열을 추가해 달라고 말해 보세요. 영수증 사진이나 표 이미지를 첨부하면 옮겨 적어요.',
    aiSuggest: ['월간 가계부 표 만들어줘', '합계 · 평균 수식 추가', '이 데이터를 정리해서 표로', '시간표 만들어줘'],
    aiSystem: `너는 스프레드시트(엑셀) 안의 도우미다. 사용자의 요청대로 현재 시트 전체 내용을 2차원 배열 rows로 돌려준다.
rows[0]은 1행(A1부터), 각 값은 문자열이다. 수식은 =로 시작하는 엑셀 수식으로 쓴다 (지원: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, IFERROR, ROUND, SUMIF, COUNTIF, AVERAGEIF, VLOOKUP, RANK, AND, OR, LEFT, RIGHT, MID, LEN, CONCAT, TODAY, ABS, INT, MOD). 셀 참조는 A1 형식만 쓴다 (A:A 같은 열 전체 참조는 쓰지 않는다).
기존 데이터를 고쳐 달라는 요청이면 기존 내용을 유지하면서 바꾼 전체 시트를 돌려준다. 첫 행은 보통 제목 행이다. 시트는 최대 ${ROWS}행 ${COLS}열.
mode: replace = rows로 현재 시트를 바꾼다, none = 시트는 그대로 두고 reply로만 답한다. reply는 무엇을 했는지 한두 문장 한국어로. sheetName은 시트 이름, title은 파일에 어울리는 짧은 제목.`,
    aiSchema: obj({ reply: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'none'] }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, sheetName: { type: 'string' }, title: { type: 'string' } }),
    serialize: () => {
      const entries = Object.entries(sh.cells).filter(([, cell]) => cell.v !== '' && cell.v != null);
      if (!entries.length) return `(시트 "${sh.name}"는 비어 있음)`;
      return `시트 이름: ${sh.name}\n` + entries.slice(0, 3000).map(([ref, cell]) => `${ref}: ${cell.v}`).join('\n');
    },
    snapshot: () => JSON.stringify(c),
    restore: snap => { const o = JSON.parse(snap); c.sheets = o.sheets; c.active = o.active; sh = c.sheets[c.active]; build(); onChange(); },
    apply: r => {
      if (r.mode !== 'replace' || !Array.isArray(r.rows)) return;
      snapshot();
      const keepW = sh.colW;
      sh.cells = {}; sh.colW = keepW;
      r.rows.slice(0, sh.rows).forEach((row, i) => row.slice(0, sh.cols).forEach((v, j) => { if (v !== '' && v != null) sh.cells[refOf(i, j)] = { v: String(v), ...(i === 0 ? { s: { b: true, bg: '#eef0f3' } } : {}) }; }));
      if (r.sheetName) sh.name = r.sheetName.slice(0, 31);
      build(); onChange();
    },
    destroy: () => window.removeEventListener('mouseup', stopDrag),
  };
  return api;
}
