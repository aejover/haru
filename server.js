// 하루 — local server
// Serves the app, keeps data in ./data, proxies Claude requests and sends
// scheduled reminders (desktop via SSE, phone via ntfy).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const FILES = path.join(DATA, 'files');
const STATE_FILE = path.join(DATA, 'state.json');
const CONFIG_FILE = path.join(DATA, 'config.json');
const LOG_FILE = path.join(DATA, 'sent-log.json');
const PORT = Number(process.env.PORT) || 5500;
// PHONE: local (this computer only) | lan (same Wi-Fi) | tailscale (anywhere, via a private Tailscale https address)
const PHONE = ['lan', 'tailscale'].includes(process.env.PHONE) ? process.env.PHONE : 'local';
const HOST = process.env.HOST || (PHONE === 'lan' ? '0.0.0.0' : '127.0.0.1');

fs.mkdirSync(FILES, { recursive: true });

const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

const writers = {};
function persist(file, obj) {
  const data = JSON.stringify(obj);
  writers[file] = (writers[file] || Promise.resolve()).then(async () => {
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, data);
    try { await fsp.rename(tmp, file); } catch { await fsp.writeFile(file, data); await fsp.rm(tmp, { force: true }); }
  }).catch(e => console.error('[save] failed', path.basename(file), e.message));
  return writers[file];
}

let state = readJSON(STATE_FILE, null);
let config = readJSON(CONFIG_FILE, { model: 'claude-opus-5-5' });
let sentLog = readJSON(LOG_FILE, {});
// Revision of `state`; every save bumps it so other open devices know to reload.
let rev = Date.now();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.ico': 'image/x-icon',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });

function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- static files (with Range support for audio/video seeking) ----------
async function serveFile(req, res, file) {
  let stat;
  try { stat = await fsp.stat(file); } catch { return send(res, 404, 'Not found'); }
  if (stat.isDirectory()) return serveFile(req, res, path.join(file, 'index.html'));
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size) return send(res, 416, '', { 'Content-Range': `bytes */${stat.size}` });
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function safeJoin(base, urlPath) {
  const target = path.resolve(base, '.' + decodeURIComponent(urlPath));
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

// ---------- Claude ----------
let client = null; let clientKey;
function getClient() {
  const key = config.apiKey || undefined;
  if (client && clientKey === key) return client;
  client = key ? new Anthropic({ apiKey: key }) : new Anthropic();
  clientKey = key;
  return client;
}
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

async function runClaude({ system, messages, tools, effort = 'medium', max_tokens, format }) {
  const model = config.model || 'claude-opus-5-5';
  const params = { model, messages, max_tokens: max_tokens || (tools?.length ? 16000 : 32000), output_config: { effort } };
  if (system) params.system = system;
  if (format) params.output_config.format = { type: 'json_schema', schema: format };
  if (FALLBACK_MODELS.has(model)) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
  const c = getClient();
  if (tools?.length) {
    params.tools = tools;
    return c.beta.messages.create(params);
  }
  // Long outputs (documents, slides) stream so the request never hits an HTTP timeout.
  return c.beta.messages.stream(params).finalMessage();
}

function claudeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return { status: 401, code: 'auth', message: 'Claude API 키가 올바르지 않아요. 설정에서 키를 확인하세요.' };
  if (e instanceof Anthropic.PermissionDeniedError) return { status: 403, code: 'permission', message: '이 API 키로는 선택한 모델을 쓸 수 없어요.' };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, code: 'rate', message: '요청이 많아요. 잠시 뒤 다시 시도하세요.' };
  if (e instanceof Anthropic.BadRequestError) return { status: 400, code: 'bad_request', message: '요청 형식 오류: ' + e.message };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, code: 'network', message: 'Claude 서버에 연결하지 못했어요. 인터넷 연결을 확인하세요.' };
  if (e instanceof Anthropic.APIError) return { status: e.status || 500, code: 'api', message: `Claude 오류 (${e.status}): ${e.message}` };
  if (/api.?key|apiKey|authToken|credentials/i.test(e.message || '')) return { status: 401, code: 'no_key', message: 'Claude API 키가 없어요. 설정 → Claude에서 키를 입력하세요.' };
  return { status: 500, code: 'unknown', message: e.message || '알 수 없는 오류' };
}

// ---------- notifications ----------
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}
setInterval(() => { for (const res of sseClients) res.write(': ping\n\n'); }, 25000);

async function pushNotify({ title, message, tags = ['bell'], priority = 3, kind = 'info', ref }) {
  broadcast('notify', { title, message, kind, ref });
  const topic = state?.settings?.ntfyTopic?.trim();
  if (!topic) return { phone: false, reason: 'no_topic' };
  const server = (state.settings.ntfyServer || 'https://ntfy.sh').trim().replace(/\/+$/, '');
  try {
    const r = await fetch(server + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, title, message, tags, priority }),
    });
    return { phone: r.ok, status: r.status };
  } catch (e) {
    console.error('[ntfy] failed', e.message);
    return { phone: false, reason: e.message };
  }
}

const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dkey(d); };
const dayDiff = (a, b) => Math.round((fromKey(a) - fromKey(b)) / 86400000);
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

function applies(t, k) {
  if (t.kind === 'once') return t.date === k;
  if (t.start && k < t.start) return false;
  if (t.end && k >= t.end) return false;
  return !t.days?.length || t.days.includes(fromKey(k).getDay());
}
const ESCALATE = n => (n >= 3 ? 10 : n === 2 ? 5 : n === 1 ? 3 : 0);

function evenSlots(n, startMin, endMin) {
  if (n <= 1) return [startMin];
  return Array.from({ length: n }, (_, i) => Math.round(startMin + (i * (endMin - startMin)) / (n - 1)));
}

function nagSlots(t, today, s) {
  const startMin = (s.nagStart ?? 9) * 60;
  const endMin = (s.nagEnd ?? 22) * 60;
  const every = Math.max(5, Number(s.nagInterval) || 60);
  const slots = [];
  const repeatToday = () => {
    const from = Math.max(startMin, toMin(t.time) ?? startMin);
    for (let m = from, i = 0; m <= endMin; m += every, i++) slots.push({ at: m, key: `nag|${t.id}|${today}|r${i}`, overdue: 0 });
  };
  const escalate = (days) => {
    const n = ESCALATE(days);
    evenSlots(n, startMin, endMin).forEach((m, i) => slots.push({ at: m, key: `nag|${t.id}|${today}|e${i}`, overdue: days, idx: i + 1, n }));
  };
  if (t.kind === 'once') {
    if (!t.date || t.done?.[t.date] || today < t.date) return slots;
    const od = dayDiff(today, t.date);
    if (od === 0) repeatToday(); else escalate(od);
    return slots;
  }
  if (applies(t, today) && !t.done?.[today]) repeatToday();
  let streak = 0; let k = addDays(today, -1);
  for (let i = 0; i < 14 && (!t.start || k >= t.start); i++, k = addDays(k, -1)) {
    if (!applies(t, k)) continue;
    if (t.done?.[k]) break;
    streak++;
  }
  if (streak > 0 && !t.done?.[today]) escalate(streak);
  return slots;
}

let briefingBusy = false;
async function tick() {
  if (!state) return;
  const s = state.settings || {};
  const now = new Date();
  const today = dkey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const fresh = at => at <= nowMin && nowMin - at < 15;
  let dirty = false;

  for (const t of state.tasks || []) {
    if (t.mode !== 'nag') continue;
    const due = nagSlots(t, today, s).filter(x => fresh(x.at) && !sentLog[x.key]);
    const slot = due[due.length - 1];
    if (!slot) continue;
    due.forEach(x => { sentLog[x.key] = Date.now(); });
    dirty = true;
    const message = slot.overdue
      ? `"${t.title}" ${slot.overdue}일째 밀렸어요. 오늘 ${slot.idx}/${slot.n}번째 알림이에요.`
      : `"${t.title}" 아직 안 했어요. 지금 끝내 볼까요?`;
    pushNotify({ title: slot.overdue ? '밀린 할 일' : '할 일 독촉', message, tags: ['rotating_light'], priority: slot.overdue >= 2 ? 5 : 4, kind: 'nag', ref: t.id });
  }

  // 할 일 미리 알림: a task with a time rings this long before it (its own setting, else the default, else 1시간)
  const taskLead = Number(s.taskLead ?? 60);
  for (const t of state.tasks || []) {
    if (!t.time || !applies(t, today) || t.done?.[today]) continue;
    const before = t.remind ?? taskLead;
    if (before < 0) continue;
    const at = toMin(t.time) - before;
    const key = `tk|${t.id}|${today}`;
    if (at != null && at >= 0 && fresh(at) && !sentLog[key]) {
      sentLog[key] = Date.now(); dirty = true;
      const left = before % 60 ? `${before}분` : `${before / 60}시간`;
      pushNotify({ title: before ? '곧 할 일이 있어요' : '할 일 시간이에요', message: `${t.time} ${t.title}${before ? ` · ${left} 남았어요` : ''}`, tags: ['spiral_notepad'], priority: 4, kind: 'task', ref: t.id });
    }
  }

  const lead = Number(s.eventLead ?? 30);
  for (const ev of state.events || []) {
    if (ev.date !== today || !ev.time) continue;
    const at = toMin(ev.time) - lead;
    const key = `ev|${ev.id}|${today}`;
    if (at != null && fresh(at) && !sentLog[key]) {
      sentLog[key] = Date.now(); dirty = true;
      pushNotify({ title: '곧 일정이 있어요', message: `${ev.time} ${ev.title}`, tags: ['calendar'], priority: 4, kind: 'event', ref: ev.id });
    }
  }

  // power nap: push to the phone when the nap ends (the app itself plays the sound when it's open)
  const nap = state.nap;
  if (nap?.end && Date.now() >= nap.end && Date.now() - nap.end < 5 * 60e3) {
    const key = `nap|${nap.end}`;
    if (!sentLog[key]) {
      sentLog[key] = Date.now(); dirty = true;
      pushNotify({ title: '파워냅 끝', message: `${nap.min}분 잤어요. 일어날 시간이에요!${nap.math ? ' 하루를 열어 문제를 풀어야 꺼져요.' : ''}`, tags: ['alarm_clock'], priority: 5, kind: 'alarm', ref: 'nap' });
    }
  }

  const briefAt = Number(s.briefHour ?? 8) * 60;
  const briefKey = `brief|${today}`;
  if (!sentLog[briefKey] && nowMin >= briefAt && nowMin - briefAt < 90 && !briefingBusy) {
    const events = (state.events || []).filter(e => e.date === today).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    if (events.length) {
      sentLog[briefKey] = Date.now(); dirty = true; briefingBusy = true;
      sendBriefing(events, today).finally(() => { briefingBusy = false; });
    }
  }

  if (dirty) {
    const cutoff = addDays(today, -14);
    for (const k of Object.keys(sentLog)) { const d = /\d{4}-\d{2}-\d{2}/.exec(k)?.[0]; if (d && d < cutoff) delete sentLog[k]; }
    persist(LOG_FILE, sentLog);
  }
}

async function sendBriefing(events, today) {
  const lines = events.map(e => `${e.time || '종일'} ${e.title}${e.note ? ` (${e.note})` : ''}`);
  const name = state.profile?.name || '';
  let message = `오늘 일정 ${events.length}개\n` + lines.join('\n');
  try {
    const msg = await runClaude({
      effort: 'low', max_tokens: 2000,
      system: '너는 사용자의 생산성 앱 속 비서 Claude야. 아침 휴대폰 알림에 들어갈 짧은 한국어 브리핑을 쓴다. 3문장 이내, 이모지 없이, 따뜻하고 간결하게. 일정 목록을 빠짐없이 시간순으로 언급한다.',
      messages: [{ role: 'user', content: `오늘은 ${today}. 사용자 이름: ${name || '(없음)'}\n오늘 일정:\n${lines.join('\n')}` }],
    });
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (msg.stop_reason !== 'refusal' && text) message = text;
  } catch (e) { /* no key or offline: send the plain list */ }
  pushNotify({ title: 'Claude · 오늘의 일정', message, tags: ['sunrise'], priority: 4, kind: 'briefing' });
}
setInterval(() => tick().catch(e => console.error('[tick]', e)), 30000);
setTimeout(() => tick().catch(() => {}), 3000);

// ---------- routes ----------
async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/state' && req.method === 'GET') return send(res, 200, JSON.stringify(state), { 'Content-Type': 'application/json; charset=utf-8', 'X-Haru-Rev': String(rev) });
  if (p === '/api/rev' && req.method === 'GET') return json(res, 200, { rev });
  if (p === '/api/state' && (req.method === 'PUT' || req.method === 'POST')) {
    const body = await readBody(req);
    state = JSON.parse(body.toString('utf8'));
    persist(STATE_FILE, state);
    rev++;
    broadcast('state', { rev, from: req.headers['x-haru-client'] || '' });
    return json(res, 200, { ok: true, rev });
  }
  if (p === '/api/upload' && req.method === 'POST') {
    const name = (url.searchParams.get('name') || 'file').slice(0, 160);
    const ext = (path.extname(name) || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16) + ext;
    const body = await readBody(req, 200 * 1024 * 1024);
    await fsp.writeFile(path.join(FILES, id), body);
    return json(res, 200, { url: '/files/' + id, name, size: body.length, type: req.headers['content-type'] || '' });
  }
  // a photo/recording synced from a paired device: saved under the same id its records use
  const fileM = /^\/api\/files\/([A-Za-z0-9._-]{1,80})$/.exec(p);
  if (fileM && req.method === 'PUT') {
    const file = path.join(FILES, fileM[1]);
    if (fs.existsSync(file)) return json(res, 200, { ok: true, existed: true });
    await fsp.writeFile(file, await readBody(req, 200 * 1024 * 1024));
    return json(res, 200, { ok: true });
  }
  if (p === '/api/config' && req.method === 'GET') {
    const key = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    return json(res, 200, { hasKey: !!key, keyHint: key ? '••••' + key.slice(-4) : '', fromEnv: !config.apiKey && !!process.env.ANTHROPIC_API_KEY, model: config.model || 'claude-opus-5-5' });
  }
  if (p === '/api/config' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) config.apiKey = body.apiKey.trim();
    if (body.clearKey) delete config.apiKey;
    if (typeof body.model === 'string' && /^claude-[a-z0-9-]+$/.test(body.model)) config.model = body.model;
    if (typeof body.pagesUrl === 'string') {
      const v = body.pagesUrl.trim();
      if (!v) delete config.pagesUrl;
      else if (/^https:\/\/[a-z0-9-]+\.github\.io(\/[\w.-]*)*\/?$/i.test(v)) config.pagesUrl = v.endsWith('/') ? v : v + '/';
    }
    client = null;
    await persist(CONFIG_FILE, config);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/ai' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    try {
      const msg = await runClaude(body);
      return json(res, 200, { content: msg.content, stop_reason: msg.stop_reason, stop_details: msg.stop_details ?? null, model: msg.model, usage: msg.usage });
    } catch (e) {
      const err = claudeError(e);
      console.error('[claude]', err.code, err.message);
      return json(res, err.status, err);
    }
  }
  if (p === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (p === '/api/phone' && req.method === 'GET') return json(res, 200, { ...phone, pagesUrl: config.pagesUrl || '' });
  if (p === '/api/notify/test' && req.method === 'POST') {
    const r = await pushNotify({ title: '하루 알림 테스트', message: '이 알림이 보이면 휴대폰 알림이 연결된 거예요.', tags: ['white_check_mark'], kind: 'test' });
    return json(res, 200, r);
  }
  return json(res, 404, { error: 'not_found' });
}

// The app screen may also be opened from GitHub Pages; only that one address (plus local test
// pages) may read and write data from the browser.
function allowedOrigin(origin) {
  if (!origin) return false;
  if (config.pagesUrl) { try { if (new URL(config.pagesUrl).origin === origin) return true; } catch { /* bad url */ } }
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const origin = req.headers.origin;
  if (allowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Haru-Client');
    res.setHeader('Access-Control-Expose-Headers', 'X-Haru-Rev');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (req.method === 'OPTIONS') return send(res, allowedOrigin(origin) ? 204 : 403, '');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/files/')) {
      const file = safeJoin(FILES, url.pathname.slice('/files'.length));
      return file ? serveFile(req, res, file) : send(res, 403, 'Forbidden');
    }
    const file = safeJoin(PUBLIC, url.pathname === '/' ? '/index.html' : url.pathname);
    return file ? serveFile(req, res, file) : send(res, 403, 'Forbidden');
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.message });
  }
});

// ---------- phone access ----------
let phone = { mode: PHONE, urls: [], status: PHONE === 'local' ? 'off' : 'pending', message: '' };

function lanUrls() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      if (/vethernet|virtualbox|vmware|wsl|hyper-v|tailscale/i.test(name) || a.address.startsWith('100.')) continue;
      out.push(`http://${a.address}:${PORT}/`);
    }
  }
  return out;
}

function runTailscale(args, timeout = 20000) {
  const bins = ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
  return new Promise(resolve => {
    const tryBin = i => {
      if (i >= bins.length) return resolve({ missing: true });
      execFile(bins[i], args, { timeout, windowsHide: true }, (err, stdout = '', stderr = '') => {
        if (err && err.code === 'ENOENT') return tryBin(i + 1);
        resolve({ ok: !err, out: `${stdout}\n${stderr}` });
      });
    };
    tryBin(0);
  });
}

async function setupPhone() {
  if (PHONE === 'lan') {
    phone.urls = lanUrls();
    phone.status = phone.urls.length ? 'ready' : 'error';
    phone.message = phone.urls.length ? '같은 Wi-Fi에 연결된 휴대폰에서 열 수 있어요. https가 아니라서 휴대폰에서는 녹음·받아쓰기·앱 설치가 안 돼요.' : 'Wi-Fi 주소를 찾지 못했어요. 컴퓨터가 네트워크에 연결되어 있는지 확인하세요.';
  }
  if (PHONE === 'tailscale') {
    const serve = await runTailscale(['serve', '--bg', String(PORT)]);
    if (serve.missing) {
      phone.status = 'error';
      phone.message = 'Tailscale이 설치되어 있지 않아요. https://tailscale.com/download 에서 설치하고 로그인한 다음 다시 실행하세요.';
    } else {
      const link = /https:\/\/login\.tailscale\.com\/\S+/.exec(serve.out)?.[0];
      const st = await runTailscale(['status', '--json'], 8000);
      let dns = '';
      try { dns = JSON.parse(st.out.slice(st.out.indexOf('{'))).Self?.DNSName?.replace(/\.$/, '') || ''; } catch { /* not logged in */ }
      if (link && !serve.ok) {
        phone.status = 'needs_https';
        phone.message = '처음 한 번, 아래 링크에서 HTTPS 사용을 켜 주세요. 켠 뒤 start.bat을 다시 실행하면 돼요.';
        phone.link = link;
      } else if (!dns) {
        phone.status = 'error';
        phone.message = 'Tailscale에 로그인되어 있지 않아요. 작업 표시줄의 Tailscale 아이콘에서 로그인하세요.';
      } else {
        phone.urls = [`https://${dns}/`];
        phone.status = 'ready';
        phone.message = '휴대폰에 Tailscale 앱을 설치하고 같은 계정으로 연결하면, 어디서든 이 주소로 열 수 있어요.';
      }
    }
  }
  if (PHONE !== 'local') {
    console.log(phone.status === 'ready'
      ? `  휴대폰 주소 →  ${phone.urls.join('   ')}\n  ${phone.message}\n`
      : `  휴대폰 연결 안 됨: ${phone.message}${phone.link ? '\n  ' + phone.link : ''}\n`);
  }
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log(`\n  하루가 이미 실행 중이에요 →  http://localhost:${PORT}\n`); process.exit(0); }
  throw e;
});
server.listen(PORT, HOST, () => {
  console.log(`\n  하루 실행 중 →  http://localhost:${PORT}\n  (종료: Ctrl+C)\n`);
  setupPhone().catch(e => { phone.status = 'error'; phone.message = e.message; });
});
