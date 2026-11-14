// tests/dimension-line-line-reference-node.test.js - TASK 589 item B (owner report 2026-11-13: "line to line will apply a driven dim, when if i do
// the same to its point it will correctly let me drive it"). SketchStudio through tests/helpers/node-app.js, on the owner's rectangle
// (tests/fixtures/dimension/owner-rect-line-line-589.document.json: rect_..._6 of report-line-line-driven.json at the owner's attempt, the chain
// that determined its top length replaced by one driving length on its bottom line). The owner selected the TOP line, pressed D and picked the
// BOTTOM line within a second. Cause: the top line's length preview is a reference (the sketch determines it) and its creation showed
// "Dimension added as reference" right then, over the line-to-line pick; the line-to-line distance itself was driving.
//  1. line + D: the length preview is a reference, and NO reference notice yet (Fusion says nothing on a pick)
//  2. + a click on the parallel line: the line-to-line distance, DRIVING, still no reference notice; placed, the value box opens
//  3. the point-to-line distance from a point of that line: driving too (the same answer as line-to-line)
//  4. line + D + a click on empty space: the reference length is placed, and the notice shows then, ONCE
// The notices are the page's own: main.js gives the constraint manager the page's toast (setConstraintNotifier(showNotification)); the kit
// does not run main.js, so this test makes that one call.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';

const OWNER = JSON.parse(fs.readFileSync(new URL('./fixtures/dimension/owner-rect-line-line-589.document.json', import.meta.url), 'utf8'));
const TOP = 's1794606832787_6_1', BOTTOM = 's1794606832787_6_3', BOTTOM_LEFT = 'j47_1794606832787';
const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'owner-589', OWNER);
const app = await open({ host: 'sketchstudio', profile });
setConstraintNotifier(showNotification);
let failed = null;
try {
  const st = app.state;
  const J = (id) => st.joints.get(id);
  const container = () => app.document.getElementById('notification-container');
  const referenceNotices = () => [...((container() && container().children) || [])].map((e) => e.textContent).filter((t) => /added as reference/i.test(t));
  const clearNotices = () => { if (container()) container().innerHTML = ''; };
  const onLine = (sid) => { const s = st.shapes.find((x) => x.id === sid); const a = J(s.joints[0]), b = J(s.joints[1]); return app.toScreen(a.x + (b.x - a.x) * 0.6, a.y + (b.y - a.y) * 0.6); };
  const boxOpen = () => !app.document.getElementById('dimInput').classList.contains('hidden');
  const pc = () => st.placingConstraint;
  const driven = (c) => !!(c.isDriven || c.driven);
  const EMPTY = (() => { const b = J(st.shapes.find((x) => x.id === BOTTOM).joints[0]); return app.toScreen(b.x + 200, b.y - 120); })();
  const start = () => { app.esc(); app.tool('select'); app.esc(); clearNotices(); const p = onLine(TOP); app.click(p.x, p.y); assert.deepStrictEqual([...st.selectedShapes], [TOP], 'the top line is selected'); app.key('d'); };

  // 1. the top line + D: its length preview is a REFERENCE (determined), and no reference notice on this pick
  start();
  assert(pc() && pc().__placing && pc().joints && pc().joints.length === 2, '1: the length preview follows the pointer');
  assert(driven(pc()), '1: the length preview is a reference (the sketch determines that length)');
  assert.deepStrictEqual(referenceNotices(), [], '1: no "added as reference" notice on the pick (it was shown here, over the next pick)');
  console.log('1. line + D: reference preview, no notice: ok');

  // 2. + the bottom line: the line-to-line distance, DRIVING; still no reference notice; placed, the value box opens
  const b = onLine(BOTTOM); app.click(b.x, b.y);
  assert(pc() && pc().shapes && pc().shapes.length === 2, '2: the line-to-line distance is being placed: ' + JSON.stringify(pc() && { j: pc().joints, s: pc().shapes }));
  const lineLine = pc();
  assert(!driven(lineLine), '2: the line-to-line distance is driving');
  assert.deepStrictEqual(referenceNotices(), [], '2: no reference notice while the line-to-line distance is placed');
  app.move(EMPTY.x, EMPTY.y); app.click(EMPTY.x, EMPTY.y);
  await app.waitFor(boxOpen, 'the value box of the line-to-line distance');
  assert(st.constraints.includes(lineLine) && !driven(lineLine), '2: placed driving, the value box open');
  app.esc(); app.undo();
  assert(!st.constraints.includes(lineLine), '2: one undo removes it');
  console.log('2. + bottom line: driving line-to-line, no notice, value box: ok');

  // 3. the point-to-line distance from the bottom-left point to the top line: driving too (the same answer as line-to-line)
  app.esc(); app.tool('dim'); clearNotices();
  const p0 = app.toScreen(J(BOTTOM_LEFT).x, J(BOTTOM_LEFT).y); app.click(p0.x, p0.y);
  const t = onLine(TOP); app.click(t.x, t.y);
  assert(pc() && pc().joints && pc().joints.length === 3, '3: the point-to-line distance is being placed');
  assert.strictEqual(driven(pc()), driven(lineLine), '3: point-to-line and line-to-line agree (both driving)');
  app.esc();
  console.log('3. point-to-line: driving, as line-to-line: ok');

  // 4. the top line + D + a click on empty space: the reference length is placed, and the notice shows now, once
  start();
  const ref = pc();
  assert.deepStrictEqual(referenceNotices(), [], '4: no notice on the pick');
  app.move(EMPTY.x, EMPTY.y); app.click(EMPTY.x, EMPTY.y);
  assert(st.constraints.includes(ref) && !ref.__placing && driven(ref), '4: the reference length is placed');
  assert(!boxOpen(), '4: a reference has no value box');
  assert.strictEqual(referenceNotices().length, 1, '4: the reference notice shows once, on placement: ' + JSON.stringify(referenceNotices()));
  console.log('4. placed reference length: one notice: ok');
} catch (e) { failed = e; } finally { setConstraintNotifier(() => {}); await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
