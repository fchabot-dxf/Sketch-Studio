// tests/trace-projects.test.js — TASK 567: Trace is bound to the shared project store like the other apps, live in headless Edge.
//  A. the four apps' File menus list the SAME items in the SAME order (only each host's declared extras differ: the Download actions);
//  B. Trace: Import SVG / DXF into Edit (the shapes are DRAWN), set trace parameters, Save as "T1", reload restores it (shapes + parameters),
//     New design empties it and resets the parameters, Open recent and Projects open it again;
//  C. the Trace design opens in SketchStudio with identical geometry, and a SketchStudio save keeps hosts.trace untouched;
//  D. (EVIDENCE_DIR set) a cropped screenshot of Trace's File menu.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importViaMenu } from './helpers/import-via-menu.js';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = path.join(REPO_ROOT, 'tests', 'fixtures', 'svg', 'import-basic.svg');

await (async () => {
  const cdp = await launchBrowser({ tag: '567', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const driveSession = await installFakeDriveSession(cdp, { signedIn: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.showOpenFilePicker; delete window.showSaveFilePicker;' });
    const goto = (url) => navigate(`http://127.0.0.1:${port}${url}`, 8000);
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const openMenu = async () => { await clickEl('.sk-sidebar-btn'); await sleep(350); };
    const items = () => evalJs(`JSON.stringify([...document.querySelectorAll('.sk-sidebar-item')].filter((b) => b.dataset.action && b.offsetParent !== null).map((b) => [b.dataset.action, b.textContent.trim()]))`).then(JSON.parse);
    const S = '(await import("/packages/ui/project-store.js")).getProjectStore()';
    const recent = () => evalJs(`(async () => JSON.stringify((await ${S}.listRecent({})).map((d) => d.name)))()`).then(JSON.parse);
    const storedCurrent = () => evalJs(`(async () => { const s = ${S}; const d = await s.current(); return JSON.stringify({ name: d.name, app: d.app, doc: (await s.get(d.id)).document }); })()`).then(JSON.parse);
    const canvasShapes = (sel) => evalJs(`document.querySelectorAll('${sel} .shape-elem').length`);
    const shot = async (name) => {
      if (!process.env.EVIDENCE_DIR) return;
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 420, height: 560, scale: 2 } });
      fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name + '.png'), Buffer.from(s.data, 'base64'));
    };
    const loadTrace = async () => { await goto('/apps/trace/index.html'); await waitFor(`!!document.querySelector('.sk-sidebar-btn') && !!document.getElementById('threshold-slider')`, 'the Trace page'); await sleep(900); };
    const editVisible = () => evalJs(`!document.getElementById('tab-edit').hidden`);
    const val = (id) => evalJs(`document.getElementById('${id}').value`);

    // ── A. the File menus ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const apps = [
      ['SketchStudio', '/apps/sketchstudio/index.html', `!!document.getElementById('tool-line')`],
      ['Shaper', '/apps/shaper/index.html', `!!document.querySelector('.sk-header-tab[data-tab="design"]')`],
      ['Pen Plotter', '/apps/penplotter/index.html', `!!window.__sketch`],
      ['Trace', '/apps/trace/index.html', `!!document.getElementById('tab-edit')`],
    ];
    const EXTRAS = new Set(['download', 'download-svg', 'download-dxf', 'export', 'explore-open', 'explore-export', 'style', 'settings', 'log', 'debug', 'tune']); // each host's declared extras (hostActions): download/export/settings/tools moved into ☰ menu (TASK 602, 619)
    const menus = {};
    for (const [name, url, ready] of apps) {
      await goto(url);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn') && ${ready}`, 'the ' + name + ' page'); await sleep(800);
      await openMenu();
      menus[name] = await items();
      if (name === 'Trace') await shot('trace-file-menu');
    }
    const common = (m) => m.filter(([id]) => !EXTRAS.has(id));
    const base = common(menus['SketchStudio']);
    for (const name of Object.keys(menus)) assert.deepStrictEqual(common(menus[name]), base, name + ': the same File menu items, same order, same labels as SketchStudio');
    assert.deepStrictEqual(base.map(([id]) => id), ['new-design', 'save-as', 'duplicate', 'open-recent', 'projects', 'open-file', 'import-file'], 'the shared items (Save to Google Drive shows signed in only)');
    assert.deepStrictEqual(menus['Trace'].slice(base.length).map(([id]) => id), ['download-svg', 'download-dxf', 'log'], 'Trace keeps its Download SVG / DXF + Log, after the shared items');
    console.log('File menus equal across the four apps; Trace extras:', JSON.stringify(menus['Trace'].slice(base.length)));

    // ── B. Trace: import into Edit, parameters, Save as, reload ──────────────────────────────────────────────────────────────────────────────
    await loadTrace();
    await importViaMenu(cdp, SVG);
    await waitFor(`document.querySelectorAll('#design-canvas .shape-elem').length === 10`, 'the 10 imported shapes DRAWN in the Edit canvas');
    assert.ok(await editVisible(), 'the Edit tab shows after an import');
    await evalJs(`(() => { const t = document.getElementById('threshold-slider'); t.value = 90; t.dispatchEvent(new Event('input', { bubbles: true })); const o = document.getElementById('outline-only-cb'); o.checked = false; o.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(300);
    await openMenu();
    await clickEl('[data-action="save-as"]'); await sleep(250);
    await waitFor(`!!document.querySelector('.sk-sidebar-ask [data-choice="signin"]')`, 'signed out Save as asks to sign in first');
    await clickEl('.sk-sidebar-ask [data-choice="signin"]');
    await waitFor(`!!document.querySelector('.sk-sidebar-input')`, 'Save as name prompt after sign-in');
    await evalJs(`document.querySelector('.sk-sidebar-input').value = 'T1'`);
    await clickEl('.sk-sidebar-confirm-btns .ok'); await sleep(900);
    assert.strictEqual(driveSession.drive.byName('T1.sketch.json').length, 1, 'T1 saved ONLY to fake Google Drive');
    assert.ok((await recent()).includes('T1'), 'Save as T1: ' + JSON.stringify(await recent()));
    const saved = await storedCurrent();
    assert.strictEqual(saved.name, 'T1'); assert.strictEqual(saved.app, 'trace');
    assert.strictEqual(saved.doc.geometry.shapes.length, 10, 'the 10 shapes are in the stored design');
    assert.strictEqual(saved.doc.hosts.trace.params.threshold, 90, 'hosts.trace holds the trace parameters');
    assert.strictEqual(saved.doc.hosts.trace.params.outlineOnly, false);
    assert.ok(!JSON.stringify(saved.doc.hosts.trace).includes('data:'), 'hosts.trace holds no photo');
    console.log('stored hosts.trace:', JSON.stringify(saved.doc.hosts.trace));

    await loadTrace();
    await waitFor(`document.querySelectorAll('#design-canvas .shape-elem').length === 10`, 'the reload to restore T1 into the Edit canvas');
    assert.ok(await editVisible(), 'the restored design (its sketch) shows on the Edit tab');
    assert.strictEqual(await val('threshold-slider'), '90', 'the restored threshold');
    assert.strictEqual(await evalJs(`document.getElementById('outline-only-cb').checked`), false, 'the restored outline-only');

    // New design: empty sketch, parameters back to the defaults
    await openMenu(); await clickEl('[data-action="new-design"]'); await sleep(900);
    assert.strictEqual(await canvasShapes('#design-canvas'), 0, 'New design empties the Edit canvas');
    assert.strictEqual(await val('threshold-slider'), '128', 'and resets the parameters to the defaults');
    // Open recent
    await openMenu(); await clickEl('[data-action="open-recent"]'); await sleep(600);
    await evalJs(`[...document.querySelectorAll('.sk-pm .sk-pm-tile')].find((t) => t.querySelector('[data-name]').textContent === 'T1').click()`); await sleep(1000);
    assert.strictEqual(await canvasShapes('#design-canvas'), 10, 'Open recent > T1 restores the shapes');
    assert.strictEqual(await val('threshold-slider'), '90', 'and the parameters');
    // Projects
    await openMenu(); await clickEl('[data-action="new-design"]'); await sleep(900);
    assert.strictEqual(await canvasShapes('#design-canvas'), 0);
    await openMenu(); await clickEl('[data-action="projects"]'); await sleep(600);
    await evalJs(`[...document.querySelectorAll('.sk-pm-side .sk-pm-prow')].find((w) => w.textContent.includes('My Designs')).querySelector('.sk-pm-rowbtn').click()`); await sleep(600);
    await evalJs(`[...document.querySelectorAll('.sk-pm-tile')].find((t) => t.querySelector('[data-name]').textContent === 'T1').click()`); await sleep(1000);
    assert.strictEqual(await canvasShapes('#design-canvas'), 10, 'Projects > My Designs > T1 opens it');
    console.log('Trace: import is drawn, Save as T1, reload, New design, Open recent, Projects: ok');

    // ── C. the Trace design in SketchStudio, and back ────────────────────────────────────────────────────────────────────────────────────────
    await sleep(2000); // let the autosave settle
    const before = await storedCurrent();
    assert.strictEqual(before.name, 'T1');
    await goto('/apps/sketchstudio/index.html');
    await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('tool-line'); })()`, 'SketchStudio');
    await waitFor(`document.querySelectorAll('#svgCanvas .shape-elem').length === 10`, 'SketchStudio to show the Trace design (10 shapes)');
    const rc = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    await clickEl('#tool-line');
    await click(Math.round(rc.x + rc.w * 0.30), Math.round(rc.y + rc.h * 0.75));
    await click(Math.round(rc.x + rc.w * 0.55), Math.round(rc.y + rc.h * 0.75));
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitFor(`(async () => { const s = ${S}; const d = await s.current(); return (await s.get(d.id)).document.geometry.shapes.length === 11; })()`, 'SketchStudio to autosave its new line', 10000);
    const after = await storedCurrent();
    assert.deepStrictEqual(after.doc.hosts.trace, before.doc.hosts.trace, 'a SketchStudio save leaves hosts.trace untouched');
    assert.deepStrictEqual(after.doc.geometry.shapes.slice(0, 10), before.doc.geometry.shapes, 'the Trace geometry is unchanged under the new line');
    await loadTrace();
    await waitFor(`document.querySelectorAll('#design-canvas .shape-elem').length === 11`, 'Trace to show the SketchStudio edit');
    assert.strictEqual(await val('threshold-slider'), '90', 'and its parameters survived the SketchStudio save');
    console.log('Trace design -> SketchStudio -> Trace: geometry identical, hosts.trace preserved: ok');
    console.log('trace-projects: ok');
  } finally {
    await cdp.close();
  }
})();
