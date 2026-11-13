// tests/drag-target-release-live.test.js -- TASK 575 in the REAL SketchStudio (headless, REAL mouse and keys via CDP), on the owner's drawing
// (tests/fixtures/drag/owner-two-arcs-575.json: two concentric arcs about the origin, radii 2286 / 2667 dimensioned, two sides collinear with
// construction lines through the origin, a 10 deg angle between them; one DOF left = the rotation about the origin).
//  1. Esc while dragging, then another drag: a drag ended by Esc kept its solver targets (joint.dragTarget) on its joints, and every later
//     solve pulled them back toward that old cursor position: after the NEXT drag (another joint) was released, the drawing rotated back
//     on its own. Now no target outlives its drag: the drawing stays where the second drag left it.
//  2. A drag held past the autosave poll: the stored design held the drag targets (a reload / tab switch / Open put them back). Now the
//     stored document never carries one.
//  3. A side's end (j9, on the construction line through the collinear) dragged along its line toward the origin snaps to the construction
//     line: the sketch already holds the point there, so the snap adds nothing (task 537's rule; it used to add a redundant pointOnLine).
// Geometry is read from the DOM (line ends, joint dots) in world units; the stored design from the project store.
import assert from 'node:assert';
import fs from 'node:fs';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

const DOC = JSON.parse(fs.readFileSync(new URL('./fixtures/drag/owner-two-arcs-575.json', import.meta.url), 'utf8'));
const J2 = 'j2_1794492542145', J3 = 'j3_1794492543360', J9 = 'j9_1794492562388';

await (async () => {
  const cdp = await launchBrowser({ tag: '575' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, navigate, waitForApp, flushAutosave } = cdp;
  const out = [];
  try {
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    // every joint position drawn (joint dots by id, line ends by their shape's joints) in world units, and the canvas transform
    const geo = () => evalJs(`(() => { const o = {}, ls = {}; const m = document.querySelector('#svgCanvas .shape-elem').getScreenCTM();
      for (const e of document.querySelectorAll('#svgCanvas .joint-handle')) o[e.dataset.jointId] = [+e.getAttribute('cx'), +e.getAttribute('cy')];
      for (const e of document.querySelectorAll('#svgCanvas line.shape-elem')) ls[e.dataset.shapeId] = [+e.getAttribute('x1'), +e.getAttribute('y1'), +e.getAttribute('x2'), +e.getAttribute('y2')];
      return JSON.stringify({ o, ls, m: [m.a, m.b, m.c, m.d, m.e, m.f] }); })()`).then(JSON.parse).then((g) => {
      for (const s of DOC.geometry.shapes) if (s.type === 'line' && g.ls[s.id]) { const v = g.ls[s.id]; g.o[s.joints[0]] = g.o[s.joints[0]] || [v[0], v[1]]; g.o[s.joints[1]] = g.o[s.joints[1]] || [v[2], v[3]]; }
      return g; });
    const toS = (g, p) => [g.m[0] * p[0] + g.m[2] * p[1] + g.m[4], g.m[1] * p[0] + g.m[3] * p[1] + g.m[5]];
    const deg = (p) => Math.atan2(p[1], p[0]) * 180 / Math.PI;
    // a stand-in for the joint's position: its cluster shares it (j3 = j14 = j16, j2 = j12 = j19)
    const at = (g, id) => g.o[id] || g.o[{ [J3]: 'j16_1794492606345', [J2]: 'j19_1794492610396' }[id]];
    const tangent = (g, p, px) => { const L = Math.hypot(p[0], p[1]); return [-p[1] / L * px * Math.sign(g.m[0]), p[0] / L * px * Math.sign(g.m[3])]; };
    const stored = async () => { await flushAutosave(); return evalJs(`import('/packages/ui/project-store.js').then(async (m) => JSON.stringify((await m.getProjectStore().loadCurrent()).document))`).then(JSON.parse); };
    const withTarget = (d) => d.geometry.joints.filter(([, j]) => j.dragTarget).map(([id]) => id).concat(d.geometry.shapes.filter((s) => s.dragTarget).map((s) => s.id));
    const frames = (n) => evalJs(`new Promise(r => { let k = ${n}; const f = () => (--k > 0 ? requestAnimationFrame(f) : r(true)); requestAnimationFrame(f); })`);
    const press = async (p) => { await mouse('mouseMoved', p[0], p[1], 0); await sleep(80); await mouse('mousePressed', p[0], p[1], 1); await sleep(80); };
    const pull = async (p, d, steps) => { for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', p[0] + d[0] * i / steps, p[1] + d[1] * i / steps, 1); await sleep(20); } return [p[0] + d[0], p[1] + d[1]]; };

    // the owner's drawing in a NAMED design (task 558: only a named design is stored), reloaded: the app restores and frames it
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`(async () => { localStorage.clear(); localStorage.setItem('sketch-studio-settings', JSON.stringify({ GRID_MAGNETISM: 0.001 })); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); return true; })()`);
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Owner 575', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
    await navigate(url, 8000); await waitForApp('svgCanvas'); await sleep(600);

    // 1. drag the j3 corner 40 px along its circle, Esc with the button held, release; then drag the j2 corner 80 px the other way
    let g = await geo();
    const a0 = deg(at(g, J3));
    let p = toS(g, at(g, J3)); await press(p); let end = await pull(p, tangent(g, at(g, J3), 40), 10);
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(150);
    await mouse('mouseReleased', end[0], end[1], 0); await sleep(300); await frames(5);
    g = await geo();
    const a1 = deg(at(g, J3));
    assert.ok(Math.abs(a1 - a0) > 1, `the first drag rotated the drawing (j3 ${a0.toFixed(3)} -> ${a1.toFixed(3)} deg)`);
    p = toS(g, at(g, J2)); await press(p); end = await pull(p, tangent(g, at(g, J2), -80), 20); await sleep(100); await frames(3);
    g = await geo(); const aHeld = deg(at(g, J3));
    await mouse('mouseReleased', end[0], end[1], 0); await sleep(300); await frames(30); await sleep(1000); await frames(10);
    g = await geo(); const aAfter = deg(at(g, J3));
    out.push(`1. Esc mid-drag (j3 ${a0.toFixed(3)} -> ${a1.toFixed(3)} deg), then the j2 drag: j3 at ${aHeld.toFixed(3)} deg while held, ${aAfter.toFixed(3)} deg 1 s after the release (drift ${(aAfter - aHeld).toFixed(4)} deg)`);
    assert.ok(Math.abs(aHeld - a1) > 1, `the second drag rotated the drawing (j3 ${a1.toFixed(3)} -> ${aHeld.toFixed(3)} deg)`);
    assert.ok(Math.abs(aAfter - aHeld) < 0.01, `after the second drag's release the drawing stays where it was left (j3 ${aHeld.toFixed(4)} -> ${aAfter.toFixed(4)} deg): no target of the Esc-ended drag keeps pulling it back`);
    const d1 = await stored();
    assert.deepStrictEqual(withTarget(d1), [], 'no joint or shape of the stored design carries a drag target');

    // 2. a drag held past the autosave poll: the design stored while it lasts has no drag target
    g = await geo(); p = toS(g, at(g, J3)); await press(p); end = await pull(p, tangent(g, at(g, J3), -30), 6); // away from the Y axis (its snap would add a legitimate pointOnLine)
    await sleep(3200); // longer than the autosave poll (1.5 s): it writes the design while the drag lasts
    const mid = await evalJs(`import('/packages/ui/project-store.js').then(async (m) => JSON.stringify((await m.getProjectStore().loadCurrent()).document))`).then(JSON.parse);
    await mouse('mouseReleased', end[0], end[1], 0); await sleep(300);
    out.push(`2. stored during a held drag: drag targets on [${withTarget(mid).join(' ')}]`);
    assert.deepStrictEqual(withTarget(mid), [], 'the design autosaved during a drag carries no drag target');

    // 3. j9 (the right side's end on the outer arc, held on the right construction line by the collinear) dragged toward the origin along
    //    that line: the cursor runs on the construction line, the snap release must add nothing
    const before = (await stored()).geometry.constraints.length;
    assert.strictEqual(before, DOC.geometry.constraints.length, 'cases 1 and 2 added no constraint: the drawing keeps its one DOF (the rotation) for case 3');
    g = await geo(); const q = at(g, J9), L = Math.hypot(q[0], q[1]);
    p = toS(g, q); await press(p); end = await pull(p, [-q[0] / L * 120 * Math.sign(g.m[0]), -q[1] / L * 120 * Math.sign(g.m[3])], 20);
    await sleep(100); await mouse('mouseReleased', end[0], end[1], 0); await sleep(400);
    const d3 = await stored();
    const added = d3.geometry.constraints.slice(before).map((c) => `${c.type}(${c.joint || (c.joints || []).join(',')} / ${c.shape || (c.shapes || []).join(',')})`);
    out.push(`3. j9 dragged 120 px toward the origin along its line: constraints ${before} -> ${d3.geometry.constraints.length} [${added.join(' ')}]`);
    assert.deepStrictEqual(added, [], 'a snap the sketch already holds adds no constraint');

    console.log(out.join('\n'));
    console.log('drag-target-release-live.test.js: ok');
  } catch (e) { console.log(out.join('\n')); throw e; } finally { await cdp.close(); }
})();
