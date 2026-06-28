import { SolverConfig } from '#core/solver-config.js';
import { dbg } from '#core/debug.js';
import { DEFAULT_VIEW } from '#core/constants.js';
import { addConstraintObject } from '#core/constraints.js';
import { removeOrphanJoints } from '#core/joints.js';
import { draw } from './svg-renderer.js';
import { setupInput, showDimInput } from './ui/input-manager.js';
import { setupUI } from './ui/ui-manager.js';
import { createEngine } from '#core/constraint-solver.js';
import { applyDefaultState } from '#core/state.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from './ui/notification-manager.js';
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
const state = {
  // expose engine proxies for modules to use
  engine,
  model: { solveConstraints: (iter=20) => engine.solve(iter) },
  joints: engine.getJoints(),
  shapes: engine.getShapes(),
  constraints: engine.getConstraints(),
  genJ: () => engine.genJ(),
  initStore: () => engine.init(),
  mergeJoints: (a,b) => engine.mergeJoints(a,b),
  currentTool: 'select',
  active: null,
  drag: null,
  snapTarget: null,
  inference: null,  // Track inference hints (horizontal, vertical, perpendicular)
  lastMouse: null,
  pendingConstraint: null,  // { type: 'parallel', firstElement: { type: 'line|joint', id }, ... }
  view,
  selectedJoints: new Set(),  // Track selected joints for showing constraint glyphs
  selectedConstraints: new Set(), // Track selected constraints (support multi-select)
  selectedShapes: new Set(),      // Track selected shapes (support multi-select)
  hoveredShape: null,          // Track hovered shape for visual feedback
  hoveredJoint: null,          // Track hovered joint for visual feedback
  hoveredConstraint: null,     // Track hovered constraint for visual feedback
  // Construction mode: when true new shapes are created as construction geometry (dashed/faded)
  isConstructionMode: false,
  history: [],  // Store last 5 states for undo
  maxHistory: 5,
  _undoGroupActive: false,
  _undoGroupDepth: 0,
  // Force push a snapshot regardless of grouping (used to capture pre-group state)
  saveStateForce: function(){
    const snapshot = {
      joints: new Map(Array.from(this.joints.entries()).map(([k,v]) => [k, {...v}])),
      shapes: this.shapes.map(s => ({...s, joints: s.joints ? [...s.joints] : []})),
      constraints: this.constraints.map(c => ({...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined}))
    };
    this.history.push(snapshot);
    if(this.history.length > this.maxHistory) this.history.shift();
    const undoBtn = document.getElementById('btn-undo');
    if(undoBtn) undoBtn.disabled = false;
  },
  // Normal save - during an active undo group we still create segment snapshots (they will be compressed on commit)
  saveState: function() {
    if(this._undoGroupActive){
      // Create a segment snapshot and remember its index for the active group
      this.saveStateForce();
      try{ if(this._undoGroupInfo) this._undoGroupInfo.segmentIndices.push(this.history.length - 1); }catch(_){ }
      return;
    }
    this.saveStateForce();
  },
  beginUndoGroup: function(){
    if(this._undoGroupActive) {
      this._undoGroupDepth = (this._undoGroupDepth || 1) + 1;
      return;
    }
    this._undoGroupActive = true;
    this._undoGroupDepth = 1;
    // capture snapshot before group begins so undo will remove entire group
    this.saveStateForce();
    // record start index and segment list
    this._undoGroupInfo = { startIndex: this.history.length - 1, segmentIndices: [] };
  },
  endUndoGroup: function(){
    if(!this._undoGroupActive) return;
    this._undoGroupDepth = (this._undoGroupDepth || 1) - 1;
    if (this._undoGroupDepth > 0) return;
    // Commit: compress group by removing intermediate segment snapshots, keeping only the pre-group snapshot
    try{
      if(this._undoGroupInfo){
        const si = this._undoGroupInfo.startIndex;
        // Remove everything after the start snapshot index (keep start snapshot as the single entry representing the whole group)
        this.history.splice(si + 1);
      }
    }catch(_){ }
    this._undoGroupInfo = null;
    this._undoGroupActive = false;
  },
  // Cancel the active undo group and revert to the snapshot taken before the group started.
  cancelUndoGroup: function(){
    if(!this._undoGroupActive || !this._undoGroupInfo) return false;
    const si = this._undoGroupInfo.startIndex;
    // Trim history back to before the group started
    const priorIndex = si - 1;
    if(priorIndex >= 0){
      // Restore to snapshot at priorIndex
      const snapshot = this.history[priorIndex];
      // Trim history to remove group snapshots (including the group's start snapshot)
      this.history.splice(priorIndex + 1);
      // Restore state from snapshot
      this.joints.clear();
      for(const [k,v] of snapshot.joints) this.joints.set(k, {...v});
      this.shapes.length = 0;
      this.shapes.push(...snapshot.shapes.map(s => ({...s, joints: s.joints ? [...s.joints] : []})));
      this.constraints.length = 0;
      for(const c of snapshot.constraints){
        const proto = {...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined};
        addConstraintObject(this, proto);
      }
    } else {
      // No prior snapshot - clear store
      this.history.splice(0);
      try{ this.initStore(); }catch(_){ }
    }
    // Cleanup and exit group mode
    try{ removeOrphanJoints(this); }catch(_){ }
    this._undoGroupInfo = null;
    this._undoGroupActive = false;
    return true;
  },
  undo: function() {
    if(this.history.length === 0) return;
    // Get the previous state (not the current one)
    const snapshot = this.history.pop();
    // Restore state
    this.joints.clear();
    for(const [k,v] of snapshot.joints) this.joints.set(k, {...v});
    this.shapes.length = 0;
    this.shapes.push(...snapshot.shapes.map(s => ({...s, joints: s.joints ? [...s.joints] : []})));
    this.constraints.length = 0;
    for(const c of snapshot.constraints){
      // Normalize arrays to avoid shared references and run validation via helper
      const proto = {...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined};
      const added = addConstraintObject(this, proto);
      if(!added){
        dbg.log('undo', '[undo] skipped restoring constraint', proto);
      }
    }
    // Cleanup after undo is disabled; trust the snapshot as saved.
    // Clear selections and active tool state
    this.selectedJoints.clear();
    this.selectedConstraints.clear();
    this.selectedShapes.clear();
    this.active = null;
    // Update undo button state
    const undoBtn = document.getElementById('btn-undo');
    if(undoBtn && this.history.length === 0) undoBtn.disabled = true;
  }
};

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
  setupInput(svg, state);

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