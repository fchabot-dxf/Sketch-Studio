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

// ── THE REQUEST CONTRACT of POST /api/shaper-upload (TASK 767), declared once: functions/api/shaper-upload.js (the site) and server.js (local dev)
// only pass the request text to handleShaperUpload below and send back what it answers.
//   request  JSON { email, password, filename, svg, mode }   mode = 'new' (the default) | 'replace' | 'keep-both'
//            filename goes through shaperFileName (the name rule below) first.
//   answers  200 { success: true,  status: 'sent',     filename, requested, blobId, file }  a new entry `filename` (keep-both: the next free name,
//                                                                                          so filename !== requested)
//            200 { success: true,  status: 'replaced', filename, requested, blobId, file }  the old entry of that name removed, the new one added
//            200 { success: false, status: 'exists',   filename }                           mode 'new' and the name is already in My Files: NOTHING was
//                                                                                          uploaded; the client asks, then sends again with mode
//                                                                                          'replace' or 'keep-both'
//            400 { error, kind }   kind = 'input' (a bad request) | 'login' (Shaper refused the sign-in) | 'network' (ShaperHub could not be reached)
//                                  | 'shaper' (Shaper refused another call: its own message, trimmed). No error text ever holds the email or password.
//   The order of the calls: shaper_sync.py sync_file (lines 158-175) lists the remote folder FIRST, and the way Shaper refuses a create of a taken
//   name is not documented there (create_file_entry only raise_for_status, line 131), so this checks first too:
//   sign in (POST auth /token) -> list My Files (GET /files/userspace/search) -> [taken + mode 'new': stop, answer 'exists', nothing uploaded]
//   -> upload the blob (POST /blobs/) -> [replace: DELETE the old entry, only now that the new blob is uploaded] -> create the entry
//   (POST /files/userspace/tree/<name>). shaper_sync.py deletes BEFORE it uploads (lines 168-174); this deletes after, so a failed blob upload
//   never costs the old file.
export const UPLOAD_MODES = Object.freeze({ NEW: 'new', REPLACE: 'replace', KEEP_BOTH: 'keep-both' });

// ── THE NAME RULE (TASK 767), declared once: the Shaper app's export names (apps/shaper/src/export-payload.js exportFileName: Generate Shaper SVG, the
// sidebar Download, the Sync dialog's file name) and the upload below all go through it. Letters, digits, _ - . space and ( ) are kept (the
// parentheses since TASK 767: "bromont (2).svg"), any other character becomes _, an empty name is the default, and the name ends in .svg.
export const SHAPER_DEFAULT_NAME = 'shaper-export';
export function shaperFileName(name) {
  const clean = String(name == null ? '' : name).trim().replace(/[^a-zA-Z0-9_\-. ()]/g, '_');
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

// shaper_sync.py _tree_url (lines 53-56): the entry of `name` in the user's space; create_file_entry (lines 125-132) and delete_file (lines 134-137)
// both use it. Only the root folder is used here. For the root shaper_sync builds ".../tree/" + "/" + name ("tree//name"); this keeps the single
// slash the upload has used since it shipped (the owner's files were created with it).
const treeUrl = (name) => `${SHAPER_API_URL}/files/userspace/tree/${encodeURIComponent(name)}`;

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

// shaper_sync.py list_files (lines 103-117) as get_remote_files calls it (lines 192-197): GET /files/userspace/search, the files of the root folder,
// the names in response.results. Its limit is 200, the most recently modified first.
async function myFileNames(token, secrets) {
  const params = new URLSearchParams({ spaceType: 'userspace', limit: '200', path: '/', sort: 'modified:-1', type: 'file' });
  const res = await shaperCall('listing My Files', `${SHAPER_API_URL}/files/userspace/search?${params}`, { method: 'GET', headers: authHeaders(token) }, secrets);
  if (!res.ok) throw new ShaperHubError('shaper', `Listing My Files failed (${res.status}): ${await refusalMessage(res, secrets)}`);
  const data = await res.json();
  const results = data && Array.isArray(data.results) ? data.results : [];
  return results.map((f) => f && f.name).filter((n) => typeof n === 'string');
}

// shaper_sync.py upload_blob (lines 139-150): POST /blobs/ the raw bytes, the id at blobs[0]
async function uploadBlob(token, svg, secrets) {
  const rawBytes = typeof svg === 'string' ? new TextEncoder().encode(svg) : svg;
  const res = await shaperCall('uploading the file', `${SHAPER_API_URL}/blobs/`, {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/octet-stream' }),
    body: rawBytes,
  }, secrets);
  if (!res.ok) throw new ShaperHubError('shaper', `Blob upload failed (${res.status}): ${await refusalMessage(res, secrets)}`);
  const data = await res.json();
  const blobId = data && Array.isArray(data.blobs) ? data.blobs[0] : null;
  if (!blobId) throw new ShaperHubError('shaper', 'Failed to retrieve blob ID from Shaper');
  return blobId;
}

/**
 * Send an SVG to the user's ShaperHub "My Files" (the root folder) through the Shaper API. The request contract and the order of the calls: the
 * comment above UPLOAD_MODES.
 * @param {Object} opts
 * @param {string} opts.email - Shaper account email
 * @param {string} opts.password - Shaper account password
 * @param {string} [opts.filename] - the file name; shaperFileName applies (empty: 'shaper-export.svg')
 * @param {string|Uint8Array} opts.svg - SVG contents
 * @param {string} [opts.mode='new'] - UPLOAD_MODES: 'new' (answers 'exists' when the name is taken), 'replace', 'keep-both'
 * @param {Function} [opts.onProgress] - Optional status progress callback (step: string)
 * @returns {Promise<{ success: boolean, status: 'sent'|'replaced'|'exists', filename: string, requested?: string, blobId?: string, file?: any }>}
 * @throws {ShaperHubError}
 */
export async function uploadToShaperHub({ email, password, filename, svg, mode = UPLOAD_MODES.NEW, onProgress = () => {} }) {
  if (!email || !String(email).trim()) throw new ShaperHubError('input', 'Shaper account email is required');
  if (!password) throw new ShaperHubError('input', 'Shaper account password is required');
  if (!svg) throw new ShaperHubError('input', 'SVG content is required');
  const secrets = [String(email), String(email).trim(), String(password)];
  if (!Object.values(UPLOAD_MODES).includes(mode)) throw new ShaperHubError('input', `Unknown upload mode: ${plainMessage(mode, secrets)}`);
  const name = shaperFileName(filename);

  // Step 1: Authenticate to get access JWT token
  onProgress('authenticating');
  const token = await signIn(email, password, secrets);

  // Step 2: is the name already in My Files? (shaper_sync.py sync_file lines 166-168: `local_file.name in remote_files`, the exact name)
  onProgress('checking_name');
  const taken = await myFileNames(token, secrets);
  const exists = taken.includes(name);
  if (exists && mode === UPLOAD_MODES.NEW) {
    onProgress('done');
    return { success: false, status: 'exists', filename: name };
  }
  const target = exists && mode === UPLOAD_MODES.KEEP_BOTH ? nextFreeName(name, taken) : name;
  const replacing = exists && mode === UPLOAD_MODES.REPLACE;

  // Step 3: Upload blob (raw SVG payload)
  onProgress('uploading_blob');
  const blobId = await uploadBlob(token, svg, secrets);

  // Step 4 (replace only; shaper_sync.py delete_file, lines 134-137): remove the old entry, now that the new blob is safely uploaded
  if (replacing) {
    onProgress('removing_old');
    const res = await shaperCall('removing the old file', treeUrl(name), { method: 'DELETE', headers: authHeaders(token) }, secrets);
    if (!res.ok) throw new ShaperHubError('shaper', `The old ${name} is still in My Files (nothing was changed): removing it failed (${res.status}): ${await refusalMessage(res, secrets)}`);
  }

  // Step 5: Link blob to My Files entry in userspace tree (shaper_sync.py create_file_entry, lines 125-132)
  onProgress('linking_tree');
  const fileRes = await shaperCall('adding the file to My Files', treeUrl(target), {
    method: 'POST',
    headers: authHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      type: 'file',
      blobs: [blobId],
    }),
  }, secrets);
  if (!fileRes.ok) {
    const why = `(${fileRes.status}): ${await refusalMessage(fileRes, secrets)}`;
    throw new ShaperHubError('shaper', replacing
      ? `The old ${name} was removed but the new one could not be added ${why}. Send again to add it.`
      : `Creating file in My Files failed ${why}`);
  }

  const fileData = await fileRes.json();
  onProgress('done');
  return { success: true, status: replacing ? 'replaced' : 'sent', filename: target, requested: name, blobId, file: fileData };
}

/** POST /api/shaper-upload, declared once (the contract above): the request's TEXT in, { status, body } out. The Pages Function and server.js
 *  send `body` back as JSON with `status`. An error text never holds the request (a JSON parse error quotes it) nor the login. */
export async function handleShaperUpload(text) {
  let request;
  try {
    request = JSON.parse(text);
  } catch (err) {
    return { status: 400, body: { error: 'The upload request is not JSON.', kind: 'input' } };
  }
  const opts = request && typeof request === 'object' ? request : {};
  try {
    return { status: 200, body: await uploadToShaperHub(opts) };
  } catch (err) {
    const secrets = [opts.email, opts.password].filter((s) => typeof s === 'string').flatMap((s) => [s, s.trim()]);
    return { status: 400, body: { error: plainMessage(err && err.message, secrets), kind: err instanceof ShaperHubError ? err.kind : 'shaper' } };
  }
}
