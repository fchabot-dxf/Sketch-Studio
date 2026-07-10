// Right panel: document size + plotter settings.
// Defaults come from state.js — no server round-trip needed anymore.

import { state } from "./state.js";
import { $ } from "./dom.js";
import { fitViewport, applyViewport } from "./viewport.js";
import { renderArt as render } from "./render-art.js"; // PP-6: Draw's trimmed renderer
import { recalcPreview } from "./preview.js";

const SETTINGS_MAP = {
    penUpZ:   "pen_up_z",
    penDownZ: "pen_down_z",
    drawFeed: "draw_feed",
    zFeed:    "z_feed",
    tol:      "tolerance_mm",
};

const MM_PER_IN = 25.4;
const DOC_UNIT_LS = "penplotter.docUnit";
const AUTO_RECALC_LS = "penplotter.autoRecalc";

/** Open/close helper shared by the modals: ✕ button, backdrop click, Esc. */
function wireModal(openerId, modalId, closeId, onOpen) {
    const opener = $("#" + openerId), modal = $("#" + modalId), closeBtn = $("#" + closeId);
    if (!modal) return;
    const close = () => { modal.style.display = "none"; };
    if (opener) {
        opener.style.cursor = "pointer";
        opener.style.pointerEvents = "auto"; // status-bar parent is pointer-events:none
        opener.addEventListener("click", () => { if (onOpen) onOpen(); modal.style.display = "flex"; });
    }
    if (closeBtn) closeBtn.addEventListener("click", close);
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.style.display !== "none") close();
    });
}

const inInches = () => state.docUnit === "in";
const toDisplay = (mm) => (inInches() ? mm / MM_PER_IN : mm);
const fromDisplay = (v) => (inInches() ? v * MM_PER_IN : v);
const roundDisplay = (v) => (inInches() ? Math.round(v * 1000) / 1000 : Math.round(v * 100) / 100);

/** Push state.doc (mm) into the Width/Height inputs in the current unit,
 *  and set the inputs' step/min/max + labels to match. Exported so import
 *  / project-load can refresh the fields without knowing about units. */
export function syncDocFields() {
    const w = $("#docW"), h = $("#docH");
    if (!w || !h) return;
    const inch = inInches();
    for (const el of [w, h]) {
        el.step = inch ? "0.05" : "1";
        el.min  = inch ? "0.5"  : "10";
        el.max  = inch ? "80"   : "2000";
    }
    w.value = roundDisplay(toDisplay(state.doc.w));
    h.value = roundDisplay(toDisplay(state.doc.h));
    document.querySelectorAll(".doc-unit-label").forEach(el => el.textContent = inch ? "in" : "mm");
    const sel = $("#docUnit");
    if (sel) sel.value = state.docUnit;
}

export function installSettingsPanel() {
    // Restore the saved display unit before wiring the fields.
    try { const u = localStorage.getItem(DOC_UNIT_LS); if (u === "in" || u === "mm") state.docUnit = u; } catch { /* ignore */ }

    const unitSel = $("#docUnit");
    if (unitSel) unitSel.addEventListener("change", (e) => {
        state.docUnit = e.target.value === "in" ? "in" : "mm";
        try { localStorage.setItem(DOC_UNIT_LS, state.docUnit); } catch { /* ignore */ }
        syncDocFields();
        applyViewport(); // refresh the dimension/zoom status text (keeps zoom)
    });

    // Document settings: opened by clicking the dimension readout in the
    // status bar. General user settings: opened by the gear in the canvas.
    const docInfo = $("#docInfo");
    if (docInfo) docInfo.title = "Document settings";
    wireModal("docInfo", "docModal", "docModalClose");
    wireModal("settingsBtn", "settingsModal", "settingsModalClose");

    // Auto-recalculate toggle (Settings modal). Off by default: edits leave
    // the toolpath stale until Recalculate. Persisted across sessions.
    try { state.autoRecalc = localStorage.getItem(AUTO_RECALC_LS) === "1"; } catch { /* ignore */ }
    const autoToggle = $("#autoRecalcToggle");
    if (autoToggle) {
        autoToggle.checked = state.autoRecalc;
        autoToggle.addEventListener("change", (e) => {
            state.autoRecalc = e.target.checked;
            try { localStorage.setItem(AUTO_RECALC_LS, state.autoRecalc ? "1" : "0"); } catch { /* ignore */ }
            if (state.autoRecalc) recalcPreview(); // catch up immediately when enabled
            render();
        });
    }

    $("#docW").addEventListener("change", (e) => {
        state.doc.w = Math.round(fromDisplay(+e.target.value) * 100) / 100; fitViewport(); render();
    });
    $("#docH").addEventListener("change", (e) => {
        state.doc.h = Math.round(fromDisplay(+e.target.value) * 100) / 100; fitViewport(); render();
    });
    syncDocFields();
    for (const [domId, key] of Object.entries(SETTINGS_MAP)) {
        $("#" + domId).addEventListener("change", (e) => {
            state.settings[key] = +e.target.value;
        });
    }
}

/** Sync the field inputs with whatever defaults state.settings carries
 *  (pure UI hydration; no async, no server). */
export async function loadDefaults() {
    const s = state.settings;
    $("#penUpZ").value   = s.pen_up_z;
    $("#penDownZ").value = s.pen_down_z;
    $("#drawFeed").value = s.draw_feed;
    $("#zFeed").value    = s.z_feed;
    $("#tol").value      = s.tolerance_mm;
}
