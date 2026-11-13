// tests/angle-sector-old-files.test.js -- TASK 553: documents saved BEFORE the angle dimension stored its sector (no `sector`; task 543's
// `supplement` flag on some) load, look and behave exactly as they did. The documents and what the build that wrote them (main 01000da)
// did with them are recorded in tests/fixtures/angle-dimension/legacy-angles.json: the angle dimension of the audit drawings that have one
// (d4-triangle), the owner's angle document, and two lines dimensioned by the Dimension tool's placing path in each of the four sectors
// (joint orders both ways, separate and shared vertex, driving and reference, typed to 190 / 270 on main). Measured the same way on both
// builds by tests/harness/angle-legacy.js: the drawn arc and label, a solve after load, a +7 / -7 degree edit of every driving angle
// (from a fresh load each), and a seeded jitter + re-solve.
// Geometry is identical everywhere (load, every edit, jitter). TWO known differences in the drawing, on purpose:
//  1. a driving angle typed past 180 on main drew the <= 180 sector of the other pair under its label (arc 170, label "190.0°"); it now
//     draws the sector of its value (190 / 270, the label inside it);
//  2. after an edit main chose between the two sectors of the value's span by where the label had been left (pinned below); the stored
//     sector stays on its rays.
import assert from 'node:assert';
import fs from 'node:fs';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const mods = {
  createEngine: (await import('../packages/core/constraint-solver.js')).createEngine,
  createSketchState: (await import('../packages/ui/sketch-state.js')).createSketchState,
  deserializeDocument: (await import('../packages/core/document.js')).deserializeDocument,
  draw: (await import('../packages/ui/svg-renderer.js')).draw,
  commitDimensionEdit: (await import('../packages/ui/dimension-seams.js')).commitDimensionEdit,
};
const { outcomesOf } = await import('./harness/angle-legacy.js');
const { measureResidual } = await import('../packages/core/constraint-verifier.js');
const { serializeDocument, validateDocument } = await import('../packages/core/document.js');

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/angle-dimension/legacy-angles.json', import.meta.url), 'utf8'));
const TOL = 1e-9;
const quiet = (f) => { const e = console.error, w = console.warn, l = console.log; console.error = console.warn = console.log = () => {}; try { return f(); } finally { console.error = e; console.warn = w; console.log = l; } };
const worstJoints = (a, b) => {
  // TASK 554: a document saved WITHOUT j_origin (the owner's) now loads with it (fixed at 0,0, nothing attached); main had no such joint
  if (a.some((x) => x[0] === 'j_origin') && !b.some((x) => x[0] === 'j_origin')) {
    const o = a.find((x) => x[0] === 'j_origin');
    assert(o[1] === 0 && o[2] === 0, 'the added origin stays at (0, 0): ' + JSON.stringify(o));
    a = a.filter((x) => x[0] !== 'j_origin');
  }
  assert.strictEqual(a.length, b.length, 'joint count');
  let w = 0;
  a.forEach((x, i) => { assert.strictEqual(x[0], b[i][0], 'joint ids'); w = Math.max(w, Math.abs(x[1] - b[i][1]), Math.abs(x[2] - b[i][2])); });
  return w;
};
const worstArc = (a, b) => {
  if (!a || !b) { assert.strictEqual(a, b, 'arc drawn on one build only'); return 0; }
  assert.strictEqual(a.large, b.large, 'large-arc flag');
  return Math.max(...['sx', 'sy', 'r', 'ex', 'ey'].map((k) => Math.abs(a[k] - b[k])));
};
// the CCW span (degrees) of a drawn arc about the vertex its two ends and radius give, and whether a point lies inside it
const spanOf = (arc, glyph) => {
  // the centre: the point at distance r from both ends on the side that makes the arc go counter-clockwise from start to end with this flag
  const mx = (arc.sx + arc.ex) / 2, my = (arc.sy + arc.ey) / 2, hx = arc.ex - arc.sx, hy = arc.ey - arc.sy, h = Math.hypot(hx, hy) / 2;
  const d = Math.sqrt(Math.max(0, arc.r * arc.r - h * h)), nx = -hy / (2 * h), ny = hx / (2 * h);
  const side = arc.large ? -1 : 1;
  const cx = mx + side * nx * d, cy = my + side * ny * d;
  const a0 = Math.atan2(arc.sy - cy, arc.sx - cx), a1 = Math.atan2(arc.ey - cy, arc.ex - cx), n = (x) => ((x % 360) + 360) % 360;
  const span = n((a1 - a0) * 180 / Math.PI), off = glyph ? n((Math.atan2(glyph.y - cy, glyph.x - cx) - a0) * 180 / Math.PI) : null;
  return { span, labelInside: off !== null && off <= span };
};

let docs = 0, angles = 0, edits = 0, past180 = 0, supplements = 0;
let worst = { arc: 0, load: 0, edit: 0, jitter: 0 };
const flips = [];
for (const d of fx.docs) {
  const now = quiet(() => outcomesOf(d.doc, mods));
  const was = d.main;
  const typedPast180 = / typed (190|270) on main$/.test(d.name);
  supplements += d.doc.geometry.constraints.filter((c) => c.type === 'angle' && c.supplement === true).length;
  // look: the same arcs, label text and label spot
  assert.strictEqual(now.angles.length, was.angles.length, `${d.name}: angle count`);
  now.angles.forEach((a, i) => {
    const b = was.angles[i];
    assert.strictEqual(a.value, b.value, `${d.name}: angle ${i} value`);
    assert.strictEqual(a.driven, b.driven, `${d.name}: angle ${i} driving / reference`);
    assert.strictEqual(a.text, b.text, `${d.name}: angle ${i} label text`);
    if (typedPast180) {
      // the known difference: main drew 360 - value; now the arc spans the value and the label sits inside it
      const s = spanOf(a.arc, a.glyph), old = spanOf(b.arc, b.glyph);
      assert(Math.abs(old.span - (360 - b.value)) < 1e-6, `${d.name}: main drew ${old.span}, the other pair's sector`);
      assert(Math.abs(s.span - a.value) < 1e-6 && s.labelInside, `${d.name}: now the arc spans ${s.span} (value ${a.value}), label inside: ${s.labelInside}`);
      past180++;
      return;
    }
    const w = worstArc(a.arc, b.arc);
    assert(w < TOL, `${d.name}: angle ${i} arc differs by ${w}: ${JSON.stringify(a.arc)} vs main ${JSON.stringify(b.arc)}`);
    if (a.glyph || b.glyph) worst.arc = Math.max(worst.arc, w, Math.abs(a.glyph.x - b.glyph.x), Math.abs(a.glyph.y - b.glyph.y));
    else worst.arc = Math.max(worst.arc, w);
    angles++;
  });
  // behave: a solve after load, every edit, a jitter re-solve land on the same geometry
  const wl = worstJoints(now.load, was.load);
  assert(wl < TOL, `${d.name}: after load + solve the geometry differs by ${wl}`);
  worst.load = Math.max(worst.load, wl);
  assert.strictEqual(now.edits.length, was.edits.length, `${d.name}: edit count`);
  now.edits.forEach((e, i) => {
    const f = was.edits[i];
    assert.strictEqual(e.refused, f.refused, `${d.name}: edit to ${e.to} refused ${e.refused}, main ${f.refused}`);
    const we = worstJoints(e.joints, f.joints);
    assert(we < TOL, `${d.name}: the edit to ${e.to} lands ${we} away from main's`);
    if (!typedPast180 && worstArc(e.arc, f.arc) >= TOL) {
      // main picked the arc from where the label was left; when the edit moves the crossing point the label can end up nearer the
      // OPPOSITE sector of the same span, and main drew that one. The stored sector stays on its rays: the vertical opposite of main's.
      const opposite = Math.abs((e.arc.sx + f.arc.sx) - (e.arc.ex + f.arc.ex)) < 1e-6 && Math.abs((e.arc.sy + f.arc.sy) - (e.arc.ey + f.arc.ey)) < 1e-6 && e.arc.large === f.arc.large;
      assert(opposite, `${d.name}: after the edit to ${e.to} the arc differs (not the opposite sector): ${JSON.stringify(e.arc)} vs main ${JSON.stringify(f.arc)}`);
      flips.push(`${d.name} -> ${e.to.toFixed(1)}`);
    }
    worst.edit = Math.max(worst.edit, we);
    edits++;
  });
  const wj = worstJoints(now.jitter, was.jitter);
  assert(wj < TOL, `${d.name}: jitter + re-solve lands ${wj} away from main's`);
  worst.jitter = Math.max(worst.jitter, wj);
  docs++;
}
// the conversion holds the loaded geometry exactly (the row is satisfied where the old one was) and drops `supplement`; every document is
// loaded as written (version 2, the owner's version 1) AND as the other old version (1 <-> 2): both load and convert the same, and the
// next save is version 3 (DOCUMENT_VERSION, task 553: an older build refuses it instead of re-solving its angles modulo 180)
const versions = {};
{
  for (const d of fx.docs) for (const version of [d.doc.version, d.doc.version === 1 ? 2 : 1]) {
    const state = mods.createSketchState((() => { const e = mods.createEngine(null); e.init(); return e; })(), {});
    const res = quiet(() => mods.deserializeDocument({ ...JSON.parse(JSON.stringify(d.doc)), version }, state));
    assert(res.ok, `${d.name} as version ${version}: ${res.reason}`);
    versions[version] = (versions[version] || 0) + 1;
    assert.strictEqual(serializeDocument(state).version, 3, `${d.name}: saved as version 3`);
    for (const c of state.constraints.filter((x) => x.type === 'angle')) {
      assert(!('supplement' in c), `${d.name}: supplement dropped`);
      if (c.isDriven || c.driven) { assert(!('sector' in c), `${d.name}: a reference stores no sector`); continue; }
      assert(c.sector && [c.sector.ray1, c.sector.ray2, c.sector.turn].every((x) => x === 1 || x === -1), `${d.name}: a driving angle has a sector`);
      assert(measureResidual(c, state.joints, state.shapes) < 1e-9, `${d.name}: the converted sector holds the loaded geometry (residual ${measureResidual(c, state.joints, state.shapes)})`);
    }
  }
}
assert(versions[1] === fx.docs.length && versions[2] === fx.docs.length && fx.docs.some((d) => d.doc.version === 1) && fx.docs.some((d) => d.doc.version === 2), `version 1 and 2 documents load and convert: ${JSON.stringify(versions)}`);
assert(!validateDocument({ version: 4, geometry: {} }).ok && validateDocument({ version: 3, geometry: {} }).ok, 'version 3 is this build; a newer one is refused');
assert(docs === fx.docs.length && fx.docs.some((d) => d.name === 'owner-trapezoid-angle') && fx.docs.some((d) => /d4-triangle/.test(d.name)), 'every recorded document checked');
// the second known difference (6 edits, pinned): two SEPARATE lines (no shared vertex) whose 10 degree dimension sits in the -u/-v sector,
// edited to 3: the crossing point moves away and main's label, left where it was, ended up nearer the +u/+v sector, so main drew that one
// (the arc jumped to the other side of the crossing); the stored sector keeps it on the rays it measures.
assert.strictEqual(flips.length, 6, `edits whose arc main moved to the opposite sector: ${flips.length}\n  ${flips.join('\n  ')}`);
assert(flips.every((f) => !/shared/.test(f)), 'only separate lines: ' + flips.join(', '));
assert(supplements > 0 && past180 > 0, 'documents with supplement and values past 180 are covered');
console.log(`angle-sector-old-files: ${docs} old documents (${supplements} angles with supplement), ${angles} angles drawn the same (worst ${worst.arc.toExponential(1)}), ${past180} typed past 180 now drawn in their own sector, ${flips.length} edits drawn on their own rays where main jumped to the opposite sector, ${edits} edits + load + jitter land on main's geometry (worst load ${worst.load.toExponential(1)}, edit ${worst.edit.toExponential(1)}, jitter ${worst.jitter.toExponential(1)}).`);
