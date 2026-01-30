// selection.js
// Small selection module that attaches a canonical selection API to a shared `state` object.
// Usage: import { attachSelection } from './selection.js'; attachSelection(state);

export function attachSelection(state){
  // Ensure sets exist
  state.selectedJoints = state.selectedJoints || new Set();
  state.selectedShapes = state.selectedShapes || new Set();
  state.selectedConstraints = state.selectedConstraints || new Set();
  state.selectedConstraint = state.selectedConstraint || null;
  state.selectedShape = state.selectedShape || null;
  state.selection = state.selection || { type: null, payload: null };

  function clearSelection(){
    for(const c of state.selectedConstraints) if(c && c.__selected) c.__selected = false;
    state.selectedConstraints.clear();
    state.selection = { type: null, payload: null };
    state.selectedConstraint = null;
    state.selectedShape = null;
    state.selectedJoints.clear();
    state.selectedShapes.clear();
  }

  function _setSingleSelection(type, payload){
    state.selection = { type, payload };
  }

  function selectItem(type, payload, opts = {}){
    // opts.add === true indicates additive selection (Shift/Ctrl semantics)
    const prevSelectedJoints = new Set(state.selectedJoints);
    // Special-case: if clicking the same joint cluster without modifiers, toggle it off
    if(type === 'joints' && Array.isArray(payload) && !opts.add){
      const allPresentBefore = payload.every(j => prevSelectedJoints.has(j)) && prevSelectedJoints.size === payload.length;
      if(allPresentBefore){ clearSelection(); return; }
    }
    if(!opts.add) clearSelection();
    _setSingleSelection(type, payload);

    if(type === 'constraint'){
      if(!opts.add){
        if(state.constraints) for(const c of state.constraints) if(c && c.__selected) c.__selected = false;
        state.selectedConstraints.clear();
      }
      if(opts.add){
        if(payload){
          if(state.selectedConstraints.has(payload)){
            state.selectedConstraints.delete(payload);
            if(payload.__selected) payload.__selected = false;
          } else {
            state.selectedConstraints.add(payload);
            payload.__selected = true;
          }
        }
      } else {
        state.selectedConstraints.clear();
        if(payload){ state.selectedConstraints.add(payload); payload.__selected = true; }
      }
      state.selectedConstraint = payload || (state.selectedConstraints.size ? Array.from(state.selectedConstraints.values())[0] : null);
      state.selectedShape = null;
      state.selectedJoints.clear();
    } else if(type === 'shape'){
      if(opts.add){
        if(payload && payload.id){
          if(state.selectedShapes.has(payload.id)) state.selectedShapes.delete(payload.id);
          else state.selectedShapes.add(payload.id);
        }
      } else {
        state.selectedShapes.clear();
        if(payload && payload.id) state.selectedShapes.add(payload.id);
      }
      state.selectedShape = payload || (state.selectedShapes.size ? state.shapes.find(s => state.selectedShapes.has(s.id)) : null);
      state.selectedConstraint = null;
      state.selectedJoints.clear();
    } else if(type === 'joint'){
      if(opts.add){
        if(payload){
          if(state.selectedJoints.has(payload)) state.selectedJoints.delete(payload);
          else state.selectedJoints.add(payload);
        }
      } else {
        state.selectedJoints.clear();
        if(payload) state.selectedJoints.add(payload);
      }
      state.selectedConstraint = null;
      state.selectedShape = null;
    } else if(type === 'joints'){
      if(opts.add === false) state.selectedJoints.clear();
      if(Array.isArray(payload)){
        const allPresent = payload.every(j => state.selectedJoints.has(j));
        if(allPresent){ payload.forEach(j => state.selectedJoints.delete(j)); }
        else { payload.forEach(j => state.selectedJoints.add(j)); }
      }
      state.selectedConstraint = null;
      state.selectedShape = null;
    } else {
      // Unknown / null selection
      state.selectedConstraint = null;
      state.selectedShape = null;
      state.selectedJoints.clear();
      state.selectedShapes.clear();
    }
  }

  function add(type, payload){ selectItem(type, payload, { add: true }); }
  function remove(type, payload){
    if(type === 'constraint' && payload){ state.selectedConstraints.delete(payload); if(payload.__selected) payload.__selected = false; }
    if(type === 'shape' && payload && payload.id) state.selectedShapes.delete(payload.id);
    if(type === 'joint' && payload) state.selectedJoints.delete(payload);
  }
  function toggle(type, payload){ selectItem(type, payload, { add: true }); }
  function get(type){
    if(type === 'constraint') return state.selectedConstraints;
    if(type === 'shape') return state.selectedShapes;
    if(type === 'joint' || type === 'joints') return state.selectedJoints;
    return null;
  }
  function isSelected(type, payload){
    if(type === 'constraint') return state.selectedConstraints.has(payload) || state.selectedConstraint === payload;
    if(type === 'shape') return payload && (state.selectedShapes.has(payload.id) || state.selectedShape === payload);
    if(type === 'joint') return state.selectedJoints.has(payload);
    return false;
  }

  // Attach API to state for backwards compatibility
  state.selectItem = function(type, payload, opts){ selectItem(type, payload, opts); };
  state.clearSelection = function(){ clearSelection(); };
  state.selectionGet = function(){ return state.selection; };
  state.selectionAdd = add;
  state.selectionRemove = remove;
  state.selectionToggle = toggle;
  state.selectionGetSet = get;
  state.selectionIsSelected = isSelected;

  return { selectItem, clearSelection, add, remove, toggle, get, isSelected };
}
