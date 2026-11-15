// TASK 657 (fillet audit F15, owner ruling): Fillet works in the ACTIVE sketch only (Fusion: only the sketch being edited can be filleted).
// Before: a corner of lines in Sketch 2 filleted with Sketch 1 active put the arc, V and new joints into Sketch 1 while the lines stayed in 2.
//  1. core: applyFillet refuses a corner with a curve outside the active sketch and writes nothing; findCornerAtPoint's include rule ignores
//     a curve it rejects as if absent (two active curves + a third of another sketch = a corner; one active + one other = none);
//  2. the tool (SketchStudio through tests/helpers/node-app.js): Sketch 1 active, tap a Sketch 2 corner -> ONE warning (task 660: not pickable, but it says so), no box,
//     no arc, no undo step; Sketch 2 active -> the same tap opens the box, Enter fillets, arc + V + joints are in sketch-2; a mixed corner
//     (one curve of each sketch) is not filleted; a locked / hidden Sketch 2 stays silent (task 649).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { findCornerAtPoint, applyFillet, findCornerBetweenLines } from '#core/fillet.js';
import { sketchOf } from '#core/sketch-model.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

// ---- 1. core
{
  const S = L.newSketch();
  const c = L.point(S, 10, 10), a = L.point(S, 60, 10), b = L.point(S, 10, 40);
  const la = L.shape(S, L.line(S, c, a)), lb = L.shape(S, L.line(S, c, b));
  la.sketchId = lb.sketchId = 'sketch-2'; S.state.activeSketchId = 'sketch-1';
  const corner = findCornerBetweenLines(S.state, la, lb);
  assert.ok(corner, 'the corner exists');
  const snap = () => JSON.stringify([[...S.state.joints], S.state.shapes, S.state.constraints]);
  const before = snap();
  const res = applyFillet(S.state, corner, 5);
  assert.ok(res && res.success === false, 'applyFillet across sketches is refused: ' + JSON.stringify(res));
  assert.strictEqual(snap(), before, 'nothing was written');
  la.sketchId = lb.sketchId = 'sketch-1'; // the same corner in the active sketch fillets
  assert.ok(applyFillet(S.state, findCornerBetweenLines(S.state, la, lb), 5).success, 'inside the active sketch it fillets');
  // a mixed corner (one curve of each sketch) is refused too
  const S2 = L.newSketch();
  const c2 = L.point(S2, 0, 0);
  const ma = L.shape(S2, L.line(S2, c2, L.point(S2, 40, 0))), mb = L.shape(S2, L.line(S2, c2, L.point(S2, 0, 40)));
  mb.sketchId = 'sketch-2'; S2.state.activeSketchId = 'sketch-1';
  const r2 = applyFillet(S2.state, findCornerBetweenLines(S2.state, ma, mb), 5);
  assert.ok(r2 && r2.success === false, 'a mixed corner is refused by applyFillet');
}
{
  const S = L.newSketch();
  const c = L.point(S, 0, 0);
  const sa = L.shape(S, L.line(S, c, L.point(S, 40, 0))), sb = L.shape(S, L.line(S, c, L.point(S, 0, 40))), sc = L.shape(S, L.line(S, c, L.point(S, -30, -30)));
  sc.sketchId = 'sketch-2'; S.state.activeSketchId = 'sketch-1';
  const mine = (s) => sketchOf(s) === 'sketch-1';
  assert.strictEqual(findCornerAtPoint(S.state, { x: 0, y: 0 }, 2), null, 'all curves: three meet, no corner');
  assert.ok(findCornerAtPoint(S.state, { x: 0, y: 0 }, 2, mine), "the active sketch's two curves are a corner, the other sketch's third ignored as if absent");
  sb.sketchId = 'sketch-2';
  assert.strictEqual(findCornerAtPoint(S.state, { x: 0, y: 0 }, 2, mine), null, "one active curve meeting another sketch's: no corner");
  assert.ok(sa);
}

// ---- 2. the tool
const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Fillet 657');
const app = await open({ host: 'sketchstudio', profile });
try {
  const st = app.state, doc = app.document;
  const r = app.svg.getBoundingClientRect();
  const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  for (let i = 0; i < 20 && Math.abs(app.toScreen(15, 0).x - app.toScreen(0, 0).x) > 100; i++) app.wheel(C.x, C.y, 300);
  const toasts = () => [...doc.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim().replace(/^[^A-Za-z]+/, ''));
  const clear = () => doc.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());
  const box = () => doc.getElementById('fillet-radius-input');
  const arcs = () => st.shapes.filter((s) => s.type === 'arc').length;
  const J = (x, y, sk) => { const id = st.genJ(); st.joints.set(id, { x, y, fixed: false, sketchId: sk }); return id; };
  const line = (id, a, b, sk) => st.shapes.push({ id, type: 'line', joints: [a, b], sketchId: sk });
  const fresh = () => {
    st.clearDocument();
    st.sketches.splice(1);
    st.sketches.push({ id: 'sketch-2', name: 'Sketch 2', visible: true });
    st.sketches[0].locked = false; st.sketches[0].visible = true; st.activeSketchId = 'sketch-1';
  };
  fresh();
  const jc = J(10, 10, 'sketch-2');
  line('s_l1', jc, J(40, 10, 'sketch-2'), 'sketch-2'); line('s_l2', jc, J(10, 40, 'sketch-2'), 'sketch-2');
  app.frames();
  const corner = app.toScreen(10, 10), onL1 = app.toScreen(25, 10), onL2 = app.toScreen(10, 25);
  app.tool('fillet');

  // Sketch 1 active: the Sketch 2 corner, tapped
  clear(); const h0 = st.history.length;
  app.click(corner.x, corner.y);
  assert.deepStrictEqual(toasts(), ['Fillet works in the active sketch: make Sketch 2 active first'], 'one warning at the corner tap: ' + JSON.stringify(toasts()));
  assert.strictEqual(box(), null, 'no radius box'); assert.strictEqual(arcs(), 0, 'no arc'); assert.strictEqual(st.history.length, h0, 'no undo step');
  clear(); app.click(onL1.x, onL1.y);
  assert.deepStrictEqual(toasts(), ['Fillet works in the active sketch: make Sketch 2 active first'], 'a line tap: the same one warning');
  const ov = doc.getElementById('fillet-tool-overlay');
  assert.ok(!ov || ov.children.length === 0, 'a line tap picks nothing');
  for (const how of ['locked', 'hidden']) { // a locked / hidden Sketch 2 stays silent (task 649)
    st.sketches[1].locked = how === 'locked'; st.sketches[1].visible = how !== 'hidden';
    clear(); app.click(corner.x, corner.y); app.click(onL1.x, onL1.y);
    assert.deepStrictEqual(toasts(), [], `${how} Sketch 2: says nothing`);
    assert.strictEqual(box(), null, `${how} Sketch 2: no box`);
  }
  st.sketches[1].locked = false; st.sketches[1].visible = true;
  app.esc(); app.tool('fillet');

  // Sketch 2 active: the same tap fillets, everything lands in sketch-2
  st.activeSketchId = 'sketch-2'; clear();
  app.click(corner.x, corner.y);
  assert.ok(box(), 'Sketch 2 active: the same tap opens the radius box');
  app.enter();
  const arc = st.shapes.find((s) => s.type === 'arc');
  assert.ok(arc, 'the fillet arc exists');
  assert.strictEqual(sketchOf(arc), 'sketch-2', 'the arc is in sketch-2');
  const sk = [...st.joints].filter(([id]) => id !== 'j_origin').map(([, j]) => j.sketchId || 'sketch-1');
  assert.ok(sk.length >= 5 && sk.every((s) => s === 'sketch-2'), 'every joint (V, centre, tangent points, line ends) is in sketch-2: ' + JSON.stringify(sk));
  assert.strictEqual(st.history.length, h0 + 1, 'one undo step');

  // mixed corner: one curve of each sketch, Sketch 1 active
  fresh();
  const m = J(10, 10, 'sketch-1');
  line('s_m1', m, J(40, 10, 'sketch-1'), 'sketch-1'); line('s_m2', m, J(10, 40, 'sketch-2'), 'sketch-2');
  app.frames(); app.tool('fillet'); clear();
  app.click(corner.x, corner.y); // picks the active curve (line 1) at most
  app.click(onL2.x, onL2.y);     // line 2 is the other sketch's curve
  assert.strictEqual(box(), null, 'a mixed corner opens no box'); assert.strictEqual(arcs(), 0, 'a mixed corner is not filleted');
  assert.deepStrictEqual(toasts(), ['Fillet works in the active sketch: make Sketch 2 active first'], 'the other sketch curve as line 2: the one warning: ' + JSON.stringify(toasts()));
  app.esc();
} finally { await app.close(); }
console.log('fillet-active-sketch-657.test.js: ok');
