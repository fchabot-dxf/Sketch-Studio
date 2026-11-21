// tests/cursor-tooltip-finger-817c-node.test.js — TASK 817c: the touch tooltip (packages/ui/cursor-tooltip.js, a long press: 'finger') on a 390 px phone is centred over
// the finger and only kept on screen, never flipped sideways. Before: a box near the RIGHT edge was flipped wholly left of (finger - width/2): the OK button's tooltip
// (finger x 333, box 220 px) sat at 8..228, 105 px from the finger. Checked for a control at the right edge and at the left edge: the box is fully on screen (8 px
// edge), spans the finger's x, its left is the centred place clamped to the screen, and its nearest point is within 90 px of the finger (tests/helpers/tooltip-live.js
// tipProblems' phone limit); it ends above the finger (the vertical placement is unchanged).
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { installCursorTooltip } from '#ui/cursor-tooltip.js';

const VW = 390, VH = 844, W = 220, H = 30, EDGE = 8;
const win = new Window({ url: 'http://localhost/', width: VW, height: VH });
const doc = win.document;
doc.body.innerHTML = '<button id="t" data-hint="ok">OK</button>';
win.HTMLElement.prototype.getBoundingClientRect = function () { return this.classList && this.classList.contains('sk-cursor-tip') ? { left: 0, top: 0, width: W, height: H, right: W, bottom: H } : { left: 0, top: 0, width: 60, height: 44, right: 60, bottom: 44 }; };
const tip = installCursorTooltip({ doc, selector: '[data-hint]', resolve: () => 'Keeps the changes: one step of Undo.', longPressMs: 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ptr = (type, x, y) => doc.getElementById('t').dispatchEvent(new win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'touch', pointerId: 1 }));

let checks = 0;
for (const [where, x, y] of [['right edge (the OK button)', 333, 694], ['left edge', 20, 694], ['middle', 195, 400]]) {
  ptr('pointerdown', x, y);
  await sleep(50);
  const b = tip.box();
  assert.ok(b && !b.hidden, `${where}: the long press shows it`);
  const left = parseFloat(b.style.left), top = parseFloat(b.style.top), right = left + W, bottom = top + H;
  const dx = Math.max(left - x, 0, x - right), dy = Math.max(top - y, 0, y - bottom), centreDx = Math.abs(left + W / 2 - x);
  console.log(`${where}: finger ${x},${y} -> box ${left}..${right} x ${top}..${bottom} (nearest ${Math.round(Math.hypot(dx, dy))} px, centre ${centreDx} px sideways)`);
  assert.ok(left >= EDGE && right <= VW - EDGE && top >= EDGE && bottom <= VH - EDGE, `${where}: fully on screen`);
  assert.strictEqual(left, Math.round(Math.max(EDGE, Math.min(VW - W - EDGE, x - W / 2))), `${where}: centred over the finger, then kept on screen (no sideways flip)`);
  assert.ok(left <= x && x <= right, `${where}: the box spans the finger's x`);
  assert.ok(Math.hypot(dx, dy) <= 90, `${where}: within 90 px of the finger`);
  assert.ok(bottom <= y, `${where}: above the finger`);
  checks += 5;
  ptr('pointerup', x, y);
  ptr('pointerdown', 1, 1); ptr('pointerup', 1, 1); // the next tap hides it
}
tip.destroy();
await win.happyDOM.close();
console.log(`cursor-tooltip-finger-817c-node: ok (${checks} checks)`);
