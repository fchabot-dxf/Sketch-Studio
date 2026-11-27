// packages/ui/drag-arrow-handle.js -- ONE shared drag handle for the canvas tools (TASK 648): a chunky outlined grey ARROW that sits on a
// point and points along the way a drag grows the value (the fillet radius; the coming Offset distance). Used instead of a joint-style
// circle. Declarative: the host rebuilds its overlay markup from state, so the component is two pure functions and no state.
//
//   dragArrowSvg({ point, dir, scale, state, className })  -> SVG markup string, in the overlay's WORLD coordinates
//       point  { x, y }   the world point the arrow is centred on
//       dir    { x, y }   the drag direction (need not be unit length); the arrow points along it
//       scale  number     screen pixels per world unit (the overlay's scale), so the arrow keeps a constant size on screen
//       state  'idle' | 'hover' | 'drag'   hover / drag draw the arrow darker (CSS: .sk-drag-arrow[data-state=...])
//       className string  an extra class the host uses to find the arrow (e.g. 'fillet-handle')
//   dragArrowHit(pointerScreen, pointScreen, isTouch, boost) -> true when the pointer is within the arrow's reach
//   dragArrowUnder(root, pointerScreen, isTouch, boost) -> true when the pointer is within reach of an arrow drawn under root
//   dragArrowDirection(pointAt, v) -> unit direction from the points a locus passes through at two values (v, v + dv)
//
// Colours come from the CSS tokens --sk-arrow-fill / --sk-arrow-stroke (+ -hover / -drag fills) in packages/ui/sketcher.css. No tooltip.
export const ARROW_LENGTH_PX = 30;
export const ARROW_HIT_PX = 22; // reach radius: a 44 px target

// the arrow in local pixels, +x = its direction; centred on the origin
const OUTLINE = [[-15, -5], [1, -5], [1, -11], [15, 0], [1, 11], [1, 5], [-15, 5]];

export function dragArrowSvg({ point, dir, scale, state = 'idle', className = '' }) {
  const m = Math.hypot(dir.x, dir.y) || 1, ux = dir.x / m, uy = dir.y / m, k = 1 / scale;
  const pts = OUTLINE.map(([a, b]) => `${point.x + (a * ux - b * uy) * k},${point.y + (a * uy + b * ux) * k}`).join(' ');
  return `<polygon class="sk-drag-arrow ${className}" data-state="${state}" points="${pts}" stroke-width="${2 * k}" />`;
}

export function dragArrowHit(pointer, point, isTouch, boost = 1) {
  return Math.hypot(pointer.x - point.x, pointer.y - point.y) <= ARROW_HIT_PX * (isTouch ? Math.max(1, boost) : 1);
}

// TASK 1030 (I-21): is the pointer (screen) within reach of an arrow drawn under `root` (the canvas)? The arrow's point is its drawn box's centre
// (the outline is centred on it). A finger pressed there grabs the arrow at once (input-manager does not hold it back as a possible pinch).
export function dragArrowUnder(root, pointer, isTouch, boost = 1) {
  for (const el of root.querySelectorAll('.sk-drag-arrow')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && dragArrowHit(pointer, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, isTouch, boost)) return true;
  }
  return false;
}

// the unit direction a value grows along a locus: pointAt(v) is the locus point at value v (null when there is none there)
export function dragArrowDirection(pointAt, v, dv) {
  const a = pointAt(v), b = pointAt(v + dv);
  if (a && b) { const m = Math.hypot(b.x - a.x, b.y - a.y); if (m > 1e-12) return { x: (b.x - a.x) / m, y: (b.y - a.y) / m }; }
  const c = pointAt(v - dv);
  if (a && c) { const m = Math.hypot(a.x - c.x, a.y - c.y); if (m > 1e-12) return { x: (a.x - c.x) / m, y: (a.y - c.y) / m }; }
  return { x: 0, y: -1 };
}
