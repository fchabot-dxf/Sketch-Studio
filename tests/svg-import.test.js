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
    const e = parsePathSubpaths('M0 0 A5 5 0 0 1 10 0'); // arc → flagged + line
    assert(e.skipped.some((s) => /arc/i.test(s.reason)), 'A flagged as skipped');
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

  // 7. unsupported element → flagged, not silently dropped
  {
    const { shapes, stats } = importSvgGeometry([{ tag: 'ellipse', cx: 0, cy: 0, rx: 5, ry: 3 }, { tag: 'text' }], { genJ: genJ() });
    assert(shapes.length === 0 && stats.skipped.length === 2, 'ellipse + text both flagged');
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
