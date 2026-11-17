// tests/bezier-pick-762-shaper-tools-b-live.test.js — TASK 762, Shaper's Design tab, desktop 1280 x 800, real mouse (tests/helpers/bezier-pick-live.js).
// More TOOL rows of the facts table, each a ribbon tool then one press on the BEZIER's body: the constraint tool Tangent refuses with the declared reason
// (#core/curve-kinds.js CURVE_REFUSALS) and stays on (it used to fall back to Select on a press that picked nothing); Offset says its own reason
// (#core/offset.js); Mirror's line step refuses a bezier as the mirror line (the line selected as the object first).
import assert from 'node:assert';
import { openBezierPickPage } from './helpers/bezier-pick-live.js';

const REFUSED = {
  tangent: 'Tangent: not available on a Bezier curve (lines, circles and arcs only)',
};
const t = await openBezierPickPage({ tag: 'shaper-tools-b' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const out = {};
try {
  await t.open();
  const { probes } = t;
  for (const [tool, msg] of Object.entries(REFUSED)) {
    const r = out[tool] = await probes.tool('bezier', tool);
    assert.deepStrictEqual([r.notes, r.tool, r.shapes, r.constraints], [[msg], tool, 0, []], tool + ': refused with the reason, the tool kept, nothing made: ' + JSON.stringify(r));
  }
  out.offset = await probes.tool('bezier', 'offset');
  assert.deepStrictEqual(out.offset.notes, ['Offset: a bezier cannot be offset (lines, arcs and circles only).'], 'Offset says its own reason: ' + JSON.stringify(out.offset));
  // Mirror: the line selected as the object, then the bezier's body as the mirror line
  await t.fresh('line'); await t.press(await t.toScreen(20, 0)); await t.ribbon('tool-mirror'); await t.clearNotes();
  await t.press(await t.toScreen(115, -18.75)); out.mirrorLine = await t.notes(); await t.keys.esc(); await t.keys.esc();
  assert.ok(out.mirrorLine.includes('Mirror line: not available on a Bezier curve (pick a line, a construction line or the X / Y axis)'), 'Mirror refuses the bezier as the mirror line: ' + JSON.stringify(out.mirrorLine));
  console.log(`bezier-pick-762-shaper-tools-b-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }
