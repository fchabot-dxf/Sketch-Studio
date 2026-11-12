// tests/drag-fling-safety.test.js -- TASK 548: a FAST FLING (the whole drag in ONE pointer event, far longer than SolverConfig.MAX_DRAG_STEP)
// across constrained sketches is as safe as the same drag done slowly. Every cell of the Fusion drag oracle (tests/harness/fusion-oracle/
// drag-cells.js: lines, rectangles, circles, arcs, two lines, tangent line + circle, origin cells, each free / held / dimensioned / fully
// constrained) is dragged through the app's real pointer path (runOurs: handleSelectionPointerDown / Move / Up + the frame solve) with its
// recorded vector scaled 1x, 5x, 20x and 70x, once in ONE pointer event (the fling: the cells are mm sized, so from 20x on the drag step
// walks it in sub-moves) and once SLOWLY (SLOW pointer events along the same straight path).
// For every fling: every constraint holds (residual < 1e-6), nothing fully constrained (nullity 0) moves, no line / arc / circle collapses
// (findCollapsedShape) unless the slow drag collapses it too, and a circle tangent to a line ends on the same side of it as after the slow
// drag. (Pushing a tangent line's end far across a circle whose radius is free shrinks the circle through zero to the other side: the slow
// drag does that as well, tangent.free / fixc.lineend.across from 5x on; it is what that drag means, not a fling artefact.)
// The drag step is still a needed safety, shown by a control run with MAX_DRAG_STEP = 0: line.H.end.across flung 70x (a 17 mm horizontal
// line's end thrown 357 mm across in one event) collapses the line while the slow drag does not: the select tool's vertical inference is
// read against the line's other end where it was BEFORE the event (88 degrees off it) and aims the end straight above it; walking the jump
// in sub-moves re-reads it on the way, as a slow drag does.
import { buildCells, runOurs, PATH } from './harness/fusion-oracle/drag-cells.js';
import { SolverConfig } from '#core/solver-config.js';

const SLOW = 40, SCALES = [1, 5, 20, 70];
const failures = [];
const cells = buildCells();
const scaled = (cell, k) => ({ ...cell, to: [cell.from[0] + (cell.to[0] - cell.from[0]) * k, cell.from[1] + (cell.to[1] - cell.from[1]) * k] });
// the side of the tangent circle's centre relative to the line's direction (+1 / -1), from a runOurs record (cm); 0 when the cell has none
const side = (cell, snap) => {
  const t = cell.cons.find(c => c.t === 'tang'); if (!t) return 0;
  const l = snap[t.line].pts, c = snap[t.circle].pts[0];
  return Math.sign((l[1][0] - l[0][0]) * (c[1] - l[0][1]) - (l[1][1] - l[0][1]) * (c[0] - l[0][0]));
};
const drag = (cell, steps) => { PATH.steps = steps; return runOurs(cell); };
const steps0 = PATH.steps;
let flings = 0, tangentChecked = 0, collapsedBoth = 0;
try {
  for (const k of SCALES) for (const cell of cells) {
    const c = scaled(cell, k), fling = drag(c, 1), slow = drag(c, SLOW);
    flings++;
    const id = `${cell.id} x${k}`;
    if (!(fling.residual < 1e-6)) failures.push(`${id}: a constraint is broken after the fling (worst residual ${fling.residual})`);
    if (fling.nullity0 === 0 && /M|r/.test(fling.moved)) failures.push(`${id}: fully constrained (nullity 0) but moved: ${fling.moved}`);
    if (fling.collapsed && !slow.collapsed) failures.push(`${id}: the fling collapses ${fling.collapsed}, the slow drag does not`);
    if (fling.collapsed && slow.collapsed) collapsedBoth++;
    const sf = side(c, fling.after), ss = side(c, slow.after);
    if (sf || ss) { tangentChecked++; if (sf !== ss) failures.push(`${id}: the tangent circle ends on side ${sf} after the fling, ${ss} after the slow drag`); }
  }
  // control: without the drag step the extreme fling collapses the horizontal line, the slow drag does not (the safety the step keeps)
  const original = SolverConfig.MAX_DRAG_STEP;
  SolverConfig.MAX_DRAG_STEP = 0;
  try {
    const c = scaled(cells.find(x => x.id === 'line.H.end.across'), 70), fling = drag(c, 1), slow = drag(c, SLOW);
    if (!fling.collapsed || slow.collapsed) failures.push(`control: line.H.end.across x70 with MAX_DRAG_STEP 0: fling collapsed=${fling.collapsed}, slow collapsed=${slow.collapsed} (expected: the fling only): re-measure whether the step is still needed and update this test`);
    else console.log(`control (MAX_DRAG_STEP 0): line.H.end.across x70: the fling collapses ${fling.collapsed}, the slow drag does not`);
  } finally { SolverConfig.MAX_DRAG_STEP = original; }
} finally { PATH.steps = steps0; }

if (failures.length) { console.error('drag-fling-safety FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`drag-fling-safety.test.js: ok (${flings} one-event flings, ${cells.length} cells x ${SCALES.join('/')}: every residual < 1e-6, nothing fully constrained moved, no collapse the slow drag does not have (${collapsedBoth} collapse in both), ${tangentChecked} tangent sides as after the slow drag)`);
