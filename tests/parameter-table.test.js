// TASK 535 slice 4 — packages/ui/parameter-table.js buildParameterRows: the ONE pure function (state -> rows) the Parameters window shows.
// PURE (plain state objects, no DOM): every dimension mode of the coverage inventory x {driving, reference} x {plain value, formula},
// user parameters (through parameters.js planChange / state directly: no UI producer exists yet), unit formatting in mm and in,
// the filter, the empty states, and agreement with the canvas formatter (formatConstraintValue) for every value.
import SettingsManager from '#core/settings-manager.js';
import { buildParameterRows, USER_EMPTY_TEXT, DIMENSION_EMPTY_TEXT } from '#ui/parameter-table.js';
import { formatConstraintValue } from '#ui/svg-renderer.js';
import { planChange } from '#core/parameters.js';
import inventory from './harness/coverage/inventory.js';

const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'not equal'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

// one constraint per inventory dimension mode, in the shape the Dimension tool creates it
const SHAPES = [
  { id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] },
  { id: 'C1', type: 'circle', joints: ['cc', 'cr'], radius: 8 }, { id: 'A1', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'] },
];
const MODE_SHAPE = {
  aligned: { joints: ['a', 'b'] }, horizontal: { joints: ['a', 'b'], dimMode: 'horizontal' }, vertical: { joints: ['a', 'b'], dimMode: 'vertical' },
  'line length': { joints: ['a', 'b'] }, 'point-line': { joints: ['p', 'c', 'd'] }, 'line-line': { shapes: ['L1', 'L2'] },
  angle: { type: 'angle', shapes: ['L1', 'L2'] }, radius: { shape: 'C1', isRadius: true },
};
const modes = inventory.dimensionModes.map((m) => m.mode);
assert(modes.length === Object.keys(MODE_SHAPE).length && modes.every((m) => MODE_SHAPE[m]), 'the test covers every dimension mode of the inventory: ' + modes.join(', '));
const VALUE = { angle: 37.25 }; // degrees; every other mode 25.4 mm = 1 in exactly

const build = () => {
  const constraints = [];
  let n = 0;
  for (const mode of modes) for (const reference of [false, true]) for (const withFormula of [false, true]) {
    if (reference && withFormula) continue; // a reference dimension never has a formula (decision O9)
    n++;
    const c = { type: 'distance', value: VALUE[mode] || 25.4, name: `d${n}`, isDriven: reference, driven: reference, ...MODE_SHAPE[mode] };
    if (withFormula) c.expression = mode === 'angle' ? '30 deg + 7.25 deg' : '1 in';
    Object.defineProperty(c, '__mode', { value: mode, enumerable: false });
    constraints.push(c);
  }
  return constraints;
};

// ── every mode x {driving, reference} x {plain, formula}: one row each, in constraint order, with the right marks ──
for (const unit of ['mm', 'in']) {
  SettingsManager.set('DOC_UNIT', unit);
  const state = { parameters: [], constraints: build(), shapes: SHAPES };
  const rows = buildParameterRows(state, { unit });
  eq(rows.dimensions.length, state.constraints.length, `${unit}: one row per dimension`);
  eq(rows.dimensions.map((r) => r.name), state.constraints.map((c) => c.name), `${unit}: constraint order, names d1..`);
  state.constraints.forEach((c, i) => {
    const r = rows.dimensions[i];
    const what = `${unit} ${c.__mode} ${c.isDriven ? 'reference' : 'driving'} ${c.expression ? 'formula' : 'plain'}`;
    const isAngle = c.type === 'angle';
    assert(r.constraint === c, `${what}: the row carries its constraint`);
    assert(r.reference === !!c.isDriven, `${what}: reference mark`);
    assert(r.hasExpression === !!c.expression, `${what}: formula mark`);
    assert(!r.error, `${what}: its formula evaluates (${r.error})`);
    eq(r.unit, isAngle ? 'deg' : unit, `${what}: unit column`);
    // THE canvas formatter agrees: value text == the canvas label with its brackets / R prefix / degree sign removed
    const canvas = formatConstraintValue(c).replace(/^fx: /, '').replace(/^[RØ] /, '').replace(/^\((.*)\)$/, '$1').replace('°', '');
    const shown = r.value.replace(/^\((.*)\)$/, '$1');
    eq(shown, canvas, `${what}: value text = canvas label`);
    if (c.isDriven) { assert(/^\(.*\)$/.test(r.value), `${what}: reference value in brackets: ${r.value}`); eq(r.expression, '(reference)', `${what}: expression`); }
    else if (c.expression) eq(r.expression, c.expression, `${what}: the formula text is shown`);
    else eq(r.expression, r.value, `${what}: no formula -> the plain value`);
    assert(r.kindLabel === (isAngle ? 'Angle' : c.isRadius ? 'Radius' : 'Distance'), `${what}: kind ${r.kindLabel}`);
    assert(r.measures && r.measures.length > 0, `${what}: the geometry it measures: "${r.measures}"`);
  });
  // the same value in the other unit really differs (25.4 mm = 1.0 in)
  const plainAligned = rows.dimensions.find((r) => !r.reference && !r.hasExpression && r.kindLabel === 'Distance');
  eq(plainAligned.value, unit === 'mm' ? '25.4' : '1.0', `${unit}: 25.4 mm shown in the document unit`);
}

// ── user parameters: built through planChange (create); values in the parameter's own unit, errors as data ──
{
  const state = { parameters: [], constraints: [{ type: 'distance', joints: ['a', 'b'], value: 10, name: 'd1', isDriven: false, driven: false }], shapes: [] };
  for (const change of [
    { type: 'createParameter', name: 'width', unit: 'mm', text: '120 mm', comment: 'outer width' },
    { type: 'createParameter', name: 'gap', unit: 'mm', text: 'width / 4 + 2 mm' },
    { type: 'createParameter', name: 'ang', unit: 'deg', text: '45' },
    { type: 'createParameter', name: 'holes', unit: '', text: '4' },
  ]) {
    const plan = planChange(state, change);
    assert(plan.ok, `${change.name}: ${plan.message}`);
    state.parameters.splice(0, state.parameters.length, ...plan.paramsAfter);
  }
  const mm = buildParameterRows(state, { unit: 'mm' });
  eq(mm.user.map((r) => [r.name, r.expression, r.value, r.unit, r.comment]), [
    ['width', '120 mm', '120.0', 'mm', 'outer width'], ['gap', 'width / 4 + 2 mm', '32.0', 'mm', ''], ['ang', '45 deg', '45.0', 'deg', ''], ['holes', '4', '4', '', ''],
  ], 'user rows: name, expression, value, unit, comment');
  assert(mm.user.every((r) => !r.error), 'no errors');
  // a parameter keeps its OWN unit whatever the document unit is
  eq(buildParameterRows(state, { unit: 'in' }).user.map((r) => r.value), ['120.0', '32.0', '45.0', '4'], "values stay in each parameter's own unit");
  // a dimension that reads a parameter: the formula text and the stored value
  state.constraints[0].expression = 'width / 2'; state.constraints[0].value = 60;
  const d = buildParameterRows(state, { unit: 'mm' }).dimensions[0];
  assert(d.hasExpression && d.expression === 'width / 2' && d.value === '60.0' && !d.error, `formula dimension row: ${JSON.stringify({ ...d, constraint: null })}`);
  // an error is data on the row (a formula reading a name that does not exist)
  state.parameters.push({ name: 'broken', unit: 'mm', expression: 'nosuch + 1 mm' });
  const br = buildParameterRows(state, { unit: 'mm' }).user.find((r) => r.name === 'broken');
  assert(br && br.error && br.value === '', `an unresolved name is an error on its row: ${JSON.stringify(br)}`);
  state.parameters.pop();
  // a loop: no value can be computed, the rows say so, nothing throws
  state.parameters.push({ name: 'p', unit: 'mm', expression: 'q' }, { name: 'q', unit: 'mm', expression: 'p' });
  const loop = buildParameterRows(state, { unit: 'mm' });
  assert(loop.user.filter((r) => r.name === 'p' || r.name === 'q').every((r) => r.error && /->/.test(r.error)), 'a loop is reported on its rows');
  state.parameters.splice(4, 2);

  // ── filter: name or expression contains the text, case-insensitive; the totals stay ──
  const f = buildParameterRows(state, { unit: 'mm', filter: 'WIDTH' });
  eq(f.user.map((r) => r.name), ['width', 'gap'], 'filter matches a name and an expression (gap reads width)');
  eq(f.dimensions.map((r) => r.name), ['d1'], 'filter matches the dimension whose formula reads width');
  eq(f.total, { user: 4, dimensions: 1 }, 'totals ignore the filter');
  eq(buildParameterRows(state, { unit: 'mm', filter: 'zzz' }).user, [], 'no match');
}

// ── empty states ──
{
  const r = buildParameterRows({ parameters: [], constraints: [], shapes: [] }, { unit: 'mm' });
  eq([r.user, r.dimensions, r.total], [[], [], { user: 0, dimensions: 0 }], 'empty document');
  assert(/name = value/.test(USER_EMPTY_TEXT) && !/\b(20\d\d|soon|next|version|slice)\b/i.test(USER_EMPTY_TEXT), 'the user empty text explains `name = value` and promises no date');
  assert(/Dim tool/.test(DIMENSION_EMPTY_TEXT), 'the dimension empty text names the tool');
  // non-dimension constraints and a state with no parameters array are not rows / do not throw
  const r2 = buildParameterRows({ constraints: [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'coincident', joints: ['a', 'c'] }] }, { unit: 'mm' });
  eq([r2.user.length, r2.dimensions.length], [0, 0], 'only dimensions are rows');
}
console.log('parameter-table: ok');
