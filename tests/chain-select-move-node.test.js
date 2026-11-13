// tests/chain-select-move-node.test.js — TASK 588 (node, through tests/helpers/node-app.js): two select-tool features, like Fusion (owner
// 2026-11-13: "double clicking a profile should select it completely, and I should be able to move lines or selection of lines with select tool").
//  1. DOUBLE CLICK a curve: the whole chain connected END TO END to it is selected (#core loop-finder findConnectedChain: through branches;
//     construction and normal geometry never mix; never into a locked or hidden sketch); Shift adds the chain to the selection.
//  2. MOVE A SELECTION: a press on a member of a selection of several shapes / points and a drag moves the WHOLE selection through the solver
//     (a group drag: one spring per member joint), so every constraint holds, inside the selection and to unselected geometry; a held
//     member locks the group; ONE undo step "move selection"; a click (no move) on a member selects it alone, as before; a press on an
//     UNSELECTED shape is today's single drag and replaces the selection.
//  3. Today's rules kept: a click INSIDE a closed profile (not on an edge) starts a box selection (no region pick); two slow clicks are two clicks.
// The scenes are declared documents (mm) opened in SketchStudio, 130 mm across the canvas (about 10 px per mm); no grid magnet.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { findConnectedChain } from '#core/loop-finder.js';
import { screenToWorld } from '#ui/coords.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' }); // no grid snap: the cursor is where the geometry goes
const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };
const residual = (st) => { let max = 0; for (const c of st.constraints) { if (!c || c.driven || c.isDriven || c.type === 'mouse_spring') continue; const r = measureResidual(c, st.joints, st.shapes); if (!(r <= max)) max = r; } return max; };
const sel = (st) => [...st.selectedShapes].sort();
const pos = (st, id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const measured = {};
const PAIR_GAP_MS = 600; // longer than the app's 500 ms double-click pairing window: the next press is a new click

// ---- #core: findConnectedChain on a declared state (lines, an arc, a branch, construction, a circle, a separate line)
{
  const J = (x, y) => ({ x, y });
  const st = {
    joints: new Map([['a', J(0, 0)], ['b', J(100, 0)], ['b2', J(100, 0)], ['c', J(100, 50)], ['d', J(150, 50)], ['e', J(250, 50)],
      ['f', J(100, -80)], ['g', J(250, 150)], ['h', J(400, 0)], ['i', J(500, 0)], ['k', J(250, 50)], ['m', J(300, 300)]]),
    shapes: [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'A1', type: 'arc', joints: ['c', 'b2', 'd'] },              // centre c, start b2 (coincident with b), end d
      { id: 'L2', type: 'line', joints: ['d', 'e'] },                     // shares the joint d with the arc
      { id: 'BR', type: 'line', joints: ['b', 'f'] },                     // a branch at b
      { id: 'CN', type: 'line', joints: ['e', 'g'], isConstruction: true }, // construction from e: not the same kind
      { id: 'CI', type: 'circle', joints: ['k'], radius: 20 },             // a circle centred on e (coincident centre): it has no ends
      { id: 'SEP', type: 'line', joints: ['h', 'i'] },
      { id: 'MID', type: 'line', joints: ['c', 'm'] },                     // from the arc CENTRE: a centre is not an end
    ],
    constraints: [{ type: 'coincident', joints: ['b', 'b2'] }, { type: 'coincident', joints: ['e', 'k'] }],
  };
  assert.deepStrictEqual(findConnectedChain(st, 'L1').sort(), ['A1', 'BR', 'L1', 'L2'], 'core: end to end through an arc, a coincident end and a branch');
  assert.deepStrictEqual(findConnectedChain(st, 'L2')[0], 'L2', 'core: the start shape comes first');
  assert.deepStrictEqual(findConnectedChain(st, 'CN'), ['CN'], 'core: a construction curve chains only construction');
  assert.deepStrictEqual(findConnectedChain(st, 'CI'), ['CI'], 'core: a circle is a chain of itself');
  assert.deepStrictEqual(findConnectedChain(st, 'MID'), ['MID'], 'core: a line from an arc centre is not connected to the arc');
  assert.deepStrictEqual(findConnectedChain(st, 'L1', (s) => s.id !== 'A1').sort(), ['BR', 'L1'], 'core: include() cuts the chain (a locked / hidden sketch)');
  measured.core = 'ok';
}

// a stored design (the document record the app saves) from joints { id: [x, y, fixed, sketchId] } (mm), shapes, constraints, sketches
function design(joints, shapes, constraints, sketches = [{ id: 'sketch-1', name: 'Sketch 1', visible: true }]) {
  return { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...Object.entries(joints).map(([id, [x, y, fixed, sk]]) => [id, { x, y, fixed: !!fixed, sketchId: sk || 'sketch-1' }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })), constraints,
    sketches, activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [], vcarves: [] } };
}
async function openDesign(doc, centre) {
  const profile = await createProfile();
  const id = await createNamedDesign(profile, 'sketchstudio', 'Task 588');
  { const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null }); await store.save(doc, { app: 'sketchstudio', id }); }
  const app = await open({ host: 'sketchstudio', profile });
  const st = app.state; app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: centre.x, y: centre.y, w: 130 }); st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
  return app;
}
// the screen point at fraction t along line `id`, or at the middle angle of arc `id`
function on(app, id, t = 0.3) {
  const st = app.state, s = st.shapes.find((x) => x.id === id);
  if (s.type === 'arc') {
    const c = pos(st, s.joints[0]), a = pos(st, s.joints[1]), b = pos(st, s.joints[2]), R = dist(c, a);
    let a0 = Math.atan2(a.y - c.y, a.x - c.x), a1 = Math.atan2(b.y - c.y, b.x - c.x); if (a1 < a0) a1 += 2 * Math.PI;
    const m = (a0 + a1) / 2; return app.toScreen(c.x + R * Math.cos(m), c.y + R * Math.sin(m));
  }
  const a = pos(st, s.joints[0]), b = pos(st, s.joints[1]);
  return app.toScreen(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}
const dbl = async (app, id, o) => { await app.pause(PAIR_GAP_MS); const p = on(app, id); app.dblclick(p.x, p.y, o); };
const click = async (app, id, o, t) => { await app.pause(PAIR_GAP_MS); const p = on(app, id, t); app.click(p.x, p.y, o); };
const rect = (p, [x0, y0, x1, y1], sk) => ({
  joints: { [p + '1']: [x0, y0, false, sk], [p + '2']: [x1, y0, false, sk], [p + '3']: [x1, y1, false, sk], [p + '4']: [x0, y1, false, sk] },
  shapes: [[1, 2], [2, 3], [3, 4], [4, 1]].map(([a, b], i) => ({ id: p + 'E' + (i + 1), type: 'line', joints: [p + a, p + b], ...(sk ? { sketchId: sk } : {}) })),
  constraints: [{ type: 'horizontal', joints: [p + '1', p + '2'] }, { type: 'vertical', joints: [p + '2', p + '3'] }, { type: 'horizontal', joints: [p + '3', p + '4'] }, { type: 'vertical', joints: [p + '4', p + '1'] }],
});

// ---- 1. DOUBLE CLICK: a rectangle + a separate line, a chain with an arc (a coincident end, a shared end), a construction line on that chain
{
  const R = rect('r', [0, 0, 40, 30]);
  const doc = design(
    { ...R.joints, s1: [55, 0], s2: [70, 25], ac: [20, -30], as: [30, -30], ae: [20, -20], k0: [50, -30], ka: [30, -30], k3: [-5, -20], c9: [60, -45] },
    [...R.shapes, { id: 'S', type: 'line', joints: ['s1', 's2'] },
      { id: 'A', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'], largeArc: false, sweep: true },
      { id: 'K1', type: 'line', joints: ['k0', 'ka'] },       // its end ka is MADE COINCIDENT with the arc's start
      { id: 'K2', type: 'line', joints: ['ae', 'k3'] },       // shares the arc's end joint
      { id: 'CN', type: 'line', joints: ['k0', 'c9'], isConstruction: true }],
    [...R.constraints, { type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }, { type: 'coincident', joints: ['ka', 'as'] }]);
  const app = await openDesign(doc, { x: 20, y: -5 });
  try {
    const st = app.state, edges = R.shapes.map((s) => s.id).sort();
    // inside the closed rectangle (not on an edge): nothing is picked, the press starts a box selection (today's behaviour, kept)
    { await app.pause(PAIR_GAP_MS); const p = app.toScreen(20, 15); app.click(p.x, p.y); measured.insideProfile = sel(st); assert.deepStrictEqual(sel(st), [], 'a click inside a profile selects nothing'); }
    // double click one rectangle edge: its 4 edges, not the separate line
    await dbl(app, 'rE1'); measured.rectChain = sel(st);
    assert.deepStrictEqual(sel(st), edges, 'a double click on a rectangle edge selects its 4 edges, not the separate line');
    // a single click on the separate line: it alone (another target: no pairing with the double click)
    await click(app, 'S'); assert.deepStrictEqual(sel(st), ['S'], 'a click selects one line');
    // Shift + double click adds the chain to the selection
    await dbl(app, 'rE3', { shift: true }); measured.shiftChain = sel(st);
    assert.deepStrictEqual(sel(st), [...edges, 'S'].sort(), 'Shift + double click adds the chain');
    // two clicks on the same line slower than the pairing window are two clicks
    await click(app, 'rE2'); await click(app, 'rE2'); assert.deepStrictEqual(sel(st), ['rE2'], 'two slow clicks select one line');
    // a chain with an arc: double click the arc -> the arc, the line on its coincident start and the line on its shared end; not construction
    await dbl(app, 'A'); measured.arcChain = sel(st);
    assert.deepStrictEqual(sel(st), ['A', 'K1', 'K2'], 'a double click on the arc selects its chain (coincident and shared ends), no construction');
    await dbl(app, 'K2'); assert.deepStrictEqual(sel(st), ['A', 'K1', 'K2'], 'the same chain from its other end');
    await dbl(app, 'CN'); measured.constructionChain = sel(st);
    assert.deepStrictEqual(sel(st), ['CN'], 'a construction line chains only construction geometry');
    assert.strictEqual(residual(st) < 1e-6, true, 'nothing moved: the constraints hold');
  } finally { await app.close(); }
}

// ---- 1b. LOCKED / HIDDEN sketches: a chain never reaches into them; a locked chain is not selectable
{
  const L = rect('q', [0, 0, 30, 20], 'sketch-2');
  const doc = design(
    { ...L.joints, x0: [-30, 0], x1: [0.0, 0.0], h0: [-30, 0, false, 'sketch-3'], h1: [-50, 10, false, 'sketch-3'] },
    [...L.shapes, { id: 'X', type: 'line', joints: ['x0', 'x1'] }, { id: 'H', type: 'line', joints: ['h0', 'h1'], sketchId: 'sketch-3' }],
    [...L.constraints, { type: 'coincident', joints: ['x1', 'q1'] }, { type: 'coincident', joints: ['x0', 'h0'] }],
    [{ id: 'sketch-1', name: 'Sketch 1', visible: true }, { id: 'sketch-2', name: 'Locked', visible: true, locked: true }, { id: 'sketch-3', name: 'Hidden', visible: false }]);
  const app = await openDesign(doc, { x: -5, y: 5 });
  try {
    const st = app.state;
    await dbl(app, 'X'); measured.lockedHiddenChain = sel(st);
    assert.deepStrictEqual(sel(st), ['X'], 'the chain stops at a locked sketch and at a hidden sketch');
    await dbl(app, 'qE3'); measured.lockedEdge = sel(st);
    assert.deepStrictEqual(sel(st), [], 'a double click on a locked sketch\'s curve selects nothing');
  } finally { await app.close(); }
}

// ---- 2. MOVE A SELECTION
// The rectangle (H / V constraints and a width dimension: inside the selection) + the separate line S, selected. Unselected: line U whose
// end u1 is made coincident with S's end s2 and line P kept parallel to S (constraints to unselected geometry), and line W (not touched).
const MOVE_SCENE = () => {
  const R = rect('r', [0, 0, 40, 30]);
  return design(
    { ...R.joints, s1: [55, 0], s2: [70, 25], u1: [70, 25], u0: [90, 30], p1: [55, -25], p2: [64, -10], w1: [-20, -20], w2: [-10, -30] },
    [...R.shapes, { id: 'S', type: 'line', joints: ['s1', 's2'] }, { id: 'U', type: 'line', joints: ['u0', 'u1'] }, { id: 'P', type: 'line', joints: ['p1', 'p2'] }, { id: 'W', type: 'line', joints: ['w1', 'w2'] }],
    [...R.constraints, { type: 'distance', joints: ['r1', 'r2'], value: 40, driven: false }, { type: 'coincident', joints: ['u1', 's2'] }, { type: 'parallel', shapes: ['S', 'P'] }]);
};
const EDGES = ['rE1', 'rE2', 'rE3', 'rE4'];
const MEMBERS = ['r1', 'r2', 'r3', 'r4', 's1', 's2'];
// the selection made with clicks (a click, then Shift clicks; each on another line, so no two pair into a double click), so this part of the
// test does not depend on the double click
async function selectRectAndS(app) {
  await app.pause(PAIR_GAP_MS);
  ['rE1', 'rE2', 'rE3', 'rE4', 'S'].forEach((id, i) => { const p = on(app, id); app.click(p.x, p.y, i ? { shift: true } : undefined); });
  assert.deepStrictEqual(sel(app.state), [...EDGES, 'S'].sort(), 'the rectangle + S are selected');
  await app.pause(PAIR_GAP_MS); // the press that follows must not pair with the Shift click on S (that would be a double click)
}
// a real-pointer drag of the press point `a` (screen) by (dx, dy) px in 12 moves; returns the world displacement of the cursor
const dragBy = quiet(async (app, a, dx, dy) => {
  a = { x: Math.round(a.x), y: Math.round(a.y) }; // a pointer event's clientX / clientY are whole pixels
  const b = { x: a.x + dx, y: a.y + dy };
  app.drag(a, b, 12);
  const wa = screenToWorld(app.svg, a.x, a.y), wb = screenToWorld(app.svg, b.x, b.y);
  return { x: wb.x - wa.x, y: wb.y - wa.y };
});
{
  const app = await openDesign(MOVE_SCENE(), { x: 30, y: 0 });
  try {
    const st = app.state;
    await selectRectAndS(app);
    const all = [...MEMBERS, 'u0', 'u1', 'p1', 'p2', 'w1', 'w2'];
    const start = new Map(all.map((id) => [id, pos(st, id)]));
    const steps0 = app.report().journal.steps.length, n0 = st.constraints.length;
    const q = on(app, 'S', 0.5);
    app.move(q.x, q.y); app.down(q.x, q.y);
    measured.groupPress = { type: st.drag && st.drag.type, group: !!(st.drag && st.drag.group), joints: st.drag && st.drag.jointIds.length };
    assert.ok(st.drag && st.drag.group && st.drag.jointIds.length === MEMBERS.length, 'a press on a member of the selection starts a group drag of its ' + MEMBERS.length + ' joints');
    app.up(q.x, q.y); // released without a move: a click (asserted below); now the real drag
    await selectRectAndS(app);
    const d = await dragBy(app, q, 60, 40);
    const err = Math.max(...MEMBERS.map((id) => dist(pos(st, id), { x: start.get(id).x + d.x, y: start.get(id).y + d.y })));
    const steps = app.report().journal.steps.slice(steps0).map((s) => s.label);
    measured.groupMove = { cursor: d, worstMemberErrMm: err, residual: residual(st), u1OnS2: dist(pos(st, 'u1'), pos(st, 's2')), wMoved: Math.max(dist(pos(st, 'w1'), start.get('w1')), dist(pos(st, 'w2'), start.get('w2'))), constraints: [n0, st.constraints.length], steps };
    assert.ok(Math.hypot(d.x, d.y) > 5, 'the cursor moved several mm');
    assert.ok(err < 1e-3, 'every selected joint moved by the cursor displacement (worst ' + err + ' mm)');
    assert.ok(residual(st) < 1e-6, 'every constraint holds, inside the selection and to unselected geometry (' + residual(st) + ')');
    assert.ok(dist(pos(st, 'u1'), pos(st, 's2')) < 1e-6, 'the unselected line U stays on S (its coincident end followed)');
    assert.ok(measured.groupMove.wMoved < 1e-9, 'an unconnected unselected line does not move');
    assert.strictEqual(st.constraints.length, n0, 'a group move adds no constraint');
    assert.deepStrictEqual(sel(st), [...EDGES, 'S'].sort(), 'the selection is kept after the move');
    assert.ok(!st.drag && [...st.joints.values()].every((j) => !j.dragTarget), 'the drag ended and released every drag target (575)');
    assert.deepStrictEqual(steps, ['move selection'], 'ONE undo step "move selection"');
    const after = new Map(all.map((id) => [id, pos(st, id)]));
    app.undo();
    for (const id of all) assert.ok(dist(pos(st, id), start.get(id)) === 0, 'undo restores ' + id);
    app.redo();
    for (const id of all) assert.ok(dist(pos(st, id), after.get(id)) === 0, 'redo is identical for ' + id);

    // a click (no move) on a member of the selection selects it alone, as before
    await selectRectAndS(app); { const p = on(app, 'S', 0.5); app.click(p.x, p.y); }
    assert.deepStrictEqual(sel(st), ['S'], 'a click on a member of the selection selects it alone');
    // a press on an UNSELECTED shape: today's single (body) drag of that shape; the selection becomes that shape
    await selectRectAndS(app);
    const w0 = pos(st, 'w1'), r0 = pos(st, 'r1');
    { const p = on(app, 'W', 0.5); app.move(p.x, p.y); app.down(p.x, p.y); measured.unselectedPress = { body: !!(st.drag && st.drag.body), group: !!(st.drag && st.drag.group) }; assert.ok(st.drag && st.drag.body && !st.drag.group, 'a press on an unselected line starts its own body drag (538)'); app.up(p.x, p.y); }
    await selectRectAndS(app);
    { const p = on(app, 'W', 0.5); await dragBy(app, p, 30, 0); }
    assert.deepStrictEqual(sel(st), ['W'], 'the press on an unselected line replaced the selection');
    assert.ok(dist(pos(st, 'w1'), w0) > 1 && dist(pos(st, 'r1'), r0) === 0, 'only that line moved');
    // a single selected line dragged by its body: today's body drag (538), not a group drag
    await click(app, 'S'); await app.pause(PAIR_GAP_MS);
    { const p = on(app, 'S', 0.5); app.move(p.x, p.y); app.down(p.x, p.y); assert.ok(st.drag && st.drag.body && !st.drag.group, 'one selected line pressed by its body: the body drag'); app.up(p.x, p.y); }
  } finally { await app.close(); }
}

// ---- 2b. a HELD member: the rectangle's corner r1 fixed. getDragDOF (every cluster drag's rule) locks the whole group: nothing moves, no step.
{
  const doc = MOVE_SCENE();
  doc.geometry.joints = doc.geometry.joints.map(([id, j]) => [id, id === 'r1' ? { ...j, fixed: true } : j]);
  const app = await openDesign(doc, { x: 30, y: 0 });
  try {
    const st = app.state;
    await selectRectAndS(app);
    const all = [...MEMBERS, 'u0', 'u1'], start = new Map(all.map((id) => [id, pos(st, id)]));
    const steps0 = app.report().journal.steps.length;
    await dragBy(app, on(app, 'S', 0.5), 60, 40);
    const moved = Math.max(...all.map((id) => dist(pos(st, id), start.get(id))));
    measured.heldMember = { moved, steps: app.report().journal.steps.slice(steps0).map((s) => s.label) };
    assert.ok(moved === 0, 'a selection with a fixed member does not move (moved ' + moved + ' mm)');
    assert.deepStrictEqual(measured.heldMember.steps, [], 'a move that changed nothing leaves no undo step');
  } finally { await app.close(); }
}

console.log('chain-select-move-node.test.js: ok', JSON.stringify(measured));
