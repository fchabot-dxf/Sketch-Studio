// tests/symmetric-live-runner.js -- TASK 563 live (headless browser through tests/helpers/cdp-browser.js, REAL pointer events and keys). NOT a test
// file: symmetric-live-sketchstudio.test.js / symmetric-live-shaper.test.js set HOST and import it (the gate runs each *.test.js under 90 s).
// In the app: draw a vertical sketch line S, two lines, two circles and two short lines; with the ribbon's Symmetric tool pick
//   line 1, line 2, then S            -> the end pairs mirror across S
//   circle 1, circle 2, then S        -> centres mirror, radii equal
//   a point, a point, then the Y axis -> mirror across the axis; the axis lights up ONLY at the third pick
// then: 6 glyphs (two per constraint) on the canvas, a cropped screenshot of them; Ctrl+Z removes the last one in ONE step and Ctrl+Y brings it
// back; SketchStudio: a right-click on a symmetric glyph offers "Delete constraint", which deletes it.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

const HOST = process.env.HOST || 'sketchstudio';
const h = await launchBrowser({ tag: 'sym-' + HOST, width: 1600, height: 900 });
if (!h) { console.log('skipped: no headless Edge/Chrome binary installed'); } else {
  let failed = null;
  try {
    const { send, evalJs, navigate, port } = h;
    const origin = `http://127.0.0.1:${port}`;
    const canvas = HOST === 'shaper' ? 'design-canvas' : 'svgCanvas';
    const url = `${origin}/apps/${HOST}/index.html`;
    const mouse = (type, x, y, buttons = 0, button = null) => send('Input.dispatchMouseEvent', { type, x, y, button: button || ((buttons || type === 'mouseReleased') ? 'left' : 'none'), buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(60); };
    const onCanvas = (x, y) => evalJs(`(() => { const e = document.elementFromPoint(${x}, ${y}); return !!(e && e.closest && e.closest('#${canvas}')); })()`);
    const click = async (p) => { assert(await onCanvas(p.x, p.y), `the click at ${p.x},${p.y} is on the canvas`); await move(p.x, p.y); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(180); };
    const rightClick = async (p) => { await move(p.x, p.y); await mouse('mousePressed', p.x, p.y, 2, 'right'); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 'right'); await sleep(250); };
    const key = async (k, code, vk, mod = 0) => { await sendRealKey(send, k, code, vk, mod); await sleep(200); };
    const esc = () => key('Escape', 'Escape', 27);
    const tool = async (name) => { await evalJs(`document.getElementById('tool-${name}').click()`); await sleep(200); };
    const litAxis = (axis) => evalJs(`document.querySelectorAll('[data-ref-axis="${axis}"]').length`);
    const glyphCount = () => evalJs(`document.querySelectorAll('#${canvas} .constraint-glyph[data-ctype="symmetric"]').length`);
    const storedDoc = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-projects', 1); open.onerror = () => res(null);
      open.onsuccess = () => { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { if (!m.result) { res(null); return; } const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null); }; }; };
    })`).then((s) => s && JSON.parse(s));
    const waitSaved = async () => { await sleep(300); for (let i = 0; i < 40; i++) { if (await evalJs(`document.getElementById('save-status').textContent === 'Saved'`)) { await sleep(200); return; } await sleep(200); } };
    // the live document: Shaper exposes its state (the existing test hook window.__designController); SketchStudio is read from its autosaved store
    const readDoc = async () => {
      if (HOST === 'shaper') return JSON.parse(await evalJs(`(() => { const s = window.__designController.state; return JSON.stringify({ shapes: s.shapes, constraints: s.constraints.map(({ glyphPos, __pos, __visible, ...r }) => r), joints: [...s.joints.entries()] }); })()`));
      await sleep(1800); await waitSaved(); return storedDoc();
    };

    // ---- open the app on an empty design
    await navigate(url); await sleep(2500);
    if (HOST === 'shaper') {
      for (let i = 0; i < 5; i++) { await evalJs(`document.querySelector('[data-mode="design"]').click()`); await sleep(500); if (await evalJs(`!!window.__designController`)) break; }
      await sleep(1500);
    } else {
      await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
      await navigate(url); await sleep(2500);
    }
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.getElementById('${canvas}'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const o = await toScreen(0, 0);
    const at = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
    const along = (a, b, t) => ({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) });
    const line = async (a, b) => { await tool('line'); await click(a); await click(b); await esc(); };
    const circle = async (c, r) => { await tool('circle'); await click(c); await click({ x: c.x + r, y: c.y }); await esc(); };

    // ---- the drawing (screen offsets from the origin, all >= 60 px from the axes so no axis snap)
    const S1 = at(330, -300), S2 = at(330, -40);                 // the symmetry line (vertical)
    const A1 = at(390, -270), A2 = at(500, -190);                 // line 1 (right of S)
    const B1 = at(150, -250), B2 = at(250, -150);                 // line 2 (left of S, not yet mirrored)
    const C1 = at(440, -95), C2 = at(190, -110);                  // circle centres
    const P1 = at(120, 120), P2 = at(200, 150), Q1 = at(-210, 190), Q2 = at(-130, 230);   // two short lines either side of the Y axis
    await line(S1, S2); await line(A1, A2); await line(B1, B2);
    await circle(C1, 30); await circle(C2, 45);
    await line(P1, P2); await line(Q1, Q2);
    const d0 = await readDoc();
    assert.strictEqual(d0.shapes.length, 7, 'drawn: 5 lines and 2 circles: ' + d0.shapes.map(s => s.type).join(','));
    const nCons0 = d0.constraints.length;
    assert.ok(await evalJs(`!!document.getElementById('tool-symmetric')`), 'the ribbon has the Symmetric tool (#tool-symmetric)');

    // ---- 1. two lines about the sketch line S
    await tool('symmetric');
    await click(along(A1, A2, 0.5)); await click(along(B1, B2, 0.5)); await click(along(S1, S2, 0.4));
    let d = await readDoc();
    const J = (doc) => Object.fromEntries(doc.joints.map(e => Array.isArray(e) ? e : [e.id, e]));
    const sOf = (doc, type, pred) => doc.shapes.filter(s => s.type === type && (!pred || pred(s)));
    const symAll = (doc) => doc.constraints.filter(c => c.type === 'symmetric');
    const mirror = (X, a, b) => { const ux = b.x - a.x, uy = b.y - a.y, k = ((X.x - a.x) * ux + (X.y - a.y) * uy) / (ux * ux + uy * uy); return { x: 2 * (a.x + k * ux) - X.x, y: 2 * (a.y + k * uy) - X.y }; };
    const near = (p, q, tol = 1e-3) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
    let sym = symAll(d);
    assert.strictEqual(sym.length, 1, 'lines: one symmetric stored: ' + JSON.stringify(d.constraints.slice(nCons0)));
    const lineSym = sym[0];
    const Sline = d.shapes.find(s => s.id === lineSym.line);
    assert.ok(lineSym.shapes && lineSym.shapes.length === 2 && lineSym.joints.length === 4 && Sline && Sline.type === 'line', 'lines form { joints: 4 end pairs, shapes, line: the sketch line }');
    let jm = J(d), sa = jm[Sline.joints[0]], sb = jm[Sline.joints[1]];
    for (let k = 0; k < 4; k += 2) assert.ok(near(jm[lineSym.joints[k + 1]], mirror(jm[lineSym.joints[k]], sa, sb)), `lines: end pair ${k / 2 + 1} mirrored across S`);
    console.log(`LIVE ${HOST} lines about a sketch line ok`);

    // ---- 2. two circles about S
    await click({ x: C1.x + 30, y: C1.y }); await click({ x: C2.x - 45, y: C2.y }); await click(along(S1, S2, 0.6));
    d = await readDoc(); sym = symAll(d);
    const circSym = sym.find(c => c.shapes && !c.joints);
    assert.ok(circSym, 'circles: a symmetric of two circles stored: ' + JSON.stringify(sym));
    jm = J(d); sa = jm[Sline.joints[0]]; sb = jm[Sline.joints[1]];
    const [k1, k2] = circSym.shapes.map(id => d.shapes.find(s => s.id === id));
    assert.ok(near(jm[k2.joints[0]], mirror(jm[k1.joints[0]], sa, sb)) && Math.abs(k1.radius - k2.radius) < 1e-3, `circles: centres mirrored, radii equal (${k1.radius}, ${k2.radius})`);
    console.log(`LIVE ${HOST} circles about a sketch line ok`);

    // ---- 3. two points about the Y axis: the axis is pickable only at the third pick
    await move(at(0, 60).x, at(0, 60).y);
    assert.strictEqual(await litAxis('ref_axis_y'), 0, 'pick 1: the Y axis is not lit under the pointer');
    await click(P1);
    await move(at(0, 60).x, at(0, 60).y);
    assert.strictEqual(await litAxis('ref_axis_y'), 0, 'pick 2: the Y axis is still not lit');
    await click(Q1);
    await move(at(0, 60).x + 3, at(0, 60).y);
    assert.strictEqual(await litAxis('ref_axis_y'), 1, 'pick 3: the Y axis lights up under the pointer');
    await click(at(3, 60));
    d = await readDoc(); sym = symAll(d);
    const ptSym = sym.find(c => c.line === 'ref_axis_y');
    assert.ok(ptSym && ptSym.joints.length === 2 && !ptSym.shapes, 'points about the Y axis stored: ' + JSON.stringify(sym));
    jm = J(d);
    const [pa, pb] = ptSym.joints.map(id => jm[id]);
    assert.ok(Math.abs(pa.x + pb.x) < 1e-3 && Math.abs(pa.y - pb.y) < 1e-3, `points: mirrored across the Y axis (${JSON.stringify(pa)} ${JSON.stringify(pb)})`);
    assert.ok(!d.shapes.some(s => s.reference) && !JSON.stringify(d.joints).includes('j_ref'), 'no axis in the saved shapes / joints');
    console.log(`LIVE ${HOST} points about the Y axis ok`);

    // ---- glyphs: two per constraint; a cropped screenshot of them
    await esc(); await tool('select'); await move(at(620, -330).x, at(620, -330).y); await sleep(300);
    assert.strictEqual(await glyphCount(), 6, 'six symmetric glyphs (two per constraint) on the canvas');
    const EVID = process.env.EVIDENCE_DIR || '';
    if (EVID) {
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: at(-260, -330).x, y: at(-260, -330).y, width: 820, height: 600, scale: 2 } });
      fs.mkdirSync(EVID, { recursive: true });
      const buf = Buffer.from(r.data, 'base64'), file = path.join(EVID, `${HOST}-symmetric-glyphs.png`);
      fs.writeFileSync(file, buf);
      console.log(`screenshot ${file} md5 ${crypto.createHash('md5').update(buf).digest('hex')}`);
    }

    // ---- undo / redo: the last symmetric goes in ONE step and comes back
    await click(at(620, -330));   // focus on an empty spot of the canvas
    await key('z', 'KeyZ', 90, 2);
    d = await readDoc();
    assert.strictEqual(symAll(d).length, 2, 'Ctrl+Z: the last symmetric is gone (one undo step), the two others stay');
    assert.ok(!symAll(d).some(c => c.line === 'ref_axis_y'), 'Ctrl+Z removed the points-about-the-axis one');
    await key('y', 'KeyY', 89, 2);
    d = await readDoc();
    assert.strictEqual(symAll(d).length, 3, 'Ctrl+Y: it is back');
    console.log(`LIVE ${HOST} undo / redo ok`);

    // ---- SketchStudio: right-click a symmetric glyph -> "Delete constraint"
    if (HOST === 'sketchstudio') {
      // the glyph of the LEFT point (Q1): it sits left of Q1, clear of any geometry (a joint or a shape under the pointer wins a right-click, as for
      // every glyph; the right point's glyph lies on its own line)
      const g = await evalJs(`(() => { const r = [...document.querySelectorAll('#${canvas} .constraint-glyph[data-ctype="symmetric"][data-cline="ref_axis_y"]')].map(e => e.getBoundingClientRect()).sort((a, b) => a.x - b.x)[0]; return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
      await rightClick(g);
      const items = await evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].map(e => e.dataset.id)`);
      assert.deepStrictEqual(items, ['con-delete'], 'the symmetric glyph menu: Delete constraint');
      await evalJs(`document.querySelector('.sk-context-menu [data-id="con-delete"]').click()`); await sleep(300);
      d = await readDoc();
      assert.ok(symAll(d).length === 2 && !symAll(d).some(c => c.line === 'ref_axis_y') && d.shapes.length === 7, 'Delete constraint removed that symmetric only');
      console.log('LIVE sketchstudio context menu Delete ok');
    }
    console.log(`symmetric-live ${HOST}: ok`);
  } catch (e) { failed = e; } finally {
    await h.close();
  }
  if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
}
