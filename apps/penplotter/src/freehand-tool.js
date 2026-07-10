// apps/penplotter/src/freehand-tool.js — UNIFY-4b: the plotter's FREEHAND tool, composed PLOTTER-SIDE on the shared
// #ui sketcher canvas (keeps #ui byte-identical — no #ui tool-mode added). A CAPTURE-PHASE pointer listener on the
// #design-canvas svg: while state.currentTool === 'freehand' it collects world points and stopImmediatePropagation()s
// so #ui's (bubble-phase) pan-zoom never fires; on pointerup it fits the stroke to cubic beziers (Schneider,
// #core/curve-fit) and adds them to the #core store as a CONNECTED chain of makeBezier shapes (shared endpoint
// joints). The result is COMPACT #core bezier geometry — targetable by a toolpath (UNIFY-2), not a dense polyline.

import { fitCubic } from '#core/curve-fit.js';
import { makeBezier } from '#core/shapes.js';
import { screenToWorld } from '#ui/coords.js';

// installFreehandTool(svgEl, controller, opts?) — opts: { tolerance?, onCommit? }.
export function installFreehandTool(svgEl, controller, opts = {}) {
  const state = controller.state, engine = controller.engine;
  const tolerance = opts.tolerance || 1.5; // world units; higher -> fewer, smoother segments (solver-light)
  let stroke = null;

  const active = () => state.currentTool === 'freehand';
  const worldPt = (e) => screenToWorld(svgEl, e.clientX, e.clientY);
  const mkJoint = (p) => { const id = engine.genJ(); engine.addJoint(id, p.x, p.y, false); return id; };

  const onDown = (e) => {
    if (!active() || e.button !== 0) return;
    e.stopImmediatePropagation(); e.preventDefault();      // win over #ui's svg + document pointer listeners
    try { svgEl.setPointerCapture(e.pointerId); } catch (_) {}
    stroke = [worldPt(e)];
  };
  const onMove = (e) => {
    if (!stroke) return;
    e.stopImmediatePropagation();
    stroke.push(worldPt(e));
  };
  const onUp = (e) => {
    if (!stroke) return;
    e.stopImmediatePropagation();
    try { svgEl.releasePointerCapture(e.pointerId); } catch (_) {}
    commit(stroke);
    stroke = null;
  };

  function commit(points) {
    const segs = fitCubic(points, tolerance);
    if (!segs.length) return;
    // Connected chain: consecutive segments SHARE the endpoint joint (N segments -> N+1 joints), so the strokes join
    // as one #core polyline-of-beziers (editable; the endpoints participate in the solver, controls stay data).
    let prevEndId = null;
    for (const s of segs) {
      const p0Id = prevEndId != null ? prevEndId : mkJoint(s.p0);
      const p3Id = mkJoint(s.p3);
      const { shapes } = makeBezier(state.joints, p0Id, p3Id, [s.c1.x, s.c1.y], [s.c2.x, s.c2.y]);
      engine.addShape(shapes[0]);
      prevEndId = p3Id;
    }
    if (typeof opts.onCommit === 'function') { try { opts.onCommit(segs); } catch (_) {} }
  }

  // Capture phase (useCapture=true) so these run BEFORE #ui's bubble-phase svg listeners; when freehand is inactive
  // they no-op (don't stopPropagation) so line/rect/circle/arc/select + pan-zoom behave normally.
  svgEl.addEventListener('pointerdown', onDown, true);
  svgEl.addEventListener('pointermove', onMove, true);
  svgEl.addEventListener('pointerup', onUp, true);
  svgEl.addEventListener('pointercancel', onUp, true);
}
