// packages/core/tests/plot-outlines.test.js — PP-2c oracle. Pins the ported outline styles (#core/plot/outlines) +
// the declared OUTLINE_STYLES registry, BYTE-EXACT vs a golden captured from the ORIGINAL penplotter outlines (same
// shape + params). All 3 are deterministic. Covers normal passthrough, dashed segments, jagged displaced verts, the
// universal multi-pass (passes), and declared defaults.
import { OUTLINE_STYLES, outlineStyle, expandLayerOutline } from '#core/plot/outlines/index.js';
import { apply as dashedApply } from '#core/plot/outlines/dashed.js';
import { apply as jaggedApply } from '#core/plot/outlines/jagged.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const r = (n) => Math.round(n * 1e6) / 1e6;
  const geom = (s) => s.type === 'line' ? ['L', r(s.x1), r(s.y1), r(s.x2), r(s.y2)] : ['P', ...s.points.map((p) => [r(p[0]), r(p[1])])];
  const ser = (ss) => JSON.stringify(ss.map(geom));
  const line10 = { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
  const line2 = { type: 'line', x1: 0, y1: 0, x2: 2, y2: 0 };

  // registry shape — 3 styles, each with params (passes universal) + apply; by-id (not a fixed count).
  assert(Array.isArray(OUTLINE_STYLES) && outlineStyle('normal') && outlineStyle('dashed') && outlineStyle('jagged'), 'registry declares normal/dashed/jagged');
  const keys = (id) => outlineStyle(id).params.map((p) => p.key).join(',');
  assert(keys('normal') === 'passes', 'normal params: passes');
  assert(keys('dashed') === 'passes,dash_length,dash_gap', 'dashed params');
  assert(keys('jagged') === 'passes,amplitude,frequency', 'jagged params');
  assert(typeof outlineStyle('normal').apply === 'function', 'apply method kept');
  const pp = outlineStyle('normal').params[0];
  assert(pp.key === 'passes' && pp.default === 1 && pp.min === 1 && pp.max === 10, 'passes universal: default 1 min 1 max 10');

  // byte-exact vs golden from the original.
  assert(ser(expandLayerOutline([line10], { style: 'normal' })) === '[["L",0,0,10,0]]', 'normal passthrough');
  const DASHED = '[["P",[0,0],[2,0]],["P",[3,0],[5,0]],["P",[6,0],[8,0]],["P",[9,0],[10,0]]]';
  assert(ser(dashedApply(line10, { dash_length: 2, dash_gap: 1 })) === DASHED, 'dashed matches golden');
  const JAGGED = '[["P",[0,-0.8],[0.357143,0],[0.714286,0.8],[1.071429,0],[1.428571,-0.8],[1.785714,0],[2,0.8]]]';
  assert(ser(jaggedApply(line2, { amplitude: 0.8, frequency: 0.7 })) === JAGGED, 'jagged matches golden (displaced verts)');

  // universal multi-pass: dashed 1 pass = 4 dash segments; 3 passes = 12.
  assert(expandLayerOutline([line10], { style: 'dashed', dash_length: 2, dash_gap: 1 }).length === 4, 'dashed 1 pass -> 4');
  assert(expandLayerOutline([line10], { style: 'dashed', passes: 3, dash_length: 2, dash_gap: 1 }).length === 12, 'dashed 3 passes -> 12');
  // passes clamped [1,10] by the declared min/max.
  assert(expandLayerOutline([line10], { style: 'dashed', passes: 0, dash_length: 2, dash_gap: 1 }).length === 4, 'passes 0 -> clamped to 1');
  assert(expandLayerOutline([line10], { style: 'dashed', passes: 99, dash_length: 2, dash_gap: 1 }).length === 40, 'passes 99 -> clamped to 10');

  // declared defaults apply when omitted (dashed dash_length 2 / dash_gap 1).
  assert(ser(expandLayerOutline([line10], { style: 'dashed' })) === DASHED, 'dashed defaults (2/1) applied when omitted');

  console.log('plot-outlines (PP-2c) tests passed ✅');
})().catch((e) => { console.error('plot-outlines tests failed ❌', e); process.exit(1); });
