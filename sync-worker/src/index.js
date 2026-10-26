// haru-sync — the mailbox that lets paired 하루 devices (computer, phone, …) share their records.
// Every device encrypts before sending, and the key lives only in the pairing QR code on those
// devices, so this worker stores bytes it cannot read. One Durable Object per pairing ("room").
//
//   GET    /v1/:room/state[?have=rev]   → encrypted state (204 if `have` is current, 404 if none yet)
//   PUT    /v1/:room/state?base=rev     → store a new state if base is the current rev (409 otherwise)
//   GET    /v1/:room/file/:id           → encrypted photo/recording
//   PUT    /v1/:room/file/:id           → store one (files never change, so a second PUT is a no-op)
//   DELETE /v1/:room/room               → forget everything in this pairing
import { DurableObject } from 'cloudflare:workers';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'X-Rev',
  'Access-Control-Max-Age': '86400',
};
const ROOM = /^[A-Za-z0-9_-]{22,64}$/;
const FILE = /^[A-Za-z0-9._-]{1,80}$/;
const CHUNK = 1 << 20; // stored values stay well under the 2 MiB per-value limit
const MAX_STATE = 24 << 20, MAX_FILE = 30 << 20;
const IDLE_DAYS = 365; // a pairing nobody has used for a year is deleted

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response('haru sync', { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
    const m = /^\/v1\/([^/]+)\/(state|room|file\/[^/]+)$/.exec(url.pathname);
    if (!m || !ROOM.test(m[1])) return withCors(Response.json({ error: 'not_found' }, { status: 404 }));
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    return withCors(await stub.fetch(req));
  },
};
function withCors(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
const keys = (prefix, n) => Array.from({ length: n }, (_, i) => prefix + i);
function join(map, list) {
  const parts = list.map(k => map.get(k));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0));
  let o = 0; for (const p of parts) { out.set(new Uint8Array(p), o); o += p.byteLength; }
  return out;
}
function split(buf, prefix) {
  const n = Math.max(1, Math.ceil(buf.byteLength / CHUNK));
  const entries = {};
  for (let i = 0; i < n; i++) entries[prefix + i] = buf.slice(i * CHUNK, (i + 1) * CHUNK);
  return { n, entries };
}

export class Room extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);
    const [, , , kind, id] = url.pathname.split('/');
    const st = this.ctx.storage;
    if (kind === 'state') {
      if (req.method === 'GET') {
        const meta = await st.get('meta');
        if (!meta?.rev) return new Response(null, { status: 404, headers: { 'X-Rev': '0' } });
        if (url.searchParams.get('have') === String(meta.rev)) return new Response(null, { status: 204, headers: { 'X-Rev': String(meta.rev) } });
        const list = keys('s', meta.n);
        return new Response(join(await st.get(list), list), { headers: { 'Content-Type': 'application/octet-stream', 'X-Rev': String(meta.rev), 'Cache-Control': 'no-store' } });
      }
      if (req.method === 'PUT') {
        // read the body first: the check-and-write below then runs without other requests slipping in
        const buf = await req.arrayBuffer();
        if (buf.byteLength > MAX_STATE) return Response.json({ error: 'too_large' }, { status: 413 });
        const meta = (await st.get('meta')) || { rev: 0, n: 0 };
        const base = Number(url.searchParams.get('base') || 0);
        if (base !== meta.rev) return Response.json({ rev: meta.rev }, { status: 409, headers: { 'X-Rev': String(meta.rev) } });
        const { n, entries } = split(buf, 's');
        const next = { rev: meta.rev + 1, n, size: buf.byteLength, at: Date.now() };
        await st.put({ ...entries, meta: next });
        if (meta.n > n) await st.delete(keys('s', meta.n).slice(n));
        await st.setAlarm(Date.now() + IDLE_DAYS * 864e5);
        return Response.json({ rev: next.rev }, { headers: { 'X-Rev': String(next.rev) } });
      }
    }
    if (kind === 'file' && FILE.test(id || '')) {
      const fm = await st.get('f:' + id);
      if (req.method === 'GET') {
        if (!fm) return new Response(null, { status: 404 });
        const list = keys(`f:${id}:`, fm.n);
        return new Response(join(await st.get(list), list), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' } });
      }
      if (req.method === 'PUT') {
        const buf = await req.arrayBuffer();
        if (fm) return Response.json({ ok: true, existed: true });
        if (buf.byteLength > MAX_FILE) return Response.json({ error: 'too_large' }, { status: 413 });
        const { n, entries } = split(buf, `f:${id}:`);
        await st.put({ ...entries, ['f:' + id]: { n, size: buf.byteLength, at: Date.now() } });
        return Response.json({ ok: true });
      }
    }
    if (kind === 'room' && req.method === 'DELETE') {
      await st.deleteAlarm();
      await st.deleteAll();
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
