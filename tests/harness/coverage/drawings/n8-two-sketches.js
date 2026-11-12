// NEW DRAWING N8 -- TWO SKETCHES IN ONE DOCUMENT with constraints in each (and one link between them). Sketch 1: a 60 x 40 rectangle. Sketch 2: an
// isosceles triangle. The solver is ONE global system (it never reads sketchId); the sketch container must survive save / load / undo.
import { point, rect, polyline, origin } from '../../audit/lib.js';
import { addSketch, activateSketch, stampSketch } from '#core/sketch-model.js';

export const NAME = 'two-sketches';
export const TITLE = 'Two sketches, constraints in each, one link';

export const RECIPE = [
  { label: 'S1 rect corner c1 at the origin', type: 'coincident', joints: ['c1', origin] },
  { label: 'S1 rect width 60', type: 'distance', joints: ['c1', 'c3'], value: 60, dimMode: 'horizontal' },
  { label: 'S1 rect height 40 (right side; the pair c1-c3 is taken by the width: F1)', type: 'distance', joints: ['r2', 'c3'], value: 40, dimMode: 'vertical' },
  { label: 'S2 triangle base AB horizontal', type: 'horizontal', joints: ['A', 'B'] },
  { label: 'S2 triangle sides CA = BC', type: 'equal', shapes: ['lCA', 'lBC'] },
  { label: 'S2 base length 60', type: 'distance', joints: ['A', 'B'], value: 60, dimMode: 'horizontal' },
  { label: 'S2 apex 50 above the base (line-to-point)', type: 'distance', joints: ['A', 'C'], value: 50, dimMode: 'vertical' },
  { label: 'LINK: A is 100 right of the rect corner c1', type: 'distance', joints: ['c1', 'A'], value: 100, dimMode: 'horizontal' },
  { label: 'LINK: A is level with the rect corner c1', type: 'horizontal', joints: ['c1', 'A'] },
];

export function build(S) {
  const stampNew = (j0, s0) => {
    let i = 0;
    for (const [, j] of S.state.joints) { if (i++ >= j0) stampSketch(j, S.state); }
    S.state.shapes.slice(s0).forEach(s => stampSketch(s, S.state));
  };
  const names = {};
  let j0 = S.state.joints.size, s0 = S.state.shapes.length;
  const r = rect(S, 3, 2, 63, 42);
  names.c1 = r.c1; names.c3 = r.c3; names.top = r.top; names.r2 = S.state.shapes.find(s => s.id === r.right).joints[0];
  stampNew(j0, s0);
  const sk2 = addSketch(S.state, 'Triangle'); activateSketch(S.state, sk2.id);
  j0 = S.state.joints.size; s0 = S.state.shapes.length;
  const seg = polyline(S, [[103, 2], [163, 2], [133, 52]]);
  names.A = seg[0].a; names.B = seg[0].b; names.C = seg[1].b; names.lAB = seg[0].id; names.lBC = seg[1].id; names.lCA = seg[2].id;
  stampNew(j0, s0);
  names.sketch2 = sk2.id;
  return { names, probes: { redundant: { joints: ['c1', 'c3'] }, conflict: { joints: ['c1', 'c3'] }, delete: { type: 'distance', joints: ['c1', 'c3'] } } };
}
