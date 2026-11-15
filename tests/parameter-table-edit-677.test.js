// TASK 677 (docs/PARAMETERS-DESIGN.md slice 5) — the Parameters window EDITS, through THE one path: planTableEdit (pure: planChange, and for a
// dimension's Expression previewDimensionInput, the canvas box's own) -> commitTableEdit (applyParameterChange: ONE undo step, the batch solve).
// Node, on the REAL box-frame template opened in a real sketch state + engine (tests/harness/audit/lib.js):
//   1. buildParameterRows: the user rows carry who reads them (the bin), the dimension rows their constraint.
//   2. a valid edit: thickness 18 -> 12 moves every board, ONE undo step, the hint lists the dimensions it moves; undo restores 18 everywhere.
//   3. errors are data and the previous expression stays in force: syntax, unknown name, unit, "=" in a parameter's Expression, a loop, and a value
//      the drawing cannot take (refused by the solve: the state, the parameters and the history are unchanged).
//   4. rename (a parameter, a dimension): every formula that reads the name follows (token by token: thickness2 is untouched); ONE undo step.
//   5. + Add: name + expression, `name = expr` fills both, the unit; incomplete rows; refused names. Delete: refused while in use (the users
//      listed), allowed once unused. Comment: set, cleared. Each ONE undo step; an edit that changes nothing takes NO undo step.
//   6. a dimension's Expression: the canvas box's previewDimensionInput (number, `name = value` creates), its label; dependentDimensions.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { buildTemplate, templateById } from '#core/templates.js';
import { deserializeDocument } from '#core/document.js';
import { buildParameterRows, planTableEdit, commitTableEdit, dependentDimensions } from '#ui/parameter-table.js';

let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.deepStrictEqual(a, b, m); };
const muted = (f) => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; } };
const U = { unit: 'mm' };

function openBoxFrame() {
  const S = L.newSketch();
  const res = muted(() => deserializeDocument(JSON.parse(JSON.stringify(buildTemplate(templateById('box-frame'), {}))), S.state));
  ok(res.ok, 'the box frame loads');
  muted(() => S.engine.solve(L.ITER));
  S.state.saveState('opened');
  return S;
}
const P = (S, name) => S.state.parameters.find((p) => p.name === name);
const D = (S, name) => S.state.constraints.find((c) => c.name === name); // undo REBUILDS the constraints: look a dimension up by name
// the x levels of the box (the two sides' edges), the board thickness as the geometry has it
const xLevels = (S) => [...new Set([...S.state.joints.values()].map((j) => Math.round(j.x * 1e4) / 1e4))].sort((a, b) => a - b);
const image = (S) => JSON.stringify({ j: [...S.state.joints].map(([k, j]) => [k, Math.round(j.x * 1e6) / 1e6, Math.round(j.y * 1e6) / 1e6]), c: S.state.constraints.map((c) => [c.name, c.value, c.expression]), p: S.state.parameters });
const plan = (S, edit) => planTableEdit(S.state, edit, U);
const commit = (S, edit) => { const p = plan(S, edit); ok(p.ok, `${JSON.stringify(edit)} plans: ${p.message}`); return muted(() => commitTableEdit(S.state, p)); };

// ================================================================ 1. the rows
{
  const S = openBoxFrame();
  const rows = buildParameterRows(S.state, U);
  eq(rows.user.map((r) => [r.name, r.expression, r.value, r.unit, r.users]), [
    ['length', '1500 mm', '1500.0', 'mm', ['d2']], ['width', '400 mm', '400.0', 'mm', ['d1']], ['thickness', '18 mm', '18.0', 'mm', ['d3']],
  ], 'user rows: name, expression, value, unit and who reads them');
  eq(rows.dimensions.length, 14, 'the 14 box-frame dimensions');
  ok(rows.dimensions.every((r) => r.constraint && r.hasExpression && !r.reference), 'every dimension row carries its constraint and is a formula');
}

// ================================================================ 2. a valid edit: thickness 18 -> 12, ONE undo step, undo restores 18
{
  const S = openBoxFrame();
  eq(xLevels(S), [0, 18, 382, 400], 'before: both sides 18 thick');
  const before = image(S);
  const h0 = S.state.history.length;
  const p = plan(S, { kind: 'parameter', column: 'expression', name: 'thickness', text: '12' });
  ok(p.ok && p.changed, 'thickness = 12 plans');
  eq(p.hint, '= 12.0 mm, also changes d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14', 'the live preview: the value and every dimension it moves');
  eq(p.label, 'change parameter thickness', 'the undo label');
  eq(image(S), before, 'planning is pure: nothing moved');
  const r = muted(() => commitTableEdit(S.state, p));
  eq(r, { ok: true, changed: true }, 'applied');
  eq(P(S, 'thickness').expression, '12 mm', 'the stored expression is canonical (units written in)');
  eq(xLevels(S), [0, 12, 388, 400], 'every side board is 12 thick');
  ok(['d3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10'].every((n) => Math.abs(D(S, n).value - 12) < 1e-9), 'every thickness dimension is 12');
  eq(S.state.history.length, h0 + 1, 'ONE undo step');
  muted(() => S.state.undo());
  eq(P(S, 'thickness').expression, '18 mm', 'undo: thickness is 18 mm again');
  eq(xLevels(S), [0, 18, 382, 400], 'undo: both sides 18 thick again');
  eq(image(S), before, 'undo restores the joints, the dimension values / expressions and the parameters exactly');
  // the same text again: nothing to do, no undo step
  const same = plan(S, { kind: 'parameter', column: 'expression', name: 'thickness', text: '18' });
  eq(same, { ok: true, changed: false }, '18 (= the stored 18 mm) changes nothing');
  eq(muted(() => commitTableEdit(S.state, same)), { ok: true, changed: false }, 'committing nothing');
  eq(S.state.history.length, h0, 'and takes no undo step');
}

// ================================================================ 3. errors are data; the previous expression stays in force
{
  const S = openBoxFrame();
  const before = image(S);
  const h0 = S.state.history.length;
  const cases = [
    [{ column: 'expression', text: 'thickness +' }, 'SYNTAX', 'unexpected the end of the input at 11'],
    [{ column: 'expression', text: 'foo' }, 'UNKNOWN_NAME', "unknown parameter 'foo' (type foo = 30 to create it)"],
    [{ column: 'expression', text: '30 deg' }, 'UNIT_MISMATCH', 'a length cannot be an angle'],
    [{ column: 'expression', text: 'a = 3' }, 'ASSIGN_NOT_TOP', '"=" is not allowed here: use the Name cell to rename thickness'],
    [{ column: 'name', text: 'width' }, 'NAME_TAKEN', "'width' is already used"],
    [{ column: 'name', text: 'd3' }, 'RESERVED_NAME', "'d3' is reserved for automatic dimension names"],
    [{ column: 'name', text: '2x' }, 'BAD_NAME', "'2x' is not a valid name"],
  ];
  for (const [edit, code, message] of cases) {
    const p = plan(S, { kind: 'parameter', name: 'thickness', ...edit });
    eq([p.ok, p.code, p.message], [false, code, message], `${edit.column} ${JSON.stringify(edit.text)}: refused as data`);
    eq(muted(() => commitTableEdit(S.state, p)), p, 'committing a refusal returns it and touches nothing');
  }
  // a loop: length reads width, then width reads length
  ok(commit(S, { kind: 'parameter', column: 'expression', name: 'length', text: 'width * 3' }).ok, 'length = width * 3 applies');
  const loop = plan(S, { kind: 'parameter', column: 'expression', name: 'width', text: 'length / 2' });
  eq([loop.ok, loop.code, loop.message], [false, 'CYCLE', 'length -> width -> length'], 'a loop is refused before anything moves');
  muted(() => S.state.undo());
  eq(image(S), before, 'back to the template');
  // a value the drawing cannot take: planned (the formula is fine), refused by the solve, NOTHING changed and no undo step left behind
  const big = plan(S, { kind: 'parameter', column: 'expression', name: 'thickness', text: '200' });
  ok(big.ok && big.changed, 'thickness = 200 is a valid formula');
  const r = muted(() => commitTableEdit(S.state, big));
  eq([r.ok, r.message], [false, "Can't apply: 200.00 would collapse a line to a point. Nothing changed."], 'the solve refuses it and says why');
  eq(image(S), before, 'refused: joints, values, expressions and parameters as they were');
  eq(S.state.history.length, h0, 'refused: no undo step');
}

// ================================================================ 4. rename: every formula follows (token by token), ONE undo step
{
  const S = openBoxFrame();
  ok(commit(S, { kind: 'new', name: 'thickness2', text: 'thickness * 2', unit: 'mm' }).ok, 'a parameter thickness2 = thickness * 2');
  ok(commit(S, { kind: 'new', name: 'edge', text: 'thickness2 + thickness', unit: 'mm' }).ok, 'a parameter edge = thickness2 + thickness');
  const h0 = S.state.history.length;
  const p = plan(S, { kind: 'parameter', column: 'name', name: 'thickness', text: 'ply' });
  eq([p.ok, p.hint, p.label], [true, 'renames thickness to ply; thickness2, edge, d3 follow', 'rename parameter thickness -> ply'], 'the rename preview names who follows');
  ok(muted(() => commitTableEdit(S.state, p)).ok, 'renamed');
  eq(S.state.parameters.map((x) => [x.name, x.expression]), [['length', '1500 mm'], ['width', '400 mm'], ['ply', '18 mm'], ['thickness2', 'ply * 2'], ['edge', 'thickness2 + ply']],
    'the parameter is renamed; every formula reading it follows, thickness2 (a longer name) is untouched');
  eq(D(S, 'd3').expression, 'ply', 'the dimension formula follows');
  eq(S.state.history.length, h0 + 1, 'ONE undo step');
  eq(xLevels(S), [0, 18, 382, 400], 'a rename moves nothing');
  // a dimension rename: d3 -> board; the formulas reading d3 (d4 .. d14) follow
  const pd = plan(S, { kind: 'dimension', column: 'name', constraint: D(S, 'd3'), text: 'board' });
  eq([pd.ok, pd.label], [true, 'rename dimension d3 -> board'], 'a dimension rename plans');
  ok(muted(() => commitTableEdit(S.state, pd)).ok, 'the dimension renamed');
  ok(!!D(S, 'board') && !D(S, 'd3'), 'd3 is now board');
  eq(D(S, 'd4').expression, 'board', 'd4 follows');
  eq(D(S, 'd11').expression, '(d2 - 6 * board) / 5', 'd11 follows inside its formula');
  eq(S.state.history.length, h0 + 2, 'ONE more undo step');
  muted(() => S.state.undo());
  eq(D(S, 'd4').expression, 'd3', 'undo: d4 reads d3 again');
  muted(() => S.state.undo());
  eq(P(S, 'thickness') && P(S, 'thickness').expression, '18 mm', 'undo: thickness is back');
  eq(P(S, 'edge').expression, 'thickness2 + thickness', 'undo: edge reads thickness again');
}

// ================================================================ 5. + Add, delete, comment
{
  const S = openBoxFrame();
  const h0 = S.state.history.length;
  const add = plan(S, { kind: 'new', name: 'gap', text: '5', unit: 'mm', comment: 'between boards' });
  eq([add.ok, add.hint, add.label], [true, 'creates gap = 5.0 mm', 'create parameter gap'], 'a new parameter plans');
  ok(muted(() => commitTableEdit(S.state, add)).ok, 'created');
  eq(P(S, 'gap'), { name: 'gap', unit: 'mm', expression: '5 mm', comment: 'between boards' }, 'gap = 5 mm with its comment');
  eq(S.state.history.length, h0 + 1, 'ONE undo step');
  const fill = plan(S, { kind: 'new', name: '', text: 'shelf = width / 4', unit: 'mm' });
  eq([fill.ok, fill.fill, fill.hint], [true, { name: 'shelf', expression: 'width / 4' }, 'creates shelf = 100.0 mm'], '`name = expr` in the Expression cell fills both');
  ok(muted(() => commitTableEdit(S.state, fill)).ok && P(S, 'shelf').expression === 'width / 4', 'shelf created from name = expr');
  eq(plan(S, { kind: 'new', name: 'n', text: '4', unit: '' }).hint, 'creates n = 4', 'a unitless count');
  for (const [e, code, msg, incomplete] of [
    [{ name: '', text: '5' }, 'BAD_NAME', 'give the new parameter a name', true],
    [{ name: 'x', text: '' }, 'SYNTAX', 'type the expression of x', true],
    [{ name: 'd7', text: '5', unit: 'mm' }, 'RESERVED_NAME', "'d7' is reserved for automatic dimension names", undefined],
    [{ name: 'width', text: '5', unit: 'mm' }, 'NAME_TAKEN', "'width' is already used", undefined],
    [{ name: 'q', text: '30 deg', unit: 'mm' }, 'UNIT_MISMATCH', 'a length cannot be an angle', undefined],
  ]) {
    const p = plan(S, { kind: 'new', ...e });
    eq([p.ok, p.code, p.message, p.incomplete], [false, code, msg, incomplete], `new ${JSON.stringify(e)}`);
  }
  eq(plan(S, { kind: 'new', name: ' ', text: '' }), { ok: true, changed: false }, 'an empty + Add row is nothing to apply');
  // comment: set, cleared (ONE undo step each)
  const h1 = S.state.history.length;
  ok(commit(S, { kind: 'parameter', column: 'comment', name: 'gap', text: 'the gap' }).ok && P(S, 'gap').comment === 'the gap', 'comment changed');
  ok(commit(S, { kind: 'parameter', column: 'comment', name: 'gap', text: '' }).ok && !('comment' in P(S, 'gap')), 'comment cleared');
  eq(S.state.history.length, h1 + 2, 'one undo step per comment edit');
  eq(plan(S, { kind: 'parameter', column: 'comment', name: 'width', text: 'Width' }), { ok: true, changed: false }, 'the same comment changes nothing');
  // delete: refused while in use, allowed once unused
  const used = plan(S, { kind: 'parameter', column: 'delete', name: 'thickness' });
  eq([used.ok, used.code, used.message], [false, 'IN_USE', 'thickness is used by d3'], 'thickness is in use: refused, its users listed');
  ok(commit(S, { kind: 'new', name: 'half', text: 'gap / 2', unit: 'mm' }).ok, 'half reads gap');
  eq(plan(S, { kind: 'parameter', column: 'delete', name: 'gap' }).message, 'gap is used by half', 'gap is in use by half');
  const h2 = S.state.history.length;
  ok(commit(S, { kind: 'parameter', column: 'delete', name: 'half' }).ok && !P(S, 'half'), 'half deleted');
  ok(commit(S, { kind: 'parameter', column: 'delete', name: 'gap' }).ok && !P(S, 'gap'), 'gap deleted once unused');
  eq(S.state.history.length, h2 + 2, 'one undo step per delete');
  muted(() => S.state.undo());
  eq(P(S, 'gap').expression, '5 mm', 'undo brings gap back');
}

// ================================================================ 6. a dimension's Expression: the canvas box's own plan
{
  const S = openBoxFrame();
  const d1 = D(S, 'd1');
  const num = plan(S, { kind: 'dimension', column: 'expression', constraint: d1, text: '420' });
  eq([num.ok, num.hint, num.label], [true, '= 420.0 mm', 'edit dimension 400 -> 420'], 'a number: the canvas box hint and label');
  const mk = plan(S, { kind: 'dimension', column: 'expression', constraint: d1, text: 'deep = 380' });
  eq([mk.ok, mk.hint, mk.label], [true, 'creates deep = 380.0 mm', 'create parameter deep'], '`name = value` creates a parameter (as on the canvas)');
  const h0 = S.state.history.length;
  ok(muted(() => commitTableEdit(S.state, mk)).ok, 'applied');
  eq([D(S, 'd1').expression, Math.round(D(S, 'd1').value * 1e9) / 1e9, P(S, 'deep').expression], ['deep', 380, '380 mm'], 'd1 reads deep = 380');
  eq(xLevels(S), [0, 18, 362, 380], 'the box is 380 wide');
  eq(S.state.history.length, h0 + 1, 'ONE undo step (parameter created + dimension rewired)');
  const unknown = plan(S, { kind: 'dimension', column: 'expression', constraint: D(S, 'd1'), text: 'gap' });
  eq([unknown.ok, unknown.message], [false, "unknown parameter 'gap' (type gap = 30 to create it)"], 'an unknown name is refused (O5)');
  eq(plan(S, { kind: 'dimension', column: 'expression', constraint: D(S, 'd1'), text: '  ' }).message, 'type a value or a formula', 'an empty Expression is refused');
  eq(dependentDimensions(S.state, 'thickness').map((c) => c.name), ['d3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11', 'd12', 'd13', 'd14'],
    'a user row selects every dimension that depends on it (directly or through d3)');
}

console.log(`parameter-table-edit-677: ok (${checks} checks)`);
