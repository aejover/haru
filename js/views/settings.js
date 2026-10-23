// settings.js — 화면 테마, 날씨 지역, Claude API, 알림(데스크톱·휴대폰·독촉), Google 연동, 데이터.
import { h, icon, store, commit, toast, seg, switchEl, confirmDialog, download, pickFiles, ai, textOf, aiFail, desktopNotify } from '../core.js';
import { applyTheme, isStandalone, canInstall, promptInstall } from '../main.js';
import { searchCity, clearWeatherCache } from '../weather.js';
import { googleConfigured, googleLinked, googleSignIn, googleSignOut } from '../google.js';
import { phoneInfo, phoneCard } from '../phone.js';

const MODELS = [['claude-opus-5-5', 'Claude Opus 5.5 (기본 · 가장 똑똑함)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (빠름)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (가장 빠르고 저렴)']];

export default {
  id: 'settings', title: '설정', icon: 'sliders',
  render(el, ctx) {
    el.classList.add('stagger', 'narrow');
    const S = store.s.settings;
    const row = (label, sub, ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, label, sub ? h('span', { class: 'sub' }, sub) : null), ctrl);
    const card = (title, ...kids) => h('section', { class: 'glass card set-section' }, h('h2', { class: 'h2', style: { marginBottom: '6px' } }, title), ...kids);
    const numIn = (key, min, max, unit) => h('div', { class: 'row', style: { gap: '6px' } }, h('input', { class: 'input', type: 'number', min, max, value: S[key], style: { width: '84px', height: '36px' }, onchange: e => { S[key] = Math.min(max, Math.max(min, Number(e.target.value) || min)); e.target.value = S[key]; commit('settings'); } }), h('span', { class: 'small muted' }, unit));

    // theme
    const themeSeg = seg([['light', '화이트'], ['dark', '블랙'], ['system', '시스템']], S.theme, v => { S.theme = v; commit('settings'); applyTheme(v, true); });

    // weather city
    const cityLabel = h('span', { class: 'small muted' }, S.city ? `${S.city.name}${S.city.region ? ' · ' + S.city.region : ''}` : '현재 위치 (허용하지 않으면 서울)');
    const cityResults = h('div', { class: 'col', style: { gap: '4px' } });
    const cityIn = h('input', { class: 'input', placeholder: '도시 이름 (예: 부산, 수원, Tokyo)', onkeydown: async e => {
      if (e.key !== 'Enter' || e.isComposing) return;
      try {
        const list = await searchCity(cityIn.value.trim());
        cityResults.replaceChildren(list.length ? list.map(c => h('button', { class: 'att', style: { textAlign: 'left' }, onclick: () => { S.city = c; commit('settings'); clearWeatherCache(); cityLabel.textContent = `${c.name} · ${c.region}`; cityResults.replaceChildren(); toast(`${c.name} 날씨를 보여 드릴게요.`); } }, icon('cloud', 16), h('span', { class: 'grow' }, h('b', null, c.name), h('span', { class: 'small muted' }, ` ${c.region}`)))) : h('span', { class: 'small muted' }, '찾지 못했어요.'));
      } catch { toast('도시를 찾지 못했어요. 인터넷 연결을 확인하세요.'); }
    } });

    // claude
    const keyIn = h('input', { class: 'input', type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', 'aria-label': 'Claude API 키' });
    const keyStatus = h('span', { class: 'small muted' }, '확인 중…');
    const modelSel = h('select', { class: 'select', 'aria-label': '모델', onchange: () => saveConfig({ model: modelSel.value }) }, MODELS.map(([v, l]) => h('option', { value: v }, l)));
    async function loadConfig() {
      try {
        const c = await (await fetch('/api/config')).json();
        keyStatus.textContent = c.hasKey ? `키 저장됨 ${c.keyHint}${c.fromEnv ? ' (환경 변수)' : ''}` : '키가 없어요. Claude 기능을 쓰려면 키를 입력하세요.';
        modelSel.value = c.model;
      } catch { keyStatus.textContent = '하루 서버에 연결하지 못했어요.'; }
    }
    async function saveConfig(body) {
      try { await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await loadConfig(); toast('저장했어요.'); }
      catch { toast('저장하지 못했어요.'); }
    }
    loadConfig();
    const testBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
      testBtn.disabled = true; testBtn.textContent = '확인 중…';
      try { const r = await ai({ effort: 'low', max_tokens: 500, messages: [{ role: 'user', content: '한 문장으로 인사해 줘.' }] }); toast(textOf(r), { title: 'Claude 연결됨', icon: 'sparkle' }); }
      catch (e) { aiFail(e); }
      finally { testBtn.disabled = false; testBtn.textContent = '연결 테스트'; }
    } }, '연결 테스트');

    // notifications
    const perm = h('span', { class: 'small muted' });
    const paintPerm = () => { perm.textContent = !('Notification' in window) ? '이 브라우저는 알림을 지원하지 않아요' : Notification.permission === 'granted' ? '허용됨' : Notification.permission === 'denied' ? '차단됨 · 주소창 왼쪽 자물쇠에서 허용하세요' : '아직 묻지 않음'; };
    paintPerm();
    const topicIn = h('input', { class: 'input', value: S.ntfyTopic, placeholder: '예: haru-7f3k2q9x', oninput: e => { S.ntfyTopic = e.target.value.trim(); commit('settings'); } });
    const serverIn = h('input', { class: 'input', value: S.ntfyServer, oninput: e => { S.ntfyServer = e.target.value.trim() || 'https://ntfy.sh'; commit('settings'); } });

    // google
    const gStatus = h('div');
    const clientIn = h('input', { class: 'input', value: S.googleClientId, placeholder: '1234567890-xxxx.apps.googleusercontent.com', oninput: e => { S.googleClientId = e.target.value.trim(); commit('settings'); paintGoogle(); } });
    function paintGoogle() {
      gStatus.replaceChildren(googleLinked()
        ? h('div', { class: 'row' }, h('span', { class: 'chip sm ink' }, '연결됨'), h('span', { class: 'small muted grow' }, 'Gmail과 YouTube를 볼 수 있어요.'), h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { googleSignOut(); paintGoogle(); } }, '연결 해제'))
        : h('button', { class: 'btn btn-ink btn-sm', disabled: !googleConfigured(), onclick: () => googleSignIn('consent').then(() => { paintGoogle(); toast('Google 계정을 연결했어요.'); }).catch(e => toast(e.message)) }, 'Google 계정 연결'));
    }
    paintGoogle();
    ctx.on('google', paintGoogle);

    // phone access (chosen in start.bat)
    const phoneBody = h('div', null, h('span', { class: 'small muted' }, '확인 중…'));
    const phoneBox = card('휴대폰에서 열기', phoneBody);
    phoneInfo().then(phoneCard).then(n => phoneBody.replaceChildren(n));

    // install as an app
    const installBody = h('div', { class: 'col' });
    const installBox = card('앱으로 설치', installBody);
    const paintInstall = () => installBody.replaceChildren(
      isStandalone()
        ? h('div', { class: 'row' }, h('span', { class: 'chip sm ink' }, '설치됨'), h('span', { class: 'small muted' }, '지금 앱으로 실행 중이에요.'))
        : canInstall()
          ? h('button', { class: 'btn btn-ink', style: { alignSelf: 'flex-start' }, onclick: () => promptInstall() }, icon('download', 16), '이 기기에 하루 설치')
          : null,
      isStandalone() ? null : h('div', { class: 'install-steps' },
        h('div', null, h('b', null, '아이폰 · 아이패드 (Safari)'), '1. 아래쪽 공유 버튼(네모에 화살표)을 눌러요.', h('br'), '2. "홈 화면에 추가"를 눌러요.', h('br'), '3. 오른쪽 위 "추가"를 누르면 아이콘이 생겨요.'),
        h('div', null, h('b', null, '안드로이드 (Chrome · 삼성 인터넷)'), '1. 오른쪽 위 ⋮ (삼성은 아래 ≡)를 눌러요.', h('br'), '2. "앱 설치" 또는 "홈 화면에 추가"를 눌러요.', h('br'), '3. 홈 화면의 하루 아이콘으로 열어요.')),
      h('p', { class: 'tiny muted', style: { margin: 0, lineHeight: 1.6 } }, '휴대폰에서는 https 주소(설정 → 휴대폰에서 열기의 Tailscale 주소)로 열어야 앱 설치와 녹음이 돼요. 기록은 컴퓨터에 저장되고, 컴퓨터와 휴대폰에서 바꾼 내용은 서로 자동으로 반영돼요.'));
    paintInstall();
    ctx.on('installable', paintInstall);

    el.append(
      h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '설정')),
      card('화면', row('테마', '블랙 · 화이트 반전', themeSeg)),
      phoneBox, installBox,
      card('날씨 지역', h('div', { class: 'row' }, icon('cloud', 18), cityLabel, h('span', { class: 'spacer' }), S.city ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { S.city = null; commit('settings'); clearWeatherCache(); cityLabel.textContent = '현재 위치'; } }, '현재 위치 사용') : null), cityIn, cityResults),
      card('Claude',
        h('p', { class: 'small muted', style: { margin: '0 0 6px', lineHeight: 1.6 } }, 'Claude 비서, 문서 AI 모드, 이미지 캘린더 분석, 녹음 요약, 감정 추천, 식단 피드백에 쓰여요. 키는 이 컴퓨터의 data/config.json에만 저장되고 브라우저로 다시 보내지 않아요.'),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, keyIn), h('button', { class: 'btn btn-ink', onclick: () => { if (keyIn.value.trim()) { saveConfig({ apiKey: keyIn.value.trim() }); keyIn.value = ''; } } }, '저장')),
        h('div', { class: 'row wrap' }, keyStatus, h('span', { class: 'spacer' }), testBtn, h('button', { class: 'btn btn-ghost btn-sm btn-danger', onclick: () => saveConfig({ clearKey: true }) }, '키 삭제')),
        row('모델', null, h('div', { style: { width: 'min(300px, 55vw)' } }, modelSel)),
        h('div', { class: 'guide' }, 'API 키는 ', h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'), '에서 만들 수 있어요. 사용한 만큼 요금이 청구돼요.')),
      card('알림',
        row('데스크톱 알림', perm, h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await desktopNotify('하루 알림', '알림이 이렇게 떠요.'); paintPerm(); } }, '허용 · 테스트')),
        row('독촉 알림 간격', '독촉 모드 할 일을 당일에 몇 분마다 알릴지', numIn('nagInterval', 5, 240, '분')),
        row('알림 받는 시간', '이 시간 사이에만 독촉 알림이 가요', h('div', { class: 'row', style: { gap: '6px' } }, numIn('nagStart', 0, 23, '시부터'), numIn('nagEnd', 1, 24, '시까지'))),
        row('아침 일정 브리핑', '일정이 있는 날 Claude가 보내는 알림 시각', numIn('briefHour', 5, 12, '시')),
        row('일정 미리 알림', '시간이 정해진 일정', numIn('eventLead', 0, 180, '분 전')),
        row('녹음할 때 자동 받아쓰기', 'Chrome · Edge에서 동작해요', switchEl(S.sttAuto, v => { S.sttAuto = v; commit('settings'); })),
        h('div', { class: 'nav-sep', style: { margin: '10px 0' } }),
        h('h3', { class: 'h3' }, '휴대폰 알림 (ntfy)'),
        h('div', { class: 'guide' }, h('ol', null,
          h('li', null, '휴대폰에 무료 앱 ', h('b', null, 'ntfy'), '를 설치해요 (App Store · Play 스토어).'),
          h('li', null, '아래에 나만 아는 주제 이름을 정해요. 다른 사람이 추측하기 어렵게 길게 만드세요.'),
          h('li', null, 'ntfy 앱에서 + 를 누르고 같은 주제 이름을 구독해요.'),
          h('li', null, '"테스트 보내기"를 눌러 휴대폰에 알림이 오는지 확인해요.')),
          h('div', { style: { marginTop: '6px' } }, '알림은 이 컴퓨터에서 하루 서버가 켜져 있을 때 보내져요.')),
        h('label', { class: 'field' }, h('span', null, '주제 이름'), h('div', { class: 'row' }, h('div', { class: 'grow' }, topicIn),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const r = 'haru-' + crypto.getRandomValues(new Uint32Array(2)).reduce((a, n) => a + n.toString(36), ''); topicIn.value = r; S.ntfyTopic = r; commit('settings'); } }, '자동 생성'))),
        h('label', { class: 'field' }, h('span', null, 'ntfy 서버'), serverIn),
        h('button', { class: 'btn btn-ink btn-sm', style: { alignSelf: 'flex-start', marginTop: '6px' }, onclick: async () => {
          await store.flush();
          try { const r = await (await fetch('/api/notify/test', { method: 'POST' })).json(); toast(r.phone ? '휴대폰으로 보냈어요. 도착했는지 확인하세요.' : r.reason === 'no_topic' ? '주제 이름을 먼저 입력하세요.' : `보내지 못했어요 (${r.status || r.reason}).`); }
          catch { toast('하루 서버에 연결하지 못했어요.'); }
        } }, icon('bell', 14), '테스트 보내기')),
      card('Google 연동 (Gmail · YouTube)',
        h('p', { class: 'small muted', style: { margin: '0 0 6px', lineHeight: 1.6 } }, '홈 화면에 새 메일을 띄우고, 유튜브 탭에서 내 구독·재생목록·좋아요를 보려면 Google OAuth 클라이언트 ID가 필요해요. 처음 한 번만 하면 돼요.'),
        h('div', { class: 'guide' }, h('ol', null,
          h('li', null, h('a', { href: 'https://console.cloud.google.com/apis/credentials', target: '_blank', rel: 'noopener' }, 'Google Cloud 콘솔'), '에서 프로젝트를 만들어요.'),
          h('li', null, '"API 및 서비스 → 라이브러리"에서 ', h('b', null, 'Gmail API'), '와 ', h('b', null, 'YouTube Data API v3'), '를 사용 설정해요.'),
          h('li', null, 'OAuth 동의 화면을 "외부"로 만들고, 테스트 사용자에 내 Gmail 주소를 추가해요.'),
          h('li', null, '"사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션"을 만들고, 승인된 자바스크립트 원본에 ', h('code', null, location.origin), '을 넣어요.'),
          h('li', null, '만들어진 클라이언트 ID를 아래에 붙여넣어요.'))),
        h('label', { class: 'field' }, h('span', null, 'OAuth 클라이언트 ID'), clientIn),
        h('div', { style: { marginTop: '8px' } }, gStatus)),
      card('데이터',
        h('p', { class: 'small muted', style: { margin: '0 0 6px', lineHeight: 1.6 } }, '모든 기록은 이 컴퓨터의 하루 폴더 안 data/state.json에, 사진·녹음은 data/files에 저장돼요.'),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => download(new Blob([JSON.stringify(store.s, null, 1)], { type: 'application/json' }), `haru-backup-${new Date().toISOString().slice(0, 10)}.json`) }, icon('download', 14), '백업 내보내기'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
            const [f] = await pickFiles({ accept: 'application/json,.json' }); if (!f) return;
            try { const data = JSON.parse(await f.text()); if (!data.tasks || !data.settings) throw new Error(); if (!(await confirmDialog('지금 기록을 백업 파일 내용으로 바꿀까요?', { ok: '불러오기' }))) return; store.s = data; await store.flush(); location.reload(); }
            catch { toast('하루 백업 파일이 아니에요.'); }
          } }, icon('upload', 14), '백업 불러오기'),
          h('button', { class: 'btn btn-ghost btn-sm btn-danger', onclick: async () => {
            if (!(await confirmDialog('모든 기록(할 일, 메모, 일기, 식단, 문서, 레벨)을 지우고 처음부터 시작할까요? 되돌릴 수 없어요.', { ok: '모두 지우기', danger: true }))) return;
            store.s = null; store._dirty = false;
            await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'null' });
            try { localStorage.removeItem('haru.state.v1'); } catch { /* ignore */ }
            location.hash = ''; location.reload();
          } }, icon('trash', 14), '모두 지우기'))),
      card('앱으로 설치하기', h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, 'Chrome이나 Edge 주소창 오른쪽의 설치 아이콘을 누르면 하루가 별도 창의 프로그램으로 열려요. 서버는 폴더의 start.bat로 켤 수 있어요.')));
  },
};
