// tests/cursor-tooltip-805-node.test.js — TASK 805: the tooltip at the cursor (packages/ui/cursor-tooltip.js): the placement near a point and on screen, the hover delay,
// the dismissals (leave, press, Esc, scroll, target gone), touch long-press (and its swallowed click), keyboard focus, and that the box is a fixed overlay
// that is never part of any layout (pointer-events none, position fixed) and never touches the elements it describes (no attribute but aria-describedby on focus).
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { placeTooltip, installCursorTooltip } from '#ui/cursor-tooltip.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

// ── placement (pure) ──
const V = { vw: 1000, vh: 700, width: 200, height: 60 };
eq(placeTooltip({ ...V, x: 100, y: 100 }), { left: 114, top: 120 }, 'near the pointer: right of it and below it, never under it');
eq(placeTooltip({ ...V, x: 900, y: 100 }), { left: 900 - 14 - 200, top: 120 }, 'no room on the right: left of the pointer');
eq(placeTooltip({ ...V, x: 100, y: 680 }), { left: 114, top: 680 - 20 - 60 }, 'no room below: above the pointer');
const corner = placeTooltip({ ...V, x: 995, y: 695 });
ok(corner.left >= 8 && corner.top >= 8 && corner.left + 200 <= 992 && corner.top + 60 <= 692, 'a corner: inside the viewport with an 8 px edge');
eq(placeTooltip({ vw: 150, vh: 50, width: 200, height: 60, x: 10, y: 10 }), { left: 8, top: 8 }, 'a box larger than the viewport: pinned at the edge, never off the left / top');
for (const [x, y] of [[0, 0], [500, 350], [1000, 700], [999, 1], [1, 699]]) {
  const p = placeTooltip({ ...V, x, y });
  ok(p.left >= 8 && p.top >= 8 && p.left + 200 <= 992 && p.top + 60 <= 692, `on screen for the point ${x},${y}`);
  ok(!(p.left <= x && x <= p.left + 200 && p.top <= y && y <= p.top + 60), `never under the pointer ${x},${y}`);
}

// ── the component ──
const win = new Window({ url: 'http://localhost/', width: 1000, height: 700 });
const doc = win.document;
doc.body.innerHTML = `<div id="a" data-hint="one">A</div><div id="b" data-hint="two"><span id="bi">in</span></div><div id="c">none</div><div id="n" data-hint="empty">E</div>
<button id="btn" data-hint="focusable">F</button>`;
win.HTMLElement.prototype.getBoundingClientRect = function () { return this.classList && this.classList.contains('sk-cursor-tip') ? { left: 0, top: 0, width: 160, height: 40, right: 160, bottom: 40 } : { left: 100, top: 300, width: 60, height: 20, right: 160, bottom: 320 }; };
const texts = { one: 'First hint.', two: 'Second hint.', focusable: 'Focus hint.', empty: '' };
const tip = installCursorTooltip({ doc, selector: '[data-hint]', resolve: (el) => texts[el.dataset.hint], hoverDelayMs: 30, longPressMs: 40 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ptr = (type, target, x, y, pointerType = 'mouse') => target.dispatchEvent(new win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType, pointerId: 1 }));
const $ = (id) => doc.getElementById(id);
const boxText = () => (tip.box() && !tip.box().hidden ? tip.box().textContent : null);

ptr('pointermove', $('a'), 200, 200);
eq(boxText(), null, 'hover: nothing before the delay');
await sleep(10);
eq(boxText(), null, 'hover: still nothing at a third of the delay');
await sleep(60);
eq(boxText(), 'First hint.', 'hover: the text shows after the delay');
const b = tip.box();
eq([b.style.left, b.style.top], ['214px', '220px'], 'hover: at the pointer, offset (right and below)');
eq(b.getAttribute('role'), 'tooltip', 'role tooltip');
eq(b.parentNode, doc.body, 'the box lives in <body>');
ptr('pointermove', $('a'), 230, 210);
eq([b.style.left, b.style.top], ['214px', '220px'], 'a shown tooltip follows nothing: it stays where it was shown');
ptr('pointermove', $('c'), 230, 210);
eq(boxText(), null, 'leaving the target hides it');
ptr('pointermove', $('bi'), 300, 100);
await sleep(60);
eq(boxText(), 'Second hint.', 'a child of the target: the target\'s tooltip (closest)');
ptr('pointerdown', $('bi'), 300, 100);
eq(boxText(), null, 'a press hides it');
ptr('pointermove', $('bi'), 301, 100);
await sleep(60);
eq(boxText(), null, 'it does not come back on the same target after a press');
ptr('pointermove', $('a'), 10, 10);
await sleep(60);
eq(boxText(), 'First hint.', 'another target: it shows again');
doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
eq(boxText(), null, 'Esc hides it');
ptr('pointermove', $('b'), 5, 5);
await sleep(60);
ok(boxText(), 'shown again');
doc.dispatchEvent(new win.Event('scroll'));
eq(boxText(), null, 'a scroll hides it');
ptr('pointermove', $('c'), 5, 5);
ptr('pointermove', $('a'), 5, 5);
await sleep(10);
ptr('pointermove', $('c'), 5, 5);
await sleep(60);
eq(boxText(), null, 'leaving before the delay: never shown');
ptr('pointermove', $('n'), 5, 5);
await sleep(60);
eq(boxText(), null, 'a target with no text: no tooltip');
ptr('pointermove', $('c'), 5, 5);
ptr('pointermove', $('a'), 5, 5);
await sleep(60);
ok(boxText(), 'shown on a');
$('a').remove();
ptr('pointermove', $('c'), 5, 5);
eq(boxText(), null, 'a target removed (a menu rebuilt) while shown: gone on the next move');
eq($('b').getAttributeNames().sort(), ['data-hint', 'id'], 'hover adds no attribute to the element');

// touch
doc.body.insertAdjacentHTML('beforeend', '<div id="t" data-hint="one">T</div>');
ptr('pointerdown', $('t'), 150, 400, 'touch');
await sleep(10);
eq(boxText(), null, 'touch: nothing before the long press');
await sleep(60);
eq(boxText(), 'First hint.', 'touch: the long press shows it');
ok(parseFloat(tip.box().style.top) + 40 <= 400, 'touch: above the finger');
ptr('pointerup', $('t'), 150, 400, 'touch');
eq(boxText(), 'First hint.', 'touch: stays after the finger lifts (until the next tap)');
let clicked = 0;
$('t').addEventListener('click', () => { clicked++; });
$('t').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
eq(clicked, 0, 'the click that ends a long press is swallowed (a long press on a menu row must not pick it)');
$('t').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
eq(clicked, 1, 'the next click goes through');
ptr('pointerdown', $('c'), 10, 10, 'touch');
eq(boxText(), null, 'touch: the next tap hides it');
ptr('pointerup', $('c'), 10, 10, 'touch');
ptr('pointerdown', $('t'), 150, 400, 'touch');
await sleep(10);
ptr('pointerup', $('t'), 150, 400, 'touch');
await sleep(60);
eq(boxText(), null, 'touch: a short tap never shows it');
ptr('pointerdown', $('t'), 150, 400, 'touch');
await sleep(10);
ptr('pointermove', $('t'), 150, 440, 'touch');
await sleep(60);
eq(boxText(), null, 'touch: a finger that moves (a scroll) cancels the long press');
ptr('pointerup', $('t'), 150, 440, 'touch');

// keyboard
$('btn').focus();
eq(boxText(), null, 'focus without a key press (a click): no tooltip');
$('btn').blur();
doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
$('btn').focus();
eq(boxText(), 'Focus hint.', 'keyboard focus shows it');
eq($('btn').getAttribute('aria-describedby'), tip.box().id, 'the focused control is described by the box');
ok(parseFloat(tip.box().style.top) >= 320, 'beside the control: below it');
$('btn').blur();
eq([boxText(), $('btn').hasAttribute('aria-describedby')], [null, false], 'blur hides it and removes aria-describedby');

// overlay: fixed, no pointer events, never in a layout flow
const css = doc.getElementById('sk-cursor-tooltip-styles').textContent;
ok(/\.sk-cursor-tip \{[^}]*position: fixed/.test(css) && /pointer-events: none/.test(css), 'the box is position: fixed with pointer-events: none');
tip.destroy();
ok(!doc.getElementById('sk-cursor-tip'), 'destroy removes the box');
await win.happyDOM.close();
console.log(`cursor-tooltip-805-node: ok (${checks} checks)`);
