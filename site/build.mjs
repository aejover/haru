// site/build.mjs — builds 하루's public web pages (소개, 가이드, 정책) from site/content into public/,
// plus sitemap.xml, robots.txt, ads.txt and the SEO block of public/index.html.
// Run after editing content or changing the address:  npm run site
//
// Change these when moving to your own domain or after AdSense / Search Console give you codes.
const SITE_URL = (process.env.SITE_URL || 'https://aejover.github.io/haru/').replace(/\/?$/, '/');
const ADSENSE_CLIENT = process.env.ADSENSE_CLIENT || ''; // e.g. 'ca-pub-1234567890123456'
const GOOGLE_SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION || ''; // Search Console "HTML 태그" content value
const NAVER_SITE_VERIFICATION = process.env.NAVER_SITE_VERIFICATION || ''; // 네이버 서치어드바이저 content value
const SITE_NAME = '하루';
const AUTHOR = 'aejover';
const CONTACT_URL = 'https://github.com/aejover/haru/issues';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const CONTENT = path.join(here, 'content');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// each content file starts with a comment of "key: value" lines, then the page body
function readPage(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = /^<!--([\s\S]*?)-->\s*/.exec(raw);
  const meta = {};
  for (const line of (m?.[1] || '').split('\n')) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { ...meta, order: Number(meta.order || 99), body: raw.slice(m ? m[0].length : 0) };
}

const pages = [];
for (const f of fs.readdirSync(CONTENT)) if (f.endsWith('.html')) pages.push({ ...readPage(path.join(CONTENT, f)), out: f });
for (const f of fs.readdirSync(path.join(CONTENT, 'guide'))) if (f.endsWith('.html')) pages.push({ ...readPage(path.join(CONTENT, 'guide', f)), out: 'guide/' + f, guide: true });
const guides = pages.filter(p => p.guide).sort((a, b) => a.order - b.order);

const urlOf = out => SITE_URL + out.replace(/(^|\/)index\.html$/, '$1');
const rel = (from, to) => { const depth = from.split('/').length - 1; return '../'.repeat(depth) + to || './'; };
const fmtDate = d => { const [y, m, dd] = d.split('-').map(Number); return `${y}년 ${m}월 ${dd}일`; };

function head(p, url) {
  const r = to => rel(p.out, to);
  const ld = [];
  if (p.guide && p.out !== 'guide/index.html') {
    ld.push({ '@context': 'https://schema.org', '@type': 'Article', headline: p.title, description: p.description, inLanguage: 'ko', datePublished: p.date, dateModified: p.updated || p.date, author: { '@type': 'Person', name: AUTHOR, url: 'https://github.com/' + AUTHOR }, publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: SITE_URL + 'icons/icon-512.png' } }, image: SITE_URL + 'og-image.png', mainEntityOfPage: url });
    ld.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: SITE_NAME, item: SITE_URL }, { '@type': 'ListItem', position: 2, name: '사용 가이드', item: SITE_URL + 'guide/' }, { '@type': 'ListItem', position: 3, name: p.title, item: url }] });
  }
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${p.base ? `<base href="${SITE_URL}">\n` : ''}${p.noindex ? '<meta name="robots" content="noindex">\n' : ''}<title>${esc(p.title)} · ${SITE_NAME}</title>
<meta name="description" content="${esc(p.description)}">
${p.noindex ? '' : `<link rel="canonical" href="${url}">\n`}
<meta property="og:type" content="${p.guide && p.out !== 'guide/index.html' ? 'article' : 'website'}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
${verification()}<meta name="theme-color" content="#F4F4F2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0D0D0F" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${r('icon.svg')}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${r('icons/apple-touch-icon.png')}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="${r('site.css')}">
${ld.map(x => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join('\n')}${adsScript()}
</head>`;
}
function verification() {
  return (GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${esc(GOOGLE_SITE_VERIFICATION)}">\n` : '')
    + (NAVER_SITE_VERIFICATION ? `<meta name="naver-site-verification" content="${esc(NAVER_SITE_VERIFICATION)}">\n` : '')
    + (ADSENSE_CLIENT ? `<meta name="google-adsense-account" content="${esc(ADSENSE_CLIENT)}">\n` : '');
}
const adsScript = () => (ADSENSE_CLIENT ? `\n<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(ADSENSE_CLIENT)}" crossorigin="anonymous"></script>` : '');

function chrome(p, inner) {
  const r = to => rel(p.out, to);
  const nav = [['guide/', '사용 가이드'], ['about.html', '소개']];
  return `<body>
<a class="skip" href="#main">본문 바로가기</a>
<header class="site-head">
  <a class="brand" href="${r('about.html')}"><img src="${r('icons/icon-192.png')}" alt="" width="28" height="28">${SITE_NAME}</a>
  <nav aria-label="사이트">${nav.map(([h, l]) => `<a href="${r(h)}"${p.out.startsWith(h.replace(/\/$/, '')) ? ' aria-current="page"' : ''}>${l}</a>`).join('')}<a class="open-app" href="${r('')}">앱 열기</a></nav>
</header>
<main id="main" class="site-main">
${inner}
</main>
<footer class="site-foot">
  <nav aria-label="정책">
    <a href="${r('about.html')}">소개</a><a href="${r('guide/')}">사용 가이드</a><a href="${r('privacy.html')}">개인정보처리방침</a><a href="${r('terms.html')}">이용약관</a><a href="${r('contact.html')}">문의</a>
  </nav>
  <p>© ${new Date().getFullYear()} ${SITE_NAME} · 만든 사람 <a href="https://github.com/${AUTHOR}">${AUTHOR}</a></p>
</footer>
</body>
</html>
`;
}

function render(p) {
  const url = urlOf(p.out);
  let inner;
  if (p.out === 'guide/index.html') {
    inner = `<article class="prose">
<p class="eyebrow">사용 가이드</p>
<h1>${esc(p.title)}</h1>
${p.body}
<ul class="guide-list">
${guides.filter(g => g.out !== 'guide/index.html').map(g => `<li><a href="${g.out.slice(6)}"><b>${esc(g.title)}</b><span>${esc(g.description)}</span></a></li>`).join('\n')}
</ul>
</article>`;
  } else if (p.guide) {
    const list = guides.filter(g => g.out !== 'guide/index.html');
    const i = list.indexOf(p);
    const prev = list[i - 1], next = list[i + 1];
    inner = `<article class="prose">
<nav class="crumbs" aria-label="위치"><a href="./">사용 가이드</a></nav>
<h1>${esc(p.title)}</h1>
<p class="meta">${fmtDate(p.updated || p.date)} 업데이트 · ${AUTHOR}</p>
${p.body}
<aside class="try"><p>${esc(p.cta || '하루에서 바로 해 보세요. 가입 없이 무료로 쓸 수 있어요.')}</p><a class="btn" href="../${p.app ? '#' + p.app : ''}">하루에서 해 보기</a></aside>
<nav class="pager" aria-label="다른 가이드">${prev ? `<a href="${prev.out.slice(6)}"><small>이전</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${next.out.slice(6)}"><small>다음</small>${esc(next.title)}</a>` : '<span></span>'}</nav>
</article>`;
  } else {
    inner = `<article class="prose">
<h1>${esc(p.title)}</h1>
${p.updated ? `<p class="meta">${fmtDate(p.updated)} 기준</p>` : ''}
${p.body.replaceAll('{{CONTACT_URL}}', CONTACT_URL)}
</article>`;
  }
  return head(p, url) + '\n' + chrome(p, inner);
}

for (const p of pages) {
  const file = path.join(PUBLIC, p.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(p));
}

// sitemap: the app itself plus every page; robots: everything public, points at the sitemap
const today = new Date().toISOString().slice(0, 10);
const entries = [{ loc: SITE_URL, lastmod: today, priority: '1.0' }, ...pages.filter(p => !p.noindex).map(p => ({ loc: urlOf(p.out), lastmod: p.updated || p.date || today, priority: p.guide ? '0.8' : '0.5' }))];
fs.writeFileSync(path.join(PUBLIC, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e => `  <url><loc>${e.loc}</loc><lastmod>${e.lastmod}</lastmod><priority>${e.priority}</priority></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(PUBLIC, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: ${new URL(SITE_URL).pathname}files/\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
const adsTxt = path.join(PUBLIC, 'ads.txt');
if (ADSENSE_CLIENT) fs.writeFileSync(adsTxt, `google.com, ${ADSENSE_CLIENT.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
else if (fs.existsSync(adsTxt)) fs.unlinkSync(adsTxt);

// the app page: canonical, social cards and structured data between the seo markers
const appFile = path.join(PUBLIC, 'index.html');
const app = fs.readFileSync(appFile, 'utf8');
const appDesc = '할 일, 목표, 루틴, 캘린더, 시간표, 뽀모도로, 파워냅, 메모, 일기, 가계부, 수면 관리까지 한곳에서. 가입 없이 무료로 쓰는 개인 생산성 앱 하루.';
const appLd = { '@context': 'https://schema.org', '@type': 'WebApplication', name: SITE_NAME, url: SITE_URL, description: appDesc, applicationCategory: 'ProductivityApplication', operatingSystem: 'Web, Android, iOS, Windows, macOS', inLanguage: 'ko', offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' }, author: { '@type': 'Person', name: AUTHOR } };
const seo = `<!-- seo:start (generated by site/build.mjs) -->
<meta name="description" content="${esc(appDesc)}">
<link rel="canonical" href="${SITE_URL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="하루 · 할 일부터 수면·가계부까지 한곳에서">
<meta property="og:description" content="${esc(appDesc)}">
<meta property="og:url" content="${SITE_URL}">
<meta property="og:image" content="${SITE_URL}og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
${verification()}<script type="application/ld+json">${JSON.stringify(appLd)}</script>${adsScript()}
<!-- seo:end -->`;
if (!/<!-- seo:start[\s\S]*?<!-- seo:end -->/.test(app)) throw new Error('public/index.html has no <!-- seo:start --> … <!-- seo:end --> block');
fs.writeFileSync(appFile, app.replace(/<!-- seo:start[\s\S]*?<!-- seo:end -->/, seo));

console.log(`built ${pages.length} pages for ${SITE_URL}${ADSENSE_CLIENT ? ' with AdSense' : ''}`);
