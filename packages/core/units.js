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

export const BASE = 'mm'; // 1 world unit = 1 mm

// mm per 1 of each unit
const TO_MM = { mm: 1, cm: 10, in: 25.4 };

// the valid document units (also the accepted input suffixes)
export const UNITS = ['mm', 'cm', 'in'];

// parse(str, docUnit) → base value in mm, or null on empty/invalid.
// A trailing unit suffix (mm|cm|in, case-insensitive, optional leading space) OVERRIDES docUnit; a BARE number is
// interpreted in docUnit. Accepts '5', '5mm', '0.25in', '5 mm', '.25in', '5MM', negatives. (Fractions like '1/8'
// are NOT supported here — noted for the cut-param presets at U3, which already store decimals.)
export function parse(str, docUnit = BASE) {
  if (str == null) return null;
  const s = String(str).trim().toLowerCase();
  if (s === '') return null;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(mm|cm|in)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] || docUnit;
  const factor = TO_MM[unit];
  if (factor == null) return null;
  return n * factor;
}

// format(baseMM, docUnit, opts?) → string in docUnit, or '' for null/non-finite.
// opts.decimals — display precision (default 1 = today's toFixed(1)).
// opts.unit:true — the Shaper EXPORT form: minimal precision (trailing zeros trimmed) + the unit suffix
//   ('0.25in' / '6.35mm') so SP1j reuses it.
export function format(baseMM, docUnit = BASE, opts = {}) {
  if (baseMM == null || !Number.isFinite(Number(baseMM))) return '';
  const unit = TO_MM[docUnit] ? docUnit : BASE;
  const val = Number(baseMM) / TO_MM[unit];
  if (opts.unit) {
    const p = (typeof opts.decimals === 'number') ? opts.decimals : 4;
    let str = val.toFixed(p);
    if (str.indexOf('.') >= 0) str = str.replace(/0+$/, '').replace(/\.$/, ''); // trim trailing zeros + dot
    return `${str}${unit}`;
  }
  const decimals = (typeof opts.decimals === 'number') ? opts.decimals : 1;
  return val.toFixed(decimals);
}
