// tests/export-header-880-live.test.js -- TASK 880 (owner turns 3484-3485): Shaper's Export view has NO side panel; the canvas takes the view's width.
//   - its three export ACTIONS (Generate Shaper SVG, Sync to ShaperHub, Open ShaperHub (My Files)) are the Export stage's HEADER actions, at the header's right
//     end (icons only below 1000 px); where the header hides (a phone) the drawer lists them under the stage buttons. Same in Fusion mode (?host=fusion).
//   - its SETTINGS (Thickness stepper, Material select) are in the shared footer, with their labels; folded into one footer button where the row is short.
//   - the explanatory texts are not on screen ("No Stock loop: ..." is the Thickness label's tooltip now); the build line ("N triangles · N levels · built in
//     N ms") is gone from the view (the debug log only; lastBuild keeps the numbers).
// Per size (desktop 1280 / 1024, a 700 px window, Fusion mode 1280, a phone 390 x 844 touch), real presses:
//   1. no #review-side; #review-stage as wide as the view; no sideways scroll; nothing of the header / footer overflows or overlaps;
//   2. Generate Shaper SVG (header, or the drawer on the phone) downloads exactly the exporter's file (export-payload.js exportWhenGenerated: the bytes the
//      Export step always wrote) and the status line says it;
//   3. Sync to ShaperHub opens the Sync dialog (Cancel closes it; nothing is sent); Open ShaperHub is a new-tab link to My Files (not followed);
//   4. Thickness + in the footer makes the 3D board thicker (the stock and the board's underside follow); Material walnut puts the walnut look on the board;
//   5. Prepare: the actions and the settings hide; Export: they are back.
// EVIDENCE_DIR set: screenshots of each size (whole page, the header and the footer zoomed, the phone drawer and the fold card).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { REVIEW_BUILT, REVIEW_BUILD } from './helpers/review-built.js';
import { pressExportAction, showExportSettings } from './helpers/export-actions.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || null;
const CASES = [
  { name: 'desktop-1280', w: 1280, h: 800, mobile: false, q: '', labels: true },
  { name: 'desktop-1024', w: 1024, h: 700, mobile: false, q: '', labels: true },
  { name: 'window-700', w: 700, h: 700, mobile: false, q: '', labels: false },
  { name: 'fusion-1280', w: 1280, h: 800, mobile: false, q: '?host=fusion', labels: true },
  { name: 'phone-390', w: 390, h: 844, mobile: true, q: '', labels: null },
];
const ACTIONS = ['btn-generate-svg', 'btn-sync-shaper', 'link-shaper-hub'];
const LABELS = ['Generate Shaper SVG', 'Sync to ShaperHub', 'Open ShaperHub (My Files)'];

const cdp = await launchBrowser({ tag: '880', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, waitForApp, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-880-dl-'));
let touchMode = false;
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
// a real press at the element's centre; the element (or a child) must be what is there: a user can reach it
const press = async (sel) => {
  const c = await centre(sel);
  assert.ok(c, sel + ' not found');
  assert.ok(c.hit, sel + ' is covered at its centre ' + JSON.stringify(c));
  if (touchMode) { await T('touchStart', [c]); await sleep(40); await T('touchEnd', []); await sleep(350); return; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
};
const rect = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), shown: e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' }; })()`);
const shown = async (sel) => !!(await rect(sel) || {}).shown;
const shot = async (name, clip = null, scale = 1) => {
  if (!EVIDENCE_DIR) return;
  const p = { format: 'png' };
  if (clip) p.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale };
  const s = await send('Page.captureScreenshot', p);
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
};
const openStage = async (id) => {
  if (await shown(`.sk-header-tab[data-tab="${id}"]`)) await press(`.sk-header-tab[data-tab="${id}"]`);
  else { await press('.sk-sidebar-chevron'); await waitFor(`!!document.querySelector('.sk-sidebar.open')`, 'the drawer'); await press(`.sk-sidebar-stage[data-tab="${id}"]`); }
  await waitFor(`!document.getElementById('view-${id}').hidden`, 'the ' + id + ' stage');
  await sleep(300);
};
const downloaded = async (fn) => {
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await fn();
  let file = null;
  for (let i = 0; i < 150 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
  assert.ok(file, 'the export downloaded');
  return fs.readFileSync(file, 'utf8');
};
// the design: a 40 x 40 Inside 3 mm and a 50 x 60 pocket 8 mm (the Review test's), assigned through the plan
const seed = () => evalJs(`(async () => {
  const st = window.__designController.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0;
  const rect = (p, x, y, w, h) => { const n = [p+'a', p+'b', p+'c', p+'d']; [[0,0],[w,0],[w,h],[0,h]].forEach(([dx,dy], i) => st.joints.set(n[i], { x: x+dx, y: y+dy })); [0,1,2,3].forEach((i) => st.shapes.push({ id: p+'s'+i, type: 'line', joints: [n[i], n[(i+1)%4]] })); };
  rect('A', 0, 0, 40, 40); rect('B', 70, 0, 50, 60);
  const plan = await import('/tests/helpers/plan-v2.js');
  const { findLoops } = await import('#core/loop-finder.js');
  const { loopPolygon } = await import('#core/loop-geometry.js');
  const loops = findLoops(st).map((l) => ({ ...l, polygon: loopPolygon(l, st, new Map(st.shapes.map((sh) => [sh.id, sh]))) }));
  const minX = (l) => Math.min(...l.polygon.map((p) => p.x));
  const A = loops.find((l) => Math.abs(minX(l)) < 1e-6), B = loops.find((l) => Math.abs(minX(l) - 70) < 1e-6);
  plan.V2_PLAN.set(plan.keyOf('loop', A.id), { cutType: 'interior', cutDepth: 3, cutOffset: 0, toolDia: 3.175 });
  plan.V2_PLAN.set(plan.keyOf('loop', B.id), { cutType: 'pocket', cutDepth: 8, cutOffset: 0, toolDia: 6.35 });
})()`);

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  for (const c of CASES) {
    const D = c.name;
    touchMode = c.mobile;
    await send('Emulation.setTouchEmulationEnabled', { enabled: c.mobile, maxTouchPoints: c.mobile ? 5 : 0 });
    await send('Emulation.setDeviceMetricsOverride', { width: c.w, height: c.h, deviceScaleFactor: 1, mobile: c.mobile });
    await resetBufferLive(cdp);
    await evalJs(`localStorage.setItem('shaper-mode', ${JSON.stringify(c.q ? 'prepare' : 'design')}); localStorage.setItem('shaper-review-view', '3d'); localStorage.removeItem('shaper-review-look')`);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html${c.q}`, 10000);
    await waitForApp('design-canvas');
    await waitFor('!!(window.__designController && window.__designController.state)', D + ': the design');
    await seed();
    await openStage('review');
    await waitFor(REVIEW_BUILT, D + ': the 3D board built', 60000);
    await sleep(500);

    // 1. no side panel: the view's width is the stage's; no sideways scroll
    const layout = await evalJs(`({ side: !!document.getElementById('review-side'), view: Math.round(document.getElementById('view-review').getBoundingClientRect().width), stage: Math.round(document.getElementById('review-stage').getBoundingClientRect().width), doc: document.documentElement.scrollWidth, vw: innerWidth })`);
    console.log(D + ' layout ' + JSON.stringify(layout));
    assert.strictEqual(layout.side, false, D + ': no #review-side');
    assert.ok(layout.stage === layout.view && layout.view === c.w, D + ': the view takes the width: ' + JSON.stringify(layout));
    assert.ok(layout.doc <= layout.vw, D + ': no sideways scroll');
    // the build line is gone (the build's numbers are lastBuild's); the explanatory texts are not on screen
    const info = await evalJs(`document.getElementById('review-info').textContent`), build = await evalJs(REVIEW_BUILD);
    assert.ok(build.triangles > 0 && !/triangles|built in|\\d+ levels? ·/.test(info), D + ': no build line on screen (' + JSON.stringify(info) + '), lastBuild has ' + build.triangles + ' triangles');
    const text = await evalJs(`document.body.innerText`);
    assert.ok(!/No Stock loop|machine-ready/.test(text), D + ': no explanatory note on screen');
    assert.ok((await evalJs(`import('/apps/shaper/src/hint.js').then((m) => m.hintFor(document.getElementById('review-stock-label')))`)).includes('No Stock loop: the board is the design bounds + margin.'), D + ': the board note is the Thickness tooltip');

    // the header (desktop) or the drawer (phone): the three actions
    if (!c.mobile) {
      const hd = await evalJs(`(() => { const h = document.querySelector('.sk-header'), hr = h.getBoundingClientRect(); const g = h.querySelector('.sk-header-stage-actions[data-stage="review"]');
        const tabs = [...h.querySelectorAll('.sk-header-tab')].map((t) => t.getBoundingClientRect().right);
        const acts = [...g.children].map((a) => { const r = a.getBoundingClientRect(); const l = a.querySelector('.sk-action-label'); return { id: a.id, aria: a.getAttribute('aria-label'), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), label: getComputedStyle(l).display !== 'none' }; });
        return { hidden: g.hidden, sw: h.scrollWidth, cw: h.clientWidth, right: Math.round(hr.right), top: Math.round(hr.top), bottom: Math.round(hr.bottom), tabsRight: Math.round(Math.max(...tabs)), acts }; })()`);
      console.log(D + ' header ' + JSON.stringify(hd));
      assert.strictEqual(hd.hidden, false, D + ': the Export actions show in the header');
      assert.deepStrictEqual(hd.acts.map((a) => a.id), ACTIONS, D + ': the three actions, in order');
      assert.deepStrictEqual(hd.acts.map((a) => a.aria), LABELS, D + ': their names');
      assert.ok(hd.sw <= hd.cw, D + ': the header does not overflow');
      assert.ok(hd.acts[0].left > hd.tabsRight + 8, D + ': the actions start after the stage tabs');
      assert.ok(hd.right - hd.acts[2].right <= 16 && hd.acts[2].right <= hd.right, D + ': right-aligned');
      assert.ok(hd.acts.every((a, i) => i === 0 || a.left >= hd.acts[i - 1].right) && hd.acts.every((a) => a.top >= hd.top && a.bottom <= hd.bottom), D + ': no overlap, inside the bar');
      assert.ok(hd.acts.every((a) => a.label === c.labels), D + (c.labels ? ': icon + label' : ': icons only (the label its name)'));
      await shot(`${D}-page.png`);
      await shot(`${D}-header.png`, { x: Math.max(0, c.w - 620), y: 0, width: Math.min(620, c.w), height: 48 }, 2);
    } else {
      assert.strictEqual(await shown('.sk-header'), false, D + ': no header bar on a phone');
      await shot(`${D}-page.png`);
      await press('.sk-sidebar-chevron');
      await waitFor(`!!document.querySelector('.sk-sidebar.open')`, D + ': the drawer');
      await sleep(300);
      const dr = await evalJs(`(() => { const g = document.querySelector('.sk-sidebar-stage-actions[data-stage="review"]'); return { hidden: g.hidden, items: [...g.children].map((a) => { const r = a.getBoundingClientRect(); return { action: a.dataset.action, text: a.textContent.trim(), id: a.id, left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) }; }), vw: innerWidth }; })()`);
      console.log(D + ' drawer ' + JSON.stringify(dr));
      assert.ok(!dr.hidden && dr.items.length === 3, D + ': the drawer lists the Export actions');
      assert.deepStrictEqual(dr.items.map((a) => [a.action, a.text, a.id]), ACTIONS.map((id, i) => [id, LABELS[i], '']), D + ': the three actions (no second element with the header ids)');
      assert.ok(dr.items.every((a) => a.left >= 0 && a.right <= dr.vw && a.h >= 44), D + ': inside the screen, 44 px tall');
      await shot(`${D}-drawer.png`);
      { const x = c.w - 12, y = Math.round(c.h / 2); await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(350); } // a tap on the backdrop, right of the drawer
      await waitFor(`!document.querySelector('.sk-sidebar.open')`, D + ': the drawer closed');
    }

    // 2. Generate Shaper SVG: the exporter's file, byte for byte
    const file = await downloaded(() => pressExportAction(cdp, press, 'btn-generate-svg'));
    const expected = await evalJs(`import('/apps/shaper/src/export-payload.js').then((m) => m.exportWhenGenerated(window.__designController.state)).then((p) => p.svg)`);
    assert.strictEqual(file, expected, D + ': Generate wrote the exporter\'s file, byte for byte');
    assert.ok(/<svg/.test(file) && /shaper:cutType/.test(file), D + ': a Shaper SVG');
    await waitFor(`/Exported 2 cuts/.test(document.getElementById('simexport-status').textContent)`, D + ': the status line says it');
    if (c.mobile) assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sidebar.open')`), false, D + ': the drawer closed on the press');
    const status = await rect('#simexport-status');
    assert.ok(status.shown && status.l >= 0 && status.r <= c.w, D + ': the status line on screen');
    await shot(`${D}-generated.png`);
    if (D === 'desktop-1280') fs.writeFileSync(path.join(EVIDENCE_DIR || os.tmpdir(), '880-generated.svg'), file);

    // 3. Sync to ShaperHub: the dialog (Cancel closes it, nothing sent); Open ShaperHub: a new-tab link to My Files
    await pressExportAction(cdp, press, 'btn-sync-shaper');
    await waitFor(`document.getElementById('shaper-sync-modal').open`, D + ': the Sync dialog opened');
    await press('#sync-btn-cancel');
    await waitFor(`!document.getElementById('shaper-sync-modal').open`, D + ': the Sync dialog closed');
    const hub = await evalJs(`[...document.querySelectorAll('[data-action="link-shaper-hub"]')].map((a) => [a.tagName, a.getAttribute('href'), a.target, a.rel])`);
    assert.ok(hub.length >= 1 && hub.every((h) => JSON.stringify(h) === JSON.stringify(['A', 'https://hub.shapertools.com/my-files', '_blank', 'noopener noreferrer'])), D + ': Open ShaperHub opens My Files in a new tab: ' + JSON.stringify(hub));

    // 4. the footer's settings: labelled; Thickness + makes the board thicker; Material walnut
    const folded = await showExportSettings(cdp, press);
    assert.strictEqual(folded, !c.labels, D + (c.labels ? ': the settings sit in the footer row' : ': the settings fold into one footer button, opened'));
    const ft = await evalJs(`(() => { const f = document.querySelector('.sk-footer'), s = document.getElementById('review-settings'); const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom) }; };
      return { inFooter: f.contains(s), labels: [document.getElementById('review-stock-label').textContent, document.getElementById('review-look-label').textContent], settings: r(s), footer: r(f), fsw: f.scrollWidth, fcw: f.clientWidth, vw: innerWidth, vh: innerHeight,
        kids: [...f.querySelectorAll('.sk-history-btn, .sk-footer-btn, .sk-save, .sk-account, #review-stock, #review-look')].filter((e) => e.getClientRects().length).map((e) => ({ id: e.id || e.className, ...r(e) })) }; })()`);
    console.log(D + ' footer ' + JSON.stringify(ft));
    assert.ok(ft.inFooter, D + ': the settings are the footer\'s');
    assert.deepStrictEqual(ft.labels, ['Thickness', 'Material'], D + ': with their labels');
    assert.ok(ft.settings.l >= 0 && ft.settings.r <= ft.vw && ft.settings.t >= 0 && ft.settings.b <= ft.vh && ft.fsw <= ft.fcw, D + ': inside the screen, the footer row does not overflow');
    if (!folded) { // in the row: the settings and the footer's buttons never overlap
      const btns = ft.kids.filter((e) => e.id !== 'review-stock' && e.id !== 'review-look' && !/cut-step/.test(e.id));
      for (const b of btns) assert.ok(!(Math.min(b.r, ft.settings.r) - Math.max(b.l, ft.settings.l) > 0), D + ': a footer button overlaps the settings: ' + JSON.stringify([b, ft.settings]));
    }
    await shot(`${D}-footer.png`, folded ? null : { x: 0, y: c.h - 48, width: c.w, height: 48 }, folded ? 1 : 2);
    const before = await evalJs(`Promise.all([import('/apps/shaper/src/stock.js'), import('/apps/shaper/src/main.js')]).then(([s, m]) => ({ t: s.getStock().thickness, y: m.currentReviewView().inspect().box.y, ms: m.currentReviewView().lastBuild.ms }))`);
    await press('#review-stock .cut-step[data-d="1"]');
    await waitFor(`Promise.all([import('/apps/shaper/src/stock.js'), import('/apps/shaper/src/main.js')]).then(([s, m]) => s.getStock().thickness > ${before.t} && m.currentReviewView().inspect().box.y < ${before.y})`, D + ': Thickness +: the stock and the 3D board are thicker');
    const after = await evalJs(`Promise.all([import('/apps/shaper/src/stock.js'), import('/apps/shaper/src/main.js')]).then(([s, m]) => ({ t: s.getStock().thickness, y: m.currentReviewView().inspect().box.y, field: document.getElementById('review-stock-thickness').value }))`);
    console.log(D + ' thickness ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after));
    if (folded) { await showExportSettings(cdp, press); } // a press on the board / the stepper may have closed it: reopen
    await evalJs(`document.getElementById('review-look-select').focus()`);
    await evalJs(`(() => { const s = document.getElementById('review-look-select'); s.value = 'walnut'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`import('/apps/shaper/src/main.js').then((m) => m.currentReviewView().inspect().look.id === 'walnut')`, D + ': Material walnut: the board takes the walnut look');
    await sleep(500);
    await shot(`${D}-walnut.png`);
    if (folded) { await press('#btn-footer-controls'); await waitFor(`document.querySelector('.sk-footer-controls').dataset.open === 'false'`, D + ': the fold card closes'); }

    // 5. another stage: no Export actions, no Export settings; back: both
    await openStage('prepare');
    assert.strictEqual(await evalJs(`(() => { const g = document.querySelector('.sk-header-stage-actions[data-stage="review"]'); return g.hidden && document.getElementById('review-settings').hidden && document.querySelector('.sk-footer-controls').hidden; })()`), true, D + ': Prepare: no Export actions or settings');
    await openStage('review');
    assert.strictEqual(await evalJs(`(() => { const g = document.querySelector('.sk-header-stage-actions[data-stage="review"]'); return !g.hidden && !document.getElementById('review-settings').hidden; })()`), true, D + ': Export again: both back');
    console.log(D + ': ok');
  }
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('export-header-880-live: ok');
} finally {
  fs.rmSync(dlDir, { recursive: true, force: true });
  await close();
}
