// TASK 512 -- one self-contained REPRO per NEW finding of the matrix (round 1 = F1..F8 in tests/harness/audit/findings.js). Each run() returns
// { ok, observed }: ok === true means the app behaves CORRECTLY, ok === false means the bug is present today. Everything goes through the real
// tool handlers / seams, never through hand-written solver rows.

// NEW-6's repro (tangent arc/arc, centres dimensioned 151 apart) was deleted by task 523: the arc tangent rows differentiate the live arc radius
// and the tangent is accepted. Its remaining cells (shared variant) are pinned by KNOWN in tests/coverage-matrix.test.js.
export const NEW_FINDINGS = [];
