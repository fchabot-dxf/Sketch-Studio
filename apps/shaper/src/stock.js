// apps/shaper/src/stock.js — TASK 459: the DECLARED STOCK (the board the design is cut from), Shaper app state.
// Declared once: the default record lives in #core/relief-model (DEFAULT_STOCK, base mm); this is the live copy the Review
// tab reads. Module-level like the operations store. TASK 460: persisted in the document's Shaper host sidecar (shaper-doc.js).
import { DEFAULT_STOCK } from '#core/relief-model.js';
import { planStockProfile } from './cut-plan.js';

const STOCK = { ...DEFAULT_STOCK };

export const getStock = () => ({ ...STOCK });
export function setStockField(field, value) {
  if (!(field in DEFAULT_STOCK)) throw new Error('unknown stock field: ' + field);
  STOCK[field] = value;
  return getStock();
}

// TASK 879: the fields NO control sets: always the declaration's. A stored one (the margin: every save wrote the default of its day, 1/2 in) is
// never the user's, so a restore does not read it (the owner's 6 in margin, DEFAULT_STOCK, applies to every design, old saves included).
const DECLARED_ONLY = Object.freeze(['margin']);

/** TASK 460: replace the whole stock from a persisted object: defaults first, then only the known fields that are present (TASK 879: not the DECLARED_ONLY ones). */
export function setStock(next) {
  for (const k of Object.keys(DEFAULT_STOCK)) STOCK[k] = DEFAULT_STOCK[k];
  for (const k of Object.keys(DEFAULT_STOCK)) if (next && next[k] !== undefined && !DECLARED_ONLY.includes(k)) STOCK[k] = next[k];
  return getStock();
}

/**
 * TASK 472: the stock the Review builds from. ONE declaration with two forms: the declared record above (a derived / explicit
 * rectangle + thickness: the fallback) or, when the cut plan holds a STOCK loop, that loop's profile (any shape, holes allowed)
 * extruded to the thickness set on that loop (unset -> the declared thickness). Returns { stock, fromLoop } where `stock` is what
 * buildRelief takes (with `profile` for the loop form) and `fromLoop` = { key, thickness, thicknessSet } | null.
 */
export function resolveStock(state) {
  const base = getStock();
  const sp = planStockProfile(state);
  if (!sp) return { stock: base, fromLoop: null };
  const thickness = sp.thickness == null ? base.thickness : sp.thickness;
  return { stock: { ...base, thickness, profile: { outer: sp.outer, holes: sp.holes, sig: sp.sig } }, fromLoop: { key: sp.key, thickness, thicknessSet: sp.thickness != null } };
}
