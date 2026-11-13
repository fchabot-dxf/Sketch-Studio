// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS - Single source of truth for all application constants
// ═══════════════════════════════════════════════════════════════════════════════
import { DEFAULT_SKETCH_ID } from './sketch-model.js'; // the origin's sketch (sketch-model.js imports nothing)

export const CONSTRAINT_TYPES = {
  COINCIDENT: 'coincident',
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical',
  PARALLEL: 'parallel',
  PERPENDICULAR: 'perpendicular',
  COLLINEAR: 'collinear',
  TANGENT: 'tangent',
  POINT_ON_LINE: 'pointOnLine',
  DISTANCE: 'distance',
  EQUAL: 'equal',
  ANGLE: 'angle',
  MIDPOINT: 'midpoint',
  // task 563 (like Fusion's Symmetric): two points, two lines or two circles / arcs are mirror images across a line (a sketch line or an axis).
  // Stored { joints: [p, q], line } (points), { shapes: [l1, l2], line } (lines: the infinite lines mirror, lengths free, task 572) or
  // { shapes: [c1, c2], line } (circles / arcs: centres mirror, radii equal). #core/symmetric.js reads it.
  SYMMETRIC: 'symmetric'
};

// Snap tolerances (in screen pixels)
const SNAP_JOINT_PX = 30;

export const SNAP = {
  // ── Hit detection (screen px) ──────────────────────────────────────
  JOINT_PX: SNAP_JOINT_PX,              // Joint snap / selection radius
  INFERENCE_PX: SNAP_JOINT_PX / 2,      // Tighter radius for inference hints (derived)
  LINE_PX: 20,                          // Line proximity detection
  AXIS_PX: 20,                          // X / Y axis proximity detection (task 537; same reach as a line)

  // ── Drag behavior ──────────────────────────────────────────────────
  DRAG_MULT: 1.1,         // Multiplier on JOINT_PX while dragging
  DRAG_THRESHOLD: 2,      // Pixel movement to count as drag (not click)

  // ── Midpoint inference tuning (the drag's findInference) ────────────
  // SCREEN pixels, like every SNAP value: findInference converts them to world units with the caller's worldPerPx.
  MIDPOINT: {
    PCT: 0.02,     // 2% of the line's on-screen length
    MIN: 1.0,      // px
    MAX: 4.0,      // px
    BIAS: 2        // pixels; prefer midpoint when within this bias vs projected line point
  }
};

// The two AXIS snap targets (task 537). A point near the X axis (y = 0) or the Y axis (x = 0) snaps onto it and is held there by
// the existing two-point constraint with the origin joint: ONE declaration read by findSnap (#ui), applySnapConstraint (#core)
// and the drag-lock check (#ui). `across` = the coordinate the snap pins to 0; the other coordinate stays free.
export const ORIGIN_JOINT_ID = 'j_origin';
// The origin joint itself (task 554): every sketch has exactly one, fixed at (0, 0). Copied (never shared) by the engine's empty store
// and by deserializeDocument, which adds it to a loaded document that has none (an empty "New design", an older file). It belongs to the
// default Sketch 1 from the start (task 558 F6: an unstamped origin got its sketchId only from the first undo restore).
export const ORIGIN_JOINT = Object.freeze({ x: 0, y: 0, fixed: true, sketchId: DEFAULT_SKETCH_ID });

// Task 539: the SAME two axes are the built-in REFERENCE LINES (#core/reference-lines.js). `shapeId` / `endJointId` / `end` declare the
// reserved fixed line through j_origin that constraints and dimensions reference; the snap leaves a point-on-line with it (task 539;
// the horizontal / vertical-with-origin constraints task 537 made stay valid in saved files).
export const AXIS_SNAP_TARGETS = {
  'axis-x': { across: 'y', label: 'X axis', shapeId: 'ref_axis_x', endJointId: 'j_ref_x', end: { x: 1, y: 0 } },
  'axis-y': { across: 'x', label: 'Y axis', shapeId: 'ref_axis_y', endJointId: 'j_ref_y', end: { x: 0, y: 1 } }
};

// Default view configuration
export const DEFAULT_VIEW = { 
  x: 0, 
  y: 0, 
  w: 1200, 
  h: 800 
};

// Constraint visualization colors
// Single source of truth for all constraint rendering
export const CONSTRAINT_COLORS = {
  // UNIFIED BLUE THEME
  // Stroke: #2563eb (Geometry Blue)
  // Fill: #60A5FA (Lighter Blue)
  [CONSTRAINT_TYPES.COINCIDENT]:    { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.HORIZONTAL]:    { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.VERTICAL]:      { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.PARALLEL]:      { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.PERPENDICULAR]: { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.COLLINEAR]:     { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.TANGENT]:       { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.POINT_ON_LINE]: { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.DISTANCE]:      { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.EQUAL]:         { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.ANGLE]:         { fill: '#60A5FA', stroke: '#2563eb' },
  // Midpoint uses the standard unified blue to match other glyphs
  [CONSTRAINT_TYPES.MIDPOINT]:      { fill: '#60A5FA', stroke: '#2563eb' },
  [CONSTRAINT_TYPES.SYMMETRIC]:     { fill: '#60A5FA', stroke: '#2563eb' },
};

// Drawing tool modes
export const TOOL_MODES = {
  SELECT: 'select',
  PAN: 'pan',
  LINE: 'line',
  RECT: 'rect',
  CIRCLE: 'circle',
  POLYGON: 'polygon', // TASK 483: regular polygon (N plain lines + equal constraints); N = POLYGON_SIDES
  ARC: 'arc',
  BEZIER: 'bezier',
  TRIM: 'trim',   // TRACE-1: trim a line/polyline segment at intersections
  BREAK: 'break', // TRACE-1: split a line at a clicked point
  FILLET: 'fillet', // corner fillet / rounding
  COINCIDENT: 'coincident',
  EQUAL: 'equal',
  HORIZONTAL_VERTICAL: 'hv',
  PARALLEL: 'parallel',
  PERPENDICULAR: 'perp',
  COLLINEAR: 'collinear',
  TANGENT: 'tangent',
  DIMENSION: 'dim',
  MIDPOINT: 'midpoint',
  SYMMETRIC: 'symmetric', // task 563: entity, entity, then the symmetry line
  MIRROR: 'mirror' // task 585: like Fusion's Create > Mirror: the objects, then the mirror line, then Enter (#core/mirror.js)
};

// TASK 585: the Mirror tool's two steps (state.mirror.step): pick the OBJECTS (the selection), then the mirror LINE (a sketch line, a construction
// line or an X / Y axis: #core/reference-lines.js REFERENCE_PICK_STEP makes the axes pickable at this step only).
export const MIRROR_STEPS = Object.freeze({ OBJECTS: 'objects', LINE: 'line' });

// The constraint tools (the picks become a geometric constraint): ONE list for the tool router, the pre-selection on activation and the
// constraint cursor. (Dimension is not one of them: it has its own tool.)
export const CONSTRAINT_TOOLS = Object.freeze([
  TOOL_MODES.COINCIDENT, TOOL_MODES.HORIZONTAL_VERTICAL, TOOL_MODES.MIDPOINT, TOOL_MODES.PARALLEL, TOOL_MODES.PERPENDICULAR,
  TOOL_MODES.COLLINEAR, TOOL_MODES.TANGENT, TOOL_MODES.EQUAL, TOOL_MODES.SYMMETRIC
]);

// TASK 483: the regular polygon's side count: declared ONCE (the tool, the ribbon field and the builder all clamp with it).
export const POLYGON_SIDES = { min: 3, max: 64, default: 6 };

// Rectangle drawing modes
export const RECT_MODES = {
  TWO_POINT: 'rect-2pt',      // Two opposite corners
  CENTER: 'rect-center',      // Center point + corner
  THREE_POINT: 'rect-3pt'     // Three points (width + height)
};

// Arc drawing modes
export const ARC_MODES = {
  CENTER_START_END: 'arc-cse'    // Center + start angle + end angle
};

// Drag types for input handling
export const DRAG_TYPES = {
  PAN: 'pan',
  JOINT: 'joint',
  CLUSTER: 'cluster',
  LINE: 'line',
  DIMENSION: 'dim'
};

// TASK 545: the undo step label of every drag that changes geometry (the journal and the undo history show it). A LINE-type drag is
// the body drag of any shape, so it is named by the SHAPE kind (DRAG_SHAPE_UNDO_LABELS), falling back to DRAG_UNDO_LABELS.line.
export const DRAG_UNDO_LABELS = {
  [DRAG_TYPES.JOINT]: 'drag point',
  [DRAG_TYPES.CLUSTER]: 'drag points',
  [DRAG_TYPES.LINE]: 'drag shape'
};
export const DRAG_SHAPE_UNDO_LABELS = { line: 'drag line', circle: 'drag circle', arc: 'drag arc' };

// Inference types for line drawing
export const INFERENCE_TYPES = {
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical',
  PERPENDICULAR: 'perpendicular',
  PARALLEL: 'parallel', // Added parallel inference
  TANGENT: 'tangent', // Tangent inference for circle/arc
  MIDPOINT: 'midpoint' // Midpoint inference for line centers
};

// Angle snap tolerance (degrees) — shared by inference and constraint auto-detection
export const ANGLE_SNAP_DEG = 3;

// Time constants (in milliseconds)
export const TIME = {
  DOUBLE_CLICK: 300,      // Double-click threshold
  LONG_PRESS: 400         // Long press threshold for dropdowns
};

// Default values
export const DEFAULTS = {
  MAX_HISTORY: 5          // Maximum undo history entries
};