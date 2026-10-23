// phone.js — shows the address (and a QR code) for opening 하루 on a phone, as set up by start.bat.
import { h, icon, toast, modal } from './core.js';
import { loadScript, LIBS } from './docs/util.js';

export async function phoneInfo() {
  try { return await (await fetch('/api/phone', { cache: 'no-store' })).json(); } catch { return null; }
}

async function qrNode(url) {
  try {
    await loadScript(LIBS.qr);
    const q = window.qrcode(0, 'M'); q.addData(url); q.make();
    return h('div', { class: 'qr-box', html: q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) });
  } catch { return null; }
}

const MODE = { lan: '같은 Wi-Fi', tailscale: 'Tailscale (어디서나)' };

export async function phoneCard(p) {
  const box = h('div', { class: 'col' });
  if (!p || p.mode === 'local') {
    box.append(h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, '지금은 이 컴퓨터에서만 열려요. 휴대폰에서 쓰려면 하루를 끄고 start.bat을 다시 실행한 뒤 2번(같은 Wi-Fi) 또는 3번(Tailscale, 추천)을 고르세요.'));
    return box;
  }
  box.append(h('div', { class: 'row wrap' }, h('span', { class: 'chip sm ink' }, MODE[p.mode]), h('span', { class: 'small muted grow' }, p.message)));
  if (p.status === 'pending') box.append(h('p', { class: 'small muted' }, '주소를 확인하는 중이에요. 잠시 뒤 다시 열어 보세요.'));
  if (p.link) box.append(h('a', { class: 'btn btn-ink btn-sm', style: { alignSelf: 'flex-start' }, href: p.link, target: '_blank', rel: 'noopener' }, icon('external', 14), 'Tailscale에서 HTTPS 켜기'));
  for (const url of p.urls || []) {
    const copy = h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('주소를 복사했어요.'); } catch { toast(url); } } }, icon('copy', 14), '복사');
    const row = h('div', { class: 'row wrap', style: { alignItems: 'center', gap: '16px' } },
      h('div', { class: 'col', style: { gap: '6px', minWidth: 0, flex: '1 1 220px' } }, h('b', { class: 'num', style: { fontSize: '17px', overflowWrap: 'anywhere', userSelect: 'all' } }, url), h('div', { class: 'row' }, copy), h('span', { class: 'tiny muted' }, '휴대폰 카메라로 QR을 찍으면 바로 열려요. 열고 나서 "홈 화면에 추가"를 누르면 앱처럼 쓸 수 있어요.')));
    box.append(row);
    qrNode(url).then(n => { if (n) row.prepend(n); });
  }
  // GitHub Pages: the same app at a fixed github.io address; the QR also hands over this computer's address
  const server = p.mode === 'tailscale' && p.status === 'ready' ? p.urls[0]?.replace(/\/$/, '') : '';
  if (p.pagesUrl && server) {
    const gh = `${p.pagesUrl}?server=${encodeURIComponent(server)}`;
    const row = h('div', { class: 'row wrap', style: { alignItems: 'center', gap: '16px', borderTop: '1px solid var(--hair)', paddingTop: '12px' } },
      h('div', { class: 'col', style: { gap: '6px', minWidth: 0, flex: '1 1 220px' } },
        h('span', { class: 'chip sm line', style: { alignSelf: 'flex-start' } }, 'GitHub Pages'),
        h('b', { style: { fontSize: '16px', overflowWrap: 'anywhere', userSelect: 'all' } }, p.pagesUrl),
        h('span', { class: 'tiny muted' }, '이 QR로 열면 컴퓨터 주소가 자동으로 연결돼요. 그 뒤로는 GitHub 주소만으로 열려요.')));
    box.append(row);
    qrNode(gh).then(n => { if (n) row.prepend(n); });
  }
  if (p.urls?.length) box.append(h('p', { class: 'tiny muted', style: { margin: 0 } }, 'Gmail·유튜브 연동을 쓰면 Google Cloud의 "승인된 자바스크립트 원본"에 이 주소도 추가하세요. 컴퓨터와 하루 서버가 켜져 있어야 휴대폰에서 열려요.'));
  return box;
}

// Once per server start, on the computer itself, point out the phone address.
export async function announcePhone(tries = 6) {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;
  const p = await phoneInfo();
  if (!p || p.mode === 'local') return;
  if (p.status === 'pending') { if (tries > 0) setTimeout(() => announcePhone(tries - 1), 4000); return; }
  const key = 'haru.phoneSeen';
  const sig = p.mode + (p.urls || []).join();
  try { if (sessionStorage.getItem(key) === sig) return; sessionStorage.setItem(key, sig); } catch { /* ignore */ }
  if (p.status === 'ready' && p.urls.length) {
    toast(p.urls[0], { title: '휴대폰에서 이 주소로 열 수 있어요', icon: 'external', duration: 9000, action: { label: 'QR 보기', onClick: async () => modal({ title: '휴대폰에서 열기', body: await phoneCard(p) }) } });
  } else {
    toast(p.message, { title: '휴대폰 연결을 마치지 못했어요', icon: 'external', duration: 9000, action: { label: '설정', onClick: () => { location.hash = 'settings'; } } });
  }
}
