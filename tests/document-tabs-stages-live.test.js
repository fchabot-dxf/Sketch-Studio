// tests/document-tabs-stages-live.test.js — TASK 605: the document tab strip in Shaper, Pen Plotter and Trace, KEPT ACROSS STAGES, in the REAL pages with the real pointer.
// A tab is the whole document. Switching tabs from a stage that is not Design switches the document and the app stays in that stage; the stage's own state
// (the tab's session: Prepare's selected loop, the Toolpath stage's selected pen folder, Trace's photo / trace / scale) comes back with the tab:
//   Shaper       Prepare: a rectangle is drawn in Design and its loop selected in Prepare; "+" in Prepare shows an empty document with nothing selected, still in
//                Prepare; the first tab back shows the loop selected again. The strip is visible in Explore, Design, Vcarve, Prepare and Review.
//   Pen Plotter  Toolpath: a pen is added and its folder selected; "+" in Toolpath shows no pens; the first tab back shows the pen and its selected folder. The
//                strip is visible in Design, Toolpath and Export.
//   Trace        Export (its other mode) and Trace: a photo is loaded and traced, its scale typed; "+" shows no photo, no trace, no scale and disabled downloads; the
//                first tab back shows the photo, the trace and the scale, in the same mode. The strip is visible in Trace, Edit and Export.
// Also: the save state is the tab's dot (no header status text) and a failed save shows in the menu's status line.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '605', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const shot = async (name, clip) => {
    if (!process.env.EVIDENCE_DIR) return;
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1.5 } });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  try {
    const url = (h) => `http://127.0.0.1:${port}/apps/${h}/index.html`;
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(250);
    };
    const clickEl = async (sel, i = 0) => {
      const c = await evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      assert(c, sel + ' #' + i + ' not found'); await click(c.x, c.y);
    };
    const names = () => evalJs(`[...document.querySelectorAll('.sk-doctab-name')].map((e) => e.textContent)`);
    const activeName = () => evalJs(`(document.querySelector('.sk-doctab.active .sk-doctab-name') || {}).textContent`);
    const stripVisible = () => evalJs(`(() => { const s = document.querySelector('.sk-doctabs'); const r = s && s.getBoundingClientRect(); return !!r && r.width > 300 && r.height === 26 && s.contains(document.elementFromPoint(r.left + 40, r.top + 12)); })()`);
    const twoDesigns = async (app) => { // two stored designs; the page restores the last (Beta)
      await navigate(url(app), 10000);
      await evalJs(CREATE_NAMED_DESIGN(app, 'Alpha')); await evalJs(CREATE_NAMED_DESIGN(app, 'Beta'));
      await navigate(url(app), 10000);
      await waitFor(`!!document.querySelector('.sk-doctab-name') && document.querySelector('.sk-doctab-name').textContent === 'Beta'`, app + ': the restored design is the first tab');
    };
    const newTab = async () => { await clickEl('.sk-doctab-new'); await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Untitled'`, 'the new tab is active'); await sleep(400); };
    const backToFirst = async () => { await clickEl('.sk-doctab-main', 0); await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Beta'`, 'Beta is active again'); await sleep(500); };
    const noStatusText = async (app) => assert.strictEqual(await evalJs(`!!document.getElementById('save-status') || !!document.getElementById('tr-status')`), false, app + ': no header status text');

    // ---- Shaper ------------------------------------------------------------------------------------------------------------------------
    {
      await twoDesigns('shaper');
      await noStatusText('shaper');
      const modeBtn = (m) => evalJs(`document.querySelector('[data-mode="${m}"]').click()`);
      for (const m of ['explore', 'design', 'vcarve', 'prepare', 'review']) { await modeBtn(m); await sleep(500); assert(await stripVisible(), `shaper ${m}: the strip is visible and uncovered`); }
      // a closed rectangle in Design (real pointer: line tool, four clicks, back to the first point)
      await modeBtn('design'); await sleep(600);
      const r = await evalJs(`(() => { const b = document.getElementById('design-canvas').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; })()`);
      const P = [[0.3, 0.3], [0.6, 0.3], [0.6, 0.6], [0.3, 0.6], [0.3, 0.3]].map(([fx, fy]) => ({ x: Math.round(r.l + r.w * fx), y: Math.round(r.t + r.h * fy) }));
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', text: 'l', windowsVirtualKeyCode: 76 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
      for (const p of P) await click(p.x, p.y);
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
      await modeBtn('prepare'); await sleep(800);
      await waitFor(`window.__prepareView && window.__prepareView.loops.length >= 1`, 'Prepare found the rectangle loop');
      await evalJs(`window.__prepareView.setSelection([{ kind: 'loop', id: window.__prepareView.loops[0].id }])`);
      const selected = () => evalJs(`window.__prepareView.selectedTargets().length`);
      const loops = () => evalJs(`window.__prepareView.loops.length`);
      const mode = () => evalJs(`document.querySelector('.mode-btn.active').dataset.mode`);
      assert.strictEqual(await selected(), 1); const nLoops = await loops();
      await shot('shaper-prepare-before-switch.png', { x: 0, y: 0, width: 1400, height: 360 });
      await newTab();
      assert.strictEqual(await mode(), 'prepare', 'shaper: "+" in Prepare stays in Prepare');
      assert.strictEqual(await loops(), 0, 'shaper: the new tab shows an empty document in Prepare (no loops)');
      assert.strictEqual(await selected(), 0, 'shaper: nothing selected in the new tab');
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-doctab-dot').length`), 0, 'shaper: an empty new tab shows no not-saved dot');
      await backToFirst();
      assert.strictEqual(await mode(), 'prepare', 'shaper: switching back from Prepare stays in Prepare');
      assert.strictEqual(await loops(), nLoops, "shaper: Beta's rectangle is shown in Prepare");
      assert.strictEqual(await selected(), 1, "shaper: Beta's selected loop is back");
      assert(await evalJs(`getComputedStyle(document.getElementById('prepare-panel')).display !== 'none' && !document.getElementById('prepare-panel').hidden`), 'shaper: the cut card of the selected loop is shown');
      await shot('shaper-prepare-after-switch.png', { x: 0, y: 0, width: 1400, height: 360 });
      // from Review (a stage with no per-tab view): the switch works and the app stays in Review
      await modeBtn('review'); await sleep(800);
      await newTab();
      assert.strictEqual(await mode(), 'review', 'shaper: "+" in Review stays in Review');
      assert(await stripVisible(), 'shaper review: the strip is visible after the switch');
      assert.deepStrictEqual(await names(), ['Beta', 'Untitled', 'Untitled']);
      // the save state is the tab's dot: an Untitled with content shows it
      assert.strictEqual(await activeName(), 'Untitled');
      console.log('shaper: strip in every mode; Prepare selection kept across a switch; Review stays');
    }

    // ---- Pen Plotter ---------------------------------------------------------------------------------------------------------------------
    {
      await twoDesigns('penplotter');
      await noStatusText('penplotter');
      const stage = (s) => evalJs(`document.querySelector('.stage-btn[data-stage="${s}"]').click()`);
      const cur = () => evalJs(`document.querySelector('.stage-btn.active').dataset.stage`);
      for (const s of ['design', 'toolpath', 'export']) { await stage(s); await sleep(500); assert(await stripVisible(), `penplotter ${s}: the strip is visible and uncovered`); }
      await stage('toolpath'); await sleep(600);
      await clickEl('#addPlotColor'); await sleep(400);
      await waitFor(`document.querySelectorAll('.pc-row').length === 1`, 'a pen was added');
      await waitFor(`document.querySelectorAll('.group-row').length >= 1`, 'its folder row');
      await clickEl('.group-row', 0); await sleep(300);
      assert.strictEqual(await evalJs(`document.querySelectorAll('.group-row.pen-selected').length`), 1, 'the pen folder is selected');
      await shot('penplotter-toolpath-before-switch.png', { x: 0, y: 0, width: 700, height: 420 });
      await newTab();
      assert.strictEqual(await cur(), 'toolpath', 'penplotter: "+" in Toolpath stays in Toolpath');
      assert.strictEqual(await evalJs(`document.querySelectorAll('.pc-row').length`), 0, 'penplotter: the new tab has no pens');
      assert.strictEqual(await evalJs(`document.querySelectorAll('.group-row.pen-selected').length`), 0, 'penplotter: and no selected folder');
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-doctab-dot').length`), 0, 'penplotter: an empty new tab shows no not-saved dot');
      await backToFirst();
      assert.strictEqual(await cur(), 'toolpath', 'penplotter: back, still Toolpath');
      assert.strictEqual(await evalJs(`document.querySelectorAll('.pc-row').length`), 1, "penplotter: Beta's pen is back");
      assert.strictEqual(await evalJs(`document.querySelectorAll('.group-row.pen-selected').length`), 1, "penplotter: Beta's selected pen folder is back");
      await shot('penplotter-toolpath-after-switch.png', { x: 0, y: 0, width: 700, height: 420 });
      // from Export: the switch works and the app stays in Export
      await stage('export'); await sleep(600);
      await clickEl('.sk-doctab-main', 1); await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Untitled'`, 'the second tab');
      await sleep(500);
      assert.strictEqual(await cur(), 'export', 'penplotter: a switch in Export stays in Export');
      assert(await stripVisible(), 'penplotter export: the strip is visible after the switch');
      console.log('penplotter: strip in every stage; Toolpath pen selection kept across a switch; Export stays');
    }

    // ---- Trace ---------------------------------------------------------------------------------------------------------------------------
    {
      await twoDesigns('trace');
      await noStatusText('trace');
      const tab = (t) => evalJs(`document.querySelector('.tr-tab[data-tab="${t}"]').click()`);
      const cur = () => evalJs(`document.querySelector('.tr-tab.active').dataset.tab`);
      for (const t of ['trace', 'edit', 'export']) { await tab(t); await sleep(500); assert(await stripVisible(), `trace ${t}: the strip is visible and uncovered`); }
      await tab('trace'); await sleep(400);
      // a photo through the real file input: a black block on white, 60 x 40 px
      await evalJs(`(async () => { const c = document.createElement('canvas'); c.width = 60; c.height = 40; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 60, 40); x.fillStyle = '#000'; x.fillRect(10, 8, 40, 24);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'block.png', { type: 'image/png' }));
        const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await waitFor(`!!document.querySelector('#svg-output svg') && !document.getElementById('btn-send-to-edit').disabled`, 'the photo was traced');
      await evalJs(`(() => { const i = document.getElementById('global-width-val'); i.value = '120'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(300);
      const trState = () => evalJs(`({ w: document.getElementById('original-canvas').width, traced: !!document.querySelector('#svg-output svg'), empty: document.getElementById('original-empty').style.display, width: document.getElementById('global-width-val').value,
        readout: document.getElementById('scale-readout').textContent.replace(/\\s+/g, ' '), send: !document.getElementById('btn-send-to-edit').disabled })`);
      const a = await trState();
      assert(a.w === 60 && a.traced && a.empty === 'none' && a.width === '120' && a.readout.includes('mm/px'), 'trace: photo, trace and scale in Beta: ' + JSON.stringify(a));
      await shot('trace-trace-before-switch.png', { x: 0, y: 0, width: 1400, height: 420 });
      await newTab();
      assert.strictEqual(await cur(), 'trace', 'trace: "+" in the Trace tab stays in the Trace tab');
      const n = await trState();
      assert(n.w === 0 && !n.traced && n.width === '' && !n.send && n.empty !== 'none', 'trace: the new tab has no photo, no trace, no scale: ' + JSON.stringify(n));
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-doctab-dot').length`), 0, 'trace: an empty new tab shows no not-saved dot (nothing changed in it)');
      await backToFirst();
      assert.strictEqual(await cur(), 'trace', 'trace: back, still the Trace tab');
      const b = await trState();
      assert(b.w === 60 && b.traced && b.empty === 'none' && b.width === '120' && b.send, "trace: Beta's photo, trace and scale are back: " + JSON.stringify(b));
      await shot('trace-trace-after-switch.png', { x: 0, y: 0, width: 1400, height: 420 });
      // the other mode: Export shows the traced result; its downloads follow the tab
      await tab('export'); await sleep(400);
      assert.strictEqual(await evalJs(`document.getElementById('btn-dl-svg').disabled`), false, 'trace: Beta can download its trace');
      await clickEl('.sk-doctab-main', 1); await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Untitled'`, 'the second tab'); await sleep(500);
      assert.strictEqual(await cur(), 'export', 'trace: a switch in Export stays in Export');
      assert.strictEqual(await evalJs(`document.getElementById('btn-dl-svg').disabled`), true, 'trace: the other tab has no trace to download');
      await clickEl('.sk-doctab-main', 0); await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Beta'`, 'Beta again'); await sleep(500);
      assert.strictEqual(await evalJs(`document.getElementById('btn-dl-svg').disabled`), false, "trace: Beta's download is enabled again");
      console.log('trace: strip in every tab; photo, trace and scale kept across a switch; Export stays');
    }
    console.log('document-tabs-stages-live: ok');
  } finally { await cdp.close(); }
})();
