// apps/penplotter/src/fields.js — the Pen Plotter's DECLARED numeric fields (TASK 453): the document size, the machine
// settings, the pen / style widths. ONE declaration each (same shape as the #core/plot fill/outline params), ONE helper
// (#core/plot coerceParam). Every input commit, the G-code emitter and a loaded document read these; nothing re-checks a
// range by hand. The fill / outline / machine ranges that #core consumes are declared in #core/plot itself.

import { MACHINE_FIELDS, TOLERANCE_FIELD, coerceParam, sanitizeParams } from "#core/plot/index.js";
import { fillPattern } from "#core/plot/fills/index.js";
import { outlineStyle } from "#core/plot/outlines/index.js";

// Paper size, stored in mm. The Document dialog showed min 10 / max 2000 already; inches derive from these.
export const DOC_FIELD = { key: "doc", label: "Document size", type: "number", default: 200, min: 10, max: 2000, unit: "mm" };

// state.settings keys -> the declared machine fields.
export const SETTINGS_FIELDS = {
    pen_up_z:     MACHINE_FIELDS.penUpZ,
    pen_down_z:   MACHINE_FIELDS.penDownZ,
    draw_feed:    MACHINE_FIELDS.drawFeed,
    z_feed:       MACHINE_FIELDS.zFeed,
    tolerance_mm: TOLERANCE_FIELD,
};

// A pen tip (the plot uses it) and a shape's display stroke width.
export const PEN_WIDTH   = { key: "width", label: "Pen width",    type: "number", default: 0.5, min: 0.05, max: 5,  unit: "mm" };
export const STYLE_WIDTH = { key: "width", label: "Stroke width", type: "number", default: 0.5, min: 0.05, max: 10, unit: "mm" };

/** The kept value for a typed number: empty / text is REJECTED (the previous value is kept), out of range is clamped. */
export function keepNumber(def, typed, previous) {
    return coerceParam(def, typed === "" ? NaN : typed, previous);
}

/** Commit one machine setting. Pen up Z == pen down Z is refused (the pen would never lift), keeping the previous value.
 *  Returns { value, note } where `note` is a message when the typed value was refused. */
export function keepSetting(settings, key, typed) {
    const def = SETTINGS_FIELDS[key];
    const value = keepNumber(def, typed, settings[key]);
    const other = key === "pen_up_z" ? settings.pen_down_z : key === "pen_down_z" ? settings.pen_up_z : undefined;
    if (other !== undefined && value === other) {
        return { value: settings[key], note: "Pen up Z and pen down Z must differ — kept " + settings[key] + "." };
    }
    return { value, note: null };
}

/** A whole settings object made valid (a loaded document may hold anything). Equal pen Z -> the declared defaults. */
export function sanitizeSettings(settings) {
    const out = {};
    for (const [key, def] of Object.entries(SETTINGS_FIELDS)) out[key] = coerceParam(def, settings ? settings[key] : undefined);
    if (out.pen_up_z === out.pen_down_z) { out.pen_up_z = SETTINGS_FIELDS.pen_up_z.default; out.pen_down_z = SETTINGS_FIELDS.pen_down_z.default; }
    return out;
}

export function sanitizeDoc(doc) {
    return { w: coerceParam(DOC_FIELD, doc ? doc.w : undefined), h: coerceParam(DOC_FIELD, doc ? doc.h : undefined) };
}

/** Pens and toolpaths made valid in place of a loaded document: pen widths, each toolpath's fill / outline params. */
export function sanitizePens(pens) {
    return pens.map(p => ({ ...p, width: coerceParam(PEN_WIDTH, p.width) }));
}
export function sanitizeToolpaths(toolpaths) {
    return toolpaths.map(tp => {
        const fp = tp.fill && fillPattern(tp.fill.pattern);
        const os = tp.outline && outlineStyle(tp.outline.style || "normal");
        return {
            ...tp,
            ...(fp ? { fill: sanitizeParams(fp.params, tp.fill) } : {}),
            ...(os ? { outline: sanitizeParams(os.params, tp.outline) } : {}),
        };
    });
}
