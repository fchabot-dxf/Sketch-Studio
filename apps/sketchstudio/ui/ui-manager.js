import { dbg } from '#core/debug.js';
import { TOOL_MODES, RECT_MODES, ARC_MODES, CONSTRAINT_TYPES, CONSTRAINT_TOOLS } from '#core/constants.js';
import { clearHover } from '#ui/hover-manager.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { exportToFile } from './export-manager.js';

import { deactivateLineTool } from '#ui/input-handlers/line-tool.js';
import { setupTrimTool, resetTrimState } from '#ui/input-handlers/trim-tool.js';
import { setupBreakTool, resetBreakState } from '#ui/input-handlers/break-tool.js';
import { setupFilletTool, resetFilletState } from '#ui/input-handlers/fillet-tool.js';
import { recordConstraintStep } from '#ui/input-handlers/constraint-tools.js';
import { startDimensionFromSelection } from '#ui/input-handlers/dimension-tool.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
export function setupUI(state){
  // S7c-2d: the shared tool ribbon (mounted below). setTool syncs its active highlight via refresh().
  let toolRibbon = null;

  // Track rect sub-mode
  state.rectMode = RECT_MODES.TWO_POINT; // default: 2-point corner rect
  
  function setTool(t){ 
  dbg.log('app', 'Setting tool to:', t); // Debug log
  // If we're switching away from active tools, run cleanup
  try{ if(state.currentTool === TOOL_MODES.LINE && t !== TOOL_MODES.LINE) deactivateLineTool(state); }catch(_){ }
  try{ if(state.currentTool === TOOL_MODES.TRIM && t !== TOOL_MODES.TRIM) resetTrimState(); }catch(_){ }
  try{ if(state.currentTool === TOOL_MODES.BREAK && t !== TOOL_MODES.BREAK) resetBreakState(); }catch(_){ }
  try{ if(state.currentTool === TOOL_MODES.FILLET && t !== TOOL_MODES.FILLET) resetFilletState(); }catch(_){ }

  state.currentTool = t; 
  state.active = null; // clear any in-progress action
    // Clear hover feedback and any rubber-band preview when switching tools
    try { clearHover(state); state.tempMousePos = null; } catch(_) {}
    // Request polyline reset; input handler will clear internal continuation state
    if(typeof state.resetPolyline === 'function') state.resetPolyline();
    state._clearPolylineRequest = true;

    if (t === TOOL_MODES.TRIM) { try { setupTrimTool(); } catch(_) {} }
    else if (t === TOOL_MODES.BREAK) { try { setupBreakTool(); } catch(_) {} }
    else if (t === TOOL_MODES.FILLET) { try { setupFilletTool(document.getElementById('svgCanvas') || document.querySelector('svg'), state); } catch(_) {} }
    
    // S7c-2d: the shared tool ribbon owns the active highlight now — sync it to state.currentTool. Load-bearing:
    // setTool is called from OUTSIDE the ribbon (the auto-SELECT after clear/escape), and the render loop also
    // calls refresh() so KEYBOARD tool-switches (switchToTool) follow too.
    if (toolRibbon) toolRibbon.refresh();

  }
  
  // S7c-2d-pre: the rich tool-activation logic (migrated from the old per-button click handlers, made
  // DOM-button-INDEPENDENT — every .tool-btn/#tool-select/.classList active management is now setTool(), which
  // refreshes the shared ribbon). The shared ribbon's onToolClick routes here, so the CAD pre-selection workflows
  // (pre-selection as 1st element, H/V-immediate, dimension-from-selection) survive the ribbon adoption.
  function handleToolActivate(t){
    if(CONSTRAINT_TOOLS.includes(t)){
      // 1. Pre-selection: a single selected joint/shape becomes the constraint's first element
      let firstEl = null;
      if(state.selectedJoints.size === 1 && state.selectedShapes.size === 0) firstEl = { type: 'joint', id: [...state.selectedJoints][0] };
      else if(state.selectedShapes.size === 1 && state.selectedJoints.size === 0) firstEl = { type: 'shape', id: [...state.selectedShapes][0] };

      // H/V Immediate Application: a selected line + H/V → apply immediately, return to SELECT
      if(t === TOOL_MODES.HORIZONTAL_VERTICAL && firstEl && firstEl.type === 'shape'){
        const s = state.shapes.find(x => x.id === firstEl.id);
        if(s && s.type === 'line'){
          recordConstraintStep(state, TOOL_MODES.HORIZONTAL_VERTICAL, () => ConstraintManager.addHorizontalOrVertical(state, s.joints));
          setTool(TOOL_MODES.SELECT);
          return;
        }
      }

      // Coincident: fresh-start (clear selection) when there's no usable pre-selection
      if(t === TOOL_MODES.COINCIDENT){
        if (!firstEl) {
          state.selectedJoints.clear();
          if(state.selectedConstraints) state.selectedConstraints.clear();
          if(state.selectedShapes) state.selectedShapes.clear();
          setTool(t);
          return;
        }
      }

      // H/V uses 'horizontal' so the solver recognizes it if passed directly
      const effectiveType = (t === TOOL_MODES.HORIZONTAL_VERTICAL) ? CONSTRAINT_TYPES.HORIZONTAL : t;

      // Clicking the same pending constraint tool again cancels it
      if(state.pendingConstraint && state.pendingConstraint.type === effectiveType){
        state.pendingConstraint = null;
        setTool(TOOL_MODES.SELECT); // refreshes the ribbon
        return;
      }

      // Enter the tool and wait for the first element
      state.pendingConstraint = { type: effectiveType, firstElement: firstEl };
      setTool(t);
      return;
    }

    // Non-constraint tools: just switch
    setTool(t);

    // Dimension tool with a preselection starts immediately
    if (t === TOOL_MODES.DIMENSION) {
      try { const svgEl = document.getElementById('svgCanvas') || document.querySelector('svg'); if (svgEl && !state.placingConstraint) startDimensionFromSelection(svgEl, state); } catch(_) {}
    }
  }


  // Polygon is currently hidden in the toolbar - no click handler attached

  // Arc: single-mode (Center-Start-End) — no dropdown
  if(!state.arcMode) state.arcMode = ARC_MODES.CENTER_START_END;
  // Arc button behaves like other simple tool buttons — no dropdown setup needed

  


  // ── S7c-2d: mount the shared tool ribbon into the (now-empty) #toolsRibbon container. Tool clicks route to the
  // rich handleToolActivate/setTool via onToolClick (a rect-variant select sets state.rectMode then calls
  // onToolClick(RECT)); the ribbon owns the rect dropdown and built-in Edit group (Undo/Redo); Actions (Clear All)
  // comes via extraGroups and KEEPS its id so the clear handler below binds it (R-BIND-ORDER: mounted before it runs).
  // (S7c-2d-cleanup: the inline button markup + the dead rect-dropdown machinery have been statically removed.)
  try {
    const trEl = document.getElementById('toolsRibbon');
    if (trEl) {
      trEl.innerHTML = '';
      toolRibbon = createToolRibbon({
        state,
        onToolClick: (t) => handleToolActivate(t), // S7c-2d-pre: the rich activation (pre-selection workflows)
        extraGroups: [{ label: 'Actions', buttons: [{ id: 'btn-clear', label: 'Clear All' }] }],
      });
      toolRibbon.render(trEl);
    }
  } catch (e) { try { dbg.warn('app', '[ui-manager] tool ribbon mount failed', e); } catch (_) {} }

  // Initially activate select tool
  setTool(TOOL_MODES.SELECT);

  // Add touch / pointer-based drag-to-scroll for toolbar (mobile-friendly)
  try {
    const ribbon = document.getElementById('toolsRibbon');
    if (ribbon) {
      let isDown = false;
      let startX;
      let scrollLeft;
      let maxDragDist = 0;

      ribbon.addEventListener('pointerdown', (e) => {
        // Allow native touch scrolling (smoother and handles taps correctly)
        if (e.pointerType === 'touch') return;

        isDown = true;
        startX = e.clientX;
        scrollLeft = ribbon.scrollLeft;
        maxDragDist = 0;
        ribbon.style.scrollBehavior = 'auto'; // Disable smooth scroll for direct control
      });

      ribbon.addEventListener('pointerup', (e) => {
        if (!isDown) return;
        isDown = false;
        ribbon.classList.remove('dragging');
        ribbon.style.scrollBehavior = '';
        if (ribbon.hasPointerCapture(e.pointerId)) {
            try{ ribbon.releasePointerCapture(e.pointerId); }catch(_){}
        }
      });

      ribbon.addEventListener('pointermove', (e) => {
        if (!isDown) return;
        
        const x = e.clientX;
        const walk = (x - startX);
        maxDragDist = Math.max(maxDragDist, Math.abs(walk));

        // Only capture and scroll if moved beyond threshold (prevents blocking clicks)
        if (maxDragDist > 5) {
            if (!ribbon.hasPointerCapture(e.pointerId)) {
                ribbon.setPointerCapture(e.pointerId);
                ribbon.classList.add('dragging');
            }
            e.preventDefault();
            ribbon.scrollLeft = scrollLeft - walk;
        }
      });
    }
  } catch (_) { }

  // Ensure UI overlays that shouldn't block the canvas are non-interactive to pointer events
  try{
    document.querySelectorAll('.ui-overlay').forEach(el => el.style.pointerEvents = 'none');
  }catch(_){ }
  

  // TASK 618: the Construction toggle and Recenter moved to the shared app footer (#ui/app-footer.js, mounted by main.js)

  // Clear All button (destructive)
  const clearBtn = document.getElementById('btn-clear');
  if(clearBtn){
    clearBtn.addEventListener('click', ()=>{
      // Clear All always clears the whole document (Destructive, Not Undoable); deleting a selection is the Delete key's job.
      try{
        state.clearDocument();

        // Reset UI mode
        setTool(TOOL_MODES.SELECT);
      }catch(err){
        console.error('[clear] error clearing canvas', err);
      }
    });
  }

  // S7c-2e: Export is a router-owned TAB now (no popup). The dead popup-open machinery (#btn-export, closeExport,
  // outside/Esc handlers) is removed; #btn-export-close is dropped; Cancel + a successful export return to Design
  // via the header tab (wired in main.js). Keep only the Export action.
  const exportDo = document.getElementById('btn-export-do');
  if (exportDo) exportDo.addEventListener('click', () => {
    const filename = document.getElementById('export-filename') ? document.getElementById('export-filename').value.trim() : 'sketch';
    const type = document.getElementById('export-type') ? document.getElementById('export-type').value : 'svg';
    const onlyLines = document.getElementById('export-only-lines') ? document.getElementById('export-only-lines').checked : true;
    const precision = document.getElementById('export-precision') ? parseInt(document.getElementById('export-precision').value, 10) : 6;
    const arcApprox = document.getElementById('export-approx-arcs') ? document.getElementById('export-approx-arcs').checked : false;
    const arcSeg = document.getElementById('export-arc-segments') ? parseInt(document.getElementById('export-arc-segments').value, 10) || 32 : 32;
    const scale = document.getElementById('export-scale') ? parseFloat(document.getElementById('export-scale').value) || 1 : 1;
    const invertY = document.getElementById('export-invert-y') ? !!document.getElementById('export-invert-y').checked : false;
    const dxfVersion = document.getElementById('export-dxf-version') ? document.getElementById('export-dxf-version').value : 'r12';

    const opts = { precision, arcApprox, arcSeg, scale, invertY, dxfVersion };

    try{
      const res = exportToFile(state, filename, type, opts);
      if (res && res.ok) {
        try{ showNotification('Export started', 'success'); }catch(_){ }
        // S7c-2e: the router returns to Design (main.js's #btn-export-do handler) — no popup hide here.
      } else {
        try{ showNotification('Export failed: ' + (res && res.reason ? res.reason : 'unknown'), 'error'); }catch(_){}
      }
    } catch (e) { try{ showNotification('Export error', 'error'); }catch(_){} }
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown',(e)=>{
    // Don't trigger shortcuts if user is typing in an input
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    const shortcuts = {
      'l': TOOL_MODES.LINE,
      'r': TOOL_MODES.RECT,
      'c': TOOL_MODES.CIRCLE,
      's': TOOL_MODES.SELECT,
      'Escape': TOOL_MODES.SELECT
    };
    
    const key = e.key.toLowerCase();
    
    // Escape key: cancel any pending constraint and switch to select
    if(e.key === 'Escape'){
      if(state.pendingConstraint){
        state.pendingConstraint = null;
        setTool(TOOL_MODES.SELECT); // S7c-2d: syncs the ribbon (no #tool-select null-deref)
        return;
      }
      
      // Tool shortcuts
      if(shortcuts[key]){
        const tool = shortcuts[key];
        const el = document.getElementById('tool-'+tool);
        if(el) el.click();
      }
    }
  });

  // S7c-2d: expose the shared ribbon (main.js's render loop calls refresh() so KEYBOARD tool-switches sync) + setTool.
  return { ribbon: toolRibbon, setTool };
}