// Ported verbatim from geometric-frame-calc's trapezoid-frame-calculator/src/utils/trapezoidMapper.js.

/**
 * Maps symmetric (isosceles) trapezoid dimensions to the 4 ordered outer
 * vertices calculateQuadFrameGeometry expects. Bottom edge on y=0, top edge
 * at y=-height, both centered on x=0 (SVG y-down).
 *
 * Vertex order: 0=bottom-left, 1=top-left, 2=top-right, 3=bottom-right —
 * this winding has positive signed area (this repo's canonical convention
 * for calculateQuadFrameGeometry), so the engine never needs to reverse it.
 * geom.interiorAnglesDeg[0] and [3] are the base (bottom) angle; [1] and
 * [2] are the top angle — equal in pairs by the trapezoid's symmetry.
 */
export function mapTrapezoidVertices({ bottomWidth, topWidth, height }) {
  const bw2 = bottomWidth / 2;
  const tw2 = topWidth / 2;
  return [
    { x: -bw2, y: 0 },
    { x: -tw2, y: -height },
    { x: tw2, y: -height },
    { x: bw2, y: 0 },
  ];
}
