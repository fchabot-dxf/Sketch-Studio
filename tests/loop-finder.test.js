import { findLoops } from '#core/loop-finder.js';

(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const mk = (jointArr, shapes, constraints = []) => {
    const joints = new Map();
    for (const [id, x, y] of jointArr) joints.set(id, { x, y });
    return { joints, shapes, constraints };
  };
  const line = (id, a, b) => ({ id, type: 'line', joints: [a, b] });
  const arc = (id, s, c, e) => ({ id, type: 'arc', joints: [s, c, e] }); // start/center/end at [0]/[1]/[2]
  const circle = (id, c, r) => ({ id, type: 'circle', joints: [c], radius: r });

  // 1. Triangle -> 1 loop (3 edges)
  {
    const st = mk([['A', 0, 0], ['B', 4, 0], ['C', 0, 3]],
      [line('e1', 'A', 'B'), line('e2', 'B', 'C'), line('e3', 'C', 'A')]);
    const loops = findLoops(st);
    assert(loops.length === 1, `triangle: expected 1 loop, got ${loops.length}`);
    assert(loops[0].edges.length === 3, `triangle loop should have 3 edges, got ${loops[0].edges.length}`);
    assert(loops[0].closed === true && Array.isArray(loops[0].joints) && typeof loops[0].id === 'string', 'loop shape');
  }

  // 2. Rectangle -> 1
  {
    const st = mk([['A', 0, 0], ['B', 4, 0], ['C', 4, 3], ['D', 0, 3]],
      [line('e1', 'A', 'B'), line('e2', 'B', 'C'), line('e3', 'C', 'D'), line('e4', 'D', 'A')]);
    assert(findLoops(st).length === 1, 'rectangle: expected 1 loop');
  }

  // 3. Two rectangles sharing an edge (B-C) -> 2 MINIMAL loops (the KEY case, not the big outer one)
  {
    const st = mk([['A', 0, 0], ['B', 2, 0], ['C', 2, 2], ['D', 0, 2], ['E', 4, 0], ['F', 4, 2]],
      [line('ab', 'A', 'B'), line('bc', 'B', 'C'), line('cd', 'C', 'D'), line('da', 'D', 'A'),
       line('be', 'B', 'E'), line('ef', 'E', 'F'), line('fc', 'F', 'C')]);
    const loops = findLoops(st);
    assert(loops.length === 2, `two rects sharing an edge: expected 2 minimal loops, got ${loops.length}`);
    for (const l of loops) assert(l.edges.length === 4, `each rect loop should have 4 edges, got ${l.edges.length}`);
  }

  // 4. Single circle -> 1
  {
    assert(findLoops(mk([['Z', 0, 0]], [circle('c1', 'Z', 5)])).length === 1, 'single circle: expected 1 loop');
  }

  // 5. Open polyline -> 0
  {
    const st = mk([['A', 0, 0], ['B', 2, 0], ['C', 2, 2]], [line('e1', 'A', 'B'), line('e2', 'B', 'C')]);
    assert(findLoops(st).length === 0, 'open polyline: expected 0 loops');
  }

  // 6. Closed loop + a dangling edge -> 1 (the dangle is excluded)
  {
    const st = mk([['A', 0, 0], ['B', 4, 0], ['C', 0, 3], ['D', 6, 3]],
      [line('e1', 'A', 'B'), line('e2', 'B', 'C'), line('e3', 'C', 'A'), line('dangle', 'C', 'D')]);
    const loops = findLoops(st);
    assert(loops.length === 1, `closed loop + dangle: expected 1 loop, got ${loops.length}`);
    assert(!loops[0].edges.includes('dangle'), 'the dangling edge must be excluded from the loop');
  }

  // 7. Coincident-merged triangle (each line owns its endpoints, joined by coincident) -> 1
  {
    const st = mk([['a0', 0, 0], ['a1', 4, 0], ['b0', 4, 0], ['b1', 0, 3], ['c0', 0, 3], ['c1', 0, 0]],
      [line('L1', 'a0', 'a1'), line('L2', 'b0', 'b1'), line('L3', 'c0', 'c1')],
      [{ type: 'coincident', joints: ['a1', 'b0'] }, { type: 'coincident', joints: ['b1', 'c0'] }, { type: 'coincident', joints: ['c1', 'a0'] }]);
    assert(findLoops(st).length === 1, 'coincident-merged triangle: expected 1 loop');
  }

  // 8. Arc-closed shape (an arc as one edge of a 3-edge loop) -> 1
  {
    const st = mk([['A', 0, 0], ['B', 4, 0], ['C', 4, 4], ['M', 0, 4]],
      [line('e1', 'A', 'B'), line('e2', 'B', 'C'), arc('e3', 'C', 'M', 'A')]);
    assert(findLoops(st).length === 1, 'arc-closed loop: expected 1 loop');
  }

  // Determinism: same input -> same ids/order
  {
    const st = mk([['A', 0, 0], ['B', 4, 0], ['C', 0, 3]],
      [line('e1', 'A', 'B'), line('e2', 'B', 'C'), line('e3', 'C', 'A')]);
    const a = findLoops(st).map(l => l.id).join(','), b = findLoops(st).map(l => l.id).join(',');
    assert(a === b && a.length > 0, 'deterministic loop ids');
  }

  console.log('loop-finder tests passed ✅');
})().catch(e => { console.error('loop-finder tests failed ❌', e); process.exit(1); });
