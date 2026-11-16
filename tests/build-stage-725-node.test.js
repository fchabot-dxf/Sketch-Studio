// tests/build-stage-725-node.test.js — TASK 725: SketchStudio's Build step, the node half.
//  1. The ONE renderer's display profiles (#ui/svg-renderer.js): a render context with no profile draws exactly what it drew before (EDIT_DISPLAY);
//     CLEAN_DISPLAY keeps the solid geometry and EVERY dimension (driving + driven linear, radius, angle) and drops the constraint glyphs, the points
//     (origin, joint dots, endpoint rings), the construction geometry, the axes, the grid, the fills, and colours every curve in one ink.
//  2. drawBuild (apps/sketchstudio/build-view.js) draws the live state through that profile, with no selection / hover, and leaves a hidden sketch out.
//  3. The step list: Design | Build (Design from the shared COMMON_STEPS), the stored step restores, the Export view is not a step.
//  4. The print layout: a standard scale, the orientation from the drawing's aspect, an empty drawing has none; the title line.
//  5. computeGeometryBounds({ construction: false }) leaves construction geometry out (Fit and print frame what Build shows).
import assert from 'node:assert';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { draw, EDIT_DISPLAY, CLEAN_DISPLAY, defaultRenderCtx } = await import('../packages/ui/svg-renderer.js');
const { drawBuild, BUILD_RENDER_CTX, planPrint, scaleText, titleLine, PRINT_AREA_MM } = await import('../apps/sketchstudio/build-view.js');
const { STUDIO_STAGES, initialStage, isStage } = await import('../apps/sketchstudio/stages.js');
const { COMMON_STEPS } = await import('../packages/ui/stage-names.js');
const { computeGeometryBounds } = await import('../packages/core/geometry-bounds.js');

const mk = () => ({ viewBox: { baseVal: { x: -20, y: -30, width: 120, height: 100 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 600, height: 500 }), innerHTML: '' });
const J = (x, y, sketchId = 's1') => ({ x, y, fixed: false, sketchId });
const scene = () => {
  const joints = new Map([['j_origin', { x: 0, y: 0, fixed: true }], ['a', J(0, 0)], ['b', J(60, 0)], ['c', J(60, 40)], ['d', J(0, 40)], ['o', J(30, 20)],
    ['h1', J(100, 0, 's2')], ['h2', J(120, 0, 's2')]]);
  const shapes = [
    { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 's1' }, { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: 's1' },
    { id: 'L3', type: 'line', joints: ['c', 'd'], sketchId: 's1' }, { id: 'L4', type: 'line', joints: ['d', 'a'], sketchId: 's1' },
    { id: 'CL', type: 'line', joints: ['a', 'c'], sketchId: 's1', isConstruction: true },
    { id: 'C', type: 'circle', joints: ['o'], radius: 8, sketchId: 's1' },
    { id: 'H', type: 'line', joints: ['h1', 'h2'], sketchId: 's2' },
  ];
  const constraints = [
    { type: 'coincident', joints: ['j_origin', 'a'] }, { type: 'horizontal', joints: ['a', 'b'] }, { type: 'vertical', joints: ['b', 'c'] },
    { type: 'parallel', shapes: ['L1', 'L3'] },
    { type: 'distance', joints: ['a', 'b'], value: 60, offset: -8 },
    { type: 'distance', joints: ['d', 'o'], value: Math.hypot(30, 20), driven: true, offset: -4 },
    { type: 'distance', shape: 'C', isRadius: true, value: 8 },
    { type: 'angle', shapes: ['L1', 'CL'], value: Math.atan2(40, 60) * 180 / Math.PI, offset: 20 },
  ];
  return { joints, shapes, constraints, sketches: [{ id: 's1', name: 'One', visible: true }, { id: 's2', name: 'Two', visible: true }], activeSketchId: 's1' };
};
const render = (st, ctx) => {
  const svg = mk(); let grid = 0;
  const c = ctx === undefined ? undefined : { ...ctx, updateGrid: () => { grid++; } };
  draw(st.joints, st.shapes, svg, null, null, st.constraints, new Set(), new Set(), 'select', null, new Set(), null, null, null, null, null, false, null, c);
  return { html: svg.innerHTML, grid };
};
const count = (html, re) => (html.match(re) || []).length;
const shapeIds = (html) => [...html.matchAll(/class="shape-elem" data-shape-id="([^"]+)"/g)].map((m) => m[1]).sort();

// ── 1. the display profiles ──
{
  const st = scene();
  const plain = render(st, {}); // a host context without a profile
  const edit = render(st, { display: EDIT_DISPLAY });
  assert.strictEqual(edit.html, plain.html, 'a context with no profile draws EDIT_DISPLAY, byte for byte (Design is unchanged)');
  const dflt = mk();
  draw(st.joints, st.shapes, dflt, null, null, st.constraints, new Set(), new Set(), 'select', null, new Set(), null, null, null, null, null, false, null);
  assert.strictEqual(defaultRenderCtx.display, undefined, 'the default render context names no profile');
  assert.ok(count(dflt.innerHTML, /class="dim-label"/g) === 4, 'the default context draws the 4 dimensions');
  // Design (the edit profile) draws glyphs, points, construction, axes, the grid
  assert.ok(count(plain.html, /class="constraint-glyph"/g) > 0, 'edit: constraint glyphs');
  assert.ok(/data-shape-id="CL"/.test(plain.html), 'edit: the construction line');
  assert.ok(/stroke="#ef4444"/.test(plain.html) && /stroke="#22c55e"/.test(plain.html), 'edit: the axes');
  assert.ok(count(plain.html, /<circle(?![^>]*class="shape-elem")/g) > 0, 'edit: point dots');
  assert.strictEqual(plain.grid, 1, 'edit: the grid is mounted');

  const clean = render(st, { display: CLEAN_DISPLAY });
  assert.deepStrictEqual(shapeIds(clean.html), ['C', 'H', 'L1', 'L2', 'L3', 'L4'], 'clean: every solid curve, no construction line');
  assert.strictEqual(count(clean.html, /class="dim-label"/g), 4, 'clean: all 4 dimensions (driving, driven, radius, angle)');
  const labels = [...clean.html.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).sort();
  const editLabels = [...plain.html.matchAll(/<g class="dim-label"[\s\S]*?<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(labels, editLabels, 'clean: the same label texts as Design');
  assert.ok(labels.some((t) => /^\(.*\)$/.test(t)), 'clean: the driven dimension keeps its reference parentheses: ' + JSON.stringify(labels));
  assert.strictEqual(count(clean.html, /constraint-glyph/g), 0, 'clean: no constraint glyph');
  assert.strictEqual(count(clean.html, /<circle(?![^>]*class="shape-elem")/g), 0, 'clean: no point, origin or endpoint ring');
  assert.strictEqual(count(clean.html, /joint-handle/g), 0, 'clean: no joint hit target');
  assert.ok(!/#ef4444|#22c55e|data-ref-axis/.test(clean.html), 'clean: no axis');
  assert.strictEqual(clean.grid, 0, 'clean: the grid is not mounted');
  assert.ok(!/fill-opacity="0\.(2|12|18)"/.test(clean.html), 'clean: no closed-loop / profile tint');
  const strokes = [...clean.html.matchAll(/class="shape-elem"[^>]*stroke:([^;"]+)/g)].map((m) => m[1].trim());
  assert.ok(strokes.length === 6 && strokes.every((s) => s === 'var(--sk-geo-fixed, #202020)'), 'clean: one ink for every curve: ' + JSON.stringify([...new Set(strokes)]));
  const fresh = scene(); render(fresh, { display: CLEAN_DISPLAY });
  assert.ok(fresh.constraints.every((c) => !('__visible' in c)), 'clean: no glyph visibility is stamped on the constraints');
}

// ── 2. drawBuild: the live state, no selection / hover, hidden sketches left out ──
{
  const st = scene();
  st.selectedShapes = new Set(['L1']); st.hoveredShape = 'L2'; st.selectedConstraints = new Set([st.constraints[4]]); st.currentTool = 'line';
  const svg = mk();
  drawBuild({ state: st, svg, world: null });
  assert.strictEqual(BUILD_RENDER_CTX.display, CLEAN_DISPLAY, 'Build draws with the clean profile');
  assert.deepStrictEqual(shapeIds(svg.innerHTML), ['C', 'H', 'L1', 'L2', 'L3', 'L4'], 'Build: the solid curves');
  assert.ok(!/--sk-selection|#017AFD|#017afd|--sk-glyph-(hover|selected)/.test(svg.innerHTML), 'Build: no selection or hover colour, though the state has a selection and a hover');
  st.sketches[1].visible = false;
  drawBuild({ state: st, svg, world: null });
  assert.deepStrictEqual(shapeIds(svg.innerHTML), ['C', 'L1', 'L2', 'L3', 'L4'], 'Build: a hidden sketch is not drawn');
  st.sketches[1].visible = true;
  st.shapes.push({ id: 'NEW', type: 'line', joints: ['a', 'o'], sketchId: 's1' });
  drawBuild({ state: st, svg, world: null });
  assert.ok(shapeIds(svg.innerHTML).includes('NEW'), 'Build: the live document (a shape added later is drawn on the next frame)');
}

// ── 3. the steps ──
assert.deepStrictEqual(STUDIO_STAGES.map((s) => s.id), ['design', 'build'], 'SketchStudio steps: design, build');
assert.deepStrictEqual(STUDIO_STAGES.map((s) => s.label), [COMMON_STEPS.design, 'Build'], 'labels: the shared Design, then the app\'s own Build');
assert.strictEqual(initialStage('build'), 'build', 'a stored Build step restores');
assert.strictEqual(initialStage('design'), 'design');
assert.strictEqual(initialStage(null), 'design', 'nothing stored: Design');
assert.strictEqual(initialStage('export'), 'design', 'the Export view is not a step: Design');
assert.ok(isStage('build') && isStage('design') && !isStage('export'), 'isStage');

// ── 4. print layout ──
{
  const st = scene(); st.shapes = st.shapes.filter((s) => s.id !== 'H');
  const plan = planPrint(st);
  assert.strictEqual(plan.orientation, 'landscape', 'a wide drawing: landscape');
  assert.strictEqual(plan.scaleText, '2:1', 'the 60 x 40 plate with its labels fits at 2:1');
  assert.deepStrictEqual(plan.area, PRINT_AREA_MM.landscape);
  assert.ok(Math.abs(plan.view.w * plan.scale - plan.area.w) < 1e-9, 'the view spans the paper area at the scale');
  const tall = { joints: new Map([['p', J(0, 0)], ['q', J(0, 200)], ['r', J(30, 0)]]), shapes: [{ id: 'a', type: 'line', joints: ['p', 'q'] }, { id: 'b', type: 'line', joints: ['p', 'r'] }], constraints: [] };
  const tp = planPrint(tall);
  assert.deepStrictEqual([tp.orientation, tp.scaleText], ['portrait', '1:1'], 'a 30 x 200 mm drawing: portrait, full size');
  const big = { joints: new Map([['p', J(0, 0)], ['q', J(2000, 0)], ['r', J(2000, 900)]]), shapes: [{ id: 'a', type: 'line', joints: ['p', 'q'] }, { id: 'b', type: 'line', joints: ['q', 'r'] }], constraints: [] };
  assert.deepStrictEqual([planPrint(big).orientation, planPrint(big).scaleText], ['landscape', '1:10'], 'a 2 x 0.9 m drawing: 1:10');
  assert.strictEqual(planPrint({ joints: new Map([['j_origin', { x: 0, y: 0 }]]), shapes: [], constraints: [] }), null, 'an empty drawing has no print layout');
  assert.deepStrictEqual([scaleText(5), scaleText(1), scaleText(0.02)], ['5:1', '1:1', '1:50']);
  assert.strictEqual(titleLine({ name: 'Plate', unit: 'in', date: '1/2/2026', plan }), 'Plate  ·  Units: in  ·  1/2/2026  ·  Scale 2:1 (print at 100%)  ·  Sketch Studio');
  assert.strictEqual(titleLine({ name: '', unit: 'mm', date: 'd', plan: null }), 'Untitled  ·  Units: mm  ·  d  ·  Not to scale  ·  Sketch Studio');
}

// ── 5. bounds without construction ──
{
  const st = { joints: new Map([['a', J(0, 0)], ['b', J(10, 0)], ['c', J(100, 50)]]), shapes: [{ id: 's', type: 'line', joints: ['a', 'b'] }, { id: 'k', type: 'line', joints: ['a', 'c'], isConstruction: true }], constraints: [] };
  assert.deepStrictEqual([computeGeometryBounds(st).maxX, computeGeometryBounds(st).maxY], [100, 50], 'default: construction counts (unchanged)');
  assert.deepStrictEqual([computeGeometryBounds(st, { construction: false }).maxX, computeGeometryBounds(st, { construction: false }).maxY], [10, 0], 'construction: false leaves it out');
}

console.log('build-stage-725-node.test.js passed');
