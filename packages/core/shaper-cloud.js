// packages/core/shaper-cloud.js — direct programmatic upload to ShaperHub / Shaper Origin "My Files".
// PURE, uses standard fetch (Node 18+, Cloudflare Workers, modern runtimes).
//
// CREDIT: the ShaperHub calls below (the /token sign-in, the /blobs/ upload and the /files/userspace/tree entry, their headers and
// field names) are a JavaScript port of shaper-sync by Antoine Millet: https://github.com/NaPs/shaper-sync (shaper_sync.py), MIT licence.
// TASK 767: the "is this name already in My Files" check (list_files / get_remote_files: GET /files/userspace/search) and the replace
// (sync_file's update: delete_file, a DELETE of the same /files/userspace/tree entry, then a new entry) are ported from the same file.
// Shaper publishes no API; shaper-sync documents the one its own apps use. The notice its licence requires:
//
// MIT License
//
// Copyright (c) 2026 Antoine Millet
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// (also listed in THIRD-PARTY-NOTICES.md at the repo root)

export const SHAPER_AUTH_URL = 'https://auth.shapertools.com';
export const SHAPER_API_URL = 'https://api.shapertools.com';
export const SHAPER_HUB_ORIGIN = 'https://hub.shapertools.com';

export const SHAPER_COMMON_HEADERS = {
  'Origin': SHAPER_HUB_ORIGIN,
  'Referer': `${SHAPER_HUB_ORIGIN}/`,
  'X-ApiVersion': '3.0.0',
};

// ── THE REQUEST CONTRACT of POST /api/shaper-upload (TASK 767 / 772), declared once: functions/api/shaper-upload.js (the site) and server.js (local dev)
// only pass the request text to handleShaperUpload below and send back what it answers.
//   auth: `token` (in-memory session JWT from an earlier call) OR `email` + `password` (when both are sent with a stale token, re-signs in once on 401);
//         TASK 774: an upload with mode 'replace' ALWAYS carries `email` + `password` (with or without a token), else 400 kind 'login' before any call
//   action = 'upload' (default) | 'list' | 'mkdir'
//   action='list'   JSON { token | email+password, remotePath? }
//                   -> 200 { success: true, path, folders: [{ name, path, modified }], files: [{ name, modified }], token }
//   action='mkdir'  JSON { token | email+password, remotePath?, folderName }
//                   -> 200 { success: true, path, parent, name, token }
//   action='upload' JSON { token | email+password, remotePath?, filename, svg, mode }   mode = 'new' (default) | 'replace' | 'keep-both'
//                   -> 200 { success: true, status: 'sent'|'replaced', filename, requested, remotePath, blobId, file, token }
//                   |  200 { success: false, status: 'exists', filename, remotePath, token }
//   400 { error, kind }   kind = 'input' | 'login' | 'network' | 'shaper' (no error text ever holds email, password or token)
export const UPLOAD_MODES = Object.freeze({ NEW: 'new', REPLACE: 'replace', KEEP_BOTH: 'keep-both' });
export const SHAPER_ACTIONS = Object.freeze({ UPLOAD: 'upload', LIST: 'list', MKDIR: 'mkdir' });

/** Normalise a ShaperHub folder path: always starts and ends with '/' ('/' for My Files root); rejects '..' and control chars. */
export function normalizeRemotePath(raw) {
  if (raw == null || String(raw).trim() === '') return '/';
  const s = String(raw).replace(/\\+/g, '/').trim();
  if (/[\x00-\x1f]/.test(s)) throw new ShaperHubError('input', 'Invalid folder path.');
  const parts = s.split('/').filter((p) => p.length > 0 && p !== '.');
  if (parts.some((p) => p === '..')) throw new ShaperHubError('input', 'Invalid folder path.');
  return parts.length ? `/${parts.join('/')}/` : '/';
}

/** Validate a new single subfolder name and join it under `remotePath`. */
export function joinRemotePath(remotePath, folderName) {
  const base = normalizeRemotePath(remotePath);
  const name = String(folderName == null ? '' : folderName).trim();
  if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) {
    throw new ShaperHubError('input', 'Enter a folder name without / or \\.');
  }
  return { parent: base, name, path: `${base}${name}/` };
}

// ── THE NAME RULE (TASK 767), declared once: the Shaper app's export names (apps/shaper/src/export-payload.js exportFileName: Generate Shaper SVG, the
// sidebar Download, the Sync dialog's file name) and the upload below all go through it. Letters, digits, _ - . space and ( ) are kept (the
// parentheses since TASK 767: "bromont (2).svg"), any other character becomes _, an empty name is the default, and the name ends in .svg.
// TASK 774 (owner turn 2356): an ACCENTED letter first becomes its plain letter ("Étagère" -> "Etagere", "ç" -> "c": the NFD form without its
// combining accents, U+0300-U+036F, then recomposed so a character with no plain form stays ONE character and so ONE _), and a ligature becomes
// its letters (SHAPER_NAME_LIGATURES: "œ" -> "oe"); any other character still becomes _.
export const SHAPER_DEFAULT_NAME = 'shaper-export';
export const SHAPER_NAME_LIGATURES = Object.freeze({ 'œ': 'oe', 'Œ': 'OE', 'æ': 'ae', 'Æ': 'AE', 'ß': 'ss' });
const plainLetters = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
  .replace(/[œŒæÆß]/g, (c) => SHAPER_NAME_LIGATURES[c]);
export function shaperFileName(name) {
  const clean = plainLetters(String(name == null ? '' : name).trim()).replace(/[^a-zA-Z0-9_\-. ()]/g, '_');
  return (clean || SHAPER_DEFAULT_NAME).replace(/(\.svg)?$/i, '.svg');
}

/** "Keep both": the first `<base> (n).svg`, n = 2, 3, ..., that is not among `taken` (the names in My Files). <base> = the name (shaperFileName)
 *  without .svg and without a " (n)" it already ends with: keeping both of "bromont (2).svg" gives "bromont (3).svg" when that one is free. */
export function nextFreeName(name, taken) {
  const have = new Set(taken);
  const base = shaperFileName(name).replace(/\.svg$/i, '').replace(/ \(\d+\)$/, '');
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n}).svg`;
    if (!have.has(candidate)) return candidate;
  }
}

/** A refusal the client can explain: kind = 'input' | 'login' | 'network' | 'shaper' (see the contract above). */
export class ShaperHubError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'ShaperHubError';
    this.kind = kind;
  }
}

// Shaper's own words, on one line, at most MAX_MESSAGE characters, with every copy of the login replaced (a message must never carry it)
const MAX_MESSAGE = 300;
function plainMessage(text, secrets) {
  let t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  for (const s of secrets) if (s) t = t.split(s).join('…');
  return t.length > MAX_MESSAGE ? t.slice(0, MAX_MESSAGE - 1) + '…' : t;
}

// The message of a refused call: its JSON `message` when the body is JSON that has one (shaper_sync.py lines 84-88 read the sign-in's refusal so),
// else the body as it came.
async function refusalMessage(res, secrets) {
  const text = await res.text();
  let msg = text;
  if (/^\s*\{/.test(text)) {
    try {
      const body = JSON.parse(text);
      if (body && typeof body.message === 'string' && body.message) msg = body.message;
    } catch (err) {
      msg = text; // it only looked like JSON: Shaper's text as it came (shaper_sync.py lines 87-88 do the same)
    }
  }
  return plainMessage(msg, secrets) || res.statusText || 'no message';
}

// One request to Shaper; a request that never got an answer (offline, DNS, a refused connection) is a 'network' error naming the step
async function shaperCall(step, url, init, secrets) {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new ShaperHubError('network', `Could not reach ShaperHub (${step}): ${plainMessage(err && err.message ? err.message : String(err), secrets)}`);
  }
}

const authHeaders = (token, extra = {}) => ({ ...SHAPER_COMMON_HEADERS, 'Authorization': `Bearer ${token}`, ...extra });

// shaper_sync.py _tree_url (lines 53-56): the entry of `name` inside `remotePath` in the user's space.
// Root ('/') keeps the single slash ".../tree/<name>" that shipped (TASK 767); subfolders join segments cleanly.
const treeUrl = (remotePath, name) => {
  const segs = normalizeRemotePath(remotePath).split('/').filter(Boolean);
  segs.push(name);
  return `${SHAPER_API_URL}/files/userspace/tree/${segs.map(encodeURIComponent).join('/')}`;
};

// shaper_sync.py _authenticate (lines 67-101): POST /token, the JWT at access_token.token
async function signIn(email, password, secrets) {
  const res = await shaperCall('signing in', `${SHAPER_AUTH_URL}/token`, {
    method: 'POST',
    headers: {
      ...SHAPER_COMMON_HEADERS,
      'X-ApiVersion': '2.0.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: '000000000000000000000000',
      grant_type: 'password',
      username: String(email).trim(),
      password: String(password),
      scope: '*',
      acceptTC: false,
    }),
  }, secrets);
  if (res.status !== 200) {
    const kind = [400, 401, 403].includes(res.status) ? 'login' : 'shaper';
    throw new ShaperHubError(kind, `Authentication failed (${res.status}): ${await refusalMessage(res, secrets)}`);
  }
  const data = await res.json();
  const token = data && data.access_token && data.access_token.token;
  if (!token) throw new ShaperHubError('shaper', 'Failed to extract access token from Shaper auth response');
  return token;
}

// Authenticates from token or email+password, and retries once on 401 when credentials were supplied.
async function makeSession({ email, password, token }, secrets, onProgress = () => {}) {
  const hasToken = typeof token === 'string' && token.trim().length > 0;
  const hasCreds = !!(email && String(email).trim() && password);
  if (!hasToken) {
    if (!email || !String(email).trim()) throw new ShaperHubError('input', 'Shaper account email is required');
    if (!password) throw new ShaperHubError('input', 'Shaper account password is required');
  }
  let activeToken = hasToken ? String(token).trim() : null;
  if (!activeToken) {
    onProgress('authenticating');
    activeToken = await signIn(email, password, secrets);
  }
  async function authedCall(step, url, makeInit) {
    let res = await shaperCall(step, url, makeInit(activeToken), secrets);
    if (res.status === 401) {
      if (!hasCreds) throw new ShaperHubError('login', 'Session expired. Sign in again to continue.');
      onProgress('authenticating');
      activeToken = await signIn(email, password, [...secrets, activeToken]);
      res = await shaperCall(step, url, makeInit(activeToken), [...secrets, activeToken]);
    }
    return res;
  }
  return { authedCall, token: () => activeToken };
}

// shaper_sync.py list_files (lines 103-117): GET /files/userspace/search for a folder path.
async function searchUserspace(session, remotePath, fileType, secrets) {
  const q = { spaceType: 'userspace', limit: '200', path: remotePath, sort: 'modified:-1' };
  if (fileType) q.type = fileType;
  const params = new URLSearchParams(q);
  const res = await session.authedCall('listing My Files', `${SHAPER_API_URL}/files/userspace/search?${params}`, (tok) => ({ method: 'GET', headers: authHeaders(tok) }));
  if (!res.ok) throw new ShaperHubError('shaper', `Listing My Files failed (${res.status}): ${await refusalMessage(res, secrets)}`);
  const data = await res.json();
  return data && Array.isArray(data.results) ? data.results : [];
}

async function myFileNames(session, remotePath, secrets) {
  const results = await searchUserspace(session, remotePath, 'file', secrets);
  return results.map((f) => f && f.name).filter((n) => typeof n === 'string');
}

// shaper_sync.py upload_blob (lines 139-150): POST /blobs/ the raw bytes, the id at blobs[0]
async function uploadBlob(session, svg, secrets) {
  const rawBytes = typeof svg === 'string' ? new TextEncoder().encode(svg) : svg;
  const res = await session.authedCall('uploading the file', `${SHAPER_API_URL}/blobs/`, (tok) => ({
    method: 'POST',
    headers: authHeaders(tok, { 'Content-Type': 'application/octet-stream' }),
    body: rawBytes,
  }));
  if (!res.ok) throw new ShaperHubError('shaper', `Blob upload failed (${res.status}): ${await refusalMessage(res, secrets)}`);
  const data = await res.json();
  const blobId = data && Array.isArray(data.blobs) ? data.blobs[0] : null;
  if (!blobId) throw new ShaperHubError('shaper', 'Failed to retrieve blob ID from Shaper');
  return blobId;
}

/** List subfolders and files inside `remotePath` in the user's ShaperHub My Files. */
export async function listShaperHubFolder({ email, password, token, remotePath = '/', onProgress = () => {} }) {
  const path = normalizeRemotePath(remotePath);
  const secrets = [email, email && String(email).trim(), password, token].filter((s) => typeof s === 'string' && s);
  const session = await makeSession({ email, password, token }, secrets, onProgress);
  onProgress('listing');
  const results = await searchUserspace(session, path, null, secrets);
  const folders = [];
  const files = [];
  for (const item of results) {
    if (!item || typeof item.name !== 'string' || !item.name) continue;
    if (item.type === 'folder') {
      folders.push({ name: item.name, path: `${path}${item.name}/`, modified: item.modified || null });
    } else {
      files.push({ name: item.name, modified: item.modified || null });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  onProgress('done');
  return { success: true, path, folders, files, token: session.token() };
}

/** Create a subfolder inside `remotePath` in the user's ShaperHub My Files (shaper_sync.py create_folder). */
export async function createShaperHubFolder({ email, password, token, remotePath = '/', folderName, onProgress = () => {} }) {
  const { parent, name, path } = joinRemotePath(remotePath, folderName);
  const secrets = [email, email && String(email).trim(), password, token].filter((s) => typeof s === 'string' && s);
  const session = await makeSession({ email, password, token }, secrets, onProgress);
  onProgress('creating_folder');
  const res = await session.authedCall('creating folder', treeUrl(parent, name), (tok) => ({
    method: 'POST',
    headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ type: 'folder' }),
  }));
  if (!res.ok) throw new ShaperHubError('shaper', `Creating folder failed (${res.status}): ${await refusalMessage(res, secrets)}`);
  onProgress('done');
  return { success: true, path, parent, name, token: session.token() };
}

/**
 * Send an SVG to the user's ShaperHub "My Files" (at `remotePath`, root '/' by default) through the Shaper API.
 * Accepts either `{ token }` or `{ email, password }` and returns the active session `token` alongside the upload result.
 */
export async function uploadToShaperHub({ email, password, token, session: includeToken = false, remotePath = '/', filename, svg, mode = UPLOAD_MODES.NEW, onProgress = () => {} }) {
  if (!svg) throw new ShaperHubError('input', 'SVG content is required');
  const path = normalizeRemotePath(remotePath);
  const secrets = [email, email && String(email).trim(), password, token].filter((s) => typeof s === 'string' && s);
  if (!Object.values(UPLOAD_MODES).includes(mode)) throw new ShaperHubError('input', `Unknown upload mode: ${plainMessage(mode, secrets)}`);
  const name = shaperFileName(filename);
  // TASK 774, THE REPLACE RULE: a Replace DELETEs the old entry and then creates the new one; a session that ends between the two would cost the
  // old file. So a Replace always carries the login (email + password) even when a session token is held: the token is tried first and a 401 at
  // ANY step, the create after the DELETE included, signs in again once (makeSession). A Replace without the login is refused before any call.
  if (mode === UPLOAD_MODES.REPLACE && !(email && String(email).trim() && password)) {
    throw new ShaperHubError('login', 'Sign in again to replace a file: a Replace needs your email and password.');
  }

  const session = await makeSession({ email, password, token }, secrets, onProgress);

  // Step 2: is the name already in the target folder?
  onProgress('checking_name');
  const taken = await myFileNames(session, path, secrets);
  const exists = taken.includes(name);
  if (exists && mode === UPLOAD_MODES.NEW) {
    onProgress('done');
    return {
      success: false,
      status: 'exists',
      filename: name,
      ...(path !== '/' ? { remotePath: path } : {}),
      ...(includeToken ? { token: session.token() } : {}),
    };
  }
  const target = exists && mode === UPLOAD_MODES.KEEP_BOTH ? nextFreeName(name, taken) : name;
  const replacing = exists && mode === UPLOAD_MODES.REPLACE;

  // Step 3: Upload blob (raw SVG payload)
  onProgress('uploading_blob');
  const blobId = await uploadBlob(session, svg, secrets);

  // Step 4 (replace only; shaper_sync.py delete_file, lines 134-137): remove the old entry, now that the new blob is safely uploaded
  if (replacing) {
    onProgress('removing_old');
    const res = await session.authedCall('removing the old file', treeUrl(path, name), (tok) => ({ method: 'DELETE', headers: authHeaders(tok) }));
    if (!res.ok) throw new ShaperHubError('shaper', `The old ${name} is still in My Files (nothing was changed): removing it failed (${res.status}): ${await refusalMessage(res, secrets)}`);
  }

  // Step 5: Link blob to entry in userspace tree (shaper_sync.py create_file_entry, lines 125-132)
  onProgress('linking_tree');
  // TASK 774: after the DELETE of a Replace, ANY failure of the create (a refusal, a session that could not be renewed, no answer) says that the old
  // file is gone and how to get the new one there, with the failure's own words in brackets; the failure's kind is kept (a 'login' still asks to sign in).
  const removedButNotAdded = (kind, why) => new ShaperHubError(kind, `The old ${name} was removed but the new one could not be added ${why}. Send again to add it.`);
  let fileRes;
  try {
    fileRes = await session.authedCall('adding the file to My Files', treeUrl(path, target), (tok) => ({
      method: 'POST',
      headers: authHeaders(tok, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        type: 'file',
        blobs: [blobId],
      }),
    }));
  } catch (err) {
    if (replacing && err instanceof ShaperHubError) throw removedButNotAdded(err.kind, `(${err.message.replace(/\.$/, '')})`);
    throw err;
  }
  if (!fileRes.ok) {
    const why = `(${fileRes.status}): ${await refusalMessage(fileRes, secrets)}`;
    throw replacing ? removedButNotAdded('shaper', why) : new ShaperHubError('shaper', `Creating file in My Files failed ${why}`);
  }

  const fileData = await fileRes.json();
  onProgress('done');
  return {
    success: true,
    status: replacing ? 'replaced' : 'sent',
    filename: target,
    requested: name,
    blobId,
    file: fileData,
    ...(path !== '/' ? { remotePath: path } : {}),
    ...(includeToken ? { token: session.token() } : {}),
  };
}

/** POST /api/shaper-upload, declared once (the contract above): dispatches action ('upload'|'list'|'mkdir') and redacts secrets on errors. */
export async function handleShaperUpload(text) {
  let request;
  try {
    request = JSON.parse(text);
  } catch (err) {
    return { status: 400, body: { error: 'The upload request is not JSON.', kind: 'input' } };
  }
  const opts = request && typeof request === 'object' ? request : {};
  const action = opts.action || SHAPER_ACTIONS.UPLOAD;
  try {
    if (action === SHAPER_ACTIONS.LIST) return { status: 200, body: await listShaperHubFolder(opts) };
    if (action === SHAPER_ACTIONS.MKDIR) return { status: 200, body: await createShaperHubFolder(opts) };
    if (action === SHAPER_ACTIONS.UPLOAD) return { status: 200, body: await uploadToShaperHub(opts) };
    throw new ShaperHubError('input', `Unknown action: ${action}`);
  } catch (err) {
    const secrets = [opts.email, opts.password, opts.token].filter((s) => typeof s === 'string').flatMap((s) => [s, s.trim()]);
    return { status: 400, body: { error: plainMessage(err && err.message, secrets), kind: err instanceof ShaperHubError ? err.kind : 'shaper' } };
  }
}
