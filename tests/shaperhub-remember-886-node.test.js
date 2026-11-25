// tests/shaperhub-remember-886-node.test.js — TASK 886 (owner turns 3612-3614): "Remember login on this computer" in Shaper's Sync to ShaperHub dialog, in Node
// (no browser). It REVERSES task 758's "the app keeps no login" (owner turn 2260 superseded): the login is kept, on the user's choice, under ONE localStorage key.
//   1. the key: declared ONCE (shaperhub-login.js REMEMBER_LOGIN_KEY), a NEW name (not 758's OLD_LOGIN_KEY, which forgetOldLogin deletes at start; that one is
//      never read, and forgetOldLogin leaves the new key alone);
//   2. rememberLogin(storage, remember, login): ticked + a login that signed in -> kept under the key; unticked (or a sign-in with the box unticked, or Switch
//      account) -> deleted; ticked with no login that signed in -> nothing changes;
//   3. readRememberedLogin: the kept login, or null; an unreadable copy throws ONE fixed message (never its content: the caller logs the message);
//   4. a reload model: the kept login fills the form and counts as signed in through the SAME function (hasSignIn, what shaper-app.js signedIn() returns), so a
//      Generate with "Keep ShaperHub up to date" on replaces the target (autoSendDecision 'send'); nothing kept -> 'no-login' (the 884 hint);
//   5. the page: the checkbox is in the sign-in, unticked by default, its hint says the login is plain text in this app's storage; ONE code path (shaper-app.js,
//      the website and the Fusion panel alike); the login is serialised for storage in ONE line (shaperhub-login.js) and for a request in ONE (the upload body).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { OLD_LOGIN_KEY, forgetOldLogin, REMEMBER_LOGIN_KEY, rememberLogin, readRememberedLogin, hasSignIn } from '../apps/shaper/src/shaperhub-login.js';
import { autoSendDecision, keepSwitchView } from '../apps/shaper/src/shaperhub-target.js';
import { hintLabel, hintText } from '../apps/shaper/src/param-hints.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const LOGIN = Object.freeze({ email: 'user@example.test', password: 'not-a-real-password' }); // fake
const OTHER = Object.freeze({ email: 'other@example.test', password: 'another-fake-password' });
const memStorage = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

// ── 1. the key ──
eq(REMEMBER_LOGIN_KEY, 'shaper-hub-remembered-login', 'the key');
ok(REMEMBER_LOGIN_KEY !== OLD_LOGIN_KEY, 'a NEW key name, not the one forgetOldLogin deletes at start');
const named = [];
const walk = (dir) => { for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) { const p = dir + '/' + e.name; if (e.isDirectory()) walk(p); else if (/\.(js|html)$/.test(e.name) && read(p).includes(REMEMBER_LOGIN_KEY)) named.push(p); } };
for (const d of ['apps', 'packages', 'functions']) walk(d);
eq(named, ['apps/shaper/src/shaperhub-login.js'], 'the key is named in ONE file (shaperhub-login.js)');
{
  const s = memStorage();
  rememberLogin(s, true, LOGIN);
  s.setItem(OLD_LOGIN_KEY, '{"email":"old@example.test","password":"old-fake"}');
  forgetOldLogin(s);
  eq([...s.m.keys()], [REMEMBER_LOGIN_KEY], 'forgetOldLogin deletes the old copy only: the remembered login stays');
}

// ── 2. rememberLogin ──
{
  const s = memStorage();
  s.setItem('shaper-mode', 'review');
  rememberLogin(s, true, LOGIN);
  eq(JSON.parse(s.m.get(REMEMBER_LOGIN_KEY)), LOGIN, 'ticked + a sign-in that succeeded: kept under the key');
  eq(s.m.size, 2, 'one key added, nothing else');
  rememberLogin(s, true, OTHER);
  eq(JSON.parse(s.m.get(REMEMBER_LOGIN_KEY)), OTHER, 'a later sign-in with another login (ticked): that login is kept instead');
  rememberLogin(s, true, null);
  eq(JSON.parse(s.m.get(REMEMBER_LOGIN_KEY)), OTHER, 'ticked with no login that signed in: nothing changes');
  rememberLogin(s, false);
  eq([s.m.has(REMEMBER_LOGIN_KEY), s.m.get('shaper-mode')], [false, 'review'], 'unticked: the kept copy is deleted, the other keys stay');
  rememberLogin(s, true, LOGIN);
  rememberLogin(s, false, LOGIN);
  eq(s.m.has(REMEMBER_LOGIN_KEY), false, 'a sign-in with the box unticked: the kept copy is deleted');
  rememberLogin(s, true, LOGIN);
  rememberLogin(s, false); // Switch account (the sign-out) calls it so
  eq(s.m.has(REMEMBER_LOGIN_KEY), false, 'Switch account: deleted');
  assert.throws(() => rememberLogin({ setItem() { throw new Error('QuotaExceededError'); }, removeItem() {} }, true, LOGIN), /QuotaExceededError/, 'a storage error reaches the caller (the page logs it)'); checks++;
}

// ── 3. readRememberedLogin ──
{
  const s = memStorage();
  eq(readRememberedLogin(s), null, 'nothing kept: null');
  rememberLogin(s, true, LOGIN);
  eq(readRememberedLogin(s), LOGIN, 'the kept login');
  s.setItem(REMEMBER_LOGIN_KEY, 'not-json-but-a-secret');
  let msg = '';
  try { readRememberedLogin(s); } catch (err) { msg = err.message; }
  eq(msg, 'the remembered ShaperHub login is not readable', 'unreadable: ONE fixed message');
  ok(!msg.includes('secret'), 'the message never carries the stored content');
  s.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({ email: 'user@example.test' }));
  assert.throws(() => readRememberedLogin(s), /^Error: the remembered ShaperHub login is not readable$/, 'a copy without a password: the same message'); checks++;
}

// ── 4. a reload model: the kept login counts as signed in, through the same function ──
const T = { filename: 'shaper-export.svg', remotePath: '/Furniture/' };
{
  const s = memStorage();
  rememberLogin(s, true, LOGIN); // the first page: ticked, Send succeeded
  // the page after a reload: no session token; the start fills the form from storage (shaper-app.js)
  const kept = readRememberedLogin(s);
  const form = { email: kept ? kept.email : '', password: kept ? kept.password : '' };
  const signedIn = hasSignIn({ session: false, remembered: !!kept, ...form });
  eq(signedIn, true, 'reload: the kept login counts as signed in');
  eq(autoSendDecision({ on: true, target: T, signedIn }), 'send', 'reload + Keep ShaperHub up to date on: Generate replaces the target');
  eq(keepSwitchView({ on: true, signedIn, target: T }).disabled, false, 'reload: the switch can be changed');
  rememberLogin(s, false); // unticked
  const none = readRememberedLogin(s);
  const signedIn2 = hasSignIn({ session: false, remembered: !!none, email: '', password: '' });
  eq([none, signedIn2, autoSendDecision({ on: true, target: T, signedIn: signedIn2 })], [null, false, 'no-login'], 'unticked, reload: nothing kept, no sign-in');
  eq(keepSwitchView({ on: true, signedIn: signedIn2, target: T }).hint, 'Needs a sign-in for this session.', 'and the switch says it needs a sign-in (TASK 884)');
}
eq(hasSignIn({ session: true, remembered: false, email: 'a@b.c', password: 'x' }), true, 'a session token + the login in the form: signed in (as 884)');
eq(hasSignIn({ session: false, remembered: false, email: 'a@b.c', password: 'x' }), false, 'a login typed but never sent: not signed in (as 884)');
eq(hasSignIn({ session: false, remembered: true, email: ' ', password: 'x' }), false, 'no email in the form: not signed in');
eq(hasSignIn({ session: true, remembered: true, email: 'a@b.c', password: '' }), false, 'no password in the form: not signed in');

// ── 5. the page ──
const app = read('apps/shaper/src/shaper-app.js');
ok(/const signedIn = \(\) => hasSignIn\(\{/.test(app), 'shaper-app.js signedIn() is hasSignIn (the one notion of a sign-in; Generate, the switch and the dialog read it)');
eq((app.match(/hasSignIn\(/g) || []).length, 1, 'hasSignIn is called in ONE place');
eq((app.match(/readRememberedLogin\(localStorage\)/g) || []).length, 1, 'the kept login is read ONCE, at start');
eq((app.match(/rememberLogin\(localStorage, /g) || []).length, 1, 'ONE place writes or deletes it (keepRememberedLogin)');
ok(/^\s*try \{ rememberLogin\(localStorage, [^\n]*\} catch \(err\) \{ dbg\.warn\('shaper', '[^']*', err && err\.message\); \}/m.test(app), 'a storage error goes to the Log (its message only)');
const call = app.slice(app.indexOf('async function callShaperHub('), app.indexOf('const uploadErrorLines'));
ok(/if \(res\.ok && !data\.error\) keepRememberedLogin\(\);/.test(call), 'callShaperHub (the one request path): every successful answer keeps / deletes the copy as the box says');
ok(/syncSwitchBtn\.addEventListener\('click', \(\) => \{[^\n]*keepRememberedLogin\(\{ signOut: true \}\)/.test(app), 'Switch account (the sign-out) deletes it');
ok(/syncRemember\.addEventListener\('change', \(\) => \{ if \(!syncRemember\.checked\) keepRememberedLogin\(\); \}\);/.test(app), 'unticking deletes it at once (ticking keeps nothing until a sign-in succeeds)');
ok(!/fusion/i.test(app.slice(app.indexOf('function keepRememberedLogin'), app.indexOf('function keepRememberedLogin') + 600)), 'no host branch in it');
ok(!read('apps/shaper/src/main.js').includes('rememberLogin') && !read('apps/shaper/src/fusion-main.js').includes('rememberLogin'), 'not in main.js or fusion-main.js: one path for the website and the Fusion panel');
const login = read('apps/shaper/src/shaperhub-login.js');
eq((login.match(/JSON\.stringify\(/g) || []).length, 1, 'shaperhub-login.js serialises the login in ONE line (the storage write)');
eq((login.match(/\.setItem\(/g) || []).length, 1, 'one setItem');
eq((app.match(/JSON\.stringify\(\{[^}]*\b(email|password)\b/g) || []).length, 1, 'the page serialises the login for a request in ONE place (the upload body, as 758)');
eq(hintLabel('keepHubUpToDate'), 'Autosend', 'the switch of TASK 884 is labelled Autosend (owner turn 3648)');
eq(hintLabel('rememberLogin'), 'Remember login on this computer', 'the label');
eq(hintText('rememberLogin'), 'Saved as plain text in this app’s storage on this computer. Untick to delete it.', 'the honest hint');
const html = read('apps/shaper/index.html');
const win = new Window();
win.document.write(html);
const doc = win.document;
const box = doc.getElementById('sync-remember-login');
ok(box && box.type === 'checkbox' && !box.hasAttribute('checked'), 'the checkbox, unticked by default');
ok(doc.getElementById('sync-creds').contains(box), 'in the sign-in (with the email and password)');
ok(box.form === doc.getElementById('sync-modal-form') || doc.getElementById('sync-modal-form').contains(box), 'in the sign-in form');
eq(box.getAttribute('aria-describedby'), 'sync-remember-hint', 'its hint line describes it');
ok(!!doc.getElementById('sync-remember-hint'), 'the hint line');
await win.happyDOM.close();
for (const host of ['sketchstudio', 'penplotter', 'trace']) ok(!/sync-remember|Remember login/.test(read(`apps/${host}/index.html`)), `ABSENT in ${host}'s page`);

console.log(`shaperhub-remember-886-node: ${checks} checks ok`);
