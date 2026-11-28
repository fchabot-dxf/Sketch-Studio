// tests/polygon-1050-node.test.js — TASK 1050: the POLYGON built like Fusion 360: ONE declared Polygon constraint (#core/polygon.js) instead of
// N construction radii + 2(N-1) Equal. Through the app's own Polygon tool, select tool, glyph pick, Delete key, undo / redo and the stored
// document in the node kit (tests/helpers/node-app.js).
// FUSION, RECORDED by the advisor (ShapePolygonInscribed / Circumscribed / Edge, 6 sides; docs/RECIPE-PARITY-1037.md D-5): 6 lines (not
// construction) sharing their 6 corners, the centre a LONE point (points 7), constraints ["Polygon()"] only, no dimension, no construction
// line; DOF 4 (the model without the Polygon constraint: 14).
// Parts:
//   A  the recipe (N = 3, 6, 64): N sides sharing N corners, a lone centre, ONE polygon constraint, no construction, no dimension; DOF 4
//      (solver nullity = the Design panel); the solver rows 2(N-1) = their rank (no redundant row)
//   B  ONE polygon glyph (no equal glyph), beside the centre; a click on it selects it; Delete removes the constraint as a whole: the lines
//      and the lone centre stay, free (DOF 14 for 6 sides); ONE undo step restores it exactly
//   C  Delete on one side: the polygon constraint goes with it (Fusion unmeasured), the other sides stay; Undo restores exactly
//   D  drags: a corner (it stays regular, turns and scales, the corner at the cursor), a side (regular), the centre (a pure translation)
//   E  typed sizes: the box's radius (a driving centre-corner dimension, DOF 3) and its side count; a dimension on a side drives the size
//   F  save + reload round trip of the polygon constraint; undo / redo of the polygon
//   G  an OLD file (6 construction radii + 10 equals) loads unchanged (no conversion) and keeps working
//   H  what a mirror / pattern / offset COPY of a polygon carries; break / trim of a side; a fillet on a corner, then its arc deleted
import assert from 'node:assert';
import { open, createProfile, createNamedDesign, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { createNewtonSolver } from '#core/solver/engine.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { polygonResidual } from '#core/polygon.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';
import { glyphAt } from '#ui/hover-manager.js';
import { mirrorObjects } from '#core/mirror.js';
import { applyPattern, patternDefaults } from '#core/pattern.js';
import { applyOffset, offsetChainOf } from '#core/offset.js';
import { breakShape } from '#core/break.js';
import { trimShape } from '#core/trim.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { applyFillet, findCornerBetweenLines } from '#core/fillet.js';
import { deleteShapes } from '#core/delete-manager.js';

await loadGlyphSheetFromDisk(); // the glyph is picked where its icon is drawn (task 603)
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };
const T = CONSTRAINT_TYPES;
const sketch1 = 'sketch-1';

async function openApp(opts = {}) {
  const app = await open({ host: 'sketchstudio', ...opts });
  const r = app.svg.getBoundingClientRect(), v = app.state.view;
  Object.assign(v, { x: 60, y: -40, w: 160 }); v.h = v.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${v.x - v.w / 2} ${v.y - v.h / 2} ${v.w} ${v.h}`);
  app.frames(2);
  return app;
}
const clk = (app, x, y) => { const p = app.toScreen(x, y); app.move(p.x, p.y); app.click(p.x, p.y); };
const P = (S, id) => S.joints.get(id);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const spread = (v) => Math.max(...v) - Math.min(...v);
const polyOf = (S) => S.constraints.filter((c) => c.type === T.POLYGON);
const sidesOf = (S, pc) => pc.shapes.map((id) => S.shapes.find((s) => s.id === id));
const dof = (S) => S.engine.jointFreedom().nullity;
const panelDof = (S) => analyzeConstraintStatus(S).dof;
const strip = (c) => { const { glyphPos, __visible, __pos, ...r } = c; return r; };
const docOf = (S) => JSON.stringify({ joints: [...S.joints].map(([id, j]) => [id, +j.x.toFixed(9), +j.y.toFixed(9), !!j.fixed, !!j.orphanAllowed]), shapes: S.shapes.map((s) => [s.id, s.joints, !!s.isConstruction]), constraints: S.constraints.map(strip) });
// a regular polygon about its constraint's centre: every corner as far from the centre, every corner-to-corner side as long, the rule's residual ~0
function regular(S, pc) {
  const c = P(S, pc.joints[0]), v = pc.joints.slice(1), rad = v.map((j) => dist(P(S, j), c));
  const sides = v.map((j, i) => dist(P(S, j), P(S, v[(i + 1) % v.length])));
  return { radius: rad[0], radSpread: spread(rad), sideSpread: spread(sides), residual: polygonResidual(pc, S.joints), side: sides[0] };
}
const isRegular = (r) => r.radSpread < 1e-6 && r.sideSpread < 1e-6 && r.residual < 1e-6;
// the solver rows of the sketch and their rank (unknowns - nullity): equal = no redundant row
function rowsAndRank(S) {
  const solver = createNewtonSolver(S.joints, S.constraints, S.shapes, { maxIter: 1 });
  const x = solver._pack(), m = solver._assemble(x).m, nullity = solver.jointFreedom().nullity;
  return { unknowns: x.length, rows: m, rank: x.length - nullity, nullity };
}
// draw a polygon with the real tool: centre click, corner click
function drawPolygon(app, n, c = [40, -30], v = [65, -30]) {
  app.state.polygonSides = n;
  app.tool('polygon'); clk(app, c[0], c[1]); clk(app, v[0], v[1]); app.esc(); app.esc();
  app.tool('select'); app.esc(); app.frames(2);
  return polyOf(app.state).pop();
}
// a screen point ON the glyph's drawn icon (task 603) that glyphAt picks as `c`
function glyphPoint(app, c) {
  const g = app.toScreen(c.glyphPos.x, c.glyphPos.y);
  for (let r = 0; r <= 12; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (glyphAt(app.svg, app.state, g.x + dx, g.y + dy) === c) return { x: g.x + dx, y: g.y + dy };
  return null;
}
const glyphCount = (app) => { const m = {}; for (const g of app.svg.querySelectorAll('g.constraint-glyph')) { const t = g.getAttribute('data-ctype'); m[t] = (m[t] || 0) + 1; } return m; };

// ------------------------------------------------------------------------------------------------ A the recipe
for (const n of [3, 6, 64]) {
  const app = await openApp();
  const S = app.state;
  const pc = drawPolygon(app, n);
  const sides = S.shapes.filter((s) => s.type === 'line');
  const centre = pc && pc.joints[0];
  const uses = new Map(); for (const s of S.shapes) for (const j of s.joints) uses.set(j, (uses.get(j) || 0) + 1);
  const corners = pc ? pc.joints.slice(1) : [];
  const rr = rowsAndRank(S);
  check(S.constraints.length === 1 && !!pc, `A N=${n}: ONE constraint, the polygon (Fusion: Polygon()): ${JSON.stringify(S.constraints.map((c) => c.type))}`);
  check(sides.length === n && S.shapes.length === n && !S.shapes.some((s) => s.isConstruction), `A N=${n}: ${n} sides, no construction (Fusion: none): ${S.shapes.length} shapes`);
  check(corners.length === n && corners.every((j) => uses.get(j) === 2), `A N=${n}: the ${n} corners are each shared by two sides`);
  check(!!centre && !uses.has(centre) && S.joints.size === n + 2, `A N=${n}: the centre is a LONE point (points ${S.joints.size - 1} = Fusion's ${n + 1})`);
  check(pc && pc.shapes.length === n && pc.shapes.every((id, i) => { const s = S.shapes.find((x) => x.id === id); return s && s.joints[0] === corners[i] && s.joints[1] === corners[(i + 1) % n]; }), `A N=${n}: the constraint names the centre, then the corners and the sides in order`);
  check(!S.constraints.some((c) => c.type === T.DISTANCE), `A N=${n}: no dimension (Fusion: none)`);
  check(isRegular(regular(S, pc)), `A N=${n}: a regular ${n}-gon (${JSON.stringify(regular(S, pc))})`);
  check(dof(S) === 4 && panelDof(S) === 4, `A N=${n}: DOF 4 = Fusion's (solver nullity ${dof(S)}, Design panel ${panelDof(S)})`);
  check(rr.rows === 2 * (n - 1) && rr.rank === rr.rows, `A N=${n}: solver rows ${rr.rows} = 2(N-1), rank ${rr.rank}, unknowns ${rr.unknowns}: no redundant row`);
  console.log(`A N=${n}: curves ${n} (construction 0) | points ${S.joints.size - 1} (lone centre 1) | constraints ${JSON.stringify(S.constraints.map((c) => c.type))} | rows ${rr.rows} rank ${rr.rank} unknowns ${rr.unknowns} DOF ${rr.nullity}`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ B the glyph, its Delete
{
  const app = await openApp();
  const S = app.state;
  const pc = drawPolygon(app, 6);
  const gc = glyphCount(app);
  check(gc.polygon === 1 && !gc.equal && Object.keys(gc).length === 1, `B: ONE polygon glyph, nothing else (${JSON.stringify(gc)})`);
  const c = P(S, pc.joints[0]);
  const near = pc.glyphPos && dist(pc.glyphPos, c);
  check(pc.glyphPos && near > 0 && near < 10 && pc.glyphPos.x > c.x && pc.glyphPos.y < c.y, `B: the glyph sits up and right of the centre (${near && near.toFixed(2)} mm from it)`);
  // the Design panel's constraint list (the inspector): ONE Polygon row, naming its sides
  const rows = [...createDesignInfoPanel({ state: S, engine: S.engine }).render(app.document.createElement('div')).querySelectorAll('.sk-info-row')].map((e) => e.textContent.trim());
  check(rows.length === 1 && /^⬡Polygon/.test(rows[0]) && (rows[0].match(/Line \d/g) || []).length === 6, `B: the Design panel lists ONE Polygon row (${JSON.stringify(rows)})`);
  const before = { doc: docOf(S), history: S.history.length, joints: S.joints.size };
  const gp = glyphPoint(app, pc);
  check(!!gp, 'B: the glyph is picked on its drawn icon');
  app.click(gp.x, gp.y);
  check(S.selectedConstraints.size === 1 && S.selectedConstraints.has(pc), 'B: a click on the glyph selects the polygon constraint');
  app.key('Delete'); app.frames(2);
  check(polyOf(S).length === 0 && S.constraints.length === 0, 'B: Delete removes the polygon constraint as a whole');
  check(S.shapes.length === 6 && S.joints.size === before.joints && S.joints.has(pc.joints[0]), 'B: the 6 lines stay, and the lone centre');
  check(dof(S) === 14 && panelDof(S) === 14, `B: the lines are free: DOF ${dof(S)} (Fusion's model without the Polygon constraint: 14)`);
  check(S.history.length === before.history + 1, 'B: ONE undo step');
  check(Object.keys(glyphCount(app)).length === 0, 'B: no glyph left');
  app.undo(); app.frames(2);
  check(docOf(S) === before.doc && dof(S) === 4, 'B: Undo restores the polygon exactly (DOF 4)');
  app.redo(); app.frames(2);
  check(polyOf(S).length === 0 && dof(S) === 14, 'B: Redo deletes it again');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ C Delete on one side
{
  const app = await openApp();
  const S = app.state;
  const pc = drawPolygon(app, 6);
  const side = sidesOf(S, pc)[2];
  const a = P(S, side.joints[0]), b = P(S, side.joints[1]);
  const before = { doc: docOf(S), history: S.history.length };
  clk(app, (a.x + b.x) / 2, (a.y + b.y) / 2);
  check(S.selectedShapes.size === 1 && S.selectedShapes.has(side.id), 'C: a click on a side selects it');
  app.key('Delete'); app.frames(2);
  check(!S.shapes.some((s) => s.id === side.id) && S.shapes.length === 5, 'C: the side goes, the other 5 stay');
  check(polyOf(S).length === 0, 'C: the polygon constraint goes with it (the natural rule; Fusion unmeasured)');
  check(S.joints.has(pc.joints[0]) && pc.joints.slice(1).every((j) => S.joints.has(j)), 'C: the corners (each still on a side) and the lone centre stay');
  check(dof(S) === 14, `C: DOF ${dof(S)} (7 free points)`);
  check(S.history.length === before.history + 1, 'C: ONE undo step');
  app.undo(); app.frames(2);
  check(docOf(S) === before.doc && dof(S) === 4, 'C: Undo restores the side and the polygon exactly');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ D drags
{
  const app = await openApp();
  const S = app.state;
  const pc = drawPolygon(app, 6);
  const px = S.view.w / app.svg.getBoundingClientRect().width; // the drag's cursor lands on whole screen pixels
  // a corner
  const k = pc.joints[3], p0 = { ...P(S, k) }, r0 = regular(S, pc), c0 = { ...P(S, pc.joints[0]) };
  const ang0 = Math.atan2(p0.y - c0.y, p0.x - c0.x);
  const to = { x: p0.x + 8, y: p0.y + 5 };
  app.drag(app.toScreen(p0.x, p0.y), app.toScreen(to.x, to.y), 10); app.frames(2);
  const r1 = regular(S, pc), c1 = P(S, pc.joints[0]), p1 = P(S, k);
  const ang1 = Math.atan2(p1.y - c1.y, p1.x - c1.x);
  check(isRegular(r1), `D corner: still a regular hexagon (${JSON.stringify(r1)})`);
  check(dist(p1, to) < px, `D corner: the corner is at the cursor (${dist(p1, to).toFixed(4)} mm, a screen pixel is ${px.toFixed(3)} mm)`);
  check(Math.abs(r1.radius - r0.radius) > 0.5 || Math.abs(ang1 - ang0) > 0.01, `D corner: it scaled / turned (radius ${r0.radius.toFixed(3)} -> ${r1.radius.toFixed(3)}, corner angle ${(ang0 * 180 / Math.PI).toFixed(2)} -> ${(ang1 * 180 / Math.PI).toFixed(2)} deg)`);
  // a side (body drag)
  const side = sidesOf(S, pc)[0];
  const m0 = { x: (P(S, side.joints[0]).x + P(S, side.joints[1]).x) / 2, y: (P(S, side.joints[0]).y + P(S, side.joints[1]).y) / 2 };
  const mTo = { x: m0.x + 6, y: m0.y - 4 };
  app.drag(app.toScreen(m0.x, m0.y), app.toScreen(mTo.x, mTo.y), 10); app.frames(2);
  const m1 = { x: (P(S, side.joints[0]).x + P(S, side.joints[1]).x) / 2, y: (P(S, side.joints[0]).y + P(S, side.joints[1]).y) / 2 };
  check(isRegular(regular(S, pc)), `D side: still a regular hexagon (${JSON.stringify(regular(S, pc))})`);
  check(dist(m1, m0) > 3, `D side: the side moved (${dist(m1, m0).toFixed(3)} mm; ${dist(m1, mTo).toFixed(3)} mm from the cursor)`);
  // the centre: a pure translation
  const cBefore = { ...P(S, pc.joints[0]) }, before = pc.joints.slice(1).map((j) => ({ ...P(S, j) })), rB = regular(S, pc).radius;
  const cTo = { x: cBefore.x + 10, y: cBefore.y + 7 };
  app.drag(app.toScreen(cBefore.x, cBefore.y), app.toScreen(cTo.x, cTo.y), 10); app.frames(2);
  const cAfter = P(S, pc.joints[0]), d = { x: cAfter.x - cBefore.x, y: cAfter.y - cBefore.y };
  check(dist(cAfter, cTo) < px, `D centre: the centre is at the cursor (${dist(cAfter, cTo).toFixed(4)} mm)`);
  const moved = pc.joints.slice(1).map((j, i) => dist(P(S, j), { x: before[i].x + d.x, y: before[i].y + d.y }));
  const rA = regular(S, pc);
  console.log(`D centre: moved by (${d.x.toFixed(3)}, ${d.y.toFixed(3)}); radius ${rB.toFixed(6)} -> ${rA.radius.toFixed(6)}; max corner off the pure translation ${Math.max(...moved).toExponential(2)} mm`);
  check(isRegular(rA) && Math.abs(rA.radius - rB) < 0.05 && Math.max(...moved) < 0.05, `D centre: the polygon moves with it, regular, its size and turn kept within 0.05 mm (radius ${rB.toFixed(4)} -> ${rA.radius.toFixed(4)}, corners off the translation ${Math.max(...moved).toExponential(1)} mm)`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ E typed sizes, a dimension on a side
{
  const app = await openApp();
  const S = app.state;
  S.polygonSides = 6;
  app.tool('polygon'); clk(app, 40, -30); { const m = app.toScreen(60, -30); app.move(m.x, m.y); }
  app.type('25'); app.enter(); app.esc(); app.esc(); app.frames(2);
  const pc = polyOf(S).pop();
  const dim = S.constraints.find((c) => c.type === T.DISTANCE);
  check(!!pc && pc.joints.length === 7, 'E radius: the typed polygon has its polygon constraint');
  check(dim && !dim.isDriven && Math.abs(dim.value - 25) < 1e-9 && dim.joints[0] === pc.joints[0] && dim.joints[1] === pc.joints[1], 'E radius: a DRIVING 25 dimension from the centre to the first corner');
  check(Math.abs(regular(S, pc).radius - 25) < 1e-6 && isRegular(regular(S, pc)), `E radius: a regular hexagon of radius 25 (${regular(S, pc).radius})`);
  check(dof(S) === 3, `E radius: DOF 3 (${dof(S)})`);
  // the side count typed in the box's second field
  app.tool('polygon'); clk(app, 100, -30); { const m = app.toScreen(118, -30); app.move(m.x, m.y); }
  const [, nField] = [...app.document.querySelectorAll('#dualInput input')];
  nField.focus(); nField.select(); app.type('8'); app.enter(); app.esc(); app.esc(); app.frames(2);
  const p8 = polyOf(S).pop();
  check(p8 !== pc && p8.joints.length === 9 && p8.shapes.length === 8 && isRegular(regular(S, p8)), 'E sides: N typed 8: an octagon, one polygon constraint of 8 corners');
  // a dimension on a side drives the size
  const side = sidesOf(S, p8)[1], L0 = dist(P(S, side.joints[0]), P(S, side.joints[1]));
  const sd = ConstraintManager.createConstraint(S, T.DISTANCE, { joints: [side.joints[0], side.joints[1]], value: L0 }, { source: 'test' });
  check(sd && !sd.isDriven, 'E side dimension: a driving side length');
  const res = commitDimensionEdit(S, sd, 12); app.frames(2);
  const r8 = regular(S, p8);
  check(res && !res.reverted && Math.abs(r8.side - 12) < 1e-6 && isRegular(r8), `E side dimension: 12 drives every side to 12 (${r8.side}), still regular`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ F save + reload, undo / redo
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'T1050 F');
  let app = await openApp({ profile });
  let S = app.state;
  const h0 = S.history.length, empty = docOf(S);
  const pc = drawPolygon(app, 5);
  const drawn = docOf(S);
  check(S.history.length === h0 + 1, 'F: the polygon is ONE undo step');
  app.undo(); app.frames(2);
  check(docOf(S) === empty, 'F: Undo removes the whole polygon (lines, corners, centre, constraint)');
  app.redo(); app.frames(2);
  check(docOf(S) === drawn && polyOf(S).length === 1 && JSON.stringify(strip(polyOf(S)[0])) === JSON.stringify(strip(pc)), 'F: Redo restores it exactly (the same polygon constraint)');
  const stored = await app.storedDoc();
  const sc = stored.geometry.constraints.filter((c) => c.type === T.POLYGON);
  const keys = Object.keys(strip(sc[0] || {})); // glyphPos / __visible: the renderer's caches every stored constraint carries
  check(sc.length === 1 && JSON.stringify(keys) === JSON.stringify(['type', 'joints', 'shapes']) && sc[0].joints.length === 6 && sc[0].shapes.length === 5, `F: the stored document holds { type, joints, shapes }: ${JSON.stringify(keys)}`);
  await app.close();
  app = await openApp({ profile });
  S = app.state;
  check(docOf(S) === drawn, 'F: the design reloads unchanged');
  check(dof(S) === 4 && isRegular(regular(S, polyOf(S)[0])), 'F: and works: DOF 4, regular');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ G an OLD file: radii + equals
{
  const profile = await createProfile();
  const J = (id, x, y, extra = {}) => [id, { x, y, sketchId: sketch1, ...extra }];
  const cx = 40, cy = -30, R = 20, corner = (i) => [cx + R * Math.cos(i * Math.PI / 3), cy + R * Math.sin(i * Math.PI / 3)];
  const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: sketch1 }], J('c', cx, cy), ...[0, 1, 2, 3, 4, 5].map((i) => J('v' + i, ...corner(i)))];
  const sides = [0, 1, 2, 3, 4, 5].map((i) => ({ id: 's_poly_old_' + i, type: 'line', joints: ['v' + i, 'v' + ((i + 1) % 6)], groupId: 'poly_old', isConstruction: false, sketchId: sketch1 }));
  const radii = [0, 1, 2, 3, 4, 5].map((i) => ({ id: 's_poly_radial_old_' + i, type: 'line', joints: ['c', 'v' + i], isConstruction: true, sketchId: sketch1 }));
  const shapes = sides.flatMap((s, i) => [s, radii[i]]);
  const constraints = [];
  for (let i = 0; i < 5; i++) { constraints.push({ type: 'equal', shapes: [sides[i].id, sides[i + 1].id] }); constraints.push({ type: 'equal', shapes: [radii[i].id, radii[i + 1].id] }); }
  await createNamedDesign(profile, 'sketchstudio', 'T1050 G', { version: 3, hosts: {}, geometry: { joints, shapes, constraints, parameters: [], sketches: [{ id: sketch1, name: 'Sketch 1', visible: true }], activeSketchId: sketch1, groups: [], profiles: [] } });
  const app = await openApp({ profile });
  const S = app.state;
  check(S.shapes.length === 12 && S.shapes.filter((s) => s.isConstruction).length === 6, 'G: an old polygon loads with its 6 construction radii');
  check(S.constraints.length === 10 && S.constraints.every((c) => c.type === T.EQUAL) && polyOf(S).length === 0, 'G: and its 10 equals, no polygon constraint (no conversion)');
  check(dof(S) === 4, `G: DOF 4 (${dof(S)})`);
  const gc = glyphCount(app);
  check(gc.equal === 20 && !gc.polygon, `G: its 20 equal glyphs as before (${JSON.stringify(gc)})`);
  const p0 = { ...P(S, 'v2') };
  app.drag(app.toScreen(p0.x, p0.y), app.toScreen(p0.x + 6, p0.y + 4), 10); app.frames(2);
  const rad = [0, 1, 2, 3, 4, 5].map((i) => dist(P(S, 'v' + i), P(S, 'c'))), sl = sides.map((s) => dist(P(S, s.joints[0]), P(S, s.joints[1])));
  check(spread(rad) < 1e-5 && spread(sl) < 1e-5, `G: a corner drag keeps the old polygon regular (radii ${spread(rad).toExponential(1)}, sides ${spread(sl).toExponential(1)})`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ H copies, break / trim, the centre
{
  // mirror: the sides only (what a user selects), about a vertical line
  const app = await openApp();
  const S = app.state;
  const pc = drawPolygon(app, 6);
  app.tool('line'); clk(app, 90, -70); clk(app, 90, 10); app.esc(); app.esc();
  const axis = S.shapes[S.shapes.length - 1];
  S.saveState('mirror');
  const nC = S.constraints.length;
  const m = mirrorObjects(S, { shapes: pc.shapes.slice(), joints: [] }, axis.id);
  S.engine.solve(500); app.frames(2);
  const added = S.constraints.slice(nC);
  check(m.ok && m.shapes.length === 6 && !added.some((c) => c.type === T.POLYGON) && added.every((c) => c.type === T.SYMMETRIC), `H mirror: the copy is 6 lines tied by ${added.length} symmetric constraints, no polygon constraint of its own (Fusion: mirror copies no constraint)`);
  const copies = m.shapes.map((id) => S.shapes.find((s) => s.id === id));
  const cu = new Map(); for (const s of copies) for (const j of s.joints) cu.set(j, (cu.get(j) || 0) + 1);
  check(cu.size === 6 && [...cu.values()].every((v) => v === 2), 'H mirror: the copy keeps its 6 shared corners');
  const v = pc.joints[2], q = { ...P(S, v) };
  app.tool('select'); app.esc();
  app.drag(app.toScreen(q.x, q.y), app.toScreen(q.x - 5, q.y + 3), 10); app.frames(2);
  const csl = copies.map((s) => dist(P(S, s.joints[0]), P(S, s.joints[1])));
  check(isRegular(regular(S, pc)) && spread(csl) < 1e-5, `H mirror: a corner drag of the original: the original stays regular and the copy follows it (copy sides spread ${spread(csl).toExponential(1)})`);
  await app.close();
}
{
  // circular pattern of the sides about the origin, and the offset of the closed polygon
  const app = await openApp();
  const S = app.state;
  const pc = drawPolygon(app, 6);
  S.saveState('pattern');
  const nC = S.constraints.length;
  const p = applyPattern(S, T.CIRCULAR_PATTERN, { shapes: pc.shapes.slice(), joints: [] }, { ...patternDefaults(T.CIRCULAR_PATTERN), centre: 'j_origin', quantity: 2 });
  S.engine.solve(500); app.frames(2);
  const added = S.constraints.slice(nC);
  check(p.ok && added.length === 1 && added[0].type === T.CIRCULAR_PATTERN, `H pattern: the copy is tied by ONE circular pattern constraint, no polygon constraint of its own (${JSON.stringify(added.map((c) => c.type))})`);
  const ch = offsetChainOf(S, pc.shapes[0]);
  S.saveState('offset');
  const nO = S.constraints.length;
  const o = applyOffset(S, ch.chain, 3, 1);
  S.engine.solve(500); app.frames(2);
  const addedO = S.constraints.slice(nO);
  check(o.ok && o.shapes.length === 6 && addedO.length === 1 && addedO[0].type === T.OFFSET, `H offset: the offset of the closed polygon is 6 lines tied by ONE offset constraint, no polygon constraint of its own (${JSON.stringify(addedO.map((c) => c.type))})`);
  const k = pc.joints[4], q = { ...P(S, k) };
  app.tool('select'); app.esc();
  app.drag(app.toScreen(q.x, q.y), app.toScreen(q.x + 4, q.y - 3), 10); app.frames(2);
  const offSides = o.shapes.map((id) => S.shapes.find((s) => s.id === id)).map((s) => dist(P(S, s.joints[0]), P(S, s.joints[1])));
  check(isRegular(regular(S, pc)) && spread(offSides) < 1e-4, `H pattern / offset: a corner drag of the original: it stays regular, the offset copy follows (its sides spread ${spread(offSides).toExponential(1)})`);
  await app.close();
}
{
  // break and trim of a side: the corners stay on their sides, so the polygon constraint stays and the polygon stays regular
  const app = await openApp();
  const S = app.state;
  const pc = drawPolygon(app, 6);
  const side = sidesOf(S, pc)[1];
  S.saveState('break');
  const br = breakShape(S, side.id, 0.4);
  const sb = S.engine.solve(500);
  check(!!br && polyOf(S).length === 1 && sb.converged && isRegular(regular(S, pc)), `H break: a side broken in two: the polygon constraint stays, still regular (${!!br} ${polyOf(S).length} ${sb.converged} ${JSON.stringify(regular(S, pc))})`);
  check(dof(S) === 5, `H break: DOF 5 (the break point slides along its side: ${dof(S)})`);
  app.undo(); app.frames(2);
  // trim: a line across side 3, the piece of side 3 between its start corner and the crossing trimmed away
  const s3 = sidesOf(S, pc)[3], a = { ...P(S, s3.joints[0]) }, b = { ...P(S, s3.joints[1]) };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny);
  app.tool('line'); clk(app, mid.x + 8 * nx / nl, mid.y + 8 * ny / nl); clk(app, mid.x - 8 * nx / nl, mid.y - 8 * ny / nl); app.esc(); app.esc();
  S.saveState('trim');
  trimShape(S, s3.id, { x: a.x + 0.25 * (b.x - a.x), y: a.y + 0.25 * (b.y - a.y) });
  const st = S.engine.solve(500);
  check(polyOf(S).length === 1 && pc.joints.every((j) => S.joints.has(j)) && st.converged && isRegular(regular(S, pc)), 'H trim: a side trimmed from one corner to a crossing line: the corner stays on its other side, the polygon constraint stays, still regular');
  await app.close();
}

{
  // a fillet on a corner: the corner becomes the fillet's virtual sharp V IN the polygon constraint (fillet.js); deleting the fillet arc keeps V
  // and the polygon (delete-manager.js virtualSharpProtectedJoints: a polygon corner, as the old recipe's construction radial kept it: DOF 6 then too)
  const app = await openApp();
  const S = app.state;
  const pc = drawPolygon(app, 6);
  const sides = sidesOf(S, pc);
  S.saveState('fillet');
  const res = applyFillet(S, findCornerBetweenLines(S, sides[0], sides[1]), 3);
  const sf = S.engine.solve(500);
  const V = pc.joints[2];
  check(res.success && sf.converged && P(S, V).virtualSharp && res.virtualSharp === V && isRegular(regular(S, pc)) && dof(S) === 4, `H fillet: the filleted corner is the virtual sharp V in the polygon constraint, still regular, DOF ${dof(S)}`);
  deleteShapes(S, [res.arc.id]);
  const sd = S.engine.solve(500);
  check(polyOf(S).length === 1 && S.joints.has(V) && sd.converged && isRegular(regular(S, pc)), `H fillet: the fillet arc deleted: V and the polygon constraint stay, still regular (${JSON.stringify(S.constraints.map((c) => c.type))})`);
  check(dof(S) === 6, `H fillet: DOF 6 after the arc's delete (the two freed side ends; the same as before task 1050): ${dof(S)}`);
  await app.close();
}

if (fails.length) { console.log(`polygon-1050-node: ${fails.length} FAILED`); process.exit(1); }
console.log('polygon-1050-node: ok');
