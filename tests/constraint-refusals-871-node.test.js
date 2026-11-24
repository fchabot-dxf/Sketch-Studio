// tests/constraint-refusals-871-node.test.js — TASK 871 (audit 869 causes G, H, I): a click on a line with Horizontal / Vertical works
// the way the tool is really entered (pendingConstraint = { type, firstElement: null }); every refused / invalid pick of a constraint tool
// tells the user why with a notice (never a console.warn or a silent end); Midpoint on an arc is refused WITH a notice.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { handleConstraintPointerDown, resetConstraintState } from '#ui/input-handlers/constraint-tools.js';
import { showNotification } from '#ui/notification-manager.js';

setConstraintNotifier(showNotification);

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const toasts = (doc) => [...doc.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim());
const clearToasts = (doc) => doc.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());

const warns = [];
const origWarn = console.warn;
console.warn = (...a) => { warns.push(a.join(' ')); };

const app = await open({ host: 'sketchstudio', width: 1280, height: 800 });
try {
  const st = app.state, doc = app.document;
  let seq = 0;
  const J = (x, y, fixed = false) => { const id = 'q' + (++seq); st.joints.set(id, { x, y, sketchId: st.activeSketchId, ...(fixed ? { fixed: true } : {}) }); return id; };
  const line = (a, b) => { const s = { id: 'L' + (++seq), type: 'line', joints: [a, b], sketchId: st.activeSketchId }; st.shapes.push(s); return s; };
  const circle = (cx, cy, r) => { const c = J(cx, cy), p = J(cx + r, cy); const s = { id: 'C' + (++seq), type: 'circle', joints: [c, p], sketchId: st.activeSketchId }; st.shapes.push(s); return s; };
  const arc = (cx, cy, r) => { const c = J(cx, cy), a = J(cx + r, cy), b = J(cx, cy + r); const s = { id: 'A' + (++seq), type: 'arc', subType: 'CENTER', joints: [c, a, b], sweep: true, sketchId: st.activeSketchId }; st.shapes.push(s); return { s, a, b, c }; };
  const hj = (id) => ({ id, j: st.joints.get(id) });
  const hs = (s) => ({ shape: s });
  // enter a tool exactly as switchToTool does: pendingConstraint = { type, firstElement: null }
  const enter = (tool) => { st.currentTool = tool; st.pendingConstraint = { type: tool, firstElement: null }; clearToasts(doc); };
  const made = (type) => st.constraints.filter((c) => c.type === type).length;
  const press = (j, s) => handleConstraintPointerDown(null, app.svg, st, j, s, null);

  // G: a click on a slanted line, tool entered with nothing pre-selected -> horizontal
  const slant = line(J(0, 0), J(40, 10));
  enter(TOOL_MODES.HORIZONTAL_VERTICAL);
  eq(press(null, hs(slant)), true, 'G: click on a line is handled');
  eq(made(CONSTRAINT_TYPES.HORIZONTAL), 1, 'G: a horizontal constraint was made on the clicked line');
  eq(st.joints.get(slant.joints[0]).y, st.joints.get(slant.joints[1]).y, 'G: the line is horizontal');
  // G: a steep line -> vertical
  const steep = line(J(100, 0), J(110, 50));
  eq(press(null, hs(steep)), true, 'G: second line click handled (tool stays)');
  eq(made(CONSTRAINT_TYPES.VERTICAL), 1, 'G: a vertical constraint was made');
  // G: two points still work
  const p1 = J(200, 0), p2 = J(240, 30);
  enter(TOOL_MODES.HORIZONTAL_VERTICAL);
  eq(press(hj(p1), null), true, 'G: first point');
  eq(press(hj(p2), null), true, 'G: second point');
  eq(made(CONSTRAINT_TYPES.HORIZONTAL), 2, 'G: two points make a horizontal');

  // I: H/V on a line that already holds that constraint -> told (the duplicate check used to drop it silently)
  enter(TOOL_MODES.HORIZONTAL_VERTICAL);
  const nH = made(CONSTRAINT_TYPES.HORIZONTAL);
  press(null, hs(slant));
  eq(made(CONSTRAINT_TYPES.HORIZONTAL), nH, 'I: no duplicate horizontal');
  eq(toasts(doc).join('|'), 'Sketch geometry over constrained', 'I: H/V on an already horizontal line is told (task 874: the over-constrained notice, no longer "That is already horizontal")');

  // I: H/V point then line -> notice
  const l2 = line(J(300, 0), J(340, 20));
  const p3 = J(400, 0);
  enter(TOOL_MODES.HORIZONTAL_VERTICAL);
  press(hj(p3), null);
  const before = st.constraints.length;
  press(null, hs(l2));
  eq(st.constraints.length, before, 'I: H/V point + line makes nothing');
  ok(toasts(doc).length >= 1, 'I: H/V point + line is told: ' + JSON.stringify(toasts(doc)));
  // I: H/V on a circle
  const circ = circle(500, 0, 10);
  enter(TOOL_MODES.HORIZONTAL_VERTICAL);
  press(null, hs(circ));
  ok(toasts(doc).length >= 1, 'I: H/V on a circle is told');

  // I: parallel / perpendicular with a circle or an arc
  for (const tool of [TOOL_MODES.PARALLEL, TOOL_MODES.PERPENDICULAR]) {
    enter(tool);
    press(null, hs(circ));
    ok(toasts(doc).length >= 1, `I: ${tool} on a circle is told`);
    enter(tool);
    press(null, hs(slant));
    clearToasts(doc);
    press(null, hs(slant));
    ok(toasts(doc).length >= 1, `I: ${tool} the same line twice is told`);
    resetConstraintState(st);
  }

  // H: midpoint with a point + an arc, both orders -> nothing made, told, never silent
  const A = arc(600, 0, 20);
  const pm = J(700, 0);
  enter(TOOL_MODES.MIDPOINT);
  press(hj(pm), null);
  const n0 = made(CONSTRAINT_TYPES.MIDPOINT);
  press(null, hs(A.s));
  eq(made(CONSTRAINT_TYPES.MIDPOINT), n0, 'H: point + arc makes no midpoint (the solver has no arc midpoint)');
  ok(toasts(doc).length >= 1, 'H: point + arc is told: ' + JSON.stringify(toasts(doc)));
  enter(TOOL_MODES.MIDPOINT);
  press(null, hs(A.s));
  ok(toasts(doc).length >= 1, 'H: arc first is told');
  // I: midpoint with two lines
  enter(TOOL_MODES.MIDPOINT);
  press(null, hs(slant));
  clearToasts(doc);
  press(null, hs(steep));
  ok(toasts(doc).length >= 1, 'I: midpoint line + line is told');

  // I: symmetric point + line
  enter(TOOL_MODES.SYMMETRIC);
  press(hj(p1), null);
  clearToasts(doc);
  press(null, hs(slant));
  ok(toasts(doc).length >= 1, 'I: symmetric point + line is told');

  // I: tangent line + line, equal line + circle, collinear with a circle
  enter(TOOL_MODES.TANGENT);
  press(null, hs(slant)); press(null, hs(steep));
  ok(toasts(doc).length >= 1, 'I: tangent line + line is told');
  enter(TOOL_MODES.EQUAL);
  press(null, hs(slant)); press(null, hs(circ));
  ok(toasts(doc).length >= 1, 'I: equal line + circle is told');
  enter(TOOL_MODES.COLLINEAR);
  press(null, hs(circ));
  ok(toasts(doc).length >= 1, 'I: collinear on a circle is told');

  // no refusal is a console.warn only
  ok(!warns.some((w) => /constraint-tools|requires a Line/i.test(w)), 'no console.warn-only refusal left: ' + JSON.stringify(warns));
} finally {
  console.warn = origWarn;
  await app.close();
}
console.log(`constraint-refusals-871-node: ${checks} checks passed`);
