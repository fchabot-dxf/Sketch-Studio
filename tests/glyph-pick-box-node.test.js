// tests/glyph-pick-box-node.test.js -- TASK 603: a glyph is picked only when the pointer is ON its drawn icon (the icon's box + 2 px mouse /
// 6 px touch margin), not within a 13 px disc around its centre. ONE function (fusion-glyphs glyphPickHalfSize) -> hover-manager glyphAt ->
// hover, left click (selectPick) and right click. Also prints the pick area / reach table for the report.
import assert from 'node:assert';
import fs from 'node:fs';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };
const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { loadGlyphSheet } = await import('../packages/ui/glyph-sheet.js');
const { glyphPickHit } = await import('../packages/ui/fusion-glyphs.js');
const { glyphAt, selectPick, updateHover } = await import('../packages/ui/hover-manager.js');
const { DOMParserShim } = await import('./helpers/xml-dom-shim.js');
await loadGlyphSheet({ fetchFn: async () => ({ ok: true, text: async () => fs.readFileSync(new URL('../assets/constraint-glyphs.svg', import.meta.url), 'utf8') }), parser: new DOMParserShim() });

// identity world <-> screen (1 unit = 1 px)
const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }), viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 200 } } };
const G = { x: 100, y: 100 };
const mk = (type, extra = {}) => ({ type, joints: ['a', 'b'], glyphPos: { ...G }, ...extra });
const stateOf = (c) => ({ constraints: [c], joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 200, y: 100 }]]), shapes: [], lastMouse: { x: 0, y: 0 }, hoveredJoint: null, hoveredConstraint: null, hoveredShape: null });
const SIZE = SettingsManager.get('GLYPH_SYMBOL_SIZE_PX'), OUT = SettingsManager.get('GLYPH_OUTLINE_PX');

const hit = (type, dx, dy, size = SIZE, touch = false) => glyphPickHit(type, dx, dy, size, OUT, touch);
// pick extent along an axis through the centre (the farthest pointer, in 0.1 px steps, that still picks) and the picked area (0.25 px grid)
const extent = (type, ax, size = SIZE, touch = false) => { let m = 0; for (let d = 0; d < 60; d += 0.1) if (hit(type, ax === 'x' ? d : 0, ax === 'y' ? d : 0, size, touch)) m = d; return m; };
const area = (type, size = SIZE, touch = false) => { let n = 0; for (let x = -40; x < 40; x += 0.25) for (let y = -40; y < 40; y += 0.25) if (hit(type, x, y, size, touch)) n++; return n * 0.0625; };
const OLD_DISC = Math.PI * 13 * 13;
assert.ok(extent('horizontal', 'x') > 1.5 * extent('horizontal', 'y'), 'the horizontal glyph is long and thin');
assert.ok(extent('horizontal', 'y') < 8, 'its short reach is far inside the old 13 px disc: ' + extent('horizontal', 'y'));
for (const t of ['horizontal', 'vertical', 'parallel', 'perpendicular', 'equal']) assert.ok(area(t) < OLD_DISC, t + ' pick area ' + area(t) + ' is below the old disc ' + OLD_DISC);
assert.ok(area('parallel') < 0.8 * OLD_DISC && area('perpendicular') < 0.8 * OLD_DISC, 'parallel / perpendicular are clearly smaller than the old disc');
assert.ok(area('parallel') < 0.8 * (2 * (SIZE / 2 + 2.5)) ** 2, 'and follow the strokes, not the bbox');
assert.strictEqual(hit('fixed', 0, 0), false, 'a type with no glyph is never picked (nothing is drawn)');
assert.ok(area('horizontal', SIZE, true) > area('horizontal') && extent('horizontal', 'y', SIZE, true) > extent('horizontal', 'y') + 3, 'touch margin is larger');
assert.ok(Math.abs(extent('horizontal', 'x', SIZE + 20) - extent('horizontal', 'x') - 10) < 0.3, 'Glyph Icon Size +20 widens the long reach by 10 px');
const hb = { hh: extent('horizontal', 'y') }, tb = { hh: extent('horizontal', 'y', SIZE, true) };

// pointer 8 px off the long side (inside the old 13 px circle, outside the new box) is NOT the glyph; on the icon IS
const c = mk('horizontal'); const st = stateOf(c);
const off = { x: G.x, y: G.y + hb.hh + 1.5 }; // just outside the short side
assert.ok(Math.hypot(off.x - G.x, off.y - G.y) < 13, 'the off-icon point is inside the old circle');
assert.strictEqual(glyphAt(svg, st, off.x, off.y), null, 'beside the icon: not the glyph');
assert.strictEqual(glyphAt(svg, st, G.x, G.y), c, 'on the icon: the glyph');
const hx = extent('horizontal', 'x');
assert.strictEqual(glyphAt(svg, st, G.x + hx - 0.5, G.y), c, 'at the end of the icon: the glyph');
assert.strictEqual(glyphAt(svg, st, G.x + hx + 1, G.y), null, 'past the icon end + margin: not the glyph');
// the touch margin: a point outside the mouse box, inside the touch box
const mid = off;
assert.strictEqual(glyphAt(svg, st, mid.x, mid.y, true), c, 'touch: a finger a little off the icon still picks it');
assert.strictEqual(glyphAt(svg, st, G.x, G.y + tb.hh + 1.5, true), null, 'touch: but not beyond the touch box');

// hover and click agree (selectPick is both): beside the icon with a line under the pointer -> the line; on the icon -> the glyph
const hitShape = { shape: { id: 'L' }, pt: off };
assert.deepStrictEqual(selectPick(svg, st, null, hitShape, off.x, off.y), { shape: hitShape }, 'beside the icon the click picks the LINE');
assert.strictEqual(selectPick(svg, st, null, hitShape, G.x, G.y).constraint, c, 'on the icon the click picks the glyph');
updateHover(svg, off.x, off.y, st); assert.strictEqual(st.hoveredConstraint, null, 'hover beside the icon: no glyph lit');
updateHover(svg, G.x, G.y, st); assert.strictEqual(st.hoveredConstraint, c, 'hover on the icon: the glyph lit (= the click)');

// the table for the report: area in px^2 and the reach (distance from the centre along each axis) vs the old 13 px disc
const rows = ['horizontal', 'vertical', 'parallel', 'perpendicular', 'equal'].map((t) =>
  `${t.padEnd(14)} area ${area(t).toFixed(0)} px2 (old disc ${OLD_DISC.toFixed(0)}), pick reaches ${extent(t, 'x').toFixed(1)} px along x / ${extent(t, 'y').toFixed(1)} px along y from the centre (old 13 / 13)`);
console.log(rows.join(String.fromCharCode(10)));
console.log('glyph-pick-box-node.test.js: ok');
