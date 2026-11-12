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
  'pointOnLine': 'remaining after task 511: a pinned operand / line held differently from Fusion', 'pointOnCircle': 'remaining after task 511: a pinned operand differs from Fusion', 'collinear': 'remaining after task 511: which line gives way (or a refusal) differs from Fusion',
  'equal-circle-circle': 'OUR BUG F2: equal on circles is refused (the radius is not a solver unknown)',
  'tangent-circle-circle': 'DIFFERENT: ours never changes a radius (shape data); Fusion resizes the moving circle',
};
const known = {};
for (const sc of buildScenarios()) {
  const f = fx.results[sc.id];
  const c = cellOf(f, runOurs(sc));
  if (!c.same) known[sc.id] = REASON[sc.group] || 'PLACEMENT: which geometry moves differs (see docs/FUSION-COMPARISON.md, Which geometry moves)';
}
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves-known.json'), JSON.stringify(known, null, 1));
console.log(Object.keys(known).length + ' KNOWN of ' + fx.scenarios.length);
