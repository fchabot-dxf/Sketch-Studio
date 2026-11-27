// tests/audits/recipe-parity-1037-node.mjs — TASK 1037 (AUDIT ONLY, outside the gate): are our compound shapes built from the same parts and
// constraints as Fusion 360's? For each of the 16 Fusion cases measured by the advisor (.evidence/1037/shp_results.json, produced by
// .evidence/1037/shp_step.py with Fusion's own commands and the real mouse), this draws the SAME shape with OUR tool and variant in the real
// SketchStudio page (tests/helpers/node-app.js: the ribbon's own buttons and variant rows, real pointer events) and dumps what it built:
// curves (+ construction), joints (shared or separate + coincident), lone points, every constraint with what it binds, dimensions, the
// visible glyphs, and the degrees of freedom: OURS from the solver (engine.jointFreedom().nullity, the ground-truth nullspace of task 496)
// and, for BOTH sides, from one independent numeric model (section MODEL below: the Jacobian rank of the recipe's equations), so the Fusion
// DOF is computed by the same code that is checked against our solver on our recipes.
// "Inferred" constraints: each case is drawn a second time with every click rotated 7 degrees about the first click; a constraint kind
// whose count changes is one the drawing DIRECTION put there (H / V inference), not the shape's own recipe.
// Then the behaviour probes (section PROBES) that back each (c) of docs/RECIPE-PARITY-1037.md.
// Run: node tests/audits/recipe-parity-1037-node.mjs  [--fusion <shp_results.json>] [--json <file>]   (default recording: .evidence/1037/shp_results.json)
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from '../helpers/node-app.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';
import { modelDof, fusionModel, oursModel } from './recipe-parity-1037-kit.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fusionAt = process.argv.indexOf('--fusion'); // the advisor's Fusion recording (local evidence, never committed)
const FUSION_FILE = fusionAt > 0 ? process.argv[fusionAt + 1] : path.join(REPO, '.evidence', '1037', 'shp_results.json');
const FUSION_TEXT = fs.readFileSync(FUSION_FILE, 'utf8');
const FUSION = JSON.parse(FUSION_TEXT);
const out = [];
const log = (s) => { out.push(s); console.log(s); };
const r3 = (v) => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------------------------------------ the cases (Fusion command -> our tool)
// Clicks are Fusion's (cm, Y up, shp_step.py CASES). Ours: world mm, Y down: (OX + 10 x, OY - 10 y), a cell away from the origin and axes.
const OX = 50, OY = -40;
const CASES = [
  { fusion: 'ShapeRectangleTwoPoint', tool: 'rect', variant: 'rect-2pt', clicks: [[0, 0], [4, 2.5]] },
  { fusion: 'ShapeRectangleCenter', tool: 'rect', variant: 'rect-center', clicks: [[2, 1], [4, 2.5]] },
  { fusion: 'ShapeRectangleThreePoint', tool: 'rect', variant: 'rect-3pt', clicks: [[0, 0], [4, 1], [3.5, 3]] },
  { fusion: 'CircleCenterRadius', tool: 'circle', clicks: [[2, 1], [3.5, 1]] },
  { fusion: 'CircleTwoPoint', none: 'no 2-point circle variant (the Circle tool is centre + radius only: packages/ui/input-handlers/circle-tool.js, no circle mode in packages/core/constants.js)' },
  { fusion: 'CircleThreePoint', none: 'no 3-point circle variant (as above)' },
  { fusion: 'ArcThreePoint', tool: 'arc', variant: 'arc-3pt', clicks: [[0, 0], [4, 0], [2, 1.5]] },
  { fusion: 'ArcCenterTwoPoint', tool: 'arc', variant: 'arc-cse', clicks: [[2, 0], [4, 0], [2, 2]] },
  { fusion: 'ShapePolygonInscribed', tool: 'polygon', clicks: [[2, 1], [3.5, 1]] },
  { fusion: 'ShapePolygonCircumscribed', none: 'no circumscribed polygon variant (the Polygon tool: centre, then a CORNER: packages/ui/input-handlers/polygon-tool.js createPolygon)' },
  { fusion: 'ShapePolygonEdge', none: 'no edge polygon variant (as above)' },
  { fusion: 'ShapeSlotCenterToCenter', tool: 'slot', variant: 'slot-c2c', clicks: [[0, 1], [4, 1], [4, 1.8]] },
  { fusion: 'ShapeSlotOverall', tool: 'slot', variant: 'slot-overall', clicks: [[0, 1], [4, 1], [4, 1.8]] },
  { fusion: 'ShapeSlotCenterPoint', tool: 'slot', variant: 'slot-center', clicks: [[2, 1], [4, 1], [4, 1.8]] },
  { fusion: 'ShapeArcSlotThreePoint', tool: 'slot', variant: 'slot-arc-3pt', clicks: [[0, 0], [4, 0], [2, 1.5], [2, 1.9]] },
  { fusion: 'ShapeArcSlotCenterTwoPoint', tool: 'slot', variant: 'slot-arc-center', clicks: [[2, 0], [4, 0], [2, 2], [2, 2.4]] },
];

// ------------------------------------------------------------------------------------------------ driving our app
async function openFresh() {
  const app = await open({ host: 'sketchstudio' });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: OX + 20, y: OY - 15, w: 160 });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}
const toWorld = ([x, y]) => ({ x: OX + 10 * x, y: OY - 10 * y });
const rotAbout = (p, o, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return { x: o.x + (p.x - o.x) * c - (p.y - o.y) * s, y: o.y + (p.x - o.x) * s + (p.y - o.y) * c }; };
/** pick the tool (its ribbon button) and the variant (its row in the button's menu), as a user does */
function pickTool(app, tool, variant) {
  app.tool(tool);
  if (variant) {
    const item = app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${variant}"]`);
    if (!item) throw new Error('no ribbon variant row ' + variant);
    item.click(); app.frames(2);
    const key = { rect: 'rectMode', slot: 'slotMode', arc: 'arcMode' }[tool];
    if (app.state[key] !== variant) throw new Error(`variant ${variant} not set (${app.state[key]})`);
  }
}
async function drawCase(cs, { rotate = 0 } = {}) {
  const app = await openFresh();
  pickTool(app, cs.tool, cs.variant);
  const pts = cs.clicks.map(toWorld);
  const o = pts[0];
  const ws = rotate ? pts.map((p) => rotAbout(p, o, rotate)) : pts;
  for (const w of ws) { const p = app.toScreen(w.x, w.y); app.move(p.x, p.y); app.click(p.x, p.y); }
  app.esc(); app.frames(2);
  return { app, clicksWorld: ws };
}

// ------------------------------------------------------------------------------------------------ dumping our state
function dumpOurs(app) {
  const st = app.state;
  const shapes = st.shapes.filter((s) => !s.textOutline);
  const name = new Map(); const counters = {};
  const short = { line: 'L', arc: 'A', circle: 'C', bezier: 'B' };
  shapes.forEach((s, i) => { name.set(s.id, (short[s.type] || s.type) + i); });
  const roles = (s) => s.type === 'line' ? ['s', 'e'] : s.type === 'arc' ? ['c', 's', 'e'] : s.type === 'circle' ? ['c'] : ['s', 'e'];
  const ports = new Map(); // joint id -> [port names]
  for (const s of shapes) roles(s).forEach((r, k) => { const j = s.joints[k]; if (!ports.has(j)) ports.set(j, []); ports.get(j).push(name.get(s.id) + '.' + r); });
  const J = (id) => st.joints.get(id);
  const pt = (id) => { const j = J(id); return j ? `(${r3(j.x)},${r3(j.y)})` : '?'; };
  const lone = [...st.joints.keys()].filter((id) => id !== 'j_origin' && !ports.has(id));
  const jn = (id) => id === 'j_origin' ? 'ORIGIN' : ports.has(id) ? ports.get(id).join('=') : 'pt' + pt(id);
  const sn = (id) => name.get(id) || (id === 'axis_x' || id === 'axis_y' ? id : '?' + id);
  const cons = st.constraints.map((c) => {
    const parts = [];
    if (c.joints) parts.push(...c.joints.map(jn));
    if (c.joint) parts.push(jn(c.joint));
    if (c.shape) parts.push(sn(c.shape));
    if (c.shapes) parts.push(...c.shapes.map(sn));
    if (c.line) parts.push(sn(c.line));
    if (c.circle) parts.push(sn(c.circle));
    const flags = [];
    if (c.type === CONSTRAINT_TYPES.DISTANCE) { flags.push((c.isDriven || c.driven) ? 'DRIVEN' : 'DRIVING'); if (c.isDiameter) flags.push('dia'); else if (c.isRadius) flags.push('rad'); flags.push('v=' + r3(c.value)); }
    if (c.branch) flags.push(c.branch);
    return `${c.type}(${parts.join(',')})${flags.length ? '[' + flags.join(' ') + ']' : ''}`;
  });
  // joints where two parts meet: SHARED (one joint id, several ports) or SEPARATE (several ids joined by a coincident)
  const shared = [...ports.entries()].filter(([, p]) => p.length > 1).map(([, p]) => p.join('='));
  const coincidentPairs = st.constraints.filter((c) => c.type === CONSTRAINT_TYPES.COINCIDENT).length;
  const glyphs = {};
  for (const g of app.svg.querySelectorAll('g.constraint-glyph')) { const t = g.getAttribute('data-ctype'); glyphs[t] = (glyphs[t] || 0) + 1; }
  const curves = shapes.map((s) => ({ id: name.get(s.id), type: s.type, construction: !!s.isConstruction, joints: roles(s).map((r, k) => r + pt(s.joints[k])).join(' '), ...(s.type === 'circle' ? { r: r3(s.radius) } : {}) }));
  return { shapes, curves, joints: st.joints.size - 1, lone: lone.map(pt), shared, coincidentPairs, cons, glyphs, name, ports };
}
const typeCount = (cons) => cons.reduce((m, c) => { const t = c.split('(')[0]; m[t] = (m[t] || 0) + 1; return m; }, {});

// ------------------------------------------------------------------------------------------------ run the 16 cases
const results = {};
log(`Fusion recording ${FUSION_FILE} md5 ${crypto.createHash('md5').update(fs.readFileSync(FUSION_FILE)).digest('hex')}`);
log('=== RECIPES (Fusion as recorded | ours as built) ===');
for (const cs of CASES) {
  const F = FUSION[cs.fusion];
  const fm = fusionModel(F);
  const fd = modelDof(fm);
  log(`\n## ${cs.fusion}`);
  log(`FUSION curves: ${F.curves.map((c) => c.id + (c.construction ? '(constr)' : '')).join(' ')} | points ${F.points} (model ${fm.pointCount}) lone ${JSON.stringify(F.lonePoints)} | dims ${F.dimensions.length}`);
  log(`FUSION constraints: ${F.constraints.join(' ')}`);
  log(`FUSION model: unknowns ${fd.unknowns} equations ${fd.equations} rank ${fd.rank} DOF ${fd.dof} residual ${fd.residual.toExponential(1)}`);
  if (cs.none) { log(`OURS: NONE: ${cs.none}`); results[cs.fusion] = { fusion: { dof: fd.dof }, ours: null, none: cs.none }; continue; }
  const { app, clicksWorld } = await drawCase(cs);
  let D, nullity, od;
  try {
    D = dumpOurs(app);
    nullity = app.engine.jointFreedom().nullity;
    od = modelDof(oursModel(app));
  } finally { await app.close(); }
  const { app: appR } = await drawCase(cs, { rotate: 7 });
  let DR, nullR;
  try { DR = dumpOurs(appR); nullR = appR.engine.jointFreedom().nullity; } finally { await appR.close(); }
  const tc = typeCount(D.cons), tcR = typeCount(DR.cons);
  const inferred = [...new Set([...Object.keys(tc), ...Object.keys(tcR)])].filter((t) => (tc[t] || 0) !== (tcR[t] || 0)).map((t) => `${t} ${tc[t] || 0}->${tcR[t] || 0}`);
  log(`OURS clicks (world mm): ${clicksWorld.map((p) => `(${r3(p.x)},${r3(p.y)})`).join(' ')}`);
  log(`OURS curves: ${D.curves.map((c) => `${c.id}:${c.type}${c.construction ? '(constr)' : ''}`).join(' ')}`);
  for (const c of D.curves) log(`   ${c.id} ${c.type}${c.construction ? ' construction' : ''} ${c.joints}${c.r != null ? ' r=' + c.r : ''}`);
  log(`OURS joints ${D.joints} | shared ${D.shared.length ? D.shared.join(' ') : 'none'} | coincident constraints ${D.coincidentPairs} | lone ${JSON.stringify(D.lone)}`);
  log(`OURS constraints (${D.cons.length}): ${D.cons.join(' ')}`);
  log(`OURS type counts: ${JSON.stringify(tc)} | rotated 7deg: ${JSON.stringify(tcR)} | direction-inferred: ${inferred.length ? inferred.join(', ') : 'none'}`);
  log(`OURS visible glyphs (nothing selected): ${JSON.stringify(D.glyphs)}`);
  log(`OURS DOF: solver nullity ${nullity} (rotated ${nullR}) | model: unknowns ${od.unknowns} equations ${od.equations} rank ${od.rank} DOF ${od.dof} residual ${od.residual.toExponential(1)}`);
  results[cs.fusion] = { fusion: { dof: fd.dof, points: F.points }, ours: { dof: nullity, dofRotated: nullR, modelDof: od.dof, joints: D.joints, cons: D.cons, inferred, glyphs: D.glyphs } };
}

log('\n=== DOF SUMMARY ===');
for (const [k, v] of Object.entries(results)) log(`DOF ${k}: fusion ${v.fusion.dof} | ours ${v.ours ? `${v.ours.dof} (model ${v.ours.modelDof}, rotated ${v.ours.dofRotated})` : 'n/a'}`);

// ------------------------------------------------------------------------------------------------ PROBES (the behaviour behind each finding)
// Each probe line starts with its id (P-xx) so the doc can quote it. Geometry is read from the state after the app's own solve.
const caseOf = (id) => CASES.find((c) => c.fusion === id);
const shapesOf = (app) => app.state.shapes.filter((s) => !s.textOutline);
const Jx = (app, id) => app.state.joints.get(id);
const angleDeg = (app, l1, l2) => { const a = Jx(app, l1.joints[0]), b = Jx(app, l1.joints[1]), c = Jx(app, l2.joints[0]), d = Jx(app, l2.joints[1]);
  const u = [b.x - a.x, b.y - a.y], v = [d.x - c.x, d.y - c.y]; return Math.acos(Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))) * 180 / Math.PI; };
const dofOf = (app) => app.engine.jointFreedom().nullity;
const panelDof = (app) => analyzeConstraintStatus({ joints: app.state.joints, shapes: app.state.shapes, constraints: app.state.constraints }).dof;
const glyphCount = (app) => { const m = {}; for (const g of app.svg.querySelectorAll('g.constraint-glyph')) { const t = g.getAttribute('data-ctype'); m[t] = (m[t] || 0) + 1; } return m; };
const dragJoint = (app, id, dx, dy) => { const j = Jx(app, id); const a = app.toScreen(j.x, j.y), b = app.toScreen(j.x + dx, j.y + dy); app.tool('select'); app.drag(a, b, 10); app.frames(2); };
const fusionDofWithout = (id, drop) => { const m = fusionModel({ ...FUSION[id], constraints: FUSION[id].constraints.filter((k) => !drop.test(k)) }); return modelDof(m).dof; };

log('\n=== PROBES ===');
{ // P-01 rect 2-point: separate joints + coincident vs Fusion's shared corner. A corner drag; what a selected corner shows.
  const { app } = await drawCase(caseOf('ShapeRectangleTwoPoint'));
  try {
    const [L0, L1, L2, L3] = shapesOf(app);
    log(`P-01 rect-2pt as built: DOF ours ${dofOf(app)} (Fusion model ${modelDof(fusionModel(FUSION.ShapeRectangleTwoPoint)).dof}); glyphs ${JSON.stringify(glyphCount(app))}`);
    dragJoint(app, L0.joints[1], 6, -4);
    const e = Jx(app, L0.joints[1]), s1 = Jx(app, L1.joints[0]);
    log(`P-01 drag L0.e by (+6,-4): L0.e (${r3(e.x)},${r3(e.y)}) L1.s (${r3(s1.x)},${r3(s1.y)}) together ${Math.hypot(e.x - s1.x, e.y - s1.y) < 1e-6}; angles L0/L1 ${r3(angleDeg(app, L0, L1))} L1/L2 ${r3(angleDeg(app, L1, L2))} L2/L3 ${r3(angleDeg(app, L2, L3))}`);
    { const j = Jx(app, L0.joints[1]); const p = app.toScreen(j.x, j.y); app.tool('select'); app.click(p.x, p.y); app.frames(2); }   // a click on the corner with Select
    log(`P-01 corner L0.e clicked with Select (selected joints ${app.state.selectedJoints.size}): visible glyphs ${JSON.stringify(glyphCount(app))} (Fusion: a shared point has no coincident to show)`);
  } finally { await app.close(); }
}
{ // P-02 rect centre: H,V,H,V (ours) vs H + Perpendicular + Parallel x2 (Fusion). Delete the Horizontal of the first side, drag a corner.
  const { app } = await drawCase(caseOf('ShapeRectangleCenter'));
  try {
    const [L0, L1, L2, L3] = shapesOf(app);
    const h = app.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.HORIZONTAL && c.joints.includes(L0.joints[0]) && c.joints.includes(L0.joints[1]));
    deleteConstraints(app.state, [h]); app.engine.solve(); app.frames(2);
    log(`P-02 rect-centre, its first side's Horizontal deleted: DOF ours ${dofOf(app)} | Fusion model without Horizontal(Line0): ${fusionDofWithout('ShapeRectangleCenter', /^Horizontal/)}`);
    dragJoint(app, L0.joints[1], 0, -6);
    log(`P-02 then drag that side's end up 6: angles L0/L1 ${r3(angleDeg(app, L0, L1))} L1/L2 ${r3(angleDeg(app, L1, L2))} L2/L3 ${r3(angleDeg(app, L2, L3))} L3/L0 ${r3(angleDeg(app, L3, L0))} (Fusion: Perpendicular(Line1,Line0) + Parallel x2 keep every angle 90)`);
  } finally { await app.close(); }
}
{ // P-03 rect 3-point: 4 perpendiculars (one redundant) vs Perpendicular + Parallel x2; the solver DOF vs the true DOF; an opposite-side dimension.
  const oppositeDims = (app) => { const [L0, , L2] = shapesOf(app); const len = (l) => { const a = Jx(app, l.joints[0]), b = Jx(app, l.joints[1]); return Math.hypot(b.x - a.x, b.y - a.y); };
    const kind = (d) => d ? (!d.isDriven && !d.driven ? 'DRIVING' : 'reference') : 'refused';
    const d0 = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [L0.joints[0], L0.joints[1]], value: len(L0) }, { source: 'test' });
    const d2 = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [L2.joints[0], L2.joints[1]], value: len(L2) }, { source: 'test' });
    return `side L0 ${kind(d0)}, opposite side L2 (equal by the rectangle) ${kind(d2)}`; };
  for (const [label, id, drag] of [['rect-3pt as built', 'ShapeRectangleThreePoint', false], ['rect-3pt after a corner drag', 'ShapeRectangleThreePoint', true],
    ['control rect-2pt as built', 'ShapeRectangleTwoPoint', false], ['control rect-2pt after a corner drag', 'ShapeRectangleTwoPoint', true]]) {
    const { app } = await drawCase(caseOf(id));
    try {
      const before = new Set(app.state.constraints);
      if (drag) dragJoint(app, shapesOf(app)[1].joints[1], 3, 2);
      const added = app.state.constraints.filter((c) => !before.has(c)).map((c) => c.type);
      log(`P-03 ${label}${drag ? ` (third corner +3,+2; the drag added ${added.length ? added.join(',') : 'nothing'})` : ''}: solver nullity ${dofOf(app)} | Design panel DOF ${panelDof(app)} | model (ours) ${modelDof(oursModel(app)).dof} | Fusion model ${modelDof(fusionModel(FUSION[id])).dof} | angles ${r3(angleDeg(app, shapesOf(app)[0], shapesOf(app)[1]))} ${r3(angleDeg(app, shapesOf(app)[1], shapesOf(app)[2]))} | dimensions: ${oppositeDims(app)}`);
    } finally { await app.close(); }
  }
  { // P-03b fully define the 3-point rectangle (corner on the origin, its base Horizontal, both side lengths): true DOF 0
    const { app: a3 } = await drawCase(caseOf('ShapeRectangleThreePoint'));
    try {
      const [L0, L1] = shapesOf(a3);
      const add = (t, p) => { ConstraintManager.createConstraint(a3.state, t, p, { source: 'test' }); a3.engine.solve(); a3.frames(2); return `model ${modelDof(oursModel(a3)).dof} solver ${dofOf(a3)}`; };
      const steps = [
        ['coincident(corner, origin)', add(CONSTRAINT_TYPES.COINCIDENT, { joints: [L0.joints[0], 'j_origin'] })],
        ['+ Horizontal(base)', add(CONSTRAINT_TYPES.HORIZONTAL, { joints: [L0.joints[0], L0.joints[1]] })],
        ['+ base 40', add(CONSTRAINT_TYPES.DISTANCE, { joints: [L0.joints[0], L0.joints[1]], value: 40 })],
        ['+ side 20', add(CONSTRAINT_TYPES.DISTANCE, { joints: [L1.joints[0], L1.joints[1]], value: 20 })],
      ];
      log(`P-03b rect-3pt, DOF after each step (true = model): ${steps.map(([a, b]) => `${a}: ${b}`).join(' | ')}`);
      const st = analyzeConstraintStatus({ joints: a3.state.joints, shapes: a3.state.shapes, constraints: a3.state.constraints });
      const lines = shapesOf(a3).filter((s) => s.type === 'line');
      log(`P-03b at the end: Design panel DOF ${st.dof} | lines drawn fully constrained ${lines.filter((s) => st.fixedShapes.has(s.id)).length}/${lines.length}; angles ${r3(angleDeg(a3, lines[0], lines[1]))} ${r3(angleDeg(a3, lines[1], lines[2]))}`);
    } finally { await a3.close(); }
  }

}
{ // P-04 polygon: N construction radii + 2(N-1) equal (ours) vs ONE Polygon constraint and no construction (Fusion).
  const { app } = await drawCase(caseOf('ShapePolygonInscribed'));
  try {
    const constr = shapesOf(app).filter((s) => s.isConstruction);
    log(`P-04 polygon: construction lines ${constr.length} (Fusion 0); constraints ${app.state.constraints.length} (Fusion 1: Polygon); glyphs ${JSON.stringify(glyphCount(app))}`);
    const eq = app.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.EQUAL);
    deleteConstraints(app.state, [eq]); app.engine.solve(); app.frames(2);
    log(`P-04 delete ONE equal (the user's Delete on one glyph): DOF ${dofOf(app)} (was 4): the polygon is no longer regular. Fusion: the one Polygon constraint goes as a whole (model without it: ${fusionDofWithout('ShapePolygonInscribed', /^Polygon/)})`);
  } finally { await app.close(); }
}
for (const id of ['ShapeSlotCenterToCenter', 'ShapeSlotOverall', 'ShapeSlotCenterPoint', 'ShapeArcSlotThreePoint', 'ShapeArcSlotCenterTwoPoint']) { // P-05 / P-06 the slot's width dimension
  const { app } = await drawCase(caseOf(id));
  try {
    const w = app.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.DISTANCE);
    const before = { solver: dofOf(app), model: modelDof(oursModel(app)).dof };
    deleteConstraints(app.state, [w]); app.engine.solve(); app.frames(2);
    log(`${id.includes('Arc') ? 'P-06' : 'P-05'} ${id}: width dimension ${w ? (w.isDriven || w.driven ? 'REFERENCE' : 'DRIVING') + ' ' + r3(w.value) : 'none'}; DOF with it: solver ${before.solver} model ${before.model}; deleted: solver ${dofOf(app)} model ${modelDof(oursModel(app)).dof} | Fusion model ${modelDof(fusionModel(FUSION[id])).dof}`);
  } finally { await app.close(); }
}
{ // P-07 arc slot: 3 tangents (ours) vs 4 (Fusion). The recipe's rank, with and without the 4th tangent; the glyphs; a width edit.
  for (const id of ['ShapeArcSlotThreePoint', 'ShapeArcSlotCenterTwoPoint']) {
    const { app } = await drawCase(caseOf(id));
    try {
      const sh = shapesOf(app); const [ao, e2, ai, e1, ac] = sh; // core/slot.js buildArcSlotCore returns [ao, e2, ai, e1, ac]
      const m = oursModel(app); const md = modelDof(m);
      const m4 = { ...m, cons: [...m.cons, { t: 'tangent', curves: [ai.id, e2.id] }] }; const md4 = modelDof(m4);
      log(`P-07 ${id}: ours model rank ${md.rank} DOF ${md.dof}; + the 4th tangent (inner arc - end cap 2, Fusion has it): rank ${md4.rank} DOF ${md4.dof} | solver nullity ${dofOf(app)} | Design panel DOF ${panelDof(app)}`);
      log(`P-07 ${id}: tangent constraints ${app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.TANGENT).length}, tangent glyphs drawn ${glyphCount(app).tangent || 0} (Fusion: 4 Tangent constraints)`);
      const C = Jx(app, ao.joints[0]), c2 = Jx(app, e2.joints[0]), i2 = Jx(app, e2.joints[2]), o2 = Jx(app, e2.joints[1]);
      const col = (p, q, r) => Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / (Math.hypot(q.x - p.x, q.y - p.y) * Math.hypot(r.x - p.x, r.y - p.y));
      const w = app.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.DISTANCE);
      const res = commitDimensionEdit(app.state, w, w.value * 1.6); app.frames(2);
      const C2 = Jx(app, ao.joints[0]), c22 = Jx(app, e2.joints[0]), i22 = Jx(app, e2.joints[2]), o22 = Jx(app, e2.joints[1]);
      log(`P-07 ${id}: width ${r3(w.value / 1.6)} -> ${r3(w.value)} (${res && res.reverted ? 'reverted' : 'applied'}): sin(angle C,c2,i2) before ${col(C, c2, i2).toExponential(1)} after ${col(C2, c22, i22).toExponential(1)}; sin(C,c2,o2) after ${col(C2, c22, o22).toExponential(1)} (0 = the cap still tangent at that corner)`);
    } finally { await app.close(); }
  }
}
{ // P-08 a circle-circle tangent from the Tangent tool's seam: is its glyph drawn? (the arc slot's arc-arc tangents draw none, P-07)
  const app = await openFresh();
  try {
    app.tool('circle'); for (const w of [{ x: 60, y: -50 }, { x: 70, y: -50 }]) { const p = app.toScreen(w.x, w.y); app.click(p.x, p.y); }
    app.tool('circle'); for (const w of [{ x: 85, y: -50 }, { x: 90, y: -50 }]) { const p = app.toScreen(w.x, w.y); app.click(p.x, p.y); }
    app.esc();
    const [a, b] = shapesOf(app);
    const t = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.TANGENT, { shapes: [a.id, b.id] }, { source: 'toolbar' });
    app.engine.solve(); app.frames(2);
    log(`P-08 two circles + Tangent (ConstraintManager.createConstraint, the Tangent tool's seam): created ${!!t} fields ${t ? Object.keys(t).filter((k) => ['shapes', 'line', 'circle', 'branch'].includes(k)).join(',') : '-'}; glyphs drawn ${JSON.stringify(glyphCount(app))}`);
  } finally { await app.close(); }
}

const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(results, null, 1));
