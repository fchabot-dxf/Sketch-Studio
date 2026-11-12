// TASK 518 part 1 -- writes the per-drawing tables of docs/FUSION-COMPARISON.md between <!-- drawings:begin --> and <!-- drawings:end -->.
//   node scripts/fusion-oracle/drawings-doc.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDrawings } from '../../tests/harness/coverage/prop-lib.js';
import { compareDrawing } from '../../tests/harness/fusion-oracle/drawings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = [];
const P = (...a) => out.push(...a);
const esc = (s) => String(s).replace(/\|/g, '/');

// verdict of a differing row: OUR BUG (finding) | FUSION DIFFERENT BY DESIGN | UNCLEAR
function verdict(name, r) {
  const kind = r.key.split('/').pop();
  if (name === 'scurve') return 'OUR BUG N-F7 (tangent between two arcs sharing a rim joint is degenerate)';
  if (name === 'plate' && /^edit(10|11)\//.test(r.key)) return 'OUR BUG F2 (equal on circles does nothing; the hole radius edit is refused)';
  if (r.key.startsWith('redundant/') || r.key.startsWith('conflict/')) return 'FUSION DIFFERENT BY DESIGN: Fusion refuses an over-constraining dimension (VCS_SKETCH_OVER_CONSTRAINTS); ours keeps it as a driven reference (O3: the owner\'s ruling on references decides)';
  if (kind === 'outcome' && /^refused/.test(r.fusion) && /^accepted/.test(r.ours)) return 'UNCLEAR / O1: a redundant geometric constraint: Fusion refuses it as over-constrained, ours accepts it silently (audit O1: "the app flags redundant dimensions but not redundant constraints")';
  if (name === 'triangle' && r.key.startsWith('edit')) return 'UNCLEAR: the angle dimension reads 180 - base angle in ours (the 0.8x value is geometrically impossible there); Fusion measures the other side, so the same number is feasible';
  if (kind === 'full') return 'UNCLEAR: per-entity "fully constrained" differs; circles: a circle\'s radius is shape data in ours (O2) while Fusion needs a radius dimension; otherwise it follows an upstream refusal difference';
  if (kind === 'sketchFull') return 'UNCLEAR: same cause as the per-entity flags (O2 circle radius, or an upstream refusal difference)';
  return 'UNCLEAR';
}

P('<!-- drawings:begin -->', '');
const sumRows = [];
const sections = [];
for (const d of await loadDrawings()) {
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle', d.mod.NAME + '.json'), 'utf8'));
  const { rows, exp } = compareDrawing(d.mod, fx);
  const rec = fx.jobs.recipe;
  const round = ['plate', 'trapezoid', 'bracket', 'triangle', 'polygon'].includes(d.mod.NAME) ? 'round 1' : 'round 2';
  const diff = rows.filter(r => !r.same);
  sumRows.push(`| ${d.mod.NAME} (${round}) | ${rec.steps.length} | ${rows.length} | ${rows.length - diff.length} | ${diff.length} |`);
  const s = [];
  s.push(`#### ${d.mod.NAME}: ${d.mod.TITLE} (${round})`, '');
  const notes = [];
  if (rec.skipped && rec.skipped.length) notes.push(`not expressible in Fusion and left out: ${rec.skipped.map(x => x.replace(/_\d+/, '').replace(/:/, ' (') + ')').join(', ')} (Fusion has no cubic bezier with our control-point data; its two end joints are kept as points)`);
  if (d.mod.NAME === 'two-sketches') notes.push('built in ONE Fusion sketch: Fusion constraints cannot cross sketches, and our solver is one global system that never reads sketchId, so the comparison is of the constraint maths only');
  if (d.mod.NAME === 'polygon' || d.mod.NAME === 'filleted-polygon' || d.mod.NAME === 'every-kind') notes.push('the polygon is our tool\'s structure (sides + construction radials + equal constraints), replayed as lines and equals, not a Fusion polygon');
  notes.push('fillets are an arc + tangent constraints + a radius dimension + a virtual sharp point (a plain sketch point on both lines), as the fillet tool builds them');
  notes.push('units: ours mm, Fusion API cm (x 0.1 on the way in); angle dimensions are given in degrees');
  s.push(notes.map(n => `* ${n}`).join('\n'), '');
  s.push('| step | ours | Fusion | same? | coordinates | fully constrained (per shape, F = yes) ours / Fusion |', '|---|---|---|---|---|---|');
  rec.steps.forEach((fs, i) => {
    const mine = rows.filter(r => r.key.startsWith(`recipe/${i}/`));
    const o = mine.find(r => r.key.endsWith('/outcome')), c = mine.find(r => r.key.endsWith('/coords')), f = mine.find(r => r.key.endsWith('/full')), sf = mine.find(r => r.key.endsWith('/sketchFull'));
    const same = mine.every(r => r.same);
    s.push(`| ${i + 1} ${esc(o.label).slice(0, 70)} | ${esc(o.ours)} | ${esc(o.fusion)} | ${same ? 'yes' : '**NO**'} | ${c ? (c.note ? c.note : (c.same ? 'same' : 'differs')) : '-'} | ${f ? esc(f.ours) + ' / ' + esc(f.fusion) + (f.same ? '' : ' *') : '-'}${sf ? ' ; sketch: ' + esc(sf.ours) + ' / ' + esc(sf.fusion) + (sf.same ? '' : ' *') : ''} |`);
  });
  s.push('');
  const E = rows.filter(r => /^edit\d+\/outcome$/.test(r.key));
  s.push(`Step E, ${E.length} dimension edits (0.8x, 1.25x): ${E.filter(r => r.same).length} agree (accepted or refused alike)${E.filter(r => !r.same).length ? '; differ: ' + E.filter(r => !r.same).map(r => `${esc(r.label)} (ours ${r.ours}, Fusion ${esc(r.fusion)})`).join('; ') : ''}.`, '');
  const F = rows.filter(r => /^(redundant|conflict|delete)\//.test(r.key));
  s.push(`Step F: ${F.map(r => `${r.label}: ours ${esc(r.ours)}, Fusion ${esc(r.fusion)}${r.same ? '' : ' *'}`).join('; ')}.`, '');
  if (diff.length) {
    const byV = {};
    for (const r of diff) { const v = verdict(d.mod.NAME, r); (byV[v] ||= []).push(r.key.replace(/^recipe\//, 'step ').replace(/\/(outcome|full|sketchFull|coords)$/, ' $1')); }
    s.push('Divergences and verdicts:', '');
    for (const [v, ks] of Object.entries(byV)) s.push(`* ${v}: ${[...new Set(ks)].slice(0, 12).join(', ')}${ks.length > 12 ? ` (+${ks.length - 12} more)` : ''}`);
    s.push('');
  }
  sections.push(s);
}
P('Rows are one per recipe step; `same?` needs the outcome (accepted / reference / refused), the per-shape and sketch "fully constrained" flags and the coordinates to agree. Coordinates: the same solution within 0.01 mm, or "another valid branch": Fusion landed elsewhere but its geometry satisfies OUR constraint set (residual <= 1e-3). Fusion has no DOF count, so the flags are `isFullyConstrained` of each entity and of the sketch; ours is "every joint of the shape has zero freedom (the finite-difference nullspace)", plus, for a circle, a driving radius dimension (a circle\'s radius is shape data: audit O2).', '');
P('| drawing | recipe steps | comparisons | same | KNOWN differences |', '|---|---|---|---|---|', ...sumRows, '');
for (const s of sections) P(...s);
P('<!-- drawings:end -->');

const docPath = path.join(ROOT, 'docs/FUSION-COMPARISON.md');
let doc = fs.readFileSync(docPath, 'utf8');
if (!doc.includes('<!-- drawings:begin -->')) doc += '\n\n## Per drawing: Fusion\'s answers step by step\n\n<!-- drawings:begin -->\n<!-- drawings:end -->\n';
doc = doc.replace(/<!-- drawings:begin -->[\s\S]*<!-- drawings:end -->/, () => out.join('\n'));
fs.writeFileSync(docPath, doc);
console.log('drawings section written, ' + out.length + ' lines');
