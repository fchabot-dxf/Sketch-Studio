// #core/plot/outlines/index.js — the DECLARED OUTLINE_STYLES registry + expandLayerOutline (PP-2c). MIRRORS the
// blessed fills registry shape (PP-2b-2), but an outline TRANSFORMS a shape (method `apply`) where a fill GENERATES
// (`generate`) — the verb difference is intentional. Consolidates the old STYLES (id->module) + STYLE_OPTIONS +
// scattered defaults into ONE list where each entry carries its full param schema (single source for UI + pipeline).

import * as normal from "./normal.js";
import * as dashed from "./dashed.js";
import * as jagged from "./jagged.js";
import { DASH_LENGTH, DASH_GAP } from "./utils.js";
import { resolveParams as resolveDeclared } from "../params.js";

// UNIVERSAL param (like fills' offset): every style redraws its outline `passes` times. Only passes is clamped
// (min/max) — matching the original expandLayerOutline, which clamped passes and left the style params unbounded.
const PASSES = { key: "passes", label: "Passes", type: "number", default: 1, min: 1, max: 10, step: 1, integer: true };

export const OUTLINE_STYLES = [
  { id: "normal", label: "Normal", params: [PASSES], apply: normal.apply },
  {
    id: "dashed",
    label: "Dashed",
    params: [
      PASSES,
      DASH_LENGTH,
      DASH_GAP,
    ],
    apply: dashed.apply,
  },
  {
    id: "jagged",
    label: "Jagged",
    params: [
      PASSES,
      { key: "amplitude", label: "Amplitude", type: "number", default: 0.8, unit: "mm", min: 0, max: 20, step: 0.1 },
      { key: "frequency", label: "Frequency", type: "number", default: 0.7, unit: "per mm", min: 0.05, max: 20, step: 0.1 },
    ],
    apply: jagged.apply,
  },
];

const BY_ID = new Map(OUTLINE_STYLES.map((s) => [s.id, s]));
export function outlineStyle(id) { return BY_ID.get(id) || null; }

// The entry's declared params resolved against the layer's outline values (TASK 453: ../params.js; every declared param
// carries its range, passes is also an integer).
const resolveParams = (entry, outline) => resolveDeclared(entry.params, outline);

// Apply the layer's outline style + multi-pass to its shapes. Returns the replacement list (does NOT mutate).
export function expandLayerOutline(shapes, outline) {
  if (!outline) return shapes;
  const entry = BY_ID.get(outline.style || "normal");
  if (!entry) return shapes;
  const params = resolveParams(entry, outline);
  const passes = params.passes; // clamped [1,10] by the declared min/max
  const out = [];
  for (let pass = 0; pass < passes; pass++) {
    for (const shape of shapes) {
      for (const s of entry.apply(shape, params)) out.push(s);
    }
  }
  return out;
}
