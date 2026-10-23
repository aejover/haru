// util.js — helpers shared by the document editors.
import { h, icon } from '../core.js';

const loaded = {};
// Load a UMD library once, trying mirrors in order.
export function loadScript(urls) {
  const key = urls[0];
  loaded[key] ||= (async () => {
    for (const u of urls) {
      try {
        await new Promise((res, rej) => { const s = document.createElement('script'); s.src = u; s.onload = res; s.onerror = rej; document.head.append(s); });
        return;
      } catch { /* try next mirror */ }
    }
    delete loaded[key];
    throw new Error('필요한 도구를 불러오지 못했어요. 인터넷 연결을 확인하세요.');
  })();
  return loaded[key];
}
export const LIBS = {
  xlsx: ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'],
  pptx: ['https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js', 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'],
  qr: ['https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js'],
  mammoth: ['https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js', 'https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js'],
};

const ALLOWED = new Set(['P', 'DIV', 'BR', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'HR', 'A', 'IMG', 'FONT', 'MARK', 'CODE', 'PRE', 'COLGROUP', 'COL']);
const ATTRS = new Set(['style', 'href', 'src', 'alt', 'colspan', 'rowspan', 'color', 'face', 'size', 'class', 'width']);
// Keep document markup, drop anything that could run code.
export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstChild;
  const walk = node => {
    [...node.children].forEach(el => {
      if (!ALLOWED.has(el.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META'].includes(el.tagName)) el.remove();
        else { walk(el); el.replaceWith(...el.childNodes); }
        return;
      }
      [...el.attributes].forEach(a => {
        const v = a.value.trim().toLowerCase();
        if (!ATTRS.has(a.name) || ((a.name === 'href' || a.name === 'src') && v.startsWith('javascript:')) || (a.name === 'style' && /expression|url\(/.test(v))) el.removeAttribute(a.name);
      });
      walk(el);
    });
  };
  walk(root);
  return root.innerHTML;
}
export async function inlineImages(root) {
  for (const img of root.querySelectorAll('img')) {
    if (img.src.startsWith('data:')) continue;
    try {
      const b = await (await fetch(img.src)).blob();
      img.src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    } catch { /* keep the link */ }
  }
}
export const safeName = s => (s || '문서').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || '문서';

// Toolbar pieces
export const tb = (ic, label, onClick, { title, text } = {}) =>
  h('button', { class: 'tb', title: title || label, 'aria-label': label, onmousedown: e => e.preventDefault(), onclick: onClick }, ic ? icon(ic, 17) : null, text ? h('span', { class: 'lb' }, text) : null);
export const group = (...kids) => h('div', { class: 'rgroup' }, ...kids);
export function colorBtn(ic, label, value, onPick) {
  const bar = h('i', { class: 'bar-c', style: { background: value } });
  const inp = h('input', { type: 'color', value, 'aria-label': label, oninput: e => { bar.style.background = e.target.value; onPick(e.target.value); } });
  return h('span', { class: 'tb tb-color', title: label }, icon(ic, 17), bar, inp);
}
export function ribbon(tabs) {
  const body = h('div', { class: 'ribbon-body' });
  const btns = tabs.map(([name, build], i) => h('button', { class: i === 0 ? 'on' : '', onclick: () => show(i) }, name));
  function show(i) { btns.forEach((b, j) => b.classList.toggle('on', i === j)); body.replaceChildren(tabs[i][1]()); }
  show(0);
  return h('div', { class: 'ribbon glass' }, h('div', { class: 'ribbon-tabs' }, btns), body);
}
