// packages/core/tests/color-match.test.js — UNIFY-4c oracle. Pins the DIGITAL -> PHYSICAL nearest-pen mapping:
// 8 digital colors -> a 4-pen palette -> the expected pen each time. + hex parsing + guards. Pure, deterministic.
import { parseHex, colorDistanceSq, nearestColorIndex } from '#core/color-match.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };

  // hex parsing: #rrggbb, #rgb shorthand, no-hash, and rejects.
  assert(JSON.stringify(parseHex('#ff8000')) === '{"r":255,"g":128,"b":0}', 'parse #rrggbb');
  assert(JSON.stringify(parseHex('#f00')) === '{"r":255,"g":0,"b":0}', 'parse #rgb shorthand');
  assert(JSON.stringify(parseHex('00ff00')) === '{"r":0,"g":255,"b":0}', 'parse no-hash');
  assert(parseHex('nope') === null && parseHex('#12') === null && parseHex(null) === null, 'reject bad hex');
  assert(colorDistanceSq({ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }) === 65025, 'distance^2 black->blue = 255^2');

  // 4 physical pens; 8 digital colors -> each maps to its NEAREST pen (unambiguous choices).
  const PENS = ['#000000', '#ff0000', '#00ff00', '#0000ff']; // black, red, green, blue
  const cases = [
    ['#000000', 0], ['#202020', 0],   // black-ish -> black
    ['#cc0000', 1], ['#ff8080', 1],   // red-ish   -> red
    ['#00cc00', 2], ['#80ff80', 2],   // green-ish -> green
    ['#0000cc', 3], ['#8080ff', 3],   // blue-ish  -> blue
  ];
  for (const [hex, want] of cases) {
    assert(nearestColorIndex(hex, PENS) === want, `${hex} -> pen ${want} (${PENS[want]})`);
  }
  // shorthand digital + exact match.
  assert(nearestColorIndex('#f00', PENS) === 1, '#f00 -> red');
  assert(nearestColorIndex('#00ff00', PENS) === 2, 'exact green -> green');

  // guards: empty palette / bad hex -> -1.
  assert(nearestColorIndex('#123456', []) === -1, 'empty palette -> -1');
  assert(nearestColorIndex('nope', PENS) === -1, 'bad digital hex -> -1');

  console.log('color-match (UNIFY-4c) tests passed ✅');
})().catch((e) => { console.error('color-match tests failed ❌', e); process.exit(1); });
