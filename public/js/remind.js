// remind.js — reminders for the "이 기기에서만" mode. With no 하루 server running, this window does what the
// server's scheduler does: 독촉 할 일 alerts (escalating when they slip) and 일정 미리 알림, on screen and,
// if a topic is set, to the phone through ntfy. It only runs while 하루 is open somewhere on this device.
import { store, dkey, addDays, fromKey, applies } from './core.js';

const LOG_KEY = 'haru.sentLog';
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const dayDiff = (a, b) => Math.round((fromKey(a) - fromKey(b)) / 864e5);
const ESCALATE = n => (n >= 3 ? 10 : n === 2 ? 5 : n === 1 ? 3 : 0);
const evenSlots = (n, a, b) => (n <= 1 ? [a] : Array.from({ length: n }, (_, i) => Math.round(a + (i * (b - a)) / (n - 1))));

// same schedule as the server: repeat every N minutes on the day, then 3·5·10 times a day once it slips
function nagSlots(t, today, s) {
  const startMin = (s.nagStart ?? 9) * 60, endMin = (s.nagEnd ?? 22) * 60;
  const every = Math.max(5, Number(s.nagInterval) || 60);
  const slots = [];
  const repeatToday = () => { for (let m = Math.max(startMin, toMin(t.time) ?? startMin), i = 0; m <= endMin; m += every, i++) slots.push({ at: m, key: `nag|${t.id}|${today}|r${i}`, overdue: 0 }); };
  const escalate = days => { const n = ESCALATE(days); evenSlots(n, startMin, endMin).forEach((m, i) => slots.push({ at: m, key: `nag|${t.id}|${today}|e${i}`, overdue: days, idx: i + 1, n })); };
  if (t.kind === 'once') {
    if (!t.date || t.done?.[t.date] || today < t.date) return slots;
    const od = dayDiff(today, t.date);
    if (od === 0) repeatToday(); else escalate(od);
    return slots;
  }
  if (applies(t, today) && !t.done?.[today]) repeatToday();
  let streak = 0;
  for (let k = addDays(today, -1), i = 0; i < 14 && (!t.start || k >= t.start); i++, k = addDays(k, -1)) {
    if (!applies(t, k)) continue;
    if (t.done?.[k]) break;
    streak++;
  }
  if (streak > 0 && !t.done?.[today]) escalate(streak);
  return slots;
}

export async function sendNtfy(settings, { title, message, tags = ['bell'], priority = 3 }) {
  const topic = settings?.ntfyTopic?.trim();
  if (!topic) return { phone: false, reason: 'no_topic' };
  const server = (settings.ntfyServer || 'https://ntfy.sh').trim().replace(/\/+$/, '');
  try {
    const r = await fetch(server + '/', { method: 'POST', body: JSON.stringify({ topic, title, message, tags, priority }) });
    return { phone: r.ok, status: r.status };
  } catch (e) { return { phone: false, reason: e.message }; }
}

let sent = {};
const loadLog = () => { try { sent = JSON.parse(localStorage.getItem(LOG_KEY)) || {}; } catch { sent = {}; } };
const saveLog = () => { try { localStorage.setItem(LOG_KEY, JSON.stringify(sent)); } catch { /* ignore */ } };

function tick(notify) {
  const st = store.s; if (!st) return;
  loadLog(); // another 하루 window on this device may have sent some already
  const s = st.settings || {};
  const now = new Date(), today = dkey(now), nowMin = now.getHours() * 60 + now.getMinutes();
  const fresh = at => at <= nowMin && nowMin - at < 15;
  const out = [];
  for (const t of st.tasks || []) {
    if (t.mode !== 'nag') continue;
    const due = nagSlots(t, today, s).filter(x => fresh(x.at) && !sent[x.key]);
    const slot = due[due.length - 1];
    if (!slot) continue;
    due.forEach(x => { sent[x.key] = Date.now(); });
    out.push({ title: slot.overdue ? '밀린 할 일' : '할 일 독촉', message: slot.overdue ? `"${t.title}" ${slot.overdue}일째 밀렸어요. 오늘 ${slot.idx}/${slot.n}번째 알림이에요.` : `"${t.title}" 아직 안 했어요. 지금 끝내 볼까요?`, tags: ['rotating_light'], priority: slot.overdue >= 2 ? 5 : 4, kind: 'nag' });
  }
  const lead = Number(s.eventLead ?? 30);
  for (const ev of st.events || []) {
    if (ev.date !== today || !ev.time) continue;
    const at = toMin(ev.time) - lead, key = `ev|${ev.id}|${today}`;
    if (at != null && fresh(at) && !sent[key]) { sent[key] = Date.now(); out.push({ title: '곧 일정이 있어요', message: `${ev.time} ${ev.title}`, tags: ['calendar'], priority: 4, kind: 'event' }); }
  }
  if (!out.length) return;
  const cutoff = addDays(today, -3);
  for (const k of Object.keys(sent)) { const d = /\d{4}-\d{2}-\d{2}/.exec(k)?.[0]; if (d && d < cutoff) delete sent[k]; }
  saveLog();
  for (const d of out) { notify(d); sendNtfy(s, d); }
}

export function startReminders(notify) {
  const run = () => { try { tick(notify); } catch (e) { console.error(e); } };
  setTimeout(run, 3000);
  setInterval(run, 30e3);
}
