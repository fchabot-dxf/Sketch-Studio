// tests/snap-constraint-audit-869-cells.js -- TASK 869 (AUDIT, report only): the matrix of tests/snap-constraint-audit-869-live.test.js.
// The bug FAMILY audited: a snap / pick the app DETECTS whose constraint is never APPLIED (the Rectangle's first corner, task 867), or a
// tool that ends without doing what its picks asked and without a word (the Coincident tool on a point then a line, task 868).
// Driver-agnostic: every cell runs through a `driver` (the live test's one drives the real page with CDP mouse and keys) that offers
//   S(wx, wy) / W(sx, sy)   world <-> screen through the page's own transform     view()           re-reads that transform
//   move / down / up / click(x, y), drag(a, b, steps)   real pointer events       key(k, mods)     a real key
//   tool(name, mode)       the ribbon button (+ its variant menu item)            typeInto(sel, t) / pressEl(sel)   a DOM field / button
//   doc()                  the design as the app keeps it ({ joints: [[id, j]], shapes, constraints })
//   markers()              the snap markers the renderer draws now, in screen px ([{ kind: 'ring' | 'diamond' | 'axis-x' | 'axis-y', x, y }])
//   markNotices() / newNotices()   notices shown since the mark                   currentTool()    the ribbon's active tool
//   restore(doc)           the page holds exactly `doc` again (a reload of it)    canvas()         the canvas box { left, top, width, height }
//   onCanvas(points)       for each screen point: is the canvas what a press there hits (no panel over it)?
// Nothing here changes the app: it only presses, clicks and reads.
import { arcSweepInfo, projectPointOnSegment } from '#core/geometry.js';

export const OFF_PX = 4;                 // every click on a target is this far off it (inside the 10 px magnet), as a hand is never on the pixel
const ON_TARGET_PX = 0.5;                // a placed point closer than this (screen px) to its target is ON it
const CLEAR_PX = 45;                     // a free click is at least this far from every piece of the fixture (and the axes)
const AXIS_IDS = { 'axis-x': 'ref_axis_x', 'axis-y': 'ref_axis_y' };
const ORIGIN = 'j_origin';

// ------------------------------------------------------------------------------------------------ small geometry (screen px)
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const len = (a) => Math.hypot(a.x, a.y);
const unit = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const rot = (a, deg) => { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }; };
const dir = (deg) => rot({ x: 1, y: 0 }, deg);
const segDist = (p, a, b) => len(sub(p, projectPointOnSegment(p, a, b)));

const jointsMap = (doc) => new Map(doc.joints);
const refs = (c) => [...(c.joints || []), c.joint, c.shape, ...(c.shapes || []), c.line, c.circle].filter(Boolean);
const norm = (t) => String(t).replace(/[-_]/g, '').toLowerCase();
const cKey = (c) => JSON.stringify([c.type, c.joints, c.joint, c.shape, c.shapes, c.line, c.circle, c.value]);

// ------------------------------------------------------------------------------------------------ the fixture, drawn with the real tools
// Laid out in screen px from the origin's place (the view a fresh page opens on); stored in world units by the app.
export const LAYOUT = {
  lineA: [{ x: 120, y: -300 }, { x: 320, y: -300 }],      // a plain line: its free end is the JOINT target, its 25 % point the MID-SPAN, its middle the MIDPOINT
  circle: { c: { x: -300, y: -270 }, r: 70 },              // a circle: its CENTRE and its EDGE
  arc: [{ x: -300, y: 110 }, { x: -230, y: 110 }, { x: -300, y: 40 }], // an arc (centre, start, end): its EDGE (the middle of its sweep)
  constr: [{ x: 120, y: 100 }, { x: 320, y: 100 }],       // a CONSTRUCTION line
  rect: [{ x: 420, y: -250 }, { x: 640, y: -50 }],        // a 2-point rectangle, offset 30 px inward: an OFFSET-made line; its corners are twin joints
  offsetPx: 30, offsetPick: { x: 420, y: -110 }, offsetSide: { x: 530, y: -150 },
  dragLine: [{ x: -600, y: -150 }, { x: -520, y: -150 }], // a free line whose end the Select tool drags onto each target (section 3)
  dragRect: [{ x: -600, y: 60 }, { x: -520, y: 140 }],    // a free rectangle whose corner the Select tool drags (section 3)
  slant: [{ x: 150, y: -150 }, { x: 300, y: -60 }],      // a slanted line (no horizontal / vertical of its own), for the constraint tools
  axisX: { x: -120, y: 0 }, axisY: { x: 0, y: -330 },     // the X / Y axis targets
};
const midOf = (seg, t = 0.5) => ({ x: seg[0].x + (seg[1].x - seg[0].x) * t, y: seg[0].y + (seg[1].y - seg[0].y) * t });

export const PX_PER_MM = [2, 3.5]; // the scale the fixture is drawn at (a user's: the owner's report shows a 356 mm rectangle across a 1536 px window)
export async function buildFixture(d) {
  await d.view();
  const O0 = d.S(0, 0);
  // the wheel (zoom about the pointer, the origin stays put) until the scale is a user's
  for (let i = 0; i < 80; i++) {
    const k = len(sub(d.S(1, 0), d.S(0, 0)));
    if (k >= PX_PER_MM[0] && k <= PX_PER_MM[1]) break;
    await d.wheel(O0.x, O0.y, k > PX_PER_MM[1] ? 100 : -100); await d.view();
  }
  const O = d.S(0, 0), cv = d.canvas();
  const at = (p) => add(O, p);
  const L = LAYOUT;
  const all = [...L.lineA, L.circle.c, ...L.arc, ...L.constr, ...L.rect, ...L.dragLine, ...L.dragRect, ...L.slant, L.axisX, L.axisY].map(at);
  const out = all.filter((p) => p.x < cv.left + 40 || p.x > cv.left + cv.width - 40 || p.y < cv.top + 40 || p.y > cv.top + cv.height - 40);
  if (out.length) throw new Error(`the fixture does not fit the canvas around the origin ${JSON.stringify(O)}: ${JSON.stringify(out)}`);
  const line = async (a, b) => { await d.tool('line'); await d.click(at(a).x, at(a).y); await d.click(at(b).x, at(b).y); await d.key('Escape'); };
  await line(...L.lineA);
  await d.tool('circle'); await d.click(at(L.circle.c).x, at(L.circle.c).y); await d.click(at(L.circle.c).x + L.circle.r, at(L.circle.c).y); await d.key('Escape');
  await d.tool('arc'); for (const p of L.arc) await d.click(at(p).x, at(p).y); await d.key('Escape');
  await d.key('k'); await line(...L.constr); await d.key('k');
  await d.tool('rect', 'rect-2pt'); await d.click(at(L.rect[0]).x, at(L.rect[0]).y); await d.click(at(L.rect[1]).x, at(L.rect[1]).y); await d.key('Escape');
  // Offset: the rectangle's left side (its chain = the whole rectangle), the inside as the side, the distance typed, Enter
  const before = (await d.doc()).shapes.length;
  await d.tool('offset');
  const leftAt = at(L.offsetPick);
  await d.click(leftAt.x, leftAt.y);
  const inside = at(L.offsetSide);
  await d.move(inside.x, inside.y); await d.click(inside.x, inside.y);
  const mmPerPx = len(sub(d.W(O.x + 100, O.y), d.W(O.x, O.y))) / 100;
  await d.typeInto('#offset-distance-input', (L.offsetPx * mmPerPx).toFixed(3));
  await d.key('Enter'); await d.key('Escape');
  await line(...L.dragLine);
  await line(...L.slant);
  await d.tool('rect', 'rect-2pt'); await d.click(at(L.dragRect[0]).x, at(L.dragRect[0]).y); await d.click(at(L.dragRect[1]).x, at(L.dragRect[1]).y); await d.key('Escape');
  const doc = await d.doc();
  if (doc.shapes.length - before < 4) throw new Error('the Offset made no inner loop: ' + (doc.shapes.length - before) + ' new shapes');
  return doc;
}

// The fixture's pieces found back in the stored design (by where they were drawn)
export function fixtureParts(doc, d) {
  const J = jointsMap(doc);
  const O = d.S(0, 0);
  const scr = (id) => { const j = J.get(id); return d.S(j.x, j.y); };
  const lines = doc.shapes.filter((s) => s.type === 'line');
  const lineNear = (p, pred = () => true) => { let best = null, bd = Infinity; for (const s of lines) { if (!pred(s)) continue; const v = segDist(add(O, p), scr(s.joints[0]), scr(s.joints[1])); if (v < bd) { bd = v; best = s; } } if (bd > 3) throw new Error('fixture: no line at ' + JSON.stringify(p)); return best; };
  const L = LAYOUT;
  const lineA = lineNear(midOf(L.lineA));
  const constr = lineNear(midOf(L.constr));
  const outerLeft = lineNear(L.offsetPick);
  const innerBottom = lineNear({ x: L.rect[0].x + 70, y: L.rect[1].y - L.offsetPx });
  const outerBottom = lineNear({ x: L.rect[0].x + 70, y: L.rect[1].y });
  const dragLine = lineNear(midOf(L.dragLine));
  const slant = lineNear(midOf(L.slant));
  const dragRectRight = lineNear({ x: L.dragRect[1].x, y: (L.dragRect[0].y + L.dragRect[1].y) / 2 });
  const circle = doc.shapes.find((s) => s.type === 'circle');
  const arc = doc.shapes.find((s) => s.type === 'arc');
  const endA = lineA.joints.find((id) => scr(id).x > O.x + L.lineA[1].x - 20);
  const dragEnd = dragLine.joints.find((id) => scr(id).x > O.x + L.dragLine[1].x - 20);
  const dragCorner = dragRectRight.joints.find((id) => scr(id).y < O.y + L.dragRect[0].y + 20);
  const rectCorner = outerBottom.joints.find((id) => scr(id).x < O.x + L.rect[0].x + 20); // the outer rectangle's bottom-left corner (twin joints)
  return { lineA, constr, outerLeft, innerBottom, outerBottom, dragLine, slant, dragRectRight, circle, arc, endA, dragEnd, dragCorner, rectCorner };
}

// Every piece of the fixture as screen geometry (for the clearance of a free click)
function sceneOf(doc, d) {
  const J = jointsMap(doc);
  const S = (j) => d.S(j.x, j.y);
  const segs = [], rings = [], pts = [];
  for (const [id, j] of J) if (!id.startsWith('j_ref')) pts.push(S(j));
  for (const s of doc.shapes) {
    if (s.type === 'line' && !s.reference) segs.push([S(J.get(s.joints[0])), S(J.get(s.joints[1]))]);
    if (s.type === 'circle') { const c = S(J.get(s.joints[0])); const e = d.S(J.get(s.joints[0]).x + s.radius, J.get(s.joints[0]).y); rings.push({ c, r: len(sub(e, c)) }); }
    if (s.type === 'arc') { for (const p of arcSamples(J, s, 48)) pts.push(d.S(p.x, p.y)); const q = arcSamples(J, s, 48).map((p) => d.S(p.x, p.y)); for (let i = 1; i < q.length; i++) segs.push([q[i - 1], q[i]]); }
  }
  const O = d.S(0, 0);
  return { segs, rings, pts, O, cv: d.canvas() };
}
function clearance(scene, p) {
  let m = Infinity;
  for (const [a, b] of scene.segs) m = Math.min(m, segDist(p, a, b));
  for (const r of scene.rings) m = Math.min(m, Math.abs(len(sub(p, r.c)) - r.r));
  for (const q of scene.pts) m = Math.min(m, len(sub(p, q)));
  m = Math.min(m, Math.abs(p.x - scene.O.x), Math.abs(p.y - scene.O.y)); // the axes
  const cv = scene.cv;
  if (p.x < cv.left + 40 || p.x > cv.left + cv.width - 40 || p.y < cv.top + 40 || p.y > cv.top + cv.height - 40) return -1;
  return m;
}
function arcSamples(J, s, n) {
  const c = J.get(s.joints[0]), a = J.get(s.joints[1]), b = J.get(s.joints[2]);
  const info = arcSweepInfo(c, a, b, { sweep: s.sweep }); const r = Math.hypot(a.x - c.x, a.y - c.y);
  const out = []; for (let i = 0; i <= n; i++) { const t = info.a0 + info.dir * info.span * i / n; out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }); }
  return out;
}

// ------------------------------------------------------------------------------------------------ the targets
// { key, label, world: {x, y}, expect: 'coincident' | 'pointOnLine' | 'midpoint', joint?, shape?, ends?, near: the entity ids it belongs to }
export function targetsOf(doc, d, P) {
  const J = jointsMap(doc);
  const at = (id) => ({ x: J.get(id).x, y: J.get(id).y });
  const along = (s, t) => { const a = at(s.joints[0]), b = at(s.joints[1]); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; };
  const leftEndT = (s) => (d.S(at(s.joints[0]).x, 0).x < d.S(at(s.joints[1]).x, 0).x ? 0.25 : 0.75); // the 25 % point from the left end
  const cc = at(P.circle.joints[0]);
  const arcMid = arcSamples(J, P.arc, 2)[1];
  const W0 = d.W(d.S(0, 0).x + LAYOUT.axisX.x, d.S(0, 0).y), W1 = d.W(d.S(0, 0).x, d.S(0, 0).y + LAYOUT.axisY.y);
  return [
    { key: 'joint', label: 'an existing joint (a line end)', world: at(P.endA), expect: 'coincident', joint: P.endA },
    { key: 'midspan', label: 'a line mid-span', world: along(P.lineA, leftEndT(P.lineA)), expect: 'pointOnLine', shape: P.lineA.id },
    { key: 'midpoint', label: 'a line midpoint', world: along(P.lineA, 0.5), expect: 'midpoint', shape: P.lineA.id, ends: P.lineA.joints },
    { key: 'arcEdge', label: 'an arc edge', world: arcMid, expect: 'pointOnLine', shape: P.arc.id, radial: at(P.arc.joints[0]) },
    { key: 'circleEdge', label: 'a circle edge', world: { x: cc.x + P.circle.radius * Math.SQRT1_2, y: cc.y - P.circle.radius * Math.SQRT1_2 }, expect: 'pointOnLine', shape: P.circle.id, radial: cc },
    { key: 'circleCentre', label: 'a circle centre', world: cc, expect: 'coincident', joint: P.circle.joints[0] },
    { key: 'construction', label: 'a construction line', world: along(P.constr, leftEndT(P.constr)), expect: 'pointOnLine', shape: P.constr.id },
    { key: 'offsetLine', label: 'an offset-made line', world: along(P.innerBottom, leftEndT(P.innerBottom)), expect: 'pointOnLine', shape: P.innerBottom.id, awayFrom: P.outerBottom.id },
    { key: 'origin', label: 'the origin', world: { x: 0, y: 0 }, expect: 'coincident', joint: ORIGIN },
    { key: 'axisX', label: 'the X axis', world: { x: W0.x, y: 0 }, expect: 'pointOnLine', shape: AXIS_IDS['axis-x'], axis: 'axis-x' },
    { key: 'axisY', label: 'the Y axis', world: { x: 0, y: W1.y }, expect: 'pointOnLine', shape: AXIS_IDS['axis-y'], axis: 'axis-y' },
  ];
}

// The click on a target: OFF_PX off it, across the line (or radially), on the side with more room
function clickOn(t, doc, d, scene) {
  const T = d.S(t.world.x, t.world.y);
  let n;
  if (t.radial) n = unit(sub(T, d.S(t.radial.x, t.radial.y)));
  else if (t.shape && t.key !== 'midpoint' && !t.axis) { const s = doc.shapes.find((x) => x.id === t.shape); const J = jointsMap(doc); const a = d.S(J.get(s.joints[0]).x, J.get(s.joints[0]).y), b = d.S(J.get(s.joints[1]).x, J.get(s.joints[1]).y); n = unit(rot(sub(b, a), 90)); }
  else if (t.axis === 'axis-x') n = { x: 0, y: 1 };
  else if (t.axis === 'axis-y') n = { x: 1, y: 0 };
  else n = unit({ x: 1, y: 1 });
  if (t.key === 'midpoint') n = { x: 0, y: 1 };
  const room = (p) => { let m = Infinity; const pp = add(T, mul(p, 14)); for (const [a, b] of scene.segs) { const dd = segDist(pp, a, b); if (dd > 1) m = Math.min(m, dd); } return m; };
  const side = room(n) >= room(mul(n, -1)) ? n : mul(n, -1);
  return { T, C: add(T, mul(side, OFF_PX)) };
}

// ------------------------------------------------------------------------------------------------ section 1: the drawing tools
// Each recipe: the clicks (screen) for a tool with its point `role` on the target point C, the other clicks free: f(C, u, R) -> [points], with u a unit
// direction and R a size (px); `idx` = the click that is on the target. `point` names what is measured: a joint near the target, or the circle's rim.
const R90 = (u) => rot(u, 90);
export const DRAW_RECIPES = [
  { tool: 'line', role: 'start', idx: 0, clicks: (C, u, R) => [C, add(C, mul(u, R))], end: ['Escape'] },
  { tool: 'line', role: 'end', idx: 1, clicks: (C, u, R) => [add(C, mul(u, R)), C], end: ['Escape'] },
  { tool: 'arc', role: 'centre', idx: 0, clicks: (C, u, R) => [C, add(C, mul(u, R)), add(C, mul(R90(u), R))], end: ['Escape'] },
  { tool: 'arc', role: 'start', idx: 1, clicks: (C, u, R) => { const c = sub(C, mul(u, R)); return [c, C, add(c, mul(R90(u), R))]; }, end: ['Escape'] },
  { tool: 'arc', role: 'end', idx: 2, clicks: (C, u, R) => { const c = sub(C, mul(R90(u), R)); return [c, add(c, mul(u, R)), C]; }, end: ['Escape'] },
  { tool: 'circle', role: 'centre', idx: 0, clicks: (C, u, R) => [C, add(C, mul(u, R))], end: ['Escape'] },
  { tool: 'circle', role: 'rim', idx: 1, point: 'rim', clicks: (C, u, R) => [sub(C, mul(u, R)), C], end: ['Escape'] },
  { tool: 'rect', mode: 'rect-2pt', role: 'corner 1', idx: 0, diag: true, clicks: (C, u, R) => [C, add(C, mul(u, R))], end: ['Escape'] },
  { tool: 'rect', mode: 'rect-2pt', role: 'corner 2', idx: 1, diag: true, clicks: (C, u, R) => [add(C, mul(u, R)), C], end: ['Escape'] },
  { tool: 'rect', mode: 'rect-center', role: 'centre', idx: 0, diag: true, clicks: (C, u, R) => [C, add(C, mul(u, R))], end: ['Escape'] },
  { tool: 'rect', mode: 'rect-center', role: 'corner', idx: 1, diag: true, clicks: (C, u, R) => [sub(C, mul(u, R)), C], end: ['Escape'] },
  { tool: 'rect', mode: 'rect-3pt', role: 'point 1', idx: 0, clicks: (C, u, R) => [C, add(C, mul(u, R)), add(add(C, mul(u, R)), mul(R90(u), R * 0.7))], end: ['Escape'] },
  { tool: 'rect', mode: 'rect-3pt', role: 'point 2', idx: 1, clicks: (C, u, R) => [sub(C, mul(u, R)), C, add(C, mul(R90(u), R * 0.7))], end: ['Escape'] },
  { tool: 'rect', mode: 'rect-3pt', role: 'point 3', idx: 2, clicks: (C, u, R) => { const p2 = sub(C, mul(R90(u), R * 0.7)); return [sub(p2, mul(u, R)), p2, C]; }, end: ['Escape'] },
  { tool: 'polygon', role: 'centre', idx: 0, clicks: (C, u, R) => [C, add(C, mul(u, R))], end: ['Escape'] },
  { tool: 'polygon', role: 'vertex', idx: 1, clicks: (C, u, R) => [sub(C, mul(u, R)), C], end: ['Escape'] },
  { tool: 'slot', mode: 'slot-c2c', role: 'centre 1', idx: 0, clicks: (C, u, R) => [C, add(C, mul(u, R)), add(add(C, mul(u, R / 2)), mul(R90(u), 22))], end: ['Escape'] },
  { tool: 'slot', mode: 'slot-c2c', role: 'centre 2', idx: 1, clicks: (C, u, R) => [sub(C, mul(u, R)), C, add(sub(C, mul(u, R / 2)), mul(R90(u), 22))], end: ['Escape'] },
  { tool: 'slot', mode: 'slot-overall', role: 'end 1', idx: 0, clicks: (C, u, R) => [C, add(C, mul(u, R)), add(add(C, mul(u, R / 2)), mul(R90(u), 22))], end: ['Escape'] },
  { tool: 'slot', mode: 'slot-overall', role: 'end 2', idx: 1, clicks: (C, u, R) => [sub(C, mul(u, R)), C, add(sub(C, mul(u, R / 2)), mul(R90(u), 22))], end: ['Escape'] },
  { tool: 'slot', mode: 'slot-center', role: 'centre', idx: 0, clicks: (C, u, R) => [C, add(C, mul(u, R / 2)), add(C, mul(R90(u), 22))], end: ['Escape'] },
  { tool: 'slot', mode: 'slot-center', role: 'end centre', idx: 1, clicks: (C, u, R) => [sub(C, mul(u, R / 2)), C, add(sub(C, mul(u, R / 2)), mul(R90(u), 22))], end: ['Escape'] },
  { tool: 'slot', mode: 'slot-arc-3pt', role: 'start', idx: 0, clicks: (C, u, R) => { const c = sub(C, mul(u, R)); return [C, add(c, mul(R90(u), R)), add(c, mul(rot(u, 45), R)), add(c, mul(rot(u, 45), R + 22))]; }, end: ['Escape'] },
  { tool: 'slot', mode: 'slot-arc-3pt', role: 'end', idx: 1, clicks: (C, u, R) => { const c = sub(C, mul(R90(u), R)); return [add(c, mul(u, R)), C, add(c, mul(rot(u, 45), R)), add(c, mul(rot(u, 45), R + 22))]; }, end: ['Escape'] },
  { tool: 'slot', mode: 'slot-arc-3pt', role: 'arc point', idx: 2, point: 'arcpoint', clicks: (C, u, R) => { const c = sub(C, mul(rot(u, 45), R)); return [add(c, mul(u, R)), add(c, mul(R90(u), R)), C, add(c, mul(rot(u, 45), R + 22))]; }, end: ['Escape'] },
  { tool: 'slot', mode: 'slot-arc-center', role: 'centre', idx: 0, clicks: (C, u, R) => [C, add(C, mul(u, R)), add(C, mul(R90(u), R)), add(C, mul(rot(u, 45), R + 22))], end: ['Escape'] },
  { tool: 'slot', mode: 'slot-arc-center', role: 'start', idx: 1, clicks: (C, u, R) => { const c = sub(C, mul(u, R)); return [c, C, add(c, mul(R90(u), R)), add(c, mul(rot(u, 45), R + 22))]; }, end: ['Escape'] },
  { tool: 'slot', mode: 'slot-arc-center', role: 'end', idx: 2, clicks: (C, u, R) => { const c = sub(C, mul(R90(u), R)); return [c, add(c, mul(u, R)), C, add(c, mul(rot(u, 45), R + 22))]; }, end: ['Escape'] },
  { tool: 'bezier', role: 'anchor 1', idx: 0, clicks: (C, u, R) => [C, add(C, mul(u, R))], end: ['Enter', 'Escape'] },
  { tool: 'bezier', role: 'anchor 2', idx: 1, clicks: (C, u, R) => [sub(C, mul(u, R)), C], end: ['Enter', 'Escape'] },
  { tool: 'text', role: 'anchor', idx: 0, text: true, clicks: (C) => [C], end: [] },
];

// the free clicks of a recipe: a direction and size that keep every non-target click CLEAR_PX from the fixture, and every click ON the canvas
// (not under a panel over it: the floating Sketches card; d.onCanvas asks the page what is at each point)
async function placeRecipe(rc, C, scene, d) {
  const dirs = rc.diag ? [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5] : [0, 45, 90, 135, 180, 225, 270, 315, 22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5];
  const cands = [];
  for (const R of [110, 90, 140, 75, 170, 60]) for (const a of dirs) {
    const pts = rc.clicks(C, dir(a), R);
    cands.push({ pts, m: Math.min(...pts.filter((_, i) => i !== rc.idx).map((p) => clearance(scene, p)), Infinity) });
  }
  const ok = async (c) => (await d.onCanvas(c.pts)).every(Boolean);
  for (const c of cands) if (c.m >= CLEAR_PX && await ok(c)) return c;
  const byRoom = cands.slice().sort((a, b) => b.m - a.m);
  for (const c of byRoom) if (await ok(c)) return c;
  return byRoom[0];
}

const markerNear = (ms, T, t) => ms.some((m) => (t && t.axis ? m.kind === t.axis || (m.kind === 'diamond' && len(sub(m, T)) < 8) : m.kind !== 'axis-x' && m.kind !== 'axis-y' && len(sub(m, T)) < 8));

// Is the target held by a NEW constraint on the placed thing? mine = the ids standing for the placed point (its joint + the new shape's own twins) or the new shape
function constraintFor(t, added, mine) {
  const has = (c, ids) => refs(c).some((r) => ids.includes(r));
  const targetIds = t.ends ? t.ends : [t.joint || t.shape];
  const hit = added.filter((c) => has(c, mine) && (t.ends ? t.ends.every((e) => refs(c).includes(e)) : has(c, targetIds)));
  return hit.map((c) => c.type);
}

function newOf(fix, doc) {
  const fj = new Set(fix.joints.map(([id]) => id)), fs = new Set(fix.shapes.map((s) => s.id)), fc = new Set(fix.constraints.map(cKey));
  return { joints: doc.joints.filter(([id]) => !fj.has(id)), shapes: doc.shapes.filter((s) => !fs.has(s.id)), constraints: doc.constraints.filter((c) => !fc.has(cKey(c))) };
}
const sameDoc = (a, b) => JSON.stringify(sig(a)) === JSON.stringify(sig(b));
const sig = (doc) => [doc.joints.map(([id, j]) => [id, Math.round(j.x * 1e3), Math.round(j.y * 1e3)]).sort(), doc.shapes.map((s) => s.id).sort(), doc.constraints.map(cKey).sort()];

// back to the fixture: Esc, Undo while the design differs (an undo step per make), else a reload of the fixture
async function revert(d, fix, after) {
  await d.key('Escape');
  if (after && sameDoc(after, fix)) return 'none';
  for (let i = 0; i < 4; i++) {
    await d.key('z', { ctrl: true });
    if (sameDoc(await d.doc(), fix)) return 'undo';
  }
  if (sameDoc(await d.doc(), fix)) return 'undo';
  await d.restore(fix);
  return 'reload';
}

// a notice (toast) or a panel over a point takes the press there: wait (up to 5 s) until every point is the canvas again
async function canvasFree(d, pts) {
  for (let i = 0; i < 50; i++) { if ((await d.onCanvas(pts)).every(Boolean)) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}

export function fmtPx(v) { return v == null ? '-' : v.toFixed(2); }

export async function runDrawCell(d, fix, P, t, rc, scene, name = '') {
  const { T, C } = clickOn(t, fix, d, scene);
  const placed = await placeRecipe(rc, C, scene, d);
  const pts = placed.pts;
  await d.tool(rc.tool, rc.mode);
  await d.markNotices();
  await canvasFree(d, pts);
  let hover = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    await canvasFree(d, [p]);
    if (i === rc.idx) { await d.move(p.x - 6, p.y - 6); await d.move(p.x, p.y); hover = markerNear(await d.markers(), T, t); }
    await d.click(p.x, p.y);
    if (rc.text && i === 0) { await d.typeInto('.sk-text-editor textarea', 'A'); await d.pressEl('.sk-text-ok'); }
  }
  for (const k of rc.end) await d.key(k);
  const doc = await d.doc();
  const nw = newOf(fix, doc);
  const J = jointsMap(doc);
  const pxPerMm = len(sub(d.S(1, 0), d.S(0, 0)));
  let dist = null, mine = [], reused = false, made = nw.shapes.length > 0;
  const newShapeIds = nw.shapes.map((s) => s.id);
  if (rc.point) {   // the click sets a CURVE through the target (a circle's rim, the centre arc of a 3-point arc slot): no joint of its own is placed there
    const tw = t.joint ? J.get(t.joint) : t.world;
    let best = null;
    for (const s of nw.shapes.filter((x) => x.type === (rc.point === 'rim' ? 'circle' : 'arc'))) {
      const c = J.get(s.joints[0]); const r = s.type === 'circle' ? s.radius : Math.hypot(J.get(s.joints[1]).x - c.x, J.get(s.joints[1]).y - c.y);
      const dd = Math.abs(Math.hypot(tw.x - c.x, tw.y - c.y) - r) * pxPerMm;
      if (!best || dd < best.dd) best = { dd, id: s.id };
    }
    if (best) { dist = best.dd; mine = [best.id]; }
  } else if (made) {
    // the target joint itself used by a new shape (the joint is shared: no constraint needed)
    if (t.joint && nw.shapes.some((s) => (s.joints || []).includes(t.joint))) { reused = true; dist = 0; mine = [t.joint]; }
    else {
      const newJ = nw.joints.filter(([, j]) => !j.textOutline);
      let best = null;
      for (const [id, j] of newJ) { const dd = len(sub(d.S(j.x, j.y), d.S(t.world.x, t.world.y))); if (!best || dd < best.dd) best = { id, dd }; }
      if (best) {
        // "on the target": the joint's distance to the target point (a point target) or to the target curve / line / axis
        dist = onTargetDist(t, J.get(best.id), doc, d);
        const twins = new Set([best.id]);
        for (const c of nw.constraints) if (norm(c.type) === 'coincident' && (c.joints || []).includes(best.id) && c.joints.every((x) => nw.joints.some(([n]) => n === x))) c.joints.forEach((x) => twins.add(x));
        for (const [id, j] of newJ) if (len(sub(d.S(j.x, j.y), d.S(J.get(best.id).x, J.get(best.id).y))) < 1e-3) twins.add(id);
        mine = [...twins];
      }
    }
  }
  const types = reused ? ['(shared joint)'] : constraintFor(t, nw.constraints, mine.length ? mine : newShapeIds);
  const posOnly = !!rc.point && !t.joint;  // a curve through a line / curve / axis / a line's middle: no point of it is placed there, so no constraint is expected (position only)
  let status;
  if (!made) status = 'FAIL-SILENT';
  else if (hover === false) status = 'FAIL-NOSNAP';
  else if (dist == null || dist > ON_TARGET_PX) status = 'FAIL-OFFTARGET';
  else if (!types.length && !posOnly) status = 'FAIL-NOCONSTRAINT';
  else status = 'PASS';
  const moved = targetMoved(t, fix, doc, d);
  const notices = await d.newNotices();
  if (d.afterCell) await d.afterCell(name, T);
  const how = await revert(d, fix, doc);
  return { section: 'draw', tool: rc.tool + (rc.mode ? `(${rc.mode})` : ''), role: rc.role, target: t.key, status, hover, dist, types, posOnly, made, clearance: placed.m, notices, revert: how, moved,
    added: nw.constraints.map((c) => c.type) };
}

// the placed joint's distance (screen px) to its target AS IT IS NOW (a solve may move the target: the snap's constraint holds it on the target, wherever)
function onTargetDist(t, j, doc, d) {
  if (!j) return null;
  const P = d.S(j.x, j.y);
  const J = jointsMap(doc);
  const at = (id) => d.S(J.get(id).x, J.get(id).y);
  if (t.joint) return len(sub(P, at(t.joint)));
  if (t.key === 'midpoint') { const a = at(t.ends[0]), b = at(t.ends[1]); return len(sub(P, mul(add(a, b), 0.5))); }
  if (t.axis === 'axis-x') return Math.abs(P.y - d.S(0, 0).y);
  if (t.axis === 'axis-y') return Math.abs(P.x - d.S(0, 0).x);
  const s = doc.shapes.find((x) => x.id === t.shape);
  if (s.type === 'line') return segDist(P, at(s.joints[0]), at(s.joints[1]));
  if (s.type === 'circle') { const c = J.get(s.joints[0]); return Math.abs(len(sub(P, at(s.joints[0]))) - len(sub(d.S(c.x + s.radius, c.y), d.S(c.x, c.y)))); }
  if (s.type === 'arc') return Math.abs(len(sub(P, at(s.joints[0]))) - len(sub(at(s.joints[1]), at(s.joints[0]))));
  return null;
}
// how far the target itself moved (screen px): the solve gave way on the fixture instead of the new point
function targetMoved(t, fix, doc, d) {
  const A = jointsMap(fix), B = jointsMap(doc);
  const ids = t.joint ? [t.joint] : t.ends ? t.ends : t.axis ? [] : (doc.shapes.find((x) => x.id === t.shape) || { joints: [] }).joints;
  let m = 0; for (const id of ids) { const a = A.get(id), b = B.get(id); if (a && b) m = Math.max(m, len(sub(d.S(a.x, a.y), d.S(b.x, b.y)))); }
  return m;
}

// ------------------------------------------------------------------------------------------------ section 2: the constraint tools
// picks: entity keys of the fixture, in order. valid: Fusion makes this constraint from these picks (else the user must be told why not).
export const PICKS = {
  P: 'a free point (line end)', RC: 'a rectangle corner (twin joints)', ORG: 'the origin', CC: 'the circle centre',
  LA: 'a line', K: 'a construction line', OL: 'an offset-made line', RS: 'a rectangle side', A: 'an arc', C: 'a circle', AX: 'the X axis', DL: 'another line', SL: 'a slanted line',
};
export const CONSTRAINT_CELLS = [
  // coincident: point + point, point + curve (point-on-line / point-on-curve), both orders
  ['coincident', ['P', 'CC'], true], ['coincident', ['P', 'ORG'], true], ['coincident', ['RC', 'P'], true],
  ['coincident', ['P', 'LA'], true], ['coincident', ['LA', 'P'], true], ['coincident', ['RC', 'OL'], true], ['coincident', ['OL', 'RC'], true],
  ['coincident', ['P', 'K'], true], ['coincident', ['P', 'A'], true], ['coincident', ['A', 'P'], true], ['coincident', ['P', 'C'], true], ['coincident', ['C', 'P'], true],
  ['coincident', ['P', 'AX'], true], ['coincident', ['AX', 'P'], true], ['coincident', ['LA', 'K'], false],
  // midpoint: a point and a line (or an arc), both orders
  ['midpoint', ['P', 'K'], true], ['midpoint', ['K', 'P'], true], ['midpoint', ['RC', 'OL'], true], ['midpoint', ['P', 'A'], true], ['midpoint', ['A', 'P'], true],
  // tangent: line + arc / circle, arc + circle, both orders; line + line is not a tangent
  ['tangent', ['LA', 'C'], true], ['tangent', ['C', 'LA'], true], ['tangent', ['LA', 'A'], true], ['tangent', ['A', 'LA'], true], ['tangent', ['A', 'C'], true], ['tangent', ['OL', 'C'], true],
  ['tangent', ['LA', 'K'], false],
  // parallel / perpendicular: two lines (sketch, construction, offset-made, an axis); a circle is not a line
  ['parallel', ['LA', 'K'], true], ['parallel', ['K', 'LA'], true], ['parallel', ['LA', 'OL'], true], ['parallel', ['DL', 'AX'], true], ['parallel', ['AX', 'DL'], true], ['parallel', ['LA', 'C'], false],
  ['perp', ['LA', 'RS'], true], ['perp', ['SL', 'OL'], true], ['perp', ['OL', 'SL'], true], ['perp', ['SL', 'AX'], true], ['perp', ['OL', 'DL'], true], ['perp', ['LA', 'AX'], true], ['perp', ['LA', 'A'], false],
  ['parallel', ['SL', 'LA'], true],
  // equal: two lines, two circles / arcs; a line and a circle are not equal
  ['equal', ['LA', 'K'], true], ['equal', ['LA', 'OL'], true], ['equal', ['A', 'C'], true], ['equal', ['C', 'A'], true], ['equal', ['LA', 'C'], false],
  // collinear: two lines (an axis included)
  ['collinear', ['LA', 'DL'], true], ['collinear', ['LA', 'OL'], true], ['collinear', ['DL', 'AX'], true], ['collinear', ['K', 'LA'], true],
  // horizontal / vertical: a line, or two points
  ['hv', ['SL'], true], ['hv', ['DL'], true], ['hv', ['P', 'CC'], true], ['hv', ['P', 'ORG'], true], ['hv', ['RC', 'P'], true], ['hv', ['P', 'LA'], false],
  // symmetric: two points / two lines / two circles, then the symmetry line
  ['symmetric', ['P', 'CC', 'K'], true], ['symmetric', ['LA', 'DL', 'K'], true], ['symmetric', ['A', 'C', 'K'], true], ['symmetric', ['P', 'CC', 'AX'], true], ['symmetric', ['P', 'LA', 'K'], false],
];
const TOOL_TYPE = { coincident: ['coincident', 'pointOnLine'], midpoint: ['midpoint'], tangent: ['tangent'], parallel: ['parallel'], perp: ['perpendicular'], equal: ['equal'], collinear: ['collinear'],
  hv: ['horizontal', 'vertical'], symmetric: ['symmetric'] };

function pickPoints(fix, d, P) {
  const J = jointsMap(fix);
  const S = (id) => d.S(J.get(id).x, J.get(id).y);
  const along = (s, t) => { const a = S(s.joints[0]), b = S(s.joints[1]); return add(a, mul(sub(b, a), t)); };
  const cc = J.get(P.circle.joints[0]);
  const arcMid = arcSamples(J, P.arc, 2)[1];
  const O = d.S(0, 0);
  return {
    P: S(P.endA), RC: S(P.rectCorner), ORG: O, CC: S(P.circle.joints[0]),
    LA: along(P.lineA, 0.3), K: along(P.constr, 0.3), OL: along(P.innerBottom, 0.3), RS: along(P.outerLeft, 0.3), DL: along(P.dragLine, 0.35), SL: along(P.slant, 0.3),
    A: d.S(arcMid.x, arcMid.y), C: d.S(cc.x + P.circle.radius * Math.SQRT1_2, cc.y - P.circle.radius * Math.SQRT1_2), AX: { x: O.x + LAYOUT.axisX.x, y: O.y },
  };
}

export async function runConstraintCell(d, fix, P, cell, name = '') {
  const [tool, picks, valid] = cell;
  const at = pickPoints(fix, d, P);
  await d.tool(tool);
  await d.markNotices();
  await canvasFree(d, picks.map((k) => at[k]));
  const toolAfter = [];
  for (const k of picks) { await canvasFree(d, [at[k]]); await d.move(at[k].x + 5, at[k].y + 5); await d.move(at[k].x, at[k].y); await d.click(at[k].x, at[k].y); toolAfter.push(await d.currentTool()); }
  const doc = await d.doc();
  const nw = newOf(fix, doc);
  const want = TOOL_TYPE[tool].map(norm);
  const made = nw.constraints.filter((c) => want.includes(norm(c.type)));
  const notices = await d.newNotices();
  const ended = toolAfter[toolAfter.length - 1] !== tool;
  if (d.afterCell) await d.afterCell(name, at[picks[0]]);
  let status;
  if (made.length) status = valid ? 'PASS' : 'PASS-UNEXPECTED';
  else if (notices.length) status = valid ? 'REFUSED-TOLD' : 'PASS-TOLD';
  else status = 'FAIL-SILENT';
  const how = await revert(d, fix, doc);
  return { section: 'constraint', tool, picks: picks.join('+'), valid, status, made: made.map((c) => c.type), added: nw.constraints.map((c) => c.type), notices, toolAfter, ended, revert: how };
}

// ------------------------------------------------------------------------------------------------ section 3: the Select tool's drag-snap
export async function runDragCell(d, fix, P, t, which, scene, name = '') {
  const J = jointsMap(fix);
  const id = which === 'line end' ? P.dragEnd : P.dragCorner;
  const from = d.S(J.get(id).x, J.get(id).y);
  const { T, C } = clickOn(t, fix, d, scene);
  await d.tool('select');
  await d.markNotices();
  await canvasFree(d, [from, C]);
  await d.move(from.x, from.y); await d.down(from.x, from.y);
  const steps = 14;
  for (let i = 1; i <= steps; i++) await d.move(from.x + (C.x - from.x) * i / steps, from.y + (C.y - from.y) * i / steps, { buttons: 1 });
  const hover = markerNear(await d.markers(), T, t);
  await d.up(C.x, C.y);
  const doc = await d.doc();
  const nw = newOf(fix, doc);
  const Jd = jointsMap(doc);
  const twins = [id, ...fix.constraints.filter((c) => norm(c.type) === 'coincident' && (c.joints || []).includes(id)).flatMap((c) => c.joints)];
  const dist = onTargetDist(t, Jd.get(id), doc, d);
  const types = constraintFor(t, nw.constraints, twins);
  let status;
  if (!hover) status = 'FAIL-NOSNAP';
  else if (dist == null || dist > ON_TARGET_PX) status = 'FAIL-OFFTARGET';
  else if (!types.length) status = 'FAIL-NOCONSTRAINT';
  else status = 'PASS';
  const moved = targetMoved(t, fix, doc, d);
  const notices = await d.newNotices();
  if (d.afterCell) await d.afterCell(name, T);
  const how = await revert(d, fix, doc);
  return { moved, section: 'drag', tool: 'select-drag', role: which, target: t.key, status, hover, dist, types, added: nw.constraints.map((c) => c.type), notices, revert: how };
}

// ------------------------------------------------------------------------------------------------ the whole matrix
export function line(r) {
  if (r.section === 'constraint') return `CELL constraint ${r.tool} [${r.picks}]${r.valid ? '' : ' (not a valid pair)'}: ${r.status} made=${JSON.stringify(r.made)} added=${JSON.stringify(r.added)} toolAfter=${JSON.stringify(r.toolAfter)} notices=${JSON.stringify(r.notices)}`;
  return `CELL ${r.section} ${r.tool} ${r.role} x ${r.target}: ${r.status}${r.dist != null ? ` d=${fmtPx(r.dist)}px` : ''} hover=${r.hover} constraint=${JSON.stringify(r.types)}${r.posOnly ? ' (position only expected)' : ''}${r.moved > 0.5 ? ` targetMoved=${fmtPx(r.moved)}px` : ''} added=${JSON.stringify(r.added)}${r.notices && r.notices.length ? ' notices=' + JSON.stringify(r.notices) : ''}${r.clearance != null && r.clearance < CLEAR_PX ? ` (free clicks only ${r.clearance.toFixed(0)}px clear)` : ''}`;
}

export async function runMatrix(d, { only = null, log = console.log } = {}) {
  await d.view();
  const fix = await d.doc();
  const P = fixtureParts(fix, d);
  const T = targetsOf(fix, d, P);
  const rows = [];
  const want = (s) => !only || only.test(s);
  for (const rc of DRAW_RECIPES) for (const t of T) {
    const name = `draw ${rc.tool}${rc.mode ? '(' + rc.mode + ')' : ''} ${rc.role} x ${t.key}`;
    if (!want(name)) continue;
    await d.view();
    const r = await runDrawCell(d, fix, P, t, rc, sceneOf(fix, d), name); rows.push(r); log(line(r));
  }
  for (const cell of CONSTRAINT_CELLS) {
    const name = `constraint ${cell[0]} ${cell[1].join('+')}`;
    if (!want(name)) continue;
    await d.view();
    const r = await runConstraintCell(d, fix, P, cell, name); rows.push(r); log(line(r));
  }
  for (const which of ['line end', 'rect corner']) for (const t of T) {
    const name = `drag ${which} x ${t.key}`;
    if (!want(name)) continue;
    await d.view();
    const r = await runDragCell(d, fix, P, t, which, sceneOf(fix, d), name); rows.push(r); log(line(r));
  }
  return rows;
}
