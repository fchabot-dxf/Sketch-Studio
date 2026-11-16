// tests/pattern-params-694-node.test.js - TASK 694: the pattern DIALOG's value boxes take what a dimension box takes (a number, a formula, a
// parameter name, `name = value`), through the dimension box's own path, in the real app (tests/helpers/node-app.js: the page's own modules,
// ribbon, input-manager, renderer, history), Pen Plotter:
//   rectangular (live at once from a pre-selected line): Distance 1 = `pitch` (a user parameter) -> the copies at pitch, the box shows `pitch`;
//   Quantity 1 = `n`; `n / 2` (2.5) refused with THE pattern rule's message (the box marked, Enter warns, nothing changes); Ctrl+Z in a box
//   restores its opening text (675 C) and applies it; `gap = 12` names the value; OK = ONE undo step; the canvas label shows `fx: `; a double
//   click on the label opens the dialog with the formula in its box; changing pitch (the + Add row's commit path) moves the pattern.
//   circular: the Angle box typed BEFORE the centre is picked (`turn`, -90 deg) -> after the centre pick the pattern reads turn (clockwise).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { labelEl, labelBoxCenter } from './helpers/node-dom-read.js';
import { planChange } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const profile = await createProfile();
await createNamedDesign(profile, 'penplotter', 'Pattern 694');
const app = await open({ host: 'penplotter', profile });
try {
  const st = app.state, doc = app.document;
  const r = app.svg.getBoundingClientRect();
  const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const at = (dx, dy) => ({ x: C.x + dx, y: C.y + dy });
  const click = (p, o) => app.click(p.x, p.y, o);
  const dialog = () => doc.querySelector('.sk-pattern-dialog:not([hidden])');
  const field = (name) => doc.querySelector(`.sk-pattern-dialog [data-field="${name}"]`);
  const typeIn = (name, text) => { const f = field(name); f.focus(); f.select(); app.type(text); app.frames(); };
  const pats = () => st.constraints.filter((c) => /Pattern$/.test(c.type));
  const toasts = () => (doc.getElementById('notification-container') || { textContent: '' }).textContent;
  const addParam = (name, unit, text) => { const plan = planChange(st, { type: 'createParameter', name, unit, text }); ok(plan.ok && applyParameterChange(st, plan, `create parameter ${name}`).ok, `+ Add ${name} = ${text}`); };
  const setParam = (name, text) => { const plan = planChange(st, { type: 'setParameter', name, text }); return plan.ok ? applyParameterChange(st, plan, `change parameter ${name}`) : plan; };
  const P = (id) => st.joints.get(id);

  app.tool('line'); click(at(-200, 0)); click(at(-120, 0)); app.esc();
  app.tool('select');
  const line = st.shapes.find((s) => s.type === 'line');
  addParam('pitch', 'mm', '25');
  addParam('n', '', '4');
  st.selectedShapes.clear(); st.selectedShapes.add(line.id);
  const h0 = st.history.length;
  app.tool('rectangularPattern');
  const q = pats()[0];
  ok(q && q.names && q.names.distance1 === 'd3', `live at once, its values named (${JSON.stringify(q && q.names)})`);
  field('Distribution').value = 'spacing'; field('Distribution').dispatchEvent(new app.window.Event('change', { bubbles: true })); app.frames();
  const open1 = field('Distance 1').value;
  typeIn('Distance 1', 'pitch');
  ok(q.distance[0] === 25 && q.expressions && q.expressions.distance1 === 'pitch' && field('Distance 1').getAttribute('aria-invalid') === 'false', `Distance 1 = pitch -> 25, the formula stored (${q.distance[0]} ${JSON.stringify(q.expressions)})`);
  const copy = () => st.shapes.find((s) => s.id === q.instances[0].shapes[0]);
  ok(Math.abs(P(copy().joints[0]).x - P(line.joints[0]).x - 25) < 1e-6, 'the copy sits 25 mm along');
  field('Distance 1').blur(); app.frames();
  ok(field('Distance 1').value === 'pitch', `the box shows the formula after leaving it (${field('Distance 1').value})`);
  typeIn('Quantity 1', 'n');
  ok(q.quantity[0] === 4 && q.instances.length === 3 && q.expressions.quantity1 === 'n', `Quantity 1 = n = 4 (${q.quantity})`);
  typeIn('Quantity 1', 'n / 2');
  ok(field('Quantity 1').getAttribute('aria-invalid') === 'false' && q.quantity[0] === 2, `n / 2 = 2 is a whole number (${q.quantity})`);
  typeIn('Quantity 1', 'n / 8');
  // typed key by key: 'n' already applied 4 (the live preview), 'n / 8' = 0.5 is refused and the pattern keeps that last valid value
  ok(field('Quantity 1').getAttribute('aria-invalid') === 'true' && q.quantity[0] === 4, `n / 8 (0.5) refused: marked, the pattern keeps 4 (${q.quantity})`);
  app.enter();
  ok(dialog() && /quantity 1 must be a whole number of 1 or more/.test(toasts()), `Enter on it: THE rule's message, the dialog stays (${toasts()})`);
  typeIn('Quantity 1', 'n');
  // Ctrl+Z in a box: its opening text, applied (675 C)
  const d1 = field('Distance 1'); d1.focus(); d1.select(); app.type('40'); app.frames();
  ok(q.distance[0] === 40 && !(q.expressions && q.expressions.distance1), 'a number replaces the formula');
  app.undo(); app.frames();
  ok(d1.value === open1 && q.distance[0] === 10 && dialog() && pats().length === 1, `Ctrl+Z in the box: its opening text '${open1}', the distance 10 again, the dialog stays (${d1.value} ${q.distance[0]})`);
  typeIn('Distance 1', 'pitch');
  typeIn('Distance 2', 'gap = 12');
  ok(q.names.distance2 === 'gap' && q.distance[1] === 12, `'gap = 12' names distance 2 (${JSON.stringify(q.names)})`);
  doc.querySelector('.sk-pattern-dialog .sk-pat-ok').click(); app.frames();
  ok(!dialog() && st.history.length === h0 + 1, 'OK: ONE undo step for the whole session');
  // the label: fx when a value it shows is a formula
  const iq = st.constraints.indexOf(q);
  const lab = labelEl(app, iq);
  ok(lab && /^fx: 4 × 25/.test(lab.textContent.trim()), `the canvas label marks the formula (${lab && lab.textContent.trim()})`);
  // a parameter change moves the pattern (the + Add row's commit path, applyParameterChange)
  ok(setParam('pitch', '30').ok && q.distance[0] === 30 && Math.abs(P(copy().joints[0]).x - P(line.joints[0]).x - 30) < 1e-6, `pitch = 30 moves the copies (${q.distance[0]})`);
  ok(!setParam('n', '2.5').ok && q.quantity[0] === 4, 'n = 2.5 is refused, the pattern keeps 4');
  // a double click on the label: the dialog shows the formulas
  await app.pause(550);
  const cc = labelBoxCenter(app, lab);
  app.dblclick(cc.x, cc.y, { target: () => labelEl(app, iq) });
  ok(dialog() && field('Distance 1').value === 'pitch' && field('Quantity 1').value === 'n' && field('Distance 2').value === '12mm', `the dialog on the stored pattern shows its formulas (${field('Distance 1').value} / ${field('Quantity 1').value} / ${field('Distance 2').value})`);
  app.esc(); app.frames();
  ok(!dialog() && q.distance[0] === 30, 'Esc: nothing changed');

  // ---- circular: a formula typed before the centre is picked
  app.tool('select');
  addParam('turn', 'deg', '-90');
  const line2 = st.shapes.find((s) => s.type === 'line' && s.id === line.id);
  st.selectedShapes.clear(); st.selectedShapes.add(line2.id);
  app.tool('circularPattern');
  ok(st.pattern.step === 'centre', 'circular: the pre-selected line, the centre step');
  field('Distribution').value = 'angle'; field('Distribution').dispatchEvent(new app.window.Event('change', { bubbles: true })); app.frames();
  typeIn('Angle', 'turn');
  ok(field('Angle').getAttribute('aria-invalid') === 'false' && pats().length === 1, 'the Angle box takes `turn` before the pattern exists');
  click(at(-120, 0));
  const k = pats().find((c) => c.type === 'circularPattern');
  ok(k && k.angle === -90 && k.expressions && k.expressions.angle === 'turn', `after the centre pick the angle reads turn = -90 (${k && k.angle} ${JSON.stringify(k && k.expressions)})`);
  ok(field('Angle').value === 'turn', `the box shows it (${field('Angle').value})`);
  doc.querySelector('.sk-pattern-dialog .sk-pat-ok').click(); app.frames();
  ok(!dialog(), 'OK');
} finally { await app.close(); }
console.log(`pattern-params-694-node: ${checks} checks passed`);
