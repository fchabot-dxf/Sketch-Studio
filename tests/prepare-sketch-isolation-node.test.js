// tests/prepare-sketch-isolation-node.test.js
// Same-sketch auto-hole behavior is preserved (directlyContainedLoops includes inner holes in the same sketch),
// while enclosing loops across DIFFERENT sketches do NOT auto-nest as holes; explicit Combine across sketches still works.
import assert from 'node:assert';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { directlyContainedLoops, derivedProfileForLoop, resolveProfileForLoop, resolveProfileAtPoint, makeProfile, deriveProfileCuts } from '#core/profile-model.js';

function polysFor(state) {
  const loops = findLoops(state);
  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const polys = {};
  for (const l of loops) polys[l.id] = loopPolygon(l, state, shapeById);
  return { loops, polys };
}

function rectShapes(prefix, p0, p1, sketchId) {
  const [x0, y0] = p0, [x1, y1] = p1;
  const joints = [
    [`${prefix}0`, { x: x0, y: y0, ...(sketchId ? { sketchId } : {}) }],
    [`${prefix}1`, { x: x1, y: y0, ...(sketchId ? { sketchId } : {}) }],
    [`${prefix}2`, { x: x1, y: y1, ...(sketchId ? { sketchId } : {}) }],
    [`${prefix}3`, { x: x0, y: y1, ...(sketchId ? { sketchId } : {}) }],
  ];
  const shapes = [
    { id: `${prefix}a`, type: 'line', joints: [`${prefix}0`, `${prefix}1`], ...(sketchId ? { sketchId } : {}) },
    { id: `${prefix}b`, type: 'line', joints: [`${prefix}1`, `${prefix}2`], ...(sketchId ? { sketchId } : {}) },
    { id: `${prefix}c`, type: 'line', joints: [`${prefix}2`, `${prefix}3`], ...(sketchId ? { sketchId } : {}) },
    { id: `${prefix}d`, type: 'line', joints: [`${prefix}3`, `${prefix}0`], ...(sketchId ? { sketchId } : {}) },
  ];
  return { joints, shapes };
}

let checks = 0;

// 1. Two different sketches: outer rect in sketch-2 encloses inner rect in sketch-1 -> NOT an auto-hole.
{
  const s1 = rectShapes('s1_', [20, 20], [80, 80], 'sketch-1');
  const s2 = rectShapes('s2_', [0, 0], [100, 100], 'sketch-2');
  const state = {
    joints: new Map([...s1.joints, ...s2.joints]),
    shapes: [...s1.shapes, ...s2.shapes],
    constraints: [],
    profiles: [],
  };
  const { loops, polys } = polysFor(state);
  const outerLoop = loops.find((l) => l.edges.includes('s2_a'));
  const innerLoop = loops.find((l) => l.edges.includes('s1_a'));
  assert(outerLoop && innerLoop, 'both loops found');

  assert.deepStrictEqual(directlyContainedLoops(outerLoop, loops, polys, state), [], 'different sketch inner loop is not directly contained');
  const derived = derivedProfileForLoop(outerLoop.id, loops, polys, state);
  assert.deepStrictEqual(derived.inners, [], 'derived profile across different sketches has no holes');

  // Point between outer and inner resolves to outer ONLY (no hole from sketch-1)
  const atOuter = resolveProfileAtPoint({ x: 5, y: 50 }, state, loops, polys);
  assert.strictEqual(atOuter.outer, outerLoop.id);
  assert.deepStrictEqual(atOuter.inners, [], 'resolveProfileAtPoint in outer ring has no sketch-1 hole');

  // Point inside inner resolves to inner slat cleanly
  const atInner = resolveProfileAtPoint({ x: 50, y: 50 }, state, loops, polys);
  assert.strictEqual(atInner.outer, innerLoop.id);

  // Explicit Combine across sketches STILL produces a compound profile with the hole if desired
  const prof = makeProfile(state, outerLoop, [innerLoop]);
  const combined = resolveProfileForLoop(outerLoop.id, state, loops, polys);
  assert.strictEqual(combined.isDerived, false);
  assert.strictEqual(combined.id, prof.id);
  assert.deepStrictEqual(combined.inners, [innerLoop.id]);
  const cuts = deriveProfileCuts({ kind: 'profile', id: prof.id }, { cutType: 'outside' }, state, loops, polys);
  assert.strictEqual(cuts.length, 2, 'explicit combined cross-sketch profile cuts outer + inner hole');
  checks += 8;
}

// 2. Same sketch: outer rect in sketch-1 encloses hole in sketch-1, even alongside another sketch's shapes -> auto-hole preserved!
{
  const outer1 = rectShapes('o1_', [0, 0], [100, 100], 'sketch-1');
  const hole1 = rectShapes('h1_', [20, 20], [80, 80], 'sketch-1');
  const midOther = rectShapes('m2_', [10, 10], [90, 90], 'sketch-2'); // intermediate rect in sketch-2 does NOT mask h1 in sketch-1
  const state = {
    joints: new Map([...outer1.joints, ...hole1.joints, ...midOther.joints]),
    shapes: [...outer1.shapes, ...hole1.shapes, ...midOther.shapes],
    constraints: [],
    profiles: [],
  };
  const { loops, polys } = polysFor(state);
  const outerL = loops.find((l) => l.edges.includes('o1_a'));
  const holeL = loops.find((l) => l.edges.includes('h1_a'));

  const direct = directlyContainedLoops(outerL, loops, polys, state).map((l) => l.id);
  assert.deepStrictEqual(direct, [holeL.id], 'same-sketch hole is directly contained and ignoring intermediate loop in another sketch');
  checks += 1;
}

// 3. Untagged legacy entities (no sketchId) all default to sketch-1 -> auto-hole preserved!
{
  const outer = rectShapes('u1_', [0, 0], [100, 100]);
  const hole = rectShapes('u2_', [25, 25], [75, 75]);
  const state = {
    joints: new Map([...outer.joints, ...hole.joints]),
    shapes: [...outer.shapes, ...hole.shapes],
    constraints: [],
    profiles: [],
  };
  const { loops, polys } = polysFor(state);
  const outerL = loops.find((l) => l.edges.includes('u1_a'));
  const holeL = loops.find((l) => l.edges.includes('u2_a'));
  assert.deepStrictEqual(directlyContainedLoops(outerL, loops, polys, state).map((l) => l.id), [holeL.id], 'untagged loops default to same sketch');
  checks += 1;
}

console.log(`prepare-sketch-isolation-node: ${checks} checks passed`);
