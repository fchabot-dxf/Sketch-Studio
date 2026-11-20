// tests/opfirst-relief-live.test.js — TASK S1 (docs/OPERATIONS-MODEL.md section 3, Live): a MIGRATED relief document in the real Shaper page. A version 2 design
// of the corpus (tests/fixtures/opfirst/: the synthetic dome relief, Roughing Nested + its Contour with its own heights / walls / ball nose: frozen on origin/main
// c5d4bb1) is stored as a named design and opened (the page's own restore: applyShaperDoc migrates it), on DESKTOP 1280 x 800 and PHONE 390 x 844:
//   the Operations list rows, the 3D Review's items and the download are the baseline's (eNoId, dContent, a md5s, tests/helpers/opfirst-measure.js);
//   the saved document is version 4 (TASK S2: the Contour's own values, one Depth) (the autosave) and opens again the same. No console error / page exception.
// Screenshots (.evidence/S1/): live-desktop-ops.png, live-desktop-review.png, live-phone-ops.png, live-phone-review.png.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { md5, canonical } from './helpers/opfirst-measure.js';

const CASE = 'matrix__relief-dome-contourSettings';
const DIR = new URL('./fixtures/opfirst/', import.meta.url);
const c = JSON.parse(fs.readFileSync(new URL('cases.json', DIR), 'utf8')).find((x) => x.name === CASE);
const pool = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('pool.json.gz', DIR))));
const base = JSON.parse(fs.readFileSync(new URL('baseline.json', DIR), 'utf8')).cases[CASE];
const sidecar = JSON.parse(JSON.stringify(c.sidecar));
for (const e of sidecar.cutPlan) if (e[1] && e[1].levels && e[1].levels.$levels) e[1].levels = pool.levels[e[1].levels.$levels];
if (sidecar.stl && sidecar.stl.$stl) sidecar.stl = pool.stl[sidecar.stl.$stl];
const document = { version: 3, geometry: pool.geometry[c.geometry], hosts: { shaper: sidecar } };
assert.strictEqual(sidecar.version, 2, 'the stored design is a version 2 one');

const EVIDENCE_DIR = path.resolve('.evidence/S1');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const cdp = await launchBrowser({ tag: 's1-relief', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
const shot = async (name, sel = null) => {
  const clip = sel ? await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.max(1, r.width), height: Math.max(1, r.height), scale: 1 }; })()`) : null;
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
const stage = (mode) => evalJs(`(() => { const e = document.querySelector('.sk-header-tab[data-tab="${mode}"]') || document.querySelector('.sk-sidebar-stage[data-tab="${mode}"]'); e.click(); return true; })()`);
const open = async () => { await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 20000); await waitForApp('design-canvas'); await sleep(800); };
// what the page shows, measured as the baseline measures it
const measureNow = async () => {
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', 'mm', { persist: false }); })`);
  await stage('prepare');
  await waitFor(`document.querySelectorAll('#prepare-ops .ops-row').length > 0`, 'the Operations list rows');
  await sleep(300);
  const items = await evalJs(`[...document.querySelector('#prepare-ops .ops-body').children].map((el) => el.classList.contains('ops-tool') ? { heading: el.textContent }
    : el.classList.contains('ops-row') ? { text: el.querySelector('.ops-name').textContent, sub: el.querySelector('.ops-sub').textContent, picked: el.classList.contains('is-picked') } : { empty: el.textContent })`);
  const svg = await evalJs(`Promise.all([import('/apps/shaper/src/export-payload.js'), import('/apps/shaper/src/cut-plan.js')]).then(([E, C]) => E.shaperSvgOf(window.__designController.state, C.planEntries()))`);
  const relief = await evalJs(`import('/apps/shaper/src/cut-plan.js').then((C) => JSON.parse(JSON.stringify(C.planReliefItems(window.__designController.state).map((i) => ({ cutType: i.cutType, cutDepth: i.cutDepth, footprints: i.footprints, shape: i.shape })))))`);
  return { items, eNoId: md5(items), a: md5(svg), dContent: md5(canonical(relief)) };
};

try {
  await installFakeDriveSession(cdp);
  await resetBufferLive(cdp);
  await open();
  const id = await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const store = m.getProjectStore(); const d = await store.newDesign('Relief S1', { app: 'shaper' });
    await store.save(${JSON.stringify(document)}, { app: 'shaper', id: d.id }); return d.id; })`);
  assert.ok(id, 'the version 2 design is stored');
  for (const [label, metrics] of [['desktop', null], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]]) {
    if (metrics) { await send('Emulation.setDeviceMetricsOverride', { ...metrics, screenOrientation: { type: 'portraitPrimary', angle: 0 } }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
    await open();
    const m = await measureNow();
    console.log(`${label}: list ${JSON.stringify(m.items)}`);
    assert.strictEqual(m.eNoId, base.eNoId, `${label}: the Operations list rows are the baseline's`);
    assert.strictEqual(m.dContent, base.dContent, `${label}: the 3D Review's items are the baseline's`);
    assert.strictEqual(m.a, base.a, `${label}: the download is the baseline's (md5 ${m.a})`);
    if (label === 'phone' && await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await evalJs(`document.querySelector('#prepare-ops .ops-head').click()`);
    await sleep(300);
    await shot(`live-${label}-ops.png`, '#prepare-ops');
    await stage('review');
    await waitFor(`!!document.querySelector('#review-canvas canvas, #review-view canvas, canvas')`, `${label}: the 3D Review`);
    await sleep(2500);
    await shot(`live-${label}-review.png`);
    console.log(`${label}: list, 3D Review items and download = the baseline (eNoId ${m.eNoId}, dContent ${m.dContent}, a ${m.a})`);
  }
  // the page's own Shaper document (shaper-doc.js captureShaperDoc: what the next save writes) stored in place of the version 2 one: opened again it measures the
  // same (opening alone changes nothing, so the autosave writes nothing until an edit)
  const stored = await evalJs(`Promise.all([import('/packages/ui/project-store.js'), import('/apps/shaper/src/shaper-doc.js')]).then(async ([m, D]) => { const store = m.getProjectStore();
    const doc = (await store.get(${JSON.stringify(id)})).document; doc.hosts.shaper = JSON.parse(JSON.stringify(D.captureShaperDoc())); await store.save(doc, { app: 'shaper', id: ${JSON.stringify(id)} });
    return (await store.get(${JSON.stringify(id)})).document.hosts.shaper; })`);
  assert.strictEqual(stored.version, 4, 'the page writes the design as version 4 (TASK S2, docs/OPERATIONS-MODEL.md 9.5)');
  assert.ok(Array.isArray(stored.operations) && !('cutPlan' in stored), 'with its operations (no cutPlan)');
  await open();
  const again = await measureNow();
  assert.deepStrictEqual([again.eNoId, again.dContent, again.a], [base.eNoId, base.dContent, base.a], 'the version 4 design opened again: the same list, Review and download');
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('opfirst-relief-live: ok');
} finally { await close(); }
