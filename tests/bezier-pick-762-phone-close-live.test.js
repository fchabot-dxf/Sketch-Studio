// tests/bezier-pick-762-phone-close-live.test.js — TASK 762 on the PHONE: Shaper's Design tab at 390 x 844, real TOUCH (tests/helpers/bezier-pick-live.js
// bezierToolFacts): the Bezier tool by taps: a tap, a tap, a one-finger drag (a smooth anchor), a tap ON the first anchor closes the outline: the anchor IS
// the first one (TASK 1045: one shared point, no coincident), the path ended, the page's findLoops returns one loop of the three beziers.
import assert from 'node:assert';
import { openBezierPickPage, bezierToolFacts } from './helpers/bezier-pick-live.js';

const t = await openBezierPickPage({ tag: 'phone-close', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const out = {};
try {
  await t.open();
  const f = await bezierToolFacts(t, { endWith: 'none', off: [0, 0] });
  out.close = f.afterClose;
  assert.deepStrictEqual(f.afterClose, { shapes: ['bezier', 'bezier', 'bezier'], jointsAtFirst: 1, constraints: [], loops: [3], drawing: false, tool: 'bezier' }, 'the tap on the first anchor closed the outline: ' + JSON.stringify(f.afterClose));
  console.log(`bezier-pick-762-phone-close-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }
