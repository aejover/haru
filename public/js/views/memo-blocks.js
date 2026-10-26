// memo-blocks.js — 메모장 블록: 표, 구분선, 토글 (접고 펼치는 블록), 그리고 줄 왼쪽의 + 버튼(이미지·표·파일 바로 넣기).
import { h, icon, modal, upload, pickFiles, toast, fmtSize } from '../core.js';

const escHTML = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cellAt = (body, node) => { for (let n = node; n && n !== body; n = n.parentNode) if (n.tagName === 'TD' || n.tagName === 'TH') return n; return null; };
const inside = (body, node, cls) => { for (let n = node; n && n !== body; n = n.parentNode) if (n.classList?.contains(cls)) return n; return null; };
const placeCaret = (el, atEnd = false) => {
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(!atEnd);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
};

export function memoBlocks(body, onChange) {
  // remember where the caret was, so toolbar buttons insert at that spot
  let saved = null;
  const onSel = () => { const s = getSelection(); if (s.rangeCount && body.contains(s.anchorNode)) { saved = s.getRangeAt(0).cloneRange(); paintTableBar(); } };
  document.addEventListener('selectionchange', onSel);
  function restore() {
    const s = getSelection();
    const live = s.rangeCount && body.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
    body.focus({ preventScroll: true });
    s.removeAllRanges();
    if (live) s.addRange(live);
    else if (saved && body.contains(saved.startContainer)) s.addRange(saved);
    else { const r = document.createRange(); r.selectNodeContents(body); r.collapse(false); s.addRange(r); }
  }
  // blocks never go inside a table cell or a toggle title: insert right after that table / toggle
  function leaveTable() {
    const s = getSelection();
    const td = cellAt(body, s.anchorNode);
    const host = td ? td.closest('table') : inside(body, s.anchorNode, 'mt-title')?.closest('.mtoggle');
    if (!host) return;
    const line = document.createElement('div'); line.innerHTML = '<br>';
    host.after(line);
    const r = document.createRange(); r.setStart(line, 0); r.collapse(true);
    s.removeAllRanges(); s.addRange(r);
  }
  const insertHTML = html => { restore(); leaveTable(); document.execCommand('insertHTML', false, html); onChange(); };

  // ----- divider -----
  const divider = () => insertHTML('<hr class="mhr"><div><br></div>');

  // ----- toggle -----
  const HEAD = '<div class="mt-head"><span class="mt-arrow" contenteditable="false" role="button" aria-label="펼치기/접기"></span><div class="mt-title"><br></div></div>';
  // Repair toggles whose header or body got deleted by editing (and fix memos saved that way).
  function normalize() {
    let fixed = false;
    body.querySelectorAll('.mtoggle').forEach(tg => {
      let head = [...tg.children].find(c => c.classList.contains('mt-head'));
      if (!head) { tg.insertAdjacentHTML('afterbegin', HEAD); head = tg.firstElementChild; fixed = true; }
      if (!head.querySelector('.mt-arrow')) { head.insertAdjacentHTML('afterbegin', '<span class="mt-arrow" contenteditable="false" role="button" aria-label="펼치기/접기"></span>'); fixed = true; }
      if (!head.querySelector('.mt-title')) { head.insertAdjacentHTML('beforeend', '<div class="mt-title"><br></div>'); fixed = true; }
      let bodyEl = [...tg.children].find(c => c.classList.contains('mt-body'));
      if (!bodyEl) { tg.insertAdjacentHTML('beforeend', '<div class="mt-body"><div class="mt-inner"><div><br></div></div></div>'); fixed = true; }
      else if (!bodyEl.querySelector('.mt-inner')) { const inner = document.createElement('div'); inner.className = 'mt-inner'; inner.append(...bodyEl.childNodes); if (!inner.firstChild) inner.innerHTML = '<div><br></div>'; bodyEl.append(inner); fixed = true; }
    });
    return fixed;
  }
  if (normalize()) onChange();
  body.addEventListener('input', () => { if (normalize()) onChange(); });
  // turn a toggle back into plain lines (its title first, then what was inside)
  function unwrap(tg) {
    const title = tg.querySelector('.mt-title');
    const first = document.createElement('div');
    first.innerHTML = title && title.textContent.trim() ? title.innerHTML : '<br>';
    const inner = tg.querySelector('.mt-inner');
    const rest = inner ? [...inner.childNodes].filter(n => n.nodeType === 1 ? n.textContent.trim() || n.querySelector('img,table,hr') : n.textContent.trim()) : [];
    tg.replaceWith(first, ...rest);
    placeCaret(first);
    onChange();
  }
  function toggle() {
    insertHTML(`<div class="mtoggle open">${HEAD}<div class="mt-body"><div class="mt-inner"><div><br></div></div></div></div><div><br></div>`);
    const all = body.querySelectorAll('.mtoggle .mt-title');
    const t = [...all].reverse().find(x => !x.textContent.trim());
    if (t) placeCaret(t);
  }
  body.addEventListener('click', e => {
    const arrow = e.target.closest('.mt-arrow');
    if (!arrow || !body.contains(arrow)) return;
    e.preventDefault();
    arrow.closest('.mtoggle').classList.toggle('open');
    onChange();
  });

  // ----- table -----
  function tablePicker() {
    const grid = h('div', { class: 'tbl-picker', style: { gridTemplateColumns: 'repeat(6, 24px)' } });
    const label = h('div', { class: 'small muted' }, '표 크기를 고르세요');
    let pick = [3, 3];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
      grid.append(h('i', {
        style: { width: '24px', height: '24px' },
        onmouseenter: () => { pick = [r + 1, c + 1]; label.textContent = `${pick[0]} × ${pick[1]} 표`; [...grid.children].forEach((x, i) => x.classList.toggle('on', Math.floor(i / 6) <= r && i % 6 <= c)); },
        onclick: () => { m.close(); insertTable(pick[0], pick[1]); },
      }));
    }
    const m = modal({ title: '표 넣기', body: h('div', { class: 'col' }, grid, label, h('p', { class: 'tiny muted', style: { margin: 0 } }, '표 안에서 Tab을 누르면 다음 칸으로, 마지막 칸에서 누르면 줄이 추가돼요.')) });
  }
  function insertTable(rows, cols) {
    const tr = () => `<tr>${'<td><br></td>'.repeat(cols)}</tr>`;
    insertHTML(`<table class="mtable"><tbody>${tr().repeat(rows)}</tbody></table><div><br></div>`);
    const t = [...body.querySelectorAll('table.mtable')].pop();
    if (t) placeCaret(t.querySelector('td'));
  }
  function tableOp(op) {
    restore();
    const td = cellAt(body, getSelection().anchorNode); if (!td) return;
    const tr = td.parentNode, table = td.closest('table'), idx = [...tr.children].indexOf(td);
    const blank = () => { const x = document.createElement('td'); x.innerHTML = '<br>'; return x; };
    if (op === 'row') { const n = document.createElement('tr'); [...tr.children].forEach(() => n.append(blank())); tr.after(n); placeCaret(n.children[idx] || n.firstChild); }
    if (op === 'col') { table.querySelectorAll('tr').forEach(row => { const ref = row.children[idx]; ref ? ref.after(blank()) : row.append(blank()); }); placeCaret(tr.children[idx + 1]); }
    if (op === 'delRow') { const next = tr.nextElementSibling || tr.previousElementSibling; tr.remove(); if (next) placeCaret(next.children[Math.min(idx, next.children.length - 1)]); else table.remove(); }
    if (op === 'delCol') { table.querySelectorAll('tr').forEach(row => row.children[idx]?.remove()); if (!table.querySelector('td')) table.remove(); }
    if (op === 'delTable') { const after = table.nextElementSibling; table.remove(); if (after) placeCaret(after); }
    onChange(); paintTableBar();
  }
  body.addEventListener('keydown', e => {
    if (e.isComposing) return;
    const s = getSelection();
    const td = cellAt(body, s.anchorNode);
    if (td && e.key === 'Tab') {
      e.preventDefault();
      const cells = [...td.closest('table').querySelectorAll('td')];
      const i = cells.indexOf(td) + (e.shiftKey ? -1 : 1);
      if (i >= cells.length) { tableOp('row'); placeCaret(td.closest('table').querySelector('tr:last-child td')); }
      else if (i >= 0) placeCaret(cells[i], true);
      return;
    }
    // Enter in a toggle title jumps into its body (and opens it) instead of splitting the title
    const title = inside(body, s.anchorNode, 'mt-title');
    if (title && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const tg = title.closest('.mtoggle'); tg.classList.add('open');
      const first = tg.querySelector('.mt-inner > *') || tg.querySelector('.mt-inner');
      placeCaret(first); onChange();
      return;
    }
    // Backspace at the very start of a title would delete the arrow; turn the toggle back into text instead
    if (title && e.key === 'Backspace' && s.isCollapsed) {
      const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(title); r.setEnd(s.anchorNode, s.anchorOffset);
      if (!r.toString().length) { e.preventDefault(); unwrap(title.closest('.mtoggle')); }
      return;
    }
    // Enter on an empty last line inside a toggle leaves the toggle (like Notion)
    const inner = inside(body, s.anchorNode, 'mt-inner');
    if (inner && e.key === 'Enter' && !e.shiftKey) {
      let line = s.anchorNode; while (line && line.parentNode !== inner) line = line.parentNode;
      if (line && line === inner.lastElementChild && !line.textContent.trim() && !line.querySelector?.('img,table,hr') && inner.children.length > 1) {
        e.preventDefault();
        line.remove();
        const out = document.createElement('div'); out.innerHTML = '<br>';
        inner.closest('.mtoggle').after(out);
        placeCaret(out); onChange();
      }
    }
  });

  // table tools appear only while the caret is in a table
  const tableBar = h('div', { class: 'memo-tablebar glass', hidden: true });
  const btn = (label, op, ic) => h('button', { class: 'tb', onmousedown: e => e.preventDefault(), onclick: () => tableOp(op) }, ic ? icon(ic, 15) : null, h('span', { class: 'lb' }, label));
  tableBar.append(h('b', { class: 'small', style: { margin: '0 6px' } }, '표'), btn('아래에 줄 추가', 'row', 'rowAdd'), btn('오른쪽에 칸 추가', 'col', 'colAdd'), btn('줄 삭제', 'delRow'), btn('칸 삭제', 'delCol'), h('span', { class: 'spacer' }), btn('표 삭제', 'delTable', 'trash'));
  function paintTableBar() { const s = getSelection(); tableBar.hidden = !(s.rangeCount && cellAt(body, s.anchorNode)); }

  // ----- the faint + at the left of the line you're writing on -----
  const plus = h('button', { class: 'memo-plus', type: 'button', hidden: true, 'aria-label': '이미지 · 표 · 파일 넣기', title: '이미지 · 표 · 파일 넣기', onmousedown: e => e.preventDefault(), onclick: () => toggleMenu() }, icon('plus', 15));
  const menu = h('div', { class: 'memo-plus-menu glass', hidden: true, role: 'menu' },
    [['image', '이미지', insertImages], ['table', '표', () => insertTable(3, 3)], ['clip', '파일', insertFiles]].map(([ic, label, run]) =>
      h('button', { type: 'button', role: 'menuitem', onmousedown: e => e.preventDefault(), onclick: () => { toggleMenu(false); run(); } }, icon(ic, 16), label)));
  const lineOf = node => { // the top-level line (block) of the memo that holds this node
    if (!node || node === body) return null;
    let n = node; while (n.parentNode && n.parentNode !== body) n = n.parentNode;
    return n.parentNode === body ? n : null;
  };
  function placePlus() {
    const s = getSelection();
    const inBody = document.activeElement === body && s.rangeCount && body.contains(s.anchorNode);
    if (!inBody) { if (menu.hidden) plus.hidden = true; return; }
    const host = plus.parentNode; if (!host) return;
    const line = lineOf(s.anchorNode);
    let rect = line?.nodeType === 1 ? line.getBoundingClientRect() : null;
    if (!rect || !rect.height) { const r = s.getRangeAt(0).getClientRects()[0]; rect = r || body.getBoundingClientRect(); }
    const lh = parseFloat(getComputedStyle(body).lineHeight) || 28;
    plus.style.top = `${rect.top - host.getBoundingClientRect().top + Math.min(rect.height || lh, lh) / 2 - 12}px`;
    plus.hidden = false;
    if (!menu.hidden) menu.style.top = `${parseFloat(plus.style.top) + 28}px`;
  }
  function toggleMenu(open = menu.hidden) {
    menu.hidden = !open;
    plus.classList.toggle('open', open);
    if (open) { menu.style.top = `${parseFloat(plus.style.top) + 28}px`; restore(); }
  }
  document.addEventListener('selectionchange', placePlus);
  body.addEventListener('focus', placePlus);
  body.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== body && menu.hidden) plus.hidden = true; }, 150));
  const onDocDown = e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== plus && !plus.contains(e.target)) toggleMenu(false); };
  const onKey = e => { if (e.key === 'Escape' && !menu.hidden) toggleMenu(false); };
  document.addEventListener('pointerdown', onDocDown);
  document.addEventListener('keydown', onKey);
  async function insertImages() {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    for (const f of files) {
      try { const up = await upload(f); insertHTML(`<img class="mimg" src="${escHTML(up.url)}" alt="${escHTML(f.name)}"><div><br></div>`); }
      catch (e) { toast(e.message); }
    }
  }
  async function insertFiles() {
    const files = await pickFiles({ multiple: true });
    for (const f of files) {
      try {
        const up = await upload(f);
        insertHTML(`<a class="mfile" contenteditable="false" href="${escHTML(up.url)}" download="${escHTML(f.name)}">${escHTML(f.name)} <small>${fmtSize(f.size)}</small></a>&nbsp;`);
      } catch (e) { toast(e.message); }
    }
  }

  return {
    tableBar,
    plus: [plus, menu],
    tools: [
      h('button', { class: 'tb', title: '표', onmousedown: e => e.preventDefault(), onclick: tablePicker }, icon('table', 16), h('span', { class: 'lb' }, '표')),
      h('button', { class: 'tb', title: '구분선', onmousedown: e => e.preventDefault(), onclick: divider }, icon('hr', 16), h('span', { class: 'lb' }, '구분선')),
      h('button', { class: 'tb', title: '토글 (접고 펼치는 블록)', onmousedown: e => e.preventDefault(), onclick: toggle }, icon('down', 16), h('span', { class: 'lb' }, '토글')),
    ],
    destroy: () => {
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('selectionchange', placePlus);
      document.removeEventListener('pointerdown', onDocDown);
      document.removeEventListener('keydown', onKey);
    },
  };
}
