// tests/shaperhub-fake-api.js — TASK 767: a FAKE Shaper API for the tests (never the real ShaperHub, never a real login). It answers, at the fetch level,
// the calls packages/core/shaper-cloud.js makes, in the shapes shaper_sync.py (NaPs/shaper-sync, MIT) shows:
//   POST https://auth.shapertools.com/token            -> 200 { access_token: { token } } for the fake login, else 401 { message }
//   GET  https://api.shapertools.com/files/userspace/search?spaceType=userspace&limit=200&path=/&sort=modified:-1&type=file -> 200 { results: [{ name, modified }] }
//   POST https://api.shapertools.com/blobs/            -> 200 { blobs: [id] }
//   POST https://api.shapertools.com/files/userspace/tree/<name> { type: 'file', blobs: [id] } -> 200 { name }; a name already there is REFUSED
//        (409 { message: 'File name already used' }: shaper_sync.py only expects a non-2xx there, create_file_entry's raise_for_status)
//   DELETE https://api.shapertools.com/files/userspace/tree/<name> -> 200 {} (404 when there is no such entry)
// Every other request: a local one (127.0.0.1 / localhost) goes to the real fetch when `passLocal` is given; any other is BLOCKED (counted, then a
// TypeError, as a network failure). `fail` makes one call fail: { token | search | blob | create | delete: { status, message } | 'network' }.
// Each call is recorded in `calls` ({ step, method, url, headers, body }) so a test can assert the order and the request shapes.
export const FAKE_LOGIN = Object.freeze({ email: 'user@example.test', password: 'not-a-real-password' });
export const FAKE_TOKEN = 'fake-jwt-767';
const AUTH = 'https://auth.shapertools.com';
const API = 'https://api.shapertools.com';
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//;

export function createFakeShaperApi({ files = [], fail = {}, passLocal = null } = {}) {
  const myFiles = new Map(files.map((name, i) => [name, { name, modified: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), blobs: [`old-blob-${i + 1}`] }]));
  const blobs = new Map();
  const calls = [];
  const blocked = [];
  let nBlob = 0;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const headersOf = (init) => Object.fromEntries(new Headers(init && init.headers).entries());
  const bodyText = (init) => (init && init.body !== undefined ? (typeof init.body === 'string' ? init.body : Buffer.from(init.body).toString('utf8')) : null);
  const failed = (step) => {
    const f = fail[step];
    if (!f) return null;
    if (f === 'network') throw new TypeError('fetch failed');
    return json(f.status, { message: f.message });
  };
  const authorised = (h) => h.authorization === `Bearer ${FAKE_TOKEN}`;

  async function fakeFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    if (LOCAL.test(url) && passLocal) return passLocal(input, init);
    const method = (init.method || 'GET').toUpperCase();
    const headers = headersOf(init);
    const u = new URL(url);
    const record = (step) => { calls.push({ step, method, url, headers, body: bodyText(init) }); };
    if (u.origin === AUTH && u.pathname === '/token' && method === 'POST') {
      record('token');
      const f = failed('token'); if (f) return f;
      const b = JSON.parse(bodyText(init));
      if (b.username === FAKE_LOGIN.email && b.password === FAKE_LOGIN.password) return json(200, { access_token: { token: FAKE_TOKEN }, expires: '2026-12-01T00:00:00Z' });
      return json(401, { message: 'Username and password could not be verified' });
    }
    if (u.origin === API && u.pathname === '/files/userspace/search' && method === 'GET') {
      record('search');
      const f = failed('search'); if (f) return f;
      if (!authorised(headers)) return json(401, { message: 'Unauthorized' });
      return json(200, { results: [...myFiles.values()].sort((a, b) => (a.modified < b.modified ? 1 : -1)).map((x) => ({ name: x.name, modified: x.modified, type: 'file' })) });
    }
    if (u.origin === API && u.pathname === '/blobs/' && method === 'POST') {
      record('blob');
      const f = failed('blob'); if (f) return f;
      if (!authorised(headers)) return json(401, { message: 'Unauthorized' });
      const id = `blob-${++nBlob}`;
      blobs.set(id, bodyText(init));
      return json(200, { blobs: [id] });
    }
    if (u.origin === API && u.pathname.startsWith('/files/userspace/tree/')) {
      const name = decodeURIComponent(u.pathname.slice('/files/userspace/tree/'.length));
      if (method === 'POST') {
        record('create');
        const f = failed('create'); if (f) return f;
        if (!authorised(headers)) return json(401, { message: 'Unauthorized' });
        const b = JSON.parse(bodyText(init));
        if (b.type !== 'file' || !Array.isArray(b.blobs) || !blobs.has(b.blobs[0])) return json(400, { message: 'Bad entry' });
        if (myFiles.has(name)) return json(409, { message: 'File name already used' });
        myFiles.set(name, { name, modified: new Date().toISOString(), blobs: b.blobs });
        return json(200, { name, type: 'file', blobs: b.blobs });
      }
      if (method === 'DELETE') {
        record('delete');
        const f = failed('delete'); if (f) return f;
        if (!authorised(headers)) return json(401, { message: 'Unauthorized' });
        if (!myFiles.has(name)) return json(404, { message: 'Not found' });
        myFiles.delete(name);
        return json(200, {});
      }
    }
    blocked.push(url);
    throw new TypeError(`blocked: a test lets no request leave this machine (${u.origin})`);
  }

  return {
    fetch: fakeFetch,
    calls,
    blocked,
    steps: () => calls.map((c) => c.step),
    names: () => [...myFiles.keys()].sort(),
    entry: (name) => myFiles.get(name) || null,
    blob: (id) => blobs.get(id),
    setFail: (next) => { for (const k of Object.keys(fail)) delete fail[k]; Object.assign(fail, next); },
    reset: () => { calls.length = 0; },
  };
}
