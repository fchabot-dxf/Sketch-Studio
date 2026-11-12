// TASK 518 -- (re)writes tests/fixtures/fusion-oracle/which-moves-known.json: one entry per scenario where OUR answer differs from Fusion's, with the reason
// class of its group. Run it only when a difference is understood and accepted as KNOWN (the test fails when a KNOWN cell starts agreeing or an agreeing cell starts differing).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScenarios, runOurs, cellOf } from '../../tests/harness/fusion-oracle/which-moves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves.json'), 'utf8'));
// reason class per group. "pending task 511" = collinear / pointOnLine placement that task 511 changes in packages/core.
const REASON = {
  'pointOnLine': 'remaining after task 511: a pinned operand / line held differently from Fusion', 'collinear': 'remaining after task 511: which line gives way (or a refusal) differs from Fusion',
  // after task 515 a circle's radius is a solver unknown: the least-change solve may now also change a free radius, where Fusion keeps the moving circle's radius
  'pointOnCircle': 'remaining after tasks 511 + 515: a pinned operand differs from Fusion; since 515 ours may also change the free circle radius (least change)',
  'equal-circle-circle': 'after task 515: which circle resizes / moves differs from Fusion (ours: least change over both)',
  'equal-arc-circle': "after task 515: Fusion's API refuses equal(arc, circle); ours accepts it (the circle radius follows the arc)",
  'tangent-circle-circle': 'after task 515: ours resizes AND moves both circles by least change; Fusion resizes / moves only the moving circle',
  'tangent-line-circle': 'after task 515: ours may also change the free circle radius (least change); Fusion moves the line or translates the circle keeping its radius',
  // after task 523 the arc side of the tangent rows differentiates the arc radius through its rim: the least-change solve may resize the arc
  'tangent-line-arc': "arc resizes at tangent creation; placement, task 525 (since task 523 an arc's radius is live through its rim joint and takes part in the least-change solve; Fusion keeps the arc; the other differences of this group are placement too)",
  'tangent-arc-arc': "arc resizes at tangent creation; placement, task 525 (since task 523 an arc's radius is live through its rim joint and takes part in the least-change solve; Fusion keeps the arc; the other differences of this group are placement too)",
};
const known = {};
for (const sc of buildScenarios()) {
  const f = fx.results[sc.id];
  const c = cellOf(f, runOurs(sc));
  if (!c.same) known[sc.id] = REASON[sc.group] || 'PLACEMENT: which geometry moves differs (see docs/FUSION-COMPARISON.md, Which geometry moves)';
}
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves-known.json'), JSON.stringify(known, null, 1));
console.log(Object.keys(known).length + ' KNOWN of ' + fx.scenarios.length);
