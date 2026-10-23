// weather.js — Open-Meteo (no key). Current conditions + a rain/snow heads-up for the next 24h.
import { store } from './core.js';

const CODES = {
  0: ['맑음', 'sun'], 1: ['대체로 맑음', 'partly'], 2: ['구름 조금', 'partly'], 3: ['흐림', 'cloud'],
  45: ['안개', 'fog'], 48: ['안개', 'fog'], 51: ['약한 이슬비', 'rain'], 53: ['이슬비', 'rain'], 55: ['강한 이슬비', 'rain'],
  56: ['어는 이슬비', 'rain'], 57: ['어는 이슬비', 'rain'], 61: ['약한 비', 'rain'], 63: ['비', 'rain'], 65: ['강한 비', 'rain'],
  66: ['어는 비', 'rain'], 67: ['어는 비', 'rain'], 71: ['약한 눈', 'snow'], 73: ['눈', 'snow'], 75: ['많은 눈', 'snow'], 77: ['싸락눈', 'snow'],
  80: ['소나기', 'rain'], 81: ['소나기', 'rain'], 82: ['강한 소나기', 'rain'], 85: ['눈보라', 'snow'], 86: ['강한 눈보라', 'snow'],
  95: ['뇌우', 'storm'], 96: ['우박 뇌우', 'storm'], 99: ['우박 뇌우', 'storm'],
};
export const isRain = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
export const isSnow = c => (c >= 71 && c <= 77) || c === 85 || c === 86;

let cache = null;
let geo = null;

async function place() {
  const c = store.s.settings.city;
  if (c) return c;
  if (geo) return geo;
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 7000, maximumAge: 3600e3 }));
    geo = { lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3), name: '현재 위치' };
  } catch {
    geo = { lat: 37.5665, lon: 126.978, name: '서울' };
  }
  return geo;
}

function whenLabel(t) {
  const d = new Date(t), now = new Date();
  const day = d.getDate() === now.getDate() ? '' : '내일 ';
  const hr = d.getHours();
  return `${day}${hr < 12 ? '오전' : '오후'} ${hr % 12 || 12}시`;
}

export async function getWeather(force = false) {
  if (!force && cache && Date.now() - cache.at < 20 * 60e3) return cache;
  const loc = await place();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,weather_code&hourly=precipitation_probability,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('날씨를 불러오지 못했어요.');
  const d = await r.json();
  const code = d.current.weather_code;
  const [desc, ic] = CODES[code] || ['', 'cloud'];
  let alert = null;
  if (isRain(code) || isSnow(code)) alert = { kind: isSnow(code) ? 'snow' : 'rain', text: isSnow(code) ? '지금 눈이 와요' : '지금 비가 와요' };
  else {
    const now = Date.now();
    for (let i = 0; i < d.hourly.time.length; i++) {
      const t = new Date(d.hourly.time[i]).getTime();
      if (t < now - 30 * 60e3 || t > now + 24 * 3600e3) continue;
      const c = d.hourly.weather_code[i], p = d.hourly.precipitation_probability?.[i] ?? 100;
      if ((isRain(c) || isSnow(c)) && p >= 40) {
        const snow = isSnow(c);
        alert = { kind: snow ? 'snow' : 'rain', text: `${whenLabel(t)}부터 ${snow ? '눈' : '비'} 예정 · ${p}%` };
        break;
      }
    }
  }
  cache = {
    at: Date.now(), place: loc.name, temp: Math.round(d.current.temperature_2m), feels: Math.round(d.current.apparent_temperature),
    code, desc, icon: ic, max: Math.round(d.daily.temperature_2m_max[0]), min: Math.round(d.daily.temperature_2m_min[0]), alert,
  };
  return cache;
}

export async function searchCity(q) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=ko`);
  const d = await r.json();
  return (d.results || []).map(x => ({ name: x.name, region: [x.admin1, x.country].filter(Boolean).join(', '), lat: x.latitude, lon: x.longitude }));
}
export const clearWeatherCache = () => { cache = null; geo = null; };
