// TASK 518 part 1 -- compares the recorded Fusion answers for one drawing (tests/fixtures/fusion-oracle/<name>.json) with OUR pipeline replaying the same recipe.
// Per recipe step: the outcome (refused | reference | accepted), which entities Fusion / ours call fully constrained, the sketch's flag, and whether Fusion's solved
// coordinates SATISFY OUR constraint set (a different but valid branch is not a disagreement). Edits and abuse probes: accepted / refused (and the delete: the flag).
import { exportDrawing } from './export.js';

export const COORD_TOL = 1e-2;         // mm: the same solution
export const RES_TOL = 1e-3;           // the verifier's own eps: Fusion's geometry satisfies our constraint
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const outcomeF = (st) => (!st.accepted ? 'refused' : st.driving === false ? 'reference' : 'accepted');
const outcomeO = (o) => (!o.accepted ? 'refused' : o.driven ? 'reference' : 'accepted');
const maxDev = (a, b) => { let d = 0; a.forEach((p, i) => { if (p && b[i]) d = Math.max(d, dist(p, b[i])); }); return d; };
const flagStr = (a) => a.map(x => (x == null ? '?' : x ? 'F' : '.')).join('');
const sameFlags = (f, o) => f.every((x, i) => x == null || o[i] == null || x === o[i]);

// returns { rows: [{ key, step, ours, fusion, same, note }], exp }
export function compareDrawing(mod, fx) {
  const rec = fx.jobs.recipe;
  const exp = exportDrawing(mod, { fusion: rec });
  const rows = [];
  const add = (key, label, ours, fusion, same, note = '') => rows.push({ key, label, ours, fusion, same, note });
  rec.steps.forEach((fs, i) => {
    const os = exp.ours.steps[i];
    const label = fs.label || exp.jobs[0].ops[i].label;
    const fo = outcomeF(fs), oo = outcomeO(os);
    add(`recipe/${i}/outcome`, label, oo, fo + (fs.error ? ` (${fs.error.slice(0, 60)})` : ''), fo === oo);
    if (fs.skipped) { rows[rows.length - 1].same = true; rows[rows.length - 1].note = 'skipped in Fusion (the arc keeps its radius structurally)'; return; }
    if (fs.accepted && os.accepted && fs.snap) {
      const dev = maxDev(fs.snap.pts, os.pts);
      const same = dev <= COORD_TOL;
      const branch = !same && os.fusionResidual != null && os.fusionResidual <= RES_TOL;
      add(`recipe/${i}/coords`, label, `max ${dev.toExponential(1)} mm apart`, os.fusionResidual != null ? `Fusion's geometry satisfies our constraints to ${os.fusionResidual.toExponential(1)}` : '', same || branch, same ? '' : branch ? 'another valid branch' : '');
      if (fs.snap.full) add(`recipe/${i}/full`, label, flagStr(os.full), flagStr(fs.snap.full), sameFlags(fs.snap.full, os.full), 'per shape, F = fully constrained');
      if (fs.snap.sketchFull != null) add(`recipe/${i}/sketchFull`, label, os.sketchFull ? 'fully constrained' : `nullity ${os.nullity}`, fs.snap.sketchFull ? 'fully constrained' : 'not fully constrained', os.sketchFull === fs.snap.sketchFull);
    }
  });
  // E: edits
  const ej = Object.keys(fx.jobs).filter(k => k.startsWith('edit'));
  ej.forEach(k => {
    const f = fx.jobs[k].steps[0], o = exp.ours.jobs[k];
    const e = exp.edits[+k.slice(4)];
    add(`${k}/outcome`, `edit x${e.factor} of dimension ${e.from.toFixed(3)} -> ${e.value.toFixed(3)}`, o.accepted ? 'accepted' : 'refused', (f.accepted ? 'accepted' : 'refused') + (f.error ? ` (${f.error.slice(0, 60)})` : ''), o.accepted === f.accepted);
  });
  // F: abuse
  for (const k of ['redundant', 'conflict']) if (fx.jobs[k] && exp.ours.jobs[k]) {
    const f = fx.jobs[k].steps[0], o = exp.ours.jobs[k];
    add(`${k}/outcome`, `${k} dimension`, outcomeO(o), outcomeF(f) + (f.error ? ` (${f.error.slice(0, 60)})` : ''), outcomeO(o) === outcomeF(f));
  }
  if (fx.jobs.delete && exp.ours.jobs.delete) {
    const f = fx.jobs.delete.steps[0], o = exp.ours.jobs.delete;
    add('delete/outcome', 'delete one dimension', o.accepted ? 'accepted' : 'refused', f.accepted ? 'accepted' : 'refused', o.accepted === f.accepted);
    if (f.accepted && f.snap && f.snap.sketchFull != null) add('delete/sketchFull', 'delete one dimension: fully constrained afterwards?', o.sketchFull ? 'fully constrained' : `nullity ${o.nullity}`, f.snap.sketchFull ? 'fully constrained' : 'not fully constrained', o.sketchFull === f.snap.sketchFull);
  }
  return { rows, exp };
}
