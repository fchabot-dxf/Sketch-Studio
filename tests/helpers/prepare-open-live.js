// tests/helpers/prepare-open-live.js — TASK S2 (docs/OPERATIONS-MODEL.md 9.1, owner rulings turns 2716-2720): editing is deliberate in the real Shaper page. An operation
// is OPENED (the Operations list: its row tapped, then its Edit), edited and confirmed (the card's OK); a click on the canvas only selects. The live tests written before
// S2 clicked a shape to see and edit its settings; these helpers stand for the user's steps today, through the page's own buttons (real mouse / touch, t.clickEl):
//   okLive(t)               the card's OK, when an operation is open
//   openOpLive(t, opId)     its list row tapped (selected), then its Edit (on a phone the sheet is opened for it, then folded again so the card is free)
//   clickOpenLive(t, click) OK, the click (t.clickWorld ...), and when it picked exactly ONE shape that is already in an operation, that operation opened (its first in
//                           the list); a shape in no operation, several, or nothing: only selected (the quick flow's type menu)
//   stepLive(t, change)     a change made in the open operation, then OK and the operation opened again: its own undo step (as each card change was before S2)
import { sleep } from './cdp-browser.js';

const openId = (t) => t.evalJs(`(() => { const ok = document.querySelector('#prepare-panel .cut-actions'); return ok && !ok.hidden ? window.__prepareView.activeOp().id : null; })()`);

export async function okLive(t) {
  if (await openId(t)) { await t.clickEl('#prepare-panel .cut-ok'); await sleep(200); }
}

export async function openOpLive(t, opId) {
  const folded = t.phone && await t.evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`);
  if (folded) { await t.clickEl('#prepare-ops .ops-head'); await sleep(250); }
  await t.clickEl(`#prepare-ops .ops-row[data-id="${opId}"] .ops-pick`);
  await t.clickEl(`#prepare-ops .ops-row[data-id="${opId}"] .ops-edit`);
  await t.waitFor(`(() => { const a = document.querySelector('#prepare-panel .cut-actions'); return a && !a.hidden && window.__prepareView.activeOp() && window.__prepareView.activeOp().id === ${JSON.stringify(opId)}; })()`, `operation ${opId} open`);
  if (folded) { await t.clickEl('#prepare-ops .ops-head'); await sleep(250); }
}

export async function clickOpenLive(t, click) {
  await okLive(t);
  await click();
  await sleep(150);
  const opId = await t.evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => { const ts = window.__prepareView.selectedTargets(); if (ts.length !== 1) return null;
    const mm = m.membersOf(ts[0].kind + ':' + ts[0].id)[0]; return mm ? mm.op.id : null; })`);
  if (opId) await openOpLive(t, opId);
}

export async function stepLive(t, change) {
  const before = await openId(t), h = await t.evalJs(`window.__designController.state.history.length`);
  await change();
  await sleep(150);
  const now = await openId(t);
  if (now && (now !== before || await t.evalJs(`window.__designController.state.history.length`) > h)) { await okLive(t); await openOpLive(t, now); }
}
