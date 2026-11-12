// TASK 535 slice 1b — packages/core/parameters.js: the parameter store's dependency graph, cycle detection, evaluation order,
// planChange (set / create / rename / delete), freezeReferencesTo and the automatic dimension names.
// PURE: builds plain state objects { parameters, constraints } (no solver, no DOM).
import {
  planChange, evaluateAll, buildDependencyGraph, freezeReferencesTo, usersOf, nextDimensionName, cloneParameters, replaceParameters,
  isDimension, AUTO_NAME_PREFIX,
} from '#core/parameters.js';

const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'not equal'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

const P = (name, expression, unit = 'mm', extra = {}) => ({ name, unit, expression, ...extra });
const D = (name, value, expression, extra = {}) => ({
  type: 'distance', joints: ['a', 'b'], value, name, isDriven: false, driven: false, ...(expression ? { expression } : {}), ...extra,
});
const A = (name, value, expression) => ({ type: 'angle', shapes: ['s1', 's2'], value, name, isDriven: false, driven: false, ...(expression ? { expression } : {}) });
const val = (state, name) => evaluateAll(state).values.get(name);

// ── chains of any depth: p1 = 10 mm, p(k+1) = p(k) + 1 mm; one dimension reads the last ──
for (const depth of [1, 2, 3, 5, 10, 40]) {
  const parameters = [P('p1', '10 mm')];
  for (let k = 2; k <= depth; k++) parameters.push(P(`p${k}`, `p${k - 1} + 1 mm`));
  const state = { parameters, constraints: [D('d1', 0, `p${depth}`)] };
  const r = evaluateAll(state);
  assert(r.ok, `depth ${depth} evaluates: ${JSON.stringify([...r.errors])}`);
  assert(near(r.values.get('d1').v, 10 + depth - 1), `depth ${depth}: d1 = ${r.values.get('d1').v}`);
  // a change at the root reaches the leaf dimension
  const plan = planChange(state, { type: 'setParameter', name: 'p1', text: '100' });
  assert(plan.ok, `depth ${depth} plan: ${plan.message}`);
  eq(plan.affected, ['d1'], `depth ${depth} affected`);
  assert(near(plan.edits[0].value, 100 + depth - 1), `depth ${depth}: new d1 ${plan.edits[0].value}`);
}

// ── evaluation order: dependencies first, ties by list order (parameters in table order, then dimensions in constraint order) ──
{
  const state = {
    parameters: [P('c', 'b + 1 mm'), P('a', '1 mm'), P('b', 'a + 1 mm')],
    constraints: [D('d1', 0, 'c'), D('d2', 5), D('d3', 0, 'a')],
  };
  const g = buildDependencyGraph(state);
  assert(g.ok, 'no cycle');
  const pos = (n) => g.order.indexOf(n);
  assert(pos('a') < pos('b') && pos('b') < pos('c') && pos('c') < pos('d1') && pos('a') < pos('d3'), 'dependencies come first');
  eq(g.order, ['a', 'b', 'c', 'd1', 'd2', 'd3'], 'ties broken by list order');
  eq(buildDependencyGraph(state).order, g.order, 'deterministic');
}

// ── diamond: top -> left, right -> bottom ──
{
  const state = { parameters: [P('bottom', '2 mm'), P('left', 'bottom * 2'), P('right', 'bottom * 3'), P('top', 'left + right')], constraints: [D('d1', 0, 'top')] };
  assert(near(val(state, 'd1').v, 10), 'diamond value');
  const plan = planChange(state, { type: 'setParameter', name: 'bottom', text: '4' });
  assert(plan.ok && near(plan.edits[0].value, 20), 'diamond change');
}

// ── cycles: self, 2, 3; refused before anything is touched; the cycle path is reported ──
{
  const base = { parameters: [P('a', '1 mm'), P('b', 'a + 1 mm'), P('c', 'b + 1 mm')], constraints: [D('d1', 3, 'c')] };
  const self = planChange(base, { type: 'setParameter', name: 'a', text: 'a + 1' });
  assert(!self.ok && self.code === 'CYCLE', 'self reference is a cycle');
  eq(self.cycle, ['a', 'a'], 'self cycle path');
  const two = planChange(base, { type: 'setParameter', name: 'a', text: 'b' });
  assert(!two.ok && two.code === 'CYCLE', '2-cycle'); eq(two.cycle, ['a', 'b', 'a'], '2-cycle path'); assert(two.message === 'a -> b -> a', two.message);
  const three = planChange(base, { type: 'setParameter', name: 'a', text: 'c' });
  assert(!three.ok && three.code === 'CYCLE', '3-cycle'); eq(three.cycle, ['a', 'c', 'b', 'a'], '3-cycle path');
  const viaDim = planChange(base, { type: 'setDimension', name: 'd1', text: 'a + d1' });
  assert(!viaDim.ok && viaDim.code === 'CYCLE', 'a dimension reading itself');
  const created = planChange(base, { type: 'createParameter', name: 'z', unit: 'mm', text: 'z + 1' });
  assert(!created.ok && created.code === 'UNKNOWN_NAME', 'a new parameter cannot read itself (it does not exist yet)');
  // the state was never touched
  eq(base.parameters.map((p) => p.expression), ['1 mm', 'a + 1 mm', 'b + 1 mm'], 'state untouched by refused plans');
  // a stored loop cannot be evaluated or planned
  const loop = { parameters: [P('a', 'b'), P('b', 'a')], constraints: [] };
  assert(!buildDependencyGraph(loop).ok && buildDependencyGraph(loop).code === 'CYCLE', 'stored loop reported');
  assert(evaluateAll(loop).code === 'CYCLE', 'evaluateAll reports a stored loop');
}

// ── planChange lists EVERY affected dimension (direct readers and readers through other parameters), in constraint order ──
{
  const state = {
    parameters: [P('width', '120 mm'), P('gap', 'width / 4 + 2 mm'), P('unrelated', '5 mm')],
    constraints: [D('d1', 120, 'width'), D('d2', 32, 'gap'), D('d3', 5, 'unrelated'), D('d4', 60, 'width / 2'), D('d5', 7), A('d6', 45)],
  };
  const plan = planChange(state, { type: 'setParameter', name: 'width', text: '200' });
  assert(plan.ok, plan.message);
  eq(plan.affected, ['d1', 'd2', 'd4'], 'affected = d1 (direct), d2 (through gap), d4 (direct)');
  eq(plan.edits.map((e) => e.name), ['d1', 'd2', 'd4'], 'edits');
  eq(plan.edits.map((e) => e.value), [200, 52, 100], 'new values');
  eq(plan.edits.map((e) => e.c === state.constraints.find((c) => c.name === e.name)), [true, true, true], 'edits carry the constraint object');
  assert(plan.solve === true, 'values change: a solve is needed');
  // nothing in the state moved
  eq(state.constraints.map((c) => c.value), [120, 32, 5, 60, 7, 45], 'planChange never writes value');
  eq(state.parameters[0].expression, '120 mm', 'planChange never writes the parameter');
  eq(plan.paramsAfter.find((p) => p.name === 'width').expression, '200 mm', 'paramsAfter');
  // setting a value to what it is: affected, but no edits, no solve
  const same = planChange(state, { type: 'setParameter', name: 'width', text: '120 mm' });
  assert(same.ok && same.edits.length === 0 && same.solve === false && same.affected.length === 3, 'no-op change');
}

// ── units: a unitless result in a length parameter is taken in the parameter's unit; an inch parameter keeps inches; angles ──
{
  const state = { parameters: [P('w', '1 in', 'in'), P('n', '4', ''), P('a', '30 deg', 'deg')], constraints: [D('d1', 25.4, 'w'), A('d2', 30, 'a')] };
  assert(near(val(state, 'w').v, 25.4) && near(val(state, 'a').v, 30) && val(state, 'n').v === 4, 'values in base units');
  const p1 = planChange(state, { type: 'setParameter', name: 'w', text: '2' });
  eq(p1.paramsAfter.find((p) => p.name === 'w').expression, '2 in', 'a bare 2 in an inch parameter is 2 in');
  assert(near(p1.edits[0].value, 50.8), 'in mm');
  const bad = planChange(state, { type: 'setParameter', name: 'w', text: '30 deg' });
  assert(!bad.ok && bad.code === 'UNIT_MISMATCH', 'an angle in a length parameter');
  const bad2 = planChange(state, { type: 'setDimension', name: 'd1', text: 'a' });
  assert(!bad2.ok && bad2.code === 'UNIT_MISMATCH', 'a length dimension cannot read an angle parameter');
}

// ── setDimension: number, formula, name = expression ──
{
  const state = { parameters: [P('width', '120 mm')], constraints: [D('d1', 120, 'width'), D('d2', 10), A('d3', 45), D('d4', 50, null, { isDriven: true, driven: true })] };
  const plain = planChange(state, { type: 'setDimension', name: 'd1', text: '2.5 in' });
  assert(plain.ok && plain.edits[0].expression === null && near(plain.edits[0].value, 63.5), 'a plain number deletes the formula');
  const frac = planChange(state, { type: 'setDimension', name: 'd2', text: '1/2 in' });
  assert(frac.ok && frac.edits[0].expression === null && near(frac.edits[0].value, 12.7), '1/2 in is a plain number');
  const formula = planChange(state, { type: 'setDimension', name: 'd2', text: 'width/2+5' });
  assert(formula.ok && formula.edits[0].expression === 'width / 2 + 5 mm' && near(formula.edits[0].value, 65), `canonical text: ${formula.edits[0].expression}`);
  const create = planChange(state, { type: 'setDimension', name: 'd2', text: 'gap = width / 4 + 2 mm' });
  assert(create.ok && create.created === 'gap' && create.paramsAfter.length === 2, 'name = expr creates a parameter');
  eq(create.paramsAfter[1], { name: 'gap', unit: 'mm', expression: 'width / 4 + 2 mm' }, 'created parameter');
  eq(create.edits.map((e) => [e.name, e.expression, e.value]), [['d2', 'gap', 32]], 'the dimension now reads it');
  const ang = planChange(state, { type: 'setDimension', name: 'd3', text: 'turn = 90' });
  eq(ang.paramsAfter[1], { name: 'turn', unit: 'deg', expression: '90 deg' }, 'an angle dimension creates a deg parameter');
  const wrongKind = planChange(state, { type: 'setDimension', name: 'd2', text: 'g = 30 deg' });
  assert(!wrongKind.ok && wrongKind.code === 'UNIT_MISMATCH', 'g = 30 deg in a length box creates nothing');
  const existing = planChange(state, { type: 'setDimension', name: 'd2', text: 'width = 140' });
  assert(existing.ok && !existing.created && existing.paramsAfter[0].expression === '140 mm', 'O4: sets the existing parameter');
  eq(existing.affected, ['d1', 'd2'], 'O4: also changes d1');
  assert(!planChange(state, { type: 'setDimension', name: 'd2', text: 'gap' }).ok && planChange(state, { type: 'setDimension', name: 'd2', text: 'gap' }).code === 'UNKNOWN_NAME', 'O5: unknown name refused');
  for (const [text, code] of [['d5 = 40', 'RESERVED_NAME'], ['mm = 3', 'RESERVED_NAME'], ['sqrt = 2', 'RESERVED_NAME'], ['d1 = 3', 'RESERVED_NAME'], ['2x = 3', null]]) {
    const r = planChange(state, { type: 'setDimension', name: 'd2', text });
    assert(!r.ok && (code === null || r.code === code), `${text} refused (${r.code})`);
  }
  const ref = planChange(state, { type: 'setDimension', name: 'd4', text: '30' });
  assert(!ref.ok && ref.code === 'REFERENCE_DIM', 'a reference dimension takes no value');
  const readsRef = planChange(state, { type: 'setDimension', name: 'd2', text: 'd4 + 1' });
  assert(!readsRef.ok && readsRef.code === 'REFERENCE_DIM', 'O9: a formula cannot read a reference dimension');
  assert(planChange(state, { type: 'setDimension', name: 'nope', text: '1' }).code === 'UNKNOWN_NAME', 'unknown dimension');
}

// ── create parameter ──
{
  const state = { parameters: [P('width', '120 mm')], constraints: [D('d1', 120, 'width')] };
  const ok = planChange(state, { type: 'createParameter', name: 'half', unit: 'mm', text: 'width / 2', comment: 'half of it' });
  eq(ok.paramsAfter[1], { name: 'half', unit: 'mm', expression: 'width / 2', comment: 'half of it' }, 'created parameter');
  assert(ok.ok && ok.paramsAfter[1].comment === 'half of it' && ok.paramsAfter[1].name === 'half', 'created with comment');
  assert(planChange(state, { type: 'createParameter', name: 'width', unit: 'mm', text: '1' }).code === 'NAME_TAKEN', 'name in use');
  assert(planChange(state, { type: 'createParameter', name: 'd1', unit: 'mm', text: '1' }).code === 'RESERVED_NAME', 'O7: d<digits> reserved for parameters');
  assert(planChange(state, { type: 'createParameter', name: 'Width', unit: 'mm', text: '1' }).ok, 'O6: case-sensitive: Width beside width');
  assert(planChange(state, { type: 'createParameter', name: 'x', unit: 'furlong', text: '1' }).ok === false, 'unit must be in the table');
  assert(planChange(state, { type: 'createParameter', name: 'x', unit: 'mm', text: 'y = 2' }).code === 'ASSIGN_NOT_TOP' || !planChange(state, { type: 'createParameter', name: 'x', unit: 'mm', text: 'y = 2' }).ok, 'no = in an expression cell');
  assert(planChange(state, { type: 'createParameter', name: 'count', unit: '', text: '4' }).ok, 'unitless parameter');
}

// ── rename follows references, token by token ──
{
  const state = {
    parameters: [P('width', '120 mm'), P('width2', 'width * 2'), P('gap', 'width / 4 + width2 / 8')],
    constraints: [D('d1', 120, 'width'), D('d2', 240, 'width2'), D('d3', 120, 'max(width; d1)'), D('d4', 7)],
  };
  const r = planChange(state, { type: 'renameParameter', name: 'width', to: 'w' });
  assert(r.ok, r.message);
  eq(r.paramsAfter.map((p) => p.name), ['w', 'width2', 'gap'], 'the parameter is renamed');
  eq(r.paramsAfter.map((p) => p.expression), ['120 mm', 'w * 2', 'w / 4 + width2 / 8'], 'width2 is NOT changed, width in other expressions is');
  eq(r.edits.map((e) => [e.name, e.expression]), [['d1', 'w'], ['d3', 'max(w; d1)']], 'dimension formulas rewritten');
  assert(r.solve === false, 'a rename needs no solve');
  const rd = planChange(state, { type: 'renameDimension', name: 'd1', to: 'slot_len' });
  assert(rd.ok, rd.message);
  eq(rd.edits.map((e) => [e.name, e.expression]), [['slot_len', 'width'], ['d3', 'max(width; slot_len)']], 'the dimension and its readers');
  assert(rd.solve === false, 'dimension rename needs no solve');
  assert(planChange(state, { type: 'renameDimension', name: 'd1', to: 'd2' }).code === 'NAME_TAKEN', 'rename onto a taken name');
  assert(planChange(state, { type: 'renameDimension', name: 'd1', to: 'width' }).code === 'NAME_TAKEN', 'one name space for parameters and dimensions');
  assert(planChange(state, { type: 'renameParameter', name: 'width', to: 'd9' }).code === 'RESERVED_NAME', 'O7 on rename');
  assert(planChange(state, { type: 'renameParameter', name: 'width', to: 'mm' }).code === 'RESERVED_NAME', 'a unit name');
  assert(planChange(state, { type: 'renameParameter', name: 'width', to: 'a b' }).code === 'BAD_NAME', 'no space');
  assert(planChange(state, { type: 'renameDimension', name: 'd1', to: 'anything_valid' }).ok, 'O7: a dimension may be renamed to anything valid');
  assert(planChange(state, { type: 'renameParameter', name: 'width', to: 'width' }).ok, 'rename to itself is a no-op');
}

// ── delete: refused while used; allowed unused ──
{
  const state = { parameters: [P('width', '120 mm'), P('gap', 'width / 4'), P('spare', '1 mm')], constraints: [D('d1', 120, 'width'), D('d2', 30, 'gap'), D('d3', 5, 'width / 24')] };
  const r = planChange(state, { type: 'deleteParameter', name: 'width' });
  assert(!r.ok && r.code === 'IN_USE', 'delete in use refused');
  assert(r.message === 'width is used by gap, d1, d3', r.message);
  eq(r.users, ['gap', 'd1', 'd3'], 'users listed');
  eq(usersOf(state, 'width'), ['gap', 'd1', 'd3'], 'usersOf');
  const ok = planChange(state, { type: 'deleteParameter', name: 'spare' });
  assert(ok.ok && ok.paramsAfter.length === 2 && ok.edits.length === 0, 'unused parameter deleted');
  assert(state.parameters.length === 3, 'state untouched');
}

// ── setComment ──
{
  const state = { parameters: [P('width', '120 mm')], constraints: [] };
  eq(planChange(state, { type: 'setComment', name: 'width', comment: 'outer' }).paramsAfter[0], { name: 'width', unit: 'mm', expression: '120 mm', comment: 'outer' }, 'comment set');
  assert(planChange(state, { type: 'bogus' }).ok === false, 'unknown change refused');
}

// ── freezeReferencesTo (O10): dependents become their current numbers; nothing moves ──
{
  const state = {
    parameters: [P('gap', 'd1 / 4 + 2 mm'), P('holes', '4', ''), P('other', '3 mm')],
    constraints: [D('d1', 120), D('d2', 32, 'gap'), D('d3', 60, 'd1 / 2'), D('d4', 9, 'other * 3'), D('d5', 1, 'holes / 4')],
  };
  const before = evaluateAll(state).values;
  const r = freezeReferencesTo(state, ['d1']);
  assert(r.ok, r.message);
  eq(r.frozen, ['gap', 'd3'], 'frozen: gap (parameter) and d3 (dimension)');
  assert(state.parameters[0].expression === '32 mm', `gap frozen to ${state.parameters[0].expression}`);
  assert(!('expression' in state.constraints[2]) && state.constraints[2].value === 60, 'd3 is a plain number now');
  assert(state.constraints[1].expression === 'gap' && state.constraints[3].expression === 'other * 3', 'others untouched');
  const after = evaluateAll(state).values;
  for (const k of ['gap', 'd2', 'd3', 'd4', 'd5']) assert(near(before.get(k).v, after.get(k).v), `${k} did not move`);
  // a negative parameter value freezes with its sign and unit
  const neg = { parameters: [P('off', '-5 mm'), P('x', 'off * 2')], constraints: [] };
  freezeReferencesTo(neg, ['off']);
  assert(neg.parameters[1].expression === '-10 mm', neg.parameters[1].expression);
  const inch = { parameters: [P('base', '1 in', 'in'), P('x', 'base * 2', 'in')], constraints: [] };
  freezeReferencesTo(inch, ['base']);
  assert(inch.parameters[1].expression === '2 in', inch.parameters[1].expression);
}

// ── automatic names (O22): highest dN + 1 ──
{
  assert(AUTO_NAME_PREFIX === 'd', 'prefix');
  assert(nextDimensionName([]) === 'd1', 'first');
  assert(nextDimensionName([D('d1', 1), D('d2', 1)]) === 'd3', 'next');
  assert(nextDimensionName([D('d1', 1), D('d7', 1), D('d2', 1)]) === 'd8', 'highest + 1, not count + 1');
  assert(nextDimensionName([D('d1', 1), D('d2', 1), D('d3', 1)].slice(0, 2)) === 'd3', 'a number is reused after the highest is deleted');
  assert(nextDimensionName([D('slot', 1), D('d2x', 1)]) === 'd1', 'only dN counts');
  assert(isDimension({ type: 'distance' }) && isDimension({ type: 'angle' }) && !isDimension({ type: 'coincident' }) && !isDimension(null), 'isDimension');
}

// ── cloneParameters / replaceParameters ──
{
  const src = [{ name: 'a', unit: 'mm', expression: '1 mm', comment: '' }, { name: 'b', unit: '', expression: '2', comment: 'c' }];
  const c = cloneParameters(src);
  eq(c, [{ name: 'a', unit: 'mm', expression: '1 mm' }, { name: 'b', unit: '', expression: '2', comment: 'c' }], 'empty comment omitted, field order fixed');
  c[0].name = 'z'; assert(src[0].name === 'a', 'deep copy');
  const live = [{ name: 'old', unit: '', expression: '0' }];
  const keep = live; replaceParameters(live, src); assert(keep === live && live.length === 2, 'identity kept');
  replaceParameters(live, undefined); assert(live.length === 0, 'absent source clears');
}

console.log('parameters-graph: OK');
