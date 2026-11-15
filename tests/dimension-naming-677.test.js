// TASK 677 ADDITION (owner ruling, turns 1720-1729; Fusion measured by the advisor through the API and by the owner in the Change Parameters table):
// Fusion's dimension rules, through THE path (previewDimensionInput -> planChange -> applyParameterChange), on a real sketch state + engine:
//   1. `name = value` typed into a DIMENSION names THAT dimension (no user parameter is made); the formulas that read its old name follow. An existing
//      USER parameter's name keeps O4 (sets that parameter, the dimension reads it). ANOTHER dimension's name is refused (NAME_TAKEN).
//   2. a named dimension shows its PLAIN value (no fx:), with the hover tag "name : expression" ("name : value unit" for a plain value); a plain number
//      typed into it sets its value and every dimension that reads its name follows, in ONE undo step.
//   3. a follower (expression = a name or a formula) shows "fx: value"; a plain number typed into it unlinks only that follower.
//   4. a USER parameter is unchanged: a dimension reading it follows it; a plain number typed into the dimension unlinks only that dimension.
// Fusion evidence: d1 renamed `thickness` = 18 mm, d2 = d3 = `thickness`; 12 typed into d1 gave d2 = d3 = 12; 15 typed into d2 unlinked only d2; the
// table listed thickness as a Model Parameter; on the canvas thickness showed a plain value, d3 "fx: ..."; `param = 2` in a width box showed a plain
// 2.00 with the hover tag 'param : 2"'.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { previewDimensionInput, planChange } from '#core/parameters.js';
import { applyParameterChange, dimensionInputLabel } from '#ui/dimension-seams.js';
import { formatConstraintValue, dimensionNameTag } from '#ui/svg-renderer.js';

let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.deepStrictEqual(a, b, m); };
const near = (a, b, m) => ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);
const muted = (f) => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return f(); } finally { console.log = l; console.warn = w; } };

// two rectangles welded apart: A (100 x 40) carries d1 (width) and d2 (height), B (60 x 30) d3 (width) and d4 (height)
function drawing() {
  const S = L.newSketch();
  const mk = (x, w, h) => {
    for (const t0 = Date.now(); Date.now() === t0;); // shape ids are s<Date.now()>_n: two rects in one millisecond would share ids
    const r = L.rect(S, x, 0, x + w, h);
    const ids = [...new Set(r.lines.flatMap((id) => L.shape(S, id).joints))];
    const at = (px, py) => ids.find((id) => Math.abs(S.state.joints.get(id).x - px) < 1e-9 && Math.abs(S.state.joints.get(id).y - py) < 1e-9);
    S.state.joints.get(at(x, 0)).fixed = true;
    ConstraintManager.createConstraint(S.state, 'distance', { joints: [at(x, 0), at(x + w, 0)], value: w, dimMode: 'horizontal' }, { source: 'audit' });
    ConstraintManager.createConstraint(S.state, 'distance', { joints: [at(x + w, 0), at(x + w, h)], value: h, dimMode: 'vertical' }, { source: 'audit' });
  };
  mk(0, 100, 40); mk(200, 60, 30);
  muted(() => S.engine.solve(L.ITER));
  S.state.saveState('baseline');
  return S;
}
const D = (S, name) => S.state.constraints.find((c) => c.name === name); // undo REBUILDS the constraints: look a dimension up by name
// what the dimension box does on Enter (numeric-input-manager handleCommit, minus the DOM): preview, then commit THAT plan
const typeInto = (S, c, text) => {
  const pv = previewDimensionInput(S.state, c, text);
  if (!pv.ok) return pv;
  return { ...muted(() => applyParameterChange(S.state, pv.plan, dimensionInputLabel(c, pv))), pv };
};
const image = (S) => JSON.stringify({ j: [...S.state.joints].map(([k, j]) => [k, Math.round(j.x * 1e6) / 1e6, Math.round(j.y * 1e6) / 1e6]), c: S.state.constraints.map((c) => [c.name, c.value, c.expression]), p: S.state.parameters });

// ================================================================ rule 1: `thickness = 18` names the dimension; readers of its old name follow
const S = drawing();
ok(typeInto(S, D(S, 'd4'), 'd1 / 4').ok, 'd4 reads d1 (by its automatic name) before d1 is named');
const h0 = S.state.history.length;
const before = image(S);
const pv = previewDimensionInput(S.state, D(S, 'd1'), 'thickness = 18');
eq([pv.ok, pv.kind, pv.name, pv.hint], [true, 'name', 'thickness', 'names it thickness = 18.0 mm, also changes d4'], 'the hint before Enter');
eq(dimensionInputLabel(D(S, 'd1'), pv), 'name dimension d1 -> thickness', 'the undo label');
eq(image(S), before, 'the preview is pure');
ok(typeInto(S, D(S, 'd1'), 'thickness = 18').ok, 'applied');
const t = D(S, 'thickness');
ok(!!t && !D(S, 'd1'), 'd1 is now called thickness');
eq([t.value, t.expression], [18, undefined], 'it holds the plain 18');
eq(S.state.parameters, [], 'NO user parameter was made (Fusion: a model parameter)');
eq(D(S, 'd4').expression, 'thickness / 4', 'the formula that read d1 follows the new name');
near(D(S, 'd4').value, 4.5, 'and its value follows 18');
eq(S.state.history.length, h0 + 1, 'ONE undo step');
muted(() => S.state.undo());
eq(image(S), before, 'ONE undo restores the name, the value and the follower');
muted(() => S.state.redo());
ok(!!D(S, 'thickness') && D(S, 'd4').expression === 'thickness / 4', 'redo brings the name back');

// d2 and d3 read thickness (followers)
ok(typeInto(S, D(S, 'd2'), 'thickness').ok && typeInto(S, D(S, 'd3'), 'thickness').ok, 'd2 and d3 typed `thickness`');
near(D(S, 'd2').value, 18, 'd2 = 18'); near(D(S, 'd3').value, 18, 'd3 = 18');
// another dimension's name is refused; the dimension's own name just sets its value
const taken = previewDimensionInput(S.state, D(S, 'd2'), 'thickness = 5');
eq([taken.ok, taken.code, taken.hint], [false, 'NAME_TAKEN', "'thickness' is already used"], "another dimension's name: refused");
eq(previewDimensionInput(S.state, D(S, 'thickness'), 'thickness = 14').kind, 'value', "the dimension's own name: a plain value");
eq(previewDimensionInput(S.state, D(S, 'd3'), 'd2 = 5').code, 'RESERVED_NAME', 'an automatic dN cannot be assigned (O7)');

// ================================================================ rule 2: the named one shows its plain value + the hover tag; 12 typed into it moves every reader
eq(formatConstraintValue(D(S, 'thickness')), '18.0', 'a named dimension shows its PLAIN value');
eq(dimensionNameTag(D(S, 'thickness')), 'thickness : 18.0 mm', 'its hover tag "name : value unit"');
eq(dimensionNameTag(D(S, 'd2')), '', 'an automatic name has no tag');
const h1 = S.state.history.length;
const twelve = typeInto(S, D(S, 'thickness'), '12');
ok(twelve.ok && twelve.pv.kind === 'value', '12 typed into thickness');
for (const n of ['thickness', 'd2', 'd3']) near(D(S, n).value, 12, `${n} = 12`);
near(D(S, 'd4').value, 3, 'd4 = thickness / 4 = 3');
eq(S.state.history.length, h1 + 1, 'ONE undo step for all of them');
muted(() => S.state.undo());
for (const n of ['thickness', 'd2', 'd3']) near(D(S, n).value, 18, `undo: ${n} = 18`);
muted(() => S.state.redo());
// a named dimension holding a formula shows the formula in its tag
ok(typeInto(S, D(S, 'd4'), 'gap = thickness / 4').ok && !!D(S, 'gap'), 'd4 named gap, holding a formula');
eq(dimensionNameTag(D(S, 'gap')), 'gap : thickness / 4', 'the tag of a named formula: "name : expression"');

// ================================================================ rule 3: a follower shows fx:; a plain number unlinks only that follower
eq(formatConstraintValue(D(S, 'd2')), 'fx: 12.0', 'a follower shows fx:');
ok(typeInto(S, D(S, 'd2'), '15').ok, '15 typed into d2');
eq([D(S, 'd2').expression, D(S, 'd2').value], [undefined, 15], 'd2 is unlinked, 15');
eq([D(S, 'd3').expression, D(S, 'd3').value, D(S, 'thickness').value], ['thickness', 12, 12], 'd3 still follows thickness (12)');

// ================================================================ rule 4: a USER parameter (the table's + Add, or a template) is unchanged
const mk = planChange(S.state, { type: 'createParameter', name: 'ply', unit: 'mm', text: '20' });
ok(mk.ok && muted(() => applyParameterChange(S.state, mk, 'create parameter ply')).ok, 'a user parameter ply = 20');
ok(typeInto(S, D(S, 'd3'), 'ply').ok && typeInto(S, D(S, 'd2'), 'ply').ok, 'd2 and d3 read ply');
const o4 = previewDimensionInput(S.state, D(S, 'd3'), 'ply = 22');
eq([o4.kind, o4.hint], ['set', 'sets ply 20.0 -> 22.0 mm, also changes d2'], '`ply = 22` in a dimension box SETS the user parameter (O4 kept)');
ok(typeInto(S, D(S, 'd3'), 'ply = 22').ok, 'applied');
eq([S.state.parameters.map((p) => [p.name, p.expression]), D(S, 'd3').expression, D(S, 'd3').name], [[['ply', '22 mm']], 'ply', 'd3'], 'the parameter is set, d3 keeps its name and reads ply');
near(D(S, 'd2').value, 22, 'd2 follows ply');
eq(formatConstraintValue(D(S, 'd3')), 'fx: 22.0', 'a dimension reading a user parameter shows fx:');
ok(typeInto(S, D(S, 'd3'), '7').ok, '7 typed into d3');
eq([D(S, 'd3').expression, D(S, 'd3').value, D(S, 'd2').expression, D(S, 'd2').value, S.state.parameters[0].expression], [undefined, 7, 'ply', 22, '22 mm'], 'only d3 is unlinked; ply and d2 unchanged');

console.log(`dimension-naming-677: ok (${checks} checks)`);
