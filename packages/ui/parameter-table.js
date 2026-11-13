// packages/ui/parameter-table.js — TASK 535 slice 4: the Parameters table (docs/PARAMETERS-DESIGN.md section F). READ-ONLY in this slice.
//
//   buildParameterRows(state, { unit, filter })   PURE: state -> { user: [row], dimensions: [row], ... }. THE one source of the rows; slice 5 adds
//                                                  editing to these same rows (each carries what an edit needs: the name and the constraint itself).
//   createParameterTable({ state, getUnit })       the DOM: ONE real <table> (role="grid") with two row groups, a filter box, and the canvas link:
//                                                  hovering / focusing a dimension row sets state.hoveredConstraint, clicking selects it (the SAME
//                                                  two seams the side panel uses), and the row of a canvas-hovered / canvas-selected dimension is lit.
// Lengths are formatted by the shared units formatter in the document unit; angles in degrees. All text is set with textContent.

import { format as formatUnit } from '#core/units.js';
import { evaluateAll, isDimension, isReferenceDimension, quantityText } from '#core/parameters.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { labelGeometry, constraintGeometryText } from '#ui/geometry-labels.js';
import { toggleConstraintSelection } from '#ui/design-info-panel.js';

export const USER_EMPTY_TEXT = 'No user parameters yet. They will appear here once you type name = value into a dimension.';
export const DIMENSION_EMPTY_TEXT = 'No dimensions yet. Use the Dim tool to add one.';

const isAngle = (c) => c.type === CONSTRAINT_TYPES.ANGLE;
const kindLabelOf = (c) => (isAngle(c) ? 'Angle' : c.isRadius || c.type === 'radius' ? 'Radius' : c.isDiameter || c.dimMode === 'diameter' || c.type === 'diameter' ? 'Diameter' : 'Distance');

const dimensionValueText = (c, unit) => (isAngle(c) ? Number(c.value).toFixed(1) : formatUnit(c.value, unit, { decimals: 1 }));

/**
 * buildParameterRows(state, { unit = 'mm', filter = '' }) -> {
 *   unit, filter, total: { user, dimensions },
 *   user:       [{ id, kind:'parameter', name, expression, value, unit, comment, error }]
 *   dimensions: [{ id, kind:'dimension', constraint, name, expression, hasExpression, reference, value, unit, kindLabel, measures, error }]
 * }  Dimensions keep constraint order, user parameters table order. `filter`: rows whose name or expression contains the text (case-insensitive).
 */
export function buildParameterRows(state, { unit = 'mm', filter = '' } = {}) {
  const params = (state && Array.isArray(state.parameters)) ? state.parameters : [];
  const cons = (state && Array.isArray(state.constraints)) ? state.constraints : [];
  const dims = cons.filter(isDimension);
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
      error: err ? err.message : loopMessage,
    };
  });

  const dimensions = dims.map((c, i) => {
    const reference = isReferenceDimension(c);
    const text = dimensionValueText(c, unit);
    const hasExpression = !reference && typeof c.expression === 'string' && c.expression !== '';
    const err = !reference && c.name ? errors.get(c.name) : null;
    return {
      id: 'd:' + (c.name || i), kind: 'dimension', constraint: c, name: c.name || '', hasExpression, reference,
      expression: reference ? '(reference)' : hasExpression ? c.expression : text,
      value: reference ? `(${text})` : text, unit: isAngle(c) ? 'deg' : unit,
      kindLabel: kindLabelOf(c), measures: constraintGeometryText(c, (state && state.shapes) || [], geo),
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
.sk-ptable-filter::placeholder { color: inherit; opacity: 0.5; }
.sk-ptable-filter:focus-visible, .sk-ptable-row:focus-visible { outline: 2px solid var(--sk-dock-accent, var(--sk-selection, #4c9aff)); outline-offset: -2px; }
.sk-ptable table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.sk-ptable th, .sk-ptable td { text-align: left; padding: 4px 6px; vertical-align: top; overflow-wrap: anywhere; font-weight: 400; }
.sk-ptable thead th { font-size: 0.85em; font-weight: 700; opacity: 0.6; }
.sk-ptable thead tr { border-bottom: 1px solid var(--sk-dock-border, rgba(127,127,127,0.3)); }
.sk-ptable th[scope="rowgroup"] { font-size: 0.8em; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; opacity: 0.75; padding-top: 10px; }
.sk-ptable .pt-count { font-weight: 400; opacity: 0.7; margin-left: 4px; }
.sk-ptable .pt-name { width: 17%; font-weight: 600; } .sk-ptable .pt-expr { width: 28%; }
.sk-ptable .pt-val { width: 14%; font-variant-numeric: tabular-nums; } .sk-ptable .pt-unit { width: 11%; opacity: 0.8; }
.sk-ptable .pt-comment { width: auto; opacity: 0.85; }
.sk-ptable-row { cursor: pointer; }
.sk-ptable-row:hover, .sk-ptable-row.pt-hover { background: var(--sk-info-hover, rgba(127,127,127,0.16)); }
.sk-ptable-row[aria-selected="true"] { background: var(--sk-dock-accent, var(--sk-selection, #4c9aff)); color: #fff; }
.sk-ptable-row.pt-reference { opacity: 0.6; font-style: italic; }
.sk-ptable-row.pt-error .pt-val { color: var(--sk-error, #e5484d); }
.sk-ptable-row[aria-selected="true"].pt-reference { opacity: 0.95; }
.sk-ptable .pt-fx { display: inline-block; font: italic 700 0.85em Georgia, serif; padding: 0 4px; margin-right: 4px; border-radius: 4px;
  background: var(--sk-info-head, rgba(127,127,127,0.2)); }
.sk-ptable .pt-ref { display: inline-block; font-size: 0.75em; padding: 0 4px; margin-left: 4px; border-radius: 4px; border: 1px solid currentColor; font-style: normal; }
.sk-ptable .pt-empty { opacity: 0.6; font-style: italic; padding: 6px; }
@media (max-width: 640px) {
  .sk-ptable .pt-unit, .sk-ptable .pt-comment { display: none; }
  .sk-ptable .pt-name { width: 22%; } .sk-ptable .pt-expr { width: 38%; } .sk-ptable .pt-val { width: 40%; } /* three visible columns must sum to 100% (fixed layout) */
  .sk-ptable .pt-val::after { content: ' ' attr(data-unit); opacity: 0.7; }
  .sk-ptable-filter { padding: 8px; } /* a touch-sized box, like the dimension box's mobile rule */
}
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/**
 * createParameterTable({ state, getUnit }) -> { el, refresh(), syncHighlight(), signature(), destroy() }
 *   refresh() rebuilds the rows from the state ONLY when they changed (keeps focus, scroll and the filter text); syncHighlight() only toggles the
 *   hover / selected classes (cheap: the window calls both every frame while it is open).
 */
export function createParameterTable({ state, getUnit = () => 'mm' } = {}) {
  injectStyles();
  const root = el('div', 'sk-ptable');
  const filter = el('input', 'sk-ptable-filter'); filter.type = 'search'; filter.placeholder = 'Filter by name or expression';
  filter.setAttribute('aria-label', 'Filter parameters');
  const table = el('table'); table.setAttribute('role', 'grid'); table.setAttribute('aria-label', 'Parameters and sketch dimensions');
  root.append(filter, table);

  let lastSig = null;
  let rowByConstraint = new Map();
  let hoveredByTable = null;

  const columns = (labels) => { const tr = el('tr'); labels.forEach(([text, cls]) => { const th = el('th', cls, text); th.scope = 'col'; tr.appendChild(th); }); return tr; };
  const groupHead = (title, shown, total) => {
    const tr = el('tr'); const th = el('th', null, title); th.scope = 'rowgroup'; th.colSpan = 5;
    th.appendChild(el('span', 'pt-count', shown === total ? `(${total})` : `(${shown} of ${total})`)); tr.appendChild(th); return tr;
  };
  const emptyRow = (text) => { const tr = el('tr'); const td = el('td', 'pt-empty', text); td.colSpan = 5; tr.appendChild(td); return tr; };
  const cell = (cls, text, unitForNarrow) => { const td = el('td', cls, text); if (unitForNarrow != null) td.dataset.unit = unitForNarrow; return td; };

  function userRow(r) {
    const tr = el('tr', 'sk-ptable-row pt-user' + (r.error ? ' pt-error' : '')); tr.dataset.name = r.name; tr.dataset.kind = 'parameter';
    if (r.error) tr.title = r.error;
    tr.append(cell('pt-name', r.name), cell('pt-expr', r.expression), cell('pt-val', r.value, r.unit), cell('pt-unit', r.unit), cell('pt-comment', r.comment));
    return tr;
  }
  function dimensionRow(r) {
    const c = r.constraint;
    const tr = el('tr', 'sk-ptable-row pt-dim' + (r.reference ? ' pt-reference' : '') + (r.error ? ' pt-error' : ''));
    tr.dataset.name = r.name; tr.dataset.kind = 'dimension'; tr.tabIndex = 0;
    if (r.error) tr.title = r.error;
    const name = cell('pt-name', r.name);
    if (r.reference) { const m = el('span', 'pt-ref', 'ref'); m.title = 'Reference dimension (driven)'; name.appendChild(m); }
    const expr = cell('pt-expr', null);
    if (r.hasExpression) { const m = el('span', 'pt-fx', 'fx'); m.title = 'Formula'; expr.appendChild(m); }
    expr.appendChild(document.createTextNode(r.expression));
    tr.append(name, expr, cell('pt-val', r.value, r.unit), cell('pt-unit', r.unit), cell('pt-comment', `${r.kindLabel}${r.measures ? ' · ' + r.measures : ''}`));
    // the canvas link: the SAME two seams as the side panel (hover -> state.hoveredConstraint, click -> state.selectedConstraints)
    const hover = () => { hoveredByTable = c; state.hoveredConstraint = c; };
    const unhover = () => { if (state.hoveredConstraint === c) state.hoveredConstraint = null; if (hoveredByTable === c) hoveredByTable = null; };
    tr.addEventListener('mouseenter', hover); tr.addEventListener('mouseleave', unhover);
    tr.addEventListener('focus', hover); tr.addEventListener('blur', unhover);
    const pick = (ev) => { toggleConstraintSelection(state, c, !!(ev && ev.shiftKey)); syncHighlight(); };
    tr.addEventListener('click', pick);
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(ev); } });
    rowByConstraint.set(c, tr);
    return tr;
  }

  function build(rows) {
    if (hoveredByTable) { if (state.hoveredConstraint === hoveredByTable) state.hoveredConstraint = null; hoveredByTable = null; } // its row is about to go: no mouseleave will fire
    table.replaceChildren();
    rowByConstraint = new Map();
    const thead = el('thead'); thead.appendChild(columns([['Name', 'pt-name'], ['Expression', 'pt-expr'], ['Value', 'pt-val'], ['Unit', 'pt-unit'], ['Comment', 'pt-comment']]));
    const users = el('tbody'); users.dataset.group = 'user';
    users.appendChild(groupHead('User parameters', rows.user.length, rows.total.user));
    if (rows.user.length) rows.user.forEach((r) => users.appendChild(userRow(r)));
    else users.appendChild(emptyRow(rows.total.user ? 'No user parameter matches the filter.' : USER_EMPTY_TEXT));
    const dims = el('tbody'); dims.dataset.group = 'dimensions';
    dims.appendChild(groupHead('Sketch dimensions', rows.dimensions.length, rows.total.dimensions));
    if (rows.dimensions.length) rows.dimensions.forEach((r) => dims.appendChild(dimensionRow(r)));
    else dims.appendChild(emptyRow(rows.total.dimensions ? 'No dimension matches the filter.' : DIMENSION_EMPTY_TEXT));
    table.append(thead, users, dims);
  }

  // what makes the rows differ: everything shown, never the constraint object
  const sigOf = (rows) => JSON.stringify([rows.unit, rows.filter, rows.total, rows.user, rows.dimensions.map(({ constraint, ...rest }) => rest)]);

  function syncHighlight() {
    const sel = state && state.selectedConstraints instanceof Set ? state.selectedConstraints : null;
    for (const [c, tr] of rowByConstraint) {
      tr.setAttribute('aria-selected', sel && sel.has(c) ? 'true' : 'false');
      tr.classList.toggle('pt-hover', state.hoveredConstraint === c);
    }
  }
  function refresh() {
    const rows = buildParameterRows(state, { unit: getUnit(), filter: filter.value });
    const sig = sigOf(rows);
    if (sig !== lastSig) { lastSig = sig; build(rows); }
    syncHighlight();
  }
  filter.addEventListener('input', refresh);

  refresh();
  return {
    el: root, refresh, syncHighlight,
    signature: () => lastSig,
    destroy: () => { if (hoveredByTable && state.hoveredConstraint === hoveredByTable) state.hoveredConstraint = null; try { root.remove(); } catch (_) { /* detached */ } },
  };
}
