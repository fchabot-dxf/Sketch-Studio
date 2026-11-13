// TASK 535 slice 3 -- formulas TYPED INTO A DIMENSION'S BOX on the canvas (docs/PARAMETERS-DESIGN.md sections D, E, R3, owner rulings O4 O5 O11 O12 O15 O16).
// Node, the REAL numeric-input-manager (showEditInput + the Enter key) on a real engine and real tool seams (tests/harness/audit/lib.js), with a minimal fake
// DOM: the hint line and the autocomplete list need a real DOM and are driven by tests/parameters-canvas-live.test.js. Covers: typed number / unit / formula /
// name / `name = value` create / `name = value` existing (the hint lists the others, ONE undo) / unknown name refused / unit mismatch / cycle / reference
// dimension / determined dimension / the fx label / save + load + undo / toggleDriving (O11) / fillet (O12) / completionsFor (R3).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { completionsFor, previewDimensionInput, MAX_COMPLETIONS } from '#core/parameters.js';
import { functionTable } from '#core/expression.js';
import { applyParameterChange, toggleDriving } from '#ui/dimension-seams.js';
import { formatConstraintValue } from '#ui/svg-renderer.js';
import { createSketchState } from '#ui/sketch-state.js';
import { createEngine } from '#core/constraint-solver.js';

let checks = 0;
const ok = (cond, msg) => { checks++; assert(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.deepStrictEqual(a, b, msg); };
const near = (a, b, msg) => ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

// ---------------------------------------------------------------- a minimal fake DOM: the REAL box, its real Enter handler, a toast recorder
const listeners = new Map();
const toasts = [];
const mkEl = (tag) => {
  const el = { tag, style: {}, classList: { _s: new Set(), add(s) { this._s.add(s); }, remove(s) { this._s.delete(s); }, contains(s) { return this._s.has(s); }, toggle() {} }, children: [], addEventListener() {}, appendChild(c) { this.children.push(c); }, setAttribute() {}, focus() {}, select() {} };
  Object.defineProperty(el, 'textContent', { set(v) { if (tag === 'pre') toasts.push(v); }, get() { return ''; } });
  return el;
};
const dimInput = {
  id: 'dimInput', inputMode: '', value: '', style: {},
  classList: { _set: new Set(['hidden']), add(s) { this._set.add(s); }, remove(s) { this._set.delete(s); }, contains(s) { return this._set.has(s); } },
  focus() {}, select() {},
  addEventListener(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
  removeEventListener() {},
};
const container = mkEl('div');
globalThis.document = {
  body: { appendChild() {} }, head: { appendChild() {}, querySelector: () => null },
  getElementById: (id) => (id === 'dimInput' ? dimInput : id === 'notification-container' ? container : null),
  createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
const { setupNumericInput, showEditInput, hideInput, isInputActive } = await import('#ui/numeric-input-manager.js');

const press = (key) => { for (const fn of listeners.get('keydown') || []) fn({ type: 'keydown', key, stopPropagation() {}, stopImmediatePropagation() {}, preventDefault() {} }); };
// open the box on a dimension, type `text`, return what the user would see; Enter commits
function typeInto(S, c, text, { enter = true } = {}) {
  showEditInput(svg, S.state, c);
  const opened = isInputActive();
  if (!opened) return { opened };
  dimInput.value = text;
  if (enter) press('Enter');
  return { opened, stillOpen: isInputActive() };
}
const D = (S, name) => S.state.constraints.find((c) => c.name === name); // undo / redo REBUILD the constraints: look a dimension up by name afterwards
const measuredLen = (S, c) => { const [a, b] = c.joints.map((j) => S.state.joints.get(j)); return c.dimMode === 'horizontal' ? Math.abs(b.x - a.x) : c.dimMode === 'vertical' ? Math.abs(b.y - a.y) : Math.hypot(b.x - a.x, b.y - a.y); };
// everything an undo must restore, as one image
const sortKeys = (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([a]) => !a.startsWith('__')).sort(([a], [b]) => (a < b ? -1 : 1))) : x);
const image = (st) => JSON.stringify({ j: [...st.joints], c: st.constraints, p: st.parameters }, sortKeys);

// ---------------------------------------------------------------- the drawing: two rectangles, each with width + height (d1..d4), welded apart; plus a reference dim
function drawing() {
  const S = L.newSketch();
  setupNumericInput(svg, S.state);
  S.state.saveState = ((orig) => function (...a) { return orig.apply(this, a); })(S.state.saveState);
  const mk = (x, w, h) => {
    for (const t0 = Date.now(); Date.now() === t0;); // shape ids are s<Date.now()>_n: two rects in one millisecond would share ids
    const r = L.rect(S, x, 0, x + w, h);
    const ids = [...new Set(r.lines.flatMap((id) => L.shape(S, id).joints))];
    const at = (px, py) => ids.find((id) => Math.abs(S.state.joints.get(id).x - px) < 1e-9 && Math.abs(S.state.joints.get(id).y - py) < 1e-9);
    S.state.joints.get(at(x, 0)).fixed = true;
    const dw = ConstraintManager.createConstraint(S.state, 'distance', { joints: [at(x, 0), at(x + w, 0)], value: w, dimMode: 'horizontal' }, { source: 'audit' });
    const dh = ConstraintManager.createConstraint(S.state, 'distance', { joints: [at(x + w, 0), at(x + w, h)], value: h, dimMode: 'vertical' }, { source: 'audit' });
    return { dw, dh, r, at };
  };
  const A = mk(0, 100, 40), B = mk(200, 60, 30);
  S.engine.solve(L.ITER);
  S.state.saveState('baseline');
  return { S, A, B, d1: A.dw, d2: A.dh, d3: B.dw, d4: B.dh };
}

// ================================================================ 1. typed number / unit / fraction / formula (plain numbers REPLACE a formula)
{
  const { S, d1, d2 } = drawing();
  eq([d1.name, d2.name], ['d1', 'd2'], 'automatic names');
  const h0 = S.state.history.length;
  const t = typeInto(S, d1, '60');
  ok(t.opened && !t.stillOpen, 'the box opened and a valid number closes it');
  near(d1.value, 60, 'typed 60'); near(measuredLen(S, d1), 60, 'geometry follows 60'); ok(d1.expression === undefined, 'a plain number stores no formula');
  eq(S.state.history.length, h0 + 1, 'ONE undo step per typed value');
  typeInto(S, d1, '2 in'); near(d1.value, 50.8, '2 in = 50.8 mm');
  typeInto(S, d1, '1/2 in'); near(d1.value, 12.7, '1/2 in = 12.7 mm (O20)');
  typeInto(S, d1, '10mm'); near(d1.value, 10, '10mm without a space');
  // a formula over another dimension (d2 is a driving dimension: its name is usable)
  typeInto(S, d1, 'd2 * 2');
  ok(d1.expression === 'd2 * 2', 'the formula is stored canonically: ' + d1.expression);
  near(d1.value, d2.value * 2, 'value = formula'); near(measuredLen(S, d1), d2.value * 2, 'geometry follows the formula');
  // the box opens with the FORMULA, not the value; a plain number then replaces it
  showEditInput(svg, S.state, d1); eq(dimInput.value, 'd2 * 2', 'prefilled with the expression'); press('Escape');
  typeInto(S, d1, '33'); ok(d1.expression === undefined && Math.abs(d1.value - 33) < 1e-6, 'a plain number deletes the formula (Fusion)');
  showEditInput(svg, S.state, d1); eq(dimInput.value, '33.0', 'prefilled with the value when there is no formula'); press('Escape');
  // an angle takes degrees; O16/O15: the edit box asks for the TEXT keyboard
  eq(dimInput.inputMode, 'text', 'the dimension box asks for the full text keyboard (O16)');
  const nothing = typeInto(S, d1, '   ');
  ok(nothing.opened && !nothing.stillOpen, 'an empty box closes like before'); near(d1.value, 33, 'and changes nothing');
}

// ================================================================ 2. `name = value`: create, then use; change the existing one with the hint listing the others (O4)
{
  const { S, d1, d2, d3, d4 } = drawing();
  const h0 = S.state.history.length, before = image(S.state);
  const pv = previewDimensionInput(S.state, d1, 'width = 120');
  ok(pv.ok && pv.kind === 'create' && pv.hint === 'creates width = 120.0 mm', 'create hint: ' + pv.hint);
  ok(S.state.parameters.length === 0, 'the preview creates nothing');
  typeInto(S, d1, 'width = 120');
  eq(S.state.parameters, [{ name: 'width', unit: 'mm', expression: '120 mm' }], 'parameter created (R2)');
  ok(d1.expression === 'width', 'the dimension now follows it'); near(measuredLen(S, d1), 120, 'geometry = 120');
  eq(S.state.history.length, h0 + 1, 'create + link = ONE undo step');
  S.state.undo();
  eq(image(S.state), before, 'ONE undo removes the parameter AND restores the dimension, exactly');
  S.state.redo(); ok(S.state.parameters.length === 1 && D(S, 'd1').expression === 'width', 'redo brings it back');

  // parameters can use parameters (R1): gap = width / 4 + 2 mm on d3
  typeInto(S, D(S, 'd3'), 'gap = width / 4 + 2 mm');
  near(D(S, 'd3').value, 120 / 4 + 2, 'gap = width / 4 + 2 mm');
  eq(S.state.parameters.map((p) => p.name), ['width', 'gap'], 'two parameters, gap uses width');
  eq(S.state.parameters[1].expression, 'width / 4 + 2 mm', 'stored with units');

  // a dimension that reads gap changes when width does (chains): d2 = gap * 2 -> the hint of width = 150 lists d1, d2 (through gap), d3
  typeInto(S, D(S, 'd2'), 'gap * 2');
  const hint = previewDimensionInput(S.state, D(S, 'd4'), 'width = 150');
  ok(hint.ok && hint.kind === 'set', 'existing name: a SET');
  eq(hint.others, ['d1', 'd2', 'd3'], 'the hint also lists dimensions that depend on width THROUGH another parameter');
  void d1; void d2; void d3; void d4;
}
// O4 in full: the hint before Enter, Enter, ONE undo
{
  const { S, d1, d2, d3, d4 } = drawing();
  typeInto(S, d1, 'width = 120');
  typeInto(S, d3, 'width');
  typeInto(S, d2, 'width / 2');                              // d2 reads width as well
  const h0 = S.state.history.length;
  const pv = previewDimensionInput(S.state, d4, 'width = 150');
  eq(pv.hint, 'sets width 120.0 -> 150.0 mm, also changes d1, d2, d3', 'O4 hint: ' + pv.hint);
  typeInto(S, d4, 'width = 150');
  for (const c of [d1, d3]) { near(c.value, 150, c.name + ' = 150'); near(measuredLen(S, c), 150, c.name + ' geometry'); }
  near(d2.value, 75, 'd2 = width / 2'); near(measuredLen(S, d2), 75, 'd2 geometry');
  ok(d4.expression === 'width' && Math.abs(d4.value - 150) < 1e-6, 'the typed dimension was rewired to width');
  eq(S.state.history.length, h0 + 1, 'Enter changed all of them in ONE undo step (all-or-nothing batch)');
  S.state.undo();
  near(D(S, 'd1').value, 120, 'one undo: d1 back'); near(D(S, 'd3').value, 120, 'one undo: d3 back'); near(D(S, 'd2').value, 60, 'one undo: d2 back');
  ok(D(S, 'd4').expression === undefined && Math.abs(D(S, 'd4').value - 30) < 1e-6, 'one undo: the typed dimension is back to its own number');
  eq(S.state.parameters, [{ name: 'width', unit: 'mm', expression: '120 mm' }], 'one undo: width = 120 again');
}

// ================================================================ 3. refusals: the hint says why; the box stays open; NOTHING changes (no undo step either)
{
  const { S, d1, d2, d3 } = drawing();
  typeInto(S, d1, 'width = 120');
  const cases = [
    ['gap', 'UNKNOWN_NAME', "unknown parameter 'gap' (type gap = 30 to create it)", 'O5: a bare unknown name'],
    ['width + gap', 'UNKNOWN_NAME', "unknown parameter 'gap' (type gap = 30 to create it)", 'O5 inside a formula'],
    ['30 deg', 'UNIT_MISMATCH', null, 'a length box cannot be an angle'],
    ['width +', 'SYNTAX', null, 'syntax error'],
    ['d3 = 5', 'RESERVED_NAME', null, 'a dimension name cannot be assigned'],
    ['mm = 3', 'RESERVED_NAME', null, 'a unit name cannot be assigned'],
    ['1 / 0', 'DIV_ZERO', null, 'division by zero'],
    ['width = d1', 'CYCLE', null, 'a loop (width -> d1 -> width)'],
    ['d3 * d3', 'UNIT_MISMATCH', null, 'a length times a length is an area, not a length'],
  ];
  const img = image(S.state), h = S.state.history.length;
  for (const [text, code, msg, what] of cases) {
    const target = text === 'width = d1' ? d2 : d2;
    const pv = previewDimensionInput(S.state, target, text);
    ok(!pv.ok && pv.code === code, `${what}: ${text} -> ${pv.code} (${pv.hint})`);
    if (msg) eq(pv.hint, msg, `${what}: the hint`);
    ok(typeof pv.hint === 'string' && pv.hint.length > 0, `${what}: there is a message`);
    const t = typeInto(S, target, text);
    ok(t.opened && t.stillOpen, `${what}: Enter keeps the box open`);
    eq(image(S.state), img, `${what}: nothing changed`); eq(S.state.history.length, h, `${what}: no undo step`);
    press('Escape');
  }
  // the position of a syntax error is data
  const e = previewDimensionInput(S.state, d2, '5 * * 3');
  ok(!e.ok && e.at && e.at.start === 4, 'errors carry their position');
  // an angle dimension refuses a length
  void d3;
}

// ================================================================ 4. a REFERENCE dimension and a DETERMINED one never open the box; a formula cannot read a reference (O9)
{
  const { S, d1, d2, A } = drawing();
  const diag = ConstraintManager.createConstraint(S.state, 'distance', { joints: [A.at(0, 0), A.at(100, 40)], value: Math.hypot(100, 40), dimMode: 'aligned', isDriven: true, driven: true }, { source: 'audit' });
  ok(diag, 'a reference dimension was made');
  const r = typeInto(S, diag, '50');
  ok(!r.opened, 'a reference dimension has no input box');
  const pv = previewDimensionInput(S.state, d1, diag.name);
  ok(!pv.ok && pv.code === 'REFERENCE_DIM', 'a formula cannot read a reference dimension: ' + pv.hint);
  ok(!completionsFor(S.state, 'd', 1) || !completionsFor(S.state, 'd', 1).items.some((i) => i.name === diag.name), 'the autocomplete never offers a reference dimension');
  // a dimension the other driving constraints already determine is placed driven and is never typed
  const dup = ConstraintManager.createConstraint(S.state, 'distance', { joints: [A.at(0, 0), A.at(100, 0)], value: 100, dimMode: 'horizontal' }, { source: 'audit' });
  if (dup) { const t = typeInto(S, dup, '30'); ok(!t.opened && (dup.isDriven || dup.driven), 'a determined dimension is a reference and never opens'); }
  void d2;
}

// ================================================================ 5. the fx label (and nothing else changes on the label)
{
  const { S, d1, d2 } = drawing();
  eq(formatConstraintValue(d1), '100.0', 'no formula: the label is unchanged');
  typeInto(S, d1, 'width = 120');
  eq(formatConstraintValue(d1), 'fx: 120.0', 'a formula: fx: 120.0');
  eq(formatConstraintValue(d1, { isPlacing: true }), '(120.0)', 'a dimension being placed shows no fx');
  eq(formatConstraintValue({ ...d1, isDriven: true }), '(120.0)', 'a reference never has a formula');
  eq(formatConstraintValue(d2), '40.0', 'a neighbour without a formula is unchanged');
  const ang = { type: 'angle', value: 45, expression: '90 deg / 2', name: 'dx', isDriven: false };
  eq(formatConstraintValue(ang), 'fx: 45.0°', 'an angle formula');
  eq(formatConstraintValue({ type: 'distance', isRadius: true, value: 12, expression: '6 mm * 2' }), 'fx: R 12.0', 'a radius formula');
}

// ================================================================ 7. toggleDriving (O11)
{
  const { S, d1, d2, d3 } = drawing();
  typeInto(S, d1, 'width = 120'); typeInto(S, d3, 'd1 / 2');
  // d1 is read by d3: refused, nothing changed
  const img = image(S.state);
  const r1 = toggleDriving(S.state, d1);
  ok(r1.refused && r1.nowDriving === true && r1.reason === 'd1 is used by d3', 'refused while another formula uses it: ' + r1.reason);
  eq(image(S.state), img, 'refusal changed nothing');
  // d3 is read by nobody: becomes a reference and its formula is cleared (its value stays what it was)
  const v = d3.value;
  const r2 = toggleDriving(S.state, d3);
  ok(!r2.refused && r2.nowDriving === false && (d3.isDriven || d3.driven), 'a formula dimension becomes a reference');
  ok(d3.expression === undefined, 'its formula is cleared (O11)'); near(d3.value, v, 'its value is the number it had');
  ok(d3.name === 'd3', 'a reference keeps its name');
}
{
  // a plain driving dimension read by a parameter's formula is refused too
  const { S, d1, d2 } = drawing();
  typeInto(S, d1, 'wide = d2 * 2');                           // the parameter wide reads d2 (and d1 follows wide)
  const r3 = toggleDriving(S.state, d2);
  ok(r3.refused && r3.reason === 'd2 is used by wide', 'a dimension read by a parameter cannot become a reference: ' + r3.reason);
}

// ================================================================ 8. fillet (O12): like Fusion, the line-length dimension KEEPS its formula and its value, measured to the sharp corner
{
  const { S, A, d1 } = drawing();
  typeInto(S, d1, 'width = 100');
  const edge = A.r.top, right = A.r.right; // d1 measures the y = 0 edge (the shape L.rect calls top): fillet ITS corner with the right edge
  const f = L.fillet(S, edge, right, 8);
  ok(S.state.shapes.some((s) => s.id === f.arc), 'the fillet was made');
  ok(d1.expression === 'width', 'the formula is still there after the fillet');
  near(d1.value, 100, 'the dimension keeps its value (the fillet does not shorten it)');
  ok(d1.joints.includes(f.V), 'its end is re-linked to the VIRTUAL SHARP corner: ' + JSON.stringify(d1.joints));
  S.engine.solve(L.ITER);
  near(measuredLen(S, d1), 100, 'measured to the sharp corner it is still 100');
  // and the formula still drives it
  typeInto(S, S.state.constraints.find((c) => c.name === 'd2'), 'width = 140');
  near(measuredLen(S, d1), 140, 'changing the parameter still moves the filleted rectangle');
}

// ================================================================ 9. R3 autocomplete: completionsFor is ONE pure function over the parser's name table
{
  const mkState = () => ({
    parameters: [
      { name: 'param1', unit: 'mm', expression: '10 mm' }, { name: 'param2', unit: 'mm', expression: '20 mm' }, { name: 'Width', unit: 'mm', expression: '120 mm' },
      { name: 'width', unit: 'mm', expression: '60 mm' }, { name: 'holes', unit: '', expression: '4' }, { name: 'turn', unit: 'deg', expression: '90 deg' },
    ],
    constraints: [
      { type: 'distance', joints: ['a', 'b'], value: 30, name: 'd1', isDriven: false, driven: false },
      { type: 'distance', joints: ['c', 'd'], value: 12, name: 'd2', isDriven: true, driven: true },   // a reference: never offered
      { type: 'angle', shapes: ['s1', 's2'], value: 45, name: 'd3', isDriven: false, driven: false },
    ],
  });
  const st = mkState();
  const names = (text, caret, o) => { const r = completionsFor(st, text, caret, o); return r ? r.items.map((i) => i.name) : null; };
  eq(names('pa', 2), ['param1', 'param2'], 'owner example: pa -> param1, param2');
  eq(names('par', 3)[0], 'param1', 'prefix');
  const wi = completionsFor(st, 'wi', 2);
  eq(wi.items.slice(0, 2).map((i) => i.name), ['Width', 'width'], 'wi: matching ignores case, both Width and width (table order)');
  eq(wi.items.map((i) => i.insert).slice(0, 2), ['Width', 'width'], 'the inserted name keeps its exact case');
  eq(wi.items[1], { kind: 'parameter', name: 'width', insert: 'width', value: '60.0', unit: 'mm', detail: '' }, 'a row: name, value, unit');
  eq(completionsFor(st, 'ho', 2).items[0], { kind: 'parameter', name: 'holes', insert: 'holes', value: '4', unit: '', detail: '' }, 'a unitless parameter has no unit');
  eq(completionsFor(st, 'tu', 2).items[0].value, '90.0', 'an angle parameter shows degrees');
  eq(names('d', 1).filter((n) => /^d[0-9]/.test(n)), ['d1', 'd3'], 'd: dimensions d1 and d3, the reference d2 is absent');
  ok(!names('d', 1).includes('d2'), 'a reference dimension is never offered');
  eq(completionsFor(st, 'd', 1).items.find((i) => i.name === 'd3').unit, 'deg', 'an angle dimension shows deg');
  // contains after prefix, parameters / dimensions before functions, functions last
  const s = completionsFor(st, 'a', 1);
  const kinds = s.items.map((i) => i.kind);
  ok(kinds.indexOf('function') === -1 || kinds.slice(kinds.indexOf('function')).every((k) => k === 'function'), 'functions come after every name: ' + kinds.join());
  const startsFirst = completionsFor(st, 'ar', 2);
  ok(startsFirst && startsFirst.items[0].name === 'param1', 'a name that merely CONTAINS the letters is offered: ' + JSON.stringify(startsFirst && startsFirst.items.map((i) => i.name)));
  eq(completionsFor(st, 'sq', 2).items[0], { kind: 'function', name: 'sqrt', insert: 'sqrt(', value: '', unit: '', detail: 'sqrt(x)' }, 'a function row inserts name(');
  eq(completionsFor(st, 'ma', 2).items.map((i) => i.name), ['max'], 'functions come from the parser table');
  for (const f of functionTable()) ok(completionsFor(st, f.name.slice(0, 2), 2).items.some((i) => i.name === f.name), 'every parser function is reachable: ' + f.name);
  // at most MAX_COMPLETIONS rows
  const big = { parameters: Array.from({ length: 30 }, (_, i) => ({ name: `p${String(i).padStart(2, '0')}`, unit: 'mm', expression: '1 mm' })), constraints: [] };
  eq(completionsFor(big, 'p', 1).items.length, MAX_COMPLETIONS, 'at most ' + MAX_COMPLETIONS + ' rows');
  // the caret decides: inside the identifier, after an operator, with text after the caret
  eq(names('width + pa', 10), ['param1', 'param2'], 'after an operator');
  eq(names('width / 2 + par', 14)[0], 'param1', 'the identifier ends at the caret');
  eq(completionsFor(st, 'width + pa', 10).from, 8, 'from..to is the identifier before the caret');
  eq(names('max(pa; 3)', 6), ['param1', 'param2'], 'after "(" ');
  eq(completionsFor(st, '12', 2), null, 'digits start no identifier');
  eq(completionsFor(st, '5pa', 3), null, 'an identifier cannot start with a digit');
  eq(completionsFor(st, '', 0), null, 'nothing typed, nothing offered'); eq(completionsFor(st, 'xyz', 3), null, 'no match, no list');
  ok(!completionsFor(st, 'width', 5) || !completionsFor(st, 'width', 5).items.some((i) => i.name === 'width'), 'the exact name typed is not offered back');
  eq(names('pa', 2, { exclude: ['param1'] }), ['param2'], 'the dimension being edited can be excluded');
  // left of `=`: only user parameters can be assigned
  eq(names('pa = 5', 2), ['param1', 'param2'], 'left of =: parameters');
  ok(completionsFor(st, 'd = 5', 1).items.every((i) => i.kind === 'parameter'), 'left of =: dimensions and functions are not offered');
}

// ================================================================ 10. the seam: applyParameterChange without its own snapshot (the first value of a just-placed dimension)
{
  const { S, d1 } = drawing();
  const plan = previewDimensionInput(S.state, d1, 'width = 90').plan;
  const h0 = S.state.history.length;
  const r = applyParameterChange(S.state, plan, 'x', { snapshot: false });
  ok(r.ok && S.state.history.length === h0, 'snapshot:false takes no undo step (the caller holds the birth snapshot)');
  near(d1.value, 90, 'and still applies');
  const imp = previewDimensionInput(S.state, d1, 'width = 0.00001').plan;
  const img = image(S.state);
  const r2 = applyParameterChange(S.state, imp, 'x', { snapshot: false });
  ok(r2.ok === false && r2.reverted && image(S.state) === img && S.state.history.length === h0, 'a refusal with snapshot:false restores everything and drops nothing');
}

// ================================================================ 11. an impossible typed formula: the box closes, a notice names the reason, everything is as before
{
  const { S, A, d1, d2 } = drawing();
  // a triangle makes an impossible edit possible
  const img = image(S.state), h = S.state.history.length;
  toasts.length = 0;
  typeInto(S, d2, '0.0000001');   // the seam's own rules for a tiny value decide; whatever it says, a refusal must restore and notify
  if (image(S.state) === img) ok(toasts.length > 0 && S.state.history.length === h, 'a refused edit notifies and leaves no undo step');
  void A; void d1;
}

// ================================================================ 6. save -> load -> the same labels, formulas and parameters; undo / redo
{
  const { S, d1, d3 } = drawing();
  typeInto(S, d1, 'width = 120'); typeInto(S, d3, 'width / 2');
  const doc = serializeDocument(S.state);
  const json = JSON.stringify(doc);
  const S2 = L.newSketch();
  deserializeDocument(JSON.parse(json), S2.state);
  const dims = S2.state.constraints.filter((c) => c.type === 'distance' && c.name);
  const f = dims.find((c) => c.name === 'd1'), g = dims.find((c) => c.name === 'd3');
  ok(f.expression === 'width' && g.expression === 'width / 2', 'formulas survive save and load');
  eq(S2.state.parameters, [{ name: 'width', unit: 'mm', expression: '120 mm' }], 'the parameter survives');
  eq(formatConstraintValue(f), 'fx: 120.0', 'the loaded label'); eq(formatConstraintValue(g), 'fx: 60.0', 'the loaded second label');
  const json2 = JSON.stringify(serializeDocument(S2.state));
  deserializeDocument(JSON.parse(json2), S2.state);
  eq(JSON.stringify(serializeDocument(S2.state)), json2, 'save -> load -> save is byte-stable (from the first save on)');
  const d = (j) => JSON.stringify(JSON.parse(j), sortKeys);
  eq(d(json2), d(json), 'a saved and reloaded drawing is the same drawing (key order aside)');
}


console.log(`parameters-canvas: ${checks} checks passed`);
process.exit(0);
