// tests/done-press-701-node.test.js — TASK 701 (node + happy-dom): the green check (.sk-done) never covers the press in progress.
// placeDone({ press }): a slot that covers the press rect is never taken (as the anchor's MIN_GAP), in the free pass and the least-covered pass;
// press null / a press on the anchor itself = the same slot as before (below-right). createDoneButton.sync(touch, { x, y, start }): the press's
// down and up points; the button that APPEARS at the pointerup (a session the press opened) is placed off them at once (not a frame later).
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { placeDone, createDoneButton } from '../packages/ui/done-button.js';

const canvas = { left: 0, top: 0, right: 390, bottom: 800 };
const pt = (x, y) => ({ left: x, top: y, right: x, bottom: y });
const covers = ([x, y], size, p) => x <= p.right && p.left <= x + size && y <= p.bottom && p.top <= y + size;

for (const size of [40, 52]) {
  const a = { x: 200, y: 300 };
  // 1. no press, or the press on the anchor (a Line tap: the joint it made): below-right, unchanged
  assert.deepStrictEqual(placeDone({ anchor: a, size, bounds: canvas }), [a.x + 16, a.y + 16], `[${size}] no press: below-right`);
  assert.deepStrictEqual(placeDone({ anchor: a, size, bounds: canvas, press: pt(a.x, a.y) }), [a.x + 16, a.y + 16], `[${size}] a press on the anchor: below-right`);
  // 2. the 701 case: below-right under the bottom sheet, the label (the press) inside the above-right slot -> another slot, off the press
  const sheet = { left: 0, top: a.y + 46, right: 390, bottom: 800 };
  const label = pt(a.x + 34, a.y - 26);
  assert.deepStrictEqual(placeDone({ anchor: a, size, bounds: canvas, obstacles: [sheet] }), [a.x + 16, a.y - 16 - size], `[${size}] without the press: above-right (the old slot, on the label)`);
  assert(covers([a.x + 16, a.y - 16 - size], size, label), `[${size}] the old slot covers the label`);
  const p = placeDone({ anchor: a, size, bounds: canvas, obstacles: [sheet], press: label });
  assert(!covers(p, size, label), `[${size}] with the press: off the label (${p})`);
  assert.deepStrictEqual(p, [a.x - 16 - size, a.y - 16 - size], `[${size}] with the press: above-left, the next slot`);
  // 3. a press that moved between down and up: the rect of both points is avoided
  const moved = { left: a.x + 20, top: a.y + 20, right: a.x + 30, bottom: a.y + 25 };
  assert(!covers(placeDone({ anchor: a, size, bounds: canvas, press: moved }), size, moved), `[${size}] the down..up rect is avoided`);
  // 4. every slot covered by an obstacle: the least-covered pass still never covers the press, and keeps MIN_GAP
  const all = [{ left: -10, top: -10, right: 400, bottom: 810 }];
  for (const [dx, dy] of [[34, -26], [40, 40], [-40, 40], [-40, -40], [90, 0]]) {
    const pr = pt(a.x + dx, a.y + dy);
    const q = placeDone({ anchor: a, size, bounds: canvas, obstacles: all, press: pr });
    assert(!covers(q, size, pr), `[${size}] all covered, press at (${dx}, ${dy}): off the press (${q})`);
    assert(Math.hypot(q[0] + size / 2 - a.x, q[1] + size / 2 - a.y) >= 44, `[${size}] all covered: MIN_GAP kept (${q})`);
  }
}

// 5. createDoneButton: hidden through the first tap, shown by the second tap's pointerup (the session that press opened), off that press
const win = new Window({ url: 'http://127.0.0.1/' });
for (const k of ['document', 'window', 'HTMLElement', 'Element']) globalThis[k] = win[k];
let raf = null;
globalThis.requestAnimationFrame = (fn) => { raf = fn; return 1; };
globalThis.cancelAnimationFrame = () => { raf = null; };
const svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 390, bottom: 800, width: 390, height: 800 });
win.document.body.appendChild(svg);
const sheetEl = win.document.createElement('div');
sheetEl.getClientRects = () => [1];
sheetEl.getBoundingClientRect = () => ({ left: 0, top: 459, right: 390, bottom: 800 });
let open = false;
const anchor = { x: 269, y: 399 }, lab = { x: 303, y: 373 };
const done = createDoneButton({ svg, isChainOpen: () => open, onDone: () => {}, anchor: () => anchor, avoid: () => [sheetEl.getBoundingClientRect()] });
const btn = win.document.querySelector('.sk-done');
const rect = () => [parseFloat(btn.style.left), parseFloat(btn.style.top)];
done.sync(true, { ...lab, start: true }); done.sync(true, { ...lab, start: false }); // tap 1: nothing open
assert.strictEqual(btn.hidden, true, 'hidden through the first tap');
done.sync(true, { ...lab, start: true }); open = true; // tap 2's pointerdown: the session opens in the handler (after the sync)
done.sync(true, { ...lab, start: false }); // tap 2's pointerup
assert.strictEqual(btn.hidden, false, 'shown at the second tap\'s pointerup');
assert(!covers(rect(), 52, pt(lab.x, lab.y)), `placed off the finger at once (${rect()})`);
// the next press elsewhere replaces the press: the button may come back to its first free slot
done.sync(true, { x: 20, y: 20, start: true });
assert.deepStrictEqual(rect(), [anchor.x + 16, anchor.y - 16 - 52], `a new press elsewhere: the above-right slot again (${rect()})`);
// sync with no point (older callers): the press is kept
done.sync(true);
assert.deepStrictEqual(rect(), [anchor.x + 16, anchor.y - 16 - 52], 'sync without a point keeps the press');
done.destroy();
console.log('done-press-701-node.test.js: ok');
