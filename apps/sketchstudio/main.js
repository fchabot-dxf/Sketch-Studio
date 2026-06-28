import { SolverConfig } from '#core/solver-config.js';
import { dbg } from '#core/debug.js';
import { DEFAULT_VIEW } from '#core/constants.js';
import { createSketchState } from '#ui/sketch-state.js';
import { draw } from '#ui/svg-renderer.js';
import { setupInput, showDimInput } from '#ui/input-manager.js';
import { setupUI } from './ui/ui-manager.js';
import { createEngine } from '#core/constraint-solver.js';
import { applyDefaultState } from '#core/state.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import './debug-overlay.js'; // side-effect: registers window.ug.debug + the spring overlay (split from core/debug.js)

let svg = document.getElementById('svgCanvas');
let worldGroup = svg ? document.getElementById('world-group') : null;
let view = { ...DEFAULT_VIEW };

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
  // Initialize state defaults (construction mode etc.)
  try{ applyDefaultState(state); }catch(_){ }
  // initialize
  engine.init();

  // Empty starting sketch — only j_origin (created by engine.init()) exists.
  // Set the view to show ~20 world units wide, centered near the origin.
  state.view.w = 20;
  state.view.x = 1.5;
  state.view.y = -1.5;

  const svgEl = document.getElementById('svgCanvas');
  if(svgEl) {
      const rect = svgEl.getBoundingClientRect();
      if (rect.height > 0) {
          state.view.h = state.view.w / (rect.width / rect.height);
          svgEl.setAttribute('viewBox', `${state.view.x - state.view.w/2} ${state.view.y - state.view.h/2} ${state.view.w} ${state.view.h}`);
      }
  }
  
  // 6. Initialize Tuning Wizard (dev-only)
  try {
    const urlSearch = (typeof location !== 'undefined' && location.search) ? location.search : '';
    const tuningQuery = urlSearch.includes('tuning=1') || urlSearch.includes('enable_tuning=1') || urlSearch.includes('enable_tuning=true');
    const shouldLoadTuning = (typeof window !== 'undefined') && (
      window.__ENABLE_TUNING_WIZARD__ ||
      tuningQuery ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1' ||
      location.port === '5500'
    );

    if (shouldLoadTuning) {
      (typeof require !== 'undefined' ? Promise.resolve(require('./ui/tuning-wizard.js')) : import('./ui/tuning-wizard.js'))
        .then(m => { if (m && typeof m.setupTuningWizard === 'function') m.setupTuningWizard(state); })
        .catch(() => {});
    }
  } catch (e) { /* no-op in production */ }

  // Initialize Debug Panel (always available)
  try {
    (typeof require !== 'undefined' ? Promise.resolve(require('./ui/debug-panel.js')) : import('./ui/debug-panel.js'))
      .then(m => { if (m && typeof m.setupDebugPanel === 'function') m.setupDebugPanel(state); })
      .catch(() => {});
  } catch (e) { /* ignore */ }

  // ════════════════════════════════════════════════════════════════════════

  setupUI(state);
  // Settings panel is SketchStudio-specific: inject the opener so the shared #ui/input-manager stays
  // app-agnostic. Preserves the original lazy import + default-export init (fire-and-forget, errors swallowed).
  setupInput(svg, state, {
    openSettings: (s, st) => import('./ui/settings-panel.js')
      .then(m => { if (m && typeof m.default === 'function') m.default(s, st); })
      .catch(() => {}),
  });

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
  // USE CONFIGURABLE ITERATIONS
  const iters = SolverConfig.ITERATIONS || 500;
  engine.solve(iters);
  // Expose latest solve stats for debug/UI consumers (AI Vision reads window.__lastSolveStats)
  try { if (typeof window !== 'undefined') window.__lastSolveStats = engine.getSolveStats(); } catch(_) {}

  draw(state.joints, state.shapes, svg, state.active, state.snapTarget, state.constraints, state.selectedJoints, state.selectedConstraints, state.currentTool, state.inference, state.selectedShapes, state.hoveredShape, state.hoveredJoint, state.hoveredConstraint, state.activeSnap, state.tempMousePos, state.drag ? true : false, worldGroup);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Export function for tests/external use
if(typeof module !== 'undefined' && module.exports) {
  module.exports = { state, engine };
}