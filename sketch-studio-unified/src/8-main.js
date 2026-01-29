import { DEFAULT_VIEW } from './1-utils.js';
import { draw } from './4-render.js';
import { setupInput, showDimInput } from './6-input.js';
import { setupUI } from './7-ui.js';
import { createEngine } from './5-engine.js';

const svg = document.getElementById('svgCanvas');
let view = { ...DEFAULT_VIEW };

function updateView(){ 
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
const engine = createEngine(svg);

// shared app state passed to input and ui modules
const state = {
  // expose engine proxies for modules to use
  engine,
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

  // Unified selection model
  selection: { type: null, payload: null }, // { type: 'constraint'|'shape'|'joint'|'joints'|null, payload }
  selectedJoints: new Set(),  // Track selected joints for showing constraint glyphs
  selectedConstraint: null,    // For backwards compatibility - kept in sync with selection
  selectedShape: null,         // For backwards compatibility - kept in sync with selection

  // Hover state
  hoveredShape: null,          // Track hovered shape for visual feedback
  hoveredJoint: null,          // Track hovered joint for visual feedback
  hoveredConstraint: null,     // Track hovered constraint for visual feedback

  history: [],  // Store last 5 states for undo
  maxHistory: 5,

  // Selection helpers
  selectItem: function(type, payload, opts = {}){
    // Clear existing selection safely
    this.clearSelection();
    this.selection = { type, payload };
    console.log('[selection] selectItem', type, payload);

    if(type === 'constraint'){
      this.selectedConstraint = payload || null;
      if(this.selectedConstraint) this.selectedConstraint.__selected = true;
      this.selectedShape = null;
      this.selectedJoints.clear();
    } else if(type === 'shape'){
      this.selectedShape = payload || null;
      this.selectedConstraint = null;
      this.selectedJoints.clear();
    } else if(type === 'joint'){
      this.selectedJoints.clear();
      if(payload) this.selectedJoints.add(payload);
      this.selectedConstraint = null;
      this.selectedShape = null;
    } else if(type === 'joints'){
      this.selectedJoints.clear();
      if(Array.isArray(payload)) payload.forEach(j => this.selectedJoints.add(j));
      this.selectedConstraint = null;
      this.selectedShape = null;
    } else {
      // Unknown / null selection
      this.selectedConstraint = null;
      this.selectedShape = null;
      this.selectedJoints.clear();
    }
  },

  clearSelection: function(){
    if(this.selectedConstraint && this.selectedConstraint.__selected) this.selectedConstraint.__selected = false;
    this.selection = { type: null, payload: null };
    this.selectedConstraint = null;
    this.selectedShape = null;
    this.selectedJoints.clear();
  },

  getSelected: function(){ return this.selection; },

  saveState: function() {
    // Deep copy current state BEFORE making changes
    const snapshot = {
      joints: new Map(Array.from(this.joints.entries()).map(([k,v]) => [k, {...v}])),
      shapes: this.shapes.map(s => ({...s, joints: s.joints ? [...s.joints] : []})),
      constraints: this.constraints.map(c => ({...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined}))
    };
    this.history.push(snapshot);
    if(this.history.length > this.maxHistory) this.history.shift();
    // Update undo button state
    const undoBtn = document.getElementById('btn-undo');
    if(undoBtn) undoBtn.disabled = false;
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
    this.constraints.push(...snapshot.constraints.map(c => ({...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined})));
    // Clear selections and active tool state
    this.clearSelection();
    this.active = null;
    // Update undo button state
    const undoBtn = document.getElementById('btn-undo');
    if(undoBtn && this.history.length === 0) undoBtn.disabled = true;
  }
};

// initialize
engine.init();
setupUI(state);
setupInput(svg, state);

// Setup dimension edit handler
window.__dimEditHandler = (cIdx) => {
  const constraint = state.constraints[cIdx];
  if(constraint && constraint.type === 'distance'){
    showDimInput(svg, state, constraint);
  }
};

function loop(){ engine.solve(8); draw(state.joints, state.shapes, svg, state.active, state.snapTarget, state.constraints, state.selectedJoints, state.selectedConstraint, state.currentTool, state.inference, state.selectedShape, state.hoveredShape, state.hoveredJoint, state.hoveredConstraint); requestAnimationFrame(loop); }
loop();

// Export function for tests/external use
if(typeof module !== 'undefined' && module.exports) {
  module.exports = { state, engine };
}
