// TASK 554: a loaded document ALWAYS has the origin joint. The project store's "New design" writes an empty document (no joints at all),
// and older files / designs saved from such a design carry no j_origin either: loading one used to leave the sketch WITHOUT its origin
// (no origin marker, nothing to snap to, no axis snap). deserializeDocument is the one place a stored document becomes the state, so it
// guarantees the origin there: exactly one j_origin, fixed at (0, 0), the first joint; a stored origin is kept as stored.
import assert from 'node:assert';
import { deserializeDocument, serializeDocument, DOCUMENT_VERSION } from '#core/document.js';
import { emptyDocument } from '#ui/project-store.js';
import { ORIGIN_JOINT_ID, ORIGIN_JOINT } from '#core/constants.js';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import fs from 'node:fs';

const freshState = () => ({ joints: new Map([['j_stale', { x: 5, y: 5 }]]), shapes: [], constraints: [] });

// 1. "New design": the store's empty document
{
  const state = freshState();
  const r = deserializeDocument(emptyDocument(), state);
  assert.equal(r.ok, true);
  assert.deepStrictEqual([...state.joints.entries()], [[ORIGIN_JOINT_ID, { x: 0, y: 0, fixed: true }]], 'an empty document loads with the fixed origin only: ' + JSON.stringify([...state.joints.entries()]));
}

// 2. a version-1 document with shapes but no origin (a design saved after a "New design" load) is repaired, origin first
{
  const state = freshState();
  const doc = { version: 1, geometry: { joints: [['j1', { x: 1, y: 2 }], ['j2', { x: 3, y: 4 }]], shapes: [{ id: 's1', type: 'line', joints: ['j1', 'j2'] }], constraints: [] } };
  deserializeDocument(doc, state);
  assert.deepStrictEqual([...state.joints.keys()], [ORIGIN_JOINT_ID, 'j1', 'j2'], 'the origin is added first, the stored joints follow');
  assert.deepStrictEqual(state.joints.get(ORIGIN_JOINT_ID), { x: 0, y: 0, fixed: true });
}

// 3. a document that HAS the origin: kept as stored (its own fields), never duplicated, order unchanged
{
  const state = freshState();
  const doc = { version: DOCUMENT_VERSION, geometry: { joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['j1', { x: 1, y: 2 }]], shapes: [], constraints: [] } };
  deserializeDocument(doc, state);
  assert.deepStrictEqual([...state.joints.entries()], [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['j1', { x: 1, y: 2 }]]);
  // round trip: what is saved back is what was loaded
  assert.deepStrictEqual(serializeDocument(state).geometry.joints, doc.geometry.joints);
}

// 4. the loaded origin is the state's own copy: changing it never writes into the declaration
{
  const state = freshState();
  deserializeDocument(emptyDocument(), state);
  state.joints.get(ORIGIN_JOINT_ID).sketchId = 'sketch-1';
  assert.deepStrictEqual(ORIGIN_JOINT, { x: 0, y: 0, fixed: true });
}

// 5. the owner's live document (byte copy of his diagnostic report's `document`, 2026-11-12): saved with NO j_origin. Opened, it has its origin again.
{
  const owner = JSON.parse(fs.readFileSync(new URL('./fixtures/angle-dimension/owner-trapezoid-angle.json', import.meta.url), 'utf8'));
  assert(!owner.geometry.joints.some((e) => (Array.isArray(e) ? e[0] : e.id) === ORIGIN_JOINT_ID), 'the fixture is the origin-less document');
  const state = freshState();
  assert.equal(deserializeDocument(owner, state).ok, true);
  assert.deepStrictEqual(state.joints.get(ORIGIN_JOINT_ID), { x: 0, y: 0, fixed: true }, 'the owner design shows its origin again');
  assert.strictEqual(state.joints.size, owner.geometry.joints.length + 1, 'only the origin was added');
  assert.strictEqual([...state.joints.keys()][0], ORIGIN_JOINT_ID);
}

// 6. Clear All (sketch-state clearDocument) and a load through the real engine-backed state keep exactly one fixed origin
{
  const engine = createEngine();
  const state = createSketchState(engine, { x: 0, y: 0, w: 20, h: 20 });
  engine.init();
  state.joints.set('j1', { x: 3, y: 4 });
  // (the live state stamps its sketch on joints: sketchId is not part of the check)
  const originOnly = () => [...state.joints.entries()].map(([id, { x, y, fixed }]) => [id, { x, y, fixed }]);
  state.clearDocument();
  assert.deepStrictEqual(originOnly(), [[ORIGIN_JOINT_ID, { x: 0, y: 0, fixed: true }]], 'Clear All leaves the origin only');
  deserializeDocument(emptyDocument(), state);
  assert.deepStrictEqual(originOnly(), [[ORIGIN_JOINT_ID, { x: 0, y: 0, fixed: true }]], 'New design on the live state: the origin only');
  assert.strictEqual(engine.getJoints().get(ORIGIN_JOINT_ID), state.joints.get(ORIGIN_JOINT_ID), 'the solver sees the same origin (one joints map)');
}

console.log('document-origin: ok');
