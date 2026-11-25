// apps/shaper/src/stock-card.js — the Review card's STOCK THICKNESS field, DECLARED in one importable place (TASK 583). The page script (main.js) and the node test
// kit both call createStockCard(): the field shows the declared stock thickness in the document unit (TASK 459/460), re-syncs after a document restore (show()), and a
// typed value sets the stock (TASK 460: persisted in the Shaper sidecar). TASK 472: with a Stock loop in the cut plan the thickness is set on that loop in Prepare,
// so the field is disabled and the note says so. Moved out of main.js unchanged. TASK 880: the note is not laid out under the field any more: the card names the BOARD
// (boardOf) and the host shows it in the thickness label's tooltip (param-hints.js stockThickness).
import { getStock, setStockField, resolveStock } from './stock.js';
import { parse as parseUnit, unitNumber } from '#core/units.js';
import { docUnit, lengthText } from '#core/settings-manager.js';
import { attachStepper } from './number-stepper.js';

// TASK 730: the thickness field's − / + step (document unit; a size: any value above 0, never 0, as typing 0 is refused too)
const THICKNESS_STEPPER = { step: { mm: 1, in: 1 / 16 }, positive: true };

/** What the 3D board is: 'loop-set' (the Stock loop, its thickness set in Prepare), 'loop-unset' (the Stock loop, the default thickness) or 'bounds' (no Stock loop: the design bounds + margin).
 *  TASK 894: read from resolveStock's `board` (null before the controller exists: 'bounds'). */
export const boardOf = (board) => (board && board.kind === 'profile' ? (board.thicknessFrom === 'default' ? 'loop-unset' : 'loop-set') : 'bounds');

/** createStockCard({ input, getController, onChange, onBoard }) -> { show }. getController(): the Design sketch controller (null before it exists). onChange(): after a typed value.
 *  onBoard(board): at every show(), what the board is now (boardOf). */
export function createStockCard({ input: thick, getController, onChange = () => {}, onBoard = () => {} }) {
  let stepper = null; // set below; show() keeps its buttons' disabled state with the field's
  const show = () => {
    const designController = getController();
    const board = designController ? resolveStock(designController.state).board : null; // TASK 472: with a Stock loop the thickness is set on that loop in Prepare
    thick.value = lengthText(board ? board.thickness : getStock().thickness); // the one length-format decider (no unit beside this box: an inch fraction carries its mark)
    thick.disabled = !!board && (board.kind === 'profile' || board.thicknessFrom !== 'default'); // TASK 894: the field edits the declared record, so only while the board reads it (an EMPTY Stock with its own thickness: set in Prepare)
    onBoard(boardOf(board));
    if (stepper) stepper.refresh();
  };
  show();
  const apply = (v) => {
    if (v != null && v > 0 && Math.abs(v - getStock().thickness) > 1e-9) {
      const dc = getController();
      const st = dc && dc.state;
      if (st && typeof st.saveState === 'function') st.saveState('stock thickness', { host: true });
      setStockField('thickness', v);
    }
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
