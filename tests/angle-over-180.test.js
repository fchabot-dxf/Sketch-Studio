// tests/angle-over-180.test.js -- TASK 553: an angle dimension takes 0 < value <= 360 like Fusion, opening its sector past 180.
// FUSION, measured with real mouse and keys (task 551): fixed line P1(1,1)-P2(5,1), free line from P1 at 30 degrees, angle dimension created
// in the 30 sector, then typed: 60 -> the free line at 60; 120 -> 120; 179 -> 179; 190 -> accepted, value 190, line at -170 (the sector
// keeps opening past 180, the same way round); 270 -> -90; 360 -> accepted, the line lies on the fixed line; -30 refused; 0 refused.
// Here: the same sketch (x10), the dimension placed by the Dimension tool's placing path, every value typed through the value-box seam
// (commitDimensionEdit). Checked after each: the free line's direction, the turn is continuous (every solve of the walk turns it a little
// the same way, never a flip), the drawn arc spans the value (reflex included) with the label inside it, the verifier and the row agree;
// 0 / -30 / 400 are refused and move nothing. Both pick orders.
import assert from 'node:assert';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const L = await import('./harness/audit/lib.js');
const { ConstraintManager } = await import('../packages/core/constraint-manager.js');
const { measureResidual } = await import('../packages/core/constraint-verifier.js');
const { commitDimensionEdit } = await import('../packages/ui/dimension-seams.js');
const { updateConstraintOffset } = await import('../packages/ui/input-handlers/dimension-tool.js');
const { draw } = await import('../packages/ui/svg-renderer.js');
const { serializeDocument, deserializeDocument } = await import('../packages/core/document.js');

const deg = (r) => r * 180 / Math.PI;
const n360 = (d) => ((d % 360) + 360) % 360;
const signed = (d) => { const x = n360(d); return x > 180 ? x - 360 : x; };
const quiet = (f) => { const e = console.error, w = console.warn; console.error = console.warn = () => {}; try { return f(); } finally { console.error = e; console.warn = w; } };

// Fusion's sketch x10: P1 (10,10) - P2 (50,10) fixed, the free line from P1 at 30 degrees, 30 long
function fusionSketch(pickFreeFirst) {
  const S = L.newSketch();
  const fix = (x, y) => { const id = L.point(S, x, y); S.state.joints.get(id).fixed = true; return id; };
  const P1 = fix(10, 10), P2 = fix(50, 10);
  const E = L.point(S, 10 + 30 * Math.cos(Math.PI / 6), 10 + 30 * Math.sin(Math.PI / 6));
  const fixed = L.line(S, P1, P2), free = L.line(S, P1, E);
  const shapes = pickFreeFirst ? [free, fixed] : [fixed, free];
  const value = L.measure(S, { type: 'angle', shapes });
  const c = quiet(() => ConstraintManager.createConstraint(S.state, 'angle', { shapes, value }, { source: 'dimension' }));
  assert(c && typeof c === 'object', 'created');
  // placed by the Dimension tool: the label dropped in the 30 degree sector (at 15 degrees from P1)
  c.__placing = true; c.__newlyPlaced = true;
  updateConstraintOffset(S.state, c, { x: 10 + 20 * Math.cos(Math.PI / 12), y: 10 + 20 * Math.sin(Math.PI / 12) });
  c.__placing = false; c.__newlyPlaced = false;
  return { S, c, P1, E };
}
const freeDir = (S, P1, E) => { const a = S.state.joints.get(P1), b = S.state.joints.get(E); return deg(Math.atan2(b.y - a.y, b.x - a.x)); };
// the drawn arc (read back from the SVG) about P1: CCW span, and whether the label spot (glyphPos, written by the renderer) is inside it
function drawn(S, c) {
  const svg = { viewBox: { baseVal: { x: -200, y: -200, width: 400, height: 400 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), innerHTML: '' };
  draw(S.state.joints, S.state.shapes, svg, null, null, [c], new Set(), new Set(), 'select', null, new Set(), null, null, null, null, null, false, null);
  const m = svg.innerHTML.match(/<path d="M ([-\d.e]+) ([-\d.e]+) A [-\d.e]+ [-\d.e]+ 0 ([01]) 1 ([-\d.e]+) ([-\d.e]+)"/);
  if (!m) return null;
  const at = (x, y) => deg(Math.atan2(y - 10, x - 10));
  const a0 = at(+m[1], +m[2]), span = n360(at(+m[4], +m[5]) - a0);
  const label = n360(at(c.glyphPos.x, c.glyphPos.y) - a0);
  const text = (svg.innerHTML.match(/class="dim-label"[\s\S]*?<text[^>]*>([^<]*)<\/text>/) || [])[1];
  return { span, large: +m[3], labelInside: label > 0 && label < span, text };
}

const SEQUENCE = [[60, 60], [120, 120], [170, 170], [179, 179], [190, -170], [270, -90], [360, 0]];
for (const pickFreeFirst of [false, true]) {
  const tag = pickFreeFirst ? 'free line picked first' : 'fixed line picked first';
  const { S, c, P1, E } = fusionSketch(pickFreeFirst);
  assert(Math.abs(c.value - 30) < 1e-9, `${tag}: created at 30 (${c.value})`);
  assert(Math.abs(freeDir(S, P1, E) - 30) < 1e-9, `${tag}: the free line starts at 30`);
  const first = drawn(S, c);
  assert(Math.abs(first.span - 30) < 1e-6 && first.labelInside, `${tag}: the 30 sector is drawn with its label`);
  // every solve of the walk: the free line's direction (unwrapped)
  const realSolve = S.engine.solve.bind(S.engine);
  let trail = [], last = 30;
  S.engine.solve = (...a) => { const r = realSolve(...a); let d = freeDir(S, P1, E); while (d < last - 180) d += 360; while (d > last + 180) d -= 360; trail.push(d); last = d; return r; };
  let prev = 30;
  for (const [value, fusionDir] of SEQUENCE) {
    trail = [];
    const r = quiet(() => commitDimensionEdit(S.state, c, value));
    assert(!r.reverted, `${tag}: ${value} accepted (${JSON.stringify(r)})`);
    assert.strictEqual(c.value, value, `${tag}: value ${value} stored`);
    const dir = freeDir(S, P1, E);
    assert(Math.abs(signed(dir - fusionDir)) < 1e-6, `${tag}: typed ${value}: the free line is at ${dir.toFixed(6)}, Fusion ${fusionDir}`);
    // continuous: each solve turns it forward by a small step, never back, never a jump
    const steps = [prev, ...trail].map((x, i, a) => (i ? x - a[i - 1] : 0)).slice(1);
    assert(steps.length > 0 && steps.every((s) => s > -1e-6 && s < 31), `${tag}: ${prev} -> ${value} turns in steps ${steps.map((s) => s.toFixed(2)).join(' ')}`);
    assert(Math.abs(trail[trail.length - 1] - value) < 1e-6, `${tag}: the walk ends at ${trail[trail.length - 1]} (unwrapped), not ${value}`);
    prev = value;
    assert(measureResidual(c, S.state.joints, S.state.shapes) < 1e-9, `${tag}: ${value}: the verifier reads it satisfied`);
    // the drawn arc spans the value (reflex past 180) and the label sits in it; at 360 the lines lie on each other: no crossing (no arc), or a
    // zero-length one where rounding leaves them a hair apart (like any 0 degree angle; a full circle is not drawn, see the WORK-LOG)
    const a = drawn(S, c);
    if (value === 360) assert(a === null || Math.min(a.span, 360 - a.span) < 1e-6, `${tag}: 360: the lines lie on each other: ${JSON.stringify(a)}`);
    else {
      assert(a && Math.abs(a.span - value) < 1e-6, `${tag}: ${value}: the arc spans ${a && a.span}`);
      assert.strictEqual(a.large, value > 180 ? 1 : 0, `${tag}: ${value}: large-arc flag`);
      assert(a.labelInside && a.text === `${value.toFixed(1)}°`, `${tag}: ${value}: the label ${a.text} sits inside the arc`);
    }
  }
  S.engine.solve = realSolve;
  // save / load keeps the 360 sector and value (and the next edit back down turns the line the same way back)
  const doc = JSON.parse(JSON.stringify(serializeDocument(S.state)));
  const S2 = L.newSketch(); deserializeDocument(doc, S2.state);
  const c2 = S2.state.constraints.find((x) => x.type === 'angle');
  assert.deepStrictEqual([c2.value, c2.sector], [c.value, c.sector], `${tag}: saved and loaded`);
  assert(!quiet(() => commitDimensionEdit(S2.state, c2, 300)).reverted && Math.abs(signed(freeDir(S2, P1, E) - (-60))) < 1e-6, `${tag}: loaded, 360 -> 300 puts the line at -60`);
  // refused like the box: 0, -30 (and past 360): nothing moves, the value stays
  for (const [bad, why] of [[0, 'an angle must be more than 0 degrees'], [-30, 'an angle must be more than 0 degrees'], [400, 'an angle must be at most 360 degrees']]) {
    const before = L.snapshot(S2), v0 = c2.value;
    const r = quiet(() => commitDimensionEdit(S2.state, c2, bad));
    assert(r.reverted && r.reason === why, `${tag}: ${bad} refused with "${why}": ${JSON.stringify(r)}`);
    assert(c2.value === v0 && L.maxDeviation(S2, before) === 0, `${tag}: ${bad} moved nothing`);
  }
}

// creation is unchanged (task 543): the drop sector picks the value, at most 180, in each of the four sectors
{
  const { S, c } = fusionSketch(false);
  for (const [labelDeg, want] of [[15, 30], [105, 150], [195, 30], [285, 150]]) {
    c.__placing = true; c.__newlyPlaced = true;
    updateConstraintOffset(S.state, c, { x: 10 + 20 * Math.cos(labelDeg * Math.PI / 180), y: 10 + 20 * Math.sin(labelDeg * Math.PI / 180) });
    c.__placing = false; c.__newlyPlaced = false;
    assert(Math.abs(c.value - want) < 1e-9, `label at ${labelDeg}: value ${c.value}, want ${want}`);
    const a = drawn(S, c);
    assert(a && Math.abs(a.span - want) < 1e-6 && a.labelInside, `label at ${labelDeg}: the ${want} sector under it is drawn`);
  }
}
// a parallel added later turns a dimensioned line's joints round (constraint-manager alignParallelOrientation): the angle names that line's
// other ray, so it keeps measuring the same sector and is still satisfied (without that the sector would point 180 degrees away)
{
  const S = L.newSketch();
  const p = (x, y) => L.point(S, x, y);
  const a = L.line(S, p(0, 0), p(100, 0)), b = L.line(S, p(0, 10), p(80, 60)), d = L.line(S, p(200, 200), p(120, 150));
  const c = quiet(() => ConstraintManager.createConstraint(S.state, 'angle', { shapes: [a, b], value: L.measure(S, { type: 'angle', shapes: [a, b] }) }, { source: 'dimension' }));
  const joints0 = L.shape(S, b).joints.join(), v0 = c.value;
  assert(quiet(() => ConstraintManager.createConstraint(S.state, 'parallel', { shapes: [d, b] }, { source: 'test' })), 'parallel added');
  assert.notStrictEqual(L.shape(S, b).joints.join(), joints0, 'the parallel turned line 2 round (its joints swapped)');
  assert.deepStrictEqual(c.sector, { ray1: 1, ray2: -1, turn: 1 }, 'the angle now names line 2\'s other ray');
  assert(c.value === v0 && measureResidual(c, S.state.joints, S.state.shapes) < 1e-9, 'and still holds its value');
}
console.log('angle-over-180: Fusion sequence 30 -> 60 -> 120 -> 170 -> 179 -> 190 -> 270 -> 360 (both pick orders): line directions as Fusion, continuous walk, reflex arcs with the label inside, save/load; 0 / -30 / 400 refused; creation sectors unchanged; a later parallel that turns a line round keeps the sector.');
