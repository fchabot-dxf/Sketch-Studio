// Shared, minimal #core-backed sketch canvas — the S1 load-safe PROOF that Shaper (and any shell) can host
// the same constraint sketcher SketchStudio uses. Self-contained: imports #core ONLY, plus a TINY inline
// renderer + pointer input — just enough to draw a line, add a coincident + a distance, solve, and render.
//
// NOTE: the renderer/input here are intentionally minimal and TEMPORARY. The real svg-renderer + input-manager
// (+ full tool palette) move to #ui/ in later slices (S3/S4); this slice only proves the mount + #core path.
//
// `createSketch()` is headless (engine + ops, no DOM — testable in Node). `mountSketch(svgEl)` adds the DOM
// renderer/input and seeds a demo sketch.

import { createEngine } from '#core/constraint-solver.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { SolverConfig } from '#core/solver-config.js';
import { screenToWorld } from '#ui/coords.js'; // shared screen<->world math (same as SketchStudio)

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
  };
  let lastError = null;
  setConstraintNotifier((msg) => { lastError = msg; });

  const point = (x, y, fixed = false) => { const id = engine.genJ(); engine.addJoint(id, x, y, fixed); return id; };
  const line = (x1, y1, x2, y2) => {
    const a = point(x1, y1), b = point(x2, y2);
    const id = 'L_' + a + '_' + b;
    engine.addShape({ id, type: 'line', joints: [a, b] });
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

// ── Tiny SVG renderer (draws in WORLD coords; the svg's viewBox maps world→screen) ──
function renderInto(svgEl, sketch) {
  const out = [];
  // origin marker
  out.push('<line x1="-3" y1="0" x2="3" y2="0" stroke="#3b4252" stroke-width="0.4"/>');
  out.push('<line x1="0" y1="-3" x2="0" y2="3" stroke="#3b4252" stroke-width="0.4"/>');
  // line shapes
  for (const s of sketch.state.shapes) {
    if (s.type !== 'line' || !s.joints || s.joints.length < 2) continue;
    const a = sketch.pos(s.joints[0]), b = sketch.pos(s.joints[1]);
    if (a && b) out.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#60a5fa" stroke-width="0.8" stroke-linecap="round"/>`);
  }
  // distance dimension labels (at the segment midpoint)
  for (const c of sketch.state.constraints) {
    if (c.type !== CONSTRAINT_TYPES.DISTANCE || !c.joints || c.joints.length < 2 || typeof c.value !== 'number') continue;
    const a = sketch.pos(c.joints[0]), b = sketch.pos(c.joints[1]);
    if (a && b) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      out.push(`<text x="${mx}" y="${my - 1.5}" font-size="4" fill="#93c5fd" text-anchor="middle">${(c.value).toFixed(1)}</text>`);
    }
  }
  // joints (skip the origin to keep it subtle)
  for (const [id, j] of sketch.state.joints) {
    if (id === 'j_origin') continue;
    out.push(`<circle cx="${j.x}" cy="${j.y}" r="1.3" fill="#e5e7eb" stroke="#2563eb" stroke-width="0.4"/>`);
  }
  svgEl.innerHTML = out.join('');
}

// ── Mount into a DOM <svg> ──────────────────────────────────────────────────
export function mountSketch(svgEl) {
  const sketch = createSketch();

  // Seed a demo so the proof renders immediately: a line whose start is coincident with the origin and whose
  // length is driven to 50 — exercises draw + coincident + distance + solve + render in one shot.
  const seg = sketch.line(20, 20, 80, 20);
  sketch.coincident(seg.a, 'j_origin');
  sketch.distance(seg.a, seg.b, 50);
  sketch.solve();

  const render = () => renderInto(svgEl, sketch);
  render();

  // Tiny input: click to drop joints; two consecutive clicks make a line segment. Then solve + render.
  // Screen→world via the SHARED #ui/coords.js (identical math to SketchStudio).
  let pending = null;
  const onPointerDown = (e) => {
    const w = screenToWorld(svgEl, e.clientX, e.clientY); if (!w) return;
    const id = sketch.point(w.x, w.y);
    if (pending) {
      const sid = 'L_' + pending + '_' + id;
      sketch.engine.addShape({ id: sid, type: 'line', joints: [pending, id] });
      pending = null;
    } else {
      pending = id;
    }
    sketch.solve();
    render();
  };
  if (svgEl && svgEl.addEventListener) svgEl.addEventListener('pointerdown', onPointerDown);

  return {
    sketch,
    render,
    destroy: () => { if (svgEl && svgEl.removeEventListener) svgEl.removeEventListener('pointerdown', onPointerDown); },
  };
}
