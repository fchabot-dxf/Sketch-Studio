// tests/notice-levels-node.test.js - TASK 612: a notice carries an explicit level and the toast paints that level: the default level is 'info'; a real
// error still paints red. TASK 878 (owner: a notice only when something is wrong): the shared Style panel's "Save as preset..." / delete / reset
// say NOTHING (they showed a success toast; the panel itself shows the result) and the panel has no toast hook any more. The real createStylePanel
// + the real showNotification in a happy-dom page, driven by clicks. The toast's level is its data-level; its colour is the level's declared background.
import assert from 'node:assert';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://127.0.0.1/' });
for (const k of ['document', 'window', 'HTMLElement', 'Node', 'navigator', 'localStorage', 'requestAnimationFrame', 'KeyboardEvent', 'MouseEvent', 'Event']) {
  try { Object.defineProperty(globalThis, k, { value: win[k], configurable: true, writable: true }); } catch (_) { /* node's own */ }
}
globalThis.window = win; globalThis.document = win.document;

const { createStylePanel } = await import('#ui/style-panel.js');
const { showNotification } = await import('#ui/notification-manager.js');

const toasts = () => [...document.querySelectorAll('#notification-container > div')];
const clearToasts = () => toasts().forEach((t) => t.remove());
const read = (t) => ({ level: t.getAttribute('data-level'), bg: t.style.backgroundColor || (/background-color:\s*([^;]+)/.exec(t.getAttribute('style')) || [])[1], icon: t.querySelector('span').textContent, text: t.querySelector('pre').textContent });
const GREEN = '#22c55e', BLUE = '#3b82f6', RED = '#ef4444';
const same = (a, b) => String(a).replace(/\s/g, '').toLowerCase() === b || String(a).replace(/\s/g, '') === 'rgb(' + [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)).join(',') + ')';

const panel = createStylePanel({ hostId: 'notice-test' });
panel.render(document.body); panel.open();
const P = document.querySelector('.sk-style-panel');
const click = (el) => { assert(el, 'element missing'); el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
win.addEventListener('error', (e) => console.log('PAGE ERROR', e.message));
const settle = () => new Promise((r) => setTimeout(r, 10));
const presetNames = () => [...P.querySelectorAll('option')].map((o) => o.textContent);

// 1. TASK 878: Save as preset -> the preset is in the list, and no toast
click(P.querySelector('[data-action="save-preset"]'));
const inp = P.querySelector('.sk-style-ask-input'); inp.value = 'Fusion2';
click(P.querySelector('.sk-style-ask .ok')); await settle();
assert(presetNames().includes('Fusion2'), 'the saved preset is listed: ' + presetNames());
assert.strictEqual(toasts().length, 0, 'TASK 878: Save as preset says nothing');

// 2. TASK 878: Delete (confirm) and Reset -> no toast either
click(P.querySelector('[data-action="delete-preset"]')); click(P.querySelector('.sk-style-ask .ok')); await settle();
assert(!presetNames().includes('Fusion2'), 'the deleted preset is gone from the list');
assert.strictEqual(toasts().length, 0, 'TASK 878: Delete preset says nothing');
click([...P.querySelectorAll('button')].find((b) => /^reset$/i.test(b.textContent))); await settle();
assert.strictEqual(toasts().length, 0, 'TASK 878: Reset says nothing');

let r;
// 3. no level given -> info (blue), never error
clearToasts(); showNotification('plain');
r = read(toasts()[0]); assert.strictEqual(r.level, 'info'); assert(same(r.bg, BLUE), 'blue: ' + r.bg); assert.strictEqual(r.icon, 'ℹ️');

// 4. a deliberate error is still red, with the warning sign and its Copy button
clearToasts(); showNotification('boom', 'error');
r = read(toasts()[0]); assert.strictEqual(r.level, 'error'); assert(same(r.bg, RED), 'red: ' + r.bg); assert.strictEqual(r.icon, '⚠️');
assert(toasts()[0].querySelector('.notif-copy-btn'), 'the error toast keeps its Copy button');

// 4b. TASK 616: Copy is for diagnostics, so only an error toast has it (success / info / warning: none)
for (const lvl of ['success', 'info', 'warning']) { clearToasts(); showNotification('x', lvl); assert(!toasts()[0].querySelector('.notif-copy-btn'), lvl + ' toast has no Copy button'); }
clearToasts(); showNotification('plain'); assert(!toasts()[0].querySelector('.notif-copy-btn'), 'a level-less toast (info) has no Copy button');

console.log('notice-levels-node: ok');
process.exit(0);
