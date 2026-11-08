// tests/cut-travel.test.js — TASK 449: conventional TRAVEL direction per cut (Shaper Origin always cuts conventionally).
// Directions are as seen ON SCREEN (world y points DOWN). Independent check: on the LEFT half of a closed path, edges run
// DOWN the screen (dy > 0) for a counter-clockwise loop and UP for a clockwise one.
import assert from 'node:assert';
import { deriveCutFootprint, deriveCutTravel, orientOnScreen, arrowsAlongClosed } from '#core/profile-model.js';

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]; // TL TR BR BL = clockwise on screen
const screenDir = (poly) => {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  let dyLeft = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; if ((a.x + b.x) / 2 < cx) dyLeft += b.y - a.y; }
  return dyLeft > 0 ? 'ccw' : 'cw';
};
// the helper itself, on the hand-checkable square: TL->TR->BR->BL is clockwise on screen
assert.strictEqual(screenDir(rect(0, 0, 10, 10)), 'cw');
assert.strictEqual(screenDir(orientOnScreen(rect(0, 0, 10, 10), 'ccw')), 'ccw');
assert.strictEqual(screenDir(orientOnScreen(rect(0, 0, 10, 10).reverse(), 'cw')), 'cw');

const rec = (cutType) => ({ cutType, toolDia: 4, cutOffset: 0 });
const travelOf = (cuts, r) => deriveCutTravel(deriveCutFootprint(cuts, r, null));
const loopCut = (poly, cutType, offsetSide) => ({ kind: 'loop', polygon: poly, cutType, offsetSide });

// Outside on a square → CCW; Inside → CW
{
  const [o] = travelOf([loopCut(rect(0, 0, 60, 40), 'exterior', 1)], rec('exterior'));
  assert.strictEqual(o.role, 'outside'); assert.strictEqual(o.direction, 'ccw'); assert.strictEqual(screenDir(o.path), 'ccw');
  const [i] = travelOf([loopCut(rect(0, 0, 60, 40), 'interior', -1)], rec('interior'));
  assert.strictEqual(i.role, 'inside'); assert.strictEqual(i.direction, 'cw'); assert.strictEqual(screenDir(i.path), 'cw');
  // the stored winding does not matter (the Origin ignores it): a reversed input gives the same travel
  const [o2] = travelOf([loopCut(rect(0, 0, 60, 40).reverse(), 'exterior', 1)], rec('exterior'));
  assert.strictEqual(screenDir(o2.path), 'ccw');
}
// an Outside frame (deriveProfileCuts order: holes first as INSIDE cuts, outer last as outside) → hole CW, outer CCW
{
  const cuts = [loopCut(rect(20, 10, 20, 20), 'interior', -1), loopCut(rect(0, 0, 60, 40), 'exterior', 1)];
  const t = travelOf(cuts, rec('exterior'));
  assert.deepStrictEqual(t.map((x) => [x.role, screenDir(x.path)]), [['inside', 'cw'], ['outside', 'ccw']]);
}
// a Pocket with an island → finish wall CW, island CCW
{
  const cut = { isCompound: true, outerPoly: rect(0, 0, 60, 40), holePolys: [rect(25, 15, 10, 10)] };
  const t = travelOf([cut], rec('pocket'));
  assert.deepStrictEqual(t.map((x) => [x.role, screenDir(x.path)]), [['wall', 'cw'], ['island', 'ccw']]);
  // the wall path is the bit-centre inset by the radius (r = 2): x from 2 to 58
  const xs = t[0].path.map((p) => p.x); assert.ok(Math.abs(Math.min(...xs) - 2) < 1e-6 && Math.abs(Math.max(...xs) - 58) < 1e-6, 'wall centre path = inset by r');
}
// On line and Guide → no direction (closed loop and open chain)
{
  assert.deepStrictEqual(travelOf([loopCut(rect(0, 0, 60, 40), 'online', 0)], rec('online')), []);
  assert.deepStrictEqual(travelOf([loopCut(rect(0, 0, 60, 40), 'guide', 0)], rec('guide')), []);
  const state = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 50, y: 0 }]]) };
  const chainCut = { kind: 'chain', chain: { shapes: [{ id: 's', type: 'line', joints: ['a', 'b'] }] }, offsetSide: 0 };
  assert.deepStrictEqual(deriveCutTravel(deriveCutFootprint([chainCut], rec('online'), state)), []);
}
// too-big bit / collapsed centre path → no travel (no garbage)
assert.deepStrictEqual(travelOf([loopCut(rect(0, 0, 60, 40), 'interior', -1)], { cutType: 'interior', toolDia: 50, cutOffset: 0 }), []);

// arrows: evenly spaced, tangent to the path in the travel direction (the reduced-motion fallback data)
{
  const [o] = travelOf([loopCut(rect(0, 0, 60, 40), 'exterior', 1)], rec('exterior'));
  assert.strictEqual(o.arrows.length, 6);
  for (const a of o.arrows) {
    // the arrow angle equals the direction of the path edge it sits on
    let best = Infinity;
    for (let i = 0; i < o.path.length; i++) {
      const p = o.path[i], q = o.path[(i + 1) % o.path.length];
      const dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy; if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((a.x - p.x) * dx + (a.y - p.y) * dy) / l2));
      if (Math.hypot(p.x + dx * t - a.x, p.y + dy * t - a.y) < 1e-6) { const ang = Math.atan2(dy, dx); best = Math.min(best, Math.abs(Math.atan2(Math.sin(ang - a.angle), Math.cos(ang - a.angle)))); }
    }
    assert.ok(best < 1e-6, 'arrow lies on the path and points along it');
  }
  assert.deepStrictEqual(arrowsAlongClosed([], 6), []);
}
// reduced-motion fallback: the dashes animate with a CSS animation (no RAF) and prefers-reduced-motion turns it OFF and shows
// the static arrows instead (arrows are hidden otherwise). Computed styles are checked live in headless Edge (evidence).
{
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../apps/shaper/index.html', import.meta.url), 'utf8');
  assert.ok(/\.sk-travel\s*\{[^}]*animation:\s*sk-march/.test(html), 'dashes animate via a CSS animation');
  assert.ok(/@keyframes sk-march \{ from \{ stroke-dashoffset: 0; \} to \{ stroke-dashoffset: -12; \} \}/.test(html), 'forward-marching keyframes (offset decreases)');
  assert.ok(/\.sk-travel-arrows\s*\{\s*display:\s*none/.test(html), 'arrows hidden by default');
  assert.ok(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.sk-travel\s*\{\s*animation:\s*none[^}]*\}[^}]*\.sk-travel-arrows\s*\{\s*display:\s*inline/.test(html), 'reduced motion: no animation, static arrows');
  const view = readFileSync(new URL('../apps/shaper/src/prepare-view.js', import.meta.url), 'utf8');
  assert.ok(!/requestAnimationFrame/.test(view), 'no RAF loop in the Prepare view');
  // no climb/conventional switch anywhere: no field or control named climb
  const cutRec = readFileSync(new URL('../apps/shaper/src/shaper.js', import.meta.url), 'utf8');
  assert.ok(!/climb/i.test(cutRec + view), 'no climb mode/field in the shaper cut record or Prepare view');
}
console.log('cut-travel: ok');
