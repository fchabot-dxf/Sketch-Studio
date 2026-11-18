// tests/settings-drive-773-live.test.js — TASK 773, two real browsers = two devices on ONE fake Google Drive (tests/harness/fake-drive.js through
// tests/helpers/fake-drive-session.js: the fake sign-in, no Google request, every non-local request blocked):
//   DESKTOP (1280 x 800): Shaper, the owner's design "bromont" on Drive, in Prepare with the pocket picked, zoomed on and its card open (the 766 page,
//            tests/helpers/prepare-drive-live.js: its view / selection / card / mount / plan reader is reused)
//   PHONE (390 x 844, touch): SketchStudio
// The user's settings follow him: the desktop's inch units reach the phone at its start; the phone changes the units in its Settings panel and the desktop
// shows them after its next sync WITHOUT any reload or remount (the Prepare view, the selection, the open card and the cut plan unchanged); a shortcut
// changed on the phone and the units changed on the desktop at the same time both end up on both; the status line in each state ("Settings saved to Google
// Drive" / "Could not reach Google Drive: will retry" / "Saved on this device only (sign in to sync)") and "Sync now"; signed out = no Drive request,
// signing in again merges. Screenshots: .evidence/773.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { createFakeDrive } from './harness/fake-drive.js';
import { parseSettingsFile } from '../packages/ui/cloud/settings-sync.js';

process.env.EVIDENCE_DIR = process.env.EVIDENCE_DIR || '.evidence/773';
const { openBromont, sameView } = await import('./helpers/prepare-drive-live.js');
const EVID = path.resolve(process.env.EVIDENCE_DIR);
const t0 = Date.now();
const drive = createFakeDrive();
const settingsFile = () => { const f = [...drive.files.values()].filter((x) => x.name === 'settings.json' && !x.trashed); assert.strictEqual(f.length, 1, 'ONE settings file on Drive'); return parseSettingsFile(f[0].content).settings; };
const S = `import('/packages/core/settings-manager.js').then((m) => m.default)`;
const SYNC = `import('/packages/ui/cloud/settings-sync.js')`;

const A = await openBromont({ tag: '773a', drive });
if (!A) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
let B = null;
try {
  // ---- the desktop chooses a setting (Angle precision 2): it goes to Drive. Shaper's inch is its own default, not a choice: it never travels ----
  await A.evalJs(`window.__notReloaded = 'A'`);
  await A.evalJs(`${S}.then((s) => s.set('ANGLE_PRECISION', 2, { persist: 'local' }))`);
  await A.evalJs(`${SYNC}.then((m) => m.syncSettingsNow())`);
  assert.strictEqual(settingsFile().ANGLE_PRECISION.value, 2, 'the desktop\'s choice is in Sketch Studio/Settings/settings.json');
  assert.ok(!settingsFile().DOC_UNIT, 'Shaper\'s own inch default (never chosen) is not on Drive');
  const start = await A.look();
  assert.ok(start.card && start.sel.length === 1, 'the desktop: Prepare, the pocket picked, its card open: ' + JSON.stringify(start.sel));

  // ---- the phone: SketchStudio, its first start reads the settings from Drive ----
  B = await launchBrowser({ tag: '773b', width: 390, height: 844 });
  const net = await blockRemote(B);
  const session = await installFakeDriveSession(B, { signedIn: true, drive });
  await B.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await B.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(B);
  await B.navigate(`http://127.0.0.1:${B.port}/apps/sketchstudio/index.html`, 10000);
  await B.waitFor(`!!document.querySelector('#svgCanvas') && !!document.getElementById('btn-settings')`, 'SketchStudio on the phone');
  await B.evalJs(`window.__notReloaded = 'B'`);
  await B.waitFor(`${S}.then((s) => s.get('ANGLE_PRECISION') === 2)`, 'the phone took the desktop\'s Angle precision from Drive at its start', 10000);
  assert.strictEqual(await B.evalJs(`${S}.then((s) => s.get('DOC_UNIT'))`), 'mm', 'the phone (SketchStudio) keeps its own mm default');
  const T = (type, pts) => B.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const tapEl = async (sel) => {
    const c = await B.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2), hit = document.elementFromPoint(x, y); return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.ok(c && c.onTop, sel + ' is on the phone screen and not covered');
    await T('touchStart', [c]); await sleep(40); await T('touchEnd', []); await sleep(300);
  };
  const statusOf = (page) => page.evalJs(`(() => { const r = document.querySelector('.sk-style-panel .sk-style-sync'); if (!r) return null; const b = r.querySelector('[data-action="sync-now"]'); return { state: r.dataset.syncState, text: r.querySelector('.sk-style-sync-text').textContent, syncNow: !b.hidden }; })()`);
  const waitState = (page, state, what, ms = 10000) => page.waitFor(`(() => { const r = document.querySelector('.sk-style-panel .sk-style-sync'); return !!r && r.dataset.syncState === ${JSON.stringify(state)}; })()`, what, ms);
  const shotB = async (name) => {
    const clip = await B.evalJs(`(() => { const r = document.querySelector('.sk-style-panel').getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(innerWidth, r.width), height: Math.min(innerHeight - Math.max(0, r.top), r.height) }; })()`);
    const { data } = await B.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
    fs.writeFileSync(path.join(EVID, name), Buffer.from(data, 'base64')); console.log('screenshot ' + path.join(EVID, name));
  };
  const scrollToSync = () => B.evalJs(`document.querySelector('.sk-style-panel .sk-style-sync').scrollIntoView({ block: 'end' })`);
  await tapEl('#btn-settings');
  await B.waitFor(`!document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`, 'the Settings panel open on the phone');
  await waitState(B, 'saved', 'the phone: "Settings saved to Google Drive"');
  let st = await statusOf(B);
  assert.deepStrictEqual(st, { state: 'saved', text: 'Settings saved to Google Drive', syncNow: true }, 'the phone\'s status line, signed in');
  await scrollToSync(); await shotB('phone-saved.png');

  // ---- the phone changes the units in its Settings panel; the desktop shows them after its next sync, nothing else moves ----
  await tapEl('.sk-style-tab[data-tab="units"]');
  await B.evalJs(`(() => { const s = document.querySelector('.sk-style-panel select[data-key="DOC_UNIT"]'); s.value = 'cm'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitState(B, 'saving', 'the phone: syncing after the change (the 2 s debounce)', 3000);
  assert.strictEqual((await statusOf(B)).text, 'Syncing settings with Google Drive…');
  await scrollToSync(); await shotB('phone-saving.png');
  await waitState(B, 'saved', 'the phone: the change is on Drive', 15000);
  assert.strictEqual(settingsFile().DOC_UNIT.value, 'cm', 'Drive holds the phone\'s units');
  await A.evalJs(`${SYNC}.then((m) => m.syncSettingsNow())`); // the desktop's next sync (what its next start, sign-in or Sync now does)
  await A.waitFor(`${S}.then((s) => s.get('DOC_UNIT') === 'cm')`, 'the desktop shows the phone\'s units (cm)');
  await sleep(300);
  const after = await A.look();
  assert.strictEqual(await A.evalJs(`window.__notReloaded`), 'A', 'the desktop was not reloaded');
  assert.ok(sameView(after.view, start.view), 'the Prepare view is unchanged: ' + JSON.stringify([after.view, start.view]));
  assert.deepStrictEqual([after.sel, after.card, after.mounts], [start.sel, true, start.mounts], 'the pocket stays selected with its card open, Prepare not re-mounted');
  assert.strictEqual(after.plan, start.plan, 'the cut plan is untouched (the units only relabel)');
  const unitText = await A.evalJs(`document.querySelector('#prepare-panel .cut-card').textContent`);
  assert.ok(/\bcm\b/.test(unitText), 'the open card now shows centimetres: ' + unitText.slice(0, 200));
  await A.shot('desktop-prepare-after-units.png');

  // ---- at the same time: a shortcut on the phone, the units on the desktop: both end up on both ----
  await B.evalJs(`import('/packages/ui/shortcuts.js').then((m) => m.unassignShortcut('tool.slot'))`);
  await A.evalJs(`${S}.then((s) => s.set('DOC_UNIT', 'in', { persist: 'local' }))`);
  await Promise.all([A.evalJs(`${SYNC}.then((m) => m.syncSettingsNow())`), B.evalJs(`${SYNC}.then((m) => m.syncSettingsNow())`)]);
  await Promise.all([A.evalJs(`${SYNC}.then((m) => m.syncSettingsNow())`), B.evalJs(`${SYNC}.then((m) => m.syncSettingsNow())`)]);
  for (const [name, page] of [['desktop', A], ['phone', B]]) {
    assert.strictEqual(await page.evalJs(`${S}.then((s) => s.get('DOC_UNIT'))`), 'in', name + ': the desktop\'s units');
    assert.deepStrictEqual(await page.evalJs(`import('/packages/ui/shortcuts.js').then((m) => m.shortcutById('tool.slot').keys)`), [], name + ': the phone\'s shortcut (Slot: no key)');
  }
  const both = await A.look();
  assert.ok(sameView(both.view, start.view) && both.card && both.mounts === start.mounts && both.plan === start.plan, 'the desktop\'s Prepare still untouched: ' + JSON.stringify([both.view, both.sel, both.card, both.mounts]));

  // ---- Drive unreachable: "Could not reach Google Drive: will retry"; back: "Sync now" ----
  drive.offline = true;
  await B.evalJs(`(() => { const s = document.querySelector('.sk-style-panel select[data-key="ANGLE_PRECISION"]'); s.value = '3'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await B.evalJs(`${SYNC}.then((m) => m.syncSettingsNow())`); // at once (the debounced save would get there 2 s later)
  await waitState(B, 'retry', 'the phone: Drive unreachable', 15000);
  st = await statusOf(B);
  assert.deepStrictEqual(st, { state: 'retry', text: 'Could not reach Google Drive: will retry', syncNow: true }, 'the phone\'s status line, Drive unreachable');
  assert.strictEqual(await B.evalJs(`${S}.then((s) => s.get('ANGLE_PRECISION'))`), 3, 'the change is kept on the phone');
  assert.deepStrictEqual(await B.evalJs(`[...document.querySelectorAll('[role="alertdialog"], [role="dialog"], dialog[open]')].filter((e) => e.getClientRects().length > 0 && !(e.classList.contains('sk-sidebar') && !e.classList.contains('open'))).map((e) => e.className)`), [], 'no blocking dialog (the closed drawer aside)');
  await scrollToSync(); await shotB('phone-retry.png');
  drive.offline = false;
  await scrollToSync(); await tapEl('.sk-style-panel [data-action="sync-now"]');
  await waitState(B, 'saved', 'the phone: "Sync now" saved it', 10000);
  assert.strictEqual(settingsFile().ANGLE_PRECISION.value, 3, 'Drive holds the change made while it was unreachable');
  await shotB('phone-sync-now-saved.png');

  // ---- signed out: exactly the old behaviour (this device only, no Drive request); signing in merges ----
  await B.evalJs(`import('/packages/ui/cloud/google-account.js').then((m) => m.getGoogleAccount().signOut())`);
  await waitState(B, 'device', 'the phone signed out: "Saved on this device only"');
  st = await statusOf(B);
  assert.deepStrictEqual(st, { state: 'device', text: 'Saved on this device only (sign in to sync)', syncNow: false }, 'the phone\'s status line, signed out');
  const reqs = drive.requests.length;
  await B.evalJs(`(() => { const s = document.querySelector('.sk-style-panel select[data-key="LENGTH_PRECISION"]'); s.value = '5'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(2300); // past the 2 s debounce
  assert.strictEqual(drive.requests.length, reqs, 'signed out: a settings change makes no Drive request');
  assert.strictEqual(await B.evalJs(`${S}.then((s) => s.get('LENGTH_PRECISION'))`), 5, 'signed out: the change applies on the phone (localStorage) as before');
  await scrollToSync(); await shotB('phone-signed-out.png');
  await B.evalJs(`import('/packages/ui/cloud/google-account.js').then((m) => m.getGoogleAccount().signIn())`);
  await waitState(B, 'saved', 'the phone signed in again: merged', 10000);
  assert.strictEqual(settingsFile().LENGTH_PRECISION.value, 5, 'signing in sent the change made while signed out');
  await A.evalJs(`${SYNC}.then((m) => m.syncSettingsNow())`);
  assert.strictEqual(await A.evalJs(`${S}.then((s) => s.get('LENGTH_PRECISION'))`), 5, '... and the desktop got it');
  // a field the user is editing (it has the focus) is not rewritten under him; it shows the arrived value once he leaves it
  const LP = `document.querySelector('.sk-style-panel select[data-key="LENGTH_PRECISION"]')`;
  await B.evalJs(`${LP}.focus()`);
  await A.evalJs(`${S}.then((s) => s.set('LENGTH_PRECISION', 2, { persist: 'local' }))`);
  await A.evalJs(`${SYNC}.then((m) => m.syncSettingsNow())`);
  await B.evalJs(`${SYNC}.then((m) => m.syncSettingsNow())`);
  assert.deepStrictEqual(await B.evalJs(`${S}.then((s) => [s.get('LENGTH_PRECISION'), ${LP}.value, document.activeElement === ${LP}])`), [2, '5', true], 'the phone has the new precision from the desktop, but the field being edited keeps what it shows');
  await B.evalJs(`document.activeElement.blur()`);
  assert.strictEqual(await B.evalJs(`${LP}.value`), '2', 'left, the field shows the arrived value');
  assert.strictEqual(await B.evalJs(`window.__notReloaded`), 'B', 'the phone was never reloaded');

  // ---- the desktop's own status line, and nothing of it is a project ----
  await A.evalJs(`document.getElementById('btn-settings').click()`);
  await waitState(A, 'saved', 'the desktop: "Settings saved to Google Drive"');
  const clipA = await A.evalJs(`(() => { document.querySelector('.sk-style-panel .sk-style-sync').scrollIntoView({ block: 'end' }); const p = document.querySelector('.sk-style-panel').getBoundingClientRect(), r = document.querySelector('.sk-style-panel .sk-style-sync').getBoundingClientRect(); return { x: p.left, y: Math.max(p.top, r.top - 120), width: p.width, height: Math.min(p.bottom, r.bottom + 60) - Math.max(p.top, r.top - 120) }; })()`);
  const { data } = await A.send('Page.captureScreenshot', { format: 'png', clip: { ...clipA, scale: 2 } });
  fs.writeFileSync(path.join(EVID, 'desktop-saved.png'), Buffer.from(data, 'base64')); console.log('screenshot ' + path.join(EVID, 'desktop-saved.png'));
  const projects = await A.evalJs(`import('/packages/ui/project-store.js').then((m) => m.getProjectStore().listProjects()).then((ps) => ps.map((p) => p.name))`);
  assert.ok(!projects.includes('Settings'), 'the Settings folder is not a project: ' + JSON.stringify(projects));
  const fileDeviceOnly = JSON.stringify(settingsFile());
  assert.ok(!/FILE_DIALOG_TAB|BROWSER_COLLAPSED|RIBBON_LAYOUT|sk_cloud|GOOD|bromont/.test(fileDeviceOnly), 'the file holds no device-only key, no token, no design name');
  console.log('settings file keys: ' + Object.keys(settingsFile()).join(', '));
  console.log(`BLOCKED non-local requests: desktop ${A.net.blocked().length}, phone ${net.blocked().length}`);
  void session;
  console.log(`settings-drive-773-live: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
} finally {
  if (B) await B.close();
  await A.close();
}
