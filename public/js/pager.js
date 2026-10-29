// pager.js — one tab made of pages side by side: swipe (finger or mouse) or tap the big titles on top to move
// between them. Used where tabs were folded together: 할 일 · 루틴, 시간표 · 캘린더, 뽀모도로 · 파워냅, 건강.
import { h } from './core.js';

const GAP = 40; // px between pages, so a neighbour's edge never peeks in

// pages: [{ id, title, render(el) }]. The address follows the page: #<base> for the first, #<base>/<id> after.
export function pager(ctx, pages, { start = 0, base } = {}) {
  let cur = -1;
  const titles = pages.map((p, i) => h('button', { class: 'pg-title', role: 'tab', type: 'button', onclick: () => show(i) }, p.title));
  const head = h('h1', { class: 'pg-titles', role: 'tablist' }, titles);
  const bodies = pages.map(() => h('div', { class: 'pg-page' }));
  const track = h('div', { class: 'pg-track', style: { gap: GAP + 'px' } }, bodies);
  const view = h('div', { class: 'pg-view' }, track);
  const el = h('div', { class: 'pg' }, head, view);
  pages.forEach((p, i) => p.render(bodies[i]));

  // as tall as the page you're on, so a long neighbour doesn't leave empty space below a short one
  const fit = () => { if (bodies[cur]) view.style.height = bodies[cur].offsetHeight + 'px'; };
  const ro = new ResizeObserver(fit);
  bodies.forEach(b => ro.observe(b));
  ctx.cleanup(() => ro.disconnect());

  const place = (dx = 0) => { track.style.transform = `translateX(calc(${-cur} * (100% + ${GAP}px) + ${dx}px))`; };
  function show(i, { instant = false } = {}) {
    i = Math.max(0, Math.min(pages.length - 1, i));
    const same = i === cur;
    cur = i;
    if (instant) { track.style.transition = 'none'; requestAnimationFrame(() => requestAnimationFrame(() => { track.style.transition = ''; })); }
    place();
    titles.forEach((t, j) => { t.classList.toggle('on', j === i); t.setAttribute('aria-selected', String(j === i)); });
    bodies.forEach((b, j) => { b.inert = j !== i; });
    fit();
    if (same) return;
    // the first show keeps the address it was opened with (it may carry a date)
    if (base && !instant) history.replaceState(null, '', `#${base}${i ? '/' + pages[i].id : ''}`);
    // after the router has set the tab's own title
    requestAnimationFrame(() => { const vt = document.getElementById('view-title'); if (vt) vt.textContent = pages[i].title; });
    // the other page may be shorter: bring its top into view when we were scrolled far down
    const scroller = document.getElementById('view');
    if (!instant && scroller && head.getBoundingClientRect().bottom < 0) scroller.scrollTo({ top: 0, behavior: 'smooth' });
    pages[i].onShow?.();
  }

  // swiping: sideways drags move the pages; up-and-down stays native scrolling. Drags that start on
  // something that moves sideways by itself (inputs, a month grid, a wide table) are left to it.
  const scrollsX = t => { for (let n = t; n && n !== view; n = n.parentElement) { if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true; } return false; };
  let drag = null;
  view.addEventListener('pointerdown', e => {
    if (e.button > 0 || e.target.closest('input, select, textarea, [contenteditable="true"], [data-noswipe], .popo-holder') || scrollsX(e.target)) return;
    drag = { x: e.clientX, y: e.clientY, t: Date.now(), on: false, dead: false };
  });
  const move = e => {
    if (!drag || drag.dead) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag.dead = true; return; }
      if (Math.abs(dx) < 10) return;
      drag.on = true; track.classList.add('dragging'); getSelection().removeAllRanges();
    }
    const edge = (cur === 0 && dx > 0) || (cur === pages.length - 1 && dx < 0);
    place(edge ? dx / 3 : dx);
  };
  const end = e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.on) return;
    track.classList.remove('dragging');
    if (e.type === 'pointercancel') { show(cur); return; }
    const dx = e.clientX - d.x, fast = Math.abs(dx) / Math.max(1, Date.now() - d.t) > 0.5;
    show(Math.abs(dx) > view.clientWidth * 0.18 || fast ? cur + (dx < 0 ? 1 : -1) : cur);
    // the swipe shouldn't also count as a tap on whatever it started on
    const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
    view.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => view.removeEventListener('click', stop, { capture: true }), 50);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  ctx.cleanup(() => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); });

  show(start, { instant: true });
  return { el, show, current: () => cur, body: i => bodies[i] };
}
