// Linear algebra of the Levenberg-Marquardt solver (task 541: sparse). The constraint Jacobian J is SPARSE (a row touches the few
// joints of its constraint), stored as rows { rowPtr: Int32Array(m + 1), cols: Int32Array, vals: Float64Array }, the columns of a row
// ascending. JᵀJ is built from those rows straight into an ENVELOPE (skyline) matrix: row i of the lower triangle is stored from its
// first structurally non-zero column first[i] to the diagonal, { first: Int32Array(n), start: Int32Array(n + 1), env: Float64Array },
// A[i][j] = env[start[i] + j - first[i]] for first[i] <= j <= i. The Cholesky factor of an envelope matrix stays inside the same envelope,
// so the factorisation, the forward and the backward substitution run over it alone.
// THE SAME ARITHMETIC as the dense form: every sum adds the same non-zero products in the same order (rows ascending for JᵀJ and Jᵀx,
// k ascending in the factorisation); the terms it skips are products with a structural zero, which add +-0 and change nothing.
// TASK 844: the envelope is built in a FILL-REDUCING ORDER. In the unknowns' own order (joint insertion order, #core/solver/engine.js _pack) a
// row of JᵀJ reaches back to the earliest unknown it is coupled to; a pattern's rows tie every copy point to its SOURCE point (drawn first), so
// every row reached column 0 and the envelope was the whole lower triangle: a dense O(n^3) Cholesky per solve. gram orders the unknowns by
// Reverse Cuthill-McKee on the sparsity graph of JᵀJ (two unknowns are neighbours when a row of J touches both) when the own order's envelope
// is large (ORDER_MIN_N, ORDER_MIN_FILL: measured) and keeps that order when its envelope is SMALLER, else the own order (then the
// arithmetic is exactly the one before task 844). The order
// is internal to the factorisation: the envelope carries it (perm: position -> unknown) and choleskySolveEnvelope reads the right-hand side
// and writes the solution through it, so every caller sees its own unknowns. P A Pᵀ is positive-definite exactly when A is (the same
// matrix in another order); only the rounding, so a pivot's last digits, can differ.

// The Reverse Cuthill-McKee order of the graph (CSR: the neighbours of node v are adj[ptr[v] .. ptr[v + 1]), the node itself left out):
// per connected component, a breadth-first numbering from a pseudo-peripheral node (George-Liu: from the component's least-degree node, the
// least-degree node of the last breadth-first level while that makes the level structure deeper), each node's unnumbered neighbours taken
// by ascending degree (then index), the whole numbering reversed. -> perm (position -> node).
function reverseCuthillMcKee(n, ptr, adj) {
  const deg = new Int32Array(n);
  for (let v = 0; v < n; ++v) deg[v] = ptr[v + 1] - ptr[v];
  const less = (a, b) => deg[a] < deg[b] || (deg[a] === deg[b] && a < b);
  const order = new Int32Array(n), level = new Int32Array(n).fill(-1), done = new Uint8Array(n), queue = new Int32Array(n);
  // the breadth-first level structure from v over the nodes not yet numbered: -> { depth, end: the least-degree node of its last level,
  // least: the least-degree node reached }
  const levels = (v) => {
    let head = 0, tail = 0, depth = 0, least = v;
    queue[tail++] = v; level[v] = 0;
    while (head < tail) {
      const u = queue[head++];
      if (less(u, least)) least = u;
      for (let p = ptr[u]; p < ptr[u + 1]; ++p) { const w = adj[p]; if (level[w] < 0 && !done[w]) { level[w] = level[u] + 1; depth = level[w]; queue[tail++] = w; } }
    }
    let end = -1;
    for (let q = 0; q < tail; ++q) { const u = queue[q]; if (level[u] === depth && (end < 0 || less(u, end))) end = u; level[u] = -1; }
    return { depth, end, least };
  };
  let k = 0;
  const nb = [];
  for (let s0 = 0; s0 < n; ++s0) {
    if (done[s0]) continue;
    let start = levels(s0).least, ls = levels(start);
    for (;;) {
      const lc = levels(ls.end);
      if (lc.depth <= ls.depth) break;
      start = ls.end; ls = lc;
    }
    const k0 = k;
    order[k++] = start; done[start] = 1;
    for (let h = k0; h < k; ++h) {
      const u = order[h];
      nb.length = 0;
      for (let p = ptr[u]; p < ptr[u + 1]; ++p) { const w = adj[p]; if (!done[w]) { done[w] = 1; nb.push(w); } }
      nb.sort((a, b) => deg[a] - deg[b] || a - b);
      for (const w of nb) order[k++] = w;
    }
  }
  const perm = new Int32Array(n);
  for (let i = 0; i < n; ++i) perm[i] = order[n - 1 - i];
  return perm;
}

// The sparsity graph of JᵀJ from the sparse rows S (m x n): CSR { ptr, adj }, the unknowns sharing a row with each unknown (itself left out).
function gramGraph(S, m, n) {
  const { rowPtr, cols } = S;
  const nnz = rowPtr[m];
  const cPtr = new Int32Array(n + 1); // the rows of each column (the transpose of S's pattern)
  for (let p = 0; p < nnz; ++p) ++cPtr[cols[p] + 1];
  for (let j = 0; j < n; ++j) cPtr[j + 1] += cPtr[j];
  const cRows = new Int32Array(nnz), at = cPtr.slice(0, n);
  for (let k = 0; k < m; ++k) for (let p = rowPtr[k]; p < rowPtr[k + 1]; ++p) cRows[at[cols[p]]++] = k;
  const mark = new Int32Array(n).fill(-1), ptr = new Int32Array(n + 1), list = [];
  for (let j = 0; j < n; ++j) {
    mark[j] = j;
    for (let q = cPtr[j]; q < cPtr[j + 1]; ++q) {
      const k = cRows[q];
      for (let p = rowPtr[k]; p < rowPtr[k + 1]; ++p) { const c = cols[p]; if (mark[c] !== j) { mark[c] = j; list.push(c); } }
    }
    ptr[j + 1] = list.length;
  }
  return { ptr, adj: Int32Array.from(list) };
}

// The envelope of the graph's matrix in the order perm (position -> node): each position's first column, the envelope's size below the
// diagonal (the sum of i - first[i]) and pos (node -> position).
function envelopeOf(n, ptr, adj, perm) {
  const pos = new Int32Array(n);
  for (let i = 0; i < n; ++i) pos[perm[i]] = i;
  const first = new Int32Array(n);
  let size = 0;
  for (let i = 0; i < n; ++i) {
    const v = perm[i];
    let f = i;
    for (let p = ptr[v]; p < ptr[v + 1]; ++p) { const c = pos[adj[p]]; if (c < f) f = c; }
    first[i] = f; size += i - f;
  }
  return { size, first, pos };
}

// TASK 844: when gram tries the Reverse Cuthill-McKee order: at least ORDER_MIN_N unknowns AND the own order's envelope at least
// ORDER_MIN_FILL * n^2 (an average row at least n / 4 wide: half the lower triangle). Measured over every solver-using quick test (273
// files, 2.4 million factorisations, both orders timed on the same matrices, WORK-LOG TURN 844): with fewer unknowns the ordering never
// paid for itself (the new way 2.4x to 5.4x slower at every fill), nor on a sparser envelope (1.4x to 5.2x slower); on a fuller one with more
// unknowns it wins (393 -> 275 ms at 65-128 unknowns, 69 -> 26 at 129-256, 334 -> 98 at 257-512; a pattern's full envelope: 23 s -> 12 ms).
// Below the rule the arithmetic is exactly the one before task 844, the pass / fail of every Cholesky (the rank probe) included.
const ORDER_MIN_N = 65;
const ORDER_MIN_FILL = 1 / 4;

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

  // JᵀJ (n x n, symmetric) as an envelope matrix, from the sparse rows of J (m x n), in the fill-reducing order (task 844, above): perm
  // (position -> unknown) when the Reverse Cuthill-McKee order is tried (ORDER_MIN_N, ORDER_MIN_FILL) and has the smaller envelope, else
  // null (the unknowns' own order, the arithmetic of before task 844).
  gram: function(S, m, n) {
    const { rowPtr, cols, vals } = S;
    // the own order's envelope: each unknown's first column is the smallest column of a row it is in
    let first = new Int32Array(n), pos = null, perm = null;
    for (let i = 0; i < n; ++i) first[i] = i;
    for (let k = 0; k < m; ++k) {
      const p0 = rowPtr[k], p1 = rowPtr[k + 1];
      if (p0 === p1) continue;
      const c0 = cols[p0]; // the row's smallest column
      for (let p = p0 + 1; p < p1; ++p) if (first[cols[p]] > c0) first[cols[p]] = c0;
    }
    let ownSize = 0;
    for (let i = 0; i < n; ++i) ownSize += i - first[i];
    if (n >= ORDER_MIN_N && ownSize >= ORDER_MIN_FILL * n * n) {
      const { ptr, adj } = gramGraph(S, m, n), rcmPerm = reverseCuthillMcKee(n, ptr, adj), rcm = envelopeOf(n, ptr, adj, rcmPerm);
      if (rcm.size < ownSize) { first = rcm.first; pos = rcm.pos; perm = rcmPerm; }
    }
    const start = new Int32Array(n + 1);
    for (let i = 0; i < n; ++i) start[i + 1] = start[i] + (i - first[i] + 1);
    const env = new Float64Array(start[n]);
    for (let k = 0; k < m; ++k) {
      const p1 = rowPtr[k + 1];
      for (let a = rowPtr[k]; a < p1; ++a) {
        const ia = pos ? pos[cols[a]] : cols[a], va = vals[a];
        for (let b = rowPtr[k]; b <= a; ++b) {
          const ib = pos ? pos[cols[b]] : cols[b]; // the product goes to the lower triangle: row max(ia, ib), column min(ia, ib)
          if (ia >= ib) env[start[ia] - first[ia] + ib] += va * vals[b];
          else env[start[ib] - first[ib] + ia] += va * vals[b];
        }
      }
    }
    return { n, first, start, env, perm };
  },

  // A[i][i] += alpha for every i (LM damping)
  addToDiag: function(E, alpha) {
    const { n, first, start, env } = E;
    for (let i = 0; i < n; ++i) env[start[i] + i - first[i]] += alpha;
    return E;
  },

  // Cholesky solve of the symmetric positive-definite envelope matrix E: (E) u = b, u written into b; E is overwritten by its factor L.
  // Returns false (b is then meaningless) when a pivot is <= EPS: the matrix is not (numerically) positive-definite.
  // TASK 844: an E in a fill-reducing order (E.perm, gram) solves the same system: b is read and the solution written through perm.
  choleskySolveEnvelope: function(E, b) {
    const { n, perm } = E;
    if (!perm) return Algebra.choleskySolveOrdered(E, b);
    const y = new Float64Array(n);
    for (let i = 0; i < n; ++i) y[i] = b[perm[i]];
    const ok = Algebra.choleskySolveOrdered(E, y);
    for (let i = 0; i < n; ++i) b[perm[i]] = y[i];
    return ok;
  },

  // The Cholesky solve of the envelope matrix E in its storage order: (E) u = b, u written into b; E is overwritten by its factor L.
  choleskySolveOrdered: function(E, b) {
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
    // Backward substitution Lᵀ x = y (column i of L: the rows k > i whose envelope reaches column i, ascending; task 844: listed first, so
    // a column costs its own entries, not a scan of every later row)
    const cPtr = new Int32Array(n + 1);
    for (let k = 0; k < n; ++k) for (let j = first[k]; j < k; ++j) ++cPtr[j + 1];
    for (let j = 0; j < n; ++j) cPtr[j + 1] += cPtr[j];
    const cRow = new Int32Array(cPtr[n]), at = cPtr.slice(0, n);
    for (let k = 0; k < n; ++k) for (let j = first[k]; j < k; ++j) cRow[at[j]++] = k;
    for (let i = n - 1; i >= 0; --i) {
      let s = b[i];
      for (let q = cPtr[i]; q < cPtr[i + 1]; ++q) { const k = cRow[q]; s -= A[start[k] - first[k] + i] * b[k]; }
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
