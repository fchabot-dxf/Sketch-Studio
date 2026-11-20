// tests/feedback-830.test.js — TASK 830: "Rate & feedback", the rules and the network, in plain Node (the window and the card are tests/feedback-830-live.test.js;
// the Worker's endpoint, its stored row and the dashboard are tests/analytics-worker.test.js):
//   - validateFeedback (feedback-rules.js, the ONE validator the page and the Worker both run): stars 1-5 or none, text <= 2000, the optional email, the declared
//     app / version / host, and "stars or words" (an email alone is not a message);
//   - the auto-ask RULE (nextAskState): the 2nd successful export makes the card due; "Not now" puts the next ask 10 exports later, ONCE; a second "Not now",
//     "Never" and a sent message end it for good; the stored state is read back strictly;
//   - the declared export list is the analytics export features, and every export the apps track is on it;
//   - analytics.js postFeedback (the same code the pages run, with a stand-in page): the exact payload (no id, nothing else), sent only from a public page and
//     only by the person's Send (an analytics opt-out does not stop it), plain sentences for offline / refused / too many; analytics onFeature hears features;
//   - every app has its card slot in its export area, and every app's menu has the item (the shared sidebar adds it, with or without the project layer).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnalytics } from '../packages/ui/analytics.js';
import { FEATURES } from '../packages/ui/analytics-events.js';
import { APPS } from '../packages/ui/app-registry.js';
import { validateFeedback, nextAskState, freshAskState, askDue, parseAskState, EXPORT_FEATURES, EXPORTS_BEFORE_ASK, EXPORTS_AFTER_NOT_NOW, TEXT_MAX, STORAGE_PREFIX } from '../packages/ui/feedback-rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let checks = 0;
const ok = (c, msg) => { assert.ok(c, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

// ── validateFeedback ─────────────────────────────────────────────────────────────────────────────────
const base = { stars: 4, text: 'It works.', email: '', app: 'shaper', version: '2026-11-16T14:05Z', host: 'web' };
const bad = (patch, msg) => ok(validateFeedback({ ...base, ...patch }).error, msg);
eq(validateFeedback(base), base, 'a valid message comes back as is');
eq(validateFeedback({ ...base, stars: null }).stars, null, 'text only: stars null');
eq(validateFeedback({ ...base, text: '' }).text, '', 'stars only: empty text');
eq(validateFeedback({ ...base, text: undefined, email: undefined }), { ...base, text: '', email: '' }, 'missing text / email are empty');
eq(validateFeedback({ ...base, email: 'a.b+c@mail.example.co' }).email, 'a.b+c@mail.example.co', 'a plain address is kept');
for (const stars of [0, 6, 3.5, '4', NaN, -1]) bad({ stars }, `stars ${JSON.stringify(stars)} refused`);
bad({ text: 'x'.repeat(TEXT_MAX + 1) }, 'text over the cap refused');
eq(validateFeedback({ ...base, text: 'x'.repeat(TEXT_MAX) }).error, undefined, 'text of exactly the cap accepted');
for (const email of ['x', 'a@b', 'a b@c.de', 'a@b@c.de', '@c.de', 'a@.de', 'a@c..de', 'a@c.de.', 'a@' + 'x'.repeat(250) + '.com']) bad({ email }, `email ${JSON.stringify(email).slice(0, 24)} refused`);
bad({ stars: null, text: '', email: 'a@b.co' }, 'an email alone is not a message');
bad({ stars: null, text: '   \n ' }, 'blank text and no stars is not a message');
bad({ app: 'frame-calc' }, 'an undeclared app refused');
bad({ host: 'desktop' }, 'an undeclared host refused');
bad({ version: '' }, 'no version refused');
bad({ version: 'a b' }, 'a version that is not a build stamp refused');
ok(validateFeedback(null).error && validateFeedback([]).error && validateFeedback('x').error, 'not an object refused');
for (const a of APPS) for (const host of ['web', 'fusion']) eq(validateFeedback({ ...base, app: a.id, host }).app, a.id, `${a.id} on ${host} is declared`);
ok(validateFeedback({ ...base, email: 'nope' }).error.toLowerCase().includes('email'), 'the email refusal is a plain sentence that names the email (the window marks the field)');

// ── the auto-ask rule ────────────────────────────────────────────────────────────────────────────────
eq([EXPORTS_BEFORE_ASK, EXPORTS_AFTER_NOT_NOW], [2, 10], 'asked after the 2nd export; "Not now" waits 10 more');
{
  let s = freshAskState();
  eq(askDue(s), false, 'a new browser: not due');
  s = nextAskState(s, 'export'); eq(askDue(s), false, '1st export: not due');
  s = nextAskState(s, 'export'); eq(askDue(s), true, '2nd export: due');
  s = nextAskState(s, 'export'); eq(askDue(s), true, 'still due until answered (e.g. the export area was not on screen)');
  const exportsAtNotNow = s.exports;
  s = nextAskState(s, 'not-now');
  eq([askDue(s), s.nextAt], [false, exportsAtNotNow + 10], '"Not now": not due, the next ask is 10 exports later');
  for (let i = 1; i < 10; i++) { s = nextAskState(s, 'export'); eq(askDue(s), false, `${i} export(s) after "Not now": not due`); }
  s = nextAskState(s, 'export'); eq(askDue(s), true, 'the 10th export after "Not now": due again (the one more ask)');
  s = nextAskState(s, 'not-now'); eq([s.done, askDue(s)], [true, false], 'a second "Not now" ends it');
  for (let i = 0; i < 30; i++) s = nextAskState(s, 'export'); eq(askDue(s), false, 'never due again after that');
}
{
  let s = nextAskState(nextAskState(freshAskState(), 'export'), 'export');
  const never = nextAskState(s, 'never'); eq([never.done, askDue(nextAskState(never, 'export'))], [true, false], '"Never": never due again');
  const sent = nextAskState(s, 'sent'); eq([sent.done, askDue(nextAskState(sent, 'export'))], [true, false], 'a message sent (or rated): never due again');
  const before = JSON.stringify(s); nextAskState(s, 'not-now'); eq(JSON.stringify(s), before, 'the rule does not change the state it is given');
  assert.throws(() => nextAskState(s, 'later'), /unknown action/); checks++;
}
{
  const s = nextAskState(nextAskState(freshAskState(), 'export'), 'not-now');
  eq(parseAskState(JSON.stringify(s)), s, 'a stored state reads back the same');
  for (const t of ['', 'null', '[]', '{"exports":-1,"nextAt":2,"notNow":0,"done":false}', '{"exports":1,"nextAt":2,"notNow":2,"done":false}', '{"exports":1,"nextAt":2,"notNow":0,"done":"no"}', 'not json', '{"exports":1.5,"nextAt":2,"notNow":0,"done":false}']) eq(parseAskState(t), null, `${JSON.stringify(t)} is not a state this code wrote`);
  ok(STORAGE_PREFIX.startsWith('sketch-feedback') && !/analytics/.test(STORAGE_PREFIX), 'the ask state has its own key (not an analytics key)');
}

// ── the declared export list ─────────────────────────────────────────────────────────────────────────
eq([...EXPORT_FEATURES].sort(), ['export:copy-svg', 'export:dxf', 'export:gcode', 'export:shaper', 'export:shaperhub', 'export:svg'], 'EXPORT_FEATURES: the analytics export features');
ok(EXPORT_FEATURES.every((f) => FEATURES.includes(f)) && FEATURES.filter((f) => f.startsWith('export:')).length === EXPORT_FEATURES.length, 'every export feature of analytics-events.js is on the list, and only those');

// ── analytics.js: the message, and onFeature ─────────────────────────────────────────────────────────
const STUB = 'https://sketch-analytics.example.workers.dev/e';
function page(href, { dnt, reply = { ok: true, status: 204 }, reject = null } = {}) {
  const u = new URL(href); const calls = []; const storage = new Map();
  const env = {
    location: { protocol: u.protocol, hostname: u.hostname, search: u.search },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    navigator: { doNotTrack: dnt }, crypto: globalThis.crypto,
    fetch: async (url, init) => { calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null }); if (reject) throw new Error(reject); return reply; },
  };
  return { env, calls, storage };
}
const start = (href, opts, app = 'trace') => { const p = page(href, opts); const a = createAnalytics({ endpoint: STUB, build: '2026-11-16T14:05Z', env: p.env }); a.start({ app, host: 'web' }); return { ...p, a }; };
const MSG = { stars: 5, text: 'Great tool', email: 'me@example.com' };
{
  const p = start('https://sketch-trace.pages.dev/');
  const before = p.calls.length;
  eq(await p.a.postFeedback(MSG), { ok: true }, 'a public page sends the message');
  const c = p.calls[before];
  eq(c.url, 'https://sketch-analytics.example.workers.dev/feedback', 'to /feedback, next to /e');
  eq(c.body, { stars: 5, text: 'Great tool', email: 'me@example.com', app: 'trace', version: '2026-11-16T14:05Z', host: 'web' }, 'EXACTLY { stars, text, email, app, version, host }: no id, nothing else');
  eq([c.init.method, c.init.headers['content-type']], ['POST', 'text/plain'], 'a CORS simple request (no preflight)');
  ok(!validateFeedback(c.body).error, 'and the shared validator (the Worker\'s) accepts it as is');
  ok(![...p.storage.keys()].some((k) => k.includes('feedback')), 'sending a message stores nothing in the page (the ask state is feedback.js\'s)');
}
{
  const p = start('http://127.0.0.1:8080/');
  eq(p.calls.length, 0, '(a local page: no visit either)');
  const r = await p.a.postFeedback(MSG);
  eq([r.ok, p.calls.length], [false, 0], 'a LOCAL page sends nothing (a developer\'s machine never writes to the real Worker)');
  ok(/published app/.test(r.message), 'and says so in a plain line');
}
{
  const p = start('https://sketch-trace.pages.dev/?analytics=off');
  const before = p.calls.length;
  eq([p.a.willSend(), (await p.a.postFeedback(MSG)).ok, p.calls.length - before], [false, true, 1], 'an analytics opt-out does not stop a message the person chose to send');
  const q = start('https://sketch-trace.pages.dev/', { dnt: '1' });
  eq([q.a.willSend(), (await q.a.postFeedback(MSG)).ok], [false, true], '(Do Not Track too)');
}
{
  const p = start('https://sketch-trace.pages.dev/'); const n = p.calls.length;
  for (const m of [{ stars: 9 }, { stars: null, text: '' }, { text: 'x'.repeat(2001) }, { stars: 3, email: 'nope' }]) { const r = await p.a.postFeedback(m); ok(!r.ok && r.message, `an invalid message (${JSON.stringify(m).slice(0, 30)}) is refused with a sentence`); }
  eq(p.calls.length, n, 'and none of them was sent');
  const a2 = createAnalytics({ endpoint: STUB, build: 'x', env: page('https://sketch-trace.pages.dev/').env });
  eq((await a2.postFeedback(MSG)).ok, false, 'before the app started (no app to name) nothing is sent');
}
{
  const off = start('https://sketch-trace.pages.dev/', { reject: 'Failed to fetch' });
  const r = await off.a.postFeedback(MSG); eq(r.ok, false, 'offline: not sent'); ok(/offline/i.test(r.message) && /still here/.test(r.message), 'offline: a plain line that says the text is kept');
  const many = start('https://sketch-trace.pages.dev/', { reply: { ok: false, status: 429 } }); ok(/Too many/.test((await many.a.postFeedback(MSG)).message), '429: a plain line');
  const err = start('https://sketch-trace.pages.dev/', { reply: { ok: false, status: 500 } }); ok(/not accepted/.test((await err.a.postFeedback(MSG)).message) && /still here/.test((await err.a.postFeedback(MSG)).message), '500: a plain line, text kept');
}
{
  const p = start('http://localhost:8080/'); const heard = []; const off = p.a.onFeature((n) => heard.push(n));
  p.a.track('export:svg'); p.a.track('stage:design'); p.a.track('not-a-feature'); off(); p.a.track('export:dxf');
  eq(heard, ['export:svg', 'stage:design'], 'onFeature hears each DECLARED feature tracked (even where nothing is sent: a local page), not an undeclared name, and stops when unsubscribed');
  const q = createAnalytics({ endpoint: STUB, env: page('https://sketch-trace.pages.dev/').env }); const h2 = []; q.onFeature((n) => h2.push(n)); q.track('export:svg');
  eq(h2, [], 'and nothing before the app started');
}

// ── the pages: a card slot in every export area, the menu item in every app ───────────────────────────
const slot = /data-feedback-slot/g;
eq([(read('apps/shaper/index.html').match(slot) || []).length, (read('apps/trace/index.html').match(slot) || []).length, (read('apps/sketchstudio/index.html').match(slot) || []).length, (read('apps/penplotter/src/export-stage.js').match(slot) || []).length], [1, 1, 1, 1], 'each app has ONE card slot, in its export area');
ok(/id="simexport-status"[^]*data-feedback-slot[^]*<\/aside>/.test(read('apps/shaper/index.html')), 'Shaper: after the Export card\'s status line (the last thing in the panel: nothing above it moves)');
ok(/id="export-scale-note"[^]*data-feedback-slot/.test(read('apps/trace/index.html')) && /id="export-panel"[^]*data-feedback-slot[^]*id="export-filename"/.test(read('apps/sketchstudio/index.html')) && /id="exportBtn"[^]*data-feedback-slot/.test(read('apps/penplotter/src/export-stage.js')), 'Trace and Pen Plotter: after the export controls; Sketch: at the top of its Export view (the card appears while that view is closed)');
const sb = read('packages/ui/sidebar-projects.js');
ok(/feedbackMenuItem\(/.test(sb) && /const siteActions = \[[^\]]*\{ divider: true \},[^\]]*feedbackItem,\s*\];/.test(sb) && /\.\.\.siteActions,\s*\] : \[\.\.\.hostActions, \.\.\.siteActions\]/.test(sb), 'the shared menu adds the item in both shapes (with the project layer, and without it: Fusion mode; TASK 828b: it is the LAST of the site items, after About)');
ok(/startFeedback\(\{ appId \}\)/.test(read('packages/ui/app-chrome.js')), 'app-chrome (every app) starts the ask');
ok(!/feedback/i.test(read('packages/ui/app-sidebar.js')) && !/feedback/i.test(read('packages/ui/app-footer.js')), 'app-sidebar.js / app-footer.js are not touched (the item goes in through the item list)');

// ── privacy.html (both languages) says what feedback stores ───────────────────────────────────────────
{
  const html = read('privacy.html');
  for (const s of ['<h2 id="feedback">Feedback you send</h2>', 'your star rating, the text you wrote, the email address only if you typed one', 'no IP address (the server does not store or log it)', 'write to the contact address below',
    '<h2 id="commentaires">Les commentaires que vous envoyez</h2>', 'seulement si vous avez saisi une adresse courriel', 'le serveur ne la conserve ni ne la consigne', "écrivez à l'adresse de contact ci-dessous"]) ok(html.includes(s), `privacy.html: ${s}`);
  ok(html.includes('mailto:dansemur@gmail.com'), 'the contact the page already shows is the one to ask for deletion');
}

console.log(`feedback-830: ${checks} checks pass`);
