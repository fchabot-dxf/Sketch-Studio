// Full G-code file for a single toolpath: header + per-polyline blocks + footer. Coordinates flip Y so SVG
// (Y-down) maps to machine (Y-up). The machine dialect is a DECLARED profile (default DDCS); pass opts.profile
// to target another controller (the PP-4 injection point).

import { header } from "./header.js";
import { pathBlock } from "./path.js";
import { footer } from "./footer.js";
import { DDCS } from "./profiles.js";
import { MACHINE_FIELDS } from "./params.js";
import { coerceParam } from "../params.js";

/** A file's three parts: the machine preamble, the toolpath body (label + paths), the postamble. Joined = renderGcode.
 *  Several bodies can sit between ONE header and ONE footer (the per-pen export). */
export function renderGcodeSections(polylines, opts) {
    const profile = opts.profile || DDCS;
    // TASK 453: the machine fields are coerced at the emitter entry (feeds are never 0/NaN, Z are finite numbers), so a bad
    // value from an old saved document cannot reach the file. A pen that never lifts is not a program: refuse it.
    const kept = {};
    for (const f of Object.values(MACHINE_FIELDS)) kept[f.key] = coerceParam(f, opts[f.key]);
    if (kept.penUpZ === kept.penDownZ) throw new Error("Pen up Z and pen down Z must differ (the pen would never lift).");
    const settings = { flipY: true, docH: opts.docH || 200, ...opts, ...kept };
    const body = [];
    if (opts.label) body.push(`(--- ${opts.label} ---)\n`);
    for (const poly of polylines) body.push(pathBlock(poly, settings, profile));
    return { header: header(settings, profile), body: body.join(""), footer: footer(settings, profile) };
}

export function renderGcode(polylines, opts) {
    const s = renderGcodeSections(polylines, opts);
    return s.header + s.body + s.footer;
}
