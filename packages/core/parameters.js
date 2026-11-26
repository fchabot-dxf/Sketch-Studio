// packages/core/parameters.js — TASK 535 slice 1b: the parameter MODEL of a document (docs/PARAMETERS-DESIGN.md sections A, C, D).
// PURE: no DOM, no #ui import. Nothing in the app calls planChange yet (slices 2-5 add the producers); today only tests do.
//
//   state.parameters   an array of USER parameters { name, unit, expression, comment? } (one list per DOCUMENT: decision O1).
//   a dimension        a DISTANCE, ANGLE or OFFSET (task 650: the offset distance) constraint; it carries `name` (always: d1, d2, ...) and `expression` (only when a formula
//                      was typed). `value` stays the solver's truth; this module only computes what it SHOULD be.
//   a pattern value    TASK 694 (Fusion: a sketch pattern's quantity / distance / total angle are model parameters d<n>): each declared value of a sketch
//                      pattern (#core/pattern-values.js PATTERN_VALUES) is a dimension ENTRY of its own, named and driven exactly like a dimension.
//   ENTRY              { c, slot }: slot null = the dimension constraint `c` itself; a slot = that value of the pattern `c`. dimensionEntries lists
//                      them all in constraint order (a pattern's values in declared order); entryName / entryValue / entryExpression / entryKind read
//                      one; writeEntry is the ONE writer of a name / formula. A count's kind is 'count' (a plain number, no unit).
//
// The dependency graph is built fresh on demand (never stored): node = every user parameter + every DRIVING dimension; edge = a
// name an expression reads. REFERENCE (driven) dimensions are not nodes and a formula cannot read one (decision O9).
// Values are quantities { v, L, A } in BASE units (mm, degrees), exactly what expression.js evaluates to.
// Errors are DATA ({ ok:false, code, message, ... }); nothing here throws on user input.

import { CONSTRAINT_TYPES } from '#core/constants.js';
import { unitInfo } from '#core/units.js';
import { lengthText, angleText } from '#core/settings-manager.js';
import { parseInput, evaluate, canonicalize, dependencies, print, validateName, foldName, functionTable } from '#core/expression.js';
import { patternValueSlots, patternSlot, patternSlotValue } from '#core/pattern-values.js';

// ── DECLARED DECISIONS (docs/PARAMETERS-DESIGN.md owner table). Each switch is ONE constant. ──
export const AUTO_NAME_PREFIX = 'd';                  // O22  the automatic dimension name is prefix + number; the number is (highest existing dN) + 1,
                                                      //      derived from the constraints, nothing stored, so a number may be reused after the highest is deleted
export const PARAMETER_UNITS = ['', 'mm', 'cm', 'in', 'deg', 'rad']; // O18  '' = unitless (a count); the rest are the UNIT_TABLE entries
const SAME_VALUE = 1e-9;                              // two values closer than this are the same value (the design's value == evaluate(expression) tolerance)

// TASK 782 / 789 / 789b / 1013 (UX-17b): THE ONE value-domain rule for every dimension kind, shared by previewDimensionInput (canvas edit box +
// Parameters table), evaluateBoxText (draw-time boxes, fillet, offset) and commitDimensionEdits (solver commit seam).
export const SIZE_REFUSAL = 'a length must be more than 0';
/** null, or SIZE_REFUSAL when `v` (a number, base unit) is 0 or less. */
export const sizeRefusal = (v) => (Number(v) <= 0 ? SIZE_REFUSAL : null);
export const OFFSET_ZERO_REASON = 'an offset distance cannot be 0 (a negative distance puts the offset on the other side)';
/** null, or the refusal sentence when dimension constraint `c` cannot take `value` (base mm / degrees). */
export function dimensionValueRefusal(c, value) {
  if (!c) return null;
  const v = Number(value);
  if (c.type === CONSTRAINT_TYPES.ANGLE) {
    return !(v > 0) ? 'an angle must be more than 0 degrees' : !(v <= 360) ? 'an angle must be at most 360 degrees' : null;
  }
  if (c.type === CONSTRAINT_TYPES.OFFSET) return !(v !== 0) ? OFFSET_ZERO_REASON : null;
  if (c.type === CONSTRAINT_TYPES.DISTANCE) return sizeRefusal(v);
  return null;
}

// ── dimension helpers (the ONE definition of "a dimension" and "a reference dimension") ──
export const isDimension = (c) => !!c && (c.type === CONSTRAINT_TYPES.DISTANCE || c.type === CONSTRAINT_TYPES.ANGLE || (c.type === CONSTRAINT_TYPES.OFFSET && c.dimensioned !== false));
export const isReferenceDimension = (c) => !!c && !!(c.isDriven || c.driven);
const dimensionKind = (c) => (c.type === CONSTRAINT_TYPES.ANGLE ? 'angle' : 'length');

// ── the dimension ENTRIES (TASK 694): a dimension constraint, or one value of a sketch pattern ──
/** Every entry of `constraints` in constraint order: { c, slot } (slot null = the dimension `c`; else that pattern value of `c`). */
export function dimensionEntries(constraints) {
  const out = [];
  for (const c of constraints || []) {
    if (isDimension(c)) out.push({ c, slot: null });
    else for (const s of patternValueSlots(c)) out.push({ c, slot: s.slot });
  }
  return out;
}
const slotOf = (e) => (e && e.slot ? e.slot : null);
export const entryName = (e) => (slotOf(e) ? ((e.c.names && e.c.names[e.slot]) || undefined) : e.c.name);
export const entryExpression = (e) => (slotOf(e) ? ((e.c.expressions && e.c.expressions[e.slot]) || null) : (e.c.expression || null));
export const entryValue = (e) => (slotOf(e) ? patternSlotValue(e.c, e.slot) : e.c.value);
export const entryKind = (e) => (slotOf(e) ? (patternSlot(e.c, e.slot) || { kind: 'length' }).kind : dimensionKind(e.c));
const isReferenceEntry = (e) => !slotOf(e) && isReferenceDimension(e.c);
/** The unit an entry's value is shown in: '' for a count, degrees for an angle, the document unit for a length. */
export const entryUnit = (e, docUnit) => { const k = entryKind(e); return k === 'count' ? '' : k === 'angle' ? 'deg' : docUnit; };
// the evaluator's target of an entry kind (#core/expression.js: a count is a plain number, 'none')
const targetOf = (kind) => (kind === 'count' ? 'none' : kind);
// a count that is a whole number but for the floating-point noise of its formula (0.7 * 10 = 7.000000000000001) is that whole number; any
// other count stays as computed (2.5 stays 2.5: #core/pattern.js patternValuesRefusal refuses it)
const countValue = (v) => (Number.isFinite(v) && Math.abs(v - Math.round(v)) <= SAME_VALUE * Math.max(1, Math.abs(v)) ? Math.round(v) : v);
/**
 * THE writer of an entry's name and formula (expression null = none). A pattern's `names` / `expressions` objects are replaced, never changed in
 * place (the undo snapshot copies a constraint shallowly).
 */
export function writeEntry(e, { name, expression }) {
  if (!slotOf(e)) {
    if (name !== undefined) e.c.name = name;
    if (expression) e.c.expression = expression; else delete e.c.expression;
    return;
  }
  if (name !== undefined) e.c.names = { ...(e.c.names || {}), [e.slot]: name };
  const ex = { ...(e.c.expressions || {}) };
  if (expression) ex[e.slot] = expression; else delete ex[e.slot];
  if (Object.keys(ex).length) e.c.expressions = ex; else delete e.c.expressions;
}

// nextDimensionName(constraints, parameters) → 'd' + (highest dN among the constraints' names, their pattern values' names and the parameters'
// names + 1)  (O22). TASK 709: `parameters` (the document's list) holds the KEPT values of deleted dimensions (O10): a new dimension never takes one.
export function nextDimensionName(constraints, parameters = []) {
  let highest = 0;
  const re = new RegExp(`^${AUTO_NAME_PREFIX}(\\d+)$`);
  const see = (name) => { const m = typeof name === 'string' ? re.exec(name) : null; if (m) highest = Math.max(highest, parseInt(m[1], 10)); };
  for (const p of parameters || []) if (p) see(p.name);
  for (const c of constraints || []) {
    if (!c) continue;
    see(c.name);
    for (const s of patternValueSlots(c)) see(c.names && c.names[s.slot]);
  }
  return `${AUTO_NAME_PREFIX}${highest + 1}`;
}
/**
 * TASK 694: give every value of the pattern `c` that has no name the next automatic one (O22), in declared order (Fusion's: quantity one / two,
 * distance one / two; quantity, total angle). `constraints` = the document's (with or without `c`). The ONE naming of pattern values: a new
 * pattern (#core/pattern.js applyPattern), a loaded document's patterns saved before task 694 (#core/document.js, after every constraint is
 * loaded, so a name is never one a later constraint of the file carries) and a pasted pattern (#ui/clipboard.js). `parameters` = the document's
 * list (task 709: a kept value's name is taken). → the names given.
 */
export function namePatternValues(constraints, c, parameters = []) {
  const given = [];
  const all = (constraints || []).includes(c) ? constraints : [...(constraints || []), c];
  for (const s of patternValueSlots(c)) {
    if (c.names && c.names[s.slot]) continue;
    const name = nextDimensionName(all, parameters);
    c.names = { ...(c.names || {}), [s.slot]: name };
    given.push(name);
  }
  return given;
}

// ── the ONE copy / restore of the parameter list (document save/load, undo snapshot, cancelUndoGroup all use these) ──
export function cloneParameters(list) {
  return (list || []).map((p) => {
    const out = { name: p.name, unit: p.unit, expression: p.expression };
    if (p.comment) out.comment = p.comment;
    if (p.deletedDimension) out.deletedDimension = true; // TASK 709: the kept value of a deleted dimension (O10)
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
    dims: dimensionEntries(state.constraints).map((e) => ({
      c: e.c, slot: e.slot, name: entryName(e), kind: entryKind(e), driven: isReferenceEntry(e), value: entryValue(e), expression: entryExpression(e),
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

// A one-item cycle is a name that reads itself: there is no path to show ("d1 -> d1"), so the message says so.
const cycleMessage = (names) => (names.length === 2 && names[0] === names[1] ? `${names[0]} refers to itself` : names.join(' -> '));
const cycleError = (cycle) => { const names = cycle.map((n) => n.name); return { ok: false, code: 'CYCLE', message: cycleMessage(names), cycle: names }; };

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
  if (node.type === 'dimension') return { target: targetOf(node.ref.kind), unit: docUnit };
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

// TASK 559 (copy / paste): every name an expression reads is mapped through `mapName(name)` AT ONCE (renameInAst renames one name at a time, so a
// d1 -> d3, d3 -> d5 mapping would chain). Constants (PI ...) are not names the caller maps. → { ok:true, text } with the canonical re-printed text
// | { ok:false } when the text does not parse or `mapName` returned null for a name (one the caller cannot resolve: the caller decides what that means).
function mapNamesInAst(n, mapName, isMapped) {
  if (!n) return n;
  switch (n.t) {
    case 'name': { if (!isMapped(n.name)) return n; const to = mapName(n.name); return to == null ? null : { ...n, name: to }; }
    case 'unit': case 'neg': { const arg = mapNamesInAst(n.arg, mapName, isMapped); return arg == null ? null : { ...n, arg }; }
    case 'bin': { const left = mapNamesInAst(n.left, mapName, isMapped), right = mapNamesInAst(n.right, mapName, isMapped); return left == null || right == null ? null : { ...n, left, right }; }
    case 'call': { const args = n.args.map((a) => mapNamesInAst(a, mapName, isMapped)); return args.some((a) => a == null) ? null : { ...n, args }; }
    default: return n;
  }
}
export function remapExpressionNames(text, mapName) {
  const p = parseInput(text, { allowAssign: false });
  if (!p.ok) return { ok: false };
  const read = new Set(dependencies(p)); // the names the expression reads (constants are not among them)
  const ast = mapNamesInAst(p.ast, mapName, (name) => read.has(name));
  return ast == null ? { ok: false } : { ok: true, text: print(ast) };
}

// a plain number: no name, no call, no operator but a "1/2 in" fraction or a "1 1/2" mixed number (typed into a dimension it REPLACES any formula)
function isPlainNumber(n) {
  if (n.t === 'num' || n.t === 'mixed') return true;
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
// planChange(state, change, { unit }) → { ok:true, paramsAfter, edits, affected, solve, created?, named? } | { ok:false, code, message, ... }
//   Pure: nothing in `state` is touched. `edits` lists, per affected dimension ENTRY (constraint order), what the batch commit must write:
//   { c, slot, name, value (base mm / degrees / a count), expression (string | null) } — only entries whose value, expression or name changes
//   (slot null = the dimension `c`; else that value of the pattern `c`, TASK 694).
//   `affected` = every dimension that depends (directly or through other formulas) on what changed, plus the one edited.
//   `solve` = some value changes (renames and comment edits skip the solve).
//   change: { type:'setDimension', name, text }          text: a number, a formula, or  name = expr: an existing USER parameter's name sets that
//                                                        parameter (O4); any other free name NAMES THIS DIMENSION (owner ruling, task 677, Fusion
//                                                        measured): the dimension is renamed (every formula reading it follows) and takes expr
//                                                        (`named` = the new name); another dimension's name is NAME_TAKEN
//           { type:'setValues', values:[{ name, value }] } TASK 694: dimensions set to plain numbers (base units / a count), their formulas
//                                                        replaced (a pattern dialog's spinner, drag arrow or distribution switch)
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
  let named;
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
  // a rename follows into every formula that reads the old name: token by token through the AST, never a text replace
  const renameReaders = (fromKey, to) => {
    const rewrite = (text) => {
      const p = parseInput(text, { allowAssign: false });
      return p.ok && dependencies(p).includes(fromKey) ? print(renameInAst(p.ast, fromKey, to)) : text;
    };
    for (const p of m1.params) if (p.expression) p.expression = rewrite(p.expression);
    for (const d of m1.dims) if (d.expression) d.expression = rewrite(d.expression);
  };

  switch (change && change.type) {
    case 'setDimension': {
      const d = dimOf(change.name);
      if (!d) return noSuch('dimension', change.name);
      if (d.driven) return { ok: false, code: 'REFERENCE_DIM', message: `${d.name} is a reference dimension` };
      const parsed = parseInput(change.text);
      if (!parsed.ok) return parsed;
      const dctx = { target: targetOf(d.kind), unit };
      let newExpression;
      const existing = parsed.assign ? paramOf(parsed.assign.name) : null;
      if (existing) { // O4: `name = expr` where name is a USER parameter sets that parameter; this dimension then reads it
        const r = canon(parsed.ast, paramCtx(existing));
        if (!r.ok) return r;
        existing.expression = r.text;
        roots.add(foldName(existing.name));
        newExpression = existing.name; // the final evaluation checks that the parameter has the dimension's kind
      } else if (isPlainNumber(parsed.ast)) {
        const r = evaluate(parsed.ast, lookupBefore, dctx);
        if (!r.ok) return r;
        d.value = r.v; newExpression = null;
      } else {
        const r = canon(parsed.ast, dctx);
        if (!r.ok) return r;
        newExpression = r.text;
      }
      // OWNER RULING (task 677, Fusion measured): `name = expr` with a name that is no user parameter NAMES THIS DIMENSION (Fusion makes it a model
      // parameter; no user parameter is created). Another dimension's name is refused (NAME_TAKEN); the dimension's own name just sets its value.
      if (parsed.assign && !existing) {
        const fromKey = foldName(d.name);
        const check = validateName(parsed.assign.name, { kind: 'dimension', isTaken: (k) => takenKeys(fromKey).has(k) });
        if (!check.ok) return { ...check, at: parsed.assign.at };
        if (parsed.assign.name !== d.name) { renameReaders(fromKey, parsed.assign.name); d.name = parsed.assign.name; }
        named = d.name;
      }
      d.expression = newExpression;
      roots.add(foldName(d.name));
      break;
    }
    case 'setValues': {
      for (const { name, value } of change.values || []) {
        const d = dimOf(name);
        if (!d) return noSuch('dimension', name);
        if (d.driven) return { ok: false, code: 'REFERENCE_DIM', message: `${d.name} is a reference dimension` };
        d.value = Number(value); d.expression = null;
        roots.add(foldName(d.name));
      }
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
      renameReaders(fromKey, change.to);
      roots.add(foldName(change.to));
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
    const value = d.kind === 'count' ? countValue(v ? v.v : d.value) : (v ? v.v : d.value);
    const entry = { c: d.c, slot: d.slot };
    const valueChanged = !(Math.abs(value - entryValue(entry)) <= SAME_VALUE * Math.max(1, Math.abs(value)));
    const expressionChanged = (d.expression || null) !== entryExpression(entry);
    const nameChanged = d.name !== entryName(entry);
    if (valueChanged || expressionChanged || nameChanged) {
      edits.push({ c: d.c, slot: d.slot, name: d.name, value, expression: d.expression || null });
      if (valueChanged) solve = true;
    }
  }
  const out = { ok: true, paramsAfter: m1.params, edits, affected, solve };
  if (created) out.created = created;
  if (named) out.named = named;
  return out;
}

// ── the KEPT value of a deleted dimension (decision O10; TASK 709, owner ruling 1905 "like Fusion", Fusion measured by the advisor) ──
// A dimension goes (its geometry deleted or trimmed, or the dimension itself deleted) while a formula reads its name: Fusion keeps the name as a
// value (d2 = d1 / 2 still 15 mm). Here that value is a USER PARAMETER of the document's list carrying `deletedDimension: true`, its expression the
// dimension's value at deletion as a plain number, its comment KEPT_DIMENSION_COMMENT: the formulas keep working through the ONE parameter model
// (graph, evaluation, rename, the table, save / load, undo all read state.parameters); it can be edited (its readers follow) and renamed. It is
// removed automatically once nothing reads it. Undo of the delete restores the real dimension (the undo snapshot holds the parameter list).
export const KEPT_DIMENSION_COMMENT = 'dimension deleted';
/** The named driving dimensions' { name, value, kind } now: what a delete takes BEFORE it removes anything (reconcileKeptDimensions' `before`). */
export function dimensionValuesOf(constraints) {
  return dimensionEntries(constraints).filter((e) => entryName(e) && !isReferenceEntry(e)).map((e) => ({ name: entryName(e), value: entryValue(e), kind: entryKind(e) }));
}
// the folded names the document's expressions read (user parameters and driving dimensions; a name nothing defines counts too)
function namesRead(state) {
  const read = new Set();
  const see = (text) => { if (text == null) return; const p = parseInput(text, { allowAssign: false }); if (p.ok) dependencies(p).forEach((k) => read.add(k)); };
  for (const p of state.parameters || []) see(p.expression);
  for (const e of dimensionEntries(state.constraints)) if (!isReferenceEntry(e)) see(entryExpression(e));
  return read;
}
/**
 * THE rule (O10, TASK 709). `before` = dimensionValuesOf(the constraints before a removal); [] after an edit. (1) every name of `before` that no
 * dimension and no parameter carries any more and that an expression still reads becomes a kept value { name, unit, expression: its value as a
 * plain number, comment: KEPT_DIMENSION_COMMENT, deletedDimension: true } (a length in the document unit `unit`, an angle in deg, a count
 * unitless); (2) every kept value nothing reads any more is removed. Called by the delete path (#core/delete-manager.js removeGeometry and
 * deleteConstraints) and by every parameter commit (#core/dimension-seams.js applyParameterChange). Mutates state.parameters.
 * -> { kept: [names], dropped: [names] }
 */
export function reconcileKeptDimensions(state, before = [], { unit = 'mm' } = {}) {
  if (!state || !Array.isArray(state.parameters)) return { kept: [], dropped: [] };
  const read = namesRead(state);
  const present = new Set([...state.parameters.map((p) => foldName(p.name)), ...dimensionEntries(state.constraints).map(entryName).filter(Boolean).map(foldName)]);
  const kept = [];
  for (const d of before) {
    const key = foldName(d.name);
    if (present.has(key) || !read.has(key)) continue;
    const punit = d.kind === 'count' ? '' : d.kind === 'angle' ? 'deg' : unit;
    state.parameters.push({ name: d.name, unit: punit, expression: numberText(d.value, punit), comment: KEPT_DIMENSION_COMMENT, deletedDimension: true });
    present.add(key);
    kept.push(d.name);
  }
  const dropped = [];
  for (let i = state.parameters.length - 1; i >= 0; i--) {
    const p = state.parameters[i];
    if (p.deletedDimension && !read.has(foldName(p.name))) { dropped.unshift(p.name); state.parameters.splice(i, 1); }
  }
  return { kept, dropped };
}

// ── display text (TASK 535 slice 3: the canvas hint, the autocomplete rows and the parameter table all use THESE) ──
// a base value (mm / degrees) as text in `unit` ('' = a plain count); 1 decimal for lengths and angles like the canvas labels, up to 4 for a count.
// show (TASK 728, a length's form, see lengthText): 'field' = the number for a cell / row that prints the unit beside it (default), 'bare' = the number
// alone ("1.5" | 1 1/2"), 'unit' = with its unit, any kind ("1.5 in" | 1 1/2" | "30.0 deg"). A length's text is decided by lengthText (one decider).
export function quantityText(v, unit, show = 'field') {
  if (!Number.isFinite(v)) return '';
  const u = unit ? unitInfo(unit) : null;
  if (!u) return String(Math.round(v * 1e4) / 1e4);
  if (u.kind === 'length') return lengthText(v, { unit: u.name, show });
  return angleText(v / u.f, { show: show === 'unit' ? 'unit' : 'bare' });
}
// the unit a dimension's value is shown in: degrees for an angle, the document unit for a length
export const dimensionUnit = (c, docUnit) => (c.type === CONSTRAINT_TYPES.ANGLE ? 'deg' : docUnit);

// ── the live hint under the dimension box (docs/PARAMETERS-DESIGN.md section E) ──
// previewDimensionInput(state, c, text, { unit }) → PURE (no solve, nothing touched).
//   { ok:false, empty:true }                           nothing typed
//   { ok:false, hint, code, at? }                      the refusal as data; `hint` is its message
//   { ok:true, hint, plan, kind:'value'|'name'|'set', name?, others:[dimension names also changed] }
//     hint: '= 60.0 mm'  |  'names it width = 120.0 mm' (task 677: `width = 120` names THIS dimension)  |  'sets width 120.0 -> 150.0 mm, also changes d3, d7'
// `plan` is the planChange result applyParameterChange commits (ONE path: the box commits THIS plan, it never builds a second one).
// TASK 694: `slot` = a value of the pattern `c` (its dialog boxes and its Parameters rows go through here too); `own` = the entry's name now.
export function previewDimensionInput(state, c, text, { unit = 'mm', slot = null } = {}) {
  const entry = { c, slot };
  if (slot ? !patternSlot(c, slot) : !isDimension(c)) return { ok: false, code: 'SYNTAX', hint: 'not a dimension' };
  if (String(text == null ? '' : text).trim() === '') return { ok: false, empty: true, hint: '' };
  const own = entryName(entry);
  if (!own) return { ok: false, code: 'UNKNOWN_NAME', hint: 'this dimension has no name' };
  const plan = planChange(state, { type: 'setDimension', name: own, text: String(text) }, { unit });
  if (!plan.ok) return { ok: false, code: plan.code, hint: plan.message, at: plan.at, plan };
  const mine = plan.edits.find((e) => e.c === c && (e.slot || null) === slot);
  const myValue = mine ? mine.value : entryValue(entry);
  // TASK 1013 (UX-17b): refuse domain-invalid values (<= 0 lengths, <= 0 or > 360 angles, 0 offsets) HERE in previewDimensionInput,
  // so the edit box stays open with the inline #dimHint — matching draw-time boxes and Fusion's dimension box.
  if (!slot) {
    const ownWhy = dimensionValueRefusal(c, myValue);
    if (ownWhy) return { ok: false, code: 'OUT_OF_RANGE', hint: ownWhy, plan };
  }
  for (const e of plan.edits) {
    if (e.slot) continue;
    const why = dimensionValueRefusal(e.c, e.value);
    if (why) return { ok: false, code: 'OUT_OF_RANGE', hint: e.c === c ? why : `${e.name}: ${why}`, plan };
  }
  const shown = entryUnit(entry, unit);
  if (plan.named && plan.named !== own) { // the dimension is renamed (owner ruling, task 677): it keeps being a dimension, now called plan.named
    const others = plan.affected.filter((n) => n !== plan.named);
    return {
      ok: true, kind: 'name', name: plan.named, own, others, plan, value: myValue,
      hint: `names it ${plan.named} = ${quantityText(myValue, shown, 'unit')}${others.length ? `, also changes ${others.join(', ')}` : ''}`,
    };
  }
  const parsed = parseInput(String(text));
  if (parsed.ok && parsed.assign && !plan.named) {
    const key = foldName(parsed.assign.name);
    const after = plan.paramsAfter.find((p) => foldName(p.name) === key);
    const evAfter = evaluateAll({ parameters: plan.paramsAfter, constraints: state.constraints }, { unit });
    const qAfter = evAfter.values && evAfter.values.get(after.name);
    const newText = quantityText(qAfter ? qAfter.v : NaN, after.unit, 'unit');
    const before = evaluateAll(state, { unit }).values.get(after.name);
    const others = plan.affected.filter((n) => n !== own);
    const oldText = quantityText(before ? before.v : NaN, after.unit, 'bare');
    return {
      ok: true, kind: 'set', name: after.name, own, others, plan, value: myValue,
      hint: `sets ${after.name} ${oldText} -> ${newText}${others.length ? `, also changes ${others.join(', ')}` : ''}`,
    };
  }
  return { ok: true, kind: 'value', own, others: [], plan, value: myValue, hint: `= ${quantityText(myValue, shown, 'unit')}` };
}

// TASK 876 / 1013 (UX-17a): THE reading of a text typed in a drawing / modify tool's value box (a line's length, a rectangle's side, a circle's diameter,
// polygon radius, slot span/width, fillet radius, offset distance, an angle): the SAME parser, assignment (`name = expr`) rules and name lookup as a
// dimension's edit box (planChange 'setDimension': parseInput, validateName, canonicalize against the sketch's evaluated names; a reference dimension and
// an unknown name are refused with the evaluator's own message). `kind` = 'length' | 'angle' | 'count'. `allowAssign`: true for boxes that create a
// dimension (default for length/angle), false for non-dimension fields (count, or draw-time angle/sweep boxes that make no constraint).
// → { ok:true, v (base mm / degrees / a number), expression (canonical text when reading a name, else null), name (new dim name from `w = expr`, else null),
//     assign ({ name, text } when `param = expr` updates an existing user parameter, else null) }
//   | { ok:false, code, message, at? }
export function evaluateBoxText(state, text, kind = 'length', { unit = 'mm', allowAssign = (kind !== 'count') } = {}) {
  const raw = String(text == null ? '' : text);
  const parsed = parseInput(raw, { allowAssign });
  if (!parsed.ok) return parsed;
  const params = (state && Array.isArray(state.parameters)) ? state.parameters : [];
  const constraints = (state && Array.isArray(state.constraints)) ? state.constraints : [];
  const values = new Map();
  const reference = new Map();
  if (state && Array.isArray(state.constraints)) {
    const ev = evaluateAll({ parameters: params, constraints }, { unit });
    if (ev && ev.values) for (const [name, q] of ev.values) values.set(foldName(name), q);
    for (const e of dimensionEntries(constraints)) {
      const n = entryName(e);
      if (isReferenceEntry(e) && n) reference.set(foldName(n), n);
    }
  }
  const lookup = (key) => {
    if (values.has(key)) return values.get(key);
    if (reference.has(key)) return { ok: false, code: 'REFERENCE_DIM', message: `${reference.get(key)} is a reference dimension` };
    return undefined;
  };
  if (parsed.assign) {
    const assignKey = foldName(parsed.assign.name);
    const existing = params.find((p) => foldName(p.name) === assignKey);
    if (existing) {
      // O4: `name = expr` where name is an existing USER parameter updates that parameter and the new dimension reads it
      if (parameterKind(existing) !== targetOf(kind)) {
        const want = kind === 'length' ? 'a length' : kind === 'angle' ? 'an angle' : 'a plain number';
        const got = parameterKind(existing) === 'length' ? 'a length' : parameterKind(existing) === 'angle' ? 'an angle' : 'a plain number';
        return { ok: false, code: 'UNIT_MISMATCH', message: `${want} cannot be ${got}`, at: parsed.assign.at };
      }
      const rhsText = raw.slice(raw.indexOf('=') + 1).trim();
      const plan = planChange(state, { type: 'setParameter', name: existing.name, text: rhsText }, { unit });
      if (!plan.ok) return plan;
      for (const e of plan.edits) {
        if (e.slot) continue;
        const why = dimensionValueRefusal(e.c, e.value);
        if (why) return { ok: false, code: 'OUT_OF_RANGE', message: `${e.name}: ${why}` };
      }
      const evAfter = evaluateAll({ parameters: plan.paramsAfter, constraints }, { unit });
      const q = evAfter && evAfter.values && evAfter.values.get(existing.name);
      if (!q) return { ok: false, code: 'SYNTAX', message: 'not a valid value' };
      return { ok: true, v: q.v, expression: existing.name, name: null, assign: { name: existing.name, text: rhsText } };
    }
    // Free name: names the dimension being created (task 677 rule); reject names already taken by another dimension or parameter
    const taken = new Set([
      ...params.map((p) => foldName(p.name)),
      ...dimensionEntries(constraints).map(entryName).filter(Boolean).map(foldName),
    ]);
    const check = validateName(parsed.assign.name, { kind: 'dimension', isTaken: (k) => taken.has(k) });
    if (!check.ok) return { ...check, at: parsed.assign.at };
    const r = canonicalize(parsed.ast, lookup, { target: targetOf(kind), unit });
    if (!r.ok) return r;
    return { ok: true, v: r.v, expression: dependencies(parsed).length > 0 ? r.text : null, name: parsed.assign.name, assign: null };
  }
  const r = canonicalize(parsed.ast, lookup, { target: targetOf(kind), unit });
  if (!r.ok) return r;
  return { ok: true, v: r.v, expression: dependencies(parsed).length > 0 ? r.text : null, name: null, assign: null };
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
    for (const e of dimensionEntries(state && state.constraints)) { // TASK 694: a pattern's values too
      const name = entryName(e);
      if (isReferenceEntry(e) || !name) continue;
      const q = values.get(name);
      const u = entryUnit(e, unit);
      candidates.push({ kind: 'dimension', name, insert: name, value: q ? quantityText(q.v, u) : '', unit: u, detail: '' });
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
