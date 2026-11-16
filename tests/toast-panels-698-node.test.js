// tests/toast-panels-698-node.test.js — TASK 698: the ONE rule. A floating window declares itself a toast obstacle with `data-toast-obstacle`
// (set by the shared dock code for every pop-up / closable window); the notification manager reads only that marker: the stack stays centred when
// nothing is under it, moves BESIDE the window when a free column holds it, else sits ABOVE the window (the window's top edge is the floor).
import assert from 'node:assert';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://127.0.0.1/', width: 1280, height: 800 });
for (const k of ['document', 'window', 'HTMLElement', 'Node', 'navigator', 'localStorage', 'requestAnimationFrame', 'KeyboardEvent', 'MouseEvent', 'Event']) {
  try { Object.defineProperty(globalThis, k, { value: win[k], configurable: true, writable: true }); } catch (_) { /* node's own */ }
}
globalThis.window = win; globalThis.document = win.document;
win.innerWidth = 1280; win.innerHeight = 800;

const { createTabbedDockPanel } = await import('#ui/tabbed-dock-panel.js');
const { setupNotifications, layoutNotifications } = await import('#ui/notification-manager.js');

// 1. the marker: set by the shared dock code on a pop-up (closable) window only
const popup = createTabbedDockPanel({ tabs: [{ label: 'x', render: () => {} }], open: false, closable: true, title: 'Pop' });
const plain = createTabbedDockPanel({ tabs: [{ label: 'x', render: () => {} }], persistKey: 'plain' });
assert.ok(popup.el.hasAttribute('data-toast-obstacle'), 'a closable pop-up dock window carries data-toast-obstacle');
assert.ok(!plain.el.hasAttribute('data-toast-obstacle'), 'a plain (non-pop-up) dock does not');

// 2. placement
setupNotifications();
const c = document.getElementById('notification-container');
Object.defineProperty(c, 'offsetWidth', { value: 420, configurable: true });
Object.defineProperty(c, 'offsetHeight', { value: 200, configurable: true });
for (let i = 0; i < 1; i++) c.appendChild(document.createElement('div')); // one child: nothing is ever trimmed
const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });
const win1 = document.createElement('div');
win1.setAttribute('data-toast-obstacle', '');
document.body.appendChild(win1);
const place = (r) => { win1.getBoundingClientRect = () => r; layoutNotifications(); return { left: c.style.left, bottom: c.style.bottom }; };

assert.deepStrictEqual(place(rect(0, 0, 0, 0)), { left: '50%', bottom: '20px' }, 'an empty / hidden window: the stack stays bottom centre');
assert.deepStrictEqual(place(rect(100, 100, 300, 300)), { left: '50%', bottom: '20px' }, 'a window the stack does not touch: unchanged');
// a window across the centre with a free column on the right (x 700..1272): beside it
const beside = place(rect(300, 500, 690, 780));
assert.strictEqual(beside.bottom, '20px', 'beside: the floor is unchanged');
assert.strictEqual(beside.left, '908px', 'beside: centred in the free column right of the window (690 + 8 + 210)');
// a window as wide as the screen under the stack: above it (floor = window top - 8 -> bottom = 800 - 492)
assert.deepStrictEqual(place(rect(0, 500, 1280, 780)), { left: '50%', bottom: '308px' }, 'no free column: the stack sits above the window');
// a window taller than the room above it, with only a 284 px column on its left: the stack reflows into that column
Object.defineProperty(c, 'offsetHeight', { value: 200, configurable: true });
win1.getBoundingClientRect = () => rect(300, 60, 1280, 780);
layoutNotifications();
assert.deepStrictEqual([c.style.left, c.style.maxWidth, c.style.visibility], ['150px', '284px', ''], 'no wide column, no room above: beside, narrowed to the 284 px column');
// a window over the whole screen: no clear spot, the stack is hidden
win1.getBoundingClientRect = () => rect(0, 0, 1280, 800);
layoutNotifications();
assert.strictEqual(c.style.visibility, 'hidden', 'no clear spot at all: the stack is hidden, never over the window');
// the window leaves: back to the default
win1.style.display = 'none';
assert.deepStrictEqual(place(rect(0, 500, 1280, 780)), { left: '50%', bottom: '20px' }, 'a hidden window is no obstacle');
console.log('toast-panels-698-node: ALL CHECKS PASSED');
process.exit(0);
