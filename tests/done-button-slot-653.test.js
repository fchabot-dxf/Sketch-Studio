// tests/done-button-slot-653.test.js -- TASK 653 (node, no browser): placeDone (packages/ui/done-button.js), the one placement rule of the green check.
// With every slot blocked it never returns a slot on or within 44 px of the anchor; where a slot is free it is the same one as before (below-right first).
import assert from 'node:assert';
import { placeDone } from '../packages/ui/done-button.js';

const canvas = { left: 0, top: 0, right: 390, bottom: 700 };
const centreGap = ([x, y], size, a) => Math.hypot(x + size / 2 - a.x, y + size / 2 - a.y);
for (const size of [40, 52]) {
  // 1. a free slot: below-right of the anchor, exactly as the old code
  const mid = { x: 200, y: 300 };
  assert.deepStrictEqual(placeDone({ anchor: mid, size, bounds: canvas, obstacles: [] }), [mid.x + 16, mid.y + 16], `[${size}] free: below-right`);
  // 2. below-right blocked by a box: above-right, as the old code
  const box = { left: mid.x + 10, top: mid.y + 10, right: mid.x + 120, bottom: mid.y + 50 };
  assert.deepStrictEqual(placeDone({ anchor: mid, size, bounds: canvas, obstacles: [box] }), [mid.x + 16, mid.y - 16 - size], `[${size}] blocked below-right: above-right`);
  // 3. every slot blocked (the whole canvas is covered), anchors all over, the corners and the edges included
  const all = [{ left: -10, top: -10, right: 400, bottom: 710 }];
  for (const ax of [0, 20, 195, 370, 390]) for (const ay of [0, 20, 350, 680, 700]) {
    const a = { x: ax, y: ay };
    const p = placeDone({ anchor: a, size, bounds: canvas, obstacles: all });
    assert(p.every(Number.isFinite), `[${size}] a finite slot at ${JSON.stringify(a)}`);
    assert(p[0] >= 4 && p[1] >= 4 && p[0] + size <= 386 && p[1] + size <= 696, `[${size}] inside the canvas at ${JSON.stringify(a)}: ${p}`);
    assert(centreGap(p, size, a) >= 44, `[${size}] never on / within 44 px of the anchor ${JSON.stringify(a)}: ${p} gap ${centreGap(p, size, a)}`);
  }
  // 4. the 653 phone case: corner 40 px inside the bottom-right, a box left of it and an arrow above it
  const a = { x: 350, y: 660 };
  const p = placeDone({ anchor: a, size, bounds: canvas, obstacles: [{ left: 200, top: 640, right: 336, bottom: 678 }, { left: 330, top: 560, right: 370, bottom: 600 }] });
  assert(centreGap(p, size, a) >= 44, `[${size}] phone corner: ${p}`);
}
console.log('done-button-slot-653.test.js: ok');
