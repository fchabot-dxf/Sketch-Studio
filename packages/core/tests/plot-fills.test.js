// packages/core/tests/plot-fills.test.js — PP-2b-2 oracle. Pins the ported fills (#core/plot/fills) + the declared
// FILL_PATTERNS registry against a GOLDEN captured from the ORIGINAL penplotter fills (same region + explicit
// params). Covers the 2 archetypes (hatch = pure line-clip, concentric = Clipper offsetRings), the universal offset
// inset (via #core/plot/clip), and that a declared default applies when a param is omitted.
import { FILL_PATTERNS, fillPattern, expandLayerWithFill } from '#core/plot/fills/index.js';
import { generate as hatchGenerate } from '#core/plot/fills/hatch.js';
import { generate as concentricGenerate } from '#core/plot/fills/concentric.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const lg = (ss) => ss.filter((s) => s.type === 'line').map((s) => [s.x1, s.y1, s.x2, s.y2]);

  const rect = { type: 'rect', x: 0, y: 0, w: 20, h: 12 };
  const dumbbell = { type: 'polyline', points: [[0,0],[20,0],[20,8],[40,8],[40,0],[60,0],[60,20],[40,20],[40,12],[20,12],[20,20],[0,20],[0,0]] };

  // 1. registry SHAPE — a list of entries, each carrying id/label/params/generate (single source for UI + defaults).
  assert(Array.isArray(FILL_PATTERNS) && FILL_PATTERNS.length === 2, 'FILL_PATTERNS = 2 archetypes this slice');
  const H = fillPattern('hatch'), C = fillPattern('concentric');
  assert(H && typeof H.generate === 'function' && Array.isArray(H.params), 'hatch entry has params + generate');
  assert(H.params.map((p) => p.key).join(',') === 'angle,spacing,offset', 'hatch params: angle,spacing,offset');
  assert(C.params.map((p) => p.key).join(',') === 'spacing,offset', 'concentric params: spacing,offset (NO angle)');

  // 2. hatch (pure line-clip) — byte-exact vs the original golden.
  const HATCH_GOLDEN = JSON.stringify([[0,2,20,2],[0,6,20,6],[0,10,20,10]]);
  assert(JSON.stringify(lg(hatchGenerate(rect, { angle: 0, spacing: 4 }))) === HATCH_GOLDEN, 'hatch matches golden');

  // 3. concentric (Clipper offsetRings) — the dumbbell splits into 9 rings (matches the PP-2b-1 probe golden).
  const conc = concentricGenerate(dumbbell, { spacing: 2, offset: 1 });
  assert(conc.length === 9 && conc.every((s) => s.type === 'polyline'), 'concentric -> 9 polyline rings');

  // 4. universal offset — expandLayerWithFill insets the region via clip then hatches (vs original golden).
  const EXPAND_GOLDEN = JSON.stringify([[2,4,18,4],[2,8,18,8]]);
  const off = expandLayerWithFill({ shapes: [rect], fill: { pattern: 'hatch', angle: 0, spacing: 4, offset: 2 } });
  assert(JSON.stringify(lg(off)) === EXPAND_GOLDEN, 'offset inset-then-hatch matches golden');

  // 5. declared default applies when a param is OMITTED (hatch angle default = 45).
  assert(H.params.find((p) => p.key === 'angle').default === 45, 'hatch angle default declared = 45');
  const omitted = expandLayerWithFill({ shapes: [rect], fill: { pattern: 'hatch', spacing: 4 } });
  const explicit45 = expandLayerWithFill({ shapes: [rect], fill: { pattern: 'hatch', angle: 45, spacing: 4 } });
  assert(JSON.stringify(lg(omitted)) === JSON.stringify(lg(explicit45)), 'omitted angle uses the declared default (45)');
  assert(lg(omitted).length > 0, 'default hatch produced lines');

  console.log('plot-fills (PP-2b-2) tests passed ✅');
})().catch((e) => { console.error('plot-fills tests failed ❌', e); process.exit(1); });
