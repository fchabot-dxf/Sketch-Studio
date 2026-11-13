// tests/origin-sketch-id.test.js — TASK 558 finding F6: the origin joint of a page whose sketch was never restored from a document belongs to
// Sketch 1 from the start, so the first undo restores it EXACTLY (before: the engine's origin had no sketchId and the first undo restore
// stamped one, so undo was not byte-exact on j_origin). Its own process: the engine store is module-level, and this order (engine.init()
// BEFORE createSketchState, as packages/ui/sketch-canvas.js mountSketch does for Shaper / Pen Plotter / Trace) must meet an unwrapped store.
import assert from 'node:assert';
import { createEngine } from '../packages/core/constraint-solver.js';
import { createSketchState } from '../packages/ui/sketch-state.js';

const engine = createEngine(null);
engine.init();
const st = createSketchState(engine, { x: 0, y: 0, w: 100, h: 80 });
const before = JSON.stringify(st.joints.get('j_origin'));
assert.strictEqual(st.joints.get('j_origin').sketchId, 'sketch-1', 'the engine\'s own origin belongs to Sketch 1: ' + before);
st.saveState('line'); st.joints.set('j1', { x: 1, y: 2 });
st.undo();
assert.strictEqual(JSON.stringify(st.joints.get('j_origin')), before, 'undo restores the origin exactly');
console.log('origin-sketch-id: ok');
