// tests/notice-levels-node.test.js - TASK 612: a notice carries an explicit level and the toast paints that level. The shared Style panel's
// "Save as preset..." / delete / reset say 'success' (they showed as red error toasts: the toast defaulted to 'error'); the default level
// is 'info'; a real error still paints red. The real createStylePanel + the real showNotification in a happy-dom page (the page's wiring is
// onNotify: showNotification), driven by clicks. The toast's level is its data-level; its colour is the level's declared background.
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

const panel = createStylePanel({ hostId: 'notice-test', onNotify: showNotification });
panel.render(document.body); panel.open();
const P = document.querySelector('.sk-style-panel');
const click = (el) => { assert(el, 'element missing'); el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); };
win.addEventListener('error', (e) => console.log('PAGE ERROR', e.message));
const settle = () => new Promise((r) => setTimeout(r, 10));

// 1. Save as preset -> a success toast: green, the check icon, no warning sign
click(P.querySelector('[data-action="save-preset"]'));
const inp = P.querySelector('.sk-style-ask-input'); inp.value = 'Fusion2';
click(P.querySelector('.sk-style-ask .ok')); await settle();
let t = toasts(); assert.strictEqual(t.length, 1, 'one toast');
let r = read(t[0]);
assert.strictEqual(r.text.trim(), 'Saved style preset "Fusion2".');
assert.strictEqual(r.level, 'success'); assert(same(r.bg, GREEN), 'green: ' + r.bg); assert.strictEqual(r.icon, '✅'); assert(!r.icon.includes('⚠'), 'no warning sign');

// 2. Delete (confirm) and Reset -> success too
clearToasts();
click(P.querySelector('[data-action="delete-preset"]')); click(P.querySelector('.sk-style-ask .ok')); await settle();
r = read(toasts()[0]); assert.strictEqual(r.text.trim(), 'Deleted style preset "Fusion2".'); assert.strictEqual(r.level, 'success');
clearToasts();
click([...P.querySelectorAll('button')].find((b) => /^reset$/i.test(b.textContent))); await settle();
r = read(toasts()[0]); assert.strictEqual(r.text.trim(), 'Reset to factory defaults.'); assert.strictEqual(r.level, 'success');

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

// 5. a throw from onNotify is not swallowed
const loud = createStylePanel({ hostId: 'notice-test-2', onNotify: () => { throw new Error('host notify broke'); } });
loud.render(document.body); loud.open();
const L = [...document.querySelectorAll('.sk-style-panel')].pop();
let thrown = null; const onErr = (e) => { thrown = e; };
win.addEventListener('error', onErr);
click(L.querySelector('[data-action="save-preset"]')); L.querySelector('.sk-style-ask-input').value = 'X';
await new Promise((res) => { process.once('uncaughtException', (e) => { thrown = e; res(); }); click(L.querySelector('.sk-style-ask .ok')); setTimeout(res, 100); });
assert(thrown && /host notify broke/.test(String(thrown.message || thrown)), 'the host hook\'s throw surfaces: ' + thrown);
console.log('notice-levels-node: ok');
process.exit(0);
