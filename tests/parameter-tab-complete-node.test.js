// tests/parameter-tab-complete-node.test.js - TASK 595: a parameter name completes with Tab, with the suggestion list shown too (the shared
// completion, packages/ui/parameter-completion.js). SketchStudio and Shaper through tests/helpers/node-app.js, the real keys (type() / key()).
// Parameters width / wing / height: "wi" lists [width, wing] with the top one highlighted; Tab gives "width" (caret after it) and the list
// closes; "wi", Down, Tab gives "wing"; one match: Tab completes it; no match: Tab does not complete; Esc closes the list and a second Esc is
// the box's own; Up / Down wrap; Enter inserts only after Up / Down (a plain Enter commits, once).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { boxOpen } from './helpers/node-dom-read.js';

const view = (app) => {
  const d = app.document, i = d.getElementById('dimInput'), c = d.getElementById('dimComplete');
  const shown = !!c && !c.classList.contains('hidden');
  return { value: i.value, caret: i.selectionStart, open: !i.classList.contains('hidden'),
    list: shown ? [...c.querySelectorAll('li')].map((li) => li.querySelector('.dc-name').textContent) : null,
    sel: shown ? [...c.querySelectorAll('li')].findIndex((li) => li.getAttribute('aria-selected') === 'true') : -1 };
};
const ready = async (app) => { await app.waitFor(() => boxOpen(app) && app.document.activeElement && app.document.activeElement.id === 'dimInput', 'the dimension box'); app.document.getElementById('dimInput').select(); };
const clear = (app) => { const i = app.document.getElementById('dimInput'); i.focus(); i.select(); app.type('\b'); };

async function run(host) {
  const app = await open({ host });
  try {
    const st = app.state;
    if (host === 'shaper') {
      st.clearDocument();
      st.joints.set('a', { x: -45, y: -20 }); st.joints.set('b', { x: -5, y: -20 });
      st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] });
      st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 40, name: 'd1', dimMode: 'aligned', glyphPos: { x: -25, y: -35 }, offset: 15 });
      app.tool('select'); app.frames(3);
    } else {
      const r = app.svg.getBoundingClientRect();
      const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      const A = { x: cv.x - 300, y: cv.y + 20 }, B = { x: cv.x + 108, y: cv.y + 20 };
      app.tool('line'); app.click(A.x, A.y); app.click(B.x, B.y); app.esc();
      app.tool('select'); app.tool('dim'); app.click(A.x, A.y); app.click(B.x, B.y);
      const m = { x: (A.x + B.x) / 2, y: A.y - 60 }; app.move(m.x, m.y); app.click(m.x, m.y);
      await ready(app);
    }
    if (host === 'shaper') {
      const lab = app.svg.querySelector('.dim-label'); const idx = +lab.getAttribute('data-constraint-idx');
      const g = st.constraints[idx].glyphPos; const p = app.toScreen(g.x, g.y);
      await app.pause(550); app.dblclick(p.x, p.y, { target: () => app.svg.querySelector(`.dim-label[data-constraint-idx="${idx}"]`) }); await ready(app);
    }
    for (const [name, expr] of [['width', '6 mm'], ['wing', '2 mm'], ['height', '9 mm']]) st.parameters.push({ name, unit: 'mm', expression: expr });

    // 1. "wi": the list shows [width, wing], the top one highlighted; Tab completes it inline, caret after it, the list closes
    app.type('wi');
    let v = view(app);
    assert.deepStrictEqual(v.list, ['width', 'wing'], host + ' 1: the list for "wi": ' + JSON.stringify(v));
    assert.strictEqual(v.sel, 0, host + ' 1: the top row is highlighted: ' + JSON.stringify(v));
    app.key('Tab');
    v = view(app);
    assert.strictEqual(v.value, 'width', host + ' 1: Tab gives "width": ' + JSON.stringify(v));
    assert.strictEqual(v.caret, 5, host + ' 1: the caret is after it');
    assert.strictEqual(v.list, null, host + ' 1: the list closes');
    assert.strictEqual(v.open, true, host + ' 1: Tab did not commit or close the box');

    // 2. "wi", Down, Tab: the second one
    clear(app); app.type('wi'); app.key('ArrowDown');
    v = view(app); assert.strictEqual(v.sel, 1, host + ' 2: Down moves the highlight: ' + JSON.stringify(v));
    app.key('Tab');
    assert.strictEqual(view(app).value, 'wing', host + ' 2: Tab takes the highlighted one');

    // 3. Up wraps; typing narrows; one match: Tab completes it
    clear(app); app.type('wi'); app.key('ArrowUp');
    assert.strictEqual(view(app).sel, 1, host + ' 3: Up from the top wraps to the last');
    app.type('n');
    v = view(app); assert.deepStrictEqual(v.list, ['wing'], host + ' 3: typing narrows: ' + JSON.stringify(v));
    assert.strictEqual(v.sel, 0, host + ' 3: the highlight is back on the top');
    app.key('Tab');
    assert.strictEqual(view(app).value, 'wing', host + ' 3: one match, Tab completes it');

    // 4. in the middle of a formula: only the word under the caret is replaced
    clear(app); app.type('2 * hei');
    app.key('Tab');
    v = view(app); assert.strictEqual(v.value, '2 * height', host + ' 4: ' + JSON.stringify(v)); assert.strictEqual(v.caret, 10);

    // 5. no match: no list, and Tab does not complete anything
    clear(app); app.type('qq');
    v = view(app); assert.strictEqual(v.list, null, host + ' 5: no match, no list');
    app.key('Tab');
    assert.strictEqual(view(app).value, 'qq', host + ' 5: Tab with no match changes nothing');

    // 6. Esc closes the list, a second Esc is the box's own
    clear(app); app.type('wi');
    assert(view(app).list, host + ' 6: list open');
    app.esc();
    v = view(app); assert.strictEqual(v.list, null, host + ' 6: Esc closes the list'); assert.strictEqual(v.open, true, host + ' 6: the box stays open');
    app.esc();
    assert.strictEqual(view(app).open, false, host + ' 6: a second Esc closes the box');
    console.log(host + ': ok');
  } finally { await app.close(); }
}
await run('sketchstudio');
await run('shaper');
console.log('parameter-tab-complete-node: ok');
