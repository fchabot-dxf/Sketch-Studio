// tests/over-constrained-874-node.test.js — TASK 874: a constraint a TOOL asks for that the sketch already has (and a conflict refusal) shows ONE
// notice, Fusion's: type 'overconstrained' (the red toast, red circle-with-X icon, "Sketch geometry over constrained"), no Copy button.
// Nothing is added; the tool ends as a valid pick ends. Snap-made / tool-internal duplicates (a rectangle's corners) stay silent.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { ConstraintManager, setConstraintNotifier, OVER_CONSTRAINED_TEXT } from '#core/constraint-manager.js';
import { handleConstraintPointerDown } from '#ui/input-handlers/constraint-tools.js';
import { rect } from '#core/tool-ops.js';
import { showNotification } from '#ui/notification-manager.js';

setConstraintNotifier(showNotification);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const notices = (doc) => [...doc.querySelectorAll('#notification-container [data-level]')];
const clear = (doc) => notices(doc).forEach((e) => e.remove());

const app = await open({ host: 'sketchstudio', width: 1280, height: 800 });
try {
  const st = app.state, doc = app.document;
  let seq = 0;
  const J = (x, y) => { const id = 'q' + (++seq); st.joints.set(id, { x, y, sketchId: st.activeSketchId }); return id; };
  const line = (a, b) => { const s = { id: 'L' + (++seq), type: 'line', joints: [a, b], sketchId: st.activeSketchId }; st.shapes.push(s); return s; };
  const hs = (s) => ({ shape: s });
  const hj = (id) => ({ id, j: st.joints.get(id) });
  const enter = (tool) => { st.currentTool = tool; st.pendingConstraint = { type: tool, firstElement: null }; clear(doc); };
  const press = (j, s) => handleConstraintPointerDown(null, app.svg, st, j, s, null);
  const told = (m) => {
    const n = notices(doc);
    eq(n.length, 1, m + ': ONE notice');
    eq(n[0].getAttribute('data-level'), 'overconstrained', m + ': the over-constrained look');
    ok(n[0].textContent.includes(OVER_CONSTRAINED_TEXT), m + ': text ' + JSON.stringify(n[0].textContent));
    eq(OVER_CONSTRAINED_TEXT, 'Sketch geometry over constrained', 'the exact text');
    eq(n[0].textContent.trim(), 'Sketch geometry over constrained', m + ': the text and nothing else');
    ok(!n[0].querySelector('button'), m + ': no Copy button');
    ok(n[0].querySelector('svg'), m + ': the circle-with-X icon');
    ok(!/More Info/.test(n[0].textContent), m + ': no More Info link');
  };
  const count = () => st.constraints.length;
  const pendingClean = (m) => ok(!st.pendingConstraint || !st.pendingConstraint.firstElement, m + ': no pending first pick left');

  // Parallel twice on the same two lines
  const a = line(J(0, 0), J(40, 10)), b = line(J(0, 50), J(40, 60));
  enter(TOOL_MODES.PARALLEL); press(null, hs(a)); press(null, hs(b));
  const n1 = count(); ok(st.constraints.some((c) => c.type === CONSTRAINT_TYPES.PARALLEL), 'parallel made');
  eq(notices(doc).length, 0, 'the first parallel is silent');
  enter(TOOL_MODES.PARALLEL); press(null, hs(a)); press(null, hs(b));
  eq(count(), n1, 'parallel twice adds nothing'); told('parallel twice'); pendingClean('parallel');

  // Equal twice
  enter(TOOL_MODES.EQUAL); press(null, hs(a)); press(null, hs(b));
  clear(doc); const n2 = count();
  enter(TOOL_MODES.EQUAL); press(null, hs(a)); press(null, hs(b));
  eq(count(), n2, 'equal twice adds nothing'); told('equal twice'); pendingClean('equal');

  // Coincident twice
  const p = J(200, 0), q = J(210, 5);
  enter(TOOL_MODES.COINCIDENT); press(hj(p), null); press(hj(q), null);
  const n3 = count();
  enter(TOOL_MODES.COINCIDENT); press(hj(p), null); press(hj(q), null);
  eq(count(), n3, 'coincident twice adds nothing'); told('coincident twice'); pendingClean('coincident');

  // Horizontal on an already horizontal line (replaces 871's "That is already horizontal")
  const h = line(J(300, 0), J(340, 10));
  enter(TOOL_MODES.HORIZONTAL_VERTICAL); press(null, hs(h));
  const n4 = count(); eq(notices(doc).length, 0, 'first horizontal silent');
  enter(TOOL_MODES.HORIZONTAL_VERTICAL); press(null, hs(h));
  eq(count(), n4, 'H twice adds nothing'); told('horizontal twice');

  // a snap / non-toolbar duplicate stays silent
  clear(doc);
  const dup = st.constraints.find((c) => c.type === CONSTRAINT_TYPES.COINCIDENT);
  eq(ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.COINCIDENT, { joints: [...dup.joints] }, { source: 'snap' }), null, 'a snap duplicate is dropped');
  eq(notices(doc).length, 0, 'a snap duplicate is silent');

  // drawing a rectangle: its internal duplicates stay silent
  clear(doc);
  // a conflict refusal (collinear of a horizontal and a vertical line) shows the SAME notice, not the old "rejected" text
  const hl = line(J(600, 0), J(640, 0)), vl = line(J(700, 0), J(700, 40));
  clear(doc); const n5 = count();
  eq(ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.COLLINEAR, { shapes: [hl.id, vl.id] }, { source: 'toolbar' }), null, 'collinear H + V refused');
  eq(count(), n5, 'nothing added'); told('conflict refusal');
  clear(doc);
  rect(st, 500, 0, 560, 40);
  eq(notices(doc).length, 0, 'a rectangle shows no notice');
} finally {
  await app.close();
}
console.log(`over-constrained-874-node: ${checks} checks passed`);
