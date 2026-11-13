// tests/sketch-layers-node.test.js — TASK 577: sketches work like LAYERS in the shared Design tab: LOCK, MOVE TO SKETCH, REORDER, SOLO.
// Through the node test kit (tests/helpers/node-app.js): each host's own canvas code (pointer events, the ribbon, the autosave buffer) and
// the shared sketch panel (packages/ui/design-info-panel.js) on the same state. The real-pointer twins (a real drag, a real reorder drag in
// the tree) are tests/sketch-layers-live.test.js.

import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { addSketch, activateSketch, setSketchLocked, moveToSketch, moveSelectionToSketch, moveSketchBy, reorderSketch, soloSketch, isSoloed,
  lockedSketchIds, pickScene, isConstraintInert, constraintSketch, DEFAULT_SKETCH_ID } from '#core/sketch-model.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { contextMenuItems } from '#ui/context-menu.js';
import { ConstraintManager } from '#core/constraint-manager.js';

const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERT: ${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const rows = [];
const row = (s) => { rows.push(s); console.log('ROW ' + s); };

// a line straight into the engine (stamped with the ACTIVE sketch by the shared state, like a drawn one)
function addLine(app, x1, y1, x2, y2) {
  const e = app.engine; const a = e.genJ(), b = e.genJ();
  e.addJoint(a, x1, y1, false); e.addJoint(b, x2, y2, false);
  const id = 'L_' + a + '_' + b; e.addShape({ id, type: 'line', joints: [a, b] });
  return { id, a, b };
}
const shapeOf = (app, id) => app.state.shapes.find((s) => s.id === id);
const sketchIdOf = (app, id) => shapeOf(app, id).sketchId;
const jointXY = (app, id) => { const j = app.state.joints.get(id); return [j.x, j.y]; };

async function canvasChecks(host) {
  const profile = await createProfile();
  await createNamedDesign(profile, host);
  const app = await open({ host, profile });
  try {
    const S = app.state;
    // two sketches: A in Sketch 1, B in Sketch 2 (active), far apart on the canvas
    const A = addLine(app, 10, 10, 30, 10);
    const sk2 = addSketch(S, 'Plate'); activateSketch(S, sk2.id);
    const B = addLine(app, 10, 30, 30, 30);
    eq([sketchIdOf(app, A.id), sketchIdOf(app, B.id)], ['sketch-1', 'sketch-2'], host + ': lines stamped with the active sketch');
    app.frames(2);
    const mid = (l) => { const a = jointXY(app, l.a), b = jointXY(app, l.b); return app.toScreen((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); };

    // ---- SELECT works on an unlocked sketch, and is blocked on a locked one
    app.tool('select');
    app.click(mid(B).x, mid(B).y);
    assert(S.selectedShapes.has(B.id), host + ': unlocked sketch 2 line is selectable');
    app.esc(); S.selectedShapes.clear(); S.selectedJoints.clear();
    let r = setSketchLocked(S, 'sketch-2', true);
    assert(r.ok && S.activeSketchId === 'sketch-1', host + ': locking the active sketch moves the active one to an unlocked sketch: ' + JSON.stringify(r));
    app.click(mid(B).x, mid(B).y);
    assert(!S.selectedShapes.has(B.id) && S.selectedShapes.size === 0, host + ': a click on a LOCKED sketch line selects nothing');
    app.click(app.toScreen(10, 30).x, app.toScreen(10, 30).y);
    assert(S.selectedJoints.size === 0, host + ': a click on a LOCKED sketch point selects nothing');
    row(`${host} select: unlocked line selected; locked line + locked point NOT selected`);

    // ---- DRAG is blocked: a drag on the locked line and on its end point moves nothing
    const before = JSON.stringify([jointXY(app, B.a), jointXY(app, B.b)]);
    const pa = app.toScreen(...jointXY(app, B.a));
    app.drag(pa, { x: pa.x + 60, y: pa.y + 40 });
    const m = mid(B); app.drag(m, { x: m.x + 50, y: m.y - 40 });
    eq(JSON.stringify([jointXY(app, B.a), jointXY(app, B.b)]), before, host + ': a drag on a locked sketch moves nothing');
    // while the same drag on the UNLOCKED sketch moves
    const a0 = jointXY(app, A.a); const pA = app.toScreen(...a0);
    app.drag(pA, { x: pA.x + 40, y: pA.y + 40 });
    assert(jointXY(app, A.a)[0] !== a0[0] || jointXY(app, A.a)[1] !== a0[1], host + ': the unlocked sketch point still drags');
    row(`${host} drag: locked point + locked line unchanged ${before}; unlocked point moved`);

    // ---- DELETE is blocked: through a click selection (nothing selected), and a selection forced into the state
    S.selectedShapes.add(B.id); S.selectedJoints.add(B.a);
    app.key('Delete');
    assert(shapeOf(app, B.id) && S.joints.has(B.a), host + ': Delete does not remove a locked sketch shape / point, even when selected some other way');
    S.selectedShapes.clear(); S.selectedJoints.clear();
    row(`${host} delete: forced selection of a locked shape + point, Delete keeps both`);

    // ---- DRAW cannot go into a locked sketch: the active sketch is never locked, a drawn line snaps to the locked line's place but shares nothing
    assert(activateSketch(S, 'sketch-2') === 'sketch-1', host + ': activating a locked sketch is refused');
    const nShapes = S.shapes.length, nCons = S.constraints.length, nJoints = S.joints.size;
    app.tool('line');
    const endB = app.toScreen(...jointXY(app, B.b));
    app.click(endB.x, endB.y);                          // first point ON the locked line's end point
    app.click(endB.x + 120, endB.y + 5);                // second point
    app.esc(); app.tool('select');
    assert(S.shapes.length === nShapes + 1, host + ': the line tool drew one line: ' + (S.shapes.length - nShapes));
    const drawn = S.shapes[S.shapes.length - 1];
    assert(drawn.sketchId === 'sketch-1', host + ': the drawn line is in the ACTIVE (unlocked) sketch: ' + drawn.sketchId);
    assert(!drawn.joints.includes(B.a) && !drawn.joints.includes(B.b), host + ': the drawn line shares no point with the locked sketch');
    const touchesLocked = S.constraints.slice(nCons).filter((c) => (c.joints || []).some((id) => id === B.a || id === B.b) || (c.shapes || []).includes(B.id) || c.shape === B.id);
    assert(touchesLocked.length === 0, host + ': no constraint ties the drawn line to the locked sketch (its own auto-horizontal is allowed): ' + JSON.stringify(touchesLocked));
    eq(JSON.stringify([jointXY(app, B.a), jointXY(app, B.b)]), before, host + ': the locked line did not move when a line was drawn on it');
    const p0 = jointXY(app, drawn.joints[0]); const wantB = jointXY(app, B.b);
    assert(Math.hypot(p0[0] - wantB[0], p0[1] - wantB[1]) < 1e-6, host + ': the drawn line starts exactly ON the locked point (a snap target): ' + JSON.stringify(p0) + ' vs ' + JSON.stringify(wantB));
    row(`${host} draw: new line in sketch-1, starts at the locked point's place (${p0.map((n) => n.toFixed(3))}), shares no point, ${S.constraints.length - nCons} new constraint(s), none on the locked sketch`);

    // ---- one undo step per toggle (and the active sketch change rides along)
    const sketches0 = JSON.stringify(S.sketches);
    S.saveState && void 0;
    setSketchLocked(S, 'sketch-2', false);
    assert(!S.sketches.find((s) => s.id === 'sketch-2').locked, host + ': unlock clears the flag');
    app.undo();
    assert(S.sketches.find((s) => s.id === 'sketch-2').locked === true, host + ': ONE undo puts the lock back: ' + JSON.stringify(S.sketches));
    app.redo();
    assert(!S.sketches.find((s) => s.id === 'sketch-2').locked, host + ': redo unlocks again');
    row(`${host} undo: unlock then Ctrl+Z = locked again, Ctrl+Y = unlocked`);
  } finally { await app.close(); }
}

for (const host of ['sketchstudio', 'shaper', 'penplotter']) await canvasChecks(host);

// ---------------------------------------------------------------- hidden = not pickable, solo, reorder, move, round trips (one host: the model is shared)
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper');
  const app = await open({ host: 'shaper', profile });
  try {
    const S = app.state;
    const A = addLine(app, 10, 10, 30, 10);
    const sk2 = addSketch(S, 'Plate'); activateSketch(S, sk2.id); const B = addLine(app, 10, 30, 30, 30);
    const sk3 = addSketch(S, 'Holes'); activateSketch(S, sk3.id); const C = addLine(app, 10, 50, 30, 50);
    app.frames(2);
    const mid = (l) => { const a = jointXY(app, l.a), b = jointXY(app, l.b); return app.toScreen((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); };

    // ---- SOLO: hides the others; the second call restores the previous visibility exactly (one sketch was hidden before)
    sk3.visible = false; // Holes hidden before the solo
    const vis0 = S.sketches.map((s) => s.visible);
    assert(soloSketch(S, 'sketch-2') && eq(S.sketches.map((s) => s.visible), [false, true, false], 'solo shows only Plate') === undefined, 'solo');
    assert(isSoloed(S, 'sketch-2'), 'isSoloed');
    app.undo(); eq(S.sketches.map((s) => s.visible), vis0, 'ONE undo reverts the solo');
    app.redo(); eq(S.sketches.map((s) => s.visible), [false, true, false], 'redo re-solos');
    soloSketch(S, 'sketch-2');
    eq(S.sketches.map((s) => s.visible), vis0, 'the second solo click restores the previous visibility EXACTLY (Holes stays hidden)');
    assert(!S.soloMemory, 'memory cleared');
    row(`solo: [v,v,h] -> only Plate -> restored ${JSON.stringify(vis0)}; undo/redo each one step`);
    // not saved: the session memory is not in the document; after a reload the second click shows all
    const d = serializeDocument(S);
    assert(!('soloMemory' in d.geometry) && !JSON.stringify(d).includes('soloMemory'), 'solo memory is not saved');
    soloSketch(S, 'sketch-2'); S.soloMemory = null; soloSketch(S, 'sketch-2');
    eq(S.sketches.map((s) => s.visible), [true, true, true], 'no memory (after a reload): the second click shows all');
    S.sketches[2].visible = false;

    // ---- HIDDEN sketches are not pickable (task: "stay unpickable")
    app.tool('select');
    app.click(mid(C).x, mid(C).y);
    assert(S.selectedShapes.size === 0, 'a click on a hidden sketch line selects nothing');
    S.sketches[2].visible = true;
    app.click(mid(C).x, mid(C).y); assert(S.selectedShapes.has(C.id), 'shown again: selectable'); S.selectedShapes.clear();
    row('hidden: a click on a hidden sketch selects nothing; shown again it selects');

    // ---- REORDER: saved order + undo
    eq(S.sketches.map((s) => s.id), ['sketch-1', 'sketch-2', 'sketch-3'], 'start order');
    assert(moveSketchBy(S, 'sketch-3', -1), 'move up'); eq(S.sketches.map((s) => s.id), ['sketch-1', 'sketch-3', 'sketch-2'], 'moved up');
    app.undo(); eq(S.sketches.map((s) => s.id), ['sketch-1', 'sketch-2', 'sketch-3'], 'ONE undo reverts the reorder');
    assert(reorderSketch(S, 'sketch-1', 2), 'reorder to the end'); eq(S.sketches.map((s) => s.id), ['sketch-2', 'sketch-3', 'sketch-1'], 'reordered');
    assert(!moveSketchBy(S, 'sketch-2', -1), 'cannot move above the top');
    app.frames(2);
    const saved = await app.storedDoc();
    eq(saved.geometry.sketches.map((s) => s.id), ['sketch-2', 'sketch-3', 'sketch-1'], 'the order is in the saved document');
    row(`reorder: ${JSON.stringify(saved.geometry.sketches.map((s) => s.id))} saved; undo one step`);
    reorderSketch(S, 'sketch-1', 0);

    // ---- LOCK saved + loaded, byte-identical round trip
    setSketchLocked(S, 'sketch-3', true);
    const doc = serializeDocument(S); const text = JSON.stringify(doc);
    eq(doc.geometry.sketches.find((s) => s.id === 'sketch-3').locked, true, 'locked is saved');
    assert(doc.geometry.sketches.filter((s) => s.id !== 'sketch-3').every((s) => !('locked' in s)), 'an unlocked sketch carries no locked key');
    assert(deserializeDocument(JSON.parse(text), S).ok, 'load');
    assert(JSON.stringify(serializeDocument(S)) === text, 'save -> load -> save is byte-identical (lock + order)');
    eq([...lockedSketchIds(S)], ['sketch-3'], 'lock survives a load');
    row(`lock round trip: ${text.length} bytes identical`);
    setSketchLocked(S, 'sketch-3', false);

    // ---- MOVE TO SKETCH
    // 1) nothing ties it to anything: moves, joints with it, one undo step
    activateSketch(S, 'sketch-3'); const D = addLine(app, 40, 10, 60, 10);
    assert(sketchIdOf(app, D.id) === S.activeSketchId, 'D in the active sketch');
    S.selectedShapes.add(D.id);
    let res = moveSelectionToSketch(S, 'sketch-2');
    assert(res.ok && res.shapes === 1 && res.joints === 2, 'moved: ' + JSON.stringify(res));
    eq([sketchIdOf(app, D.id), S.joints.get(D.a).sketchId, S.joints.get(D.b).sketchId], ['sketch-2', 'sketch-2', 'sketch-2'], 'shape + joints now in Plate');
    app.undo(); eq(sketchIdOf(app, D.id), 'sketch-3', 'ONE undo moves it back');
    app.redo(); eq(sketchIdOf(app, D.id), 'sketch-2', 'redo moves it again');
    // 2) a dimension whose operands ALL move goes with them
    ConstraintManager.createConstraint(S, 'distance', { joints: [D.a, D.b], value: 20 }, { source: 'test' });
    S.selectedShapes.clear(); S.selectedShapes.add(D.id);
    const nC = S.constraints.length;
    res = moveSelectionToSketch(S, 'sketch-1');
    assert(res.ok && res.constraints === 1 && S.constraints.length === nC, 'the dimension goes along: ' + JSON.stringify(res));
    // 3) a constraint tying the moving shape to a shape that stays: REFUSED, nothing changes, no undo step
    ConstraintManager.createConstraint(S, 'parallel', { shapes: [D.id, A.id] }, { source: 'test' });
    const snap = JSON.stringify(serializeDocument(S)); const hist = S.history.length;
    S.selectedShapes.clear(); S.selectedShapes.add(D.id);
    res = moveSelectionToSketch(S, 'sketch-2');
    assert(!res.ok && /constraint/.test(res.reason), 'refused: ' + JSON.stringify(res));
    assert(JSON.stringify(serializeDocument(S)) === snap && S.history.length === hist, 'a refused move changes nothing and records no undo step');
    // 4) locked source / locked target
    setSketchLocked(S, 'sketch-3', true);
    res = moveToSketch(S, { shapeIds: [C.id] }, 'sketch-2'); assert(!res.ok, 'a shape of a locked sketch is not moved: ' + JSON.stringify(res));
    res = moveToSketch(S, { shapeIds: [D.id] }, 'sketch-3'); assert(!res.ok, 'moving INTO a locked sketch is refused');
    row('move: plain move 1 undo step; dimension with all operands goes along; split constraint refused, state + history unchanged; locked source/target refused');
  } finally { await app.close(); }
}

// ---------------------------------------------------------------- STEP 0: how constraints behave ACROSS sketches today (unchanged by this task)
{
  const app = await open({ host: 'shaper', profile: await createProfile() });
  try {
    const S = app.state;
    const A = addLine(app, 0, 10, 20, 10);
    const sk2 = addSketch(S, 'Plate'); activateSketch(S, sk2.id); const B = addLine(app, 0, 30, 20, 30);
    const ok = ConstraintManager.createConstraint(S, 'coincident', { joints: [A.b, B.a] }, { source: 'test' });
    const c = S.constraints[S.constraints.length - 1];
    const cs = constraintSketch(c, S);
    assert(ok && c && cs instanceof Set && cs.has('sketch-1') && cs.has('sketch-2'), 'a constraint CAN join entities of two sketches today (constraintSketch = the spanning Set): ' + JSON.stringify(cs && [...cs]));
    // locking one side puts the constraint out of reach (it is not pickable / deletable), and a move that would split it is refused
    setSketchLocked(S, 'sketch-2', true);
    const inert = pickScene(S).inert;
    assert(isConstraintInert(inert, c), 'a cross-sketch constraint with one locked operand cannot be picked');
    row('step 0: constraintSketch of a cross-sketch coincident = Set ' + JSON.stringify([...cs]) + '; with one side locked it is out of reach');
  } finally { await app.close(); }
}

// ---------------------------------------------------------------- OLD files load unchanged (a fixture saved by origin/main 14ba754, before this task)
{
  const raw = fs.readFileSync(new URL('./fixtures/pre-577-two-sketches.document.json', import.meta.url), 'utf8');
  const profile = await createProfile();
  const app = await open({ host: 'shaper', profile });
  try {
    assert(deserializeDocument(JSON.parse(raw), app.state).ok, 'the pre-577 file loads');
    const S = app.state;
    eq(S.sketches.map((s) => [s.id, s.name, s.visible]), [['sketch-1', 'Sketch 1', true], ['sketch-2', 'Plate', true], ['sketch-3', 'Holes', false]], 'sketches as saved');
    assert(lockedSketchIds(S).size === 0, 'no sketch is locked');
    // the host's state also carries profiles / parameters / vcarves, which the headless state that made the fixture did not: compare every key the OLD file has
    const again = JSON.parse(JSON.stringify(serializeDocument(S))), old = JSON.parse(raw);
    for (const k of Object.keys(old.geometry)) eq(again.geometry[k], old.geometry[k], 'geometry.' + k + ' re-saved equals the pre-577 file');
    assert(JSON.stringify(again.geometry.sketches).includes('locked') === false, 'no locked key appears in a re-saved old file');
    row('old file: loads with no locked sketch; every key of the pre-577 file re-saves equal (joints, shapes, constraints, sketches, activeSketchId)');
  } finally { await app.close(); }
}

// ---------------------------------------------------------------- the PANEL (shared): the controls per host, and each control drives the model
{
  const results = {};
  // host -> does its page mount the sketch tree? (read from the host's own source: showSketchTree: true at the createDesignInfoPanel call)
  const declared = { sketchstudio: fs.readFileSync(new URL('../apps/sketchstudio/main.js', import.meta.url), 'utf8'), trace: fs.readFileSync(new URL('../apps/trace/src/app.js', import.meta.url), 'utf8'),
    shaper: fs.readFileSync(new URL('../apps/shaper/src/main.js', import.meta.url), 'utf8'), penplotter: fs.readFileSync(new URL('../apps/penplotter/src/sketch-stage.js', import.meta.url), 'utf8') };
  const CONTROLS = ['.sk-tree-add', '.sk-tree-move', '.sk-sketch-grip', '.sk-sketch-up', '.sk-sketch-down', '.sk-sketch-solo', '.sk-sketch-lock', '.sk-sketch-eye'];
  for (const host of ['shaper', 'penplotter']) {
    const profile = await createProfile();
    const app = await open({ host, profile });
    try {
      const S = app.state; const doc = app.document;
      assert(/showSketchTree:\s*true/.test(declared[host]), host + ' declares the sketch tree');
      const addL = (x, y) => addLine(app, x, y, x + 20, y);
      addL(0, 10); const sk2 = addSketch(S, 'Plate'); activateSketch(S, sk2.id); const B = addL(0, 30); const sk3 = addSketch(S, 'Holes'); activateSketch(S, sk3.id); addL(0, 50);
      const panel = createDesignInfoPanel({ state: S, engine: app.engine, showSketchTree: true });
      const holder = doc.createElement('div'); doc.body.appendChild(holder); panel.render(holder);
      results[host] = Object.fromEntries(CONTROLS.map((c) => [c, holder.querySelectorAll(c).length]));
      eq(results[host], { '.sk-tree-add': 1, '.sk-tree-move': 1, '.sk-sketch-grip': 3, '.sk-sketch-up': 3, '.sk-sketch-down': 3, '.sk-sketch-solo': 3, '.sk-sketch-lock': 3, '.sk-sketch-eye': 3 }, host + ' panel controls');
      const node = (id) => holder.querySelector(`.sk-sketch-node[data-sketch-id="${id}"]`);
      const names = () => [...holder.querySelectorAll('.sk-sketch-node .sk-sketch-name')].map((n) => n.textContent);
      // lock button: locks sketch 2; the active sketch (3) is untouched
      node('sketch-2').querySelector('.sk-sketch-lock').click();
      assert(S.sketches[1].locked === true && node('sketch-2').classList.contains('is-locked'), host + ': lock button locks + marks the node');
      assert(node('sketch-2').querySelector('.sk-sketch-lock').textContent === '🔒', host + ': lock icon');
      // lock the ACTIVE sketch via the panel: the active one moves away; the last unlocked cannot be locked
      node('sketch-3').querySelector('.sk-sketch-lock').click(); eq(S.activeSketchId, 'sketch-1', host + ': locking the active sketch hands activation to an unlocked one');
      node('sketch-1').querySelector('.sk-sketch-lock').click(); assert(S.sketches[0].locked !== true, host + ': the last unlocked sketch cannot be locked');
      node('sketch-3').querySelector('.sk-sketch-lock').click(); node('sketch-2').querySelector('.sk-sketch-lock').click();
      assert(lockedSketchIds(S).size === 0, host + ': unlocked again');
      // clicking a locked sketch's head does not activate it
      node('sketch-2').querySelector('.sk-sketch-lock').click(); node('sketch-2').querySelector('.sk-sketch-head').click();
      assert(S.activeSketchId !== 'sketch-2', host + ': a locked sketch is not activated by a click'); node('sketch-2').querySelector('.sk-sketch-lock').click();
      // up / down
      node('sketch-3').querySelector('.sk-sketch-up').click(); eq(S.sketches.map((s) => s.id), ['sketch-1', 'sketch-3', 'sketch-2'], host + ': up button');
      assert(node('sketch-1').querySelector('.sk-sketch-up').disabled && holder.querySelectorAll('.sk-sketch-down')[2].disabled, host + ': up disabled at the top, down at the bottom');
      eq(names(), ['Sketch 1', 'Holes', 'Plate'], host + ': the tree shows the new order');
      node('sketch-3').querySelector('.sk-sketch-down').click(); eq(S.sketches.map((s) => s.id), ['sketch-1', 'sketch-2', 'sketch-3'], host + ': down button');
      // solo button: on, then off
      node('sketch-2').querySelector('.sk-sketch-solo').click(); eq(S.sketches.map((s) => s.visible), [false, true, false], host + ': solo button');
      assert(node('sketch-2').querySelector('.sk-sketch-solo').classList.contains('on'), host + ': solo marked');
      node('sketch-2').querySelector('.sk-sketch-solo').click(); eq(S.sketches.map((s) => s.visible), [true, true, true], host + ': solo again restores');
      // move selection select
      S.selectedShapes.add(B.id);
      const sel = holder.querySelector('.sk-tree-move');
      eq([...sel.options].map((o) => o.value), ['', 'sketch-1', 'sketch-2', 'sketch-3'], host + ': move targets');
      sel.value = 'sketch-1'; sel.dispatchEvent(new app.window.Event('change', { bubbles: true }));
      eq(sketchIdOf(app, B.id), 'sketch-1', host + ': the panel moves the selection');
      // the context-menu items are the same list
      const items = contextMenuItems('geometry', { target: { kind: 'shape', id: B.id }, actions: { lockState: () => ({ locked: false }), toggleLock() {}, deleteSelection() {}, sketchTargets: () => S.sketches, moveToSketch(id) { S.__moved = id; } } });
      eq(items.filter((i) => i.id.startsWith('geo-move-')).map((i) => i.label), ['Move to sketch ▸ Sketch 1', 'Move to sketch ▸ Plate', 'Move to sketch ▸ Holes'], host + ': context menu move items');
      items.find((i) => i.id === 'geo-move-sketch-3').onSelect(); eq(S.__moved, 'sketch-3', host + ': menu item runs moveToSketch'); delete S.__moved;
      panel.destroy();
    } finally { await app.close(); }
  }
  results.sketchstudio = { tree: /showSketchTree:\s*true/.test(declared.sketchstudio) ? 'yes' : 'NO sketch tree mounted' };
  results.trace = { tree: /showSketchTree:\s*true/.test(declared.trace) ? 'yes' : 'NO sketch tree mounted' };
  row('panel controls per host: ' + JSON.stringify(results));
}

console.log('SKETCH-LAYERS-NODE OK (' + rows.length + ' rows)');
