// TASK 518 part 1 -- node scripts/fusion-oracle/drawings-cli.mjs merge <jobs dir>: turns the Fusion answers of every drawing (<name>.jobs.json + <name>.fusion.json)
// into tests/fixtures/fusion-oracle/<name>.json. Positions / radii / fully-constrained flags are stored BY INDEX (joint order of the document without the
// origin, shape order) because ids carry timestamps and change on every build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [cmd, dir] = process.argv.slice(2);
if (cmd !== 'merge') { console.error('usage: merge <jobs dir>'); process.exit(1); }
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.jobs.json') && !n.startsWith('graded'))) {
  const name = f.replace('.jobs.json', '');
  const jobs = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const fus = JSON.parse(fs.readFileSync(path.join(dir, name + '.fusion.json'), 'utf8'));
  const jids = Object.keys(jobs.doc.joints).filter(j => j !== 'j_origin'), sids = jobs.doc.shapes.map(s => s.id);
  const inShape = new Set(jobs.doc.shapes.flatMap(s => s.joints));
  const P = (m) => jids.map(j => (m[j] || null)), R = (m) => sids.map(s => (m[s] == null ? null : m[s]));
  const snap = (sn) => (sn ? { pts: P(sn.pts), radii: R(sn.radii), full: sids.map(s => (sn.full[s] == null ? null : sn.full[s])), fullPts: jids.map(j => (inShape.has(j) ? null : (sn.full[j] == null ? null : sn.full[j]))), sketchFull: sn.sketchFull == null ? null : sn.sketchFull, origin: sn.origin } : null);
  const out = { name, fusion: fus.fusion, date: new Date().toLocaleDateString('sv'), units: 'mm; arrays by joint index (no origin) / shape index', jobs: {} };
  for (const jb of jobs.jobs) {
    const r = fus.results[name + '/' + jb.id];
    if (!r || r.setupError) { out.jobs[jb.id] = { setupError: r ? r.setupError : 'no answer' }; continue; }
    const steps = jb.record === 'all' ? r.steps : r.steps.slice(-1);
    out.jobs[jb.id] = { buildErrors: r.buildErrors, skipped: r.skipped, initial: snap(r.initial), steps: steps.map(s => ({ label: s.label, accepted: s.accepted, error: s.error, valueError: s.valueError || null, driving: s.driving == null ? null : s.driving, skipped: !!s.skipped, snap: snap(s.snap) })) };
  }
  fs.writeFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle', name + '.json'), JSON.stringify(out));
  console.log(name, Object.keys(out.jobs).length, 'jobs');
}
