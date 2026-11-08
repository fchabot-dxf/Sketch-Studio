// tests/dimension-label-doubleclick.test.js — TASK 487: a double click on a dimension label is two clicks on the SAME label.
// A click on anything else (a line, empty space) followed within the window by a click on a label must NOT open the edit input
// (it used to, because every non-label click shared the key `undefined`, which equalled the key of a label child element).
import assert from 'node:assert';
import { handleSelectionPointerDown } from '#ui/input-handlers/selection-tools.js';
import { TOOL_MODES } from '#core/constants.js';

const svg = {
  setPointerCapture() {},
  viewBox: { baseVal: { x: 0, y: 0, width: 100, height: 100 } },
  getScreenCTM() { return null; },
  createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return { x: 0, y: 0 }; } }; },
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
};
const c0 = { type: 'distance', joints: ['a', 'b'], value: 10, isDriven: true };
const c1 = { type: 'distance', joints: ['b', 'c'], value: 20, isDriven: true };
const mkState = () => ({ currentTool: TOOL_MODES.SELECT, constraints: [c0, c1], selectedConstraints: new Set(), selectedShapes: new Set(), selectedJoints: new Set(), joints: new Map(), shapes: [] });

// `child` = a text node inside the label group: it has NO constraintIdx of its own, only the label ancestor does
const label = (idx, child) => { const g = { dataset: { constraintIdx: String(idx) } }; return child ? { dataset: {}, closest: (s) => (s === '.dim-label' ? g : null) } : { dataset: g.dataset, closest: (s) => (s === '.dim-label' ? g : null) }; };
const geometry = { dataset: {}, closest: () => null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function press(state, target) {
  let opened = false;
  const e = { target, pointerId: 1, clientX: 5, clientY: 5, shiftKey: false, stopPropagation() { opened = true; }, preventDefault() {} };
  handleSelectionPointerDown(e, svg, state, null, null, null);
  return opened;
}

const reset = async () => { await sleep(600); }; // let any earlier click fall out of the double-click window

await reset();
{ const s = mkState(); await press(s, geometry); await sleep(100);
  assert.strictEqual(await press(s, label(0, true)), false, 'geometry then a label (child element) within 100 ms: no edit input'); }

await reset();
{ const s = mkState(); await press(s, geometry); await sleep(100);
  assert.strictEqual(await press(s, label(0, false)), false, 'geometry then a label within 100 ms: no edit input'); }

await reset();
{ const s = mkState(); await press(s, label(0, true)); await sleep(100);
  assert.strictEqual(await press(s, label(1, true)), false, 'two DIFFERENT labels: no edit input'); }

await reset();
{ const s = mkState(); await press(s, label(0, true)); await sleep(100);
  assert.strictEqual(await press(s, label(0, true)), true, 'the same label twice quickly: the edit path runs'); }

await reset();
{ const s = mkState(); await press(s, label(0, false)); await sleep(100);
  assert.strictEqual(await press(s, label(0, false)), true, 'the same label twice quickly (target carries the index): the edit path runs'); }

await reset();
{ const s = mkState(); await press(s, label(0, true)); await sleep(600);
  assert.strictEqual(await press(s, label(0, true)), false, 'the same label with a slow gap: single click, no edit'); }

console.log('dimension-label-doubleclick: ok');
