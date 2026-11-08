// tests/shaper-persist.test.js — TASK 460: Shaper keeps its CUT PLAN (all fields incl. cutterShape) and STOCK across a REAL page reload
// via the host sidecar doc.hosts.shaper; an old document (no sidecar) loads with defaults; a SketchStudio save in between does not
// drop the Shaper sidecar (TASK 458); the export is byte-identical before vs after the reload. Headless Edge, real reload.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '460' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, navigate } = cdp;

  try {
    const key = async (k, code, vk, modifiers = 0, text = '') => { await sendRealKey(send, k, code, vk, modifiers, text); await sleep(200); };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const openMode = async (mode) => {
      await clickEl(`[data-mode="${mode}"]`);
      await waitFor(`document.querySelector('.mode-btn.active').dataset.mode === '${mode}'`, 'the ' + mode + ' tab to open');
    };

    const url = `http://127.0.0.1:${port}/apps/shaper/index.html`;
    const nav = async (u) => { await navigate(u, 8000); await waitFor(`!!document.querySelector('[data-mode], #svgCanvas')`, 'the app to load'); };
    const reload = async () => { const l = once('Page.loadEventFired'); await send('Page.reload'); await Promise.race([l, sleep(8000)]); await waitFor(`!!document.querySelector('[data-mode]')`, 'the app to load after the reload'); };
    // the shared document buffer's stored doc (IndexedDB), polled until `pred` holds: the real "autosave has run" signal
    const idbDoc = `new Promise((res, rej) => { const r = indexedDB.open('sketch-studio-projects', 1); r.onerror = () => rej(r.error); r.onsuccess = () => { try { const db = r.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign'); m.onsuccess = () => { try { const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { db.close(); res(g.result ? g.result.document : null); }; } catch (e) { rej(e); } }; } catch (e) { rej(e); } }; })`;
    const saved = (pred, what) => waitFor(`${idbDoc}.then((d) => !!d && (${pred}))`, what);
    const restored = () => waitFor(`!!window.__designController && window.__designController.state.shapes.length > 0`, 'the document to be restored');
    const planJson = () => evalJs(`(async () => { const { CUT_PLAN } = await import('/apps/shaper/src/cut-plan.js'); return JSON.stringify([...CUT_PLAN.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)); })()`);
    const stockJson = () => evalJs(`(async () => { const m = await import('/apps/shaper/src/stock.js'); return JSON.stringify(m.getStock()); })()`);
    const exportStr = () => evalJs(`(async () => {
      const { exportShaperSVG } = await import('/packages/core/shaper-export.js'); const { CUT_TYPES } = await import('/apps/shaper/src/shaper.js');
      const { cutPlanEntries } = await import('/apps/shaper/src/cut-plan.js'); const { findLoops } = await import('/packages/core/loop-finder.js');
      const { loopPolygon } = await import('/packages/core/loop-geometry.js');
      const st = window.__designController.state; const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {};
      for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by);
      return exportShaperSVG({ state: st, entries: cutPlanEntries(), encoding: CUT_TYPES, docUnit: 'in', options: { groupByCut: true }, loopPolys: lp });
    })()`);
    const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 44, width: 1500, height: 700, scale: 1 } }); if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name + '.png'), Buffer.from(s.data, 'base64')); };

    // ── 1. build a design + cut plan (several types, with cutter shapes) + a non-default stock, then let the autosave run ──
    await nav(url);
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    await evalJs(`(async () => {
      const { findLoops, findOpenChains } = await import('/packages/core/loop-finder.js');
      const { CUT_PLAN, keyOf } = await import('/apps/shaper/src/cut-plan.js');
      const { setStockField } = await import('/apps/shaper/src/stock.js');
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0; CUT_PLAN.clear();
      let n = 0; const J = (x, y) => { const id = 'j' + (++n); st.joints.set(id, { x, y }); return id; };
      const line = (a, b) => st.shapes.push({ id: 's' + (++n), type: 'line', joints: [a, b] });
      const rect = (x, y, w, h) => { const p = [J(x, y), J(x + w, y), J(x + w, y + h), J(x, y + h)]; for (let i = 0; i < 4; i++) line(p[i], p[(i + 1) % 4]); };
      rect(0, 0, 60, 40); rect(80, 0, 40, 40); rect(140, 0, 40, 40); line(J(0, 60), J(40, 60)); line(J(60, 60), J(100, 60));
      const loops = findLoops(st); const chains = findOpenChains(st, loops);
      const L = loops.sort((a, b) => st.joints.get(a.joints[0]).x - st.joints.get(b.joints[0]).x);
      const C = chains.sort((a, b) => st.joints.get(a.shapes[0].joints[0]).x - st.joints.get(b.shapes[0].joints[0]).x);
      CUT_PLAN.set(keyOf('loop', L[0].id), { cutType: 'pocket', cutDepth: 7.62, cutOffset: 1.5, toolDia: 6.35, cutterShape: 'endmill', cutterAngle: 90 });
      CUT_PLAN.set(keyOf('loop', L[1].id), { cutType: 'exterior', cutDepth: 5, cutOffset: 0, toolDia: 3.175, cutterShape: 'ballnose', cutterAngle: 90 });
      CUT_PLAN.set(keyOf('loop', L[2].id), { cutType: 'interior', cutDepth: 'unset', cutOffset: -2, toolDia: 6.35, cutterShape: 'vbit', cutterAngle: 60 });
      CUT_PLAN.set(keyOf('chain', C[0].id), { cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 });
      CUT_PLAN.set(keyOf('chain', C[1].id), { cutType: 'guide', cutDepth: 'unset', cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 });
      setStockField('thickness', 25.4); setStockField('margin', 6);
    })()`);
    await openMode('prepare');
    await waitFor(`document.querySelectorAll('#prepare-canvas .sk-edge').length >= 14`, 'Prepare shows the seeded geometry');
    const planBefore = await planJson(), stockBefore = await stockJson(), exportBefore = await exportStr();
    assert.strictEqual(JSON.parse(planBefore).length, 5, 'five cut records assigned');
    assert.deepStrictEqual(JSON.parse(stockBefore), { thickness: 25.4, width: null, height: null, margin: 6 });
    await shot('before-reload');
    await saved(`d.hosts.shaper && d.hosts.shaper.cutPlan.length === 5 && d.hosts.shaper.stock.thickness === 25.4 && d.hosts.shaper.stock.margin === 6`, 'the autosave to store the cut plan and stock'); // the buffer polls every 1.5 s

    // ── 2. a REAL reload: every record equal, stock round-trips, export byte-identical ──
    await reload();
    await openMode('prepare');
    await restored();
    await shot('after-reload');
    const planAfter = await planJson();
    assert.strictEqual(planAfter, planBefore, 'every cut record is equal after a real page reload (all fields, incl. cutterShape/cutterAngle)');
    assert.strictEqual(await stockJson(), stockBefore, 'the stock round-trips');
    assert.strictEqual(await exportStr(), exportBefore, 'the export is byte-identical before vs after the reload');
    assert.ok(await evalJs(`document.querySelectorAll('#prepare-canvas .sk-edge').length`) >= 14, 'Prepare shows the restored geometry');

    // ── 2b. the Review card's stock-thickness field round-trips through the sidecar (real typing, real reload) ──
    await openMode('review');
    await waitFor(`!!document.getElementById('review-stock-thickness')`, 'the Review stock field');
    assert.strictEqual(await evalJs(`document.getElementById('review-stock-thickness').value`), '1.000', 'the card shows the restored 25.4 mm = 1.000 in');
    await clickEl('#review-stock-thickness');
    await key('a', 'KeyA', 65, 2);
    for (const ch of '1.25') await key(ch, ch === '.' ? 'Period' : 'Digit' + ch, ch === '.' ? 190 : ch.charCodeAt(0), 0, ch);
    await key('Enter', 'Enter', 13);
    await evalJs(`document.getElementById('review-stock-thickness').dispatchEvent(new Event('change', { bubbles: true }))`);
    await waitFor(`import('/apps/shaper/src/stock.js').then((m) => Math.abs(m.getStock().thickness - 31.75) < 1e-9)`, 'the stock thickness to take the typed value');
    const typedStock = JSON.parse(await stockJson());
    assert.ok(Math.abs(typedStock.thickness - 31.75) < 1e-9, 'typing 1.25 in sets the stock thickness to 31.75 mm');
    await saved(`Math.abs(d.hosts.shaper.stock.thickness - 31.75) < 1e-9`, 'the autosave to store the typed thickness');
    await reload();
    await openMode('review');
    await restored();
    await waitFor(`document.getElementById('review-stock-thickness').value === '1.250'`, 'the Review card to show the restored thickness');
    assert.strictEqual(await evalJs(`document.getElementById('review-stock-thickness').value`), '1.250', 'after a real reload the card shows 1.250 in');
    assert.ok(Math.abs(JSON.parse(await stockJson()).thickness - 31.75) < 1e-9, 'and the stock is 31.75 mm');
    // restore the original stock for the remaining steps (planBefore/stockBefore comparisons)
    await evalJs(`(async () => { const m = await import('/apps/shaper/src/stock.js'); m.setStockField('thickness', 25.4); })()`);
    await saved(`d.hosts.shaper.stock.thickness === 25.4`, 'the autosave to store the restored thickness');

    // ── 3. a SketchStudio save in between does NOT drop the Shaper sidecar (TASK 458): draw a line there, let it save, come back ──
    await nav(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`);
    await waitFor(`!!document.getElementById('svgCanvas')`, 'the SketchStudio canvas');
    const box = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76, text: 'l' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
    await click(box.x - 150, box.y + 100); await click(box.x + 150, box.y + 100);
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await saved(`d.geometry.shapes.length > 14`, 'the SketchStudio autosave to store the drawn line');
    await nav(url);
    await openMode('prepare');
    await restored();
    assert.strictEqual(await planJson(), planBefore, 'the cut plan survives a SketchStudio save in between');
    assert.strictEqual(await stockJson(), stockBefore, 'and so does the stock');

    // ── 4. an OLD document (no shaper sidecar) loads with the defaults ──
    await evalJs(`new Promise((res, rej) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction(['meta', 'designs'], 'readwrite');
        const m = tx.objectStore('meta').get('currentDesign');
        m.onsuccess = () => { const g = tx.objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result; delete d.document.hosts.shaper; tx.objectStore('designs').put(d); }; };
        tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
      };
      open.onerror = () => rej(open.error);
    })`);
    await evalJs(`(async () => { const { CUT_PLAN } = await import('/apps/shaper/src/cut-plan.js'); CUT_PLAN.clear(); })()`); // so the autosave cannot re-add it before the reload
    await sleep(100);
    await reload();
    await openMode('prepare');
    await restored();
    assert.strictEqual(await planJson(), '[]', 'an old document (no sidecar) has an empty cut plan');
    assert.deepStrictEqual(JSON.parse(await stockJson()), { thickness: 19.05, width: null, height: null, margin: 12.7 }, 'and the owner-confirmed stock defaults: 3/4 in thick, 1/2 in margin');
    assert.ok(await evalJs(`document.querySelectorAll('#prepare-canvas .sk-edge').length`) >= 14, 'the geometry still loads');
    console.log('shaper-persist: ok');
  } finally {
    await cdp.close();
  }
})();
