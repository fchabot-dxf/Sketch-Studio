// TASK 545: a drag takes its undo snapshot through state.saveState and reads state.history (selection-tools.js ensureDragUndo /
// settleDragUndo). Hand-built mock states in the drag tests spread this in so they carry the same three members the real sketch state has.
export const undoStub = () => ({
  history: [],
  saveState(label) { this.history.push({ label, joints: new Map(), shapes: [], constraints: [] }); },
  discardSnapshotAt(len) { if (this.history.length !== len) return false; this.history.pop(); return true; }
});
