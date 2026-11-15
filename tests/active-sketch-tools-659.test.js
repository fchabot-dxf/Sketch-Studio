// TASK 659 (owner, Fusion's way): Fillet, Trim, Break, Offset and Mirror work ONLY on curves of the ACTIVE sketch; a curve of another sketch is
// not a pick (as empty canvas: no hover, no pick, no message). They are not used implicitly either: the cutting lines of a Trim, the mirror line.
// ONE rule (#core/sketch-model.js inActiveSketch / activeSketchPick).
//  1. core entries refuse and write nothing: trimShape, breakShape, applyOffset, mirrorObjects (objects and line);
//  2. each tool in SketchStudio: Sketch 1 active, a Sketch 2 curve picks nothing (no message, no undo step); Sketch 2 active: it works and every
//     new joint / shape is in sketch-2; a Trim ignores another sketch's cutting line.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { trimShape } from '#core/trim.js';
import { breakShape } from '#core/break.js';
import { offsetChainOf, applyOffset } from '#core/offset.js';
import { mirrorObjects, mirrorObjectsOf } from '#core/mirror.js';
import { sketchOf } from '#core/sketch-model.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const snapOf = (S) => JSON.stringify([[...S.state.joints], S.state.shapes, S.state.constraints]);
// ---- 1. core
{
  const S = L.newSketch(), st = S.state;
  const mk = (x1, y1, x2, y2, sk) => { const a = L.point(S, x1, y1), b = L.point(S, x2, y2); const s = L.shape(S, L.line(S, a, b)); for (const j of [a, b]) st.joints.get(j).sketchId = sk; s.sketchId = sk; return s; };
  const t = mk(0, 0, 60, 0, 'sketch-2'), mir = mk(100, -10, 100, 10, 'sketch-2'), off = mk(0, 50, 40, 50, 'sketch-2');
  st.activeSketchId = 'sketch-1';
  const before = snapOf(S);
  assert.strictEqual(trimShape(st, t.id, { x: 10, y: 0 }), null, 'trimShape outside the active sketch is refused');
  assert.strictEqual(breakShape(st, t.id, 0.5), null, 'breakShape outside the active sketch is refused');
  const ch = offsetChainOf(st, off.id, () => true);
  const ro = applyOffset(st, ch.chain, 5, 1);
  assert.ok(ro && ro.ok === false, 'applyOffset outside the active sketch is refused: ' + JSON.stringify(ro));
  const rm = mirrorObjects(st, mirrorObjectsOf([t.id], []), mir.id);
  assert.ok(rm.ok === false, 'mirrorObjects of objects outside the active sketch is refused: ' + JSON.stringify(rm));
  assert.strictEqual(snapOf(S), before, 'nothing was written by any refusal');
  const own = mk(0, 80, 20, 80, 'sketch-1');
  const before2 = snapOf(S);
  const rl = mirrorObjects(st, mirrorObjectsOf([own.id], []), mir.id);
  assert.ok(rl.ok === false, 'a mirror line of another sketch is refused: ' + JSON.stringify(rl));
  assert.strictEqual(snapOf(S), before2, 'the refused mirror wrote nothing');
  st.activeSketchId = 'sketch-2';
  assert.ok(breakShape(st, t.id, 0.25), 'break works inside the active sketch');
}

// ---- 2. the tools
const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Active sketch 659');
const app = await open({ host: 'sketchstudio', profile });
try {
  const st = app.state, doc = app.document;
  const r = app.svg.getBoundingClientRect();
  const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  for (let i = 0; i < 20 && Math.abs(app.toScreen(60, 0).x - app.toScreen(0, 0).x) > 300; i++) app.wheel(C.x, C.y, 300);
  const toasts = () => [...doc.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim());
  const clear = () => doc.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());
  const J = (x, y, sk) => { const id = st.genJ(); st.joints.set(id, { x, y, fixed: false, sketchId: sk }); return id; };
  const line = (id, a, b, sk) => st.shapes.push({ id, type: 'line', joints: [a, b], sketchId: sk });
  const fresh = (active) => {
    st.clearDocument(); st.sketches.splice(1);
    st.sketches.push({ id: 'sketch-2', name: 'Sketch 2', visible: true });
    st.sketches[0].locked = false; st.sketches[0].visible = true; st.activeSketchId = active;
  };
  const sketches = () => ({ j: [...st.joints].filter(([id]) => id !== 'j_origin').map(([, j]) => j.sketchId || 'sketch-1'), s: st.shapes.map((s) => sketchOf(s)) });
  const pos = () => JSON.stringify([...st.joints].map(([id, j]) => [id, j.x, j.y]));
  const P = (x, y) => app.toScreen(x, y);
  const allIn = (k, sk) => k.j.every((x) => x === sk) && k.s.every((x) => x === sk);

  // TRIM: a Sketch 2 line crossed by a Sketch 2 line
  const trimDoc = (active) => { fresh(active); const a = J(0, 0, 'sketch-2'), b = J(60, 0, 'sketch-2'), c = J(30, -20, 'sketch-2'), d = J(30, 20, 'sketch-2'); line('t1', a, b, 'sketch-2'); line('t2', c, d, 'sketch-2'); app.frames(); app.tool('trim'); clear(); };
  trimDoc('sketch-1');
  { const h = st.history.length, p0 = pos(), n0 = st.shapes.length;
    app.move(P(10, 0).x, P(10, 0).y);
    assert.ok(!doc.getElementById('trim-tool-overlay'), 'trim: no hover preview');
    app.click(P(10, 0).x, P(10, 0).y);
    assert.strictEqual(pos(), p0, 'trim: nothing moved'); assert.strictEqual(st.shapes.length, n0, 'trim: no shape change');
    assert.strictEqual(st.history.length, h, 'trim: no undo step'); assert.deepStrictEqual(toasts(), [], 'trim: no message'); }
  trimDoc('sketch-2');
  { app.click(P(10, 0).x, P(10, 0).y);
    const t1 = st.shapes.find((x) => x.id === 't1'), xs = t1.joints.map((j) => st.joints.get(j).x).sort((a, b) => a - b);
    assert.deepStrictEqual(xs, [30, 60], 'trim in the active sketch: the leading half is gone, the new end is at the crossing ' + JSON.stringify(xs));
    const k = sketches(); assert.ok(allIn(k, 'sketch-2'), 'trim: every joint and shape in sketch-2 ' + JSON.stringify(k)); }
  fresh('sketch-1');
  { const a = J(0, 0, 'sketch-1'), b = J(60, 0, 'sketch-1'), c = J(30, -20, 'sketch-2'), d = J(30, 20, 'sketch-2'); line('u1', a, b, 'sketch-1'); line('u2', c, d, 'sketch-2'); app.frames(); app.tool('trim');
    app.click(P(10, 0).x, P(10, 0).y);
    assert.ok(!st.shapes.find((s) => s.id === 'u1') && st.shapes.find((s) => s.id === 'u2'), "trim: another sketch's crossing line does not cut; the active line goes whole"); }

  // BREAK
  const breakDoc = (active) => { fresh(active); line('b1', J(0, 0, 'sketch-2'), J(60, 0, 'sketch-2'), 'sketch-2'); app.frames(); app.tool('break'); clear(); };
  breakDoc('sketch-1');
  { const h = st.history.length, p0 = pos(); app.click(P(30, 0).x, P(30, 0).y);
    assert.strictEqual(pos(), p0, 'break: nothing moved'); assert.strictEqual(st.shapes.length, 1, 'break: no new half');
    assert.strictEqual(st.history.length, h, 'break: no undo step'); assert.deepStrictEqual(toasts(), [], 'break: no message'); }
  breakDoc('sketch-2');
  { app.click(P(30, 0).x, P(30, 0).y);
    assert.strictEqual(st.shapes.length, 2, 'break in the active sketch: two halves');
    const k = sketches(); assert.ok(k.j.length === 3 && allIn(k, 'sketch-2'), 'break: mid joint and halves in sketch-2 ' + JSON.stringify(k)); }

  // OFFSET
  const box = () => doc.getElementById('offset-distance-input');
  const offDoc = (active) => { fresh(active); line('o1', J(0, 0, 'sketch-2'), J(60, 0, 'sketch-2'), 'sketch-2'); app.frames(); app.tool('offset'); clear(); };
  offDoc('sketch-1');
  { const h = st.history.length; app.click(P(30, 0).x, P(30, 0).y);
    assert.strictEqual(box(), null, 'offset: no distance box'); assert.strictEqual(st.history.length, h, 'offset: no undo step'); assert.deepStrictEqual(toasts(), [], 'offset: no message'); }
  offDoc('sketch-2');
  { app.click(P(30, 0).x, P(30, 0).y); assert.ok(box(), 'offset in the active sketch: the box opens'); app.enter();
    assert.strictEqual(st.shapes.length, 2, 'offset: the new line');
    const k = sketches(); assert.ok(allIn(k, 'sketch-2'), 'offset: all in sketch-2 ' + JSON.stringify(k)); app.esc(); }

  // MIRROR: objects and mirror line only from the active sketch
  fresh('sketch-1');
  { line('m1', J(0, 0, 'sketch-2'), J(30, 0, 'sketch-2'), 'sketch-2'); line('m2', J(0, 40, 'sketch-1'), J(30, 40, 'sketch-1'), 'sketch-1'); line('m3', J(60, -20, 'sketch-2'), J(60, 60, 'sketch-2'), 'sketch-2'); app.frames(); app.tool('mirror');
    app.click(P(15, 0).x, P(15, 0).y);
    assert.strictEqual(st.selectedShapes.size, 0, "mirror: another sketch's line is not an object");
    app.click(P(15, 40).x, P(15, 40).y); assert.ok(st.selectedShapes.has('m2'), 'mirror: the active line is an object'); app.enter();
    app.click(P(60, 20).x, P(60, 20).y); assert.ok(!st.mirror.line, "mirror: another sketch's line is not the mirror line"); app.esc(); }
} finally { await app.close(); }
console.log('active-sketch-tools-659.test.js: ok');
