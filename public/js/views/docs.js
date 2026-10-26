// docs.js — 문서 작업: 워드 · 한글 · 엑셀 · PPT, 계산기. 일반 모드(직접 편집)와 AI 모드(Claude에게 말하면 문서에 반영).
import { h, icon, store, commit, uid, toast, seg, confirmDialog, gainXP, ai, jsonOf, aiFail, fileToBlock, pickFiles, debounce, modal } from '../core.js';
import { calculator } from '../docs/calc.js';
import { mountWord } from '../docs/word.js';
import { mountSheet } from '../docs/sheet.js';
import { mountSlides } from '../docs/slides.js';

export const KINDS = {
  word: { label: 'Word', name: '워드 문서', badge: 'W', desc: '보고서, 자기소개서, 레포트. 글꼴·표·그림·쪽 설정까지.' },
  hwp: { label: '한글', name: '한글 문서', badge: '한', desc: '한글 문서 기본 서식(바탕 글꼴 10pt, 줄 간격 160%)으로 시작해요.' },
  excel: { label: 'Excel', name: '엑셀 시트', badge: 'X', desc: '수식(SUM, IF, VLOOKUP…), 서식, 정렬, 차트, xlsx 저장.' },
  ppt: { label: 'PowerPoint', name: '프레젠테이션', badge: 'P', desc: '슬라이드, 텍스트·그림·도형, 테마, 발표 모드, pptx 저장.' },
};
const MOUNT = { word: mountWord, hwp: mountWord, excel: mountSheet, ppt: mountSlides };

const timeAgo = t => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return '방금'; if (m < 60) return `${m}분 전`;
  const hr = Math.round(m / 60); if (hr < 24) return `${hr}시간 전`;
  return new Date(t).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
};

function newDoc(kind, ai = false) {
  const d = { id: uid(), kind, title: `제목 없는 ${KINDS[kind].name}`, content: null, ai, createdAt: Date.now(), updatedAt: Date.now() };
  store.s.docs.unshift(d); commit('docs');
  location.hash = `docs/${d.id}`;
}

function listView(el) {
  const docs = store.s.docs.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  el.append(
    h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '문서 작업'), h('span', { class: 'small muted' }, '일반 모드는 직접, AI 모드는 Claude에게 말로 시켜요')),
    h('div', { class: 'doc-new' }, Object.entries(KINDS).map(([k, v]) => h('div', { class: 'doc-kind glass' },
      h('span', { class: 'badge' }, v.badge), h('b', null, v.label), h('span', null, v.desc),
      h('div', { class: 'row', style: { marginTop: 'auto', gap: '6px' } },
        h('button', { class: 'btn btn-ink btn-sm grow', onclick: () => newDoc(k, false) }, '새로 만들기'),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Claude와 함께 쓰기', onclick: () => newDoc(k, true) }, icon('sparkle', 14), 'AI'))))),
    h('div', { class: 'doc-lower' },
      h('section', { class: 'glass card col' },
        h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '계산기'), h('span', { class: 'tiny muted' }, '키보드로도 입력돼요')),
        calculator()),
      h('section', { class: 'glass card col' },
      h('h2', { class: 'h2' }, '최근 문서'),
      docs.length ? h('div', null, docs.map(d => h('div', { class: 'row' },
        h('button', { class: 'doc-list-item', onclick: () => { location.hash = `docs/${d.id}`; } },
          h('span', { class: 'badge' }, KINDS[d.kind].badge),
          h('span', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'ell', style: { fontWeight: 600 } }, d.title), h('div', { class: 'tiny muted' }, `${KINDS[d.kind].label} · ${timeAgo(d.updatedAt)}`))),
        h('button', { class: 'btn-icon sm', 'aria-label': '문서 삭제', onclick: async () => { if (await confirmDialog(`"${d.title}"을(를) 삭제할까요?`, { ok: '삭제', danger: true })) { store.s.docs = store.s.docs.filter(x => x !== d); commit('docs'); el.replaceChildren(); listView(el); } } }, icon('trash', 16)))))
        : h('div', { class: 'empty' }, icon('doc', 32), '아직 문서가 없어요. 위에서 종류를 골라 시작하세요.'))));
}
// the same calculator while writing, in a window over the document
function openCalc() {
  const c = calculator();
  modal({ title: '계산기', body: c });
  setTimeout(() => c.focus(), 120);
}

// ---------- AI panel ----------
function aiPanel(editor, doc) {
  const msgs = h('div', { class: 'cs-msgs' });
  const input = h('textarea', { rows: 2, placeholder: editor.aiPlaceholder || 'Claude에게 문서 작업을 시켜 보세요', 'aria-label': 'Claude에게 보낼 요청' });
  const attachRow = h('div', { class: 'cs-attach' });
  let files = [];
  let busy = false;
  const add = (kind, ...kids) => { const m = h('div', { class: 'msg ' + kind }, ...kids); msgs.append(m); msgs.scrollTop = msgs.scrollHeight; return m; };
  add('bot', editor.aiHello || '무엇을 만들어 드릴까요? 이미지나 파일을 첨부하면 참고해서 작업해요.');
  const paintAttach = () => attachRow.replaceChildren(files.map((f, i) => h('span', { class: 'chip sm' }, icon(f.type.startsWith('image/') ? 'image' : 'file', 14), h('span', { class: 'ell', style: { maxWidth: '140px' } }, f.name), h('button', { 'aria-label': '첨부 빼기', onclick: () => { files.splice(i, 1); paintAttach(); } }, icon('x', 12)))));
  async function send(preset) {
    const text = (preset ?? input.value).trim();
    if (!text || busy) return;
    busy = true; input.value = '';
    const attached = files.splice(0); paintAttach();
    add('user', text, attached.length ? h('div', { class: 'tiny', style: { opacity: 0.7 } }, `첨부 ${attached.length}개`) : null);
    const typing = add('bot typing', h('i'), h('i'), h('i'));
    try {
      const content = [];
      for (const f of attached) content.push(await fileToBlock(f));
      content.push({ type: 'text', text: `현재 문서 제목: ${doc.title}\n현재 문서 내용:\n${editor.serialize()}\n\n사용자 요청: ${text}` });
      const resp = await ai({ system: editor.aiSystem, messages: [{ role: 'user', content }], format: editor.aiSchema, effort: 'medium', max_tokens: 48000 });
      const result = jsonOf(resp);
      const before = editor.snapshot();
      if (result.mode && result.mode !== 'none') { editor.apply(result); gainXP('doc'); }
      if (result.title && /제목 없는/.test(doc.title)) { doc.title = result.title; editor.onTitle?.(result.title); }
      typing.remove();
      add('bot', result.reply || '반영했어요.', result.mode && result.mode !== 'none' ? h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn btn-ghost btn-sm', onclick: e => { editor.restore(before); e.currentTarget.disabled = true; e.currentTarget.textContent = '되돌렸어요'; } }, icon('undo', 14), '되돌리기')) : null);
    } catch (e) {
      typing.remove();
      add('err', e.message);
      if (['no_key', 'auth'].includes(e.code)) add('bot', h('a', { href: '#settings' }, '설정에서 Claude API 키 입력하기'));
    } finally { busy = false; }
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  return h('aside', { class: 'ai-panel glass' },
    h('div', { class: 'cs-head' }, icon('sparkle', 18), h('div', { class: 'grow' }, h('div', { class: 't' }, 'AI 모드'), h('div', { class: 'ctx' }, 'Claude가 문서를 직접 고쳐요'))),
    msgs,
    h('div', { class: 'cs-sugs' }, (editor.aiSuggest || []).map(t => h('button', { class: 'chip sm line', onclick: () => send(t) }, t))),
    attachRow,
    h('div', { class: 'cs-input' },
      h('button', { class: 'btn-icon', 'aria-label': '이미지·파일 첨부', onclick: async () => { files.push(...await pickFiles({ accept: 'image/*,application/pdf,.txt,.md,.csv', multiple: true })); paintAttach(); } }, icon('clip', 18)),
      input,
      h('button', { class: 'btn-icon on', 'aria-label': '보내기', onclick: () => send() }, icon('send', 18))));
}

function editorView(el, ctx, doc) {
  const kind = KINDS[doc.kind];
  const save = debounce(() => { doc.updatedAt = Date.now(); commit('docs'); status.textContent = '저장됨'; }, 800);
  const status = h('span', { class: 'small muted' }, '저장됨');
  const onChange = () => { status.textContent = '저장 중…'; save(); };
  const host = h('div', { class: 'editor-shell', style: { minWidth: 0 } });
  const editor = MOUNT[doc.kind](host, doc, { onChange, kind: doc.kind });
  const title = h('input', { class: 'input bare title-in', value: doc.title, 'aria-label': '문서 제목', oninput: () => { doc.title = title.value; onChange(); } });
  editor.onTitle = t => { title.value = t; onChange(); };
  const split = h('div', { class: 'editor-split' + (doc.ai ? ' ai' : '') }, host);
  let panel = null;
  const setAI = on => {
    doc.ai = on; commit('docs');
    split.classList.toggle('ai', on);
    if (on && !panel) { panel = aiPanel(editor, doc); split.append(panel); }
    if (!on && panel) { panel.remove(); panel = null; }
    editor.relayout?.();
  };
  const exportBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: e => {
    e.stopPropagation();
    const menu = h('div', { class: 'popover glass', style: { padding: '8px', minWidth: '210px' } },
      editor.exports.map(x => h('button', { class: 'nav-item', style: { opacity: 1, transform: 'none', height: '40px', width: '100%' }, onclick: () => { menu.remove(); x.run(); gainXP('doc'); } }, icon(x.icon || 'download', 16), x.label)));
    const r = e.currentTarget.getBoundingClientRect();
    Object.assign(menu.style, { top: r.bottom + 6 + 'px', left: Math.min(r.left, innerWidth - 230) + 'px', transformOrigin: 'top left' });
    document.getElementById('popover-root').append(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }));
  } }, icon('download', 15), '열기 · 저장');
  el.append(
    h('div', { class: 'editor-top' },
      h('a', { class: 'btn-icon glass-btn', href: '#docs', 'aria-label': '문서 목록' }, icon('left')),
      h('span', { class: 'chip ink sm' }, kind.label), title, status,
      seg([['normal', '일반'], ['ai', 'AI']], doc.ai ? 'ai' : 'normal', v => setAI(v === 'ai')),
      h('button', { class: 'btn btn-ghost btn-sm', title: '계산기', onclick: openCalc }, icon('calc', 15), '계산기'),
      exportBtn),
    split);
  if (doc.ai) setAI(true);
  ctx.cleanup(() => { editor.destroy?.(); });
}

export default {
  id: 'docs', title: '문서 작업', icon: 'doc',
  render(el, ctx, arg) {
    const doc = arg && store.s.docs.find(d => d.id === arg);
    if (doc) editorView(el, ctx, doc);
    else listView(el);
  },
};
