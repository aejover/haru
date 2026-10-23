// google.js — one Google sign-in for Gmail (unread mail on the home screen) and YouTube (your subscriptions,
// playlists and likes). Uses Google Identity Services with the OAuth client ID entered in 설정.
import { store, bus } from './core.js';

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/youtube.readonly';
const TK = 'haru.gtoken';
let tok = null;
try { tok = JSON.parse(localStorage.getItem(TK)); } catch { tok = null; }

export const googleConfigured = () => !!store.s.settings.googleClientId?.trim();
export const googleLinked = () => !!(tok && tok.exp > Date.now());
export const everLinked = () => { try { return localStorage.getItem('haru.glinked') === '1'; } catch { return false; } };

let gis;
function loadGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gis ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => { gis = null; rej(new Error('Google 로그인 스크립트를 불러오지 못했어요. 인터넷 연결을 확인하세요.')); };
    document.head.append(s);
  });
  return gis;
}

export async function googleSignIn(prompt = '') {
  const id = store.s.settings.googleClientId?.trim();
  if (!id) throw Object.assign(new Error('설정 → Google 연동에서 OAuth 클라이언트 ID를 먼저 입력하세요.'), { code: 'no_client' });
  await loadGIS();
  return new Promise((res, rej) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: id, scope: SCOPES, prompt,
      callback: r => {
        if (r.error) return rej(new Error('Google 연결이 취소됐어요.'));
        tok = { access: r.access_token, exp: Date.now() + (Number(r.expires_in) - 60) * 1000 };
        try { localStorage.setItem(TK, JSON.stringify(tok)); localStorage.setItem('haru.glinked', '1'); } catch { /* ignore */ }
        bus.emit('google', true);
        res(tok);
      },
      error_callback: e => rej(new Error(e?.type === 'popup_closed' ? 'Google 로그인 창이 닫혔어요.' : 'Google 연결에 실패했어요. 클라이언트 ID와 승인된 출처(http://localhost:5500)를 확인하세요.')),
    });
    client.requestAccessToken();
  });
}
export function googleSignOut() {
  try { if (tok && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(tok.access, () => {}); } catch { /* ignore */ }
  tok = null;
  try { localStorage.removeItem(TK); localStorage.removeItem('haru.glinked'); } catch { /* ignore */ }
  bus.emit('google', false);
}

async function gget(url) {
  if (!googleLinked()) throw Object.assign(new Error('Google 연결이 필요해요.'), { code: 'need_auth' });
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok.access } });
  if (r.status === 401) { tok = null; try { localStorage.removeItem(TK); } catch { /* ignore */ } throw Object.assign(new Error('Google 연결이 만료됐어요. 다시 연결하세요.'), { code: 'need_auth' }); }
  if (r.status === 403) throw new Error('Google API 권한이 없어요. Google Cloud에서 Gmail API와 YouTube Data API v3를 사용 설정했는지 확인하세요.');
  if (!r.ok) throw new Error(`Google API 오류 (${r.status})`);
  return r.json();
}

export async function gmailSummary() {
  const G = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const [label, list] = await Promise.all([
    gget(`${G}/labels/INBOX`),
    gget(`${G}/messages?maxResults=4&q=${encodeURIComponent('is:unread in:inbox newer_than:3d')}`),
  ]);
  const msgs = await Promise.all((list.messages || []).map(m => gget(`${G}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)));
  return {
    unread: label.messagesUnread || 0,
    recent: msgs.map(m => {
      const hd = Object.fromEntries((m.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value]));
      return { id: m.id, from: (hd.from || '').replace(/<.*>/, '').replace(/"/g, '').trim() || hd.from, subject: hd.subject || '(제목 없음)' };
    }),
  };
}

const Y = 'https://www.googleapis.com/youtube/v3';
const vid = it => ({
  id: it.contentDetails?.videoId || it.snippet?.resourceId?.videoId || it.id?.videoId || (typeof it.id === 'string' ? it.id : ''),
  title: it.snippet?.title || '', channel: it.snippet?.videoOwnerChannelTitle || it.snippet?.channelTitle || '',
  thumb: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || '',
});
export const ytApi = {
  async subs() { const d = await gget(`${Y}/subscriptions?part=snippet&mine=true&maxResults=40&order=relevance`); return d.items.map(s => ({ id: s.snippet.resourceId.channelId, title: s.snippet.title, thumb: s.snippet.thumbnails?.default?.url })); },
  async playlists() { const d = await gget(`${Y}/playlists?part=snippet,contentDetails&mine=true&maxResults=40`); return d.items.map(p => ({ list: p.id, title: p.snippet.title, count: p.contentDetails?.itemCount, thumb: p.snippet.thumbnails?.medium?.url })); },
  async liked() { const d = await gget(`${Y}/videos?part=snippet&myRating=like&maxResults=24`); return d.items.map(vid); },
  async search(q) { const d = await gget(`${Y}/search?part=snippet&type=video&maxResults=24&q=${encodeURIComponent(q)}`); return d.items.map(vid); },
  async channel(id) { const d = await gget(`${Y}/search?part=snippet&type=video&order=date&maxResults=24&channelId=${id}`); return d.items.map(vid); },
  async playlistItems(id) { const d = await gget(`${Y}/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${id}`); return d.items.map(vid).filter(v => v.id); },
};
