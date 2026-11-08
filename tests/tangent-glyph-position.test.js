// tests/tangent-glyph-position.test.js — TASK 491: one tangent glyph per tangent constraint, AT its tangency point.
import assert from 'node:assert';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };
const { draw } = await import('../packages/ui/svg-renderer.js');

const glyphPositions = (joints, shapes, constraints) => {
  const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 700, height: 500 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 700, height: 500 }), innerHTML: '' };
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, null, false, null);
  return [...svg.innerHTML.matchAll(/data-ctype="tangent"[^>]*transform="translate\(([-\d.]+),([-\d.]+)\)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
};
const foot = (a, b, c) => {
  const dx = b.x - a.x, dy = b.y - a.y, t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy);
  return { x: a.x + dx * t, y: a.y + dy * t };
};
const near = (p, q, tol) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
const allDistinct = (ps) => ps.every((p, i) => ps.every((q, j) => i === j || !near(p, q, 0.5)));

// 1) line + circle, tangent: circle centre (200,200) r 50 sits on the line y = 250
{
  const joints = new Map([['a', { x: 50, y: 250 }], ['b', { x: 400, y: 250 }], ['c', { x: 200, y: 200 }], ['r', { x: 250, y: 200 }]]);
  const shapes = [{ id: 'L', type: 'line', joints: ['a', 'b'] }, { id: 'C', type: 'circle', joints: ['c', 'r'] }];
  const ps = glyphPositions(joints, shapes, [{ id: 't', type: 'tangent', line: 'L', circle: 'C' }]);
  assert.strictEqual(ps.length, 1, 'one glyph for one tangent constraint');
  assert(near(ps[0], foot(joints.get('a'), joints.get('b'), joints.get('c')), 6), 'line+circle glyph within 6px of the tangency point');
}

// 2) fillet corner: two lines meeting at a 90 degree corner, arc between the trimmed ends -> two glyphs, one per point
{
  const joints = new Map([['a', { x: 100, y: 400 }], ['ta', { x: 100, y: 250 }], ['c', { x: 150, y: 250 }], ['tb', { x: 150, y: 300 }], ['b', { x: 400, y: 300 }]]);
  // vertical line a-ta ends at (100,250); arc centre (150,250) r 50 touches it there and the horizontal line y=300 at (150,300)
  joints.set('ta', { x: 100, y: 250 }); joints.set('a', { x: 100, y: 50 });
  const shapes = [
    { id: 'LA', type: 'line', joints: ['a', 'ta'] }, { id: 'LB', type: 'line', joints: ['tb', 'b'] },
    { id: 'ARC', type: 'arc', joints: ['c', 'ta', 'tb'] },
  ];
  const cons = [{ id: 't1', type: 'tangent', line: 'LA', circle: 'ARC' }, { id: 't2', type: 'tangent', line: 'LB', circle: 'ARC' }];
  const ps = glyphPositions(joints, shapes, cons);
  assert.strictEqual(ps.length, 2, 'a fillet has two tangent constraints, so two glyphs');
  const want = [foot(joints.get('a'), joints.get('ta'), joints.get('c')), foot(joints.get('tb'), joints.get('b'), joints.get('c'))];
  want.forEach((w, i) => assert(near(ps[i], w, 6), `fillet glyph ${i} within 6px of its tangency point`));
  assert(allDistinct(ps), 'no two tangent glyphs share a position');
}

console.log('tangent-glyph-position.test.js passed');
