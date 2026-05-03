// Lightweight, high-performance dense linear algebra helpers (small matrices)
// Designed for Levenberg-Marquardt on small-to-medium systems (n <= 200)

export const Algebra = {
  zeros: (n) => new Float64Array(n),
  allocMatrix: (rows, cols) => new Float64Array(rows * cols),

  // A[row,col] stored row-major in flat Float64Array
  matGet: (A, rows, cols, r, c) => A[r * cols + c],
  matSet: (A, rows, cols, r, c, v) => { A[r * cols + c] = v; },

  // C = A^T * A  (A: m x n) -> (n x n)
  gram: function(A, m, n, out) {
    // out must be n*n Float64Array (row-major)
    for (let i = 0; i < n; ++i) {
      for (let j = 0; j <= i; ++j) {
        let s = 0.0;
        let oi = i, oj = j;
        for (let k = 0; k < m; ++k) s += A[k * n + oi] * A[k * n + oj];
        out[i * n + j] = s;
        out[j * n + i] = s; // symmetric
      }
    }
    return out;
  },

  // y = A^T * x  (A: m x n, x: m) -> y: n
  atx: function(A, m, n, x, out) {
    for (let j = 0; j < n; ++j) {
      let s = 0.0;
      for (let i = 0; i < m; ++i) s += A[i * n + j] * x[i];
      out[j] = s;
    }
    return out;
  },

  // Cholesky solve for symmetric positive-definite matrix
  // Solve (A) u = b in-place; A is n*n (row-major); b is length n
  choleskySolve: function(A, n, b) {
    // Compute Cholesky factorization A = L * L^T (store L in lower triangle of A)
    const EPS = 1e-14;
    for (let i = 0; i < n; ++i) {
      for (let j = 0; j <= i; ++j) {
        let s = A[i * n + j];
        for (let k = 0; k < j; ++k) s -= A[i * n + k] * A[j * n + k];
        if (i === j) {
          if (s <= EPS) return false; // not positive-definite
          A[i * n + i] = Math.sqrt(s);
        } else {
          A[i * n + j] = s / A[j * n + j];
        }
      }
      // zero upper triangle for sanity
      for (let j = i + 1; j < n; ++j) A[i * n + j] = 0.0;
    }

    // Forward substitution Ly = b
    for (let i = 0; i < n; ++i) {
      let s = b[i];
      for (let k = 0; k < i; ++k) s -= A[i * n + k] * b[k];
      b[i] = s / A[i * n + i];
    }
    // Backward substitution L^T x = y
    for (let i = n - 1; i >= 0; --i) {
      let s = b[i];
      for (let k = i + 1; k < n; ++k) s -= A[k * n + i] * b[k];
      b[i] = s / A[i * n + i];
    }
    return true;
  },

  // Add a scalar to the diagonal of a square matrix (in-place). Useful for LM damping.
  addToDiag: function(A, n, alpha) {
    for (let i = 0; i < n; ++i) A[i * n + i] += alpha;
    return A;
  }
};
