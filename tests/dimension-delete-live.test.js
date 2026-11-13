// tests/dimension-delete-live.test.js — TASK 485: deleting a DIMENSION removes only its constraint, never geometry (real pointer + real Delete key + the panel).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser } from './helpers/cdp-browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '485', width: 1400, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, ws, waitFor, waitForApp } = cdp;
  try {
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)); });
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log('PAGE CONSOLE ERROR:', m.params.args.map((a) => a.value || (a.description || '').slice(0, 300)).join(' ')); });
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
    const key = async (k, code, vk, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(350); };
    const counts = () => evalJs(`(() => { const s = window.__designController.state; return JSON.stringify({ shapes: s.shapes.length, joints: s.joints.size, constraints: s.constraints.length, pos: [...s.joints.entries()].map(([k, j]) => k + ':' + Math.round(j.x * 100) / 100 + ',' + Math.round(j.y * 100) / 100).sort().join(' '), selShapes: s.selectedShapes.size, selJoints: s.selectedJoints.size, selCons: s.selectedConstraints.size }); })()`);
    // seed: an L (two lines, 40 + 30), a circle with a radius dim, an arc with a radius dim, a distance dim, an angle dim, a DRIVEN distance dim
    const seed = async () => evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear();
      const J = (id, x, y) => st.joints.set(id, { x, y });
      J('a', -45, -20); J('b', -5, -20); J('c', -5, 10);
      st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] });
      J('cc', 15, 25); J('cr', 23, 25);
      st.shapes.push({ id: 'C1', type: 'circle', joints: ['cc', 'cr'], radius: 8 });
      J('ac', -30, 30); J('as', -20, 30); J('ae', -30, 20);
      st.shapes.push({ id: 'A1', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'] });
      st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 40, glyphPos: { x: -25, y: -30 } });
      st.constraints.push({ type: 'angle', shapes: ['L1', 'L2'], value: 90, glyphPos: { x: -12, y: -10 } });
      st.constraints.push({ type: 'distance', shape: 'C1', value: 8, isRadius: true, glyphPos: { x: 15, y: 10 } });
      st.constraints.push({ type: 'distance', shape: 'A1', value: 10, isRadius: true, glyphPos: { x: -25, y: 25 } });
      st.constraints.push({ type: 'distance', joints: ['b', 'c'], value: 30, isDriven: true, glyphPos: { x: 8, y: -5 } });
      J('p1', -45, -40); J('p2', -20, -40); // two STANDALONE points (no shape) held only by their distance dimension
      st.constraints.push({ type: 'distance', joints: ['p1', 'p2'], value: 25, glyphPos: { x: -32, y: -43 } });
      if (window.__designController.render) window.__designController.render();
      return st.constraints.length;
    })()`);
    const W2S = (x, y) => evalJs(`(() => { const s = document.getElementById('design-canvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const click = async (pt, shift = false) => { await mouse('mouseMoved', pt.x, pt.y); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1, modifiers: shift ? 8 : 0 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1, modifiers: shift ? 8 : 0 }); await sleep(700); };
    const labelPt = async (idx) => { const r = await evalJs(`(() => { const e = document.querySelector('#design-canvas .dim-label[data-constraint-idx="${idx}"]'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`); assert(r, 'dim label ' + idx + ' is on screen'); return r; };
    const KINDS = ['distance (two points)', 'angle (two lines)', 'radius (circle)', 'radius (arc)', 'driven / reference distance', 'distance (two standalone points)'];
    const GEO = { L2: [-5, -5] }; // a point ON line L2 (world mm)
    const jc = (c) => JSON.parse(c);
    // the panel groups rows by type under a collapsed sketch node: expand it (real click), then find the row of constraint i
    const expandPanel = async () => { const c = await evalJs(`(() => { const t = document.querySelector('#design-panel-info .sk-sketch-tw'); if (!t || t.textContent !== '▸') return null; const b = t.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`); if (c) { await click(c); } };
    const panelRow = async (i) => {
      const r = await evalJs(`(() => {
        const s = window.__designController.state; const find = () => [...document.querySelectorAll('#design-panel-info .sk-info-row')];
        const n = find().length; let hit = -1;
        for (let j = 0; j < n; j++) { s.selectedConstraints.clear(); find()[j].click(); if (s.selectedConstraints.has(s.constraints[${i}])) { hit = j; break; } }
        s.selectedConstraints.clear(); s.selectedShapes.clear(); s.selectedJoints.clear();
        if (hit < 0) return null; const b = find()[hit].getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), n };
      })()`);
      assert(r, 'panel row for constraint ' + i + ' exists'); return r;
    };
    await seed(); await sleep(600); await expandPanel(); await sleep(400);
    const base = jc(await counts());
    console.log('seeded', JSON.stringify({ shapes: base.shapes, joints: base.joints, constraints: base.constraints }));
    // after a delete the geometry (count AND positions) is exactly as seeded and the constraint count dropped by exactly one
    const onlyTheDimension = (c, msg) => {
      assert.strictEqual(c.shapes, base.shapes, msg + ': no shape removed'); assert.strictEqual(c.joints, base.joints, msg + ': no joint removed');
      assert.strictEqual(c.pos, base.pos, msg + ': no joint moved'); assert.strictEqual(c.constraints, base.constraints - 1, msg + ': exactly one constraint removed');
    };
    for (let i = 0; i < KINDS.length; i++) {
      const K = KINDS[i];
      // A: the dimension label alone: real click + real Delete key
      await seed(); await sleep(500);
      await click(await labelPt(i)); assert.strictEqual(jc(await counts()).selCons, 1, K + ': the label click selects the dimension');
      await key('Delete', 'Delete', 46);
      onlyTheDimension(jc(await counts()), K + ' / label + Delete');
      // D: Undo restores the dimension in ONE step (the geometry is untouched)
      await key('z', 'KeyZ', 90, 2);
      const undone = jc(await counts());
      assert.strictEqual(undone.constraints, base.constraints, K + ': one Ctrl+Z gives the dimension back'); assert.strictEqual(undone.shapes, base.shapes); assert.strictEqual(undone.pos, base.pos);
      // B: a line selected FIRST, then the dimension label clicked: the line must NOT stay selected, so Delete removes only the dimension
      await seed(); await sleep(500);
      await click(await W2S(...GEO.L2)); assert.strictEqual(jc(await counts()).selShapes, 1, K + ': the line is selected');
      await click(await labelPt(i));
      const mid = jc(await counts()); assert.strictEqual(mid.selShapes, 0, K + ': clicking a dimension drops the earlier geometry selection'); assert.strictEqual(mid.selCons, 1);
      await key('Delete', 'Delete', 46);
      onlyTheDimension(jc(await counts()), K + ' / line then label + Delete');
      // C: the Design panel list: a line selected first, then the constraint's ROW clicked, then Delete
      await seed(); await sleep(500);
      const rowPt = await panelRow(i); // (found BEFORE the line is selected: the lookup clears the selection sets)
      await click(await W2S(...GEO.L2)); assert.strictEqual(jc(await counts()).selShapes, 1, K + ': the line is selected');
      await click(rowPt);
      const pm = jc(await counts()); assert.strictEqual(pm.selShapes, 0, K + ': picking the row drops the geometry selection'); assert.strictEqual(pm.selCons, 1);
      await key('Delete', 'Delete', 46);
      onlyTheDimension(jc(await counts()), K + ' / panel row + Delete');
      console.log('ok:', K);
    }
    // E: a MIXED selection (line + dimension, Shift-click) removes both: that part is intended
    await seed(); await sleep(500);
    await click(await W2S(...GEO.L2)); await click(await labelPt(0), true);
    const mixed = jc(await counts()); assert.strictEqual(mixed.selShapes, 1); assert.strictEqual(mixed.selCons, 1, 'Shift extends the selection');
    await key('Delete', 'Delete', 46);
    const after = jc(await counts());
    assert.strictEqual(after.shapes, base.shapes - 1, 'the selected line is removed with it'); assert.ok(after.constraints <= base.constraints - 1);
    console.log('dimension-delete-live: ok');
  } finally {
    await cdp.close();
  }
})();
