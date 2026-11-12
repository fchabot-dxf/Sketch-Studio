// TASK 518 part 0b -- (re)writes tests/fixtures/fusion-oracle/which-moves-graded-known.json: per class (constraint x kind pair) the cells where OUR answer differs from
// Fusion's: "all" when the class is uniform, else the list of "levelA,levelB". Run only when a difference is understood and accepted as KNOWN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cells } from './graded-analyze.mjs';
import { cellKey, classOf } from '../../tests/harness/fusion-oracle/graded.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// reason class per group after task 525 (who moves at creation from the declared table): what still differs, in one line. "Refused" = Fusion
// refuses a redundant / over-constraining add that ours accepts (refusing like Fusion is task 526).
const REASON = {
  'parallel': 'after task 525: Fusion refuses a redundant parallel (task 526); a corner line against an H/V line pinned at one end: Fusion turns it rigidly and drags its partner, ours swings it about the corner',
  'perpendicular': 'after task 525: who moves agrees; with a handedness locked ours reaches 90 degrees by the least-change solve of the mover (the branched solver row is stationary at exactly 90 degrees), Fusion turns it rigidly',
  'collinear': 'after task 525: Fusion refuses (task 526) or moves both lines; a corner line: Fusion stretches it, ours turns it rigidly; a rect side: Fusion translates the rect, ours deforms it',
  'equal-line-line': 'after task 525: two rect sides: Fusion deforms one rect, ours both',
  'dim-angle': 'after task 525: Fusion refuses a redundant angle (task 526); a free line: Fusion turns it rigidly, ours reaches the angle by the least-change solve (it stretches)',
  'coincident-pp': 'after task 525: the 315 and the graded fixture disagree on a free line against an H/V line (the table follows the 315 majority); a line centred on the origin against a free line',
  'dim-aligned': 'after task 525: Fusion refuses a dimension between held points (task 526); the moving line: Fusion stretches or turns it, ours translates it; an arc centre: Fusion moves the centre alone (the arc resizes), ours translates the arc',
  'dim-horizontal': 'after task 525: Fusion refuses (task 526); the moving line: Fusion moves the picked point alone or turns the line, ours translates it',
  'dim-vertical': 'after task 525: Fusion refuses (task 526); the moving line: Fusion moves the picked point alone or turns the line, ours translates it',
  'horizontal-2pt': 'after task 525: Fusion refuses a redundant H/V (task 526); two H/V lines or two rects: Fusion moves the first pick',
  'vertical-2pt': 'after task 525: Fusion refuses a redundant H/V (task 526)',
  'pointOnCircle': 'after task 525: Fusion refuses (task 526); a fillet arc / two arcs: Fusion translates or deforms the other operand',
  'equal-circle': "after task 525: Fusion refuses equal(arc, circle), equal with a fillet arc and two dimensioned radii (task 526); an arc against a fillet arc: Fusion scales the arc about its centre, ours resizes it by least change",
  'tangent-line-circle': 'after task 525: who moves agrees; an H/V line, or a circle with centre and radius held: Fusion translates the line, ours moves it by least change (it stretches); a pinned line against a fillet arc: Fusion deforms the fillet',
  'dim-length': 'Fusion refuses a length dimension on a fully held line; ours adds it as a reference (task 526)',
  'horizontal-line': 'same shape (the two ends of one line): since task 525 no pre-placement between two points of one shape, the solve moves both ends (as before 525); Fusion moves one end',
  'vertical-line': 'same shape (the two ends of one line): since task 525 no pre-placement between two points of one shape, the solve moves both ends (as before 525); Fusion moves one end',
  'dim-radius': 'same shape (the arc and its own centre): no pre-placement (task 525 rule), the solve deforms the arc where Fusion scales it about its centre',
};
// a tangent class with an ARC operand (A arc, F fillet arc): after task 523 the arc radius takes part in the least-change solve
const ARC_TANGENT = "arc resizes at tangent creation; placement, task 525 (since task 523 an arc's radius is live through its rim joint and takes part in the least-change solve; Fusion keeps the arc; a free circle radius may change too, task 515)";
const reasonOf = (k) => { const [g, kinds] = k.split('|'); return (g.startsWith('tangent') && /[AF]/.test(kinds || '')) ? ARC_TANGENT : REASON[g]; };
const byClass = {};
for (const c of cells()) {
  const k = classOf(c.cell);
  (byClass[k] ||= { total: 0, diff: [] }).total++;
  if (!cellKey(c.f, c.o).same) byClass[k].diff.push(c.cell.levels.join(','));
}
const known = {};
for (const [k, v] of Object.entries(byClass)) {
  if (!v.diff.length) continue;
  known[k] = { reason: reasonOf(k) || 'PLACEMENT / HOW: which geometry moves differs (docs/FUSION-COMPARISON.md, Which geometry moves: graded)', total: v.total, cells: v.diff.length === v.total ? 'all' : v.diff };
}
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves-graded-known.json'), JSON.stringify(known, null, 1));
const nd = Object.values(known).reduce((a, v) => a + (v.cells === 'all' ? v.total : v.cells.length), 0);
console.log(`${Object.keys(known).length} KNOWN classes of ${Object.keys(byClass).length}; ${nd} differing cells of ${Object.values(byClass).reduce((a, v) => a + v.total, 0)}`);
