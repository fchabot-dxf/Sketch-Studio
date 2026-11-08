// apps/shaper/src/stock.js — TASK 459: the DECLARED STOCK (the board the design is cut from), Shaper app state.
// Declared once: the default record lives in #core/relief-model (DEFAULT_STOCK, base mm); this is the live copy the Review
// tab reads. Module-level like CUT_PLAN. TASK 460: persisted in the document's Shaper host sidecar (shaper-doc.js).
import { DEFAULT_STOCK } from '#core/relief-model.js';

const STOCK = { ...DEFAULT_STOCK };

export const getStock = () => ({ ...STOCK });
export function setStockField(field, value) {
  if (!(field in DEFAULT_STOCK)) throw new Error('unknown stock field: ' + field);
  STOCK[field] = value;
  return getStock();
}

/** TASK 460: replace the whole stock from a persisted object: defaults first, then only the known fields that are present. */
export function setStock(next) {
  for (const k of Object.keys(DEFAULT_STOCK)) STOCK[k] = DEFAULT_STOCK[k];
  for (const k of Object.keys(DEFAULT_STOCK)) if (next && next[k] !== undefined) STOCK[k] = next[k];
  return getStock();
}
