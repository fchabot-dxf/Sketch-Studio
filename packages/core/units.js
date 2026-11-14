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

import SettingsManager from './settings-manager.js';

export const BASE = 'mm'; // 1 world unit = 1 mm

/** The active document unit ('mm' | 'cm' | 'in'), defaulting to 'mm'. */
export const docUnit = () => SettingsManager.get('DOC_UNIT') || 'mm';

// TASK 535 (slice 1a) — THE one unit table. Every conversion factor in the app lives here (the expression parser reads it too).
// kind 'length' → f = mm per 1 of the unit (base mm); kind 'angle' → f = degrees per 1 of the unit (base deg).
// { alias: 'in' } is an alternative spelling of another entry. Names are matched case-insensitively (see unitInfo).
// Decision O18 (units accepted: mm cm in " deg rad) is THIS table: add or remove an entry to flip it.
export const UNIT_TABLE = {
  mm: { kind: 'length', f: 1 },
  cm: { kind: 'length', f: 10 },
  in: { kind: 'length', f: 25.4 },
  '"': { alias: 'in' },
  deg: { kind: 'angle', f: 1 },
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

// formatShaperParam(baseMM, docUnit, { zeroBare }) — TASK 456: THE one formatter for the shaper:cutDepth / cutOffset / toolDia
// attribute values, matching Shaper Studio's exports: every non-zero value = 3 decimals + a SPACE + the unit ("0.100 in",
// "-2.000 in", "0.125 in"); with zeroBare a ZERO is "0in" (Studio writes an unset offset that way). mm / cm mirror the
// pattern ("6.350 mm", "0mm") — UNVERIFIED against a Studio mm export (the samples are all inches).
export function formatShaperParam(baseMM, docUnit = BASE, { zeroBare = false } = {}) {
  const v = Number(baseMM);
  if (!Number.isFinite(v)) return '';
  const unit = TO_MM[docUnit] ? docUnit : BASE;
  if (zeroBare && v === 0) return `0${unit}`;
  return `${(v / TO_MM[unit]).toFixed(3)} ${unit}`;
}
