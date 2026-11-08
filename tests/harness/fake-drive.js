// tests/harness/fake-drive.js — an in-memory fake of the slice of Google Drive v3 REST that the Sketch Studio Drive adapter uses
// (TASK 480). NO network: tests hand its `fetch` to the account / adapter. Supports: about, files.generateIds, files.list (q with
// 'X' in parents / mimeType= / name= / trashed=false / appProperties has {key,value}, paging), files.get (meta, alt=media), files.create
// (metadata and multipart upload), files.update (metadata incl. trashed / addParents / removeParents, and media upload), files.delete.
// Every mutation bumps `version` and `modifiedTime` like Drive does; `beforeWrite` lets a test change a file "from another tab".
export function createFakeDrive({ user = { displayName: 'Ada Lovelace', emailAddress: 'ada@example.com', photoLink: 'https://example.invalid/photo.jpg' }, pageSize = 200 } = {}) {
  const files = new Map();
  let seq = 0, clock = Date.UTC(2026, 10, 8, 10, 0, 0);
  const d = { files, calls: [], token: 'GOOD', user, beforeWrite: null, failWrites: 0, offline: false, requests: [] };
  const tick = () => { clock += 1000; return new Date(clock).toISOString(); };
  const newId = () => 'fakeid-' + (++seq);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const meta = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, appProperties: f.appProperties, modifiedTime: f.modifiedTime, version: String(f.version), trashed: !!f.trashed });
  const touch = (f) => { f.version++; f.modifiedTime = tick(); };

  function matches(f, q) {
    let rest = q || '';
    const app = /appProperties has \{ key='(\w+)' and value='([^']*)' \}/.exec(rest);
    if (app) { rest = rest.replace(app[0], 'true'); if (!(f.appProperties && f.appProperties[app[1]] === app[2])) return false; }
    for (const clause of rest.split(' and ').map((c) => c.trim()).filter((c) => c && c !== 'true')) {
      let m;
      if ((m = /^'([^']+)' in parents$/.exec(clause))) { if (!(f.parents || ['root']).includes(m[1])) return false; }
      else if ((m = /^mimeType='([^']+)'$/.exec(clause))) { if (f.mimeType !== m[1]) return false; }
      else if ((m = /^name='((?:\\'|[^'])*)'$/.exec(clause))) { if (f.name !== m[1].replace(/\\'/g, "'")) return false; }
      else if (clause === 'trashed=false') { if (f.trashed) return false; }
      else throw new Error('fake drive: unsupported q clause: ' + clause);
    }
    return true;
  }
  const parseMultipart = (body, ctype) => {
    const boundary = /boundary=(.+)$/.exec(ctype)[1];
    const parts = String(body).split('--' + boundary).map((p) => p.trim()).filter((p) => p && p !== '--');
    const [h1, ...r1] = parts[0].split('\r\n\r\n'); const [, ...r2] = parts[1].split('\r\n\r\n');
    return { metadata: JSON.parse(r1.join('\r\n\r\n')), content: r2.join('\r\n\r\n') };
  };

  d.fetch = async (url, init = {}) => {
    if (d.offline) throw new TypeError('network unreachable');
    const u = new URL(url); const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    d.calls.push({ method, path: u.pathname, search: u.search, headers });
    d.requests.push({ url, method, headers, body: init.body });
    if (headers.Authorization !== 'Bearer ' + d.token) return json({ error: 'unauthorized' }, 401);
    const isWrite = method !== 'GET';
    if (isWrite && d.beforeWrite) d.beforeWrite({ method, path: u.pathname });
    if (isWrite && d.failWrites > 0) { d.failWrites--; return json({ error: 'backend' }, 500); }
    const path = u.pathname;

    if (path === '/drive/v3/about') return json({ user: d.user });
    if (path === '/drive/v3/files/generateIds') return json({ ids: Array.from({ length: Number(u.searchParams.get('count') || 1) }, newId) });
    if (path === '/drive/v3/files' && method === 'GET') {
      const all = [...files.values()].filter((f) => matches(f, u.searchParams.get('q')));
      const start = Number(u.searchParams.get('pageToken') || 0);
      const slice = all.slice(start, start + pageSize);
      return json({ files: slice.map(meta), ...(start + pageSize < all.length ? { nextPageToken: String(start + pageSize) } : {}) });
    }
    if (path === '/drive/v3/files' && method === 'POST') {
      const b = JSON.parse(init.body); const f = { id: b.id || newId(), name: b.name, mimeType: b.mimeType, parents: b.parents || ['root'], appProperties: b.appProperties || {}, version: 1, modifiedTime: tick(), content: '' };
      files.set(f.id, f); return json({ id: f.id });
    }
    let m;
    if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(path))) {
      const f = files.get(m[1]);
      if (!f) return json({ error: 'not found' }, 404);
      if (method === 'GET') return u.searchParams.get('alt') === 'media' ? new Response(f.content, { status: 200 }) : json(meta(f));
      if (method === 'PATCH') {
        const b = JSON.parse(init.body);
        if (b.name !== undefined) f.name = b.name;
        if (b.trashed !== undefined) f.trashed = !!b.trashed;
        if (b.appProperties) f.appProperties = { ...f.appProperties, ...b.appProperties };
        const add = u.searchParams.get('addParents'), rem = u.searchParams.get('removeParents');
        if (rem) f.parents = (f.parents || []).filter((p) => p !== rem);
        if (add) f.parents = [...(f.parents || []), add];
        touch(f); return json({ id: f.id });
      }
      if (method === 'DELETE') { files.delete(f.id); return new Response(null, { status: 204 }); }
    }
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      const { metadata, content } = parseMultipart(init.body, headers['Content-Type']);
      const f = { id: metadata.id || newId(), name: metadata.name, mimeType: metadata.mimeType, parents: metadata.parents || ['root'], appProperties: metadata.appProperties || {}, version: 1, modifiedTime: tick(), content };
      files.set(f.id, f); return json({ id: f.id });
    }
    if ((m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path)) && method === 'PATCH') {
      const f = files.get(m[1]); if (!f) return json({ error: 'not found' }, 404);
      f.content = String(init.body); touch(f); return json({ id: f.id });
    }
    return json({ error: 'fake drive: unhandled ' + method + ' ' + path }, 400);
  };
  /** Another tab / device changes a file's content behind the adapter's back. */
  d.externalEdit = (id, mutate) => { const f = files.get(id); f.content = mutate(f.content); touch(f); };
  d.byName = (name) => [...files.values()].filter((f) => f.name === name);
  return d;
}
