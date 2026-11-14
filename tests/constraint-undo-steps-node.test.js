// tests/constraint-undo-steps-node.test.js — TASK 601 (node port of BUG 1 of tests/constraint-undo-glyph-live.test.js, TASK 571): a constraint made by
// a constraint tool (parallel, coincident, tangent) is ONE undo step: one Ctrl+Z removes only the constraint and puts the joints back; Ctrl+Y brings
// it back; the next Ctrl+Z removes the drawn element. SketchStudio through tests/helpers/node-app.js; every document is the stored design after the
// page-hide autosave, as the browser test read it. Same drawing (7 lines and a circle), same picks (screen offsets from the origin), same asserts.
// What stays in the browser (tests/constraint-glyph-menu-live.test.js): BUG 2, the right click and the touch hold on a symmetric glyph over geometry.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio'); // only a NAMED design autosaves (the test reads the autosave)
const app = await open({ host: 'sketchstudio', profile });
try {
  const readDoc = async () => { const d = await app.storedDoc(); return JSON.parse(JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints })); };
  const cons = (d, type) => d.constraints.filter((c) => c.type === type);
  const joints = (d) => JSON.stringify(d.joints.map((e) => (Array.isArray(e) ? [e[0], +e[1].x.toFixed(6), +e[1].y.toFixed(6)] : [e.id, +e.x.toFixed(6), +e.y.toFixed(6)])).sort());
  const o = app.toScreen(0, 0);
  const at = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
  const along = (a, b, t) => ({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) });
  const click = (p) => app.click(p.x, p.y);
  const line = (a, b) => { app.tool('line'); click(a); click(b); app.esc(); };

  // ---- drawing: two lines for Parallel, two for Coincident, a line and a circle for Tangent (all >= 60 px from the axes)
  const L1a = at(150, -380), L1b = at(450, -380), L2a = at(150, -300), L2b = at(400, -220);
  const Aa = at(150, -160), Ab = at(300, -100), Ba = at(430, -130), Bb = at(570, -70);
  const Ta = at(150, 80), Tb = at(450, 80), Cc = at(300, 160);
  const P1 = at(100, 170), P2 = at(190, 205), Q1 = at(-210, 120), Q2 = at(-130, 170);   // two short lines either side of the Y axis (the glyph half uses them)
  line(L1a, L1b); line(L2a, L2b); line(Aa, Ab); line(Ba, Bb); line(Ta, Tb); line(P1, P2); line(Q1, Q2);
  app.tool('circle'); click(Cc); click({ x: Cc.x + 45, y: Cc.y }); app.esc();
  let d = await readDoc();
  assert.strictEqual(d.shapes.length, 8, 'drawn: 7 lines and a circle: ' + d.shapes.map(s => s.type).join(','));
  const undo = () => app.undo();
  const redo = () => app.redo();
  const oneStep = async (name, picks, type) => {
    app.tool(name);
    const before = await readDoc();
    const n0 = cons(before, type).length;
    for (const p of picks) click(p);
    app.esc(); app.tool('select');
    const made = await readDoc();
    assert.strictEqual(cons(made, type).length, n0 + 1, `${name}: one ${type} stored`);
    undo();
    const un = await readDoc();
    assert.strictEqual(cons(un, type).length, n0, `${name}: ONE Ctrl+Z removes the ${type}`);
    assert.strictEqual(un.shapes.length, before.shapes.length, `${name}: ... and removes no drawn element`);
    assert.strictEqual(joints(un), joints(before), `${name}: ... and puts the joints back where they were`);
    redo();
    const re = await readDoc();
    assert.strictEqual(cons(re, type).length, n0 + 1, `${name}: Ctrl+Y brings it back`);
    assert.strictEqual(joints(re), joints(made), `${name}: ... with the same positions`);
    console.log(`NODE ${name}: one undo step ok`);
  };
  await oneStep('parallel', [along(L1a, L1b, 0.5), along(L2a, L2b, 0.5)], 'parallel');
  await oneStep('coincident', [Ab, Ba], 'coincident');
  const tangent0 = cons(await readDoc(), 'tangent').length;
  await oneStep('tangent', [along(Ta, Tb, 0.2), { x: Cc.x + 45, y: Cc.y }], 'tangent');
  // the three constraints are back (redone): three Ctrl+Z remove exactly them, the fourth removes the drawn circle (its own step)
  for (let i = 0; i < 3; i++) undo();
  d = await readDoc();
  assert.strictEqual(d.shapes.length, 8, 'three Ctrl+Z (tangent, coincident, parallel) removed no drawn element');
  assert.strictEqual(cons(d, 'tangent').length, tangent0, 'the tangent is gone');
  undo();
  d = await readDoc();
  assert.strictEqual(d.shapes.length, 7, 'the next Ctrl+Z removes the drawn circle (a drawn element is its own step)');
  for (let i = 0; i < 4; i++) redo();
  d = await readDoc();
  assert.strictEqual(d.shapes.length, 8, 'four Ctrl+Y bring the circle and the three constraints back');
  console.log('constraint-undo-steps-node: ok');
} finally { await app.close(); }
