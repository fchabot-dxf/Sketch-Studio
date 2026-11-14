// tests/symmetric-glyph.test.js — TASK 563: the renderer draws the Symmetric glyph on BOTH entities (like Fusion), never on the symmetry line,
// resolving the operands through the scene (an axis line resolves), in the outlined style (the sheet glyph).
import assert from 'node:assert';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { draw } = await import('../packages/ui/svg-renderer.js');
const { loadGlyphSheet, getGlyph } = await import('../packages/ui/glyph-sheet.js');
const { CONSTRAINT_GLYPH } = await import('../packages/ui/fusion-glyphs.js');
const { DOMParserShim } = await import('./helpers/xml-dom-shim.js');
const { readFileSync } = await import('node:fs');
await loadGlyphSheet({ fetchFn: async () => ({ ok: true, text: async () => readFileSync(new URL('../assets/constraint-glyphs.svg', import.meta.url), 'utf8') }), parser: new DOMParserShim() });

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const joints = new Map([
  ['j_origin', { x: 0, y: 0, fixed: true }],
  ['p', { x: 60, y: 40 }], ['q', { x: -60, y: 40 }],                                    // points mirrored across the Y axis
  ['a1', { x: 20, y: 100 }], ['a2', { x: 80, y: 140 }], ['b1', { x: -20, y: 100 }], ['b2', { x: -80, y: 140 }],   // lines mirrored across the Y axis
  ['s1', { x: 200, y: -50 }], ['s2', { x: 200, y: 200 }],                               // a sketch line x = 200
  ['c1', { x: 150, y: 60 }], ['c2', { x: 250, y: 60 }],                                 // circles mirrored across x = 200
]);
const shapes = [
  { id: 'L1', type: 'line', joints: ['a1', 'a2'] }, { id: 'L2', type: 'line', joints: ['b1', 'b2'] },
  { id: 'SL', type: 'line', joints: ['s1', 's2'] },
  { id: 'C1', type: 'circle', joints: ['c1'], radius: 15 }, { id: 'C2', type: 'circle', joints: ['c2'], radius: 15 },
];
const cons = [
  { type: 'symmetric', joints: ['p', 'q'], line: 'ref_axis_y' },
  { type: 'symmetric', shapes: ['L1', 'L2'], line: 'ref_axis_y' },
  { type: 'symmetric', shapes: ['C1', 'C2'], line: 'SL' },
];
const render = () => {
  const svg = { viewBox: { baseVal: { x: -300, y: -100, width: 700, height: 400 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 700, height: 400 }), innerHTML: '' };
  draw(joints, shapes, svg, null, null, cons, new Set(), new Set(), null, null, new Set(), null, null, null, null, null, false, null);
  return svg.innerHTML;
};
const glyphs = (html) => [...html.matchAll(/<g class="constraint-glyph" ([^>]*) transform="translate\(([-\d.e]+),([-\d.e]+)\)"[^>]*>(.*?)<\/g>(?=<g|$|<[a-z])/g)]
  .filter(m => /data-ctype="symmetric"/.test(m[1])).map(m => ({ attrs: m[1], x: +m[2], y: +m[3], body: m[4] }));

{
  const html = render();
  const g = glyphs(html);
  ok(g.length === 6, `two glyphs per symmetric constraint (6 for 3), got ${g.length}`);
  // the point pair: one glyph beside each point, mirror images across the Y axis (the axis itself has none)
  const pts = g.filter(x => /data-cj0="p"/.test(x.attrs));
  ok(pts.length === 2 && Math.abs(pts[0].x + pts[1].x) < 1e-6 && Math.abs(pts[0].y - pts[1].y) < 1e-6 && Math.abs(Math.abs(pts[0].x) - 60) > 1, `point glyphs beside p and q, mirrored, away from the points' own spot`);
  ok(pts.every(x => Math.abs(x.x) > 60), `each point glyph sits on the side AWAY from the axis`);
  // the line pair: one glyph per line, near its midpoint
  const ln = g.filter(x => /data-cs0="L1"/.test(x.attrs));
  ok(ln.length === 2 && ln.some(x => x.x > 0) && ln.some(x => x.x < 0), `one glyph on each line`);
  // the circle pair about a sketch line: one glyph per circle, none on the line x = 200
  const cc = g.filter(x => /data-cs0="C1"/.test(x.attrs));
  ok(cc.length === 2 && cc.some(x => x.x < 200) && cc.some(x => x.x > 200), `one glyph on each circle`);
  ok(cons.every(c => Array.isArray(c.glyphPos) && c.glyphPos.length === 2), `each constraint records both glyph positions (hit test / hover)`);
  ok(CONSTRAINT_GLYPH.symmetric === 'glyph-symmetric' && getGlyph('glyph-symmetric') && g.every(x => /class="fusion-glyph"/.test(x.body)), 'the sheet glyph glyph-symmetric');
}
console.log(`symmetric-glyph.test.js: ${checks} checks passed`);
