// apps/shaper/src/stock-card.js — the Review card's STOCK THICKNESS field, DECLARED in one importable place (TASK 583). The page script (main.js) and the node test
// kit both call createStockCard(): the field shows the declared stock thickness in the document unit (TASK 459/460), re-syncs after a document restore (show()), and a
// typed value sets the stock (TASK 460: persisted in the Shaper sidecar). TASK 472: with a Stock loop in the cut plan the thickness is set on that loop in Prepare,
// so the field is disabled and the note says so. Moved out of main.js unchanged.
import { getStock, setStockField, resolveStock } from './stock.js';
import { CUT_PLAN } from './cut-plan.js';
import { parse as parseUnit, format as formatUnit, docUnit } from '#core/units.js';

/** createStockCard({ input, noteEl, getController, onChange }) -> { show }. getController(): the Design sketch controller (null before it exists). onChange(): after a typed value. */
export function createStockCard({ input: thick, noteEl: note, getController, onChange = () => {} }) {
  const show = () => {
    const designController = getController();
    const loop = designController ? resolveStock(designController.state, CUT_PLAN).fromLoop : null; // TASK 472: with a Stock loop the thickness is set on that loop in Prepare
    thick.value = formatUnit(loop ? loop.thickness : getStock().thickness, docUnit(), { decimals: 3 });
    thick.disabled = !!loop;
    note.textContent = loop ? (loop.thicknessSet ? 'The board is your Stock loop; set its thickness in Prepare.' : 'The board is your Stock loop; no thickness set on it, so the default applies. Set it in Prepare.') : 'No Stock loop: the board is the design bounds + margin.';
  };
  show();
  thick.addEventListener('change', () => {
    const v = parseUnit(thick.value, docUnit());
    if (v != null && v > 0) setStockField('thickness', v);
    show();
    onChange();
  });
  return { show };
}
