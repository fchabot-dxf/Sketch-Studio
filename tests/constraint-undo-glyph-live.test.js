// tests/constraint-undo-glyph-live.test.js -- TASK 571 live (SketchStudio, headless browser, REAL pointer events and keys).
// BUG 1: a constraint made by a constraint tool (parallel, coincident, tangent) is ONE undo step: one Ctrl+Z removes only the constraint and
//        puts the joints back; Ctrl+Y brings it back; the next Ctrl+Z removes the drawn element.
// BUG 2: right-click on a constraint glyph that sits over geometry opens the CONSTRAINT menu (Delete constraint); right-click on the line
//        away from the glyph opens the line's menu (Lock / Delete).
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';

const h = await launchBrowser({ tag: '571', width: 1600, height: 900 });
if (!h) { console.log('skipped: no headless Edge/Chrome binary installed'); } else {
  let failed = null;
  try {
    const { send, evalJs, navigate, port } = h;
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const canvas = 'svgCanvas';
    const mouse = (type, x, y, buttons = 0, button = null) => send('Input.dispatchMouseEvent', { type, x, y, button: button || ((buttons || type === 'mouseReleased') ? 'left' : 'none'), buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(60); };
    const click = async (p) => { await move(p.x, p.y); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(180); };
    const rightClick = async (p) => { await move(p.x, p.y); await mouse('mousePressed', p.x, p.y, 2, 'right'); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 'right'); await sleep(250); };
    const key = async (k, code, vk, mod = 0) => { await sendRealKey(send, k, code, vk, mod); await sleep(250); };
    const esc = () => key('Escape', 'Escape', 27);
    const tool = async (name) => { await evalJs(`document.getElementById('tool-${name}').click()`); await sleep(200); };
    const menuIds = () => evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].map(e => e.dataset.id)`);
    const storedDoc = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-projects', 1); open.onerror = () => res(null);
      open.onsuccess = () => { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { if (!m.result) { res(null); return; } const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null); }; }; };
    })`).then((s) => s && JSON.parse(s));
    const waitSaved = async () => { await sleep(300); for (let i = 0; i < 40; i++) { if (await evalJs(`document.getElementById('save-status').textContent === 'Saved'`)) { await sleep(200); return; } await sleep(200); } };
    const readDoc = async () => { await sleep(1800); await waitSaved(); return storedDoc(); };
    const cons = (d, type) => d.constraints.filter((c) => c.type === type);
    const joints = (d) => JSON.stringify(d.joints.map((e) => (Array.isArray(e) ? [e[0], +e[1].x.toFixed(6), +e[1].y.toFixed(6)] : [e.id, +e.x.toFixed(6), +e.y.toFixed(6)])).sort());

    await navigate(url); await sleep(2500);
    await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
    await navigate(url); await sleep(2500);
    await evalJs(CREATE_NAMED_DESIGN('sketchstudio')); // only a NAMED design autosaves (the test reads the autosave)
    await navigate(url); await sleep(2500);
    const o = await evalJs(`(() => { const s = document.getElementById('${canvas}'); const p = s.createSVGPoint(); p.x = 0; p.y = 0; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const at = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
    const along = (a, b, t) => ({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) });
    const line = async (a, b) => { await tool('line'); await click(a); await click(b); await esc(); };

    // ---- drawing: two lines for Parallel, two for Coincident, a line and a circle for Tangent (all >= 60 px from the axes)
    const L1a = at(150, -380), L1b = at(450, -380), L2a = at(150, -300), L2b = at(400, -220);
    const Aa = at(150, -160), Ab = at(300, -100), Ba = at(430, -130), Bb = at(570, -70);
    const Ta = at(150, 80), Tb = at(450, 80), Cc = at(300, 160);
    const P1 = at(100, 170), P2 = at(190, 205), Q1 = at(-210, 120), Q2 = at(-130, 170);   // two short lines either side of the Y axis (Symmetric, below)
    await line(L1a, L1b); await line(L2a, L2b); await line(Aa, Ab); await line(Ba, Bb); await line(Ta, Tb); await line(P1, P2); await line(Q1, Q2);
    await tool('circle'); await click(Cc); await click({ x: Cc.x + 45, y: Cc.y }); await esc();
    let d = await readDoc();
    assert.strictEqual(d.shapes.length, 8, 'drawn: 7 lines and a circle: ' + d.shapes.map(s => s.type).join(','));
    const undo = () => key('z', 'KeyZ', 90, 2);
    const redo = () => key('y', 'KeyY', 89, 2);
    const oneStep = async (name, picks, type) => {
      await tool(name);
      const before = await readDoc();
      const n0 = cons(before, type).length;
      for (const p of picks) await click(p);
      await esc(); await tool('select');
      const made = await readDoc();
      assert.strictEqual(cons(made, type).length, n0 + 1, `${name}: one ${type} stored`);
      await undo();
      const un = await readDoc();
      assert.strictEqual(cons(un, type).length, n0, `${name}: ONE Ctrl+Z removes the ${type}`);
      assert.strictEqual(un.shapes.length, before.shapes.length, `${name}: ... and removes no drawn element`);
      assert.strictEqual(joints(un), joints(before), `${name}: ... and puts the joints back where they were`);
      await redo();
      const re = await readDoc();
      assert.strictEqual(cons(re, type).length, n0 + 1, `${name}: Ctrl+Y brings it back`);
      assert.strictEqual(joints(re), joints(made), `${name}: ... with the same positions`);
      console.log(`LIVE ${name}: one undo step ok`);
    };
    await oneStep('parallel', [along(L1a, L1b, 0.5), along(L2a, L2b, 0.5)], 'parallel');
    await oneStep('coincident', [Ab, Ba], 'coincident');
    const tangent0 = cons(await readDoc(), 'tangent').length;
    await oneStep('tangent', [along(Ta, Tb, 0.2), { x: Cc.x + 45, y: Cc.y }], 'tangent');
    // the three constraints are back (redone): three Ctrl+Z remove exactly them, the fourth removes the drawn circle (its own step)
    for (let i = 0; i < 3; i++) await undo();
    d = await readDoc();
    assert.strictEqual(d.shapes.length, 8, 'three Ctrl+Z (tangent, coincident, parallel) removed no drawn element');
    assert.strictEqual(cons(d, 'tangent').length, tangent0, 'the tangent is gone');
    await undo();
    d = await readDoc();
    assert.strictEqual(d.shapes.length, 7, 'the next Ctrl+Z removes the drawn circle (a drawn element is its own step)');
    for (let i = 0; i < 4; i++) await redo();
    d = await readDoc();
    assert.strictEqual(d.shapes.length, 8, 'four Ctrl+Y bring the circle and the three constraints back');

    // ---- BUG 2: the Symmetric tool (two points about the Y axis) draws a glyph beside each point; the one by P1 lies ON its own line P1-P2
    await tool('symmetric'); await click(P1); await click(Q1); await click(at(3, 60)); await esc(); await tool('select');
    await move(at(700, -430).x, at(700, -430).y); await sleep(300);
    const gs = await evalJs(`[...document.querySelectorAll('#${canvas} .constraint-glyph[data-ctype="symmetric"]')].map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })`);
    assert.strictEqual(gs.length, 2, 'two symmetric glyphs');
    const segDist = (p, a, b) => { const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2))); return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))); };
    const g = gs.slice().sort((u, v) => segDist(u, P1, P2) - segDist(v, P1, P2))[0];
    console.log(`glyph at ${g.x},${g.y}; ${segDist(g, P1, P2).toFixed(1)} px from its line P1-P2`);
    assert.ok(segDist(g, P1, P2) < 20, 'a symmetric glyph sits within the line pick reach (20 px) of its line P1-P2: geometry under it');
    await rightClick(g);
    assert.deepStrictEqual(await menuIds(), ['con-delete'], 'right-click on the glyph over its line: the constraint menu (Delete constraint)');
    await esc();
    assert.deepStrictEqual(await menuIds(), [], 'Escape closes it');
    await rightClick(along(P1, P2, Math.hypot(g.x - P1.x, g.y - P1.y) < Math.hypot(g.x - P2.x, g.y - P2.y) ? 0.9 : 0.1));
    assert.deepStrictEqual(await menuIds(), ['geo-lock', 'geo-delete'], 'right-click on the line away from the glyph: the line menu');
    await esc();
    // a pointer NEAR the glyph but not on its badge (a point of the line 24 px from the glyph centre; the badge is 16 px + 3 px margin) keeps the line menu
    const ux = (P2.x - P1.x) / Math.hypot(P2.x - P1.x, P2.y - P1.y), uy = (P2.y - P1.y) / Math.hypot(P2.x - P1.x, P2.y - P1.y);
    const t0 = (g.x - P1.x) * ux + (g.y - P1.y) * uy, dLine = segDist(g, P1, P2), dt = Math.sqrt(24 * 24 - dLine * dLine);
    const nearPt = [t0 + dt, t0 - dt].map((t) => ({ x: Math.round(P1.x + ux * t), y: Math.round(P1.y + uy * t) })).find((q) => segDist(q, P1, P2) < 1 && Math.hypot(q.x - g.x, q.y - g.y) > 22);
    assert.ok(nearPt, 'a point of the line 24 px from the glyph');
    await rightClick(nearPt);
    assert.deepStrictEqual(await menuIds(), ['geo-lock', 'geo-delete'], `mouse: right-click on the line ${Math.hypot(nearPt.x - g.x, nearPt.y - g.y).toFixed(1)} px from the glyph centre opens the line menu`);
    await esc();
    // the same by touch and hold (the finger on the glyph: its menu; the finger on the line beside it: the line's)
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const hold = async (p) => { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }); await sleep(800); const ids = await menuIds(); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300); return ids; };
    assert.deepStrictEqual(await hold(g), ['con-delete'], 'touch hold on the glyph: the constraint menu');
    await esc();
    assert.deepStrictEqual(await hold(nearPt), ['geo-lock', 'geo-delete'], 'touch hold on the line beside the glyph: the line menu');
    await esc();
    console.log('LIVE glyph over geometry: right-click picks the glyph, the line away from it keeps the line menu');
    console.log('constraint-undo-glyph-live: ok');
  } catch (e) { failed = e; } finally {
    await h.close();
  }
  if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
}
