// tests/fusion-addin-import.test.js — TASK 478: the owner's REAL files from Shaper's Fusion add-in ("Generator: Fusion 360, Shaper Origin
// Export Add-In 1.9.0"): width/height + viewBox in cm, six <path>s each with transform="matrix(1,0,0,-1,...)" (a Y flip), NO shaper:cutType;
// the cut type is the FILL colour only (black = outside, three DIFFERENT greys = pockets), shaper:cutDepth in cm, and one compound path
// (an outer rectangle + an inner profile) = a pocket with a hole. The second file has the pocket profile's fillets as circular SVG `A` arcs.
// Host DOM extraction is replaced by a tiny attribute reader here; everything else is the real code path (extractCutRecord ->
// importSvgGeometry -> assignImportedCuts).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { computeImportScale, importSvgGeometry, multiplyMatrix, parseTransform, IDENTITY_MATRIX } from '#core/svg-import.js';
import { extractCutRecord, classify } from '../apps/shaper/src/shaper.js';
import { assignImportedCuts, planStockProfile } from '../apps/shaper/src/cut-plan.js';
import { findLoops } from '#core/loop-finder.js';
import { arcSweepInfo } from '#core/geometry.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const dir = path.resolve(import.meta.dirname, 'fixtures', 'svg');

function load(file) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const root = attrsOf(/<svg\b([^>]*)>/.exec(text)[1]);
  const els = [...text.matchAll(/<path\b([^>]*)\/>/g)].map((m) => attrsOf(m[1]));
  const { scale } = computeImportScale({ width: root.width, height: root.height, viewBox: root.viewBox });
  let seq = 0;
  const descs = els.map((a, i) => {
    const el = { getAttribute: (n) => (n in a ? a[n] : null), getAttributeNS: () => null };
    return { tag: 'path', d: a.d, ctm: a.transform ? multiplyMatrix(IDENTITY_MATRIX, parseTransform(a.transform)) : IDENTITY_MATRIX, descId: 'desc_' + i, cutRecord: extractCutRecord(el, 'cm'), el };
  });
  let n = 0;
  const geo = importSvgGeometry(descs, { genJ: () => 'j' + (n++), scale, idPrefix: 'svg0' });
  const joints = new Map(geo.joints.map((j) => [j.id, { x: j.x, y: j.y }]));
  const state = { joints, shapes: geo.shapes, constraints: [], profiles: [], genJ: () => 'jx' + (seq++) };
  return { text, root, descs, geo, state, scale };
}

// ── classification: rgb() and hex forms, one declared tolerance (not a list of these values) ──
{
  const el = (fill, stroke) => ({ getAttribute: (n) => ({ fill, stroke })[n] || null, getAttributeNS: () => null });
  assert.strictEqual(classify(el('rgb(0,0,0)', null)), 'exterior', 'black fill = outside');
  for (const g of ['rgb(121,121,121)', 'rgb(134,134,134)', 'rgb(106,106,106)', '#7F7F7F', 'rgb(100, 102, 99)', 'rgb(200,200,200)']) assert.strictEqual(classify(el(g, null)), 'pocket', g + ' is a pocket (any grey)');
  assert.strictEqual(classify(el('rgb(255,255,255)', 'rgb(0,0,0)')), 'interior', 'white fill + black stroke = inside (rgb form)');
  assert.strictEqual(classify(el('#FFFFFF', '#000000')), 'interior', 'and the hex form');
  assert.strictEqual(classify(el('none', 'rgb(127,127,127)')), 'online', 'grey stroke + no fill = on line');
  assert.strictEqual(classify(el('#0068FF', '#0068FF')), 'guide', 'blue = guide'); assert.strictEqual(classify(el('rgb(0,104,255)', 'rgb(0,104,255)')), 'guide');
  assert.strictEqual(classify(el('rgb(240,240,240)', null)), null, 'a near-white fill is not a cut');
  assert.strictEqual(classify(el('rgb(255,0,0)', null)), null, 'red is not a cut');
  assert.strictEqual(classify(el('none', null)), null);
}

for (const file of ['fusion-shaper-addin.svg', 'fusion-shaper-addin-arcs.svg']) {
  const { descs, geo, state, root } = load(file);
  // the six paths: cut type from the FILL, depth in cm -> mm
  const got = descs.map((d) => [d.cutRecord.cutType, Math.round(d.cutRecord.cutDepth * 1000) / 1000]);
  assert.deepStrictEqual(got, [['exterior', 81.28], ['pocket', 17.78], ['pocket', 17.78], ['pocket', 17.78], ['pocket', 27.94], ['pocket', 5.08]], file + ': per path cut type + depth (mm)');
  // overall size 88.9 x 53.34 mm (8.8900003 cm x 5.3340002 cm), origin at the top-left
  const xs = geo.joints.map((j) => j.x), ys = geo.joints.map((j) => j.y);
  near(Math.min(...xs), 0, 1e-4, 'min x'); near(Math.min(...ys), 0, 1e-4, 'min y');
  near(Math.max(...xs) - Math.min(...xs), 88.9, 1e-3, file + ': width'); near(Math.max(...ys) - Math.min(...ys), 53.34, 1e-3, file + ': height');
  assert.ok(/width="8\.89/.test(root.width ? 'width="' + root.width + '"' : ''), 'physical width in cm');
  // Y orientation: the hexagon pocket (path 5, user x -4.44..-2.03, y -2.04..0.05 under the Y flip) sits at the LEFT, 17.5..38.4 mm from the top
  const hex = state.shapes.filter((s) => s.descId === 'desc_4');
  const hx = hex.flatMap((s) => s.joints.map((id) => state.joints.get(id)));
  near(Math.min(...hx.map((p) => p.x)), 11.432, 1e-2, 'hexagon left'); near(Math.max(...hx.map((p) => p.x)), 35.56, 1e-2, 'hexagon right');
  near(Math.min(...hx.map((p) => p.y)), 17.492, 1e-2, 'hexagon top'); near(Math.max(...hx.map((p) => p.y)), 38.388, 1e-2, 'hexagon bottom');

  // joints are shared: every closed path is a connected loop with NO zero-length closing line (the rect = exactly 4 lines)
  assert.strictEqual(state.shapes.filter((s) => s.descId === 'desc_0').length, 4, 'the outside rectangle is 4 lines, not 4 + a zero-length closer');
  assert.strictEqual(findLoops(state).length, 7, file + ': 7 closed loops (1 outside + 3 simple pockets + hexagon + the compound path\'s 2)');

  // the compound path (path 6, fill-rule nonzero: outer rect + inner profile) = ONE pocket with a HOLE
  const byDesc = new Map(descs.filter((d) => d.cutRecord && d.cutRecord.cutType).map((d) => [d.descId, d.cutRecord]));
  const plan = new Map();
  const n = assignImportedCuts(state, byDesc, plan);
  const keys = [...plan.keys()];
  const prof = keys.filter((k) => k.startsWith('profile:'));
  assert.strictEqual(prof.length, 1, 'the compound path becomes ONE profile'); assert.strictEqual(plan.get(prof[0]).cutType, 'pocket');
  assert.strictEqual(Math.round(plan.get(prof[0]).cutDepth * 1000) / 1000, 5.08);
  assert.strictEqual(state.profiles.length, 1); assert.strictEqual(state.profiles[0].inners.length, 1, 'with ONE hole (the inner profile stays uncut)');
  assert.strictEqual(n, 6, '6 cuts kept: 5 loops + 1 pocket-with-hole'); assert.strictEqual(keys.length, 6);
  assert.strictEqual(keys.filter((k) => k.startsWith('loop:')).length, 5);
  // the hole is the inner profile (14-edge profile, 10 edges after dropping the closing duplicate), the outer is the board-sized rectangle
  const loops = findLoops(state);
  const outer = loops.find((l) => l.id === state.profiles[0].outer), inner = loops.find((l) => l.id === state.profiles[0].inners[0]);
  assert.strictEqual(outer.edges.length, 4); assert.ok(inner.edges.length >= 9, 'the hole is the 10-segment inner profile: ' + inner.edges.length);
  void planStockProfile;
}

// ── the ARCS file: the pocket profile (path 3) = 4 lines + 2 REAL arcs, radius 3.81 mm, closed through shared joints ──
{
  const { descs, geo, state } = load('fusion-shaper-addin-arcs.svg');
  const prof = state.shapes.filter((s) => s.descId === 'desc_2');
  assert.deepStrictEqual([prof.filter((s) => s.type === 'line').length, prof.filter((s) => s.type === 'arc').length], [4, 2], '4 lines + 2 arcs');
  const deg = new Map();
  for (const s of prof) for (const id of (s.type === 'arc' ? [s.joints[1], s.joints[2]] : s.joints)) deg.set(id, (deg.get(id) || 0) + 1);
  assert.ok(deg.size === 6 && [...deg.values()].every((c) => c === 2), 'every vertex joint shared by exactly 2 segments = ONE closed loop');
  const arcs = prof.filter((s) => s.type === 'arc');
  const J = (id) => state.joints.get(id);
  const wantCentres = [[69.180332, 32.483674], [69.180332, 23.396174]]; // (x + 5.588) * 10, (1.798 - y) * 10 of the two fillet centres
  arcs.forEach((a, i) => {
    const [c, s, e] = a.joints.map(J);
    near(c.x, wantCentres[i][0], 1e-3, 'arc centre x'); near(c.y, wantCentres[i][1], 1e-3, 'arc centre y');
    near(Math.hypot(s.x - c.x, s.y - c.y), 3.81, 1e-3, 'radius 3.81 mm at the start'); near(Math.hypot(e.x - c.x, e.y - c.y), 3.81, 1e-3, 'and at the end');
    assert.strictEqual(a.subType, 'CENTER'); assert.strictEqual(arcSweepInfo(c, s, e, { sweep: a.sweep }).large, false);
    // the Y flip (det -1) REVERSES the sweep: the file says sweep-flag 1, the world arc is sweep false; the quarter arc runs the SHORT way
    assert.strictEqual(a.sweep, false, 'sweep reversed by the Y-flipping transform');
    near(arcSweepInfo(c, s, e, { sweep: a.sweep }).span, Math.PI / 2, 1e-6, 'a 90 deg arc, not 270');
  });
  // the same path WITHOUT the flip keeps the file's sweep flag (1)
  let k = 0;
  const noFlip = importSvgGeometry([{ tag: 'path', d: descs[2].d, descId: 'x' }], { genJ: () => 'q' + (k++), scale: 10, idPrefix: 'n' });
  assert.deepStrictEqual(noFlip.shapes.filter((s) => s.type === 'arc').map((s) => s.sweep), [true, true], 'unflipped: sweep stays true');
  assert.strictEqual(noFlip.stats.skipped.length, 0);
  // a NON-circular arc (rx != ry) and a SKEWED transform keep today's flattening, counted
  let m = 0;
  const ell = importSvgGeometry([{ tag: 'path', d: 'M0,0 A10,5 0 0,1 20,0 L20,10 L0,10 z', descId: 'e' }], { genJ: () => 'e' + (m++), scale: 1, idPrefix: 'e' });
  assert.ok(ell.shapes.every((s) => s.type === 'line') && ell.stats.skipped.some((s) => /non-circular/.test(s.reason)), 'elliptical arc: flattened + counted');
  const skew = importSvgGeometry([{ tag: 'path', d: 'M0,0 A5,5 0 0,1 10,0 L10,10 L0,10 z', ctm: [1, 0, 0.5, 1, 0, 0], descId: 's' }], { genJ: () => 's' + (m++), scale: 1, idPrefix: 's' });
  assert.ok(skew.shapes.every((s) => s.type === 'line') && skew.stats.skipped.some((s) => /skewed/.test(s.reason)), 'skewed CTM: flattened + counted');
  const rot = importSvgGeometry([{ tag: 'path', d: 'M0,0 A5,5 0 0,1 10,0 L10,10 L0,10 z', ctm: [0, 1, -1, 0, 0, 0], descId: 'r' }], { genJ: () => 'r' + (m++), scale: 1, idPrefix: 'r' });
  assert.ok(rot.shapes.some((s) => s.type === 'arc'), 'a rotation is a similarity: still a real arc');
}
console.log('fusion-addin-import: ok');
