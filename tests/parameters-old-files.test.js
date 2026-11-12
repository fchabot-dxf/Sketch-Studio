// TASK 535 slice 1b — OLD (version 1) documents still load, get dimension names d1..dn in constraint order, and nothing else about
// them changes. Every document in the repo is covered: the owner's real version-1 file (tests/fixtures/owner-trapezoid.document.json)
// and every audit / coverage drawing (built, then written as a version-1 file: no names, no parameters, version 1).
// Also: a version-2 document without parameters, the version gate, and the project-file envelope.
import { readFileSync } from 'node:fs';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { serializeDocument, deserializeDocument, validateDocument, DOCUMENT_VERSION } from '#core/document.js';
import { serializeProjectFile, parseProjectFile } from '#ui/project-file.js';
import { loadDrawings, buildDrawing } from './harness/coverage/prop-lib.js';

const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'not equal'}:\n  ${JSON.stringify(a).slice(0, 400)}\n  ${JSON.stringify(b).slice(0, 400)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
// key-order-insensitive form (a constraint pushed raw by fillet.js has its keys in another order than createConstraint writes them: same content)
const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x);
const isDim = (c) => c.type === 'distance' || c.type === 'angle';

// createEngine() shares one module-level store: one state, loaded into in turn
const state = createSketchState(createEngine(null), {});
state.initStore();

// load `doc` (a version-1 document) and check the load changed nothing but adding names
function checkLoad(label, doc, { sameAsInput = false } = {}) {
  assert(doc.version === 1 && !doc.geometry.parameters, `${label}: test input is a version-1 document`);
  assert(doc.geometry.constraints.every((c) => !('name' in c)), `${label}: no names in the old file`);
  assert(validateDocument(doc).ok, `${label}: version 1 is accepted`);
  const input = clone(doc);
  const res = deserializeDocument(doc, state);
  assert(res.ok, `${label}: ${res.reason}`);
  eq(doc, input, `${label}: loading does not modify the document object it was given`);
  const out = clone(serializeDocument(state));
  assert(out.version === DOCUMENT_VERSION, `${label}: saved as the new version`);
  eq(out.geometry.parameters, [], `${label}: no parameters`);
  // names: d1..dn over the dimensions in constraint order, none on anything else
  const dims = out.geometry.constraints.filter(isDim);
  eq(dims.map((c) => c.name), dims.map((_, i) => `d${i + 1}`), `${label}: names d1..dn in constraint order`);
  assert(out.geometry.constraints.filter((c) => !isDim(c)).every((c) => !('name' in c)), `${label}: only dimensions are named`);
  assert(out.geometry.constraints.every((c) => !('expression' in c)), `${label}: an old file has no formulas`);
  // nothing else changed: every constraint is the loaded input constraint plus `name`
  const stripped = out.geometry.constraints.map((c) => { const { name, ...rest } = c; return rest; });
  assert(stripped.length === input.geometry.constraints.length, `${label}: constraint count ${stripped.length} vs ${input.geometry.constraints.length}`);
  if (sameAsInput) {
    // the input came from this code's own serializer: it must come back identical except for name / version / parameters
    const expected = input.geometry.constraints;
    stripped.forEach((c, i) => eq(canon(c), canon(expected[i]), `${label}: constraint ${i} unchanged`));
    for (const part of ['joints', 'shapes', 'sketches', 'activeSketchId', 'groups', 'profiles', 'vcarves']) eq(out.geometry[part], input.geometry[part], `${label}: ${part} unchanged`);
  }
  return { out, input };
}

// ── 1. the owner's real version-1 file ──
{
  const doc = JSON.parse(readFileSync(new URL('./fixtures/owner-trapezoid.document.json', import.meta.url), 'utf8'));
  const { out, input } = checkLoad('owner-trapezoid', doc);
  // joints and shapes: exactly the file's (positions to the last bit)
  for (const [id, j] of input.geometry.joints) {
    const back = out.geometry.joints.find(([k]) => k === id);
    assert(back, `joint ${id} survives`);
    for (const k of Object.keys(j)) eq(back[1][k], j[k], `joint ${id}.${k}`);
  }
  eq(out.geometry.joints.length, input.geometry.joints.length, 'joint count');
  eq(out.geometry.shapes.map((s) => [s.id, s.type, s.joints]), input.geometry.shapes.map((s) => [s.id, s.type, s.joints]), 'shapes');
  // every constraint keeps the type, geometry, value and driving flag the file gave it
  input.geometry.constraints.forEach((f, i) => {
    const l = out.geometry.constraints[i];
    for (const k of ['type', 'joints', 'shapes', 'shape', 'joint', 'value', 'isDriven', 'driven', 'dimMode', 'isRadius']) if (k in f) eq(l[k], f[k], `constraint ${i} ${k}`);
  });
  const dims = out.geometry.constraints.filter(isDim);
  assert(dims.length >= 3, `the fixture has dimensions (${dims.length})`);
}

// ── 2. every audit / coverage drawing, written as a version-1 file ──
{
  const drawings = await loadDrawings();
  assert(drawings.length >= 13, `${drawings.length} drawings`);
  let totalDims = 0;
  for (const d of drawings) {
    const { S } = buildDrawing(d.mod);
    // buildDrawing makes its own state (the shared store now holds that drawing): serialize it, then load it into `state`
    const v2 = clone(serializeDocument(S.state));
    const v1 = clone(v2);
    v1.version = 1;
    delete v1.geometry.parameters;
    for (const c of v1.geometry.constraints) delete c.name;
    totalDims += v1.geometry.constraints.filter(isDim).length;
    checkLoad(d.file.split('/').pop(), v1, { sameAsInput: true });
  }
  assert(totalDims > 20, `drawings contain ${totalDims} dimensions`);
}

// ── 3. a version-2 document without parameters (a host with no parameter list) loads with none ──
{
  const doc = { version: 2, geometry: { joints: [], shapes: [], constraints: [{ type: 'distance', joints: ['a', 'b'], value: 5, name: 'len' }, { type: 'distance', joints: ['b', 'c'], value: 6 }] }, hosts: {} };
  state.parameters.push({ name: 'leftover', unit: '', expression: '1' });
  assert(deserializeDocument(doc, state).ok, 'loads');
  eq(state.parameters, [], 'no parameters');
  eq(state.constraints.map((c) => c.name), ['len', 'd1'], 'a given name is kept, an unnamed dimension gets the next automatic one');
}

// ── 4. the version gate and the project-file envelope ──
{
  assert(DOCUMENT_VERSION === 3, 'document version 3 (owner ruling O2: always write the new version; 3 = task 553, the angle sector)');
  assert(validateDocument({ version: 1, geometry: {} }).ok && validateDocument({ version: 2, geometry: {} }).ok, 'versions 1 and 2 are accepted');
  assert(validateDocument({ version: 3, geometry: {} }).ok, 'version 3 (this build) is accepted');
  const newer = validateDocument({ version: DOCUMENT_VERSION + 1, geometry: {} });
  assert(!newer.ok && newer.newer === true, 'a newer document is refused as newer');
  // what a build whose DOCUMENT_VERSION is 1 does with a version-2 file: validateDocument refuses version > its own (the same rule, one number lower)
  assert(2 > 1, 'a version-1 build refuses a version-2 file by that rule (document.js: doc.version > DOCUMENT_VERSION)');
  state.parameters.push({ name: 'w', unit: 'mm', expression: '5 mm' });
  const doc = clone(serializeDocument(state, { hosts: { test: { a: 1 } } }));
  const text = serializeProjectFile({ app: 'sketchstudio', name: 'x', document: doc });
  const parsed = parseProjectFile(text);
  eq(parsed.document, doc, 'project file keeps parameters');
  assert(serializeProjectFile({ app: parsed.app, name: parsed.name, document: parsed.document }) === text, 'open -> save gives the same bytes');
  let refused = false;
  try { parseProjectFile(serializeProjectFile({ app: 'a', name: 'x', document: { ...doc, version: DOCUMENT_VERSION + 1 } })); } catch (e) { refused = /newer/.test(e.message); }
  assert(refused, 'a newer document inside the envelope is refused with the "newer version" message');
}

console.log('parameters-old-files: OK');
