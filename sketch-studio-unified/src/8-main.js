import { DEFAULT_VIEW } from './1-utils.js';
import { draw } from './4-render.js';
import { setupInput, showDimInput } from './6-input.js';
import { setupUI } from './7-ui.js';
import { createEngine } from './5-engine.js';
import { attachSelection } from './selection.js';

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
  selectedConstraints: new Set(), // Support multi-selection of constraints
  selectedConstraint: null,    // For backwards compatibility - kept in sync with selection
  selectedShape: null,         // For backwards compatibility - kept in sync with selection
  selectedShapes: new Set(),   // Support multi-selection of shapes (shift+click)

  // Hover state
  hoveredShape: null,          // Track hovered shape for visual feedback
  hoveredJoint: null,          // Track hovered joint for visual feedback
  hoveredConstraint: null,     // Track hovered constraint for visual feedback

  history: [],  // Store last 5 states for undo
  maxHistory: 5,
  _undoGroupActive: false,
  _undoGroupInfo: null,

  // Selection helpers
  selectItem: function(type, payload, opts = {}){
    // Support additive selection when opts.add is true (Shift/Ctrl click)
    if(!opts.add) this.clearSelection();
    this.selection = { type, payload };
    console.log('[selection] selectItem', type, payload, opts);

    if(type === 'constraint'){
      // Clear selection flag if not additive
      if(!opts.add){
        if(this.constraints) for(const c of this.constraints) if(c && c.__selected) c.__selected = false;
        this.selectedConstraints.clear();
      }
      if(opts.add){
        if(payload){
          if(this.selectedConstraints.has(payload)){
            this.selectedConstraints.delete(payload);
            if(payload.__selected) payload.__selected = false;
          } else {
            this.selectedConstraints.add(payload);
            payload.__selected = true;
          }
        }
      } else {
        this.selectedConstraints.clear();
        if(payload){ this.selectedConstraints.add(payload); payload.__selected = true; }
      }
      this.selectedConstraint = payload || (this.selectedConstraints.size ? Array.from(this.selectedConstraints.values())[0] : null);
      this.selectedShape = null;
      this.selectedJoints.clear();
    } else if(type === 'shape'){
      if(opts.add){
        if(payload && payload.id){
          // Toggle selection when adding with Shift/Ctrl
          if(this.selectedShapes.has(payload.id)) this.selectedShapes.delete(payload.id);
          else this.selectedShapes.add(payload.id);
        }
      } else {
        this.selectedShapes.clear();
        if(payload && payload.id) this.selectedShapes.add(payload.id);
      }
      this.selectedShape = payload || (this.selectedShapes.size ? this.shapes.find(s => this.selectedShapes.has(s.id)) : null);
      this.selectedConstraint = null;
      this.selectedJoints.clear();
    } else if(type === 'joint'){
      if(opts.add){
        if(payload){
          if(this.selectedJoints.has(payload)) this.selectedJoints.delete(payload);
          else this.selectedJoints.add(payload);
        }
      } else {
        this.selectedJoints.clear();
        if(payload) this.selectedJoints.add(payload);
      }
      this.selectedConstraint = null;
      this.selectedShape = null;
    } else if(type === 'joints'){
      if(opts.add === false) this.selectedJoints.clear();
      if(Array.isArray(payload)){
        // Toggle behaviour for clusters: if all present then remove, else add
        const allPresent = payload.every(j => this.selectedJoints.has(j));
        if(allPresent){ payload.forEach(j => this.selectedJoints.delete(j)); }
        else { payload.forEach(j => this.selectedJoints.add(j)); }
      }
      this.selectedConstraint = null;
      this.selectedShape = null;
    } else {
      // Unknown / null selection
      this.selectedConstraint = null;
      this.selectedShape = null;
      this.selectedJoints.clear();
      this.selectedShapes.clear();
    }
  },

  clearSelection: function(){
    // Clear selected constraints
    for(const c of this.selectedConstraints) if(c && c.__selected) c.__selected = false;
    this.selectedConstraints.clear();
    this.selection = { type: null, payload: null };
    this.selectedConstraint = null;
    this.selectedShape = null;
    this.selectedJoints.clear();
    this.selectedShapes.clear();
  },

  getSelected: function(){ return this.selection; },

  _snapshotState: function(){
    return {
      joints: new Map(Array.from(this.joints.entries()).map(([k,v]) => [k, {...v}])),
      shapes: this.shapes.map(s => ({...s, joints: s.joints ? [...s.joints] : []})),
      constraints: this.constraints.map(c => ({...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined}))
    };
  },

  saveState: function() {
    const snapshot = this._snapshotState();
    this.history.push(snapshot);
    if(this.history.length > this.maxHistory) this.history.shift();
    const undoBtn = document.getElementById('btn-undo');
    if(undoBtn) undoBtn.disabled = false;
  },

  beginUndoGroup: function(){
    if(this._undoGroupActive) return;
    this._undoGroupActive = true;
    this._undoGroupInfo = { startHistoryLen: this.history.length, preSnapshot: this._snapshotState() };
    // Ensure a baseline snapshot exists so intermediate saveState() calls can provide per-segment undo
    this.saveState();
    // Keep Undo button available so users can cancel an in-progress group via Undo
    try{ const undoBtn = document.getElementById('btn-undo'); if(undoBtn) undoBtn.disabled = false; }catch(_){ }
  },

  endUndoGroup: function(){
    if(!this._undoGroupActive) return;
    const start = this._undoGroupInfo.startHistoryLen;
    const count = this.history.length - start;
    if(count > 0){
      // Compress group history entries into a single snapshot (the pre-group state)
      this.history.splice(start, count, this._undoGroupInfo.preSnapshot);
    }
    this._undoGroupActive = false;
    this._undoGroupInfo = null;
    // Re-enable Undo button only if there is history to undo
    try{ const undoBtn = document.getElementById('btn-undo'); if(undoBtn) undoBtn.disabled = (this.history.length === 0); }catch(_){ }
  },

  cancelUndoGroup: function(){
    if(!this._undoGroupActive) return;
    const start = this._undoGroupInfo.startHistoryLen;
    const count = this.history.length - start;
    if(count > 0) this.history.splice(start, count);
    const snapshot = this._undoGroupInfo.preSnapshot;
    // Restore live state to pre-group snapshot
    this.joints.clear();
    for(const [k,v] of snapshot.joints) this.joints.set(k, {...v});
    this.shapes.length = 0;
    this.shapes.push(...snapshot.shapes.map(s => ({...s, joints: s.joints ? [...s.joints] : []})));
    this.constraints.length = 0;
    this.constraints.push(...snapshot.constraints.map(c => ({...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined})));
    this.clearSelection();
    this.active = null;
    this._undoGroupActive = false;
    this._undoGroupInfo = null;
    try{ const undoBtn = document.getElementById('btn-undo'); if(undoBtn) undoBtn.disabled = (this.history.length === 0); }catch(_){ }
  },

  undo: function() {
    if(this._undoGroupActive){ try{ this.cancelUndoGroup(); }catch(_){ console.warn('Failed to cancel undo group'); } return; }
    if(this.history.length === 0) return;
    const snapshot = this.history.pop();
    this.joints.clear();
    for(const [k,v] of snapshot.joints) this.joints.set(k, {...v});
    this.shapes.length = 0;
    this.shapes.push(...snapshot.shapes.map(s => ({...s, joints: s.joints ? [...s.joints] : []})));
    this.constraints.length = 0;
    this.constraints.push(...snapshot.constraints.map(c => ({...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined})));
    this.clearSelection();
    this.active = null;
    try{ const undoBtn = document.getElementById('btn-undo'); if(undoBtn) undoBtn.disabled = (this.history.length === 0); }catch(_){ }
  }
};

// initialize
attachSelection(state);
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

function loop(){ engine.solve(8); draw(state.joints, state.shapes, svg, state.active, state.snapTarget, state.constraints, state.selectedConstraints, state.selectedJoints, state.selectedConstraint, state.currentTool, state.inference, state.selectedShapes, state.selectedShape, state.hoveredShape, state.hoveredJoint, state.hoveredConstraint); requestAnimationFrame(loop); }
loop();

// Export function for tests/external use
if(typeof module !== 'undefined' && module.exports) {
  module.exports = { state, engine };
}
