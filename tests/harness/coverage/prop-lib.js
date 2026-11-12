// TASK 514 -- shared helpers of the "properties" half of the coverage audit: the drawing registry (round-1 drawings + the 8 new ones), a light
// pipeline per drawing (build -> recipe -> measure, no dimension-edit / abuse passes: those are round 1's and the random properties'), a seeded
// RNG and document helpers. Reuses tests/harness/audit/lib.js (oracle, fdJacobian, applyStep, ...); changes nothing in it.
import * as L from '../audit/lib.js';
import { serializeDocument } from '#core/document.js';
import { DEFAULT_SKETCH_ID } from '#core/sketch-model.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { oracleDof } from './prop-oracle.js';

export const ROUND1 = ['d1-plate', 'd2-trapezoid', 'd3-bracket', 'd4-triangle', 'd5-polygon'].map(f => ({ file: `../audit/${f}.js`, group: 'round 1' }));
export const NEW = ['n1-scurve', 'n2-slot', 'n3-collinear', 'n4-axis', 'n5-welded', 'n6-filleted-polygon', 'n7-every-kind', 'n8-two-sketches']
  .map(f => ({ file: `./drawings/${f}.js`, group: 'new' }));
export async function loadDrawings(which = [...ROUND1, ...NEW]) {
  const out = [];
  for (const d of which) out.push({ ...d, mod: await import(d.file) });
  return out;
}

export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// a JSON-safe copy of the whole document (what a save writes): geometry, constraints (with their driven flags), sketches
// An entity with NO sketchId and one stamped with the default sketch are the same thing (sketchOf falls back to it). Undo re-stamps the untagged origin
// joint (the stamping wrap in sketch-state.js sees the restore's joints.set), so the default stamp is dropped before comparing documents.
export function normDoc(doc) {
  const d = JSON.parse(JSON.stringify(doc));
  const strip = (e) => { if (e && e.sketchId === DEFAULT_SKETCH_ID) delete e.sketchId; return e; };
  d.geometry.joints.forEach(([, j]) => strip(j));
  d.geometry.shapes.forEach(strip);
  return d;
}
export const docOf = (S) => normDoc(serializeDocument(S.state));
export const panelDof = (S) => analyzeConstraintStatus({ joints: S.state.joints, shapes: S.state.shapes, constraints: S.state.constraints }).dof;

// Build a drawing and apply its recipe (the first `steps` steps), one constraint at a time through the same path as round 1 (L.applyStep).
// `journal: true` snapshots before every step (what the UI does before each action) so packages/core/journal.js can replay it.
export function buildDrawing(mod, { steps = Infinity, journal = false } = {}) {
  const S = L.newSketch();
  const built = mod.build(S, {});
  S.names = built.names;
  const rows = [];
  for (const step of mod.RECIPE.slice(0, steps)) {
    if (journal) S.state.saveState(step.label);
    rows.push(L.applyStep(S, step, built.names));
  }
  S.engine.solve(L.ITER);
  return { S, built, rows };
}

// the light per-drawing summary (final state)
export async function summarize(mod, { oracle = true } = {}) {
  const { S, rows } = buildDrawing(mod);
  const f = L.freedom(S), fd = L.fdJacobian(S), rr = L.residuals(S);
  const size = L.drawingSize(S), ref = L.snapshot(S);
  let back = 0, converged = 0;
  if (f.nullity === 0) {   // only a fully constrained drawing has ONE geometry to come back to
    for (const seed of [11, 23, 37]) { L.restore(S, ref); L.jitter(S, seed, 0.02, size); const r = S.engine.solve(L.ITER); if (r.converged === true && L.maxDeviation(S, ref) < L.GEOM_TOL) back++; converged++; }
    L.restore(S, ref); S.engine.solve(L.ITER);
  }
  const G = oracle ? await oracleDof(S) : null;
  const out = {
    name: mod.NAME, steps: rows.length, joints: S.state.joints.size, constraints: S.state.constraints.length,
    nullity: f.nullity, panel: panelDof(S), fd: fd.nullity, jacobianErrors: fd.worst.map(e => e.type),
    verifier: rr.max, nan: L.hasNaN(S), refused: rows.filter(r => !r.accepted).map(r => r.label),
    demoted: rows.filter(r => r.accepted && r.driven).map(r => r.label), unconverged: rows.filter(r => !r.converged).map(r => r.label),
    returns: converged ? `${back}/${converged}` : 'n/a', planegcs: G,
  };
  return { S, summary: out };
}
