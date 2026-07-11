// packages/core/tests/color-mix.test.js — COLOR-MIX-1 oracle. mixForColor(target, palette) -> [{penId, weight}]:
// a single pen within tolerance -> [{that, 1}]; else the best 2-pen weighted blend whose linear-RGB average
// RECONSTRUCTS the target within tolerance (orange = red+yellow ~.5/.5; grey = black+white). Weights sum to 1;
// empty palette guarded. Deterministic, pure.
import { mixForColor } from '#core/color-mix.js';
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

  console.log('color-mix (COLOR-MIX-1) tests passed ✅');
})().catch((e) => { console.error('color-mix tests failed ❌', e); process.exit(1); });
