// TASK 512 -- one self-contained REPRO per NEW finding of the matrix (round 1 = F1..F8 in tests/harness/audit/findings.js). Each run() returns
// { ok, observed }: ok === true means the app behaves CORRECTLY, ok === false means the bug is present today. Everything goes through the real
// tool handlers / seams, never through hand-written solver rows.
import { runCell, ROWS } from './matrix-run.js';

export const NEW_FINDINGS = [
  {
    id: 'NEW-6', severity: 'LOW', row: 'tangent',
    title: 'a feasible tangent between two arcs (an arc and a fillet arc, an arc and a shared-joint line) is refused when the arc radius has to change a lot; PlaneGCS solves it',
    diagnosis: 'the radius of an arc is a joint distance the solver must move, and the arc side of the tangent row reads it as a constant (no rim derivative: .evidence/515/arc-tangent-probe.txt); from the current pose the solve does not reach the tangency (arc 20 / arc 20 with the centres dimensioned 151 apart). The circle/arc cells of this finding were fixed by task 515 (the circle radius is a solver unknown and moves). Same family as F5 (feasibility judged from the pose) but not a sandbox-burst issue: a forced add does not converge either.',
    proposal: 'give the arc side of the tangent rows the rim derivative (like point_on_line onCircle rimJoint) or seed the arc radius from the tangency (like seedFilletForRadius); test: the tangent in this repro is accepted.',
    async run() { const r = await runCell(ROWS.find(x => x.id === 'tangent'), ['A', 'A'], 'dimmed'); return { ok: r.pass, observed: `tangent arc/arc, centres dimensioned 151 apart: accepted=${r.accepted} errors=${r.errors.join(',')} oracleFeasible=${r.oracleFeasible}` }; },
  },
];
