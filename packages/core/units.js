// packages/core/units.js — document-unit model. PURE, no DOM.
//
// The solver works in WORLD coordinates; the declared BASE is **1 world unit = 1 mm**. A document unit
// ('mm' | 'cm' | 'in') is a DISPLAY / INPUT lens over that base — switching it RE-LABELS the same base value in the
// new unit, it never resizes geometry. Stored values (a dimension's constraint.value, the cut record's
// depth/offset/toolDia) all live in BASE (mm); fields parse/format through here.
//
//   parse(str, docUnit)  → base value in mm (a trailing unit suffix OVERRIDES docUnit; a bare number = docUnit)
//   format(baseMM, docUnit, opts) → string in docUnit (opts.unit:true → the Shaper export form '0.25in' / '6.35mm')
//
// Adopted by the dimension field (U2) + the Shaper cut params (U3); INERT until then.

import { parseInput, evaluate } from './expression.js'; // TASK 817: relative, as every other #core module: a module worker (apps/shaper paths-worker.js) has no import map
import { exportForm } from './origin-rules.js'; // TASK 803: the shaper:* length format is the Origin / Studio rules' (paramFormat); TASK 817: relative (see above)

export const BASE = 'mm'; // 1 world unit = 1 mm

// TASK 535 (slice 1a) — THE one unit table. Every conversion factor in the app lives here (the expression parser reads it too).
// kind 'length' → f = mm per 1 of the unit (base mm); kind 'angle' → f = degrees per 1 of the unit (base deg).
// { alias: 'in' } is an alternative spelling of another entry. Names are matched case-insensitively (see unitInfo).
// Decision O18 (units accepted: mm cm in " deg ° rad) is THIS table: add or remove an entry to flip it.
export const UNIT_TABLE = {
  mm: { kind: 'length', f: 1 },
  cm: { kind: 'length', f: 10 },
  in: { kind: 'length', f: 25.4 },
  '"': { alias: 'in' },
  deg: { kind: 'angle', f: 1 },
  '°': { alias: 'deg' }, // TASK 694: the degree sign, like " for inches ("90°", "-90 °", "45° * 2")
  rad: { kind: 'angle', f: 180 / Math.PI },
};

// unitInfo(name) → { name (canonical, alias resolved), kind, f } or null for an unknown unit
export function unitInfo(name) {
  if (typeof name !== 'string') return null;
  let key = name.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(UNIT_TABLE, key)) return null;
  if (UNIT_TABLE[key].alias) key = UNIT_TABLE[key].alias;
  const e = UNIT_TABLE[key];
  return { name: key, kind: e.kind, f: e.f };
}

// mm per 1 of each LENGTH unit (derived from UNIT_TABLE: not a second table)
const TO_MM = Object.fromEntries(
  Object.entries(UNIT_TABLE).filter(([, e]) => e.kind === 'length').map(([k, e]) => [k, e.f])
);

// world units (mm) in 1 of a document unit (1 for an unknown unit): the ONE conversion factor, for callers that need a length in BASE
export const basePer = (docUnit) => TO_MM[docUnit] || 1;

// TASK 534 — THE one Y-direction seam. Stored geometry (joints, files, the solver, exports) keeps WORLD y, which grows DOWN the
// screen (the SVG's own y). The USER sees positive Y pointing UP, as in Fusion. Every place that SHOWS a y to the user (or reads
// a typed y) goes through this pair; nothing else in the app negates y for display. `0 -` keeps zero a plain +0 (never "-0").
export const worldToUserY = (y) => 0 - y;
export const userToWorldY = (y) => 0 - y;

// the valid document units (also the accepted input suffixes)
export const UNITS = ['mm', 'cm', 'in'];

// parse(str, docUnit) → base value in mm, or null on empty/invalid.
// A trailing unit suffix (mm | cm | in | ", case-insensitive, optional leading space) OVERRIDES docUnit; a BARE number is interpreted in
// docUnit. Accepts '5', '5mm', '0.25in', '5 mm', '.25in', '5MM', negatives, and (TASK 728) fractions and mixed numbers: '1/8', '3/8 in',
// '1 1/2', '1 1/2"', '-1 1/4 in'. ONE grammar: the text is read by the shared expression parser (#core/expression.js, the parameter / dimension
// language), and only a single NUMBER LITERAL is taken here (a sign, a number / fraction / mixed number, an optional length unit): arithmetic
// and names stay refused in these fields, as before ('1-1/2' is a subtraction there, so it is refused here).
// (expression.js imports this module's unit table; this function calls the parser only at run time, so the cycle is harmless.)
export function parse(str, docUnit = BASE) {
  if (str == null) return null;
  const p = parseInput(String(str), { allowAssign: false });
  if (!p.ok || !isNumberLiteral(p.ast)) return null;
  if (!hasUnit(p.ast) && TO_MM[docUnit] == null) return null; // a bare number needs a known document unit
  const r = evaluate(p.ast, null, { target: 'length', unit: docUnit });
  return r.ok ? r.v : null;
}
// the literal forms parse() takes: [-|+] (number | whole/whole | mixed) [length unit]
const isNumberBody = (n) => n.t === 'num' || n.t === 'mixed'
  || (n.t === 'bin' && n.op === '/' && n.left.t === 'num' && n.right.t === 'num' && Number.isInteger(n.left.value) && Number.isInteger(n.right.value));
function isNumberLiteral(n) {
  const x = n.t === 'neg' ? n.arg : n;
  if (x.t === 'unit') return unitInfo(x.unit).kind === 'length' && isNumberBody(x.arg);
  return isNumberBody(x);
}
const hasUnit = (n) => (n.t === 'neg' ? n.arg : n).t === 'unit';

// format(baseMM, docUnit, opts?) → string in docUnit, or '' for null/non-finite.
// opts.decimals — display precision (default 1 = today's toFixed(1)).
// opts.unit:true — the Shaper EXPORT form: minimal precision (trailing zeros trimmed) + the unit suffix
//   ('0.25in' / '6.35mm') so SP1j reuses it.
export function format(baseMM, docUnit = BASE, opts = {}) {
  if (baseMM == null || !Number.isFinite(Number(baseMM))) return '';
  const unit = TO_MM[docUnit] ? docUnit : BASE;
  // TASK 766: the converted value without its float error (12 significant digits): 3/16 in stored as 4.7625 mm or as 4.762499999999999 mm (a step landed
  // there) is the SAME 0.1875 in, so it rounds the same way everywhere ("0.188" at 3 decimals, never "0.187" in one place and "0.188" in another)
  const val = Number((Number(baseMM) / TO_MM[unit]).toPrecision(12));
  if (opts.unit) {
    const p = (typeof opts.decimals === 'number') ? opts.decimals : 4;
    let str = val.toFixed(p);
    if (str.indexOf('.') >= 0) str = str.replace(/0+$/, '').replace(/\.$/, ''); // trim trailing zeros + dot
    return `${str}${unit}`;
  }
  const decimals = (typeof opts.decimals === 'number') ? opts.decimals : 1;
  return val.toFixed(decimals);
}

// formatFraction(value, den) → TASK 728: a number (in its own unit, e.g. inches) as the NEAREST fraction of `den` (8 | 16 | 32 | 64 ...), reduced, as a
// tape measure reads it: 0.5 → '1/2', 1.5 → '1 1/2', 23.625 → '23 5/8', 3 → '3', -1.25 → '-1 1/4', 0.1 at 16 → '1/8' (1.6 sixteenths rounds to 2),
// and '0' for anything that rounds to zero (never '-0'). No unit mark: the caller adds it. Display only (the value itself is never rounded).
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
export function formatFraction(value, den) {
  const ticks = Math.round(Math.abs(Number(value)) * den);
  if (!Number.isFinite(ticks)) return '';
  if (ticks === 0) return '0';
  const whole = Math.floor(ticks / den);
  const rest = ticks - whole * den, g = gcd(rest, den), num = rest / g, d = den / g; // reduced: 12/16 → 3/4
  const body = rest === 0 ? String(whole) : whole === 0 ? `${num}/${d}` : `${whole} ${num}/${d}`;
  return (Number(value) < 0 ? '-' : '') + body;
}

// unitNumber(baseMM, docUnit) → the value as a plain NUMBER in docUnit (6 decimals: exact enough to step or compare from; not display text)
export const unitNumber = (baseMM, docUnit = BASE) => Number(format(baseMM, docUnit, { decimals: 6 }));

// formatShaperParam(baseMM, docUnit, { zeroBare }) — TASK 456: THE one formatter for the shaper:cutDepth / cutOffset / toolDia
// attribute values, matching Shaper Studio's exports: every non-zero value = 3 decimals + a SPACE + the unit ("0.100 in",
// "-2.000 in", "0.125 in"); with zeroBare a ZERO is "0in" (Studio writes an unset offset that way). mm / cm mirror the
// pattern ("6.350 mm", "0mm") — UNVERIFIED against a Studio mm export (the samples are all inches).
// TASK 803: the decimals and the separator are the Origin / Studio rules' paramFormat (#core/origin-rules.js), read here, not repeated.
export function formatShaperParam(baseMM, docUnit = BASE, { zeroBare = false, decimals = exportForm('paramFormat').decimals } = {}) { // decimals: DISPLAY callers only (TASK 724); the export never passes it
  const v = Number(baseMM);
  if (!Number.isFinite(v)) return '';
  const unit = TO_MM[docUnit] ? docUnit : BASE;
  if (zeroBare && v === 0) return `0${unit}`;
  return `${(v / TO_MM[unit]).toFixed(decimals)}${exportForm('paramFormat').separator}${unit}`;
}
