// packages/core/parameters.js — TASK 535 slice 1b: the parameter MODEL of a document (docs/PARAMETERS-DESIGN.md sections A, C, D).
// PURE: no DOM, no #ui import. Nothing in the app calls planChange yet (slices 2-5 add the producers); today only tests do.
//
//   state.parameters   an array of USER parameters { name, unit, expression, comment? } (one list per DOCUMENT: decision O1).
//   a dimension        a DISTANCE or ANGLE constraint; it carries `name` (always: d1, d2, ...) and `expression` (only when a formula
//                      was typed). `value` stays the solver's truth; this module only computes what it SHOULD be.
//
// The dependency graph is built fresh on demand (never stored): node = every user parameter + every DRIVING dimension; edge = a
// name an expression reads. REFERENCE (driven) dimensions are not nodes and a formula cannot read one (decision O9).
// Values are quantities { v, L, A } in BASE units (mm, degrees), exactly what expression.js evaluates to.
// Errors are DATA ({ ok:false, code, message, ... }); nothing here throws on user input.

import { CONSTRAINT_TYPES } from '#core/constants.js';
import { unitInfo, format as formatUnit } from '#core/units.js';
import { parseInput, evaluate, canonicalize, dependencies, print, validateName, foldName, functionTable } from '#core/expression.js';

// ── DECLARED DECISIONS (docs/PARAMETERS-DESIGN.md owner table). Each switch is ONE constant. ──
export const AUTO_NAME_PREFIX = 'd';                  // O22  the automatic dimension name is prefix + number; the number is (highest existing dN) + 1,
                                                      //      derived from the constraints, nothing stored, so a number may be reused after the highest is deleted
export const PARAMETER_UNITS = ['', 'mm', 'cm', 'in', 'deg', 'rad']; // O18  '' = unitless (a count); the rest are the UNIT_TABLE entries
const SAME_VALUE = 1e-9;                              // two values closer than this are the same value (the design's value == evaluate(expression) tolerance)

// ── dimension helpers (the ONE definition of "a dimension" and "a reference dimension") ──
export const isDimension = (c) => !!c && (c.type === CONSTRAINT_TYPES.DISTANCE || c.type === CONSTRAINT_TYPES.ANGLE);
export const isReferenceDimension = (c) => !!c && !!(c.isDriven || c.driven);
const dimensionKind = (c) => (c.type === CONSTRAINT_TYPES.ANGLE ? 'angle' : 'length');

// nextDimensionName(constraints) → 'd' + (highest dN among the constraints' names + 1)  (O22)
export function nextDimensionName(constraints) {
  let highest = 0;
  const re = new RegExp(`^${AUTO_NAME_PREFIX}(\\d+)$`);
  for (const c of constraints || []) {
    const m = c && typeof c.name === 'string' ? re.exec(c.name) : null;
    if (m) highest = Math.max(highest, parseInt(m[1], 10));
  }
  return `${AUTO_NAME_PREFIX}${highest + 1}`;
}

// ── the ONE copy / restore of the parameter list (document save/load, undo snapshot, cancelUndoGroup all use these) ──
export function cloneParameters(list) {
  return (list || []).map((p) => {
    const out = { name: p.name, unit: p.unit, expression: p.expression };
    if (p.comment) out.comment = p.comment;
    return out;
  });
}
// replaceParameters(target array, source list): the live array keeps its identity (other code holds it)
export function replaceParameters(target, source) {
  target.length = 0;
  target.push(...cloneParameters(source));
}

export const parameterKind = (p) => { const u = p && p.unit ? unitInfo(p.unit) : null; return u ? u.kind : 'none'; };

// ── the model: parameters + dimensions as plain data (a planChange edits a COPY of it, never the state) ──
function modelOf(state) {
  return {
    params: cloneParameters(state.parameters),
    dims: (state.constraints || []).filter(isDimension).map((c) => ({
      c, name: c.name, kind: dimensionKind(c), driven: isReferenceDimension(c), value: c.value, expression: c.expression || null,
    })),
  };
}
const cloneModel = (m) => ({ params: cloneParameters(m.params), dims: m.dims.map((d) => ({ ...d })) });

// the nodes of the graph, in LIST ORDER (user parameters in table order, then driving dimensions in constraint order)
function nodesOf(model) {
  const nodes = [];
  for (const p of model.params) nodes.push({ key: foldName(p.name), name: p.name, type: 'parameter', ref: p, expression: p.expression || null });
  for (const d of model.dims) if (!d.driven && d.name) nodes.push({ key: foldName(d.name), name: d.name, type: 'dimension', ref: d, expression: d.expression });
  const byKey = new Map();
  for (const n of nodes) { n.index = byKey.size; byKey.set(n.key, n); }
  for (const n of nodes) {
    n.parsed = null; n.deps = [];
    if (n.expression != null) {
      const p = parseInput(n.expression, { allowAssign: false });
      if (p.ok) { n.parsed = p; n.deps = dependencies(p).filter((k) => byKey.has(k)); } else n.parseError = p;
    }
  }
  return { nodes, byKey };
}

// findCycle: depth-first search with three colours in list order; the first back edge gives the cycle path [a, b, ..., a]
function findCycle(nodes, byKey) {
  const colour = new Map(); // key → 1 (on the path) | 2 (done)
  const path = [];
  const visit = (n) => {
    colour.set(n.key, 1); path.push(n);
    for (const k of n.deps) {
      const m = byKey.get(k);
      if (colour.get(k) === 1) return [...path.slice(path.indexOf(m)), m];
      if (!colour.has(k)) { const c = visit(m); if (c) return c; }
    }
    path.pop(); colour.set(n.key, 2);
    return null;
  };
  for (const n of nodes) if (!colour.has(n.key)) { const c = visit(n); if (c) return c; }
  return null;
}

// evaluationOrder: Kahn's algorithm, ties broken by list order (so results never depend on hash order). Dependencies come first.
function evaluationOrder(nodes, byKey) {
  const indegree = new Map(nodes.map((n) => [n.key, n.deps.length]));
  const dependents = new Map(nodes.map((n) => [n.key, []]));
  for (const n of nodes) for (const k of n.deps) dependents.get(k).push(n);
  const ready = nodes.filter((n) => n.deps.length === 0).map((n) => n.index);
  const order = [];
  while (ready.length) {
    let best = 0;
    for (let i = 1; i < ready.length; i++) if (ready[i] < ready[best]) best = i;
    const n = nodes[ready.splice(best, 1)[0]];
    order.push(n);
    for (const m of dependents.get(n.key)) { const d = indegree.get(m.key) - 1; indegree.set(m.key, d); if (d === 0) ready.push(m.index); }
  }
  return order;
}

const cycleError = (cycle) => ({ ok: false, code: 'CYCLE', message: cycle.map((n) => n.name).join(' -> '), cycle: cycle.map((n) => n.name) });

// buildDependencyGraph(state) → { ok:true, order:[names, dependencies first] } | { ok:false, code:'CYCLE', cycle:[names], message }
export function buildDependencyGraph(state) {
  const g = graphOf(modelOf(state));
  return g.ok ? { ok: true, order: g.order.map((n) => n.name) } : g;
}
function graphOf(model) {
  const { nodes, byKey } = nodesOf(model);
  const cycle = findCycle(nodes, byKey);
  if (cycle) return cycleError(cycle);
  return { ok: true, nodes, byKey, order: evaluationOrder(nodes, byKey) };
}

// ── evaluation ──
const quantityOfDimension = (d) => ({ v: d.value, L: d.kind === 'length' ? 1 : 0, A: d.kind === 'angle' ? 1 : 0 });
function contextOf(node, docUnit) {
  if (node.type === 'dimension') return { target: node.ref.kind, unit: docUnit };
  const kind = parameterKind(node.ref);
  const u = node.ref.unit ? unitInfo(node.ref.unit) : null;
  return { target: kind, unit: u && kind === 'length' ? u.name : docUnit, angleUnit: u && kind === 'angle' ? u.name : undefined };
}

// evaluate every node of the model. → { ok, values: Map(key → {v,L,A}), errors: Map(key → error), graph } | the cycle error
function evaluateModel(model, docUnit = 'mm') {
  const graph = graphOf(model);
  if (!graph.ok) return graph;
  const values = new Map();
  const errors = new Map();
  const reference = new Map(model.dims.filter((d) => d.driven && d.name).map((d) => [foldName(d.name), d]));
  const lookup = (key) => {
    if (errors.has(key)) { const e = errors.get(key); return { ok: false, code: e.code, message: `${graph.byKey.get(key).name}: ${e.message}` }; }
    if (values.has(key)) return values.get(key);
    if (reference.has(key)) return { ok: false, code: 'REFERENCE_DIM', message: `${reference.get(key).name} is a reference dimension` };
    return undefined;
  };
  for (const n of graph.order) {
    if (n.expression == null) {
      if (n.type === 'dimension') values.set(n.key, quantityOfDimension(n.ref));
      else errors.set(n.key, { ok: false, code: 'SYNTAX', message: 'the parameter has no expression' });
      continue;
    }
    if (n.parseError) { errors.set(n.key, n.parseError); continue; }
    const r = evaluate(n.parsed.ast, lookup, contextOf(n, docUnit));
    if (r.ok) values.set(n.key, { v: r.v, L: r.L, A: r.A }); else errors.set(n.key, r);
  }
  return { ok: errors.size === 0, values, errors, graph };
}

// evaluateAll(state, { unit }) → { ok, values: Map(name → {v,L,A}), errors: Map(name → error), order:[names] } | { ok:false, code:'CYCLE', ... }
export function evaluateAll(state, { unit = 'mm' } = {}) {
  const r = evaluateModel(modelOf(state), unit);
  if (!r.graph || !r.graph.ok) return r;
  const named = (map) => new Map([...map].map(([k, v]) => [r.graph.byKey.get(k).name, v]));
  return { ok: r.ok, values: named(r.values), errors: named(r.errors), order: r.graph.order.map((n) => n.name) };
}

// usersOf(state, name) → the names of the user parameters and driving dimensions whose expression reads `name`, in list order
export function usersOf(state, name) {
  return usersInModel(graphOf(modelOf(state)), foldName(name));
}
function usersInModel(graph, key) {
  return graph.ok ? graph.nodes.filter((n) => n.deps.includes(key)).map((n) => n.name) : [];
}

// ── rewriting names inside an expression (rename follows references): token by token through the AST, never a text replace ──
function renameInAst(n, fromKey, to) {
  if (!n) return n;
  switch (n.t) {
    case 'name': return foldName(n.name) === fromKey ? { ...n, name: to } : n;
    case 'unit': case 'neg': return { ...n, arg: renameInAst(n.arg, fromKey, to) };
    case 'bin': return { ...n, left: renameInAst(n.left, fromKey, to), right: renameInAst(n.right, fromKey, to) };
    case 'call': return { ...n, args: n.args.map((a) => renameInAst(a, fromKey, to)) };
    default: return n;
  }
}

// a plain number: no name, no call, no operator but a "1/2 in" fraction (typed into a dimension it REPLACES any formula)
function isPlainNumber(n) {
  if (n.t === 'num') return true;
  if (n.t === 'neg') return isPlainNumber(n.arg);
  if (n.t === 'unit') return isPlainNumber(n.arg) || (n.arg.t === 'bin' && n.arg.op === '/' && n.arg.left.t === 'num' && n.arg.right.t === 'num');
  return false;
}

// the canonical text of a number in a unit ("-5 mm"); unitless for ''
function numberText(base, unit) {
  const u = unit ? unitInfo(unit) : null;
  const x = u ? base / u.f : base;
  const lit = { t: 'num', value: Math.abs(x) };
  const node = u ? { t: 'unit', unit: u.name, arg: lit } : lit;
  return print(x < 0 ? { t: 'neg', arg: node } : node);
}

// ── planChange ──
// planChange(state, change, { unit }) → { ok:true, paramsAfter, edits, affected, solve, created? } | { ok:false, code, message, ... }
//   Pure: nothing in `state` is touched. `edits` lists, per affected dimension (constraint order), what the batch commit must write:
//   { c, name, value (base mm / degrees), expression (string | null) } — only dimensions whose value, expression or name changes.
//   `affected` = every dimension that depends (directly or through other formulas) on what changed, plus the one edited.
//   `solve` = some value changes (renames and comment edits skip the solve).
//   change: { type:'setDimension', name, text }          text: a number, a formula, or  newName = expr  (creates / sets that user parameter)
//           { type:'setParameter', name, text }          the Expression cell of a user parameter (no "=")
//           { type:'createParameter', name, unit, text, comment? }
//           { type:'renameParameter' | 'renameDimension', name, to }
//           { type:'deleteParameter', name }
//           { type:'setComment', name, comment }
export function planChange(state, change, { unit = 'mm' } = {}) {
  const m0 = modelOf(state);
  const e0 = evaluateModel(m0, unit);
  if (!e0.graph || !e0.graph.ok) return e0; // the stored state already has a loop: nothing can be planned
  const m1 = cloneModel(m0);
  const roots = new Set(); // keys of the nodes the change touches directly
  let created;
  const takenKeys = (exceptKey) => new Set([...m1.params.map((p) => foldName(p.name)), ...m1.dims.filter((d) => d.name).map((d) => foldName(d.name))].filter((k) => k !== exceptKey));
  const paramOf = (name) => m1.params.find((p) => foldName(p.name) === foldName(name));
  const dimOf = (name) => m1.dims.find((d) => d.name && foldName(d.name) === foldName(name));
  const known = { values: e0.values, errors: e0.errors };
  const lookupBefore = (key) => {
    if (known.values.has(key)) return known.values.get(key);
    const d = m1.dims.find((x) => x.name && foldName(x.name) === key);
    if (d && d.driven) return { ok: false, code: 'REFERENCE_DIM', message: `${d.name} is a reference dimension` };
    return undefined;
  };
  const noSuch = (what, name) => ({ ok: false, code: 'UNKNOWN_NAME', message: `no ${what} named '${name}'`, names: [name] });
  const paramCtx = (p) => contextOf({ type: 'parameter', ref: p }, unit);
  const canon = (ast, ctx) => canonicalize(ast, lookupBefore, ctx);

  switch (change && change.type) {
    case 'setDimension': {
      const d = dimOf(change.name);
      if (!d) return noSuch('dimension', change.name);
      if (d.driven) return { ok: false, code: 'REFERENCE_DIM', message: `${d.name} is a reference dimension` };
      const parsed = parseInput(change.text);
      if (!parsed.ok) return parsed;
      const dctx = { target: d.kind, unit };
      let newExpression;
      if (parsed.assign) {
        const key = foldName(parsed.assign.name);
        const existing = paramOf(parsed.assign.name);
        if (existing) { // O4: set that parameter's expression
          const r = canon(parsed.ast, paramCtx(existing));
          if (!r.ok) return r;
          existing.expression = r.text;
        } else {
          const nameCheck = validateName(parsed.assign.name, { kind: 'parameter', isTaken: (k) => takenKeys(null).has(k) });
          if (!nameCheck.ok) return nameCheck;
          const punit = d.kind === 'angle' ? 'deg' : (unitInfo(unit) && unitInfo(unit).kind === 'length' ? unitInfo(unit).name : 'mm');
          const p = { name: parsed.assign.name, unit: punit, expression: '' };
          const r = canon(parsed.ast, paramCtx(p));
          if (!r.ok) return r;
          p.expression = r.text;
          m1.params.push(p);
          created = p.name;
        }
        roots.add(key);
        newExpression = parsed.assign.name; // the final evaluation checks that the parameter has the dimension's kind
      } else if (isPlainNumber(parsed.ast)) {
        const r = evaluate(parsed.ast, lookupBefore, dctx);
        if (!r.ok) return r;
        d.value = r.v; newExpression = null;
      } else {
        const r = canon(parsed.ast, dctx);
        if (!r.ok) return r;
        newExpression = r.text;
      }
      d.expression = newExpression;
      roots.add(foldName(d.name));
      break;
    }
    case 'setParameter': {
      const p = paramOf(change.name);
      if (!p) return noSuch('parameter', change.name);
      const parsed = parseInput(change.text, { allowAssign: false });
      if (!parsed.ok) return parsed;
      const r = canon(parsed.ast, paramCtx(p));
      if (!r.ok) return r;
      p.expression = r.text;
      roots.add(foldName(p.name));
      break;
    }
    case 'createParameter': {
      const nameCheck = validateName(change.name, { kind: 'parameter', isTaken: (k) => takenKeys(null).has(k) });
      if (!nameCheck.ok) return nameCheck;
      const punit = change.unit == null ? '' : change.unit;
      if (!PARAMETER_UNITS.includes(punit)) return { ok: false, code: 'UNIT_MISMATCH', message: `'${punit}' is not a unit a parameter can have`, at: { start: 0, end: 0 } };
      const parsed = parseInput(change.text, { allowAssign: false });
      if (!parsed.ok) return parsed;
      const p = { name: change.name, unit: punit, expression: '' };
      if (change.comment) p.comment = change.comment;
      const r = canon(parsed.ast, paramCtx(p));
      if (!r.ok) return r;
      p.expression = r.text;
      m1.params.push(p);
      created = p.name;
      roots.add(foldName(p.name));
      break;
    }
    case 'renameParameter': case 'renameDimension': {
      const isParam = change.type === 'renameParameter';
      const item = isParam ? paramOf(change.name) : dimOf(change.name);
      if (!item) return noSuch(isParam ? 'parameter' : 'dimension', change.name);
      const fromKey = foldName(item.name);
      const check = validateName(change.to, { kind: isParam ? 'parameter' : 'dimension', isTaken: (k) => takenKeys(fromKey).has(k) });
      if (!check.ok) return check;
      item.name = change.to;
      const toKey = foldName(change.to);
      const rewrite = (text) => {
        const p = parseInput(text, { allowAssign: false });
        return p.ok && dependencies(p).includes(fromKey) ? print(renameInAst(p.ast, fromKey, change.to)) : text;
      };
      for (const p of m1.params) if (p.expression) p.expression = rewrite(p.expression);
      for (const d of m1.dims) if (d.expression) d.expression = rewrite(d.expression);
      roots.add(toKey);
      break;
    }
    case 'deleteParameter': {
      const p = paramOf(change.name);
      if (!p) return noSuch('parameter', change.name);
      const users = usersInModel(graphOf(m0), foldName(p.name));
      if (users.length) return { ok: false, code: 'IN_USE', message: `${p.name} is used by ${users.join(', ')}`, users };
      m1.params.splice(m1.params.indexOf(p), 1);
      break;
    }
    case 'setComment': {
      const p = paramOf(change.name);
      if (!p) return noSuch('parameter', change.name);
      if (change.comment) p.comment = change.comment; else delete p.comment;
      break;
    }
    default:
      return { ok: false, code: 'SYNTAX', message: `unknown change '${change && change.type}'`, at: { start: 0, end: 0 } };
  }

  const e1 = evaluateModel(m1, unit);
  if (!e1.graph || !e1.graph.ok) return e1; // CYCLE: refused before anything is touched
  // closure: the touched nodes and everything that depends on them, directly or through other formulas
  const closure = new Set(roots);
  for (let grew = true; grew;) {
    grew = false;
    for (const n of e1.graph.nodes) if (!closure.has(n.key) && n.deps.some((k) => closure.has(k))) { closure.add(n.key); grew = true; }
  }
  for (const n of e1.graph.order) if (closure.has(n.key) && e1.errors.has(n.key)) {
    const e = e1.errors.get(n.key);
    return { ...e, ok: false, message: roots.has(n.key) ? e.message : `${n.name}: ${e.message}`, node: n.name };
  }
  const edits = [];
  const affected = [];
  let solve = false;
  for (const d of m1.dims) {
    if (d.driven || !d.name) continue;
    const key = foldName(d.name);
    const touched = closure.has(key);
    if (touched) affected.push(d.name);
    const v = e1.values.get(key);
    const value = v ? v.v : d.value;
    const before = d.c;
    const valueChanged = !(Math.abs(value - before.value) <= SAME_VALUE * Math.max(1, Math.abs(value)));
    const expressionChanged = (d.expression || null) !== (before.expression || null);
    const nameChanged = d.name !== before.name;
    if (valueChanged || expressionChanged || nameChanged) {
      edits.push({ c: before, name: d.name, value, expression: d.expression || null });
      if (valueChanged) solve = true;
    }
  }
  const out = { ok: true, paramsAfter: m1.params, edits, affected, solve };
  if (created) out.created = created;
  return out;
}

// ── freezeReferencesTo (decision O10) ──
// A DIMENSION is about to disappear while formulas read its name: every formula that reads any of `removedNames` is replaced by the
// canonical text of its CURRENT value, so nothing moves. A dimension has no formula after that (a plain number), a user parameter
// gets "<value> <unit>". Call it BEFORE the removal (the values are evaluated with the dimensions still present).
// Mutates state.parameters and the dimensions' `expression`; → { ok:true, frozen:[names] } | { ok:false, ... } (nothing changed).
export function freezeReferencesTo(state, removedNames, { unit = 'mm' } = {}) {
  const model = modelOf(state);
  const ev = evaluateModel(model, unit);
  if (!ev.graph || !ev.graph.ok) return ev;
  const gone = new Set(removedNames.map(foldName));
  const hit = ev.graph.nodes.filter((n) => !gone.has(n.key) && n.deps.some((k) => gone.has(k)));
  for (const n of hit) if (ev.errors.has(n.key)) return { ...ev.errors.get(n.key), ok: false, node: n.name };
  for (const n of hit) {
    const q = ev.values.get(n.key);
    if (n.type === 'parameter') {
      const p = (state.parameters || []).find((x) => x.name === n.name);
      p.expression = numberText(q.v, p.unit);
    } else {
      delete n.ref.c.expression;
    }
  }
  return { ok: true, frozen: hit.map((n) => n.name) };
}

// ── display text (TASK 535 slice 3: the canvas hint, the autocomplete rows and the parameter table all use THESE) ──
// a base value (mm / degrees) as text in `unit` ('' = a plain count); 1 decimal for lengths and angles like the canvas labels, up to 4 for a count
export function quantityText(v, unit) {
  if (!Number.isFinite(v)) return '';
  const u = unit ? unitInfo(unit) : null;
  if (!u) return String(Math.round(v * 1e4) / 1e4);
  if (u.kind === 'length') return formatUnit(v, u.name, { decimals: 1 });
  return (v / u.f).toFixed(1);
}
// the unit a dimension's value is shown in: degrees for an angle, the document unit for a length
export const dimensionUnit = (c, docUnit) => (c.type === CONSTRAINT_TYPES.ANGLE ? 'deg' : docUnit);
const withUnit = (text, unit) => (unit ? `${text} ${unit}` : text);

// ── the live hint under the dimension box (docs/PARAMETERS-DESIGN.md section E) ──
// previewDimensionInput(state, c, text, { unit }) → PURE (no solve, nothing touched).
//   { ok:false, empty:true }                           nothing typed
//   { ok:false, hint, code, at? }                      the refusal as data; `hint` is its message
//   { ok:true, hint, plan, kind:'value'|'create'|'set', name?, others:[dimension names also changed] }
//     hint: '= 60.0 mm'  |  'creates width = 120.0 mm'  |  'sets width 120.0 -> 150.0 mm, also changes d3, d7'
// `plan` is the planChange result applyParameterChange commits (ONE path: the box commits THIS plan, it never builds a second one).
export function previewDimensionInput(state, c, text, { unit = 'mm' } = {}) {
  if (!isDimension(c)) return { ok: false, code: 'SYNTAX', hint: 'not a dimension' };
  if (String(text == null ? '' : text).trim() === '') return { ok: false, empty: true, hint: '' };
  if (!c.name) return { ok: false, code: 'UNKNOWN_NAME', hint: 'this dimension has no name' };
  const plan = planChange(state, { type: 'setDimension', name: c.name, text: String(text) }, { unit });
  if (!plan.ok) return { ok: false, code: plan.code, hint: plan.message, at: plan.at, plan };
  const mine = plan.edits.find((e) => e.c === c);
  const myValue = mine ? mine.value : c.value;
  const parsed = parseInput(String(text));
  if (parsed.ok && parsed.assign) {
    const key = foldName(parsed.assign.name);
    const after = plan.paramsAfter.find((p) => foldName(p.name) === key);
    const evAfter = evaluateAll({ parameters: plan.paramsAfter, constraints: state.constraints }, { unit });
    const qAfter = evAfter.values && evAfter.values.get(after.name);
    const newText = withUnit(quantityText(qAfter ? qAfter.v : NaN, after.unit), after.unit);
    if (plan.created === after.name) return { ok: true, kind: 'create', name: after.name, others: [], plan, value: myValue, hint: `creates ${after.name} = ${newText}` };
    const before = evaluateAll(state, { unit }).values.get(after.name);
    const others = plan.affected.filter((n) => n !== c.name);
    const oldText = quantityText(before ? before.v : NaN, after.unit);
    return {
      ok: true, kind: 'set', name: after.name, others, plan, value: myValue,
      hint: `sets ${after.name} ${oldText} -> ${newText}${others.length ? `, also changes ${others.join(', ')}` : ''}`,
    };
  }
  const shown = dimensionUnit(c, unit);
  return { ok: true, kind: 'value', others: [], plan, value: myValue, hint: `= ${withUnit(quantityText(myValue, shown), shown)}` };
}

// ── autocomplete (OWNER REQUIREMENT R3, docs/PARAMETERS-DESIGN.md section E): ONE pure function; the DOM list is a thin view over it ──
export const MAX_COMPLETIONS = 8;
const isIdentChar = (ch) => !!ch && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || (ch >= '0' && ch <= '9'));
const isIdentStart = (ch) => !!ch && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_');

// completionsFor(state, text, caret, { unit, exclude }) → null | { from, to, prefix, items:[{ kind:'parameter'|'dimension'|'function', name, insert, value, unit, detail }] }
//   The identifier is the run of letters / digits / "_" that ENDS at the caret and starts with a letter. `from`..`to` is what an insert replaces.
//   Order: user parameters, then driving dimensions (table / constraint order), then the functions; inside a group the names that START with the
//   typed letters, then the names that merely CONTAIN them. Matching ignores case; `insert` keeps the exact case (a function inserts `name(`).
//   At most MAX_COMPLETIONS rows. Never offered: a reference dimension (O9: a formula cannot read it), `exclude` (the dimension being edited), and a
//   name equal to what is typed. When the identifier is the left side of `name =` only user parameters are offered (the others cannot be assigned).
export function completionsFor(state, text, caret, { unit = 'mm', exclude = [] } = {}) {
  const s = String(text == null ? '' : text);
  const to = Math.max(0, Math.min(Number.isInteger(caret) ? caret : s.length, s.length));
  let from = to;
  while (from > 0 && isIdentChar(s[from - 1])) from--;
  if (from === to || !isIdentStart(s[from])) return null;
  const prefix = s.slice(from, to);
  let end = to;
  while (end < s.length && isIdentChar(s[end])) end++;
  let after = end;
  while (after < s.length && (s[after] === ' ' || s[after] === '\t')) after++;
  const leftOfAssign = s.slice(0, from).trim() === '' && s[after] === '=' && s[after + 1] !== '=';
  const lower = prefix.toLowerCase();
  const ev = evaluateAll(state || { parameters: [], constraints: [] }, { unit });
  const values = ev.values || new Map();
  const skip = new Set(exclude.map(foldName));
  const candidates = [];
  for (const p of (state && state.parameters) || []) {
    const q = values.get(p.name);
    candidates.push({ kind: 'parameter', name: p.name, insert: p.name, value: q ? quantityText(q.v, p.unit) : '', unit: p.unit || '', detail: '' });
  }
  if (!leftOfAssign) {
    for (const c of (state && state.constraints) || []) {
      if (!isDimension(c) || isReferenceDimension(c) || !c.name) continue;
      const q = values.get(c.name);
      const u = dimensionUnit(c, unit);
      candidates.push({ kind: 'dimension', name: c.name, insert: c.name, value: q ? quantityText(q.v, u) : '', unit: u, detail: '' });
    }
    for (const f of functionTable()) {
      const args = f.max === Infinity ? 'a; b; ...' : f.min === 1 ? 'x' : 'a; b';
      candidates.push({ kind: 'function', name: f.name, insert: `${f.name}(`, value: '', unit: '', detail: `${f.name}(${args})` });
    }
  }
  const ranked = [];
  candidates.forEach((cand, order) => {
    const at = cand.name.toLowerCase().indexOf(lower);
    if (at === -1 || skip.has(foldName(cand.name)) || cand.name === prefix) return;
    ranked.push({ cand, key: [cand.kind === 'function' ? 1 : 0, at === 0 ? 0 : 1, order] });
  });
  ranked.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
  const items = ranked.slice(0, MAX_COMPLETIONS).map((r) => r.cand);
  return items.length ? { from, to, prefix, items } : null;
}
