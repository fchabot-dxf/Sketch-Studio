// tests/split-shared-point-1041-node.test.js — TASK 1041: SPLIT A SHARED POINT, Fusion's way (#core/shared-point.js), through the app's own
// select tool, glyph pick, Delete key, context menu and footer Delete in the node kit (tests/helpers/node-app.js).
// FUSION, MEASURED by the advisor 2026-11-27 with the real mouse:
//   - two curves at a point share ONE SketchPoint (no coincident in the API); a click on the point shows a coincident glyph (none with nothing
//     selected) = an entity "SharedPointCoincident"; with n curves at the point there are n - 1 glyphs (3 lines -> 2); the curve that joined last
//     owns the point (no glyph of its own);
//   - Delete on a glyph detaches ONLY that curve: it gets its own new point (sketch points +1), the others keep sharing;
//   - constraints on the curves stay on the curves (Horizontal stayed on its line); a dimension ON THE POINT stays with the curve that joined it
//     LAST (measured twice with the roles reversed); the earlier curve gets a fresh point;
//   - never refused: an Offset copy's corner split removes the Offset relationship; a circular pattern SOURCE corner split removes the pattern.
// Parts:
//   A  polygon corner (3 curves: 2 edges + the construction radius): 2 glyphs, shown only while the point is selected; a click on a glyph selects
//      it; Delete detaches that curve: +1 joint, the owner keeps the id and the point's pointOnLine, DOF +2, converges, ONE undo step restoring
//      the shared joint exactly (ids), the other two curves keep sharing; a drag of the detached end pulls the corner apart; save + reload
//   B  the kept-attachment rule on two lines with a point dimension, a pointOnLine and a lock on the point and H + length on each line, both
//      shape orders (the roles reversed, as measured)
//   C  a slot cap joint (both ways: the line detached from the arc, the arc detached from the line: its centre-rim equal follows the arc)
//   D  a fillet joint: the leg detached, tangents + virtual sharp stay, the arc is no live fillet any more
//   E  an imported shared corner, F a mirror copy corner (its symmetric stays with the owner)
//   G  an offset copy corner (the offset record dissolves), H a pattern SOURCE corner (the pattern dissolves) and a pattern COPY corner (it stays;
//      BUG-411: when that instance is removed later its copies' detached point goes with them)
//   I  stacked corners (a rectangle) are unchanged: no shared glyph, their coincident deletes as before
//   J  BUG-410: 3 and 4 ends glued at one spot (chain A-B B-C, star A-B A-C), plus a pointOnLine on one stacked joint: selecting / hovering ANY
//      point at the spot shows EVERY coincident / point-on-line glyph of the spot
//   K  the context menu's Delete and the footer Delete (the phone's delete path) on a glyph split the point too
//   L  Fusion's mixed stack (a shared corner + a line glued on by a coincident): both glyphs show; each Delete undoes only its own join
//   M  the point's context menu "Delete Coincident" (Fusion, owner-checked): unjoins the spot in ONE step; absent on a point with no join
import assert from 'node:assert';
import { open, createProfile, createNamedDesign, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import { sharedPointCoincidents, curvesAtJoint, SHARED_POINT_COINCIDENT } from '#core/shared-point.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { applyFillet, findCornerAtJoint, isLiveFillet } from '#core/fillet.js';
import { mirrorObjects } from '#core/mirror.js';
import { applyOffset, offsetChainOf } from '#core/offset.js';
import { applyPattern, patternDefaults, isPatternConstraint, editPattern } from '#core/pattern.js';
import { glyphAt } from '#ui/hover-manager.js';
import { enterGroup } from '#core/group-model.js';

await loadGlyphSheetFromDisk(); // task 603: a glyph is picked where its icon is drawn
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

const sketch1 = 'sketch-1';
async function openApp(opts = {}) {
  const app = await open({ host: 'sketchstudio', ...opts });
  setView(app, 0, 0, 160);
  return app;
}
function setView(app, x, y, w) {
  const r = app.svg.getBoundingClientRect(), v = app.state.view;
  Object.assign(v, { x, y, w }); v.h = w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${v.x - v.w / 2} ${v.y - v.h / 2} ${v.w} ${v.h}`);
  app.frames(2);
}
const at = (app, x, y) => app.toScreen(x, y);
const clk = (app, x, y) => { const p = at(app, x, y); app.click(p.x, p.y); };
const clickJoint = (app, id) => { const j = app.state.joints.get(id); clk(app, j.x, j.y); };
// a point ON the glyph's drawn icon (task 603: the pick follows the drawn strokes, its centre is empty) as far as possible from its joint (a press
// within the joint's reach picks the joint first): the screen points around the glyph's centre that hover-manager glyphAt picks it at
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
  return { x: best.x, y: best.y };
};
const clickGlyph = (app, g) => { const p = glyphPoint(app, g); app.click(p.x, p.y); };
const glyphsAt = (app, jid) => sharedPointCoincidents(app.state.joints, app.state.shapes).filter((g) => g.joints[0] === jid);
const visibleGlyphs = (app, jid) => glyphsAt(app, jid).filter((g) => g.__visible === true);
const dof = (S) => analyzeConstraintStatus(S).dof;
const strip = (c) => { const { glyphPos, __visible, __showGlyph, ...r } = c; return r; };
const docOf = (S) => JSON.stringify({ joints: [...S.joints].map(([id, j]) => [id, j.x, j.y, !!j.fixed]), shapes: S.shapes.map((s) => [s.id, s.joints]), constraints: S.constraints.map(strip) });
const shapeById = (S, id) => S.shapes.find((s) => s.id === id);
// select the point, click the glyph of `curveId`, press Delete; returns { before, newJoint }
function splitVia(app, jid, curveId, how = 'key') {
  const S = app.state;
  app.tool('select'); app.esc();
  // an imported / copied drawing is a user group (task 751): a user enters it (a double click) before picking one of its points
  const grp = curvesAtJoint(S.shapes, jid).map((s) => s.userGroupId).find(Boolean);
  if (grp) enterGroup(S, grp);
  clickJoint(app, jid);
  const g = glyphsAt(app, jid).find((e) => e.shape === curveId);
  assert(g && g.__visible === true, `the glyph of ${curveId} at ${jid} shows while the point is selected`);
  clickGlyph(app, g);
  assert(S.selectedConstraints.has(g) && S.selectedConstraints.size === 1 && !S.selectedJoints.size && !S.selectedShapes.size, 'a click on the glyph selects it alone');
  const before = { joints: S.joints.size, history: S.history.length, dof: dof(S), doc: docOf(S) };
  if (how === 'key') app.key('Delete');
  else if (how === 'menu') { // the right click on the glyph opens the constraint menu; its Delete
    const p = glyphPoint(app, g); app.rightClick(p.x, p.y);
    const item = app.document.querySelector('.sk-context-menu .sk-context-item[data-id="con-delete"]');
    assert(item, 'the right click on the glyph opens the constraint menu with its Delete'); item.click(); app.frames();
  }
  else if (how === 'footer') { const b = app.document.getElementById('btn-delete-selection'); assert(b && !b.disabled, 'the footer Delete is enabled with the glyph selected'); app.press(b); }
  const curve = shapeById(S, curveId);
  const newJoint = curve.joints.find((j) => !JSON.parse(before.doc).joints.some(([id]) => id === j));
  return { before, newJoint };
}

// ------------------------------------------------------------------------------------------------ A polygon corner
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'T1041 A');
  let app = await openApp({ profile });
  const S = app.state;
  app.tool('polygon'); clk(app, 0, 0); clk(app, 30, 0); app.esc(); app.esc();
  app.tool('select'); app.esc();
  const edges = S.shapes.filter((s) => !s.isConstruction);
  const corner = edges[0].joints[1]; // edge 0's end = edge 1's start, and one construction radius
  const curves = curvesAtJoint(S.shapes, corner);
  check(curves.length === 3, `A: the polygon corner is shared by 3 curves (2 sides + the construction radius): ${curves.length}`);
  check(glyphsAt(app, corner).length === 2, 'A: n - 1 = 2 SharedPointCoincident glyphs there (Fusion: 3 lines -> 2)');
  const owner = curves[2];
  check(!glyphsAt(app, corner).some((g) => g.shape === owner.id), 'A: the latest curve owns the point: no glyph of its own');
  check(visibleGlyphs(app, corner).length === 0, 'A: no glyph shows with nothing selected');
  const pol0 = S.constraints.find((c) => c.type === 'pointOnLine' && c.shape === 'ref_axis_x');
  const victim = curves.find((s) => s !== owner && !s.isConstruction);
  const { before, newJoint } = splitVia(app, corner, victim.id);
  check(S.joints.size === before.joints + 1, `A: Delete adds ONE joint (${before.joints} -> ${S.joints.size})`);
  check(S.history.length === before.history + 1, `A: ONE undo step (${before.history} -> ${S.history.length})`);
  check(!!newJoint && newJoint !== corner && shapeById(S, victim.id).joints.includes(newJoint), 'A: the detached side ends at a NEW joint');
  check(curvesAtJoint(S.shapes, corner).length === 2 && curvesAtJoint(S.shapes, corner).every((s) => s !== shapeById(S, victim.id)), 'A: the other two curves keep sharing the corner (its id kept)');
  const nj = S.joints.get(newJoint), cj = S.joints.get(corner);
  check(nj.x === cj.x && nj.y === cj.y && !nj.fixed, 'A: the new joint is at the same place, not fixed');
  check(glyphsAt(app, corner).length === 1 && glyphsAt(app, newJoint).length === 0, 'A: one glyph left at the corner, none at the new point');
  check(dof(S) === before.dof + 2, `A: DOF goes up by 2 (${before.dof} -> ${dof(S)})`);
  check(S.engine.solve(500).converged, 'A: the solver converges');
  // the drag of the detached end pulls the corner apart
  const p0 = at(app, nj.x, nj.y);
  app.tool('select'); app.esc();
  // the press at the spot picks one of the two points there: drag it 60 px away; one end moves, the other stays
  app.drag(p0, { x: p0.x + 60, y: p0.y + 40 }, 10);
  const moved = [newJoint, corner].map((id) => { const j = S.joints.get(id); return Math.hypot(j.x - cj.x, j.y - cj.y) > 1; });
  const gap = Math.hypot(S.joints.get(newJoint).x - S.joints.get(corner).x, S.joints.get(newJoint).y - S.joints.get(corner).y);
  check(gap > 1, `A: dragging one end pulls the corner apart (gap ${gap.toFixed(2)} mm, moved ${moved})`);
  app.undo();
  app.undo();
  check(docOf(S) === before.doc, 'A: Undo restores the shared joint exactly (shapes, joint ids, constraints)');
  check(pol0 && S.constraints.some((c) => c.type === 'pointOnLine' && c.shape === 'ref_axis_x'), 'A: the polygon point on the X axis is still there');
  // save + reload a split corner
  app.redo(); app.frames(2);
  const saved = docOf(S);
  await app.storedDoc();
  await app.close();
  app = await openApp({ profile });
  check(docOf(app.state) === saved, 'A: the split document saves and reloads unchanged');
  check(curvesAtJoint(app.state.shapes, corner).length === 2, 'A: after the reload the corner is shared by 2 curves, the detached side ends at its own point');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ B the kept-attachment rule, both orders
for (const order of ['L1 first', 'L2 first']) {
  const profile = await createProfile();
  const L1 = { id: 'L1', type: 'line', joints: ['a', 'J'], sketchId: sketch1 }, L2 = { id: 'L2', type: 'line', joints: ['J', 'b'], sketchId: sketch1 };
  const doc = { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: sketch1 }], ['a', { x: -30, y: 0, sketchId: sketch1 }], ['J', { x: 0, y: 0.0001 + 10, sketchId: sketch1 }],
      ['b', { x: 0, y: 40, sketchId: sketch1 }], ['p', { x: 25, y: 10, sketchId: sketch1 }], ['q1', { x: 20, y: -20, sketchId: sketch1 }], ['q2', { x: 20, y: 30, sketchId: sketch1 }]],
    shapes: order === 'L1 first' ? [L1, L2, { id: 'L3', type: 'line', joints: ['q1', 'q2'], sketchId: sketch1 }] : [L2, L1, { id: 'L3', type: 'line', joints: ['q1', 'q2'], sketchId: sketch1 }],
    constraints: [
      { type: 'horizontal', joints: ['a', 'J'] },
      { type: 'distance', joints: ['a', 'J'], value: 30, dimMode: 'horizontal', offset: -8, name: 'd1' },  // L1's length (on the curve)
      { type: 'vertical', joints: ['J', 'b'] },
      { type: 'distance', joints: ['J', 'b'], value: 30, offset: 8, name: 'd2' },                         // L2's length (on the curve)
      { type: 'distance', joints: ['J', 'p'], value: 25, offset: 6, name: 'd3' },                         // a dimension ON THE POINT
      { type: 'distance', joints: ['J', 'q1', 'q2'], value: 20, offset: 6, name: 'd4' },                  // a point-to-line dimension ON THE POINT
    ],
    parameters: [], sketches: [{ id: sketch1, name: 'Sketch 1', visible: true }], activeSketchId: sketch1, groups: [], profiles: [] } };
  await createNamedDesign(profile, 'sketchstudio', 'T1041 B', doc);
  const app = await openApp({ profile });
  const S = app.state;
  S.engine.solve(500); app.frames(2);
  const owner = order === 'L1 first' ? 'L2' : 'L1', detached = order === 'L1 first' ? 'L1' : 'L2';
  check(glyphsAt(app, 'J').length === 1 && glyphsAt(app, 'J')[0].shape === detached, `B ${order}: one glyph at J, for ${detached} (${owner} joined last and owns J)`);
  const { newJoint } = splitVia(app, 'J', detached);
  const find = (name) => S.constraints.find((c) => c.name === name);
  const own = (s) => shapeById(S, s).joints;
  check(own(owner).includes('J') && own(detached).includes(newJoint) && !own(detached).includes('J'), `B ${order}: ${owner} keeps J, ${detached} gets ${newJoint}`);
  const hv = (t) => S.constraints.find((c) => c.type === t);
  const onDetached = detached === 'L1' ? { hv: hv('horizontal'), len: find('d1') } : { hv: hv('vertical'), len: find('d2') };
  const onOwner = detached === 'L1' ? { hv: hv('vertical'), len: find('d2') } : { hv: hv('horizontal'), len: find('d1') };
  check(onDetached.hv.joints.includes(newJoint) && !onDetached.hv.joints.includes('J'), `B ${order}: the H / V of ${detached} stays on ${detached} (its new joint)`);
  check(onDetached.len.joints.includes(newJoint) && !onDetached.len.joints.includes('J'), `B ${order}: the length of ${detached} stays on ${detached}`);
  check(onOwner.hv.joints.includes('J') && onOwner.len.joints.includes('J'), `B ${order}: ${owner}'s own H / V and length still read J`);
  check(find('d3').joints[0] === 'J' && find('d4').joints[0] === 'J', `B ${order}: the dimensions ON THE POINT stay with J (${owner}, joined last)`);
  check(!S.constraints.some((c) => (c.joints || []).includes(newJoint) && c !== onDetached.hv && c !== onDetached.len), `B ${order}: the new joint carries nothing but ${detached}'s own constraints`);
  const res = S.engine.solve(500);
  check(res.converged, `B ${order}: the solver converges`);
  await app.close();
}

// a lock (fixed) and a pointOnLine on the point stay with the owner; the new point is free
{
  const profile = await createProfile();
  const doc = { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: sketch1 }], ['a', { x: -30, y: 5, sketchId: sketch1 }], ['J', { x: 0, y: 5, fixed: true, sketchId: sketch1 }],
      ['b', { x: 20, y: 30, sketchId: sketch1 }], ['m', { x: 10, y: 30, sketchId: sketch1 }], ['n', { x: -10, y: -20, sketchId: sketch1 }]],
    shapes: [{ id: 'L1', type: 'line', joints: ['a', 'J'], sketchId: sketch1 }, { id: 'L2', type: 'line', joints: ['J', 'b'], sketchId: sketch1 }, { id: 'L3', type: 'line', joints: ['m', 'n'], sketchId: sketch1 }],
    constraints: [{ type: 'pointOnLine', joint: 'J', shape: 'L3' }],
    parameters: [], sketches: [{ id: sketch1, name: 'Sketch 1', visible: true }], activeSketchId: sketch1, groups: [], profiles: [] } };
  await createNamedDesign(profile, 'sketchstudio', 'T1041 B2', doc);
  const app = await openApp({ profile });
  const S = app.state;
  const { newJoint } = splitVia(app, 'J', 'L1');
  check(S.joints.get('J').fixed === true && !S.joints.get(newJoint).fixed, 'B2: the lock stays on J (the owner L2), the new point of L1 is free');
  check(S.constraints.some((c) => c.type === 'pointOnLine' && c.joint === 'J' && c.shape === 'L3') && !S.constraints.some((c) => c.joint === newJoint), 'B2: the pointOnLine on the point stays with J');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ C slot cap joints
for (const which of ['line from arc', 'arc from line']) {
  const app = await openApp();
  const S = app.state;
  app.tool('slot'); clk(app, 0, 0); clk(app, 40, 0); clk(app, 40, 10); app.esc(); app.esc();
  const arcs = S.shapes.filter((s) => s.type === 'arc'), lines = S.shapes.filter((s) => s.type === 'line' && !s.isConstruction);
  // every cap joint is shared by a side line and a cap arc; pick a joint whose owner is the arc (line detached) or the line (arc detached)
  const joints = [...new Set(lines.flatMap((l) => l.joints))];
  const jid = joints.find((j) => { const cs = curvesAtJoint(S.shapes, j); return cs.length === 2 && (which === 'line from arc' ? cs[1].type === 'arc' : cs[1].type === 'line'); });
  const cs = curvesAtJoint(S.shapes, jid), victim = cs[0], arc = cs.find((s) => s.type === 'arc');
  const equalOfArc = () => S.constraints.find((c) => c.type === 'equal' && Array.isArray(c.joints) && c.joints[0] === arc.joints[0]);
  const tangentsBefore = S.constraints.filter((c) => c.type === 'tangent').length;
  const dof0 = dof(S);
  const { newJoint } = splitVia(app, jid, victim.id);
  check(!!newJoint, `C ${which}: the ${victim.type} gets a new joint`);
  const eq = equalOfArc();
  const arcNow = shapeById(S, arc.id);
  check(eq && eq.joints.every((j) => arcNow.joints.includes(j)), `C ${which}: the arc's centre-rim equal reads only the arc's own joints (${eq && eq.joints})`);
  check(S.constraints.filter((c) => c.type === 'tangent').length === tangentsBefore, `C ${which}: the slot's tangents stay (on the curves)`);
  check(dof(S) === dof0 + 2, `C ${which}: DOF +2 (${dof0} -> ${dof(S)})`);
  check(S.engine.solve(500).converged, `C ${which}: the solver converges`);
  const used = new Set(S.shapes.flatMap((s) => s.joints));
  check(S.constraints.every((c) => (c.joints || []).every((j) => S.joints.has(j) || j.startsWith('ref'))), `C ${which}: no constraint names a missing joint`);
  check(used.has(newJoint), `C ${which}: the new joint is used by the detached curve`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ D fillet joint
{
  const app = await openApp();
  const S = app.state;
  app.tool('polygon'); clk(app, 0, 0); clk(app, 30, 0); app.esc(); app.esc();
  const corner = S.shapes[0].joints[1];
  S.saveState('fillet');
  const r = applyFillet(S, findCornerAtJoint(S, corner), 5);
  check(r && r.success, 'D: a fillet on the polygon corner');
  S.engine.solve(500); app.frames(2);
  const arc = shapeById(S, r.arc.id);
  check(isLiveFillet(S, arc), 'D: the fillet is live before the split');
  const rim = arc.joints[1];
  const cs = curvesAtJoint(S.shapes, rim);
  check(cs.length === 2 && cs[1].id === arc.id, 'D: the rim is shared by the leg and the fillet arc (the arc joined last)');
  const leg = cs[0];
  const dof0 = dof(S);
  const { newJoint } = splitVia(app, rim, leg.id);
  check(shapeById(S, arc.id).joints[1] === rim && shapeById(S, leg.id).joints.includes(newJoint), 'D: the arc keeps the rim, the leg gets a new joint');
  check(S.constraints.filter((c) => c.type === 'tangent' && c.circle === arc.id).length === 2, 'D: both tangents stay (on the curves)');
  check(S.joints.has(r.virtualSharp) && shapeById(S, arc.id).filletSharp === r.virtualSharp, 'D: the virtual sharp stays');
  check(!isLiveFillet(S, shapeById(S, arc.id)), 'D: the arc is no live fillet any more (a leg is no longer joined): its radius edits as a plain arc');
  check(dof(S) === dof0 + 2, `D: DOF +2 (${dof0} -> ${dof(S)})`);
  check(S.engine.solve(500).converged, 'D: the solver converges');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ E imported shared corner, F mirror copy corner
{
  const app = await openApp();
  const S = app.state;
  app.importFile('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M10 10 L60 10 L60 50 Z"/></svg>', 'tri.svg');
  await app.pause(30);
  const tri = S.shapes.filter((s) => s.type === 'line');
  check(tri.length === 3, 'E: the imported triangle is 3 lines');
  const j = tri[0].joints[1];
  const cs = curvesAtJoint(S.shapes, j);
  check(cs.length === 2, 'E: its corner is one shared joint');
  setView(app, S.joints.get(j).x, S.joints.get(j).y, 120);
  const n0 = S.joints.size, h0 = S.history.length;
  const { before: bE } = splitVia(app, j, cs[0].id); // (the DOF inside the entered import group: outside it the group is one rigid block)
  check(S.joints.size === n0 + 1 && S.history.length === h0 + 1 && dof(S) === bE.dof + 2, `E: +1 joint, ONE step, DOF +2 (${bE.dof} -> ${dof(S)})`);
  check(S.engine.solve(500).converged, 'E: the solver converges');

  // F: mirror the (now partly split) triangle's two still-joined sides about a vertical line: the copies share their corner
  S.esc && S.esc();
  app.tool('line'); clk(app, S.joints.get(j).x - 40, S.joints.get(j).y - 30); clk(app, S.joints.get(j).x - 40, S.joints.get(j).y + 30); app.esc(); app.esc();
  const axis = S.shapes[S.shapes.length - 1];
  const pair = tri.slice(1).map((s) => s.id); // sides 1 and 2 share the far corner
  S.saveState('mirror');
  const m = mirrorObjects(S, { shapes: pair, joints: [] }, axis.id);
  check(m.ok && m.shapes.length === 2, 'F: the mirror makes 2 copies');
  S.engine.solve(500); app.frames(2);
  const copies = m.shapes.map((id) => shapeById(S, id));
  const shared = copies[0].joints.find((x) => copies[1].joints.includes(x));
  check(!!shared, 'F: the copies share their corner (one joint)');
  const sym = S.constraints.find((c) => c.type === 'symmetric' && (c.joints || []).includes(shared));
  check(!!sym, 'F: the shared copy corner carries a symmetric (on the point)');
  const cs2 = curvesAtJoint(S.shapes, shared);
  setView(app, S.joints.get(shared).x, S.joints.get(shared).y, 120);
  const { before: bF, newJoint } = splitVia(app, shared, cs2[0].id);
  const dofF = bF.dof;
  check(sym.joints.includes(shared) && !sym.joints.includes(newJoint), 'F: the symmetric stays with the owner copy (joined last)');
  check(dof(S) === dofF + 2, `F: DOF +2 (${dofF} -> ${dof(S)})`);
  check(S.engine.solve(500).converged, 'F: the solver converges');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ G offset copy corner, H pattern
{
  const app = await openApp();
  const S = app.state;
  app.importFile('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M10 10 L60 10 L60 50"/></svg>', 'vee.svg');
  await app.pause(30);
  const src = S.shapes.filter((s) => s.type === 'line');
  const ch = offsetChainOf(S, src[0].id);
  S.saveState('offset');
  const o = applyOffset(S, ch.chain, 3, 1);
  check(o.ok, 'G: an offset of the open 2-line chain');
  S.engine.solve(500); app.frames(2);
  const off = o.shapes.map((id) => shapeById(S, id));
  const join = off[0].joints.find((x) => off[1].joints.includes(x));
  check(!!join, 'G: the offset copies share their join');
  const cs = curvesAtJoint(S.shapes, join);
  setView(app, S.joints.get(join).x, S.joints.get(join).y, 80);
  splitVia(app, join, cs[0].id);
  check(!S.constraints.some((c) => c.type === 'offset'), 'G: the offset relationship is removed (Fusion: the copies become plain lines)');
  check(off.every((s) => shapeById(S, s.id)), 'G: the copies stay as plain lines');
  check(S.engine.solve(500).converged, 'G: the solver converges');
  app.undo();
  check(S.constraints.some((c) => c.type === 'offset') && curvesAtJoint(S.shapes, join).length === 2, 'G: Undo brings the offset and the shared join back');
  await app.close();
}
{
  const app = await openApp();
  const S = app.state;
  app.importFile('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M30 10 L60 10 L60 30"/></svg>', 'vee.svg');
  await app.pause(30);
  const src = S.shapes.filter((s) => s.type === 'line');
  S.saveState('pattern');
  const p = applyPattern(S, 'circularPattern', { shapes: src.map((s) => s.id), joints: [] }, { ...patternDefaults('circularPattern'), centre: 'j_origin' });
  check(p.ok, 'H: a circular pattern of the 2 joined lines');
  S.engine.solve(500); app.frames(2);
  // a COPY corner: the pattern stays
  const copyA = shapeById(S, p.shapes[0]), copyB = shapeById(S, p.shapes[1]);
  const copyJoin = copyA.joints.find((x) => copyB.joints.includes(x));
  check(!!copyJoin, 'H: the pattern copies share their corner');
  setView(app, S.joints.get(copyJoin).x, S.joints.get(copyJoin).y, 80);
  splitVia(app, copyJoin, curvesAtJoint(S.shapes, copyJoin)[0].id);
  check(S.constraints.some(isPatternConstraint), 'H: a COPY corner split keeps the pattern (its point row stays with the owner copy)');
  check(S.engine.solve(500).converged, 'H: the solver converges after the copy split');
  // a SOURCE corner: the pattern dissolves, the copies stay as plain geometry with their own shared corners
  const srcJoin = src[0].joints.find((x) => src[1].joints.includes(x));
  setView(app, S.joints.get(srcJoin).x, S.joints.get(srcJoin).y, 80);
  const copyShapes = p.shapes.slice();
  splitVia(app, srcJoin, curvesAtJoint(S.shapes, srcJoin)[0].id);
  check(!S.constraints.some(isPatternConstraint), 'H: a SOURCE corner split removes the pattern relationship (Fusion)');
  check(copyShapes.every((id) => shapeById(S, id)), 'H: the copies stay as plain geometry');
  const otherCopyA = shapeById(S, p.shapes[2]), otherCopyB = shapeById(S, p.shapes[3]);
  check(otherCopyA.joints.some((x) => otherCopyB.joints.includes(x)), 'H: the other copies keep their own shared corner');
  check(S.engine.solve(500).converged, 'H: the solver converges after the source split');
  await app.close();
}

{ // H2 (BUG-411): a pattern COPY corner split (Fusion, measured 2026-11-27: the pattern stays, points +1), then the instance removed: its copies
  // go with every point they used (no lone point left)
  const app = await openApp();
  const S = app.state;
  app.importFile('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path d="M30 10 L60 10 L60 30"/></svg>', 'vee.svg');
  await app.pause(30);
  const src = S.shapes.filter((s) => s.type === 'line');
  S.saveState('pattern');
  const p = applyPattern(S, 'circularPattern', { shapes: src.map((s) => s.id), joints: [] }, { ...patternDefaults('circularPattern'), centre: 'j_origin' });
  S.engine.solve(500); app.frames(2);
  const lastA = shapeById(S, p.shapes[2]), lastB = shapeById(S, p.shapes[3]);
  const lastJoin = lastA.joints.find((x) => lastB.joints.includes(x));
  setView(app, S.joints.get(lastJoin).x, S.joints.get(lastJoin).y, 80);
  const { newJoint: lone } = splitVia(app, lastJoin, curvesAtJoint(S.shapes, lastJoin)[0].id);
  const pc = S.constraints.find(isPatternConstraint);
  S.saveState('pattern quantity');
  check(editPattern(S, pc, { quantity: 2 }).ok, 'H2: the pattern quantity cut to 2');
  check(!!lone && !S.joints.has(lone), `H2 (BUG-411): the removed copy's detached point goes with it (${lone} left: ${S.joints.has(lone)})`);
  const used = new Set(S.shapes.flatMap((s) => s.joints));
  check([...S.joints.keys()].every((j) => used.has(j) || j === 'j_origin' || S.constraints.some((c) => (c.joints || []).includes(j) || c.joint === j || c.centre === j)), 'H2 (BUG-411): no lone point is left');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ I stacked corners unchanged
{
  const app = await openApp();
  const S = app.state;
  app.tool('rect'); clk(app, -20, -10); clk(app, 20, 15); app.esc(); app.esc();
  check(sharedPointCoincidents(S.joints, S.shapes).length === 0, 'I: a rectangle has no shared point (two joints + a coincident per corner)');
  const co = S.constraints.filter((c) => c.type === 'coincident');
  check(co.length >= 4, `I: its corners are stacked joints held by ${co.length} coincidents`);
  app.tool('select'); app.esc();
  clickJoint(app, co[0].joints[0]);
  check(co[0].__visible === true, 'I: selecting the corner shows its coincident glyph (as before)');
  clickGlyph(app, co[0]);
  check(S.selectedConstraints.has(co[0]), 'I: a click on it selects the coincident');
  const n = S.constraints.length, nj = S.joints.size;
  app.key('Delete');
  check(S.constraints.length === n - 1 && !S.constraints.includes(co[0]) && S.joints.size === nj, 'I: Delete removes that coincident only (as before)');
  await app.close();
}

// ------------------------------------------------------------------------------------------------ J BUG-410: every glyph of a glued spot shows
for (const shape of ['chain 3', 'star 3', 'chain 4', 'star 4']) {
  const profile = await createProfile();
  const n = Number(shape.slice(-1));
  const ends = Array.from({ length: n }, (_, i) => 'e' + i), fars = Array.from({ length: n }, (_, i) => 'f' + i);
  const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: sketch1 }]];
  ends.forEach((e) => joints.push([e, { x: 10, y: 10, sketchId: sketch1 }]));
  fars.forEach((f, i) => { const a = (i / n) * 2 * Math.PI; joints.push([f, { x: 10 + 30 * Math.cos(a), y: 10 + 30 * Math.sin(a), sketchId: sketch1 }]); });
  joints.push(['q1', { x: -20, y: 10, sketchId: sketch1 }], ['q2', { x: 40, y: 10, sketchId: sketch1 }]);
  const shapes = ends.map((e, i) => ({ id: 'L' + i, type: 'line', joints: [e, fars[i]], sketchId: sketch1 }));
  shapes.push({ id: 'M', type: 'line', joints: ['q1', 'q2'], sketchId: sketch1 });
  const glue = shape.startsWith('chain') ? ends.slice(1).map((e, i) => ({ type: 'coincident', joints: [ends[i], e] })) : ends.slice(1).map((e) => ({ type: 'coincident', joints: [ends[0], e] }));
  const constraints = [...glue, { type: 'pointOnLine', joint: ends[n - 1], shape: 'M' }];
  await createNamedDesign(profile, 'sketchstudio', 'T1041 J', { version: 3, hosts: {}, geometry: { joints, shapes, constraints, parameters: [], sketches: [{ id: sketch1, name: 'Sketch 1', visible: true }], activeSketchId: sketch1, groups: [], profiles: [] } });
  const app = await openApp({ profile });
  const S = app.state;
  app.tool('select'); app.esc();
  const spotGlyphs = () => S.constraints.filter((c) => c.type === 'coincident' || c.type === 'pointOnLine');
  check(spotGlyphs().every((c) => c.__visible === false), `J ${shape}: nothing selected: no glyph at the spot`);
  for (const pick of ends) {
    S.selectedJoints.clear(); S.selectedJoints.add(pick); app.frames(2);
    const shown = spotGlyphs().filter((c) => c.__visible === true).length;
    check(shown === spotGlyphs().length, `J ${shape}: ${pick} selected: every glyph at the spot shows (${shown}/${spotGlyphs().length})`);
    S.selectedJoints.clear(); S.hoveredJoint = pick; app.frames(2);
    const hov = spotGlyphs().filter((c) => c.__visible === true).length;
    check(hov === spotGlyphs().length, `J ${shape}: ${pick} hovered: every glyph at the spot shows (${hov}/${spotGlyphs().length})`);
    S.hoveredJoint = null;
  }
  // a real click at the spot (the select tool's pick: one of the stacked points) shows them all
  clk(app, 10, 10);
  check(S.selectedJoints.size === 1 && spotGlyphs().every((c) => c.__visible === true), `J ${shape}: a click at the spot selects one point and shows all ${spotGlyphs().length} glyphs`);
  await app.close();
}

// ------------------------------------------------------------------------------------------------ L mixed stack (Fusion measured)
// lines A and B SHARE a corner joint S; line C's end is a SEPARATE joint c glued onto it by a coincident. Fusion: selecting the spot shows BOTH
// glyphs side by side, the shared-point glyph (Delete = split A / B) and C's coincident (Delete = unglue C); each Delete undoes only its own join.
for (const pickJoint of ['S', 'c']) {
  for (const del of ['shared', 'coincident']) {
    const profile = await createProfile();
    const doc = { version: 3, hosts: {}, geometry: {
      joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: sketch1 }], ['a', { x: -30, y: 10, sketchId: sketch1 }], ['S', { x: 10, y: 10, sketchId: sketch1 }],
        ['b', { x: 10, y: 40, sketchId: sketch1 }], ['c', { x: 10, y: 10, sketchId: sketch1 }], ['f', { x: 35, y: -10, sketchId: sketch1 }]],
      shapes: [{ id: 'A', type: 'line', joints: ['a', 'S'], sketchId: sketch1 }, { id: 'B', type: 'line', joints: ['S', 'b'], sketchId: sketch1 }, { id: 'C', type: 'line', joints: ['c', 'f'], sketchId: sketch1 }],
      constraints: [{ type: 'coincident', joints: ['S', 'c'] }],
      parameters: [], sketches: [{ id: sketch1, name: 'Sketch 1', visible: true }], activeSketchId: sketch1, groups: [], profiles: [] } };
    await createNamedDesign(profile, 'sketchstudio', 'T1041 L', doc);
    const app = await openApp({ profile });
    const S = app.state;
    app.tool('select'); app.esc();
    S.selectedJoints.clear(); S.selectedJoints.add(pickJoint); app.frames(2); // the click at the spot picks one of the two stacked points
    const shared = glyphsAt(app, 'S')[0], co = S.constraints.find((c) => c.type === 'coincident');
    check(shared && shared.shape === 'A' && shared.__visible === true && co.__visible === true, `L ${pickJoint} picked: BOTH glyphs show (the shared point's for A, C's coincident)`);
    const sp = app.toScreen(shared.glyphPos.x, shared.glyphPos.y), cp = app.toScreen(co.glyphPos.x, co.glyphPos.y), dist = Math.hypot(sp.x - cp.x, sp.y - cp.y);
    check(dist > 10, `L ${pickJoint} picked: the two glyphs sit side by side (${dist.toFixed(0)} px apart)`);
    const g = del === 'shared' ? shared : co;
    clickGlyph(app, g);
    check(S.selectedConstraints.has(g) && S.selectedConstraints.size === 1, `L ${pickJoint} / ${del}: a click selects that glyph alone`);
    const nj = S.joints.size, nc = S.constraints.length;
    app.key('Delete');
    if (del === 'shared') {
      const aNow = shapeById(S, 'A').joints;
      check(S.joints.size === nj + 1 && !aNow.includes('S') && shapeById(S, 'B').joints.includes('S'), `L ${pickJoint} / shared: A is split off (its own new point), B keeps S`);
      check(S.constraints.length === nc && S.constraints.some((c) => c.type === 'coincident' && c.joints.includes('S') && c.joints.includes('c')), `L ${pickJoint} / shared: C stays glued to S (its coincident untouched)`);
    } else {
      check(S.joints.size === nj && S.constraints.length === nc - 1 && !S.constraints.some((c) => c.type === 'coincident'), `L ${pickJoint} / coincident: only C's coincident goes (C unglued)`);
      check(curvesAtJoint(S.shapes, 'S').map((s) => s.id).join() === 'A,B', `L ${pickJoint} / coincident: A and B still share S`);
    }
    check(S.engine.solve(500).converged, `L ${pickJoint} / ${del}: the solver converges`);
    await app.close();
  }
}

// ------------------------------------------------------------------------------------------------ M the point's "Delete Coincident"
// Fusion (owner-checked 2026-11-27): right-clicking a joined corner point offers "Delete Coincident", the same split as deleting the glyph. Here it
// unjoins the whole spot (#core/shared-point.js joinsAt): every shared-point glyph there and every coincident gluing a point there, ONE step.
{
  const menuIds = (app) => [...app.document.querySelectorAll('.sk-context-menu .sk-context-item')].map((e) => e.dataset.id);
  const rightClickJoint = (app, id) => { const j = app.state.joints.get(id); const p = at(app, j.x, j.y); app.rightClick(p.x, p.y); };
  const chooseItem = (app, id) => { const el = app.document.querySelector(`.sk-context-menu .sk-context-item[data-id="${id}"]`); assert(el, 'menu item ' + id); el.click(); app.frames(); };
  { // a shared corner (polygon: 3 curves) + a line glued on it by a coincident (the mixed stack)
    const profile = await createProfile();
    const doc = { version: 3, hosts: {}, geometry: {
      joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: sketch1 }], ['a', { x: -30, y: 10, sketchId: sketch1 }], ['S', { x: 10, y: 10, sketchId: sketch1 }],
        ['b', { x: 10, y: 40, sketchId: sketch1 }], ['d', { x: 40, y: 30, sketchId: sketch1 }], ['c', { x: 10, y: 10, sketchId: sketch1 }], ['f', { x: 35, y: -10, sketchId: sketch1 }],
        ['u', { x: -30, y: -20, sketchId: sketch1 }], ['v', { x: -10, y: -25, sketchId: sketch1 }]],
      shapes: [{ id: 'A', type: 'line', joints: ['a', 'S'], sketchId: sketch1 }, { id: 'B', type: 'line', joints: ['S', 'b'], sketchId: sketch1 }, { id: 'D', type: 'line', joints: ['S', 'd'], sketchId: sketch1 },
        { id: 'C', type: 'line', joints: ['c', 'f'], sketchId: sketch1 }, { id: 'U', type: 'line', joints: ['u', 'v'], sketchId: sketch1 }],
      constraints: [{ type: 'coincident', joints: ['S', 'c'] }],
      parameters: [], sketches: [{ id: sketch1, name: 'Sketch 1', visible: true }], activeSketchId: sketch1, groups: [], profiles: [] } };
    await createNamedDesign(profile, 'sketchstudio', 'T1041 M', doc);
    const app = await openApp({ profile });
    const S = app.state;
    app.tool('select'); app.esc();
    rightClickJoint(app, 'u');
    check(!menuIds(app).includes('geo-delete-coincident'), `M: a free line end has no "Delete Coincident" (${menuIds(app)})`);
    app.esc();
    rightClickJoint(app, 'S');
    check(menuIds(app).includes('geo-delete-coincident'), `M: the joined corner's menu offers "Delete Coincident" (${menuIds(app)})`);
    const label = app.document.querySelector('.sk-context-menu .sk-context-item[data-id="geo-delete-coincident"]');
    check(label && /Delete Coincident/.test(label.textContent), 'M: its label is "Delete Coincident" (the Fusion name)');
    const nj = S.joints.size, h = S.history.length, before = docOf(S);
    chooseItem(app, 'geo-delete-coincident');
    check(S.joints.size === nj + 2 && S.history.length === h + 1, `M: ONE step: A and B each get their own point (+2 joints: ${nj} -> ${S.joints.size}), D (joined last) keeps S`);
    check(['A', 'B'].every((id) => !shapeById(S, id).joints.includes('S')) && shapeById(S, 'D').joints.includes('S'), 'M: A and B detached, D keeps S');
    check(!S.constraints.some((c) => c.type === 'coincident'), 'M: and the coincident gluing C on the spot is gone (C unglued)');
    check(['A', 'B', 'C', 'D', 'U'].every((id) => shapeById(S, id)), 'M: no curve is deleted');
    app.undo();
    check(docOf(S) === before, 'M: Undo puts every join back exactly');
    // a right click at the spot again (it picks one of its stacked points): the item is back
    rightClickJoint(app, 'S');
    check(menuIds(app).includes('geo-delete-coincident'), 'M: the menu again after the undo');
    app.esc();
    await app.close();
  }
}

// ------------------------------------------------------------------------------------------------ K context menu Delete, footer Delete
for (const how of ['menu', 'footer']) {
  const app = await openApp();
  const S = app.state;
  app.tool('polygon'); clk(app, 0, 0); clk(app, 30, 0); app.esc(); app.esc();
  const corner = S.shapes[0].joints[1];
  const victim = curvesAtJoint(S.shapes, corner)[0];
  const { before, newJoint } = splitVia(app, corner, victim.id, how);
  check(S.joints.size === before.joints + 1 && !!newJoint && S.history.length === before.history + 1, `K ${how}: Delete splits the point (+1 joint, ONE step)`);
  check(!S.constraints.some((c) => c.type === SHARED_POINT_COINCIDENT), `K ${how}: nothing is stored for the glyph`);
  // the glyph pick (hover-manager glyphAt) finds the remaining glyph only while it is shown
  app.esc(); app.frames(2);
  const rest = glyphsAt(app, corner)[0];
  const c = app.toScreen(rest.glyphPos.x, rest.glyphPos.y);
  let picked = 0;
  for (let dx = -12; dx <= 12; dx++) for (let dy = -12; dy <= 12; dy++) if (glyphAt(app.svg, S, c.x + dx, c.y + dy) === rest) picked++;
  check(rest.__visible === false && picked === 0, `K ${how}: the remaining glyph is hidden with nothing selected and is not picked`);
  await app.close();
}

if (fails.length) { console.error(`split-shared-point-1041-node: ${fails.length} FAIL`); process.exit(1); }
console.log('split-shared-point-1041-node: ok');
