// Small helper to initialize/patch application-level state defaults
export function applyDefaultState(state){
  if(!state) return;
  if(typeof state.isConstructionMode === 'undefined') state.isConstructionMode = false;
}
