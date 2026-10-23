// youtube.js — one persistent YouTube player (so sound keeps going on every tab), radio mode,
// the "그만 보기" alarm, and the 유튜브 · 라디오 view.
import { h, icon, store, commit, bus, toast, seg, switchEl, chime, desktopNotify, modal, gainXP } from './core.js';
import { googleConfigured, googleLinked, googleSignIn, googleSignOut, ytApi } from './google.js';

const host = () => document.getElementById('yt-host');
let player = null, apiReady = null, playerReady = null;
let now = { id: '', title: '', channel: '', list: '' };
let playing = false;
let miniClosed = false;
let slot = null;
let watchedMs = 0, nextAlarmMs = 0, lastTick = Date.now();
const Y = () => store.s.yt;

export const ytState = () => ({ ...now, playing, radio: Y().radio, loaded: !!(now.id || now.list) });

function loadAPI() {
  apiReady ||= new Promise((res, rej) => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiReady = null; rej(new Error('YouTube를 불러오지 못했어요. 인터넷 연결을 확인하세요.')); };
    document.head.append(s);
  });
  return apiReady;
}
async function ensurePlayer() {
  await loadAPI();
  playerReady ||= new Promise(res => {
    player = new window.YT.Player('yt-player', {
      width: '100%', height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
      events: {
        onReady: () => res(player),
        onStateChange: onState,
        onError: e => toast(e.data === 101 || e.data === 150 ? '이 영상은 채널 설정 때문에 다른 곳에서 재생할 수 없어요.' : '영상을 재생하지 못했어요.', { icon: 'youtube' }),
      },
    });
  });
  return playerReady;
}
function onState(e) {
  const S = window.YT.PlayerState;
  playing = e.data === S.PLAYING;
  if (e.data === S.PLAYING || e.data === S.CUED) {
    const d = player.getVideoData?.() || {};
    if (d.video_id) { now.id = d.video_id; now.title = d.title || now.title; now.channel = d.author || now.channel; remember(); }
  }
  if (playing) miniClosed = false;
  place();
  bus.emit('yt');
}
function remember() {
  if (!now.id) return;
  const r = Y().recent.filter(x => x.id !== now.id);
  r.unshift({ id: now.id, title: now.title, channel: now.channel, thumb: `https://i.ytimg.com/vi/${now.id}/mqdefault.jpg` });
  Y().recent = r.slice(0, 12);
  store.save();
}

export function parseYT(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return { id: s };
  try {
    const u = new URL(s.startsWith('http') ? s : 'https://' + s);
    if (!/youtu\.?be/.test(u.hostname)) return null;
    const list = u.searchParams.get('list') || '';
    let id = u.searchParams.get('v') || '';
    if (u.hostname.includes('youtu.be')) id = u.pathname.slice(1, 12);
    const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
    if (m) id = m[2];
    if (!id && !list) return null;
    return { id, list };
  } catch { return null; }
}

export async function play(item) {
  try { await ensurePlayer(); } catch (e) { toast(e.message, { icon: 'youtube' }); return; }
  now = { id: item.id || '', title: item.title || '', channel: item.channel || '', list: item.list || '' };
  if (item.list) player.loadPlaylist({ list: item.list, listType: 'playlist', index: 0 });
  else player.loadVideoById(item.id);
  miniClosed = false;
  gainXP('youtube');
  place();
  bus.emit('yt');
}
export function togglePlay() { if (!player) return; playing ? player.pauseVideo() : player.playVideo(); }
export const next = () => player?.nextVideo?.();
export const prev = () => player?.previousVideo?.();
export function setRadio(on) { Y().radio = on; commit('yt'); place(); bus.emit('yt'); }
export const setVolume = v => player?.setVolume?.(v);

// ----- placement: in the page slot, as a mini player, or hidden (radio) -----
function setHostMode(mode, rect) {
  const el = host();
  el.dataset.mode = mode;
  if (mode === 'slot' && rect) Object.assign(el.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px', bottom: 'auto' });
  else el.style.cssText = '';
}
export function place() {
  const loaded = !!(now.id || now.list);
  const onPage = slot && document.body.contains(slot) && location.hash.startsWith('#youtube');
  if (Y().radio) return setHostMode(loaded || onPage ? 'radio' : 'hidden');
  if (onPage && slot) return setHostMode('slot', slot.getBoundingClientRect());
  if (loaded && playing && !miniClosed) return setHostMode('mini');
  setHostMode('hidden');
}
let follow = 0;
export function followSlot(ms = 900) {
  const until = performance.now() + ms;
  cancelAnimationFrame(follow);
  const loop = () => { place(); if (performance.now() < until) follow = requestAnimationFrame(loop); };
  loop();
}

export function initYouTubeHost() {
  document.getElementById('yt-mini-close').addEventListener('click', () => { miniClosed = true; player?.pauseVideo?.(); place(); });
  document.getElementById('yt-mini-open').addEventListener('click', () => { location.hash = 'youtube'; });
  document.getElementById('view').addEventListener('scroll', () => { if (slot) place(); }, { passive: true });
  window.addEventListener('resize', () => place());
  bus.on('route', () => followSlot());
  setInterval(alarmTick, 1000);
}

// ----- "그만 보기" alarm: counts time actually spent watching -----
function alarmTick() {
  const t = Date.now(), dt = t - lastTick; lastTick = t;
  const a = Y().alarm;
  const watching = playing && (!Y().radio || a.radio);
  if (!a.on || !watching) return;
  watchedMs += dt;
  if (!nextAlarmMs) nextAlarmMs = a.every * 60e3;
  if (watchedMs >= nextAlarmMs) {
    nextAlarmMs = watchedMs + a.every * 60e3;
    fireAlarm();
  }
  bus.emit('yt-alarm');
}
export function alarmInfo() {
  const a = Y().alarm;
  return { on: a.on, every: a.every, watchedMs, leftMs: Math.max(0, (nextAlarmMs || a.every * 60e3) - watchedMs) };
}
export function resetAlarm() { watchedMs = 0; nextAlarmMs = 0; bus.emit('yt-alarm'); }
function fireAlarm() {
  chime('alarm');
  const mins = Math.round(watchedMs / 60e3);
  desktopNotify('유튜브 그만 볼 시간', `벌써 ${mins}분째 보고 있어요.`);
  modal({
    title: '유튜브 그만 볼 시간이에요',
    body: h('p', { style: { margin: 0, lineHeight: 1.7 } }, `벌써 ${mins}분째 보고 있어요. 지금 멈추고 하던 일로 돌아가 볼까요?`),
    actions: [
      { label: `${Y().alarm.every}분 더 볼게요` },
      { label: '그만 볼래요', primary: true, onClick: () => { player?.pauseVideo?.(); resetAlarm(); } },
    ],
  });
}

// ---------- view ----------
function vidCard(v, onClick) {
  return h('button', { class: 'vid', onclick: onClick },
    h('img', { src: v.thumb || (v.id ? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` : ''), alt: '', loading: 'lazy' }),
    h('span', { class: 'vt' }, v.title || '제목 없음'),
    v.channel || v.count != null ? h('span', { class: 'vc' }, v.channel || `${v.count}개 영상`) : null);
}

export default {
  id: 'youtube', title: '유튜브 · 라디오', icon: 'youtube',
  render(el, ctx) {
    el.classList.add('stagger');
    const q = h('input', { class: 'input', placeholder: '유튜브 링크를 붙여넣거나 검색어를 입력하세요', onkeydown: e => { if (e.key === 'Enter') go(); } });
    const modeSeg = seg([['video', '영상'], ['radio', '라디오']], Y().radio ? 'radio' : 'video', v => setRadio(v === 'radio'));
    const searchRow = h('div', { class: 'row wrap' }, h('div', { class: 'grow', style: { minWidth: '220px' } }, q), h('button', { class: 'btn btn-ink', onclick: go }, icon('play', 16), '재생 / 검색'), modeSeg);

    const stageBox = h('div');
    const titleEl = h('div', { class: 'h3 ell' });
    const subEl = h('div', { class: 'small muted ell' });
    const playBtn = h('button', { class: 'btn-icon glass-btn', 'aria-label': '재생/일시정지', onclick: togglePlay });
    const vol = h('input', { type: 'range', min: 0, max: 100, value: 80, 'aria-label': '볼륨', style: { width: '110px', accentColor: 'var(--fg)' }, oninput: () => setVolume(+vol.value) });
    const saveBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: saveCurrent }, icon('pin', 16), '저장');
    const controls = h('div', { class: 'yt-controls' },
      h('button', { class: 'btn-icon glass-btn', 'aria-label': '이전', onclick: prev }, icon('prev')), playBtn,
      h('button', { class: 'btn-icon glass-btn', 'aria-label': '다음', onclick: next }, icon('skip')),
      h('span', { class: 'row', style: { gap: '6px' } }, icon('wave', 18), vol), h('span', { class: 'spacer' }), saveBtn);
    const playerCard = h('section', { class: 'glass card col' }, stageBox, h('div', { class: 'col', style: { gap: '2px' } }, titleEl, subEl), controls);

    // alarm
    const a = Y().alarm;
    const nextEl = h('span', { class: 'next' });
    const everyB = h('b', { class: 'num' }, `${a.every}분`);
    const setEvery = v => { a.every = Math.max(5, Math.min(180, v)); everyB.textContent = `${a.every}분`; resetAlarm(); commit('yt'); };
    const alarmCard = h('section', { class: 'glass card col alarm-card' },
      h('div', { class: 'row between' }, h('div', { class: 'row' }, icon('bell'), h('h2', { class: 'h2' }, '그만 보기 알람')), switchEl(a.on, v => { a.on = v; resetAlarm(); commit('yt'); paintAlarm(); }, '알람 켜기')),
      h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, '알람 간격', h('span', { class: 'sub' }, '실제로 본 시간 기준으로 울려요')),
        h('div', { class: 'stepper' }, h('button', { class: 'btn-icon', 'aria-label': '줄이기', onclick: () => setEvery(a.every - 5) }, icon('minus', 16)), everyB, h('button', { class: 'btn-icon', 'aria-label': '늘리기', onclick: () => setEvery(a.every + 5) }, icon('plus', 16)))),
      h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, '라디오 모드에서도 울리기'), switchEl(!!a.radio, v => { a.radio = v; commit('yt'); })),
      h('div', { class: 'small muted' }, nextEl));

    // google
    const gCard = h('section', { class: 'glass card col' });
    const savedCard = h('section', { class: 'glass card col' });
    const browse = h('section', { class: 'glass card col' });

    el.append(h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '유튜브 · 라디오')), searchRow,
      h('div', { class: 'yt-layout' }, h('div', { class: 'col', style: { gap: '16px', minWidth: 0 } }, playerCard, browse), h('div', { class: 'col', style: { gap: '16px' } }, alarmCard, gCard, savedCard)));

    let ytSlot = null;
    function paintStage() {
      const st = ytState();
      if (Y().radio) {
        ytSlot = null; slot = null;
        stageBox.replaceChildren(h('div', { class: 'radio-face glass' },
          h('div', { class: 'vinyl' + (st.playing ? ' playing' : '') }, h('i')),
          h('div', { class: 'row', style: { gap: '10px' } }, h('div', { class: 'eq' + (st.playing ? '' : ' paused') }, h('i'), h('i'), h('i'), h('i')), h('b', null, st.loaded ? 'ON AIR' : '라디오 대기 중')),
          h('div', { class: 'small muted' }, st.loaded ? '화면 없이 소리만 재생돼요. 다른 탭으로 가도 계속 들려요.' : '아래에서 영상이나 재생목록을 고르면 소리만 재생돼요.')));
      } else {
        if (!ytSlot) {
          ytSlot = h('div', { class: 'yt-slot' }, st.loaded ? null : h('div', { class: 'placeholder' }, icon('youtube', 40), h('div', null, '링크를 붙여넣거나 아래 목록에서 영상을 고르세요.')));
          stageBox.replaceChildren(ytSlot);
        }
        slot = st.loaded ? ytSlot : null;
        if (st.loaded) ytSlot.replaceChildren();
      }
      titleEl.textContent = st.title || (st.loaded ? '재생 중' : '재생 중인 영상 없음');
      subEl.textContent = st.channel || (st.list ? '재생목록' : '');
      playBtn.replaceChildren(icon(st.playing ? 'pause' : 'play', 20));
      modeSeg.set(Y().radio ? 'radio' : 'video');
      followSlot(700);
    }
    function paintAlarm() {
      const i = alarmInfo();
      if (!i.on) { nextEl.textContent = '알람이 꺼져 있어요.'; return; }
      const m = Math.floor(i.leftMs / 60e3), s = Math.floor((i.leftMs % 60e3) / 1000);
      nextEl.textContent = `지금까지 ${Math.floor(i.watchedMs / 60e3)}분 시청 · 다음 알람까지 ${m}분 ${String(s).padStart(2, '0')}초`;
    }
    function paintGoogle() {
      if (googleLinked()) {
        gCard.replaceChildren(h('div', { class: 'row between' }, h('h2', { class: 'h2' }, '내 YouTube 계정'), h('span', { class: 'chip sm ink' }, '연결됨')),
          h('p', { class: 'small muted', style: { margin: 0 } }, '구독 채널, 내 재생목록, 좋아요 표시한 영상을 아래에서 볼 수 있어요.'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { googleSignOut(); } }, '연결 해제'));
      } else {
        gCard.replaceChildren(h('h2', { class: 'h2' }, '내 YouTube 계정 연동'),
          h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, googleConfigured() ? '연결하면 구독 채널, 재생목록, 좋아요한 영상을 여기서 바로 볼 수 있어요.' : '연동하려면 설정에서 Google OAuth 클라이언트 ID를 한 번 입력해야 해요. 연동하지 않아도 링크로 재생할 수 있어요.'),
          googleConfigured()
            ? h('button', { class: 'btn btn-ink', onclick: () => googleSignIn().catch(e => toast(e.message)) }, icon('youtube', 16), 'Google 계정 연결')
            : h('a', { class: 'btn btn-ghost', href: '#settings' }, icon('sliders', 16), '설정에서 입력하기'));
      }
    }
    function paintSaved() {
      const sv = Y().saved, rc = Y().recent;
      savedCard.replaceChildren(h('h2', { class: 'h2' }, '저장한 목록'),
        sv.length ? h('div', { class: 'col', style: { gap: '4px' } }, sv.map(v => h('div', { class: 'row' },
          h('button', { class: 'grow ell', style: { textAlign: 'left', padding: '6px 0', fontWeight: 560 }, onclick: () => play(v) }, (v.list ? '[재생목록] ' : '') + (v.title || v.id)),
          h('button', { class: 'btn-icon sm', 'aria-label': '삭제', onclick: () => { Y().saved = sv.filter(x => x !== v); commit('yt'); paintSaved(); } }, icon('x', 16)))))
          : h('p', { class: 'small muted', style: { margin: 0 } }, '재생 중에 "저장"을 누르면 여기에 모여요.'),
        rc.length ? h('div', { class: 'section-label', style: { marginTop: '8px' } }, '최근 재생') : null,
        rc.length ? h('div', { class: 'col', style: { gap: '2px' } }, rc.slice(0, 6).map(v => h('button', { class: 'ell small', style: { textAlign: 'left', padding: '5px 0' }, onclick: () => play(v) }, v.title || v.id))) : null);
    }
    let tab = 'subs';
    async function paintBrowse(results) {
      if (results) {
        browse.replaceChildren(h('div', { class: 'row between' }, h('h2', { class: 'h2' }, results.title), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => paintBrowse() }, '내 계정 목록')),
          results.items.length ? h('div', { class: 'vid-grid' }, results.items.map(v => vidCard(v, () => play(v)))) : h('div', { class: 'empty' }, '결과가 없어요.'));
        return;
      }
      if (!googleLinked()) {
        browse.replaceChildren(h('h2', { class: 'h2' }, '바로 재생하기'),
          h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.7 } }, 'youtube.com에서 영상이나 재생목록 주소를 복사해 위 칸에 붙여넣으면 바로 재생돼요. 계정을 연동하면 구독 채널과 재생목록이 이곳에 보여요.'),
          Y().recent.length ? h('div', { class: 'vid-grid' }, Y().recent.map(v => vidCard(v, () => play(v)))) : null);
        return;
      }
      const tabs = seg([['subs', '구독'], ['lists', '재생목록'], ['liked', '좋아요']], tab, v => { tab = v; paintBrowse(); });
      const body = h('div', null, h('div', { class: 'empty' }, '불러오는 중…'));
      browse.replaceChildren(h('div', { class: 'row between wrap' }, h('h2', { class: 'h2' }, '내 YouTube'), tabs), body);
      try {
        if (tab === 'subs') {
          const subs = await ytApi.subs();
          body.replaceChildren(h('div', { class: 'sub-list' }, subs.map(s => h('button', { class: 'sub', onclick: async () => paintBrowse({ title: s.title, items: await ytApi.channel(s.id) }) }, h('img', { src: s.thumb || '', alt: '' }), h('span', null, s.title)))),
            h('p', { class: 'small muted' }, '채널을 누르면 최신 영상이 보여요.'));
        } else if (tab === 'lists') {
          const lists = await ytApi.playlists();
          body.replaceChildren(lists.length ? h('div', { class: 'vid-grid' }, lists.map(p => vidCard(p, () => play({ list: p.list, title: p.title })))) : h('div', { class: 'empty' }, '재생목록이 없어요.'));
        } else {
          const liked = await ytApi.liked();
          body.replaceChildren(h('div', { class: 'vid-grid' }, liked.map(v => vidCard(v, () => play(v)))));
        }
      } catch (e) { body.replaceChildren(h('div', { class: 'empty' }, e.message)); }
    }
    async function go() {
      const v = q.value.trim(); if (!v) return;
      const p = parseYT(v);
      if (p) { play(p); q.value = ''; return; }
      if (googleLinked()) {
        try { paintBrowse({ title: `"${v}" 검색 결과`, items: await ytApi.search(v) }); } catch (e) { toast(e.message); }
      } else {
        toast('검색은 Google 계정을 연동하면 쓸 수 있어요. 지금은 youtube.com에서 찾아 링크를 붙여넣으세요.', { duration: 6000, action: { label: 'YouTube 열기', onClick: () => window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(v), '_blank', 'noopener') } });
      }
    }
    function saveCurrent() {
      const st = ytState(); if (!st.loaded) return toast('재생 중인 영상이 없어요.');
      const item = st.list ? { list: st.list, title: st.title || '재생목록' } : { id: st.id, title: st.title, channel: st.channel };
      if (Y().saved.some(x => (x.id && x.id === item.id) || (x.list && x.list === item.list))) return toast('이미 저장했어요.');
      Y().saved.unshift(item); commit('yt'); paintSaved(); toast('저장했어요.', { icon: 'pin' });
    }

    paintStage(); paintAlarm(); paintGoogle(); paintSaved(); paintBrowse();
    ctx.on('yt', () => { paintStage(); paintSaved(); });
    ctx.on('yt-alarm', paintAlarm);
    ctx.on('google', () => { paintGoogle(); paintBrowse(); });
    ctx.on('change', w => { if (w === 'yt') { paintStage(); } });
    ctx.cleanup(() => { slot = null; place(); });
  },
};
