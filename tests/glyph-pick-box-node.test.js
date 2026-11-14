// tests/glyph-pick-box-node.test.js -- TASK 603: a glyph is picked only when the pointer is ON its drawn icon (the icon's box + 2 px mouse /
// 6 px touch margin), not within a 13 px disc around its centre. ONE function (fusion-glyphs glyphPickHalfSize) -> hover-manager glyphAt ->
// hover, left click (selectPick) and right click. Also prints the pick area / reach table for the report.
import assert from 'node:assert';
import fs from 'node:fs';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };
const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { loadGlyphSheet } = await import('../packages/ui/glyph-sheet.js');
const { glyphPickHalfSize, GLYPH_PICK_MARGIN_PX, GLYPH_PICK_MARGIN_TOUCH_PX } = await import('../packages/ui/fusion-glyphs.js');
const { glyphAt, selectPick, updateHover } = await import('../packages/ui/hover-manager.js');
const { DOMParserShim } = await import('./helpers/xml-dom-shim.js');
await loadGlyphSheet({ fetchFn: async () => ({ ok: true, text: async () => fs.readFileSync(new URL('../assets/constraint-glyphs.svg', import.meta.url), 'utf8') }), parser: new DOMParserShim() });

// identity world <-> screen (1 unit = 1 px)
const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }), viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 200 } } };
const G = { x: 100, y: 100 };
const mk = (type, extra = {}) => ({ type, joints: ['a', 'b'], glyphPos: { ...G }, ...extra });
const stateOf = (c) => ({ constraints: [c], joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 200, y: 100 }]]), shapes: [], lastMouse: { x: 0, y: 0 }, hoveredJoint: null, hoveredConstraint: null, hoveredShape: null });
const SIZE = 20, OUT = SettingsManager.get('GLYPH_OUTLINE_PX');

// the box: horizontal is long and thin; the larger side is the icon size (+ the outline half-width + margin each side)
const hb = glyphPickHalfSize('horizontal', SIZE, OUT);
assert.ok(hb.hw > hb.hh * 1.5, 'the horizontal glyph box is long and thin: ' + JSON.stringify(hb));
assert.ok(Math.abs(hb.hw - (SIZE / 2 + OUT / 2 + GLYPH_PICK_MARGIN_PX)) < 0.6, 'its long half side is size / 2 + outline / 2 + margin: ' + hb.hw);
assert.ok(hb.hh < 13 - 3, 'and its short half side is far inside the old 13 px disc: ' + hb.hh);
assert.strictEqual(glyphPickHalfSize('fixed', SIZE, OUT), null, 'a type with no glyph has no box (nothing is drawn, nothing is picked)');
const tb = glyphPickHalfSize('horizontal', SIZE, OUT, true);
assert.ok(Math.abs((tb.hw - hb.hw) - (GLYPH_PICK_MARGIN_TOUCH_PX - GLYPH_PICK_MARGIN_PX)) < 1e-9 && GLYPH_PICK_MARGIN_TOUCH_PX > GLYPH_PICK_MARGIN_PX, 'touch margin is larger');
// the glyph's own size setting scales the box
const big = glyphPickHalfSize('horizontal', 40, OUT);
assert.ok(Math.abs((big.hw - hb.hw) - 10) < 1e-9, 'Glyph Icon Size 40 widens the long half side by 10 px: ' + big.hw);

// pointer 8 px off the long side (inside the old 13 px circle, outside the new box) is NOT the glyph; on the icon IS
const c = mk('horizontal'); const st = stateOf(c);
const off = { x: G.x, y: G.y + hb.hh + 2 }; // just outside the short side
assert.ok(Math.hypot(off.x - G.x, off.y - G.y) < 13, 'the off-icon point is inside the old circle');
assert.strictEqual(glyphAt(svg, st, off.x, off.y), null, 'beside the icon: not the glyph');
assert.strictEqual(glyphAt(svg, st, G.x, G.y), c, 'on the icon: the glyph');
assert.strictEqual(glyphAt(svg, st, G.x + hb.hw - 0.5, G.y), c, 'at the end of the icon: the glyph');
assert.strictEqual(glyphAt(svg, st, G.x + hb.hw + 1, G.y), null, 'past the icon end + margin: not the glyph');
// the touch margin: a point outside the mouse box, inside the touch box
const mid = { x: G.x, y: G.y + hb.hh + 2 };
assert.strictEqual(glyphAt(svg, st, mid.x, mid.y, true), c, 'touch: a finger a little off the icon still picks it');
assert.strictEqual(glyphAt(svg, st, G.x, G.y + tb.hh + 1, true), null, 'touch: but not beyond the touch box');

// hover and click agree (selectPick is both): beside the icon with a line under the pointer -> the line; on the icon -> the glyph
const hitShape = { shape: { id: 'L' }, pt: off };
assert.deepStrictEqual(selectPick(svg, st, null, hitShape, off.x, off.y), { shape: hitShape }, 'beside the icon the click picks the LINE');
assert.strictEqual(selectPick(svg, st, null, hitShape, G.x, G.y).constraint, c, 'on the icon the click picks the glyph');
updateHover(svg, off.x, off.y, st); assert.strictEqual(st.hoveredConstraint, null, 'hover beside the icon: no glyph lit');
updateHover(svg, G.x, G.y, st); assert.strictEqual(st.hoveredConstraint, c, 'hover on the icon: the glyph lit (= the click)');

// the table for the report: area in px^2 and the reach (distance from the centre along each axis) vs the old 13 px disc
const rows = ['horizontal', 'vertical', 'parallel', 'perpendicular', 'equal'].map((t) => {
  const b = glyphPickHalfSize(t, SIZE, OUT); return `${t.padEnd(14)} box ${(2 * b.hw).toFixed(1)} x ${(2 * b.hh).toFixed(1)} = ${(4 * b.hw * b.hh).toFixed(0)} px2 (old disc ${(Math.PI * 169).toFixed(0)}), line wins beyond ${b.hh.toFixed(1)} px (x) / ${b.hw.toFixed(1)} px (y)` ;
});
console.log(rows.join('\n'));
console.log('glyph-pick-box-node.test.js: ok');
