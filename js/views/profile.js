// profile.js — 이름·목표·나이·사진, 동갑 롤모델, 레벨·티어·전적 요약.
import { h, icon, store, commit, toast, upload, pickFiles, gainXP, levelInfo, tierInfo, tierEmblem, record, ai, jsonOf, aiFail, obj } from '../core.js';

export default {
  id: 'profile', title: '프로필', icon: 'user',
  render(el, ctx) {
    el.classList.add('stagger', 'narrow');
    const p = store.s.profile;
    const save = (what = 'profile') => { commit(what); };

    const photo = h('button', { class: 'prof-photo', 'aria-label': '프로필 사진 바꾸기', onclick: async () => {
      const [f] = await pickFiles({ accept: 'image/*' }); if (!f) return;
      try { const up = await upload(f); p.photo = up.url; save(); gainXP('profile'); paintPhoto(); toast('사진을 바꿨어요.'); } catch (e) { toast(e.message); }
    } });
    const paintPhoto = () => photo.replaceChildren(p.photo ? h('img', { src: p.photo, alt: '' }) : (p.name || '나').slice(0, 1), h('span', { class: 'edit' }, '사진 바꾸기'));
    paintPhoto();

    const input = (key, label, attrs = {}) => h('label', { class: 'field' }, h('span', null, label),
      h('input', { class: 'input', value: p[key] || '', ...attrs, oninput: e => { p[key] = e.target.value; save(); if (key === 'name') paintPhoto(); if (key === 'birthYear') paintAge(); } }));
    const ageEl = h('span', { class: 'small muted' });
    const paintAge = () => { const y = Number(p.birthYear); ageEl.textContent = y > 1900 ? `${new Date().getFullYear() - y + 1}세 (만 ${new Date().getFullYear() - y - 1}~${new Date().getFullYear() - y}세)` : ''; };
    paintAge();

    // role model
    const rm = p.roleModel;
    const rmName = h('input', { class: 'input', value: rm.name, placeholder: '예: 같은 해에 태어난 운동선수, 창업가, 아티스트', oninput: e => { rm.name = e.target.value; save(); } });
    const rmNote = h('input', { class: 'input', value: rm.note, placeholder: '그 사람의 어떤 점을 닮고 싶나요?', oninput: e => { rm.note = e.target.value; save(); } });
    const sugBox = h('div', { class: 'col', style: { gap: '6px' } });
    const sugBtn = h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
      const y = Number(p.birthYear);
      if (!(y > 1900)) { toast('먼저 태어난 해를 입력하세요.'); return; }
      sugBtn.disabled = true; sugBtn.textContent = '찾는 중…';
      try {
        const resp = await ai({
          effort: 'low', max_tokens: 4000,
          format: obj({ people: { type: 'array', items: obj({ name: { type: 'string' }, field: { type: 'string' }, why: { type: 'string' } }) } }),
          system: '사용자와 같은 해에 태어난, 자기 분야에서 크게 성공한 실존 인물을 추천한다. 출생 연도가 확실한 사람만 고르고, 확실하지 않으면 목록에서 뺀다. field는 분야, why는 사용자의 목표와 연결해 본받을 점 한 문장.',
          messages: [{ role: 'user', content: `출생 연도: ${y}년. 내 목표: ${p.goal || '(미정)'}. 동갑 롤모델 5명을 추천해 줘.` }],
        });
        const d = jsonOf(resp);
        sugBox.replaceChildren(h('span', { class: 'tiny muted' }, '누르면 롤모델로 정해요. 출생 연도는 한 번 더 확인해 보세요.'),
          (d.people || []).map(x => h('button', { class: 'att', style: { textAlign: 'left' }, onclick: () => { rm.name = x.name; rm.note = x.why; rmName.value = x.name; rmNote.value = x.why; save(); toast(`${x.name}님을 롤모델로 정했어요.`); } },
            icon('target', 18), h('div', { class: 'grow' }, h('b', null, x.name), h('span', { class: 'small muted' }, ` · ${x.field}`), h('div', { class: 'small' }, x.why)))));
      } catch (e) { aiFail(e); }
      finally { sugBtn.disabled = false; sugBtn.replaceChildren(icon('sparkle', 14), 'Claude에게 추천받기'); }
    } }, icon('sparkle', 14), 'Claude에게 추천받기');

    const motto = h('textarea', { class: 'textarea', style: { minHeight: '70px' }, placeholder: '홈 화면에 보일 동기부여 문구', oninput: e => { p.motivation = e.target.value; save(); } });
    motto.value = p.motivation || '';

    const lv = levelInfo(store.s.xp.total), tr = tierInfo(store.s.tier.lp), rc = record();
    el.append(
      h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, '프로필')),
      h('section', { class: 'glass card col' },
        h('div', { class: 'profile-hero' }, photo, h('div', { class: 'grow col', style: { gap: '4px', minWidth: '200px' } },
          h('div', { class: 'h1' }, p.name || '이름을 정해 주세요'), h('div', { class: 'muted' }, p.goal || '목표를 적어 보세요'), ageEl)),
        h('div', { class: 'grid-2' }, input('name', '이름', { placeholder: '이름' }), input('birthYear', '태어난 해', { type: 'number', placeholder: '예: 2007', min: 1900, max: 2100 })),
        input('goal', '목표', { placeholder: '예: 올해 안에 토익 900, 앱 하나 출시하기' })),
      h('section', { class: 'glass card col' },
        h('div', { class: 'row between wrap' }, h('div', null, h('h2', { class: 'h2' }, '동갑 롤모델'), h('div', { class: 'small muted' }, p.birthYear ? `${p.birthYear}년생 중 닮고 싶은 사람` : '태어난 해를 넣으면 같은 해에 태어난 사람을 추천해 드려요')), sugBtn),
        h('label', { class: 'field' }, h('span', null, '이름'), rmName), h('label', { class: 'field' }, h('span', null, '닮고 싶은 점'), rmNote), sugBox),
      h('section', { class: 'glass card col' }, h('h2', { class: 'h2' }, '동기부여 문구'), motto),
      h('section', { class: 'glass card' },
        h('div', { class: 'prof-stats', style: { marginTop: 0 } },
          h('div', { class: 'stat-box' }, h('span', { class: 'k' }, '레벨'), h('span', { class: 'v' }, `Lv.${lv.level}`), h('div', { class: 'bar thin' }, h('i', { style: { width: lv.pct + '%' } })), h('span', { class: 'tiny muted num' }, `${lv.cur}/${lv.need} XP`)),
          h('div', { class: 'stat-box' }, h('span', { class: 'k' }, '티어'), h('div', { class: 'row', style: { gap: '8px' } }, h('span', { html: tierEmblem(tr.idx, 30) }), h('span', { class: 'v', style: { fontSize: '17px' } }, tr.label)), h('span', { class: 'tiny muted num' }, `${tr.lp} LP`)),
          h('div', { class: 'stat-box span2' }, h('span', { class: 'k' }, '전적'), h('span', { class: 'v', style: { fontSize: '17px' } }, rc.games ? `${rc.w}승 ${rc.l}패 ${rc.d}무 · 승률 ${rc.rate}%` : '아직 대결 기록이 없어요'), h('a', { class: 'small', href: '#growth' }, '커리큘럼에서 자세히 보기')))));
  },
};
