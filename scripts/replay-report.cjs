// scripts/replay-report.cjs — TASK 507: reproduce a drawing from a pasted diagnostic report.
//   node scripts/replay-report.cjs <report.json> [out.json] [--redo]
// Prints the journal's step list ('seq  time  label  +2 joints +1 shape') and writes the replayed final document (default
// <report>.replayed.json), verified against the journal's own digest. The format is described at the top of packages/core/journal.js.
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const includeRedo = process.argv.includes('--redo');
  if (!args[0]) { console.error('usage: node scripts/replay-report.cjs <report.json> [out.json] [--redo]'); process.exit(2); }
  const report = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const { replayReport } = await import('../tests/harness/sketch.js');
  const { describePatch } = await import('../packages/core/journal.js');
  const j = report.journal;
  if (!j) { console.error('the report has no journal'); process.exit(1); }
  const time = (t) => (t ? new Date(t).toTimeString().slice(0, 8) : '--:--:--');
  const row = (s, mark) => `${String(s.seq).padStart(3)}  ${time(s.t)}  ${String(s.label ?? '').padEnd(28)}  ${describePatch(s.patch)}${mark}`;
  if (j.truncated) console.log(`(journal truncated: the ${j.truncated.droppedSteps} oldest steps are folded into the base)`);
  for (const s of j.steps) console.log(row(s, ''));
  for (const s of (j.redo || [])) console.log(row(s, '   [undone, redo-able]'));
  const doc = replayReport(report, { includeRedo });
  const out = args[1] || args[0].replace(/\.json$/i, '') + '.replayed.json';
  fs.writeFileSync(out, JSON.stringify(doc, null, 1));
  const g = doc.geometry;
  console.log(`replayed: ${g.joints.length} joints, ${g.shapes.length} shapes, ${g.constraints.length} constraints -> ${path.resolve(out)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
