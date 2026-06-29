import { dbg } from '#core/debug.js';
import { DEFAULT_VIEW } from '#core/constants.js';
import { TOOL_MODES, RECT_MODES, ARC_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { clearHover } from '#ui/hover-manager.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { exportToFile } from './export-manager.js';

import { deactivateLineTool } from '#ui/input-handlers/line-tool.js';
import { startDimensionFromSelection } from '#ui/input-handlers/dimension-tool.js';
import { deleteSelection } from '#core/delete-manager.js';
import { draw } from '#ui/svg-renderer.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
export function setupUI(state){
  // S7c-2d: the shared tool ribbon (mounted below). setTool syncs its active highlight via refresh().
  let toolRibbon = null;

  // Track rect sub-mode
  state.rectMode = RECT_MODES.TWO_POINT; // default: 2-point corner rect
  
  function setTool(t){ 
  dbg.log('app', 'Setting tool to:', t); // Debug log
  // If we're switching away from the Line tool, run its deactivation cleanup
  try{ if(state.currentTool === TOOL_MODES.LINE && t !== TOOL_MODES.LINE) deactivateLineTool(state); }catch(_){ }
  state.currentTool = t; 
  state.active = null; // clear any in-progress action
    // Clear hover feedback and any rubber-band preview when switching tools
    try { clearHover(state); state.tempMousePos = null; } catch(_) {}
    // Request polyline reset; input handler will clear internal continuation state
    if(typeof state.resetPolyline === 'function') state.resetPolyline();
    state._clearPolylineRequest = true;
    
    // S7c-2d: the shared tool ribbon owns the active highlight now — sync it to state.currentTool. Load-bearing:
    // setTool is called from OUTSIDE the ribbon (the auto-SELECT after clear/escape), and the render loop also
    // calls refresh() so KEYBOARD tool-switches (switchToTool) follow too.
    if (toolRibbon) toolRibbon.refresh();

    // Update mode text
    const mt = document.getElementById('modeText');
    let modeText = t.toUpperCase();
    if(t === TOOL_MODES.RECT) {
      const modeNames = { 
        [RECT_MODES.TWO_POINT]: '2PT', 
        [RECT_MODES.CENTER]: 'CENTER', 
        [RECT_MODES.THREE_POINT]: '3PT' 
      };
      modeText = 'RECT ' + (modeNames[state.rectMode] || '');
    }
    if(mt) mt.innerText = 'MODE: ' + modeText; 
  }
  
  // S7c-2d-pre: the rich tool-activation logic (migrated from the old per-button click handlers, made
  // DOM-button-INDEPENDENT — every .tool-btn/#tool-select/.classList active management is now setTool(), which
  // refreshes the shared ribbon). The shared ribbon's onToolClick routes here, so the CAD pre-selection workflows
  // (pre-selection as 1st element, H/V-immediate, dimension-from-selection) survive the ribbon adoption.
  function handleToolActivate(t){
    const constraintTools = [TOOL_MODES.COINCIDENT,TOOL_MODES.MIDPOINT,TOOL_MODES.HORIZONTAL_VERTICAL,TOOL_MODES.PARALLEL,TOOL_MODES.PERPENDICULAR,TOOL_MODES.COLLINEAR,TOOL_MODES.TANGENT,TOOL_MODES.EQUAL];
    if(constraintTools.includes(t)){
      // 1. Pre-selection: a single selected joint/shape becomes the constraint's first element
      let firstEl = null;
      if(state.selectedJoints.size === 1 && state.selectedShapes.size === 0) firstEl = { type: 'joint', id: [...state.selectedJoints][0] };
      else if(state.selectedShapes.size === 1 && state.selectedJoints.size === 0) firstEl = { type: 'shape', id: [...state.selectedShapes][0] };

      // H/V Immediate Application: a selected line + H/V → apply immediately, return to SELECT
      if(t === TOOL_MODES.HORIZONTAL_VERTICAL && firstEl && firstEl.type === 'shape'){
        const s = state.shapes.find(x => x.id === firstEl.id);
        if(s && s.type === 'line'){
          ConstraintManager.addHorizontalOrVertical(state, s.joints);
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
        setTool(TOOL_MODES.SELECT); // sets modeText SELECT + refreshes the ribbon
        return;
      }

      // Enter the tool, wait for the first element; mode-text hint (overrides setTool's plain modeText)
      state.pendingConstraint = { type: effectiveType, firstElement: firstEl };
      setTool(t);
      const mt = document.getElementById('modeText');
      const hint = t === TOOL_MODES.COLLINEAR ? (t.toUpperCase() + ' - 1/3 Points') : (t.toUpperCase() + (firstEl ? ' - Select 2nd Element' : ' - Select 1st Element'));
      if(mt) mt.innerText = 'MODE: ' + hint;
      return;
    }

    // Non-constraint tools: just switch
    setTool(t);

    // Dimension tool with a preselection starts immediately
    if (t === TOOL_MODES.DIMENSION) {
      try { const svgEl = document.querySelector('svg'); if (svgEl) startDimensionFromSelection(svgEl, state); } catch(_) {}
    }
  }


  // Polygon is currently hidden in the toolbar - no click handler attached

  // Arc: single-mode (Center-Start-End) — no dropdown
  if(!state.arcMode) state.arcMode = ARC_MODES.CENTER_START_END;
  // Arc button behaves like other simple tool buttons — no dropdown setup needed

  


  // ── S7c-2d: mount the shared tool ribbon into the (now-empty) #toolsRibbon container. Tool clicks route to the
  // rich handleToolActivate/setTool via onToolClick (a rect-variant select sets state.rectMode then calls
  // onToolClick(RECT)); the ribbon owns the rect dropdown; Edit (Clear/Undo) come via extraGroups and KEEP their
  // ids so the existing clear/undo handlers below bind them (R-BIND-ORDER: mounted before those run).
  // (S7c-2d-cleanup: the inline button markup + the dead rect-dropdown machinery have been statically removed.)
  try {
    const trEl = document.getElementById('toolsRibbon');
    if (trEl) {
      trEl.innerHTML = '';
      toolRibbon = createToolRibbon({
        state,
        onToolClick: (t) => handleToolActivate(t), // S7c-2d-pre: the rich activation (pre-selection workflows)
        extraGroups: [{ label: 'Edit', buttons: [{ id: 'btn-clear', label: 'Clear All' }, { id: 'btn-undo', label: 'Undo' }] }],
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
  
  // Undo button
  const undoBtn = document.getElementById('btn-undo');
  if(undoBtn){
    undoBtn.addEventListener('click',()=>{
      state.undo();
    });
    undoBtn.disabled = state.history.length === 0;
  }

  // Construction toggle (floating switch)
  const constructToggle = document.getElementById('btn-construct-toggle');
  if (constructToggle) {
    function updateConstructUI() {
      const pressed = !!state.isConstructionMode;
      // Visual classes and title
      if (pressed) {
        constructToggle.style.backgroundColor = '#f97316'; // Dark orange when active
        constructToggle.style.color = 'white';
        constructToggle.setAttribute('aria-pressed', 'true');
        constructToggle.title = 'Construction: ON (K)';
      } else {
        constructToggle.style.backgroundColor = '#fed7aa'; // Light orange when idle
        constructToggle.style.color = '#9a3412'; // Dark orange text
        constructToggle.setAttribute('aria-pressed', 'false');
        constructToggle.title = 'Construction: OFF (K)';
      }
      // Ensure visible label
      try { constructToggle.innerText = 'Construction'; } catch (_){ }
    }

    // Initial UI
    updateConstructUI();

    constructToggle.addEventListener('click', () => {
      // If shapes are selected, toggle their construction state (undoable)
      if (state.selectedShapes && state.selectedShapes.size > 0) {
        try{ state.beginUndoGroup(); }catch(_){ }
        for (const sid of state.selectedShapes) {
          const s = state.shapes.find(x => x.id === sid);
          if (s) s.isConstruction = !s.isConstruction;
        }
        try{ state.saveState(); }catch(_){ }
        try{ state.endUndoGroup(); }catch(_){ }
      } else {
        // Toggle global construction mode for subsequent draws
        state.isConstructionMode = !state.isConstructionMode;
      }

      // Refresh UI to reflect global state
      updateConstructUI();

      dbg.log('ui', '[ui] isConstructionMode set to', state.isConstructionMode);
    });

    // Make toggle keyboard-accessible and add 'k' shortcut
    constructToggle.tabIndex = 0;
    constructToggle.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); constructToggle.click(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key && e.key.toLowerCase() === 'k') {
        constructToggle.click();
      }
    });
  }

  // Recenter view button (canvas overlay)
  const recenterBtn = document.getElementById('btn-recenter-view');
  if (recenterBtn) {
    recenterBtn.addEventListener('click', () => {
      const svg = document.getElementById('svgCanvas');
      if (!svg || !state || !state.view) return;
      
      // Calculate geometry bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let hasGeometry = false;
      
      // Include all joints
      for (const [id, j] of state.joints.entries()) {
        if (!j) continue;
        minX = Math.min(minX, j.x);
        minY = Math.min(minY, j.y);
        maxX = Math.max(maxX, j.x);
        maxY = Math.max(maxY, j.y);
        hasGeometry = true;
      }
      
      // Include circle radii
      for (const s of state.shapes) {
        if (!s) continue;
        if (s.type === 'circle' && s.joints && s.joints[0]) {
          const c = state.joints.get(s.joints[0]);
          const r = (typeof s.radius === 'number') ? s.radius : 0;
          if (c && r > 0) {
            minX = Math.min(minX, c.x - r);
            minY = Math.min(minY, c.y - r);
            maxX = Math.max(maxX, c.x + r);
            maxY = Math.max(maxY, c.y + r);
          }
        }
      }
      
      if (!hasGeometry) {
        // No geometry, use default view
        state.view.x = DEFAULT_VIEW.x;
        state.view.y = DEFAULT_VIEW.y;
        state.view.w = DEFAULT_VIEW.w;
      } else {
        // Center on geometry bounds
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const w = maxX - minX;
        const h = maxY - minY;
        
        // Add 20% padding
        const padding = 1.2;
        state.view.x = cx;
        state.view.y = cy;
        state.view.w = Math.max(10, w * padding); // Minimum 10 units
      }
      
      const rect = svg.getBoundingClientRect();
      if (rect && rect.height > 0) {
        state.view.h = state.view.w / (rect.width / rect.height);
      } else {
        state.view.h = DEFAULT_VIEW.h;
      }
      svg.setAttribute('viewBox', `${state.view.x - state.view.w / 2} ${state.view.y - state.view.h / 2} ${state.view.w} ${state.view.h}`);
    });
  }

  // Clear All button (destructive)
  const clearBtn = document.getElementById('btn-clear');
  if(clearBtn){
    clearBtn.addEventListener('click', ()=>{
      // 1. If selection exists, delete selection (Undoable)
      const hasSelection = (state.selectedShapes && state.selectedShapes.size > 0) || 
                           (state.selectedJoints && state.selectedJoints.size > 0) || 
                           (state.selectedConstraints && state.selectedConstraints.size > 0);
      
      if (hasSelection) {
          deleteSelection(state);
          // Clear selection sets explicitly to remove highlights
          state.selectedShapes.clear();
          state.selectedJoints.clear();
          state.selectedConstraints.clear();

          // Force immediate redraw to reflect deletion
          const svg = document.getElementById('svgCanvas');
          const worldGroup = document.getElementById('world-group');
          if(svg && worldGroup) {
             draw(state.joints, state.shapes, svg, state.active, state.snapTarget, state.constraints, state.selectedJoints, state.selectedConstraints, state.currentTool, state.inference, state.selectedShapes, state.hoveredShape, state.hoveredJoint, state.hoveredConstraint, state.activeSnap, state.tempMousePos, !!state.drag, worldGroup);
          }
          return;
      }

      // 2. Else, Clear All (Destructive, Not Undoable)
      // Proceed to clear all immediately (no confirmation)

      try{
        // Clear model
        if(state && state.joints && typeof state.joints.clear === 'function') state.joints.clear();
        if(state && Array.isArray(state.shapes)) state.shapes.length = 0;
        if(state && Array.isArray(state.constraints)) state.constraints.length = 0;

        // Clear selections and history
        if(state && state.selectedJoints && typeof state.selectedJoints.clear === 'function') state.selectedJoints.clear();
        if(state && state.selectedShapes && typeof state.selectedShapes.clear === 'function') state.selectedShapes.clear();
        if(state && state.selectedConstraints && typeof state.selectedConstraints.clear === 'function') state.selectedConstraints.clear();
        if(state && Array.isArray(state.history)) state.history.splice(0);

        // Re-init engine store (creates origin joint, etc.)
        if(typeof state.initStore === 'function') state.initStore();

        // Reset UI mode and undo button
        setTool(TOOL_MODES.SELECT);
        const mt = document.getElementById('modeText'); if(mt) mt.innerText = 'MODE: SELECT';
        if(undoBtn) undoBtn.disabled = true;
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
        setTool(TOOL_MODES.SELECT); // S7c-2d: sets modeText + syncs the ribbon (no #tool-select null-deref)
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