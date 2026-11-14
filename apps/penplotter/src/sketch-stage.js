// apps/penplotter/src/sketch-stage.js — the merged 'Design' tab: the shared #core/#ui sketcher, embedded UNCHANGED.
// Its OWN <svg> canvas (NOT the plotter #canvasWrap), a RAF tied to the active stage (start on enter / stop on
// leave), and — host-side, #ui byte-identical — a FREEHAND tool (UNIFY-4b) + a pen-color UNDERLAY (UNIFY-4c).
//
// UNIFY-4c/STYLE-1: a per-shape DIGITAL STYLE (state.shapeStyles) editable via the Design-tab Style section, drawn beneath the
// sketcher in its DIGITAL stroke/fill (STYLE-3; the Toolpath/Export canvas keeps the pen mapping) by an underlay <svg> — rendered ON CHANGE
// (dirty-flagged), NOT per frame. The sketcher draws the DOF/scaffold on the transparent canvas ON TOP.
// PP-7b's "Bake to Draw" stays DORMANT (one-store; toolpaths target #core directly via UNIFY-2). Host wiring ONLY.

import { mountSketch } from '#ui/sketch-canvas.js';
import { fitToDrawing } from '#ui/input-handlers/pan-zoom.js'; // TASK 494: frame a restored sketch
import { mountDesignBrowser } from '#ui/design-browser.js'; // task 586: the floating SKETCHES browser over the canvas
import { sketchesSignature } from '#core/sketch-model.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
import { createMobileDrawer } from '#ui/mobile-drawer.js';
import { createDocumentBuffer } from '#ui/document-buffer.js'; // PERSIST-2: autosave + cross-app carry
import { DESIGN_CANVAS_OPTIONS, plotterBufferOptions } from './design-canvas.js'; // TASK 569: the Design canvas setup, declared once (the node test kit reads it too)
import { updateViewBox } from '#ui/input-manager.js';                   // UNIFY-6: apply the shared view to #design-canvas
import { needsFit, markFitted, fitRectForDoc, fitViewport } from './viewport.js';   // UNIFY-6: one shared doc-fit across the 4 tabs
import { coreShapeToPolyline } from '#core/core-shape-to-polyline.js'; // PP-7b/UNIFY-4c: #core shape -> polyline
import { closedPolygonFor } from '#core/plot/fills/utils.js';          // STYLE-3: the pipeline's OWN closed-shape test
import { state, shapeStyle, setShapeStyle, makeShapeStyle, docSizeLabel } from './state.js'; // UNIFY-4c/STYLE-1: the style record
import { installFreehandTool } from './freehand-tool.js';               // UNIFY-4b: plotter-side Freehand -> #core beziers
import { importFileToCore } from './core-import.js';                     // UNIFY-5 / TASK 478 / TASK 566: import SVG or DXF -> #core sketch + colors (via the shared importer)
import { mountImportDrop } from '#ui/sketch-import.js';               // TASK 566: the drop on the Design canvas
import { applyMix, clearMix, isMixed, mixSummary, mixColorFor } from './mix-toolpaths.js'; // COLOR-MIX-3: opt-in pen-mix -> fill toolpaths
import { installDocModal, syncDocFields, loadDefaults } from './settings.js';                        // DOC-SIZE-IN-DESIGN: doc-size dialog trigger in the first tab
import { STYLE_WIDTH, keepNumber } from './fields.js';                  // TASK 453: declared width range
import { capturePlotterDoc, applyPlotterDoc, resetPlotterDoc, captureImportState, applyImportState } from './plotter-doc.js';  // TASK 451: the plotter's own state, persisted via the host sidecar
import { renderArt } from './render-art.js';
import { recalcPreview } from './preview.js';
import { paperGridMarkup } from './paper-grid.js';                      // DESIGN-PAPER-BOUNDS: the doc paper+grid, shared with render-art
// STYLE-3: how solid a fill preview is on the Design canvas. Translucent on purpose — a pen plotter realises a fill
// as HATCHING, not flood colour, so the preview should read as "this region gets filled", not as printed ink.
const FILL_PREVIEW_OPACITY = 0.35;

const PANEL_COLLAPSED_KEY = 'penplotter-sketch-panel-collapsed';
let docBuffer = null; // TASK 474: the autosave buffer / project actions (created on mount); read it through getDocBuffer()
/** The Pen Plotter's document buffer (openDesign / newDesign / saveAs / saveFile / openFile / store), or null before the Design stage mounted. */
export const getDocBuffer = () => docBuffer;
let designImport = null; // TASK 566: the Design tab's SVG / DXF import (set on mount); the sidebar's "Import SVG / DXF…" calls it through importDrawing()
export const importDrawing = (text, name) => {
  if (!designImport) throw new Error('This app is still starting. Try again in a moment.');
  return designImport(text, name);
};
const FREEHAND_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 16 C 7 6, 10 6, 12 12 S 17 18, 21 8"/></svg>';

// The Design-tab DOM: the shared ribbon on top, a collapsible panel (Freehand lives in the ribbon; Bake + the
// per-shape color control live here), and the canvas WRAP holding the pen-color underlay BENEATH the sketcher svg.
const SCAFFOLD = `
  <div id="design-view">
    <div id="design-ribbon"></div>
    <div id="design-body">
      <div id="design-canvas-wrap">
        <svg id="design-paper" viewBox="-60 -45 120 90" preserveAspectRatio="xMidYMid meet"></svg>
        <svg id="pen-underlay" viewBox="-60 -45 120 90" preserveAspectRatio="xMidYMid meet"></svg>
        <svg id="design-canvas" viewBox="-60 -45 120 90" preserveAspectRatio="xMidYMid meet"></svg>
        <!-- IMPORT-2B-4: the drop target's overlay, RE-HOMED here from the hidden Draw panel (where it was rendered
             but its listeners were stranded in the never-called installSvgImport). Keeps the existing #dropOverlay
             CSS; #design-canvas-wrap is already position:relative and the overlay is pointer-events:none. -->
        <div id="dropOverlay">Drop an SVG or DXF to import</div>
      </div>
      <aside id="design-panel">
        <button id="design-panel-toggle" title="Collapse panel" aria-label="Toggle panel">&#9654;</button>
        <div id="design-panel-actions">
          <button id="designDocBtn" class="dp-btn" title="Set the document size — opens the Document dialog">Document</button>
          <div id="importStatus" class="dp-note"></div>
          <!-- STYLE-2: the Style section (legacy style-panel.js, ported to the #core style record). STROKE drives the
               OUTLINE pen, FILL drives the FILL pen. Width is DISPLAY-only. The preset-swatch popover + the "mixed"
               multi-select cue stay deferred (Batch 5 polish, per the roadmap). -->
          <div id="shape-style">
            <div class="dp-head">Style</div>
            <div class="dp-field">
              <label for="strokeColor">Stroke</label>
              <input id="strokeColor" type="color" value="#000000" disabled title="Outline colour — drives the OUTLINE pen">
            </div>
            <div class="dp-field">
              <label for="strokeWidth">Width <small>mm · display only</small></label>
              <input id="strokeWidth" type="number" min="0.05" max="10" step="0.05" value="0.5" disabled title="Display width only — the plot uses the physical pen's width">
            </div>
            <div class="dp-field">
              <label for="fillColor">Fill</label>
              <input id="fillColor" type="color" value="#c8c8c8" disabled title="Fill colour — drives the FILL pen">
            </div>
            <div class="dp-field dp-check">
              <label title="No fill: the shape gets no fill pen (+ Fill skips it)"><input id="fillNone" type="checkbox" disabled> Fill: None</label>
            </div>
            <div class="dp-field dp-check">
              <label title="Reproduce an out-of-palette colour as interleaved per-pen cross-hatch (COLOR-MIX-3). Applies to the FILL colour when one is set, else the stroke."><input id="shapeMix" type="checkbox" disabled> Pen-mix</label>
            </div>
            <div id="mixStatus" class="dp-note"></div>
          </div>
        </div>
      </aside>
    </div>
  </div>`;

export function mountSketchStage(view, ctx = {}) {
  view.innerHTML = SCAFFOLD;
  const underlay = view.querySelector('#pen-underlay');
  const paperSvg = view.querySelector('#design-paper'); // DESIGN-PAPER-BOUNDS: backmost paper+grid layer
  const designCanvas = view.querySelector('#design-canvas');
  const colorInput = view.querySelector('#strokeColor');   // STYLE-2: the Style section's four controls
  const widthInput = view.querySelector('#strokeWidth');
  const fillInput = view.querySelector('#fillColor');
  const fillNone = view.querySelector('#fillNone');
  const mixToggle = view.querySelector('#shapeMix');
  const docBtn = view.querySelector('#designDocBtn'); // DOC-SIZE-IN-DESIGN: opens #docModal; label shows the size
  const mixStatus = view.querySelector('#mixStatus');

  let controller = null, browser = null, infoPanel = null, ribbon = null, lastSig = '', lastUSig = '', lastMixSig = '', lastDocSig = '', underlayDirty = true;

  // UNIFY-throttle: a shape is STATIC (drawn by the color underlay; SKIPPED by the per-frame sketcher — perf, and its
  // joint glyphs are suppressed) ONLY when the plotter has MARKED it static (state.staticShapeIds — imported/dense
  // geometry) AND it is not currently selected. Freehand/drawn/selected geometry is LIVE: the sketcher draws it with
  // its JOINTS (editable). Selecting a static shape ACTIVATES it (live); deselecting returns it to static. #14: this
  // is why a fresh freehand bezier shows its endpoint joints (it's never marked static -> live).
  const isStatic = (sh) => state.staticShapeIds.has(sh.id) &&
    !(controller && controller.state.selectedShapes && controller.state.selectedShapes.has(sh.id)) &&
    !(controller && controller.state.hoveredShape === sh.id); // HOVER-2: a HOVERED static shape renders LIVE so its
    // hover highlight shows (imported/static geometry hovers like drawn); mirrors the selected-static-goes-live rule.

  // UNIFY-throttle: gate the per-frame solve to when geometry is being MANIPULATED (a drag, a selected/active edit).
  // Idle frames skip solve (each call is ~1.3s at 13k joints); the last-solved geometry stays put. Discrete changes
  // solve explicitly (after mount / freehand commit). Studio/Shaper (no shouldSolve) always solve -> byte-identical.
  const shouldSolve = () => {
    const s = controller && controller.state;
    return !!(s && (s.drag || s.active || (s.selectedShapes && s.selectedShapes.size > 0)));
  };

  // UNIFY-4c: keep the underlay's viewBox aligned with the sketcher's (pan/zoom mutates the canvas viewBox). CHEAP —
  // a per-frame attribute copy, NOT a re-render; the path rebuild is dirty-flagged (renderUnderlay).
  const syncUnderlayView = () => {
    if (!designCanvas) return;
    const vb = designCanvas.getAttribute('viewBox');
    if (!vb) return;
    if (underlay && underlay.getAttribute('viewBox') !== vb) underlay.setAttribute('viewBox', vb);
    if (paperSvg && paperSvg.getAttribute('viewBox') !== vb) paperSvg.setAttribute('viewBox', vb); // DESIGN-PAPER-BOUNDS: paper follows pan/zoom
  };
  // DESIGN-PAPER-BOUNDS: draw the document paper+grid (0,0)-(doc.w,doc.h) as the BACKMOST Design layer — same helper +
  // world/mm coords the plotter canvas (render-art) uses, so the Design area IS the paper. Redrawn on doc-size change.
  const renderPaper = () => { if (paperSvg) paperSvg.innerHTML = paperGridMarkup(state.doc, { grid: false }); };
  // IMPORT-DOC-SIZE / UNIFY-6: fit the SHARED view to the CURRENT doc on THIS canvas, then apply it. The plotter-side
  // fitViewport() measures #canvasWrap — hidden while Design is up — so the Design tab has to do its own fit. Used on
  // stage entry (first fit) AND after an import changes the paper size.
  const fitDesignView = () => {
    const r = designCanvas.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    Object.assign(controller.state.view, fitRectForDoc(r.width, r.height));
    markFitted();
    try { updateViewBox(designCanvas, controller.state.view); } catch (_) {}
    return true;
  };
  // TASK 451: after the saved plotter state is applied, repaint everything that was built from the defaults at mount.
  // The stage that is showing may be Design OR a pen tab (the active stage is restored too), so fit whichever canvas has
  // a size; the Toolpath settings inputs exist only once that stage has mounted (it hydrates them itself on mount).
  const refreshAfterPlotterRestore = ({ reason } = {}) => {
    underlayDirty = true;
    syncDocFields();
    if (document.getElementById('penUpZ')) loadDefaults();
    // TASK 494: a restored sketch is framed (the Design canvas shows the drawing; the paper stays visible when it is near);
    // a design with no geometry keeps the paper fit.
    // TASK 587: a tab switch keeps the tab's own view (the buffer put it back): nothing is refitted.
    if (reason !== 'switch') {
      if (fitToDrawing(designCanvas, controller.state)) markFitted(); // the pen tabs then keep this shared view
      else if (!fitDesignView()) fitViewport();
    }
    if (state.preview.showToolpath) recalcPreview();
    renderArt();
  };
  // STYLE-3: rebuild the underlay paths — each #core shape flattened (coreShapeToPolyline), then painted from its
  // STYLE record: the stroke colour at the style's DISPLAY width, and, for a CLOSED shape carrying a fill colour, a
  // translucent fill so fills are visible while designing (as the legacy did).
  //
  // DIGITAL, not pen-mapped. The old underlay drew every shape in its NEAREST PHYSICAL PEN colour; punch item #10
  // rules "Design = digital colour; Toolpath = physical-pen mapping", and render-art.js (the Toolpath/Export canvas)
  // still uses penColorForShape, so the split now matches that decision. In practice imports look the same — the
  // palette is seeded FROM the import, so their nearest pen IS their digital colour. What changes is a user EDIT to
  // an off-palette colour: Design now shows what they picked instead of snapping it to an owned pen.
  //
  // CLOSED is not our own test: closedPolygonFor is the SAME rule #core/plot/fills uses to decide what it can hatch
  // (>=3 pts and first==last within 0.001), so a fill VISIBLE here is a fill that will actually plot. Per-SHAPE, which
  // means an imported filled outline (decomposed into separate line shapes) shows no region fill — matching the
  // pipeline, which cannot hatch it either. Multi-shape loops need #core findLoops (already roadmapped, S7).
  const renderUnderlay = () => {
    if (!underlay || !controller) return;
    const s = controller.state, parts = [];
    for (const sh of s.shapes) {
      if (!isStatic(sh)) continue; // live (selected) shapes are drawn by the sketcher (DOF) — not the underlay
      const pts = coreShapeToPolyline(sh, s.joints);
      if (!pts || pts.length < 2) continue;
      const st = shapeStyle(sh.id) || makeShapeStyle();
      // A fill-only shape (stroke None, e.g. an imported <path fill="red">) still draws its outline — in the FILL
      // colour — so it never becomes invisible. Same stroke-then-fill precedence shapeColorFor declares.
      const strokePaint = st.stroke || st.fill;
      const ring = st.fill ? closedPolygonFor({ type: 'polyline', points: pts }) : null;
      const d = 'M ' + pts.map(p => p[0] + ' ' + p[1]).join(' L ');
      parts.push('<path data-shape-id="' + sh.id + '" d="' + d + '"' +
        (ring ? ' fill="' + st.fill + '" fill-opacity="' + FILL_PREVIEW_OPACITY + '" fill-rule="evenodd"' : ' fill="none"') +
        (strokePaint ? ' stroke="' + strokePaint + '" stroke-width="' + st.width + '"' : ' stroke="none"') +
        ' stroke-linecap="round" stroke-linejoin="round"/>');
    }
    underlay.innerHTML = parts.join('');
  };

  // Signature-gated ribbon/info refresh (Shaper's panelTick) + the UNIFY-4b selection mirror + UNIFY-4c underlay
  // sync/render + the color control's reflect.
  const panelTick = () => {
    if (!controller) return;
    const s = controller.state;
    // UNIFY-4b: mirror the #core selection -> the plotter's selectedShapeIds (Design-active only) for toolpath targeting.
    if (s.selectedShapes) state.selectedShapeIds = new Set(s.selectedShapes);
    // UNIFY-4c: reflect the selected shape's digital color into the picker (enable when a shape is selected).
    const selIds = s.selectedShapes ? [...s.selectedShapes] : [];
    // STYLE-2: reflect the FIRST selected shape's style into the Style section; every control is disabled with no
    // selection. A focused control is left alone so a live edit is never overwritten mid-frame. (Multi-select shows
    // the first shape's values — the legacy "mixed" cue is deferred to Batch 5 polish.)
    {
      const st0 = selIds.length ? (shapeStyle(selIds[0]) || makeShapeStyle()) : null;
      const enable = (el, on) => { if (el) el.disabled = !on; };
      enable(colorInput, !!st0); enable(widthInput, !!st0); enable(fillInput, !!st0); enable(fillNone, !!st0);
      if (st0) {
        if (colorInput && document.activeElement !== colorInput && st0.stroke) colorInput.value = st0.stroke;
        if (widthInput && document.activeElement !== widthInput) widthInput.value = st0.width;
        // an unset fill leaves the swatch showing the last colour but ticks None — so unticking restores something sane
        if (fillInput && document.activeElement !== fillInput && st0.fill) fillInput.value = st0.fill;
        if (fillNone && document.activeElement !== fillNone) fillNone.checked = !st0.fill;
      }
    }
    // COLOR-MIX-3: reflect the Pen-mix opt-in for a single selected, colored shape (needs a palette to mix over).
    if (mixToggle) {
      const one = selIds.length === 1 ? selIds[0] : null;
      const canMix = !!one && !!mixColorFor(one) && state.plotColors.length > 0;
      mixToggle.disabled = !canMix;
      const mixed = canMix && isMixed(one);
      if (document.activeElement !== mixToggle) mixToggle.checked = mixed;
      // TASK 465: a coloured shape + an EMPTY palette used to leave the box silently disabled; say what is missing.
      const noPens = !!one && !!mixColorFor(one) && state.plotColors.length === 0;
      const msig = (one || '') + '|' + mixed + '|' + state.toolpaths.length + '|' + noPens;
      if (msig !== lastMixSig) {
        lastMixSig = msig;
        mixStatus.textContent = mixed ? mixSummary(one) : (noPens ? 'Pen-mix needs pens: add one with + Pen on the Toolpath tab.' : '');
      }
    }
    // DOC-SIZE-IN-DESIGN: keep the Document button's label in sync with state.doc (updates after a modal size edit).
    if (docBtn) {
      // STYLE-5: the label honours state.docUnit via the shared docSizeLabel() (it hardcoded "mm"). docUnit is part of
      // the signature now — without it, switching mm<->in left the button showing the OLD unit until the size changed.
      const dsig = state.doc.w + 'x' + state.doc.h + '|' + state.docUnit;
      if (dsig !== lastDocSig) { lastDocSig = dsig; docBtn.textContent = `Document · ${docSizeLabel()}`; renderPaper(); }
    }
    let vsum = 0; for (const c of s.constraints) if (typeof c.value === 'number') vsum += c.value;
    const nShapes = (s.shapes && s.shapes.length) || 0;
    const nJoints = (s.joints && s.joints.size) || 0;
    const sig = s.constraints.length + ':' + nShapes + ':' + nJoints + ':' + vsum.toFixed(1) + ':' +
      (s.selectedConstraints ? s.selectedConstraints.size : 0) + ':' + s.currentTool + ':' + sketchesSignature(s);
    if (sig !== lastSig) { lastSig = sig; if (ribbon) ribbon.refresh(); if (infoPanel) infoPanel.refresh(); }
    // UNIFY-throttle: dirty the underlay on shape-count / SELECTION change (a shape entering/leaving the live set),
    // NOT on per-frame joint moves — so dragging a live shape does NOT rebuild the (static) underlay's many paths.
    const uSig = nShapes + '|' + state.staticShapeIds.size + '|' + (s.selectedShapes ? [...s.selectedShapes].sort().join(',') : '');
    if (uSig !== lastUSig) { lastUSig = uSig; underlayDirty = true; }
    syncUnderlayView();                                   // per frame (cheap) — alignment during pan/zoom
    if (underlayDirty) { renderUnderlay(); underlayDirty = false; } // rebuild paths only on change
  };

  // Mount the shared sketcher ONCE into the stage's OWN svg (isActive gates its document-level input listeners).
  controller = mountSketch(designCanvas, { isActive: ctx.isActive || (() => true), onRender: panelTick, isStatic, shouldSolve, ...DESIGN_CANVAS_OPTIONS }); // design-canvas.js (PERSIST-2: seedDemo false, the autosave buffer below decides what geometry to show)
  state.coreSketch = controller.state; // UNIFY-2: a toolpath can target this #core geometry directly
  // TASK 570: one Ctrl+Z of an import also puts back the paper size, pens and styles it set (the import's snapshot only: `asked`).
  controller.state.hostSnapshot = { asked: true, capture: captureImportState, restore: (d) => { applyImportState(d); underlayDirty = true; syncDocFields(); renderArt(); } };
  try { controller.engine.solve(500); } catch (_) {} // UNIFY-throttle: converge the seed once (per-frame solve is now gated)

  // PERSIST-2: restore the shared cross-app document (if any), then keep autosaving.
  // TASK 474: the SAME restore runs after the initial restore and after Open / New / Open from file (onRestored); a design with no
  // plotter sidecar resets the plotter state to defaults (it must not inherit the previous design's pens and toolpaths).
  docBuffer = createDocumentBuffer({ ...plotterBufferOptions({ // design-canvas.js: the restore, the plotter sidecar, the status
    controller, canvas: designCanvas,
    afterSession: () => renderArt(), // TASK 605: the Toolpath panels + canvas show the tab's own selection
    refreshPanels: () => { if (infoPanel) infoPanel.refresh(); },
    afterSidecar: refreshAfterPlotterRestore,
  }), ...ctx.bufferSeams }); // TASK 583: ctx.bufferSeams = the buffer's own store / doc / win seams (the page passes none: stages.js)
  docBuffer.restore();
  docBuffer.start();

  // Design UI: the shared info/DOF panel + the shared tool ribbon (+ a host FREEHAND button via extraGroups; #ui
  // unchanged). A #core tool click ('tool') de-highlights Freehand; the plotter-side capture tool does the drawing.
  browser = mountDesignBrowser({ container: view.querySelector('#design-canvas-wrap'), state: controller.state, engine: controller.engine });
  browser.toggleEl.style.display = 'none'; // shown only while Design is the active stage (onEnter/onLeave below)
  infoPanel = browser.panel;
  const freehandActive = (on) => { const b = view.querySelector('#freehand-btn'); if (b) b.classList.toggle('active', on); };
  ribbon = createToolRibbon({
    state: controller.state,
    extraGroups: [{ label: 'Draw', buttons: [{
      id: 'freehand-btn', label: 'Freehand', svg: FREEHAND_ICON, title: 'Freehand — draw a stroke, fitted to smooth beziers',
      onClick: () => { controller.state.currentTool = 'freehand'; ribbon.refresh(); freehandActive(true); },
    }] }],
    on: (name) => { if (name === 'tool') freehandActive(false); },
  });
  ribbon.render(view.querySelector('#design-ribbon'));
  installFreehandTool(designCanvas, controller, { onCommit: () => { underlayDirty = true; } });
  // DOC-SIZE-IN-DESIGN: wire the shared #docModal (its fields + close + the #designDocBtn / #docInfo openers) so the
  // Document dialog works from the first tab even before Toolpath is visited. Idempotent (settings.js guards it).
  try { installDocModal(); } catch (_) {}
  renderPaper(); // DESIGN-PAPER-BOUNDS: draw the paper immediately (panelTick also refreshes it on size change)

  // Collapsible side panel (persisted).
  const panel = view.querySelector('#design-panel');
  const toggle = view.querySelector('#design-panel-toggle');
  const setCollapsed = (c) => {
    panel.classList.toggle('collapsed', c);
    toggle.textContent = c ? '◀' : '▶';
    toggle.title = c ? 'Expand panel' : 'Collapse panel';
    try { localStorage.setItem(PANEL_COLLAPSED_KEY, c ? '1' : '0'); } catch (_) { /* storage blocked */ }
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(PANEL_COLLAPSED_KEY) === '1'; } catch (_) {}
  setCollapsed(collapsed);
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));

  // MOBILE-DRAWER: below 768px, #design-panel becomes a slide-over drawer instead of the desktop
  // collapse-to-strip above; hideOnMobile keeps the two toggle affordances from fighting each other.
  const drawer = createMobileDrawer({ panelEl: panel, label: 'Panel', hideOnMobile: [toggle], side: 'right' });
  const header = document.querySelector('header.toolbar');
  if (header) header.appendChild(drawer.toggleEl);
  drawer.toggleEl.style.display = 'none'; // shown only while Design is the active stage (onEnter/onLeave below)

  // STYLE-2: the Style controls. ONE applier for all four — patch every selected shape's style record, re-mix if the
  // shape was already mixed (so the pens follow the edit, as the single colour control did), redraw the underlay.
  const applyStyle = (patch) => {
    const ids = controller.state.selectedShapes ? [...controller.state.selectedShapes] : [];
    if (!ids.length) return;
    for (const id of ids) setShapeStyle(id, patch);
    // COLOR-MIX-3: if a shape is already mixed, recompute its mix for the new colour so the pens follow the edit.
    for (const id of ids) if (isMixed(id)) applyMix(id);
    lastMixSig = ''; // force the mix status to refresh next tick
    underlayDirty = true; renderUnderlay();
  };
  if (colorInput) colorInput.addEventListener('input', () => applyStyle({ stroke: colorInput.value }));
  if (widthInput) widthInput.addEventListener('change', () => {
    // TASK 453: clamp to the declared range; empty / text changes nothing. panelTick redraws the box with the kept width.
    if (widthInput.value !== '' && Number.isFinite(+widthInput.value)) applyStyle({ width: keepNumber(STYLE_WIDTH, widthInput.value, 0.5) });
  });
  // Picking a fill colour IMPLIES a fill — otherwise the swatch would visibly change while None kept it off.
  if (fillInput) fillInput.addEventListener('input', () => {
    if (fillNone) fillNone.checked = false;
    applyStyle({ fill: fillInput.value });
  });
  // None ON = fill null (no fill pen). None OFF = adopt whatever the fill swatch currently shows.
  if (fillNone) fillNone.addEventListener('change', () => {
    applyStyle({ fill: fillNone.checked ? null : (fillInput ? fillInput.value : '#c8c8c8') });
  });

  // COLOR-MIX-3: the Pen-mix opt-in — reproduce the selected shape's out-of-palette color as per-pen cross-hatch fill
  // toolpaths (Export then emits one gcode file per pen). Unchecking removes them; a single-pen color needs no mix.
  if (mixToggle) mixToggle.addEventListener('change', () => {
    const ids = controller.state.selectedShapes ? [...controller.state.selectedShapes] : [];
    if (ids.length !== 1) { mixToggle.checked = false; return; }
    const id = ids[0];
    if (mixToggle.checked) {
      const res = applyMix(id);
      if (!res.mixed) { mixToggle.checked = false; mixStatus.textContent = 'Nearest single pen — no mix needed.'; }
      else mixStatus.textContent = mixSummary(id);
    } else {
      clearMix(id);
      mixStatus.textContent = '';
    }
    lastMixSig = ''; // panelTick recomputes on next frame
  });

  // UNIFY-5 / TASK 566: Import SVG / DXF -> #core sketch (constrainable) through the shared importer (core-import.js). Paint -> shapeStyles ->
  // the underlay's mapped pen; the geometry is static. The entry is the sidebar's "Import SVG / DXF…" (importDrawing -> here); a drop on the
  // Design canvas is the second way in. The status line of the Design panel shows the result. Returns the result (dev/test seam).
  const importStatus = view.querySelector('#importStatus');
  const doImport = (text, name) => {
    const res = importFileToCore(text, name || 'Imported.svg', controller);
    if (res.ok) underlayDirty = true; // new static geometry -> redraw the underlay
    // TASK 570: the shared importer framed the imported shapes; the pen tabs keep that shared view. The paper rect itself and the
    // Document button label refresh on the next panelTick (its doc-size signature changed).
    if (res.fitted) markFitted();
    if (importStatus) importStatus.textContent = res.message;
    return res;
  };
  designImport = doImport;

  // IMPORT-2B-4: DRAG-AND-DROP a file onto the Design canvas -> the SAME doImport as the menu entry. #dropOverlay is the drop cue.
  const dropWrap = view.querySelector('#design-canvas-wrap');
  const dropOverlay = view.querySelector('#dropOverlay');
  if (dropWrap) mountImportDrop(dropWrap, doImport, { onHover: (on) => { if (dropOverlay) dropOverlay.classList.toggle('show', on); } });

  // UNIFY-7: "Bake to Draw" REMOVED (punch #3) — one store now; toolpaths target #core geometry directly (UNIFY-2),
  // so the bake bridge is meaningless.

  if (typeof window !== 'undefined') window.__sketch = { controller, panelTick, renderUnderlay, importSvg: doImport, mix: { applyMix, clearMix, isMixed, mixSummary } }; // dev/test seam

  // RAF lifecycle tied to the active stage. onEnter re-renders the underlay (catches palette edits made on other tabs).
  return {
    controller, // TASK 618: the stage's history (stages.js)
    onEnter: () => {
      controller.start(); underlayDirty = true;
      // UNIFY-6: the FIRST canvas shown at a real size fits the SHARED view (controller.state.view) to the plotter
      // doc. Then ALWAYS apply the shared view to #design-canvas on entry, so pan/zoom done on a pen tab reflects here
      // (persists across tabs). updateViewBox is the #ui's own applier (center-based; adjusts h to this canvas aspect).
      if (needsFit()) fitDesignView();
      try { updateViewBox(designCanvas, controller.state.view); } catch (_) {}
      drawer.toggleEl.style.display = ''; browser.toggleEl.style.display = '';
    },
    onLeave: () => { controller.stop(); drawer.toggleEl.style.display = 'none'; browser.close(); browser.toggleEl.style.display = 'none'; },
  };
}
