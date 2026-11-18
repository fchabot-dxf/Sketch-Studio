// tests/shaperhub-browser-772-node.test.js -- Task 772: ShaperHub folder browser (list, mkdir, nested upload/replace/keep-both,
// in-memory token reuse & 401 expiry recovery) + path normalization + secret redaction via handleShaperUpload & shaperhub-fake-api.js.
import assert from 'node:assert';
import { createFakeShaperApi, FAKE_LOGIN, FAKE_TOKEN } from './shaperhub-fake-api.js';
import {
  listShaperHubFolder,
  createShaperHubFolder,
  uploadToShaperHub,
  handleShaperUpload,
  normalizeRemotePath,
  joinRemotePath,
  ShaperHubError,
  UPLOAD_MODES,
  SHAPER_ACTIONS,
} from '#core/shaper-cloud.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
let checks = 0;

// 1. Path normalization & validation
assert.strictEqual(normalizeRemotePath(null), '/');
assert.strictEqual(normalizeRemotePath('  '), '/');
assert.strictEqual(normalizeRemotePath('Furniture/Chairs'), '/Furniture/Chairs/');
assert.strictEqual(normalizeRemotePath('\\Projects\\Box\\'), '/Projects/Box/');
assert.deepStrictEqual(joinRemotePath('/Furniture/', 'Stools'), {
  parent: '/Furniture/',
  name: 'Stools',
  path: '/Furniture/Stools/',
});
for (const bad of ['../secret', 'ok/../bad', 'line\0char']) {
  assert.throws(() => normalizeRemotePath(bad), ShaperHubError);
  checks++;
}
for (const badName of ['', '.', '..', 'a/b', 'a\\b']) {
  assert.throws(() => joinRemotePath('/', badName), ShaperHubError);
  checks++;
}
checks += 5;

// 2. Folder listing + navigation + mkdir + upload in nested subfolder via cached token
const origFetch = globalThis.fetch;
const api = createFakeShaperApi({
  files: ['root-only.svg', 'Furniture/chair.svg', 'Furniture/Oak/leg.svg'],
  folders: ['Furniture', 'EmptyFolder', 'Furniture/Oak'],
});
globalThis.fetch = api.fetch;
try {
  // Sign in once via listShaperHubFolder -> returns root folders, root files, and active token
  const root = await listShaperHubFolder({ ...FAKE_LOGIN, remotePath: '/' });
  assert.strictEqual(root.success, true);
  assert.strictEqual(root.path, '/');
  assert.strictEqual(root.token, FAKE_TOKEN);
  assert.deepStrictEqual(root.folders.map((f) => f.name), ['EmptyFolder', 'Furniture']);
  assert.deepStrictEqual(root.files.map((f) => f.name), ['root-only.svg']);
  assert.deepStrictEqual(api.steps(), ['token', 'search']);
  checks += 6;

  // Reuse returned token (no email/password sent!) to navigate into /Furniture/
  api.reset();
  const furn = await listShaperHubFolder({ token: root.token, remotePath: '/Furniture/' });
  assert.strictEqual(furn.path, '/Furniture/');
  assert.deepStrictEqual(furn.folders.map((f) => f.name), ['Oak']);
  assert.deepStrictEqual(furn.files.map((f) => f.name), ['chair.svg']);
  assert.deepStrictEqual(api.steps(), ['search']);
  checks += 4;

  // Create a subfolder inside /Furniture/ via handleShaperUpload action='mkdir' using token only
  api.reset();
  const mk = await handleShaperUpload(JSON.stringify({
    action: SHAPER_ACTIONS.MKDIR,
    token: root.token,
    remotePath: '/Furniture/',
    folderName: 'Tables',
  }));
  assert.strictEqual(mk.status, 200);
  assert.strictEqual(mk.body.path, '/Furniture/Tables/');
  assert.strictEqual(mk.body.token, FAKE_TOKEN);
  assert.deepStrictEqual(api.steps(), ['create']);
  assert.ok(api.folders().includes('/Furniture/Tables/'));
  checks += 5;

  // Upload into /Furniture/Tables/ via handleShaperUpload action='upload' with token only
  api.reset();
  const up1 = await handleShaperUpload(JSON.stringify({
    action: SHAPER_ACTIONS.UPLOAD,
    token: root.token,
    remotePath: '/Furniture/Tables/',
    filename: 'apron.svg',
    svg: SVG,
    session: true,
  }));
  assert.strictEqual(up1.status, 200);
  assert.strictEqual(up1.body.success, true);
  assert.strictEqual(up1.body.status, 'sent');
  assert.strictEqual(up1.body.remotePath, '/Furniture/Tables/');
  assert.strictEqual(up1.body.token, FAKE_TOKEN);
  assert.deepStrictEqual(api.steps(), ['search', 'blob', 'create']);
  assert.deepStrictEqual(api.names('/Furniture/Tables/'), ['apron.svg']);
  checks += 7;

  // Root check: same filename at '/' still succeeds because 'apron.svg' only exists in /Furniture/Tables/
  api.reset();
  const upRoot = await uploadToShaperHub({ token: root.token, remotePath: '/', filename: 'apron.svg', svg: SVG, session: true });
  assert.strictEqual(upRoot.success, true);
  assert.strictEqual(upRoot.status, 'sent');
  assert.deepStrictEqual(api.names('/'), ['apron.svg', 'root-only.svg']);
  checks += 3;

  // Duplicate inside /Furniture/Tables/: returns exists -> Replace & Keep both stay inside /Furniture/Tables/
  api.reset();
  const dup = await uploadToShaperHub({ token: root.token, remotePath: '/Furniture/Tables/', filename: 'apron.svg', svg: SVG, session: true });
  assert.deepStrictEqual(dup, { success: false, status: 'exists', filename: 'apron.svg', remotePath: '/Furniture/Tables/', token: FAKE_TOKEN });
  const kb = await uploadToShaperHub({ token: root.token, remotePath: '/Furniture/Tables/', filename: 'apron.svg', svg: SVG, mode: UPLOAD_MODES.KEEP_BOTH, session: true });
  assert.strictEqual(kb.filename, 'apron (2).svg');
  assert.strictEqual(kb.remotePath, '/Furniture/Tables/');
  const rep = await uploadToShaperHub({ token: root.token, remotePath: '/Furniture/Tables/', filename: 'apron.svg', svg: SVG, mode: UPLOAD_MODES.REPLACE, session: true });
  assert.strictEqual(rep.status, 'replaced');
  assert.deepStrictEqual(api.names('/Furniture/Tables/'), ['apron (2).svg', 'apron.svg']);
  checks += 5;

  // 3. Expired token recovery: token rotated server-side -> token-only fails (401 login), email+password re-signs in with new token
  api.rotateToken('fresh-jwt-999');
  api.reset();
  const expiredNoCreds = await handleShaperUpload(JSON.stringify({ action: 'list', token: FAKE_TOKEN, remotePath: '/' }));
  assert.strictEqual(expiredNoCreds.status, 400);
  assert.strictEqual(expiredNoCreds.body.kind, 'login');
  assert.ok(!expiredNoCreds.body.error.includes(FAKE_TOKEN), 'token redacted from error');

  api.reset();
  const refreshed = await listShaperHubFolder({ ...FAKE_LOGIN, token: FAKE_TOKEN, remotePath: '/Furniture/' });
  assert.strictEqual(refreshed.token, 'fresh-jwt-999');
  assert.deepStrictEqual(api.steps(), ['search', 'token', 'search']);
  checks += 5;
} finally {
  globalThis.fetch = origFetch;
}

console.log(`shaperhub-browser-772-node: ${checks} checks passed`);
