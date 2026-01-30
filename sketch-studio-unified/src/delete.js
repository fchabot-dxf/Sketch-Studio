// delete.js
// Centralize deletion logic for selected items to make it testable and reuseable.
export function deleteSelected(state){
  // Ensure delete is undoable: save snapshot before destructive changes
  try{ if(state.saveState) state.saveState(); }catch(_){ }

  // Try to use selection API when available
  const sel = (state.selectionGet ? state.selectionGet() : state.selection);

  // Single selected constraint
  if(sel && sel.type === 'constraint'){
    const c = sel.payload;
    const idx = state.constraints.indexOf(c);
    if(idx !== -1){
      if(c && c.__selected) c.__selected = false;
      state.constraints.splice(idx, 1);
      if(state.clearSelection) state.clearSelection();
    }
    return;
  }

  // Multiple selected constraints
  if(state.selectedConstraints && state.selectedConstraints.size > 0){
    const delSet = new Set(state.selectedConstraints);
    state.constraints = state.constraints.filter(c => !delSet.has(c));
    for(const c of delSet) if(c && c.__selected) c.__selected = false;
    state.selectedConstraints.clear();
    if(state.clearSelection) state.clearSelection();
    return;
  }

  // Multiple selected shapes
  if(state.selectedShapes && state.selectedShapes.size > 0){
    const delSet = new Set(state.selectedShapes);
    state.shapes = state.shapes.filter(s => !delSet.has(s.id));
    // Remove constraints that reference deleted shapes
    state.constraints = state.constraints.filter(c => {
      if(c.shapes && c.shapes.some(id => delSet.has(id))) return false;
      if(c.shape && delSet.has(c.shape)) return false;
      if(c.line && delSet.has(c.line)) return false;
      if(c.circle && delSet.has(c.circle)) return false;
      return true;
    });
    if(state.clearSelection) state.clearSelection();
    return;
  }

  // Single selected shape
  if(sel && sel.type === 'shape'){
    const s = sel.payload;
    const idx = state.shapes.indexOf(s);
    if(idx !== -1){
      state.shapes.splice(idx, 1);
      // Remove constraints referencing it
      state.constraints = state.constraints.filter(c => {
        if(c.shapes && c.shapes.some(id => id === s.id)) return false;
        if(c.shape && c.shape === s.id) return false;
        if(c.line && c.line === s.id) return false;
        if(c.circle && c.circle === s.id) return false;
        return true;
      });
      if(state.clearSelection) state.clearSelection();
    }
    return;
  }

  // No selected items
  return;
}
