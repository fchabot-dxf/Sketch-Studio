// tests/parameters-canvas-node.test.js — TASK 580 (node port of parts A and C of tests/parameters-canvas-live.test.js, TASK 535 slice 3), through
// tests/helpers/node-app.js: formulas typed into a dimension's box, in the REAL apps.
//  A. SketchStudio: `width = 6` creates a parameter and the label reads "fx: 6.0"; a second dimension typed `width` follows it; the O4 hint lists
//     the other dimension BEFORE Enter; Enter changes both in ONE undo step; an unknown name is refused with the O5 hint and the box stays open; the
//     autocomplete list (rows with value and unit, Down + Enter, Esc, a mouse click); the box is a TEXT input; plain numbers still work and drop the
//     formula; the labels survive a reload (close + open on the profile).
//  C. Shaper: the same box (the shared code), a formula and `name = value` on a seeded drawing, the fx label, the stored parameters.
// Part B (the 390 px phone layout: the box / hint / list fit the screen) stays in the browser: tests/parameters-canvas-live.test.js. The screenshots
// (evidence, no assert) are not taken. The text is typed with the kit's type() (keydown, value, input event per character).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { boxOpen, findLabel, labelEl } from './helpers/node-dom-read.js';
import SettingsManager from '#core/settings-manager.js';

const labels = (app) => [...app.svg.querySelectorAll('.dim-label')].map((g) => g.textContent.trim().replace(/\s+/g, ' '));
const box = (app) => {
  const d = app.document, i = d.getElementById('dimInput'), h = d.getElementById('dimHint'), c = d.getElementById('dimComplete');
  return { open: !i.classList.contains('hidden'), value: i.value, type: i.type, inputmode: i.inputMode, hint: h && !h.classList.contains('hidden') ? h.textContent : null, hintErr: !!(h && h.classList.contains('err')),
    invalid: i.getAttribute('aria-invalid'),
    list: c && !c.classList.contains('hidden') ? [...c.querySelectorAll('li')].map((li) => ({ name: li.querySelector('.dc-name').textContent, val: li.querySelector('.dc-val').textContent, sel: li.getAttribute('aria-selected') })) : null,
    active: d.activeElement && d.activeElement.id };
};
// the box opened and took the focus (its requestAnimationFrame), then select all as the browser test did
const boxReady = async (app) => { await app.waitFor(() => boxOpen(app) && app.document.activeElement && app.document.activeElement.id === 'dimInput', 'the dimension box to open and take the focus'); app.document.getElementById('dimInput').select(); };
const reopen = async (app, re) => { // two quick clicks on the label of the dimension whose text matches (Select tool)
  const lab = findLabel(app, (t) => re.test(t)); assert(lab, 'a label matching ' + re + ' is on the canvas: ' + JSON.stringify(labels(app)));
  await app.pause(550); // a person's pause between two double clicks on the same label (the app pairs clicks within 500 ms)
  app.dblclick(lab.x, lab.y, { target: () => labelEl(app, lab.idx) }); await boxReady(app);
};

// ================================================================== A. SketchStudio
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'Formulas'); // TASK 558: only a NAMED design autosaves (part A reloads and expects the drawing back)
  let app = await open({ host: 'sketchstudio', profile });
  try {
    assert.strictEqual(app.document.getElementById('dimInput').type, 'text', '#dimInput is a TEXT input (it was type=number, which cannot hold a name or an "=")');
    const r = app.svg.getBoundingClientRect();
    const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    const click = (p) => app.click(p.x, p.y);
    const A = { x: cv.x - 300, y: cv.y + 20 }, B = { x: cv.x + 108, y: cv.y + 20 };
    const C = { x: cv.x - 300, y: cv.y + 160 }, D = { x: cv.x - 28, y: cv.y + 160 };
    app.tool('line'); click(A); click(B); app.esc();
    app.tool('line'); click(C); click(D); app.esc();
    const dimension = async (P, Q, up) => {
      app.tool('select'); app.tool('dim');
      click(P); click(Q);
      const m = { x: (P.x + Q.x) / 2, y: P.y - up }; app.move(m.x, m.y); click(m);
      await boxReady(app);
    };
    await dimension(A, B, 60);
    let b = box(app);
    assert.strictEqual(b.type, 'text'); assert.strictEqual(b.inputmode, 'text', 'the dimension box asks for the full text keyboard (O16)');
    // typing `width = 6`: the hint says what Enter will do BEFORE Enter
    app.type('width = 6');
    b = box(app);
    assert.strictEqual(b.hint, 'creates width = 6.0 mm', 'the live hint before Enter: ' + b.hint);
    assert.strictEqual(b.hintErr, false);
    app.enter();
    assert.strictEqual(box(app).open, false, 'Enter closes the box');
    let lab = labels(app);
    assert(lab.some((t) => /^fx: 6\.0$/.test(t)), 'the label reads "fx: 6.0": ' + JSON.stringify(lab));
    // dimension 2, typed as a formula on the new parameter. While it is being typed the autocomplete offers `width`
    await dimension(C, D, 60);
    app.type('wi');
    b = box(app);
    assert.deepStrictEqual(b.list.map((x) => [x.name, x.val]), [['width', '6.0 mm']], 'autocomplete after "wi": the parameter with its value and unit: ' + JSON.stringify(b.list));
    assert.strictEqual(b.list[0].sel, 'false', 'no row is picked until Down is pressed (so a plain Enter still commits)');
    app.key('ArrowDown');
    assert.strictEqual(box(app).list[0].sel, 'true', 'Down picks the first row');
    app.enter();
    b = box(app);
    assert.strictEqual(b.value, 'width', 'Enter inserts the picked name');
    assert.strictEqual(b.list, null, 'the list closes after an insert');
    assert.strictEqual(b.open, true, 'and Enter did NOT commit the dimension');
    assert.strictEqual(b.hint, '= 6.0 mm', 'the hint is the value preview: ' + b.hint);
    app.type(' / 2 + pa'); // nothing named pa: no list
    assert.strictEqual(box(app).list, null, 'no match, no list');
    app.type('\b\b');
    app.type('i'); // "+ i": contains-matches: names with an i in them (width), functions after
    b = box(app);
    assert(b.list && b.list.length >= 1 && b.list.length <= 8, 'rows: ' + JSON.stringify(b.list));
    assert(b.list.some((x) => x.name === 'width'), 'contains matching offers width for "i"');
    app.esc();
    b = box(app);
    assert.strictEqual(b.list, null, 'Esc closes the list'); assert.strictEqual(b.open, true, "and leaves the box open (a second Esc is the box's own)");
    app.type('\b\b\b\b');
    b = box(app); assert.strictEqual(b.value, 'width / 2', 'edited back: ' + JSON.stringify(b.value));
    app.type(' + 1');
    app.enter();
    lab = labels(app);
    assert(lab.filter((t) => /^fx: /.test(t)).length === 2, 'both dimensions carry the fx mark: ' + JSON.stringify(lab));
    assert(lab.includes('fx: 4.0'), 'width / 2 + 1 mm = 4.0 (a unitless 1 takes the document unit): ' + JSON.stringify(lab));
    // reopen d1 with two quick clicks on its label (Select tool): the box opens with the FORMULA, not the value
    app.tool('select');
    await reopen(app, /6\.0/);
    b = box(app);
    assert.strictEqual(b.value, 'width', "the box opens with the dimension's FORMULA");
    // O4: typing `width = 8` lists what else changes, BEFORE Enter
    app.type('width = 8');
    b = box(app);
    assert.strictEqual(b.hint, 'sets width 6.0 -> 8.0 mm, also changes d2', 'the O4 hint: ' + b.hint);
    app.enter();
    lab = labels(app);
    assert(lab.includes('fx: 8.0') && lab.includes('fx: 5.0'), 'Enter changed both dimensions: ' + JSON.stringify(lab));
    // ONE undo restores both
    app.undo();
    lab = labels(app);
    assert(lab.includes('fx: 6.0') && lab.includes('fx: 4.0') && !lab.some((t) => /8\.0|5\.0/.test(t)), 'one Ctrl+Z changed both back: ' + JSON.stringify(lab));
    app.redo();
    lab = labels(app);
    assert(lab.includes('fx: 8.0') && lab.includes('fx: 5.0'), 'redo: ' + JSON.stringify(lab));
    // O5: a bare unknown name is refused with the hint; the box stays open; nothing changes
    await reopen(app, /8\.0/);
    app.type('gap');
    b = box(app);
    assert.strictEqual(b.hint, "unknown parameter 'gap' (type gap = 30 to create it)", 'the O5 hint: ' + b.hint);
    assert.strictEqual(b.hintErr, true, 'shown as an error'); assert.strictEqual(b.invalid, 'true', 'aria-invalid');
    app.enter();
    b = box(app);
    assert.strictEqual(b.open, true, 'Enter on a refused text keeps the box open (and the text)'); assert.strictEqual(b.value, 'gap');
    lab = labels(app);
    assert(lab.includes('fx: 5.0'), 'nothing changed (the edited label is hidden while its box is open): ' + JSON.stringify(lab));
    // a unit mismatch and a loop are refused too
    app.document.getElementById('dimInput').select();
    app.type('30 deg'); b = box(app);
    assert.strictEqual(b.hintErr, true, 'a length cannot be an angle: ' + b.hint);
    app.document.getElementById('dimInput').select();
    app.type('width = d1'); b = box(app);
    assert(/d1|width/.test(b.hint) && b.hintErr, 'a loop is refused with its path: ' + b.hint);
    // the mouse: click a row of the list to insert it
    app.document.getElementById('dimInput').select();
    app.type('wi');
    const row = app.document.querySelector('#dimComplete li');
    assert(row, 'the list row is there');
    app.press(row);
    b = box(app);
    assert.strictEqual(b.value, 'width', 'a mouse click on a row inserts it (the box keeps focus: ' + b.active + ')'); assert.strictEqual(b.active, 'dimInput');
    // a plain number replaces the formula (the fx mark goes)
    app.document.getElementById('dimInput').select();
    app.type('3mm'); // a unit suffix, which a type=number box could not hold
    app.enter();
    lab = labels(app);
    assert(lab.includes('3.0') && !lab.some((t) => /^fx: 8/.test(t)), 'a plain number replaces the formula and drops the fx mark: ' + JSON.stringify(lab));
    // d2 still follows the parameter (d1 was detached from width, which stays 8)
    assert(lab.includes('fx: 5.0'), 'the other dimension still follows width: ' + JSON.stringify(lab));
    // after a reload the formulas are still there (autosave): the fx label comes back
    await app.storedDoc(); await app.close();
    app = await open({ host: 'sketchstudio', profile });
    lab = labels(app);
    assert(lab.includes('fx: 5.0') && lab.includes('3.0'), 'after a reload the labels are the same: ' + JSON.stringify(lab));
  } finally { await app.close(); }
}

// ================================================================== C. Shaper (the same shared box)
{
  const app = await open({ host: 'shaper' });
  try {
    const st = app.state;
    st.clearDocument();
    const J = (id, x, y) => st.joints.set(id, { x, y });
    J('a', -45, -20); J('b', -5, -20); J('c', -45, 10); J('d', -5, 10);
    st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] });
    st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 40, name: 'd1', dimMode: 'aligned', glyphPos: { x: -25, y: -35 }, offset: 15 });
    st.constraints.push({ type: 'distance', joints: ['c', 'd'], value: 40, name: 'd2', dimMode: 'aligned', glyphPos: { x: -25, y: 25 }, offset: 15 });
    app.tool('select'); app.frames(3);
    const shaperUnit = SettingsManager.get('DOC_UNIT') || 'mm';
    const inU = (mm) => (mm / (shaperUnit === 'in' ? 25.4 : 1)).toFixed(1);
    const re40 = new RegExp(inU(40).replace('.', '\\.'));
    await reopen(app, re40);
    let b = box(app);
    assert.strictEqual(b.type, 'text', 'Shaper: the box is a text input'); assert.strictEqual(b.inputmode, 'text');
    app.type('stock = 30 mm');
    b = box(app);
    assert.strictEqual(b.hint, `creates stock = ${inU(30)} ${shaperUnit}`, 'Shaper: the live hint (a stored unit is shown in the document unit): ' + b.hint);
    app.enter();
    const shLabs = labels(app);
    assert(shLabs.includes(`fx: ${inU(30)}`), 'Shaper: the fx label: ' + JSON.stringify(shLabs));
    // the second dimension uses the parameter in a formula
    await reopen(app, re40);
    app.type('sto');
    b = box(app);
    assert.strictEqual(b.list && b.list[0].name, 'stock', 'Shaper: the autocomplete offers the new parameter: ' + JSON.stringify(b.list));
    app.key('Tab');
    assert.strictEqual(box(app).value, 'stock', 'Tab inserts the first row');
    app.type(' * 2');
    app.enter();
    const shLabs2 = labels(app);
    assert(shLabs2.includes(`fx: ${inU(60)}`) && shLabs2.includes(`fx: ${inU(30)}`), 'Shaper: both formulas show: ' + JSON.stringify(shLabs2));
    const ss = JSON.parse(JSON.stringify({ p: st.parameters, d: st.constraints.map((c) => [c.name, c.expression || null, Math.round(c.value * 1e6) / 1e6]) }));
    assert.deepStrictEqual(ss.p.map((p) => [p.name, p.unit, p.expression]), [['stock', shaperUnit, '30 mm']], 'Shaper: the parameter keeps the units it was typed with (O19), in the document unit: ' + JSON.stringify(ss));
    assert.deepStrictEqual(ss.d, [['d1', 'stock', 30], ['d2', 'stock * 2', 60]], 'Shaper: the formulas and values: ' + JSON.stringify(ss));
  } finally { await app.close(); }
}
console.log('parameters-canvas-node: ok');
