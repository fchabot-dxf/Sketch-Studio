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

/** Wire a trigger to OPEN a modal. onOpen runs first (it snapshots the modal's state + syncs the fields), then the
 *  modal shows. Called once per opener — #docModal has two (#docInfo, #designDocBtn), so the on-open snapshot lives
 *  per-MODAL (a module-level _docSnap/_settingsSnap set by onOpen), NOT in this closure. */
function wireOpener(openerId, modalId, onOpen) {
    const opener = $("#" + openerId), modal = $("#" + modalId);
    if (!opener || !modal) return;
    opener.style.cursor = "pointer";
    opener.style.pointerEvents = "auto"; // status-bar parent is pointer-events:none
    opener.addEventListener("click", () => { if (onOpen) onOpen(); modal.style.display = "flex"; });
}

/** BURN-DOWN-5: wire a modal's controls ONCE (not per opener): Done = close keeping the live edits; Cancel / the ✕ /
 *  the backdrop / Esc = revert to the on-open snapshot, then close. `revert` restores that snapshot + refreshes. */
function wireModalControls(modalId, { closeId, doneId, cancelId, revert } = {}) {
    const modal = $("#" + modalId);
    if (!modal) return;
    const doClose = () => { modal.style.display = "none"; };
    const cancel = () => { if (revert) revert(); doClose(); };
    const bind = (id, fn) => { const b = id && $("#" + id); if (b) b.addEventListener("click", fn); };
    bind(closeId, cancel);   // the ✕ reverts (x = Cancel)
    bind(cancelId, cancel);
    bind(doneId, doClose);
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) cancel(); }); // backdrop click = Cancel
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.style.display !== "none") cancel();             // Esc = Cancel
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

/** IMPORT-DOC-SIZE: set the document size FROM CODE (mm) + refresh everything that reads it — the ONE named
 *  entry point for a programmatic doc-size change (import today; project-load / a paper-size preset later).
 *  Rounds to 2dp in mm, exactly like the #docW/#docH handlers. `fitViewport` no-ops while the plotter canvas is
 *  hidden (e.g. on the Design tab) — that canvas re-fits from the shared view on its own stage entry.
 *  A SET, not a lock: the Document dialog still overrides freely afterwards.
 *  (The #docW/#docH handlers deliberately do NOT route through here — the input IS their source of truth, so
 *  syncDocFields would rewrite the value the user just typed.) */
export function setDocSize(w, h) {
    if (!(w > 0) || !(h > 0)) return false;
    state.doc.w = Math.round(w * 100) / 100;
    state.doc.h = Math.round(h * 100) / 100;
    syncDocFields();   // the Document dialog's W/H fields
    fitViewport();     // shared view -> the new paper (+ the #docInfo readout, via applyViewport)
    render();
    return true;
}

// BURN-DOWN-5: on-open snapshots so Cancel/✕/backdrop/Esc revert the live edits (doc size + unit change apply
// immediately as the user types; the Settings toggle applies on change). Set by each modal's onOpen.
let _docSnap = null, _settingsSnap = null;
function revertDoc() {
    if (!_docSnap) return;
    state.doc.w = _docSnap.w; state.doc.h = _docSnap.h;
    if (state.docUnit !== _docSnap.unit) {
        state.docUnit = _docSnap.unit;
        try { localStorage.setItem(DOC_UNIT_LS, state.docUnit); } catch { /* ignore */ }
    }
    syncDocFields(); fitViewport(); render();
}
function revertSettings() {
    if (!_settingsSnap) return;
    state.autoRecalc = _settingsSnap.autoRecalc;
    try { localStorage.setItem(AUTO_RECALC_LS, state.autoRecalc ? "1" : "0"); } catch { /* ignore */ }
    const t = $("#autoRecalcToggle"); if (t) t.checked = state.autoRecalc;
    render();
}

let _docModalWired = false;
/** DOC-SIZE-IN-DESIGN: wire the Document-size modal (#docModal: #docW/#docH/#docUnit) + its openers (the #docInfo
 *  canvas readout AND #designDocBtn in the Design sidebar) + close. IDEMPOTENT — called from BOTH the Design mount (so
 *  the modal works before Toolpath is ever visited) AND installSettingsPanel; wires once, re-syncs on later calls.
 *  The modal HTML lives in index.html (always present), so this is the SINGLE editor; triggers just open it. */
export function installDocModal() {
    if (_docModalWired) { syncDocFields(); return; }
    _docModalWired = true;
    // Restore the saved display unit before wiring the fields.
    try { const u = localStorage.getItem(DOC_UNIT_LS); if (u === "in" || u === "mm") state.docUnit = u; } catch { /* ignore */ }

    const unitSel = $("#docUnit");
    if (unitSel) unitSel.addEventListener("change", (e) => {
        state.docUnit = e.target.value === "in" ? "in" : "mm";
        try { localStorage.setItem(DOC_UNIT_LS, state.docUnit); } catch { /* ignore */ }
        syncDocFields();
        applyViewport(); // refresh the dimension/zoom status text (keeps zoom)
    });

    // Openers: the #docInfo dimension readout (Toolpath/Export canvas) + the #designDocBtn control (Design sidebar).
    // Each opener snapshots the doc (size + unit) into _docSnap on open, so Cancel can revert the live edits.
    const docInfo = $("#docInfo");
    if (docInfo) docInfo.title = "Document settings";
    const openDoc = () => { _docSnap = { w: state.doc.w, h: state.doc.h, unit: state.docUnit }; syncDocFields(); };
    wireOpener("docInfo", "docModal", openDoc);
    wireOpener("designDocBtn", "docModal", openDoc);
    wireModalControls("docModal", { closeId: "docModalClose", doneId: "docDone", cancelId: "docCancel", revert: revertDoc });

    const dw = $("#docW"), dh = $("#docH");
    if (dw) dw.addEventListener("change", (e) => {
        state.doc.w = Math.round(fromDisplay(+e.target.value) * 100) / 100; fitViewport(); render();
    });
    if (dh) dh.addEventListener("change", (e) => {
        state.doc.h = Math.round(fromDisplay(+e.target.value) * 100) / 100; fitViewport(); render();
    });
    syncDocFields();
}

export function installSettingsPanel() {
    installDocModal(); // doc-size modal (shared with the Design-tab trigger)
    // Snapshot auto-recalc on open so Cancel can revert it; Done keeps it.
    wireOpener("settingsBtn", "settingsModal", () => { _settingsSnap = { autoRecalc: state.autoRecalc }; });
    wireModalControls("settingsModal", { closeId: "settingsModalClose", doneId: "settingsDone", cancelId: "settingsCancel", revert: revertSettings });

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
    for (const [domId, key] of Object.entries(SETTINGS_MAP)) {
        const el = $("#" + domId);
        if (el) el.addEventListener("change", (e) => { state.settings[key] = +e.target.value; });
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
