// Linear algebra of the Levenberg-Marquardt solver (task 541: sparse). The constraint Jacobian J is SPARSE (a row touches the few
// joints of its constraint), stored as rows { rowPtr: Int32Array(m + 1), cols: Int32Array, vals: Float64Array }, the columns of a row
// ascending. JᵀJ is built from those rows straight into an ENVELOPE (skyline) matrix: row i of the lower triangle is stored from its
// first structurally non-zero column first[i] to the diagonal, { first: Int32Array(n), start: Int32Array(n + 1), env: Float64Array },
// A[i][j] = env[start[i] + j - first[i]] for first[i] <= j <= i. The Cholesky factor of an envelope matrix stays inside the same envelope,
// so the factorisation, the forward and the backward substitution run over it alone.
// THE SAME ARITHMETIC as the dense form: every sum adds the same non-zero products in the same order (rows ascending for JᵀJ and Jᵀx,
// k ascending in the factorisation); the terms it skips are products with a structural zero, which add +-0 and change nothing.

export const Algebra = {
  // y = Jᵀx (J: m x n sparse rows, x: m) -> y: n
  atx: function(S, m, n, x, out) {
    const { rowPtr, cols, vals } = S;
    for (let j = 0; j < n; ++j) out[j] = 0.0;
    for (let i = 0; i < m; ++i) {
      const xi = x[i];
      for (let p = rowPtr[i]; p < rowPtr[i + 1]; ++p) out[cols[p]] += vals[p] * xi;
    }
    return out;
  },

  // JᵀJ (n x n, symmetric) as an envelope matrix, from the sparse rows of J (m x n)
  gram: function(S, m, n) {
    const { rowPtr, cols, vals } = S;
    const first = new Int32Array(n);
    for (let i = 0; i < n; ++i) first[i] = i;
    for (let k = 0; k < m; ++k) {
      const p0 = rowPtr[k], p1 = rowPtr[k + 1];
      if (p0 === p1) continue;
      const c0 = cols[p0]; // the row's smallest column
      for (let p = p0 + 1; p < p1; ++p) if (first[cols[p]] > c0) first[cols[p]] = c0;
    }
    const start = new Int32Array(n + 1);
    for (let i = 0; i < n; ++i) start[i + 1] = start[i] + (i - first[i] + 1);
    const env = new Float64Array(start[n]);
    for (let k = 0; k < m; ++k) {
      const p1 = rowPtr[k + 1];
      for (let a = rowPtr[k]; a < p1; ++a) {
        const ca = cols[a], va = vals[a], base = start[ca] - first[ca];
        for (let b = rowPtr[k]; b <= a; ++b) env[base + cols[b]] += va * vals[b];
      }
    }
    return { n, first, start, env };
  },

  // A[i][i] += alpha for every i (LM damping)
  addToDiag: function(E, alpha) {
    const { n, first, start, env } = E;
    for (let i = 0; i < n; ++i) env[start[i] + i - first[i]] += alpha;
    return E;
  },

  // Cholesky solve of the symmetric positive-definite envelope matrix E: (E) u = b, u written into b; E is overwritten by its factor L.
  // Returns false (b is then meaningless) when a pivot is <= EPS: the matrix is not (numerically) positive-definite.
  choleskySolveEnvelope: function(E, b) {
    const { n, first, start, env: A } = E;
    // EPS rejects (near-)singular matrices. It must be loose enough never to
    // reject the LM-damped normal equations (A = JᵀJ + λI, λ >= lambdaInit ~1e-3,
    // so pivots >= ~1e-3), yet tight enough to reject the near-singular JᵀJ of the
    // zero-damping polish step — a pivot ~1e-10 otherwise divides through to a
    // ~1e10 step and flings geometry during a drag (the "bounce"). 1e-8 sits
    // safely between the two. Rejection => caller treats the system as
    // rank-deficient and skips the undamped step, keeping the stable LM result.
    const EPS = 1e-8;
    // Factorisation A = L Lᵀ, L in place (row i of L in row i's envelope; L[i][k] = 0 for k < first[i])
    for (let i = 0; i < n; ++i) {
      const fi = first[i], oi = start[i] - fi;
      for (let j = fi; j <= i; ++j) {
        let s = A[oi + j];
        const fj = first[j], oj = start[j] - fj;
        for (let k = fi > fj ? fi : fj; k < j; ++k) s -= A[oi + k] * A[oj + k];
        if (i === j) {
          if (s <= EPS) return false; // not positive-definite
          A[oi + i] = Math.sqrt(s);
        } else {
          A[oi + j] = s / A[oj + j];
        }
      }
    }
    // Forward substitution L y = b
    for (let i = 0; i < n; ++i) {
      const fi = first[i], oi = start[i] - fi;
      let s = b[i];
      for (let k = fi; k < i; ++k) s -= A[oi + k] * b[k];
      b[i] = s / A[oi + i];
    }
    // Backward substitution Lᵀ x = y (column i of L: the rows k > i whose envelope reaches column i)
    for (let i = n - 1; i >= 0; --i) {
      let s = b[i];
      for (let k = i + 1; k < n; ++k) if (first[k] <= i) s -= A[start[k] - first[k] + i] * b[k];
      b[i] = s / A[start[i] + i - first[i]];
    }
    return true;
  },

  // Cholesky solve of a DENSE symmetric positive-definite matrix A (n*n, row-major; its lower triangle is read): (A) u = b in place.
  // The envelope solve with a full envelope (every row from column 0): one factorisation, one EPS.
  choleskySolve: function(A, n, b) {
    const first = new Int32Array(n), start = new Int32Array(n + 1);
    for (let i = 0; i < n; ++i) start[i + 1] = start[i] + i + 1;
    const env = new Float64Array(start[n]);
    for (let i = 0; i < n; ++i) for (let j = 0; j <= i; ++j) env[start[i] + j] = A[i * n + j];
    return Algebra.choleskySolveEnvelope({ n, first, start, env }, b);
  },

  // The dense m x n row-major copy of sparse rows (tests and the rank analyses read rows densely)
  dense: function(S, m, n) {
    const { rowPtr, cols, vals } = S;
    const J = new Float64Array(m * n);
    for (let i = 0; i < m; ++i) for (let p = rowPtr[i]; p < rowPtr[i + 1]; ++p) J[i * n + cols[p]] = vals[p];
    return J;
  }
};
