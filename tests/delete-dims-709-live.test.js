// tests/delete-dims-709-live.test.js -- TASK 709 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// Deleting geometry deletes its dimensions (owner turn 1896; Fusion: a deleted curve or point takes every dimension on it, and its parameter):
// a line L with its length d1 and the angle d2 to a line K, a line M with its length d3 (the survivor). Three ways to delete L:
//   A. its END POINT picked, then Delete (the Delete key with the mouse, the footer's red X with a finger): TASK 1044 THE POINT RULE (owner
//      2026-11-27, Fusion): a curve's point is never deleted: NOTHING goes (no undo step, L, d1, d2 stay) and the hint shows
//   B. the Trim tool on L (no crossing: the whole line goes)
//   C. the line itself picked, then Delete
// After each: L is gone, the labels of d1 and d2 are gone from the canvas, their rows are gone from the Parameters window (the footer fx button),
// d3's label and row stay; ONE undo step (Ctrl+Z / the footer Undo) brings L, both labels and both rows back.
// The drawing is made by the tools' own operations (#core/tool-ops.js) in the page; the deletes and the undo are real pointer / key input.
// Run twice: desktop 1600x900 with the mouse, phone 390x844 with a finger (resetBufferLive before each phase). Screenshots: .evidence/709.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '709');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '709', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const key = async (k, code, vk, mods = 0, text = '') => { await sendRealKey(send, k, code, vk, mods, text); await sleep(250); };
    const ctrlZ = () => key('z', 'KeyZ', 90, 2);
    const del = () => key('Delete', 'Delete', 46);
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const pointers = {
      mouse: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(80); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(300); },
      touch: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(350); },
    };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`);
    const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('#design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const q = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const hist = () => evalJs(`${STATE}.history.length`);
    // the canvas labels and the Parameters window rows, by dimension name
    const labels = () => evalJs(`JSON.stringify((() => { const s = ${STATE}; const out = {}; for (const n of ['d1', 'd2', 'd3']) { const i = s.constraints.findIndex((c) => c.name === n); const e = i < 0 ? null : document.querySelector('#design-canvas .dim-label[data-constraint-idx="' + i + '"]'); out[n] = e ? e.textContent.trim() : null; } return out; })())`).then(JSON.parse);
    const W = '.sk-pwin';
    const winOpen = () => evalJs(`(() => { const e = document.querySelector('${W}'); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; })()`);
    const tableRows = () => evalJs(`JSON.stringify([...document.querySelectorAll('${W} tr.pt-dim')].map((r) => r.dataset.name))`).then(JSON.parse);
    const hasL = () => evalJs(`${STATE}.shapes.some((s) => s.id === window.__t709.L)`);

    const run = async (kind) => {
      const tap = pointers[kind];
      const out = (s) => console.log(`[${kind}] ${s}`);
      await resetBufferLive(cdp); // the four apps share one tab list (task 684): each phase starts on a clean Untitled
      if (kind === 'touch') {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 10000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, `[${kind}] the stage button`);
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE} && ${STATE}.shapes.length === 0`, `[${kind}] an empty design canvas`);
      await sleep(400);
      const press = async (sel) => { const c = await centerOf(sel); assert(c, `[${kind}] ${sel} is on screen`); await tap(c); };
      // the drawing, by the tools' own operations (world mm, Y down): L with its length d1 and the angle d2 to K; M with its length d3
      await evalJs(`import('/packages/core/tool-ops.js').then((ops) => { const st = ${STATE};
        const ln = (x1, y1, x2, y2) => ops.polyline(st, [[x1, y1], [x2, y2]], false)[0];
        const L = ln(0, 0, 60, 0), K = ln(0, -10, 40, -50), M = ln(0, 40, 50, 40);
        ops.dimension(st, { joints: [L.a, L.b] }, { x: 30, y: 8 }, '60');
        ops.dimension(st, { lines: [L.id, K.id] }, { x: 22, y: -9 }, '45');
        ops.dimension(st, { joints: [M.a, M.b] }, { x: 25, y: 48 }, '50');
        st.engine.solve(200); window.__t709 = { L: L.id, b: L.b }; })`);
      await press('#btn-recenter-view'); await sleep(500);
      const tool = async (id) => { await evalJs(`document.querySelector('#${id}').click()`); await sleep(200); };
      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight - Math.max(0, r.top)) }; })()`);
      const ALL = { d1: '60', d2: '45°', d3: '50' };
      const labelsAll = async (what) => {
        const l = await labels();
        assert.ok(l.d1 && l.d1.startsWith('60') && l.d2 && l.d2.startsWith('45') && l.d3 && l.d3.startsWith('50'), `[${kind}] ${what}: the three labels are on the canvas ${JSON.stringify(l)} (${JSON.stringify(ALL)})`);
      };
      // the Parameters window: opened by the footer fx button, read, closed again (on a phone the sheet covers the canvas)
      const rowsNow = async (file) => {
        if (!(await winOpen())) await press('#btn-parameters');
        await waitFor(`(() => { const e = document.querySelector('${W}'); return !!e && !e.hidden; })()`, `[${kind}] the Parameters window`);
        await sleep(200);
        const r = await tableRows();
        if (file) await shot(file, await evalJs(`(() => { const r = document.querySelector('${W}').getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, innerWidth - Math.max(0, r.left)), height: Math.min(r.height, innerHeight - Math.max(0, r.top)) }; })()`));
        await press('#btn-parameters'); await sleep(200);
        assert.ok(!(await winOpen()), `[${kind}] the fx button closes the window`);
        return r;
      };
      const checkGone = async (how, tableShot) => {
        assert.strictEqual(await hasL(), false, `[${kind}] ${how}: L is deleted`);
        const l = await labels();
        assert.deepStrictEqual({ d1: l.d1, d2: l.d2 }, { d1: null, d2: null }, `[${kind}] ${how}: no label of d1 (its length) nor d2 (its angle) on the canvas`);
        assert.ok(l.d3 && l.d3.startsWith('50'), `[${kind}] ${how}: d3 (on M, which stays) keeps its label: ${l.d3}`);
        assert.deepStrictEqual(await rowsNow(tableShot), ['d3'], `[${kind}] ${how}: the Parameters window lists only d3`);
        assert.deepStrictEqual(await evalJs(`JSON.stringify(${STATE}.constraints.filter((c) => c.name).map((c) => c.name))`).then(JSON.parse), ['d3'], `[${kind}] ${how}: d1 and d2 are deleted with L`);
      };
      const undoAndCheck = async (how, h0) => {
        if (kind === 'mouse') await ctrlZ(); else await press('#btn-undo');
        await sleep(400);
        assert.strictEqual(await hasL(), true, `[${kind}] ${how}: one ${kind === 'mouse' ? 'Ctrl+Z' : 'footer Undo'} brings L back`);
        await labelsAll(`${how}, undone`);
        assert.deepStrictEqual(await rowsNow(how === 'A' ? `${kind}-3-table-after-undo.png` : undefined), ['d1', 'd2', 'd3'], `[${kind}] ${how}, undone: the rows d1, d2 are back`);
        assert.strictEqual(await hist(), h0, `[${kind}] ${how}: it was ONE undo step`);
      };

      await labelsAll('before');
      assert.deepStrictEqual(await rowsNow(`${kind}-1-table-before.png`), ['d1', 'd2', 'd3'], `[${kind}] before: the rows d1, d2, d3`);
      await shot(`${kind}-1-canvas-before.png`, cr);
      const h0 = await hist();

      // ---- A. L's end point picked, then Delete
      await tool('tool-select');
      const b = await evalJs(`JSON.stringify(${STATE}.joints.get(window.__t709.b))`).then(JSON.parse);
      await tap(await toScreen(b.x, b.y));
      assert.deepStrictEqual(await evalJs(`JSON.stringify([...${STATE}.selectedJoints])`).then(JSON.parse), [await evalJs('window.__t709.b')], `[${kind}] A: the tap picks L's end point`);
      await evalJs(`(() => { const c = document.getElementById('notification-container'); if (c) c.innerHTML = ''; return true; })()`);
      if (kind === 'mouse') await del(); else await press('#btn-delete-selection');
      await sleep(300);
      assert.strictEqual(await hist(), h0, `[${kind}] A: the point rule: no undo step`);
      assert.strictEqual(await hasL(), true, `[${kind}] A: the point rule: L stays`);
      await labelsAll('A (end point + Delete: the point rule)');
      assert.deepStrictEqual(await rowsNow(`${kind}-2-table-after-point-delete.png`), ['d1', 'd2', 'd3'], `[${kind}] A: the point rule: the rows d1, d2, d3 stay`);
      const hintA = await evalJs(`(document.getElementById('notification-container') || { textContent: '' }).textContent`);
      assert.ok(hintA.includes('Select the line to delete it, or the corner mark to separate.'), `[${kind}] A: the point rule's hint shows (${hintA})`);
      await shot(`${kind}-2-canvas-after-point-delete.png`, cr);
      out('A: end point + Delete -> NOTHING deleted (the point rule), the hint shows');

      // ---- B. the Trim tool on L
      await tool('tool-trim');
      await tap(await toScreen(45, 0));
      await tool('tool-select');
      assert.strictEqual(await hist(), h0 + 1, `[${kind}] B: one undo step`);
      await checkGone('B (Trim)');
      await shot(`${kind}-4-canvas-after-trim.png`, cr);
      out('B: Trim -> L, d1, d2 gone; d3 stays');
      await undoAndCheck('B', h0);

      // ---- C. the line itself picked, then Delete
      await tap(await toScreen(45, 0));
      assert.deepStrictEqual(await evalJs(`JSON.stringify([...${STATE}.selectedShapes])`).then(JSON.parse), [await evalJs('window.__t709.L')], `[${kind}] C: the tap picks L`);
      if (kind === 'mouse') await del(); else await press('#btn-delete-selection');
      await sleep(300);
      await checkGone('C (line + Delete)');
      out('C: line + Delete -> L, d1, d2 gone; d3 stays');
      await undoAndCheck('C', h0);

      // ---- D. O10 (owner ruling 1905, like Fusion): d3 reads d1 (`d1 - 10` typed in d3's Expression cell of the Parameters window); L deleted:
      // d1 stays as a VALUE, a user parameter row "dimension deleted" (60.0), d3 still 50 with no error; one undo gives the real d1 back
      const prow = (name) => `${W} tr.sk-ptable-row[data-name="${name}"]`;
      const cellIn = (name, col) => `${prow(name)} input[data-col="${col}"]`;
      await press('#btn-parameters');
      await waitFor(`!!document.querySelector(${JSON.stringify(cellIn('d3', 'expression'))})`, `[${kind}] D: d3's Expression cell`);
      await press(cellIn('d3', 'expression'));
      await evalJs(`(() => { const i = document.querySelector(${JSON.stringify(cellIn('d3', 'expression'))}); i.focus(); i.select(); })()`);
      for (const ch of 'd1 - 10') {
        const [code, vk] = /[a-z]/i.test(ch) ? ['Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0)] : /\d/.test(ch) ? ['Digit' + ch, ch.charCodeAt(0)] : ch === '-' ? ['Minus', 189] : ['Space', 32];
        await sendRealKey(send, ch, code, vk, 0, ch); await sleep(20);
      }
      await key('Enter', 'Enter', 13, 0, '\r'); await sleep(400);
      assert.strictEqual(await evalJs(`${STATE}.constraints.find((c) => c.name === 'd3').expression`), 'd1 - 10 mm', `[${kind}] D: d3 = d1 - 10 mm (the stored form carries its unit)`);
      await evalJs(`document.activeElement && document.activeElement.blur()`);
      await press('#btn-parameters'); await sleep(200);
      const hD = await hist();
      await tap(await toScreen(45, 0));
      if (kind === 'mouse') await del(); else await press('#btn-delete-selection');
      await sleep(400);
      assert.strictEqual(await hasL(), false, `[${kind}] D: L is deleted`);
      assert.deepStrictEqual(await evalJs(`JSON.stringify(${STATE}.parameters)`).then(JSON.parse), [{ name: 'd1', unit: 'mm', expression: '60 mm', comment: 'dimension deleted', deletedDimension: true }], `[${kind}] D: d1 is kept as a value`);
      const l3 = (await labels()).d3;
      assert.ok(l3 && l3.includes('50'), `[${kind}] D: d3 still reads 50 on the canvas: ${l3}`);
      await press('#btn-parameters');
      await waitFor(`!!document.querySelector(${JSON.stringify(prow('d1'))})`, `[${kind}] D: the kept d1 row`);
      await sleep(200);
      const keptRow = await evalJs(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(prow('d1'))}); const msg = r.nextElementSibling; return { user: r.classList.contains('pt-user'), value: r.querySelector('td.pt-val').textContent, expression: r.querySelector('input[data-col="expression"]').value, comment: r.querySelector('input[data-col="comment"]').value, error: !!(msg && msg.classList.contains('pt-msg-err')) }; })())`).then(JSON.parse);
      assert.deepStrictEqual(keptRow, { user: true, value: '60', expression: '60 mm', comment: 'dimension deleted', error: false }, `[${kind}] D: the Parameters window lists d1 = 60 mm · dimension deleted`);
      assert.deepStrictEqual(await tableRows(), ['d3'], `[${kind}] D: the sketch dimensions are only d3`);
      await shot(`${kind}-5-table-kept-d1.png`, await evalJs(`(() => { const r = document.querySelector('${W}').getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, innerWidth - Math.max(0, r.left)), height: Math.min(r.height, innerHeight - Math.max(0, r.top)) }; })()`));
      await press('#btn-parameters'); await sleep(200);
      if (kind === 'mouse') await ctrlZ(); else await press('#btn-undo');
      await sleep(400);
      assert.strictEqual(await hist(), hD, `[${kind}] D: the delete was ONE undo step`);
      assert.deepStrictEqual(await evalJs(`JSON.stringify(${STATE}.parameters)`).then(JSON.parse), [], `[${kind}] D: undone, no kept value`);
      assert.deepStrictEqual(await rowsNow(), ['d1', 'd2', 'd3'], `[${kind}] D: undone, the real dimension d1 is back`);
      out('D: d3 = d1 - 10, L deleted -> d1 kept as 60 mm (dimension deleted), d3 still 50; undo -> the real d1');
      out('all checks passed');
    };

    await run('mouse');
    await run('touch');
    console.log('delete-dims-709-live.test.js: ok');
  } finally { await cdp.close(); }
})();
