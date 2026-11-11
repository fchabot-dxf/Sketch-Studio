// tests/fit-to-drawing.test.js — TASK 494: fitToDrawing (#ui/input-handlers/pan-zoom.js) with a stub svg / ResizeObserver.
import assert from 'node:assert';
import { fitToDrawing, FIT_MIN_WIDTH } from '#ui/input-handlers/pan-zoom.js';

let observers = [];
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; this.live = true; observers.push(this); } observe() {} disconnect() { this.live = false; } };
const svg = (w, h) => { const el = { w, h, attrs: {}, getBoundingClientRect() { return { width: this.w, height: this.h, left: 0, top: 0 }; }, setAttribute(k, v) { this.attrs[k] = v; } }; return el; };
const sketch = (...pts) => ({ view: { x: 0, y: 0, w: 120, h: 90 }, joints: new Map(pts.map(([id, x, y]) => [id, { x, y }])), shapes: [{ id: 'S', type: 'line', joints: [pts[0][0], pts[pts.length - 1][0]] }] });
const fire = () => observers.filter((o) => o.live).forEach((o) => o.cb());

// sized canvas: centred on the box, 10% margin each side (width limited: 100 wide box on a 2:1 canvas => view w 120)
let el = svg(800, 400), st = sketch(['a', 1000, 500], ['b', 1100, 520]);
assert.strictEqual(fitToDrawing(el, st), true);
assert.strictEqual(st.view.x, 1050); assert.strictEqual(st.view.y, 510);
assert(Math.abs(st.view.w - 120) < 1e-9 && Math.abs(st.view.h - 60) < 1e-9, 'fits the 100-wide box with 10% margin per side: ' + JSON.stringify(st.view));

// a tiny drawing is not blown up past FIT_MIN_WIDTH
st = sketch(['a', 5, 5], ['b', 5.5, 5]);
fitToDrawing(el, st);
assert.strictEqual(st.view.w, FIT_MIN_WIDTH);

// an empty drawing leaves the view alone
st = { view: { x: 7, y: 8, w: 120, h: 90 }, joints: new Map([['j_origin', { x: 0, y: 0 }]]), shapes: [] };
assert.strictEqual(fitToDrawing(el, st), false);
assert.deepStrictEqual(st.view, { x: 7, y: 8, w: 120, h: 90 });

// a hidden (zero-size) canvas is fitted at its first real size
observers = [];
el = svg(0, 0); st = sketch(['a', 1000, 500], ['b', 1100, 520]);
assert.strictEqual(fitToDrawing(el, st), false);
assert.strictEqual(st.view.x, 0, 'not fitted while the canvas has no size');
fire(); assert.strictEqual(st.view.x, 0, 'still no size: still not fitted');
el.w = 800; el.h = 400; fire();
assert.strictEqual(st.view.x, 1050, 'fitted once the canvas got a size');
assert.strictEqual(observers.filter((o) => o.live).length, 0, 'the observer is released after the fit');

// the user moved the view before the canvas got a size: no fit
observers = [];
el = svg(0, 0); st = sketch(['a', 1000, 500], ['b', 1100, 520]);
fitToDrawing(el, st); st.view.w = 60; el.w = 800; el.h = 400; fire();
assert.strictEqual(st.view.x, 0, 'a view the user changed is not re-fitted');

// a newer call for the same canvas replaces the armed fit
observers = [];
el = svg(0, 0); st = sketch(['a', 1000, 500], ['b', 1100, 520]);
fitToDrawing(el, st);
const st2 = sketch(['a', -50, -50], ['b', -40, -48]); st2.view = st.view;
fitToDrawing(el, st2);
assert.strictEqual(observers.filter((o) => o.live).length, 1, 'one armed fit per canvas');
el.w = 800; el.h = 400; fire();
assert.strictEqual(st.view.x, -45, 'the newest drawing is the one that is framed');

// geometry of a hidden sketch is not framed
observers = [];
el = svg(800, 400);
st = sketch(['a', 1000, 500], ['b', 1100, 520]);
st.sketches = [{ id: 'sketch-1', visible: false }]; st.shapes[0].sketchId = 'sketch-1'; st.joints.get('a').sketchId = 'sketch-1'; st.joints.get('b').sketchId = 'sketch-1';
assert.strictEqual(fitToDrawing(el, st), false);
console.log('fit-to-drawing test passed');
