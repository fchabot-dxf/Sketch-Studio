// tests/shaperhub-name-767.test.js — TASK 767: the Shaper Export step's file is named after the design, and a name already in the user's ShaperHub
// "My Files" is asked about (Replace it / Keep both) instead of failing after the upload. NO real ShaperHub and NO real login: a FAKE Shaper API
// (tests/shaperhub-fake-api.js) answers at the fetch level; every other request is blocked and counted.
//  - the name rule (packages/core/shaper-cloud.js shaperFileName) and the export name (apps/shaper/src/export-payload.js exportFileName): the design's
//    name + .svg, Untitled -> shaper-export.svg; no fixed export name left in the Shaper app;
//  - uploadToShaperHub, mode 'new': a new name is created (token -> search -> blob -> create); an existing name answers 'exists' after the search,
//    NOTHING uploaded or deleted;
//  - 'replace': the new blob is uploaded BEFORE the old entry is deleted, then the entry is created (the order of the calls asserted); a failure of
//    the blob upload or of the delete leaves the old file in place;
//  - 'keep-both': the next free name ("bromont (2).svg"; with (2) and (3) taken, "bromont (4).svg");
//  - the request shapes ported from shaper_sync.py (method, URL, headers, body of token, search, blobs, create, delete);
//  - errors: a wrong login is kind 'login' with Shaper's message; a network failure is kind 'network'; Shaper's other refusals keep its message; the
//    login is in no error text (also when Shaper's own message repeats it);
//  - POST /api/shaper-upload: the Pages Function answers what handleShaperUpload answers (one implementation); server.js passes the text through too.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeShaperApi, FAKE_LOGIN, FAKE_TOKEN } from './shaperhub-fake-api.js';
import { uploadToShaperHub, handleShaperUpload, shaperFileName, nextFreeName, ShaperHubError, SHAPER_COMMON_HEADERS } from '../packages/core/shaper-cloud.js';
import { exportFileName } from '../apps/shaper/src/export-payload.js';
import { onRequestPost } from '../functions/api/shaper-upload.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 0"/></svg>';
const SECRETS = [FAKE_LOGIN.email, FAKE_LOGIN.password];
const errorTexts = []; // every error text the function produced: none may hold the login
const realFetch = globalThis.fetch;
let api = null;
const install = (opts) => { api = createFakeShaperApi(opts); globalThis.fetch = api.fetch; return api; };
const allBlocked = [];
const send = (extra) => uploadToShaperHub({ ...FAKE_LOGIN, svg: SVG, filename: 'bromont.svg', ...extra });
const refused = async (extra, label) => {
  try { await send(extra); } catch (err) { errorTexts.push(err.message); ok(err instanceof ShaperHubError, label + ': a ShaperHubError'); return err; }
  assert.fail(label + ': expected a refusal');
};
const done = () => { allBlocked.push(...api.blocked); };

try {
  // ── 1. the name rule ──
  eq(shaperFileName('bromont'), 'bromont.svg', 'a design name gets .svg');
  eq(shaperFileName('bromont.svg'), 'bromont.svg', 'a name already ending in .svg keeps one');
  eq(shaperFileName('Bromont.SVG'), 'Bromont.svg', 'the extension is lower-cased');
  eq(shaperFileName('  '), 'shaper-export.svg', 'an empty name: the default');
  eq(shaperFileName('bromont (2)'), 'bromont (2).svg', 'parentheses are kept (Keep both names)');
  eq(shaperFileName('a/b:c*d'), 'a_b_c_d.svg', 'other characters become _ (the rule the server has applied since the upload shipped)');
  eq(exportFileName('bromont'), 'bromont.svg', 'the export name: the design name + .svg');
  eq(exportFileName('Untitled'), 'shaper-export.svg', 'an Untitled design: the default name');
  eq(exportFileName(null), 'shaper-export.svg', 'no design (yet): the default name');
  eq(exportFileName('Body1'), 'Body1.svg', 'Fusion mode: the selection name');
  eq(nextFreeName('bromont.svg', ['bromont.svg']), 'bromont (2).svg', 'keep both: (2)');
  eq(nextFreeName('bromont.svg', ['bromont.svg', 'bromont (2).svg', 'bromont (3).svg']), 'bromont (4).svg', 'keep both: (2) and (3) taken -> (4)');
  eq(nextFreeName('bromont (2).svg', ['bromont (2).svg']), 'bromont (3).svg', 'keep both of a "(2)" name: the next number, not "(2) (2)"');
  // no fixed export name is left in the Shaper app: Generate, Download and the Sync dialog all name the file through designFileName -> exportFileName
  const main = read('apps/shaper/src/main.js');
  const fixed = fs.readdirSync(path.join(ROOT, 'apps/shaper/src')).filter((f) => f.endsWith('.js') && read('apps/shaper/src/' + f).includes('shaper-export.svg'));
  eq(fixed, [], 'no "shaper-export.svg" literal in apps/shaper/src (the default lives in the one rule)');
  eq([...main.matchAll(/download\(([^,]+),/g)].map((m) => m[1]), ['designFileName()', 'name'], 'the two downloads use the design file name (Download; Generate via name = designFileName())');
  ok(/const name = designFileName\(\);\s*download\(name, payload\.svg\)/.test(main), 'Generate saves under designFileName()');
  ok(/syncFilename\.value = syncNameEdits\.has\(key\) \? syncNameEdits\.get\(key\) : designFileName\(\)/.test(main), 'the Sync dialog starts from designFileName() (or the edit for this design)');
  ok(!/innerHTML/.test(main), 'main.js writes no innerHTML (the success / export lines are built as text)');

  // ── 2. mode 'new', a new name: created; the request shapes ──
  install({ files: ['other.svg'] });
  const r1 = await send({});
  eq([r1.success, r1.status, r1.filename, r1.requested], [true, 'sent', 'bromont.svg', 'bromont.svg'], 'a new name is sent');
  eq(api.steps(), ['token', 'search', 'blob', 'create'], 'new name: sign in, list, upload, create');
  eq(api.names(), ['bromont.svg', 'other.svg'], 'it is in My Files');
  eq(api.blob(api.entry('bromont.svg').blobs[0]), SVG, 'with the SVG uploaded');
  // shaper_sync.py _authenticate (lines 67-82): POST /token, JSON body, X-ApiVersion 2.0.0, the common Origin / Referer
  const [tok, search, blob, create] = api.calls;
  eq([tok.method, tok.url, tok.headers['x-apiversion'], tok.headers['content-type'], tok.headers.origin, tok.headers.referer], ['POST', 'https://auth.shapertools.com/token', '2.0.0', 'application/json', SHAPER_COMMON_HEADERS.Origin, SHAPER_COMMON_HEADERS.Referer], 'token request shape');
  eq(JSON.parse(tok.body), { client_id: '000000000000000000000000', grant_type: 'password', username: FAKE_LOGIN.email, password: FAKE_LOGIN.password, scope: '*', acceptTC: false }, 'token body (shaper_sync.py lines 73-80)');
  // shaper_sync.py list_files (lines 103-117) as get_remote_files calls it (line 196): GET /files/userspace/search, its params
  const su = new URL(search.url);
  eq([search.method, su.origin + su.pathname, [...su.searchParams.entries()]], ['GET', 'https://api.shapertools.com/files/userspace/search', [['spaceType', 'userspace'], ['limit', '200'], ['path', '/'], ['sort', 'modified:-1'], ['type', 'file']]], 'search request shape');
  eq([search.headers.authorization, search.headers['x-apiversion'], search.headers.origin, search.body], [`Bearer ${FAKE_TOKEN}`, '3.0.0', SHAPER_COMMON_HEADERS.Origin, null], 'search headers: the session headers + Bearer, no body');
  eq([blob.method, blob.url, blob.headers['content-type'], blob.headers.authorization], ['POST', 'https://api.shapertools.com/blobs/', 'application/octet-stream', `Bearer ${FAKE_TOKEN}`], 'blob request shape (lines 139-150)');
  eq([create.method, create.url, create.headers['content-type'], JSON.parse(create.body)], ['POST', 'https://api.shapertools.com/files/userspace/tree/bromont.svg', 'application/json', { type: 'file', blobs: ['blob-1'] }], 'create request shape (lines 125-132)');
  done();

  // ── 3. mode 'new', the name exists: answered 'exists' after the search, nothing uploaded or deleted ──
  install({ files: ['bromont.svg', 'other.svg'] });
  const before = api.entry('bromont.svg').blobs[0];
  const r2 = await send({});
  eq([r2.success, r2.status, r2.filename], [false, 'exists', 'bromont.svg'], 'an existing name: "exists"');
  eq(api.steps(), ['token', 'search'], 'exists: nothing uploaded, nothing deleted, nothing created');
  eq([api.names(), api.entry('bromont.svg').blobs[0]], [['bromont.svg', 'other.svg'], before], 'My Files unchanged');
  done();

  // ── 4. 'replace': blob BEFORE delete, then create ──
  install({ files: ['bromont.svg'] });
  const r3 = await send({ mode: 'replace' });
  eq([r3.success, r3.status, r3.filename], [true, 'replaced', 'bromont.svg'], 'replace: "replaced"');
  eq(api.steps(), ['token', 'search', 'blob', 'delete', 'create'], 'replace: the new blob is uploaded BEFORE the old entry is deleted, then created');
  const del = api.calls[3];
  eq([del.method, del.url, del.headers.authorization, del.body], ['DELETE', 'https://api.shapertools.com/files/userspace/tree/bromont.svg', `Bearer ${FAKE_TOKEN}`, null], 'delete request shape (shaper_sync.py delete_file lines 134-137: DELETE the same tree entry)');
  eq(del.url, api.calls[4].url, 'delete and create address the same entry (shaper_sync.py _tree_url for both)');
  eq(api.entry('bromont.svg').blobs, ['blob-1'], 'the entry now holds the NEW blob');
  done();
  // replace of a name that is no longer there: simply sent
  install({ files: [] });
  const r3b = await send({ mode: 'replace' });
  eq([r3b.status, api.steps()], ['sent', ['token', 'search', 'blob', 'create']], 'replace with nothing to replace: sent, no delete');
  done();

  // ── 5. replace that fails: the old file stays ──
  install({ files: ['bromont.svg'], fail: { blob: { status: 500, message: 'Blob store down' } } });
  const e5 = await refused({ mode: 'replace' }, 'blob failure');
  eq([e5.kind, api.steps()], ['shaper', ['token', 'search', 'blob']], 'a blob failure: no delete is ever sent');
  eq([api.names(), api.entry('bromont.svg').blobs], [['bromont.svg'], ['old-blob-1']], 'the old file is in place');
  ok(/Blob upload failed \(500\): Blob store down/.test(e5.message), "Shaper's message kept: " + e5.message);
  done();
  install({ files: ['bromont.svg'], fail: { delete: { status: 403, message: 'Not allowed' } } });
  const e5b = await refused({ mode: 'replace' }, 'delete failure');
  eq(api.steps(), ['token', 'search', 'blob', 'delete'], 'a delete failure: no create');
  eq(api.entry('bromont.svg').blobs, ['old-blob-1'], 'the old file is in place after a failed delete');
  ok(/The old bromont\.svg is still in My Files \(nothing was changed\): removing it failed \(403\): Not allowed/.test(e5b.message), 'says the old file is still there: ' + e5b.message);
  done();
  install({ files: ['bromont.svg'], fail: { create: { status: 500, message: 'Tree down' } } });
  const e5c = await refused({ mode: 'replace' }, 'create failure after the delete');
  ok(/The old bromont\.svg was removed but the new one could not be added \(500\): Tree down\. Send again to add it\./.test(e5c.message), 'a create failure after the delete says so plainly: ' + e5c.message);
  done();

  // ── 6. 'keep-both': the next free name ──
  install({ files: ['bromont.svg'] });
  const r6 = await send({ mode: 'keep-both' });
  eq([r6.status, r6.filename, r6.requested], ['sent', 'bromont (2).svg', 'bromont.svg'], 'keep both: sent as "bromont (2).svg"');
  eq(api.steps(), ['token', 'search', 'blob', 'create'], 'keep both: no delete');
  eq(api.calls[3].url, 'https://api.shapertools.com/files/userspace/tree/bromont%20(2).svg', 'the new name in the tree URL (space encoded, parentheses as requests sends them)');
  eq(api.names(), ['bromont (2).svg', 'bromont.svg'], 'both are in My Files');
  done();
  install({ files: ['bromont.svg', 'bromont (2).svg', 'bromont (3).svg'] });
  const r6b = await send({ mode: 'keep-both' });
  eq(r6b.filename, 'bromont (4).svg', 'keep both with (2) and (3) taken: (4)');
  eq(api.entry('bromont.svg').blobs, ['old-blob-1'], 'the original untouched');
  done();

  // ── 7. errors in plain words; the login in none ──
  install({});
  const e7 = await refused({ password: 'wrong-not-a-real-password' }, 'wrong login');
  eq([e7.kind, e7.message], ['login', 'Authentication failed (401): Username and password could not be verified'], "a wrong login: kind 'login', Shaper's meaning kept");
  eq(api.steps(), ['token'], 'nothing else is called after a refused sign-in');
  done();
  install({ fail: { token: 'network' } });
  const e7b = await refused({}, 'network');
  eq([e7b.kind, e7b.message], ['network', 'Could not reach ShaperHub (signing in): fetch failed'], "no answer: kind 'network'");
  done();
  install({ files: ['other.svg'], fail: { search: { status: 503, message: `  Service\n unavailable for ${FAKE_LOGIN.email} (${FAKE_LOGIN.password})  ` } } });
  const e7c = await refused({}, 'a refusal that repeats the login');
  eq(e7c.kind, 'shaper', "another refusal: kind 'shaper'");
  eq(e7c.message, 'Listing My Files failed (503): Service unavailable for … (…)', "Shaper's message trimmed to one line, the login replaced");
  done();
  install({ fail: { create: { status: 400, message: 'x'.repeat(1000) } } });
  const e7d = await refused({}, 'a long refusal');
  ok(e7d.message.length < 400 && e7d.message.endsWith('…'), 'a long message is cut: ' + e7d.message.length);
  done();
  const e7e = await refused({ mode: 'sideways' }, 'unknown mode');
  eq(e7e.kind, 'input', 'an unknown mode is an input error');
  for (const t of errorTexts) for (const s of SECRETS) ok(!t.includes(s), 'no error text holds the login: ' + t);

  // ── 8. POST /api/shaper-upload: one implementation; the Pages Function passes it through ──
  install({ files: ['bromont.svg'] });
  const viaFn = async (body) => { const res = await onRequestPost({ request: new Request('http://127.0.0.1/api/shaper-upload', { method: 'POST', body }) }); return { status: res.status, type: res.headers.get('content-type'), body: await res.json() }; };
  const f1 = await viaFn(JSON.stringify({ ...FAKE_LOGIN, filename: 'bromont', svg: SVG }));
  eq([f1.status, f1.type, f1.body], [200, 'application/json', { success: false, status: 'exists', filename: 'bromont.svg' }], 'the function: 200 "exists"');
  const f2 = await viaFn(JSON.stringify({ ...FAKE_LOGIN, filename: 'bromont', svg: SVG, mode: 'keep-both' }));
  eq([f2.status, f2.body.status, f2.body.filename], [200, 'sent', 'bromont (2).svg'], 'the function: keep both');
  const f3 = await viaFn(JSON.stringify({ ...FAKE_LOGIN, password: 'wrong-not-a-real-password', filename: 'bromont', svg: SVG }));
  eq([f3.status, f3.body], [400, { error: 'Authentication failed (401): Username and password could not be verified', kind: 'login' }], 'the function: 400 with the kind');
  const f4 = await viaFn(`not json ${FAKE_LOGIN.password}`);
  eq([f4.status, f4.body], [400, { error: 'The upload request is not JSON.', kind: 'input' }], 'not JSON: 400, the request is not quoted back');
  const h = await handleShaperUpload(JSON.stringify({ ...FAKE_LOGIN, filename: 'bromont', svg: SVG }));
  eq(h, { status: 200, body: f1.body }, 'handleShaperUpload answers what the function sends');
  for (const r of [f1, f2, f3, f4]) for (const s of SECRETS) ok(!JSON.stringify(r.body).includes(s), 'no answer holds the login');
  done();
  const fnSrc = read('functions/api/shaper-upload.js'), srvSrc = read('server.js');
  ok(/handleShaperUpload\(await request\.text\(\)\)/.test(fnSrc) && !/uploadToShaperHub/.test(fnSrc.replace(/^\/\/.*$/gm, '')), 'the Pages Function only passes the request text through');
  ok(/m\.handleShaperUpload\(bodyStr\)/.test(srvSrc) && !/uploadToShaperHub/.test(srvSrc), 'server.js only passes the request text through');

  eq(allBlocked, [], 'no request left for anywhere but the fake Shaper API');
  console.log(`network: every Shaper call answered by the fake API; ${allBlocked.length} other non-local requests blocked`);
  console.log(`shaperhub-name-767.test.js: ${checks} checks pass`);
} finally {
  globalThis.fetch = realFetch;
}
