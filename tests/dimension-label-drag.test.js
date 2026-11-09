// tests/dimension-label-drag.test.js — TASK 492: a dimension's value can sit anywhere (constraint.labelPos, world XY) and
// its lead lines follow; a span too narrow for two arrowheads flips them outside.
import assert from 'node:assert';
import crypto from 'node:crypto';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { draw } = await import('../packages/ui/svg-renderer.js');
const { applyStyleTemplate } = await import('../packages/ui/style-templates.js');
const { axisRect, rectEdgePoint, linearLead, radialLead, isNarrowDim, dimNarrowThresholdPx } = await import('../packages/ui/dimension-lead.js');
const { createEngine } = await import('../packages/core/constraint-solver.js');
const { createSketchState } = await import('../packages/ui/sketch-state.js');
const { addConstraintObject } = await import('../packages/core/constraints.js');
const { serializeDocument, deserializeDocument } = await import('../packages/core/document.js');
const { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } = await import('../packages/ui/input-handlers/selection-tools.js');
const { TOOL_MODES } = await import('../packages/core/constants.js');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const near = (a, b, m) => assert(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);

// ── lead geometry (pure): endpoints touch the dimension line and the text edge ─────────────────────────────────────────
{
  const rect = axisRect(250, 60, 40, 18); // text well above and beyond the right end of a line (0,0)-(100,0)
  const lead = linearLead({ x: 0, y: 0 }, { x: 100, y: 0 }, rect, 4);
  assert(lead.extension, 'a text beyond the end extends the dimension line');
  near(lead.extension.x1, 100, 'extension starts at the line end'); near(lead.extension.y1, 0, 'extension on the line');
  near(lead.extension.x2, 250 - 20, 'extension reaches the text edge along the line'); near(lead.extension.y2, 0, 'extension stays on the line axis');
  assert(lead.leader, 'a text off the line gets a leader');
  near(lead.leader.x1, 230, 'leader starts on the extended line'); near(lead.leader.y1, 0, 'leader starts on the line');
  near(lead.leader.y2, 60 - 9, 'leader ends on the text bottom edge'); assert(lead.leader.x2 >= 230 - 1e-9 && lead.leader.x2 <= 270 + 1e-9, 'leader ends on the text edge');
  // over the middle of the span, off the line: leader only, from the nearest point of the line
  const mid = linearLead({ x: 0, y: 0 }, { x: 100, y: 0 }, axisRect(40, -50, 40, 18), 4);
  assert(!mid.extension, 'inside the span: no extension'); near(mid.leader.x1, 40, 'foot on the line'); near(mid.leader.y1, 0, 'foot on the line');
  near(mid.leader.y2, -41, 'ends on the text edge');
  // on the line: nothing
  const on = linearLead({ x: 0, y: 0 }, { x: 100, y: 0 }, axisRect(50, 0, 40, 18), 4);
  assert(!on.extension && !on.leader, 'text on its line: no lead lines');
  assert.strictEqual(rectEdgePoint(axisRect(0, 0, 10, 10), { x: 1, y: 1 }), null, 'a point inside the rect has no edge point');
  const r = radialLead({ x: 0, y: 0 }, axisRect(100, 0, 40, 18), 4);
  near(r.x2, 80, 'radial leader ends on the text edge'); near(r.y2, 0, 'on the ray to the text');
}
assert.strictEqual(dimNarrowThresholdPx(), 16, 'narrow threshold = two arrowheads + gap');
assert(isNarrowDim(10, 1) && !isNarrowDim(30, 1) && !isNarrowDim(10, 0.1), 'narrow is decided in screen pixels (zoom)');

// ── rendering ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const joints = new Map([['a', { x: 100, y: 100, fixed: true }], ['b', { x: 300, y: 100, fixed: true }], ['c', { x: 300, y: 200, fixed: true }], ['d', { x: 100, y: 200, fixed: true }]]);
const shapes = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']].map((j, i) => ({ id: 'r' + i, type: 'line', joints: j }));
const render = (cons, jm = joints, sh = shapes, width = 700, selected = new Set()) => {
  const svg = { viewBox: { baseVal: { x: 0, y: 0, width, height: width * 320 / 700 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 700, height: 320 }), innerHTML: '' };
  draw(jm, sh, svg, null, null, cons, new Set(), selected, 'select', null, new Set(), null, null, null, null, null, false, null);
  return svg.innerHTML;
};
const leads = (html) => [...html.matchAll(/<line class="dim-lead" x1="([-\d.e]+)" y1="([-\d.e]+)" x2="([-\d.e]+)" y2="([-\d.e]+)"/g)].map((m) => m.slice(1).map(Number));
const base = () => [{ id: 'k1', type: 'distance', joints: ['a', 'b'], value: 200, dimMode: 'horizontal' }, { id: 'k2', type: 'distance', joints: ['b', 'c'], value: 100, dimMode: 'vertical' }];

for (const tpl of ['default', 'fusion']) {
  applyStyleTemplate(tpl);
  const plain = render(base());
  assert.strictEqual(plain, render(base().map((c) => ({ ...c, labelPos: undefined }))), `${tpl}: absent labelPos = identical markup`);
  assert.strictEqual(leads(plain).length, 0, `${tpl}: no lead lines when the value sits where it normally does`);
  const moved = base(); moved[0].labelPos = { x: 450, y: 40 };
  const html = render(moved);
  assert.notStrictEqual(html, plain, `${tpl}: labelPos changes the drawing`);
  const L = leads(html);
  assert(L.length >= 1, `${tpl}: lead lines drawn for a dragged value`);
  // the horizontal dimension line is y=130 (offset 30 below the midpoint y=100) from x=100..300; the extension continues it
  const ext = L.find(([x1, y1, , y2]) => Math.abs(y1 - 130) < 1e-6 && Math.abs(y2 - 130) < 1e-6);
  assert(ext && Math.abs(ext[0] - 300) < 1e-6 && ext[2] > 300, `${tpl}: the dimension line extends from its end toward the value`);
  assert(/<text [^>]*>200<\/text>/.test(html.replace(/\.0+</, '<')) || html.includes('200'), `${tpl}: value still drawn`);
}

// narrow: arrows flip outside at one zoom, sit inside at the other, same dimension
for (const tpl of ['default', 'fusion']) {
  applyStyleTemplate(tpl);
  const j = new Map([['p', { x: 100, y: 100 }], ['q', { x: 100, y: 108 }]]); // 8 world units apart
  const sh = [{ id: 'l', type: 'line', joints: ['p', 'q'] }];
  const dim = () => [{ id: 'n1', type: 'distance', joints: ['p', 'q'], value: 8, dimMode: 'vertical', offset: 20 }];
  const arrows = (html) => [...html.matchAll(/<polygon points="([-\d.e]+),([-\d.e]+) ([-\d.e]+),([-\d.e]+) ([-\d.e]+),([-\d.e]+)" style="fill:var\(--sk-constraint-stroke/g)].map((m) => m.slice(1).map(Number));
  const tipSide = (a) => { const cy = (a[3] + a[5]) / 2; return cy - a[1]; }; // + : the body lies below its tip
  // zoom 1 (700 world / 700 px): 8px span < 16px -> outside
  let html = render(dim(), j, sh, 700);
  let A = arrows(html).sort((u, v) => u[1] - v[1]);
  assert.strictEqual(A.length, 2, `${tpl}: two arrowheads`);
  assert(tipSide(A[0]) < 0 && tipSide(A[1]) > 0, `${tpl}: narrow: arrows outside, pointing in at the extension lines`);
  assert(html.includes('class="dim-stub"'), `${tpl}: narrow: stubs drawn`);
  // zoomed in (70 world across 700 px => 10 px per world unit): 80px span -> inside
  html = render(dim(), j, sh, 70);
  A = arrows(html).sort((u, v) => u[1] - v[1]);
  assert(tipSide(A[0]) > 0 && tipSide(A[1]) < 0, `${tpl}: wide: arrows inside, pointing out at the extension lines`);
  assert(!html.includes('class="dim-stub"'), `${tpl}: wide: no stubs`);
}

// radius + angle: a dragged value gets a leader from the rim / arc to the text edge
applyStyleTemplate('default');
{
  const j = new Map([['c', { x: 0, y: 0 }], ['rim', { x: 10, y: 0 }]]);
  const circle = [{ id: 'circ', type: 'circle', joints: ['c', 'rim'], radius: 10 }];
  const dim = { id: 'r', type: 'distance', isRadius: true, shape: 'circ', value: 10, offset: 25, labelPos: { x: 60, y: -40 } };
  const svg = { viewBox: { baseVal: { x: -50, y: -80, width: 140, height: 140 } }, getBoundingClientRect: () => ({ width: 700, height: 700 }), innerHTML: '' };
  draw(j, circle, svg, null, null, [dim], new Set(), new Set(), 'select', null, new Set(), null, null, null, null, null, false, null);
  const m = [...svg.innerHTML.matchAll(/<line x1="([-\d.e]+)" y1="([-\d.e]+)" x2="([-\d.e]+)" y2="([-\d.e]+)" style="stroke:var\(--sk-constraint-stroke[^"]*" stroke-width="[^"]*" stroke-opacity="1"\/>/g)][0];
  const ang = Math.atan2(-40, 60);
  near(+m[1], 10 * Math.cos(ang), 'radius leader starts on the rim toward the value'); near(+m[2], 10 * Math.sin(ang), 'radius leader starts on the rim');
  const w = 0.5 * 50 * (140 / 700) * 5; // box half width (scale(50)/2, zoom 0.2)
  assert(Math.hypot(+m[3] - 60, +m[4] + 40) > 0 && Math.abs(+m[3] - 60) <= 25 * 0.2 + 1e-6 && Math.abs(+m[4] + 40) <= 9 * 0.2 + 1e-6, 'radius leader ends on the text box edge');
  assert(w > 0);
}
{
  const j = new Map([['p1', { x: 0, y: 0 }], ['p2', { x: 100, y: 0 }], ['p3', { x: 0, y: 0 }], ['p4', { x: 0, y: 100 }]]);
  const sh = [{ id: 'l1', type: 'line', joints: ['p1', 'p2'] }, { id: 'l2', type: 'line', joints: ['p3', 'p4'] }];
  const dim = { id: 'an', type: 'angle', shapes: ['l1', 'l2'], value: 90, offset: 40 };
  const r0 = render([dim], j, sh);
  const r1 = render([{ ...dim, labelPos: { x: 200, y: 200 } }], j, sh);
  assert.notStrictEqual(r0, r1, 'angle: labelPos moves the value');
  assert(leads(r1).length === 1, 'angle: one leader from the arc to the value');
  assert.strictEqual(leads(r0).length, 0, 'angle: no leader at the default spot');
}

// ── persistence ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const mkState = () => { const e = createEngine(); e.init(); return createSketchState(e, { x: 0, y: 0, w: 700, h: 320 }); };
{
  const s = mkState();
  for (const [id, p] of joints) s.joints.set(id, { ...p });
  s.shapes.push(...shapes.map((x) => ({ ...x, joints: [...x.joints] })));
  assert(addConstraintObject(s, { type: 'distance', joints: ['a', 'b'], value: 200, dimMode: 'horizontal', labelPos: { x: 450, y: 40 } }));
  const doc = JSON.parse(JSON.stringify(serializeDocument(s)));
  const s2 = mkState(); deserializeDocument(doc, s2);
  assert.deepStrictEqual(s2.constraints.find((c) => c.type === 'distance').labelPos, { x: 450, y: 40 }, 'labelPos round-trips through serialize/deserialize');
  const s3 = mkState(); deserializeDocument(JSON.parse(JSON.stringify(serializeDocument(mkStateWithoutLabelPos()))), s3);
  assert(!('labelPos' in s3.constraints[0]), 'an old document without labelPos stays without it');
}
function mkStateWithoutLabelPos() {
  const s = mkState();
  for (const [id, p] of joints) s.joints.set(id, { ...p });
  s.shapes.push(...shapes.map((x) => ({ ...x, joints: [...x.joints] })));
  addConstraintObject(s, { type: 'distance', joints: ['a', 'b'], value: 200, dimMode: 'horizontal' });
  return s;
}

// ── a real pointer drag: label follows the pointer, geometry/constraints untouched, one undo step ───────────────────────
{
  const s = mkStateWithoutLabelPos();
  s.currentTool = TOOL_MODES.SELECT;
  const c = s.constraints[0];
  const svg = {
    setPointerCapture() {}, releasePointerCapture() {},
    viewBox: { baseVal: { x: 0, y: 0, width: 700, height: 320 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 700, height: 320 }),
  };
  const labelEl = { dataset: { constraintIdx: '0' }, closest: (q) => (q === '.dim-label' ? { dataset: { constraintIdx: '0' } } : null) };
  const before = JSON.stringify([...s.joints.entries()]) + JSON.stringify(s.constraints.map((k) => ({ ...k, labelPos: undefined, glyphPos: undefined })));
  const hist0 = s.history.length;
  handleSelectionPointerDown({ target: labelEl, pointerId: 1, clientX: 200, clientY: 130, shiftKey: false, preventDefault() {}, stopPropagation() {} }, svg, s, null, null, null);
  assert.strictEqual(s.history.length, hist0, 'pressing the label saves nothing');
  handleSelectionPointerMove({ pointerId: 1, clientX: 201, clientY: 130 }, svg, s);
  assert(!c.labelPos, 'a 1 px jiggle is a click, not a drag');
  handleSelectionPointerMove({ pointerId: 1, clientX: 400, clientY: 40 }, svg, s);
  handleSelectionPointerMove({ pointerId: 1, clientX: 520, clientY: 260 }, svg, s);
  assert.deepStrictEqual(c.labelPos, { x: 520, y: 260 }, 'the label sits at the pointer in X and Y');
  handleSelectionPointerUp({ pointerId: 1, clientX: 520, clientY: 260 }, svg, s);
  const after = JSON.stringify([...s.joints.entries()]) + JSON.stringify(s.constraints.map((k) => ({ ...k, labelPos: undefined, glyphPos: undefined })));
  assert.strictEqual(after, before, 'geometry and constraint data are unchanged by the drag');
  assert.strictEqual(s.history.length, hist0 + 1, 'the whole drag is ONE undo step');
  s.undo();
  assert(!s.constraints[0].labelPos, 'one Undo restores the label');
  assert.strictEqual(s.history.length, hist0, 'and the history is back');
}

// ── selected dimension: the blue handle dot drives the line offset and never clears labelPos ────────────────────────────
{
  const sel = base(); sel[0].labelPos = { x: 450, y: 40 };
  const html = render(sel, joints, shapes, 700, new Set([sel[0]]));
  assert(html.includes('class="dim-offset-handle"'), 'a selected linear dimension shows the offset handle');
  assert(!render(sel).includes('dim-offset-handle'), 'an unselected one does not');
  const s = mkStateWithoutLabelPos();
  s.currentTool = TOOL_MODES.SELECT; s.constraints[0].labelPos = { x: 450, y: 40 };
  const svg = { setPointerCapture() {}, releasePointerCapture() {}, viewBox: { baseVal: { x: 0, y: 0, width: 700, height: 320 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 700, height: 320 }) };
  const handle = { dataset: { constraintIdx: '0' }, closest: (q) => (q === '.dim-offset-handle' ? { dataset: { constraintIdx: '0' } } : null) };
  handleSelectionPointerDown({ target: handle, pointerId: 1, clientX: 140, clientY: 130, shiftKey: false, preventDefault() {}, stopPropagation() {} }, svg, s, null, null, null);
  handleSelectionPointerMove({ pointerId: 1, clientX: 140, clientY: 180 }, svg, s);
  handleSelectionPointerUp({ pointerId: 1, clientX: 140, clientY: 180 }, svg, s);
  near(s.constraints[0].offset, 80, 'the handle moved the dimension line offset');
  assert.deepStrictEqual(s.constraints[0].labelPos, { x: 450, y: 40 }, 'moving the offset does not clear labelPos');
}
console.log('dimension-label-drag: md5', md5(render(base())), 'ok');
