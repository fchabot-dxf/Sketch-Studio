import { dbg } from '../core/debug.js';
import { DEFAULT_VIEW } from '../core/constants.js';
import { TOOL_MODES, RECT_MODES, ARC_MODES, CONSTRAINT_TYPES } from '../core/constants.js';
import { clearHover } from './hover-manager.js';
import { ConstraintManager } from '../core/constraint-manager.js';
import { exportToFile } from './export-manager.js';

import { deactivateLineTool } from './input-handlers/line-tool.js';
import { startDimensionFromSelection } from './input-handlers/dimension-tool.js';
import { deleteSelection } from '../core/delete-manager.js';
import { draw } from '../svg-renderer.js';
export function setupUI(state){
  // Remove active class from all buttons initially
  document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
  
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
    
    // Remove active from all buttons
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active')); 
    
    // Add active to selected button
    const el = document.getElementById('tool-'+t); 
    if(el) {
      el.classList.add('active');
      dbg.log('app', 'Added active class to:', el.id); // Debug log
    } else {
      dbg.warn('app', 'Button not found for tool:', t); // Debug log
    }
    
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
  
  // Map internal tool constants to HTML IDs where they differ or for explicit clarity
  const toolIdMap = {
    [TOOL_MODES.HORIZONTAL_VERTICAL]: 'tool-hv',
    [TOOL_MODES.PERPENDICULAR]: 'tool-perp',
    [TOOL_MODES.DIMENSION]: 'tool-dim',
    [TOOL_MODES.COINCIDENT]: 'tool-coincident',
    [TOOL_MODES.MIDPOINT]: 'tool-midpoint',
    // Map standard tools for safety, though 'tool-'+mode handles them
    [TOOL_MODES.LINE]: 'tool-line',
    [TOOL_MODES.RECT]: 'tool-rect',
    [TOOL_MODES.CIRCLE]: 'tool-circle',
    [TOOL_MODES.ARC]: 'tool-arc',
    [TOOL_MODES.SELECT]: 'tool-select',
    [TOOL_MODES.PARALLEL]: 'tool-parallel',
    [TOOL_MODES.COLLINEAR]: 'tool-collinear',
    [TOOL_MODES.TANGENT]: 'tool-tangent',
    [TOOL_MODES.EQUAL]: 'tool-equal'
  };

  // Attach click handlers to all tool buttons
  Object.values(TOOL_MODES).forEach(t=>{ 
    const id = toolIdMap[t] || ('tool-' + t);
    const el=document.getElementById(id); 
    if(el) {
      el.addEventListener('click', (e) => {
        dbg.log('app', 'Tool button clicked:', t); // Debug log
        
        // For constraint tools, check if there's a pending selection
        const constraintTools = [TOOL_MODES.COINCIDENT,TOOL_MODES.MIDPOINT,TOOL_MODES.HORIZONTAL_VERTICAL,TOOL_MODES.PARALLEL,TOOL_MODES.PERPENDICULAR,TOOL_MODES.COLLINEAR,TOOL_MODES.TANGENT,TOOL_MODES.EQUAL];
        if(constraintTools.includes(t)){
          
          // 1. Check for existing selection to use as first element
          let firstEl = null;
          if(state.selectedJoints.size === 1 && state.selectedShapes.size === 0) firstEl = { type: 'joint', id: [...state.selectedJoints][0] };
          else if(state.selectedShapes.size === 1 && state.selectedJoints.size === 0) firstEl = { type: 'shape', id: [...state.selectedShapes][0] };

          // H/V Immediate Application: If a line is selected, apply H/V immediately
          if(t === TOOL_MODES.HORIZONTAL_VERTICAL && firstEl && firstEl.type === 'shape'){
              const s = state.shapes.find(x => x.id === firstEl.id);
              if(s && s.type === 'line'){
                  ConstraintManager.addHorizontalOrVertical(state, s.joints);
                  setTool(TOOL_MODES.SELECT);
                  return;
              }
          }

          // For coincident: just switch to the tool, let the sequential click method handle it
          // Clear any selection so user starts fresh
          if(t === TOOL_MODES.COINCIDENT){
            // If we have a valid pre-selection, keep it and enter tool with pending state
            if (!firstEl) {
                state.selectedJoints.clear();
                if(state.selectedConstraints) state.selectedConstraints.clear();
                if(state.selectedShapes) state.selectedShapes.clear();
                setTool(t);
                return;
            }
          }
          
          // Determine effective type for pending constraint
          // Ensure H/V uses 'horizontal' so solver recognizes it if passed directly
          const effectiveType = (t === TOOL_MODES.HORIZONTAL_VERTICAL) ? CONSTRAINT_TYPES.HORIZONTAL : t;

          // For other constraint tools: if we have a pending constraint with the same type, complete it
          if(state.pendingConstraint && state.pendingConstraint.type === effectiveType){
            // We already have a first element selected, so clicking the tool again should cancel
            state.pendingConstraint = null;
            const mt = document.getElementById('modeText');
            if(mt) mt.innerText = 'MODE: SELECT';
            
            // Reset toolbar buttons
            document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
            document.getElementById('tool-select').classList.add('active');
            return;
          }
          
          // Otherwise, switch to the tool and wait for first element selection
          state.pendingConstraint = { type: effectiveType, firstElement: firstEl };
          setTool(t);
          
          // Update mode text to indicate we're waiting for first element
          const mt = document.getElementById('modeText');
          let modeText = t === TOOL_MODES.COLLINEAR ? (t.toUpperCase() + ' - 1/3 Points') : (t.toUpperCase() + (firstEl ? ' - Select 2nd Element' : ' - Select 1st Element'));
          if(mt) mt.innerText = 'MODE: ' + modeText;
          
          // Highlight the first element visually by keeping tool active
          document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
          el.classList.add('active');
          return;
        }
        
        // For all tools: just switch to the tool (rect dropdown handled separately)
        setTool(t);

        // If Dimension tool is activated with preselection, start it immediately
        if (t === TOOL_MODES.DIMENSION) {
          try {
            const svgEl = document.querySelector('svg');
            if (svgEl) startDimensionFromSelection(svgEl, state);
          } catch(_) {}
        }
      });
    } else {
      if (t !== TOOL_MODES.PAN) {
        console.warn('[ui-manager] Button not found for tool:', t, 'Expected ID:', id);
      }
    }
  });

  // Generic dropdown helpers
  function updateToolButtonUI(toolName, modeKey, modes){
    // Update Icon <use> href
    const useEl = document.getElementById(`${toolName}-tool-icon-use`);
    if(useEl) {
        useEl.setAttribute('href', `#icon-tool-${modeKey}`);
    }

    // Update Label
    const label = document.getElementById(`${toolName}-label`);
    const variant = modes[modeKey];
    if(variant && label){
      try{ label.innerText = variant.label; } catch(_) {}
    }

    // Update active state for dropdown items
    try{
      document.querySelectorAll(`#${toolName}-dropdown .tool-dropdown-item`).forEach(item => item.classList.toggle('active', item.dataset.mode === modeKey));
    }catch(_){ }
  }

  function setupToolDropdown(toolName, modes, onModeChange){
    const btn = document.getElementById(`tool-${toolName}`);
    const dropdown = document.getElementById(`${toolName}-dropdown`);
    if(!btn || !dropdown) return;

    // Shared logic to toggle/show dropdown
    const toggleDropdown = (forceShow) => {
      // Close other dropdowns
      document.querySelectorAll('.tool-dropdown-menu.show').forEach(d => { if(d !== dropdown) {
        d.classList.remove('show');
        // clear inline positioning on other menus
        d.style.position = '';
        d.style.left = '';
        d.style.top = '';
        // If previously moved to body, restore it
        if(d.__origParent) {
          try { d.__origParent.insertBefore(d, d.__origNextSibling || null); } catch(_){}
          d.__origParent = null; d.__origNextSibling = null;
        }
      } });

      // Toggle current dropdown and position it fixed so it appears above SVG/canvas
      const willShow = (forceShow === true) || (forceShow !== false && !dropdown.classList.contains('show'));
      if(willShow){
        // Diagnostics
        try{ dbg.debug('ui', '[ui-manager] Opening dropdown for', toolName); }catch(_){ }

        // compute button rect and position menu using fixed coords (avoids overflow/clipping issues)
        const rect = btn.getBoundingClientRect();

        // Move dropdown into body so it's not affected by parent stacking/overflow
        if(!dropdown.__origParent){
          dropdown.__origParent = dropdown.parentNode;
          dropdown.__origNextSibling = dropdown.nextSibling;
          document.body.appendChild(dropdown);
        }

        dropdown.style.position = 'fixed';
        dropdown.style.left = (rect.left) + 'px';
        // add slight offset so menu doesn't overlap the button
        dropdown.style.top = (rect.bottom + 6) + 'px';
        dropdown.style.minWidth = Math.max(rect.width, 160) + 'px';
        dropdown.style.zIndex = '999999';
        dropdown.classList.add('show');
      } else {
        try{ dbg.debug('ui', '[ui-manager] Closing dropdown for', toolName); }catch(_){ }
        dropdown.classList.remove('show');
        dropdown.style.position = '';
        dropdown.style.left = '';
        dropdown.style.top = '';
        dropdown.style.minWidth = '';
        dropdown.style.zIndex = '';
        // Restore to original container if needed
        if(dropdown.__origParent){
          try { dropdown.__origParent.insertBefore(dropdown, dropdown.__origNextSibling || null); }catch(_){ }
          dropdown.__origParent = null; dropdown.__origNextSibling = null;
        }
      }
    };

    // Touch Long Press Logic
    let pressTimer;
    let isTouch = false;

    btn.addEventListener('touchstart', (e) => {
        isTouch = true;
        pressTimer = setTimeout(() => {
            toggleDropdown(true); // Force open on long press
            if (navigator.vibrate) navigator.vibrate(50);
        }, 400);
    }, { passive: true });

    btn.addEventListener('touchend', () => clearTimeout(pressTimer));
    btn.addEventListener('touchmove', () => clearTimeout(pressTimer));

    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      // If touch interaction, do NOT toggle dropdown on click (tap selects tool only)
      if (isTouch) { isTouch = false; return; }
      // Mouse click -> Toggle
      toggleDropdown();
    });

    dropdown.querySelectorAll('.tool-dropdown-item').forEach(item => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const mode = item.dataset.mode;
        onModeChange(mode);
        updateToolButtonUI(toolName, mode, modes);
        dropdown.classList.remove('show');
      });
    });

    // Close on outside click and clear inline positioning
    document.addEventListener('click', ()=>{ dropdown.classList.remove('show'); dropdown.style.position = ''; dropdown.style.left = ''; dropdown.style.top = ''; dropdown.style.minWidth = ''; dropdown.style.zIndex = ''; });
  }

  // Rectangle: setup using unified pattern
  const RECT_MODES_CONFIG = {
    'rect-2pt': { class: '2pt', label: 'Rect' },
    'rect-center': { class: 'center', label: 'Rect C' },
    'rect-3pt': { class: '3pt', label: 'Rect 3P' }
  };
  const RECT_MODES_MAP = {
    'rect-2pt': RECT_MODES.TWO_POINT,
    'rect-center': RECT_MODES.CENTER,
    'rect-3pt': RECT_MODES.THREE_POINT
  };

  setupToolDropdown('rect', RECT_MODES_CONFIG, (modeKey) => {
    state.rectMode = RECT_MODES_MAP[modeKey];
    try{ dbg.debug('ui', '[ui] rect mode selected ->', state.rectMode); } catch(_) {}
    setTool(TOOL_MODES.RECT);
  });

  const rectDefaultKey = Object.keys(RECT_MODES_CONFIG).find(k => RECT_MODES_MAP[k] === state.rectMode) || 'rect-2pt';
  updateToolButtonUI('rect', rectDefaultKey, RECT_MODES_CONFIG);

  // Polygon is currently hidden in the toolbar - no click handler attached

  // Arc: single-mode (Center-Start-End) — no dropdown
  if(!state.arcMode) state.arcMode = ARC_MODES.CENTER_START_END;
  // Arc button behaves like other simple tool buttons — no dropdown setup needed

  


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

  // EXPORT button
  const exportBtn = document.getElementById('btn-export');
  function closeExport() {
    const p = document.getElementById('export-panel');
    if (!p) return;
    p.classList.add('hidden');
    p.setAttribute('aria-hidden', 'true');
    if (p._outsideHandler) { document.removeEventListener('click', p._outsideHandler); p._outsideHandler = null; }
    if (p._escHandler) { document.removeEventListener('keydown', p._escHandler); p._escHandler = null; }
  }
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const panel = document.getElementById('export-panel');
      const settings = document.getElementById('settings-panel');
      if (settings) settings.classList.add('hidden');
      if (!panel) return;
      panel.classList.toggle('hidden');
      panel.setAttribute('aria-hidden', panel.classList.contains('hidden'));
      if (!panel.classList.contains('hidden')) {
        const outsideHandler = (e) => { if (!panel.contains(e.target) && e.target !== exportBtn && !exportBtn.contains(e.target)) closeExport(); };
        const escHandler = (e) => { if (e.key === 'Escape') closeExport(); };
        panel._outsideHandler = outsideHandler;
        panel._escHandler = escHandler;
        setTimeout(()=> document.addEventListener('click', outsideHandler), 0);
        document.addEventListener('keydown', escHandler);
      } else {
        if (panel._outsideHandler) { document.removeEventListener('click', panel._outsideHandler); panel._outsideHandler = null; }
        if (panel._escHandler) { document.removeEventListener('keydown', panel._escHandler); panel._escHandler = null; }
      }
    });
  }

  // Export panel controls
  const exportClose = document.getElementById('btn-export-close');
  const exportCancel = document.getElementById('btn-export-cancel');
  const exportDo = document.getElementById('btn-export-do');
  if (exportClose) exportClose.addEventListener('click', () => { closeExport(); });
  if (exportCancel) exportCancel.addEventListener('click', () => { closeExport(); });
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
        const p=document.getElementById('export-panel'); if(p) p.classList.add('hidden');
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
        const mt = document.getElementById('modeText');
        if(mt) mt.innerText = 'MODE: SELECT';
        
        // Reset toolbar buttons
        document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
        document.getElementById('tool-select').classList.add('active');
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
}