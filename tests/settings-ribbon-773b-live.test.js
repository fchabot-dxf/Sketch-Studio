// tests/settings-ribbon-773b-live.test.js — TASK 773b (owner turn 2364: the ribbon layout "per account"): the tool-ribbon layout follows the user between devices
// through the settings file on his Google Drive, per app. Two real browsers = two devices, SketchStudio desktop 1280 x 800, ONE fake Drive
// (tests/harness/fake-drive.js through tests/helpers/fake-drive-session.js: fake sign-in, no Google request, every non-local request blocked):
//   A takes Circle out of the Create section's bar with real clicks (the section's dropdown, its checkbox); Sync now on A, then on B: B's bar loses Circle
//   WITHOUT a reload, the other sections untouched. Then a layout naming a tool SketchStudio does not have arrives from Drive: B applies it with no error,
//   the unknown id is ignored and every section of the ribbon is still there with its tools. Screenshot: .evidence/773/ribbon-b-after-sync.png.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { blockRemote } from './helpers/block-remote.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { createFakeDrive } from './harness/fake-drive.js';
import { parseSettingsFile } from '../packages/ui/cloud/settings-sync.js';

const EVID = path.resolve(process.env.EVIDENCE_DIR || '.evidence/773');
fs.mkdirSync(EVID, { recursive: true });
const t0 = Date.now();
const drive = createFakeDrive();
const SYNC_NOW = `import('/packages/ui/cloud/settings-sync.js').then((m) => m.syncSettingsNow()).then((s) => s.state)`;
const COUNT_ERRORS = `(() => { window.__errors = []; addEventListener('error', (e) => window.__errors.push(String(e.message))); addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message || e.reason))); })();`;
const ribbon = `(() => [...document.querySelectorAll('.sk-ribbon-group')].map((g) => ({ key: g.dataset.section, ids: [...g.querySelectorAll('.sk-ribbon-btns > .sk-ribbon-btn')].map((b) => b.id), shown: [...g.querySelectorAll('.sk-ribbon-btns > .sk-ribbon-btn')].filter((b) => !b.hidden).map((b) => b.id) })))()`;

async function device(tag) {
  const cdp = await launchBrowser({ tag, width: 1280, height: 800 });
  if (!cdp) return null;
  try {
    await blockRemote(cdp);
    await installFakeDriveSession(cdp, { signedIn: true, drive });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_ERRORS });
    await resetBufferLive(cdp);
    await cdp.navigate(`http://127.0.0.1:${cdp.port}/apps/sketchstudio/index.html`, 10000);
    await cdp.waitFor(`!!document.querySelector('#svgCanvas') && !!document.querySelector('.sk-ribbon-group[data-section="create"]')`, tag + ': SketchStudio and its ribbon');
    await cdp.waitFor(`import('/packages/ui/cloud/settings-sync.js').then((m) => m.settingsSyncStatus().state === 'saved')`, tag + ': the start sync done');
    await cdp.evalJs(`window.__notReloaded = ${JSON.stringify(tag)}`);
    return cdp;
  } catch (e) { await cdp.close(); throw e; }
}

const A = await device('773ra');
if (!A) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
let B = null;
try {
  B = await device('773rb');
  const mouse = (type, x, y, buttons = 0) => A.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const clickEl = async (sel) => {
    const p = await A.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2), hit = document.elementFromPoint(x, y); return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.ok(p && p.onTop, sel + ' is on screen and not covered');
    await mouse('mouseMoved', p.x, p.y); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y); await sleep(250);
  };
  const before = await B.evalJs(ribbon);
  const create = before.find((s) => s.key === 'create');
  assert.ok(create.shown.includes('tool-circle'), 'B: Circle is in the Create bar at first: ' + JSON.stringify(create.shown));

  // ---- A: Circle out of the Create bar, with real clicks; Sync now on A then on B ----
  await clickEl('.sk-ribbon-group[data-section="create"] .sk-ribbon-group-label');
  await A.waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show[data-section="create"]')`, 'A: the Create dropdown');
  await clickEl('.sk-ribbon-sect-row[data-id="tool-circle"] .sk-ribbon-sect-check input');
  assert.strictEqual(await A.evalJs(`document.getElementById('tool-circle').hidden`), true, 'A: Circle left the bar');
  await clickEl('.sk-ribbon-group[data-section="create"] .sk-ribbon-group-label'); // closes the dropdown
  assert.strictEqual(await A.evalJs(SYNC_NOW), 'saved', 'A: Sync now saved it');
  const file = () => parseSettingsFile([...drive.files.values()].find((f) => f.name === 'settings.json' && !f.trashed).content).settings;
  assert.ok(file()['RIBBON_LAYOUT:sketchstudio'] && file()['RIBBON_LAYOUT:sketchstudio'].value.create.off.includes('tool-circle'), 'Drive holds SketchStudio\'s layout, per app: ' + JSON.stringify(Object.keys(file())));
  assert.strictEqual(await B.evalJs(SYNC_NOW), 'saved', 'B: Sync now');
  const after = await B.evalJs(ribbon);
  assert.strictEqual(await B.evalJs(`window.__notReloaded`), '773rb', 'B was not reloaded');
  assert.ok(!after.find((s) => s.key === 'create').shown.includes('tool-circle'), 'B: Circle left the Create bar too: ' + JSON.stringify(after.find((s) => s.key === 'create').shown));
  assert.deepStrictEqual(after.find((s) => s.key === 'create').ids.sort(), [...create.ids].sort(), 'B: Circle is still in the section (its dropdown), only out of the bar');
  for (const s of before.filter((x) => x.key !== 'create')) assert.deepStrictEqual(after.find((x) => x.key === s.key).ids, s.ids, 'B: section ' + s.key + ' untouched');
  const clip = await B.evalJs(`(() => { const r = document.querySelector('.sk-ribbon-group[data-section="create"]').closest('.sk-ribbon-host, .sk-ribbon, div').getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(innerWidth, r.width), height: Math.max(40, r.height) }; })()`);
  const { data } = await B.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
  fs.writeFileSync(path.join(EVID, 'ribbon-b-after-sync.png'), Buffer.from(data, 'base64')); console.log('screenshot ' + path.join(EVID, 'ribbon-b-after-sync.png'));

  // ---- a layout naming a tool SketchStudio does not have arrives from Drive: ignored safely ----
  await A.evalJs(`Promise.all([import('/packages/core/settings-manager.js'), import('/packages/ui/ribbon-layout.js')]).then(([S, R]) => S.default.set('RIBBON_LAYOUT', R.withSection(S.default.get('RIBBON_LAYOUT'), 'sketchstudio', 'create', { order: ['tool-no-such-tool', 'tool-circle'], off: ['tool-no-such-tool'] }), { persist: 'local' }))`);
  assert.strictEqual(await A.evalJs(SYNC_NOW), 'saved');
  assert.strictEqual(await B.evalJs(SYNC_NOW), 'saved');
  const odd = await B.evalJs(ribbon);
  assert.deepStrictEqual(await B.evalJs(`window.__errors`), [], 'B: no error');
  assert.deepStrictEqual(odd.map((s) => s.key), before.map((s) => s.key), 'B: every ribbon section is still there');
  const oc = odd.find((s) => s.key === 'create');
  assert.deepStrictEqual([...oc.ids].sort(), [...create.ids].sort(), 'B: Create keeps exactly its own tools (the unknown id ignored)');
  assert.strictEqual(oc.ids[0], 'tool-circle', 'B: the known part of the arrived order applies (Circle first)');
  assert.ok(oc.shown.includes('tool-circle') && oc.shown.length > 0, 'B: Circle back in the bar, the bar not empty: ' + JSON.stringify(oc.shown));
  assert.strictEqual(await B.evalJs(`!!document.getElementById('tool-no-such-tool')`), false, 'B: no button for the unknown id');
  assert.deepStrictEqual(await A.evalJs(`window.__errors`), [], 'A: no error');
  assert.strictEqual(await B.evalJs(`window.__notReloaded`), '773rb', 'B was never reloaded');
  console.log(`settings-ribbon-773b-live: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
} finally {
  if (B) await B.close();
  await A.close();
}
