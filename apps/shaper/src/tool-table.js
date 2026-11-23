// apps/shaper/src/tool-table.js — TASK 842 (TASK 852: shown to the user as "My bits"; the bit TYPES (CUTTER_SHAPES) are its templates; code names and the storage key stay) (owner turns 3079-3081: "What about a tool table"; "Ballnoses, tapered too"; "Mm or inches right?"): Shaper's TOOL
// TABLE, the user's bit library. PURE model + its storage; the window is tool-table-window.js, the cut card's bit pick is cut-panel.js.
//
// A BIT = { id, name, type, unit, <the size fields of its type>, cutLength?, notes? }:
//   type    a CUTTER_SHAPES id (shaper.js: end mill | ball nose | bowl | V-bit | tapered ball nose | tapered end mill); the type's `fields` declare its size fields:
//           diameter (mm) | cornerRadius (mm, a bowl bit: 0 < cornerRadius <= diameter / 2) | angle (a V-bit's INCLUDED angle, degrees) | tipDiameter, taperAngle (degrees PER SIDE), shankDiameter (a tapered bit)
//   unit    'mm' | 'in': the unit the bit was ENTERED in, declared once per bit (the owner: a 1/4 in bit stays "1/4 in", a 6 mm bit "6 mm", whatever the
//           document's unit). Every length is STORED in base mm, exactly as the units parser gives it (1/4 in = 0.25 x 25.4 mm), and shown in the bit's unit
//           (bitLengthText: an inch size that is an exact 64th as a fraction, else decimals), the other unit in brackets in the list (bitSizeText).
//   cutLength  the cutting length (the deepest the flutes reach, mm), optional: an operation deeper than it gets one plain note line (cutLengthNote; never blocks)
//   notes   free text, optional
// THE TABLE is saved ONCE for all the user's designs: the per-user settings store (#core/settings-manager.js, key SHAPER_TOOL_TABLE = { v: 1, bits: [...] }),
// which is this browser's local storage and, while the user is signed in, follows him to his other devices through his Google Drive (TASK 773: the key is a
// synced setting). Nothing stored (first use) = DEFAULT_BITS (the standard inch end mills; a stored table is never touched). A DOCUMENT never refers to the table for its cuts: an operation that picks a bit takes a COPY of its
// settings into its own record (recordFieldsOf: toolDia / cutterShape / cutterAngle / cornerRadius / taperAngle / shankDia, + bitId / bitName / cutLength), so a design opens and
// cuts the same after the bit is changed or deleted in the table.

import { CUTTER_SHAPES } from './shaper.js';
import { parse as parseUnit, formatFraction, basePer } from '#core/units.js';
import SettingsManager, { lengthText, angleText } from '#core/settings-manager.js';

export const TOOL_TABLE_KEY = 'SHAPER_TOOL_TABLE';
export const TOOL_TABLE_VERSION = 1;
export const BIT_UNITS = Object.freeze(['mm', 'in']);
/** TASK 852d: default V-bit flat tip width (0.02 in = 0.508 mm) for new V-bits and read-time fallback for stored V-bits/records without one. */
export const DEFAULT_VBIT_TIP_WIDTH_MM = 0.508;
/** The cut-record fields a bit sets (recordFieldsOf): the bit's copy in an operation. */
export const BIT_RECORD_FIELDS = Object.freeze(['bitId', 'bitName', 'toolDia', 'cutterShape', 'cutterAngle', 'tipWidth', 'cornerRadius', 'taperAngle', 'shankDia', 'cutLength']);
/** The fields the card's Custom pick clears (the link to a table bit and its cutting length; the cutter itself stays as it is). */
export const CUSTOM_CLEARS = Object.freeze(['bitId', 'bitName', 'cutLength']);
const NAME_MAX = 60;

/** A bit type's declaration (CUTTER_SHAPES entry), or null. */
export const bitType = (id) => CUTTER_SHAPES.find((s) => s.id === id) || null;
/** The size fields of a bit type (its declared `fields`). */
export const typeFields = (type) => (bitType(type) || { fields: [] }).fields;
const isTapered = (type) => typeFields(type).includes('taperAngle');

// an exact length from its text in a unit (the one parser, #core/units.js): '1/4' in -> 6.35 mm, '6' mm -> 6
const len = (text, unit) => parseUnit(text, unit);

/**
 * The bits a user starts with (first use: nothing stored): the standard inch END MILLS (owner turn 3184: 1/16, 1/8, 1/4, 3/8, 1/2 in). Every other kind of bit
 * (ball nose, bowl, V-bit, tapered) is a TYPE template: the user adds the sizes he owns (the window's Add bit). No cutting length is assumed.
 */
export const DEFAULT_BITS = Object.freeze([
  ...[['1-16', '1/16'], ['1-8', '1/8'], ['1-4', '1/4'], ['3-8', '3/8'], ['1-2', '1/2']].map(([id, f]) => ({ id: `em-${id}in`, name: `${f} in end mill`, type: 'endmill', unit: 'in', diameter: len(f, 'in') })),
].map((b) => Object.freeze(b)));

/** A bit with ONLY the fields its type has (+ id, name, type, unit, cutLength, notes); anything else is dropped. Numbers stay as given (never rounded). */
export function normalizeBit(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const out = { id: String(b.id ?? ''), name: String(b.name ?? '').trim(), type: String(b.type ?? ''), unit: BIT_UNITS.includes(b.unit) ? b.unit : 'mm' };
  for (const f of typeFields(out.type)) out[f] = b[f] == null || b[f] === '' ? null : Number(b[f]);
  if (b.cutLength != null && b.cutLength !== '') out.cutLength = Number(b.cutLength);
  if (typeof b.notes === 'string' && b.notes.trim()) out.notes = b.notes;
  return out;
}

const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
/**
 * The ONE validation of a bit: [] when it is valid, else its plain refusal lines (one per problem). `others` = the other bits of the table (a name is used once:
 * the operation names and the tool changes say it).
 */
export function validateBit(raw, others = []) {
  const b = normalizeBit(raw), out = [];
  if (!b.name) out.push('Give the bit a name.');
  else if (b.name.length > NAME_MAX) out.push(`Keep the name to ${NAME_MAX} characters.`);
  else if (others.some((o) => o && o.id !== b.id && String(o.name).trim().toLowerCase() === b.name.toLowerCase())) out.push(`Another bit is already named “${b.name}”.`);
  const t = bitType(b.type);
  if (!t) { out.push('Pick the bit’s type.'); return out; }
  const has = (f) => t.fields.includes(f);
  if (has('diameter') && !positive(b.diameter)) out.push('The diameter must be more than 0.');
  if (has('cornerRadius')) {
    if (!positive(b.cornerRadius)) out.push('The corner radius must be more than 0.');
    else if (positive(b.diameter) && b.cornerRadius > b.diameter / 2 * (1 + 1e-12)) out.push('The corner radius can be at most half the diameter.');
  }
  if (has('angle') && !(positive(b.angle) && b.angle < 180)) out.push('The V-bit’s angle must be between 0° and 180°.');
  if (has('tipWidth')) {
    if (!positive(b.tipWidth)) out.push('The tip width must be more than 0.');
    else if (positive(b.diameter) && !(b.tipWidth < b.diameter)) out.push('The tip width must be smaller than the diameter.');
  }
  if (has('tipDiameter') && !positive(b.tipDiameter)) out.push('The tip diameter must be more than 0.');
  if (has('taperAngle') && !(positive(b.taperAngle) && b.taperAngle < 90)) out.push('The taper angle (per side) must be between 0° and 90°.');
  if (has('shankDiameter')) {
    if (!positive(b.shankDiameter)) out.push('The shank diameter must be more than 0.');
    else if (positive(b.tipDiameter) && !(b.shankDiameter > b.tipDiameter)) out.push('The shank must be wider than the tip.');
  }
  if (b.cutLength != null && !positive(b.cutLength)) out.push('The cutting length must be more than 0 (or empty).');
  return out;
}

/** The bit's DIAMETER as an operation takes it (its toolDia, written to the file as shaper:toolDia): a tapered bit's TIP (see recordFieldsOf). */
export const bitToolDia = (bit) => (isTapered(bit.type) ? bit.tipDiameter : bit.diameter);
/** TASK 852d: a V-bit record's tip width (mm), reading DEFAULT_VBIT_TIP_WIDTH_MM when an old record or Custom V-bit has none. */
export const vbitTipWidth = (rec) => (rec && Number(rec.tipWidth) > 0 ? Number(rec.tipWidth) : DEFAULT_VBIT_TIP_WIDTH_MM);

/**
 * The cut-record fields an operation takes from a bit (its COPY of the bit): bitId, bitName, cutterShape = the type, toolDia (a tapered bit: its TIP diameter:
 * the Origin offsets an inside / outside cut by half the toolDia, and the tip is what cuts at the bottom of the cut, on the line; the cone above it is the
 * wall's draft), cutterAngle (a V-bit), tipWidth (a V-bit: TASK 852d), cornerRadius (a bowl bit), taperAngle + shankDia (a tapered bit), cutLength (when set). A field the bit does not have is `undefined` (the
 * operation's own field is removed: setOpFields), except cutterAngle, which only a V-bit sets.
 */
export function recordFieldsOf(bit) {
  const b = normalizeBit(bit), tapered = isTapered(b.type);
  return {
    bitId: b.id, bitName: b.name, cutterShape: b.type, toolDia: bitToolDia(b),
    ...(b.type === 'vbit' ? { cutterAngle: b.angle, tipWidth: b.tipWidth } : { tipWidth: undefined }),
    cornerRadius: b.type === 'bowl' ? b.cornerRadius : undefined,
    taperAngle: tapered ? b.taperAngle : undefined,
    shankDia: tapered ? b.shankDiameter : undefined,
    cutLength: positive(b.cutLength) ? b.cutLength : undefined,
  };
}
/** The record fields the card's Custom pick sets: the table link and the cutting length cleared, the cutter kept (CUSTOM_CLEARS). */
export const customFields = () => Object.fromEntries(CUSTOM_CLEARS.map((f) => [f, undefined]));
/** The table bit an operation's record picked (its bitId), or null (Custom, or the bit is no longer in the table). */
export const bitOfRecord = (rec, bits) => (rec && rec.bitId ? bits.find((b) => b.id === rec.bitId) || null : null);

// ── display, in the BIT'S unit ──
const EXACT_DEN = 64; // an inch size that is a whole number of 64ths is shown as its fraction (1/8, 1/4, 3/8, 1 1/2 ...)
/** A bit length (base mm) as text in `unit` without the unit: inches as a fraction when it is an exact 64th, else decimals (the Length precision setting). */
export function bitLengthText(mm, unit) {
  if (mm == null || !Number.isFinite(Number(mm))) return '';
  if (unit === 'in') {
    const v = Number((Number(mm) / basePer('in')).toPrecision(12));
    if (v > 0 && Math.abs(v * EXACT_DEN - Math.round(v * EXACT_DEN)) < 1e-9) return formatFraction(v, EXACT_DEN);
  }
  return lengthText(mm, { unit, show: 'field', fractions: false });
}
const otherUnit = (unit) => (unit === 'in' ? 'mm' : 'in');
/** "1/4 in (6.35 mm)", "6 mm (0.236 in)": a size in the bit's unit, the other unit in brackets. */
export const bitSizeText = (mm, unit) => `${bitLengthText(mm, unit)} ${unit} (${lengthText(mm, { unit: otherUnit(unit), show: 'field', fractions: false })} ${otherUnit(unit)})`;
/** Parse a typed bit length in the bit's unit (a fraction, a mixed number, decimals; a typed unit suffix wins): base mm, or null. */
export const parseBitLength = (text, unit) => {
  const n = parseUnit(String(text ?? '').trim(), unit);
  return n != null && Number.isFinite(n) ? n : null;
};
/** The size a bit is listed with: "1/4 in (6.35 mm)", "1/4 in (6.35 mm) 60°", "tip 1 mm (0.039 in), 3.5° per side". */
export function bitSummary(bit) {
  const b = normalizeBit(bit);
  if (isTapered(b.type)) return `tip ${bitSizeText(b.tipDiameter, b.unit)}, ${angleText(b.taperAngle, { show: 'deg' })} per side`;
  if (b.type === 'bowl') return `${bitSizeText(b.diameter, b.unit)}, ${bitSizeText(b.cornerRadius, b.unit)} corner`;
  return `${bitSizeText(b.diameter, b.unit)}${b.type === 'vbit' ? ` ${angleText(b.angle, { show: 'deg' })}` : ''}`;
}

/**
 * The name the window suggests for a bit from its sizes ('' while a size is missing): "1/4 in end mill", "3 mm ball nose", "1/4 in bowl bit, 1/16 in corner",
 * "1/4 in 60° V-bit", "1 mm 3.5° tapered ball nose". Lengths in the bit's unit (bitLengthText).
 */
export function suggestBitName(bit) {
  const b = normalizeBit(bit), L = (mm) => `${bitLengthText(mm, b.unit)} ${b.unit}`, t = bitType(b.type);
  const need = b.type === 'vbit' ? ['diameter', 'angle'] : t ? t.fields : [];
  if (!t || need.some((f) => !positive(b[f]))) return '';
  const label = b.type === 'bowl' ? 'bowl bit' : t.label;
  if (b.type === 'bowl') return `${L(b.diameter)} ${label}, ${L(b.cornerRadius)} corner`;
  if (isTapered(b.type)) return `${L(b.tipDiameter)} ${angleText(b.taperAngle, { show: 'deg' })} ${label}`;
  if (b.type === 'vbit') return `${L(b.diameter)} ${angleText(b.angle, { show: 'deg' })} ${label}`;
  return `${L(b.diameter)} ${label}`;
}
/** The one plain line the window shows under a bit's sizes when it is valid but another type fits better, else null: a bowl corner of half the diameter IS a ball nose. */
export function bitNote(bit) {
  const b = normalizeBit(bit);
  return b.type === 'bowl' && positive(b.diameter) && positive(b.cornerRadius) && Math.abs(b.cornerRadius - b.diameter / 2) <= b.diameter * 1e-9
    ? 'A corner radius of half the diameter is a ball nose: pick the Ball nose type for it.' : null;
}

// ── the stored table ──
/**
 * The user's table: [bit] from the settings store (`settings` injectable for a node test). Nothing stored = DEFAULT_BITS (copies). A stored bit that fails the
 * validation (an older or a hand-edited store) is left out with a console warning; the store itself is never rewritten by reading it.
 */
export function loadBits(settings = SettingsManager) {
  const v = settings.get(TOOL_TABLE_KEY);
  if (v == null) return DEFAULT_BITS.map((b) => ({ ...b }));
  if (!v || typeof v !== 'object' || !Array.isArray(v.bits)) { console.warn('[tool-table] the stored table is not { v, bits }: the defaults are shown'); return DEFAULT_BITS.map((b) => ({ ...b })); }
  const out = [];
  for (const raw of v.bits) {
    const withDefaults = raw && raw.type === 'vbit' && (raw.tipWidth == null || raw.tipWidth === '') ? { ...raw, tipWidth: DEFAULT_VBIT_TIP_WIDTH_MM } : raw; // TASK 852d: read-time default for stored V-bits without tipWidth (stored table untouched)
    const b = normalizeBit(withDefaults), why = validateBit(b, out);
    if (!b.id || why.length) { console.warn('[tool-table] a stored bit was left out:', b.name || b.id, why.join(' ')); continue; }
    out.push(b);
  }
  return out;
}
/** Save the whole table (every bit validated first: throws on an invalid one, the store is then unchanged). */
export function saveBits(bits, settings = SettingsManager) {
  const clean = bits.map(normalizeBit);
  clean.forEach((b, i) => { const why = validateBit(b, clean.slice(0, i)); if (!b.id || why.length) throw new Error(`tool-table: invalid bit ${b.name || b.id}: ${why.join(' ')}`); });
  settings.set(TOOL_TABLE_KEY, { v: TOOL_TABLE_VERSION, bits: clean }, { persist: 'local' });
  return clean;
}
/** A new bit id, unique in `bits`. */
export function newBitId(bits) {
  let n = bits.length + 1;
  while (bits.some((b) => b.id === `bit-${n}`)) n++;
  return `bit-${n}`;
}
/** A copy of `bit` for the table (Duplicate): a new id and a name not used yet ("… copy", "… copy 2"). */
export function duplicateBit(bit, bits) {
  const base = `${normalizeBit(bit).name} copy`;
  let name = base, k = 2;
  while (bits.some((b) => String(b.name).trim().toLowerCase() === name.toLowerCase())) name = `${base} ${k++}`;
  return { ...normalizeBit(bit), id: newBitId(bits), name };
}

/** TASK 842 item 6: the one plain note line when an operation goes deeper than its bit's cutting length (`depth` in mm), else null. Never a refusal. */
export function cutLengthNote(rec, depth, unit) {
  const L = Number(rec && rec.cutLength), d = Number(depth);
  if (!(L > 0) || !(d > L + 1e-9)) return null;
  const f = (mm) => `${lengthText(mm, { unit, show: 'field' })} ${unit}`;
  return `This cut goes ${f(d)} deep, deeper than the ${f(L)} cutting length of ${rec.bitName || 'its bit'}.`;
}
