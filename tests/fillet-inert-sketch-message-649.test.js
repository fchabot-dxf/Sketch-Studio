// TASK 649 (fillet audit, finding F6): a Fillet tap on a corner of a LOCKED or HIDDEN sketch does nothing and says nothing (like Trim and
// Offset: a locked / hidden sketch is out of the pick, task 577). Before: it warned "Fillet needs a corner between two lines", about a
// corner that IS one (locked), or that the user cannot see (hidden).
//  1. core: diagnoseNoFillet(state, pt, tol, include) judges only the curves `include` accepts (none left -> null, no message);
//  2. the tool (SketchStudio through tests/helpers/node-app.js): tap the corner of a locked, then a hidden sketch -> no box, no warning;
//     the same corner unlocked and shown -> the radius box opens.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { diagnoseNoFillet } from '#core/fillet.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

// ---- 1. core
{
  const S = L.newSketch();
  const c = L.point(S, 10, 10), a = L.point(S, 60, 10), b = L.point(S, 10, 40);
  L.line(S, c, a); L.line(S, c, b); L.line(S, c, L.point(S, -20, -20)); // a T: three lines (a real "no fillet" reason)
  assert.match(String(diagnoseNoFillet(S.state, { x: 10, y: 10 }, 2)), /T-junction/, 'all curves: the T-junction reason (unchanged)');
  assert.strictEqual(diagnoseNoFillet(S.state, { x: 10, y: 10 }, 2, () => false), null, 'no curve accepted: no message');
}

// ---- 2. the tool
const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Fillet 649 inert');
const app = await open({ host: 'sketchstudio', profile });
try {
  const st = app.state, doc = app.document;
  const r = app.svg.getBoundingClientRect();
  const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  for (let i = 0; i < 20 && Math.abs(app.toScreen(15, 0).x - app.toScreen(0, 0).x) > 100; i++) app.wheel(C.x, C.y, 300);
  st.clearDocument();
  const J = (x, y) => { const id = st.genJ(); st.joints.set(id, { x, y, fixed: false }); return id; };
  const jc = J(10, 10);
  st.shapes.push({ id: 's_l1', type: 'line', joints: [jc, J(40, 10)] });
  st.shapes.push({ id: 's_l2', type: 'line', joints: [jc, J(10, 40)] });
  app.frames();
  const corner = app.toScreen(10, 10);
  const warnings = () => [...doc.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim());
  const clear = () => doc.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());
  app.tool('fillet');
  for (const how of ['locked', 'hidden']) {
    st.sketches[0].locked = how === 'locked';
    st.sketches[0].visible = how !== 'hidden';
    clear();
    app.click(corner.x, corner.y);
    assert.strictEqual(doc.getElementById('fillet-radius-input'), null, `${how} sketch: the tap opens no radius box`);
    assert.deepStrictEqual(warnings(), [], `${how} sketch: the tap says nothing`);
    app.esc();
    app.tool('fillet');
  }
  st.sketches[0].locked = false; st.sketches[0].visible = true;
  app.click(corner.x, corner.y);
  assert.ok(doc.getElementById('fillet-radius-input'), 'unlocked and shown: the same tap opens the radius box');
  app.esc(); app.esc();
} finally { await app.close(); }
console.log('fillet-inert-sketch-message-649.test.js: ok');
