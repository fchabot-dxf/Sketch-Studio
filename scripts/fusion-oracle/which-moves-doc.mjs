// TASK 518 -- writes the "Which geometry moves" section of docs/FUSION-COMPARISON.md between the markers
// <!-- which-moves:begin --> and <!-- which-moves:end -->. The tables come from the recorded Fusion answers and a live run of OUR pipeline;
// the one-sentence rules and the proposed fixes are the prose below (read from the tables by hand).
//   node scripts/fusion-oracle/which-moves-doc.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScenarios, runOurs, cellOf, GROUPS } from '../../tests/harness/fusion-oracle/which-moves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves.json'), 'utf8'));
const known = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves-known.json'), 'utf8'));

// group -> { rule: Fusion's rule in one sentence, fix: proposed fix, verdict }
const T = {
  'horizontal-line': { rule: 'The unpinned end(s) move; a free line rotates about its midpoint (length kept); a pinned end stays; already horizontal or fully fixed is refused.', verdict: 'SAME' },
  'vertical-line': { rule: 'As horizontal: the unpinned end(s) move, a free line rotates about its midpoint, a pinned end stays.', verdict: 'SAME' },
  'horizontal-2pt': { rule: 'The FIRST-picked point stays and the SECOND is moved onto its row; a fixed point always stays.', fix: 'createConstraint, placeForCreation (the task 511 hook): for horizontal / vertical with two joints, set the second-picked joint\'s y (x) to the first\'s before the solve, unless the second is fixed (then move the first). The solver row stays as it is.', verdict: 'FUSION DIFFERENT BY DESIGN (ours: both points meet in the middle; pick order has no effect)' },
  'vertical-2pt': { rule: 'As horizontal (2 points): the first-picked point stays, the second moves onto its column.', fix: 'Same hook as horizontal-2pt.', verdict: 'FUSION DIFFERENT BY DESIGN' },
  'coincident-pp': { rule: 'The FIRST-picked point\'s line stays and the whole SECOND line is TRANSLATED (length and direction kept) so its point lands on the first; a line with one pinned end stretches its free end to the other point instead; a fixed or dimensioned line stays whichever order.', fix: 'placeForCreation: translate the second-picked joint\'s whole line (both endpoints) by the gap vector, instead of moving that one joint (the rubber-band that changes the line\'s length). Needs "which line owns the joint": shape.joints lookup. Pick order must reach createConstraint (the Coincident tool already passes it).', verdict: 'FUSION DIFFERENT BY DESIGN (ours moves only the second picked joint, in BOTH orders: the line is stretched / rotated, and the pick order is ignored)' },
  'parallel': { rule: 'The FIRST-picked line stays and the SECOND rotates about its own midpoint (length kept); a line with one pinned end pivots about it (and the other stays); a fully fixed, H/V-constrained or dimensioned line stays whichever order; with a shared joint the SECOND picked pivots about it.', fix: 'placeForCreation: rotate the second line about its midpoint onto the first\'s direction (shared joint: about the joint) before the solve, choosing the anchor by the existing _lineEstablishmentScore (fixed 4, H/V 2, aligned 1) extended with "carries a driving dimension" and "one end pinned means it pivots". The solver row is untouched.', verdict: 'FUSION DIFFERENT BY DESIGN (ours: both lines rotate, always)' },
  'perpendicular': { rule: 'Same as parallel: the first-picked line stays, the second rotates about its midpoint (shared joint: about the joint); pinned end pivots; fixed / H-V / dimensioned lines stay.', fix: 'Same hook as parallel (target direction = first line rotated 90 degrees, branch from the existing lockPerpendicularBranch).', verdict: 'FUSION DIFFERENT BY DESIGN' },
  'collinear': { rule: 'The FIRST-picked line stays, the second lands on it; a fixed, H/V-constrained or dimensioned line stays whichever order.', verdict: 'AFTER TASK 511: most cells agree; the remaining differences are listed in the table' },
  'equal-line-line': { rule: 'The FIRST-picked line stays and the SECOND keeps its START point and direction and only changes length (its last end slides along its own line); a fixed or dimensioned line stays; a pinned end is the end that stays.', fix: 'placeForCreation: set the second line\'s length to the first\'s by moving its END joint along its own direction (the unpinned end, else the second joint). Keeps direction; ours currently rotates and resizes both lines.', verdict: 'FUSION DIFFERENT BY DESIGN (ours: both lines change length and direction)' },
  'pointOnLine': { rule: 'The point moves onto the line and the line stays; only when the point is fixed does the line move (translated). (Fusion\'s API wants the point first.)', verdict: 'AFTER TASK 511: agrees except the cells marked NO' },
  'pointOnCircle': { rule: 'The point moves radially onto the rim; the circle stays; a fixed point moves the circle instead.', verdict: 'AFTER TASK 511: agrees except the cells marked NO' },
  'midpoint': { rule: 'The point moves to the midpoint and the line stays; only a fixed point moves the line (translated).', fix: 'createConstraint, placeForCreation: move the free point to the midpoint before the solve; the solver row stays as it is, but its Jacobian must not move the line while the point is free (use the same one-sided option pointOnLine had: `mutual` off unless the point is fixed). Today the line\'s two ends move too.', verdict: 'FUSION DIFFERENT BY DESIGN (ours also moves the line when the point is free)' },
  'equal-circle-circle': { rule: 'The SECOND-picked circle is resized (its centre stays); a circle with a driving radius or fully fixed stays; a circle with a fixed centre is the one that resizes, even when picked first.', fix: 'OUR BUG F2 (docs/CONSTRAINT-AUDIT.md): the radius is shape data, not a solver unknown; nothing to place until the radius is a DOF (task 510 / the O2 decision). Not a createConstraint fix.', verdict: 'OUR BUG (F2): refused' },
  'equal-arc-arc': { rule: 'The SECOND-picked arc is re-sized (centre, ends and radius all move); the first stays; an arc with a pinned centre is the one that resizes (even when first); a fully fixed or radius-dimensioned arc stays.', fix: 'The arc has real joints, so the solver can do it; the change is the anchor choice (first picked stays, the arc with a pinned centre or a radius dimension is held) in the same placeForCreation hook. Fusion moves the whole second arc (centre too), not only its radius.', verdict: 'FUSION DIFFERENT BY DESIGN (ours moves both arcs)' },
  'equal-arc-circle': { rule: 'Fusion\'s API REFUSES equal(arc, circle) with "invalid argument value" (the interactive tool may differ; not measurable through the API).', verdict: 'SAME (both refuse) - ours refuses for the F2 reason, Fusion for an API reason: do not read it as agreement' },
  'tangent-line-circle': { rule: 'The LINE moves (rotates and translates; pick order is irrelevant) and the circle stays; a pinned or fixed line stays and the circle\'s centre moves; a circle with a dimensioned radius moves its centre while the line stays.', fix: 'placeForCreation: move the line (never the circle) onto tangency, nearest side, unless the line is pinned (then move the circle centre) or the circle\'s radius is dimensioned. Ours moves both the line and the circle centre.', verdict: 'FUSION DIFFERENT BY DESIGN (ours moves both)' },
  'tangent-line-arc': { rule: 'The LINE moves and the arc stays (even with a dimensioned radius); a pinned or fixed line stays and the whole arc is translated.', fix: 'Same hook as tangent-line-circle. Ours also changes the arc\'s radius and all three points.', verdict: 'FUSION DIFFERENT BY DESIGN (ours moves both, and re-sizes the arc)' },
  'tangent-circle-circle': { rule: 'The SECOND-picked circle moves AND is re-sized (centre and radius); the first stays; a circle with a dimensioned radius or fixed centre keeps its radius, so the other circle\'s centre absorbs the change.', fix: 'Not a createConstraint fix: our circle radius is shape data (O2 / F2). Ours moves both centres and never touches a radius.', verdict: 'FUSION DIFFERENT BY DESIGN, tied to the open O2 question (circle radius as a DOF)' },
  'tangent-arc-arc': { rule: 'The SECOND-picked arc moves and re-sizes (3 points + radius); the first stays; a pinned centre makes that arc the one that changes; fixed / radius-dimensioned arcs stay.', fix: 'Same anchor choice as equal-arc-arc.', verdict: 'FUSION DIFFERENT BY DESIGN (ours moves both)' },
  'dim-aligned': { rule: 'Pick order is IGNORED: the unconstrained line (the later-created one when both are free) is TRANSLATED whole to the new distance; a fixed, H/V or dimensioned line stays.', fix: 'The edit path (commitDimensionEdit, packages/ui/dimension-seams.js): before the solve translate the whole line that owns the unconstrained joint along the measured direction. Ours moves just the two dimension points.', verdict: 'FUSION DIFFERENT BY DESIGN' },
  'dim-horizontal': { rule: 'The FIRST-picked point moves (along x only, nothing else) and the second stays; when the first-picked point is on a fixed line, the SECOND line is translated; when the second point is pinned or its line is fixed / dimensioned, the first moves (its line translates if the first-picked point is itself pinned).', fix: 'commitDimensionEdit: move the first-picked joint only, along the dimension axis. Ours moves the second point and (when held) the first.', verdict: 'FUSION DIFFERENT BY DESIGN (ours: first picked is the anchor, Fusion: it is the one that moves)' },
  'dim-vertical': { rule: 'As horizontal dimension: the first-picked point moves (along y only), the second stays.', fix: 'Same as dim-horizontal.', verdict: 'FUSION DIFFERENT BY DESIGN' },
  'dim-length': { rule: 'The START end stays and the END slides along the line (direction kept); a pinned end stays; fully fixed or already dimensioned is refused ("over constrained" / "already has the same dimension").', fix: 'commitDimensionEdit: for a lone line length keep joints[0], move joints[1]. Ours moves both ends (the line grows about its midpoint). Also ours ACCEPTS a length on a fully fixed line as a reference instead of refusing.', verdict: 'FUSION DIFFERENT BY DESIGN; the fully-fixed case is a leniency in ours (kept as a reference, no error)' },
  'dim-radius-circle': { rule: 'The radius changes, the centre stays.', verdict: 'SAME' },
  'dim-radius-arc': { rule: 'The arc\'s centre stays and its two ends move (radius changes); a pinned centre is the same.', fix: 'commitDimensionEdit: keep the arc centre fixed on a free arc. Ours moves the centre too when the arc is free.', verdict: 'FUSION DIFFERENT BY DESIGN' },
  'dim-angle': { rule: 'The FIRST-picked line stays and the SECOND rotates about its midpoint (length kept); a fixed / H-V / dimensioned line stays whichever order; a pinned end pivots.', fix: 'commitDimensionEdit: rotate the second line about its midpoint onto the new angle, anchor chosen like parallel. Ours rotates both lines.', verdict: 'FUSION DIFFERENT BY DESIGN (ours: both rotate)' },
};

const lines = [];
const scs = buildScenarios();
const byGroup = new Map();
for (const sc of scs) { if (!byGroup.has(sc.group)) byGroup.set(sc.group, []); byGroup.get(sc.group).push(sc); }
const stats = [];
const esc = (s) => s.replace(/\|/g, '/');
for (const g of GROUPS) {
  const list = byGroup.get(g.id);
  const t = T[g.id] || { rule: '?', verdict: '?' };
  const variants = [...new Set(list.map(s => s.variant))];
  const orders = [...new Set(list.map(s => s.order))];
  let same = 0, n = 0;
  const rows = [];
  for (const v of variants) {
    const cells = orders.map(o => {
      const sc = list.find(s => s.variant === v && s.order === o);
      const f = fx.results[sc.id], c = cellOf(f, runOurs(sc));
      n++; if (c.same) same++;
      return `${esc(c.fusion)} | ${esc(c.ours)} | ${c.same ? 'yes' : (known[sc.id] && known[sc.id].startsWith('pending') ? 'pending 511' : '**NO**')}`;
    });
    rows.push(`| ${v} | ${cells.join(' | ')} |`);
  }
  stats.push({ id: g.id, same, n });
  lines.push(`#### ${g.id}  (${same} of ${n} cells the same)`, '', `Fusion's rule: ${t.rule}`, '');
  lines.push(`Verdict: ${t.verdict}.`, '');
  if (t.fix) lines.push(`Proposed fix: ${t.fix}`, '');
  const head = orders.map(o => `${o} Fusion | ${o} ours | ${o} same`).join(' | ');
  lines.push(`| variant | ${head} |`, `|---|${orders.map(() => '---|---|---').join('|')}|`, ...rows, '');
}
const summary = ['| constraint / dimension | cells | same as Fusion |', '|---|---|---|', ...stats.map(s => `| ${s.id} | ${s.n} | ${s.same} |`)].join('\n');
const total = stats.reduce((a, s) => ({ n: a.n + s.n, same: a.same + s.same }), { n: 0, same: 0 });
const out = [`<!-- which-moves:begin -->`, '', `Fusion ${fx.fusion}, recorded ${fx.date}; ${total.n} cells, ${total.same} identical, ${total.n - total.same} differ (all KNOWN in tests/fixtures/fusion-oracle/which-moves-known.json). Data: tests/fixtures/fusion-oracle/which-moves.json (before / after coordinates in mm of every entity, per cell).`, '', summary, '', ...lines, `<!-- which-moves:end -->`].join('\n');
const docPath = path.join(ROOT, 'docs/FUSION-COMPARISON.md');
let doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : null;
if (!doc) { console.error('docs/FUSION-COMPARISON.md missing: create it with the markers first'); process.exit(1); }
doc = doc.replace(/<!-- which-moves:begin -->[\s\S]*<!-- which-moves:end -->/, () => out);
fs.writeFileSync(docPath, doc);
console.log(`wrote ${total.n} cells`);
