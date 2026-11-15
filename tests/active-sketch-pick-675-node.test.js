// tests/active-sketch-pick-675-node.test.js — TASK 675 Part A:
// When an active-sketch curve and a non-active visible sketch's curve overlap or lie 1-2 px apart under one tap/hover,
// the active-sketch curve wins (other-sketch curve never shadows hover or pick) with no warning; only when NO active curve
// is in reach does a press on the other sketch's curve emit the active-sketch warning. Select continues to hover all visible unlocked sketches.
import assert from 'node:assert';
import { activeSketchPick, activeSketchScene, otherSketchScene, pickScene } from '#core/sketch-model.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

// ---- 1. Pure shared scene rule ----
{
  const state = {
    activeSketchId: 'sketch-1',
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }, { id: 'sketch-2', name: 'Sketch 2', visible: true }],
    joints: new Map([
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['j1', { x: 0, y: 20, sketchId: 'sketch-1' }], ['j2', { x: 60, y: 20, sketchId: 'sketch-1' }],
      ['j3', { x: 0, y: 20.5, sketchId: 'sketch-2' }], ['j4', { x: 60, y: 20.5, sketchId: 'sketch-2' }],
    ]),
    shapes: [
      { id: 'act', type: 'line', joints: ['j1', 'j2'], sketchId: 'sketch-1' },
      { id: 'oth', type: 'line', joints: ['j3', 'j4'], sketchId: 'sketch-2' },
      { id: 'ref_axis_x', type: 'line', joints: ['j_origin', 'j_ref_x'], reference: true },
    ],
  };
  assert.strictEqual(activeSketchPick(state, state.shapes[0]), true);
  assert.strictEqual(activeSketchPick(state, state.shapes[1]), false);
  const picked = pickScene(state, state.shapes);
  const actScene = activeSketchScene(state, picked);
  assert.deepStrictEqual(actScene.shapes.map((s) => s.id), ['act', 'ref_axis_x'], 'activeSketchScene keeps active shapes + reference axes');
  assert.deepStrictEqual([...actScene.joints.keys()], ['j_origin', 'j1', 'j2'], 'activeSketchScene drops non-active joints');
  const othScene = otherSketchScene(state, picked);
  assert.deepStrictEqual(othScene.shapes.map((s) => s.id), ['oth'], 'otherSketchScene keeps visible non-active curves only');
}

// ---- 2. App-level hover & pick across active-sketch tools + Select ----
const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Shadow Pick 675');
const app = await open({ host: 'sketchstudio', profile });

try {
  const st = app.state, doc = app.document;
  const r = app.svg.getBoundingClientRect();
  const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  for (let i = 0; i < 20 && Math.abs(app.toScreen(60, 0).x - app.toScreen(0, 0).x) > 300; i++) app.wheel(C.x, C.y, 300);

  const P = (x, y) => app.toScreen(x, y);
  const wpp = Math.abs(1 / (P(1, 0).x - P(0, 0).x));
  const sep = 1.5 * wpp;
  const J = (x, y, sk) => { const id = st.genJ(); st.joints.set(id, { x, y, fixed: false, sketchId: sk }); return id; };
  const line = (id, a, b, sk) => st.shapes.push({ id, type: 'line', joints: [a, b], sketchId: sk });
  const toasts = () => [...doc.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim().replace(/^[^A-Za-z]+/, ''));
  const clear = () => doc.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());

  const reset = () => {
    st.clearDocument(); st.sketches.splice(1);
    st.sketches.push({ id: 'sketch-2', name: 'Sketch 2', visible: true });
    st.sketches[0].locked = false; st.sketches[0].visible = true;
    st.activeSketchId = 'sketch-1';
    clear();
  };

  // Helper to lay down 'act' (y=20) and 'oth' (y=20+dy) plus 'oth_only' (y=60)
  const pair = (dy = sep, otherFirst = true) => {
    reset();
    const mkOth = () => line('oth', J(0, 20 + dy, 'sketch-2'), J(60, 20 + dy, 'sketch-2'), 'sketch-2');
    const mkAct = () => line('act', J(0, 20, 'sketch-1'), J(60, 20, 'sketch-1'), 'sketch-1');
    if (otherFirst) { mkOth(); mkAct(); } else { mkAct(); mkOth(); }
    line('oth_only', J(0, 60, 'sketch-2'), J(60, 60, 'sketch-2'), 'sketch-2');
  };

  // Point on Sketch 2 when other is 1.5 px closer than active, or on Sketch 1 when active is closer:
  const onOtherNearer = P(25, 20 + sep);
  const onActiveNearer = P(25, 20);
  const onOnlyOther = P(25, 60);

  // Select STILL hovers the nearer / non-active curve (turn 1595)
  pair(sep, true); app.frames();
  app.tool('select');
  app.move(onOtherNearer.x, onOtherNearer.y);
  assert.strictEqual(st.hoveredShape, 'oth', 'select: still hovers nearer Sketch 2 curve');
  app.move(onOnlyOther.x, onOnlyOther.y);
  assert.strictEqual(st.hoveredShape, 'oth_only', 'select: still hovers Sketch 2-only curve');

  // Offset, Mirror (objects + mirror line), Fillet, Trim, Break:
  for (const [label, tap] of [['otherNearer', onOtherNearer], ['activeNearer', onActiveNearer], ['overlap', onActiveNearer]]) {
    const dy = label === 'overlap' ? 0 : sep;

    // 1. Offset
    pair(dy, true); app.frames();
    app.tool('offset'); clear();
    app.move(tap.x, tap.y);
    assert.strictEqual(st.hoveredShape, 'act', `offset (${label}): hover lands on active curve, not other`);
    app.click(tap.x, tap.y);
    assert.ok(doc.getElementById('offset-distance-input'), `offset (${label}): distance box opens on active curve`);
    assert.deepStrictEqual(toasts(), [], `offset (${label}): no warning`);
    app.esc();

    // 2. Mirror OBJECTS
    pair(dy, true); app.frames();
    app.tool('mirror'); clear();
    app.move(tap.x, tap.y);
    assert.strictEqual(st.hoveredShape, 'act', `mirror objects (${label}): hover lands on active curve`);
    app.click(tap.x, tap.y);
    assert.deepStrictEqual([...st.selectedShapes], ['act'], `mirror objects (${label}): active curve selected`);
    assert.deepStrictEqual(toasts(), [], `mirror objects (${label}): no warning`);
    app.esc();

    // 3. Mirror LINE (object pre-selected)
    pair(dy, true);
    line('obj', J(0, -30, 'sketch-1'), J(30, -30, 'sketch-1'), 'sketch-1');
    st.selectedShapes.add('obj');
    app.frames();
    app.tool('mirror'); clear();
    app.move(tap.x, tap.y);
    assert.strictEqual(st.hoveredShape, 'act', `mirror line (${label}): hover lands on active line`);
    app.click(tap.x, tap.y);
    assert.strictEqual(st.mirror?.line, 'act', `mirror line (${label}): active line picked as mirror line`);
    app.esc();

    // 4. Trim
    pair(dy, true); app.frames();
    app.tool('trim'); clear();
    app.move(tap.x, tap.y);
    assert.strictEqual(st.hoveredShape, 'act', `trim (${label}): hover lands on active curve`);
    app.click(tap.x, tap.y);
    assert.ok(!st.shapes.some((s) => s.id === 'act') && st.shapes.some((s) => s.id === 'oth'), `trim (${label}): trims active, keeps other`);
    assert.deepStrictEqual(toasts(), [], `trim (${label}): no warning`);
    app.esc();

    // 5. Break
    pair(dy, true); app.frames();
    app.tool('break'); clear();
    app.move(tap.x, tap.y);
    assert.strictEqual(st.hoveredShape, 'act', `break (${label}): hover lands on active curve`);
    app.click(tap.x, tap.y);
    assert.strictEqual(st.shapes.filter((s) => s.sketchId === 'sketch-1').length, 2, `break (${label}): active line split`);
    assert.strictEqual(st.shapes.filter((s) => s.sketchId === 'sketch-2').length, 2, `break (${label}): other sketch lines untouched`);
    assert.deepStrictEqual(toasts(), [], `break (${label}): no warning`);
    app.esc();

    // 6. Fillet (line 1 + line 2)
    pair(dy, true);
    const act = st.shapes.find((s) => s.id === 'act');
    const jCornerEnd = J(60, 50, 'sketch-1');
    line('act2', act.joints[1], jCornerEnd, 'sketch-1');
    app.frames();
    app.tool('fillet'); clear();
    app.move(tap.x, tap.y);
    assert.strictEqual(st.hoveredShape, 'act', `fillet (${label}): hover lands on active curve`);
    app.click(tap.x, tap.y);
    const pLine2 = P(60, 35);
    app.click(pLine2.x, pLine2.y);
    assert.ok(doc.getElementById('fillet-radius-input'), `fillet (${label}): radius box opens on active corner`);
    assert.deepStrictEqual(toasts(), [], `fillet (${label}): no warning`);
    app.esc();
  }

  // Only Sketch 2 under tap/hover: hover is null, press emits the active-sketch warning
  for (const [t, warnTool] of [['offset', 'Offset'], ['mirror', 'Mirror'], ['trim', 'Trim'], ['break', 'Break'], ['fillet', 'Fillet']]) {
    pair(sep, true); app.frames();
    app.tool(t); clear();
    app.move(onOnlyOther.x, onOnlyOther.y);
    assert.strictEqual(st.hoveredShape, null, `${t}: hovering only other sketch curve leaves hoveredShape null`);
    assert.deepStrictEqual(toasts(), [], `${t}: hover never warns`);
    app.click(onOnlyOther.x, onOnlyOther.y);
    assert.deepStrictEqual(toasts(), [`${warnTool} works in the active sketch: make Sketch 2 active first`], `${t}: press with no active curve warns`);
    app.esc();
  }

  console.log('active-sketch-pick-675-node.test.js: ok');
} finally {
  await app.close();
}
