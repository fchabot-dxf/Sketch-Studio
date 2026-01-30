export function setupUI(state){
  // Remove active class from all buttons initially
  document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
  
  // Track rect sub-mode
  state.rectMode = 'rect-2pt'; // default: 2-point corner rect
  
  function setTool(t){ 
    // Ensure any active undo group is cancelled (do NOT commit) when switching tools
    try{ if(state._undoGroupActive) state.cancelUndoGroup(); }catch(_){ }
    console.log('Setting tool to:', t); // Debug log
    state.currentTool = t; 
    state.active = null; // clear any in-progress action
    if(state.resetPolyline) state.resetPolyline(); // end polyline mode
    
    // Remove active from all buttons
    document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active')); 
    
    // Add active to selected button
    const el = document.getElementById('tool-'+t); 
    if(el) {
      el.classList.add('active');
      console.log('Added active class to:', el.id); // Debug log
    } else {
      console.warn('Button not found for tool:', t); // Debug log
    }
    
    // Update mode text
    const mt = document.getElementById('modeText');
    let modeText = t.toUpperCase();
    if(t === 'rect') {
      const modeNames = { 'rect-2pt': '2PT', 'rect-center': 'CENTER', 'rect-3pt': '3PT' };
      modeText = 'RECT ' + (modeNames[state.rectMode] || '');
    }
    if(mt) mt.innerText = 'MODE: ' + modeText; 
  }
  
  // Attach click handlers to all tool buttons
  ['line','rect','circle','coincident','hv','parallel','perp','collinear','tangent','dim','select'].forEach(t=>{ 
    const el=document.getElementById('tool-'+t); 
    if(el) {
      el.addEventListener('click', (e) => {
        console.log('Tool button clicked:', t); // Debug log
        const constraintTools = ['coincident','hv','parallel','perp','collinear','tangent'];
        if(constraintTools.includes(t)){
          // Always enter pendingConstraint mode and wait for user picks
          try{ state.selectionGetSet('joints').clear(); }catch(_){ if(state.selectedJoints) state.selectedJoints.clear(); }
          try{ state.selectionGetSet('shape').clear(); }catch(_){ if(state.selectedShapes) state.selectedShapes.clear(); }
          state.pendingConstraint = { type: t, firstElement: null };
          state.active = null;
          setTool(t);
          // Update mode text to show pending constraint
          const mt = document.getElementById('modeText');
          let modeText = t === 'collinear' ? (t.toUpperCase() + ' - 1/3 Points') : (t.toUpperCase() + ' - Select 1st Element');
          if(mt) mt.innerText = 'MODE: ' + modeText;
          document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
          el.classList.add('active');
          return;
        }
        // Normal tool selection
        setTool(t);
      }); 
    } else {
      console.warn('Tool button not found:', 'tool-'+t); // Debug log
    }
  });
  
  // Undo button
  const undoBtn = document.getElementById('btn-undo');
  if(undoBtn) {
    undoBtn.disabled = true; // Initially disabled
    undoBtn.addEventListener('click', () => {
      state.undo();
    });
  }
  
  // Rect dropdown handling
  const rectBtn = document.getElementById('tool-rect');
  const rectDropdown = document.getElementById('rect-dropdown');
  let longPressTimer = null;
  let dropdownOpenedByLongPress = false;
  let hoveredDropdownItem = null;
  
  if(rectBtn && rectDropdown) {
    // Long press to show dropdown
    rectBtn.addEventListener('pointerdown', (e) => {
      dropdownOpenedByLongPress = false;
      longPressTimer = setTimeout(() => {
        rectDropdown.classList.add('show');
        dropdownOpenedByLongPress = true;
        longPressTimer = null;
      }, 400); // 400ms for long press
    });
    
    // Track hovered item while dropdown is open
    rectDropdown.querySelectorAll('.tool-dropdown-item').forEach(item => {
      item.addEventListener('pointerenter', () => {
        hoveredDropdownItem = item;
        // Visual feedback
        rectDropdown.querySelectorAll('.tool-dropdown-item').forEach(i => i.classList.remove('hover'));
        item.classList.add('hover');
      });
      item.addEventListener('pointerleave', () => {
        if(hoveredDropdownItem === item) hoveredDropdownItem = null;
        item.classList.remove('hover');
      });
    });
    
    // On pointerup anywhere, if dropdown was opened by long press, select hovered item
    document.addEventListener('pointerup', (e) => {
      if(longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      
      if(dropdownOpenedByLongPress && rectDropdown.classList.contains('show')) {
        if(hoveredDropdownItem) {
          // Select the hovered item
          const mode = hoveredDropdownItem.dataset.mode;
          state.rectMode = mode;
          rectDropdown.querySelectorAll('.tool-dropdown-item').forEach(i => i.classList.remove('active'));
          hoveredDropdownItem.classList.add('active');
          updateRectIcon(mode);
          setTool('rect');
        }
        rectDropdown.classList.remove('show');
        rectDropdown.querySelectorAll('.tool-dropdown-item').forEach(i => i.classList.remove('hover'));
        dropdownOpenedByLongPress = false;
        hoveredDropdownItem = null;
      }
    });
    
    rectBtn.addEventListener('pointerleave', () => {
      if(longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    
    // Function to update rect icon based on mode
    function updateRectIcon(mode) {
      const icon2pt = document.querySelectorAll('.rect-icon-2pt');
      const iconCenter = document.querySelectorAll('.rect-icon-center');
      const icon3pt = document.querySelectorAll('.rect-icon-3pt');
      const rectLabel = document.getElementById('rect-label');
      
      // Hide all
      icon2pt.forEach(el => el.style.display = 'none');
      iconCenter.forEach(el => el.style.display = 'none');
      icon3pt.forEach(el => el.style.display = 'none');
      
      // Show active mode
      if(mode === 'rect-2pt') {
        icon2pt.forEach(el => el.style.display = '');
        if(rectLabel) rectLabel.textContent = 'Rect';
      } else if(mode === 'rect-center') {
        iconCenter.forEach(el => el.style.display = '');
        if(rectLabel) rectLabel.textContent = 'Ctr';
      } else if(mode === 'rect-3pt') {
        icon3pt.forEach(el => el.style.display = '');
        if(rectLabel) rectLabel.textContent = '3Pt';
      }
    }
    
    // Dropdown item selection
    rectDropdown.querySelectorAll('.tool-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = item.dataset.mode;
        state.rectMode = mode;
        // Update active state in dropdown
        rectDropdown.querySelectorAll('.tool-dropdown-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        // Update toolbar icon
        updateRectIcon(mode);
        // Hide dropdown and select rect tool
        rectDropdown.classList.remove('show');
        setTool('rect');
      });
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if(!rectBtn.contains(e.target) && !rectDropdown.contains(e.target)) {
        rectDropdown.classList.remove('show');
      }
    });
  }
  
  // Keyboard shortcuts
  const shortcuts = {
    'l': 'line',
    'r': 'rect',
    'c': 'circle',
    's': 'select',
    'v': 'select',      // V for pointer/select (like Illustrator)
    'o': 'coincident',  // O for cOincident
    'h': 'hv',          // H for horizontal/vertical
    'p': 'parallel',
    't': 'perp',        // T for perpendicular (T-shape)
    'd': 'dim',
  };
  window.addEventListener('keydown', (e) => {
    // Don't trigger if typing in an input
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();
    
    // Escape cancels current action
    if(e.key === 'Escape'){      // If user presses Escape, cancel any active undo group (do not commit)
      try{ if(state._undoGroupActive) state.cancelUndoGroup(); }catch(_){ }      state.active = null;
      state.pendingConstraint = null;
      if(state.resetPolyline) state.resetPolyline();
      
      // Reset mode text if there was a pending constraint
      const mt = document.getElementById('modeText');
      if(mt) mt.innerText = 'MODE: SELECT';
      
      // Reset toolbar buttons
      document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
      document.getElementById('tool-select').classList.add('active');
      return;
    }
    
    // Tool shortcuts
    if(shortcuts[key]){
      e.preventDefault();
      setTool(shortcuts[key]);
      return;
    }
    // Undo with Ctrl+Z
    if((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)){
      e.preventDefault();
      try{ state.undo(); }catch(_){ }
      return;
    }
    // Delete/Backspace to delete selected item (constraint/shape/joint(s))
    if(e.key === 'Delete' || e.key === 'Backspace'){
      const sel = state.getSelected ? state.getSelected() : state.selection;
      if(sel && sel.type === 'constraint'){
        const c = sel.payload;
        const idx = state.constraints.indexOf(c);
        if(idx >= 0){
          try{ state.beginUndoGroup(); }catch(_){ }
          if(c.__selected) c.__selected = false;
          state.constraints.splice(idx, 1);
          try{ state.endUndoGroup(); }catch(_){ }
        }
        state.clearSelection();
        return;
      }

      if(state.selectedConstraints && state.selectedConstraints.size > 0){
        try{ state.beginUndoGroup(); }catch(_){ }
        const delSet = new Set(state.selectedConstraints);
        state.constraints = state.constraints.filter(c => !delSet.has(c));
        for(const c of delSet) if(c && c.__selected) c.__selected = false;
        state.selectedConstraints.clear();
        state.clearSelection();
        try{ state.endUndoGroup(); }catch(_){ }
        return;
      }
      if(state.selectedShapes && state.selectedShapes.size > 0){
        // Bulk delete selected shapes
        try{ state.beginUndoGroup(); }catch(_){ }
        const delSet = new Set(state.selectedShapes);
        state.shapes = state.shapes.filter(s => !delSet.has(s.id));
        state.constraints = state.constraints.filter(c => {
          if(c.shapes && c.shapes.some(id => delSet.has(id))) return false;
          if(c.shape && delSet.has(c.shape)) return false;
          if(c.line && delSet.has(c.line)) return false;
          if(c.circle && delSet.has(c.circle)) return false;
          return true;
        });
        try{ state.endUndoGroup(); }catch(_){ }
        state.clearSelection();
        return;
      }

      if(sel && sel.type === 'shape'){
        const s = sel.payload;
        const shapeIdx = state.shapes.indexOf(s);
        if(shapeIdx !== -1){
          try{ state.beginUndoGroup(); }catch(_){ }
          const deletedShapeId = s.id;
          state.shapes.splice(shapeIdx, 1);
          state.constraints = state.constraints.filter(c => {
            if(c.shapes && c.shapes.includes(deletedShapeId)) return false;
            if(c.shape === deletedShapeId) return false;
            if(c.line === deletedShapeId) return false;
            if(c.circle === deletedShapeId) return false;
            return true;
          });
          try{ state.endUndoGroup(); }catch(_){ }
        }
        state.clearSelection();
        return;
      }
      if(sel && (sel.type === 'joint' || sel.type === 'joints')){
        // Deleting joints is not supported via Delete key to avoid accidental heavy changes
        // Consider leaving as future improvement
        return;
      }
      // Nothing selected: do nothing (prevent accidental clear of whole drawing)
      return;
    }
  }, true); // Use capture phase
  
  // add undo/clear
  document.getElementById('btn-undo')?.addEventListener('click', ()=>{ try{ state.undo(); }catch(_){ } });
  document.getElementById('btn-clear')?.addEventListener('click', ()=>{ state.initStore(); });
  // ensure default
  setTool(state.currentTool || 'select');
}
