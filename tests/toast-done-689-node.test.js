// tests/toast-done-689-node.test.js — TASK 689 (node + happy-dom):
// createDoneButton treats visible toasts (#notification-container [data-level]) as obstacles via placeDone,
// for both anchored tools (Line, Fillet, Offset, Slot, Pattern) and un-anchored bottom-right tools (Mirror).
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { createDoneButton } from '../packages/ui/done-button.js';

const win = new Window({ url: 'http://127.0.0.1/' });
for (const k of ['document', 'window', 'HTMLElement', 'Element']) {
  globalThis[k] = win[k];
}
let rafCb = null;
globalThis.requestAnimationFrame = (fn) => { rafCb = fn; return 1; };
globalThis.cancelAnimationFrame = () => { rafCb = null; };
const tick = () => { const fn = rafCb; rafCb = null; if (fn) fn(); };
win.innerWidth = 390;
win.innerHeight = 844;
const rOf = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h });
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

const svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.getBoundingClientRect = () => rOf(0, 120, 390, 680); // 390x800 phone canvas [0..390, 120..800]
win.document.body.appendChild(svg);

const nc = win.document.createElement('div');
nc.id = 'notification-container';
win.document.body.appendChild(nc);
const addToast = (rect) => {
  const el = win.document.createElement('div');
  el.setAttribute('data-level', 'info');
  el.textContent = 'Fillet applied (R 5.0)';
  el.getClientRects = () => [rect];
  el.getBoundingClientRect = () => rect;
  nc.appendChild(el);
  return el;
};

// 1. Anchored tool (Fillet / Line / Offset): toast covering below-right moves .sk-done clear of toast
const t1 = addToast(rOf(95, 728, 200, 43));
const t2 = addToast(rOf(95, 781, 200, 43));
let mode = 'anchored';
const done = createDoneButton({
  svg,
  isChainOpen: () => true,
  onDone: () => {},
  anchor: () => (mode === 'anchored' ? { x: 150, y: 740 } : null),
});
done.sync(true); // touch size = 52 px
const btn = win.document.querySelector('.sk-done');
assert(btn && !btn.hidden, '.sk-done shown');
const br = rOf(parseFloat(btn.style.left), parseFloat(btn.style.top), 52, 52);
assert.strictEqual(overlap(br, t1.getBoundingClientRect()), 0, `anchored .sk-done avoids toast 1 (${JSON.stringify(br)})`);
assert.strictEqual(overlap(br, t2.getBoundingClientRect()), 0, `anchored .sk-done avoids toast 2 (${JSON.stringify(br)})`);
assert.ok(Math.hypot(br.left + 26 - 150, br.top + 26 - 740) >= 44, 'MIN_GAP >= 44 preserved');

// 2. Un-anchored tool (Mirror, anchor=null): wide toast over bottom-right moves .sk-done clear instead of leaving it covered
mode = 'mirror';
const wide = addToast(rOf(15, 732, 360, 56));
tick();
const mr = rOf(parseFloat(btn.style.left), parseFloat(btn.style.top), 52, 52);
assert.ok(Number.isFinite(mr.left) && Number.isFinite(mr.top), 'mirror moves via left/top when corner blocked');
assert.strictEqual(overlap(mr, wide.getBoundingClientRect()), 0, `mirror .sk-done avoids wide toast (${JSON.stringify(mr)})`);

// 3. Clearing toasts returns Mirror to bottom-right CSS positioning (right/bottom 16px)
nc.innerHTML = '';
tick();
assert.strictEqual(btn.style.right, '16px', 'mirror returns to bottom-right when clear');
assert.strictEqual(btn.style.bottom, '60px', 'mirror bottom offset respects window.innerHeight - canvas.bottom + 16');

done.destroy();
console.log('toast-done-689-node: ok');
