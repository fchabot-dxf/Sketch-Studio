// Shared sketch app-state factory (#ui/sketch-state.js). Builds the ~41-field state object the renderer + input
// layer operate on (engine proxies, view, selection sets, hover/active/drag, undo-group history). Relocated
// VERBATIM from apps/sketchstudio/main.js (P5 pre) so SketchStudio AND Shaper's Design canvas share ONE state
// shape. Pure relocation — no field changed.
// Params: `engine` (the constraint engine) + `view` (the viewBox state object, shared with the host's view loop).
import { addConstraintObject } from '#core/constraints.js';
import { removeOrphanJoints } from '#core/joints.js';
import { dbg } from '#core/debug.js';
import { createSketches, stampSketch } from '#core/sketch-model.js'; // SKETCH-1a/2a: the sketch-container overlay + stamping
import { cloneProfiles } from '#core/profile-model.js';
import { cloneParameters, replaceParameters } from '#core/parameters.js'; // TASK 535: the document's user parameters ride every snapshot
import { withoutDragTarget } from '#core/document.js'; // TASK 575: a drag target is not part of the drawing (never in a snapshot)

// TASK 575: removes the solver targets a drag set (its member joints' dragTarget, a BODY drag's shape.dragTarget). The ONE release: the
// select tool calls it at pointer-up (before a snap-on-release solves) and the state's `drag` setter calls it when a drag is replaced
// or cleared by any other path.
export function releaseDragTargets(state, drag) {
  if (!drag) return;
  if (drag.body) { const s = (state.shapes || []).find(x => x.id === drag.body.shape); if (s) delete s.dragTarget; }
  for (const id of (drag.jointIds || [])) { const j = state.joints && state.joints.get(id); if (j) delete j.dragTarget; }
}

// TASK 466: THE undo depth, declared once and shared by every app (one shared state). It was 5, far too shallow for a CAD tool.
// Measured snapshot cost (headless Edge): the owner's 8x11 dewalt SVG imported in Shaper (1693 shapes, 33 cuts) = 384 KB JSON /
// ~276 KB heap per snapshot; a synthetic large sketch (2000 shapes, 4000 joints, 500 constraints, 300 cuts) = 424 KB JSON /
// ~539 KB heap. At depth 100 that is ~28 MB typical, ~54 MB worst (history + redo together never exceed the depth).
export const HISTORY_DEPTH = 100;

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
    // TASK 575: the drag in progress. Its solver targets (joint.dragTarget / shape.dragTarget, which every solve pulls toward while
    // they exist) live exactly as long as the drag: replacing or clearing state.drag releases them, whatever ends the drag (pointer-up,
    // Esc, a touch hold, a new press after a lost release, clearing the document). Until then a target left behind kept pulling its
    // joint toward an old cursor position in every later solve.
    _drag: null,
    get drag() { return this._drag; },
    set drag(d) { if (this._drag && this._drag !== d) releaseDragTargets(this, this._drag); this._drag = d; },
    snapTarget: null,
    inference: null,  // Track inference hints (horizontal, vertical, perpendicular)
    lastMouse: null,
    pendingConstraint: null,  // { type: 'parallel', firstElement: { type: 'line|joint', id }, ... }
    mirror: null,  // TASK 585: the Mirror tool's pick { step: MIRROR_STEPS.*, objects: { shapes, joints } | null, line: id | null }; read only while currentTool is MIRROR (input-handlers/mirror-tool.js beginMirror sets it)
    view,
    selectedJoints: new Set(),  // Track selected joints for showing constraint glyphs
    selectedConstraints: new Set(), // Track selected constraints (support multi-select)
    selectedShapes: new Set(),      // Track selected shapes (support multi-select)
    hoveredShape: null,          // Track hovered shape for visual feedback
    hoveredJoint: null,          // Track hovered joint for visual feedback
    hoveredConstraint: null,     // Track hovered constraint for visual feedback
    // Construction mode: when true new shapes are created as construction geometry (dashed/faded)
    isConstructionMode: false,
    groups: [],
    profiles: [],
    parameters: [], // TASK 535: user parameters { name, unit, expression, comment? }, one list per document (no non-test producer yet)
    vcarves: [],
    // TASK 463: OPTIONAL generic host hook so a host's own undoable data rides in the SAME snapshots (one history, no second
    // stack): { capture() -> JSON-safe data, restore(data), [asked] }. Shaper uses it for its cut plan. null = nothing extra.
    // TASK 570: `asked: true` = the host's data rides ONLY in snapshots saved with saveState(label, { host: true }) (an import);
    // every other step, and its undo / redo, leaves the host's data alone (Pen Plotter). Without `asked` every snapshot carries it (Shaper).
    hostSnapshot: null,
    history: [],  // the last HISTORY_DEPTH states for undo
    maxHistory: HISTORY_DEPTH,
    redoStack: [],  // BURN-DOWN-2: states popped by undo, so redo() can re-apply them (empty until undo() runs)
    // TASK 435: callbacks run after every history change (the shared ribbon's Undo/Redo enable state subscribes).
    _historyListeners: new Set(),
    _undoGroupActive: false,
    _undoGroupDepth: 0,
    // BURN-DOWN-2: deep-clone the live store into a snapshot object (extracted from saveStateForce so undo/redo
    // capture the current state identically — one definition of "what a snapshot is").
    // `withHost` (TASK 570): include the host's data (always for a hostSnapshot without `asked`; only when true for one with it).
    _captureSnapshot: function(withHost){
      const hs = this.hostSnapshot;
      return {
        joints: new Map(Array.from(this.joints.entries()).map(([k,v]) => [k, withoutDragTarget(v)])),
        shapes: this.shapes.map(s => ({...withoutDragTarget(s), joints: s.joints ? [...s.joints] : []})),
        constraints: this.constraints.map(c => ({...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined})),
        // SKETCH-2a: capture the sketch container so new-sketch + active changes undo/redo correctly
        sketches: Array.isArray(this.sketches) ? this.sketches.map(s => ({...s})) : undefined,
        activeSketchId: this.activeSketchId,
        // SKETCH-4c: the user-GROUP list (the userGroupId stamps ride the shape snapshot above)
        groups: Array.isArray(this.groups) ? this.groups.map(g => ({...g})) : undefined,
        // COMBINE slice 1: combined profiles
        profiles: Array.isArray(this.profiles) ? cloneProfiles(this.profiles) : undefined,
        parameters: Array.isArray(this.parameters) ? cloneParameters(this.parameters) : undefined, // TASK 535
        // VCARVE-3b: the V-carve records (deep clone incl. the nested vbit)
        vcarves: Array.isArray(this.vcarves) ? this.vcarves.map(v => ({...v, vbit: v.vbit ? {...v.vbit} : undefined})) : undefined,
        host: hs && (!hs.asked || withHost) ? hs.capture() : undefined // TASK 463: the host's own undoable data
      };
    },
    // TASK 507 (ops journal): every stored snapshot carries WHEN it was saved (`t`) and WHAT the user did next (`label`; default =
    // the current tool). The snapshot is taken BEFORE the action, so its label names the action that follows it. These two
    // fields never touch undo/redo (_restoreSnapshot ignores them); packages/core/journal.js turns the history into an ordered log.
    _stamp: function(snapshot, label){
      snapshot.t = Date.now();
      snapshot.label = label || this.currentTool;
      return snapshot;
    },
    // BURN-DOWN-2: restore the live store from a snapshot (extracted verbatim from undo() so redo() reuses it).
    _restoreSnapshot: function(snapshot){
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
      // SKETCH-2a: restore the sketch container (new-sketch + active changes undo correctly)
      if(snapshot.sketches && Array.isArray(this.sketches)){ this.sketches.length = 0; this.sketches.push(...snapshot.sketches.map(s => ({...s}))); }
      if(snapshot.activeSketchId) this.activeSketchId = snapshot.activeSketchId;
      if(snapshot.groups && Array.isArray(this.groups)){ this.groups.length = 0; this.groups.push(...snapshot.groups.map(g => ({...g}))); } // SKETCH-4c
      if(snapshot.profiles && Array.isArray(this.profiles)){
        this.profiles.length = 0;
        this.profiles.push(...cloneProfiles(snapshot.profiles));
      } else if (Array.isArray(this.profiles)) {
        this.profiles.length = 0;
      }
      if(Array.isArray(this.parameters)) replaceParameters(this.parameters, snapshot.parameters); // TASK 535
      if(snapshot.vcarves && Array.isArray(this.vcarves)){ this.vcarves.length = 0; this.vcarves.push(...snapshot.vcarves.map(v => ({...v, vbit: v.vbit ? {...v.vbit} : undefined}))); } // VCARVE-3b
      if (this.hostSnapshot && snapshot.host !== undefined) this.hostSnapshot.restore(snapshot.host); // TASK 463
      // Clear selections and active tool state
      this.selectedJoints.clear();
      this.selectedConstraints.clear();
      this.selectedShapes.clear();
      this.active = null;
    },
    canUndo: function() { return this.history.length > 0; },
    canRedo: function() { return this.redoStack.length > 0; },
    // TASK 435: subscribe to history changes; returns the unsubscribe function.
    addHistoryListener: function(fn) {
      this._historyListeners.add(fn);
      return () => this._historyListeners.delete(fn);
    },
    _notifyHistory: function() {
      for (const fn of this._historyListeners) fn();
    },
    // TASK 435: drop every undo AND redo step (Clear All: "not undoable"), then tell the listeners.
    clearHistory: function() {
      this.history.length = 0;
      this.redoStack.length = 0;
      this._notifyHistory();
    },
    // Clear All: reset EVERY document store + session UI to a freshly-constructed state, then drop history (NOT undoable).
    clearDocument: function() {
      this.joints.clear();
      this.shapes.length = 0;
      this.constraints.length = 0;
      const fresh = createSketches();
      this.sketches.length = 0;
      this.sketches.push(...fresh.sketches);
      this.activeSketchId = fresh.activeSketchId;
      this.groups.length = 0;
      this.profiles.length = 0;
      this.parameters.length = 0; // TASK 535
      this.vcarves.length = 0;
      this.selectedJoints.clear();
      this.selectedConstraints.clear();
      this.selectedShapes.clear();
      this.active = null;
      this.drag = null;
      this.snapTarget = null;
      this.inference = null;
      this.lastMouse = null;
      this.pendingConstraint = null;
      this.hoveredShape = null;
      this.hoveredJoint = null;
      this.hoveredConstraint = null;
      this.clearHistory();
      this.initStore(); // re-creates the origin joint
    },
    // Force push a snapshot regardless of grouping (used to capture pre-group state)
    // TASK 549: `snapshot` (optional) = a state captured EARLIER with captureUndoSnapshot(), pushed as this step's "before" instead of the live one.
    saveStateForce: function(label, snapshot, opts){
      this.history.push(this._stamp(snapshot || this._captureSnapshot(!!(opts && opts.host)), label));
      if(this.history.length > this.maxHistory) this.history.shift();
      this.redoStack.length = 0; // BURN-DOWN-2: any new saved state invalidates the redo branch
      this._notifyHistory();
    },
    discardSnapshotAt(len) {
      if (this.history.length !== len) return false;
      this.history.pop();
      this._notifyHistory();
      return true;
    },
    // Normal save - during an active undo group we still create segment snapshots (they will be compressed on commit)
    saveState: function(label, opts) { // opts.host (TASK 570): this step's snapshot carries the host's data (see hostSnapshot.asked)
      if(this._undoGroupActive){
        // Create a segment snapshot and remember its index for the active group
        this.saveStateForce(label, undefined, opts);
        try{ if(this._undoGroupInfo) this._undoGroupInfo.segmentIndices.push(this.history.length - 1); }catch(_){ }
        return;
      }
      this.saveStateForce(label, undefined, opts);
    },
    beginUndoGroup: function(label, snapshot){
      if(this._undoGroupActive) {
        this._undoGroupDepth = (this._undoGroupDepth || 1) + 1;
        return;
      }
      this._undoGroupActive = true;
      this._undoGroupDepth = 1;
      // capture snapshot before group begins so undo will remove entire group
      this.saveStateForce(label, snapshot);
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
      this._notifyHistory();
    },
    // ── DRAW STEP (TASK 549): ONE drawn element = ONE undo step (Fusion's rule) ─────────────────────────────────────────────────
    // A drawing tool opens its step at the element's FIRST click (beginDrawStep: the snapshot is the document BEFORE the element, so
    // Undo removes the element's joints, shape and every constraint made while drawing it) and closes it when the element is committed
    // (its own endUndoGroup). closeDrawStep() is the ONE place a draw that did NOT commit ends (Esc, another tool picked, Undo mid-draw):
    // nothing was committed -> the document is put back exactly as it was and the step is dropped, so no half-drawn point is left behind
    // and no empty step is on the stack; something was committed (a bezier / line chain kept by Esc) -> the step is kept.
    // Only groups opened by beginDrawStep are touched: a dimension edit / drag / delete group is never cancelled by a tool switch.
    captureUndoSnapshot: function(){ return this._captureSnapshot(); },
    isUndoGroupOpen: function(){ return !!this._undoGroupActive; },
    beginDrawStep: function(label, snapshot){
      if(this._undoGroupActive){ this._undoGroupDepth = (this._undoGroupDepth || 1) + 1; return; }
      this.beginUndoGroup(label, snapshot);
      this._undoGroupInfo.draw = true;
    },
    closeDrawStep: function(){
      const info = this._undoGroupInfo;
      if(!this._undoGroupActive || !info || !info.draw) return 'none';
      const start = this.history[info.startIndex];
      this._undoGroupDepth = 1;
      if(this.shapes.length > start.shapes.length){ this.endUndoGroup(); return 'kept'; } // a draw only ever ADDS shapes (counted)
      this._undoGroupInfo = null; this._undoGroupActive = false; this._undoGroupDepth = 0;
      this.history.splice(info.startIndex);
      this._restoreSnapshot(start);
      this._notifyHistory();
      return 'cancelled';
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
        // SKETCH-2a: restore the sketch container with the rest of the snapshot
        if(snapshot.sketches && Array.isArray(this.sketches)){ this.sketches.length = 0; this.sketches.push(...snapshot.sketches.map(s => ({...s}))); }
        if(snapshot.activeSketchId) this.activeSketchId = snapshot.activeSketchId;
        if(snapshot.groups && Array.isArray(this.groups)){ this.groups.length = 0; this.groups.push(...snapshot.groups.map(g => ({...g}))); } // SKETCH-4c
        if(snapshot.profiles && Array.isArray(this.profiles)){
          this.profiles.length = 0;
          this.profiles.push(...cloneProfiles(snapshot.profiles));
        }
        if(Array.isArray(this.parameters)) replaceParameters(this.parameters, snapshot.parameters); // TASK 535
        if(snapshot.vcarves && Array.isArray(this.vcarves)){ this.vcarves.length = 0; this.vcarves.push(...snapshot.vcarves.map(v => ({...v, vbit: v.vbit ? {...v.vbit} : undefined}))); } // VCARVE-3b
      } else {
        // No prior snapshot - clear store
        this.history.splice(0);
        try{ this.initStore(); }catch(_){ }
      }
      // Cleanup and exit group mode
      try{ removeOrphanJoints(this); }catch(_){ }
      this._undoGroupInfo = null;
      this._undoGroupActive = false;
      this._notifyHistory();
      return true;
    },
    undo: function() {
      if(this.closeDrawStep() === 'cancelled') return; // TASK 549: Undo in the middle of a draw cancels that draw (nothing committed yet)
      if(this.history.length === 0) return;
      // BURN-DOWN-2: capture the CURRENT live state so redo() can return to it, THEN restore the previous snapshot.
      const snapshot = this.history.pop();
      this.redoStack.push(this._stamp(this._captureSnapshot(snapshot.host !== undefined), snapshot.label)); // the redo entry is labelled with the action it re-does
      this._restoreSnapshot(snapshot); // cleanup after undo is disabled; trust the snapshot as saved
      this._notifyHistory();
    },
    // BURN-DOWN-2: re-apply the most recently undone state (symmetric with undo()). No-op when nothing was undone.
    redo: function() {
      this.closeDrawStep(); // TASK 549: a half-drawn element is cancelled before Redo re-applies the undone one
      if(!this.redoStack || this.redoStack.length === 0) return;
      // The current state becomes undoable again, then restore the redo snapshot.
      const snapshot = this.redoStack.pop();
      this.history.push(this._stamp(this._captureSnapshot(snapshot.host !== undefined), snapshot.label));
      if(this.history.length > this.maxHistory) this.history.shift();
      this._restoreSnapshot(snapshot);
      this._notifyHistory();
    }
  };

  // SKETCH-2a: live-tool STAMPING via a centralized .set/.push WRAP (covers ALL creation sites at once — can't miss
  // one). Safe: the solver MUTATES joint positions in place (j.x = …) and never .set-replaces, so the wrap is never
  // triggered during solve; and it only stamps an entity WITHOUT a sketchId, so undo-restore (which spreads the
  // snapshot's sketchId) is preserved. New geometry → sketchId = the ACTIVE sketch (default sketch-1 = the fallback,
  // so the single-sketch default is byte-identical). Covers: line/rect/circle/arc/dimension joints.set + circle/line
  // shapes.push + the rect/arc factory `res.shapes.forEach(state.shapes.push)`.
  const _jointsSet = state.joints.set.bind(state.joints);
  state.joints.set = (id, j) => { if (j && j.sketchId == null) stampSketch(j, state); return _jointsSet(id, j); };
  const _shapesPush = state.shapes.push.bind(state.shapes);
  state.shapes.push = (...items) => { for (const s of items) if (s && s.sketchId == null) stampSketch(s, state); return _shapesPush(...items); };

  return state;
}
