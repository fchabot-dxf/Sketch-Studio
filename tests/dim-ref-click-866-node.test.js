// tests/dim-ref-click-866-node.test.js — TASK 866: clicking an existing dimension (text or leader) while a dimension value box is open
// inserts its parameter name (e.g. d1) at the caret / replaces selection, keeps the box open & focused, caret after the name;
// self-click does nothing; clicking elsewhere keeps today's behaviour. Verified on SketchStudio & Shaper through node-app.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { boxOpen } from './helpers/node-dom-read.js';

const view = (app) => {
  const i = app.document.getElementById('dimInput');
  return {
    open: boxOpen(app),
    value: i ? i.value : null,
    start: i ? i.selectionStart : null,
    end: i ? i.selectionEnd : null,
    active: app.document.activeElement ? app.document.activeElement.id : null,
  };
};
const boxReady = async (app) => {
  await app.waitFor(() => boxOpen(app) && app.document.activeElement && app.document.activeElement.id === 'dimInput', 'the dimension box to open and take focus');
};

async function runHost(host) {
  const app = await open({ host });
  try {
    const st = app.state;
    st.clearDocument();
    st.joints.set('a1', { x: -40, y: -20 }); st.joints.set('a2', { x: 20, y: -20 });
    st.joints.set('b1', { x: -40, y: 20 }); st.joints.set('b2', { x: 0, y: 20 });
    st.shapes.push({ id: 'L1', type: 'line', joints: ['a1', 'a2'] });
    st.shapes.push({ id: 'L2', type: 'line', joints: ['b1', 'b2'] });
    st.constraints.push({ type: 'distance', joints: ['a1', 'a2'], value: 60, name: 'd1', dimMode: 'aligned', glyphPos: { x: -10, y: -35 }, offset: -15 });
    st.constraints.push({ type: 'distance', joints: ['b1', 'b2'], value: 40, name: 'd2', dimMode: 'aligned', glyphPos: { x: -20, y: 35 }, offset: 15 });
    app.tool('select');
    app.frames(3);

    const idx1 = st.constraints.findIndex((c) => c.name === 'd1');
    const idx2 = st.constraints.findIndex((c) => c.name === 'd2');
    const label1 = () => app.svg.querySelector(`.dim-label[data-constraint-idx="${idx1}"]`);
    const label2 = () => app.svg.querySelector(`.dim-label[data-constraint-idx="${idx2}"]`);
    const p1 = app.toScreen(st.constraints[idx1].glyphPos.x, st.constraints[idx1].glyphPos.y);
    const p2 = app.toScreen(st.constraints[idx2].glyphPos.x, st.constraints[idx2].glyphPos.y);

    // Normal click when NO box is open still selects d1 (behaviour unchanged)
    app.click(p1.x, p1.y, { target: label1 });
    assert.strictEqual(st.selectedConstraints.has(st.constraints[idx1]), true, `${host}: normal click with no box open selects d1`);

    // 1. Open d2's box, whole value selected -> click d1's label -> replaces with 'd1', keeps box open & focused, caret at 2
    await app.pause(550);
    app.dblclick(p2.x, p2.y, { target: label2 });
    await boxReady(app);
    // Fusion: editing a dimension opens its box with the whole value selected (typing replaces it)
    let v = view(app);
    assert.ok(v.value.length > 0 && v.start === 0 && v.end === v.value.length, `${host} 0: the box opens with its value selected: ${JSON.stringify(v)}`);
    app.document.getElementById('dimInput').select();
    app.click(p1.x, p1.y, { target: label1 });
    v = view(app);
    assert.deepStrictEqual(v, { open: true, value: 'd1', start: 2, end: 2, active: 'dimInput' }, `${host} 1: click d1 replaces prefill: ${JSON.stringify(v)}`);

    // Type '/2' and Enter -> d2 becomes d1 / 2 = 30
    app.type('/2');
    app.enter();
    assert.strictEqual(boxOpen(app), false, `${host} 1: Enter closes box`);
    assert(Math.abs(st.constraints[idx2].value - 30) < 0.01, `${host} 1: d2 solved to 30, got ${st.constraints[idx2].value}`);
    assert.strictEqual(st.constraints[idx2].expression, 'd1 / 2', `${host} 1: d2 keeps expression`);

    // 2. Insert at caret + replace mid-string selection + self-click is no-op
    app.frames(2);
    await app.pause(550);
    app.dblclick(p2.x, p2.y, { target: label2 });
    await boxReady(app);
    const inp = app.document.getElementById('dimInput');
    inp.select();
    app.type('2 * ');
    app.click(p1.x, p1.y, { target: label1 });
    v = view(app);
    assert.deepStrictEqual(v, { open: true, value: '2 * d1', start: 6, end: 6, active: 'dimInput' }, `${host} 2: insert at caret after '2 * ': ${JSON.stringify(v)}`);

    // Mid-string selection replacement: '10 + 99 + 5' with '99' (5..7) selected -> '10 + d1 + 5', caret 7
    inp.value = '10 + 99 + 5';
    inp.setSelectionRange(5, 7);
    app.click(p1.x, p1.y, { target: label1 });
    v = view(app);
    assert.deepStrictEqual(v, { open: true, value: '10 + d1 + 5', start: 7, end: 7, active: 'dimInput' }, `${host} 3: replace selection inside box: ${JSON.stringify(v)}`);

    // Click self (d2's own leader line element with data-constraint-idx) -> nothing changes, box stays open
    const leader2 = () => app.svg.querySelector(`[data-constraint-idx="${idx2}"]:not(.dim-label)`);
    assert.ok(leader2(), `${host} 4: d2 leader/dim line carries data-constraint-idx="${idx2}"`);
    app.click(p2.x, p2.y, { target: leader2 });
    v = view(app);
    assert.deepStrictEqual(v, { open: true, value: '10 + d1 + 5', start: 7, end: 7, active: 'dimInput' }, `${host} 4: self-click on d2 leader does nothing: ${JSON.stringify(v)}`);

    // Click another dimension's leader line (d1's non-label line) -> inserts d1
    const leader1 = () => app.svg.querySelector(`[data-constraint-idx="${idx1}"]:not(.dim-label)`);
    assert.ok(leader1(), `${host} 5: d1 leader/dim line carries data-constraint-idx="${idx1}"`);
    inp.select();
    app.click(p1.x, p1.y, { target: leader1 });
    v = view(app);
    assert.deepStrictEqual(v, { open: true, value: 'd1', start: 2, end: 2, active: 'dimInput' }, `${host} 5: clicking d1 leader inserts d1: ${JSON.stringify(v)}`);

    // Clicking empty canvas commits/closes as before
    const emptyPt = app.toScreen(-80, -80);
    app.click(emptyPt.x, emptyPt.y);
    assert.strictEqual(boxOpen(app), false, `${host} 6: click outside still closes box`);
    assert(Math.abs(st.constraints[idx2].value - 60) < 0.01, `${host} 6: valid 'd1' committed on outside press`);

    // 7. New dimension value box: place d3 on a 3rd line with Dim tool, click d1, type '/2', Enter
    st.joints.set('c1', { x: -40, y: 50 }); st.joints.set('c2', { x: 10, y: 50 });
    st.shapes.push({ id: 'L3', type: 'line', joints: ['c1', 'c2'] });
    app.frames(2);
    app.tool('dim');
    const cMid = app.toScreen(-15, 50);
    const cDrop = app.toScreen(-15, 68);
    app.click(cMid.x, cMid.y);
    app.move(cDrop.x, cDrop.y);
    app.click(cDrop.x, cDrop.y);
    await boxReady(app);
    app.document.getElementById('dimInput').select();
    app.click(p1.x, p1.y, { target: label1 });
    assert.strictEqual(app.document.getElementById('dimInput').value, 'd1', `${host} 7: new dimension box took d1`);
    app.type('/2');
    app.enter();
    const d3 = st.constraints.find((c) => c.name === 'd3');
    assert(d3 && Math.abs(d3.value - 30) < 0.01, `${host} 7: new dimension d3 = d1 / 2 = 30 (got ${d3 && d3.value})`);
    assert.strictEqual(d3.expression, 'd1 / 2', `${host} 7: d3 stores expression 'd1 / 2'`);

    console.log(`${host}: ok`);
  } finally { await app.close(); }
}

await runHost('sketchstudio');
await runHost('shaper');
console.log('dim-ref-click-866-node: ok');
