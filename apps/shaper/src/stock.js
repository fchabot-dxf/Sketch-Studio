// apps/shaper/src/stock.js — TASK 459: the DECLARED STOCK (the board the design is cut from), Shaper app state.
// Declared once: the default record lives in #core/relief-model (DEFAULT_STOCK, base mm); this is the live copy the Review
// tab reads. Module-level like CUT_PLAN. NOT persisted yet (slice S0 puts it in the document's Shaper host sidecar).
import { DEFAULT_STOCK } from '#core/relief-model.js';

const STOCK = { ...DEFAULT_STOCK };

export const getStock = () => ({ ...STOCK });
export function setStockField(field, value) {
  if (!(field in DEFAULT_STOCK)) throw new Error('unknown stock field: ' + field);
  STOCK[field] = value;
  return getStock();
}
