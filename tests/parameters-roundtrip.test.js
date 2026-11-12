// TASK 535 slice 1b — parameters + dimension names/expressions PERSIST: save -> load -> save is byte-stable, and undo / redo /
// cancelUndoGroup / the ops journal keep them, for EVERY dimension mode of tests/harness/coverage/inventory.js x {driving, reference}.
// DATA ONLY: no solver runs (the constraints name joints/shapes that need not exist); the point is what the model carries.
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { serializeDocument, deserializeDocument, DOCUMENT_VERSION } from '#core/document.js';
import { addConstraint } from '#core/constraints.js';
import { evaluateAll } from '#core/parameters.js';
import { buildJournal, replayJournal, documentHash } from '#core/journal.js';
import inventory from './harness/coverage/inventory.js';

const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'not equal'}:\n  ${JSON.stringify(a)}\n  ${JSON.stringify(b)}`);
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// createEngine() shares ONE module-level store (joints, shapes, constraints), so only ONE state lives at a time: the test uses a single state and
// builds / loads into it in turn (deserializeDocument replaces everything). `parameters` is per state.
const state = createSketchState(createEngine(null), {});
state.initStore(); // the origin is created after the state, as the app does (so it is sketch-stamped)

// every dimension mode, as the params the app's createConstraint calls carry (distinct joints/shapes so no duplicate is rejected)
const MODES = [
  { key: 'aligned', mode: 'aligned', type: 'distance', params: { joints: ['a1', 'a2'], dimMode: 'aligned' } },
  { key: 'horizontal', mode: 'horizontal', type: 'distance', params: { joints: ['h1', 'h2'], dimMode: 'horizontal' } },
  { key: 'vertical', mode: 'vertical', type: 'distance', params: { joints: ['v1', 'v2'], dimMode: 'vertical' } },
  { key: 'line length', mode: 'line length', type: 'distance', params: { joints: ['l1', 'l2'] } },
  { key: 'point-line', mode: 'point-line', type: 'distance', params: { joints: ['p1', 'p2', 'p3'] } },
  { key: 'line-line', mode: 'line-line', type: 'distance', params: { shapes: ['s1', 's2'] } },
  { key: 'angle', mode: 'angle', type: 'angle', angle: true, params: { shapes: ['s3', 's4'] } },
  { key: 'radius circle', mode: 'radius', type: 'distance', params: { shape: 'circ1', isRadius: true } },
  { key: 'radius arc', mode: 'radius', type: 'distance', params: { shape: 'arc1', isRadius: true } },
  { key: 'radius fillet arc', mode: 'radius', type: 'distance', params: { shape: 'fil1', isRadius: true } },
];
// the test follows the inventory: a new dimension mode there must get a row here
for (const m of inventory.dimensionModes) assert(MODES.some((x) => x.mode === m.mode), `inventory has a dimension mode the round trip test does not cover: ${m.mode}`);

const PARAMS = [
  { name: 'width', unit: 'mm', expression: '120 mm', comment: 'outer width' },
  { name: 'turn', unit: 'deg', expression: '90 deg' },
  { name: 'count', unit: '', expression: '4' },
];

function build() {
  state.clearDocument();
  state.parameters.push(...PARAMS.map((p) => ({ ...p })));
  const expected = new Map();
  for (const m of MODES) for (const reference of [false, true]) {
    const params = { ...m.params, value: m.angle ? 30 : 10, offset: 31, isDriven: reference, driven: reference };
    // a reference dimension is a different geometry from its driving twin (the dedupe rejects two on the same joints): own ids
    if (reference) {
      if (params.joints) params.joints = params.joints.map((j) => `${j}r`);
      if (params.shapes) params.shapes = params.shapes.map((s) => `${s}r`);
      if (params.shape) params.shape = `${params.shape}r`;
    }
    if (!reference) params.expression = m.angle ? 'turn / 3' : 'width / 12';
    const before = state.constraints.length;
    assert(addConstraint(state, m.type, params), `${m.key}/${reference ? 'reference' : 'driving'} was not added`);
    assert(state.constraints.length === before + 1, 'one constraint added');
    expected.set(state.constraints[before], { key: m.key, reference });
  }
  return expected;
}

// ── names: every dimension has one, d1.. in creation order, none for non-dimensions ──
const expected = build();
{
  const dims = state.constraints.filter((c) => c.type === 'distance' || c.type === 'angle');
  assert(dims.length === MODES.length * 2, `${dims.length} dimensions`);
  eq(dims.map((c) => c.name), dims.map((_, i) => `d${i + 1}`), 'automatic names d1..dn');
  for (const [c, info] of expected) {
    assert(c.name, `${info.key}: has a name`);
    assert(info.reference ? !('expression' in c) : typeof c.expression === 'string', `${info.key}: expression only on a driving dimension that was given one`);
  }
  // the formulas hold a value that matches them once the batch commit writes it (slice 2); here we write what it would write
  const ev = evaluateAll(state);
  assert(ev.ok, `evaluates: ${JSON.stringify([...ev.errors])}`);
  for (const c of state.constraints.filter((x) => x.expression)) c.value = ev.values.get(c.name).v;
  assert(near(state.constraints.find((c) => c.name === 'd1').value, 10), 'width / 12');
  assert(near(state.constraints.find((c) => c.type === 'angle' && c.expression).value, 30), 'turn / 3');
}

// ── save -> load -> save is byte-stable, with parameters and expressions, for every mode x {driving, reference} ──
const doc1 = serializeDocument(state, { hosts: { test: { x: 1 } } });
const json1 = JSON.stringify(doc1);
{
  assert(doc1.version === DOCUMENT_VERSION && DOCUMENT_VERSION === 2, 'always the new version (O2)');
  eq(doc1.geometry.parameters, PARAMS, 'parameters are in the document');
  const originals = state.constraints.filter((x) => x.type === 'distance' || x.type === 'angle').map((c) => JSON.parse(JSON.stringify(c)));
  const res = deserializeDocument(JSON.parse(json1), state); // replaces the whole state
  assert(res.ok, res.reason);
  const json2 = JSON.stringify(serializeDocument(state, { hosts: res.hosts }));
  assert(json1 === json2, 'save -> load -> save is byte-stable');
  // and once more through a real JSON text (what a file is)
  deserializeDocument(JSON.parse(json2), state);
  assert(JSON.stringify(serializeDocument(state, { hosts: res.hosts })) === json1, 'third generation identical');
  // per mode: name, expression, driving flag survive
  const dims = state.constraints.filter((x) => x.type === 'distance' || x.type === 'angle');
  assert(dims.length === originals.length, 'same dimension count');
  for (const o of originals) {
    const back = dims.find((x) => x.name === o.name);
    assert(back, `${o.name} survives`);
    eq([back.expression, back.isDriven, back.driven, back.value, back.dimMode], [o.expression, o.isDriven, o.driven, o.value, o.dimMode], `${o.name} fields`);
  }
  const ev = evaluateAll(state);
  for (const c of state.constraints.filter((x) => x.expression)) assert(near(ev.values.get(c.name).v, c.value), `${c.name}: value == evaluated formula after load`);
  // load replaces parameters, never blends
  state.parameters.push({ name: 'stray', unit: '', expression: '1' });
  deserializeDocument(JSON.parse(json1), state);
  eq(state.parameters.map((p) => p.name), ['width', 'turn', 'count'], 'load replaces the parameter list');
  // a document without a `parameters` field (a version-2 document written by a state that has none) loads with none
  const noParams = JSON.parse(json1); delete noParams.geometry.parameters;
  state.parameters.push({ name: 'x', unit: '', expression: '1' });
  assert(deserializeDocument(noParams, state).ok && state.parameters.length === 0, 'absent parameters -> none');
}

// ── undo / redo (the snapshot sites _captureSnapshot / _restoreSnapshot) keep names, expressions and parameters ──
{
  build(); const s = state;
  const doc = () => JSON.stringify(serializeDocument(s));
  const original = doc();
  s.saveState('edit parameters');
  s.parameters[0].expression = '200 mm';
  s.parameters.push({ name: 'extra', unit: 'mm', expression: 'width / 2' });
  s.constraints[0].expression = 'extra';
  s.constraints[0].name = 'slot_len';
  const edited = doc();
  assert(edited !== original, 'the edit changed the document');
  s.undo();
  assert(doc() === original, 'undo restores parameters, expressions and names');
  assert(s.parameters.length === 3 && s.constraints[0].name === 'd1', 'undone');
  s.redo();
  assert(doc() === edited, 'redo brings them back');
  assert(s.parameters.some((p) => p.name === 'extra') && s.constraints[0].name === 'slot_len', 'redone');
  // the snapshot holds its own copy: editing the live list afterwards does not edit history
  s.undo();
  s.parameters[0].expression = '1 mm';
  s.redo();
  assert(doc() === edited, 'snapshots are copies');
  // clearDocument empties parameters (a new document must not inherit them)
  s.clearDocument();
  assert(s.parameters.length === 0, 'Clear All empties the parameters');
}

// ── cancelUndoGroup (the third snapshot site) ──
{
  build(); const s = state;
  const doc = () => JSON.stringify(serializeDocument(s));
  s.saveState('before');
  const atStart = doc();
  s.parameters[0].expression = '150 mm';
  s.constraints[0].expression = 'width / 3';
  s.beginUndoGroup('group');
  s.parameters.push({ name: 'inGroup', unit: '', expression: '2' });
  s.constraints[1].name = 'renamed';
  s.cancelUndoGroup();
  // cancel restores the snapshot taken BEFORE the group's pre-state, i.e. history[prior]: the state at the first saveState
  assert(doc() === atStart, 'cancelUndoGroup restores parameters, expressions and names');
  assert(!s.parameters.some((p) => p.name === 'inGroup'), 'the in-group parameter is gone');
}

// ── the journal (diagnostic report) carries parameters: replaying the patches rebuilds the same document ──
{
  build(); const s = state;
  s.saveState('first');
  s.parameters[0].expression = '130 mm';
  s.saveState('second');
  s.parameters.push({ name: 'later', unit: 'mm', expression: 'width / 2' });
  s.parameters.splice(1, 1);
  const j = buildJournal(s.history, s, { redoStack: s.redoStack });
  const replayed = replayJournal(j);
  assert(documentHash(replayed) === j.current.hash, 'journal replay matches the live document (parameters included)');
  eq(replayed.geometry.parameters.map((p) => p.name), ['width', 'count', 'later'], 'replayed parameters');
  assert(j.steps.some((st) => st.patch.parameters), 'a parameter change is in a patch');
}

console.log('parameters-roundtrip: OK');
