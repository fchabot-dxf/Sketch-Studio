// packages/core/frame-geometry.js -- TASK 672: the FRAME engines of the owner's frame-calc app, PORTED once (unchanged math). PURE, no DOM.
//
// Ported from fchabot-dxf/triangular-frame-calc @ b59816f (READ-ONLY reference):
//   calculateFramingGeometry       <- triangle-frame-calculator/src/utils/framingCalculator.js (the right-angle frame with its diagonal brace)
//   calculatePolygonFrameGeometry  <- shared/utils/quadFrameCalculator.js calculateQuadFrameGeometry (its per-vertex engine; its body already
//                                     loops over P.length, so it IS the N-vertex engine: a regular N-gon, and task 674's trapezoid /
//                                     parallelogram / triangle frames, all go through THIS one function)
//   regularPolygonVertices         <- polygon-frame-calculator/src/utils/polygonCalculator.js (the outer vertices of its regular N-gon, P_0 on top)
//   distance                       <- shared/utils/geometry.js
// TASK 674 (the VERTEX MAPPERS of frame-calc's other frames, each a pure function feeding THE per-vertex engine above, no second board math):
//   mapTrapezoidVertices, trapezoidSetbacks <- trapezoid-frame-calculator/src/utils/trapezoidMapper.js
//   computeEffectiveOffset                  <- trapezoid-frame-calculator/src/utils/trapezoidVariant.js (the variants: isosceles / right / scalene)
//   mapParallelogramVertices                <- parallelogram-frame-calculator/src/utils/parallelogramMapper.js
//   solveArbitraryTriangle                  <- triangle-frame-calculator/src/utils/obliqueCalculator.js (any triangle from 3 locked quantities)
//   obliqueTriangleVertices                 <- the same file's calculateObliqueFramingGeometry: its outer vertices P1, P2, P3. Its BOARDS are
//                                              not ported: with one thickness they are calculatePolygonFrameGeometry's on [P1, P3, P2] with the
//                                              joints mapped by obliqueVertexJoints (tests/templates-674.test.js: equal to frame-calc's
//                                              calculateObliqueFramingGeometry boards for every joint combination, from its fixture)
// (trapezoidQuantities.js, frame-calc's driver-set evaluator, is not ported: in a sketch the dimensions and the solver do that job.)
// Coordinates are frame-calc's: Y DOWN (SVG), which is also Sketch-Studio's WORLD frame (units.js userToWorldY), so the points are world
// points as they are. The frame templates (#core/templates.js) and their start-modal glyphs (#ui/template-glyphs.js) call these
// functions: one frame geometry.

/** frame-calc shared/utils/geometry.js distance: Euclidean distance between two 2D points. */
export function distance(p1, p2) {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * The right-angle brace's joints, per corner, in frame-calc's JointPicker order, named as frame-calc names them (the start modal's aria-label /
 * title of each glyph), with frame-calc's defaults (FramingCalculator.js: topJoint 'V-Through', blJoint 'V-Through', brJoint 'H-Through').
 */
export const BRACE_JOINTS = Object.freeze({
  top: Object.freeze([
    Object.freeze({ value: 'V-Through', label: 'Vertical Through Joint' }),
    Object.freeze({ value: 'D-Through', label: 'Diagonal Through Joint' }),
    Object.freeze({ value: 'Miter', label: 'Mitered Joint' }),
  ]),
  bl: Object.freeze([
    Object.freeze({ value: 'V-Through', label: 'Vertical Through Joint' }),
    Object.freeze({ value: 'H-Through', label: 'Horizontal Through Joint' }),
    Object.freeze({ value: 'Miter', label: 'Mitered Joint' }),
  ]),
  br: Object.freeze([
    Object.freeze({ value: 'H-Through', label: 'Horizontal Through Joint' }),
    Object.freeze({ value: 'D-Through', label: 'Diagonal Through Joint' }),
    Object.freeze({ value: 'Miter', label: 'Mitered Joint' }),
  ]),
});

/** The polygon frame's vertex joints, in frame-calc's JointPicker order (PolygonCanvasView.js), named as frame-calc names them. */
export const POLYGON_JOINT_TYPES = Object.freeze([
  Object.freeze({ value: 'CW-Through', label: 'Clockwise Through' }),
  Object.freeze({ value: 'CCW-Through', label: 'Counter-Clockwise Through' }),
  Object.freeze({ value: 'Miter', label: 'Mitered Joint' }),
]);

// ── ported from frame-calc triangle-frame-calculator/src/utils/framingCalculator.js @ b59816f (unchanged) ──
/**
 * Calculates framing core board geometries and cut list metrics.
 */
export function calculateFramingGeometry(inputs) {
  const {
    width,
    height,
    thickV,
    thickH,
    thickD,
    topJoint,
    blJoint,
    brJoint,
  } = inputs;

  // Clamp values to prevent mathematical impossibilities
  const W = Math.max(width, 1);
  const H = Math.max(height, 1);
  const Tv = Math.min(Math.max(thickV, 0.1), W / 2.1);
  const Th = Math.min(Math.max(thickH, 0.1), H / 2.1);
  const Td = Math.max(thickD, 0.1);

  const L = Math.sqrt(W * W + H * H);

  // Angles in radians & degrees
  const thetaTop = Math.atan(W / H);
  const thetaBot = Math.atan(H / W);
  const degTop = (thetaTop * 180) / Math.PI;
  const degBot = (thetaBot * 180) / Math.PI;

  const innerTopX = Tv;
  const innerTopY = Tv * (H / W) + Td * (L / W);
  const pInnerTop = { x: innerTopX, y: innerTopY };

  const pInnerBotLeft = { x: Tv, y: H - Th };

  const innerBotRightY = H - Th;
  const innerBotRightX = W - Th * (W / H) - Td * (L / H);
  const pInnerBotRight = { x: innerBotRightX, y: innerBotRightY };

  const V = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
  const H_board = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } };
  const D = { to: { x: 0, y: 0 }, bo: { x: 0, y: 0 }, bi: { x: 0, y: 0 }, ti: { x: 0, y: 0 } };

  // 1. Top Joint (Vertical / Diagonal)
  let sawVTop = 0;
  let sawDTop = 0;

  if (topJoint === 'V-Through') {
    V.tl = { x: 0, y: 0 };
    V.tr = { x: Tv, y: Tv * (H / W) };
    D.to = { ...V.tr };
    D.ti = { ...pInnerTop };
    sawVTop = 0.0;
    sawDTop = 90 - degTop;
  } else if (topJoint === 'D-Through') {
    D.to = { x: 0, y: 0 };
    D.ti = { x: 0, y: Td * (L / W) };
    V.tl = { ...D.ti };
    V.tr = { ...pInnerTop };
    sawVTop = 90 - degTop;
    sawDTop = 0.0;
  } else { // Miter
    V.tl = { x: 0, y: 0 };
    D.to = { x: 0, y: 0 };
    V.tr = { ...pInnerTop };
    D.ti = { ...pInnerTop };
    sawVTop = degTop / 2;
    sawDTop = degTop / 2;
  }

  // 2. Bottom-Left Joint (Vertical / Horizontal)
  let sawVBot = 0;
  let sawHLeft = 0;

  if (blJoint === 'V-Through') {
    V.bl = { x: 0, y: H };
    V.br = { x: Tv, y: H };
    H_board.bl = { ...V.br };
    H_board.tl = { ...pInnerBotLeft };
    sawVBot = 0.0;
    sawHLeft = 0.0;
  } else if (blJoint === 'H-Through') {
    H_board.bl = { x: 0, y: H };
    H_board.tl = { x: 0, y: H - Th };
    V.bl = { ...H_board.tl };
    V.br = { ...pInnerBotLeft };
    sawVBot = 0.0;
    sawHLeft = 0.0;
  } else { // Miter
    V.bl = { x: 0, y: H };
    H_board.bl = { x: 0, y: H };
    V.br = { ...pInnerBotLeft };
    H_board.tl = { ...pInnerBotLeft };
    sawVBot = 45.0;
    sawHLeft = 45.0;
  }

  // 3. Bottom-Right Joint (Horizontal / Diagonal)
  let sawHRight = 0;
  let sawDBot = 0;

  if (brJoint === 'H-Through') {
    H_board.br = { x: W, y: H };
    H_board.tr = { x: W - Th * (W / H), y: H - Th };
    D.bo = { ...H_board.tr };
    D.bi = { ...pInnerBotRight };
    sawHRight = 0.0;
    sawDBot = 90 - degBot;
  } else if (brJoint === 'D-Through') {
    D.bo = { x: W, y: H };
    D.bi = { x: W - Td * (L / H), y: H };
    H_board.br = { ...D.bi };
    H_board.tr = { ...pInnerBotRight };
    sawHRight = 90 - degBot;
    sawDBot = 0.0;
  } else { // Miter
    H_board.br = { x: W, y: H };
    D.bo = { x: W, y: H };
    H_board.tr = { ...pInnerBotRight };
    D.bi = { ...pInnerBotRight };
    sawHRight = degBot / 2;
    sawDBot = degBot / 2;
  }

  const points = { V, H: H_board, D };

  // Calculate cut list lengths
  const maxV = Math.max(distance(V.tl, V.bl), distance(V.tr, V.br));
  const minV = Math.min(distance(V.tl, V.bl), distance(V.tr, V.br));
  const maxH = Math.max(distance(H_board.tl, H_board.tr), distance(H_board.bl, H_board.br));
  const minH = Math.min(distance(H_board.tl, H_board.tr), distance(H_board.bl, H_board.br));
  const maxD = Math.max(distance(D.to, D.bo), distance(D.ti, D.bi));
  const minD = Math.min(distance(D.to, D.bo), distance(D.ti, D.bi));

  const cutList = [
    {
      part: 'Vertical (Left)',
      maxLen: maxV,
      minLen: minV,
      topSawGauge: sawVTop,
      botSawGauge: sawVBot,
    },
    {
      part: 'Horizontal (Bottom)',
      maxLen: maxH,
      minLen: minH,
      topSawGauge: sawHLeft,
      botSawGauge: sawHRight,
    },
    {
      part: 'Diagonal (Hypotenuse)',
      maxLen: maxD,
      minLen: minD,
      topSawGauge: sawDTop,
      botSawGauge: sawDBot,
    },
  ];

  return {
    W, H, Tv, Th, Td, L,
    thetaTop, thetaBot, degTop, degBot,
    points,
    cutList,
  };
}

// ── ported from frame-calc polygon-frame-calculator/src/utils/polygonCalculator.js @ b59816f: its outer vertex generator ──
/**
 * The outer vertices P_k (k = 0 .. N-1) of frame-calc's regular N-sided polygon frame, exactly as calculatePolygonFramingGeometry places them:
 * circumradius R = s / (2 sin(PI / N)), P_k at angle 2 PI k / N - PI / 2 (Y down, so the first vertex P_0 is at the top: (0, -R)), centred on
 * (0, 0). N is rounded and clamped to 3 .. 48 and s to at least 0.5, as frame-calc does.
 */
export function regularPolygonVertices(N, sideLength) {
  // Cap matches the N input's max (48) — the old cap of 12 silently drew a
  // 12-gon while the panel reported whatever larger N the user typed.
  const numSides = Math.max(3, Math.min(48, Math.round(N)));
  const s = Math.max(0.5, sideLength);
  // R: Circumradius (center to outer corner)
  const R = s / (2 * Math.sin(Math.PI / numSides));
  // Outer Vertices P_k (k = 0 .. N-1)
  // Orient so first vertex P_0 is at top: (0, -R)
  const P = [];
  for (let k = 0; k < numSides; k++) {
    const angle = (2 * Math.PI * k) / numSides - Math.PI / 2;
    P.push({
      x: R * Math.cos(angle),
      y: R * Math.sin(angle),
    });
  }
  return P;
}

// ── ported from frame-calc shared/utils/quadFrameCalculator.js calculateQuadFrameGeometry @ b59816f (unchanged; renamed: it takes any N) ──
/**
 * Per-vertex generalization of polygon-frame-calculator's regular-N-gon
 * engine (calculatePolygonFramingGeometry in polygonCalculator.js) to ANY
 * convex quadrilateral: same board/joint/shell geometry, but each vertex
 * carries its own interior angle instead of the constant used by a regular
 * polygon's central symmetry.
 *
 * Winding: normalized internally to the convention the reference engine's
 * regular-polygon vertex generator produces — positive signed area under
 * the standard shoelace formula. Callers may pass P in either order; if the
 * input is wound the other way, P and joints are reversed internally before
 * processing. Reversal swaps the array-index roles at every vertex (what
 * was the "current/start" board becomes the "previous/end" board), so
 * 'CW-Through'/'CCW-Through' are swapped on reversal to preserve each
 * joint's physical meaning — 'Miter' is unaffected.
 *
 * Saw gauge convention (miter-saw-scale readings, deviation from a square
 * cut) — matches polygonCalculator.js's stored cutList values and what
 * every app in this repo displays (framingCalculator.js stores the raw
 * θ/2 half-angle instead and displays the 90−x complement at render time —
 * same number on screen, different storage convention, so it is NOT the
 * same "stored" reference this engine's cutList matches):
 *   through board at that end:  0
 *   squared (butt) board:       |90 - interiorAngle_k|
 *   miter board:                |90 - interiorAngle_k / 2|
 *
 * (Sketch-Studio, TASK 672: the body loops over P.length, so it is the engine of ANY convex polygon frame with N vertices, not only 4: the
 * regular N-gon of the "Polygon frame" template goes through it, and equals calculatePolygonFramingGeometry's boards, tests/frame-geometry-672.)
 *
 * @param {Object} inputs
 * @param {Array<{x:number,y:number}>} inputs.P - 4 ordered outer vertices (SVG y-down)
 * @param {number} [inputs.thick=1.5] - uniform board thickness
 * @param {Array<string>} [inputs.joints] - per-vertex 'Miter'|'CW-Through'|'CCW-Through',
 *   joints[k] between incoming board k-1 and outgoing board k (same semantics as polygonCalculator.js)
 * @param {number} [inputs.shellOffset=0] - sheathing shell clearance
 */
export function calculatePolygonFrameGeometry({ P: inputP, thick = 1.5, joints: inputJoints = [], shellOffset = 0 }) {
  const n = inputP.length;
  const T = Math.max(0.1, thick);
  const d = Math.max(0.0, shellOffset);

  let P = inputP;
  let joints = inputJoints;
  if (signedArea(inputP) < 0) {
    P = inputP.slice().reverse();
    joints = inputJoints.slice().reverse().map(swapThroughLabel);
  }

  // Per-vertex interior angle and inward bisector direction. u1/u2 are unit
  // vectors from the vertex toward its neighbors; their sum bisects the
  // interior angle and points into the polygon regardless of winding (a
  // convex-polygon-only identity — see WORK-LOG for the derivation).
  const interiorAngleRad = [];
  const bisectorDir = [];
  for (let k = 0; k < n; k++) {
    const prevK = (k - 1 + n) % n;
    const nextK = (k + 1) % n;
    const u1 = unit(sub(P[prevK], P[k]));
    const u2 = unit(sub(P[nextK], P[k]));
    const dot = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
    interiorAngleRad.push(Math.acos(dot));
    bisectorDir.push(unit({ x: u1.x + u2.x, y: u1.y + u2.y }));
  }

  const Q = [];
  const S = [];
  for (let k = 0; k < n; k++) {
    const half = interiorAngleRad[k] / 2;
    const offsetQ = T / Math.sin(half);
    const offsetS = d / Math.sin(half);
    Q.push({ x: P[k].x + bisectorDir[k].x * offsetQ, y: P[k].y + bisectorDir[k].y * offsetQ });
    S.push({ x: P[k].x - bisectorDir[k].x * offsetS, y: P[k].y - bisectorDir[k].y * offsetS });
  }

  const shellPolyString = S.map(pt => `${pt.x},${pt.y}`).join(' ');

  const boards = [];
  const cutList = [];

  for (let k = 0; k < n; k++) {
    const nextK = (k + 1) % n;
    const prevK = (k - 1 + n) % n;
    const nextNextK = (k + 2) % n;

    const jStart = joints[k] || 'Miter';
    const jEnd = joints[nextK] || 'Miter';

    const pStart = P[k];
    const pEnd = P[nextK];
    const qStart = Q[k];
    const qEnd = Q[nextK];

    let bP1 = { ...pStart };
    let bP2 = { ...pEnd };
    let bP3 = { ...qEnd };
    let bP4 = { ...qStart };

    const boardLen = distance(pStart, pEnd);
    const dirX = (pEnd.x - pStart.x) / boardLen;
    const dirY = (pEnd.y - pStart.y) / boardLen;

    const pPrev = P[prevK];
    const prevLen = distance(pPrev, pStart);
    const dirPrevX = (pStart.x - pPrev.x) / prevLen;
    const dirPrevY = (pStart.y - pPrev.y) / prevLen;

    const pNextNext = P[nextNextK];
    const nextLen = distance(pEnd, pNextNext);
    const dirNextX = (pNextNext.x - pEnd.x) / nextLen;
    const dirNextY = (pNextNext.y - pEnd.y) / nextLen;

    // Butt-joint corner shift uses the vertex's OWN exterior angle.
    const extSinStart = Math.sin(Math.PI - interiorAngleRad[k]);
    const extSinEnd = Math.sin(Math.PI - interiorAngleRad[nextK]);

    if (jStart === 'CW-Through') { // previous board runs through, this board butts
      const shift = T / extSinStart;
      bP1 = { x: pStart.x + dirX * shift, y: pStart.y + dirY * shift };
      bP4 = { ...qStart };
    } else if (jStart === 'CCW-Through') { // this board runs through, previous board butts
      const shift = T / extSinStart;
      bP1 = { ...pStart };
      bP4 = { x: pStart.x - dirPrevX * shift, y: pStart.y - dirPrevY * shift };
    }

    if (jEnd === 'CCW-Through') { // next board runs through, this board butts
      const shift = T / extSinEnd;
      bP2 = { x: pEnd.x - dirX * shift, y: pEnd.y - dirY * shift };
      bP3 = { ...qEnd };
    } else if (jEnd === 'CW-Through') { // this board runs through, next board butts
      const shift = T / extSinEnd;
      bP2 = { ...pEnd };
      bP3 = { x: pEnd.x + dirNextX * shift, y: pEnd.y + dirNextY * shift };
    }

    boards.push({ p1: bP1, p2: bP2, p3: bP3, p4: bP4 });

    const maxLen = distance(bP1, bP2);
    const minLen = distance(bP4, bP3);

    const interiorDegStart = interiorAngleRad[k] * 180 / Math.PI;
    const interiorDegEnd = interiorAngleRad[nextK] * 180 / Math.PI;
    const buttGaugeStart = Math.abs(90 - interiorDegStart);
    const buttGaugeEnd = Math.abs(90 - interiorDegEnd);
    const miterGaugeStart = Math.abs(90 - interiorDegStart / 2);
    const miterGaugeEnd = Math.abs(90 - interiorDegEnd / 2);

    const startGauge = jStart === 'CCW-Through' ? 0 : jStart === 'CW-Through' ? buttGaugeStart : miterGaugeStart;
    const endGauge = jEnd === 'CW-Through' ? 0 : jEnd === 'CCW-Through' ? buttGaugeEnd : miterGaugeEnd;

    cutList.push({
      part: `Side ${k + 1}`,
      maxLen,
      minLen,
      topSawGauge: startGauge,
      botSawGauge: endGauge,
    });
  }

  const xs = P.map(p => p.x);
  const ys = P.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    P,
    Q,
    S,
    boards,
    cutList,
    interiorAnglesDeg: interiorAngleRad.map(r => r * 180 / Math.PI),
    shellPolyString,
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// ── TASK 674: ported from frame-calc trapezoid-frame-calculator/src/utils/trapezoidMapper.js @ b59816f (unchanged) ──
/**
 * Maps trapezoid dimensions to the 4 ordered outer vertices
 * calculateQuadFrameGeometry expects. Bottom edge on y=0 centered on x=0,
 * top edge at y=-height, its own center shifted by `offset` (task 27: the
 * ONE generalization — isosceles is just offset=0, not a separate shape).
 * The shared quad engine already handles arbitrary convex quads (verified
 * before adding this — `calculateQuadFrameGeometry` computes each vertex's
 * own interior angle from its neighbors, no symmetry assumed anywhere), so
 * this mapper is the entire change; no engine edit needed.
 *
 * Vertex order: 0=bottom-left, 1=top-left, 2=top-right, 3=bottom-right —
 * this winding has positive signed area (this repo's canonical convention
 * for calculateQuadFrameGeometry), so the engine never needs to reverse it.
 * geom.interiorAnglesDeg[0]/[1] are the LEFT leg's base/top angle (always
 * supplementary, since the top/bottom edges stay parallel regardless of
 * offset); [3]/[2] are the RIGHT leg's — equal to [0]/[1] only when
 * offset=0 (isosceles); otherwise genuinely independent.
 *
 * Per-side horizontal setback (task 27 Part B — how far the slope starts
 * in from its own base corner, the human's circled "2.00"):
 *   setbackLeft  = bottomWidth/2 - topWidth/2 + offset
 *   setbackRight = bottomWidth/2 - topWidth/2 - offset
 * (their SUM is always bottomWidth-topWidth, fixed by the two widths alone
 * — offset only redistributes it between the two sides.) A "right"
 * variant pins whichever side's setback to exactly 0, so the OTHER side
 * necessarily carries the full bottomWidth-topWidth difference — this is
 * what the worked example (8/10, height 6, setback 2.00 on one side, 0 on
 * the other) checks: setbackNonzero = bottomWidth-topWidth = 10-8 = 2 ✓,
 * slant = hypot(2,6) = 6.3246 ✓, corner = atan(6/2) = 71.57° ✓.
 */
export function mapTrapezoidVertices({ bottomWidth, topWidth, height, offset = 0 }) {
  const bw2 = bottomWidth / 2;
  const tw2 = topWidth / 2;
  return [
    { x: -bw2, y: 0 },
    { x: offset - tw2, y: -height },
    { x: offset + tw2, y: -height },
    { x: bw2, y: 0 },
  ];
}

/** Left/right horizontal setback (task 27 Part B) — see the mapper's own
 * doc comment above for the formula and its worked-example check. */
export function trapezoidSetbacks({ bottomWidth, topWidth, offset = 0 }) {
  const half = bottomWidth / 2 - topWidth / 2;
  return { left: half + offset, right: half - offset };
}

// ── TASK 674: ported from frame-calc trapezoid-frame-calculator/src/utils/trapezoidVariant.js @ b59816f (unchanged) ──
/**
 * Task 27 — isosceles/right/scalene are the SAME trapezoid model at
 * different top-edge offsets, not three separate shapes (see
 * trapezoidMapper.js's own doc comment for the offset/setback formulas).
 * Declared once here so the calculator (which owns the state) and the
 * panel (which needs to know the current effective offset to compute
 * setbacks for its own readouts) never diverge on how a variant maps to
 * an offset.
 *
 *   isosceles — offset pinned to 0.
 *   right     — offset pinned to ±(bottomWidth-topWidth)/2: 'left' makes
 *               the LEFT leg vertical (setbackLeft 0), 'right' makes the
 *               RIGHT leg vertical (setbackRight 0).
 *   scalene   — offset is a free, independently stored value (`freeOffset`),
 *               unpinned from bottomWidth/topWidth changes.
 */
export function computeEffectiveOffset({ trapVariant, rightSide, bottomWidth, topWidth, freeOffset }) {
  if (trapVariant === 'right') {
    const half = (bottomWidth - topWidth) / 2;
    return rightSide === 'left' ? -half : half;
  }
  if (trapVariant === 'scalene') return freeOffset;
  return 0; // isosceles
}

/**
 * TASK 674: the trapezoid's variants as ONE choice of the start modal: frame-calc's three shapes (TrapezoidControlsPanel.js "Shape": Isosceles,
 * Right, Scalene) with Right's "Square corner" (Left / Right) folded in, each carrying the trapVariant / rightSide computeEffectiveOffset reads.
 */
export const TRAPEZOID_VARIANTS = Object.freeze([
  Object.freeze({ value: 'isosceles', label: 'Isosceles', trapVariant: 'isosceles', rightSide: 'left' }),
  Object.freeze({ value: 'right-left', label: 'Right, left corner square', trapVariant: 'right', rightSide: 'left' }),
  Object.freeze({ value: 'right-right', label: 'Right, right corner square', trapVariant: 'right', rightSide: 'right' }),
  Object.freeze({ value: 'scalene', label: 'Scalene', trapVariant: 'scalene', rightSide: 'left' }),
]);

// ── TASK 674: ported from frame-calc parallelogram-frame-calculator/src/utils/parallelogramMapper.js @ b59816f (unchanged) ──
/**
 * Maps parallelogram dimensions to the 4 ordered outer vertices
 * calculateQuadFrameGeometry expects. Base along y=0 from (0,0) to
 * (base,0); the slant side leaves bottom-left at angleA above the base
 * (SVG y-down, so "above" is more negative y) — top-left =
 * (side*cos(A), -side*sin(A)); top-right = top-left + (base, 0), which is
 * what makes this a true parallelogram (opposite sides parallel and equal
 * — the top edge is a pure horizontal translate of the bottom edge).
 *
 * Vertex order: 0=bottom-left, 1=top-left, 2=top-right, 3=bottom-right —
 * same convention as trapezoidMapper.js, positive signed area, so the
 * engine never needs to reverse it. geom.interiorAnglesDeg[0] and [2] are
 * angleA (bottom-left / top-right); [1] and [3] are 180-angleA
 * (top-left / bottom-right).
 */
export function mapParallelogramVertices({ base, side, angleA }) {
  const rad = angleA * Math.PI / 180;
  const tlX = side * Math.cos(rad);
  const tlY = -side * Math.sin(rad);
  return [
    { x: 0, y: 0 },
    { x: tlX, y: tlY },
    { x: tlX + base, y: tlY },
    { x: base, y: 0 },
  ];
}

// ── TASK 674: ported from frame-calc triangle-frame-calculator/src/utils/obliqueCalculator.js @ b59816f (solveArbitraryTriangle unchanged) ──
/**
 * Solves an arbitrary (any angle) triangle given 3 locked quantities.
 * Quantities:
 *   a: Left side length (connecting P1 to P3)
 *   b: Base side length (connecting P1 to P2)
 *   c: Right side length (connecting P2 to P3)
 *   A: Corner angle at P1 (in degrees)
 *   B: Corner angle at P2 (in degrees)
 *   C: Corner angle at P3 (in degrees)
 *
 * Side/angle opposite pairing (NOT the textbook a<->A convention — a and b
 * are the two sides meeting AT P1, so they're adjacent to A, not opposite
 * it): side a is opposite B, side b is opposite C, side c is opposite A.
 * Every case below must use THIS pairing in its law-of-sines step, verified
 * against a plain 3-4-5 right triangle (a=3,b=4,c=5,A=90,B=36.87,C=53.13).
 */
export function solveArbitraryTriangle(lockedTriplet) {
  const get = k => lockedTriplet.find(e => e.key === k)?.val;

  let a = get('a');
  let b = get('b');
  let c = get('c');
  let A = get('A');
  let B = get('B');
  let C = get('C');

  const deg2rad = d => (d * Math.PI) / 180;
  const rad2deg = r => (r * 180) / Math.PI;

  // Case 1: SSS (a, b, c)
  if (a != null && b != null && c != null) {
    if (a + b <= c || a + c <= b || b + c <= a) return null;
    const cosA = Math.min(1, Math.max(-1, (a * a + b * b - c * c) / (2 * a * b)));
    const cosB = Math.min(1, Math.max(-1, (b * b + c * c - a * a) / (2 * b * c)));
    A = rad2deg(Math.acos(cosA));
    B = rad2deg(Math.acos(cosB));
    C = 180 - A - B;
  }
  // Case 2: SAS (a, b, A) — A is the included angle at P1, unambiguous.
  // Once c is known via law of cosines, get B via law of cosines too (not
  // law of sines): asin() can't tell an obtuse angle from its acute
  // supplement, and SAS can legitimately produce an obtuse B or C.
  else if (a != null && b != null && A != null) {
    const radA = deg2rad(A);
    c = Math.sqrt(Math.max(0.01, a * a + b * b - 2 * a * b * Math.cos(radA)));
    // B is opposite a
    const cosB = Math.min(1, Math.max(-1, (b * b + c * c - a * a) / (2 * b * c)));
    B = rad2deg(Math.acos(cosB));
    C = 180 - A - B;
  }
  // Case 3: SAS (b, c, B) — B is the included angle at P2, unambiguous.
  else if (b != null && c != null && B != null) {
    const radB = deg2rad(B);
    a = Math.sqrt(Math.max(0.01, b * b + c * c - 2 * b * c * Math.cos(radB)));
    // A is opposite c
    const cosA = Math.min(1, Math.max(-1, (a * a + b * b - c * c) / (2 * a * b)));
    A = rad2deg(Math.acos(cosA));
    C = 180 - A - B;
  }
  // Case 4: SAS (a, c, C) — C is the included angle at P3, unambiguous.
  else if (a != null && c != null && C != null) {
    const radC = deg2rad(C);
    b = Math.sqrt(Math.max(0.01, a * a + c * c - 2 * a * c * Math.cos(radC)));
    // A is opposite c
    const cosA = Math.min(1, Math.max(-1, (a * a + b * b - c * c) / (2 * a * b)));
    A = rad2deg(Math.acos(cosA));
    B = 180 - A - C;
  }
  // Case 5: ASA or AAS (a, A, B)
  else if (a != null && A != null && B != null) {
    C = 180 - A - B;
    if (C <= 0) return null;
    // a is opposite B, not A: pivot the law of sines off sin(B)
    const sinB = Math.sin(deg2rad(B));
    b = (a * Math.sin(deg2rad(C))) / sinB;
    c = (a * Math.sin(deg2rad(A))) / sinB;
  }
  // Case 6: ASA or AAS (b, A, B)
  else if (b != null && A != null && B != null) {
    C = 180 - A - B;
    if (C <= 0) return null;
    // b is opposite C, not B: pivot the law of sines off sin(C)
    const sinC = Math.sin(deg2rad(C));
    a = (b * Math.sin(deg2rad(B))) / sinC;
    c = (b * Math.sin(deg2rad(A))) / sinC;
  }
  // Case 7: ASA or AAS (c, A, B)
  else if (c != null && A != null && B != null) {
    C = 180 - A - B;
    if (C <= 0) return null;
    // c is opposite A: pivot the law of sines off sin(A)
    const sinA = Math.sin(deg2rad(A));
    a = (c * Math.sin(deg2rad(B))) / sinA;
    b = (c * Math.sin(deg2rad(C))) / sinA;
  }
  // Case 8: ASA or AAS (a, A, C)
  else if (a != null && A != null && C != null) {
    B = 180 - A - C;
    if (B <= 0) return null;
    // a is opposite B, not A: pivot the law of sines off sin(B)
    const sinB = Math.sin(deg2rad(B));
    b = (a * Math.sin(deg2rad(C))) / sinB;
    c = (a * Math.sin(deg2rad(A))) / sinB;
  }
  // Case 9: ASA or AAS (b, B, C)
  else if (b != null && B != null && C != null) {
    A = 180 - B - C;
    if (A <= 0) return null;
    // b is opposite C, not B: pivot the law of sines off sin(C)
    const sinC = Math.sin(deg2rad(C));
    a = (b * Math.sin(deg2rad(B))) / sinC;
    c = (b * Math.sin(deg2rad(A))) / sinC;
  }
  // Fallback default — a self-consistent solve of the app's actual default
  // locked triplet (a=24, b=12, A=63.4349), not an arbitrary placeholder:
  // the previous hardcoded B/C here (26.5651/90) didn't satisfy the law of
  // sines for these sides at all (a=24 can't be opposite a smaller angle
  // than b=12's opposite angle while also being the longer side).
  else {
    a = 24; b = 12;
    A = 63.4349;
    const radA = deg2rad(A);
    c = Math.sqrt(Math.max(0.01, a * a + b * b - 2 * a * b * Math.cos(radA)));
    const cosB = Math.min(1, Math.max(-1, (b * b + c * c - a * a) / (2 * b * c)));
    B = rad2deg(Math.acos(cosB));
    C = 180 - A - B;
  }

  return { a, b, c, A, B, C };
}

/**
 * TASK 674: the outer vertices of frame-calc's oblique triangle frame, exactly as calculateObliqueFramingGeometry (obliqueCalculator.js @ b59816f)
 * places them from solveArbitraryTriangle's result: "2D Outer vertices with base along X-axis / P1: Bottom-Left (0, 0) / P2: Bottom-Right (b, 0)
 * / P3: Top Apex (a * cos(A), -a * sin(A))" (Y down).
 */
export function obliqueTriangleVertices({ a, b, A }) {
  const radA = (A * Math.PI) / 180;
  return { P1: { x: 0, y: 0 }, P2: { x: b, y: 0 }, P3: { x: a * Math.cos(radA), y: -a * Math.sin(radA) } };
}

/**
 * TASK 674: frame-calc's oblique corner joints (calculateObliqueFramingGeometry's jointA at P1: 'V-Through' board A (left) runs through,
 * 'H-Through' board B (base) runs through; jointB at P2: 'D-Through' board C (right) through, 'H-Through' board B through; jointC at P3:
 * 'V-Through' board A through, 'D-Through' board C through; 'Miter' everywhere) as THE engine's per-vertex joints on P = [P1, P3, P2] (the
 * positive winding, so the engine never reverses it): joints[k] is between the incoming board k - 1 and the outgoing board k, 'CW-Through' =
 * the incoming one runs through, 'CCW-Through' = the outgoing one. Boards on that P: 0 = P1 -> P3 (A), 1 = P3 -> P2 (C), 2 = P2 -> P1 (B).
 */
const OBLIQUE_VERTEX = Object.freeze({
  A: Object.freeze({ 'V-Through': 'CCW-Through', 'H-Through': 'CW-Through', Miter: 'Miter' }), // at P1: in = B, out = A
  C: Object.freeze({ 'V-Through': 'CW-Through', 'D-Through': 'CCW-Through', Miter: 'Miter' }), // at P3: in = A, out = C
  B: Object.freeze({ 'D-Through': 'CW-Through', 'H-Through': 'CCW-Through', Miter: 'Miter' }), // at P2: in = C, out = B
});
export function obliqueVertexJoints({ jointA, jointB, jointC }) {
  return [OBLIQUE_VERTEX.A[jointA], OBLIQUE_VERTEX.C[jointC], OBLIQUE_VERTEX.B[jointB]];
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function unit(v) {
  const len = Math.hypot(v.x, v.y);
  return { x: v.x / len, y: v.y / len };
}

function signedArea(P) {
  let area = 0;
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += P[i].x * P[j].y - P[j].x * P[i].y;
  }
  return area / 2;
}

function swapThroughLabel(j) {
  if (j === 'CW-Through') return 'CCW-Through';
  if (j === 'CCW-Through') return 'CW-Through';
  return j;
}
