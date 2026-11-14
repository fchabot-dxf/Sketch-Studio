import { dbg } from '#core/debug.js';
import { DEFAULT_VIEW } from '#core/constants.js';
import { createSketchState } from '#ui/sketch-state.js';
import { setupInput, showDimInput, sketchHistory } from '#ui/input-manager.js';
import { createHistoryRouter } from '#ui/history-control.js'; // TASK 618
import { mountAppFooter } from '#ui/app-footer.js'; // TASK 618: Undo / Redo, Construction, Recenter in the footer
import { fitToDrawing } from '#ui/input-handlers/pan-zoom.js'; // TASK 494: frame a restored drawing
import { CANVAS_ID, createStudioImporter, initStudioCanvas, mountStudioBrowser, studioBufferOptions, studioFrame } from './design-canvas.js'; // TASK 569: the Design canvas setup, declared once (the node test kit reads it too)
import { setupUI } from './ui/ui-manager.js';
import { createEngine } from '#core/constraint-solver.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import { mountAppChrome } from '#ui/app-chrome.js';
import { SIDEBAR_ICONS } from '#ui/app-sidebar.js';
import { getGoogleAccount } from '#ui/cloud/google-account.js'; // TASK 488: probe the server session once at start (signing in syncs nothing)
getGoogleAccount().init();
import { applyAppIdentity } from '#ui/app-registry.js'; // TASK 473: tab title + favicon from the registry
applyAppIdentity('sketchstudio');
import { exportToFile } from './ui/export-manager.js';
import { createStylePanel } from '#ui/style-panel.js';
import { bindTemplateTokens } from '#ui/style-templates.js';
import { createDocumentBuffer } from '#ui/document-buffer.js'; // PERSIST-2: autosave + cross-app carry
import { createDiagnosticLog } from '#ui/diagnostic-log.js'; // DIAG-OVERLAY: mobile-usable log + Copy Report
import './debug-overlay.js'; // side-effect: registers window.ug.debug + the spring overlay (split from core/debug.js)
import { loadFusionGlyphs } from '#ui/fusion-glyphs.js';
loadFusionGlyphs(); // the owner's constraint-glyph sheet, fetched once; the render loop picks it up when it arrives

let svg = document.getElementById('svgCanvas');
let worldGroup = svg ? document.getElementById('world-group') : null;
let view = { ...DEFAULT_VIEW };
let docBuffer = null; // TASK 474: the autosave buffer / project actions of this app; a sidebar reads it lazily
let sidePanel = null; // task 586: the floating Design browser (SKETCHES tree + constraint lists); the render loop ticks it
let toolRibbon = null; // S7c-2d: the shared tool ribbon (from setupUI); the render loop refreshes its active highlight

function updateView(){ 
  if(!svg) return;
  // Match viewBox aspect ratio to SVG element
  const rect = svg.getBoundingClientRect();
  const aspectRatio = rect.width / rect.height;
  view.h = view.w / aspectRatio;
  svg.setAttribute('viewBox', `${view.x-view.w/2} ${view.y-view.h/2} ${view.w} ${view.h}`); 
}

// Update on resize
window.addEventListener('resize', updateView);
setTimeout(updateView, 0); // Initial update after layout

// create engine instance bound to this svg
const engine = createEngine({
  // Forward solver metrics to the tuning wizard (lazy-loaded, dev-only). The wizard
  // registers window.__updateSolverMetrics when it mounts; the core no longer touches
  // window — the shell injects this callback and keeps the window glue here.
  onMetrics: (stats) => {
    if (typeof window !== 'undefined' && window.__updateSolverMetrics) {
      window.__updateSolverMetrics(stats);
    }
  }
});

// Wire the brain's notification seam to the shell's toast UI. The core stays
// headless (it only knows the injected notifier, not the UI module); without
// this call conflict notifications would silently no-op.
setConstraintNotifier(showNotification);

// shared app state passed to input and ui modules
const state = createSketchState(engine, view);
// TASK 473: the sidebar's Download uses the same exporter as the Export view, with its default options.
// TASK 566: Import SVG / DXF -> a new sketch, through the shared importer (the file menu's entry; a drop on the canvas is the second way in).
// SketchStudio declares no options: its sketch state is what the importer works on, and the result is shown as a notification.
function sidebarExport(type) {
  const res = exportToFile(state, 'sketch', type, { precision: 6, arcApprox: false, arcSeg: 32, scale: 1, invertY: false, dxfVersion: 'r12' });
  try { showNotification(res && res.ok ? 'Export started' : 'Export failed: ' + (res && res.reason ? res.reason : 'unknown'), res && res.ok ? 'success' : 'error'); } catch (_) {}
}

// initialize
function initApp(){
  svg = svg || document.getElementById('svgCanvas');
  if(!svg){
    dbg.warn('main', '[main] svgCanvas not found yet; aborting init');
    return;
  }
  // Ensure we have a reference to the drawing layer group (world-group)
  worldGroup = document.getElementById('world-group');
  
  // Make SVG focusable to capture keyboard events reliably
  if (!svg.hasAttribute('tabindex')) {
      svg.setAttribute('tabindex', '0');
      svg.style.outline = 'none';
  }
  dbg.log('main', '[main] initApp starting, svg found:', !!svg);
  const importer = createStudioImporter({ state, svg }); // TASK 610: design-canvas.js (the node test kit calls it too): the file menu's entry + the drop
  // design-canvas.js: the state defaults, the empty store (only j_origin), the initial view and its viewBox
  initStudioCanvas(state, engine, document.getElementById(CANVAS_ID));
  
  // 6. Initialize Tuning Wizard (dev-only)
  let shouldLoadTuning = false;
  let toggleTune = null;
  try {
    const urlSearch = (typeof location !== 'undefined' && location.search) ? location.search : '';
    const tuningQuery = urlSearch.includes('tuning=1') || urlSearch.includes('enable_tuning=1') || urlSearch.includes('enable_tuning=true');
    shouldLoadTuning = (typeof window !== 'undefined') && !!(
      window.__ENABLE_TUNING_WIZARD__ ||
      tuningQuery ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1' ||
      location.port === '5500'
    );

    if (shouldLoadTuning) {
      (typeof require !== 'undefined' ? Promise.resolve(require('./ui/tuning-wizard.js')) : import('./ui/tuning-wizard.js'))
        .then(m => {
          if (m && typeof m.setupTuningWizard === 'function') m.setupTuningWizard(state);
          if (m && typeof m.toggleTuningPanel === 'function') toggleTune = m.toggleTuningPanel;
        })
        .catch(() => {});
    }
  } catch (e) { /* no-op in production */ }

  // Initialize Debug Panel (always available)
  let toggleDebug = null;
  try {
    (typeof require !== 'undefined' ? Promise.resolve(require('./ui/debug-panel.js')) : import('./ui/debug-panel.js'))
      .then(m => {
        if (m && typeof m.setupDebugPanel === 'function') m.setupDebugPanel(state);
        if (m && typeof m.toggleDebugPanel === 'function') toggleDebug = m.toggleDebugPanel;
      })
      .catch(() => {});
  } catch (e) { /* ignore */ }

  // ════════════════════════════════════════════════════════════════════════

  const ui = setupUI(state);
  toolRibbon = (ui && ui.ribbon) || null; // S7c-2d: the shared tool ribbon; the render loop syncs its highlight

  // ── S7c-2c: the shared app header (Design|Export tabs + Style/Debug actions) + the shared style panel + a
  // Design↔Export view router. The tool ribbon + canvas + footer stay AS-IS in the Design view (the shared-ribbon
  // swap is S7c-2d; the faithful Export popup→tab cleanup is S7c-2e).
  const stylePanel = createStylePanel({
    hostId: 'sketchstudio',
    onNotify: showNotification,
  });
  stylePanel.render(document.body);
  bindTemplateTokens(document.getElementById('svgCanvas'));

  const ribbonEl = document.getElementById('toolsRibbon');
  const mainEl = document.querySelector('main');
  const footerEl = document.querySelector('footer');
  const exportPanelEl = document.getElementById('export-panel');
  function showView(mode) {
    const design = mode !== 'export';
    if (ribbonEl) ribbonEl.style.display = design ? '' : 'none';
    if (mainEl) mainEl.style.display = design ? '' : 'none';
    if (sidePanel) { sidePanel.drawer.close(); sidePanel.drawer.toggleEl.style.display = design ? '' : 'none'; }
    if (footerEl) footerEl.style.display = design ? '' : 'none';
    if (exportPanelEl) exportPanelEl.classList.toggle('hidden', design); // Export view = the existing export form
    if (design) setTimeout(updateView, 0); // recompute the canvas viewBox aspect once it reflows back in
  }

  const diagLog = createDiagnosticLog({ appId: 'sketchstudio', state });

  // THE mode router (TASK 602/619): Design is the one stage tab; Export, Style, Log, Debug and Tune solver live in the ☰ menu.
  const route = (mode) => { chrome.setActiveStage(mode); showView(mode); };
  const chrome = mountAppChrome({
    appId: 'sketchstudio',
    container: document.getElementById('app-header-host'),
    stages: [{ id: 'design', label: 'Design' }],
    activeStage: 'design',
    onStageChange: showView,
    getBuffer: () => docBuffer,
    importFile: importer.importFile,
    hostActions: [
      { id: 'export', label: 'Export…', icon: SIDEBAR_ICONS.download, onClick: () => route('export') },
      { id: 'download-svg', label: 'Download SVG', icon: SIDEBAR_ICONS.download, onClick: () => sidebarExport('svg') },
      { id: 'download-dxf', label: 'Download DXF', icon: SIDEBAR_ICONS.download, onClick: () => sidebarExport('dxf') },
      { divider: true },
      { id: 'style', label: 'Style', icon: SIDEBAR_ICONS.style, onClick: () => stylePanel.toggle() },
      { id: 'log', label: 'Log', icon: SIDEBAR_ICONS.log, onClick: () => diagLog.toggle() },
      { id: 'debug', label: 'Debug', icon: SIDEBAR_ICONS.debug, onClick: () => toggleDebug && toggleDebug() },
      { id: 'tune', label: 'Tune solver', icon: SIDEBAR_ICONS.gear, visible: () => shouldLoadTuning, onClick: () => toggleTune && toggleTune() },
    ],
  });
  mountAppFooter({ router: createHistoryRouter({ current: () => sketchHistory(state) }), view: () => ({ svg, state }), construction: true, footer: document.querySelector('footer.sk-statusbar') }); // TASK 618/619: Undo / Redo (left), Construction + Recenter (right)
  // the SKETCHES browser floats over the canvas's top-left; at phone width it is a slide-over drawer
  sidePanel = mountStudioBrowser({ svg, state, engine }); // design-canvas.js
  showView('design');

  // TASK 602 (owner): no "Saved" text in the header: the document tab's dot shows unsaved / saving / failed (document-tabs.js)
  docBuffer = createDocumentBuffer(studioBufferOptions({ state, engine, svg })); // design-canvas.js
  docBuffer.restore();
  docBuffer.start();

  // S7c-2e: the Export view's Cancel/Export return to the Design tab via the router (single source of truth).
  ['btn-export-cancel', 'btn-export-do'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => route('design'));
  });

  setupInput(svg, state);
  importer.mountDrop(); // TASK 566: a drop on the canvas imports too

  // Auto-focus SVG when window regains focus to ensure shortcuts work immediately
  window.addEventListener('focus', () => {
      // Only steal focus if it's currently on the body (lost)
      if (document.activeElement === document.body && svg) {
          svg.focus();
      }
  });
}

if(!svg){
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Setup dimension edit handler
window.__dimEditHandler = (cIdx) => {
  const constraint = state.constraints[cIdx];
  if(constraint && constraint.type === 'distance'){
    showDimInput(svg, state, constraint);
  }
};

// Render loop: solve → draw
function loop(){
  if (sidePanel) sidePanel.tick();
  studioFrame({ engine, state, svg, worldGroup, ribbon: toolRibbon, onSolved: () => {
    // Expose latest solve stats for debug/UI consumers (AI Vision reads window.__lastSolveStats)
    try { if (typeof window !== 'undefined') window.__lastSolveStats = engine.getSolveStats(); } catch(_) {}
  } }); // design-canvas.js: solve, draw, ribbon highlight
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Export function for tests/external use
if(typeof module !== 'undefined' && module.exports) {
  module.exports = { state, engine };
}