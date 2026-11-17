// tests/bezier-pick-762-shaper-tools-live.test.js — TASK 762, Shaper's Design tab, desktop 1280 x 800, real mouse (tests/helpers/bezier-pick-live.js).
// The TOOL rows of the facts table, each a ribbon tool then one press on the BEZIER's body:
//  Trim, Fillet and Dimension refuse with the declared reason (#core/curve-kinds.js CURVE_REFUSALS), the tool kept, nothing made (every refused tool is
//  pressed in tests/bezier-pick-762-node.test.js). (Tangent, Offset and Mirror's line step: bezier-pick-762-shaper-tools-b-live; the Line tool ending on
//  the body and Close path by the body: bezier-pick-762-shaper-snap-live.)
import assert from 'node:assert';
import { openBezierPickPage } from './helpers/bezier-pick-live.js';

const REFUSED = {
  trim: 'Trim: not available on a Bezier curve (Trim cuts lines only)',
  fillet: 'Fillet: not available on a Bezier curve (Fillet rounds corners of lines and arcs only)',
  dim: 'Dimension: not available on a Bezier curve (pick its end points to dimension the distance between them)',
};
const t = await openBezierPickPage({ tag: 'shaper-tools' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const out = {};
try {
  await t.open();
  const { probes } = t;
  for (const [tool, msg] of Object.entries(REFUSED)) {
    const r = out[tool] = await probes.tool('bezier', tool);
    assert.deepStrictEqual([r.notes, r.tool, r.shapes, r.constraints], [[msg], tool, 0, []], tool + ': refused with the reason, the tool kept, nothing made: ' + JSON.stringify(r));
  }
  console.log(`bezier-pick-762-shaper-tools-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }
