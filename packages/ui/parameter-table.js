// packages/ui/parameter-table.js — the Parameters table (docs/PARAMETERS-DESIGN.md section F): TASK 535 slice 4 (the rows, the canvas link) and
// TASK 677 slice 5 (editing).
//
//   buildParameterRows(state, { unit, filter })   PURE: state -> { user: [row], dimensions: [row], ... }. THE one source of the rows.
//   planTableEdit(state, edit, { unit })          PURE: one cell edit -> the planChange plan it means (+ the live hint and the undo label), or the
//                                                  refusal as data. Every cell goes through planChange; a dimension's Expression goes through
//                                                  previewDimensionInput, the SAME function the canvas box uses (no second parser, no second plan).
//   commitTableEdit(state, planned)                applies a planned edit through applyParameterChange (ONE undo step; the batch solve when a value
//                                                  moves). Nothing else here writes the state.
//   createParameterTable({ state, getUnit, history })  the DOM: ONE real <table> (role="grid") with two row groups, a filter box, the canvas link
//                                                  (hovering / focusing a dimension row sets state.hoveredConstraint, clicking selects it, clicking a
//                                                  user parameter row selects every dimension that depends on it), and the editing of section F:
//                                                  Name / Expression / Comment cells applied on Enter or on leaving the cell (never per keystroke), the
//                                                  live preview or the error on a line under the row while typing, + Add, the bin, Tab / Enter / Esc,
//                                                  the parameter-name completion of the canvas box (#ui/parameter-completion.js) in Expression cells.
//                                                  `history` (the Design surface's undo source) serves Ctrl+Z / Ctrl+Y typed in a cell with no pending text.
// Lengths are formatted by the shared units formatter in the document unit; angles in degrees. All text is set with textContent.

import { lengthText, angleText } from '#core/settings-manager.js';
import { evaluateAll, isReferenceDimension, quantityText, planChange, previewDimensionInput, usersOf, cloneParameters, PARAMETER_UNITS,
  dimensionEntries, entryName, entryValue, entryExpression, entryKind, entryUnit } from '#core/parameters.js';
import { patternSlot } from '#core/pattern-values.js';
import { parseInput } from '#core/expression.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { measureDimension } from '#core/constraint-verifier.js';
import { labelGeometry, constraintGeometryText } from '#ui/geometry-labels.js';
import { toggleConstraintSelection } from '#ui/design-info-panel.js';
import { applyParameterChange, dimensionInputLabel, patternPlanRefusal, refusalReason } from '#core/dimension-seams.js';
import { createParameterCompletion } from '#ui/parameter-completion.js';
import { ensureNumericInputStyles } from '#ui/numeric-input-manager.js';
import { undoRedoKeyAction } from '#ui/history-control.js';

export const USER_EMPTY_TEXT = 'No user parameters yet. Press + Add to make one.';
export const DIMENSION_EMPTY_TEXT = 'No dimensions yet. Use the Dim tool to add one.';

const isAngle = (c) => c.type === CONSTRAINT_TYPES.ANGLE;
const kindLabelOf = (c) => (isAngle(c) ? 'Angle' : (c.isDiameter || c.dimMode === 'diameter' || c.type === 'diameter') ? 'Diameter' : (c.isRadius || c.type === 'radius') ? 'Radius' : 'Distance');
// TASK 694: a pattern value's row: its kind (Count / Length / Angle) and what it is ('Circular pattern: quantity')
const PATTERN_KIND_LABEL = Object.freeze({ count: 'Count', length: 'Length', angle: 'Angle' });
const PATTERN_TITLE = Object.freeze({ [CONSTRAINT_TYPES.CIRCULAR_PATTERN]: 'Circular pattern', [CONSTRAINT_TYPES.RECTANGULAR_PATTERN]: 'Rectangular pattern' });

// the value text of an entry (`v`, default its stored value): a count as a whole number, an angle in degrees, a length in the document unit
const entryValueText = (e, unit, v = entryValue(e)) => {
  const k = entryKind(e);
  return k === 'count' ? String(v) : k === 'angle' ? angleText(v) : lengthText(v, { unit, show: 'field' }); // the Unit column says the unit
};

/**
 * buildParameterRows(state, { unit = 'mm', filter = '' }) -> {
 *   unit, filter, total: { user, dimensions },
 *   user:       [{ id, kind:'parameter', name, expression, value, unit, comment, error, users }]      users: who reads it (the bin is refused then)
 *   dimensions: [{ id, kind:'dimension', constraint, slot, name, expression, hasExpression, reference, value, unit, kindLabel, measures, error }]
 * }  Dimensions keep constraint order, user parameters table order. `filter`: rows whose name or expression contains the text (case-insensitive).
 *    TASK 694: a sketch pattern's values are dimension rows too, one per value (slot: #core/pattern-values.js; constraint: the pattern).
 */
export function buildParameterRows(state, { unit = 'mm', filter = '' } = {}) {
  const params = (state && Array.isArray(state.parameters)) ? state.parameters : [];
  const cons = (state && Array.isArray(state.constraints)) ? state.constraints : [];
  const dims = dimensionEntries(cons);
  const ev = evaluateAll(state || { parameters: [], constraints: [] }, { unit });
  const values = ev.values || new Map();
  const errors = ev.errors || new Map();
  const loopMessage = ev.ok === false && !ev.values ? ev.message : null; // a CYCLE: no value can be computed
  const geo = labelGeometry((state && state.shapes) || []);

  const user = params.map((p) => {
    const q = values.get(p.name);
    const err = errors.get(p.name);
    return {
      id: 'p:' + p.name, kind: 'parameter', name: p.name, expression: p.expression || '',
      value: q ? quantityText(q.v, p.unit) : '', unit: p.unit || '', comment: p.comment || '',
      error: err ? err.message : loopMessage, users: usersOf(state, p.name),
    };
  });

  const dimensions = dims.map((e, i) => {
    const c = e.c, name = entryName(e) || '';
    const reference = !e.slot && isReferenceDimension(c);
    // TASK 789: a reference shows what it measures NOW (#core/constraint-verifier.js measureDimension, as its canvas label): its stored value is
    // only what it measured when it was made, and the window refreshes every frame, so a drag shows here too. Unmeasurable (parallel lines): stored.
    const now = reference && state.joints ? measureDimension(c, state.joints, state.shapes || []) : null;
    const text = entryValueText(e, unit, now == null ? entryValue(e) : now);
    const expression = entryExpression(e);
    const hasExpression = !reference && typeof expression === 'string' && expression !== '';
    const err = !reference && name ? errors.get(name) : null;
    return {
      id: 'd:' + (name || i), kind: 'dimension', constraint: c, slot: e.slot, name, hasExpression, reference,
      expression: reference ? '(reference)' : hasExpression ? expression : text,
      value: reference ? `(${text})` : text, unit: entryUnit(e, unit),
      kindLabel: e.slot ? PATTERN_KIND_LABEL[entryKind(e)] : kindLabelOf(c),
      measures: e.slot ? `${PATTERN_TITLE[c.type]}: ${patternSlot(c, e.slot).label}` : constraintGeometryText(c, (state && state.shapes) || [], geo),
      error: err ? err.message : null,
    };
  });

  const needle = String(filter || '').trim().toLowerCase();
  const keep = (r) => !needle || r.name.toLowerCase().includes(needle) || r.expression.toLowerCase().includes(needle);
  return {
    unit, filter: needle, total: { user: user.length, dimensions: dimensions.length },
    user: user.filter(keep), dimensions: dimensions.filter(keep),
  };
}

// ── the edits (PURE planning, then the ONE commit) ──
const UNCHANGED = Object.freeze({ ok: true, changed: false });
const sameParameters = (a, b) => JSON.stringify(cloneParameters(a)) === JSON.stringify(cloneParameters(b));
const refusal = (r, extra = {}) => ({ ok: false, code: r.code, message: r.message, at: r.at, ...extra });

/**
 * planTableEdit(state, edit, { unit }) -> PURE (nothing in `state` is touched, no solve).
 *   edit: { kind:'parameter', column:'name'|'expression'|'comment'|'delete', name, text }
 *       | { kind:'dimension', column:'name'|'expression', constraint, slot?, text }   slot: a pattern value of `constraint` (TASK 694)
 *       | { kind:'new', name, text, unit, comment }   the + Add row: `text` is its Expression cell; `name = expr` there fills both
 *   -> UNCHANGED { ok:true, changed:false }            applying it would change nothing (no undo step is taken)
 *    | { ok:true, changed:true, plan, label, hint, fill? }   plan: planChange's result; label: the undo step's; hint: the live preview;
 *                                                        fill: { name, expression } split out of `name = expr` (the + Add row)
 *    | { ok:false, code, message, at?, incomplete?, fill? }  refused; incomplete: the + Add row still misses its name or its expression
 */
export function planTableEdit(state, edit, { unit = 'mm' } = {}) {
  const text = String(edit && edit.text != null ? edit.text : '');
  const t = text.trim();
  const plan = (change) => planChange(state, change, { unit });
  const done = (p, label, hint, extra = {}) => {
    if (!p.ok) return refusal(p, extra);
    const bad = patternPlanRefusal(p); // TASK 694: a pattern value the plan would write is checked by THE pattern rule, the commit's own check
    if (bad) return refusal({ ...bad, message: bad.node && !bad.message.startsWith(bad.node) ? `${bad.node}: ${bad.message}` : bad.message }, extra);
    const changed = p.edits.length > 0 || !sameParameters(p.paramsAfter, state.parameters);
    return changed ? { ok: true, changed: true, plan: p, label, hint, ...extra } : UNCHANGED;
  };
  // a parameter's value once the plan applies (in its own unit), and the dimensions the plan moves besides `except`
  const valueAfter = (p, name) => {
    const after = p.paramsAfter.find((x) => x.name === name);
    const ev = evaluateAll({ parameters: p.paramsAfter, constraints: state.constraints }, { unit });
    const q = ev.values && ev.values.get(name);
    return after && q ? quantityText(q.v, after.unit, 'unit') : '';
  };
  const also = (p, except) => { const o = p.affected.filter((n) => n !== except); return o.length ? `, also changes ${o.join(', ')}` : ''; };
  const follow = (name) => { const u = usersOf(state, name); return u.length ? `; ${u.join(', ')} follow${u.length === 1 ? 's' : ''}` : ''; };

  if (edit && edit.kind === 'parameter') {
    const name = edit.name;
    if (edit.column === 'name') {
      if (t === name) return UNCHANGED;
      return done(plan({ type: 'renameParameter', name, to: t }), `rename parameter ${name} -> ${t}`, `renames ${name} to ${t}${follow(name)}`);
    }
    if (edit.column === 'expression') {
      const p = plan({ type: 'setParameter', name, text });
      if (!p.ok && p.code === 'ASSIGN_NOT_TOP') return refusal(p, { message: `"=" is not allowed here: use the Name cell to rename ${name}` });
      return p.ok ? done(p, `change parameter ${name}`, `= ${valueAfter(p, name)}${also(p)}`) : refusal(p);
    }
    if (edit.column === 'comment') return done(plan({ type: 'setComment', name, comment: t }), `comment on parameter ${name}`, '');
    if (edit.column === 'delete') return done(plan({ type: 'deleteParameter', name }), `delete parameter ${name}`, '');
  }
  if (edit && edit.kind === 'dimension') {
    const c = edit.constraint, slot = edit.slot || null, own = entryName({ c, slot });
    if (edit.column === 'name') {
      if (t === own) return UNCHANGED;
      return done(plan({ type: 'renameDimension', name: own, to: t }), `rename dimension ${own} -> ${t}`, `renames ${own} to ${t}${follow(own)}`);
    }
    if (edit.column === 'expression') {
      const pv = previewDimensionInput(state, c, text, { unit, slot });
      if (pv.empty) return { ok: false, code: 'SYNTAX', message: 'type a value or a formula' };
      if (!pv.ok) return refusal({ code: pv.code, message: pv.hint, at: pv.at });
      return done(pv.plan, dimensionInputLabel(c, pv), pv.hint);
    }
  }
  if (edit && edit.kind === 'new') {
    let name = String(edit.name || '').trim();
    let expression = t;
    let fill = null;
    if (t.includes('=')) { // `name = expr` in the Expression cell fills both (the same top-level assignment rule as the canvas box)
      const parsed = parseInput(t);
      if (!parsed.ok) return refusal(parsed);
      if (parsed.assign) { name = parsed.assign.name; expression = t.slice(t.indexOf('=') + 1).trim(); fill = { name, expression }; }
    }
    const extra = fill ? { fill } : {};
    if (!name && !expression) return UNCHANGED;
    if (!name) return { ok: false, code: 'BAD_NAME', incomplete: true, message: 'give the new parameter a name', ...extra };
    if (!expression) return { ok: false, code: 'SYNTAX', incomplete: true, message: `type the expression of ${name}`, ...extra };
    const comment = String(edit.comment || '').trim();
    const p = plan({ type: 'createParameter', name, unit: edit.unit == null ? unit : edit.unit, text: expression, ...(comment ? { comment } : {}) });
    return p.ok ? done(p, `create parameter ${name}`, `creates ${name} = ${valueAfter(p, name)}`, extra) : refusal(p, extra);
  }
  return { ok: false, code: 'SYNTAX', message: `unknown edit '${edit && edit.kind}' / '${edit && edit.column}'` };
}

/**
 * commitTableEdit(state, planned) -> { ok:true, changed } | { ok:false, code, message }
 *   THE commit of the window: applyParameterChange (ONE undo step; the dimension values through the batch seam; all-or-nothing). A refusal leaves
 *   the state, the parameters and the history exactly as they were (applyParameterChange guarantees it); the message says why.
 */
export function commitTableEdit(state, planned) {
  if (!planned || !planned.ok) return planned || { ok: false, code: 'SYNTAX', message: 'nothing to apply' };
  if (!planned.changed) return { ok: true, changed: false };
  const res = applyParameterChange(state, planned.plan, planned.label);
  if (res.ok) return { ok: true, changed: true };
  const why = refusalReason(res);
  const who = res.culprit && res.culprit.name && !String(why).startsWith(res.culprit.name) ? `${res.culprit.name}: ` : '';
  return { ok: false, code: res.code || 'REFUSED', message: `Can't apply: ${who}${why}. Nothing changed.` };
}

// every DIMENSION that depends on `name`, directly or through other user parameters (a user row's click selects them: section F canvas link);
// TASK 694: a pattern whose value depends on it is listed once
export function dependentDimensions(state, name) {
  const seen = new Set([name]);
  const queue = [name];
  while (queue.length) for (const u of usersOf(state, queue.shift())) if (!seen.has(u)) { seen.add(u); queue.push(u); }
  const out = [];
  for (const e of dimensionEntries(state && state.constraints)) {
    const n = entryName(e);
    if (n && n !== name && seen.has(n) && !out.includes(e.c)) out.push(e.c);
  }
  return out;
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-ptable-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-ptable-styles';
  s.textContent = `
.sk-ptable { display: flex; flex-direction: column; gap: 6px; font: 12px system-ui, sans-serif; color: inherit; min-width: 0; }
.sk-ptable-filter { width: 100%; box-sizing: border-box; font: inherit; padding: 5px 8px; border-radius: 6px; color: inherit;
  background: var(--sk-info-head, rgba(127,127,127,0.12)); border: 1px solid var(--sk-dock-border, rgba(127,127,127,0.35)); }
.sk-ptable-filter::placeholder, .sk-ptable .pt-in::placeholder { color: inherit; opacity: 0.5; }
.sk-ptable-filter:focus-visible, .sk-ptable button:focus-visible, .sk-ptable select:focus-visible { outline: 2px solid var(--sk-dock-accent, var(--sk-selection, #4c9aff)); outline-offset: -2px; }
.sk-ptable table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.sk-ptable th, .sk-ptable td { text-align: left; padding: 3px 4px; vertical-align: middle; overflow-wrap: anywhere; font-weight: 400; }
.sk-ptable thead th { font-size: 0.85em; font-weight: 700; opacity: 0.6; }
.sk-ptable thead tr { border-bottom: 1px solid var(--sk-dock-border, rgba(127,127,127,0.3)); }
.sk-ptable th[scope="rowgroup"] { font-size: 0.8em; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; padding-top: 10px; }
.sk-ptable th[scope="rowgroup"] .pt-title { opacity: 0.75; }
.sk-ptable .pt-count { font-weight: 400; opacity: 0.7; margin-left: 4px; }
.sk-ptable .pt-name { width: 17%; font-weight: 600; } .sk-ptable .pt-expr { width: 28%; }
.sk-ptable .pt-val { width: 13%; font-variant-numeric: tabular-nums; } .sk-ptable .pt-unit { width: 10%; opacity: 0.8; }
.sk-ptable .pt-comment { width: auto; opacity: 0.85; } .sk-ptable .pt-bin { width: 30px; padding: 0; text-align: center; }
.sk-ptable-row { cursor: pointer; }
.sk-ptable-row:hover, .sk-ptable-row.pt-hover { background: var(--sk-info-hover, rgba(127,127,127,0.16)); }
.sk-ptable-row[aria-selected="true"] { background: var(--sk-dock-accent, var(--sk-selection, #4c9aff)); color: #fff; }
.sk-ptable-row.pt-reference { opacity: 0.6; font-style: italic; }
.sk-ptable-row.pt-error .pt-val { color: var(--sk-error, #e5484d); }
.sk-ptable-row[aria-selected="true"].pt-reference { opacity: 0.95; }
.sk-ptable .pt-cellwrap { display: flex; align-items: center; gap: 2px; min-width: 0; }
.sk-ptable .pt-fx { flex: 0 0 auto; display: inline-block; font: italic 700 0.85em Georgia, serif; padding: 0 4px; margin-right: 2px; border-radius: 4px;
  background: var(--sk-info-head, rgba(127,127,127,0.2)); }
.sk-ptable .pt-fx[hidden] { display: none; } /* TASK 699: the rule above sets display, which beats the [hidden] attribute */
.sk-ptable .pt-ref { display: inline-block; font-size: 0.75em; padding: 0 4px; margin-left: 4px; border-radius: 4px; border: 1px solid currentColor; font-style: normal; }
.sk-ptable .pt-empty { opacity: 0.6; font-style: italic; padding: 6px; }
/* TASK 677: the editable cells: a faint box to signal editability, stronger on hover / focus; pending dashed, invalid red (aria-invalid) */
.sk-ptable .pt-in { flex: 1 1 auto; width: 100%; min-width: 0; box-sizing: border-box; font: inherit; color: inherit; background: rgba(127,127,127,0.06);
  border: 1px solid rgba(127,127,127,0.24); border-radius: 4px; padding: 2px 4px; margin: 0; }
.sk-ptable .pt-name .pt-in { font-weight: 600; }
.sk-ptable .pt-in:hover { border-color: var(--sk-dock-border, rgba(127,127,127,0.5)); background: rgba(127,127,127,0.1); }
.sk-ptable .pt-in:focus { outline: none; border-color: var(--sk-dock-accent, var(--sk-selection, #4c9aff)); background: var(--sk-dock-bg, #fff); color: var(--sk-dock-text, #1f2937); }
.sk-ptable .pt-in.pt-pending { border-style: dashed; border-color: var(--sk-dock-accent, var(--sk-selection, #4c9aff)); }
.sk-ptable .pt-in[aria-invalid="true"] { border: 1px solid var(--sk-error, #e5484d); box-shadow: 0 0 0 1px var(--sk-error, #e5484d); }
.sk-ptable select.pt-in { padding: 1px 2px; }
.sk-ptable tr.pt-msg td { padding: 0 6px 5px 6px; font-size: 0.92em; line-height: 1.3; }
.sk-ptable tr.pt-msg.pt-msg-err td { color: var(--sk-error, #e5484d); font-weight: 600; }
.sk-ptable tr.pt-msg.pt-msg-hint td { opacity: 0.85; }
.sk-ptable tr.pt-new { background: var(--sk-info-head, rgba(127,127,127,0.1)); }
.sk-ptable .pt-del, .sk-ptable .pt-add { font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
.sk-ptable .pt-del { width: 26px; height: 24px; padding: 0; line-height: 1; opacity: 0.75; }
.sk-ptable .pt-del:hover { opacity: 1; border-color: var(--sk-dock-border, rgba(127,127,127,0.45)); }
.sk-ptable .pt-del[aria-disabled="true"] { opacity: 0.3; cursor: not-allowed; }
.sk-ptable .pt-add { float: right; font-size: 1.1em; font-weight: 700; letter-spacing: 0; text-transform: none; padding: 1px 8px;
  border-color: var(--sk-dock-border, rgba(127,127,127,0.45)); }
.sk-ptable .pt-add:hover { background: var(--sk-info-hover, rgba(127,127,127,0.16)); }
ul.dim-complete.sk-ptable-complete { position: fixed; z-index: 9100; }
/* TASK 562: a finger: the filter box and the buttons >= 44 px, table text >= 12 px. */
@media (pointer: coarse) {
  .sk-ptable-filter { min-height: 44px; font-size: 14px; }
  .sk-ptable thead th, .sk-ptable th[scope="rowgroup"], .sk-ptable .pt-count { font-size: 12px; }
  .sk-ptable .pt-del, .sk-ptable .pt-add { min-width: 44px; min-height: 44px; }
}
/* the bottom sheet (section F, narrow screens): Value and Unit in one column, the Comment behind the row's tap (it takes the Value's place), 36 px inputs */
@media (max-width: 640px) {
  .sk-ptable .pt-unit, .sk-ptable .pt-comment { display: none; }
  .sk-ptable .pt-name { width: 26%; } .sk-ptable .pt-expr { width: 36%; } .sk-ptable .pt-val { width: 26%; } .sk-ptable .pt-bin { width: 12%; } /* the four visible columns sum to 100% (fixed layout) */
  .sk-ptable .pt-val::after { content: ' ' attr(data-unit); opacity: 0.7; }
  .sk-ptable tr.pt-open > td.pt-val { display: none; }
  .sk-ptable tr.pt-open > td.pt-comment { display: table-cell; }
  .sk-ptable-filter { padding: 8px; } /* a touch-sized box, like the dimension box's mobile rule */
  .sk-ptable .pt-in { min-height: 36px; font-size: 14px; padding: 4px 6px; }
  .sk-ptable .pt-del { width: 36px; height: 36px; font-size: 16px; } .sk-ptable .pt-add { min-height: 36px; }
}
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const COLUMN_LABEL = { name: 'Name', expression: 'Expression', comment: 'Comment' };
const COLUMNS = 6; // Name, Expression, Value, Unit, Comment, the bin
let tableCount = 0;

/**
 * createParameterTable({ state, getUnit, history }) -> { el, refresh(), syncHighlight(), signature(), destroy() }
 *   refresh() updates the rows from the state ONLY when they changed: in place when the same rows are shown (an edit, a solve, an undo: focus, caret
 *   and any text being typed are kept), rebuilt when rows come or go (the focused cell's place and every pending text are carried over).
 *   syncHighlight() only toggles the hover / selected classes (cheap: the window calls both every frame while it is open).
 */
export function createParameterTable({ state, getUnit = () => 'mm', history = null } = {}) {
  injectStyles();
  ensureNumericInputStyles(); // the completion list's look is the canvas box's (.dim-complete)
  const uid = ++tableCount;
  const root = el('div', 'sk-ptable');
  const filter = el('input', 'sk-ptable-filter'); filter.type = 'search'; filter.placeholder = 'Filter by name or expression';
  filter.setAttribute('aria-label', 'Filter parameters');
  const table = el('table'); table.setAttribute('role', 'grid'); table.setAttribute('aria-label', 'Parameters and sketch dimensions');
  root.append(filter, table);

  let lastSig = null;
  let lastShape = null;
  let rowRefs = [];              // every shown row's refs, in DOM order (user rows, the + Add row, dimension rows)
  let hoveredByTable = null;
  let newRow = null;             // the + Add row's typed fields { name, expression, unit, comment } while it is open
  const meta = new WeakMap();    // input -> { refs, column }
  let completion = null;         // the parameter-name completion of the focused Expression cell (one at a time)
  let completionList = null;

  const unitNow = () => getUnit();
  const columns = (labels) => { const tr = el('tr'); labels.forEach(([text, cls, aria]) => { const th = el('th', cls, text); th.scope = 'col'; if (aria) th.setAttribute('aria-label', aria); tr.appendChild(th); }); return tr; };
  const groupHead = (title, shown, total, add) => {
    const tr = el('tr'); const th = el('th'); th.scope = 'rowgroup'; th.colSpan = COLUMNS;
    th.append(el('span', 'pt-title', title), el('span', 'pt-count', shown === total ? `(${total})` : `(${shown} of ${total})`));
    if (add) th.appendChild(add);
    tr.appendChild(th); return tr;
  };
  const emptyRow = (text) => { const tr = el('tr'); const td = el('td', 'pt-empty', text); td.colSpan = COLUMNS; tr.appendChild(td); return tr; };
  const cell = (cls, text, unitForNarrow) => { const td = el('td', cls, text); if (unitForNarrow != null) td.dataset.unit = unitForNarrow; return td; };

  // ── an editable cell ──
  function makeInput(refs, column, value, label) {
    const inp = el('input', 'pt-in');
    inp.type = 'text'; inp.value = value; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('aria-label', label);
    inp.dataset.col = column;
    inp._orig = value;
    meta.set(inp, { refs, column });
    inp.addEventListener('input', () => { preview(inp); if (column === 'expression' && completion && completion.input === inp) completion.ctl.update(); });
    inp.addEventListener('focus', () => {
      if (column === 'expression') attachCompletion(inp);
      if (column !== 'comment') refs.tr.classList.remove('pt-open'); // the bottom sheet: editing the Name / Expression shows the Value again
    });
    inp.addEventListener('blur', (e) => leave(inp, e.relatedTarget));
    inp.addEventListener('keydown', (e) => keydown(inp, e));
    return inp;
  }
  const pending = (inp) => inp.value !== inp._orig;
  const setClean = (inp, value) => { if (!pending(inp) && inp.value !== value) inp.value = value; inp._orig = value; markPending(inp); }; // a pending text is kept
  const markPending = (inp) => inp.classList.toggle('pt-pending', pending(inp));
  const editOf = (inp) => {
    const { refs, column } = meta.get(inp);
    if (refs.isNew) return { kind: 'new', name: refs.inputs.name.value, text: refs.inputs.expression.value, unit: refs.unitSelect.value, comment: refs.inputs.comment.value };
    const r = refs.data;
    return r.kind === 'dimension' ? { kind: 'dimension', column, constraint: r.constraint, slot: r.slot, text: inp.value } : { kind: 'parameter', column, name: r.name, text: inp.value };
  };

  // the line under the row: the live preview (what Enter will do) or why it will not (the input gets aria-invalid and the red border)
  function showMessage(refs, inp, text, kind) {
    if (!text) { clearMessage(refs); return; }
    if (!refs.msg) {
      refs.msg = el('tr', 'pt-msg'); const td = el('td'); td.colSpan = COLUMNS; td.id = `sk-ptable-${uid}-msg-${refs.key}`; td.setAttribute('role', 'status');
      refs.msg.appendChild(td); refs.tr.after(refs.msg);
    }
    refs.msg.className = `pt-msg ${kind === 'error' ? 'pt-msg-err' : 'pt-msg-hint'}`;
    refs.msg.firstChild.textContent = text;
    for (const i of Object.values(refs.inputs)) if (i) { i.setAttribute('aria-invalid', 'false'); i.removeAttribute('aria-describedby'); }
    if (inp) { inp.setAttribute('aria-invalid', kind === 'error' ? 'true' : 'false'); inp.setAttribute('aria-describedby', refs.msg.firstChild.id); }
    refs.msgFor = inp ? meta.get(inp).column : null;
  }
  function clearMessage(refs) {
    if (refs.msg) { refs.msg.remove(); refs.msg = null; }
    for (const i of Object.values(refs.inputs)) if (i) { i.setAttribute('aria-invalid', 'false'); i.removeAttribute('aria-describedby'); }
    refs.msgFor = null;
  }
  function preview(inp) {
    const { refs } = meta.get(inp);
    markPending(inp);
    if (!refs.isNew && !pending(inp)) { clearMessage(refs); return; }
    const planned = planTableEdit(state, editOf(inp), { unit: unitNow() });
    if (planned.ok) showMessage(refs, inp, planned.changed ? planned.hint : '', 'hint');
    else showMessage(refs, inp, planned.message, planned.incomplete ? 'hint' : 'error');
  }

  // apply one cell (or the + Add row): true when it applied or nothing needed applying
  function apply(inp) {
    const { refs } = meta.get(inp);
    const planned = planTableEdit(state, editOf(inp), { unit: unitNow() });
    if (refs.isNew && planned.fill) { refs.inputs.name.value = planned.fill.name; refs.inputs.expression.value = planned.fill.expression; syncNewRow(refs); }
    if (!planned.ok) { showMessage(refs, inp, planned.message, planned.incomplete ? 'hint' : 'error'); return false; }
    if (!planned.changed) { if (!refs.isNew) { inp.value = inp._orig; markPending(inp); } clearMessage(refs); return true; }
    const res = commitTableEdit(state, planned);
    if (!res.ok) { showMessage(refs, inp, res.message, 'error'); return false; }
    if (refs.isNew) newRow = null;
    else { inp._orig = inp.value; markPending(inp); } // clean now: the refresh writes the stored (canonical) text into it
    clearMessage(refs);
    refresh();
    return true;
  }
  function revert(inp) {
    const { refs } = meta.get(inp);
    if (!refs.isNew) { inp.value = inp._orig; markPending(inp); }
    clearMessage(refs);
  }

  // ── where the focus is, as a place that survives a rebuild: (row index in DOM order, column) ──
  const placeOf = (node) => {
    if (!node || !table.contains(node)) return null;
    const i = rowRefs.findIndex((r) => r.tr.contains(node));
    return i === -1 ? null : { id: rowRefs[i].data.id, index: i, col: node.dataset.col || (node.classList.contains('pt-del') ? 'bin' : null) };
  };
  const indexOfPlace = (place) => { const i = rowRefs.findIndex((r) => r.data.id === place.id); return i !== -1 ? i : Math.min(place.index, rowRefs.length - 1); };
  const targetAt = (refs, col) => (!refs ? null : col === 'bin' ? refs.bin : (refs.inputs[col] || null));
  function focusPlace(place, { select = false } = {}) {
    if (!place || !rowRefs.length) return;
    const refs = rowRefs[indexOfPlace(place)];
    const t = targetAt(refs, place.col) || refs.inputs.name || refs.bin;
    if (t) { t.focus(); if (select && t.select) t.select(); }
  }
  // Enter: down one row in the same column (rows without that cell are skipped); none below: stay
  function moveDown(place) {
    for (let i = indexOfPlace(place) + 1; i < rowRefs.length; i++) {
      const t = targetAt(rowRefs[i], place.col);
      if (t) { t.focus(); if (t.select) t.select(); return; }
    }
    focusPlace(place);
  }

  function keydown(inp, e) {
    const { refs, column } = meta.get(inp);
    if (column === 'expression' && completion && completion.input === inp && completion.ctl.handleKey(e)) { e.stopPropagation(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const place = { id: refs.data.id, index: rowRefs.indexOf(refs), col: column };
      if (refs.isNew) {
        const planned = planTableEdit(state, editOf(inp), { unit: unitNow() });
        if (planned.ok && !planned.changed) return;
        if (!planned.ok && planned.incomplete && !planned.fill) { // the missing half: go there
          const missing = String(refs.inputs.name.value).trim() ? refs.inputs.expression : refs.inputs.name;
          if (missing !== inp) { missing.focus(); return; }
        }
      }
      if (refs.isNew) place.id = null; // the created parameter takes the + Add row's place
      if (apply(inp)) moveDown(place);
      return;
    }
    if (e.key === 'Escape') {
      if (refs.isNew) {
        e.preventDefault();
        if (inp.value) { inp.value = ''; syncNewRow(refs); preview(inp); return; }
        discardNewRow({ focusAdd: true });
        return;
      }
      if (pending(inp) || refs.msg) { e.preventDefault(); revert(inp); } // the first Esc reverts; with nothing being edited the dock's Esc closes the window
      return;
    }
    const action = undoRedoKeyAction(e);
    if (action && history && !pending(inp) && !refs.isNew) { e.preventDefault(); history[action](); refresh(); }
  }
  function leave(inp, to) {
    const { refs, column } = meta.get(inp);
    if (column === 'expression' && completion && completion.input === inp) completion.ctl.close();
    if (column === 'comment') refs.tr.classList.remove('pt-open'); // the bottom sheet: the Comment hides again once left
    if (!inp.isConnected) return;
    if (refs.isNew) {
      syncNewRow(refs);
      if (to && refs.tr.contains(to)) return; // moving inside the + Add row
      const planned = planTableEdit(state, editOf(inp), { unit: unitNow() });
      if (planned.ok && planned.changed) applyThenRefocus(inp, to);
      else if (!planned.ok && !planned.incomplete) showMessage(refs, inp, planned.message, 'error');
      return;
    }
    if (pending(inp)) applyThenRefocus(inp, to); // leaving the cell applies it; an invalid text stays, with its message, until it is fixed or reverted
  }
  // a commit that adds or removes a row rebuilds the table: the cell the focus was going to is then gone, so its place is focused again
  function applyThenRefocus(inp, to) {
    const place = placeOf(to);
    if (apply(inp) && place && !to.isConnected) focusPlace(place);
  }

  // ── the parameter-name completion (#ui/parameter-completion.js, the canvas box's own) on the focused Expression cell ──
  function attachCompletion(inp) {
    if (completion && completion.input === inp) return;
    detachCompletion();
    const { refs } = meta.get(inp);
    const list = el('ul', 'dim-complete sk-ptable-complete hidden');
    list.id = `sk-ptable-${uid}-complete`; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Parameter names');
    document.body.appendChild(list);
    inp.setAttribute('aria-controls', list.id); inp.setAttribute('aria-autocomplete', 'list');
    const exclude = () => (refs.isNew ? [] : [refs.data.name]); // a cell never offers its own name (that would be a loop)
    const ctl = createParameterCompletion({
      input: inp, list,
      context: () => ({ state, unit: unitNow(), exclude: exclude() }),
      onInsert: () => preview(inp),
      onChange: () => placeList(inp, list),
    });
    completion = { input: inp, ctl };
    completionList = list;
  }
  function detachCompletion() {
    if (completion) completion.ctl.close();
    if (completionList) completionList.remove();
    completion = null; completionList = null;
  }
  function placeList(inp, list) {
    if (list.classList.contains('hidden')) return;
    const r = inp.getBoundingClientRect();
    const h = list.offsetHeight;
    const below = r.bottom + 2 + h <= window.innerHeight - 4 || r.top - 2 - h < 0;
    list.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - list.offsetWidth - 4))}px`;
    list.style.top = `${below ? r.bottom + 2 : r.top - 2 - h}px`;
  }

  // ── the + Add row ──
  function syncNewRow(refs) {
    if (!newRow || !refs.isNew) return;
    newRow.name = refs.inputs.name.value; newRow.expression = refs.inputs.expression.value;
    newRow.unit = refs.unitSelect.value; newRow.comment = refs.inputs.comment.value;
  }
  function openNewRow() {
    if (!newRow) { const u = unitNow(); newRow = { name: '', expression: '', unit: PARAMETER_UNITS.includes(u) ? u : 'mm', comment: '' }; rebuild(); }
    const refs = rowRefs.find((r) => r.isNew);
    if (refs) refs.inputs.name.focus();
  }
  function discardNewRow({ focusAdd = false } = {}) {
    newRow = null; rebuild();
    if (focusAdd) { const b = table.querySelector('.pt-add'); if (b) b.focus(); }
  }

  // ── the rows ──
  function rowClick(refs, ev) {
    if (ev.target && ev.target.closest && ev.target.closest('input, button, select')) return; // a cell or the bin: not a row pick
    if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) { // the bottom sheet: a tap shows the row's Comment in the Value's place (one row at a time)
      for (const o of rowRefs) if (o !== refs) o.tr.classList.remove('pt-open');
      refs.tr.classList.toggle('pt-open');
    }
    const r = refs.data;
    const extend = !!(ev && ev.shiftKey);
    if (r.kind === 'dimension') toggleConstraintSelection(state, r.constraint, extend);
    else {
      if (!extend && state.selectedConstraints instanceof Set) state.selectedConstraints.clear();
      dependentDimensions(state, r.name).forEach((c, i) => { if (!(state.selectedConstraints instanceof Set) || !state.selectedConstraints.has(c)) toggleConstraintSelection(state, c, extend || i > 0); });
    }
    syncHighlight();
  }
  function userRow(r, key) {
    const refs = { key, kind: 'parameter', data: r, inputs: {} };
    const tr = refs.tr = el('tr', 'sk-ptable-row pt-user'); tr.dataset.kind = 'parameter';
    const name = cell('pt-name'); name.appendChild(refs.inputs.name = makeInput(refs, 'name', r.name, `Name of ${r.name}`));
    const expr = cell('pt-expr'); expr.appendChild(refs.inputs.expression = makeInput(refs, 'expression', r.expression, `Expression of ${r.name}`));
    const comment = cell('pt-comment'); comment.appendChild(refs.inputs.comment = makeInput(refs, 'comment', r.comment, `Comment of ${r.name}`));
    refs.inputs.comment.placeholder = 'comment';
    refs.valueTd = cell('pt-val'); refs.unitTd = cell('pt-unit');
    const bin = cell('pt-bin');
    refs.bin = el('button', 'pt-del', '🗑'); refs.bin.type = 'button';
    refs.bin.addEventListener('click', () => deleteRow(refs));
    bin.appendChild(refs.bin);
    tr.append(name, expr, refs.valueTd, refs.unitTd, comment, bin);
    tr.addEventListener('click', (ev) => rowClick(refs, ev));
    updateUserRow(refs, r);
    return refs;
  }
  function updateUserRow(refs, r) {
    refs.data = r;
    refs.tr.dataset.name = r.name;
    refs.tr.classList.toggle('pt-error', !!r.error);
    if (r.error) refs.tr.title = r.error; else refs.tr.removeAttribute('title');
    setClean(refs.inputs.name, r.name); setClean(refs.inputs.expression, r.expression); setClean(refs.inputs.comment, r.comment);
    refs.inputs.name.setAttribute('aria-label', `Name of ${r.name}`); refs.inputs.expression.setAttribute('aria-label', `Expression of ${r.name}`);
    refs.inputs.comment.setAttribute('aria-label', `Comment of ${r.name}`);
    refs.valueTd.textContent = r.value; refs.valueTd.dataset.unit = r.unit; refs.unitTd.textContent = r.unit;
    const inUse = r.users.length > 0;
    refs.bin.setAttribute('aria-disabled', inUse ? 'true' : 'false');
    refs.bin.title = inUse ? `${r.name} is used by ${r.users.join(', ')}: it cannot be deleted` : `Delete ${r.name}`;
    refs.bin.setAttribute('aria-label', refs.bin.title);
  }
  function deleteRow(refs) {
    const planned = planTableEdit(state, { kind: 'parameter', column: 'delete', name: refs.data.name }, { unit: unitNow() });
    if (!planned.ok) { showMessage(refs, null, planned.message, 'error'); return; } // in use: the message lists its users (the bin is aria-disabled)
    const res = commitTableEdit(state, planned);
    if (!res.ok) { showMessage(refs, null, res.message, 'error'); return; }
    const place = placeOf(refs.bin);
    refresh();
    if (place) focusPlace(place);
  }
  function newParameterRow() {
    const refs = { key: 'new', kind: 'new', isNew: true, data: { id: 'new', kind: 'new', name: '' }, inputs: {} };
    const tr = refs.tr = el('tr', 'sk-ptable-row pt-user pt-new'); tr.dataset.kind = 'new';
    const name = cell('pt-name'); name.appendChild(refs.inputs.name = makeInput(refs, 'name', newRow.name, 'Name of the new parameter'));
    refs.inputs.name.placeholder = 'name'; refs.inputs.name._orig = '';
    const expr = cell('pt-expr'); expr.appendChild(refs.inputs.expression = makeInput(refs, 'expression', newRow.expression, 'Expression of the new parameter'));
    refs.inputs.expression.placeholder = 'value, or name = value'; refs.inputs.expression._orig = '';
    const comment = cell('pt-comment'); comment.appendChild(refs.inputs.comment = makeInput(refs, 'comment', newRow.comment, 'Comment of the new parameter'));
    refs.inputs.comment.placeholder = 'comment'; refs.inputs.comment._orig = '';
    const unit = cell('pt-unit');
    const sel = refs.unitSelect = el('select', 'pt-in'); sel.setAttribute('aria-label', 'Unit of the new parameter');
    for (const u of PARAMETER_UNITS) { const o = el('option', null, u || 'none'); o.value = u; sel.appendChild(o); }
    sel.value = newRow.unit;
    sel.addEventListener('change', () => { syncNewRow(refs); preview(refs.inputs.expression); });
    unit.appendChild(sel);
    refs.valueTd = cell('pt-val');
    const bin = cell('pt-bin');
    refs.bin = el('button', 'pt-del', '✕'); refs.bin.type = 'button'; refs.bin.title = 'Discard the new parameter'; refs.bin.setAttribute('aria-label', refs.bin.title);
    refs.bin.addEventListener('click', () => discardNewRow({ focusAdd: true }));
    bin.appendChild(refs.bin);
    tr.append(name, expr, refs.valueTd, unit, comment, bin);
    return refs;
  }
  function dimensionRow(r, key) {
    const refs = { key, kind: 'dimension', data: r, inputs: {} };
    const tr = refs.tr = el('tr', 'sk-ptable-row pt-dim'); tr.dataset.kind = 'dimension';
    const name = cell('pt-name');
    refs.inputs.name = makeInput(refs, 'name', r.name, `Name of ${r.name}`);
    if (r.reference) { const wrap = el('div', 'pt-cellwrap'); const m = el('span', 'pt-ref', 'ref'); m.title = 'Reference dimension (driven)'; wrap.append(refs.inputs.name, m); name.appendChild(wrap); }
    else name.appendChild(refs.inputs.name);
    const expr = cell('pt-expr');
    if (r.reference) expr.textContent = r.expression; // a reference dimension has no formula (O9): read only
    else {
      const wrap = el('div', 'pt-cellwrap');
      refs.fx = el('span', 'pt-fx', 'fx'); refs.fx.title = 'Formula';
      wrap.append(refs.fx, refs.inputs.expression = makeInput(refs, 'expression', r.expression, `Expression of ${r.name}`));
      expr.appendChild(wrap);
    }
    refs.valueTd = cell('pt-val'); refs.unitTd = cell('pt-unit'); refs.commentTd = cell('pt-comment');
    tr.append(name, expr, refs.valueTd, refs.unitTd, refs.commentTd, cell('pt-bin'));
    // the canvas link: the SAME two seams as the side panel (hover -> state.hoveredConstraint, click -> state.selectedConstraints); a focused cell hovers too
    const hover = () => { hoveredByTable = refs.data.constraint; state.hoveredConstraint = refs.data.constraint; };
    const unhover = () => { const c = refs.data.constraint; if (state.hoveredConstraint === c) state.hoveredConstraint = null; if (hoveredByTable === c) hoveredByTable = null; };
    tr.addEventListener('mouseenter', hover); tr.addEventListener('mouseleave', unhover);
    tr.addEventListener('focusin', hover); tr.addEventListener('focusout', unhover);
    tr.addEventListener('click', (ev) => rowClick(refs, ev));
    updateDimensionRow(refs, r);
    return refs;
  }
  function updateDimensionRow(refs, r) {
    refs.data = r;
    refs.tr.dataset.name = r.name;
    refs.tr.classList.toggle('pt-error', !!r.error);
    refs.tr.classList.toggle('pt-reference', r.reference);
    if (r.error) refs.tr.title = r.error; else refs.tr.removeAttribute('title');
    setClean(refs.inputs.name, r.name); refs.inputs.name.setAttribute('aria-label', `Name of ${r.name}`);
    if (refs.inputs.expression) {
      setClean(refs.inputs.expression, r.expression); refs.inputs.expression.setAttribute('aria-label', `Expression of ${r.name}`);
      refs.fx.hidden = !r.hasExpression;
    }
    refs.valueTd.textContent = r.value; refs.valueTd.dataset.unit = r.unit; refs.unitTd.textContent = r.unit;
    refs.commentTd.textContent = `${r.kindLabel}${r.measures ? ' · ' + r.measures : ''}`;
  }

  // what decides whether rows can be updated in place: the same rows of the same kinds (a reference row has no Expression cell)
  const shapeOf = (rows) => JSON.stringify([rows.filter, rows.total, rows.user.length, !!newRow, rows.dimensions.map((r) => (r.reference ? 'r' : 'd'))]);
  const sigOf = (rows) => JSON.stringify([rows.unit, rows.filter, rows.total, rows.user, !!newRow, rows.dimensions.map(({ constraint, ...rest }) => rest)]);

  function build(rows) {
    if (hoveredByTable) { if (state.hoveredConstraint === hoveredByTable) state.hoveredConstraint = null; hoveredByTable = null; } // its row is about to go: no mouseleave will fire
    // carried over: the focused cell's place and every pending text (by row id and column)
    const place = placeOf(document.activeElement);
    const drafts = new Map();
    for (const refs of rowRefs) if (!refs.isNew) for (const [col, inp] of Object.entries(refs.inputs)) if (inp && pending(inp)) drafts.set(`${refs.data.id}|${col}`, inp.value);
    for (const refs of rowRefs) if (refs.isNew) syncNewRow(refs);
    detachCompletion();
    table.replaceChildren();
    rowRefs = [];
    let n = 0;
    const thead = el('thead');
    thead.appendChild(columns([['Name', 'pt-name'], ['Expression', 'pt-expr'], ['Value', 'pt-val'], ['Unit', 'pt-unit'], ['Comment', 'pt-comment'], ['', 'pt-bin', 'Delete']]));
    const add = el('button', 'pt-add', '+ Add'); add.type = 'button'; add.title = 'Add a user parameter'; add.setAttribute('aria-label', 'Add a user parameter');
    add.addEventListener('click', openNewRow);
    const users = el('tbody'); users.dataset.group = 'user';
    users.appendChild(groupHead('User parameters', rows.user.length, rows.total.user, add));
    rows.user.forEach((r) => { const refs = userRow(r, ++n); rowRefs.push(refs); users.appendChild(refs.tr); });
    if (newRow) { const refs = newParameterRow(); rowRefs.push(refs); users.appendChild(refs.tr); }
    if (!rows.user.length && !newRow) users.appendChild(emptyRow(rows.total.user ? 'No user parameter matches the filter.' : USER_EMPTY_TEXT));
    const dims = el('tbody'); dims.dataset.group = 'dimensions';
    dims.appendChild(groupHead('Sketch dimensions', rows.dimensions.length, rows.total.dimensions));
    rows.dimensions.forEach((r) => { const refs = dimensionRow(r, ++n); rowRefs.push(refs); dims.appendChild(refs.tr); });
    if (!rows.dimensions.length) dims.appendChild(emptyRow(rows.total.dimensions ? 'No dimension matches the filter.' : DIMENSION_EMPTY_TEXT));
    table.append(thead, users, dims);
    for (const refs of rowRefs) {
      if (refs.isNew) { if (refs.inputs.name.value || refs.inputs.expression.value) preview(refs.inputs.expression.value ? refs.inputs.expression : refs.inputs.name); continue; }
      for (const [col, inp] of Object.entries(refs.inputs)) {
        const d = inp && drafts.get(`${refs.data.id}|${col}`);
        if (d != null) { inp.value = d; preview(inp); }
      }
    }
    if (place) focusPlace(place);
  }
  function update(rows) {
    const all = [...rows.user, ...rows.dimensions];
    let i = 0;
    for (const refs of rowRefs) {
      if (refs.isNew) continue;
      const r = all[i++];
      if (refs.kind === 'parameter') updateUserRow(refs, r); else updateDimensionRow(refs, r);
      if (refs.msg) { const inp = refs.msgFor && refs.inputs[refs.msgFor]; if (inp && pending(inp)) preview(inp); else clearMessage(refs); }
    }
  }
  function rebuild() { lastSig = null; lastShape = null; refresh(); }

  function syncHighlight() {
    const sel = state && state.selectedConstraints instanceof Set ? state.selectedConstraints : null;
    // every row of a constraint (TASK 694: a pattern has one row per value)
    for (const r of rowRefs) {
      if (r.kind !== 'dimension') continue;
      const c = r.data.constraint;
      r.tr.setAttribute('aria-selected', sel && sel.has(c) ? 'true' : 'false');
      r.tr.classList.toggle('pt-hover', state.hoveredConstraint === c);
    }
  }
  function refresh() {
    const rows = buildParameterRows(state, { unit: unitNow(), filter: filter.value });
    const sig = sigOf(rows);
    if (sig !== lastSig) {
      lastSig = sig;
      const shape = shapeOf(rows);
      if (shape === lastShape) update(rows); else { lastShape = shape; build(rows); }
    }
    syncHighlight();
  }
  filter.addEventListener('input', refresh);

  refresh();
  return {
    el: root, refresh, syncHighlight,
    signature: () => lastSig,
    destroy: () => { if (hoveredByTable && state.hoveredConstraint === hoveredByTable) state.hoveredConstraint = null; detachCompletion(); root.remove(); },
  };
}
