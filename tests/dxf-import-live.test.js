// tests/dxf-import-live.test.js — TASK 478: the ONE 'Import SVG / DXF' entry in the REAL Shaper (headless Edge, real file input): a Fusion sketch
// DXF lands as true lines + arcs with construction lines and counted skips, its closed profiles are selectable loops in Prepare, a malformed
// DXF is a readable status (no throw), and the Fusion add-in SVG imports with its cut types and the compound pocket as a profile.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { launchBrowser } from './helpers/cdp-browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '478', width: 1400, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, ws, waitFor, waitForApp } = cdp;
  try {
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)); });
    const mouse = async (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: (buttons || type === 'mouseReleased') ? 1 : 0 });
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); await mouse('mouseReleased', c.x, c.y); await sleep(200);
    };
    const openMode = async (mode) => { // real click; retry because the nav shifts while the page's late widgets mount
      for (let i = 0; i < 5; i++) {
        await clickEl(`[data-mode="${mode}"]`); await sleep(300);
        if (await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`) === mode) return;
      }
      assert.fail('could not open the ' + mode + ' tab');
    };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(r.data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      return { md5: createHash('md5').update(buf).digest('hex'), bytes: buf.length };
    };

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded, sleep(8000)]); await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'the Shaper to load');
    await openMode('design'); await waitForApp('design-canvas'); await waitFor(`!!window.__designController && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'the Shaper Design tab to show');
    const fileNode = async () => { let q = { nodeId: 0 }; for (let i = 0; i < 10 && !q.nodeId; i++) { const doc = await send('DOM.getDocument', { depth: -1 }); q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]:not(#file)' }); if (!q.nodeId) await sleep(400); } assert(q.nodeId, 'the import file input exists'); return q.nodeId; };
    const importFile = async (file) => { // clear the status line, import, wait for the app to write the import's result into it (the import reads and parses the file asynchronously)
      await evalJs(`(document.getElementById('group-status') || {}).textContent = ''`);
      await send('DOM.setFileInputFiles', { nodeId: await fileNode(), files: [file] });
      await waitFor(`!!document.getElementById('group-status') && document.getElementById('group-status').textContent !== ''`, 'the import result in #group-status');
      return evalJs(`document.getElementById('group-status').textContent`); };
    // the ONE entry is labelled SVG / DXF and accepts both
    assert.strictEqual(await evalJs(`document.getElementById('svg-import-btn').textContent`), '\u2b07 Import SVG / DXF');
    assert.match(await evalJs(`document.querySelector('input[type=file]:not(#file)').accept`), /\.dxf/);

    // a malformed DXF: a readable status, no exception
    const bad = path.join(os.tmpdir(), 'sk-478-bad.dxf'); fs.writeFileSync(bad, 'hello world\nthis is not a dxf\n');
    const badStatus = await importFile(bad);
    console.log('malformed:', badStatus);
    assert.match(badStatus, /^Import failed: /, 'a malformed DXF is reported, not thrown');
    assert.strictEqual(await evalJs(`window.__designController.state.shapes.length`), 0, 'and imports nothing');

    // the owner's real Fusion sketch DXF
    const st1 = await importFile(path.join(REPO_ROOT, 'tests', 'fixtures', 'dxf', 'fusion-sketch4.dxf'));
    console.log('dxf status:', st1);
    assert.match(st1, /Imported 26 shapes .* @ inches/); assert.match(st1, /4 construction/); assert.match(st1, /POINT .* x5|POINT .*\u00d75/);
    const kinds = await evalJs(`(() => { const t = {}; for (const s of window.__designController.state.shapes) { const k = s.type + (s.isConstruction ? '*' : ''); t[k] = (t[k] || 0) + 1; } return JSON.stringify(t); })()`);
    assert.deepStrictEqual(JSON.parse(kinds), { line: 20, 'line*': 4, arc: 2 });
    await mouse('mouseMoved', 5, 760); await sleep(300);
    await shot('dxf-design.png');
    await openMode('prepare'); await sleep(900);
    const loops = await evalJs(`(async () => { const { findLoops } = await import('#core/loop-finder.js'); return findLoops(window.__designController.state).map((l) => l.edges.length).join(','); })()`);
    assert.strictEqual(loops, '4,6,6,4', 'four closed loops through shared joints (construction lines do not split them): ' + loops);
    // a closed profile is SELECTABLE in Prepare: click inside the filleted rectangle (DXF -0.99..1.04 in x, 1.21..2.33 in y) -> the cut card appears
    const pt = await evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = 0.02 * 25.4; p.y = -1.85 * 25.4; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    await mouse('mouseMoved', pt.x, pt.y); await mouse('mousePressed', pt.x, pt.y, 1); await mouse('mouseReleased', pt.x, pt.y); await sleep(500);
    assert.strictEqual(await evalJs(`document.querySelector('.cut-type-trigger') && !document.querySelector('.cut-type-trigger').closest('[hidden]')`), true, 'selecting the imported loop shows the cut card');
    await shot('dxf-prepare-selected.png');

    // the Shaper Fusion add-in SVG (arcs): cut types from the grey fills, depths in cm, the compound path = a profile with a hole, real arcs
    await openMode('design'); await sleep(1200);
    const st2 = await importFile(path.join(REPO_ROOT, 'tests', 'fixtures', 'svg', 'fusion-shaper-addin-arcs.svg'));
    console.log('svg status:', st2);
    assert.match(st2, /Imported 39 shapes .* 6 cuts kept/);
    const plan = await evalJs(`(async () => { const p = await import('/apps/shaper/src/cut-plan.js'); return JSON.stringify([...p.CUT_PLAN.entries()].map(([k, r]) => [k.split(':')[0], r.cutType, Math.round(r.cutDepth * 100) / 100]).sort()); })()`);
    assert.deepStrictEqual(JSON.parse(plan), [['loop', 'exterior', 81.28], ['loop', 'pocket', 17.78], ['loop', 'pocket', 17.78], ['loop', 'pocket', 27.94], ['loop', 'pocket', 17.78], ['profile', 'pocket', 5.08]].sort());
    console.log('dxf-import-live: ok');
  } finally {
    await cdp.close();
  }
})();
