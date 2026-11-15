// tests/templates-node.test.js -- TASK 651: the bank of template drawings (packages/core/templates.js). Every template builds a valid version-3
// document that loads through the ONE load path (deserializeDocument), is accepted by the solver with 0 conflicts, carries its declared
// number of driving dimensions, keeps its geometry through a solve, and is FULLY constrained (nullity 0, anchored at the origin).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { TEMPLATES, buildTemplate, templateById } from '#core/templates.js';
import { DOCUMENT_VERSION, deserializeDocument, validateDocument } from '#core/document.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { measureResidual } from '#core/constraint-verifier.js';

assert.ok(TEMPLATES.length >= 6, 'a bank of templates');
const ids = TEMPLATES.map((t) => t.id);
assert.strictEqual(new Set(ids).size, ids.length, 'template ids are unique');
for (const id of ['slot', 'rounded-rectangle', 'keyhole', 'hexagon', 'star', 'arrow', 'l-bracket', 'bolt-circle', 'finger-edge']) assert.ok(templateById(id), `the bank declares ${id}`);

const isDim = (c) => (c.type === 'distance' || c.type === 'angle') && !c.isDriven && !c.driven;
const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };

for (const t of TEMPLATES) {
  assert.ok(t.name && t.description && typeof t.build === 'function', `${t.id}: name, description, build`);
  const doc = buildTemplate(t);
  assert.strictEqual(doc.version, DOCUMENT_VERSION, `${t.id}: a version-${DOCUMENT_VERSION} document`);
  assert.ok(validateDocument(doc).ok, `${t.id}: the document is valid`);
  assert.ok(doc.geometry.shapes.length > 0, `${t.id}: has shapes`);
  assert.strictEqual(doc.geometry.constraints.filter(isDim).length, t.dimensions, `${t.id}: ${t.dimensions} driving dimensions`);

  const S = L.newSketch();
  const res = muted(() => deserializeDocument(JSON.parse(JSON.stringify(doc)), S.state));
  assert.ok(res.ok, `${t.id}: loads (${res.reason})`);
  assert.strictEqual(S.state.constraints.length, doc.geometry.constraints.length, `${t.id}: every constraint loaded (none dropped)`);
  const before = L.snapshot(S);
  const r = muted(() => S.engine.solve(L.ITER));
  assert.deepStrictEqual(r.conflicts || [], [], `${t.id}: 0 conflicts`);
  assert.ok(r.converged !== false, `${t.id}: converged`);
  assert.ok(!L.hasNaN(S), `${t.id}: no NaN`);
  assert.ok(L.maxDeviation(S, before) < 1e-3, `${t.id}: the authored geometry already satisfies its constraints (moved ${L.maxDeviation(S, before)})`);
  for (const c of S.state.constraints) assert.ok(!(measureResidual(c, S.state.joints, S.state.shapes) > 1e-4), `${t.id}: ${c.type} ${c.name || ''} residual`);
  assert.strictEqual(L.nullity(S), 0, `${t.id}: fully constrained (nullity ${L.nullity(S)})`);
  // editable after it opens: every driving dimension takes a new value (x 1.1) without a refusal and the sketch still solves
  for (const d of S.state.constraints.filter(isDim)) {
    const res2 = muted(() => commitDimensionEdit(S.state, d, d.value * 1.1));
    assert.ok(!res2.reverted, `${t.id}: dimension ${d.name} accepts ${d.value}`);
  }
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], `${t.id}: 0 conflicts after editing every dimension`);
  const o = S.state.joints.get('j_origin');
  assert.ok(o && Math.hypot(o.x, o.y) < 1e-9, `${t.id}: the origin stays at 0,0`);
}
console.log(`templates-node: ${TEMPLATES.length} templates ok`);
