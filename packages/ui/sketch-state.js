// Shared sketch app-state factory (#ui/sketch-state.js). Builds the ~41-field state object the renderer + input
// layer operate on (engine proxies, view, selection sets, hover/active/drag, undo-group history). Relocated
// VERBATIM from apps/sketchstudio/main.js (P5 pre) so SketchStudio AND Shaper's Design canvas share ONE state
// shape. Pure relocation — no field changed.
// Params: `engine` (the constraint engine) + `view` (the viewBox state object, shared with the host's view loop).
// TODO(shaper): the undo helpers reach `#btn-undo` (guarded → no-op in a host without it); parameterize if a
// host wants its own undo button.
import { addConstraintObject } from '#core/constraints.js';
import { removeOrphanJoints } from '#core/joints.js';
import { dbg } from '#core/debug.js';
import { createSketches } from '#core/sketch-model.js'; // SKETCH-1a: the sketch-container overlay (additive)

export function createSketchState(engine, view) {
  const state = {
    // SKETCH-1a: the sketch container — state.sketches + activeSketchId (default single 'Sketch 1'). ADDITIVE; nothing
    // reads it yet (the panel sketch-tree is S-1b). The GLOBAL solver never reads sketchId. Live-tool entity stamping
    // lands at S-2 (until then untagged entities resolve to Sketch 1 via sketchOf's fallback).
    ...createSketches(),
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
  return state;
}
