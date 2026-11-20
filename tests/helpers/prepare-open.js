// tests/helpers/prepare-open.js — TASK S2 (docs/OPERATIONS-MODEL.md 4.2-4.4, owner rulings turns 2716-2719): editing is deliberate. An operation is OPENED (the Operations
// list's Edit button), edited and confirmed (OK); a click on the canvas only selects. The node tests written before S2 clicked a shape to see and edit its settings,
// then clicked the next shape. clickOpen(app, click) stands for the user's steps of today, through the page's own calls (the buttons' calls, prepare-stage.js):
//   OK on the operation open now (the previous pick's), the click, and, when it picked exactly ONE shape that is already in an operation, that operation opened (its
//   first in the list: the row's Edit). A click on a shape in no operation, on several, or on nothing only selects (the quick flow's type menu).
import { membersOf } from '../../apps/shaper/src/operations-store.js';
import { keyOf } from '../../apps/shaper/src/cut-plan.js';

export function clickOpen(app, click) {
  app.prepare.ok();
  click();
  const pv = app.prepare.view(), ts = pv ? pv.selectedTargets() : [];
  if (ts.length !== 1) return;
  const m = membersOf(keyOf(ts[0].kind, ts[0].id))[0];
  if (m) app.prepare.edit(m.op.id);
}

/** editStep(app, change) — the node tests written before S2 made each card change its own undo step and kept the card open. This stands for the same steps today: when
 *  the change made one (it took its session's undo point, or a quick-flow pick created an operation, open), OK on that operation (one undo step) and the operation
 *  opened again (no undo point until its next change). A press that changes nothing (a tab, a menu opening) leaves the card as it is. */
export function editStep(app, change) {
  const id = app.prepare.openId(), h = app.state.history.length;
  change();
  const now = app.prepare.openId();
  if (now && (now !== id || app.state.history.length > h)) { app.prepare.ok(); app.prepare.edit(now); }
}
