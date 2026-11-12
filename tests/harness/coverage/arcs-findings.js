// TASK 531 -- extreme arcs, part D: the findings (EA-n), the rule that gives every failing cell its id, and one self-contained repro per finding.
// KNOWN means "expected to FAIL today": tests/extreme-arcs.test.js fails loudly when an entry stops having failing cells (delete it then). Diagnose, do not fix.
// Ids EA-n are new; F4 / F5 / F6 are the round-1 findings of docs/CONSTRAINT-AUDIT.md that the ordinary control arc already shows (inherited, tolerated like the matrix does).
import { arcByTool, measureArc } from './arcs-variants.js';
import { uiFacts } from './arcs-ui.js';
import { variant } from './arcs-variants.js';
import { runArcCell, ROWS } from './arcs-rows.js';

export const KNOWN = {
  'EA-1': {
    severity: 'MEDIUM',
    title: 'A zero-sweep collapse is still ACCEPTED after a DRAG (refused at constraint creation and on every dimension edit since task 550)',
    diagnosis: 'task 550: findCollapsedShape (constraint-verifier.js) measures the ends of an arc (chord and chord / radius), and every "converged, accept" decision uses it: constraint creation (the coincident of the own ends of an arc: refused on every variant, like Fusion) and every dimension edit, a fillet radius edit included (only the fillet legs are judged by filletHasCollapsedLine). Not covered: a DRAG of an arc joint (f179r10, the end of a 1 degree fillet arc dragged across its start: no refusal while dragging, EA-4 family).',
    task: 'decide with Fusion what a drag that closes an arc does (refuse the frame, or flip the direction)',
  },
  // EA-2 (the stored largeArc flag never recomputed: an arc past 180 degrees drawn and exported as the other arc) FIXED in task 550: the large-arc
  // choice is derived from the joints and the direction by geometry.js arcSweepInfo everywhere (renderer, exports, loop paths, bounds). A cell whose
  // drawn path is not the arc the joints say is still classified EA-2 below and fails the test (no KNOWN entry).
  'EA-3': {
    severity: 'MEDIUM',
    title: 'A constraint on a very short arc can still make the sweep jump to the complement when no solution keeps its side (r0.5 x 0.1 deg tangent to an arc sharing its start)',
    diagnosis: 'task 550 measured the rest: every other EA-3 cell was a coincident of the own ends of the arc (now refused, EA-1 rule). Our least-change solve keeps the side of an arc by itself in every probe (the Fusion fixed-ends radius sequence, near-180 radius jumps, tests/arc-direction.test.js). An orientation lock in the solve (an arc_side row, .evidence/550/arc-side-lock-attempt.patch) removes this last cell only by REFUSING it, and the same rule then turns 67 passing cells into jitter re-solve failures (EA-6 class) and makes 10 Fusion graded cells and 1 dimension-edit run diverge from Fusion: not shipped, the owner decides.',
    task: 'decide with Fusion whether a wrap with no same-side solution is refused; then an arc_side lock that refuses only a wrap',
  },
  'EA-4': {
    severity: 'MEDIUM',
    title: 'Dragging the end of a short arc past its start turns it into a ~360 degree arc',
    diagnosis: 'same cause as EA-3 (geometry.js:285-288); the drag seam (selection-tools.js move handler, prop-drag.js dragJoint) just moves the joint. Whether Fusion does the same is open (replay list).',
    task: 'decide the rule (flip direction or refuse) with Fusion, then implement it with EA-3',
  },
  'EA-5': {
    severity: 'MEDIUM',
    title: 'A constraint or edit shrinks the sweep to under a quarter of its size without being asked',
    diagnosis: 'the solver changes the least in joint coordinates, not in sweep; for a short arc a small joint move is a big relative sweep change. Not a collapse (EA-1) and not a wrap (EA-3); listed so the numbers are in front of the owner.',
    task: 'none until EA-3 is decided',
  },
  'EA-6': {
    severity: 'MEDIUM',
    title: 'parallel / perpendicular / collinear of the CHORD line of a tiny arc: accepted, but not satisfied after a jitter re-solve (and once not converged at all)',
    diagnosis: 'solver/definitions.js:277-306 (parallel) and :309-345 (perpendicular) rows are the un-normalised u x v / u . v (length-squared units), so the row scales with the line lengths (a 0.26 long chord line of an R 0.5 arc against an 8 long line); suspected cause of the stall, NOT proven. Measured: `r0.5s30cw perpendicular-chord sep` is accepted and the re-solve reports no-converge + residual. Task 533 measured the perpendicular cells: the tool locks the branch, the row u x v - |u||v| has a DOUBLE root at the target (r ~ |u||v| d^2 / 2, zero gradient), so the solve stops at r = 1e-6 with d = sqrt(2e-6 / (|u||v|)) = 1.162e-3 rad > VERIFIER_TOLERANCE; normalising by |u||v| would not fix that. The parallel / collinear cells (a simple root) are not diagnosed.',
    task: 'normalise the parallel / perpendicular rows by |u||v| (the Jacobian guard test already compares them with finite differences)',
  },
  'EA-7': {
    severity: 'LOW',
    title: 'Analytic Jacobian of collinear differs from finite differences on a near-zero-length chord line',
    diagnosis: 'solver/definitions.js:228 collinear, chord line 0.00087 long (`r0.5s0.1cw collinear-chord`): 5.7e-3 off. Not the F6 family: unchanged by the task 533 shared-joint fix (this sep cell repeats no joint index).',
    task: 'measure the finite-difference step against the 0.00087 chord before calling it a Jacobian error',
  },
  'EA-8': {
    severity: 'MEDIUM',
    title: 'A feasible constraint on a short chord / tiny fillet is REFUSED (ERR-CSOLVE-01)',
    diagnosis: 'constraint-manager.js:456 _sandboxVerify (reported at :295): PlaneGCS says the same constraint is satisfiable. Seen: perpendicular of the locked chord line of a 0.1 / 1 / 359.9 degree arc and a r 0.5 arc, H/V on the ends of a fillet r 0.5. (parallel / perpendicular on a shared corner is F4, inherited.)',
    task: 'sandbox verification at small scales: tolerance relative to the shape size',
  },
  'EA-9': {
    severity: 'LOW',
    title: 'H/V between two LOCKED arc joints that are within 0.05 of aligned is accepted as already satisfied; PlaneGCS calls it a conflict',
    diagnosis: 'constraint-manager.js:693-696 and :768 compare with GEOMETRY_TOLERANCE 0.05 (world units): a 0.1 degree arc (chord 0.035), the 180 degree arc (the tool nudges its end by 1e-6) and the 359.9 degree arc are all "close enough". Our DOF count 0, PlaneGCS counts -1.',
    task: 'none (a tolerance choice); noted because 0.05 is larger than the whole 0.1 degree arc',
  },
  // EA-10 (an arc picked from anywhere on its circle) FIXED in task 550: snap-detection.js hits an arc only on its drawn sweep (arcSweepInfo);
  // tests/extreme-arcs.test.js asserts it with ui10().
};
// round-1 findings the ordinary control arc already shows (docs/CONSTRAINT-AUDIT.md): tolerated
export const INHERITED = { F4: 'parallel / perpendicular / collinear refused on a shared joint although feasible', F5: 'collinear DOF count on lines meeting at a corner', F6: 'parallel / perpendicular Jacobian: the shared joint column is assigned twice' };

// ------------------------------------------------------------------------------------------------------------------ classification
const CHORD_ROWS = /^(parallel|perpendicular|collinear)-chord$/;
// one id per ISSUE of a failing cell; a cell can carry several. UNCLASSIFIED = an issue no rule explains (the test fails).
function idOf(issue, c) {
  const base = issue.replace(/^(drag|jitter|edit1\.5|edit0\.67|base)-/, '');
  const dragged = /^drag-/.test(issue);
  if (base === 'zero-sweep') return 'EA-1';
  if (base === 'stale-large-arc') return 'EA-2';
  if (base === 'sweep-wrap') return dragged ? 'EA-4' : 'EA-3';
  if (base === 'sweep-shrunk') return 'EA-5';
  if (c.issues.some(i => /zero-sweep/.test(i)) && /^(nullity!=fd|nullity!=oracle|nominal)$/.test(base)) return 'EA-1';
  if (base === 'jacobian') return CHORD_ROWS.test(c.row) && c.state === 'shared' && !/^collinear/.test(c.row) ? 'F6' : 'EA-7';
  if (base === 'bite' || base === 'no-converge' || base === 'residual') return 'EA-6';
  if (base === 'refused-feasible') return CHORD_ROWS.test(c.row) && c.state === 'shared' ? 'F4' : 'EA-8';
  if ((base === 'accepted-conflict' || base === 'nullity!=oracle') && c.state === 'locked' && /^(hv-|coincident-own)/.test(c.row)) return 'EA-9';
  if (base === 'nullity!=oracle' && c.row === 'collinear-chord' && c.state === 'shared') return 'F5';
  return null;
}
// { v: 'PASS' | 'N/A' | 'NA-BUILD' | 'EA-1+EA-2' ... | 'UNCLASSIFIED', ids: [...] }
export function classifyArc(c) {
  if (c.na) return { v: 'NA-BUILD', ids: [] };
  if (c.pass) return !c.accepted ? { v: 'N/A', ids: [] } : { v: 'PASS', ids: [] };
  const ids = new Set(), unexplained = [];
  for (const i of new Set(c.issues)) { const id = idOf(i, c); if (id) ids.add(id); else unexplained.push(i); }
  if (unexplained.length) return { v: 'UNCLASSIFIED', ids: [...ids], why: unexplained.join('+') };
  const arr = [...ids].sort((a, b) => (+a.replace(/\D/g, '') || 99) - (+b.replace(/\D/g, '') || 99));
  return { v: arr.join('+'), ids: arr };
}

// ------------------------------------------------------------------------------------------------------------------ the UI repro (EA-10)
export function ui10() { const f = uiFacts(variant('s30cw')); return { ok: !f.arcPickedOutsideSweep, observed: `mouse on the circle OUTSIDE the 30 degree sweep picks: ${f.mouseOnCircleOutsideSweep}` }; }

// the cell repro of an EA id: the first (variant,row,state) that shows it, as a command line the doc quotes
export const REPRO_CELL = {
  'EA-1': ['f179r10', 'hv-start-end', 'sep'],
  // EA-3 and EA-5: their first repros (s0.1cw / r0.5s30cw tangent-line sep) pass since task 525 (the who-moves placement moves the line and
  // keeps the arc); the repro is now the first cell that still shows the finding
  'EA-3': ['r0.5s0.1cw', 'tangent-arc', 'shared'],
  'EA-4': ['s0.1ccw', 'hv-start-end', 'sep'],
  'EA-5': ['r0.5s0.1cw', 'dim-chord', 'sep'],
  'EA-6': ['r0.5s30cw', 'perpendicular-chord', 'sep'],
  'EA-7': ['r0.5s0.1cw', 'collinear-chord', 'sep'],
  'EA-8': ['s0.1cw', 'perpendicular-chord', 'locked'],
  'EA-9': ['s0.1cw', 'hv-start-end', 'locked'],
};
export async function repro(id) {
  const [v, r, s] = REPRO_CELL[id];
  const rec = await runArcCell(ROWS.find(x => x.id === r), variant(v), s);
  const c = classifyArc(rec);
  return { cell: `${v} ${r} ${s}`, has: c.ids.includes(id), verdict: c.v, issues: [...new Set(rec.issues)].join('+'), g0: rec.g0, g1: rec.g1, drag: rec.drag, notes: rec.notes };
}
void arcByTool; void measureArc;
