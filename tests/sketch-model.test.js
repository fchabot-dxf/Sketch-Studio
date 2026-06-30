import { createSketches, sketchOf, stampSketch, constraintSketch, entitiesInSketch, DEFAULT_SKETCH_ID, DEFAULT_SKETCH_NAME } from '#core/sketch-model.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };

  // 1. the default container = EXACTLY one 'Sketch 1' (visible, active)
  {
    const c = createSketches();
    assert(c.sketches.length === 1, 'one sketch');
    assert(c.sketches[0].id === DEFAULT_SKETCH_ID && c.sketches[0].name === DEFAULT_SKETCH_NAME && c.sketches[0].visible === true, 'Sketch 1 visible');
    assert(c.activeSketchId === DEFAULT_SKETCH_ID, 'active = sketch-1');
  }

  // 2. sketchOf fallback — untagged → sketch-1; tagged → its id
  {
    assert(sketchOf({}) === 'sketch-1', 'untagged → default');
    assert(sketchOf({ sketchId: 'sketch-2' }) === 'sketch-2', 'tagged → its id');
    assert(sketchOf(null) === 'sketch-1', 'null → default');
  }

  // 3. stampSketch — sets sketchId = the active sketch
  {
    const state = createSketches();
    assert(stampSketch({ x: 0, y: 0 }, state).sketchId === 'sketch-1', 'stamps the active');
    state.activeSketchId = 'sketch-2';
    assert(stampSketch({}, state).sketchId === 'sketch-2', 'stamps the new active');
    assert(stampSketch({}, {}).sketchId === 'sketch-1', 'no active → default');
  }

  // 4. a fixture → every entity stamped sketch-1; a same-sketch constraint → its HOME; entitiesInSketch
  {
    const state = { ...createSketches(), joints: new Map(), shapes: [], constraints: [] };
    const mkJ = (id) => { state.joints.set(id, stampSketch({ x: 0, y: 0, fixed: false }, state)); return id; };
    mkJ('a'); mkJ('b');
    const sh = stampSketch({ id: 'L', type: 'line', joints: ['a', 'b'] }, state); state.shapes.push(sh);
    assert(state.joints.get('a').sketchId === 'sketch-1' && sh.sketchId === 'sketch-1', 'all stamped sketch-1');
    assert(constraintSketch({ id: 'd1', type: 'distance', joints: ['a', 'b'], value: 50 }, state) === 'sketch-1', 'same-sketch constraint → home sketch-1');
    const ein = entitiesInSketch(state, 'sketch-1');
    assert(ein.joints.length === 2 && ein.shapes.length === 1, 'entitiesInSketch counts sketch-1');
    assert(constraintSketch({ joints: [] }, state) === null, 'no joints → null');
  }

  // 5. a cross-sketch coincidence (two joints in different sketches) → the SPANNING set (the link)
  {
    const state = { ...createSketches(), joints: new Map(), shapes: [], constraints: [] };
    state.sketches.push({ id: 'sketch-2', name: 'Sketch 2', visible: true });
    state.joints.set('p', { x: 0, y: 0, sketchId: 'sketch-1' });
    state.joints.set('q', { x: 0, y: 0, sketchId: 'sketch-2' });
    const r = constraintSketch({ id: 'c1', type: 'coincident', joints: ['p', 'q'] }, state);
    assert(r instanceof Set && r.size === 2 && r.has('sketch-1') && r.has('sketch-2'), 'cross-sketch → spanning Set {sketch-1, sketch-2}');
  }

  console.log('sketch-model tests passed ✅');
})().catch((e) => { console.error('sketch-model tests failed ❌', e); process.exit(1); });
