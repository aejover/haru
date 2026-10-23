// word.js — 워드 / 한글 편집기 (contenteditable A4 page with a beginner-friendly ribbon).
import { h, icon, toast, modal, promptDialog, upload, pickFiles, download, seg, obj } from '../core.js';
import { loadScript, LIBS, sanitize, inlineImages, safeName, tb, group, colorBtn, ribbon } from './util.js';

const FONTS = [['Malgun Gothic', '맑은 고딕'], ['Nanum Myeongjo', '나눔명조'], ['Batang', '바탕'], ['Dotum', '돋움'], ['Gulim', '굴림'], ['Pretendard Variable', '프리텐다드'], ['Arial', 'Arial'], ['Times New Roman', 'Times New Roman'], ['Georgia', 'Georgia'], ['Consolas', 'Consolas']];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const MARGINS = { normal: ['보통', [96, 96, 96, 96]], narrow: ['좁게', [48, 48, 48, 48]], wide: ['넓게', [96, 192, 96, 192]], hwp: ['한글 기본', [76, 113, 57, 113]] };
const CHARS = '※★☆○●◎◇◆□■△▲▽▼→←↑↓↔「」『』【】·‥…〃㈜℃㎡㎏㎞①②③④⑤ⓐⓑⓒ♡♥✓✔';

export function mountWord(host, doc, { onChange, kind }) {
  const hwp = kind === 'hwp';
  const c = doc.content ||= { html: '', orient: 'portrait', margin: hwp ? 'hwp' : 'normal', zoom: 1 };
  const paper = h('div', { class: 'paper' + (hwp ? ' hwp' : ''), contenteditable: 'true', spellcheck: 'false', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '문서 본문' });
  paper.innerHTML = sanitize(c.html);
  const desk = h('div', { class: 'desk' }, paper);
  const status = h('div', { class: 'statusbar' });
  const findBar = h('div', { class: 'find-bar glass', hidden: true });
  const picBar = h('div', { class: 'pic-bar glass', hidden: true });

  const changed = () => { c.html = paper.innerHTML; onChange(); paintStatus(); };
  paper.addEventListener('input', changed);

  // keep the caret when toolbar selects steal focus
  let saved = null;
  document.addEventListener('selectionchange', onSel);
  function onSel() { const s = getSelection(); if (s.rangeCount && paper.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); }
  function restore() { paper.focus({ preventScroll: true }); if (saved) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved); } }
  function exec(cmd, val, css = false) { restore(); document.execCommand('styleWithCSS', false, css); document.execCommand(cmd, false, val); changed(); }
  function setFontSize(pt) {
    restore(); document.execCommand('styleWithCSS', false, false); document.execCommand('fontSize', false, '7');
    paper.querySelectorAll('font[size="7"]').forEach(f => { const sp = document.createElement('span'); sp.style.fontSize = pt + 'pt'; sp.append(...f.childNodes); f.replaceWith(sp); });
    changed();
  }
  function blocksInSelection() {
    restore();
    const s = getSelection(); if (!s.rangeCount) return [];
    [...paper.childNodes].forEach(n => { if (n.nodeType === 3 && n.textContent.trim()) { const p = document.createElement('p'); n.replaceWith(p); p.append(n); } });
    const top = n => { while (n && n.parentNode !== paper) n = n.parentNode; return n; };
    const r = s.getRangeAt(0); const a = top(r.startContainer), b = top(r.endContainer);
    if (!a) return [];
    const out = []; let n = a;
    while (n) { if (n.nodeType === 1) out.push(n); if (n === b) break; n = n.nextSibling; }
    return out;
  }
  function insertHTML(html) { restore(); document.execCommand('insertHTML', false, html); changed(); }

  // paste: keep formatting but clean it; images go to the server
  paper.addEventListener('paste', async e => {
    const img = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (img) { e.preventDefault(); try { const up = await upload(img); exec('insertImage', up.url); } catch (err) { toast(err.message); } return; }
    const html = e.clipboardData?.getData('text/html');
    if (html) { e.preventDefault(); insertHTML(sanitize(html.replace(/<!--[\s\S]*?-->/g, ''))); }
  });

  // pictures: click to select, resize / align / delete
  let pic = null;
  paper.addEventListener('click', e => {
    paper.querySelectorAll('img.sel').forEach(i => i.classList.remove('sel'));
    pic = e.target.tagName === 'IMG' ? e.target : null;
    if (pic) pic.classList.add('sel');
    paintPic();
  });
  function paintPic() {
    picBar.hidden = !pic;
    if (!pic) return;
    const setW = w => { pic.style.width = w; changed(); };
    const align = a => { pic.style.display = 'block'; pic.style.marginLeft = a === 'l' ? '0' : 'auto'; pic.style.marginRight = a === 'r' ? '0' : 'auto'; changed(); };
    picBar.replaceChildren(h('b', { class: 'small', style: { margin: '0 6px' } }, '그림'), ...['25%', '50%', '75%', '100%'].map(w => h('button', { class: 'tb', onclick: () => setW(w) }, w)),
      h('span', { class: 'rgroup' }), tb('alignL', '왼쪽', () => align('l')), tb('alignC', '가운데', () => align('c')), tb('alignR', '오른쪽', () => align('r')),
      h('span', { class: 'spacer' }), tb('trash', '그림 삭제', () => { pic.remove(); pic = null; paintPic(); changed(); }));
  }

  // tables
  const cellAt = () => { const s = getSelection(); let n = s.anchorNode; while (n && n !== paper) { if (n.tagName === 'TD' || n.tagName === 'TH') return n; n = n.parentNode; } return null; };
  function tableOp(op) {
    restore();
    const td = cellAt(); if (!td) { toast('표 안을 먼저 누르세요.'); return; }
    const tr = td.parentNode, table = td.closest('table'), idx = [...tr.children].indexOf(td);
    const blank = tag => { const x = document.createElement(tag); x.innerHTML = '<br>'; return x; };
    if (op === 'rowBelow') { const n = document.createElement('tr'); [...tr.children].forEach(x => n.append(blank(x.tagName))); tr.after(n); }
    if (op === 'colRight') table.querySelectorAll('tr').forEach(row => { const ref = row.children[idx]; (ref ? ref.after.bind(ref) : row.append.bind(row))(blank(ref?.tagName || 'TD')); });
    if (op === 'delRow') { tr.remove(); if (!table.querySelector('tr')) table.remove(); }
    if (op === 'delCol') { table.querySelectorAll('tr').forEach(row => row.children[idx]?.remove()); if (!table.querySelector('td,th')) table.remove(); }
    if (op === 'delTable') table.remove();
    changed();
  }
  function tablePicker() {
    const grid = h('div', { class: 'tbl-picker' });
    const label = h('div', { class: 'small muted' }, '표 크기를 고르세요');
    let pick = [0, 0];
    for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) {
      grid.append(h('i', {
        onmouseenter: () => { pick = [r + 1, col + 1]; label.textContent = `${pick[0]} × ${pick[1]} 표`; [...grid.children].forEach((x, i) => x.classList.toggle('on', Math.floor(i / 8) <= r && i % 8 <= col)); },
        onclick: () => { m.close(); insert(pick[0], pick[1]); },
      }));
    }
    const insert = (rows, cols) => {
      const head = `<tr>${Array.from({ length: cols }, () => '<th><br></th>').join('')}</tr>`;
      const body = Array.from({ length: rows - 1 }, () => `<tr>${Array.from({ length: cols }, () => '<td><br></td>').join('')}</tr>`).join('');
      insertHTML(`<table><tbody>${head}${body}</tbody></table><p><br></p>`);
    };
    const m = modal({ title: '표 넣기', body: h('div', { class: 'col' }, grid, label, h('p', { class: 'tiny muted', style: { margin: 0 } }, '첫 줄은 제목 행이에요. 표 안을 누른 뒤 "삽입" 탭에서 행·열을 늘릴 수 있어요.')) });
  }
  function charPicker() {
    const m = modal({ title: '특수 문자', body: h('div', { class: 'char-grid' }, [...CHARS].map(ch => h('button', { onclick: () => { m.close(); exec('insertText', ch); } }, ch))) });
  }

  // find & replace
  function openFind() {
    findBar.hidden = !findBar.hidden;
    if (findBar.hidden) return;
    const q = h('input', { class: 'input', placeholder: '찾을 내용' });
    const rp = h('input', { class: 'input', placeholder: '바꿀 내용' });
    const info = h('span', { class: 'small muted' });
    let at = 0;
    const hits = () => {
      const out = []; const needle = q.value; if (!needle) return out;
      const w = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) { let i = n.textContent.indexOf(needle); while (i >= 0) { out.push([n, i]); i = n.textContent.indexOf(needle, i + needle.length); } }
      return out;
    };
    const findNext = () => {
      const list = hits(); info.textContent = list.length ? `${Math.min(at + 1, list.length)}/${list.length}` : '없음';
      if (!list.length) return;
      const [n, i] = list[at % list.length]; at = (at + 1) % list.length;
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + q.value.length);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      n.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    const replaceAll = () => {
      const needle = q.value; if (!needle) return;
      let count = 0;
      const w = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
      const nodes = []; for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
      nodes.forEach(n => { const parts = n.textContent.split(needle); if (parts.length > 1) { count += parts.length - 1; n.textContent = parts.join(rp.value); } });
      changed(); info.textContent = `${count}개 바꿈`;
    };
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } });
    findBar.replaceChildren(icon('search', 16), q, h('button', { class: 'btn btn-ghost btn-sm', onclick: findNext }, '다음 찾기'), rp, h('button', { class: 'btn btn-ghost btn-sm', onclick: replaceAll }, '모두 바꾸기'), info, h('span', { class: 'spacer' }), h('button', { class: 'btn-icon sm', 'aria-label': '닫기', onclick: () => { findBar.hidden = true; } }, icon('x', 16)));
    setTimeout(() => q.focus(), 0);
  }
  function countDialog() {
    const text = paper.innerText || '';
    const noSpace = text.replace(/\s/g, '').length;
    const words = (text.trim().match(/\S+/g) || []).length;
    const paras = [...paper.children].filter(x => x.textContent.trim()).length || (text.trim() ? 1 : 0);
    modal({ title: '글자 수 세기', body: h('div', { class: 'fn-help' },
      h('span', null, '글자 (공백 포함)'), h('b', { class: 'num' }, text.replace(/\n/g, '').length.toLocaleString()),
      h('span', null, '글자 (공백 제외)'), h('b', { class: 'num' }, noSpace.toLocaleString()),
      h('span', null, '단어'), h('b', { class: 'num' }, words.toLocaleString()),
      h('span', null, '문단'), h('b', { class: 'num' }, paras.toLocaleString()),
      h('span', null, '원고지 (200자)'), h('b', { class: 'num' }, `${Math.ceil(text.replace(/\n/g, '').length / 200)}매`),
      h('span', null, '바이트 (UTF-8)'), h('b', { class: 'num' }, new TextEncoder().encode(text).length.toLocaleString())) });
  }

  // page layout
  function applyLayout() {
    const [t, r, b, l] = MARGINS[c.margin]?.[1] || MARGINS.normal[1];
    paper.style.padding = `${t}px ${r}px ${b}px ${l}px`;
    paper.classList.toggle('landscape', c.orient === 'landscape');
    paper.style.zoom = c.zoom;
    paintStatus();
  }
  function paintStatus() {
    const text = paper.innerText || '';
    const pageH = c.orient === 'landscape' ? 794 : 1123;
    const pages = Math.max(1, Math.ceil(paper.scrollHeight / pageH));
    const zoom = h('input', { type: 'range', min: 50, max: 200, step: 10, value: Math.round(c.zoom * 100), 'aria-label': '확대/축소', oninput: e => { c.zoom = e.target.value / 100; paper.style.zoom = c.zoom; zl.textContent = e.target.value + '%'; onChange(); } });
    const zl = h('span', null, Math.round(c.zoom * 100) + '%');
    status.replaceChildren(h('span', null, `${pages}쪽`), h('span', null, `글자 ${text.replace(/\s/g, '').length.toLocaleString()}`), h('span', null, `단어 ${(text.trim().match(/\S+/g) || []).length.toLocaleString()}`), h('span', null, hwp ? '한글 문서' : 'Word 문서'), h('span', { class: 'spacer' }), zoom, zl);
  }

  // ribbon
  const fontSel = () => h('select', { class: 'tb-select', 'aria-label': '글꼴', onchange: e => exec('fontName', e.target.value) }, FONTS.map(([v, l]) => h('option', { value: v, selected: hwp ? v === 'Nanum Myeongjo' : v === 'Malgun Gothic' }, l)));
  const sizeSel = () => h('select', { class: 'tb-select', 'aria-label': '글자 크기', style: { width: '74px' }, onchange: e => setFontSize(e.target.value) }, SIZES.map(sz => h('option', { value: sz, selected: sz === (hwp ? 10 : 11) }, sz)));
  const styleSel = () => h('select', { class: 'tb-select', 'aria-label': '스타일', onchange: e => exec('formatBlock', e.target.value) }, [['<p>', '본문'], ['<h1>', '제목 1'], ['<h2>', '제목 2'], ['<h3>', '제목 3'], ['<blockquote>', '인용']].map(([v, l]) => h('option', { value: v }, l)));
  const lineSel = () => h('select', { class: 'tb-select', 'aria-label': '줄 간격', style: { width: '92px' }, onchange: e => { blocksInSelection().forEach(b => { b.style.lineHeight = e.target.value; }); changed(); } },
    h('option', { value: '' }, '줄 간격'), ['1.0', '1.15', '1.5', '1.6', '2.0', '2.5'].map(v => h('option', { value: v }, v === '1.6' ? '160%' : v)));
  const rb = ribbon([
    ['홈', () => h('div', { class: 'row wrap', style: { gap: '4px' } },
      group(tb('undo', '실행 취소 (Ctrl+Z)', () => exec('undo')), tb('redo', '다시 실행 (Ctrl+Y)', () => exec('redo'))),
      group(fontSel(), sizeSel()),
      group(tb('bold', '굵게 (Ctrl+B)', () => exec('bold')), tb('italic', '기울임 (Ctrl+I)', () => exec('italic')), tb('underline', '밑줄 (Ctrl+U)', () => exec('underline')), tb('strike', '취소선', () => exec('strikeThrough')),
        h('button', { class: 'tb', title: '위 첨자', onmousedown: e => e.preventDefault(), onclick: () => exec('superscript') }, 'x²'), h('button', { class: 'tb', title: '아래 첨자', onmousedown: e => e.preventDefault(), onclick: () => exec('subscript') }, 'x₂')),
      group(colorBtn('text', '글자 색', '#d93636', v => exec('foreColor', v, true)), colorBtn('highlighter', '형광펜', '#fff27a', v => exec('hiliteColor', v, true)), tb('eraser', '서식 지우기', () => exec('removeFormat'))),
      group(styleSel()),
      group(tb('alignL', '왼쪽 정렬', () => exec('justifyLeft')), tb('alignC', '가운데 정렬', () => exec('justifyCenter')), tb('alignR', '오른쪽 정렬', () => exec('justifyRight')), tb('alignJ', '양쪽 정렬', () => exec('justifyFull'))),
      group(tb('list', '글머리 기호', () => exec('insertUnorderedList')), tb('olist', '번호 매기기', () => exec('insertOrderedList')), tb('outdent', '내어쓰기', () => exec('outdent')), tb('indent', '들여쓰기', () => exec('indent')), lineSel()))],
    ['삽입', () => h('div', { class: 'row wrap', style: { gap: '4px' } },
      group(tb('table', '표', tablePicker, { text: '표' }), tb('image', '그림', async () => { const fs = await pickFiles({ accept: 'image/*', multiple: true }); for (const f of fs) { try { const up = await upload(f); exec('insertImage', up.url); } catch (e) { toast(e.message); } } }, { text: '그림' }),
        tb('link', '링크', async () => { const u = await promptDialog('링크 주소', { placeholder: 'https://' }); if (u) exec('createLink', /^https?:/.test(u) ? u : 'https://' + u); }, { text: '링크' })),
      group(tb('hr', '가로줄', () => exec('insertHorizontalRule'), { text: '가로줄' }), tb('doc', '쪽 나누기', () => insertHTML('<hr class="page-break"><p><br></p>'), { text: '쪽 나누기' }),
        tb('calendar', '날짜', () => exec('insertText', new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })), { text: '날짜' }), tb(null, '특수 문자', charPicker, { text: '※ 특수 문자' })),
      group(h('span', { class: 'tiny muted', style: { padding: '0 4px' } }, '표 편집'), tb('rowAdd', '아래에 행 추가', () => tableOp('rowBelow')), tb('colAdd', '오른쪽에 열 추가', () => tableOp('colRight')),
        h('button', { class: 'tb', onmousedown: e => e.preventDefault(), onclick: () => tableOp('delRow') }, '행 삭제'), h('button', { class: 'tb', onmousedown: e => e.preventDefault(), onclick: () => tableOp('delCol') }, '열 삭제'), h('button', { class: 'tb', onmousedown: e => e.preventDefault(), onclick: () => tableOp('delTable') }, '표 삭제')))],
    ['레이아웃', () => h('div', { class: 'row wrap', style: { gap: '10px' } },
      h('span', { class: 'small muted' }, '용지 방향'), seg([['portrait', '세로'], ['landscape', '가로']], c.orient, v => { c.orient = v; applyLayout(); onChange(); }),
      h('span', { class: 'small muted' }, '여백'), seg(Object.entries(MARGINS).map(([k, [l]]) => [k, l]), c.margin, v => { c.margin = v; applyLayout(); onChange(); }),
      h('span', { class: 'small muted' }, 'A4 (210 × 297mm)'))],
    ['검토', () => h('div', { class: 'row wrap', style: { gap: '4px' } },
      group(tb('search', '찾기 · 바꾸기', openFind, { text: '찾기 · 바꾸기' }), tb('type', '글자 수', countDialog, { text: '글자 수 세기' })),
      group(tb('present', '인쇄 · PDF', () => window.print(), { text: '인쇄 · PDF' })))],
  ]);

  paper.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
    if (e.key === 'Tab') { e.preventDefault(); exec(e.shiftKey ? 'outdent' : 'insertText', e.shiftKey ? undefined : '    '); }
  });

  host.append(rb, findBar, picBar, desk, status);
  applyLayout();
  if (!c.html) setTimeout(() => paper.focus(), 100);

  // ----- files -----
  const wrapDoc = async () => {
    const clone = paper.cloneNode(true);
    clone.querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
    await inlineImages(clone);
    const font = hwp ? "'Batang', 'Nanum Myeongjo', serif" : "'Malgun Gothic', sans-serif";
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${doc.title}</title><style>@page{size:${c.orient === 'landscape' ? '297mm 210mm' : '210mm 297mm'};margin:${(MARGINS[c.margin]?.[1] || MARGINS.normal[1]).map(px => (px / 3.78).toFixed(1) + 'mm').join(' ')}}body{font-family:${font};font-size:${hwp ? 10 : 11}pt;line-height:1.6}table{border-collapse:collapse}td,th{border:1px solid #888;padding:4px 6px}.page-break{page-break-after:always;border:0}</style></head><body>${clone.innerHTML}</body></html>`;
  };
  const exports = [
    { label: hwp ? '한글·Word에서 열 수 있는 파일 (.doc)' : 'Word 문서로 저장 (.doc)', run: async () => download(new Blob(['﻿', await wrapDoc()], { type: 'application/msword' }), safeName(doc.title) + '.doc') },
    { label: '웹 페이지로 저장 (.html)', run: async () => download(new Blob([await wrapDoc()], { type: 'text/html' }), safeName(doc.title) + '.html') },
    { label: '텍스트로 저장 (.txt)', run: () => download(new Blob([paper.innerText], { type: 'text/plain;charset=utf-8' }), safeName(doc.title) + '.txt') },
    { label: 'PDF로 저장 · 인쇄', icon: 'present', run: () => window.print() },
    { label: 'Word 파일 열기 (.docx)', icon: 'upload', run: async () => {
      const [f] = await pickFiles({ accept: '.docx' }); if (!f) return;
      try {
        await loadScript(LIBS.mammoth);
        const r = await window.mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() }, { convertImage: window.mammoth.images.imgElement(async im => { const b64 = await im.read('base64'); return { src: `data:${im.contentType};base64,${b64}` }; }) });
        paper.innerHTML = sanitize(r.value); changed(); toast('문서를 불러왔어요.');
        if (/제목 없는/.test(doc.title)) api.onTitle?.(f.name.replace(/\.docx$/i, ''));
      } catch (e) { toast(e.message || '문서를 열지 못했어요.'); }
    } },
    { label: 'HTML · 텍스트 파일 열기', icon: 'upload', run: async () => {
      const [f] = await pickFiles({ accept: '.html,.htm,.txt,.md' }); if (!f) return;
      const t = await f.text();
      paper.innerHTML = /\.html?$/i.test(f.name) ? sanitize(new DOMParser().parseFromString(t, 'text/html').body.innerHTML) : t.split('\n').map(l => `<p>${l.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) || '<br>'}</p>`).join('');
      changed();
    } },
  ];

  const api = {
    exports,
    aiPlaceholder: '예: "인공지능 윤리에 대한 A4 2쪽 보고서 써줘", "맞춤법 고쳐줘", "표로 정리해줘"',
    aiHello: `${hwp ? '한글' : '워드'} 문서를 함께 써요. 쓰고 싶은 내용을 말하거나, 지금 문서를 어떻게 고칠지 알려 주세요. 사진이나 PDF를 첨부하면 참고해서 써요.`,
    aiSuggest: ['보고서 목차와 초안 써줘', '맞춤법 · 띄어쓰기 고쳐줘', '더 격식 있게 다듬어줘', '핵심만 요약한 문단 추가'],
    aiSystem: `너는 ${hwp ? '한글(HWP)' : '워드'} 문서 편집기 안의 글쓰기 도우미다. 사용자의 요청대로 문서 본문을 HTML로 쓰거나 고친다.
사용 가능한 태그: h1, h2, h3, p, ul, ol, li, table, tr, th, td, b, i, u, blockquote, hr. style 속성은 text-align, color, background-color, font-size만 쓴다. img, script, style 태그는 쓰지 않는다.
mode: replace = html로 문서 전체를 바꾼다 (기존 문서를 고쳐 달라는 요청이면 고친 전체 문서를 돌려준다), append = html을 문서 끝에 덧붙인다, none = 문서는 두고 reply로만 답한다.
분량 요청(예: A4 2쪽)이 있으면 그에 맞춘다. 한국어 문서는 자연스러운 한국어 문체로 쓴다. reply는 무엇을 했는지 한두 문장. title은 문서에 어울리는 짧은 제목.`,
    aiSchema: obj({ reply: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append', 'none'] }, html: { type: 'string' }, title: { type: 'string' } }),
    serialize: () => { const cl = paper.cloneNode(true); cl.querySelectorAll('img').forEach(i => i.replaceWith('[그림]')); return cl.innerHTML.trim() || '(빈 문서)'; },
    snapshot: () => paper.innerHTML,
    restore: html => { paper.innerHTML = html; changed(); },
    apply: r => { const clean = sanitize(r.html || ''); if (r.mode === 'replace') paper.innerHTML = clean; else if (r.mode === 'append') paper.insertAdjacentHTML('beforeend', clean); changed(); },
    destroy: () => document.removeEventListener('selectionchange', onSel),
  };
  return api;
}
