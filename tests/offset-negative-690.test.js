// tests/offset-negative-690.test.js - TASK 690 (owner turn 1822 "Offset constraint should allow negative value"; Fusion measured by the advisor,
// turn 1823): a NEGATIVE offset value puts the offset on the OTHER side of its source, at |value|. ONE rule (#core/offset.js header):
//   1. parse: parseOffsetDistance is SIGNED, 0 / not a number -> null; offsetSideAndDistance(side, v) flips the side for a negative v.
//   2. solver: an offset DIMENSION edited to a negative value (the canvas box's own path: previewDimensionInput -> applyParameterChange) moves the
//      offset line / arc / circle to the other side; an arc / circle radius = R + side * value (inward offsets shrink it); |value| >= the radius
//      inward is REFUSED with its own message (never a fold); 0 is REFUSED; each edit is ONE undo step; a parameter (or '-off') drives it.
//   3. the undimensioned offset (task 667): deleting a negative dimension keeps the geometry (value |v|, sides flipped) and a drag still never
//      flips its free distance through zero.
//   4. the real app (tests/helpers/node-app.js, SketchStudio): the Offset tool's box takes -5 (the preview and the result on the other side, the
//      arrow drag still works from there), 0 is refused; the dimension box takes -3 (label -3.0), Ctrl+Z in the box restores the opening value;
//      the Parameters table sets a referenced parameter to -2.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import {
  offsetChainOf, offsetSideAt, applyOffset, parseOffsetDistance, offsetSideAndDistance, offsetValueRefusal, OFFSET_ZERO_REASON
} from '#core/offset.js';
import { previewDimensionInput, planChange } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { labelEl, labelBoxCenter } from './helpers/node-dom-read.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, msg, tol = 1e-4) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// ---- 1. parse + the side rule
ok(parseOffsetDistance('-5', 'mm') === -5, `'-5' parses to -5 (${parseOffsetDistance('-5', 'mm')})`);
ok(parseOffsetDistance('-0.25', 'in') === -6.35 && parseOffsetDistance('-1 cm', 'mm') === -10, 'a negative value in the document unit / with a unit suffix');
ok(parseOffsetDistance('5', 'mm') === 5, 'a positive value is unchanged');
ok(parseOffsetDistance('0', 'mm') === null && parseOffsetDistance('-0', 'mm') === null && parseOffsetDistance('x', 'mm') === null, '0, -0 and a non-number are no distance');
ok(JSON.stringify(offsetSideAndDistance(1, -5)) === '{"side":-1,"d":5}' && JSON.stringify(offsetSideAndDistance(-1, -5)) === '{"side":1,"d":5}', 'a negative distance: the other side at |v|');
ok(JSON.stringify(offsetSideAndDistance(-1, 5)) === '{"side":-1,"d":5}', 'a positive distance keeps its side');

// ---- 2. solver, through the dimension box's own path
// build: a source on fixed joints, offset 5 toward `sidePt`; -> { S, c (the offset constraint), off (the first offset piece), src }
function offsetOf(build, sidePt, d = 5) {
  const S = L.newSketch();
  const srcId = build(S);
  const ch = offsetChainOf(S.state, srcId);
  ok(ch.ok, 'the chain');
  const res = applyOffset(S.state, ch.chain, d, offsetSideAt(S.state, ch.chain, sidePt));
  ok(res.ok, `the offset is made (${res.reason || ''})`);
  S.state.engine.solve(500);
  const c = S.state.constraints.find((x) => x.type === CONSTRAINT_TYPES.OFFSET);
  return { S, c, off: S.state.shapes.find((s) => s.id === c.shapes[1]), src: S.state.shapes.find((s) => s.id === c.shapes[0]) };
}
// the box: type `text` into the dimension -> applyParameterChange's result (one undo step)
const typeInto = (S, c, text) => {
  const pv = previewDimensionInput(S.state, c, text, { unit: 'mm' });
  ok(pv.ok, `"${text}" is a value the box takes (${pv.hint})`);
  return applyParameterChange(S.state, pv.plan, 'edit');
};
const J = (S, id) => S.state.joints.get(id);
const radiusOf = (S, s) => (s.type === 'circle' ? s.radius : Math.hypot(J(S, s.joints[1]).x - J(S, s.joints[0]).x, J(S, s.joints[1]).y - J(S, s.joints[0]).y));
const fixAll = (S, ids) => ids.forEach((j) => { J(S, j).fixed = true; });

{ // a line 0,0 -> 60,0 offset 5 to y > 0
  const { S, c, off } = offsetOf((S) => { const a = L.point(S, 0, 0), b = L.point(S, 60, 0); fixAll(S, [a, b]); return L.line(S, a, b); }, { x: 30, y: 10 });
  const ys = () => off.joints.map((j) => J(S, j).y);
  ok(ys().every((y) => Math.abs(y - 5) < 1e-6), `line: the offset at y = 5 (${ys()})`);
  const h0 = S.state.history.length;
  let r = typeInto(S, c, '-5');
  ok(r.ok && c.value === -5, `line: -5 accepted, the value stays signed (${JSON.stringify(r)}, ${c.value})`);
  ok(ys().every((y) => Math.abs(y + 5) < 1e-6), `line: -5 puts the offset on the other side, y = -5 (${ys()})`);
  ok(S.state.history.length === h0 + 1, 'line: the flip is ONE undo step');
  r = typeInto(S, c, '-3');
  ok(r.ok && ys().every((y) => Math.abs(y + 3) < 1e-6), `line: -3 -> y = -3 (${ys()})`);
  r = typeInto(S, c, '5');
  ok(r.ok && ys().every((y) => Math.abs(y - 5) < 1e-6), `line: back to 5 -> y = 5 (${ys()})`);
  S.state.undo(); // the undo snapshot restores copies: read the offset again
  const c2 = S.state.constraints.find((x) => x.type === CONSTRAINT_TYPES.OFFSET), off2 = S.state.shapes.find((s) => s.id === c2.shapes[1]);
  ok(c2.value === -3, `line: Undo steps back to -3 (${c2.value})`);
  ok(off2.joints.every((j) => Math.abs(J(S, j).y + 3) < 1e-6), 'line: after Undo the offset is back at y = -3');
  // 0 is refused before anything moves, no undo step
  const h1 = S.state.history.length;
  r = typeInto(S, c2, '0');
  ok(!r.ok && r.reason === OFFSET_ZERO_REASON, `line: 0 is refused with its message (${r.reason})`);
  ok(c2.value === -3 && off2.joints.every((j) => Math.abs(J(S, j).y + 3) < 1e-6) && S.state.history.length === h1, 'line: 0 changes nothing, no undo step');
  // a parameter drives it: d = off, off = -2 -> y = -2; d = -off -> y = +2 (Fusion: expressions may negate)
  const created = planChange(S.state, { type: 'createParameter', name: 'off', unit: 'mm', text: '3 mm' }, { unit: 'mm' });
  ok(created.ok && applyParameterChange(S.state, created, 'add').ok, 'a user parameter off = 3 mm');
  r = typeInto(S, c2, 'off');
  ok(r.ok && off2.joints.every((j) => Math.abs(J(S, j).y - 3) < 1e-6), 'line: the dimension reads off = 3 -> y = 3');
  const neg = planChange(S.state, { type: 'setParameter', name: 'off', text: '-2 mm' }, { unit: 'mm' });
  r = applyParameterChange(S.state, neg, 'change parameter off');
  ok(r.ok && c2.value === -2 && off2.joints.every((j) => Math.abs(J(S, j).y + 2) < 1e-6), `line: off = -2 moves the offset to y = -2 (${c2.value})`);
  r = typeInto(S, c2, '-off');
  ok(r.ok && c2.value === 2 && off2.joints.every((j) => Math.abs(J(S, j).y - 2) < 1e-6), 'line: -off (= 2) -> y = 2');
}

{ // a circle R 10 offset 5 OUTWARD (r 15): a negative value shrinks it; |value| >= 10 is refused, never a fold
  const { S, c, off } = offsetOf((S) => { const k = L.circle(S, 0, 0, 10); fixAll(S, [S.state.shapes.find((s) => s.id === k.id).joints[0]]); return k.id; }, { x: 20, y: 0 });
  near(off.radius, 15, 'circle: offset outward r 15');
  ok(typeInto(S, c, '-5').ok && Math.abs(off.radius - 5) < 1e-6, `circle: -5 -> r 5 (${off.radius})`);
  ok(typeInto(S, c, '-9').ok && Math.abs(off.radius - 1) < 1e-6, `circle: -9 -> r 1 (${off.radius})`);
  for (const t of ['-10', '-12']) {
    const r = typeInto(S, c, t);
    ok(!r.ok && /takes the circle of radius 10\s*mm inward by 1[02]\s*mm: it must stay under 10\s*mm/.test(r.reason), `circle: ${t} refused with its message (${r.reason})`);
    ok(c.value === -9 && Math.abs(off.radius - 1) < 1e-6, `circle: ${t} changed nothing (r ${off.radius})`);
  }
  ok(typeInto(S, c, '5').ok && Math.abs(off.radius - 15) < 1e-6, 'circle: +5 again -> r 15');
}
{ // a circle offset INWARD (r 5): -5 puts it outside (r 15)
  const { S, c, off } = offsetOf((S) => { const k = L.circle(S, 0, 0, 10); fixAll(S, [S.state.shapes.find((s) => s.id === k.id).joints[0]]); return k.id; }, { x: 2, y: 0 });
  near(off.radius, 5, 'inner circle: r 5');
  ok(typeInto(S, c, '-5').ok && Math.abs(off.radius - 15) < 1e-6, `inner circle: -5 -> r 15, outside (${off.radius})`);
}
{ // an arc R 10 offset 5 outward (r 15): -5 -> r 5; -12 refused with the radius message (the bare solve said "conflicts with offset, equal")
  const { S, c, off } = offsetOf((S) => { const a = L.point(S, 0, 0), b = L.point(S, 10, 0), e = L.point(S, 0, 10); fixAll(S, [a, b, e]); return L.arc(S, a, b, e); }, { x: 20, y: 20 });
  near(radiusOf(S, off), 15, 'arc: offset outward r 15');
  ok(typeInto(S, c, '-5').ok && Math.abs(radiusOf(S, off) - 5) < 1e-6, `arc: -5 -> r 5 (${radiusOf(S, off)})`);
  const r = typeInto(S, c, '-12');
  ok(!r.ok && /takes the arc of radius 10\s*mm inward by 12\s*mm/.test(r.reason) && !r.clash, `arc: -12 refused with its message (${r.reason}; clash '${r.clash}')`);
  ok(c.value === -5 && Math.abs(radiusOf(S, off) - 5) < 1e-6, 'arc: -12 changed nothing');
  ok(offsetValueRefusal(c, -9.9, S.state.joints, S.state.shapes) === null && /inward by 10/.test(offsetValueRefusal(c, -10, S.state.joints, S.state.shapes)), 'arc: the rule is radius + side * value > 0');
}
{ // a closed rectangle offset 5 inside: -5 puts the whole chain outside
  const { S, c } = offsetOf((S) => { const r = L.rect(S, 0, 0, 60, 40); return r.top; }, { x: 30, y: 20 });
  const offIds = c.shapes.filter((_, i) => i % 2 === 1);
  const box = () => { const pts = offIds.flatMap((id) => S.state.shapes.find((s) => s.id === id).joints.map((j) => J(S, j))); return [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))].map((v) => +v.toFixed(4)); };
  ok(JSON.stringify(box()) === '[5,5,55,35]', `rectangle: inside 5 (${box()})`);
  ok(typeInto(S, c, '-5').ok && JSON.stringify(box()) === '[-5,-5,65,45]', `rectangle: -5 -> outside 5 (${box()})`);
}

// ---- 3. the undimensioned offset: a negative dimension deleted keeps its geometry, its free distance stays > 0 and a drag cannot flip it
{
  const { S, c, off } = offsetOf((S) => { const a = L.point(S, 0, 0), b = L.point(S, 60, 0); fixAll(S, [a, b]); return L.line(S, a, b); }, { x: 30, y: 10 });
  ok(typeInto(S, c, '-5').ok, 'free: the dimension at -5');
  const sidesBefore = c.sides.slice();
  deleteConstraints(S.state, [c]);
  const cf = S.state.constraints.find((x) => x.type === CONSTRAINT_TYPES.OFFSET);
  const offf = S.state.shapes.find((s) => s.id === cf.shapes[1]);
  ok(cf.dimensioned === false && cf.value === 5 && cf.sides[0] === -sidesBefore[0], `free: the dimension deleted -> value |v| = 5, the side flipped (${cf.value}, ${sidesBefore} -> ${cf.sides})`);
  const solved = S.state.engine.solve(500);
  ok(solved.converged && offf.joints.every((j) => Math.abs(J(S, j).y + 5) < 1e-6), `free: the sketch still solves, the offset stays at y = -5 (${JSON.stringify(solved).slice(0, 80)})`);
  const q = offf.joints[0];
  const r1 = S.state.engine.solve(500, { dragTarget: { jointId: q, x: 0, y: -12 } });
  ok(r1.converged && Math.abs(cf.value - 12) < 1e-3, `free: a drag away moves the free distance to 12 (${cf.value})`);
  const r2 = S.state.engine.solve(500, { dragTarget: { jointId: q, x: 0, y: 6 } });
  ok(r2.converged === false && cf.value > 0 && Math.abs(J(S, q).y + 12) < 1e-3, `free: a drag across the source is refused, d stays > 0 (${cf.value}, y ${J(S, q).y})`);
}

// ---- 4. the real app (SketchStudio): the Offset tool's box, the dimension box, the Parameters table
{
  const { planTableEdit, commitTableEdit } = await import('#ui/parameter-table.js');
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'Offset negative 690');
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const st = app.state, doc = app.document;
    const r = app.svg.getBoundingClientRect();
    const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    const at = (dx, dy) => ({ x: C.x + dx, y: C.y + dy });
    const box = () => doc.getElementById('offset-distance-input');
    const previewYs = () => [...app.svg.querySelectorAll('#offset-tool-overlay .offset-preview')].map((e) => +e.getAttribute('y1'));
    for (let i = 0; i < 20 && Math.abs(app.toScreen(15, 0).x - app.toScreen(0, 0).x) > 100; i++) app.wheel(C.x, C.y, 300);
    app.tool('line'); app.click(at(-200, 0).x, at(-200, 0).y); app.click(at(200, 0).x, at(200, 0).y); app.esc();
    app.tool('select');
    const src = st.shapes.find((s) => s.type === 'line');
    const ySrc = st.joints.get(src.joints[0]).y;
    const h0 = st.history.length;
    // the Offset tool: pick the line, the pointer below it on screen, type -5 -> the preview lies ABOVE (the other side), 5 from the line
    app.tool('offset');
    app.click(at(0, 0).x, at(0, 0).y);
    const below = at(0, 80);
    app.move(below.x, below.y);
    const yBelow = previewYs()[0];
    ok(Math.abs(Math.abs(yBelow - ySrc) - 5) < 1e-6, `tool: the preview 5 from the line on the pointer side (${yBelow} vs ${ySrc})`);
    box().select(); app.type('-5');
    const yNeg = previewYs()[0];
    ok(Math.abs(Math.abs(yNeg - ySrc) - 5) < 1e-6 && Math.sign(yNeg - ySrc) === -Math.sign(yBelow - ySrc), `tool: -5 puts the preview on the OTHER side, 5 away (${yNeg})`);
    app.move(below.x + 20, below.y); // a mouse move on the same side keeps the flip
    ok(Math.sign(previewYs()[0] - ySrc) === Math.sign(yNeg - ySrc), 'tool: the pointer moving on its side keeps the negative flip');
    box().select(); app.type('0'); app.enter();
    ok(box() && st.history.length === h0, 'tool: 0 is refused, the box stays open, no undo step');
    box().select(); app.type('-5'); app.enter();
    ok(!box() && st.history.length === h0 + 1, 'tool: Enter applies -5 as ONE undo step');
    let c = st.constraints.find((x) => x.type === CONSTRAINT_TYPES.OFFSET);
    const off = st.shapes.find((s) => s.id === c.shapes[1]);
    const yOff = () => st.joints.get(off.joints[0]).y;
    ok(Math.sign(yOff() - ySrc) === Math.sign(yNeg - ySrc) && Math.abs(Math.abs(yOff() - ySrc) - 5) < 1e-6, `tool: the offset is made on the other side, 5 away (${yOff()})`);
    // TASK 710: the typed value IS the dimension's value (Fusion): -5 stays -5, the side is the pointer's, the sign carries the flip
    ok(c.value === -5, `tool (710): the new offset dimension holds -5 as typed (${c.value})`);
    const labNew = labelEl(app, st.constraints.indexOf(c));
    ok(labNew && /^-5\.0/.test(labNew.textContent.trim()), `tool (710): the label reads -5 (${labNew && labNew.textContent.trim()})`);
    // the dimension box: -3 keeps the side of -5 (the offset stays on the other side), at 3; its label shows -3.0
    app.tool('select');
    const idx = st.constraints.indexOf(c);
    await app.pause(550);
    app.dblclick(labelBoxCenter(app, labelEl(app, idx)).x, labelBoxCenter(app, labelEl(app, idx)).y, { target: () => labelEl(app, idx) });
    const dimInput = doc.getElementById('dimInput');
    ok(dimInput && !dimInput.classList.contains('hidden'), 'dimension: a double click opens its box');
    const opening = dimInput.value;
    dimInput.select(); app.type('-3');
    app.undo(); // Ctrl+Z in the box (task 675 C): the opening value again, the box open, no document step
    ok(dimInput.value === opening && !dimInput.classList.contains('hidden') && st.history.length === h0 + 1, `dimension: Ctrl+Z in the box restores the opening value (${dimInput.value} vs ${opening})`);
    dimInput.select(); app.type('-3'); app.enter();
    ok(c.value === -3 && Math.sign(yOff() - ySrc) === Math.sign(yNeg - ySrc) && Math.abs(Math.abs(yOff() - ySrc) - 3) < 1e-4, `dimension: -3 stays on the -5 side at 3 (${c.value}, ${yOff()})`);
    ok(st.history.length === h0 + 2, 'dimension: ONE undo step');
    const lab = labelEl(app, st.constraints.indexOf(c));
    ok(lab && /-3\.0/.test(lab.textContent), `dimension: the label shows the signed value (${lab && lab.textContent.trim()})`);
    // TASK 710: editing the dimension -3 -> 5 puts the offset back on the pointer side, at 5; Ctrl+Z restores -3 on the other
    const hF = st.history.length;
    ok(typeInto({ state: st }, c, '5').ok && c.value === 5 && Math.sign(yOff() - ySrc) === Math.sign(yBelow - ySrc) && Math.abs(Math.abs(yOff() - ySrc) - 5) < 1e-4, `dimension (710): 5 flips back to the pointer side at 5 (${c.value}, ${yOff()})`);
    app.undo();
    c = st.constraints.find((x) => x.type === CONSTRAINT_TYPES.OFFSET);
    const cU = c;
    ok(cU.value === -3 && st.history.length === hF, `dimension (710): Ctrl+Z restores -3 (${cU.value})`);
    // the Parameters table: off = 4 mm read by the dimension, then off = -2 mm
    const add = planTableEdit(st, { kind: 'new', name: 'off', text: '4 mm', unit: 'mm' }, { unit: 'mm' });
    ok(commitTableEdit(st, add).ok, 'table: + Add off = 4 mm');
    ok(commitTableEdit(st, planTableEdit(st, { kind: 'dimension', column: 'expression', constraint: c, text: 'off' }, { unit: 'mm' })).ok, 'table: the dimension reads off');
    const yFour = yOff();
    ok(Math.abs(Math.abs(yFour - ySrc) - 4) < 1e-4 && Math.sign(yFour - ySrc) === Math.sign(yBelow - ySrc), `table: off = 4 -> 4 on the pointer side, the sign flips the -5 side (${yFour})`);
    const hT = st.history.length;
    const res = commitTableEdit(st, planTableEdit(st, { kind: 'parameter', column: 'expression', name: 'off', text: '-2 mm' }, { unit: 'mm' }));
    app.frames();
    ok(res.ok && c.value === -2 && Math.sign(yOff() - ySrc) === Math.sign(yNeg - ySrc) && Math.abs(Math.abs(yOff() - ySrc) - 2) < 1e-4, `table: off = -2 moves the offset to the other side at 2 (${JSON.stringify(res)}, ${yOff()}, src ${ySrc}, yNeg ${yNeg}, v ${c.value})`);
    ok(st.history.length === hT + 1, 'table: ONE undo step');
    app.undo();
    const c3 = st.constraints.find((x) => x.type === CONSTRAINT_TYPES.OFFSET), off3 = st.shapes.find((s) => s.id === c3.shapes[1]);
    ok(Math.abs(st.joints.get(off3.joints[0]).y - yFour) < 1e-4 && c3.value === 4, `table: Ctrl+Z steps back to off = 4 (${c3.value})`);
  } finally { await app.close(); }
}

console.log(`offset-negative-690: ${checks} checks passed`);
