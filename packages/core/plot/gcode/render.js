// Full G-code file for a single toolpath: header + per-polyline blocks + footer. Coordinates flip Y so SVG
// (Y-down) maps to machine (Y-up). The machine dialect is a DECLARED profile (default DDCS); pass opts.profile
// to target another controller (the PP-4 injection point).

import { header } from "./header.js";
import { pathBlock } from "./path.js";
import { footer } from "./footer.js";
import { DDCS } from "./profiles.js";

export function renderGcode(polylines, opts) {
    const profile = opts.profile || DDCS;
    const settings = { flipY: true, docH: opts.docH || 200, ...opts };
    const parts = [header(settings, profile)];
    if (opts.label) parts.push(`(--- ${opts.label} ---)\n`);
    for (const poly of polylines) parts.push(pathBlock(poly, settings, profile));
    parts.push(footer(settings, profile));
    return parts.join("");
}
