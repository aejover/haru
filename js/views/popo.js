// popo.js — 포포: 홈을 옆으로 넘기면 나오는 수달 친구. 안부를 묻고, 어제 못 한 독촉 할 일(없으면 다가오는 일정)을
// 알려 주고, 기분 버튼에 맞춰 애교 · 같이 기뻐하기 · 포진정~ · 꼬옥 안아주기를 해 줘요. 배를 쓰다듬으면 좋아해요.
import { h, icon, store, dkey, addDays, fmtShort, popoSVG, visibleTasks, overdueDays, isDone } from '../core.js';

const pick = list => list[Math.floor(Math.random() * list.length)];
const MOODS = {
  tired: {
    label: '포야 나 오늘 힘들었어',
    lines: ['오늘 진짜 고생 많았어요~ 포포가 볼 비벼 줄게요 >_<', '힘든 하루 버틴 거 너무 대단해요! 포포 뱃살 만지면서 쉬어요~', '수고했어요 수고했어요~ 포포가 오늘 제일 칭찬해요!'],
    fx: ['♥', '♥', '♡'],
  },
  happy: {
    label: '나 오늘 기분 좋아',
    lines: ['와아~! 포포도 덩달아 신나요! 깡충깡충!', '좋은 일 있었구나! 포포도 기뻐서 배가 출렁출렁해요~', '오늘 같은 날이 또 오도록 포포가 응원할게요!'],
    fx: ['✦', '✧', '★', '✦'],
  },
  angry: {
    label: '포야 나 화나',
    lines: ['숨 크게 들이마시고… 후~ 천천히 내쉬어요.', '포포가 대신 화내 줄게요! 크앙! …이제 좀 괜찮아요?', '따뜻한 물 한 잔 마시고 천천히 숨 쉬어요. 포포가 옆에서 토닥토닥할게요.'],
    fx: ['~', '∼'],
  },
  sad: {
    label: '포야 나 우울해',
    lines: ['이리 와요. 포포가 꼬옥 안아줄게요.', '괜찮아요, 오늘은 그냥 쉬어도 돼요. 포포가 옆에 있을게요.', '꼬옥— 포포 품은 언제나 열려 있어요.'],
    fx: ['♡', '♥'],
  },
};

function greeting(name) {
  const hr = new Date().getHours();
  const who = name ? `${name}님, ` : '';
  if (hr < 5) return `${who}아직 안 잤어요? 포포는 졸려요… 얼른 자요.`;
  if (hr < 11) return `${who}좋은 아침이에요! 잘 잤어요?`;
  if (hr < 14) return `${who}점심은 먹었어요? 밥은 꼭 챙겨 먹어요.`;
  if (hr < 18) return `${who}오후도 힘내요! 포포가 응원하고 있어요.`;
  if (hr < 22) return `${who}오늘 하루 어땠어요? 포포한테 얘기해 줘요.`;
  return `${who}오늘도 수고 많았어요. 푹 쉬어요.`;
}

export function popoPage(ctx) {
  const page = h('div', { class: 'home-popo' });
  const bubble = h('div', { class: 'popo-bubble' });
  const stage = h('div', { class: 'popo-stage', html: popoSVG() });
  const fx = h('div', { class: 'popo-fx', 'aria-hidden': 'true' });
  const info = h('div', { class: 'popo-info' });
  let timer = null;

  function paintIdle() {
    const s = store.s, k = dkey();
    const say = [h('b', null, greeting(s.profile?.name))];
    // 어제 못 한 일 중에 독촉 할 일, 없으면 다가오는 일정
    const late = visibleTasks().filter(t => t.mode === 'nag' && overdueDays(t, k) > 0 && !(t.kind === 'daily' && isDone(t, k)));
    if (late.length) {
      say.push(h('span', null, ` 어제 못 한 일 중에 꼭 해야 하는 게 ${late.length}개 있어요. 오늘은 포포랑 같이 끝내요!`));
      info.replaceChildren(h('div', { class: 'popo-info-head' }, icon('bell', 15), '포포가 독촉해요'),
        late.slice(0, 4).map(t => h('a', { class: 'popo-item', href: '#checklist' }, h('span', { class: 'grow ell' }, t.title), h('span', { class: 'chip sm line num' }, `${overdueDays(t, k)}일째`))));
    } else {
      const now = new Date(), hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const upcoming = (s.events || []).filter(e => e.date > k || (e.date === k && (!e.time || e.time >= hm)))
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99')).slice(0, 4);
      say.push(h('span', null, upcoming.length ? ' 밀린 독촉 할 일은 없어요, 멋져요! 앞으로 이런 일정이 있어요.' : ' 밀린 독촉 할 일도, 다가오는 일정도 없어요. 오늘은 여유롭게 보내요~'));
      info.replaceChildren(upcoming.length ? [h('div', { class: 'popo-info-head' }, icon('calendar', 15), '다가오는 일정'),
        upcoming.map(e => h('a', { class: 'popo-item', href: `#calendar/${e.date}` }, h('span', { class: 'chip sm line num' }, e.date === k ? '오늘' : e.date === addDays(k, 1) ? '내일' : fmtShort(e.date)), h('span', { class: 'grow ell' }, e.title), e.time ? h('span', { class: 'tiny muted num' }, e.time) : null))] : null);
    }
    bubble.replaceChildren(...say);
    bubble.classList.remove('mood');
  }

  function react(mood) {
    const m = MOODS[mood];
    clearTimeout(timer);
    stage.className = 'popo-stage';
    void stage.offsetWidth; // restart the pose even when the same button is pressed twice
    stage.classList.add(mood);
    bubble.replaceChildren(mood === 'angry' ? [h('b', { class: 'popo-calm' }, '포진정~ 포진정~'), h('br')] : null, pick(m.lines));
    bubble.classList.add('mood');
    // little hearts / sparkles / calm waves floating up around 포포
    fx.replaceChildren(...Array.from({ length: mood === 'happy' ? 9 : 6 }, (_, i) => h('i', { class: 'fx-' + mood, style: { left: `${12 + ((i * 37) % 76)}%`, animationDelay: `${i * 0.18}s` } }, m.fx[i % m.fx.length])));
    timer = setTimeout(() => { stage.className = 'popo-stage'; fx.replaceChildren(); paintIdle(); }, 6500);
  }

  // 배 쓰다듬기: rub the belly (finger or mouse) and 포포 wriggles happily — no words, just hearts
  const holder = h('div', { class: 'popo-holder', title: '포포 배를 쓰다듬어 보세요' }, stage, fx);
  let rub = null, petTimer = null, petting = false;
  const onBelly = e => {
    const r = stage.getBoundingClientRect(); // belly: circle at (100,170) r62 in the 200×250 drawing
    const x = ((e.clientX - r.left) / r.width) * 200, y = ((e.clientY - r.top) / r.height) * 250;
    return Math.hypot(x - 100, y - 170) < 70;
  };
  holder.addEventListener('pointerdown', e => { if (onBelly(e)) { rub = { x: e.clientX, y: e.clientY, dist: 0 }; holder.setPointerCapture?.(e.pointerId); } });
  holder.addEventListener('pointermove', e => {
    if (!rub) return;
    rub.dist += Math.hypot(e.clientX - rub.x, e.clientY - rub.y); rub.x = e.clientX; rub.y = e.clientY;
    if (rub.dist < 60) return;
    if (!petting) {
      petting = true; clearTimeout(timer);
      stage.className = 'popo-stage pet';
      fx.replaceChildren(...Array.from({ length: 5 }, (_, i) => h('i', { class: 'fx-tired', style: { left: `${20 + i * 15}%`, animationDelay: `${i * 0.25}s` } }, '♥')));
    }
    clearTimeout(petTimer);
    petTimer = setTimeout(endPet, 900);
  });
  const stopRub = () => { rub = null; };
  holder.addEventListener('pointerup', stopRub); holder.addEventListener('pointercancel', stopRub);
  function endPet() { petting = false; stage.className = 'popo-stage'; setTimeout(() => { if (!petting) fx.replaceChildren(); }, 1600); }
  ctx.cleanup(() => clearTimeout(petTimer));

  page.append(
    bubble,
    holder,
    info,
    h('div', { class: 'popo-moods' }, Object.entries(MOODS).map(([k, m]) => h('button', { class: 'btn btn-glass', onclick: () => react(k) }, m.label))));
  paintIdle();
  // keep the greeting current, but don't cut a reaction short
  ctx.on('change', w => { if (['tasks', 'events', 'profile'].includes(w) && stage.classList.length === 1) paintIdle(); });
  ctx.on('newday', paintIdle);
  ctx.cleanup(() => clearTimeout(timer));
  return { page, refresh: paintIdle };
}
