// assistant.js — the Claude button (bottom-right on every tab). Chat + tools that act on the app.
import {
  $, h, icon, clawdSVG, store, commit, bus, uid, dkey, addDays, WEEK, pad, ai, textOf, fileToBlock, pickFiles,
  addTask, setDone, tasksOn, isDone, dayStats, weekStats, mondayOf, levelInfo, tierInfo, record, gainXP,
} from './core.js';
import { start as pomoStart, pause as pomoPause, reset as pomoReset, setMode } from './pomodoro.js';
import { play as ytPlay, parseYT } from './youtube.js';

const TABS = ['home', 'memo', 'calendar', 'timetable', 'pomodoro', 'youtube', 'docs', 'checklist', 'diary', 'diet', 'growth', 'profile', 'settings'];
const DATE = { type: 'string', description: 'YYYY-MM-DD 형식 날짜' };
const TOOLS = [
  { name: 'add_task', description: '할 일 또는 매일 하는 루틴을 추가한다. kind=once는 특정 날짜에 한 번, daily는 매일(또는 days 요일마다) 반복. mode=nag는 안 하면 계속 알림을 보내는 독촉 모드.', input_schema: { type: 'object', properties: { title: { type: 'string' }, kind: { type: 'string', enum: ['once', 'daily'] }, date: DATE, time: { type: 'string', description: 'HH:MM' }, mode: { type: 'string', enum: ['normal', 'nag'] }, days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: '반복 요일 (0=일요일 … 6=토요일). 비우면 매일' } }, required: ['title', 'kind'] } },
  { name: 'complete_task', description: '제목이 일치하거나 포함된 할 일을 완료(또는 완료 취소) 처리한다.', input_schema: { type: 'object', properties: { title: { type: 'string' }, date: DATE, done: { type: 'boolean' } }, required: ['title'] } },
  { name: 'list_tasks', description: '특정 날짜의 할 일·루틴과 완료 여부를 가져온다.', input_schema: { type: 'object', properties: { date: DATE } } },
  { name: 'add_event', description: '캘린더에 일정을 추가한다. 일정 당일 아침에 휴대폰 알림이 간다.', input_schema: { type: 'object', properties: { title: { type: 'string' }, date: DATE, time: { type: 'string', description: 'HH:MM, 종일이면 생략' }, note: { type: 'string' } }, required: ['title', 'date'] } },
  { name: 'list_events', description: '기간 안의 캘린더 일정을 가져온다.', input_schema: { type: 'object', properties: { from: DATE, to: DATE } } },
  { name: 'add_memo', description: '메모장에 새 메모를 만든다.', input_schema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] } },
  { name: 'write_diary', description: '일기를 작성하거나 같은 날짜의 일기를 덮어쓴다. rating: 5=최고의 날, 4=좋은 날, 3=보통 날, 2=안 좋은 날, 1=최악의 날.', input_schema: { type: 'object', properties: { date: DATE, title: { type: 'string' }, body: { type: 'string' }, emotion: { type: 'string' }, rating: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['title', 'body'] } },
  { name: 'log_meal', description: '식단에 먹은 음식을 기록한다. 영양 정보는 1회 제공량 기준 추정치를 넣는다.', input_schema: { type: 'object', properties: { name: { type: 'string' }, meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] }, kcal: { type: 'number' }, carb: { type: 'number' }, protein: { type: 'number' }, fat: { type: 'number' }, date: DATE }, required: ['name', 'meal', 'kcal', 'carb', 'protein', 'fat'] } },
  { name: 'pomodoro', description: '뽀모도로 타이머를 조작한다.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'pause', 'reset', 'break'] }, minutes: { type: 'integer', minimum: 1, maximum: 180 } }, required: ['action'] } },
  { name: 'set_motivation', description: '홈 화면의 동기부여 문구를 바꾼다.', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'get_stats', description: '오늘/어제 완료율, 이번 주/지난주 비교, 집중 시간, 레벨·티어·전적을 가져온다.', input_schema: { type: 'object', properties: {} } },
  { name: 'play_youtube', description: '유튜브 링크를 재생한다.', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'open_tab', description: '앱의 다른 탭으로 이동한다.', input_schema: { type: 'object', properties: { tab: { type: 'string', enum: TABS } }, required: ['tab'] } },
];

const SYSTEM = `너는 '하루'라는 개인 생산성 앱 안에 사는 비서 Claude야. 사용자는 한국어를 쓴다.
앱에는 홈(시계·날씨·할 일), 메모장, 캘린더, 뽀모도로, 유튜브·라디오, 문서 작업(워드·한글·엑셀·PPT), 오늘 할 일(체크리스트, 독촉 모드), 일기, 식단, 커리큘럼(성장 통계), 프로필, 설정 탭이 있다.
사용자가 무언가를 해 달라고 하면 도구를 써서 직접 처리하고, 처리한 내용을 한두 문장으로 알려 준다. 날짜는 메시지 앞의 [지금: …] 정보를 기준으로 계산한다.
질문에는 짧고 분명하게, 친근한 존댓말로 답한다. 목록이 필요할 때만 줄바꿈 목록을 쓰고, 마크다운 제목이나 표는 쓰지 않는다.
정보가 부족해 도구를 쓸 수 없으면 추측하지 말고 무엇이 필요한지 묻는다. 문서 작성은 문서 작업 탭의 AI 모드에서 하면 문서에 바로 반영된다고 안내한다.`;

const SUGGEST = {
  home: ['오늘 할 일 정리해줘', '내일 오전 10시 회의 일정 넣어줘', '나 어제보다 성장했어?'],
  calendar: ['이번 주 일정 알려줘', '매주 월수금 7시 운동 루틴 추가', '금요일 저녁 7시 약속 추가'],
  checklist: ['매일 밤 10시 약 먹기, 독촉 모드로', '오늘 남은 할 일 뭐야?'],
  pomodoro: ['50분 집중 시작', '오늘 집중 시간 얼마나 돼?'],
  diary: ['오늘 일기 쓰는 것 좀 도와줘', '이번 달 기분이 어땠는지 요약해줘'],
  diet: ['점심에 김치찌개랑 공깃밥 먹었어', '단백질 많은 저녁 메뉴 추천'],
  growth: ['이번 주 지난주랑 비교해줘', '티어 올리려면 뭘 해야 해?'],
  memo: ['회의록 양식 메모 만들어줘', '오늘 장 볼 목록 메모해줘'],
  docs: ['자기소개서 구조 짜는 법 알려줘'],
  youtube: ['집중할 때 들을 만한 음악 장르 추천'],
};

let history = [];
let busy = false;
let attachments = [];
let api = null;

function ctxLine() {
  const d = new Date();
  return `지금: ${dkey(d)} (${WEEK[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())} · 현재 탭: ${api.viewTitle(api.currentView()) || '홈'}`;
}

function runTool(name, input) {
  const s = store.s; const today = dkey();
  switch (name) {
    case 'add_task': {
      const t = addTask({ title: input.title, kind: input.kind, date: input.date || today, time: input.time, mode: input.mode, days: input.days });
      return { ok: true, id: t.id, summary: `${t.kind === 'daily' ? '루틴' : t.date + ' 할 일'} "${t.title}"${t.mode === 'nag' ? ' (독촉 모드)' : ''}` };
    }
    case 'complete_task': {
      const k = input.date || today;
      const list = tasksOn(k);
      const t = list.find(x => x.title === input.title) || list.find(x => x.title.includes(input.title) || input.title.includes(x.title));
      if (!t) return { ok: false, error: '해당 날짜에 그런 할 일이 없어요.', tasks: list.map(x => x.title) };
      setDone(t, k, input.done !== false);
      return { ok: true, title: t.title, done: input.done !== false };
    }
    case 'list_tasks': {
      const k = input.date || today;
      return { date: k, tasks: tasksOn(k).map(t => ({ title: t.title, kind: t.kind, time: t.time || null, mode: t.mode, done: isDone(t, k) })) };
    }
    case 'add_event': {
      const ev = { id: uid(), title: input.title, date: input.date, time: input.time || '', note: input.note || '', source: 'claude' };
      s.events.push(ev); gainXP('calendar'); commit('events');
      return { ok: true, event: ev };
    }
    case 'list_events': {
      const from = input.from || today, to = input.to || addDays(from, 7);
      return { events: s.events.filter(e => e.date >= from && e.date <= to).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).map(e => ({ title: e.title, date: e.date, time: e.time, note: e.note })) };
    }
    case 'add_memo': {
      const html = String(input.text).split('\n').map(l => `<div>${l.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) || '<br>'}</div>`).join('');
      s.memos.unshift({ id: uid(), title: input.title, html, atts: [], drawing: null, saved: true, createdAt: Date.now(), updatedAt: Date.now() });
      gainXP('memo'); commit('memos');
      return { ok: true };
    }
    case 'write_diary': {
      const date = input.date || today;
      let e = s.diary.find(x => x.date === date);
      if (!e) { e = { id: uid(), date, media: [], createdAt: Date.now() }; s.diary.push(e); }
      Object.assign(e, { title: input.title, body: input.body, emotion: input.emotion ?? e.emotion ?? '', rating: input.rating ?? e.rating ?? 3, updatedAt: Date.now() });
      gainXP('diary'); commit('diary');
      return { ok: true, date };
    }
    case 'log_meal': {
      const date = input.date || today;
      (s.diet.logs[date] ||= []).push({ id: uid(), name: input.name, meal: input.meal, qty: 1, kcal: +input.kcal || 0, carb: +input.carb || 0, protein: +input.protein || 0, fat: +input.fat || 0 });
      gainXP('diet'); commit('diet');
      return { ok: true };
    }
    case 'pomodoro': {
      if (input.minutes && input.action === 'start') { s.pomoCfg.focus = input.minutes; setMode('focus'); }
      if (input.action === 'break') setMode('short');
      if (input.action === 'start' || input.action === 'break') pomoStart();
      if (input.action === 'pause') pomoPause();
      if (input.action === 'reset') pomoReset();
      return { ok: true, mode: s.pomo.mode, running: s.pomo.running };
    }
    case 'set_motivation': { s.profile.motivation = input.text; commit('profile'); return { ok: true }; }
    case 'get_stats': {
      const t = dayStats(today), y = dayStats(addDays(today, -1));
      const mon = mondayOf(today), w = weekStats(mon), lw = weekStats(addDays(mon, -7));
      const lv = levelInfo(s.xp.total), tr = tierInfo(s.tier.lp), rc = record();
      const r = x => ({ done: x.done, total: x.total, pct: Math.round(x.pct), focusMin: Math.round(x.focus / 60) });
      return { today: r(t), yesterday: r(y), thisWeek: r(w), lastWeek: r(lw), level: lv.level, xp: s.xp.total, tier: tr.label, lp: tr.lp, record: `${rc.w}승 ${rc.l}패 ${rc.d}무` };
    }
    case 'play_youtube': {
      const p = parseYT(input.url);
      if (!p) return { ok: false, error: '유튜브 링크가 아니에요.' };
      ytPlay(p); return { ok: true };
    }
    case 'open_tab': { api.go(input.tab); return { ok: true }; }
    default: throw new Error('알 수 없는 도구: ' + name);
  }
}
const TOOL_LABEL = { add_task: '할 일 추가', complete_task: '완료 처리', list_tasks: '할 일 확인', add_event: '일정 추가', list_events: '일정 확인', add_memo: '메모 작성', write_diary: '일기 작성', log_meal: '식단 기록', pomodoro: '뽀모도로', set_motivation: '문구 변경', get_stats: '통계 확인', play_youtube: '유튜브 재생', open_tab: '탭 이동' };

export function initAssistant(shell) {
  api = shell;
  const fab = $('#claude-fab'), sheet = $('#claude-sheet');
  fab.innerHTML = clawdSVG(44);
  const msgs = h('div', { class: 'cs-msgs', 'aria-live': 'polite' });
  const sugs = h('div', { class: 'cs-sugs' });
  const attachRow = h('div', { class: 'cs-attach' });
  const input = h('textarea', { rows: 1, placeholder: 'Claude에게 물어보거나 일을 시켜 보세요', 'aria-label': 'Claude에게 보낼 메시지' });
  const sendBtn = h('button', { class: 'btn-icon on', 'aria-label': '보내기', onclick: () => submit() }, icon('send', 18));
  const ctxEl = h('div', { class: 'ctx' });
  sheet.append(
    h('div', { class: 'cs-head' }, h('span', { html: clawdSVG(30) }), h('div', { class: 'grow' }, h('div', { class: 't' }, 'Claude'), ctxEl),
      h('button', { class: 'btn-icon sm', title: '대화 지우기', 'aria-label': '대화 지우기', onclick: clear }, icon('refresh', 16)),
      h('button', { class: 'btn-icon sm', 'aria-label': '닫기', onclick: close }, icon('x', 18))),
    msgs, sugs, attachRow,
    h('div', { class: 'cs-input' },
      h('button', { class: 'btn-icon', 'aria-label': '사진·파일 첨부', title: '사진·PDF·텍스트 첨부', onclick: async () => { attachments.push(...await pickFiles({ accept: 'image/*,application/pdf,.txt,.md,.csv', multiple: true })); paintAttach(); } }, icon('clip', 18)),
      input, sendBtn));

  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; });
  fab.addEventListener('click', () => (sheet.hidden ? open() : close()));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) close(); });
  bus.on('route', () => { if (!sheet.hidden) paintContext(); });

  function open() {
    sheet.hidden = false; sheet.classList.remove('closing'); fab.classList.add('open'); fab.setAttribute('aria-expanded', 'true');
    paintContext();
    if (!msgs.children.length) addMsg('bot', `안녕하세요${store.s.profile.name ? ', ' + store.s.profile.name + '님' : ''}! 할 일 추가, 일정 잡기, 식단 기록, 뽀모도로 시작처럼 앱 안의 일을 대신 해 드려요. 무엇을 도와드릴까요?`);
    setTimeout(() => input.focus(), 120);
  }
  function close() {
    sheet.classList.add('closing'); fab.classList.remove('open'); fab.setAttribute('aria-expanded', 'false');
    setTimeout(() => { sheet.hidden = true; sheet.classList.remove('closing'); }, 240);
  }
  function clear() { history = []; msgs.replaceChildren(); attachments = []; paintAttach(); open(); }
  function paintContext() {
    const v = api.currentView();
    ctxEl.textContent = `${api.viewTitle(v) || '홈'} 탭에서 대화 중`;
    sugs.replaceChildren(...(SUGGEST[v] || SUGGEST.home).map(t => h('button', { class: 'chip sm line', onclick: () => submit(t) }, t)));
  }
  function paintAttach() {
    attachRow.replaceChildren(...attachments.map((f, i) => h('span', { class: 'chip sm' }, icon(f.type.startsWith('image/') ? 'image' : 'file', 14), h('span', { class: 'ell', style: { maxWidth: '140px' } }, f.name),
      h('button', { 'aria-label': '첨부 빼기', onclick: () => { attachments.splice(i, 1); paintAttach(); } }, icon('x', 12)))));
  }
  function addMsg(kind, text, extra) {
    const el = h('div', { class: 'msg ' + kind }, kind === 'tool' ? icon('check', 14) : null, text, extra);
    msgs.append(el); msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  async function submit(preset) {
    const text = (preset ?? input.value).trim();
    if ((!text && !attachments.length) || busy) return;
    input.value = ''; input.style.height = '';
    const files = attachments.splice(0); paintAttach();
    addMsg('user', text || '(첨부 파일)', files.filter(f => f.type.startsWith('image/')).map(f => h('img', { src: URL.createObjectURL(f), alt: '' })));
    busy = true; fab.classList.add('thinking'); sendBtn.disabled = true;
    const typing = h('div', { class: 'msg bot typing' }, h('i'), h('i'), h('i'));
    msgs.append(typing); msgs.scrollTop = msgs.scrollHeight;
    try {
      const content = [];
      for (const f of files) content.push(await fileToBlock(f));
      content.push({ type: 'text', text: `[${ctxLine()}]\n${text || '첨부한 파일을 봐 줘.'}` });
      history.push({ role: 'user', content });
      for (let i = 0; i < 8; i++) {
        const resp = await ai({ system: SYSTEM, messages: history, tools: TOOLS, effort: 'low', max_tokens: 8000 });
        history.push({ role: 'assistant', content: resp.content });
        const said = textOf(resp);
        if (said) { msgs.insertBefore(h('div', { class: 'msg bot' }, said), typing); }
        const uses = resp.content.filter(b => b.type === 'tool_use');
        if (resp.stop_reason !== 'tool_use' || !uses.length) break;
        const results = uses.map(u => {
          try {
            const out = runTool(u.name, u.input || {});
            if (!/^(list_|get_)/.test(u.name)) msgs.insertBefore(h('div', { class: 'msg tool' }, icon('check', 14), TOOL_LABEL[u.name] || u.name), typing);
            return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: u.id, content: e.message, is_error: true };
          }
        });
        history.push({ role: 'user', content: results });
        msgs.scrollTop = msgs.scrollHeight;
      }
    } catch (e) {
      msgs.insertBefore(h('div', { class: 'msg err' }, e.message), typing);
      if (['no_key', 'auth'].includes(e.code)) msgs.insertBefore(h('div', { class: 'msg bot' }, h('a', { href: '#settings' }, '설정에서 Claude API 키 입력하기')), typing);
    } finally {
      typing.remove(); busy = false; fab.classList.remove('thinking'); sendBtn.disabled = false; msgs.scrollTop = msgs.scrollHeight;
    }
  }
  return { open, submit };
}
