// tests/shaperhub-login-758-live.test.js — TASK 758: the Shaper Export step's "Sync to ShaperHub" sign-in keeps NO login of its own; the browser's
// password manager does. In the real Shaper page (a fresh temporary profile), with EVERY request that is not to the test's own local server blocked
// (Fetch domain: failRequest, counted) and /api/shaper-upload answered by a stub in this test (it never reaches a network):
//  - a profile holding the old app-stored login (key shaper_hub_creds, fake values) no longer holds it after ONE load, and the fields are empty;
//  - the sign-in is a password-manager form: one <form>, the email input type=email name=username autocomplete=username, the password input
//    type=password name=password autocomplete=current-password, each with a <label for>, a type=submit button in the form, no autocomplete="off",
//    no paste listener on the two fields;
//  - desktop 1280 x 800 (mouse, keyboard): a fake login typed, ENTER in the password field submits: the stub receives it ONCE, the success state shows;
//  - phone 390 x 844 (touch): the same, submitted with a tap on Send; the email field asks for the email keyboard (type=email); the fields and the
//    dialog's buttons are 44 px tall, the dialog fits the screen;
//  - Fusion mode (?host=fusion, window.adsk stubbed): the form still works by typing;
//  - after each Sync: no localStorage / sessionStorage key or value, cookie, IndexedDB record, page markup, console line or other request holds the
//    fake email or password; after a reload the fields are empty and opening the sign-in fills nothing in.
// Screenshots of the sign-in (empty, and holding only the fake login) to .evidence/758/ (EVIDENCE_DIR overrides).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/758');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const FAKE = { email: 'user@example.test', password: 'not-a-real-password' };
const OLD = { email: 'old-user@example.test', password: 'old-not-a-real-password' }; // what an earlier version would have stored (fake)
const OLD_KEY = 'shaper_hub_creds';
const SECRETS = [FAKE.email, FAKE.password, OLD.email, OLD.password];
const fixture = (n) => fs.readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8');

const cdp = await launchBrowser({ tag: '758-login', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, ws, send, once, evalJs, waitFor, navigate, waitForApp } = cdp;
const LOCAL = `http://127.0.0.1:${port}/`;

// ── the network: only the local server; the upload function is this stub ──
const uploads = [];   // { method, body } the stub received
const blocked = [];   // every non-local request, failed before it left the browser
const sent = [];      // every request's url + body (to scan for the login)
const consoleLines = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || '')).join(' '));
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  const body = request.postData !== undefined ? request.postData : (request.postDataEntries || []).map((x) => Buffer.from(x.bytes || '', 'base64').toString('utf8')).join('');
  if (!request.url.startsWith(LOCAL)) {
    blocked.push(request.url);
    sent.push({ url: request.url, body });
    send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    return;
  }
  if (new URL(request.url).pathname === '/api/shaper-upload') {
    const json = JSON.parse(body);
    uploads.push({ method: request.method, body: json });
    const answer = JSON.stringify({ success: true, filename: json.filename, blobId: 'stub-blob' });
    send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(answer).toString('base64') });
    return;
  }
  sent.push({ url: request.url, body });
  send('Fetch.continueRequest', { requestId });
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

let phone = false;
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const press = async (x, y) => {
  if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
  else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
  await sleep(250);
};
// a real click / tap on the element's centre, after checking nothing covers it there
const clickEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await press(p.x, p.y);
};
const clickWorld = async (x, y) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await press(p.x, p.y);
};
const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
const openStage = async (id) => {
  for (let i = 0; i < 5; i++) {
    if (await activeStage() === id) return;
    if (phone) {
      if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-handle');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
      await clickEl(`.sk-sidebar-stage[data-tab="${id}"]`);
    } else await clickEl(`.sk-header-tab[data-tab="${id}"]`);
    await sleep(400);
  }
  assert.fail('could not open the ' + id + ' stage');
};
const shot = async (name, sel) => {
  const clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); const m = 8;
    const x = Math.max(0, r.left - m), y = Math.max(0, r.top - m); return { x, y, width: Math.min(innerWidth, r.right + m) - x, height: Math.min(innerHeight, r.bottom + m) - y, scale: ${phone ? 1 : 1.5} }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
const planSize = () => evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.cutPlanEntries().length)`);
const pickPocket = async () => {
  await clickEl('#prepare-panel .cut-type-trigger');
  await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the type menu');
  await clickEl('.cut-type-opt[data-id="pocket"]');
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => m.cutPlanEntries().length > 0)`, 'a planned cut');
};
// the standalone app: a 120 x 70 rectangle, planned as a Pocket in Prepare
const planRectangle = async (label) => {
  await openStage('design');
  await waitFor('!!(window.__designController && window.__designController.state)', label + ': the design controller');
  await evalJs(`(() => { const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k); st.shapes.length = 0; st.constraints.length = 0;
    [[0, 0], [120, 0], [120, 70], [0, 70]].forEach(([x, y], i) => st.joints.set('Rj' + i, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'Rs' + i, type: 'line', joints: ['Rj' + i, 'Rj' + ((i + 1) % 4)] });
    st.saveState('draw'); })()`);
  await openStage('prepare');
  if (phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head'); // the folded bar keeps the card free
  await clickWorld(60, 10);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, label + ': the cut card');
  await pickPocket();
};
const fields = () => evalJs(`({ email: document.getElementById('sync-email').value, password: document.getElementById('sync-password').value })`);
const openSignIn = async (label) => {
  await openStage('review');
  await clickEl('#btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, label + ': the sign-in dialog opens');
  await sleep(200);
};
// the form a password manager reads
const checkFormSemantics = async (label) => {
  const f = await evalJs(`(() => { const em = document.getElementById('sync-email'), pw = document.getElementById('sync-password'), form = em.form;
    const lab = (i) => i.labels.length === 1 && i.labels[0].htmlFor === i.id ? i.labels[0].textContent.trim() : null;
    const submit = form ? [...form.elements].filter((b) => b.localName === 'button' && b.type === 'submit') : [];
    return { form: form ? form.localName : null, sameForm: !!form && pw.form === form,
      email: { type: em.type, name: em.name, ac: em.getAttribute('autocomplete'), inputmode: em.getAttribute('inputmode'), label: lab(em) },
      password: { type: pw.type, name: pw.name, ac: pw.getAttribute('autocomplete'), label: lab(pw) },
      submit: submit.map((b) => b.id), acOff: !!document.querySelector('#shaper-sync-modal [autocomplete="off"]'),
      remember: !!document.getElementById('sync-remember') || /Remember login/i.test(document.getElementById('shaper-sync-modal').textContent) }; })()`);
  console.log(label + ': form ' + JSON.stringify(f));
  assert.strictEqual(f.form, 'form', label + ': the fields are in a <form>');
  assert.ok(f.sameForm, label + ': email and password are in the SAME form');
  assert.deepStrictEqual(f.email, { type: 'email', name: 'username', ac: 'username', inputmode: null, label: 'Shaper Account Email' }, label + ': the email field');
  assert.deepStrictEqual(f.password, { type: 'password', name: 'password', ac: 'current-password', label: 'Password' }, label + ': the password field');
  assert.deepStrictEqual(f.submit, ['sync-btn-submit'], label + ': one submit button in the form (Send)');
  assert.strictEqual(f.acOff, false, label + ': no autocomplete="off" in the sign-in');
  assert.strictEqual(f.remember, false, label + ': no "Remember login" checkbox');
  // paste is not blocked: no paste / copy / cut listener on either field or the form
  const doc = await send('DOM.getDocument', { depth: 0 });
  for (const sel of ['#sync-email', '#sync-password', '#sync-modal-form']) {
    const { nodeId } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
    const { object } = await send('DOM.resolveNode', { nodeId });
    const { listeners } = await send('DOMDebugger.getEventListeners', { objectId: object.objectId });
    const bad = listeners.filter((l) => ['paste', 'copy', 'cut'].includes(l.type));
    assert.deepStrictEqual(bad, [], label + `: no paste/copy/cut listener on ${sel}`);
  }
};
const typeInto = async (sel, text) => { await clickEl(sel); await send('Input.insertText', { text }); await sleep(100); };
// every place the page could keep the login: storage keys + values, cookies, every IndexedDB record, the markup, the console, the other requests
const scanForLogin = async (label) => {
  const found = await evalJs(`(async () => { const secrets = ${JSON.stringify(SECRETS)}; const hits = [];
    const has = (where, s) => { for (const x of secrets) if (String(s).includes(x)) hits.push(where); };
    for (const [n, st] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) for (let i = 0; i < st.length; i++) { const k = st.key(i); has(n + ' key', k); has(n + ' value of ' + k, st.getItem(k)); }
    has('cookie', document.cookie);
    has('markup', document.documentElement.outerHTML);
    for (const d of await indexedDB.databases()) {
      const db = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      for (const s of db.objectStoreNames) {
        const all = await new Promise((ok, no) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
        has('IndexedDB ' + d.name + '/' + s, JSON.stringify(all));
      }
      db.close();
    }
    return { hits, keys: localStorage.length + sessionStorage.length }; })()`);
  const elsewhere = sent.filter((r) => SECRETS.some((x) => (r.url + r.body).includes(x))).map((r) => r.url);
  const logged = consoleLines.filter((l) => SECRETS.some((x) => l.includes(x)));
  console.log(label + `: login scan: page ${JSON.stringify(found)}, other requests carrying it ${elsewhere.length}, console lines carrying it ${logged.length}`);
  assert.deepStrictEqual(found.hits, [], label + ': the login is in no storage, cookie, IndexedDB record or markup');
  assert.deepStrictEqual(elsewhere, [], label + ': no request but the upload carries the login');
  assert.deepStrictEqual(logged, [], label + ': no console line carries the login');
};
// the earlier versions' stored login (fake) in the profile, then ONE load of the app: it is gone and the fields are empty
const loadWithOldLogin = async (url, label) => {
  await resetBufferLive(cdp);
  await evalJs(`(() => { localStorage.setItem('${OLD_KEY}', JSON.stringify(${JSON.stringify(OLD)})); localStorage.removeItem('shaper-mode'); })()`);
  assert.strictEqual(await evalJs(`localStorage.getItem('${OLD_KEY}') !== null`), true, label + ': the old login is in the profile before the load');
  await navigate(url, 10000);
  await waitForApp('design-canvas');
  const after = await evalJs(`localStorage.getItem('${OLD_KEY}') === null`);
  const f = await fields();
  console.log(label + `: after one load: old key gone ${after}, fields ${JSON.stringify({ email: f.email.length, password: f.password.length })}`);
  assert.strictEqual(after, true, label + ': the old stored login is removed on the first load');
  assert.deepStrictEqual(f, { email: '', password: '' }, label + ': the fields are empty');
};
// sign in with the fake login; `how` = 'enter' (ENTER in the password field) or 'tap' (the Send button)
const syncOnce = async (label, how) => {
  const n0 = uploads.length;
  await typeInto('#sync-email', FAKE.email);
  await typeInto('#sync-password', FAKE.password);
  assert.deepStrictEqual(await fields(), FAKE, label + ': typed');
  if (how === 'enter') {
    assert.strictEqual(await evalJs(`document.activeElement.id`), 'sync-password', label + ': the focus is in the password field');
    await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r');
  } else await clickEl('#sync-btn-submit');
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-success')`, label + ': the success state');
  const ok = await evalJs(`({ modal: document.getElementById('sync-modal-status').textContent, panel: document.getElementById('simexport-status').textContent })`);
  console.log(label + ': success ' + JSON.stringify(ok));
  assert.match(ok.modal, /Uploaded "shaper-export\.svg" to ShaperHub/, label + ': the dialog says it uploaded');
  assert.match(ok.panel, /Synced shaper-export\.svg directly to ShaperHub/, label + ': the Export panel says it synced');
  await sleep(300);
  assert.strictEqual(uploads.length, n0 + 1, label + ': the stub received the Sync ONCE');
  const u = uploads[uploads.length - 1];
  assert.strictEqual(u.method, 'POST', label + ': a POST');
  assert.deepStrictEqual([u.body.email, u.body.password, u.body.filename, /^<\?xml|<svg/.test(u.body.svg)], [FAKE.email, FAKE.password, 'shaper-export.svg', true], label + ': the stub got the fake login, the name and the SVG');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, label + ': the dialog closes after the success');
};
// the browser's own Reload (Page.reload: the same history entry, where a browser restores form state it kept), then the sign-in opened again
const reloadEmpty = async (label, plan) => {
  const loaded = once('Page.loadEventFired');
  await send('Page.reload', {});
  await Promise.race([loaded, sleep(10000)]);
  await waitForApp('design-canvas');
  assert.deepStrictEqual(await fields(), { email: '', password: '' }, label + ': after a reload the fields are empty');
  if (!await planSize()) await plan(label + ' after reload');
  await openSignIn(label + ' after reload');
  assert.deepStrictEqual(await fields(), { email: '', password: '' }, label + ': opening the sign-in after a reload fills nothing in');
  await clickEl('#sync-btn-cancel');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, label + ': Cancel closes');
  await scanForLogin(label + ' after reload');
};

try {
  const url = `http://127.0.0.1:${port}/apps/shaper/index.html`;
  await send('DOM.enable');

  // ── desktop 1280 x 800, mouse + keyboard ──
  await loadWithOldLogin(url, 'desktop');
  await planRectangle('desktop');
  await openSignIn('desktop');
  await checkFormSemantics('desktop');
  await shot('desktop-signin-empty.png', '#shaper-sync-modal');
  await typeInto('#sync-email', FAKE.email);
  await typeInto('#sync-password', FAKE.password);
  await shot('desktop-signin-fake-login.png', '#shaper-sync-modal');
  await evalJs(`(() => { const e = document.getElementById('sync-email'), p = document.getElementById('sync-password'); e.value = ''; p.value = ''; })()`); // syncOnce types it again
  await syncOnce('desktop', 'enter');
  await scanForLogin('desktop');
  await reloadEmpty('desktop', planRectangle);

  // ── phone 390 x 844, touch ──
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  phone = true;
  await loadWithOldLogin(url, 'phone');
  await planRectangle('phone');
  await openSignIn('phone');
  await checkFormSemantics('phone');
  const sizes = await evalJs(`(() => { const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width) }; };
    return { dialog: box('#shaper-sync-modal'), email: box('#sync-email'), password: box('#sync-password'), filename: box('#sync-filename'), send: box('#sync-btn-submit'), cancel: box('#sync-btn-cancel'), close: box('#sync-modal-close'),
      scroll: { doc: document.documentElement.scrollWidth, vw: innerWidth } }; })()`);
  console.log('phone: sizes ' + JSON.stringify(sizes));
  assert.ok(sizes.dialog.left >= 0 && sizes.dialog.right <= 390, 'phone: the dialog is inside the screen');
  for (const k of ['email', 'password', 'filename', 'send', 'cancel', 'close']) assert.ok(sizes[k].h >= 44 && sizes[k].w >= 44, `phone: ${k} is a 44 px target: ` + JSON.stringify(sizes[k]));
  assert.ok(sizes.scroll.doc <= sizes.scroll.vw, 'phone: no sideways scroll');
  await shot('phone-signin-empty.png', '#shaper-sync-modal');
  await typeInto('#sync-email', FAKE.email);
  await typeInto('#sync-password', FAKE.password);
  await shot('phone-signin-fake-login.png', '#shaper-sync-modal');
  await evalJs(`(() => { document.getElementById('sync-email').value = ''; document.getElementById('sync-password').value = ''; })()`);
  await syncOnce('phone', 'tap');
  await scanForLogin('phone');
  await reloadEmpty('phone', planRectangle);

  // ── Fusion mode (the add-in palette), desktop: the form works by typing ──
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  phone = false;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  const furl = `${url}?host=fusion`;
  const planFusion = async (label) => {
    await openStage('prepare');
    await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('sa7-slope/06-countersink'))})`);
    await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, label + ': the Fusion selection imported');
    await clickWorld(60, -40);
    await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, label + ': the cut card');
    await pickPocket();
  };
  await loadWithOldLogin(furl, 'fusion');
  await waitFor(`!!window.fusionJavaScriptHandler && !document.getElementById('view-prepare').hidden`, 'fusion: the Fusion Prepare stage');
  await planFusion('fusion');
  await openSignIn('fusion');
  await checkFormSemantics('fusion');
  await syncOnce('fusion', 'tap');
  await scanForLogin('fusion');
  await reloadEmpty('fusion', planFusion);

  assert.strictEqual(uploads.length, 3, 'the stub received exactly the three Syncs');
  console.log(`network: ${uploads.length} uploads answered by the stub, ${blocked.length} non-local requests blocked` + (blocked.length ? ': ' + [...new Set(blocked.map((u) => new URL(u).origin))].join(', ') : ''));
  console.log('shaperhub-login-758-live.test.js: ok');
} finally {
  await cdp.close();
}
