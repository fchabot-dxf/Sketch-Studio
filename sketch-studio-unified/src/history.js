// history.js
// Attach minimal undo history helpers to a state object for testing and simple use.
export function attachHistory(state){
  state.history = state.history || [];
  state.maxHistory = state.maxHistory || 10;
  state._undoGroupActive = false;
  state._undoGroupInfo = null;

  state._snapshotState = state._snapshotState || function(){
    return {
      joints: new Map(Array.from((state.joints || new Map()).entries()).map(([k,v]) => [k, {...v}])),
      shapes: (state.shapes || []).map(s => ({...s, joints: s.joints ? [...s.joints] : [] })),
      constraints: (state.constraints || []).map(c => ({...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined }))
    };
  };

  state.saveState = state.saveState || function(){
    const snapshot = state._snapshotState();
    state.history.push(snapshot);
    if(state.history.length > state.maxHistory) state.history.shift();
  };

  state.beginUndoGroup = state.beginUndoGroup || function(){
    if(state._undoGroupActive) return;
    state._undoGroupActive = true;
    state._undoGroupInfo = { startHistoryLen: state.history.length, preSnapshot: state._snapshotState() };
    // Ensure baseline snapshot
    state.saveState();
  };

  state.endUndoGroup = state.endUndoGroup || function(){
    if(!state._undoGroupActive) return;
    const start = state._undoGroupInfo.startHistoryLen;
    const count = state.history.length - start;
    if(count > 0){
      state.history.splice(start, count, state._undoGroupInfo.preSnapshot);
    }
    state._undoGroupActive = false;
    state._undoGroupInfo = null;
  };

  state.cancelUndoGroup = state.cancelUndoGroup || function(){
    if(!state._undoGroupActive) return;
    const start = state._undoGroupInfo.startHistoryLen;
    const count = state.history.length - start;
    if(count > 0) state.history.splice(start, count);
    const snapshot = state._undoGroupInfo.preSnapshot;
    // Restore
    state.joints = new Map();
    for(const [k,v] of snapshot.joints) state.joints.set(k, {...v});
    state.shapes = snapshot.shapes.map(s => ({...s, joints: s.joints ? [...s.joints] : [] }));
    state.constraints = snapshot.constraints.map(c => ({...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined }));
    state.clearSelection && state.clearSelection();
    state.active = null;
    state._undoGroupActive = false;
    state._undoGroupInfo = null;
  };

  state.undo = state.undo || function(){
    if(state._undoGroupActive){ try{ state.cancelUndoGroup(); }catch(_){ } return; }
    if(!state.history || state.history.length === 0) return;
    const snapshot = state.history.pop();
    state.joints = new Map();
    for(const [k,v] of snapshot.joints) state.joints.set(k, {...v});
    state.shapes = snapshot.shapes.map(s => ({...s, joints: s.joints ? [...s.joints] : [] }));
    state.constraints = snapshot.constraints.map(c => ({...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined }));
    state.clearSelection && state.clearSelection();
    state.active = null;
  };

  return { attachHistory: true };
}
