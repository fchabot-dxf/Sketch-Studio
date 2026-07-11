// packages/core/tests/color-mix.test.js — COLOR-MIX-1 oracle. mixForColor(target, palette) -> [{penId, weight}]:
// a single pen within tolerance -> [{that, 1}]; else the best 2-pen weighted blend whose linear-RGB average
// RECONSTRUCTS the target within tolerance (orange = red+yellow ~.5/.5; grey = black+white). Weights sum to 1;
// empty palette guarded. Deterministic, pure.
import { mixForColor, mixFillStrokes, mixFillParams } from '#core/color-mix.js';
import { parseHex } from '#core/color-match.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const near = (a, b, e) => Math.abs(a - b) <= e;

  const PAL = [
    { id: 'red',    hex: '#ff0000' },
    { id: 'yellow', hex: '#ffff00' },
    { id: 'blue',   hex: '#0000ff' },
    { id: 'black',  hex: '#000000' },
    { id: 'white',  hex: '#ffffff' },
  ];
  const byId = Object.fromEntries(PAL.map(p => [p.id, parseHex(p.hex)]));
  const sumW = (mix) => mix.reduce((s, m) => s + m.weight, 0);
  // Reconstruct the blended color from the mix (linear-RGB average) and compare per-channel to the target.
  const reconstruct = (mix) => mix.reduce((acc, m) => {
    const c = byId[m.penId];
    return { r: acc.r + m.weight * c.r, g: acc.g + m.weight * c.g, b: acc.b + m.weight * c.b };
  }, { r: 0, g: 0, b: 0 });
  const channelsNear = (a, b, e = 3) => near(a.r, b.r, e) && near(a.g, b.g, e) && near(a.b, b.b, e);

  // 1) ORANGE = red + yellow, ~0.5/0.5, and the blend reconstructs #ff8000.
  const orange = mixForColor('#ff8000', PAL);
  assert(orange.length === 2, `orange -> 2 pens (got ${orange.length})`);
  const oIds = orange.map(m => m.penId).sort();
  assert(oIds[0] === 'red' && oIds[1] === 'yellow', `orange -> red+yellow (got ${oIds.join('+')})`);
  orange.forEach(m => assert(near(m.weight, 0.5, 0.05), `orange weight ~0.5 (got ${m.penId}=${m.weight.toFixed(3)})`));
  assert(near(sumW(orange), 1, 1e-9), 'orange weights sum to 1');
  assert(channelsNear(reconstruct(orange), parseHex('#ff8000')), 'orange blend reconstructs #ff8000 within tol');

  // 2) EXACT pen -> that single pen, weight 1.
  const exact = mixForColor('#0000ff', PAL);
  assert(exact.length === 1 && exact[0].penId === 'blue' && exact[0].weight === 1, `exact blue -> [{blue,1}] (got ${JSON.stringify(exact)})`);
  const exactRed = mixForColor('#ff0000', PAL);
  assert(exactRed.length === 1 && exactRed[0].penId === 'red' && exactRed[0].weight === 1, 'exact red -> [{red,1}]');

  // 3) GREY = black + white, ~0.5/0.5, reconstructs #808080.
  const grey = mixForColor('#808080', PAL);
  assert(grey.length === 2, `grey -> 2 pens (got ${grey.length})`);
  const gIds = grey.map(m => m.penId).sort();
  assert(gIds[0] === 'black' && gIds[1] === 'white', `grey -> black+white (got ${gIds.join('+')})`);
  assert(near(sumW(grey), 1, 1e-9), 'grey weights sum to 1');
  assert(channelsNear(reconstruct(grey), parseHex('#808080'), 4), 'grey blend reconstructs #808080 within tol');

  // 4) EMPTY palette guarded; unparseable target guarded.
  assert(Array.isArray(mixForColor('#ff8000', [])) && mixForColor('#ff8000', []).length === 0, 'empty palette -> []');
  assert(mixForColor('nope', PAL).length === 0, 'unparseable target -> []');

  // 5) SINGLE-pen palette -> that pen, weight 1 (even if far from target).
  const one = mixForColor('#00ff00', [{ id: 'red', hex: '#ff0000' }]);
  assert(one.length === 1 && one[0].penId === 'red' && one[0].weight === 1, 'single-pen palette -> [{red,1}]');

  // 6) Accepts {r,g,b} and array target forms too.
  assert(mixForColor({ r: 255, g: 128, b: 0 }, PAL).length === 2, 'accepts {r,g,b} target');
  assert(mixForColor([255, 128, 0], PAL).length === 2, 'accepts [r,g,b] target');

  // ── COLOR-MIX-2: mixFillStrokes — per-pen cross-hatch at spacing ∝ 1/weight, distinct angles ──────────────────
  const square = { type: 'rect', x: 0, y: 0, w: 100, h: 100 };
  // Measure the REAL perpendicular spacing between adjacent parallel hatch lines (not just the recorded field): project
  // each stroke start onto the hatch normal, sort, and take the median adjacent gap.
  const measureSpacing = (strokes, angleDeg) => {
    const a = angleDeg * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a);
    const proj = strokes.map(s => s.x1 * nx + s.y1 * ny).sort((p, q) => p - q);
    const diffs = [];
    for (let i = 1; i < proj.length; i++) { const d = proj[i] - proj[i - 1]; if (d > 1e-6) diffs.push(d); }
    diffs.sort((p, q) => p - q);
    return diffs.length ? diffs[Math.floor(diffs.length / 2)] : NaN;
  };

  // Orange mix {red:.5, yellow:.5}, penWidth 2 -> 2 hatch sets, each spacing ~ 2/.5 = 4, DISTINCT angles.
  const W = 2;
  const mixOrange = mixForColor('#ff8000', PAL);
  const fills = mixFillStrokes(square, mixOrange, W);
  assert(fills.length === 2, `orange fill -> 2 pen sets (got ${fills.length})`);
  fills.forEach(f => {
    assert(f.strokes.length > 5, `${f.penId} set has hatch strokes (got ${f.strokes.length})`);
    assert(near(f.spacing, 4, 0.1), `${f.penId} recorded spacing ~ 2w=4 (got ${f.spacing})`); // ~0.5 weight (#ff8000 -> .498/.502)
    assert(near(measureSpacing(f.strokes, f.angle), 4, 0.25), `${f.penId} GEOMETRIC spacing ~ 4 (got ${measureSpacing(f.strokes, f.angle).toFixed(3)})`);
  });
  assert(fills[0].angle !== fills[1].angle, `distinct angles per pen (got ${fills[0].angle}, ${fills[1].angle})`);
  assert(fills.map(f => f.penId).sort().join('+') === 'red+yellow', 'orange fill pens = red+yellow');

  // Single-pen mix {p:1}, penWidth 2 -> ONE denser fill, spacing ~ w = 2.
  const single = mixFillStrokes(square, [{ penId: 'black', weight: 1 }], W);
  assert(single.length === 1, `single-pen mix -> 1 set (got ${single.length})`);
  assert(near(single[0].spacing, 2, 0.01), `single spacing ~ w=2 (got ${single[0].spacing})`);
  assert(near(measureSpacing(single[0].strokes, single[0].angle), 2, 0.25), 'single GEOMETRIC spacing ~ 2');
  // The full-weight single fill is DENSER (more strokes, tighter spacing) than each half-weight mix set.
  assert(single[0].strokes.length > fills[0].strokes.length, 'single (w=1) fill is denser than a .5-weight mix set');
  assert(single[0].spacing < fills[0].spacing, 'higher weight -> tighter spacing');

  // mixFillParams: the shared per-pen params. Per-pen WIDTH function -> per-pen spacing (spacing = width/weight).
  const params = mixFillParams([{ penId: 'red', weight: 0.5 }, { penId: 'yellow', weight: 0.25 }], (id) => id === 'red' ? 1 : 2);
  assert(params.length === 2, 'mixFillParams -> 2 entries');
  assert(near(params[0].spacing, 2, 1e-9) && params[0].angle === 0, 'red: spacing = 1/0.5 = 2 at angle 0');
  assert(near(params[1].spacing, 8, 1e-9) && params[1].angle === 60, 'yellow: spacing = 2/0.25 = 8 at angle 60');

  // Guards: empty mix -> []; missing region -> []; zero-weight pen contributes nothing.
  assert(mixFillStrokes(square, [], W).length === 0, 'empty mix -> []');
  assert(mixFillStrokes(null, mixOrange, W).length === 0, 'missing region -> []');
  assert(mixFillStrokes(square, [{ penId: 'red', weight: 0 }], W).length === 0, 'zero-weight pen -> no set');

  console.log('color-mix (COLOR-MIX-1 + COLOR-MIX-2) tests passed ✅');
})().catch((e) => { console.error('color-mix tests failed ❌', e); process.exit(1); });
