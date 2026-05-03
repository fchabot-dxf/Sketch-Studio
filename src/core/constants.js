// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS - Single source of truth for all application constants
// ═══════════════════════════════════════════════════════════════════════════════

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
  MIDPOINT: 'midpoint'
};

// Snap tolerances (in screen pixels)
const SNAP_JOINT_PX = 30;

export const SNAP = {
  // ── Hit detection (screen px) ──────────────────────────────────────
  JOINT_PX: SNAP_JOINT_PX,              // Joint snap / selection radius
  INFERENCE_PX: SNAP_JOINT_PX / 2,      // Tighter radius for inference hints (derived)
  LINE_PX: 20,                          // Line proximity detection

  // ── Drag behavior ──────────────────────────────────────────────────
  DRAG_MULT: 1.1,         // Multiplier on JOINT_PX while dragging
  DRAG_THRESHOLD: 2,      // Pixel movement to count as drag (not click)

  // ── Midpoint snap tuning ───────────────────────────────────────────
  MIDPOINT: {
    PCT: 0.02,     // 2% of anchor distance
    MIN: 1.0,
    MAX: 4.0,
    BIAS: 2        // pixels; prefer midpoint when within this bias vs projected line point
  }
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
};

// Drawing tool modes
export const TOOL_MODES = {
  SELECT: 'select',
  PAN: 'pan',
  LINE: 'line',
  RECT: 'rect',
  CIRCLE: 'circle',
  ARC: 'arc',
  COINCIDENT: 'coincident',
  EQUAL: 'equal',
  HORIZONTAL_VERTICAL: 'hv',
  PARALLEL: 'parallel',
  PERPENDICULAR: 'perp',
  COLLINEAR: 'collinear',
  TANGENT: 'tangent',
  DIMENSION: 'dim',
  MIDPOINT: 'midpoint'
};

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