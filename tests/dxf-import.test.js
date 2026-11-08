(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { parseDxf, importDxf, importDxfGeometry, looksLikeDxf } = await import('../packages/core/dxf-import.js');
  const { arcSweepInfo } = await import('../packages/core/geometry.js');

  let jn = 0;
  const opts = () => { jn = 0; return { genJ: () => 'j' + (jn++), idPrefix: 't' }; };
  const run = (text) => importDxf(text, opts());
  const jmap = (r) => new Map(r.joints.map((j) => [j.id, j]));

  // Build a minimal ASCII DXF: header units + entity blocks (each an array of [code, value]).
  const dxf = (insunits, ...ents) => {
    const P = [[0, 'SECTION'], [2, 'HEADER']];
    if (insunits != null) P.push([9, '$INSUNITS'], [70, insunits]);
    P.push([0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES']);
    for (const e of ents) P.push(...e);
    P.push([0, 'ENDSEC'], [0, 'EOF']);
    return P.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
  };
  const LINE = (x1, y1, x2, y2) => [[0, 'LINE'], [10, x1], [20, y1], [11, x2], [21, y2]];
  const ARC = (cx, cy, r, a0, a1) => [[0, 'ARC'], [10, cx], [20, cy], [40, r], [50, a0], [51, a1]];
  const CIRCLE = (cx, cy, r) => [[0, 'CIRCLE'], [10, cx], [20, cy], [40, r]];
  const LWP = (closed, verts) => [[0, 'LWPOLYLINE'], [90, verts.length], [70, closed ? 1 : 0], ...verts.flatMap(([x, y, b]) => [[10, x], [20, y], ...(b ? [[42, b]] : [])])];

  // 1. Units: an inch file lands 25.4x a mm file; missing/0 = mm and flagged assumed.
  const ents = [LINE(0, 0, 10, 0), CIRCLE(5, 5, 2)];
  const mm = run(dxf(4, ...ents)), inch = run(dxf(1, ...ents)), none = run(dxf(null, ...ents)), zero = run(dxf(0, ...ents));
  assert(mm.stats.assumed === false && inch.stats.assumed === false, 'declared units are not assumed');
  assert(near(inch.joints[1].x / mm.joints[1].x, 25.4), 'inch is 25.4x mm');
  assert(near(inch.shapes[1].radius / mm.shapes[1].radius, 25.4), 'inch radius is 25.4x mm');
  assert(near(run(dxf(5, ...ents)).joints[1].x, 100) && near(run(dxf(6, ...ents)).joints[1].x, 10000) && near(run(dxf(2, ...ents)).joints[1].x, 3048), 'cm / m / ft scales');
  assert(none.stats.assumed === true && zero.stats.assumed === true && near(none.joints[1].x, 10), 'missing / 0 $INSUNITS = mm, assumed');

  // 2. Y flip: DXF Y-up -> world Y-down, asymmetric shape stays the right way up.
  const tri = run(dxf(4, LINE(0, 0, 10, 0), LINE(10, 0, 0, 30)));
  const tj = jmap(tri), l0 = tri.shapes[0].joints.map((id) => tj.get(id));
  assert(near(l0[0].y, 0) && near(l0[1].x, 10), 'line endpoints carried');
  assert(near(tj.get(tri.shapes[1].joints[1]).y, -30), 'a point at DXF y=+30 lands at world y=-30 (up on a Y-down canvas)');

  // 3. ARC -> #core arc: [centre, start, end], CENTER, explicit flags, exact centre / radius / sweep.
  const a = run(dxf(4, ARC(10, 20, 5, 0, 90)));
  const arc = a.shapes[0], aj = jmap(a);
  assert(arc.type === 'arc' && arc.subType === 'CENTER' && arc.joints.length === 3, 'arc shape');
  const [c, s, e] = arc.joints.map((id) => aj.get(id));
  assert(near(c.x, 10) && near(c.y, -20), 'arc centre');
  assert(near(Math.hypot(s.x - c.x, s.y - c.y), 5) && near(Math.hypot(e.x - c.x, e.y - c.y), 5), 'arc radius at both ends');
  assert(near(s.x, 15) && near(s.y, -20) && near(e.x, 10) && near(e.y, -25), 'arc start at 0deg, end at 90deg (flipped)');
  assert(arc.sweep === false && arc.largeArc === false, 'CCW in DXF = sweep false on the Y-down canvas');
  const info = arcSweepInfo(c, s, e, { largeArc: arc.largeArc, sweep: arc.sweep });
  assert(near(info.span, Math.PI / 2) && info.dir === -1, 'core sweep info = 90deg');
  const big = run(dxf(4, ARC(0, 0, 5, 270, 90))).shapes[0];       // wraps through 0: 180deg; and a 270deg one
  assert(run(dxf(4, ARC(0, 0, 5, 45, 315))).shapes[0].largeArc === true, 'span > 180 = largeArc');
  const w = run(dxf(4, ARC(0, 0, 5, 300, 60))), wj = jmap(w), ws = w.shapes[0];
  assert(near(arcSweepInfo(...ws.joints.map((id) => wj.get(id)), { largeArc: ws.largeArc, sweep: ws.sweep }).span, Math.PI * 2 / 3), 'angle wrap 300->60 = 120deg');
  assert(big.type === 'arc', 'half arc imports');

  // 4. LWPOLYLINE with a bulge: line + arc, CLOSED through shared joints.
  const loop = run(dxf(4, LWP(true, [[0, 0], [20, 0, 0.5], [20, 20], [0, 20]])));
  assert(loop.shapes.length === 4 && loop.shapes.filter((x) => x.type === 'arc').length === 1, 'bulge loop = 3 lines + 1 arc');
  const deg = new Map();
  for (const sh of loop.shapes) { const ends = sh.type === 'arc' ? [sh.joints[1], sh.joints[2]] : sh.joints; for (const id of ends) deg.set(id, (deg.get(id) || 0) + 1); }
  assert(deg.size === 4 && [...deg.values()].every((n) => n === 2), 'every vertex joint shared by exactly 2 shapes = a closed loop');
  const bArc = loop.shapes.find((x) => x.type === 'arc'), bj = jmap(loop);
  const [bc, bs, be] = bArc.joints.map((id) => bj.get(id));
  const rr = Math.hypot(bs.x - bc.x, bs.y - bc.y);
  assert(near(rr, Math.hypot(be.x - bc.x, be.y - bc.y)), 'bulge arc equidistant from its centre');
  assert(near(rr, 20 * (1 + 0.25) / (4 * 0.5)), 'bulge radius = chord(1+b^2)/(4b)');
  assert(near(arcSweepInfo(bc, bs, be, { largeArc: bArc.largeArc, sweep: bArc.sweep }).span, 4 * Math.atan(0.5)), 'bulge sweep = 4*atan(b)');
  const cw = run(dxf(4, LWP(false, [[0, 0, -1], [10, 0]]))).shapes[0];       // CW semicircle bulging into +y
  assert(cw.type === 'arc' && cw.sweep === true, 'negative bulge = CW = sweep true');

  // POLYLINE / VERTEX with bulge
  const polyOld = run(dxf(4, [[0, 'POLYLINE'], [70, 1]], [[0, 'VERTEX'], [10, 0], [20, 0], [42, 1]], [[0, 'VERTEX'], [10, 10], [20, 0]], [[0, 'SEQEND']]));
  assert(polyOld.shapes.length === 2 && polyOld.shapes.some((x) => x.type === 'arc'), 'POLYLINE/VERTEX: arc + closing line');

  // 5. SPLINE: clamped cubic -> exact bezier(s); anything else flattened + counted.
  const SPL = (deg, knots, pts, flags = 8, weights) => [[0, 'SPLINE'], [70, flags], [71, deg], [72, knots.length], [73, pts.length], ...knots.map((k) => [40, k]), ...(weights ? weights.map((x) => [41, x]) : []), ...pts.flatMap(([x, y]) => [[10, x], [20, y]])];
  const sp = run(dxf(4, SPL(3, [0, 0, 0, 0, 1, 1, 1, 1], [[0, 0], [10, 20], [30, 20], [40, 0]])));
  assert(sp.shapes.length === 1 && sp.shapes[0].type === 'bezier' && sp.stats.flattened === 0, 'single-span cubic = one exact bezier');
  const bz = sp.shapes[0], sj = jmap(sp);
  assert(near(sj.get(bz.joints[1]).x, 40) && near(bz.c1[0], 10) && near(bz.c1[1], -20) && near(bz.c2[0], 30), 'bezier endpoints + controls (flipped)');
  const multi = run(dxf(4, SPL(3, [0, 0, 0, 0, 1, 2, 2, 2, 2], [[0, 0], [5, 10], [10, 10], [15, 0], [20, -10]])));
  assert(multi.shapes.length === 2 && multi.shapes.every((x) => x.type === 'bezier'), 'interior knot -> 2 beziers');
  assert(multi.shapes[0].joints[1] === multi.shapes[1].joints[0], 'bezier spans share their joint');
  const joined = jmap(multi), mj = joined.get(multi.shapes[0].joints[1]);
  assert(mj.x > 5 && mj.x < 15, 'joint between spans lies inside the control hull');
  const quad = run(dxf(4, SPL(2, [0, 0, 0, 1, 1, 1], [[0, 0], [10, 20], [20, 0]])));
  assert(quad.shapes.length === 1 && quad.shapes[0].type === 'bezier' && near(quad.shapes[0].c1[1], -40 / 3), 'quadratic elevated to an exact cubic');
  const rat = run(dxf(4, SPL(3, [0, 0, 0, 0, 1, 1, 1, 1], [[0, 0], [10, 20], [30, 20], [40, 0]], 8 | 4, [1, 2, 2, 1])));
  assert(rat.shapes.length > 1 && rat.shapes.every((x) => x.type === 'line') && rat.stats.flattened === 1, 'rational spline flattened + counted');
  assert(rat.stats.skipped.some((x) => x.tag === 'SPLINE' && /flattened/.test(x.reason) && x.count === 1), 'flattened spline listed in stats.skipped');
  const fit = run(dxf(4, [[0, 'SPLINE'], [70, 0], [71, 3], [74, 3], [11, 0], [21, 0], [11, 5], [21, 5], [11, 10], [21, 0]]));
  assert(fit.shapes.length === 2 && fit.stats.flattened === 1, 'fit-point-only spline = polyline through fit points, counted');

  // 6. ELLIPSE flattens; unsupported entities are skipped AND counted.
  const el = run(dxf(4, [[0, 'ELLIPSE'], [10, 0], [20, 0], [11, 10], [21, 0], [40, 0.5], [41, 0], [42, 6.283185307179586]]));
  assert(el.shapes.length >= 16 && el.shapes.every((x) => x.type === 'line') && el.stats.flattened === 1, 'ellipse flattened ring');
  const sk = run(dxf(4, LINE(0, 0, 1, 1), [[0, 'TEXT'], [10, 0], [20, 0], [1, 'x']], [[0, 'TEXT'], [10, 0], [20, 0], [1, 'y']], [[0, 'HATCH']], [[0, 'POINT'], [10, 1], [20, 1]], [[0, 'INSERT'], [2, 'B']], [[0, 'DIMENSION']], [[0, 'WEIRD']], [[0, 'LINE'], [67, 1], [10, 0], [20, 0], [11, 1], [21, 1]]));
  const sn = (tag) => (sk.stats.skipped.find((x) => x.tag === tag) || {}).count;
  assert(sk.shapes.length === 1, 'only the model-space line imported');
  assert(sn('TEXT') === 2 && sn('HATCH') === 1 && sn('POINT') === 1 && sn('INSERT') === 1 && sn('DIMENSION') === 1 && sn('WEIRD') === 1, 'skipped entities counted per type');
  assert(sk.stats.skipped.every((x) => x.reason && x.count > 0), 'every skip has a reason');
  assert(sk.stats.skipped.find((x) => x.tag === 'LINE' && /paper space/.test(x.reason)), 'paper-space entity skipped with a reason');
  assert(sk.stats.skipped.find((x) => x.tag === 'WEIRD').reason === 'entity type not supported', 'unknown type reason');

  // 7. Joint merge tolerance: near-coincident endpoints merge, distant ones do not.
  const t1 = run(dxf(4, LINE(0, 0, 100, 0), LINE(100 + 1e-6, 0, 100, 50)));
  assert(t1.joints.length === 3, 'endpoints within 1e-6 x size merge');
  const t2 = run(dxf(4, LINE(0, 0, 100, 0), LINE(100.1, 0, 100, 50)));
  assert(t2.joints.length === 4, 'endpoints 0.1 apart stay separate');

  // 8. Malformed input -> a clear { error }, never a throw.
  for (const bad of ['', 'hello world', '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\nabc\n20\n0\n0\nENDSEC\n0\nEOF\n', '0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n', 'AutoCAD Binary DXF\r\n\x1a\x00', '0\nSECTION\n2\nENTITIES\n0\nLINE\n']) {
    let r; try { r = importDxf(bad, opts()); } catch (err) { throw new Error('importDxf threw on malformed input: ' + err.message); }
    assert(r && typeof r.error === 'string' && r.error.length > 5 && !r.shapes, 'malformed → error string: ' + JSON.stringify(bad.slice(0, 20)));
  }
  assert(parseDxf('nope').error, 'parseDxf reports the error too');
  assert(importDxfGeometry({ entities: [], insunits: 4 }, opts()).shapes.length === 0, 'empty entity list imports nothing');

  // looksLikeDxf: extension first, then content.
  assert(looksLikeDxf('a.DXF', '') && !looksLikeDxf('a.svg', '0\nSECTION\n') && looksLikeDxf('noext', '  0\nSECTION\n  2\nHEADER') && !looksLikeDxf('noext', '<svg/>'), 'looksLikeDxf');

  // 9. Every fixture file: parses, imports, declared units, ids unique, shapes reference real joints.
  const dir = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'dxf');
  const files = fs.readdirSync(dir).filter((f) => /\.dxf$/i.test(f));
  assert(files.length >= 2, 'fixtures present');
  const byName = {};
  for (const f of files) {
    const r = importDxf(fs.readFileSync(path.join(dir, f), 'utf8'), opts());
    assert(!r.error, f + ': ' + r.error);
    assert(r.shapes.length > 0 && r.joints.length > 0, f + ': imported something');
    const ids = new Set(r.joints.map((j) => j.id)); assert(ids.size === r.joints.length, f + ': joint ids unique');
    assert(new Set(r.shapes.map((x) => x.id)).size === r.shapes.length, f + ': shape ids unique');
    for (const sh of r.shapes) assert(sh.joints.every((id) => ids.has(id)), f + ': shape joints exist');
    assert(r.stats.assumed === false, f + ': fixture declares its units');
    byName[f] = r;
  }
  const part = byName['part-mm.dxf'];
  assert(part.stats.skipped.some((x) => x.tag === 'TEXT'), 'part-mm: TEXT counted as skipped');
  assert(part.shapes.filter((x) => x.type === 'arc').length === 1 && part.shapes.filter((x) => x.type === 'circle').length === 1 && part.shapes.filter((x) => x.type === 'bezier').length === 1, 'part-mm: arc + circle + bezier');
  // the part-mm profile (4 lines + arc) is one closed loop
  const pdeg = new Map(), prof = part.shapes.filter((x) => x.type === 'line' || x.type === 'arc');
  for (const sh of prof) for (const id of (sh.type === 'arc' ? [sh.joints[1], sh.joints[2]] : sh.joints)) pdeg.set(id, (pdeg.get(id) || 0) + 1);
  assert(prof.length === 5 && [...pdeg.values()].every((n) => n === 2), 'part-mm: profile closes into a loop');
  const bin = byName['bulge-loop-in.dxf'];
  assert(bin.stats.label === 'inches' && near(bin.joints.find((j) => j.x > 500).x, 20 * 25.4, 1e-6), 'bulge-loop-in: inches → mm');


  // 10. CONSTRUCTION: a DASHED linetype (group 6) or a *construction* layer imports as construction geometry (isConstruction), counted.
  {
    const dashed = [[0, 'LINE'], [8, '0'], [10, 0], [20, 0], [11, 10], [21, 0], [6, 'DASHED']];
    const onLayer = [[0, 'LINE'], [8, 'Sketch Construction'], [10, 0], [20, 1], [11, 10], [21, 1]];
    const solid = [[0, 'LINE'], [8, '0'], [10, 0], [20, 2], [11, 10], [21, 2], [6, 'CONTINUOUS']];
    const r = run(dxf(4, dashed, onLayer, solid));
    assert(r.shapes.length === 3 && r.shapes.filter((x) => x.isConstruction).length === 2 && !r.shapes[2].isConstruction, 'dashed + construction-layer lines are construction, a solid line is not');
    assert(r.stats.construction === 2, 'construction counted in stats');
  }

  // 11. The owner's REAL Fusion sketch export (R14, $INSUNITS 1 = inches, everything on layer 0): 6 LINE (4 DASHED = construction),
  //     4 LWPOLYLINE (the fillets are bulges, group 42, on the last one: 2 x tan(22.5deg) = 90deg arcs), 5 POINT.
  {
    const { findLoops, findOpenChains } = await import('../packages/core/loop-finder.js');
    const real = importDxf(fs.readFileSync(path.join(dir, 'fusion-sketch4.dxf'), 'utf8'), opts());
    assert(!real.error && real.stats.label === 'inches' && real.stats.assumed === false, 'inches declared by $INSUNITS 1');
    const kinds = {};
    for (const x of real.shapes) { const k = x.type + (x.isConstruction ? '*' : ''); kinds[k] = (kinds[k] || 0) + 1; }
    assert(kinds.line === 20 && kinds['line*'] === 4 && kinds.arc === 2 && real.shapes.length === 26, 'real file shapes: ' + JSON.stringify(kinds));
    assert(real.stats.construction === 4, 'the 4 DASHED lines are construction');
    const pt = real.stats.skipped.find((x) => x.tag === 'POINT');
    assert(pt && pt.count === 5 && /sketch point/.test(pt.reason), 'the 5 sketch POINTs are skipped and counted, not minted as free joints');
    // size: the polylines span x -1.1..2.4 in and y 0.7..2.8 in = 88.9 x 53.34 mm
    const xs = real.joints.map((j) => j.x), ys = real.joints.map((j) => j.y);
    assert(near(Math.max(...xs) - Math.min(...xs), 88.9, 1e-4) && near(Math.max(...ys) - Math.min(...ys), 53.34, 1e-4), 'inches -> mm: 88.9 x 53.34 mm');
    assert(near(Math.min(...ys), -2.8 * 25.4, 1e-4), 'the top of the part (DXF y = 2.8 in) lands at world y = -71.12 (Y flipped)');
    // the two bulges: -0.41421356 = -tan(22.5deg) = a 90deg CLOCKWISE arc in the DXF (Y-up) = sweep true on the Y-down canvas
    const rj = jmap(real);
    for (const a of real.shapes.filter((x) => x.type === 'arc')) {
      const [c, s, e] = a.joints.map((id) => rj.get(id));
      assert(a.sweep === true && a.largeArc === false, 'negative bulge = a clockwise minor arc');
      assert(near(arcSweepInfo(c, s, e, { largeArc: a.largeArc, sweep: a.sweep }).span, Math.PI / 2, 1e-6), 'each fillet arc sweeps 90 deg');
      assert(near(Math.hypot(s.x - c.x, s.y - c.y), 0.15 * 25.4, 1e-4), 'fillet radius 0.15 in = 3.81 mm');
    }
    // the polylines are CLOSED loops through shared joints; construction lines never split them (loop-finder skips construction)
    const state = { joints: new Map(real.joints.map((j) => [j.id, { x: j.x, y: j.y }])), shapes: real.shapes, constraints: [] };
    const loops = findLoops(state);
    assert(loops.length === 4, 'four closed loops (the 4 closed polylines), construction diagonals do not subdivide them: ' + loops.length);
    assert(loops.every((l) => l.edges.every((id) => !real.shapes.find((x) => x.id === id).isConstruction)), 'no loop uses a construction line');
    assert(loops.some((l) => l.edges.length === 6 && l.edges.filter((id) => real.shapes.find((x) => x.id === id).type === 'arc').length === 2), 'the filleted profile is ONE closed loop of 4 lines + 2 arcs');
    assert(findOpenChains(state, loops).every((c) => c.shapes.every((x) => !x.isConstruction)), 'construction never becomes a chain');
    // without the construction rule the diagonals WOULD split a loop: prove the rule is what keeps it whole
    const noCon = { ...state, shapes: real.shapes.map((x) => ({ ...x, isConstruction: false })) };
    assert(findLoops(noCon).some((l) => l.edges.length === 8), 'sanity: counting the dashed lines as geometry bends a loop out of shape (an 8-edge face)');
  }

  console.log('dxf-import.test.js: all passed (' + files.length + ' fixtures)');
})().catch((e) => { console.error(e); process.exit(1); });
