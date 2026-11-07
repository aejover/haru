#!/usr/bin/env node
// 하루 MCP 서버 — Claude 데스크톱 앱 · Claude Code 같은 MCP 클라이언트가 하루의 할 일 · 일정 · 메모 · 디데이를
// 읽고 쓸 수 있게 해 줘요. stdio로 동작하고(줄마다 JSON-RPC 한 개), 추가로 설치할 것이 없어요.
//
// 기록은 이렇게 찾아요:
//   1. 하루 서버(start.bat)가 켜져 있으면 그 서버의 /api/state로 읽고 써요. 열려 있는 하루 창에 곧바로 반영돼요.
//   2. 꺼져 있으면 이 폴더의 data/state.json을 직접 읽고 써요. 다음에 서버를 켜면 그대로 보여요.
// HARU_URL로 서버 주소를(기본 http://127.0.0.1:5500), HARU_DATA로 data 폴더를 바꿀 수 있어요.
// 웹 주소(workers.dev · github.io)에서 "이 기기에서만"으로 쓰는 기록은 그 브라우저 안에만 있어서 여기서는 못 봐요.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.HARU_DATA || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const SERVER = (process.env.HARU_URL || `http://127.0.0.1:${process.env.PORT || 5500}`).replace(/\/$/, '');
const VERSION = '1.0.0';
const log = (...a) => console.error('[haru-mcp]', ...a); // stdout is the protocol; notes go to stderr

// ---------- dates & tasks (same rules as the app) ----------
const pad = n => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dkey(d); };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const isKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const uid = () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex').slice(0, 6);
function applies(t, k) {
  if (t.kind === 'once') return t.date === k;
  if (t.start && k < t.start) return false;
  if (t.end && k >= t.end) return false;
  return !t.days?.length || t.days.includes(fromKey(k).getDay());
}
const eventOn = (e, k) => e.date === k || (!!e.endDate && e.date < k && k <= e.endDate);
const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99');
const fmtDay = k => { const d = fromKey(k); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };
const ddayLabel = k => { const n = Math.round((fromKey(k) - fromKey(dkey())) / 864e5); return n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`; };
const findByTitle = (list, title) => list.find(x => x.title === title) || list.find(x => x.title.includes(title) || title.includes(x.title));
const textOfHtml = html => String(html || '').replace(/<(br|\/div|\/p|\/li)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------- reading & writing the record ----------
async function viaServer() {
  try {
    const r = await fetch(SERVER + '/api/state', { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function load() {
  const remote = await viaServer();
  if (remote) return { s: remote, where: 'server' };
  try { return { s: JSON.parse(await fsp.readFile(STATE_FILE, 'utf8')), where: 'file' }; } catch { /* not created yet */ }
  throw new Error(`하루 기록을 찾지 못했어요. start.bat으로 하루 서버를 켜거나(${SERVER}), 하루를 한 번 실행해 ${STATE_FILE}을 만들어 주세요.`);
}
async function save(s, where) {
  if (where === 'server') {
    const r = await fetch(SERVER + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Haru-Client': 'mcp' }, body: JSON.stringify(s) });
    if (!r.ok) throw new Error(`하루 서버에 저장하지 못했어요 (${r.status}).`);
    return;
  }
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(s));
  try { await fsp.rename(tmp, STATE_FILE); } catch { await fsp.writeFile(STATE_FILE, JSON.stringify(s)); await fsp.rm(tmp, { force: true }); }
}
// read → change → write right away, so the window where another device could save in between stays tiny
async function change(fn) {
  const { s, where } = await load();
  s.tasks ||= []; s.events ||= []; s.memos ||= []; s.ddays ||= [];
  const out = fn(s);
  await save(s, where);
  return out;
}

// ---------- tools ----------
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD, 비우면 오늘' };
const TIME = { type: 'string', pattern: '^\\d{1,2}:\\d{2}$', description: 'HH:MM (24시간), 비우면 종일·시간 없음' };
const TOOLS = [
  {
    name: 'get_today', title: '오늘 한눈에',
    description: '오늘(또는 date)의 할 일·루틴(완료 여부 포함), 일정, 다가오는 디데이를 한 번에 가져온다. 하루 기록에 대해 답하기 전에 먼저 부르면 좋다.',
    inputSchema: { type: 'object', properties: { date: DATE } }, readOnly: true,
    run: async ({ date }) => {
      const k = date || dkey(); const { s, where } = await load();
      const tasks = (s.tasks || []).filter(t => applies(t, k)).map(t => ({ title: t.title, kind: t.kind === 'daily' ? '루틴' : '할 일', time: t.time || null, nag: t.mode === 'nag', done: !!t.done?.[k] }));
      const events = (s.events || []).filter(e => eventOn(e, k)).sort(byTime).map(evOut);
      const ddays = (s.ddays || []).filter(x => x.date >= k).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5).map(x => ({ title: x.title, date: x.date, label: ddayLabel(x.date) }));
      return { date: k, day: fmtDay(k), source: where === 'server' ? '하루 서버' : 'data/state.json', tasks, events, ddays };
    },
  },
  {
    name: 'list_tasks', title: '할 일 보기',
    description: '어느 날의 할 일과 루틴을 완료 여부와 함께 가져온다.',
    inputSchema: { type: 'object', properties: { date: DATE } }, readOnly: true,
    run: async ({ date }) => {
      const k = date || dkey(); const { s } = await load();
      return { date: k, tasks: (s.tasks || []).filter(t => applies(t, k)).map(t => ({ id: t.id, title: t.title, kind: t.kind, time: t.time || null, mode: t.mode || 'normal', category: t.cat || null, done: !!t.done?.[k] })) };
    },
  },
  {
    name: 'add_task', title: '할 일 추가',
    description: '할 일을 추가한다. kind=once는 그날 한 번, kind=daily는 매일(또는 days 요일마다) 반복하는 루틴. mode=nag(독촉)는 끝낼 때까지 휴대폰으로 계속 알린다.',
    inputSchema: {
      type: 'object', required: ['title'], properties: {
        title: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['once', 'daily'], default: 'once' }, date: DATE, time: TIME,
        mode: { type: 'string', enum: ['normal', 'nag'], default: 'normal' }, days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: '루틴 반복 요일 (0=일 … 6=토), 비우면 매일' },
        category: { type: 'string', description: '할 일 종류 (예: 운동, 공부), 비우면 공통' },
      },
    },
    run: ({ title, kind = 'once', date, time, mode = 'normal', days, category }) => change(s => {
      const t = { id: uid(), title: title.trim(), kind, mode, start: dkey(), done: {} };
      if (kind === 'once') t.date = date || dkey();
      if (time) t.time = time;
      if (kind === 'daily' && days?.length && days.length < 7) t.days = [...new Set(days)].sort();
      if (category?.trim()) t.cat = category.trim();
      s.tasks.push(t);
      return { ok: true, task: { id: t.id, title: t.title, kind: t.kind, date: t.date, time: t.time, mode: t.mode, days: t.days } };
    }),
  },
  {
    name: 'complete_task', title: '할 일 완료',
    description: '그날의 할 일이나 루틴을 완료(또는 done=false로 완료 취소) 처리한다. 제목 일부만 맞아도 찾는다.',
    inputSchema: { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 1 }, date: DATE, done: { type: 'boolean', default: true } } },
    run: ({ title, date, done = true }) => change(s => {
      const k = date || dkey();
      const list = s.tasks.filter(t => applies(t, k));
      const t = findByTitle(list, title);
      if (!t) throw new Error(`${k}에 "${title}" 할 일이 없어요. 그날 할 일: ${list.map(x => x.title).join(', ') || '(없음)'}`);
      t.done ||= {};
      if (done) t.done[k] ||= Date.now(); else delete t.done[k];
      return { ok: true, title: t.title, date: k, done };
    }),
  },
  {
    name: 'list_events', title: '일정 보기',
    description: '기간(from~to, 둘 다 포함) 안에 걸치는 캘린더 일정을 가져온다. 기본은 오늘부터 7일.',
    inputSchema: { type: 'object', properties: { from: DATE, to: DATE } }, readOnly: true,
    run: async ({ from, to }) => {
      const a = from || dkey(), b = to || addDays(a, 7); const { s } = await load();
      return { from: a, to: b, events: (s.events || []).filter(e => e.date <= b && (e.endDate || e.date) >= a).sort((x, y) => (x.date + (x.time || '')).localeCompare(y.date + (y.time || ''))).map(evOut) };
    },
  },
  {
    name: 'add_event', title: '일정 추가',
    description: '캘린더에 일정을 추가한다. 여러 날 이어지는 일정(여행, 시험 기간, 방학)은 endDate에 마지막 날을 넣는다. 일정 당일 아침에 휴대폰 브리핑이 간다.',
    inputSchema: {
      type: 'object', required: ['title', 'date'], properties: {
        title: { type: 'string', minLength: 1 }, date: { ...DATE, description: '시작일 YYYY-MM-DD' }, endDate: { ...DATE, description: '마지막 날 YYYY-MM-DD (하루짜리면 생략)' },
        time: TIME, note: { type: 'string', description: '장소, 준비물 같은 메모' },
      },
    },
    run: ({ title, date, endDate, time, note }) => change(s => {
      if (!isKey(date)) throw new Error('date는 YYYY-MM-DD 형식이어야 해요.');
      if (endDate && (!isKey(endDate) || endDate < date)) throw new Error('endDate는 시작일과 같거나 그 뒤여야 해요.');
      const ev = { id: uid(), title: title.trim(), date, ...(endDate && endDate > date ? { endDate } : {}), time: time || '', note: note || '', source: 'claude' };
      s.events.push(ev);
      return { ok: true, event: evOut(ev) };
    }),
  },
  {
    name: 'delete_event', title: '일정 삭제',
    description: '일정을 지운다. id(list_events 결과)로 지우는 것이 가장 정확하고, 없으면 title과 date로 찾는다.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, date: DATE } }, destructive: true,
    run: ({ id, title, date }) => change(s => {
      const pool = date ? s.events.filter(e => eventOn(e, date)) : s.events;
      const ev = id ? s.events.find(e => e.id === id) : title ? findByTitle(pool, title) : null;
      if (!ev) throw new Error('지울 일정을 찾지 못했어요. list_events로 id를 확인해 주세요.');
      s.events = s.events.filter(e => e !== ev);
      return { ok: true, deleted: evOut(ev) };
    }),
  },
  {
    name: 'list_memos', title: '메모 보기',
    description: '메모장의 메모를 최근 것부터 가져온다. query를 주면 제목·내용에 그 말이 들어간 메모만.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } } }, readOnly: true,
    run: async ({ query, limit = 10 }) => {
      const { s } = await load(); const q = query?.trim().toLowerCase();
      const memos = (s.memos || []).map(m => ({ id: m.id, title: m.title || '(제목 없음)', text: textOfHtml(m.html), updated: m.updatedAt ? dkey(new Date(m.updatedAt)) : null, attachments: (m.atts || []).length }))
        .filter(m => !q || (m.title + '\n' + m.text).toLowerCase().includes(q)).slice(0, limit)
        .map(m => ({ ...m, text: m.text.length > 600 ? m.text.slice(0, 600) + '…' : m.text }));
      return { count: memos.length, memos };
    },
  },
  {
    name: 'add_memo', title: '메모 쓰기',
    description: '메모장에 새 텍스트 메모를 맨 위에 추가한다. 줄바꿈은 그대로 유지된다.',
    inputSchema: { type: 'object', required: ['title', 'text'], properties: { title: { type: 'string', minLength: 1 }, text: { type: 'string' } } },
    run: ({ title, text }) => change(s => {
      const html = String(text).split('\n').map(l => `<div>${esc(l) || '<br>'}</div>`).join('');
      const m = { id: uid(), title: title.trim(), html, atts: [], drawing: null, saved: true, createdAt: Date.now(), updatedAt: Date.now() };
      s.memos.unshift(m);
      return { ok: true, id: m.id, title: m.title };
    }),
  },
  {
    name: 'add_dday', title: '디데이 만들기',
    description: '디데이를 만든다. 홈 화면 날씨 아래에 D-n으로 보인다.',
    inputSchema: { type: 'object', required: ['title', 'date'], properties: { title: { type: 'string', minLength: 1, maxLength: 20 }, date: { ...DATE, description: '그날 YYYY-MM-DD' } } },
    run: ({ title, date }) => change(s => {
      if (!isKey(date)) throw new Error('date는 YYYY-MM-DD 형식이어야 해요.');
      s.ddays.push({ id: uid(), title: title.trim(), date });
      return { ok: true, title: title.trim(), date, label: ddayLabel(date) };
    }),
  },
];
function evOut(e) {
  return { id: e.id, title: e.title, date: e.date, ...(e.endDate ? { endDate: e.endDate } : {}), time: e.time || null, note: e.note || null };
}

// ---------- JSON-RPC over stdio ----------
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'haru', title: '하루', version: VERSION },
        instructions: '하루는 사용자의 개인 생산성 앱이다(할 일·루틴, 캘린더 일정, 메모, 디데이). 날짜는 사용자의 현지 날짜 기준 YYYY-MM-DD로 주고받는다. 무엇이 있는지 물으면 먼저 get_today나 list_events로 확인하고, 추가·삭제한 뒤에는 무엇을 했는지 한두 문장으로 알려 준다.',
      });
    case 'ping': return isRequest ? reply(id, {}) : undefined;
    case 'tools/list':
      return reply(id, {
        tools: TOOLS.map(t => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, idempotentHint: !!t.readOnly, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params.name);
      if (!tool) return fail(id, -32602, `알 수 없는 도구: ${params.name}`);
      try {
        const out = await tool.run(params.arguments || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out });
      } catch (e) {
        // a tool that ran but couldn't do it is a result the model should see, not a protocol error
        return reply(id, { content: [{ type: 'text', text: e.message }], isError: true });
      }
    }
    default:
      if (method?.startsWith('notifications/')) return; // initialized, cancelled… nothing to answer
      if (isRequest) return fail(id, -32601, `지원하지 않는 메서드: ${method}`);
  }
}

let buf = '';
const pending = new Set(); // calls still running when the client closes stdin get to finish and answer
// one write at a time, in order: two quick calls must not both read the old record and undo each other
let queue = Promise.resolve();
const run = m => {
  const p = (queue = queue.then(() => handle(m)).catch(e => { log(e); if (m.id != null) fail(m.id, -32603, e.message); }));
  pending.add(p); p.finally(() => pending.delete(p));
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    for (const m of Array.isArray(msg) ? msg : [msg]) run(m);
  }
});
process.stdin.on('end', async () => { await Promise.allSettled([...pending]); process.exit(0); });
log(`ready · 서버 ${SERVER} (꺼져 있으면 ${STATE_FILE})`);
