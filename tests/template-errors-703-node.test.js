// tests/template-errors-703-node.test.js -- TASK 703: a template's start view says in plain words WHICH value can't be drawn and what range works.
//   1. every refusal a template declares (#core/templates.js `limits`) is a TemplateRefusal carrying its plain message AND the param it concerns
//   2. the number a message gives works: the value just inside it is not refused for that param (the range said is the range that works)
//   3. the start view (Shaper's sidebar picker): the error line shows that message, the param's field is marked aria-invalid, Open is disabled and the
//      last good preview stays; changing a value clears both; a value set that no limit foresaw (a bug) shows ONE generic line and logs the technical
//      text through dbg; the picker never reads an exception's text for its line
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile } from './helpers/node-app.js';
import { TEMPLATES, TemplateRefusal, buildTemplate, templateById } from '#core/templates.js';
import { GENERIC_REFUSAL } from '#ui/template-picker.js';
import { setDebugSink } from '#core/debug.js';

const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };
const refusalOf = (id, values) => { try { muted(() => buildTemplate(templateById(id), values)); } catch (e) { return e; } return null; };
let checks = 0;

// ---- 1. each declared refusal: its message and its param (the limit stated is the one computed from the OTHER values)
const CASES = [
  ['slot', { width: 40 }, 'width', 'Width is too big for this length: use less than 40 mm.'],
  ['rounded-rectangle', { radius: 20 }, 'radius', 'Corner radius is too big for this width and height: use less than 20 mm.'],
  ['keyhole', { neck: 20 }, 'neck', 'Neck width is too big for this head radius: use less than 20 mm.'],
  ['l-bracket', { thickness: 50 }, 'thickness', 'Thickness is too big for this width and height: use less than 50 mm.'],
  ['box-frame', { thickness: 300 }, 'thickness', 'Plywood thickness is too big for this width: use less than 200 mm.'],
  ['box-frame', { length: 100 }, 'thickness', 'Plywood thickness is too big for this length and 5 compartments: use less than 16.66 mm.'],
  ['right-angle-corner', { thickness: 200 }, 'thickness', 'Board thickness is too big for these lengths: use less than 200 mm.'],
  ['right-angle-brace', { thickD: 250 }, 'thickD', 'Diagonal board thickness is too big for this width and height: use less than 217.34 mm.'],
  ['right-angle-brace', { thickV: 350 }, 'thickV', 'Vertical board thickness is too big for this width and height: use less than 238.51 mm.'],
  ['right-angle-brace', { width: 20, height: 40, thickV: 38, thickH: 38, thickD: 38 }, 'thickD', 'Diagonal board thickness is too big: the boards leave no opening, so make the frame bigger or the boards thinner.'],
  ['curved-bench-seat', { outerRadius: 450 }, 'outerRadius', 'Outer radius is too small for this inner radius: use more than 450 mm.'],
  ['curved-bench-seat', { innerRadius: 5 }, 'innerRadius', 'Inner radius is too small for this gap: use more than 5 mm.'],
  ['parallelogram-frame', { angle: 190 }, 'angle', 'Angle is too big: use less than 180 deg.'],
  ['triangle-frame', { base: 1000 }, 'base', 'Base is too long for the other two sides: use less than 900 mm.'],
  ['triangle-frame', { leftSide: 1000 }, 'leftSide', 'Left side is too long for the other two sides: use less than 1000 mm.'],
  ['triangle-frame', { rightSide: 2000 }, 'rightSide', 'Right side is too long for the other two sides: use less than 1100 mm.'],
  ['slot', { width: -3 }, 'width', 'Width must be a number more than 0'],
];
const results = CASES.map(([id, values]) => refusalOf(id, values));
CASES.forEach(([id, values, param, message], i) => {
  const e = results[i];
  assert(e instanceof TemplateRefusal, `${id} ${JSON.stringify(values)}: a TemplateRefusal (got ${e && e.constructor.name}: ${e && e.message})`);
  assert.strictEqual(e.param, param, `${id} ${JSON.stringify(values)}: the param it concerns`);
  assert.strictEqual(e.message, message, `${id} ${JSON.stringify(values)}: its plain message`);
  checks += 3;
});

// ---- 2. the range said works: a number just inside the stated limit is not refused for that param
for (const [id, values, param, message] of CASES) {
  const m = /use (less|more) than ([\d.]+)/.exec(message);
  if (!m) continue;
  const inside = Number(m[2]) + (m[1] === 'less' ? -0.01 : 0.01);
  const e = refusalOf(id, { ...values, [param]: inside });
  assert(!(e instanceof TemplateRefusal && e.param === param), `${id}: ${param} = ${inside} (just inside "${message}") is not refused for ${param}: ${e && e.message}`);
  checks++;
}

// limits are declared with their template
for (const t of TEMPLATES) assert.ok(t.limits === undefined || typeof t.limits === 'function', `${t.id}: limits is a function`);
checks++;

// ---- 3. the start view
const profile = await createProfile();
const app = await open({ host: 'shaper', profile, sidebar: true });
const logged = [];
setDebugSink((entry) => logged.push(entry));
try {
  const doc = app.document;
  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => [...doc.querySelectorAll(sel)];
  const pressEl = (sel) => { const e = typeof sel === 'string' ? q(sel) : sel; assert(e, sel + ' not found'); app.press(e); };
  const settle = (ms = 120) => app.pause(ms);
  const startOf = async (id) => { pressEl('.sk-sidebar-btn'); await settle(); pressEl('[data-action="templates"]'); await settle(); pressEl(`.sk-tp-card[data-template="${id}"]`); await settle(); assert(q(`.sk-tp-start[data-template="${id}"]`), `${id}: the start view`); };
  const typeInto = (param, text) => { const i = q(`.sk-tp-field[data-param="${param}"] input`); i.focus(); i.value = ''; app.type(text); return i; };
  const leave = async () => { pressEl('.sk-tp-cancel'); await settle(); pressEl('.sk-tp-x'); await settle(); };
  const marked = () => qa('.sk-tp-input[aria-invalid="true"]').map((i) => i.closest('.sk-tp-field').dataset.param);

  for (const [id, param, text, fixed, message] of [
    ['right-angle-brace', 'thickD', '250', '38', 'Diagonal board thickness is too big for this width and height: use less than 217.34 mm.'],
    ['box-frame', 'thickness', '300', '18', 'Plywood thickness is too big for this width: use less than 200 mm.'],
    ['triangle-frame', 'base', '1000', '600', 'Base is too long for the other two sides: use less than 900 mm.'],
    ['slot', 'width', '50', '10', 'Width is too big for this length: use less than 40 mm.'],
  ]) {
    await startOf(id);
    const before = q('.sk-tp-start .sk-tp-prev svg');
    typeInto(param, text); await settle(400);
    assert.strictEqual(q('.sk-tp-err').textContent, message, `${id}: the error line says which value and what works`);
    assert.deepStrictEqual(marked(), [param], `${id}: the field of the value is marked aria-invalid`);
    assert.ok(q('.sk-tp-open').disabled, `${id}: Open disabled`);
    assert.ok(before && q('.sk-tp-start .sk-tp-prev svg') === before, `${id}: the last good preview stays`);
    typeInto(param, fixed); await settle(400);
    assert.strictEqual(q('.sk-tp-err').textContent, '', `${id}: a change clears the line`);
    assert.deepStrictEqual(marked(), [], `${id}: a change clears the mark`);
    assert.ok(!q('.sk-tp-open').disabled, `${id}: Open enabled again`);
    await leave();
    checks += 7;
  }

  // a refusal blamed on ANOTHER field than the one edited: the mark clears on any change (the box frame's thickness, fixed by the width)
  await startOf('box-frame');
  typeInto('thickness', '240'); await settle(400);
  assert.deepStrictEqual(marked(), ['thickness']);
  typeInto('width', '700'); await settle(400);
  assert.strictEqual(q('.sk-tp-err').textContent, '', 'the width fixed it: no line');
  assert.deepStrictEqual(marked(), [], 'and no mark left on the thickness');
  await leave();
  checks += 3;

  // an unexpected error (no limit foresaw it): ONE generic line, the technical text logged through dbg (the parallelogram at 89 degrees: the Dimension
  // tool reads its side as upright)
  await startOf('parallelogram-frame');
  logged.length = 0;
  typeInto('angle', '89'); await settle(400);
  assert.strictEqual(q('.sk-tp-err').textContent, GENERIC_REFUSAL, 'a bug: the one generic line');
  assert.strictEqual(GENERIC_REFUSAL, "These values can't be drawn. Try other values.");
  assert.deepStrictEqual(marked(), [], 'no field is blamed');
  assert.ok(q('.sk-tp-open').disabled, 'Open disabled');
  const log = logged.find((l) => l.category === 'template-picker' && l.level === 'error');
  assert.ok(log && /parallelogram-frame/.test(log.args[0]) && /label point made a vertical dimension/.test(log.args[0]), 'the technical text is logged: ' + (log && log.args[0]));
  await leave();
  checks += 6;
} finally { setDebugSink(null); await app.close(); }

// the picker shows a message only from a TemplateRefusal (never an exception it has to read the text of)
const src = fs.readFileSync(new URL('../packages/ui/template-picker.js', import.meta.url), 'utf8');
assert.strictEqual(src.match(/e\.message/g).length, 2, 'e.message: the refusal line, the log line, nothing else');
assert.ok(/if \(e instanceof TemplateRefusal\) \{\s*err\.textContent = e\.message;/.test(src), 'the line takes a message only from a TemplateRefusal');
checks++;
console.log(`template-errors-703-node: ok (${checks} checks)`);
