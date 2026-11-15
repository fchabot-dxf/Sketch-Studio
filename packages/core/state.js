import { SLOT_MODES } from './constants.js';

// Small helper to initialize/patch application-level state defaults
export function applyDefaultState(state){
  if(!state) return;
  if(typeof state.isConstructionMode === 'undefined') state.isConstructionMode = false;
  if(typeof state.slotMode === 'undefined') state.slotMode = SLOT_MODES.CENTER_TO_CENTER;
}
