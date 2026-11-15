// packages/core/frame-geometry.js -- TASK 672: the FRAME engines of the owner's frame-calc app, PORTED once (unchanged math). PURE, no DOM.
//
// Ported from fchabot-dxf/triangular-frame-calc @ b59816f (READ-ONLY reference):
//   calculateFramingGeometry       <- triangle-frame-calculator/src/utils/framingCalculator.js (the right-angle frame with its diagonal brace)
//   calculatePolygonFrameGeometry  <- shared/utils/quadFrameCalculator.js calculateQuadFrameGeometry (its per-vertex engine; its body already
//                                     loops over P.length, so it IS the N-vertex engine: a regular N-gon, and task 674's trapezoid /
//                                     parallelogram / triangle frames, all go through THIS one function)
//   regularPolygonVertices         <- polygon-frame-calculator/src/utils/polygonCalculator.js (the outer vertices of its regular N-gon, P_0 on top)
//   distance                       <- shared/utils/geometry.js
// Coordinates are frame-calc's: Y DOWN (SVG), which is also Sketch-Studio's WORLD frame (units.js userToWorldY), so the points are world
// points as they are. The "Right-angle brace" and "Polygon frame" templates (#core/templates.js) and their start-modal glyphs
// (#ui/template-glyphs.js) call these functions: one frame geometry.

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
