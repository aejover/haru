// slides.js — PPT 편집기: 슬라이드 목록, 960×540 무대, 텍스트·그림·도형, 테마, 발표 모드, pptx 저장.
import { h, icon, uid, toast, modal, upload, pickFiles, download, obj, apiUrl } from '../core.js';
import { loadScript, LIBS, sanitize, safeName, tb, group, colorBtn } from './util.js';

const W = 960, H = 540;
// Templates: colours plus a few quiet shapes per slide kind (marked deco, kept behind the text, swapped
// when the template changes). Every colour is plain hex so the .pptx export matches the screen.
const R = (x, y, w, hh, fill, radius = 0) => ({ type: 'rect', x, y, w, h: hh, fill, radius });
const O = (x, y, w, hh, fill) => ({ type: 'ellipse', x, y, w, h: hh, fill });
const THEMES = {
  white: { name: '미니멀 화이트', bg: '#ffffff', fg: '#141416', sub: '#6b6c70', accent: '#141416',
    deco: { title: [R(450, 140, 60, 4, '#141416')], content: [R(60, 118, 44, 4, '#141416')], section: [] } },
  black: { name: '모던 블랙', bg: '#121214', fg: '#f4f4f2', sub: '#a4a5aa', accent: '#f4f4f2',
    deco: { title: [R(60, 470, 840, 1, '#3a3a3e'), O(866, 452, 36, 36, '#f4f4f2')], content: [R(60, 118, 44, 4, '#f4f4f2'), R(60, 500, 840, 1, '#2c2c30')], section: [R(0, 0, 14, 540, '#f4f4f2')] } },
  gray: { name: '그레이', bg: '#ececea', fg: '#18181a', sub: '#6b6c70', accent: '#18181a', deco: { title: [], content: [], section: [] } },
  beige: { name: '소프트 베이지', bg: '#f6f1e9', fg: '#2e2a25', sub: '#8a8075', accent: '#c9a27e',
    deco: { title: [O(640, 300, 420, 420, '#ece2d3'), O(-120, -160, 320, 320, '#efe6d9'), R(450, 140, 60, 4, '#c9a27e')], content: [O(820, -80, 220, 220, '#efe6d9'), R(60, 118, 44, 4, '#c9a27e')], section: [O(560, 120, 520, 520, '#ece2d3')] } },
  blue: { name: '클린 블루', bg: '#f5f8fd', fg: '#15233c', sub: '#66748c', accent: '#3d6fe0',
    deco: { title: [R(0, 0, 960, 12, '#3d6fe0'), R(820, 400, 90, 90, '#dbe6fb', 18), R(870, 450, 40, 40, '#3d6fe0', 10)], content: [R(0, 0, 960, 6, '#3d6fe0'), R(60, 118, 44, 4, '#3d6fe0')], section: [R(0, 0, 480, 540, '#3d6fe0')] } },
  forest: { name: '포레스트', bg: '#1e3a2f', fg: '#f4f1e8', sub: '#b6c3b5', accent: '#d8b26a',
    deco: { title: [R(40, 40, 70, 3, '#d8b26a'), R(40, 40, 3, 70, '#d8b26a'), R(850, 497, 70, 3, '#d8b26a'), R(917, 430, 3, 70, '#d8b26a')], content: [R(60, 118, 44, 4, '#d8b26a')], section: [R(80, 230, 6, 150, '#d8b26a')] } },
  coral: { name: '코랄 팝', bg: '#fff5ef', fg: '#2a1f1b', sub: '#8c756c', accent: '#ff6f4e',
    deco: { title: [R(0, 0, 22, 540, '#ff6f4e'), O(760, 60, 140, 140, '#ffd9cc'), O(840, 140, 60, 60, '#ff6f4e')], content: [R(0, 0, 10, 540, '#ff6f4e'), R(60, 118, 44, 4, '#ff6f4e')], section: [O(-180, 140, 460, 460, '#ffd9cc')] } },
  lavender: { name: '라벤더', bg: '#f4f1fb', fg: '#241e36', sub: '#7b7394', accent: '#8b6fd6',
    deco: { title: [O(-140, -140, 420, 420, '#e6defa'), O(780, 360, 260, 260, '#ece6fb'), O(140, 120, 22, 22, '#8b6fd6')], content: [O(860, -60, 180, 180, '#e6defa'), R(60, 118, 44, 4, '#8b6fd6')], section: [O(600, -80, 480, 480, '#e6defa')] } },
  navy: { name: '네이비 골드', bg: '#1d2b44', fg: '#f3f5f9', sub: '#b7c2d6', accent: '#f2c230',
    deco: { title: [R(430, 140, 100, 4, '#f2c230'), R(0, 524, 960, 16, '#f2c230')], content: [R(60, 118, 44, 4, '#f2c230')], section: [] } },
  mono: { name: '모노 그리드', bg: '#f2f2f0', fg: '#111113', sub: '#6d6e72', accent: '#111113',
    deco: { title: [R(60, 60, 120, 120, '#111113'), R(780, 360, 120, 120, '#ffffff'), R(820, 400, 80, 80, '#111113')], content: [R(860, 40, 40, 40, '#111113'), R(60, 118, 44, 4, '#111113')], section: [R(0, 0, 480, 540, '#111113')] } },
};
// a slide's decoration for its template; section slides on a dark block get light text
function decoFor(theme, kind) { return ((THEMES[theme] || THEMES.white).deco?.[kind] || []).map(d => ({ id: uid(), deco: true, ...d })); }
const SECTION_ON_BLOCK = { blue: true, mono: true };
const FONT = '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif';

function textEl(x, y, w, hgt, html, size, extra = {}) { return { id: uid(), type: 'text', x, y, w, h: hgt, html, size, bold: false, align: 'left', ...extra }; }
function layout(kind, theme, d = {}) {
  const t = THEMES[theme] || THEMES.white;
  const els = decoFor(theme, kind);
  if (kind === 'title') {
    els.push(textEl(80, 170, 800, 120, d.title || '제목을 입력하세요', 54, { bold: true, align: 'center', color: t.fg }));
    els.push(textEl(120, 300, 720, 70, d.subtitle || '부제목', 26, { align: 'center', color: t.sub }));
  } else if (kind === 'section') {
    const onBlock = SECTION_ON_BLOCK[theme];
    if (!onBlock) els.push({ id: uid(), type: 'rect', x: 80, y: 250, w: 80, h: 6, fill: t.accent });
    els.push(textEl(onBlock ? 60 : 76, 270, onBlock ? 380 : 800, 110, d.title || '구역 제목', 48, { bold: true, color: onBlock ? t.bg : t.fg }));
  } else if (kind === 'content') {
    els.push(textEl(60, 40, 840, 80, d.title || '제목', 38, { bold: true, color: t.fg }));
    const items = d.bullets?.length ? d.bullets : ['첫 번째 내용', '두 번째 내용', '세 번째 내용'];
    els.push(textEl(70, 140, 820, 360, `<ul>${items.map(b => `<li>${b.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</li>`).join('')}</ul>`, 26, { color: t.fg }));
  }
  return { id: uid(), kind, bg: t.bg, els, notes: d.notes || '' };
}

function renderSlide(s, { interactive = false, selected } = {}) {
  const stage = h('div', { class: 'stage', style: { background: s.bg, fontFamily: FONT } });
  s.els.forEach(e => {
    const st = { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px' };
    let el;
    if (e.type === 'text') el = h('div', { class: 'sl-el text', style: { ...st, fontSize: e.size + 'px', color: e.color || '#111', fontWeight: e.bold ? '700' : '400', fontStyle: e.italic ? 'italic' : '', textAlign: e.align || 'left' }, html: sanitize(e.html) });
    else if (e.type === 'image') el = h('div', { class: 'sl-el image', style: st }, h('img', { src: e.src, alt: '' }));
    else el = h('div', { class: 'sl-el shape', style: { ...st, background: e.fill || '#ccc', borderRadius: e.type === 'ellipse' ? '50%' : (e.radius || 0) + 'px' } });
    el.dataset.id = e.id;
    if (interactive && selected === e.id) { el.classList.add('sel'); el.append(h('span', { class: 'sl-handle', 'data-handle': '1' })); }
    stage.append(el);
  });
  return stage;
}

export function mountSlides(host, doc, { onChange }) {
  const c = doc.content ||= { theme: 'white', slides: [] };
  if (!c.slides.length) c.slides.push(layout('title', c.theme));
  let cur = 0, selId = null, editingId = null, scale = 1;
  const thumbs = h('div', { class: 'thumbs' });
  const box = h('div', { class: 'stage-box' });
  const stageWrap = h('div', { class: 'stage-wrap' }, box);
  const notes = h('textarea', { class: 'textarea', style: { minHeight: '70px' }, placeholder: '발표자 메모', 'aria-label': '발표자 메모', oninput: () => { slide().notes = notes.value; onChange(); } });
  const toolbar = h('div', { class: 'ribbon glass' }, h('div', { class: 'ribbon-body', style: { background: 'transparent' } }));
  const slide = () => c.slides[cur];
  const selEl = () => slide()?.els.find(e => e.id === selId);
  const changed = () => { onChange(); paintThumbs(); };

  function paintThumbs() {
    thumbs.replaceChildren(c.slides.map((s, i) => {
      const t = h('button', { class: 'thumb' + (i === cur ? ' on' : ''), 'aria-label': `슬라이드 ${i + 1}`, onclick: () => go(i), draggable: 'true' }, h('span', { class: 'n' }, i + 1));
      const mini = renderSlide(s); mini.classList.add('mini'); t.append(mini);
      requestAnimationFrame(() => { mini.style.transform = `scale(${t.clientWidth / W})`; });
      t.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', String(i)));
      t.addEventListener('dragover', e => e.preventDefault());
      t.addEventListener('drop', e => { e.preventDefault(); const from = +e.dataTransfer.getData('text/plain'); if (from === i) return; const [m] = c.slides.splice(from, 1); c.slides.splice(i, 0, m); cur = i; paint(); changed(); });
      return t;
    }), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => addSlide('content') }, icon('plus', 14), '슬라이드'));
  }
  function paintStage() {
    const st = renderSlide(slide(), { interactive: true, selected: selId });
    st.style.transform = `scale(${scale})`;
    box.replaceChildren(st);
    st.addEventListener('pointerdown', onDown);
    st.addEventListener('dblclick', onDbl);
    notes.value = slide().notes || '';
  }
  function paintToolbar() {
    const e = selEl();
    const t = THEMES[c.theme];
    const body = toolbar.firstChild;
    body.replaceChildren(
      group(h('select', { class: 'tb-select', 'aria-label': '새 슬라이드', onchange: ev => { if (ev.target.value) addSlide(ev.target.value); ev.target.value = ''; } },
        h('option', { value: '' }, '+ 새 슬라이드'), h('option', { value: 'title' }, '제목 슬라이드'), h('option', { value: 'content' }, '제목 + 내용'), h('option', { value: 'section' }, '구역 머리글'), h('option', { value: 'blank' }, '빈 화면')),
        tb('copy', '슬라이드 복제', () => { const cp = JSON.parse(JSON.stringify(slide())); cp.id = uid(); cp.els.forEach(x => { x.id = uid(); }); c.slides.splice(cur + 1, 0, cp); go(cur + 1); changed(); }),
        tb('trash', '슬라이드 삭제', () => { if (c.slides.length === 1) { toast('슬라이드가 하나뿐이에요.'); return; } c.slides.splice(cur, 1); go(Math.max(0, cur - 1)); changed(); })),
      group(tb('text', '텍스트 상자', () => addEl(textEl(300, 220, 360, 80, '텍스트를 입력하세요', 28, { color: t.fg })), { text: '텍스트' }),
        tb('image', '그림', addImage, { text: '그림' }),
        tb('square', '사각형', () => addEl({ id: uid(), type: 'rect', x: 380, y: 200, w: 200, h: 140, fill: t.accent, radius: 12 })),
        tb('circle', '원', () => addEl({ id: uid(), type: 'ellipse', x: 400, y: 190, w: 160, h: 160, fill: t.accent }))),
      e?.type === 'text' ? group(
        h('select', { class: 'tb-select', 'aria-label': '글자 크기', style: { width: '74px' }, onchange: ev => { e.size = +ev.target.value; refresh(); } }, [14, 16, 18, 20, 24, 28, 32, 38, 44, 54, 64, 80, 96].map(s => h('option', { value: s, selected: s === e.size }, s))),
        h('button', { class: 'tb' + (e.bold ? ' on' : ''), 'aria-label': '굵게', onclick: () => { e.bold = !e.bold; refresh(); } }, icon('bold', 17)),
        h('button', { class: 'tb' + (e.italic ? ' on' : ''), 'aria-label': '기울임', onclick: () => { e.italic = !e.italic; refresh(); } }, icon('italic', 17)),
        colorBtn('text', '글자 색', e.color || t.fg, v => { e.color = v; refresh(); }),
        tb('alignL', '왼쪽', () => { e.align = 'left'; refresh(); }), tb('alignC', '가운데', () => { e.align = 'center'; refresh(); }), tb('alignR', '오른쪽', () => { e.align = 'right'; refresh(); }),
        tb('list', '글머리 기호', () => { toggleBullets(e); refresh(); })) : null,
      e && (e.type === 'rect' || e.type === 'ellipse') ? group(colorBtn('fill', '채우기 색', e.fill || '#cccccc', v => { e.fill = v; refresh(); })) : null,
      // place the selected text box, picture or shape on the slide
      e ? group(
        tb('posL', '슬라이드 왼쪽에 맞추기', () => { e.x = 0; refresh(); }),
        tb('posC', '슬라이드 가운데에 맞추기', () => { e.x = Math.round((W - e.w) / 2); refresh(); }),
        tb('posR', '슬라이드 오른쪽에 맞추기', () => { e.x = Math.round(W - e.w); refresh(); }),
        tb('posT', '슬라이드 위쪽에 맞추기', () => { e.y = 0; refresh(); }),
        tb('posM', '슬라이드 중간에 맞추기', () => { e.y = Math.round((H - e.h) / 2); refresh(); }),
        tb('posB', '슬라이드 아래쪽에 맞추기', () => { e.y = Math.round(H - e.h); refresh(); })) : null,
      e ? group(tb('front', '맨 앞으로', () => { const a = slide().els; a.push(...a.splice(a.indexOf(e), 1)); refresh(); }), tb('back', '맨 뒤로', () => { const a = slide().els; a.unshift(...a.splice(a.indexOf(e), 1)); refresh(); }),
        tb('x', '요소 삭제 (Delete)', () => { slide().els = slide().els.filter(x => x !== e); selId = null; refresh(); })) : null,
      group(colorBtn('palette', '배경색', slide().bg, v => { slide().bg = v; refresh(); }),
        h('button', { class: 'btn btn-glass btn-sm', title: '템플릿 고르기', onclick: pickTemplate }, icon('sparkle', 15), `템플릿 · ${(THEMES[c.theme] || THEMES.white).name}`)),
      group(h('button', { class: 'btn btn-ink btn-sm', onclick: present }, icon('present', 15), '발표하기')));
  }
  function refresh() { paintStage(); paintToolbar(); changed(); }
  function paint() { paintThumbs(); paintStage(); paintToolbar(); }
  function go(i) { cur = Math.max(0, Math.min(c.slides.length - 1, i)); selId = null; paint(); }
  function addSlide(kind) { c.slides.splice(cur + 1, 0, layout(kind, c.theme)); go(cur + 1); changed(); }
  function addEl(e) { slide().els.push(e); selId = e.id; refresh(); }
  async function addImage() {
    const [f] = await pickFiles({ accept: 'image/*' }); if (!f) return;
    try {
      const up = await upload(f);
      const img = new Image(); img.src = apiUrl(up.url); await img.decode().catch(() => {});
      const r = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 4 / 3;
      const w = r > 1 ? 480 : 320 * r, hh = r > 1 ? 480 / r : 320;
      addEl({ id: uid(), type: 'image', x: (W - w) / 2, y: (H - hh) / 2, w, h: hh, src: up.url });
    } catch (e) { toast(e.message); }
  }
  function toggleBullets(e) {
    const d = h('div', { html: e.html });
    if (d.querySelector('li')) e.html = [...d.querySelectorAll('li')].map(li => li.innerHTML).join('<br>');
    else e.html = `<ul>${d.innerHTML.split(/<br\s*\/?>|<\/div>|<\/p>/i).map(x => x.replace(/<\/?(div|p)>/gi, '').trim()).filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ul>`;
  }
  // switch the whole deck to another template: colours follow, the old decoration goes, the new one comes in
  function applyTheme(key) {
    const oldKey = c.theme, old = THEMES[oldKey] || THEMES.white, t = THEMES[key];
    c.theme = key;
    c.slides.forEach(s => {
      if (s.bg === old.bg) s.bg = t.bg;
      s.els = s.els.filter(e => !e.deco);
      const block = s.kind === 'section' && SECTION_ON_BLOCK[key], wasBlock = s.kind === 'section' && SECTION_ON_BLOCK[oldKey];
      s.els.forEach(e => {
        if (e.type === 'text') e.color = e.color === old.sub ? t.sub : e.color === old.fg || !e.color || (wasBlock && e.color === old.bg) ? (block ? t.bg : t.fg) : e.color;
        if ((e.type === 'rect' || e.type === 'ellipse') && e.fill === old.accent) e.fill = t.accent;
      });
      // a section title sits inside the coloured block on templates that have one
      const head = s.kind === 'section' && s.els.find(e => e.type === 'text');
      if (head && block !== wasBlock) Object.assign(head, block ? { x: 60, w: 380 } : { x: 76, w: 800 });
      if (s.kind) s.els.unshift(...decoFor(key, s.kind));
    });
    refresh();
  }
  // template gallery: each template's cover, drawn small
  function pickTemplate() {
    const PW = 208;
    const m = modal({
      title: '템플릿', wide: true,
      body: h('div', { class: 'col' },
        h('p', { class: 'small muted', style: { margin: 0 } }, '고르면 모든 슬라이드의 색과 장식이 바뀌어요. 내용은 그대로예요.'),
        h('div', { class: 'tpl-grid' }, Object.entries(THEMES).map(([k, v]) => {
          const st = renderSlide(layout('title', k, { title: v.name, subtitle: '제목 슬라이드' }));
          Object.assign(st.style, { transform: `scale(${PW / W})`, transformOrigin: '0 0', position: 'absolute', left: 0, top: 0 });
          return h('button', { class: 'tpl' + (k === c.theme ? ' on' : ''), type: 'button', onclick: () => { applyTheme(k); m.close(); toast(`"${v.name}" 템플릿을 입혔어요.`); } },
            h('span', { class: 'tpl-pv', style: { width: PW + 'px', height: (PW * H) / W + 'px' } }, st), h('span', { class: 'tpl-name' }, v.name));
        }))),
    });
  }

  // ----- direct manipulation -----
  function onDown(ev) {
    const target = ev.target.closest('.sl-el');
    if (editingId && target?.dataset.id === editingId) return;
    finishText();
    if (!target) { selId = null; paintStage(); paintToolbar(); return; }
    const e = slide().els.find(x => x.id === target.dataset.id);
    const resizing = ev.target.dataset.handle;
    if (selId !== e.id) { selId = e.id; paintStage(); paintToolbar(); }
    ev.preventDefault();
    const x0 = ev.clientX, y0 = ev.clientY, sx = e.x, sy = e.y, sw = e.w, shh = e.h;
    let moved = false;
    const node = () => box.querySelector(`[data-id="${e.id}"]`);
    // dragging near the slide's center line (left–right) or middle line (top–bottom) catches there, with a guide
    const SNAP = 10;
    const stage = box.querySelector('.stage');
    const guideV = h('i', { class: 'sl-guide v', style: { left: W / 2 + 'px' } }), guideH = h('i', { class: 'sl-guide h', style: { top: H / 2 + 'px' } });
    const move = m => {
      const dx = (m.clientX - x0) / scale, dy = (m.clientY - y0) / scale;
      if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
      if (resizing) { e.w = Math.max(20, sw + dx); e.h = Math.max(20, m.shiftKey && e.type !== 'text' ? (sw + dx) * (shh / sw) : shh + dy); }
      else {
        e.x = Math.round(sx + dx); e.y = Math.round(sy + dy);
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        const snapX = !m.altKey && Math.abs(cx - W / 2) < SNAP, snapY = !m.altKey && Math.abs(cy - H / 2) < SNAP;
        if (snapX) e.x = Math.round((W - e.w) / 2);
        if (snapY) e.y = Math.round((H - e.h) / 2);
        if (snapX) stage.append(guideV); else guideV.remove();
        if (snapY) stage.append(guideH); else guideH.remove();
      }
      const n = node(); if (n) Object.assign(n.style, { left: e.x + 'px', top: e.y + 'px', width: e.w + 'px', height: e.h + 'px' });
    };
    const up = () => { guideV.remove(); guideH.remove(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) changed(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function onDbl(ev) {
    const target = ev.target.closest('.sl-el.text'); if (!target) return;
    editingId = target.dataset.id;
    target.contentEditable = 'true'; target.focus();
    const r = document.createRange(); r.selectNodeContents(target); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    target.addEventListener('blur', finishText, { once: true });
  }
  function finishText() {
    if (!editingId) return;
    const n = box.querySelector(`[data-id="${editingId}"]`);
    const e = slide().els.find(x => x.id === editingId);
    editingId = null;
    if (n && e) { e.html = sanitize(n.innerHTML); n.contentEditable = 'false'; changed(); }
  }
  function onKey(ev) {
    if (editingId || !selId || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    if (!host.isConnected) return;
    const e = selEl(); if (!e) return;
    const step = ev.shiftKey ? 10 : 1;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); slide().els = slide().els.filter(x => x !== e); selId = null; refresh(); }
    else if (ev.key.startsWith('Arrow')) {
      ev.preventDefault();
      if (ev.key === 'ArrowLeft') e.x -= step; if (ev.key === 'ArrowRight') e.x += step; if (ev.key === 'ArrowUp') e.y -= step; if (ev.key === 'ArrowDown') e.y += step;
      paintStage(); changed();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') { ev.preventDefault(); const cp = { ...JSON.parse(JSON.stringify(e)), id: uid(), x: e.x + 20, y: e.y + 20 }; addEl(cp); }
  }
  document.addEventListener('keydown', onKey);

  // ----- present mode -----
  function present() {
    finishText();
    let i = cur;
    const pc = h('div', { class: 'pcount' });
    const ov = h('div', { class: 'present', tabindex: '0' });
    const show = () => {
      const st = renderSlide(c.slides[i]);
      const sc = Math.min(innerWidth / W, innerHeight / H);
      st.style.transform = `scale(${sc})`; st.style.transformOrigin = 'center'; st.style.position = 'relative';
      ov.replaceChildren(st, pc); pc.textContent = `${i + 1} / ${c.slides.length} · Esc로 종료`;
    };
    const close = () => { document.removeEventListener('keydown', key); window.removeEventListener('resize', show); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); ov.remove(); go(i); };
    const key = e => {
      if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); if (i < c.slides.length - 1) { i++; show(); } else close(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); if (i > 0) { i--; show(); } }
      else if (e.key === 'Escape') close();
    };
    ov.addEventListener('click', () => { if (i < c.slides.length - 1) { i++; show(); } else close(); });
    document.addEventListener('keydown', key);
    window.addEventListener('resize', show);
    document.body.append(ov); show(); ov.focus();
    ov.requestFullscreen?.().catch(() => {});
    document.addEventListener('fullscreenchange', function fc() { if (!document.fullscreenElement && ov.isConnected) { document.removeEventListener('fullscreenchange', fc); close(); } });
  }

  // ----- layout -----
  const ro = new ResizeObserver(() => { scale = box.clientWidth / W; const st = box.firstChild; if (st) st.style.transform = `scale(${scale})`; paintThumbScale(); });
  function paintThumbScale() { thumbs.querySelectorAll('.thumb').forEach(t => { const m = t.querySelector('.mini'); if (m) m.style.transform = `scale(${t.clientWidth / W})`; }); }
  ro.observe(box);
  host.append(toolbar, h('div', { class: 'slides-layout' }, thumbs, h('div', { class: 'col', style: { gap: '10px', minWidth: 0 } }, stageWrap, notes)),
    h('div', { class: 'statusbar' }, h('span', null, '두 번 눌러 글자 편집 · 끌어서 이동 · 모서리로 크기 조절 · Delete 삭제 · Ctrl+D 복제')));
  scale = box.clientWidth / W || 0.8;
  paint();

  // ----- export -----
  const toText = html => {
    const d = h('div', { html });
    const lis = [...d.querySelectorAll('li')];
    if (lis.length) return lis.map(li => ({ text: li.textContent, options: { bullet: true, breakLine: true } }));
    return d.innerHTML.split(/<br\s*\/?>|<\/div>|<\/p>/i).map(x => h('div', { html: x }).textContent).filter((x, i, a) => x || i < a.length - 1).map(x => ({ text: x, options: { breakLine: true } }));
  };
  async function exportPPTX() {
    await loadScript(LIBS.pptx);
    const pres = new window.PptxGenJS();
    pres.layout = 'LAYOUT_16x9';
    pres.title = doc.title;
    const inch = px => px / 96;
    for (const s of c.slides) {
      const sl = pres.addSlide();
      sl.background = { color: s.bg.replace('#', '') };
      for (const e of s.els) {
        const pos = { x: inch(e.x), y: inch(e.y), w: inch(e.w), h: inch(e.h) };
        if (e.type === 'text') sl.addText(toText(e.html), { ...pos, fontSize: Math.round(e.size * 0.75), color: (e.color || '#111111').replace('#', ''), bold: !!e.bold, italic: !!e.italic, align: e.align || 'left', valign: 'top', fontFace: 'Malgun Gothic', margin: 6 });
        else if (e.type === 'image') {
          try { const b = await (await fetch(e.src)).blob(); const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); sl.addImage({ data, ...pos }); } catch { /* skip broken image */ }
        } else sl.addShape(e.type === 'ellipse' ? pres.ShapeType.ellipse : e.radius ? pres.ShapeType.roundRect : pres.ShapeType.rect, { ...pos, fill: { color: (e.fill || '#cccccc').replace('#', '') }, line: { type: 'none' }, rectRadius: e.radius ? 0.12 : undefined });
      }
      if (s.notes) sl.addNotes(s.notes);
    }
    await pres.writeFile({ fileName: safeName(doc.title) + '.pptx' });
  }

  const api = {
    exports: [
      { label: 'PowerPoint로 저장 (.pptx)', run: () => exportPPTX().catch(e => toast(e.message || '저장하지 못했어요.')) },
      { label: '발표하기 (전체 화면)', icon: 'present', run: present },
      { label: '슬라이드 개요 저장 (.txt)', run: () => download(new Blob([c.slides.map((s, i) => `[${i + 1}]\n` + s.els.filter(e => e.type === 'text').map(e => h('div', { html: e.html }).innerText).join('\n') + (s.notes ? `\n(메모) ${s.notes}` : '')).join('\n\n')], { type: 'text/plain;charset=utf-8' }), safeName(doc.title) + '.txt') },
    ],
    aiPlaceholder: '예: "환경 보호 주제로 발표 슬라이드 8장 만들어줘", "3번 슬라이드 더 간결하게"',
    aiHello: '발표 자료를 함께 만들어요. 주제와 장수, 발표 대상을 알려 주면 슬라이드를 만들어요. 자료 사진이나 PDF를 첨부해도 돼요.',
    aiSuggest: ['발표 슬라이드 6장 만들어줘', '각 슬라이드에 발표자 메모 추가', '마지막에 요약 슬라이드 추가', '내용을 더 짧고 굵직하게'],
    aiSystem: `너는 프레젠테이션 편집기 안의 도우미다. 사용자의 요청대로 슬라이드 목록을 만든다.
각 슬라이드: layout(title=표지, content=제목+글머리 목록, section=구역 머리글), title, subtitle(표지에서만, 아니면 빈 문자열), bullets(content에서 3~6개의 짧은 문장, 아니면 빈 배열), notes(발표자가 말할 내용 1~3문장).
mode: replace = slides로 전체 발표를 바꾼다 (기존 슬라이드를 고쳐 달라는 요청이면 고친 전체 목록을 돌려준다), append = slides를 끝에 추가, none = 슬라이드는 두고 reply로만 답한다.
슬라이드 글은 짧고 명확하게, 한 줄에 20자 안팎. reply는 무엇을 했는지 한두 문장 한국어로. title은 발표에 어울리는 짧은 제목.`,
    aiSchema: obj({ reply: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append', 'none'] }, title: { type: 'string' },
      slides: { type: 'array', items: obj({ layout: { type: 'string', enum: ['title', 'content', 'section'] }, title: { type: 'string' }, subtitle: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }) } }),
    serialize: () => c.slides.map((s, i) => `슬라이드 ${i + 1}:\n` + s.els.filter(e => e.type === 'text').map(e => '  ' + h('div', { html: e.html }).innerText.replace(/\n/g, ' / ')).join('\n') + (s.notes ? `\n  (메모) ${s.notes}` : '')).join('\n'),
    snapshot: () => JSON.stringify(c),
    restore: snap => { const o = JSON.parse(snap); c.slides = o.slides; c.theme = o.theme; go(Math.min(cur, c.slides.length - 1)); changed(); },
    apply: r => {
      if (!Array.isArray(r.slides) || !r.slides.length) return;
      const made = r.slides.map(d => layout(d.layout || 'content', c.theme, d));
      if (r.mode === 'replace') { c.slides = made; cur = 0; } else { c.slides.push(...made); cur = c.slides.length - made.length; }
      selId = null; paint(); changed();
    },
    relayout: () => setTimeout(() => { scale = box.clientWidth / W; paintStage(); paintThumbScale(); }, 50),
    destroy: () => { document.removeEventListener('keydown', onKey); ro.disconnect(); },
  };
  return api;
}
