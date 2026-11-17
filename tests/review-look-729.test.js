// tests/review-look-729.test.js — TASK 729: the Export step's 3D LOOKS, declared once as data (review-view.js LOOKS) and read by the one
// material builder (lookSpec -> applyLook). Node: every row builds a material spec; the default is Plywood with today's parameters; the
// stored state is validated (normaliseLook); the procedural textures are deterministic, tile, and run their grain the declared way.
// The swap on the real three.js materials (no geometry rebuild, remembered, export unchanged) is asserted in review-look-729-live.test.js.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { LOOKS, DEFAULT_LOOK_ID, BOARD_HEX, PAINTERS, PAINT_SIZE, normaliseLook, lookSpec, WOOD_URL, EDGE_URL } from '../apps/shaper/src/review-view.js';

const root = path.resolve(import.meta.dirname, '..');
const HEX = /^#[0-9a-f]{6}$/;

// the table: unique ids, the owner's five looks in order, every part names a photo or a painter
assert.deepStrictEqual(LOOKS.map((l) => l.id), ['plywood', 'solid', 'mdf', 'walnut', 'acrylic'], 'the five looks');
assert.strictEqual(new Set(LOOKS.map((l) => l.id)).size, LOOKS.length, 'unique ids');
for (const l of LOOKS) {
  assert.ok(l.label && Number.isFinite(l.roughness) && Number.isFinite(l.metalness), l.id + ': label, roughness, metalness');
  for (const name of ['face', 'edge']) {
    const p = l[name];
    if (!p) continue;
    if (p.paint) assert.ok(PAINTERS[p.paint] && p.tileMm > 0, `${l.id}.${name}: a known painter with a tile size`);
    if (p.image) assert.ok(/\/apps\/shaper\/assets\/.+\.jpg$/.test(p.image), `${l.id}.${name}: a bundled image`);
  }
  for (const c of l.colors || []) assert.ok(c.label && HEX.test(c.hex) && (c.opacity === undefined || (c.opacity > 0 && c.opacity <= 1)), `${l.id} colour ${JSON.stringify(c)}`);
  assert.ok(l.color ? HEX.test(l.color) : l.colors && l.colors.length, l.id + ': a flat colour, or the user picks one');
}
// only the plywood uses image files: every other texture is painted in code (no downloaded images)
assert.deepStrictEqual(LOOKS.flatMap((l) => [l.face, l.edge]).filter((p) => p && p.image).map((p) => p.image), [WOOD_URL, EDGE_URL], 'the only images are the two plywood assets');

// every look builds a spec for both materials
for (const l of LOOKS) {
  const states = l.colors ? l.colors.map((c) => ({ id: l.id, colors: { [l.id]: c.hex } })) : [{ id: l.id }];
  for (const st of states) {
    const s = lookSpec(st);
    console.log(`${l.id} ${JSON.stringify(st.colors || {})} -> ${JSON.stringify({ color: s.color, roughness: s.roughness, metalness: s.metalness, opacity: s.opacity, transparent: s.transparent, face: s.face.image ? 'image' : s.face.paint ? 'paint:' + s.face.paint.paint : 'flat', edge: s.edge.image ? 'image' : s.edge.paint ? 'paint:' + s.edge.paint.paint : 'flat', glow: [s.face.glow, s.edge.glow] })}`);
    assert.strictEqual(s.id, l.id);
    assert.ok(HEX.test(s.color), 'a flat colour: ' + s.color);
    assert.strictEqual(s.transparent, s.opacity < 1);
  }
}

// the DEFAULT = Plywood with today's parameters (birch photo face, birch edge photo, roughness 0.85, metalness 0, opaque, no glow)
assert.strictEqual(DEFAULT_LOOK_ID, 'plywood');
const def = lookSpec(null);
assert.deepStrictEqual({ id: def.id, face: def.face.image, edge: def.edge.image, roughness: def.roughness, metalness: def.metalness, opacity: def.opacity, transparent: def.transparent, glow: [def.face.glow, def.edge.glow] },
  { id: 'plywood', face: WOOD_URL, edge: EDGE_URL, roughness: 0.85, metalness: 0, opacity: 1, transparent: false, glow: [0, 0] }, 'the default look is today\'s plywood');
// BOARD_HEX is the old flat board colour (linear 0.85 / 0.70 / 0.50) as sRGB hex: three's own linear -> sRGB conversion
const toSrgb = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);
assert.strictEqual(BOARD_HEX, '#' + [0.85, 0.70, 0.50].map((c) => Math.round(toSrgb(c) * 255).toString(16).padStart(2, '0')).join(''), 'BOARD_HEX = the old BOARD colour');
assert.strictEqual(LOOKS.find((l) => l.id === 'solid').colors[0].hex, BOARD_HEX, 'Solid colour\'s first preset is the natural wood tan (the old Wood-off look)');

// Acrylic: see-through per colour, glossy, and the edge (only) glows
for (const [hex, op] of LOOKS.find((l) => l.id === 'acrylic').colors.map((c) => [c.hex, c.opacity])) {
  const s = lookSpec({ id: 'acrylic', colors: { acrylic: hex } });
  assert.ok(s.transparent && s.opacity === op && s.roughness < 0.2 && s.face.glow === 0 && s.edge.glow > 0, 'acrylic ' + hex);
}
// MDF and Walnut: painted face AND edge (solid materials: no plies), opaque
for (const id of ['mdf', 'walnut']) { const s = lookSpec({ id }); assert.ok(s.face.paint && s.edge.paint && !s.transparent, id + ': painted face and edge, opaque'); }

// normaliseLook: unknown -> default; each colour-taking look keeps its own pick; a custom colour only where the look allows one
assert.deepStrictEqual(normaliseLook({ id: 'nope' }), { id: 'plywood', colors: { solid: BOARD_HEX, acrylic: LOOKS.find((l) => l.id === 'acrylic').colors[0].hex } });
assert.strictEqual(normaliseLook({ id: 'solid', colors: { solid: '#12AB34' } }).colors.solid, '#12ab34', 'any colour on Solid colour (lower-cased)');
assert.strictEqual(normaliseLook({ id: 'solid', colors: { solid: 'red' } }).colors.solid, BOARD_HEX, 'not a hex: the first preset');
assert.strictEqual(normaliseLook({ id: 'acrylic', colors: { acrylic: '#12ab34' } }).colors.acrylic, '#d8eef2', 'Acrylic takes only its presets');
assert.deepStrictEqual(normaliseLook({ id: 'acrylic', colors: { solid: '#2a2c30', acrylic: '#1b1c1f' } }).colors, { solid: '#2a2c30', acrylic: '#1b1c1f' }, 'both picks kept');

// the painters: deterministic, opaque, seamless (the wrap step is no bigger than an interior step), grain along the declared direction
const lum = (px, size, x, y) => { const i = (((y + size) % size) * size + ((x + size) % size)) * 4; return 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]; };
const meanStep = (px, size, dx, dy, at) => { let s = 0, n = 0; for (let k = 0; k < size; k++) { const [x, y] = at(k); s += Math.abs(lum(px, size, x + dx, y + dy) - lum(px, size, x, y)); n++; } return s / n; };
for (const l of LOOKS) for (const name of ['face', 'edge']) {
  const p = l[name];
  if (!p || !p.paint) continue;
  const px = PAINTERS[p.paint](p, PAINT_SIZE), again = PAINTERS[p.paint](p, PAINT_SIZE);
  assert.strictEqual(px.length, PAINT_SIZE * PAINT_SIZE * 4);
  assert.ok(px.every((v, i) => v === again[i]), `${l.id}.${name}: the same pixels every time`);
  assert.ok(px.filter((_, i) => i % 4 === 3).every((a) => a === 255), `${l.id}.${name}: opaque`);
  const S = PAINT_SIZE;
  // the step over the wrap line vs the largest step over any interior line (a seam would stand out above every interior line)
  const wrapX = meanStep(px, S, 1, 0, (k) => [S - 1, k]), innerX = Math.max(...Array.from({ length: S - 1 }, (_, c) => meanStep(px, S, 1, 0, (k) => [c, k])));
  const wrapY = meanStep(px, S, 0, 1, (k) => [k, S - 1]), innerY = Math.max(...Array.from({ length: S - 1 }, (_, r) => meanStep(px, S, 0, 1, (k) => [k, r])));
  console.log(`${l.id}.${name}: step over the x wrap ${wrapX.toFixed(2)} (largest interior ${innerX.toFixed(2)}), over the y wrap ${wrapY.toFixed(2)} (largest interior ${innerY.toFixed(2)})`);
  assert.ok(wrapX <= innerX * 1.1 && wrapY <= innerY * 1.1, `${l.id}.${name}: tiles seamlessly`);
  if (p.paint === 'grain') {
    // along the grain the tone changes less than across it: 'v' = streaks along y (a face: the board's long side), 'u' = along x (an edge: along the wall)
    const alongY = meanStep(px, S, 0, 1, (k) => [k, k]), alongX = meanStep(px, S, 1, 0, (k) => [k, k]);
    console.log(`${l.id}.${name}: grain along ${p.along}: mean step along y ${alongY.toFixed(2)}, along x ${alongX.toFixed(2)}`);
    assert.ok(p.along === 'v' ? alongY < alongX / 2 : alongX < alongY / 2, `${l.id}.${name}: the grain runs along ${p.along}`);
  }
  if (l.id === 'mdf' && name === 'edge') { // a SOLID uniform edge: no plies (no light / dark bands across the height)
    const rows = Array.from({ length: S }, (_, y) => { let s = 0; for (let x = 0; x < S; x++) s += lum(px, S, x, y); return s / S; });
    const spread = Math.max(...rows) - Math.min(...rows);
    console.log(`mdf.edge: row-mean spread ${spread.toFixed(2)} (0-255)`);
    assert.ok(spread < 6, 'MDF edge: uniform rows (no plies): ' + spread);
  }
}

// the wiring: the Wood checkbox is gone; the Look card holds the Material select + the colour swatches; the export never reads the look
const html = fs.readFileSync(path.join(root, 'apps/shaper/index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'apps/shaper/src/main.js'), 'utf8');
assert.ok(!/review-wood|setWood/.test(html + main), 'no Wood checkbox left');
assert.ok(html.includes('id="review-look-select"') && html.includes('id="review-look-colors"'), 'the Look card controls');
assert.ok(/REVIEW_LOOK_KEY = 'shaper-review-look'/.test(main), 'the look is remembered per app');
for (const f of ['apps/shaper/src/export-preview.js', 'apps/shaper/src/shaper.js', 'packages/core/shaper-export.js']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) assert.ok(!/LOOKS|lookSpec|review-look/.test(fs.readFileSync(p, 'utf8')), f + ' does not read the look');
}
console.log('review-look-729: ok');
