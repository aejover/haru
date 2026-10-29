// memo.js — 메모장: text, voice recording (live transcription + Claude summary), links, images, files,
// and a pen layer for doodling over a saved memo.
import {
  h, icon, store, commit, uid, fmtSize, toast, modal, promptDialog, confirmDialog, upload, pickFiles, gainXP, ai, textOf, aiFail, debounce, apiUrl, download, htmlOf, saveImage,
} from '../core.js';
import { memoBlocks } from './memo-blocks.js';
import { openViewer } from '../viewer.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const plain = html => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.trim(); };
// Browser-made webm recordings carry no length, so the player shows no duration and can't seek.
// Jumping to the far end once makes the browser read the real length.
function audioEl(src) {
  const el = h('audio', { src, controls: true, preload: 'metadata' });
  el.addEventListener('loadedmetadata', () => {
    if (el.duration !== Infinity) return;
    const back = () => { el.removeEventListener('timeupdate', back); el.currentTime = 0; };
    el.addEventListener('timeupdate', back);
    el.currentTime = 1e101;
  });
  return el;
}
const fmtTime = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// Pasted text keeps its structure (bold, lists, links, tables) but none of the source page's colors,
// backgrounds or fonts — those made pasted text show up as white-on-black blocks.
const KEEP_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'UL', 'OL', 'LI', 'P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'HR', 'IMG']);
function cleanPaste(html) {
  const doc = new DOMParser().parseFromString(html.replace(/<!--[\s\S]*?-->/g, ''), 'text/html');
  const walk = node => [...node.children].forEach(el => {
    if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'IFRAME', 'OBJECT'].includes(el.tagName)) { el.remove(); return; }
    walk(el);
    if (!KEEP_TAGS.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
    [...el.attributes].forEach(a => { if (!((a.name === 'href' && el.tagName === 'A' && !/^\s*javascript:/i.test(a.value)) || (a.name === 'src' && el.tagName === 'IMG') || a.name === 'colspan' || a.name === 'rowspan')) el.removeAttribute(a.name); });
    if (el.tagName === 'A') el.setAttribute('target', '_blank');
  });
  walk(doc.body);
  return doc.body.innerHTML;
}
const SIZES = [['', '크기'], ['14px', '작게'], ['16px', '보통'], ['19px', '크게'], ['24px', '아주 크게'], ['30px', '제목']];
const WEIGHTS = [['', '두께'], ['300', '얇게'], ['400', '보통'], ['500', '중간'], ['700', '굵게'], ['800', '아주 굵게']];
const lastMemo = { get: () => { try { return localStorage.getItem('haru.lastMemo'); } catch { return null; } }, set: id => { try { id ? localStorage.setItem('haru.lastMemo', id) : localStorage.removeItem('haru.lastMemo'); } catch { /* ignore */ } } };

export default {
  id: 'memo', title: '메모장', icon: 'memo',
  render(el, ctx, arg) {
    const s = store.s;
    // reopen the memo you were last working on
    let cur = s.memos.find(m => m.id === (arg || lastMemo.get())) || null;
    let query = '';
    const layout = h('div', { class: 'memo-layout' + (cur ? ' editing' : '') });
    const listBox = h('aside', { class: 'memo-list glass' });
    const editor = h('section', { class: 'memo-editor glass' });
    layout.append(listBox, editor);
    el.append(h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '메모장'), h('button', { class: 'btn btn-ink', onclick: newMemo }, icon('plus', 16), '새 메모')), layout);

    function newMemo() {
      const m = { id: uid(), title: '', html: '', atts: [], drawing: null, saved: false, createdAt: Date.now(), updatedAt: Date.now() };
      s.memos.unshift(m); cur = m; commit('memos'); paintList(); paintEditor();
      layout.classList.add('editing');
      setTimeout(() => editor.querySelector('.memo-title')?.focus(), 50);
    }
    function paintList() {
      const q = query.trim().toLowerCase();
      const items = s.memos.filter(m => !q || (m.title + ' ' + plain(m.html) + ' ' + m.atts.map(a => a.transcript || a.name || a.url).join(' ')).toLowerCase().includes(q))
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
      const search = h('input', { class: 'input', placeholder: '메모 검색', value: query, 'aria-label': '메모 검색', oninput: e => { query = e.target.value; paintList(); search.focus(); } });
      listBox.replaceChildren(search,
        items.length ? items.map(m => {
          const kinds = [...new Set(m.atts.map(a => a.type))];
          return h('button', { class: 'memo-item' + (cur?.id === m.id ? ' on' : ''), onclick: () => { cur = m; layout.classList.add('editing'); paintList(); paintEditor(); } },
            h('span', { class: 'ttl' }, m.pinned ? icon('pin', 13) : null, ' ', m.title || '제목 없음'),
            h('span', { class: 'pv' }, plain(m.html) || '내용 없음'),
            h('span', { class: 'ic' }, new Date(m.updatedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
              kinds.map(k => icon({ audio: 'mic', link: 'link', image: 'image', file: 'clip' }[k], 13)), m.drawing ? icon('pen', 13) : null));
        }) : h('div', { class: 'empty' }, icon('memo', 28), q ? '찾는 메모가 없어요.' : '아직 메모가 없어요.'));
      const sel = search.value.length; search.setSelectionRange(sel, sel);
    }

    function paintEditor() {
      stopRecording?.();
      if (!cur) {
        lastMemo.set(null);
        editor.replaceChildren(h('div', { class: 'empty', style: { padding: '60px 20px' } }, icon('memo', 40), '왼쪽에서 메모를 고르거나 새 메모를 만드세요.', h('button', { class: 'btn btn-ink', onclick: newMemo }, icon('plus', 16), '새 메모')));
        return;
      }
      const m = cur;
      lastMemo.set(m.id);
      const touch = debounce(() => { m.updatedAt = Date.now(); commit('memos'); paintList(); }, 600);
      const title = h('input', { class: 'input bare memo-title', placeholder: '제목', value: m.title, 'aria-label': '메모 제목', oninput: () => { m.title = title.value; touch(); } });
      const body = h('div', { class: 'memo-body', contenteditable: 'true', 'data-placeholder': '여기에 메모를 적으세요…', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '메모 내용', html: m.html });
      body.addEventListener('input', () => { m.html = htmlOf(body); touch(); });
      // pictures put inline with the + button open in the zoom viewer
      body.addEventListener('click', e => {
        const img = e.target.closest('img.mimg');
        if (img && body.contains(img)) openViewer(img.src, { alt: img.alt || '', onDownload: () => saveImage(img.src, img.alt || m.title || '메모 이미지') });
        // files put inline: saved the same way (the share sheet on iPhone, where download links do nothing)
        const file = e.target.closest('a.mfile');
        if (file && body.contains(file)) { e.preventDefault(); saveImage(file.href, file.getAttribute('download') || '파일'); }
      });
      // clean memos pasted before the fix: drop leftover colors/backgrounds/fonts, keep size & weight
      let tidied = false;
      body.querySelectorAll('[style],[color],[bgcolor],[face]').forEach(x => {
        ['color', 'bgcolor', 'face'].forEach(a => { if (x.hasAttribute(a)) { x.removeAttribute(a); tidied = true; } });
        if (!x.hasAttribute('style')) return;
        const before = x.getAttribute('style'), fs = x.style.fontSize, fw = x.style.fontWeight;
        x.removeAttribute('style');
        if (fs) x.style.fontSize = fs;
        if (fw) x.style.fontWeight = fw;
        if ((x.getAttribute('style') || '') !== before) tidied = true;
      });
      if (tidied) { m.html = htmlOf(body); commit('memos'); }
      if (m.fs) body.style.fontSize = m.fs;
      if (m.fw) body.style.fontWeight = m.fw;
      body.addEventListener('paste', e => {
        const img = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
        if (img) { e.preventDefault(); addFiles([img], 'image'); return; }
        const html = e.clipboardData?.getData('text/html');
        if (html) { e.preventDefault(); document.execCommand('insertHTML', false, cleanPaste(html)); m.html = htmlOf(body); touch(); }
      });
      const fmt = (cmd, val) => { body.focus(); document.execCommand(cmd, false, val); m.html = htmlOf(body); touch(); };
      // text size / weight: selected text only, or the whole memo when nothing is selected
      let range = null;
      const keepRange = () => { const sel = getSelection(); if (sel.rangeCount && body.contains(sel.anchorNode)) range = sel.getRangeAt(0).cloneRange(); };
      document.addEventListener('selectionchange', keepRange);
      const prevCleanup = destroyBlocks;
      function styleText(prop, value, label) {
        if (!value) return;
        if (!range || range.collapsed || !body.contains(range.startContainer)) {
          m[prop === 'fontSize' ? 'fs' : 'fw'] = value; body.style[prop] = value;
          commit('memos'); toast(`메모 전체를 ${label}(으)로 바꿨어요. 일부만 바꾸려면 글자를 먼저 고르세요.`);
          return;
        }
        // wrap the selection ourselves: the browser's fontSize command would wipe earlier size/weight choices
        body.focus({ preventScroll: true });
        const r = range.cloneRange();
        const sp = document.createElement('span'); sp.style[prop] = value;
        sp.append(r.extractContents());
        sp.querySelectorAll('span').forEach(inner => { inner.style[prop] = ''; if (!inner.getAttribute('style')) inner.replaceWith(...inner.childNodes); });
        r.insertNode(sp);
        const sel = getSelection(); const again = document.createRange(); again.selectNodeContents(sp); sel.removeAllRanges(); sel.addRange(again);
        range = again.cloneRange();
        m.html = htmlOf(body); touch();
      }
      const sizeSel = h('select', { class: 'tb-select', 'aria-label': '글자 크기', title: '글자 크기', onchange: e => { styleText('fontSize', e.target.value, SIZES.find(x => x[0] === e.target.value)[1]); e.target.value = ''; } }, SIZES.map(([v, l]) => h('option', { value: v }, l)));
      const weightSel = h('select', { class: 'tb-select', 'aria-label': '글자 두께', title: '글자 두께', onchange: e => { styleText('fontWeight', e.target.value, WEIGHTS.find(x => x[0] === e.target.value)[1]); e.target.value = ''; } }, WEIGHTS.map(([v, l]) => h('option', { value: v }, l)));
      prevCleanup?.();
      const blocks = memoBlocks(body, () => { m.html = htmlOf(body); touch(); });
      destroyBlocks = () => { blocks.destroy(); document.removeEventListener('selectionchange', keepRange); };

      const attBox = h('div', { class: 'attach-list' });
      const imgGrid = h('div', { class: 'img-grid' });
      const ink = h('div', { class: 'ink-layer' }, m.drawing ? h('img', { src: m.drawing, alt: '' }) : null);
      const wrap = h('div', { class: 'memo-canvas-wrap' }, body, imgGrid, attBox, ink, blocks.plus);
      const recBox = h('div');

      const saveBtn = h('button', { class: 'btn btn-ink btn-sm', onclick: save }, icon('check', 15), m.saved ? '저장됨' : '저장');
      const penBtn = h('button', { class: 'btn btn-glass btn-sm', hidden: !m.saved, onclick: () => startDrawing() }, icon('pen', 15), '펜');
      const tools = h('div', { class: 'memo-tools' },
        h('button', { class: 'tb', title: '굵게', 'aria-label': '굵게', onclick: () => fmt('bold') }, icon('bold', 16)),
        h('button', { class: 'tb', title: '기울임', 'aria-label': '기울임', onclick: () => fmt('italic') }, icon('italic', 16)),
        h('button', { class: 'tb', title: '목록', 'aria-label': '목록', onclick: () => fmt('insertUnorderedList') }, icon('list', 16)),
        sizeSel, weightSel,
        blocks.tools,
        h('span', { class: 'nav-sep', style: { width: '1px', height: '20px', margin: '0 4px' } }),
        h('button', { class: 'tb', onclick: () => toggleRecording() }, icon('mic', 16), h('span', { class: 'lb' }, '녹음')),
        h('button', { class: 'tb', onclick: addLink }, icon('link', 16), h('span', { class: 'lb' }, '링크')),
        h('button', { class: 'tb', onclick: async () => addFiles(await pickFiles({ accept: 'image/*', multiple: true }), 'image') }, icon('image', 16), h('span', { class: 'lb' }, '이미지')),
        h('button', { class: 'tb', onclick: async () => addFiles(await pickFiles({ multiple: true }), 'file') }, icon('clip', 16), h('span', { class: 'lb' }, '파일')),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn-icon sm', title: '고정', 'aria-label': '상단 고정', onclick: () => { m.pinned = !m.pinned; commit('memos'); paintList(); toast(m.pinned ? '맨 위에 고정했어요.' : '고정을 풀었어요.'); } }, icon('pin', 16)),
        h('button', { class: 'btn-icon sm', title: '삭제', 'aria-label': '메모 삭제', onclick: async () => { if (await confirmDialog('이 메모를 삭제할까요?', { ok: '삭제', danger: true })) { s.memos = s.memos.filter(x => x !== m); cur = null; commit('memos'); layout.classList.remove('editing'); paintList(); paintEditor(); } } }, icon('trash', 16)),
        penBtn, saveBtn);

      editor.replaceChildren(
        h('div', { class: 'row' }, h('button', { class: 'btn-icon sm', 'aria-label': '목록으로', style: { display: matchMedia('(max-width: 860px)').matches ? '' : 'none' }, onclick: () => { layout.classList.remove('editing'); } }, icon('left', 18)), title),
        tools, recBox, blocks.tableBar, wrap);

      function save() {
        m.html = htmlOf(body); m.updatedAt = Date.now();
        if (!m.title.trim()) { m.title = plain(m.html).slice(0, 30) || '제목 없음'; title.value = m.title; }
        const first = !m.saved; m.saved = true;
        commit('memos'); paintList();
        if (first) gainXP('memo');
        saveBtn.replaceChildren(icon('check', 15), '저장됨');
        penBtn.hidden = false;
        toast('메모를 저장했어요. 이제 펜으로 위에 그릴 수 있어요.', { icon: 'check' });
      }

      // ----- attachments -----
      function paintAtts() {
        const imgs = m.atts.filter(a => a.type === 'image');
        imgGrid.replaceChildren(imgs.map(a => h('figure', null, h('img', { src: a.url, alt: a.name || '', title: '눌러서 크게 보기', onclick: () => openViewer(a.url, { alt: a.name || '', onDownload: () => saveFile(a) }) }),
          h('button', { class: 'btn-icon sm dl', 'aria-label': '이미지 다운로드', title: '다운로드', onclick: () => saveFile(a) }, icon('download', 14)),
          h('button', { class: 'btn-icon sm', 'aria-label': '이미지 삭제', onclick: () => removeAtt(a) }, icon('x', 14)))));
        imgGrid.hidden = !imgs.length;
        attBox.replaceChildren(m.atts.filter(a => a.type !== 'image').map(a => {
          if (a.type === 'link') return h('div', { class: 'att' }, icon('link', 18), h('div', { class: 'grow' }, h('a', { href: a.url, target: '_blank', rel: 'noopener', class: 'ell', style: { display: 'block', fontWeight: 600 } }, a.title || a.url), h('div', { class: 'tiny muted ell' }, a.url)), h('button', { class: 'btn-icon sm', 'aria-label': '삭제', onclick: () => removeAtt(a) }, icon('x', 14)));
          if (a.type === 'file') return h('div', { class: 'att' }, icon('file', 18), h('div', { class: 'grow' }, h('a', { href: a.url, download: a.name, class: 'ell', style: { display: 'block', fontWeight: 600 } }, a.name), h('div', { class: 'tiny muted' }, fmtSize(a.size || 0))), h('button', { class: 'btn-icon sm', 'aria-label': '삭제', onclick: () => removeAtt(a) }, icon('x', 14)));
          // audio
          const sumBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: () => summarize(a, sumBtn) }, icon('sparkle', 14), a.summary ? '다시 요약' : 'Claude 요약');
          return h('div', { class: 'att', style: { flexDirection: 'column', alignItems: 'stretch' } },
            h('div', { class: 'row' }, icon('mic', 18), h('b', { class: 'grow' }, a.name || '녹음'), h('span', { class: 'tiny muted num' }, fmtTime(a.duration || 0)),
              h('button', { class: 'btn-icon sm', 'aria-label': '녹음 삭제', onclick: () => removeAtt(a) }, icon('x', 14))),
            audioEl(a.url),
            a.transcript ? h('div', { class: 'transcript' }, a.transcript) : h('div', { class: 'tiny muted' }, SR ? '받아쓴 내용이 없어요.' : '이 브라우저는 받아쓰기를 지원하지 않아요. Chrome이나 Edge에서 녹음하면 자동으로 텍스트가 돼요.'),
            h('div', { class: 'row wrap' },
              a.transcript ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { body.focus(); document.execCommand('insertText', false, '\n' + a.transcript); m.html = htmlOf(body); touch(); } }, icon('text', 14), '본문에 넣기') : null,
              a.transcript ? sumBtn : null),
            a.summary ? h('div', { class: 'summary' }, a.summary) : null);
        }));
      }
      const saveFile = a => saveImage(a.url, a.name || '이미지');
      function removeAtt(a) { m.atts = m.atts.filter(x => x !== a); commit('memos'); paintAtts(); paintList(); }
      async function addFiles(files, type) {
        for (const f of files) {
          try { const up = await upload(f); m.atts.push({ id: uid(), type: type === 'image' || f.type.startsWith('image/') ? 'image' : 'file', url: up.url, name: f.name, size: f.size }); }
          catch (e) { toast(e.message); }
        }
        m.updatedAt = Date.now(); commit('memos'); paintAtts(); paintList();
      }
      async function addLink() {
        const url = await promptDialog('링크 추가', { placeholder: 'https://…', ok: '추가' });
        if (!url) return;
        const u = /^https?:\/\//.test(url.trim()) ? url.trim() : 'https://' + url.trim();
        let host = u; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { /* keep */ }
        m.atts.push({ id: uid(), type: 'link', url: u, title: host });
        m.updatedAt = Date.now(); commit('memos'); paintAtts(); paintList();
      }
      async function summarize(a, btn) {
        btn.disabled = true; btn.textContent = '요약 중…';
        try {
          const resp = await ai({ effort: 'low', max_tokens: 4000, system: '녹음을 받아쓴 텍스트를 한국어로 요약한다. 핵심 내용 3~5줄을 "- "로 시작하는 목록으로 쓰고, 할 일이 있으면 마지막에 "할 일:" 아래 목록으로 덧붙인다. 받아쓰기 오류로 보이는 단어는 문맥에 맞게 해석한다.', messages: [{ role: 'user', content: a.transcript }] });
          a.summary = textOf(resp); commit('memos'); paintAtts();
        } catch (e) { aiFail(e); btn.disabled = false; btn.textContent = 'Claude 요약'; }
      }

      // ----- recording -----
      let rec = null;
      const memoId = m.id;
      async function toggleRecording() { if (rec) return stopRecording(); startRecording(); }
      async function startRecording(withSpeech = !!(SR && s.settings.sttAuto)) {
        if (!window.MediaRecorder) { toast('이 브라우저는 녹음을 지원하지 않아요.'); return; }
        let stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
        catch { toast(location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname) ? '마이크를 쓸 수 없어요. 주소창의 마이크 권한을 허용하세요.' : '휴대폰에서 녹음하려면 https 주소(Tailscale)로 열어야 해요.'); return; }
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported?.(t));
        const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        const chunks = [];
        mr.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
        let finalText = '', interim = '';
        const live = h('div', { class: 'live-tx' }, withSpeech ? '말하면 여기에 받아써져요…' : '녹음 중…');
        const clock = h('span', { class: 'num' }, '0:00');
        const started = Date.now();
        const me = { mr, stream, recog: null, byUser: false, release: store.hold(), timer: setInterval(() => { clock.textContent = fmtTime((Date.now() - started) / 1000); }, 500) };
        rec = me;
        // Some phones hand the microphone to speech recognition and end the recording; keep recording without it.
        stream.getAudioTracks()[0]?.addEventListener('ended', () => {
          if (rec !== me || me.byUser) return;
          if (me.recog && Date.now() - started < 4000) { me.fallback = true; toast('이 기기에서는 녹음과 받아쓰기를 함께 할 수 없어서 녹음만 할게요.'); }
          stopRecording(true);
        });
        if (withSpeech) {
          const r = new SR(); r.lang = 'ko-KR'; r.continuous = true; r.interimResults = true;
          r.onresult = e => {
            interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) finalText += res[0].transcript.trim() + ' '; else interim += res[0].transcript; }
            live.textContent = (finalText + interim).trim() || '…';
          };
          r.onend = () => { if (rec === me && me.recog === r) { try { r.start(); } catch { /* already running */ } } };
          r.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { me.recog = null; live.textContent = '받아쓰기를 쓸 수 없어서 녹음만 하고 있어요.'; } };
          try { r.start(); me.recog = r; } catch { /* unsupported */ }
        }
        mr.onstop = async () => {
          me.stream.getTracks().forEach(t => t.stop());
          me.release();
          if (me.fallback) { startRecording(false); return; }
          const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' });
          if (!blob.size) { toast('녹음된 소리가 없어요. 마이크가 다른 앱에서 쓰이고 있지 않은지 확인하세요.'); return; }
          const type = blob.type || '';
          const ext = type.includes('mp4') ? '.m4a' : type.includes('ogg') ? '.ogg' : '.webm';
          const duration = (Date.now() - started) / 1000;
          try {
            const up = await upload(blob, `recording${ext}`);
            // the memo object on screen may have been replaced meanwhile; attach to the stored one
            const target = store.s.memos.find(x => x.id === memoId) || m;
            target.atts.push({ id: uid(), type: 'audio', url: up.url, name: `녹음 ${new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, duration, transcript: (finalText + interim).trim() });
            target.updatedAt = Date.now(); commit('memos'); gainXP('record');
            if (cur?.id === memoId) { if (cur !== target) { cur = target; paintEditor(); } else paintAtts(); }
            paintList();
            toast('녹음을 저장했어요.', { icon: 'mic' });
          } catch (e) { toast(e.message); }
        };
        mr.start(1000);
        recBox.replaceChildren(h('div', { class: 'att', style: { flexDirection: 'column', alignItems: 'stretch' } },
          h('div', { class: 'row' }, h('span', { class: 'rec-dot' }), h('b', { class: 'grow' }, '녹음 중'), clock, h('button', { class: 'btn btn-ink btn-sm', onclick: () => stopRecording() }, icon('stop', 14), '정지')),
          live));
      }
      stopRecording = (auto = false) => {
        if (!rec) return;
        const r = rec; rec = null;
        r.byUser = !auto;
        clearInterval(r.timer);
        const sp = r.recog; r.recog = null;
        try { sp?.stop(); } catch { /* ignore */ }
        // let the recorder hand over its last chunk; tracks stop in onstop
        if (r.mr.state !== 'inactive') { try { r.mr.requestData?.(); } catch { /* ignore */ } r.mr.stop(); }
        else { r.stream.getTracks().forEach(t => t.stop()); r.release(); }
        recBox.replaceChildren();
      };

      // ----- pen layer -----
      function startDrawing() {
        const rect = wrap.getBoundingClientRect();
        const W = Math.max(200, Math.round(rect.width)), H = Math.max(240, Math.round(wrap.scrollHeight));
        const dpr = window.devicePixelRatio || 1;
        const cv = h('canvas', { class: 'draw-canvas', width: W * dpr, height: H * dpr, style: { width: W + 'px', height: H + 'px' } });
        const g = cv.getContext('2d'); g.scale(dpr, dpr); g.lineCap = 'round'; g.lineJoin = 'round';
        if (m.drawing) { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => g.drawImage(im, 0, 0, W, H); im.src = apiUrl(m.drawing); }
        ink.hidden = true;
        let tool = 'pen', color = getComputedStyle(document.body).color, size = 3;
        const colors = [color, '#8a8a8f', '#d93636', '#2f6fde', '#f2c230'];
        const sw = colors.map(c => { const b = h('button', { class: 'swatch' + (c === color ? ' on' : ''), style: { background: c }, 'aria-label': '색 ' + c, onclick: () => { color = c; sw.forEach(x => x.classList.toggle('on', x === b)); if (tool === 'eraser') setTool('pen'); } }); return b; });
        const tb = {};
        const setTool = t => { tool = t; Object.entries(tb).forEach(([k, b]) => b.classList.toggle('on', k === t)); };
        tb.pen = h('button', { class: 'tb on', title: '펜', 'aria-label': '펜', onclick: () => setTool('pen') }, icon('pen', 16));
        tb.marker = h('button', { class: 'tb', title: '형광펜', 'aria-label': '형광펜', onclick: () => setTool('marker') }, icon('highlighter', 16));
        tb.eraser = h('button', { class: 'tb', title: '지우개', 'aria-label': '지우개', onclick: () => setTool('eraser') }, icon('eraser', 16));
        const range = h('input', { type: 'range', min: 1, max: 24, value: size, 'aria-label': '굵기', style: { width: '90px', accentColor: 'var(--fg)' }, oninput: () => { size = +range.value; } });
        const bar = h('div', { class: 'draw-bar glass' }, tb.pen, tb.marker, tb.eraser, h('span', { style: { width: '6px' } }), sw, range, h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => g.clearRect(0, 0, W, H) }, '모두 지우기'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => finish(false) }, '취소'),
          h('button', { class: 'btn btn-ink btn-sm', onclick: () => finish(true) }, icon('check', 14), '완료'));
        wrap.before(bar); wrap.append(cv);
        let last = null;
        const pos = e => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
        cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); last = pos(e); dot(last, e); });
        cv.addEventListener('pointermove', e => { if (!last) return; const p = pos(e); line(last, p, e); last = p; });
        cv.addEventListener('pointerup', () => { last = null; });
        function style(e) {
          const pr = e.pressure && e.pointerType === 'pen' ? 0.5 + e.pressure : 1;
          g.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
          g.globalAlpha = tool === 'marker' ? 0.32 : 1;
          g.strokeStyle = g.fillStyle = color;
          g.lineWidth = (tool === 'marker' ? size * 4 : tool === 'eraser' ? size * 3 : size) * pr;
        }
        function dot(p, e) { style(e); g.beginPath(); g.arc(p.x, p.y, g.lineWidth / 2, 0, Math.PI * 2); g.fill(); }
        function line(a, b, e) { style(e); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
        async function finish(keep) {
          if (keep) {
            const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
            try {
              const up = await upload(blob, 'drawing.png');
              m.drawing = up.url; m.updatedAt = Date.now(); commit('memos'); gainXP('memo');
              ink.replaceChildren(h('img', { src: up.url, alt: '' }));
              toast('그림을 저장했어요.', { icon: 'pen' });
            } catch (e) { toast(e.message); }
          }
          bar.remove(); cv.remove(); ink.hidden = false;
        }
      }
      paintAtts();
    }
    let stopRecording = null, destroyBlocks = null;
    ctx.cleanup(() => { stopRecording?.(); destroyBlocks?.(); });
    paintList(); paintEditor();
  },
};
