// tests/arc-preview-contract.test.js — TASK 470: a tool preview never emits NaN / undefined attributes.
// The arc preview used to carry its centre as a joint ID that the renderer resolved at draw time; when the joint was gone
// (tool reset, undo) the renderer fell back to the raw id string and drew `M NaN,NaN A ...` / `<circle cx="undefined">`.
// Contract now: a preview carries RESOLVED POINTS (the producer owns the resolution, preview-manager.js enforces the shape);
// an arc preview whose centre is not a finite point is not a preview at all (cleared).
import assert from 'node:assert';
import { updatePreview } from '../packages/ui/preview-manager.js';
import { draw } from '../packages/ui/svg-renderer.js';
import { handleArcPointerMove } from '../packages/ui/input-handlers/arc-tool.js';
import { TOOL_MODES } from '../packages/core/constants.js';

const makeSVG = () => ({
  viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
  getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
  innerHTML: '',
});
const render = (joints, active) => {
  const svg = makeSVG();
  draw(joints, [], svg, active, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  return svg.innerHTML;
};
const bad = (markup) => (markup.match(/[a-z0-9-]+="[^"]*(NaN|undefined)[^"]*"/gi) || []);

// 1. THE REPRO: the arc tool's preview names its centre by joint id, and that joint is gone at draw time.
{
  const state = { joints: new Map(), active: { mode: 'arc', phase: 'start', center: 'cGone' } };
  // exactly what arc-tool.js (before the fix) handed to the manager: center = the joint ID
  updatePreview(state, 'arc', [], { x: 30, y: 10 }, { subMode: 'arc-cse', center: 'cGone', radius: 30, startAngle: 0, endAngle: 1.2, largeArc: false, sweep: true });
  const markup = render(state.joints, state.active);
  const issues = bad(markup);
  assert.deepStrictEqual(issues, [], 'arc preview with an unresolvable centre emitted: ' + issues.slice(0, 3).join(' | '));
  assert(!state.active.preview, 'a preview whose centre is not a point is not a preview');
}

// 1b. the REAL producer (arc-tool.js) hands the preview a resolved point, so deleting the joint cannot break the next frame
{
  const joints = new Map([['c', { x: 50, y: 50 }], ['s', { x: 80, y: 50 }]]);
  const state = { joints, snapTarget: null, active: { mode: TOOL_MODES.ARC, phase: 'start', center: 'c', start: 's' } };
  assert(handleArcPointerMove({ clientX: 0, clientY: 0 }, null, state, { x: 50, y: 80 }), 'the arc tool handled the move');
  const pv = state.active.preview;
  assert(pv && pv.type === 'arc' && typeof pv.center === 'object' && pv.center.x === 50 && pv.center.y === 50, 'the real arc tool previews with a resolved centre point: ' + JSON.stringify(pv && pv.center));
  joints.delete('c');
  assert.deepStrictEqual(bad(render(joints, state.active)), [], 'no NaN/undefined after the centre joint is deleted');
}

// 2. the producer hands over a RESOLVED point: the preview is self-contained (the joint may vanish afterwards)
{
  const joints = new Map([['c', { x: 200, y: 200 }]]);
  const state = { joints, active: { mode: 'arc', phase: 'start', center: 'c' } };
  const c = joints.get('c');
  updatePreview(state, 'arc', [], { x: 230, y: 200 }, { subMode: 'arc-cse', center: { x: c.x, y: c.y }, radius: 30, startAngle: 0, endAngle: 1, largeArc: false, sweep: true });
  assert(state.active.preview && state.active.preview.type === 'arc', 'a point centre is a valid arc preview');
  joints.delete('c'); // undo / tool reset removes the joint before the next frame
  const markup = render(joints, state.active);
  assert.deepStrictEqual(bad(markup), [], 'no NaN/undefined once the joint is gone: ' + bad(markup).slice(0, 3));
  assert(/<circle[^>]+cx="200"[^>]*r="3"/.test(markup) && /d="M [\d.]+,[\d.]+ A 30,30 /.test(markup), 'the arc is still drawn from the stored point');
}

// 3. other invalid arc previews (non-finite radius / angle / cursor) are rejected too
for (const props of [{ center: { x: 0, y: 0 }, radius: NaN, startAngle: 0, endAngle: 1 }, { center: { x: 0, y: 0 }, radius: 5, startAngle: 'x', endAngle: 1 }, { center: { x: NaN, y: 0 }, radius: 5, startAngle: 0, endAngle: 1 }, { center: null, radius: 5, startAngle: 0, endAngle: 1 }, {}]) {
  const state = { joints: new Map(), active: { mode: 'arc' } };
  updatePreview(state, 'arc', [], { x: 1, y: 1 }, props);
  assert(!state.active.preview && !state.preview, 'rejected: ' + JSON.stringify(props));
}
{
  const state = { joints: new Map(), active: { mode: 'arc' } };
  updatePreview(state, 'arc', [], null, { center: { x: 0, y: 0 }, radius: 5, startAngle: 0, endAngle: 1 });
  assert(!state.active.preview, 'an arc preview needs a cursor point');
}

// 4. the other previews carry no ids the renderer must resolve (they hold points; their anchors are looked up with an
//    explicit "missing joint -> not drawn" rule): feed each one a MISSING joint and scan the markup
{
  const cases = [
    { mode: 'line', start: 'gone', preview: { type: 'line', pt: { x: 10, y: 10 } } },
    { mode: 'circle', start: 'gone', preview: { type: 'circle', pt: { x: 10, y: 10 } } },
    { mode: 'rect', start: 'gone', preview: { type: 'rect', pt: { x: 10, y: 10 } } },
    { mode: 'rect', start: 'gone', preview: { type: 'rect-center', pt: { x: 10, y: 10 } } },
    { mode: 'rect', start: 'gone', secondPt: 'gone2', preview: { type: 'rect-3pt', pt: { x: 10, y: 10 } } },
    { mode: 'polygon', start: 'gone', preview: { type: 'polygon', sides: 5, pt: { x: 10, y: 10 } } },
    { mode: 'arc', preview: { type: 'arc', p1: 'gone', pt: { x: 10, y: 10 } } },
    { mode: 'bezier', preview: { type: 'bezier', seg: { p0: { x: 0, y: 0 }, c1: { x: 1, y: 1 }, c2: { x: 2, y: 2 }, p3: { x: 3, y: 0 } }, handles: [], anchorDots: [{ x: 0, y: 0 }] } },
    // and with the anchor PRESENT, every preview still draws something finite
    { mode: 'line', start: 'a', preview: { type: 'line', pt: { x: 10, y: 10 } } },
    { mode: 'circle', start: 'a', preview: { type: 'circle', pt: { x: 10, y: 10 } } },
    { mode: 'rect', start: 'a', preview: { type: 'rect', pt: { x: 10, y: 10 } } },
    { mode: 'rect', start: 'a', preview: { type: 'rect-center', pt: { x: 10, y: 10 } } },
    { mode: 'rect', start: 'a', secondPt: 'b', preview: { type: 'rect-3pt', pt: { x: 10, y: 10 } } },
    { mode: 'polygon', start: 'a', preview: { type: 'polygon', sides: 5, pt: { x: 10, y: 10 } } },
  ];
  for (const active of cases) {
    const joints = new Map([['a', { x: 1, y: 1 }], ['b', { x: 5, y: 1 }]]);
    const markup = render(joints, active);
    assert.deepStrictEqual(bad(markup), [], active.preview.type + ' (' + (active.start || 'no anchor') + ') emitted ' + bad(markup).slice(0, 3));
  }
}
console.log('arc-preview-contract: ok');
