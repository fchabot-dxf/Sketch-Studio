// tests/shared-corners-1045-node.test.js — TASK 1045: SHARED CORNERS, phase 2 of "one shared point for every join, like Fusion", through the app's own
// ribbon, variant rows, real pointer events, Enter, Esc, Delete and context menu in the node kit (tests/helpers/node-app.js).
// FUSION, MEASURED by the advisor 2026-11-27 (real clicks):
//   - every DRAWING tool joins meeting ends with ONE shared point (rectangles: all 3; Line tool chains and a line ending on an existing end point;
//     polygon; slot; fillet; offset; pattern; break); an end landing on a curve's MIDDLE is a Coincident (point-on-curve);
//   - a 2-point rectangle whose first corner is clicked on an existing line's END shares it (1 point, used by 3 curves): the rule holds for every
//     drawing tool's new point on an existing curve END POINT;
//   - a line END on a circle CENTRE, a line END on a LONE point, a line START at the ORIGIN: a separate point + Coincident (not shared);
//   - the COINCIDENT TOOL never merges (it glues separate points with n-1 coincidents); a DRAG of a point onto another is that kind of join here.
// Parts:
//   A  the three rectangles: corner joints shared (2-point 4 joints, centre 4 corners + its centre, 3-point 4), NO coincident, the structural
//      constraints Fusion's (2-point: H, V, H, V; centre, task 1049: H + perpendicular + 2 parallel + 2 pointOnLine; 3-point, task 1049: perpendicular
//      + 2 parallel); DOF as before (2-point / centre 4)
//   B  a new rectangle corner splits through 1041's glyph (Delete) and through the point's "Delete Coincident"; one undo step restores it
//   C  the Line tool: a chain's segments share their point (click and Enter), a closed chain ends on its first point, no coincident
//   D  the Line tool's ends on existing points: on a line END shared (end and start), on a line MIDDLE a pointOnLine, on a circle CENTRE / a lone
//      point / the origin a separate point + Coincident
//   E  the other drawing tools on an existing line end: rectangle corner (1 point used by 3 curves), arc, circle centre, polygon corner, slot centre,
//      bezier anchor: shared
//   F  a DRAG of an existing end point onto another end point glues (a coincident), never merges
//   G  Close path: a near-closed chain's ends become ONE point; a gap's closing line shares both ends
//   H  old files: a rectangle saved with two joints + a coincident per corner loads unchanged and its corner coincident still deletes as before
//   I  undo: a rectangle and each chain segment are ONE step each; Esc after a first click on an existing end point leaves that point's constraints
import assert from 'node:assert';
import { open, createProfile, createNamedDesign, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import { sharedPointCoincidents, curvesAtJoint } from '#core/shared-point.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { glyphAt } from '#ui/hover-manager.js';

await loadGlyphSheetFromDisk(); // task 603: a glyph is picked where its icon is drawn
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

const sketch1 = 'sketch-1';
async function openApp(opts = {}) {
  const app = await open({ host: 'sketchstudio', ...opts });
  const r = app.svg.getBoundingClientRect(), v = app.state.view;
  Object.assign(v, { x: 0, y: 0, w: 160 }); v.h = v.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${v.x - v.w / 2} ${v.y - v.h / 2} ${v.w} ${v.h}`);
  app.frames(2);
  return app;
}
const clk = (app, x, y) => { const p = app.toScreen(x, y); app.move(p.x, p.y); app.click(p.x, p.y); };
const clickJoint = (app, id) => { const j = app.state.joints.get(id); clk(app, j.x, j.y); };
/** the tool's ribbon button and the variant's row in its menu, as a user picks them (tests/audits/recipe-parity-1037-node.mjs pickTool) */
function pickTool(app, tool, variant) {
  app.tool(tool);
  if (!variant) return;
  const item = app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${variant}"]`);
  assert(item, 'no ribbon variant row ' + variant);
  item.click(); app.frames(2);
}
const coincidents = (S) => S.constraints.filter((c) => c.type === 'coincident');
const types = (S) => S.constraints.map((c) => c.type).sort().join(',');
const lines = (S) => S.shapes.filter((s) => s.type === 'line');
const usedJoints = (S) => new Set(S.shapes.flatMap((s) => s.joints));
const dof = (S) => analyzeConstraintStatus(S).dof;
const usersOf = (S, j) => curvesAtJoint(S.shapes, j).length;
const glyphsAt = (S, jid) => sharedPointCoincidents(S.joints, S.shapes).filter((g) => g.joints[0] === jid);
const glyphPoint = (app, g) => {
  const c = app.toScreen(g.glyphPos.x, g.glyphPos.y), jw = app.state.joints.get(g.joints[0]), j = jw ? app.toScreen(jw.x, jw.y) : c;
  let best = null;
  for (let dx = -12; dx <= 12; dx++) for (let dy = -12; dy <= 12; dy++) {
    const p = { x: c.x + dx, y: c.y + dy };
    if (glyphAt(app.svg, app.state, p.x, p.y) !== g) continue;
    const d = Math.hypot(p.x - j.x, p.y - j.y);
    if (!best || d > best.d) best = { ...p, d };
  }
  assert(best, 'the glyph is pickable on its drawn icon');
  return best;
};
/** a doc with one line L (a = (-40, 20) -> b = (-10, 20)) and, optionally, more geometry */
async function openWith(extra = {}) {
  const profile = await createProfile();
  const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: sketch1 }], ['a', { x: -40, y: 20, sketchId: sketch1 }], ['b', { x: -10, y: 20, sketchId: sketch1 }], ...(extra.joints || [])];
  const shapes = [{ id: 'L', type: 'line', joints: ['a', 'b'], sketchId: sketch1 }, ...(extra.shapes || [])];
  await createNamedDesign(profile, 'sketchstudio', 'T1045', { version: 3, hosts: {}, geometry: { joints, shapes, constraints: extra.constraints || [], parameters: [], sketches: [{ id: sketch1, name: 'Sketch 1', visible: true }], activeSketchId: sketch1, groups: [], profiles: [] } });
  return openApp({ profile });
}

// ------------------------------------------------------------------------------------------------ A the three rectangles
for (const [variant, clicks, want] of [
  ['rect-2pt', [[10, 10], [50, 35]], { joints: 4, kinds: 'horizontal,horizontal,vertical,vertical', dof: 4, users: [2, 2, 2, 2] }],
  ['rect-center', [[30, 20], [50, 35]], { joints: 5, kinds: 'horizontal,parallel,parallel,perpendicular,pointOnLine,pointOnLine', dof: 4, users: [3, 3, 3, 3] }],   // task 1049: Fusion's recipe
  ['rect-3pt', [[10, 10], [50, 15], [45, 40]], { joints: 4, kinds: 'parallel,parallel,perpendicular', users: [2, 2, 2, 2] }],   // task 1049: Fusion's recipe
]) {
  const app = await openApp();
  const S = app.state;
  pickTool(app, 'rect', variant);
  for (const [x, y] of clicks) clk(app, x, y);
  app.esc(); app.esc();
  const sides = lines(S).filter((l) => !l.isConstruction);
  check(sides.length === 4, `A ${variant}: 4 sides`);
  const corners = [...new Set(sides.flatMap((l) => l.joints))];
  const real = [...S.joints.keys()].filter((j) => j !== 'j_origin');
  check(corners.length === 4, `A ${variant}: 4 corner joints, each SHARED by its two sides (${corners.length} distinct; was 8)`);
  check(real.length === want.joints, `A ${variant}: ${want.joints} joints in the sketch (${real.length}; was ${variant === 'rect-center' ? 13 : 8})`);
  check(coincidents(S).length === 0, `A ${variant}: NO coincident constraint (${coincidents(S).length}; was ${variant === 'rect-center' ? 8 : 4})`);
  check(types(S) === want.kinds, `A ${variant}: the structural constraints (Fusion's recipe): ${types(S)}`);
  check(JSON.stringify(corners.map((j) => usersOf(S, j))) === JSON.stringify(want.users), `A ${variant}: curves at each corner ${JSON.stringify(corners.map((j) => usersOf(S, j)))} (the centre rectangle's diagonals end on them too)`);
  check(sides.every((l, i) => l.joints[1] === sides[(i + 1) % 4].joints[0] || l.joints.some((j) => sides[(i + 1) % 4].joints.includes(j))), `A ${variant}: neighbouring sides share their corner`);
  if (want.dof !== undefined) check(dof(S) === want.dof, `A ${variant}: DOF ${dof(S)} (as before: ${want.dof})`);
  // a corner drag moves both sides and keeps the right angles
  app.tool('select'); app.esc();
  const c = corners[1], p0 = { ...S.joints.get(c) }, sp = app.toScreen(p0.x, p0.y);
  app.drag(sp, { x: sp.x + 25, y: sp.y - 15 }); app.frames(3);
  const p1 = S.joints.get(c);
  const ang = (l1, l2) => { const v = (l) => { const a = S.joints.get(l.joints[0]), b = S.joints.get(l.joints[1]); return [b.x - a.x, b.y - a.y]; }; const [u, w] = [v(l1), v(l2)]; return Math.abs((u[0] * w[0] + u[1] * w[1]) / (Math.hypot(...u) * Math.hypot(...w))); };
  check(Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1 && sides.every((l, i) => ang(l, sides[(i + 1) % 4]) < 1e-6), `A ${variant}: dragging a corner moves it and both its sides, the angles stay 90 (moved ${Math.hypot(p1.x - p0.x, p1.y - p0.y).toFixed(2)})`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ B a new rectangle corner splits (1041)
{
  const app = await openApp();
  const S = app.state;
  pickTool(app, 'rect', 'rect-2pt'); clk(app, 10, 10); clk(app, 50, 35); app.esc(); app.esc();
  const corner = lines(S)[0].joints[1];
  app.tool('select'); app.esc();
  clickJoint(app, corner);
  const g = glyphsAt(S, corner);
  check(g.length === 1 && g[0].__visible === true, `B: selecting a new rectangle corner shows ONE shared-point glyph (${g.length})`);
  const p = glyphPoint(app, g[0]); app.click(p.x, p.y);
  check(S.selectedConstraints.has(g[0]), 'B: a click on the glyph selects it');
  const nj = S.joints.size, h = S.history.length, d0 = dof(S), before = JSON.stringify(S.shapes.map((s) => s.joints));
  app.key('Delete');
  check(S.joints.size === nj + 1 && usersOf(S, corner) === 1 && S.history.length === h + 1, `B: Delete SPLITS the corner (+1 joint ${nj} -> ${S.joints.size}, the corner keeps 1 curve, ONE step)`);
  check(dof(S) === d0 + 2, `B: DOF +2 (${d0} -> ${dof(S)})`);
  check(coincidents(S).length === 0, 'B: no coincident is made or left');
  app.undo();
  check(JSON.stringify(S.shapes.map((s) => s.joints)) === before && S.joints.size === nj, 'B: undo restores the shared corner exactly');
  // Delete Coincident (the point's context menu)
  const j = S.joints.get(corner), sp = app.toScreen(j.x, j.y);
  app.rightClick(sp.x, sp.y);
  const item = app.document.querySelector('.sk-context-menu .sk-context-item[data-id="geo-delete-coincident"]');
  check(!!item, 'B: the new corner point\'s menu offers "Delete Coincident"');
  if (item) { item.click(); app.frames(); }
  check(S.joints.size === nj + 1 && usersOf(S, corner) === 1, `B: Delete Coincident splits it (+1 joint: ${S.joints.size})`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ C the Line tool's chain
{
  const app = await openApp();
  const S = app.state;
  app.tool('line');
  clk(app, 10, 10); clk(app, 40, 10); clk(app, 40, 30); clk(app, 20, 40);
  app.esc();
  const ls = lines(S);
  check(ls.length === 3, `C: 3 segments (${ls.length})`);
  check(ls[0].joints[1] === ls[1].joints[0] && ls[1].joints[1] === ls[2].joints[0], 'C: each segment STARTS ON the previous one\'s end point (shared)');
  check(usedJoints(S).size === 4 && S.joints.size === 5, `C: 4 points for 3 segments (+ origin: ${S.joints.size}; was 6 + 2 coincidents)`);
  check(coincidents(S).length === 0, `C: no coincident (${coincidents(S).length})`);
  await app.close();
}
{ // closed by a click on the first point
  const app = await openApp();
  const S = app.state;
  app.tool('line');
  clk(app, 10, 10); clk(app, 40, 10); clk(app, 40, 30); clk(app, 10, 10);
  app.esc();
  const ls = lines(S);
  check(ls.length === 3 && ls[2].joints[1] === ls[0].joints[0], `C: a click on the chain's first point ends ON it (closed, shared: ${ls.map((l) => l.joints.join('-')).join(' ')})`);
  check(usedJoints(S).size === 3 && coincidents(S).length === 0, `C: a closed triangle is 3 points, no coincident (${usedJoints(S).size}, ${coincidents(S).length})`);
  await app.close();
}
{ // Enter: a typed length and Enter commit the segment; the chain goes on from its end, shared
  const app = await openApp();
  const S = app.state;
  app.tool('line');
  clk(app, 10, 10);
  const p = app.toScreen(40, 10); app.move(p.x, p.y);
  app.type('25'); app.enter();
  const q = app.toScreen(35, 30); app.move(q.x, q.y);
  app.type('15'); app.enter();
  app.esc();
  const ls = lines(S);
  check(ls.length === 2 && ls[0].joints[1] === ls[1].joints[0], `C Enter: two typed segments share their point (${ls.map((l) => l.joints.join('-')).join(' ')})`);
  check(coincidents(S).length === 0 && S.constraints.filter((c) => c.type === 'distance').length === 2, `C Enter: no coincident, the two typed lengths (${types(S)})`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ D the Line tool's ends on existing points
{ // the end on a line END: shared; the start on a line END: shared
  const app = await openWith();
  const S = app.state;
  app.tool('line'); clk(app, 20, 40); clk(app, -10, 20); app.esc();
  const n = S.shapes.find((s) => s.id !== 'L');
  check(n && n.joints[1] === 'b' && usersOf(S, 'b') === 2 && coincidents(S).length === 0, `D: a line ENDING on a line's end point shares it (${n && n.joints}, no coincident)`);
  app.tool('line'); clk(app, -40, 20); clk(app, -40, 50); app.esc();
  const m = S.shapes.find((s) => s.id !== 'L' && s !== n);
  check(m && m.joints[0] === 'a' && coincidents(S).length === 0, `D: a line STARTING on a line's end point shares it (${m && m.joints})`);
  check(S.joints.size === 5, `D: no extra point (${S.joints.size}: origin, a, b, two far ends)`);
  await app.close();
}
{ // the end on a line's MIDDLE: a pointOnLine
  const app = await openWith();
  const S = app.state;
  app.tool('line'); clk(app, -30, 50); clk(app, -30, 20); app.esc();
  const n = S.shapes.find((s) => s.id !== 'L');
  check(n && !['a', 'b'].includes(n.joints[1]) && S.constraints.some((c) => c.type === 'pointOnLine' && c.joint === n.joints[1] && c.shape === 'L'), `D: an end on a line's MIDDLE is its own point on the line (${types(S)})`);
  await app.close();
}
{ // the end on a circle CENTRE, on a LONE point, the start at the ORIGIN: a separate point + Coincident
  const app = await openWith({ joints: [['c', { x: 30, y: 30, sketchId: sketch1 }], ['p', { x: 30, y: -30, sketchId: sketch1, orphanAllowed: true }]], shapes: [{ id: 'C', type: 'circle', joints: ['c'], radius: 8, sketchId: sketch1 }], constraints: [] });
  const S = app.state;
  app.tool('line'); clk(app, 55, 45); clk(app, 30, 30); app.esc();
  const n = S.shapes.find((s) => s.type === 'line' && s.id !== 'L');
  check(n && n.joints[1] !== 'c' && S.constraints.some((c) => c.type === 'coincident' && c.joints.includes('c') && c.joints.includes(n.joints[1])), `D: an end on a circle CENTRE is a separate point + Coincident (${types(S)})`);
  app.tool('line'); clk(app, 0, 0); clk(app, 20, -15); app.esc();
  const o = S.shapes.filter((s) => s.type === 'line').at(-1);
  check(o && !o.joints.includes('j_origin') && S.constraints.some((c) => c.type === 'coincident' && c.joints.includes('j_origin') && c.joints.includes(o.joints[0])), `D: a line START at the ORIGIN is a separate point + Coincident (${o && o.joints}; it used to BE the origin)`);
  check(o && o.joints[0] !== 'j_origin', 'D: the origin is no line\'s point');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ E the other drawing tools on an existing line end
for (const [name, draw, check1] of [
  ['rect-2pt first corner', (app) => { pickTool(app, 'rect', 'rect-2pt'); clk(app, -10, 20); clk(app, 20, 45); }, (S) => usersOf(S, 'b') === 3],
  ['arc start', (app) => { pickTool(app, 'arc', 'arc-cse'); clk(app, 10, 20); clk(app, -10, 20); clk(app, 10, 40); }, (S) => usersOf(S, 'b') === 2 && S.shapes.some((s) => s.type === 'arc' && s.joints[1] === 'b')],
  ['circle centre', (app) => { app.tool('circle'); clk(app, -10, 20); clk(app, 0, 20); }, (S) => S.shapes.some((s) => s.type === 'circle' && s.joints[0] === 'b')],
  ['polygon corner', (app) => { app.tool('polygon'); clk(app, 10, 20); clk(app, -10, 20); }, (S) => usersOf(S, 'b') >= 3],
  ['slot centre', (app) => { pickTool(app, 'slot', 'slot-c2c'); clk(app, -10, 20); clk(app, 20, 20); clk(app, 20, 26); }, (S) => usersOf(S, 'b') >= 2],
  ['bezier anchor', (app) => { app.tool('bezier'); clk(app, -10, 20); clk(app, 20, 40); clk(app, 40, 30); app.enter(); }, (S) => S.shapes.some((s) => s.type === 'bezier' && s.joints[0] === 'b')],
]) {
  const app = await openWith();
  const S = app.state;
  draw(app); app.esc(); app.esc();
  const glued = coincidents(S).filter((c) => c.joints.includes('b'));
  check(check1(S) && glued.length === 0 && S.joints.has('b'), `E ${name} on a line's end point: SHARES it (curves at b: ${usersOf(S, 'b')}, coincidents on b: ${glued.length})`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ F a drag glues, never merges
{
  const app = await openWith({ joints: [['c2', { x: 10, y: -20, sketchId: sketch1 }], ['d2', { x: 30, y: -20, sketchId: sketch1 }]], shapes: [{ id: 'M', type: 'line', joints: ['c2', 'd2'], sketchId: sketch1 }] });
  const S = app.state;
  app.tool('select'); app.esc();
  const from = app.toScreen(10, -20), to = app.toScreen(-10, 20);
  app.drag(from, to); app.frames(3);
  check(S.joints.has('c2') && S.shapes.find((s) => s.id === 'M').joints[0] === 'c2' && S.constraints.some((c) => c.type === 'coincident' && c.joints.includes('c2') && c.joints.includes('b')), `F: a point DRAGGED onto another end point is glued by a coincident (${types(S)}), both points stay`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ G Close path
{
  const { planClosePaths, applyClosePath } = await import('#core/close-path.js');
  for (const [name, end, wantLine] of [['near-closed', { x: -40.004, y: 20 }, false], ['gap', { x: -40, y: 32 }, true]]) {
    const app = await openWith({ joints: [['e', { x: -10, y: 50, sketchId: sketch1 }], ['f', end && { ...end, sketchId: sketch1 }]], shapes: [{ id: 'M', type: 'line', joints: ['b', 'e'], sketchId: sketch1 }, { id: 'N', type: 'line', joints: ['e', 'f'], sketchId: sketch1 }] });
    const S = app.state;
    const [plan] = planClosePaths(S, ['L']);
    const r = applyClosePath(S, plan);
    const line = wantLine ? S.shapes.find((s) => s.id === r.lineId) : null;
    if (wantLine) check(r.ok && r.mode === 'line' && line.joints.includes('a') && line.joints.includes('f') && coincidents(S).length === 0, `G ${name}: the closing line SHARES both free ends (${line && line.joints}, coincidents ${coincidents(S).length})`);
    else check(r.ok && r.mode === 'coincident' && coincidents(S).length === 0 && usedJoints(S).size === 3, `G ${name}: the two free ends become ONE point (points ${usedJoints(S).size}, coincidents ${coincidents(S).length})`);
    await app.close();
  }
}

// ------------------------------------------------------------------------------------------------ H old files load unchanged
{
  const profile = await createProfile();
  const J = (id, x, y) => [id, { x, y, sketchId: sketch1 }];
  const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: sketch1 }], J('1A', 10, 10), J('1B', 10, 10), J('2A', 50, 10), J('2B', 50, 10), J('3A', 50, 35), J('3B', 50, 35), J('4A', 10, 35), J('4B', 10, 35)];
  const g = 'rect_old';
  const shapes = [{ id: 's1', type: 'line', joints: ['1A', '2A'], groupId: g, sketchId: sketch1 }, { id: 's2', type: 'line', joints: ['2B', '3B'], groupId: g, sketchId: sketch1 }, { id: 's3', type: 'line', joints: ['4A', '3A'], groupId: g, sketchId: sketch1 }, { id: 's4', type: 'line', joints: ['1B', '4B'], groupId: g, sketchId: sketch1 }];
  const constraints = [{ type: 'horizontal', joints: ['1A', '2A'] }, { type: 'vertical', joints: ['2B', '3B'] }, { type: 'horizontal', joints: ['4A', '3A'] }, { type: 'vertical', joints: ['1B', '4B'] },
    ...['1', '2', '3', '4'].map((k) => ({ type: 'coincident', joints: [k + 'A', k + 'B'] }))];
  await createNamedDesign(profile, 'sketchstudio', 'T1045 H', { version: 3, hosts: {}, geometry: { joints, shapes, constraints, parameters: [], sketches: [{ id: sketch1, name: 'Sketch 1', visible: true }], activeSketchId: sketch1, groups: [], profiles: [] } });
  const app = await openApp({ profile });
  const S = app.state;
  check(S.joints.size === 9 && coincidents(S).length === 4 && sharedPointCoincidents(S.joints, S.shapes).length === 0, `H: an old rectangle loads as saved: 8 corner joints + 4 coincidents, no conversion (${S.joints.size - 1}, ${coincidents(S).length})`);
  check(dof(S) === 4, `H: its DOF 4 (${dof(S)})`);
  app.tool('select'); app.esc();
  clickJoint(app, '2A');
  const co = coincidents(S).find((c) => c.joints.includes('2A'));
  check(co && co.__visible === true, 'H: its corner shows its coincident glyph');
  const p = glyphPoint(app, co); app.click(p.x, p.y);
  const n = S.constraints.length;
  app.key('Delete');
  check(S.constraints.length === n - 1 && !S.constraints.includes(co), 'H: Delete removes that coincident (as before)');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ I undo, Esc
{
  const app = await openApp();
  const S = app.state;
  const h0 = S.history.length;
  pickTool(app, 'rect', 'rect-2pt'); clk(app, 10, 10); clk(app, 50, 35); app.esc(); app.esc();
  check(S.history.length === h0 + 1, `I: a rectangle is ONE undo step (${S.history.length - h0})`);
  app.undo();
  check(S.shapes.length === 0 && S.joints.size === 1 && S.constraints.length === 0, `I: undo removes it whole (${S.shapes.length} shapes, ${S.joints.size} joints, ${S.constraints.length} constraints)`);
  app.tool('line'); clk(app, 10, 10); clk(app, 40, 10); clk(app, 40, 30); app.esc();
  check(lines(S).length === 2, 'I: a chain of 2 segments');
  app.undo();
  check(lines(S).length === 1 && usedJoints(S).size === 2 && S.joints.size === 3, `I: undo removes the LAST segment and its end point only (${lines(S).length} line, ${S.joints.size} joints)`);
  app.undo();
  check(S.shapes.length === 0 && S.joints.size === 1, `I: a second undo removes the first segment (${S.joints.size} joints)`);
  await app.close();
}
{ // Esc after a first click on an existing end point: the point and what is on it stay
  const app = await openWith({ constraints: [{ type: 'horizontal', joints: ['a', 'b'] }] });
  const S = app.state;
  app.tool('line'); clk(app, -10, 20); app.esc();
  check(S.joints.has('b') && S.constraints.some((c) => c.type === 'horizontal') && S.shapes.length === 1 && S.joints.size === 3, `I: Esc after a first click on a line's end point leaves that point and its constraints (${types(S)}, joints ${S.joints.size})`);
  await app.close();
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
