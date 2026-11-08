// Full G-code file for a single toolpath: header + per-polyline blocks + footer. Coordinates flip Y so SVG
// (Y-down) maps to machine (Y-up). The machine dialect is a DECLARED profile (default DDCS); pass opts.profile
// to target another controller (the PP-4 injection point).

import { header } from "./header.js";
import { pathBlock } from "./path.js";
import { footer } from "./footer.js";
import { DDCS } from "./profiles.js";
import { MACHINE_FIELDS } from "./params.js";
import { coerceParam } from "../params.js";

export function renderGcode(polylines, opts) {
    const profile = opts.profile || DDCS;
    // TASK 453: the machine fields are coerced at the emitter entry (feeds are never 0/NaN, Z are finite numbers), so a bad
    // value from an old saved document cannot reach the file. A pen that never lifts is not a program: refuse it.
    const kept = {};
    for (const f of Object.values(MACHINE_FIELDS)) kept[f.key] = coerceParam(f, opts[f.key]);
    if (kept.penUpZ === kept.penDownZ) throw new Error("Pen up Z and pen down Z must differ (the pen would never lift).");
    const settings = { flipY: true, docH: opts.docH || 200, ...opts, ...kept };
    const parts = [header(settings, profile)];
    if (opts.label) parts.push(`(--- ${opts.label} ---)\n`);
    for (const poly of polylines) parts.push(pathBlock(poly, settings, profile));
    parts.push(footer(settings, profile));
    return parts.join("");
}
