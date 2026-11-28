// tests/recipes-1049-node.test.js — TASK 1049: the Center Rectangle, 3-Point Rectangle and slot RECIPES built like Fusion 360's (owner-approved
// 2026-11-27; the recipe parity audit 1037, docs/RECIPE-PARITY-1037.md on origin/agents/recipe-parity-1037, D-2 / D-3 / D-6). Drawn through the
// app's own ribbon button, variant row and real pointer events in the node kit (tests/helpers/node-app.js), at the audit's clicks and view.
// FUSION, as recorded by the advisor (.evidence/1037/shp_results.json, md5 ac676a7711e32820da45811ed8c52b52):
//   ShapeRectangleCenter     Horizontal(Line0) Perpendicular(Line1,Line0) Parallel(Line2,Line0) Parallel(Line3,Line1)
//                            + construction Line4 / Line5 (the diagonals, corner to corner) + the lone centre Coincident on both;  DOF 4
//   ShapeRectangleThreePoint Perpendicular(Line1,Line0) Parallel(Line2,Line0) Parallel(Line3,Line1);                                DOF 5
//   the 5 slots              dims 0 (no width dimension);  DOF 4 (straight, with the inferred Horizontal), 6 (arc)
// Parts:
//   A  Center Rectangle: H on the first side + Perpendicular + Parallel x2, the diagonals and the centre on them kept; DOF 4; its glyphs; delete the
//      Horizontal: DOF 5, a corner drag ROTATES it and it stays a rectangle (every angle 90)
//   B  3-Point Rectangle: Perpendicular + Parallel x2, no redundant row (DOF 5 = 8 unknowns - 3 rows); its glyphs; delete the Perpendicular:
//      DOF 6, a corner drag leaves a PARALLELOGRAM (opposite sides parallel, the angle off 90)
//   C  the 5 slots: untyped width = NO width dimension, Fusion's DOF; a TYPED width = one driving diameter dimension at the typed value (DOF - 1)
//   D  typed sizes on the new recipes: the centre rect's W x H and the 3-point rect's length / height dimensions are driving, the DOF falls by 2
//   E  old files: a centre rect (H, V, H, V), a 3-point rect (4 perpendiculars) and a slot with its width dimension, saved before, load
//      UNCHANGED (no conversion) and still work (DOF, a corner drag keeps 90, the width dimension edits the slot)
//   F  undo / redo: each new shape is ONE step; redo gives back the same recipe; the stored design reopened has it
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { CONSTRAINT_TYPES as T } from '#core/constants.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';
import { makeSlotCenterToCenter } from '#core/slot.js';

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

// the audit's view and clicks (tests/audits/recipe-parity-1037-node.mjs: Fusion cm -> world mm, Y flipped, a cell away from the origin and axes)
const OX = 50, OY = -40;
const W = ([x, y]) => ({ x: OX + 10 * x, y: OY - 10 * y });
const CLICKS = {
  'rect-center': [[2, 1], [4, 2.5]],
  'rect-3pt': [[0, 0], [4, 1], [3.5, 3]],
  'slot-c2c': [[0, 1], [4, 1], [4, 1.8]],
  'slot-overall': [[0, 1], [4, 1], [4, 1.8]],
  'slot-center': [[2, 1], [4, 1], [4, 1.8]],
  'slot-arc-3pt': [[0, 0], [4, 0], [2, 1.5], [2, 1.9]],
  'slot-arc-center': [[2, 0], [4, 0], [2, 2], [2, 2.4]],
};
const FUSION_DOF = { 'rect-center': 4, 'rect-3pt': 5, 'slot-c2c': 4, 'slot-overall': 4, 'slot-center': 4, 'slot-arc-3pt': 6, 'slot-arc-center': 6 };

const sketch1 = 'sketch-1';
async function openApp(opts = {}) {
  const app = await open({ host: 'sketchstudio', ...opts });
  const r = app.svg.getBoundingClientRect(), v = app.state.view;
  Object.assign(v, { x: OX + 20, y: OY - 15, w: 160 }); v.h = v.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${v.x - v.w / 2} ${v.y - v.h / 2} ${v.w} ${v.h}`);
  app.frames(2);
  return app;
}
function pickTool(app, tool, variant) {
  app.tool(tool);
  const item = app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${variant}"]`);
  assert(item, 'no ribbon variant row ' + variant);
  item.click(); app.frames(2);
  assert.strictEqual(app.state[tool === 'rect' ? 'rectMode' : 'slotMode'], variant, `the ${variant} row picks the variant`);
}
const clk = (app, w) => { const p = app.toScreen(w.x, w.y); app.move(p.x, p.y); app.click(p.x, p.y); };
/** the variant drawn by its clicks; `width` typed in the slot's width box (after the last-but-one click) and Enter instead of the last click */
function draw(app, variant, { width = null } = {}) {
  pickTool(app, variant.startsWith('rect') ? 'rect' : 'slot', variant);
  const pts = CLICKS[variant].map(W);
  const last = pts.length - 1;
  pts.forEach((w, i) => {
    if (i < last || width === null) { clk(app, w); return; }
    const p = app.toScreen(w.x, w.y); app.move(p.x, p.y);
    app.type(String(width)); app.enter();
  });
  app.esc(); app.esc(); app.frames(2);
}
const S = (app) => app.state;
const J = (app, id) => app.state.joints.get(id);
const sides = (app) => app.state.shapes.filter((s) => s.type === 'line' && !s.isConstruction);
const kinds = (app) => app.state.constraints.map((c) => c.type).sort().join(',');
const dof = (app) => analyzeConstraintStatus(app.state).dof;
const nullity = (app) => app.engine.jointFreedom().nullity;
const dists = (app) => app.state.constraints.filter((c) => c.type === T.DISTANCE);
const glyphs = (app) => { const m = {}; for (const g of app.svg.querySelectorAll('g.constraint-glyph')) { const t = g.getAttribute('data-ctype'); m[t] = (m[t] || 0) + 1; } return m; };
const dir = (app, l) => { const a = J(app, l.joints[0]), b = J(app, l.joints[1]); return [b.x - a.x, b.y - a.y]; };
const cosOf = (app, l1, l2) => { const u = dir(app, l1), v = dir(app, l2); return (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)); };
const sinOf = (app, l1, l2) => { const u = dir(app, l1), v = dir(app, l2); return (u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v)); };
const right = (app, ls) => ls.every((l, i) => Math.abs(cosOf(app, l, ls[(i + 1) % 4])) < 1e-6);
const tiltDeg = (app, l) => { const [x, y] = dir(app, l); return Math.abs(Math.atan2(y, x) * 180 / Math.PI) % 180; };
const samePair = (a, b) => a && b && a.length === 2 && b.length === 2 && ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]));
const find = (app, type, pair) => app.state.constraints.find((c) => c.type === type && samePair(c.shapes, pair));
/** Select + Delete on one constraint: the key's own path (#core/delete-manager.js deleteSelection) */
function deleteConstraint(app, c) {
  app.tool('select'); app.esc();
  app.state.selectedConstraints.clear(); app.state.selectedJoints.clear(); app.state.selectedShapes.clear();
  app.state.selectedConstraints.add(c); app.frames();
  app.key('Delete'); app.frames(2);
}
function dragCorner(app, id, dx, dy) {
  app.tool('select'); app.esc();
  const j = J(app, id), a = app.toScreen(j.x, j.y), b = app.toScreen(j.x + dx, j.y + dy);
  app.drag(a, b, 10); app.frames(3);
}

// ------------------------------------------------------------------------------------------------ A Center Rectangle
{
  const app = await openApp();
  try {
    draw(app, 'rect-center');
    const [s1, s2, s3, s4] = sides(app);
    const diags = app.state.shapes.filter((s) => s.type === 'line' && s.isConstruction);
    check(kinds(app) === 'horizontal,parallel,parallel,perpendicular,pointOnLine,pointOnLine', `A centre rect: Fusion's recipe H + Perpendicular + Parallel x2 (+ the centre's 2 pointOnLine): ${kinds(app)}`);
    const h = app.state.constraints.find((c) => c.type === T.HORIZONTAL);
    check(h && samePair(h.joints, s1.joints), 'A centre rect: the ONE Horizontal is on the first side (Fusion Horizontal(Line0))');
    check(!!find(app, T.PERPENDICULAR, [s2.id, s1.id]), 'A centre rect: Perpendicular(side 2, side 1) (Fusion Perpendicular(Line1,Line0))');
    check(!!find(app, T.PARALLEL, [s3.id, s1.id]) && !!find(app, T.PARALLEL, [s4.id, s2.id]), 'A centre rect: Parallel(side 3, side 1) and Parallel(side 4, side 2) (Fusion Parallel(Line2,Line0), Parallel(Line3,Line1))');
    const corners = new Set([s1, s2, s3, s4].flatMap((l) => l.joints));
    const centre = [...app.state.joints.keys()].find((id) => id !== 'j_origin' && !app.state.shapes.some((s) => s.joints.includes(id)));
    check(diags.length === 2 && diags.every((d) => d.joints.every((j) => corners.has(j))) && diags[0].joints.every((j) => !diags[1].joints.includes(j)),
      'A centre rect: the 2 construction diagonals kept, corner to opposite corner (Fusion Line4 / Line5)');
    check(!!centre && diags.every((d) => app.state.constraints.some((c) => c.type === T.POINT_ON_LINE && c.joint === centre && c.shape === d.id)),
      'A centre rect: the lone centre point on both diagonals (Fusion Coincident(centre, Line4 / Line5))');
    check(dof(app) === FUSION_DOF['rect-center'] && nullity(app) === 4, `A centre rect: DOF ${dof(app)} (solver ${nullity(app)}) = Fusion 4`);
    const g = glyphs(app);
    check(g.horizontal === 1 && !g.vertical && g.perpendicular === 2 && g.parallel === 4, `A centre rect: its glyphs H 1 + perpendicular + parallel, no vertical: ${JSON.stringify(g)}`);
    // the first edit: delete the Horizontal, drag a corner: it ROTATES and stays a rectangle (Fusion); H, V, H, V tilted one side (a trapezoid)
    deleteConstraint(app, h);
    check(!app.state.constraints.includes(h) && dof(app) === 5, `A centre rect, its Horizontal deleted: DOF ${dof(app)} (Fusion 5)`);
    dragCorner(app, s1.joints[1], 0, -6);
    check(right(app, [s1, s2, s3, s4]), `A centre rect, then a corner dragged up 6: every angle 90 (cos ${[s1, s2, s3, s4].map((l, i) => cosOf(app, l, [s1, s2, s3, s4][(i + 1) % 4]).toExponential(1)).join(' ')})`);
    check(tiltDeg(app, s1) > 1 && tiltDeg(app, s1) < 179, `A centre rect: it ROTATED (side 1 at ${tiltDeg(app, s1).toFixed(3)} deg)`);
    const m = J(app, centre), a = J(app, diags[0].joints[0]), b = J(app, diags[0].joints[1]);
    check(Math.abs((b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x)) < 1e-6, 'A centre rect: the centre is still on its diagonal');
  } finally { await app.close(); }
}

// ------------------------------------------------------------------------------------------------ B 3-Point Rectangle
{
  const app = await openApp();
  try {
    draw(app, 'rect-3pt');
    const [s1, s2, s3, s4] = sides(app);
    check(kinds(app) === 'parallel,parallel,perpendicular', `B 3-point rect: Fusion's recipe Perpendicular + Parallel x2: ${kinds(app)}`);
    check(!!find(app, T.PERPENDICULAR, [s2.id, s1.id]) && !!find(app, T.PARALLEL, [s3.id, s1.id]) && !!find(app, T.PARALLEL, [s4.id, s2.id]),
      'B 3-point rect: Perpendicular(side 2, side 1), Parallel(side 3, side 1), Parallel(side 4, side 2) (Fusion Line1/Line0, Line2/Line0, Line3/Line1)');
    const unknowns = 2 * new Set([s1, s2, s3, s4].flatMap((l) => l.joints)).size;
    check(dof(app) === FUSION_DOF['rect-3pt'] && nullity(app) === unknowns - app.state.constraints.length,
      `B 3-point rect: DOF ${dof(app)} = Fusion 5 = ${unknowns} unknowns - ${app.state.constraints.length} rows: no redundant row (4 perpendiculars had one)`);
    check(right(app, [s1, s2, s3, s4]), 'B 3-point rect: a rectangle as built');
    const g = glyphs(app);
    check(g.perpendicular === 2 && g.parallel === 4, `B 3-point rect: its glyphs 1 perpendicular + 2 parallel: ${JSON.stringify(g)} (was perpendicular 8)`);
    deleteConstraint(app, find(app, T.PERPENDICULAR, [s2.id, s1.id]));
    check(kinds(app) === 'parallel,parallel' && dof(app) === 6, `B 3-point rect, its Perpendicular deleted: DOF ${dof(app)} (Fusion model 6)`);
    dragCorner(app, s2.joints[1], 6, 0);
    const par = Math.abs(sinOf(app, s1, s3)) < 1e-6 && Math.abs(sinOf(app, s2, s4)) < 1e-6;
    const ang = Math.acos(Math.abs(cosOf(app, s1, s2))) * 180 / Math.PI;
    check(par && ang < 89, `B 3-point rect: a corner drag leaves a PARALLELOGRAM (opposite sides parallel ${par}, corner angle ${ang.toFixed(3)} deg), as Fusion`);
  } finally { await app.close(); }
}

// ------------------------------------------------------------------------------------------------ C the 5 slots: untyped and typed width
for (const variant of ['slot-c2c', 'slot-overall', 'slot-center', 'slot-arc-3pt', 'slot-arc-center']) {
  for (const width of [null, 7]) {
    const app = await openApp();
    try {
      draw(app, variant, { width });
      const arcs = app.state.shapes.filter((s) => s.type === 'arc' && !s.isConstruction);
      check(arcs.length >= 2, `C ${variant}${width ? ' typed width ' + width : ''}: drawn (${arcs.length} arcs)`);
      const d = dists(app);
      if (width === null) {
        check(d.length === 0, `C ${variant} untyped: NO width dimension (Fusion dims 0): ${d.length}`);
        check(dof(app) === FUSION_DOF[variant], `C ${variant} untyped: DOF ${dof(app)} = Fusion ${FUSION_DOF[variant]}`);
      } else {
        const wd = d.find((c) => c.isDiameter);
        check(d.length === 1 && wd && !wd.isDriven && !wd.driven && Math.abs(wd.value - width) < 1e-9, `C ${variant} typed ${width}: ONE driving width (diameter) dimension = ${wd && wd.value}`);
        const cap = wd && app.state.shapes.find((s) => s.id === wd.shape);
        const c0 = cap && J(app, cap.joints[0]), r0 = cap && J(app, cap.joints[1]);
        check(cap && Math.abs(2 * Math.hypot(r0.x - c0.x, r0.y - c0.y) - width) < 1e-6, `C ${variant} typed ${width}: the slot IS ${width} wide`);
        check(dof(app) === FUSION_DOF[variant] - 1, `C ${variant} typed: DOF ${dof(app)} = Fusion ${FUSION_DOF[variant]} - the typed width`);
      }
    } finally { await app.close(); }
  }
}

// ------------------------------------------------------------------------------------------------ D typed sizes on the new recipes
{
  const app = await openApp();
  try {
    pickTool(app, 'rect', 'rect-center');
    clk(app, W([2, 1])); const p = app.toScreen(W([4, 2.5]).x, W([4, 2.5]).y); app.move(p.x, p.y);
    app.type('40'); app.key('Tab'); app.type('20'); app.enter(); app.esc(); app.esc();
    const d = dists(app), [s1, s2, s3, s4] = sides(app);
    const len = (l) => Math.hypot(...dir(app, l));
    check(d.length === 2 && d.every((c) => !c.isDriven && !c.driven), `D centre rect typed 40 x 20: two DRIVING dimensions (${d.map((c) => c.value + (c.isDriven ? ' ref' : '')).join(', ')})`);
    check(Math.abs(len(s1) - 40) < 1e-6 && Math.abs(len(s2) - 20) < 1e-6 && dof(app) === 2, `D centre rect typed: 40 x 20 (${len(s1).toFixed(6)} x ${len(s2).toFixed(6)}), DOF ${dof(app)} (4 - 2)`);
  } finally { await app.close(); }
}
{
  const app = await openApp();
  try {
    pickTool(app, 'rect', 'rect-3pt');
    clk(app, W([0, 0])); let p = app.toScreen(W([4, 1]).x, W([4, 1]).y); app.move(p.x, p.y);
    app.type('40'); app.enter();
    p = app.toScreen(W([3.5, 3]).x, W([3.5, 3]).y); app.move(p.x, p.y);
    app.type('20'); app.enter(); app.esc(); app.esc();
    const d = dists(app), [s1, s2] = sides(app);
    const len = (l) => Math.hypot(...dir(app, l));
    check(d.length === 2 && d.every((c) => !c.isDriven && !c.driven), `D 3-point rect typed length 40, height 20: two DRIVING dimensions (${d.map((c) => c.value + (c.isDriven ? ' ref' : '')).join(', ')})`);
    check(Math.abs(len(s1) - 40) < 1e-6 && Math.abs(len(s2) - 20) < 1e-6 && dof(app) === 3, `D 3-point rect typed: 40 x 20 (${len(s1).toFixed(6)} x ${len(s2).toFixed(6)}), DOF ${dof(app)} (5 - 2)`);
  } finally { await app.close(); }
}

// ------------------------------------------------------------------------------------------------ E old files load unchanged
{
  // a centre rect and a 3-point rect as the makers built them before task 1049 (task 1045 shared corners), and a slot with the width dimension
  // every slot had before (the core maker, asked for its width dimension, builds that same structure)
  const sj = (id, x, y, extra = {}) => [id, { x, y, sketchId: sketch1, ...extra }];
  const L = (id, a, b, extra = {}) => ({ id, type: 'line', joints: [a, b], sketchId: sketch1, groupId: extra.g, isConstruction: !!extra.c });
  const joints = [sj('j_origin', 0, 0, { fixed: true }),
    sj('a1', 60, -60), sj('a2', 100, -60), sj('a3', 100, -40), sj('a4', 60, -40), sj('am', 80, -50, { orphanAllowed: true }),
    sj('b1', 60, -10), sj('b2', 100, 0), sj('b3', 95, 20), sj('b4', 55, 10)];
  const shapes = [L('A1', 'a1', 'a2', { g: 'rect_oa' }), L('A2', 'a2', 'a3', { g: 'rect_oa' }), L('A3', 'a4', 'a3', { g: 'rect_oa' }), L('A4', 'a1', 'a4', { g: 'rect_oa' }),
    L('Ad1', 'a1', 'a3', { g: 'rect_oa', c: true }), L('Ad2', 'a2', 'a4', { g: 'rect_oa', c: true }),
    L('B1', 'b1', 'b2', { g: 'rect_ob' }), L('B2', 'b2', 'b3', { g: 'rect_ob' }), L('B3', 'b4', 'b3', { g: 'rect_ob' }), L('B4', 'b1', 'b4', { g: 'rect_ob' })];
  const constraints = [{ type: 'horizontal', joints: ['a1', 'a2'] }, { type: 'vertical', joints: ['a2', 'a3'] }, { type: 'horizontal', joints: ['a4', 'a3'] }, { type: 'vertical', joints: ['a1', 'a4'] },
    { type: 'pointOnLine', joint: 'am', shape: 'Ad1' }, { type: 'pointOnLine', joint: 'am', shape: 'Ad2' },
    { type: 'perpendicular', shapes: ['B1', 'B2'], branch: 1 }, { type: 'perpendicular', shapes: ['B2', 'B3'], branch: -1 }, { type: 'perpendicular', shapes: ['B3', 'B4'], branch: 1 }, { type: 'perpendicular', shapes: ['B4', 'B1'], branch: -1 }];
  // the slot: two end centres (20, 20) and (50, 20), width 10, its width dimension
  const slotJoints = new Map([['c1', { x: 20, y: 20 }], ['c2', { x: 50, y: 20 }]]);
  let n = 0;
  const slot = makeSlotCenterToCenter(slotJoints, 'c1', 'c2', 10, () => 'sj' + (++n), false, { widthDimension: true });
  for (const [id, j] of slotJoints) joints.push(sj(id, j.x, j.y));
  for (const s of slot.shapes) shapes.push({ ...s, sketchId: sketch1 });
  for (const c of slot.constraints) constraints.push(JSON.parse(JSON.stringify(c)));
  const saved = JSON.parse(JSON.stringify(constraints));
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'Old recipes 1049', { version: 3, hosts: {}, geometry: { joints, shapes, constraints, parameters: [], sketches: [{ id: sketch1, name: 'Sketch 1', visible: true }], activeSketchId: sketch1, groups: [], profiles: [] } });
  const app = await openApp({ profile });
  try {
    const strip = (cs) => JSON.stringify(cs.map((c) => { const o = {}; for (const k of Object.keys(c).sort()) if (!k.startsWith('__') && !['glyphPos', 'labelPos', 'id', 'name', 'isDriven', 'driven', 'drivenReason'].includes(k)) o[k] = c[k]; return o; }));
    const diff = saved.map((c, i) => [strip([c]), strip([app.state.constraints[i] || {}])]).filter(([a, b]) => a !== b);
    check(strip(app.state.constraints) === strip(saved), `E old files: every constraint loads UNCHANGED (${app.state.constraints.length}): ${app.state.constraints.map((c) => c.type).join(',')}${diff.length ? ' DIFF ' + JSON.stringify(diff) : ''}`);
    const wd = app.state.constraints.find((c) => c.isDiameter);
    check(!!wd && !wd.isDriven && !wd.driven, 'E old slot: its width dimension is kept, driving');
    // the whole sketch: centre rect 4 + 3-point rect 5 + slot (c2c, no inferred H: 5 free, - its width) 4 = 13
    check(dof(app) === 13, `E old files: DOF ${dof(app)} (centre rect 4 + 3-point rect 5 + slot 4, as before)`);
    const sideOf = (id) => app.state.shapes.find((s) => s.id === id);
    dragCorner(app, 'a3', 5, 4);
    check(right(app, ['A1', 'A2', 'A3', 'A4'].map(sideOf)) && tiltDeg(app, sideOf('A1')) < 1e-6, 'E old centre rect: a corner drag keeps it an axis-aligned rectangle (H, V, H, V)');
    dragCorner(app, 'b3', 5, 4);
    check(right(app, ['B1', 'B2', 'B3', 'B4'].map(sideOf)), 'E old 3-point rect: a corner drag keeps every angle 90 (4 perpendiculars)');
    const cap = app.state.shapes.find((s) => s.id === wd.shape);
    const edit = commitDimensionEdit(app.state, wd, '16'); app.engine.solve(); app.frames(2);
    const c0 = J(app, cap.joints[0]), r0 = J(app, cap.joints[1]);
    check(edit && edit.ok !== false && Math.abs(2 * Math.hypot(r0.x - c0.x, r0.y - c0.y) - 16) < 1e-4, `E old slot: its width dimension edited to 16 makes it 16 wide (${(2 * Math.hypot(r0.x - c0.x, r0.y - c0.y)).toFixed(6)})`);
  } finally { await app.close(); }
}

// ------------------------------------------------------------------------------------------------ F undo / redo / the stored design
for (const [variant, recipe] of [['rect-center', 'horizontal,parallel,parallel,perpendicular,pointOnLine,pointOnLine'], ['rect-3pt', 'parallel,parallel,perpendicular'],
  ['slot-c2c', 'distance-free'], ['slot-arc-3pt', 'distance-free']]) {
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'Recipes 1049'); // a named design autosaves: the reopen reads it back
  let app = await openApp({ profile });
  try {
    const h = app.state.history.length;
    draw(app, variant);
    const after = kinds(app);
    check(recipe === 'distance-free' ? !dists(app).length : after === recipe, `F ${variant}: drawn with its recipe (${after})`);
    check(app.state.history.length === h + 1, `F ${variant}: ONE undo step (${app.state.history.length - h})`);
    app.undo();
    check(kinds(app) === '' && !app.state.shapes.some((s) => !String(s.id).startsWith('ref_')), `F ${variant}: undo removes it (${kinds(app) || 'nothing left'})`);
    app.redo();
    check(kinds(app) === after, `F ${variant}: redo gives the same recipe back (${kinds(app)})`);
    await app.storedDoc(); await app.close();
    app = await openApp({ profile });
    check(kinds(app) === after, `F ${variant}: the stored design reopened has the same constraints (${kinds(app)})`);
  } finally { await app.close(); }
}

if (fails.length) { console.log(`\n${fails.length} FAIL(s)`); process.exit(1); }
console.log('\nrecipes-1049-node: all ok');
