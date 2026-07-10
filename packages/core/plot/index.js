// Public surface for the vpype pipeline, relocated to #core/plot (PP-2a). Import from here, not individual files.
// PURE + app-agnostic (north star #6): imports stay within #core/plot; the one DOM touch (fromPath) is guarded.

export { shapeToPolyline } from "./polylines/index.js";
export { linemerge, linesort, linesimplify, optimize } from "./optimize/index.js";
export { renderGcode } from "./gcode/render.js";
export { DDCS } from "./gcode/profiles.js";   // PP-2a: the declared machine profile (injection-ready for PP-4)
export { buildZip } from "./zip/index.js";
export {
    flattenToolpath,
    optimizePolylines,
    toolpathToPolylines,
    toolpathToGcode,
} from "./pipeline.js";
