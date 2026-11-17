// tests/shaperhub-login-758.test.js — TASK 758: the Shaper "Sync to ShaperHub" sign-in keeps NO login of its own (the browser's password manager does).
//  - source: in the Shaper app (apps/shaper/src, index.html), the function's client and the function itself (packages/core/shaper-cloud.js,
//    functions/api/shaper-upload.js, server.js), no line that writes to storage, logs, sends analytics or writes the page names the email or the
//    password; the login leaves the page ONCE: the body of the POST to /api/shaper-upload;
//  - the old "Remember login" checkbox and key are gone: the key is named in ONE file (shaperhub-login.js), main.js deletes it ONCE at start;
//  - forgetOldLogin removes the old key without reading it and keeps every other key; a storage error reaches the caller;
//  - the sign-in markup is a password form: email input name=username autocomplete=username type=email, password input name=password
//    autocomplete=current-password, each with a <label for>, a submit button, no autocomplete="off".
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { OLD_LOGIN_KEY, forgetOldLogin } from '../apps/shaper/src/shaperhub-login.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

// ── 1. no sink names the login ──
const FILES = [...fs.readdirSync(path.join(ROOT, 'apps/shaper/src')).filter((f) => f.endsWith('.js')).map((f) => 'apps/shaper/src/' + f),
  'apps/shaper/index.html', 'packages/core/shaper-cloud.js', 'functions/api/shaper-upload.js', 'server.js'];
// a line that stores, logs, sends analytics or writes the page
const SINK = /\b(localStorage|sessionStorage|indexedDB|cookie|setItem|caches|console\.\w+|dbg\.\w+|track|innerHTML|outerHTML|textContent|insertAdjacentHTML|setAttribute|document\.write)\b|\.put\(/;
// the login as code (string literals removed first: a message such as 'Please enter both email and password.' names no value)
const LOGIN = /\b(email|password|syncEmail|syncPassword|username|creds?|credentials?)\b/i;
const noStrings = (line) => line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
const leaks = [];
for (const f of FILES) read(f).split('\n').forEach((line, i) => { const code = noStrings(line); if (SINK.test(code) && LOGIN.test(code)) leaks.push(`${f}:${i + 1}: ${line.trim()}`); });
eq(leaks, [], 'no storage / log / analytics / page-writing line names the email or the password');

// the login leaves the page once: the upload POST's body
const main = read('apps/shaper/src/main.js');
const sends = [...main.matchAll(/JSON\.stringify\(\{[^}]*\b(email|password)\b/g)];
eq(sends.length, 1, 'main.js serialises the login exactly once');
const fetchAt = main.indexOf("fetch('/api/shaper-upload'");
ok(fetchAt >= 0 && sends[0].index > fetchAt && sends[0].index - fetchAt < 200, 'that one place is the body of the POST to /api/shaper-upload');
ok(!/\btrack\([^)]*,/.test(main), 'track() is called with the feature name only (no second argument carries data)');

// ── 2. the old storage is gone; its key is named in one file and deleted once at start ──
const named = [];
const walk = (dir) => { for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) { const p = dir + '/' + e.name; if (e.isDirectory()) walk(p); else if (/\.(js|html)$/.test(e.name) && read(p).includes(OLD_LOGIN_KEY)) named.push(p); } };
for (const d of ['apps', 'packages', 'functions']) walk(d);
eq(named, ['apps/shaper/src/shaperhub-login.js'], 'the old key is named only in shaperhub-login.js');
eq(OLD_LOGIN_KEY, 'shaper_hub_creds', 'the key earlier versions stored the login under');
ok(!/CRED_STORAGE_KEY|sync-remember|syncRemember/.test(main), 'main.js has no credential key or Remember checkbox');
eq([...main.matchAll(/forgetOldLogin\(/g)].length, 1, 'main.js deletes the old login in ONE place');
ok(/^try \{ forgetOldLogin\(localStorage\); \} catch \(err\) \{ dbg\.warn\('shaper', '[^']*', err && err\.message\); \}$/m.test(main), 'at top level (app start), a storage error goes to the Log');

// ── 3. forgetOldLogin: removes the key without reading it, keeps the rest; a storage error surfaces ──
const fakeStorage = (entries) => {
  const m = new Map(Object.entries(entries)), removed = [];
  return { m, removed, getItem() { throw new Error('read'); }, key() { throw new Error('read'); }, setItem() { throw new Error('write'); }, removeItem(k) { removed.push(k); m.delete(k); } };
};
const s1 = fakeStorage({ [OLD_LOGIN_KEY]: '{"email":"old-user@example.test","password":"old-not-a-real-password"}', 'shaper-mode': 'review' });
forgetOldLogin(s1);
eq([...s1.m.keys()], ['shaper-mode'], 'the old login is removed, the other key kept');
eq(s1.removed, [OLD_LOGIN_KEY], 'one removeItem of the old key, no read');
const s2 = fakeStorage({});
forgetOldLogin(s2);
eq(s2.removed, [OLD_LOGIN_KEY], 'nothing stored: one harmless removeItem');
assert.throws(() => forgetOldLogin({ removeItem() { throw new Error('SecurityError'); } }), /SecurityError/, 'a storage error reaches the caller (main.js logs it)'); checks++;

// ── 4. the sign-in markup ──
const html = read('apps/shaper/index.html');
ok(!/Remember login|sync-remember|sync-checkbox-label/.test(html), 'no Remember-login checkbox or its CSS');
const win = new Window();
win.document.write(html);
const doc = win.document;
const form = doc.getElementById('sync-modal-form');
const em = doc.getElementById('sync-email'), pw = doc.getElementById('sync-password');
ok(form && form.localName === 'form' && form.contains(em) && form.contains(pw), 'email and password are in one <form>');
eq(['type', 'name', 'autocomplete'].map((a) => em.getAttribute(a)), ['email', 'username', 'username'], 'the email field: type=email name=username autocomplete=username');
eq(['type', 'name', 'autocomplete'].map((a) => pw.getAttribute(a)), ['password', 'password', 'current-password'], 'the password field: type=password name=password autocomplete=current-password');
for (const i of [em, pw, doc.getElementById('sync-filename')]) ok(doc.querySelectorAll(`label[for="${i.id}"]`).length === 1, `#${i.id} has one <label for>`);
eq([...form.querySelectorAll('button[type="submit"]')].map((b) => b.id), ['sync-btn-submit'], 'one submit button (Send) in the form');
ok(!form.querySelector('[autocomplete="off"]') && form.getAttribute('autocomplete') !== 'off', 'no autocomplete="off"');
ok(!/onpaste|oncopy/i.test(form.outerHTML), 'no inline paste blocking');
await win.happyDOM.close();

console.log(`shaperhub-login-758.test.js: ${checks} checks pass`);
