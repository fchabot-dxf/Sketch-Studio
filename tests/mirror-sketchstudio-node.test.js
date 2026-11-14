// tests/mirror-sketchstudio-node.test.js — TASK 601 (node port of tests/mirror-live-sketchstudio.test.js, TASK 585), SketchStudio through
// tests/helpers/node-app.js: the MIRROR tool. Draw a two-line chain and a circle left of the Y axis; with the Select tool click line 1, Shift+click
// line 2 and the circle (the pre-selection); the ribbon's Mirror (Create group) starts at the mirror-LINE step; click the Y axis (it lights up);
// Enter -> the mirrored copies right of the axis, linked by 4 symmetric constraints about the Y axis and nothing else; Ctrl+Z removes the whole
// mirror in ONE step, Ctrl+Y brings back the identical document. Same asserts, same picks. Dropped: the cropped screenshots of the ribbon's Create
// group and of the canvas (EVIDENCE_DIR evidence, they asserted nothing).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio'); // only a NAMED design autosaves (the test reads the autosave)
const app = await open({ host: 'sketchstudio', profile });
try {
  const doc = app.document;
  const readDoc = async () => { const d = await app.storedDoc(); return JSON.parse(JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints })); };
  const J = (d) => Object.fromEntries(d.joints.map((e) => (Array.isArray(e) ? e : [e.id, e])));
  const cleanCons = (d) => JSON.stringify(d.constraints.map(({ glyphPos, __pos, __visible, ...r }) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]]))));
  const geom = (d) => JSON.stringify(d.shapes.map((s) => s.id)) + cleanCons(d) + JSON.stringify(d.joints.map((e) => (Array.isArray(e) ? [e[0], +e[1].x.toFixed(6), +e[1].y.toFixed(6)] : [e.id, +e.x.toFixed(6), +e.y.toFixed(6)])).sort());
  const o = app.toScreen(0, 0);
  const at = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
  const along = (a, b, t) => ({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) });
  const click = (p, shift = false) => app.click(p.x, p.y, { shift });
  const move = (p) => app.move(p.x, p.y);
  const tool = (n) => app.tool(n);

  // ---- the ribbon: Mirror in the Create group
  const b = doc.getElementById('tool-mirror');
  const g = b && b.closest('.sk-ribbon-group');
  const grp = g && { label: g.querySelector('.sk-ribbon-group-label').textContent, text: b.textContent.trim() };
  assert.ok(grp && grp.label === 'Create' && grp.text === 'Mirror', 'the ribbon has a Mirror button in the Create group: ' + JSON.stringify(grp));

  // ---- the drawing (left of the Y axis, >= 60 px from both axes): a chain A1 - A2 - B2 (two lines, the corner joined) and a circle
  const A1 = at(-80, -260), A2 = at(-330, -260), B2 = at(-330, -80), C = at(-190, -150), R = 40;
  tool('line'); click(A1); click(A2); click(B2); app.esc();
  tool('circle'); click(C); click({ x: C.x + R, y: C.y }); app.esc();
  tool('select');
  const d0 = await readDoc();
  assert.strictEqual(d0.shapes.length, 3, 'drawn: two lines and a circle: ' + d0.shapes.map((s) => s.type).join(','));

  // ---- the pre-selection (clicks, Shift adds), the ribbon's Mirror, the Y axis, Enter
  click(along(A1, A2, 0.5)); click(along(A2, B2, 0.5), true); click({ x: C.x - R, y: C.y }, true);
  assert.strictEqual(doc.getElementById('tool-mirror') ? 1 : 0, 1);
  tool('mirror');
  move(at(0, 120));
  assert.ok(doc.querySelectorAll('[data-ref-axis="ref_axis_y"]').length > 0, 'the LINE step: the Y axis lights up under the pointer');
  click(at(0, 120));
  move(at(300, 200));
  assert.ok(doc.querySelectorAll('[data-ref-axis="ref_axis_y"]').length > 0, 'the picked Y axis stays lit (pointer away)');
  const before = await readDoc();
  assert.strictEqual(before.shapes.length, 3, 'nothing is made before Enter');
  app.enter();
  const after = await readDoc();
  assert.strictEqual(after.shapes.length, 6, 'Enter: three copies: ' + after.shapes.map((s) => s.type).join(','));
  const active = doc.querySelector('.sk-ribbon-btn.active');
  assert.strictEqual(active && active.id, 'tool-select', 'the tool ends: Select is active');

  // ---- the copies: mirror images about the Y axis (x -> -x), the corner shared, linked only by symmetric constraints
  const j = J(after), [oA, oB, oK] = after.shapes.slice(0, 3), [cA, cB, cK] = after.shapes.slice(3);
  const mir = (id) => ({ x: -j[id].x, y: j[id].y });
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  assert.ok(cA.type === 'line' && near(j[cA.joints[0]], mir(oA.joints[0])) && near(j[cA.joints[1]], mir(oA.joints[1])), 'line 1 mirrored');
  assert.ok(cB.type === 'line' && near(j[cB.joints[1]], mir(oB.joints[1])), 'line 2 mirrored');
  assert.ok(cA.joints[1] === cB.joints[0], 'the copy\'s corner is one shared point');
  assert.ok(cK.type === 'circle' && near(j[cK.joints[0]], mir(oK.joints[0])) && Math.abs(cK.radius - oK.radius) < 1e-9, 'the circle mirrored, same radius');
  const added = after.constraints.slice(before.constraints.length);
  assert.ok(added.length === 4 && added.every((c) => c.type === 'symmetric' && c.line === 'ref_axis_y'), '4 new constraints, all symmetric about the Y axis: ' + JSON.stringify(added));
  console.log(`NODE mirror: 3 copies, ${added.length} symmetric links about the Y axis`);

  // ---- ONE undo step; redo identical
  app.undo();
  const un = await readDoc();
  assert.strictEqual(geom(un), geom(before), 'Ctrl+Z: the whole mirror is undone in ONE step (the document as before)');
  app.redo();
  const re = await readDoc();
  assert.strictEqual(geom(re), geom(after), 'Ctrl+Y: the identical mirrored document');
  console.log('mirror-sketchstudio-node: ok');
} finally { await app.close(); }
