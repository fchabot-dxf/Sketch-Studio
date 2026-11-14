// tests/save-to-file-in-projects.test.js — TASK 547: the PROJECT MANAGER modal (thumbnail grid) in SketchStudio and Shaper, live and headless.
// "Save to file" left the main menu and is an action of each design in the manager; every other design / project action is there too.
// Covers: no save-file in the menu, the modal opens from "Projects" (focus in, drawer closed), projects + thumbnails, search, rename, duplicate,
// Save to file (bytes equal what the old menu item wrote: store.exportFile of the same design through the same seam; the picker is stubbed),
// delete with confirm, arrows + Enter open a design, Esc closes and focus returns, the 390 px single-pane layout.
// EVIDENCE_DIR=<dir> also writes screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

const STUB = `(() => {
  window.showOpenFilePicker = undefined;
  window.__t547 = { saves: [] };
  window.showSaveFilePicker = async (o) => ({ name: o.suggestedName, createWritable: async () => { let t = ''; return { write: async (x) => { t += x; }, close: async () => { window.__t547.saves.push({ name: o.suggestedName, text: t }); } }; } });
})();`;

await (async () => {
  const cdp = await launchBrowser({ tag: '547', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  try {
    await installFakeDriveSession(cdp);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
    const shot = async (name, w = 1000, h = 680, x = 0, y = 0) => {
      if (!process.env.EVIDENCE_DIR) return;
      await sleep(300);
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 1.3 } });
      fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name + '.png'), Buffer.from(s.data, 'base64'));
    };
    const key = (k, code, vk, text) => send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, text });
    const click = (sel) => evalJs(`document.querySelector(${JSON.stringify(sel)}).click()`);
    const q = (js) => evalJs(js);
    const S = '(await import("/packages/ui/project-store.js")).getProjectStore()';
    const tiles = () => q(`[...document.querySelectorAll('.sk-pm-tile [data-name]')].map((n) => n.textContent)`);
    const menuOf = async (name, item) => {
      await q(`[...document.querySelectorAll('.sk-pm-tile')].find((t) => t.querySelector('[data-name]').textContent === ${JSON.stringify(name)}).querySelector('[data-pm=design-menu]').click()`);
      await waitFor(`!!document.querySelector('.sk-pm-menu [data-menu="${item}"]')`, `menu item ${item}`);
      await click(`.sk-pm-menu [data-menu="${item}"]`);
    };
    const DOC = (pts) => ({ version: 2, geometry: { joints: pts.map((p, i) => ['j' + i, { x: p[0], y: p[1] }]), shapes: pts.map((_, i) => ({ id: 's' + i, type: 'line', joints: ['j' + i, 'j' + ((i + 1) % pts.length)] })), constraints: [] }, hosts: {} });
    const openManager = async (what) => {
      await click('.sk-sidebar-btn');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open') && !!document.querySelector('[data-action="projects"]')`, `${what}: drawer`);
      await click('[data-action="projects"]');
      await waitFor(`!!document.querySelector('.sk-pm') && !!document.querySelector('.sk-pm-rowbtn')`, `${what}: the modal`);
    };

    for (const host of ['sketchstudio', 'shaper']) {
      await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
      await navigate(`http://127.0.0.1:${port}/apps/${host}/index.html`, 10000);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn')`, `${host} sidebar button`);
      if (host === 'sketchstudio') await waitForApp('svgCanvas'); // the Shaper's Design buffer exists only once its Design tab is entered
      const H = JSON.stringify(host);
      // seed: two designs in My Designs (with geometry) and one in a new project. My Designs is named: a new design goes to the CURRENT design's
      // project by default (project-store.js newDesign), and the current design here is whatever the previous host's half opened last (TASK 558:
      // a fresh page no longer stores an "Untitled" in My Designs that used to be the current one).
      await q(`(async () => { const s = ${S};
        const a = await s.newDesign('Trapezoid', { app: ${H} }); await s.save(${JSON.stringify(DOC([[0, 0], [60, 0], [45, 30], [15, 30]]))}, { id: a.id, app: ${H} });
        const b = await s.newDesign('Bracket', { app: ${H}, projectId: a.projectId }); await s.save(${JSON.stringify(DOC([[0, 0], [40, 0], [40, 40]]))}, { id: b.id, app: ${H} });
        const p = await s.createProject('Shop jigs'); const c = await s.newDesign('Plate', { app: ${H} }); await s.save(${JSON.stringify(DOC([[0, 0], [80, 0], [80, 20], [0, 20]]))}, { id: c.id, app: ${H} }); await s.moveDesign(c.id, p.id);
        await s.flushDrive();
        return true; })()`);

      // the menu: no Save to file; its neighbours are untouched
      await click('.sk-sidebar-btn');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open') && !!document.querySelector('[data-action="projects"]')`, `${host} drawer`);
      const acts = await q(`[...document.querySelectorAll('.sk-sidebar [data-section="actions"] [data-action]')].map((b) => b.dataset.action)`);
      assert.ok(!acts.includes('save-file'), `${host}: no Save to file in the main menu: ${acts}`);
      for (const a of ['open-recent', 'projects', 'open-file']) assert.ok(acts.includes(a), `${host}: ${a} still in the menu`);
      assert.ok(!(await q(`document.querySelector('.sk-sidebar').textContent`)).includes('Save to file'), `${host}: no "Save to file" text in the menu`);
      await shot(`547-${host}-menu-after`, 360, 560);

      // Projects opens the modal; the drawer closes; focus is inside
      await click('[data-action="projects"]');
      await waitFor(`!!document.querySelector('.sk-pm') && document.querySelectorAll('.sk-pm-tile').length >= 3`, `${host}: the modal with its designs`);
      assert.strictEqual(await q(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, `${host}: the drawer closed`);
      assert.strictEqual(await q(`document.querySelector('.sk-pm').contains(document.activeElement)`), true, `${host}: focus is inside the modal`);
      const sideRows = await q(`[...document.querySelectorAll('.sk-pm-side .sk-pm-rowbtn .nm')].map((n) => n.textContent)`);
      assert.ok(sideRows[0] === 'Recent' && sideRows.includes('My Designs') && sideRows.includes('Shop jigs'), `${host}: Recent then the projects: ${sideRows}`);
      assert.ok((await tiles()).includes('Trapezoid') && (await tiles()).includes('Plate'), `${host}: Recent lists the designs`);
      await waitFor(`document.querySelectorAll('.sk-pm-thumb svg').length >= 3`, `${host}: thumbnails`);
      assert.ok(await q(`document.querySelector('.sk-pm-thumb svg path').getAttribute('d').startsWith('M')`), `${host}: a thumbnail draws a path`);
      assert.ok(/Google Drive/.test(await q(`document.querySelector('.sk-pm-sub').textContent`)), `${host}: where it lives is shown`);
      await shot(`547-${host}-manager-desktop`, 960, 660, 220, 70);

      // search
      await q(`(() => { const i = document.querySelector('[data-pm=search]'); i.value = 'brack'; i.dispatchEvent(new Event('input')); })()`);
      const found = await tiles(); // (both hosts share one browser profile, so the other host's renamed copy may be listed too)
      assert.ok(found.includes('Bracket') && found.every((n) => /brack/i.test(n)), `${host}: search filters by name: ${found}`);
      await q(`(() => { const i = document.querySelector('[data-pm=search]'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);

      // one project's designs, then Recent again
      const shopId = await q(`(() => { const b = [...document.querySelectorAll('.sk-pm-rowbtn')].find((x) => x.textContent.includes('Shop jigs')); b.click(); return b.dataset.pane; })()`);
      // the view's OWN condition (a tile count also holds for the Recent view still on screen): that project's row is the selected one, which
      // the manager renders together with its designs
      await waitFor(`!!document.querySelector('.sk-pm-rowbtn.sel[data-pane="${shopId}"]')`, `${host}: a project's designs`);
      assert.ok((await tiles()).includes('Plate') && !(await tiles()).includes('Trapezoid'), `${host}: only that project's designs`);
      await click('.sk-pm-rowbtn[data-pane="recent"]');
      await waitFor(`document.querySelectorAll('.sk-pm-tile').length >= 3`, `${host}: back to Recent`);

      // rename
      await menuOf('Bracket', 'rename');
      await q(`document.querySelector('.sk-pm-ask input').value = 'Bracket v2'`); await click('.sk-pm-ask .ok');
      await waitFor(`[...document.querySelectorAll('.sk-pm-tile [data-name]')].some((n) => n.textContent === 'Bracket v2')`, `${host}: rename`);
      // duplicate
      const before = (await tiles()).length;
      await menuOf('Bracket v2', 'duplicate');
      await waitFor(`document.querySelectorAll('.sk-pm-tile').length === ${before + 1}`, `${host}: duplicate adds a design`);
      assert.ok((await tiles()).includes('Bracket v2 copy'), `${host}: the copy is named`);
      // Save to file: bytes equal what the old menu item wrote
      const id = await q(`[...document.querySelectorAll('.sk-pm-tile')].find((t) => t.querySelector('[data-name]').textContent === 'Trapezoid').dataset.design`);
      await menuOf('Trapezoid', 'save-file');
      await waitFor(`window.__t547.saves.length === 1`, `${host}: the file to be written`);
      const saved = await q(`window.__t547.saves[0]`);
      const expected = await q(`(async () => { let text = null, name = null; await ${S}.exportFile(${JSON.stringify(id)}, { save: async (t, n) => { text = t; name = n; return { name: n }; } }); return { text, name }; })()`);
      assert.strictEqual(saved.text, expected.text, `${host}: the saved bytes equal the old menu item's output`);
      assert.strictEqual(saved.name, 'Trapezoid.sketch.json');
      assert.strictEqual(JSON.parse(saved.text).format, 'sketch-studio-project');
      assert.strictEqual(await q(`!!document.querySelector('.sk-pm')`), true, `${host}: the modal stays open after saving`);
      // delete asks first
      await menuOf('Bracket v2 copy', 'delete');
      assert.ok(/Delete "Bracket v2 copy"\?/.test(await q(`document.querySelector('.sk-pm-ask').textContent`)), `${host}: delete asks`);
      await click('.sk-pm-ask .cancel');
      assert.ok((await tiles()).includes('Bracket v2 copy'), `${host}: Cancel deletes nothing`);
      await menuOf('Bracket v2 copy', 'delete'); await click('.sk-pm-ask .ok');
      await waitFor(`![...document.querySelectorAll('.sk-pm-tile [data-name]')].some((n) => n.textContent === 'Bracket v2 copy')`, `${host}: delete`);
      // right-click menu: the design's declared actions (no Google Drive item while signed out); Esc closes it first, not the modal
      await q(`document.querySelector('.sk-pm-tile').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))`);
      assert.deepStrictEqual(await q(`[...document.querySelectorAll('.sk-pm-menu button')].map((b) => b.dataset.menu)`), ['open', 'rename', 'duplicate', 'move', 'save-file', 'delete'], `${host}: the design menu`);
      await key('Escape', 'Escape', 27); await sleep(100);
      assert.strictEqual(await q(`!document.querySelector('.sk-pm-menu') && !!document.querySelector('.sk-pm')`), true, `${host}: Esc closes the menu first`);
      // keyboard: arrows move, Enter opens
      await q(`document.querySelector('.sk-pm-tile').focus()`);
      await key('ArrowRight', 'ArrowRight', 39); await sleep(100);
      assert.strictEqual(await q(`document.activeElement === document.querySelectorAll('.sk-pm-tile')[1]`), true, `${host}: ArrowRight moves along the grid`);
      const openId = await q(`document.activeElement.dataset.design`);
      await key('Enter', 'Enter', 13, '\r'); await sleep(100);
      await waitFor(`!document.querySelector('.sk-pm')`, `${host}: Enter opens the design and closes the modal`);
      await waitFor(`(async () => ((await ${S}.current()) || {}).id === ${JSON.stringify(openId)})()`, `${host}: the design is current`);
      // reopen: Esc closes, focus returns to the menu button
      await openManager(host);
      await key('Escape', 'Escape', 27); await sleep(150);
      assert.strictEqual(await q(`!document.querySelector('.sk-pm') && document.activeElement === document.querySelector('.sk-sidebar-btn')`), true, `${host}: Esc closes; focus is back on the menu button`);

      // 390 px: one pane at a time, with a back button
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(300);
      await openManager(`${host} 390`);
      assert.strictEqual(await q(`getComputedStyle(document.querySelector('.sk-pm-main')).display`), 'none', `${host} 390: the projects list shows first`);
      assert.ok(await q(`document.querySelector('.sk-pm').scrollWidth <= 390 && document.documentElement.scrollWidth <= 390`), `${host} 390: no horizontal overflow`);
      await shot(`547-${host}-manager-390-projects`, 390, 800);
      await click('.sk-pm-rowbtn[data-pane="recent"]');
      await waitFor(`getComputedStyle(document.querySelector('.sk-pm-main')).display !== 'none' && document.querySelectorAll('.sk-pm-tile').length >= 1`, `${host} 390: the designs pane`);
      assert.strictEqual(await q(`getComputedStyle(document.querySelector('.sk-pm-side')).display`), 'none');
      await waitFor(`document.querySelectorAll('.sk-pm-thumb svg').length >= 1`, `${host} 390: thumbnails`);
      await shot(`547-${host}-manager-390-designs`, 390, 800);
      await click('[data-pm=back]');
      assert.strictEqual(await q(`getComputedStyle(document.querySelector('.sk-pm-side')).display !== 'none'`), true, `${host} 390: back returns to the projects`);
      await click('[data-pm=close]');
      assert.strictEqual(await q(`!document.querySelector('.sk-pm')`), true, `${host}: X closes`);
      console.log(`${host}: project manager ok`);
    }
    console.log('save-to-file-in-projects: ok');
  } finally {
    await cdp.close();
  }
})();
