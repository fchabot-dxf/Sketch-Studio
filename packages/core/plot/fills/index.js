// #core/plot/fills/index.js — the DECLARED FILL_PATTERNS registry + expandLayerWithFill. Ported + CONSOLIDATED
// (PP-2b-2): the old split PATTERNS (id->module) + PATTERN_OPTIONS (id->option keys) + scattered defaults collapse
// into ONE list where each entry carries its FULL param schema — the SINGLE source for the Fill-tab UI controls
// AND the pipeline defaults. Add a pattern = add one entry (INTEGRATION.md's registry rule). "none" is a UI concern,
// not an entry. This slice ships 2 archetypes: hatch (pure line-clip) + concentric (Clipper offsetRings via clip.js).
// The remaining 4 (crosshatch / zigzag / stipple / dots) are PP-2b-3.

import * as hatch from "./hatch.js";
import * as concentric from "./concentric.js";
import * as crosshatch from "./crosshatch.js"; // PP-2b-3
import * as zigzag from "./zigzag.js";         // PP-2b-3
import * as stipple from "./stipple.js";       // PP-2b-3
import * as dots from "./dots.js";             // PP-2b-3
import { closedPolygonFor, makePolylineShape } from "./utils.js";
import { insetPolygon } from "../clip.js";

// Each entry: { id, label, params:[{ key, label, type, default, unit, min? }], generate(shape, params) }.
// params drives BOTH the UI (controls + defaults) and the pipeline (defaults merged with the layer's fill values).
export const FILL_PATTERNS = [
  {
    id: "hatch",
    label: "Hatch",
    params: [
      { key: "angle",   label: "Angle",   type: "number", default: 45, unit: "deg", step: 1 },
      { key: "spacing", label: "Spacing", type: "number", default: 2,  unit: "mm", min: 0.1, step: 0.1 },
      { key: "offset",  label: "Offset",  type: "number", default: 0,  unit: "mm", step: 0.1 },
    ],
    generate: hatch.generate,
  },
  {
    id: "concentric",
    label: "Concentric",
    params: [
      { key: "spacing", label: "Spacing", type: "number", default: 2, unit: "mm", min: 0.1, step: 0.1 },
      { key: "offset",  label: "Offset",  type: "number", default: 0, unit: "mm", step: 0.1 },
    ],
    generate: concentric.generate,
  },
  // PP-2b-3 — the remaining 4 (param schemas match the old PATTERN_OPTIONS).
  {
    id: "crosshatch",
    label: "Crosshatch",
    params: [
      { key: "angle",   label: "Angle",   type: "number", default: 45, unit: "deg", step: 1 },
      { key: "spacing", label: "Spacing", type: "number", default: 2,  unit: "mm", min: 0.1, step: 0.1 },
      { key: "offset",  label: "Offset",  type: "number", default: 0,  unit: "mm", step: 0.1 },
    ],
    generate: crosshatch.generate,
  },
  {
    id: "zigzag",
    label: "Zigzag",
    params: [
      { key: "angle",   label: "Angle",   type: "number", default: 45, unit: "deg", step: 1 },
      { key: "spacing", label: "Spacing", type: "number", default: 2,  unit: "mm", min: 0.1, step: 0.1 },
      { key: "offset",  label: "Offset",  type: "number", default: 0,  unit: "mm", step: 0.1 },
    ],
    generate: zigzag.generate,
  },
  {
    id: "stipple",
    label: "Stipple",
    params: [
      { key: "spacing", label: "Spacing", type: "number", default: 2, unit: "mm", min: 0.1, step: 0.1 },
      { key: "offset",  label: "Offset",  type: "number", default: 0, unit: "mm", step: 0.1 },
    ],
    generate: stipple.generate,
  },
  {
    id: "dots",
    label: "Dots",
    params: [
      { key: "spacing", label: "Spacing", type: "number", default: 2, unit: "mm", min: 0.1, step: 0.1 },
      { key: "offset",  label: "Offset",  type: "number", default: 0, unit: "mm", step: 0.1 },
    ],
    generate: dots.generate,
  },
];

const BY_ID = new Map(FILL_PATTERNS.map((p) => [p.id, p]));
export function fillPattern(id) { return BY_ID.get(id) || null; }

// Merge the entry's declared param DEFAULTS with the layer's fill values (numeric-coerced; a param's min floors it).
function resolveParams(entry, fill) {
  const params = {};
  for (const p of entry.params) {
    let v = p.default;
    const raw = fill ? fill[p.key] : undefined;
    if (raw !== undefined && raw !== null && raw !== "") {
      const n = +raw;
      if (Number.isFinite(n)) v = n;
    }
    if (p.min !== undefined) v = Math.max(p.min, v);
    params[p.key] = v;
  }
  return params;
}

// The export-time shape list for `layer`: the user's drawn shapes + generated fill geometry.
export function expandLayerWithFill(layer) {
  const out = [...layer.shapes];
  const fill = layer.fill;
  if (!fill || fill.pattern === "none") return out;
  const entry = BY_ID.get(fill.pattern);
  if (!entry) return out;

  const params = resolveParams(entry, fill);
  const off = +params.offset || 0;

  for (const shape of layer.shapes) {
    // offset is universal: concentric folds it into its ring schedule; every other pattern insets/bleeds the fill
    // REGION first (via clip.insetPolygon — robust on concave art) then fills the offset polygon.
    if (off !== 0 && entry.id !== "concentric") {
      const poly = closedPolygonFor(shape);
      if (poly) {
        for (const ring of insetPolygon(poly, off)) {
          const region = makePolylineShape(ring);
          for (const extra of entry.generate(region, { ...params, offset: 0 })) out.push(extra);
        }
        continue;
      }
    }
    for (const extra of entry.generate(shape, params)) out.push(extra);
  }
  return out;
}
