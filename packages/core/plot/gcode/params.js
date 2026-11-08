// #core/plot/gcode/params.js — the DECLARED machine fields the G-code emitter reads (TASK 453). One declaration for
// the valid range of each: the Pen Plotter's settings UI, a loaded document and renderGcode's own entry guard all
// run values through coerceParam with these. `key` is the emitter option name; apps map their own setting names to it.

export const MACHINE_FIELDS = {
  penUpZ:    { key: "penUpZ",    label: "Pen up Z",   type: "number", default: 5,    min: -100, max: 100,   unit: "mm" },
  penDownZ:  { key: "penDownZ",  label: "Pen down Z", type: "number", default: -1,   min: -100, max: 100,   unit: "mm" },
  drawFeed:  { key: "drawFeed",  label: "Draw feed",  type: "number", default: 2000, min: 1,    max: 50000, unit: "mm/min", integer: true },
  zFeed:     { key: "zFeed",     label: "Z feed",     type: "number", default: 1000, min: 1,    max: 50000, unit: "mm/min", integer: true },
};
// Path simplification tolerance (vpype linesimplify): 0 or negative would mean "no tolerance"; cap keeps shapes recognisable.
export const TOLERANCE_FIELD = { key: "simplifyTol", label: "Simplify tol", type: "number", default: 0.1, min: 0.001, max: 5, unit: "mm" };
