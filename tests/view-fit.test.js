import assert from 'node:assert';
import { jointBounds, fitViewFor } from '../packages/ui/view-fit.js';

console.log('Running tests for packages/ui/view-fit.js...');

// origin ignored once real geometry exists; included when alone
{
  const joints = new Map([['j_origin', { x: 0, y: 0 }], ['a', { x: 100, y: 200 }], ['b', { x: 300, y: 260 }]]);
  assert.deepStrictEqual(jointBounds({ joints }), { minX: 100, minY: 200, maxX: 300, maxY: 260 });
  assert.deepStrictEqual(jointBounds({ joints: new Map([['j_origin', { x: 0, y: 0 }]]) }), { minX: 0, minY: 0, maxX: 0, maxY: 0 });
}
// the fitted view contains the bounds with margin, is centred on them, and matches the viewport aspect
{
  const b = { minX: 100, minY: 200, maxX: 300, maxY: 260 };
  for (const aspect of [1.6, 0.6]) {
    const v = fitViewFor(b, aspect, 0.1);
    assert.ok(Math.abs(v.w / v.h - aspect) < 1e-9, 'aspect');
    assert.strictEqual(v.x, 200); assert.strictEqual(v.y, 230);
    assert.ok(v.x - v.w / 2 <= 100 - 20 + 1e-9 && v.x + v.w / 2 >= 300 + 20 - 1e-9, 'x margin');
    assert.ok(v.y - v.h / 2 <= 200 - 6 + 1e-9 && v.y + v.h / 2 >= 260 + 6 - 1e-9, 'y margin');
  }
}
// single point -> 10-unit box, never zero-size
{
  const v = fitViewFor({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 1, 0.1);
  assert.ok(v.w >= 10 && v.h >= 10);
}
console.log('view-fit tests passed.');
