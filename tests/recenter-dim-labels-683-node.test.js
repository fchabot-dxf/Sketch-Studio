// tests/recenter-dim-labels-683-node.test.js — TASK 683B unit checks for fitViewToExtents / computeDimLabelBounds:
//   1. Linear, narrow linear, radius, angle, and pattern dimension labels are included in fitViewToExtents bounds with the same margin rule.
//   2. Both DIM_LABEL_BOX=false (default Fusion plain look) and DIM_LABEL_BOX=true frame labels cleanly inside the viewBox.
//   3. Constraints belonging to a hidden sketch do not expand the fit.
//   4. Template states (rounded-rectangle, box-frame) frame every dimension label box inside the viewBox on desktop and phone sizes.
import assert from 'node:assert';
import { fitViewToExtents, fitToDrawing } from '#ui/input-handlers/pan-zoom.js';
import { computeDimLabelBounds } from '#ui/svg-renderer.js';
import { deserializeDocument } from '#core/document.js';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#core/sketch-state.js';
import { templateById, buildTemplate } from '#core/templates.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import SettingsManager from '#core/settings-manager.js';

const mockSvg = (w, h) => ({
  attrs: {},
  getBoundingClientRect() { return { width: w, height: h, left: 0, top: 0, right: w, bottom: h }; },
  setAttribute(k, v) { this.attrs[k] = v; },
});
const viewRectOf = (v) => ({
  minX: v.x - v.w / 2, maxX: v.x + v.w / 2,
  minY: v.y - v.h / 2, maxY: v.y + v.h / 2,
});
const inside = (outer, inner, label) => {
  assert(
    inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY,
    `${label}: label bounds ${JSON.stringify(inner)} exceed fitted view ${JSON.stringify(outer)}`,
  );
};

// 1. Real templates (rounded-rectangle and box-frame) on both desktop and phone canvas sizes
for (const [id, params] of [['rounded-rectangle', {}], ['box-frame', {}]]) {
  const tpl = templateById(id);
  assert(tpl, `template ${id} exists`);
  const doc = buildTemplate(tpl, params);
  for (const [tag, W, H] of [['desktop', 1280, 603], ['phone', 390, 720]]) {
    const view = { x: 0, y: 0, w: 120, h: 90 };
    const engine = createEngine(null);
    engine.init();
    const st = createSketchState(engine, view);
    assert.strictEqual(deserializeDocument(doc, st).ok, true);
    fitViewToExtents(mockSvg(W, H), view, st);
    const lb = computeDimLabelBounds(st, view.w / W);
    assert(lb, `${id} ${tag}: has label bounds`);
    inside(viewRectOf(view), lb, `${id} ${tag} fitViewToExtents`);

    // fitToDrawing (without pre-rendered DOM labels) produces the same framing
    const view2 = { x: 0, y: 0, w: 120, h: 90 };
    const engine2 = createEngine(null);
    engine2.init();
    const st2 = createSketchState(engine2, view2);
    assert.strictEqual(deserializeDocument(doc, st2).ok, true);
    assert.strictEqual(fitToDrawing(mockSvg(W, H), st2), true);
    assert.deepStrictEqual(view2, view, `${id} ${tag}: fitToDrawing matches fitViewToExtents`);
  }
}

// 2. Same 10% margin rule applies cleanly to a single linear dimension far outside geometry, in both DIM_LABEL_BOX modes
const prevBox = SettingsManager.get('DIM_LABEL_BOX');
try {
  for (const boxMode of [false, true]) {
    SettingsManager.set('DIM_LABEL_BOX', boxMode, { persist: false });
    const st = {
      view: { x: 0, y: 0, w: 120, h: 90 },
      joints: new Map([
        ['a', { x: 0, y: 0 }],
        ['b', { x: 100, y: 0 }],
        ['c', { x: 0, y: -50 }],
      ]),
      shapes: [
        { id: 'L1', type: 'line', joints: ['a', 'b'] },
        { id: 'L2', type: 'line', joints: ['a', 'c'] },
      ],
      constraints: [
        { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a', 'b'], dimMode: 'horizontal', value: 100, offset: 40 },
        { type: CONSTRAINT_TYPES.ANGLE, shapes: ['L1', 'L2'], value: 90, offset: 50 },
        { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a', 'c'], dimMode: 'vertical', value: 50, offset: -40 },
      ],
    };
    const svg = mockSvg(800, 600);
    fitViewToExtents(svg, st.view, st);
    const lb = computeDimLabelBounds(st, st.view.w / 800);
    inside(viewRectOf(st.view), lb, `angle+linear boxMode=${boxMode}`);

    // Pattern label
    const stPat = {
      view: { x: 0, y: 0, w: 120, h: 90 },
      joints: new Map([['p0', { x: 0, y: 0 }], ['p1', { x: 20, y: 0 }]]),
      shapes: [{ id: 'S1', type: 'line', joints: ['p0', 'p1'] }],
      constraints: [
        { type: CONSTRAINT_TYPES.CIRCULAR_PATTERN, sources: { shapes: ['S1'] }, center: 'p0', quantity: 4, angle: 90 },
      ],
    };
    fitViewToExtents(svg, stPat.view, stPat);
    const lbPat = computeDimLabelBounds(stPat, stPat.view.w / 800);
    if (lbPat) inside(viewRectOf(stPat.view), lbPat, `pattern boxMode=${boxMode}`);
  }
} finally {
  SettingsManager.set('DIM_LABEL_BOX', prevBox, { persist: false });
}

// 3. Hidden sketch constraints are excluded from bounds
const hiddenSt = {
  view: { x: 0, y: 0, w: 120, h: 90 },
  joints: new Map([
    ['a', { x: 0, y: 0, sketchId: 'sketch-1' }],
    ['b', { x: 40, y: 0, sketchId: 'sketch-1' }],
    ['ha', { x: 500, y: 500, sketchId: 'sketch-2' }],
    ['hb', { x: 600, y: 500, sketchId: 'sketch-2' }],
  ]),
  shapes: [
    { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
    { id: 'L2', type: 'line', joints: ['ha', 'hb'], sketchId: 'sketch-2' },
  ],
  constraints: [
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['ha', 'hb'], dimMode: 'horizontal', value: 100, offset: 800 },
  ],
  sketches: [
    { id: 'sketch-1', name: 'Sketch 1', visible: true },
    { id: 'sketch-2', name: 'Sketch 2', visible: false },
  ],
};
fitViewToExtents(mockSvg(800, 400), hiddenSt.view, hiddenSt);
assert.strictEqual(hiddenSt.view.x, 20, 'hidden sketch constraint does not pull view center');
assert.strictEqual(hiddenSt.view.w, 48, 'hidden sketch constraint does not expand view width (40 * 1.2)');

console.log('recenter-dim-labels-683-node: ok');
