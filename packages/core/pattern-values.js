// packages/core/pattern-values.js - task 694: the VALUES of a sketch pattern record (#core/pattern.js) as named document parameters, like
// Fusion (advisor-measured with the Fusion API: a rectangular pattern makes quantityOne d1, quantityTwo d2, distanceOne d3, distanceTwo d4; a
// circular one quantity and totalAngle). PURE, imports only the constants, so #core/parameters.js (the parameter model) can read a pattern's
// values without importing #core/pattern.js (which imports the parameter model to name a new pattern's values).
//
// THE DECLARATION (PATTERN_VALUES): per pattern type, its values in Fusion's order (the order their automatic names d<n> are given in):
//   { slot, kind: 'count' | 'length' | 'angle', field, k? (the index into an array field), label }
// THE STORED NAMES / FORMULAS: the record carries `names: { slot: name }` (every slot, always) and `expressions: { slot: text }` (only the
// slots a formula drives), the dimension's `name` / `expression` one per value. Neither object is ever changed in place (the undo snapshot
// copies a constraint shallowly): a writer assigns a new object.
import { CONSTRAINT_TYPES } from './constants.js';

const T = CONSTRAINT_TYPES;
export const PATTERN_VALUES = Object.freeze({
  [T.CIRCULAR_PATTERN]: Object.freeze([
    Object.freeze({ slot: 'quantity', kind: 'count', field: 'quantity', label: 'quantity' }),
    Object.freeze({ slot: 'angle', kind: 'angle', field: 'angle', label: 'total angle' }),
  ]),
  [T.RECTANGULAR_PATTERN]: Object.freeze([
    Object.freeze({ slot: 'quantity1', kind: 'count', field: 'quantity', k: 0, label: 'quantity 1' }),
    Object.freeze({ slot: 'quantity2', kind: 'count', field: 'quantity', k: 1, label: 'quantity 2' }),
    Object.freeze({ slot: 'distance1', kind: 'length', field: 'distance', k: 0, label: 'distance 1' }),
    Object.freeze({ slot: 'distance2', kind: 'length', field: 'distance', k: 1, label: 'distance 2' }),
  ]),
});

/** The declared values of `c` (a pattern record), in Fusion's order; [] for anything else. */
export const patternValueSlots = (c) => (c && Object.prototype.hasOwnProperty.call(PATTERN_VALUES, c.type) ? PATTERN_VALUES[c.type] : []);
/** The declaration of one value of `c`, or null. */
export const patternSlot = (c, slot) => patternValueSlots(c).find((s) => s.slot === slot) || null;
/** The current number of one value (a count, world mm, user degrees). */
export function patternSlotValue(c, slot) {
  const s = patternSlot(c, slot);
  if (!s) return NaN;
  const v = c[s.field];
  return s.k == null ? v : (Array.isArray(v) ? v[s.k] : NaN);
}
/** The record changes (#core/pattern.js editPattern's `changes`) that give the values `values` ({ slot: number }); array fields copied, never mutated. */
export function patternSlotChanges(c, values) {
  const out = {};
  for (const s of patternValueSlots(c)) {
    if (!Object.prototype.hasOwnProperty.call(values || {}, s.slot)) continue;
    if (s.k == null) { out[s.field] = values[s.slot]; continue; }
    if (!out[s.field]) out[s.field] = (Array.isArray(c[s.field]) ? c[s.field] : []).slice();
    out[s.field][s.k] = values[s.slot];
  }
  return out;
}
/** Split an editPattern `changes` object: the declared values it CHANGES ({ slot: number }) and the rest (every other field). */
export function patternValuesIn(c, changes) {
  const values = {}, rest = { ...(changes || {}) };
  for (const s of patternValueSlots(c)) {
    if (!Object.prototype.hasOwnProperty.call(rest, s.field)) continue;
    const v = s.k == null ? rest[s.field] : (Array.isArray(rest[s.field]) ? rest[s.field][s.k] : undefined);
    if (v !== undefined && v !== patternSlotValue(c, s.slot)) values[s.slot] = v;
  }
  for (const s of patternValueSlots(c)) delete rest[s.field];
  return { values, rest };
}
/** The stored form of a record's `names` / `expressions` object: only declared slots with a non-empty text, in the declared order. */
export function patternSlotTexts(type, map) {
  const out = {};
  for (const s of PATTERN_VALUES[type] || []) if (map && typeof map[s.slot] === 'string' && map[s.slot]) out[s.slot] = map[s.slot];
  return out;
}
