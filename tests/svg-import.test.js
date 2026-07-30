import { parseLength, computeImportScale, computeImportSize, parsePoints, parsePathSubpaths, importSvgGeometry, parseTransform, multiplyMatrix, applyMatrix, linearScaleOf, IDENTITY_MATRIX } from '#core/svg-import.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
  const genJ = () => { let n = 0; return () => 'j' + (n++); };

  // 1. parseLength
  {
    assert(parseLength('100mm').value === 100 && parseLength('100mm').unit === 'mm', 'parseLength mm');
    assert(parseLength('2in').unit === 'in' && parseLength('2in').value === 2, 'parseLength in');
    assert(parseLength('50').unit === '' && parseLength('50').value === 50, 'parseLength unitless');
    assert(parseLength('abc') === null, 'parseLength bad → null');
  }

  // 2. computeImportScale — the documented policy
  {
    const a = computeImportScale({ width: '100mm', viewBox: '0 0 100 80' });
    assert(near(a.scale, 1) && a.assumed === false, '100mm / vb100 → 1 mm/unit exact');
    const b = computeImportScale({ width: '100mm', viewBox: '0 0 50 40' });
    assert(near(b.scale, 2) && b.assumed === false, '100mm / vb50 → 2 mm/unit');
    const c = computeImportScale({ width: '2in', viewBox: '0 0 50.8 25.4' });
    assert(near(c.scale, 1), '2in (=50.8mm) / vb50.8 → 1 mm/unit');
    const d = computeImportScale({ viewBox: '0 0 100 80' });
    assert(near(d.scale, 1) && d.assumed === true, 'unitless viewBox → 1 mm/unit assumed');
    const e = computeImportScale({ width: '300px' });
    assert(near(e.scale, 25.4 / 96) && e.assumed === true, 'no viewBox → 96 dpi px assumed');
  }

  // 2b. IMPORT-DOC-SIZE: computeImportSize — the doc extent in mm, derived from the SAME scale as the coords
  {
    const a = computeImportSize({ width: '100mm', height: '80mm', viewBox: '0 0 200 160' });
    assert(near(a.w, 100) && near(a.h, 80), 'physical width + viewBox → exact mm extent');
    const b = computeImportSize({ viewBox: '0 0 210 297' });
    assert(near(b.w, 210) && near(b.h, 297) && b.assumed === true, 'unitless viewBox → 1mm/unit extent (A4)');
    const c = computeImportSize({ width: '800', height: '600' });
    assert(near(c.w, 800 * 25.4 / 96) && near(c.h, 600 * 25.4 / 96), 'no viewBox, unitless → px @ 96 dpi');
    const d = computeImportSize({ width: '100mm', height: '80mm' });
    assert(near(d.w, 100) && near(d.h, 80), 'no viewBox, physical → the physical size IS the viewport');
    // the paper must match the geometry: extent = what the same scale maps the viewBox onto
    const e = computeImportSize({ width: '100mm', viewBox: '0 0 50 40' });
    assert(near(e.scale, 2) && near(e.w, 100) && near(e.h, 80), 'scale 2 mm/unit → 50x40 units = 100x80 mm');
    assert(computeImportSize({}) === null, 'no viewBox + no size → null (host keeps its doc)');
    assert(computeImportSize({ width: '100%', height: '100%' }) === null, '% size → null (unknowable)');
    assert(computeImportSize({ width: '0', height: '0' }) === null, 'zero size → null');
  }

  // 3. parsePoints
  {
    const p = parsePoints('0,0 10,0 10,10');
    assert(p.length === 3 && p[1].x === 10 && p[2].y === 10, 'parsePoints');
  }

  // 4. parsePathSubpaths — M/L/Z, bézier flatten, multi-subpath
  {
    const a = parsePathSubpaths('M0 0 L10 0 L10 10 Z');
    assert(a.subpaths.length === 1 && a.subpaths[0].closed && a.subpaths[0].pts.length === 3, 'M/L/Z closed triangle');
    const b = parsePathSubpaths('M0 0 C0 10 10 10 10 0');
    assert(b.subpaths.length === 1 && b.subpaths[0].pts.length > 3, 'cubic flattened to many points');
    const c = parsePathSubpaths('M0 0 L5 5 M20 20 L25 25');
    assert(c.subpaths.length === 2, 'two subpaths');
    const d = parsePathSubpaths('m0 0 l10 0 l0 10 z'); // relative
    assert(d.subpaths[0].pts.length === 3 && d.subpaths[0].pts[2].x === 10 && d.subpaths[0].pts[2].y === 10, 'relative l');
    // UNREGRESSED: the M/L/C/Q/Z flatten counts are exactly what they were (1 start + 16 per bézier), and a path
    // without S/T/A reports nothing skipped.
    assert(parsePathSubpaths('M0 0 C0 10 10 10 10 0').subpaths[0].pts.length === 17, 'cubic = 1 + 16 points');
    assert(parsePathSubpaths('M0 0 Q5 10 10 0').subpaths[0].pts.length === 17, 'quad = 1 + 16 points');
    assert(parsePathSubpaths('M0 0 L10 0 L10 10 Z').skipped.length === 0, 'M/L/Z path skips nothing');
  }

  // 4b. IMPORT-2B-3: S/T reflect the previous control point; A is a REAL elliptical arc (all three were chords)
  {
    const ys = (r) => r.subpaths.flatMap((s) => s.pts.map((p) => p.y));
    const xs = (r) => r.subpaths.flatMap((s) => s.pts.map((p) => p.x));

    // --- A: a semicircle (0,0)→(10,0), rx=ry=5 ⇒ centre (5,0), r=5. Sampled ON the circle, not chorded. ---
    const a = parsePathSubpaths('M0 0 A5 5 0 0 1 10 0');
    assert(a.skipped.length === 0, 'A no longer flagged as skipped');
    const ap = a.subpaths[0].pts;
    assert(ap.length === 1 + 32, 'π sweep = 32 segments (16 per quadrant)');
    assert(ap.every((p) => near(Math.hypot(p.x - 5, p.y - 0), 5, 1e-9)), 'every arc point lies ON the circle');
    assert(near(ap[ap.length - 1].x, 10) && near(ap[ap.length - 1].y, 0), 'arc ends at its endpoint');
    // the SWEEP flag picks which of the two arcs — opposite bulge, and NOT a chord either way. (Signs verified
    // against the BROWSER's own SVGGeometryElement sampling: sweep=1 bulges −y, sweep=0 bulges +y.)
    assert(near(Math.min(...ys(parsePathSubpaths('M0 0 A5 5 0 0 1 10 0'))), -5), 'sweep=1 bulges −y');
    assert(near(Math.max(...ys(parsePathSubpaths('M0 0 A5 5 0 0 0 10 0'))), 5), 'sweep=0 bulges +y');
    // the LARGE-ARC flag: same endpoints + r=8 ⇒ the long way round sweeps far further (−1.76 vs −14.24)
    const small = Math.min(...ys(parsePathSubpaths('M0 0 A8 8 0 0 1 10 0')));
    const large = Math.min(...ys(parsePathSubpaths('M0 0 A8 8 0 1 1 10 0')));
    assert(near(small, -1.755, 1e-3) && large < small - 5, 'large-arc=1 takes the long way round');
    // x-axis-rotation on a non-circular arc actually rotates it (rx10/ry4 turned 90° = a far deeper sweep)
    const rot0 = Math.min(...ys(parsePathSubpaths('M0 0 A10 4 0 0 1 12 0')));
    const rot90 = Math.min(...ys(parsePathSubpaths('M0 0 A10 4 90 0 1 12 0')));
    assert(near(rot0, -0.8, 1e-9) && near(rot90, -15, 1e-9), 'x-axis-rotation rotates the ellipse');
    // spec degeneracies, reported not silent
    const coin = parsePathSubpaths('M5 5 A5 5 0 0 1 5 5');
    assert(/coincident/.test(coin.skipped[0].reason), 'coincident endpoints → omitted + flagged');
    const zero = parsePathSubpaths('M0 0 A0 5 0 0 1 10 0');
    assert(/zero radius/.test(zero.skipped[0].reason) && zero.subpaths[0].pts.length === 2, 'zero radius → line + flagged');
    // out-of-range radii are GROWN (F.6.6) rather than dropped: r=1 can't span 10, so it becomes a 5-radius semicircle
    const grown = parsePathSubpaths('M0 0 A1 1 0 0 1 10 0');
    assert(grown.subpaths[0].pts.every((p) => near(Math.hypot(p.x - 5, p.y), 5, 1e-9)), 'too-small radii grown to fit');
    // GLUED flags ("011" is ONE token to the scanner) must parse identically to spaced ones — SVGO/Illustrator emit this
    const glued = parsePathSubpaths('M0 0 A5 5 0 011 0'), spaced = parsePathSubpaths('M0 0 A5 5 0 0 1 1 0');
    assert(JSON.stringify(glued) === JSON.stringify(spaced), 'glued arc flags parse identically to spaced');

    // --- S: reflection of the previous cubic's 2nd control point ---
    // C(0,0)(0,5)(5,5)(5,0) peaks at y=15·t(1−t)=3.75; S reflects (5,5)→(5,−5) so the second half MIRRORS it.
    const s = parsePathSubpaths('M0 0 C0 5 5 5 5 0 S10 -5 10 0');
    assert(s.skipped.length === 0, 'S no longer flagged');
    assert(s.subpaths[0].pts.length === 1 + 16 + 16, 'S flattens as a full cubic (16 segments), not a chord');
    assert(near(Math.max(...ys(s)), 3.75) && near(Math.min(...ys(s)), -3.75), 'S mirrors the previous cubic exactly');
    // after a NON-cubic, S's first control point collapses to the current point (spec): the cubic is then
    // (5,0)(5,0)(10,−5)(10,0), whose true extremum −20/9 falls between two flatten samples ⇒ −2.2156.
    const s2 = parsePathSubpaths('M0 0 L5 0 S10 -5 10 0');
    assert(near(Math.min(...ys(s2)), -2.2156, 1e-3), 'S after a line: control = current point');

    // --- T: reflection of the previous quad's control point ---
    // Q ctrl (5,5) peaks at y=2.5; T's ctrl = reflect about (10,0) = (15,−5) ⇒ trough −2.5.
    const t = parsePathSubpaths('M0 0 Q5 5 10 0 T20 0');
    assert(t.skipped.length === 0, 'T no longer flagged');
    assert(t.subpaths[0].pts.length === 1 + 16 + 16, 'T flattens as a full quad');
    assert(near(Math.max(...ys(t)), 2.5) && near(Math.min(...ys(t)), -2.5), 'T mirrors the previous quad exactly');
    assert(near(Math.max(...xs(t)), 20), 'T reaches its endpoint');
    // T after a non-quad → control = current point ⇒ a straight run (all y = 0)
    assert(parsePathSubpaths('M0 0 L5 0 T15 0').subpaths.flatMap((p) => p.pts).every((p) => near(p.y, 0)), 'T after a line is straight');

    // relative s/t/a work off the current point
    const rel = parsePathSubpaths('m0 0 c0 5 5 5 5 0 s5 -5 5 0');
    assert(near(Math.max(...xs(rel)), 10) && near(Math.min(...ys(rel)), -3.75), 'relative s mirrors + lands at x=10');
    const ra = parsePathSubpaths('m0 0 a5 5 0 0 1 10 0');
    assert(ra.subpaths[0].pts.every((p) => near(Math.hypot(p.x - 5, p.y), 5, 1e-9)), 'relative a = the same arc');
  }

  // 5. importSvgGeometry — the declared element mapping → STATIC joints/shapes
  {
    const descs = [
      { tag: 'rect', x: 0, y: 0, width: 40, height: 30 },
      { tag: 'circle', cx: 10, cy: 20, r: 5 },
      { tag: 'polyline', points: '0,0 10,0 10,10' },
      { tag: 'path', d: 'M0 0 L10 0 L10 10 Z' },
    ];
    const { joints, shapes, stats } = importSvgGeometry(descs, { genJ: genJ(), scale: 1 });
    // rect → 4 lines + 4 joints; circle → 1 circle + 1 joint; polyline(3) → 2 lines + 3 joints; path(3,closed) → 3 lines + 3 joints
    const lines = shapes.filter((s) => s.type === 'line'), circles = shapes.filter((s) => s.type === 'circle');
    assert(lines.length === 4 + 2 + 3 && circles.length === 1, 'shape counts (lines + 1 circle)');
    assert(joints.length === 4 + 1 + 3 + 3, 'joint counts');
    assert(circles[0].joints.length === 1 && circles[0].radius === 5, 'circle = center joint + radius field');
    // STATIC: no constraints anywhere; shapes carry no H/V/coincident
    assert(stats && !('constraints' in { joints, shapes, stats }), 'no constraints returned');
    assert(shapes.every((s) => s.type === 'line' ? s.joints.length === 2 : true), 'lines are plain 2-joint');
    // the rect is a closed loop (4 lines share 4 joints — first line starts at (0,0))
    const j0 = joints.find((j) => j.id === lines[0].joints[0]);
    assert(j0.x === 0 && j0.y === 0, 'rect first corner at origin');
  }

  // 6. scale applies to coords + radius
  {
    const { joints, shapes } = importSvgGeometry([{ tag: 'rect', x: 0, y: 0, width: 10, height: 10 }, { tag: 'circle', cx: 5, cy: 5, r: 2 }], { genJ: genJ(), scale: 2 });
    const maxX = Math.max(...joints.map((j) => j.x));
    assert(maxX === 20, 'rect scaled ×2 (10 → 20)');
    assert(shapes.find((s) => s.type === 'circle').radius === 4, 'radius scaled ×2');
  }

  // 7. unsupported element → flagged, not silently dropped (IMPORT-2B-2: <ellipse> is now SUPPORTED)
  {
    const { shapes, stats } = importSvgGeometry([{ tag: 'text' }], { genJ: genJ() });
    assert(shapes.length === 0 && stats.skipped.length === 1 && stats.skipped[0].tag === 'text', 'text flagged');
  }

  // 7b. IMPORT-2B-2: <ellipse> → a closed polyline ring at the pipeline's curve density
  {
    const { joints, shapes, stats } = importSvgGeometry([{ tag: 'ellipse', cx: 10, cy: 20, rx: 5, ry: 3 }], { genJ: genJ(), scale: 1 });
    assert(stats.skipped.length === 0, 'ellipse no longer flagged as unsupported');
    assert(joints.length === 64, 'ellipse sampled at 64 points (16 per bézier-quadrant)');
    assert(shapes.length === 64 && shapes.every((s) => s.type === 'line'), 'ellipse = a closed ring of 64 lines');
    // the ring's extent is exactly the ellipse's bbox, centred on (cx,cy)
    const xs = joints.map((j) => j.x), ys = joints.map((j) => j.y);
    assert(near(Math.min(...xs), 5) && near(Math.max(...xs), 15), 'ellipse x spans cx±rx');
    assert(near(Math.min(...ys), 17) && near(Math.max(...ys), 23), 'ellipse y spans cy±ry');
    // CLOSED: the last line returns to the first joint
    assert(shapes[63].joints[1] === shapes[0].joints[0], 'ring is closed (last → first)');
    // every sampled point satisfies the ellipse equation
    assert(joints.every((j) => near(((j.x - 10) / 5) ** 2 + ((j.y - 20) / 3) ** 2, 1, 1e-9)), 'points lie ON the ellipse');
    // rx/ry="auto" (SVG2) → use the other radius; a 0 radius is not rendered → flagged
    const a = importSvgGeometry([{ tag: 'ellipse', cx: 0, cy: 0, rx: 4 }], { genJ: genJ(), scale: 1 });
    assert(a.joints.length === 64 && near(Math.max(...a.joints.map((j) => j.y)), 4), 'missing ry → ry=rx (circle-like)');
    const z = importSvgGeometry([{ tag: 'ellipse', cx: 0, cy: 0, rx: 0, ry: 0 }], { genJ: genJ(), scale: 1 });
    assert(z.shapes.length === 0 && /zero radius/.test(z.stats.skipped[0].reason), 'zero-radius ellipse flagged');
    // scale + a ctm both apply (the ring is minted through the same J() as every other element)
    const s2 = importSvgGeometry([{ tag: 'ellipse', cx: 0, cy: 0, rx: 5, ry: 5 }], { genJ: genJ(), scale: 2 });
    assert(near(Math.max(...s2.joints.map((j) => j.x)), 10), 'ellipse scaled ×2');
    const ct = importSvgGeometry([{ tag: 'ellipse', ctm: parseTransform('translate(100,0)'), cx: 0, cy: 0, rx: 5, ry: 5 }], { genJ: genJ(), scale: 1 });
    assert(near(Math.max(...ct.joints.map((j) => j.x)), 105), 'ellipse baked by the ctm');
  }

  // 8. GRIEVANCE-2: parseTransform primitives → the 2x3 matrix [a,b,c,d,e,f]
  {
    const nearM = (m, e) => m.every((v, i) => near(v, e[i]));
    assert(nearM(parseTransform('translate(10,20)'), [1, 0, 0, 1, 10, 20]), 'translate');
    assert(nearM(parseTransform('translate(5)'), [1, 0, 0, 1, 5, 0]), 'translate 1-arg (ty=0)');
    assert(nearM(parseTransform('scale(2,3)'), [2, 0, 0, 3, 0, 0]), 'scale xy');
    assert(nearM(parseTransform('scale(2)'), [2, 0, 0, 2, 0, 0]), 'scale 1-arg (uniform)');
    assert(nearM(parseTransform('matrix(1,2,3,4,5,6)'), [1, 2, 3, 4, 5, 6]), 'matrix passthrough');
    const r90 = parseTransform('rotate(90)'); const rp = applyMatrix(r90, 1, 0);
    assert(near(rp.x, 0) && near(rp.y, 1), 'rotate(90): (1,0) maps to (0,1)');
    assert(parseTransform('') === IDENTITY_MATRIX, 'empty transform gives identity');
    assert(nearM(parseTransform('wobble(3)'), [1, 0, 0, 1, 0, 0]), 'unknown primitive skipped (identity)');
  }

  // 9. compose (parent-then-child) + linearScaleOf
  {
    const m = multiplyMatrix(parseTransform('translate(100,0)'), parseTransform('scale(2)'));
    const p = applyMatrix(m, 3, 4);
    assert(near(p.x, 106) && near(p.y, 8), 'compose translate then scale: (3,4) maps to (106,8)');
    assert(near(linearScaleOf(parseTransform('scale(0.1,-0.1)')), 0.1), 'linearScaleOf(scale 0.1,-0.1) = 0.1');
    assert(near(linearScaleOf(IDENTITY_MATRIX), 1), 'linearScaleOf(identity) = 1');
  }

  // 10. THE REAL potrace transform (the exact string 2462889.svg emits) — the user's empty-import bug
  {
    const nearM = (m, e) => m.every((v, i) => near(v, e[i]));
    const T = parseTransform('translate(0.000000,930.000000) scale(0.100000,-0.100000)');
    assert(nearM(T, [0.1, 0, 0, -0.1, 0, 930]), 'potrace CTM = [0.1,0,0,-0.1,0,930]');
    // first path start M4402 8990 -> inside the 1280 x 930 viewBox, un-flipped (near the top). Was 10x off before.
    const q = applyMatrix(T, 4402, 8990);
    assert(near(q.x, 440.2) && near(q.y, 31), 'potrace maps (4402,8990) to (440.2, 31) in viewBox space');
  }

  // 11. importSvgGeometry BAKES a per-descriptor ctm (coords + radius); no ctm = identity = byte-identical
  {
    const ctm = multiplyMatrix(parseTransform('translate(5,5)'), parseTransform('scale(2)'));
    const { joints, shapes } = importSvgGeometry([{ tag: 'rect', ctm, x: 0, y: 0, width: 10, height: 10 }], { genJ: genJ(), scale: 1 });
    const xs = joints.map((j) => j.x), ys = joints.map((j) => j.y);
    assert(Math.min(...xs) === 5 && Math.max(...xs) === 25, 'rect X baked by ctm (5..25)');
    assert(Math.min(...ys) === 5 && Math.max(...ys) === 25, 'rect Y baked by ctm (5..25)');
    assert(shapes.filter((s) => s.type === 'line').length === 4, 'rect is still 4 lines');
    const cg = importSvgGeometry([{ tag: 'circle', ctm: parseTransform('scale(2)'), cx: 0, cy: 0, r: 3 }], { genJ: genJ(), scale: 1 });
    assert(cg.shapes[0].radius === 6, 'circle radius baked by linearScaleOf (3 -> 6)');
    const nc = importSvgGeometry([{ tag: 'rect', x: 0, y: 0, width: 4, height: 4 }], { genJ: genJ(), scale: 1 });
    assert(Math.max(...nc.joints.map((j) => j.x)) === 4, 'no ctm gives identity (coords unchanged)');
  }

  console.log('svg-import tests passed ✅');
})().catch((e) => { console.error('svg-import tests failed ❌', e); process.exit(1); });
