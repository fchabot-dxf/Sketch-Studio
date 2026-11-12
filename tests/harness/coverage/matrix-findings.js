// TASK 512 -- one self-contained REPRO per NEW finding of the matrix (round 1 = F1..F8 in tests/harness/audit/findings.js). Each run() returns
// { ok, observed }: ok === true means the app behaves CORRECTLY, ok === false means the bug is present today. Everything goes through the real
// tool handlers / seams, never through hand-written solver rows.
import { runCell, ROWS } from './matrix-run.js';

export const NEW_FINDINGS = [
  {
    id: 'NEW-6', severity: 'LOW', row: 'tangent',
    title: 'a feasible tangent between a circle and an arc (or two arcs) is refused when the arc radius has to change a lot; PlaneGCS solves it',
    diagnosis: 'the radius of an arc is a joint distance the solver must move; from the current pose even 500 iterations leave the residual at 53 (circle 15 / arc 20 with the centres dimensioned 151 apart: tangent needs R 136). Same family as F5 (feasibility judged from the pose) but not a sandbox-burst issue: a forced add does not converge either.',
    proposal: 'seed the arc radius from the tangency (like seedFilletForRadius does for fillets) or verify with a continuation; test: the tangent in this repro is accepted.',
    async run() { const r = await runCell(ROWS.find(x => x.id === 'tangent'), ['O', 'A'], 'dimmed'); return { ok: r.pass, observed: `tangent circle/arc, centres dimensioned 151 apart: accepted=${r.accepted} errors=${r.errors.join(',')} oracleFeasible=${r.oracleFeasible}` }; },
  },
];
