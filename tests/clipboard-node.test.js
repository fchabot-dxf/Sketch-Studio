// tests/clipboard-node.test.js — TASK 580 (node port of the LOGIC half of tests/clipboard-live-shaper.test.js and clipboard-live-sketchstudio.test.js =
// clipboard-live-runner.js, TASK 559), both hosts through tests/helpers/node-app.js: draw a rectangle, marquee-select it, Ctrl+C (the system clipboard
// holds our JSON payload), Ctrl+X + Ctrl+Z, Ctrl+V twice, Ctrl+Z / Ctrl+Y, text fields leave Ctrl+C / V / X to the browser (the key is not consumed,
// nothing is pasted), the canvas consumes Ctrl+C, foreign clipboard text is ignored. The system clipboard is the kit's (override 7, `app.clipboard`).
// What stays in the browser (tests/clipboard-live-*.test.js): the browser's NATIVE copy from a text field (the field text lands on the clipboard).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

const tick = () => new Promise((r) => setImmediate(r)); // the clipboard calls are promises: let them settle
for (const host of ['sketchstudio', 'shaper']) {
  const app = await open({ host });
  try {
    const ctrl = async (k) => { app.key(k, { ctrl: true }); await tick(); await tick(); };
    const copyKey = () => ctrl('c'), pasteKey = () => ctrl('v'), cutKey = () => ctrl('x');
    const undoKey = () => app.undo(), redoKey = () => app.redo();
    const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o;
    const norm = (d) => ({ shapes: sortKeys(d.shapes.map(({ sketchId, ...r }) => r)), joints: sortKeys(d.joints.map(([k, v]) => { const { sketchId, ...r } = v; return [k, r]; })), constraints: d.constraints.map((c) => { const { __visible, glyphPos, __pos, ...r } = c; return sortKeys(r); }) });
    // the live document (the state the page edits)
    const readDoc = () => norm(JSON.parse(JSON.stringify({ shapes: app.state.shapes, constraints: app.state.constraints, joints: [...app.state.joints.entries()] })));
    const jmap = (d) => Object.fromEntries(d.joints);
    const canon = (d) => JSON.stringify({ j: Object.entries(jmap(d)).sort((a, b) => (a[0] < b[0] ? -1 : 1)), s: d.shapes, c: d.constraints.map((c) => JSON.stringify(c)).sort() });
    // a bubble-phase listener AFTER the app's, recording whether the app consumed the key
    const defaultPrevented = async (fn) => { const seen = []; const probe = (e) => seen.push(e.defaultPrevented); app.document.addEventListener('keydown', probe, false); await fn(); app.document.removeEventListener('keydown', probe); return seen; };

    // ---- draw a rectangle, select it with a marquee
    const o = app.toScreen(0, 0);
    const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
    const d0 = readDoc();
    app.tool('rect');
    app.click(P(-250, -150).x, P(-250, -150).y); app.click(P(-100, -70).x, P(-100, -70).y); app.esc();
    const drawn = readDoc();
    const nShapes = drawn.shapes.length - d0.shapes.length, nCons = drawn.constraints.length - d0.constraints.length, nJoints = drawn.joints.length - d0.joints.length;
    assert.strictEqual(nShapes, 4, host + ': a rectangle is 4 shapes');
    app.tool('select');
    app.drag(P(-290, -190), P(-50, -20), 6);

    // ---- Ctrl+C: the SYSTEM clipboard now holds our JSON payload
    await copyKey();
    const text = app.clipboard.text;
    const payload = JSON.parse(text);
    assert.strictEqual(payload.format, 'sketch-studio/geometry'); assert.strictEqual(payload.version, 1);
    assert.strictEqual(payload.document.geometry.shapes.length, 4, host + ': the four sides were copied');
    assert.strictEqual(payload.document.geometry.constraints.length, nCons, host + ': every constraint of the rectangle is inside the copy');

    // ---- Ctrl+X on the selected rectangle = copy + delete (the Delete key's step); Ctrl+Z brings it back exactly
    await cutKey();
    const c1 = readDoc();
    assert.strictEqual(c1.shapes.length, d0.shapes.length, host + ': Ctrl+X removed the selected rectangle');
    assert.strictEqual(c1.constraints.length, d0.constraints.length, 'with its constraints');
    assert.strictEqual(JSON.parse(app.clipboard.text).document.geometry.shapes.length, 4, 'and put it on the clipboard');
    undoKey();
    assert.strictEqual(canon(readDoc()), canon(drawn), host + ': Ctrl+Z after the cut restores the geometry exactly (one step)');
    // ---- Ctrl+V twice (each one more step), then Ctrl+Z, Ctrl+Y: ONE undo step each, exact
    await pasteKey();
    const p1 = readDoc();
    assert.strictEqual(p1.shapes.length, drawn.shapes.length + 4, host + ': Ctrl+V pasted 4 shapes');
    assert.strictEqual(p1.constraints.length, drawn.constraints.length + nCons, 'and every constraint');
    assert.strictEqual(p1.joints.length, drawn.joints.length + nJoints, 'and every joint');
    const ids0 = new Set(Object.keys(jmap(drawn)));
    const fresh = Object.entries(jmap(p1)).filter(([k]) => !ids0.has(k));
    assert.strictEqual(fresh.length, nJoints, 'new joint ids');
    const shift = new Set(Object.values(jmap(drawn)).flatMap((j) => fresh.filter(([, f]) => Math.abs(f.x - j.x - 10) < 1e-3 && Math.abs(f.y - j.y - 10) < 1e-3).map(() => 1)));
    assert.ok(shift.size > 0, 'the copy is the original moved by (+10, +10) (right and down)');
    await pasteKey();
    const p2 = readDoc();
    assert.strictEqual(p2.shapes.length, drawn.shapes.length + 8, 'a second Ctrl+V pastes again');
    const fresh2 = Object.entries(jmap(p2)).filter(([k]) => !ids0.has(k) && !(k in jmap(p1)));
    assert.ok(fresh2.some(([, f]) => Object.values(jmap(drawn)).some((j) => Math.abs(f.x - j.x - 20) < 1e-3 && Math.abs(f.y - j.y - 20) < 1e-3)), 'the second paste is one more step (+20, +20)');
    undoKey();
    assert.strictEqual(canon(readDoc()), canon(p1), 'ONE Ctrl+Z removes exactly the last paste');
    undoKey();
    assert.strictEqual(canon(readDoc()), canon(drawn), 'the second Ctrl+Z removes the first paste: back to the drawn rectangle');
    redoKey();
    assert.strictEqual(canon(readDoc()), canon(p1), 'Ctrl+Y brings the first paste back exactly');

    // ---- text fields keep the browser's own copy / paste: the key is not consumed, the document is untouched
    app.clipboard.text = text;
    const doc = app.document;
    const probes = [];
    for (const tag of ['input', 'textarea']) { const e = doc.createElement(tag); e.id = 'probe-' + tag; if (tag === 'input') e.type = 'text'; e.value = 'abc'; doc.body.appendChild(e); probes.push(e); }
    const ce = doc.createElement('div'); ce.id = 'probe-ce'; ce.contentEditable = 'true'; ce.setAttribute('tabindex', '0'); ce.textContent = 'abc'; doc.body.appendChild(ce); probes.push(ce);
    const before = readDoc();
    for (const e of probes) {
      e.focus(); if (e.select) e.select();
      assert.strictEqual(doc.activeElement, e, e.id + ' has the focus');
      const prevented = await defaultPrevented(async () => { await copyKey(); await pasteKey(); await cutKey(); });
      assert.deepStrictEqual(prevented, [false, false, false], `${e.id}: Ctrl+C / V / X are left to the browser (defaultPrevented ${JSON.stringify(prevented)})`);
    }
    assert.strictEqual(app.clipboard.text, text, 'the app did not touch the system clipboard from a text field');
    assert.strictEqual(canon(readDoc()), canon(before), 'and nothing was pasted into the sketch from a text field');
    // the canvas (not a text field) still consumes them
    if (doc.activeElement) doc.activeElement.blur();
    const canvasPrevented = await defaultPrevented(async () => { await copyKey(); });
    assert.deepStrictEqual(canvasPrevented, [true], 'on the canvas Ctrl+C is the app\'s');

    // ---- text that is not ours: nothing happens
    app.clipboard.text = 'hello, not a sketch';
    const h0 = readDoc();
    await pasteKey();
    assert.strictEqual(canon(readDoc()), canon(h0), 'foreign clipboard text: Ctrl+V does nothing');
    console.log('clipboard-node ' + host + ': ok (4 shapes +', nCons, 'constraints per paste, offset (+10,+10) then (+20,+20), one undo step each)');
  } finally { await app.close(); }
}
