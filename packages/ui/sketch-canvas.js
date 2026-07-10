// Shared #core/#ui-backed sketch canvas for a host shell's Design tab (Shaper today).
// `createSketch()` is the headless core (engine + ops, no DOM — testable in Node).
// `mountSketch(svgEl)` (P5a) renders via the REAL shared renderer: it builds the full sketch state
// (#ui/sketch-state.js), creates a world-group render target inside the host svg, seeds a small demo, and runs
// a RAF solve→draw loop (read-only this slice — interactive input arrives in P5b). The host drives start()/stop()
// on tab show/hide so the loop never runs while hidden. Theme: the host's dark --sk-* vars (P1) colour the
// render automatically (P2 routed the renderer through them) — nothing is set here.

import { createEngine } from '#core/constraint-solver.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { SolverConfig } from '#core/solver-config.js';
import { createSketches, stampSketch, sketchOf, hiddenSketchIds } from '#core/sketch-model.js'; // SKETCH-1a/2b: container + visibility
import { draw } from '#ui/svg-renderer.js';
import { createSketchState } from '#ui/sketch-state.js';
import { setupInput } from '#ui/input-manager.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── Headless core (no DOM) ──────────────────────────────────────────────────
export function createSketch() {
  const engine = createEngine(null);
  engine.init(); // adds the fixed j_origin at (0,0)
  const state = {
    joints: engine.getJoints(),
    shapes: engine.getShapes(),
    constraints: engine.getConstraints(),
    engine,
    genJ: engine.genJ,
    ...createSketches(), // SKETCH-1a: state.sketches + activeSketchId (default single 'Sketch 1')
  };
  let lastError = null;
  setConstraintNotifier((msg) => { lastError = msg; });

  // SKETCH-1a: stamp new entities with the active sketch (default sketch-1). Additive — nothing reads sketchId yet.
  const point = (x, y, fixed = false) => { const id = engine.genJ(); engine.addJoint(id, x, y, fixed); stampSketch(state.joints.get(id), state); return id; };
  const line = (x1, y1, x2, y2) => {
    const a = point(x1, y1), b = point(x2, y2);
    const id = 'L_' + a + '_' + b;
    engine.addShape(stampSketch({ id, type: 'line', joints: [a, b] }, state));
    return { id, a, b };
  };
  const coincident = (a, b) => ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [a, b] }, { source: 'design' });
  const distance = (a, b, value) => ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [a, b], value }, { source: 'design' });
  const solve = (iter) => engine.solve(iter || SolverConfig.ITERATIONS || 500);

  return {
    engine, state, point, line, coincident, distance, solve,
    pos: (id) => { const j = state.joints.get(id); return j ? { x: j.x, y: j.y } : null; },
    get lastError() { return lastError; },
  };
}

// Seed a small demo so the canvas visibly renders: a line whose start is coincident with the origin and whose
// length is driven to 50.
function seedDemo(engine, state) {
  const a = engine.genJ(); engine.addJoint(a, 20, 20, false);
  const b = engine.genJ(); engine.addJoint(b, 80, 20, false);
  engine.addShape({ id: 'L_' + a + '_' + b, type: 'line', joints: [a, b] });
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [a, 'j_origin'] }, { source: 'design' });
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [a, b], value: 50 }, { source: 'design' });
}

// ── Mount the full renderer + input into a host <svg> (P5a render + P5b interactive) ─────────────
// opts.isActive: () => boolean — gates the input layer's document-level listeners to the host's active surface
// (so an inactive Design tab doesn't hijack a sibling editor's keyboard/wheel). Defaults to always-active.
// opts.isStatic: (shape) => boolean — OPTIONAL host static-skip seam (UNIFY-throttle): skip that shape + its joint
// glyphs from the per-frame render (the host draws it elsewhere, e.g. a color underlay), so dense scenes stay
// interactive. Omitted (default) = render everything = byte-identical. 'static' is a HOST concept, not a #core flag.
// opts.shouldSolve: () => boolean — OPTIONAL host solve gate (UNIFY-throttle): skip the per-frame engine.solve() when
// it returns false (e.g. idle / nothing being edited). Omitted (default) = always solve = byte-identical.
export function mountSketch(svgEl, opts = {}) {
  const engine = createEngine(null);
  engine.init();
  // view isn't driven yet (no pan/zoom UI); the svg's own viewBox maps world→screen.
  const view = { x: 0, y: 0, w: 120, h: 90 };
  const state = createSketchState(engine, view);
  setConstraintNotifier(() => {}); // host has no toast surface yet

  // World-group: the render target draw() writes into (created once inside the host svg).
  let worldGroup = svgEl && svgEl.querySelector ? svgEl.querySelector('#design-world-group') : null;
  if (!worldGroup && svgEl) {
    worldGroup = document.createElementNS(SVG_NS, 'g');
    worldGroup.id = 'design-world-group';
    svgEl.appendChild(worldGroup);
  }

  seedDemo(engine, state);

  // P5b: interactive input. Host input ctx binds the Design canvas; OMIT getMagEls (loupe) + the toolbar methods
  // (P4 fall-throughs degrade gracefully). isActive gates the document-level listeners to the Design surface.
  const hostInputCtx = {
    getCanvasSvg: () => svgEl,
    getWorldGroup: () => worldGroup,
    getInputHost: () => (typeof document !== 'undefined' ? document.body : null),
  };
  try { setupInput(svgEl, state, { inputCtx: hostInputCtx, isActive: opts.isActive }); } catch (_) { /* non-fatal */ }

  // Render ctx OMITS updateGrid/getSolverStats/injectDebugStyle — the host has no #grid/debug overlay; all
  // three are no-op-safe (P3).
  const renderCtx = {};
  let rafId = null;
  const frame = () => {
    // UNIFY-throttle: each engine.solve() call has an O(joints) setup cost (~1.3s at 13k joints) INDEPENDENT of
    // iteration count, so calling it every frame makes dense scenes unusable even with the render skip. opts.shouldSolve
    // lets the HOST gate solve to when geometry is actually being manipulated (drag/selection); idle frames skip it and
    // the last-solved geometry stays put. DEFAULT (no shouldSolve) = always solve = byte-identical (Studio/Shaper).
    if (!opts.shouldSolve || opts.shouldSolve()) engine.solve(SolverConfig.ITERATIONS || 500);
    // SKETCH-2b: hide a HIDDEN sketch's geometry from the canvas (a layer filter). Default (all visible) → empty set →
    // the originals pass through UNCHANGED → byte-identical. A constraint stays if ANY of its joints is still visible.
    let dJoints = state.joints, dShapes = state.shapes, dConstraints = state.constraints;
    const hidden = hiddenSketchIds(state);
    if (hidden.size) {
      dJoints = new Map(); for (const [id, j] of state.joints) if (!hidden.has(sketchOf(j))) dJoints.set(id, j);
      dShapes = state.shapes.filter((s) => !hidden.has(sketchOf(s)));
      dConstraints = state.constraints.filter((c) => !(c.joints && c.joints.length) || c.joints.some((jid) => { const j = state.joints.get(jid); return j && !hidden.has(sketchOf(j)); }));
    }
    // UNIFY-throttle: a HOST-injected static-skip seam. When opts.isStatic(shape) is provided, SKIP static shapes +
    // their joint glyphs from the per-frame render (the host draws them once in its color underlay); only the FEW
    // live (e.g. selected/edited) shapes redraw each frame -> dense scenes stay interactive. Live joints = those used
    // by a non-static shape, plus the origin + any selected joints (so activation/edit glyphs still show). DEFAULT
    // (no opts.isStatic) leaves dJoints/dShapes/dConstraints UNCHANGED -> byte-identical (Studio/Shaper pass nothing).
    if (typeof opts.isStatic === 'function') {
      const liveShapes = [], liveJ = new Set(['j_origin']);
      for (const s of dShapes) {
        let st; try { st = opts.isStatic(s); } catch (_) { st = false; }
        if (st) continue;
        liveShapes.push(s); if (s.joints) for (const jid of s.joints) liveJ.add(jid);
      }
      if (state.selectedJoints) for (const jid of state.selectedJoints) liveJ.add(jid);
      const fJ = new Map(); for (const [id, j] of dJoints) if (liveJ.has(id)) fJ.set(id, j);
      dJoints = fJ; dShapes = liveShapes;
      dConstraints = dConstraints.filter((c) => !(c.joints && c.joints.length) || c.joints.some((jid) => liveJ.has(jid)));
    }
    draw(dJoints, dShapes, svgEl, state.active, state.snapTarget, dConstraints, state.selectedJoints, state.selectedConstraints, state.currentTool, state.inference, state.selectedShapes, state.hoveredShape, state.hoveredJoint, state.hoveredConstraint, state.activeSnap, state.tempMousePos, state.drag ? true : false, worldGroup, renderCtx);
    try { opts.onRender && opts.onRender(); } catch (_) { /* host hook (e.g. dock refresh) */ }
    rafId = requestAnimationFrame(frame);
  };
  const start = () => { if (rafId == null && typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(frame); };
  const stop = () => { if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } };

  return { state, engine, worldGroup, start, stop };
}
