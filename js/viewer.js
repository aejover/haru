// viewer.js — full-screen image viewer: wheel / pinch / buttons to zoom, drag to move, double-tap to zoom in & out,
// and a download button for every picture.
import { h, icon, saveImage } from './core.js';

export function openViewer(src, { alt = '', onDownload = () => saveImage(src, alt || '이미지') } = {}) {
  let scale = 1, x = 0, y = 0;
  const img = h('img', { src, alt, draggable: 'false', class: 'viewer-img' });
  const stage = h('div', { class: 'viewer-stage' }, img);
  const pct = h('span', { class: 'num viewer-pct' }, '100%');
  const apply = (smooth = false) => {
    img.style.transition = smooth ? 'transform .35s var(--ease)' : 'none';
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    pct.textContent = Math.round(scale * 100) + '%';
  };
  // zoom keeping the point under the cursor/fingers in place
  const zoomAt = (next, cx, cy, smooth) => {
    next = Math.min(8, Math.max(1, next));
    const r = stage.getBoundingClientRect();
    const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
    x = px - ((px - x) * next) / scale; y = py - ((py - y) * next) / scale;
    scale = next;
    if (scale === 1) { x = 0; y = 0; }
    apply(smooth);
  };
  const center = () => { const r = stage.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

  stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(scale * Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY); }, { passive: false });
  const pts = new Map();
  let last = null, pinch = null, lastTap = 0;
  stage.addEventListener('pointerdown', e => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: scale }; last = null; }
    else { last = [e.clientX, e.clientY]; }
    const now = Date.now();
    if (pts.size === 1 && now - lastTap < 300) zoomAt(scale > 1.2 ? 1 : 2.5, e.clientX, e.clientY, true);
    lastTap = now;
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      zoomAt(pinch.s * (Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    } else if (last && scale > 1) {
      x += e.clientX - last[0]; y += e.clientY - last[1]; last = [e.clientX, e.clientY]; apply();
    }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; last = pts.size === 1 ? [...pts.values()][0] : null; };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  const close = () => { document.removeEventListener('keydown', key); wrap.classList.add('out'); setTimeout(() => wrap.remove(), 250); };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === '+' || e.key === '=') zoomAt(scale * 1.4, ...center(), true); if (e.key === '-') zoomAt(scale / 1.4, ...center(), true); };
  document.addEventListener('keydown', key);
  const btn = (ic, label, fn) => h('button', { class: 'btn-icon', 'aria-label': label, title: label, onclick: fn }, icon(ic, 18));
  const wrap = h('div', { class: 'viewer', role: 'dialog', 'aria-label': '이미지 보기' }, stage,
    h('div', { class: 'viewer-bar glass' },
      btn('minus', '축소', () => zoomAt(scale / 1.5, ...center(), true)), pct, btn('plus', '확대', () => zoomAt(scale * 1.5, ...center(), true)),
      h('button', { class: 'btn btn-ghost btn-sm', onclick: () => zoomAt(1, ...center(), true) }, '맞춤'),
      onDownload ? btn('download', '다운로드', onDownload) : null,
      btn('x', '닫기', close)),
    h('div', { class: 'viewer-hint tiny' }, '휠·두 손가락으로 확대, 끌어서 이동, 두 번 눌러 확대/원래대로'));
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('in'));
}
