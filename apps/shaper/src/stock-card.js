// apps/shaper/src/stock-card.js — the Review card's STOCK THICKNESS field, DECLARED in one importable place (TASK 583). The page script (main.js) and the node test
// kit both call createStockCard(): the field shows the declared stock thickness in the document unit (TASK 459/460), re-syncs after a document restore (show()), and a
// typed value sets the stock (TASK 460: persisted in the Shaper sidecar). TASK 472: with a Stock loop in the cut plan the thickness is set on that loop in Prepare,
// so the field is disabled and the note says so. Moved out of main.js unchanged.
import { getStock, setStockField, resolveStock } from './stock.js';
import { CUT_PLAN } from './cut-plan.js';
import { parse as parseUnit, unitNumber } from '#core/units.js';
import { docUnit, lengthText } from '#core/settings-manager.js';
import { attachStepper } from './number-stepper.js';

// TASK 730: the thickness field's − / + step (document unit; a size: any value above 0, never 0, as typing 0 is refused too)
const THICKNESS_STEPPER = { step: { mm: 1, in: 1 / 16 }, positive: true };

/** createStockCard({ input, noteEl, getController, onChange }) -> { show }. getController(): the Design sketch controller (null before it exists). onChange(): after a typed value. */
export function createStockCard({ input: thick, noteEl: note, getController, onChange = () => {} }) {
  let stepper = null; // set below; show() keeps its buttons' disabled state with the field's
  const show = () => {
    const designController = getController();
    const loop = designController ? resolveStock(designController.state, CUT_PLAN).fromLoop : null; // TASK 472: with a Stock loop the thickness is set on that loop in Prepare
    thick.value = lengthText(loop ? loop.thickness : getStock().thickness); // the one length-format decider (no unit beside this box: an inch fraction carries its mark)
    thick.disabled = !!loop;
    note.textContent = loop ? (loop.thicknessSet ? 'The board is your Stock loop; set its thickness in Prepare.' : 'The board is your Stock loop; no thickness set on it, so the default applies. Set it in Prepare.') : 'No Stock loop: the board is the design bounds + margin.';
    if (stepper) stepper.refresh();
  };
  show();
  const apply = (v) => {
    if (v != null && v > 0) setStockField('thickness', v);
    show();
    onChange();
  };
  thick.addEventListener('change', () => apply(parseUnit(thick.value, docUnit())));
  stepper = attachStepper(thick, THICKNESS_STEPPER, {
    unit: docUnit, toDoc: (mm) => unitNumber(mm, docUnit()),
    read: () => unitNumber(getStock().thickness, docUnit()),
    commit: (docNum) => apply(parseUnit(String(docNum), docUnit())), // -> base mm
  }, { label: 'thickness' });
  stepper.refresh();
  return { show };
}
