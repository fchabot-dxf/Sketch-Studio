// tests/journal.test.js — TASK 507: the ops journal (packages/core/journal.js) + the report that carries it.
//  (a) property: applyPatch(a, diff(a, b)) deep-equals b, and replayJournal(buildJournal(history, state)) deep-equals the live document,
//      over random mutation sequences incl. undo/redo, removes, reorders, constraint edits, sketches
//  (b) history stamps: every saved step carries t + label (default = the current tool), undo/redo keep them, semantics unchanged
//  (c) a 120-step session on a 100-shape sketch respects the size cap and says truncated, and the replay is still exact
//  (d) the redo stack is journaled; the report keeps every old field and gains journal (null without a state)
import assert from 'node:assert';

globalThis.window = { addEventListener() {}, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 };
globalThis.document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
globalThis.location = { href: 'http://test/' };

const { createEngine } = await import('#core/constraint-solver.js');
const { createSketchState } = await import('#ui/sketch-state.js');
const { serializeDocument } = await import('#core/document.js');
const { addConstraintObject } = await import('#core/constraints.js');
const { diffSnapshots, applyPatch, buildJournal, replayJournal, snapshotToDoc, describePatch } = await import('#core/journal.js');
const diag = await import('#ui/diagnostic-log.js');
const { replayReport } = await import('./harness/sketch.js');

const norm = (v) => JSON.parse(JSON.stringify(v));
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

function newState() {
  const engine = createEngine(null); engine.init();
  const state = createSketchState(engine, {});
  state.currentTool = 'line';
  return state;
}
let idn = 0;
function mutate(state) {
  const op = pick(['line', 'line', 'move', 'remove', 'dim', 'editdim', 'sketch', 'reorder', 'group']);
  if (op === 'line') {
    const a = 'J' + (++idn), b = 'J' + (++idn);
    state.joints.set(a, { x: rnd() * 100, y: rnd() * 100, fixed: false }); state.joints.set(b, { x: rnd() * 100, y: rnd() * 100, fixed: false });
    state.shapes.push({ id: 'S' + (++idn), type: 'line', joints: [a, b] });
  } else if (op === 'move' && state.joints.size) { const j = state.joints.get(pick([...state.joints.keys()])); j.x += 1.5; j.y -= 2; }
  else if (op === 'remove' && state.shapes.length) { state.shapes.splice(Math.floor(rnd() * state.shapes.length), 1); }
  else if (op === 'dim' && state.joints.size > 1) { const k = [...state.joints.keys()]; addConstraintObject(state, { type: 'distance', joints: [pick(k), pick(k)], value: Math.round(rnd() * 1000) / 10 }); } // the app's own add path (normalizes defaults, as a restore does)
  else if (op === 'editdim' && state.constraints.length) { pick(state.constraints).value = Math.round(rnd() * 1000) / 10; }
  else if (op === 'sketch') { state.sketches.push({ id: 'sketch-x' + (++idn), name: 'S' + (state.sketches.length + 1), visible: true }); state.activeSketchId = state.sketches[state.sketches.length - 1].id; }
  else if (op === 'reorder' && state.shapes.length > 1) { state.shapes.reverse(); }
  else if (op === 'group') { state.groups.push({ id: 'g' + (++idn), name: 'G' }); }
  return op;
}
function randomSession(steps) {
  const state = newState();
  for (let i = 0; i < steps; i++) {
    const r = rnd();
    if (r < 0.12 && state.canUndo()) state.undo();
    else if (r < 0.2 && state.canRedo()) state.redo();
    else { state.saveState(rnd() < 0.5 ? 'op' + i : undefined); mutate(state); }
  }
  return state;
}

// (a) property tests
for (let trial = 0; trial < 60; trial++) {
  const state = randomSession(5 + Math.floor(rnd() * 40));
  const live = norm(serializeDocument(state));
  const journal = buildJournal(state.history, state, { redoStack: state.redoStack });
  assert.deepStrictEqual(replayJournal(journal), live, `trial ${trial}: replay equals the live document`);
  assert.deepStrictEqual(norm(journal), journal, 'journal is pure JSON');
  const docs = [...state.history.map(snapshotToDoc), snapshotToDoc(state)];
  for (let i = 0; i + 1 < docs.length; i++) assert.deepStrictEqual(applyPatch(docs[i], diffSnapshots(docs[i], docs[i + 1])), norm(docs[i + 1]), `trial ${trial} pair ${i}`);
  for (let k = 0; k < 5; k++) {
    const a = pick(docs), b = pick(docs);
    assert.deepStrictEqual(applyPatch(a, diffSnapshots(a, b)), norm(b), `trial ${trial} random pair`);
  }
  // redo: replaying with the redo steps lands where the redo()s would
  const withRedo = replayJournal(journal, { includeRedo: true });
  while (state.canRedo()) state.redo();
  assert.deepStrictEqual(withRedo, norm(serializeDocument(state)), `trial ${trial}: replay with redo equals the state after every redo`);
}

// (b) stamps: t + label on every step; default label = the tool; undo/redo keep them; undo/redo behaviour unchanged
{
  const state = newState();
  state.currentTool = 'rect'; state.saveState(); state.joints.set('A', { x: 1, y: 1 });
  state.currentTool = 'select'; state.saveState('edit dimension 23.6 -> 17'); state.joints.get('A').x = 5;
  assert.deepStrictEqual(state.history.map((h) => h.label), ['rect', 'edit dimension 23.6 -> 17'], 'default label = tool, explicit label wins');
  assert.ok(state.history.every((h) => typeof h.t === 'number'), 'every step is timestamped');
  state.undo();
  assert.strictEqual(state.joints.get('A').x, 1, 'undo restores');
  assert.strictEqual(state.redoStack[0].label, 'edit dimension 23.6 -> 17', 'the redo entry is labelled with the undone action');
  state.redo();
  assert.strictEqual(state.joints.get('A').x, 5, 'redo re-applies');
  assert.strictEqual(state.history[1].label, 'edit dimension 23.6 -> 17', 'redo puts the label back on the history entry');
  state.beginUndoGroup('delete shapes'); state.saveState('delete shapes'); state.endUndoGroup();
  assert.strictEqual(state.history[state.history.length - 1].label, 'delete shapes', 'beginUndoGroup takes a label');
}

// (c) a 120-step session on a 100-shape sketch respects the cap
{
  const state = newState();
  for (let i = 0; i < 100; i++) { const a = 'P' + i, b = 'Q' + i; state.joints.set(a, { x: i, y: 0 }); state.joints.set(b, { x: i, y: 10 }); state.shapes.push({ id: 'L' + i, type: 'line', joints: [a, b] }); }
  for (let i = 0; i < 120; i++) { state.saveState('move ' + i); state.joints.get('P' + (i % 100)).x += 1; }
  assert.strictEqual(state.history.length, 100, 'history keeps its depth');
  const full = buildJournal(state.history, state, { redoStack: state.redoStack });
  assert.strictEqual(full.truncated, null, 'under the default cap: not truncated');
  const cap = Math.floor(Buffer.byteLength(JSON.stringify(full)) * 0.6);
  const small = buildJournal(state.history, state, { redoStack: state.redoStack, maxBytes: cap });
  assert.ok(small.truncated && small.truncated.droppedSteps > 0, 'over the cap: journal.truncated.droppedSteps');
  assert.strictEqual(small.steps.length + small.truncated.droppedSteps, 100, 'dropped + kept = all steps');
  assert.ok(Buffer.byteLength(JSON.stringify(small)) <= cap, 'the serialized journal respects the cap');
  assert.strictEqual(small.steps[0].seq, small.truncated.droppedSteps + 1, 'seq keeps counting from the original order');
  assert.deepStrictEqual(replayJournal(small), norm(serializeDocument(state)), 'a truncated journal still replays exactly');
  const rep = diag.buildReport({ appId: 't', getState: state, journalMaxBytes: cap });
  assert.ok(rep.journal.truncated && rep.journal.truncated.droppedSteps > 0, 'the report says truncated');
}

// (d) redo in the journal; old report fields intact; journal null without state
{
  const state = newState();
  state.saveState('line'); state.joints.set('A', { x: 0, y: 0 }); state.shapes.push({ id: 'S1', type: 'line', joints: ['A', 'A'] });
  state.saveState('rect'); state.joints.set('B', { x: 1, y: 1 });
  state.undo();
  const rep = diag.buildReport({ appId: 't', getState: () => state });
  assert.strictEqual(rep.journal.redo.length, 1, 'the undone step is in journal.redo');
  assert.strictEqual(rep.journal.redo[0].label, 'rect');
  assert.strictEqual(describePatch(rep.journal.redo[0].patch), '+1 joint');
  assert.deepStrictEqual(replayReport(norm(rep)), norm(rep.document), 'replayReport rebuilds the report document');
  for (const f of ['app', 'url', 'ua', 't', 'viewport', 'touchTrace', 'log', 'document']) assert.ok(f in rep, 'old report field kept: ' + f);
  assert.strictEqual(rep.app, 't');
  assert.deepStrictEqual(rep.document, serializeDocument(state));
  const none = diag.buildReport({ appId: 't', getState: null });
  assert.strictEqual(none.journal, null, 'no state -> journal null');
  assert.strictEqual(none.document, null);
}
console.log('journal.test.js: ok');
