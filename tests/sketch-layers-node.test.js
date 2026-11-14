// tests/sketch-layers-node.test.js — TASK 577: sketches work like LAYERS in the shared Design tab: LOCK, MOVE TO SKETCH, REORDER, SHOW ONLY.
// Through the node test kit (tests/helpers/node-app.js): each host's own canvas code (pointer events, the ribbon, the autosave buffer) and
// the shared sketch panel (packages/ui/design-info-panel.js) on the same state. The real-pointer twins (a real drag, a real reorder drag in
// the tree) are tests/sketch-layers-live.test.js.

import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { addSketch, activateSketch, setSketchLocked, moveToSketch, moveSelectionToSketch, moveSketchBy, reorderSketch, showOnlySketch,
  lockedSketchIds, moveTargets, moveSelectionToNewSketch, pickScene, isConstraintInert, constraintSketch, DEFAULT_SKETCH_ID } from '#core/sketch-model.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { contextMenuItems } from '#ui/context-menu.js';
import { mountDesignBrowser } from '#ui/design-browser.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { updateViewBox } from '#ui/input-manager.js';

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
    // TASK 583: the Pen Plotter node host is now the real stages, whose Design view frames the whole 200 mm paper (about 3.5 px per unit); this test's pixel offsets
    // (a 5 px dy to the second point, the grid snap reach in px) were written for the 120-unit-wide view Shaper opens with, so Pen Plotter starts from that same view
    if (host === 'penplotter') { Object.assign(S.view, { x: 0, y: 0, w: 120 }); updateViewBox(app.svg, S.view); app.frames(2); }
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
    app.click(endB.x + 120, endB.y + 40);               // second point
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

    // ---- SHOW ONLY THIS SKETCH is NOT a mode: it sets visible=false on every other sketch (plain eye toggles), nothing is remembered
    sk3.visible = false; // Holes hidden before
    const vis0 = S.sketches.map((s) => s.visible);
    assert(showOnlySketch(S, 'sketch-2'), 'show only');
    eq(S.sketches.map((s) => s.visible), [false, true, false], 'show only: Plate visible, every other sketch hidden');
    app.undo(); eq(S.sketches.map((s) => s.visible), vis0, 'ONE undo reverts it (as an eye toggle)');
    app.redo(); eq(S.sketches.map((s) => s.visible), [false, true, false], 'redo re-applies it');
    showOnlySketch(S, 'sketch-2');
    eq(S.sketches.map((s) => s.visible), [false, true, false], 'a second call changes nothing: no "show all again", no restore');
    assert(!('soloMemory' in S) && !JSON.stringify(serializeDocument(S)).includes('solo'), 'no solo memory exists, in the session or in the saved document');
    row(`show only this sketch: ${JSON.stringify(vis0)} -> only Plate (others visible=false); undo/redo one step each; no memory`);
    S.sketches.forEach((s) => { s.visible = true; });
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

// ---------------------------------------------------------------- the PANEL (shared): the same row controls in ALL FOUR hosts, and each drives the model
{
  const results = {};
  // How each host mounts the tree (read from the host's own source): all four through the ONE shared mount (#ui/design-browser.js, task 586,
  // which sets showSketchTree: true).
  const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const declared = { sketchstudio: src('apps/sketchstudio/design-canvas.js'), trace: src('apps/trace/src/edit-view.js'), shaper: src('apps/shaper/src/design-canvas.js'), // TASK 610: SketchStudio's and Shaper's mounts moved from main.js into design-canvas.js (mountStudioBrowser / mountShaperBrowser)
    penplotter: src('apps/penplotter/src/sketch-stage.js') };
  assert(/showSketchTree:\s*true/.test(src('packages/ui/design-browser.js')), 'the shared browser mount opts into the tree');
  for (const host of ['sketchstudio', 'trace', 'shaper', 'penplotter']) assert(/mountDesignBrowser\(/.test(declared[host]), host + ' mounts the sketch tree through mountDesignBrowser');
  // Trace has no node-kit host (its Edit tab is the same createDesignInfoPanel on the same sketch state); its real page is in sketch-layers-live.test.js
  const CONTROLS = ['.sk-tree-add', '.sk-sketch-eye', '.sk-sketch-icon', '.sk-sketch-name', '.sk-sketch-radio'];
  const GONE = ['.sk-sketch-grip', '.sk-sketch-up', '.sk-sketch-down', '.sk-sketch-solo', '.sk-sketch-lock', '.sk-tree-move', 'select'];
  const WANT = { '.sk-tree-add': 1, '.sk-sketch-eye': 3, '.sk-sketch-icon': 3, '.sk-sketch-name': 3, '.sk-sketch-radio': 3 };
  for (const host of ['shaper', 'penplotter', 'sketchstudio']) {
    const profile = await createProfile();
    const app = await open({ host, profile });
    try {
      const S = app.state; const doc = app.document; const win = doc.defaultView;
      const addL = (x, y) => addLine(app, x, y, x + 20, y);
      const A = addL(0, 10); const sk2 = addSketch(S, 'Plate'); activateSketch(S, sk2.id); const B = addL(0, 30); const sk3 = addSketch(S, 'Holes'); activateSketch(S, sk3.id); const C = addL(0, 50);
      const holder = doc.createElement('div'); doc.body.appendChild(holder);
      let panel;
      if (host === 'sketchstudio') { const side = mountDesignBrowser({ container: holder, state: S, engine: app.engine }); panel = side.panel; }
      else { panel = createDesignInfoPanel({ state: S, engine: app.engine, showSketchTree: true }); panel.render(holder); }
      results[host] = Object.fromEntries(CONTROLS.map((c) => [c, holder.querySelectorAll(c).length]));
      eq(results[host], WANT, host + ' panel controls');
      eq(Object.fromEntries(GONE.map((c) => [c, holder.querySelectorAll(c).length])), Object.fromEntries(GONE.map((c) => [c, 0])), host + ': no grip, up/down, solo, lock buttons, no select');
      assert(![...holder.querySelectorAll('.sk-sketch-head, .sk-tree-hdr')].some((h) => /[🌀-🫿☀-➿◎◉◌⠇▴▾]/u.test(h.textContent)), host + ': no emoji or glyph icon in the sketch rows');
      const node = (id) => holder.querySelector(`.sk-sketch-node[data-sketch-id="${id}"]`);
      const names = () => [...holder.querySelectorAll('.sk-sketch-node .sk-sketch-name')].map((n) => n.textContent);
      const ctx = (id) => { node(id).querySelector('.sk-sketch-head').dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 })); };
      const menuItems = () => [...doc.querySelectorAll('.sk-context-menu .sk-context-item')].map((r) => r.dataset.id + '=' + r.textContent.replace('✓', '').trim());
      const pick = (itemId) => { doc.querySelector(`.sk-context-menu .sk-context-item[data-id="${itemId}"]`).click(); };

      // ROW parts: eye (inline SVG), sketch icon (inline SVG), name = plain text (not a button), radio on the right
      const n1 = node('sketch-1').querySelector('.sk-sketch-head');
      eq([...n1.children].filter((c) => !c.classList.contains('sk-sketch-tw')).map((c) => c.className.split(' ')[0]), ['sk-sketch-eye', 'sk-sketch-icon', 'sk-sketch-name', 'sk-sketch-radio'], host + ': row order eye, icon, name, radio');
      assert(n1.querySelector('.sk-sketch-eye svg') && n1.querySelector('.sk-sketch-icon svg') && n1.querySelector('.sk-sketch-name').tagName === 'SPAN', host + ': inline SVG icons; the name is plain text');
      assert(/.sk-sketch-lockbadge {[^}]*background: #7c3aed/.test(src('packages/ui/design-info-panel.js')), host + ': the lock badge is purple (#7c3aed), not red');

      // RADIO: the active sketch (3) is filled; a click on an empty radio activates; the NAME and the row do not
      eq(holder.querySelectorAll('.sk-sketch-radio[aria-checked="true"]').length, 1, host + ': one filled radio');
      assert(node('sketch-3').querySelector('.sk-sketch-radio').getAttribute('aria-checked') === 'true', host + ': the active sketch has the filled radio');
      node('sketch-1').querySelector('.sk-sketch-name').click(); node('sketch-1').querySelector('.sk-sketch-head').click();
      eq(S.activeSketchId, 'sketch-3', host + ': clicking the name / row does not activate');
      node('sketch-2').querySelector('.sk-sketch-radio').click(); eq(S.activeSketchId, 'sketch-2', host + ': clicking an empty radio activates that sketch');
      node('sketch-3').querySelector('.sk-sketch-radio').click(); eq(S.activeSketchId, 'sketch-3', host + ': and back');

      // RIGHT-CLICK menu: Lock / Unlock, Show only this sketch, Rename, Delete
      ctx('sketch-2');
      eq(menuItems(), ['sk-lock=Lock', 'sk-only=Show only this sketch', 'sk-rename=Rename', 'sk-delete=Delete'], host + ': the row menu');
      pick('sk-lock');
      assert(S.sketches[1].locked === true && node('sketch-2').classList.contains('is-locked'), host + ': Lock locks + marks the node');
      assert(node('sketch-2').querySelector('.sk-sketch-lockbadge') && !node('sketch-1').querySelector('.sk-sketch-lockbadge'), host + ': the purple badge is on the locked sketch icon only');
      assert(node('sketch-2').querySelector('.sk-sketch-radio').disabled, host + ': the radio of a locked sketch is disabled');
      node('sketch-2').querySelector('.sk-sketch-radio').click(); assert(S.activeSketchId !== 'sketch-2', host + ': a locked sketch cannot be activated');
      ctx('sketch-2'); eq(menuItems()[0], 'sk-lock=Unlock', host + ': the menu now offers Unlock'); pick('sk-lock');
      assert(S.sketches[1].locked !== true && !node('sketch-2').querySelector('.sk-sketch-lockbadge'), host + ': Unlock removes the lock and the badge');
      // locking the ACTIVE sketch hands activation on; the last unlocked sketch cannot be locked
      ctx('sketch-3'); pick('sk-lock'); eq(S.activeSketchId, 'sketch-2', host + ': locking the active (last) sketch hands activation to the previous unlocked one');
      ctx('sketch-2'); pick('sk-lock'); ctx('sketch-1'); pick('sk-lock'); assert(S.sketches[0].locked !== true, host + ': the last unlocked sketch cannot be locked');
      ctx('sketch-3'); pick('sk-lock'); ctx('sketch-2'); pick('sk-lock'); assert(lockedSketchIds(S).size === 0, host + ': all unlocked again');

      // EYE: a plain toggle, ONE undo step (eye toggles were undo steps before this task, through the panel's saveState; kept, now via recordUndo)
      const h0 = S.history.length;
      node('sketch-1').querySelector('.sk-sketch-eye').click(); eq(S.sketches[0].visible, false, host + ': the eye hides'); eq(S.history.length, h0 + 1, host + ': an eye toggle is one undo step');
      app.undo(); eq(S.sketches[0].visible !== false, true, host + ': undo shows it again');
      // SHOW ONLY THIS SKETCH: the others' visible=false, nothing else (no banner, no restore memory)
      ctx('sketch-2'); pick('sk-only'); eq(S.sketches.map((s) => s.visible), [false, true, false], host + ': Show only this sketch = the others visible false');
      assert(!/show all|only this/i.test(holder.textContent), host + ': no banner, no "show all again"');
      node('sketch-1').querySelector('.sk-sketch-eye').click(); node('sketch-3').querySelector('.sk-sketch-eye').click();
      eq(S.sketches.map((s) => s.visible), [true, true, true], host + ': the eyes bring the sketches back (plain toggles)');

      // RENAME from the menu: the inline field, Enter saves, one undo step
      ctx('sketch-2'); pick('sk-rename');
      const inp = holder.querySelector('.sk-sketch-rename'); assert(inp, host + ': Rename opens the inline field');
      inp.value = 'Base'; inp.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      eq(S.sketches[1].name, 'Base', host + ': renamed'); app.undo(); eq(S.sketches[1].name, 'Plate', host + ': one undo reverts the rename');

      // DRAG-REORDER by the NAME: a mouse drag of Holes above Sketch 1 (rects stubbed: happy-dom has no layout), one undo step
      const nodesEls = [...holder.querySelectorAll('.sk-sketch-node')];
      nodesEls.forEach((n, i) => { n.getBoundingClientRect = () => ({ top: i * 30, height: 30, bottom: i * 30 + 30, left: 0, right: 100, width: 100, x: 0, y: i * 30 }); });
      const nm = node('sketch-3').querySelector('.sk-sketch-name'); const hR = S.history.length;
      const ptr = (type, y, tgt = nm) => tgt.dispatchEvent(new win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: 20, clientY: y, pointerId: 7, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      ptr('pointerdown', 75); ptr('pointermove', 60); ptr('pointermove', 10); assert(node('sketch-1').classList.contains('drop-before'), host + ': a blue insertion line while dragging'); ptr('pointerup', 10);
      eq(S.sketches.map((s) => s.id), ['sketch-3', 'sketch-1', 'sketch-2'], host + ': dragging the name reordered'); eq(S.history.length, hR + 1, host + ': one undo step');
      eq(names(), ['Holes', 'Sketch 1', 'Plate'], host + ': the tree shows the new order'); app.undo();
      eq(S.sketches.map((s) => s.id), ['sketch-1', 'sketch-2', 'sketch-3'], host + ': undo restores the order');
      // a click on the name (no movement) neither reorders nor activates
      const nm2 = node('sketch-1').querySelector('.sk-sketch-name'); ptr('pointerdown', 15, nm2); ptr('pointerup', 15, nm2);
      eq(S.sketches.map((s) => s.id), ['sketch-1', 'sketch-2', 'sketch-3'], host + ': a click on the name reorders nothing');

      // DELETE from the menu: the sketch and its geometry go in ONE undo step; a locked sketch refuses; the only sketch refuses
      const nShapes = S.shapes.length, hD = S.history.length;
      ctx('sketch-3'); pick('sk-delete');
      eq(S.sketches.map((s) => s.id), ['sketch-1', 'sketch-2'], host + ': Delete removed the sketch'); assert(!shapeOf(app, C.id) && S.shapes.length === nShapes - 1, host + ': its line went with it');
      assert(S.activeSketchId !== 'sketch-3', host + ': the active sketch moved off the deleted one'); eq(S.history.length, hD + 1, host + ': one undo step');
      app.undo(); eq(S.sketches.length, 3, host + ': undo brings the sketch back'); assert(shapeOf(app, C.id), host + ': and its line');
      setSketchLocked(S, 'sketch-2', true); ctx('sketch-2'); pick('sk-delete'); assert(S.sketches.some((s) => s.id === 'sketch-2'), host + ': a locked sketch is not deleted'); setSketchLocked(S, 'sketch-2', false);

      // MOVE TO SKETCH lives in the right-click menu on geometry, not in the panel
      S.selectedShapes.add(B.id);
      const targets = moveTargets(S);
      eq(targets.map((x) => [x.id, !!x.disabled, x.reason || null]), [['sketch-1', false, null], ['sketch-2', true, 'current'], ['sketch-3', false, null]], host + ': the sketch the selection is in is greyed as current');
      setSketchLocked(S, 'sketch-1', true);
      eq(moveTargets(S).find((x) => x.id === 'sketch-1'), { id: 'sketch-1', name: 'Sketch 1', disabled: true, reason: 'locked' }, host + ': a locked sketch is greyed');
      setSketchLocked(S, 'sketch-1', false);
      const items = contextMenuItems('geometry', { target: { kind: 'shape', id: B.id }, actions: { lockState: () => ({ locked: false }), toggleLock() {}, deleteSelection() {}, sketchTargets: () => moveTargets(S), moveToSketch(id) { S.__moved = id; }, moveToNewSketch() { S.__moved = 'NEW'; } } });
      const parent = items.find((i) => i.id === 'geo-move');
      assert(parent && parent.label === 'Move to sketch' && Array.isArray(parent.submenu), host + ': one "Move to sketch" row with a submenu');
      eq(parent.submenu.map((i) => i.label), ['Sketch 1', 'Plate', 'Holes', 'New sketch…'], host + ': submenu = the sketch names + New sketch…');
      eq(parent.submenu.map((i) => !!i.disabled), [false, true, false, false], host + ': the current sketch is greyed, New sketch… is not');
      parent.submenu.find((i) => i.id === 'geo-move-sketch-3').onSelect(); eq(S.__moved, 'sketch-3', host + ': submenu item runs moveToSketch');
      // New sketch…: moves the selection into a NEW sketch, one undo step; a refused move leaves no empty sketch
      const nSk = S.sketches.length; const histN = S.history.length;
      const rn = moveSelectionToNewSketch(S);
      assert(rn.ok && S.sketches.length === nSk + 1 && sketchIdOf(app, B.id) === rn.sketchId && S.history.length === histN + 1, host + ': New sketch… moved the selection into a new sketch in one step');
      app.undo(); assert(S.sketches.length === nSk && sketchIdOf(app, B.id) === 'sketch-2', host + ': one undo removes the new sketch and moves back');
      delete S.__moved;
      panel.destroy();
    } finally { await app.close(); }
  }
  results.shaper_penplotter_sketchstudio_equal = results.shaper && JSON.stringify(results.shaper) === JSON.stringify(results.penplotter) && JSON.stringify(results.shaper) === JSON.stringify(results.sketchstudio);
  assert(results.shaper_penplotter_sketchstudio_equal, 'the same controls in Shaper, Pen Plotter and SketchStudio');
  row('panel controls per host (Trace: same panel code, real page in the live test): ' + JSON.stringify(results));
}

console.log('SKETCH-LAYERS-NODE OK (' + rows.length + ' rows)');

