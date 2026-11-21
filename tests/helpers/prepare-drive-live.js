// tests/helpers/prepare-drive-live.js — TASK 766: the owner's Prepare sequence on a design whose home is Google Drive (the FAKE Drive and the fake sign-in of
// tests/helpers/fake-drive-session.js; every non-local request blocked), shared by the 766 live tests. The page: Shaper, desktop 1280 x 800, inches; the design
// "bromont" (a tapered outline and two small rectangles) saved to the fake Drive through THE Save as dialog; Prepare; the lower rectangle a Pocket, picked with
// the mouse, zoomed on with the wheel. Then the page tools to edit its card with real clicks and to read what the 766 bug changed:
//   look()   { view (the Prepare viewBox x,y,w,h), sel (the selected targets), card (open?), mounts (Prepare view mounts), plan (every record, full precision) }
//   drive    the fake Drive: files(), file content of "bromont", bump(n) (Drive's version moves, same content), write(fn) (another device changes the file)
//   failNextMetaPatch()  the NEXT metadata PATCH of "bromont" answers 503 once (the content upload before it lands): a write stopped half way
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './cdp-browser.js';
import { installFakeDriveSession } from './fake-drive-session.js';
import { blockRemote } from './block-remote.js';
import { resetBufferLive } from './reset-buffer.js';
import { parseProjectFile, serializeProjectFile } from '../../packages/ui/project-file.js';

// every (re)mount of the Prepare view (main.js sets window.__prepareView on each one) is counted
const COUNT_MOUNTS = `(() => { let pv = null; window.__prepareMounts = 0;
  Object.defineProperty(window, '__prepareView', { configurable: true, get: () => pv, set: (v) => { pv = v; window.__prepareMounts++; } }); })();`;

export async function openBromont({ tag, drive: sharedDrive }) { // TASK 773: `drive` = a fake Drive shared with another page (a second device); default a new one
  const EVID = path.resolve(process.env.EVIDENCE_DIR || '.evidence/766');
  fs.mkdirSync(EVID, { recursive: true });
  const cdp = await launchBrowser({ tag, width: 1280, height: 800 });
  if (!cdp) return null;
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const net = await blockRemote(cdp);
    const session = await installFakeDriveSession(cdp, { signedIn: true, drive: sharedDrive });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_MOUNTS });
    let failMeta = false;
    const f0 = session.drive.fetch;
    session.drive.fetch = async (url, init = {}) => { // the fake Drive's one injected failure: the metadata PATCH of bromont after its content upload
      if (failMeta && (init.method || 'GET').toUpperCase() === 'PATCH' && /^\/drive\/v3\/files\/[^/]+$/.test(new URL(url).pathname) && /bromont/.test(String(init.body || ''))) {
        failMeta = false;
        return new Response(JSON.stringify({ error: { code: 503, message: 'backendError' } }), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      return f0(url, init);
    };
    const bromontFile = () => [...session.drive.files.values()].find((f) => f.name === 'bromont.sketch.json' && !f.trashed);
    const drive = {
      files: () => [...session.drive.files.values()].filter((f) => !f.trashed && /\.sketch\.json$/.test(f.name)).map((f) => f.name),
      copies: () => drive.files().filter((n) => /conflicted copy/.test(n)),
      doc: () => parseProjectFile(bromontFile().content),
      bump: (n) => { bromontFile().version += n; },
      write: (fn) => { const f = bromontFile(); const p = parseProjectFile(f.content); fn(p.document); f.content = serializeProjectFile(p); f.version++; },
      version: () => bromontFile().version,
    };
    const failNextMetaPatch = () => { failMeta = true; };

    const ready = `!!document.querySelector('.sk-header-tab[data-tab="design"]') && !!(window.__designController && window.__designController.state) && document.getElementById('design-canvas').dataset.docReady === '1'`;
    const load = async () => { await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000); await waitFor(ready, 'Shaper ready'); };
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const press = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); await sleep(250); };
    const clickEl = async (sel) => {
      const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2), hit = document.elementFromPoint(x, y); return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
      assert.ok(p && p.onTop, `${sel} is on screen and not covered`);
      await press(p.x, p.y);
    };
    const toScreen = (x, y) => evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
    const look = () => evalJs(`import('/tests/helpers/plan-v2.js').then((C) => { const v = window.__prepareView, c = document.querySelector('#prepare-panel .cut-card');
      return { view: v ? [v.view.x, v.view.y, v.view.w, v.view.h] : null, sel: v ? v.selectedTargets().map((t) => t.kind + ':' + t.id) : [], card: !!c && !c.hidden, mounts: window.__prepareMounts,
        plan: JSON.stringify([...C.V2_PLAN.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) }; })`);
    const openStage = async (mode) => { await clickEl(`.sk-header-tab[data-tab="${mode}"]`); await sleep(300); };
    const menu = async () => {
      if (!(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`))) await clickEl('.sk-sidebar-btn');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the menu open');
    };
    const closeMenu = async () => { await clickEl('.sk-sidebar-backdrop'); await waitFor(`!document.querySelector('.sk-sidebar').classList.contains('open')`, 'the menu closed'); };
    const status = () => evalJs(`(() => { const s = document.querySelector('.sk-sidebar [data-section="status"]'); return s ? s.textContent : null; })()`);
    const saved = () => waitFor(`document.getElementById('design-canvas').dataset.saveState === 'saved' && !document.querySelector('.sk-doctab.active .sk-doctab-dot')`, 'the autosave settled', 15000);
    const flushDrive = () => evalJs(`import('/packages/ui/project-store.js').then((m) => m.getProjectStore().flushDrive())`);
    const ctrlS = () => sendRealKey(send, 's', 'KeyS', 83, 2);
    const shot = async (name) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVID, name), Buffer.from(data, 'base64')); console.log('screenshot ' + path.join(EVID, name)); };

    // ---- the owner's design, saved to the (fake) Drive, Prepare, the pocket picked and zoomed on ----
    await resetBufferLive(cdp);
    await load();
    await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'in'))`);
    await evalJs(`(() => { const st = window.__designController.state;
      const poly = (name, pts) => { pts.forEach(([x, y], i) => st.joints.set(name + 'j' + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: name + 's' + i, type: 'line', joints: [name + 'j' + i, name + 'j' + ((i + 1) % pts.length)] })); };
      poly('O', [[0, 0], [100, 0], [80, 300], [20, 300]]); poly('A', [[35, 60], [65, 60], [65, 100], [35, 100]]); poly('B', [[37, 130], [63, 130], [63, 170], [37, 170]]);
      st.saveState('draw'); })()`);
    await menu();
    await clickEl('[data-action="save-as"]');
    await waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"] [data-fd-tab="drive"][aria-selected="true"]') || !!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'the Save as dialog');
    if (await evalJs(`document.querySelector('.sk-fd').dataset.fdTab`) !== 'drive') await clickEl('.sk-fd [data-fd-tab="drive"]');
    await evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
    for (const ch of 'bromont') await sendRealKey(send, ch, '', ch.toUpperCase().charCodeAt(0), 0, ch);
    await clickEl('.sk-fd [data-choice="ok"]');
    await waitFor(`!document.querySelector('.sk-fd') && !!document.querySelector('.sk-doctab.active .sk-doctab-home[data-home="drive"]')`, 'bromont saved to the (fake) Drive');
    await openStage('prepare');
    await waitFor(`!!window.__prepareView && !document.getElementById('view-prepare').hidden`, 'Prepare');
    const c = await toScreen(50, 150);
    await press(c.x, c.y);
    // TASK S3: the press selects the shape (no card); the operations toolbar's Pocket makes the operation, open (its card)
    await waitFor(`window.__prepareView.selectedTargets().length === 1 && document.querySelector('#prepare-panel .cut-card').hidden`, 'the shape selected (no card)');
    await clickEl('#op-type-pocket'); await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'the pocket\'s card');
    await clickEl('#prepare-panel .cut-clear-trigger'); await waitFor(`!document.querySelector('.cut-clear-pop').hidden`, 'the Clearing popover'); await clickEl('.cut-clear-opt[data-clearing="linked"]');
    await sleep(300);
    const z = await toScreen(50, 150);
    for (let k = 0; k < 6; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: z.x, y: z.y, deltaX: 0, deltaY: -240 }); await sleep(60); }
    await sleep(300);
    await flushDrive(); await saved();
    return { cdp, port, send, evalJs, waitFor, load, net, drive, failNextMetaPatch, clickEl, press, look, openStage, menu, closeMenu, status, saved, flushDrive, ctrlS, shot, EVID,
      close: () => cdp.close() };
  } catch (e) { await cdp.close(); throw e; }
}

/** The card edits of the owner's sequence (real clicks on the steppers and the Loop box): [label, selector, the record field it changes]. */
export const CARD_EDITS = [
  ['depth +', '#prepare-panel .cut-row[data-param="cutDepth"] .cut-step[data-d="1"]', 'cutDepth'],
  ['stepover +', '#prepare-panel .cut-row[data-row="stepover"] .cut-step[data-d="1"]', 'stepover'],
  ['finish allowance +', '#prepare-panel .cut-row[data-row="finishAllowance"] .cut-step[data-d="1"]', 'finishAllowance'],
  ['Loop', '#prepare-panel .cut-row[data-row="loop"] .cut-check', 'loop'],
  ['depth +', '#prepare-panel .cut-row[data-param="cutDepth"] .cut-step[data-d="1"]', 'cutDepth'],
  ['bit +', '#prepare-panel .cut-row[data-param="toolDia"] .cut-step[data-d="1"]', 'toolDia'],
];

/** The records of a plan JSON (look().plan) with `field` of `key` left out: what an edit of that field must leave unchanged. */
export const planWithout = (planJson, key, field) => JSON.stringify(JSON.parse(planJson).map(([k, r]) => [k, k === key ? Object.fromEntries(Object.entries(r).filter(([f]) => f !== field)) : r]));

/** The view (x, y, w, h) is the same within 1e-6. */
export const sameView = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-6);
