import { parseLength, computeImportScale, parsePoints, parsePathSubpaths, importSvgGeometry } from '#core/svg-import.js';

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

  console.log('svg-import tests passed ✅');
})().catch((e) => { console.error('svg-import tests failed ❌', e); process.exit(1); });
