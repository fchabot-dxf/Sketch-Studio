// TASK 660 (owner: "a warning or error is important here"): Fillet, Trim, Break, Offset and Mirror, pressed on a curve of ANOTHER visible, unlocked
// sketch with none of the ACTIVE sketch within reach, show ONE warning "<Tool> works in the active sketch: make <Sketch name> active first" and start nothing
// (no undo step, no change). A locked / hidden sketch stays silent (task 649). An active curve within reach always wins over a nearer curve of another
// sketch (Offset and Mirror used to take the app's single snap pick: the nearer one shadowed it). The text is built ONCE (#core/sketch-model.js otherSketchWarning).
import assert from 'node:assert';
import { otherSketchWarning, otherSketchPick } from '#core/sketch-model.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

// ---- 1. the one message and its test
{
  const state = { activeSketchId: 'sketch-1', sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }, { id: 'sketch-2', name: 'Tabs', visible: true }, { id: 'sketch-3', name: 'Hidden', visible: false }, { id: 'sketch-4', name: 'Locked', visible: true, locked: true }], shapes: [], joints: new Map() };
  const shape = (id, sk) => { const s = { id, type: 'line', joints: [], sketchId: sk }; state.shapes.push(s); return s; };
  assert.strictEqual(otherSketchWarning(state, 'Offset', shape('a', 'sketch-2')), 'Offset works in the active sketch: make Tabs active first');
  assert.strictEqual(otherSketchWarning(state, 'Offset', shape('a', 'sketch-1')), null, 'an active curve: no warning');
  assert.strictEqual(otherSketchWarning(state, 'Offset', shape('a', 'sketch-3')), null, 'a hidden sketch: silent');
  assert.strictEqual(otherSketchWarning(state, 'Offset', shape('a', 'sketch-4')), null, 'a locked sketch: silent');
  assert.strictEqual(otherSketchWarning(state, 'Offset', null), null);
  assert.strictEqual(otherSketchPick(state, { id: 'x', type: 'line', reference: true }), false, 'an axis is no sketch curve');
}

// ---- 2. each tool in SketchStudio
const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Active sketch warn 660');
const app = await open({ host: 'sketchstudio', profile });
try {
  const st = app.state, doc = app.document;
  const r = app.svg.getBoundingClientRect();
  const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  for (let i = 0; i < 20 && Math.abs(app.toScreen(60, 0).x - app.toScreen(0, 0).x) > 300; i++) app.wheel(C.x, C.y, 300);
  const toasts = () => [...doc.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.replace(/^\W+/u, '').trim());
  const clear = () => doc.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());
  const J = (x, y, sk) => { const id = st.genJ(); st.joints.set(id, { x, y, fixed: false, sketchId: sk }); return id; };
  const line = (id, a, b, sk) => st.shapes.push({ id, type: 'line', joints: [a, b], sketchId: sk });
  const fresh = (active = 'sketch-1') => {
    st.clearDocument(); st.sketches.splice(1);
    st.sketches.push({ id: 'sketch-2', name: 'Sketch 2', visible: true });
    st.sketches[0].locked = false; st.sketches[0].visible = true; st.activeSketchId = active;
    st.selectedShapes.clear(); st.selectedJoints.clear();
  };
  const P = (x, y) => app.toScreen(x, y);
  const pos = () => JSON.stringify([[...st.joints].map(([id, j]) => [id, j.x, j.y]), st.shapes.map((s) => s.id)]);
  const box = (id) => doc.getElementById(id);
  const warn = (tool) => `${tool} works in the active sketch: make Sketch 2 active first`;
  const pxMm = P(1, 0).x - P(0, 0).x; // screen px per mm
  const near = 2 / pxMm; // 2 screen px, in mm

  // the tools, each with a curve of Sketch 2 under the tap (Sketch 1 active)
  const one = () => { line('o1', J(0, 0, 'sketch-2'), J(60, 0, 'sketch-2'), 'sketch-2'); };
  const cases = {
    Trim: { tool: 'trim', build: one, tap: () => P(10, 0) },
    Break: { tool: 'break', build: one, tap: () => P(30, 0) },
    Offset: { tool: 'offset', build: one, tap: () => P(30, 0) },
    Fillet: { tool: 'fillet', build: () => { const c = J(10, 10, 'sketch-2'); line('o1', c, J(40, 10, 'sketch-2'), 'sketch-2'); line('o2', c, J(10, 40, 'sketch-2'), 'sketch-2'); }, tap: () => P(10, 10) },
    Mirror: { tool: 'mirror', build: one, tap: () => P(30, 0) },
  };
  for (const [name, c] of Object.entries(cases)) {
    for (const how of ['visible', 'locked', 'hidden']) {
      fresh(); c.build(); st.sketches[1].locked = how === 'locked'; st.sketches[1].visible = how !== 'hidden';
      app.frames(); app.tool(c.tool); clear();
      const h = st.history.length, p0 = pos(), t = c.tap();
      app.click(t.x, t.y);
      assert.deepStrictEqual(toasts(), how === 'visible' ? [warn(name)] : [], `${name} (${how} Sketch 2): ${JSON.stringify(toasts())}`);
      assert.strictEqual(st.history.length, h, `${name} (${how}): no undo step`);
      assert.strictEqual(pos(), p0, `${name} (${how}): nothing changed`);
      assert.strictEqual(box('offset-distance-input'), null, `${name}: no offset box`);
      assert.strictEqual(box('fillet-radius-input'), null, `${name}: no fillet box`);
      assert.strictEqual(st.selectedShapes.size, 0, `${name} (${how}): nothing picked`);
      if (how === 'visible') { clear(); app.move(t.x, t.y); assert.deepStrictEqual(toasts(), [], `${name}: a hover never warns`); }
      app.esc();
    }
    // with Sketch 2 active the same tap works and says nothing of the kind
    fresh('sketch-2'); c.build(); app.frames(); app.tool(c.tool); clear();
    { const t = c.tap(); app.click(t.x, t.y); }
    assert.ok(!toasts().some((m) => /works in the active sketch/.test(m)), `${name}: no warning with Sketch 2 active`);
    app.esc();
  }

  // Mirror at the LINE step: another sketch's line is not a mirror line -> the warning
  fresh(); line('m_o', J(0, 40, 'sketch-1'), J(30, 40, 'sketch-1'), 'sketch-1'); line('m_l', J(60, -20, 'sketch-2'), J(60, 60, 'sketch-2'), 'sketch-2'); app.frames();
  st.selectedShapes.add('m_o'); app.tool('mirror'); clear();
  { const h = st.history.length; app.click(P(60, 20).x, P(60, 20).y);
    assert.deepStrictEqual(toasts(), [warn('Mirror')], 'mirror line step: ' + JSON.stringify(toasts()));
    assert.ok(!st.mirror.line, 'no mirror line'); assert.strictEqual(st.history.length, h, 'mirror line step: no undo step'); }
  app.esc();

  // an ACTIVE curve 2 px farther than another sketch's curve under the tap is the pick, with no warning
  const shadow = (name) => {
    fresh();
    line('other', J(0, 0, 'sketch-2'), J(60, 0, 'sketch-2'), 'sketch-2');     // under the tap
    line('mine', J(0, near, 'sketch-1'), J(60, near, 'sketch-1'), 'sketch-1'); // 2 px farther
    app.frames(); app.tool(cases[name].tool); clear();
  };
  const tapAt = P(30, 0);
  shadow('Offset'); app.click(tapAt.x, tapAt.y);
  assert.ok(box('offset-distance-input'), 'offset: the box opens (the active line is the pick)');
  assert.deepStrictEqual(toasts(), [], 'offset: no warning');
  { const lit = [...doc.querySelectorAll('#offset-tool-overlay .offset-chain')];
    assert.strictEqual(lit.length, 1, 'offset: one curve lit');
    assert.ok(Math.abs(Number(lit[0].getAttribute('y1')) - near) < 1e-6, 'offset: the lit curve is the ACTIVE line, y=' + lit[0].getAttribute('y1')); }
  app.esc();
  shadow('Mirror'); app.click(tapAt.x, tapAt.y);
  assert.deepStrictEqual([...st.selectedShapes], ['mine'], 'mirror: the active line is the object: ' + JSON.stringify([...st.selectedShapes]));
  assert.deepStrictEqual(toasts(), [], 'mirror: no warning');
  app.esc();
  shadow('Trim'); app.click(tapAt.x, tapAt.y);
  assert.deepStrictEqual(toasts(), [], 'trim: no warning');
  assert.ok(!st.shapes.some((s) => s.id === 'mine') && st.shapes.some((s) => s.id === 'other'), 'trim: the active line goes, the other sketch line is untouched');
  shadow('Break'); app.click(tapAt.x, tapAt.y);
  assert.strictEqual(st.shapes.filter((s) => s.sketchId === 'sketch-2').length, 1, 'break: the other sketch line is whole');
  assert.strictEqual(st.shapes.filter((s) => s.sketchId === 'sketch-1').length, 2, 'break: the active line is split');
  assert.deepStrictEqual(toasts(), [], 'break: no warning');
  // Fillet: an active corner 2 px from another sketch's corner
  fresh();
  { const c2 = J(10, 10, 'sketch-2'); line('o1', c2, J(40, 10, 'sketch-2'), 'sketch-2'); line('o2', c2, J(10, 40, 'sketch-2'), 'sketch-2');
    const c1 = J(10 + near, 10, 'sketch-1'); line('f1', c1, J(40, 10, 'sketch-1'), 'sketch-1'); line('f2', c1, J(10 + near, 40, 'sketch-1'), 'sketch-1'); }
  app.frames(); app.tool('fillet'); clear();
  { const t = P(10, 10); app.click(t.x, t.y); }
  assert.ok(box('fillet-radius-input'), 'fillet: the box opens on the active corner');
  assert.deepStrictEqual(toasts(), [], 'fillet: no warning');
  app.esc();
} finally { await app.close(); }
console.log('active-sketch-warn-660.test.js: ok');
