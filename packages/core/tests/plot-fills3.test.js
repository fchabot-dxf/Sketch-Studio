// packages/core/tests/plot-fills3.test.js — PP-2b-3 oracle. Pins the 4 remaining fill patterns (crosshatch,
// zigzag, stipple, dots) added to the FILL_PATTERNS registry, BYTE-EXACT vs a golden captured from the ORIGINAL
// penplotter fills (same rect + params). All 4 are DETERMINISTIC (no Math.random), so exact geometry holds.
import { FILL_PATTERNS, fillPattern } from '#core/plot/fills/index.js';
import { generate as crosshatch } from '#core/plot/fills/crosshatch.js';
import { generate as zigzag } from '#core/plot/fills/zigzag.js';
import { generate as stipple } from '#core/plot/fills/stipple.js';
import { generate as dots } from '#core/plot/fills/dots.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const round = (n) => Math.round(n * 1e6) / 1e6;
  const geom = (s) => s.type === 'line'
    ? ['L', round(s.x1), round(s.y1), round(s.x2), round(s.y2)]
    : ['P', ...s.points.map((p) => [round(p[0]), round(p[1])])];
  const ser = (ss) => JSON.stringify(ss.map(geom));
  const rect = { type: 'rect', x: 0, y: 0, w: 20, h: 12 };

  // registry now carries all 6; the 4 new entries have the PATTERN_OPTIONS param schemas.
  assert(FILL_PATTERNS.length === 6, 'FILL_PATTERNS = 6 entries');
  const keys = (id) => fillPattern(id).params.map((p) => p.key).join(',');
  assert(keys('crosshatch') === 'angle,spacing,offset', 'crosshatch params');
  assert(keys('zigzag') === 'angle,spacing,offset', 'zigzag params');
  assert(keys('stipple') === 'spacing,offset', 'stipple params (no angle)');
  assert(keys('dots') === 'spacing,offset', 'dots params (no angle)');
  assert(fillPattern('hatch') && fillPattern('concentric'), 'hatch + concentric still present (untouched)');

  // byte-exact vs golden from the original.
  const CROSSHATCH = '[["L",0,2,20,2],["L",0,6,20,6],["L",0,10,20,10],["L",18,0,18,12],["L",14,0,14,12],["L",10,0,10,12],["L",6,0,6,12],["L",2,0,2,12]]';
  const ZIGZAG = '[["P",[0,2],[20,2],[0,6],[20,10]]]';
  const STIPPLE = '[["L",2,2,2.1,2],["L",6,2,6.1,2],["L",10,2,10.1,2],["L",14,2,14.1,2],["L",18,2,18.1,2],["L",4,6,4.1,6],["L",8,6,8.1,6],["L",12,6,12.1,6],["L",16,6,16.1,6],["L",2,10,2.1,10],["L",6,10,6.1,10],["L",10,10,10.1,10],["L",14,10,14.1,10],["L",18,10,18.1,10]]';
  const DOTS = '[["L",2,2,2.1,2],["L",6,2,6.1,2],["L",10,2,10.1,2],["L",14,2,14.1,2],["L",18,2,18.1,2],["L",2,6,2.1,6],["L",6,6,6.1,6],["L",10,6,10.1,6],["L",14,6,14.1,6],["L",18,6,18.1,6],["L",2,10,2.1,10],["L",6,10,6.1,10],["L",10,10,10.1,10],["L",14,10,14.1,10],["L",18,10,18.1,10]]';

  assert(ser(crosshatch(rect, { angle: 0, spacing: 4 })) === CROSSHATCH, 'crosshatch matches golden');
  assert(ser(zigzag(rect, { angle: 0, spacing: 4 })) === ZIGZAG, 'zigzag matches golden');
  assert(ser(stipple(rect, { spacing: 4 })) === STIPPLE, 'stipple matches golden (14 dots, staggered)');
  assert(ser(dots(rect, { spacing: 4 })) === DOTS, 'dots matches golden (15 dots, square grid)');

  console.log('plot-fills3 (PP-2b-3) tests passed ✅');
})().catch((e) => { console.error('plot-fills3 tests failed ❌', e); process.exit(1); });
