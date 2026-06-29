import { parse, format, BASE, UNITS } from '#core/units.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const close = (a, b, e = 1e-6) => typeof a === 'number' && Math.abs(a - b) < e;

  assert(BASE === 'mm', 'BASE is mm');
  assert(Array.isArray(UNITS) && UNITS.includes('mm') && UNITS.includes('in'), 'UNITS list');

  // ── parse: a bare number uses docUnit ──
  assert(parse('5', 'mm') === 5, 'parse 5 in mm doc → 5mm');
  assert(close(parse('5', 'in'), 127), 'parse 5 in inch doc → 127mm');
  assert(parse('5') === 5, 'parse bare → base (mm) by default');
  // ── parse: a unit suffix OVERRIDES docUnit ──
  assert(parse('5mm', 'in') === 5, 'mm suffix overrides inch doc');
  assert(close(parse('0.25in', 'mm'), 6.35), '0.25in → 6.35mm');
  assert(close(parse('1in'), 25.4), '1in → 25.4mm');
  assert(parse('2cm', 'mm') === 20, '2cm → 20mm');
  // ── parse: tolerant inputs ──
  assert(close(parse('.25in'), 6.35), 'leading-dot .25in');
  assert(parse('5 mm') === 5, 'space before suffix');
  assert(parse('5MM') === 5, 'case-insensitive suffix');
  assert(parse('-3mm') === -3, 'negative');
  assert(parse('5.') === 5, 'trailing dot');
  // ── parse: invalid → null ──
  assert(parse('') === null, 'empty → null');
  assert(parse('   ') === null, 'whitespace → null');
  assert(parse('abc') === null, 'abc → null');
  assert(parse('5x') === null, 'bad suffix → null');
  assert(parse('1/8') === null, 'fractions unsupported in U1 → null (noted for U3)');
  assert(parse(null) === null, 'null → null');
  assert(parse(undefined) === null, 'undefined → null');

  // ── format: display (default decimals 1 — MUST match today's toFixed(1)) ──
  assert(format(5, 'mm') === '5.0', "format(5,'mm') === '5.0' (toFixed(1) parity)");
  assert(format(25.4, 'in') === '1.0', '25.4mm → 1.0in');
  assert(format(0, 'mm') === '0.0', 'zero');
  assert(format(-3, 'mm') === '-3.0', 'negative format');
  assert(format(5, 'mm', { decimals: 3 }) === '5.000', 'decimals option');
  // ── format: edges → '' ──
  assert(format(null, 'mm') === '', "null → ''");
  assert(format(NaN, 'mm') === '', "NaN → ''");
  assert(format(undefined, 'mm') === '', "undefined → ''");
  // ── format {unit:true}: the Shaper export form (minimal precision + suffix) ──
  assert(format(6.35, 'mm', { unit: true }) === '6.35mm', 'export 6.35mm');
  assert(format(6.35, 'in', { unit: true }) === '0.25in', 'export 0.25in');
  assert(format(25.4, 'in', { unit: true }) === '1in', 'export trims trailing zeros → 1in');
  assert(format(parse('0.25in'), 'in', { unit: true }) === '0.25in', 'round-trip export inch');
  assert(format(parse('0.25in'), 'mm', { unit: true }) === '6.35mm', 'round-trip export mm');

  // ── round-trip (same unit, display precision) ──
  assert(parse(format(5, 'mm'), 'mm') === 5, 'round-trip 5mm');
  assert(close(parse(format(127, 'in'), 'in'), 127, 0.1), 'round-trip 127mm via inch display');

  console.log('units tests passed ✅');
})().catch((e) => { console.error('units tests failed ❌', e); process.exit(1); });
