// tests/parameters-canvas-node.test.js — TASK 580 (node port of parts A and C of tests/parameters-canvas-live.test.js, TASK 535 slice 3), through
// tests/helpers/node-app.js: formulas typed into a dimension's box, in the REAL apps.
//  A. SketchStudio: `width = 6` NAMES the dimension (TASK 677 owner ruling, Fusion measured: no user parameter) and its label reads a plain "6.0";
//     a second dimension typed `width / 2 + 1` follows it ("fx: 4.0"); typing 8 into width changes both in ONE undo step; an unknown name is refused with the O5 hint and the box stays open; the
//     autocomplete list (rows with value and unit, Down + Enter, Esc, a mouse click); the box is a TEXT input; plain numbers still work and drop the
//     formula; the labels survive a reload (close + open on the profile).
//  C. Shaper: the same box (the shared code), a formula and `name = value` on a seeded drawing, the fx label, the stored parameters.
// Part B (the 390 px phone layout: the box / hint / list fit the screen) stays in the browser: tests/parameters-canvas-live.test.js. The screenshots
// (evidence, no assert) are not taken. The text is typed with the kit's type() (keydown, value, input event per character).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { boxOpen, findLabel, labelEl } from './helpers/node-dom-read.js';
import SettingsManager from '#core/settings-manager.js';

const labels = (app) => [...app.svg.querySelectorAll('.dim-label')].map((g) => (g.querySelector('text') || g).textContent.trim().replace(/\s+/g, ' '));
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
    // typing `width = 6`: the hint says what Enter will do BEFORE Enter (TASK 677: it names this dimension width)
    app.type('width = 6');
    b = box(app);
    assert.strictEqual(b.hint, 'names it width = 6.0 mm', 'the live hint before Enter: ' + b.hint);
    assert.strictEqual(b.hintErr, false);
    app.enter();
    assert.strictEqual(box(app).open, false, 'Enter closes the box');
    let lab = labels(app);
    assert(lab.includes('6.0') && !lab.some((t) => /^fx: /.test(t)), 'a named dimension reads a plain "6.0": ' + JSON.stringify(lab));
    assert.deepStrictEqual(app.state.parameters, [], 'no user parameter was created');
    // dimension 2, typed as a formula on the named dimension. While it is being typed the autocomplete offers `width`
    await dimension(C, D, 60);
    app.type('wi');
    b = box(app);
    assert.deepStrictEqual(b.list.map((x) => [x.name, x.val]), [['width', '6.0 mm']], 'autocomplete after "wi": the named dimension with its value and unit: ' + JSON.stringify(b.list));
    assert.strictEqual(b.list[0].sel, 'true', 'TASK 595: the top row is highlighted (Tab takes it)');
    app.key('ArrowDown'); // a plain Enter still commits; after Up / Down Enter inserts the highlighted row
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
    assert(lab.filter((t) => /^fx: /.test(t)).length === 1 && lab.includes('6.0'), 'the follower carries the fx mark, the named one does not: ' + JSON.stringify(lab));
    assert(lab.includes('fx: 4.0'), 'width / 2 + 1 mm = 4.0 (a unitless 1 takes the document unit): ' + JSON.stringify(lab));
    // reopen d1 with two quick clicks on its label (Select tool): the box opens with the FORMULA, not the value
    app.tool('select');
    await reopen(app, /6\.0/);
    b = box(app);
    assert.strictEqual(b.value, '6.0', 'a named dimension holding a plain value opens with its value');
    // a plain number typed into the named dimension: every dimension that reads its name follows (Fusion)
    app.document.getElementById('dimInput').select();
    app.type('8');
    b = box(app);
    assert.strictEqual(b.hint, '= 8.0 mm', 'the hint: ' + b.hint);
    app.enter();
    lab = labels(app);
    assert(lab.includes('8.0') && lab.includes('fx: 5.0'), 'Enter changed both dimensions: ' + JSON.stringify(lab));
    // ONE undo restores both
    app.undo();
    lab = labels(app);
    assert(lab.includes('6.0') && lab.includes('fx: 4.0') && !lab.some((t) => /8\.0|5\.0/.test(t)), 'one Ctrl+Z changed both back: ' + JSON.stringify(lab));
    app.redo();
    lab = labels(app);
    assert(lab.includes('8.0') && lab.includes('fx: 5.0'), 'redo: ' + JSON.stringify(lab));
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
    app.type('width = d2'); b = box(app);
    assert(/d2|width/.test(b.hint) && b.hintErr, 'a loop is refused with its path: ' + b.hint);
    // the mouse: click a row of the list to insert it (width's own box never offers width: a function row here)
    app.document.getElementById('dimInput').select();
    app.type('sq');
    const row = app.document.querySelector('#dimComplete li');
    assert(row, 'the list row is there');
    app.press(row);
    b = box(app);
    assert.strictEqual(b.value, 'sqrt(', 'a mouse click on a row inserts it (the box keeps focus: ' + b.active + ')'); assert.strictEqual(b.active, 'dimInput');
    // a plain number typed into the named dimension (a unit suffix, which a type=number box could not hold)
    app.document.getElementById('dimInput').select();
    app.type('3mm'); // a unit suffix, which a type=number box could not hold
    app.enter();
    lab = labels(app);
    assert(lab.includes('3.0'), 'width reads 3.0: ' + JSON.stringify(lab));
    assert(lab.includes('fx: 2.5'), 'the other dimension follows width (3 / 2 + 1): ' + JSON.stringify(lab));
    // after a reload the formulas are still there (autosave): the fx label comes back
    await app.storedDoc(); await app.close();
    app = await open({ host: 'sketchstudio', profile });
    lab = labels(app);
    assert(lab.includes('fx: 2.5') && lab.includes('3.0'), 'after a reload the labels are the same: ' + JSON.stringify(lab));
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
    assert.strictEqual(b.hint, `names it stock = ${inU(30)} ${shaperUnit}`, 'Shaper: the live hint (shown in the document unit): ' + b.hint);
    app.enter();
    const shLabs = labels(app);
    assert(shLabs.includes(inU(30)) && !shLabs.some((t) => /^fx: /.test(t)), 'Shaper: the named dimension shows its plain value: ' + JSON.stringify(shLabs));
    // the second dimension uses the parameter in a formula
    await reopen(app, re40);
    app.type('sto');
    b = box(app);
    assert.strictEqual(b.list && b.list[0].name, 'stock', 'Shaper: the autocomplete offers the named dimension: ' + JSON.stringify(b.list));
    app.key('Tab');
    assert.strictEqual(box(app).value, 'stock', 'Tab inserts the first row');
    app.type(' * 2');
    app.enter();
    const shLabs2 = labels(app);
    assert(shLabs2.includes(`fx: ${inU(60)}`) && shLabs2.includes(inU(30)), 'Shaper: the follower shows fx, the named one its plain value: ' + JSON.stringify(shLabs2));
    const ss = JSON.parse(JSON.stringify({ p: st.parameters, d: st.constraints.map((c) => [c.name, c.expression || null, Math.round(c.value * 1e6) / 1e6]) }));
    assert.deepStrictEqual(ss.p, [], 'Shaper: no user parameter (the dimension is named): ' + JSON.stringify(ss));
    assert.deepStrictEqual(ss.d, [['stock', null, 30], ['d2', 'stock * 2', 60]], 'Shaper: the named dimension and the formula: ' + JSON.stringify(ss));
  } finally { await app.close(); }
}
console.log('parameters-canvas-node: ok');
