// Zoom-extents for a mounted sketch: frames every joint in state.joints (origin included only if it is
// the sole joint) inside the host <svg> with a margin. Additive shared helper (VIEW-FIT) -- mountSketch's
// default view is a fixed 120x90 box centred on the origin, so a host that builds geometry elsewhere in
// the world must call this once after building. view = { x, y, w, h } is CENTRE-based (see
// input-handlers/pan-zoom.js updateViewBox: viewBox = x - w/2, y - h/2, w, h).

/** @returns {{minX,minY,maxX,maxY}|null} bounds of all joints, or null when there are none. */
export function jointBounds(state) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [id, j] of state.joints) {
    if (id === 'j_origin' && state.joints.size > 1) continue;
    if (!isFinite(j.x) || !isFinite(j.y)) continue;
    if (j.x < minX) minX = j.x; if (j.x > maxX) maxX = j.x;
    if (j.y < minY) minY = j.y; if (j.y > maxY) maxY = j.y;
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/**
 * Pure: the centre-based view that frames `b` with `margin` (fraction of the span, per side) for a
 * viewport aspect ratio (width/height). Degenerate spans fall back to a 10-unit box.
 */
export function fitViewFor(b, aspect, margin = 0.12) {
  const spanX = Math.max(b.maxX - b.minX, 1e-6), spanY = Math.max(b.maxY - b.minY, 1e-6);
  let w = spanX * (1 + 2 * margin), h = spanY * (1 + 2 * margin);
  if (spanX < 1e-3 && spanY < 1e-3) { w = 10; h = 10; }
  if (w / h < aspect) w = h * aspect; else h = w / aspect; // grow the short axis to the viewport shape
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, w, h };
}

/** Frames state's geometry in `svg`; no-op (returns false) when there is nothing to frame or the svg has no size yet. */
export function fitViewToGeometry(svg, state, margin = 0.12) {
  const b = jointBounds(state);
  const rect = svg.getBoundingClientRect();
  if (!b || !rect.width || !rect.height) return false;
  const v = fitViewFor(b, rect.width / rect.height, margin);
  state.view.x = v.x; state.view.y = v.y; state.view.w = v.w; state.view.h = v.h;
  svg.setAttribute('viewBox', `${v.x - v.w / 2} ${v.y - v.h / 2} ${v.w} ${v.h}`);
  return true;
}
