import { screenToWorld, worldToScreen, makeRectFromTwoJoints, makeRectFromCenter, makeRectFrom3Points, getDist, addConstraint } from './1-utils.js';
import { findSnap, hitJointAtScreen, hitLineAtScreen, hitCircleAtScreen, findCoincidentCluster, findInference } from './3-snap.js';

// Show dimension input for editing a constraint value
export function showDimInput(svg, state, constraint){
  const dimInput = document.getElementById('dimInput');
  if(!dimInput || !constraint.joints || constraint.joints.length < 2) return;
  
  const j1 = state.joints.get(constraint.joints[0]);
  const j2 = state.joints.get(constraint.joints[1]);
  if(!j1 || !j2) return;
  
  // Position at the annotation location
  const mx = (j1.x + j2.x) / 2, my = (j1.y + j2.y) / 2;
  const dx = j2.x - j1.x, dy = j2.y - j1.y;
  const len = Math.hypot(dx, dy);
  const offset = constraint.offset || 30;
  
  let annotX = mx, annotY = my - 20;
  if(len > 0.01){
    const nx = -dy / len, ny = dx / len;
    annotX = mx + nx * offset;
    annotY = my + ny * offset;
  }
  
  const screenPos = worldToScreen(svg, { x: annotX, y: annotY });
  dimInput.style.left = (screenPos.x - 40) + 'px';
  dimInput.style.top = (screenPos.y - 15) + 'px';
  dimInput.value = constraint.value.toFixed(1);
  dimInput.classList.remove('hidden');
  dimInput.focus();
  dimInput.select();
  
  // Handle input
  const onKeydown = (e) => {
    if(e.key === 'Enter'){
      const newVal = parseFloat(dimInput.value);
      if(!isNaN(newVal) && newVal > 0){
        constraint.value = newVal;
      }
      dimInput.classList.add('hidden');
      dimInput.removeEventListener('keydown', onKeydown);
      dimInput.removeEventListener('blur', onBlur);
    } else if(e.key === 'Escape'){
      dimInput.classList.add('hidden');
      dimInput.removeEventListener('keydown', onKeydown);
      dimInput.removeEventListener('blur', onBlur);
    }
  };
  const onBlur = () => {
    const newVal = parseFloat(dimInput.value);
    if(!isNaN(newVal) && newVal > 0){
      constraint.value = newVal;
    }
    dimInput.classList.add('hidden');
    dimInput.removeEventListener('keydown', onKeydown);
    dimInput.removeEventListener('blur', onBlur);
  };
  
  dimInput.addEventListener('keydown', onKeydown);
  dimInput.addEventListener('blur', onBlur);
}

export function setupInput(svg, state){
  // Track continuation point for sequential clicking (all drawing tools)
  let continueFrom = null;
  let polylineOrigin = null; // Track the very first point of a polyline sequence
  let isDragging = false;
  let dragStartScreen = null; // Track where mouse went down
  const DRAG_THRESHOLD = 2; // pixels to consider it a drag vs click - reduced for touch responsiveness
  let justCreatedActive = false; // Track if state.active was just created in pointerdown

  // Helper: find an existing joint close to the given point (returns joint id or null)
  function findNearbyJoint(jointsMap, pt, excludeId, eps = 0.01){
    if(!pt) return null;
    for(const [id, j] of jointsMap.entries()){
      if(id === excludeId) continue;
      const dx = j.x - pt.x, dy = j.y - pt.y;
      if(Math.hypot(dx, dy) < eps) return id;
    }
    return null;
  }
  
  // Track last clicked dimension for double-click detection
  let lastDimClick = { constraint: null, time: 0 };
  const DOUBLE_CLICK_THRESHOLD = 300; // milliseconds
  
  svg.addEventListener('pointermove',(e)=>{
    state.lastMouse = { x: e.clientX, y: e.clientY };
    const w = screenToWorld(svg, e.clientX, e.clientY);
    // Exclude dragged joints from snap, and disable line snap when dragging
    const excludeIds = state.drag ? state.drag.jointIds : (state.active ? [state.active.start] : (continueFrom ? [continueFrom] : []));
    const isDraggingPoint = state.drag && (state.drag.type === 'joint' || state.drag.type === 'cluster');
    // Use tighter tolerance for inference snaps during line drawing
    const useInferenceTolerance = state.active && (state.active.mode === 'line');
    
    // For constraint tools that only work on lines (hv, parallel, perp, tangent), skip joint snapping
    // Collinear works on joints, so it should use normal snapping
    const lineOnlyTools = ['hv', 'parallel', 'perp', 'tangent'];
    const skipJointSnap = lineOnlyTools.includes(state.currentTool);
    
    if(skipJointSnap){
      // Only detect line snaps for these tools
      state.snapTarget = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
      if(state.snapTarget){
        state.snapTarget.type = 'line'; // Ensure it has the type property
      }
    } else {
      state.snapTarget = findSnap(state.joints, state.shapes, svg, state.lastMouse, excludeIds, isDraggingPoint, useInferenceTolerance);
    }
    
    // Track hover for selection feedback (when in select mode and not dragging)
    if(!state.drag && state.currentTool === 'select'){
      // Check for hovering over constraint glyphs FIRST (priority over lines/joints)
      // Only check if pointer is over the SVG canvas to avoid interfering with UI
      const targetElem = e.target;
      const isOverCanvas = targetElem && (targetElem === svg || svg.contains(targetElem));
      
      if(isOverCanvas){
        const glyphElem = document.elementFromPoint(e.clientX, e.clientY);
        const glyphGroup = glyphElem?.closest('.constraint-glyph');
        if(glyphGroup){
          const ctype = glyphGroup.dataset.ctype;
          if(ctype === 'coincident'){
            const cj0 = glyphGroup.dataset.cj0, cj1 = glyphGroup.dataset.cj1;
            state.hoveredConstraint = state.constraints.find(c => 
              c.type === 'coincident' && c.joints && c.joints[0] === cj0 && c.joints[1] === cj1
            );
          } else if(ctype === 'horizontal'){
            const cj0 = glyphGroup.dataset.cj0, cj1 = glyphGroup.dataset.cj1;
            state.hoveredConstraint = state.constraints.find(c => 
              c.type === 'horizontal' && c.joints && c.joints[0] === cj0 && c.joints[1] === cj1
            );
          } else if(ctype === 'vertical'){
            const cj0 = glyphGroup.dataset.cj0, cj1 = glyphGroup.dataset.cj1;
            state.hoveredConstraint = state.constraints.find(c => 
              c.type === 'vertical' && c.joints && c.joints[0] === cj0 && c.joints[1] === cj1
            );
          } else if(ctype === 'parallel'){
            const cs0 = glyphGroup.dataset.cs0, cs1 = glyphGroup.dataset.cs1;
            state.hoveredConstraint = state.constraints.find(c => 
              c.type === 'parallel' && c.shapes && c.shapes[0] === cs0 && c.shapes[1] === cs1
            );
          } else if(ctype === 'perpendicular'){
            const cs0 = glyphGroup.dataset.cs0, cs1 = glyphGroup.dataset.cs1;
            state.hoveredConstraint = state.constraints.find(c => 
              c.type === 'perpendicular' && c.shapes && c.shapes[0] === cs0 && c.shapes[1] === cs1
            );
          } else if(ctype === 'pointOnLine'){
            const cjoint = glyphGroup.dataset.cjoint, cshape = glyphGroup.dataset.cshape;
            state.hoveredConstraint = state.constraints.find(c => 
              c.type === 'pointOnLine' && c.joint === cjoint && c.shape === cshape
            );
          } else if(ctype === 'collinear'){
            const cjoints = glyphGroup.dataset.cjoints?.split(',') || [];
            state.hoveredConstraint = state.constraints.find(c => 
              c.type === 'collinear' && c.joints && c.joints.length === cjoints.length &&
              c.joints.every((j, i) => j === cjoints[i])
            );
          } else if(ctype === 'tangent'){
            const cline = glyphGroup.dataset.cline, ccircle = glyphGroup.dataset.ccircle;
            state.hoveredConstraint = state.constraints.find(c => 
              c.type === 'tangent' && c.line === cline && c.circle === ccircle
            );
          }
          // When hovering over glyph, suppress line/joint hover
          state.hoveredJoint = null;
          state.hoveredShape = null;
        } else {
          state.hoveredConstraint = null;
          
          // Check for hovering over joints
          const hoveredJoint = hitJointAtScreen(state.joints, svg, e.clientX, e.clientY, 20);
          state.hoveredJoint = hoveredJoint || null;
          
          // Check for hovering over shapes
          const hoveredLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
          state.hoveredShape = hoveredLine ? hoveredLine.shape : null;
        }
      } else {
        // Not over canvas - clear all hover states
        state.hoveredConstraint = null;
        state.hoveredJoint = null;
        state.hoveredShape = null;
      }
    } else {
      state.hoveredJoint = null;
      state.hoveredShape = null;
      state.hoveredConstraint = null;
    }
    
    // Track if we've moved enough to be considered dragging (for drawing tools)
    if(dragStartScreen && state.active){
      const dist = Math.hypot(e.clientX - dragStartScreen.x, e.clientY - dragStartScreen.y);
      if(dist > DRAG_THRESHOLD) isDragging = true;
    }
    
    if(state.drag){ 
      isDragging = true;
      if(state.drag.type==='joint' || state.drag.type==='cluster'){ 
        const wpt = screenToWorld(svg, e.clientX, e.clientY); 
        // Apply snap if available
        const targetPt = state.snapTarget ? state.snapTarget.pt : wpt;
        const dx = targetPt.x - state.drag.startWorld.x;
        const dy = targetPt.y - state.drag.startWorld.y;
        for(const id of state.drag.jointIds){
          const init = state.drag.initial.get(id);
          const j = state.joints.get(id);
          if(j && init && !j.fixed){ j.x = init.x + dx; j.y = init.y + dy; }
        }
      } else if(state.drag.type==='line'){
        const wpt = screenToWorld(svg, e.clientX, e.clientY);
        const dx = wpt.x - state.drag.startWorld.x;
        const dy = wpt.y - state.drag.startWorld.y;
        for(const id of state.drag.jointIds){
          const init = state.drag.initial.get(id);
          const j = state.joints.get(id);
          if(j && init && !j.fixed){ j.x = init.x + dx; j.y = init.y + dy; }
        }
      } else if(state.drag.type==='pan'){
        const rect = svg.getBoundingClientRect();
        const dx = e.clientX - state.drag.start.x;
        const dy = e.clientY - state.drag.start.y;
        const scaleX = state.view.w / rect.width;
        const scaleY = state.view.h / rect.height;
        state.view.x = state.drag.initialPan.x - dx * scaleX;
        state.view.y = state.drag.initialPan.y - dy * scaleY;
        svg.setAttribute('viewBox', `${state.view.x-state.view.w/2} ${state.view.y-state.view.h/2} ${state.view.w} ${state.view.h}`);
      } else if(state.drag.type==='dim'){
        // Dragging dimension label - update offset perpendicular to the line
        const constraint = state.drag.constraint;
        if(constraint && constraint.joints && constraint.joints.length >= 2){
          const j1 = state.joints.get(constraint.joints[0]);
          const j2 = state.joints.get(constraint.joints[1]);
          if(j1 && j2){
            const w = screenToWorld(svg, e.clientX, e.clientY);
            const mx = (j1.x + j2.x) / 2, my = (j1.y + j2.y) / 2;
            const dx = j2.x - j1.x, dy = j2.y - j1.y;
            const len = Math.hypot(dx, dy);
            if(len > 0.01){
              const nx = -dy / len, ny = dx / len;
              const toMouse = { x: w.x - mx, y: w.y - my };
              constraint.offset = toMouse.x * nx + toMouse.y * ny;
            }
          }
        }
      }
    }
    // Show preview for drawing tools
    if(state.active && (state.active.mode==='line' || state.active.mode==='rect' || state.active.mode==='circle')){ 
      let previewType = state.active.mode;
      // Use rect sub-mode for preview type
      if(state.active.mode === 'rect'){
        const rectMode = state.rectMode || 'rect-2pt';
        if(rectMode === 'rect-center') previewType = 'rect-center';
        else if(rectMode === 'rect-3pt') previewType = 'rect-3pt';
      }
      let previewPt = state.snapTarget ? state.snapTarget.pt : w;
      
      // Apply inference for line drawing (horizontal, vertical, perpendicular)
      state.inference = null;
      if(state.active.mode === 'line' && state.active.start){
        const startJoint = state.joints.get(state.active.start);
        if(startJoint){
          const inference = findInference(startJoint, previewPt, state.shapes, state.joints, state.snapTarget);
          if(inference){
            state.inference = inference;
            previewPt = inference.pt; // Snap to inferred position
          }
        }
      }
      
      state.active.preview = { type: previewType, pt: previewPt }; 
    }
    // Show preview for continuation mode
    if(continueFrom && (state.currentTool === 'line' || state.currentTool === 'rect' || state.currentTool === 'circle') && !state.active){
      const previewPt = state.snapTarget ? state.snapTarget.pt : w;
      
      // Apply inference for continuation
      let finalPt = previewPt;
      state.inference = null;
      if(state.currentTool === 'line'){
        const startJoint = state.joints.get(continueFrom);
        if(startJoint){
          const inference = findInference(startJoint, previewPt, state.shapes, state.joints, state.snapTarget);
          if(inference){
            state.inference = inference;
            finalPt = inference.pt;
          }
        }
      }
      
      state.active = { mode: state.currentTool, start: continueFrom, preview: { type: state.currentTool, pt: finalPt } };
    }
    
    // Dimension tool: update offset while dragging
    if(state.active && (state.active.mode === 'dim-line' || state.active.mode === 'dim-circle' || (state.active.mode === 'dim-p2p' && state.active.j2))){
      if(state.active.mode === 'dim-circle'){
        // For circle: update radial offset
        const center = state.joints.get(state.active.joints[0]);
        if(center){
          const distFromCenter = Math.hypot(w.x - center.x, w.y - center.y);
          state.active.offset = distFromCenter;
        }
      } else {
        // For line: update perpendicular offset
        const j1 = state.joints.get(state.active.joints[0]);
        const j2 = state.joints.get(state.active.joints[1]);
        if(j1 && j2){
          // Calculate perpendicular distance from mouse to line
          const mx = (j1.x + j2.x) / 2, my = (j1.y + j2.y) / 2;
          const dx = j2.x - j1.x, dy = j2.y - j1.y;
          const len = Math.hypot(dx, dy);
          if(len > 0.01){
            // Normal vector (perpendicular)
            const nx = -dy / len, ny = dx / len;
            // Vector from midpoint to mouse
            const toMouse = { x: w.x - mx, y: w.y - my };
            // Project onto normal to get signed offset
            state.active.offset = toMouse.x * nx + toMouse.y * ny;
          }
        }
      }
    }
  });

  svg.addEventListener('pointerdown',(e)=>{
    // Allow middle mouse button to pan regardless of current tool or state
    if(e.button === 1){ // Middle mouse button
      svg.setPointerCapture(e.pointerId);
      state.drag = { 
        type: 'pan', 
        start: { x: e.clientX, y: e.clientY }, 
        initialPan: { x: state.view.x, y: state.view.y }, 
        pointerId: e.pointerId 
      };
      return;
    }
    
    // FIRST: Check if clicking on a dimension label - only in select or dim tool
    if(state.currentTool === 'select' || state.currentTool === 'dim'){
      // Check if clicked element or any parent has dim-label class
      let dimLabel = null;
      let target = e.target;
      for(let i = 0; i < 10 && target; i++){
        if(target.classList && target.classList.contains('dim-label')){
          dimLabel = target;
          break;
        }
        target = target.parentElement;
      }
      
      if(dimLabel){
        const cIdx = parseInt(dimLabel.getAttribute('data-constraint-idx'));
        const constraint = state.constraints[cIdx];
        if(constraint && constraint.type === 'distance'){
          e.stopPropagation();
          e.preventDefault();
          
          // Check for double-click
          const now = Date.now();
          const isDoubleClick = lastDimClick.constraint === constraint && (now - lastDimClick.time) < DOUBLE_CLICK_THRESHOLD;
          
          if(isDoubleClick){
            // Double-click: edit the dimension
            showDimInput(svg, state, constraint);
            lastDimClick = { constraint: null, time: 0 };
          } else {
            // Single click: select the dimension and allow dragging
            state.selectedConstraint = constraint;
            lastDimClick = { constraint, time: now };
            
            // Start dragging if user wants to move the label
            svg.setPointerCapture(e.pointerId);
            state.drag = {
              type: 'dim',
              constraint: constraint,
              pointerId: e.pointerId,
              dragStartScreen: { x: e.clientX, y: e.clientY }
            };
          }
          return;
        }
      }
    }
    
    const w = screenToWorld(svg, e.clientX, e.clientY);
    state.lastMouse = { x: e.clientX, y: e.clientY };
    isDragging = false;
    dragStartScreen = { x: e.clientX, y: e.clientY };
    const excludeIds = continueFrom ? [continueFrom] : [];
    const hitSnap = findSnap(state.joints, state.shapes, svg, state.lastMouse, excludeIds);
    const hitJoint = hitJointAtScreen(state.joints, svg, e.clientX, e.clientY, 30);
    
    // Check if clicking on a constraint glyph FIRST (priority over joints)
    const target = e.target.closest('.constraint-glyph');
    if(target && state.currentTool === 'select'){
      const ctype = target.dataset.ctype;
      let constraint = null;
      // Match common glyph types to constraints
      if(ctype === 'coincident' || ctype === 'horizontal' || ctype === 'vertical'){
        const cj0 = target.dataset.cj0, cj1 = target.dataset.cj1;
        constraint = state.constraints.find(c => c.type === ctype && c.joints && ((c.joints[0] === cj0 && c.joints[1] === cj1) || (c.joints[0] === cj1 && c.joints[1] === cj0)));
      } else if(ctype === 'parallel' || ctype === 'perpendicular'){
        const cs0 = target.dataset.cs0, cs1 = target.dataset.cs1;
        constraint = state.constraints.find(c => c.type === ctype && c.shapes && ((c.shapes[0] === cs0 && c.shapes[1] === cs1) || (c.shapes[0] === cs1 && c.shapes[1] === cs0)));
      } else if(ctype === 'pointOnLine'){
        const cjoint = target.dataset.cjoint, cshape = target.dataset.cshape;
        constraint = state.constraints.find(c => c.type === 'pointOnLine' && c.joint === cjoint && c.shape === cshape);
      } else if(ctype === 'collinear'){
        const cjoints = target.dataset.cjoints ? target.dataset.cjoints.split(',') : [];
        constraint = state.constraints.find(c => c.type === 'collinear' && c.joints && c.joints.length === cjoints.length && c.joints.every((j,i) => j === cjoints[i]));
      } else if(ctype === 'tangent'){
        const cline = target.dataset.cline, ccircle = target.dataset.ccircle;
        constraint = state.constraints.find(c => c.type === 'tangent' && c.line === cline && c.circle === ccircle);
      }

      if(constraint){
        // Select constraint glyph for visual feedback (do NOT delete immediately)
        state.selectItem('constraint', constraint);
        // Ensure we are in select mode visually
        state.currentTool = 'select';
        document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
        const selBtn = document.getElementById('tool-select');
        if(selBtn) selBtn.classList.add('active');
        // Re-render to show selection feedback (safe-call if render is available)
        try{ render(); }catch(_){ }
        return;
      }
    }
    
    if(state.currentTool==='line' || state.currentTool==='rect' || state.currentTool==='circle'){
      // If already active (in continuation mode), complete the shape
      if(state.active && state.active.start){
        // Already have a start point from previous click, so this click completes the segment
        // Process the completion in pointerup instead - do nothing here
        return;
      }
      // If continuing from previous shape, use that endpoint as start
      if(continueFrom){
        state.active = { mode: state.currentTool, start: continueFrom, startPt: state.joints.get(continueFrom), preview: null, polylineOrigin: polylineOrigin };
        continueFrom = null; // Clear it so we don't keep reusing
        justCreatedActive = true; // Mark that we just created active in this click
      } else {
        // Snap to existing joint or create new one
        const startPt = hitSnap ? hitSnap.pt : w;
        const startId = hitSnap && hitSnap.type==='joint' ? hitSnap.id : state.genJ(); 
        if(!state.joints.has(startId)) state.joints.set(startId, {x: startPt.x, y: startPt.y, fixed:false}); 
        state.active = { mode: state.currentTool, start: startId, startPt: startPt, preview: null, polylineOrigin: startId };
        polylineOrigin = startId; // Remember the origin of this polyline
        justCreatedActive = true; // Mark that we just created active
      }
    } else if(state.currentTool==='select'){
      continueFrom = null;
      // Clear previous selections when clicking elsewhere
      state.clearSelection();
      
      if(hitJoint){ 
        svg.setPointerCapture(e.pointerId);
        // Find all joints in coincident cluster first
        const cluster = findCoincidentCluster(hitJoint.id, state.constraints);
        const jointIds = Array.from(cluster);
        // Select this joint cluster (add to selection with Shift, replace otherwise)
        if(!e.shiftKey) state.clearSelection();
        state.selectItem('joints', jointIds);
        const initial = new Map();
        for(const id of jointIds){
          const j = state.joints.get(id);
          if(j) initial.set(id, { x: j.x, y: j.y });
        }
        // Only allow dragging if it's a single joint with no coincident constraints
        // Or if it's part of a cluster, drag the entire cluster together
        state.drag = { 
          type: cluster.size > 1 ? 'cluster' : 'joint', 
          id: hitJoint.id, 
          jointIds,
          initial, 
          startWorld: { x: w.x, y: w.y },
          pointerId: e.pointerId 
        };
        state.active = null;
        // If user selected a joint, auto-select any coincident constraint involving it
        // This ensures the glyph appears immediately when clicking the joint
        const coincidentConstraint = state.constraints.find(c => c.type === 'coincident' && c.joints && c.joints.includes(hitJoint.id));
        if(coincidentConstraint){
          console.log('[select] auto-select coincident constraint for joint', hitJoint.id, coincidentConstraint);
          state.selectedConstraint = coincidentConstraint;
          try{ render(); }catch(_){ /* render may be provided by outer scope; ignore if not */ }
        } 
      } else {
        // Check if clicking on a line/shape
        const hitLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
        if(hitLine){
          // Select and prepare to drag the line
          state.selectItem('shape', hitLine.shape);
          state.active = null;
          svg.setPointerCapture(e.pointerId);
          // Start dragging the line by tracking both its joints
          const initial = new Map();
          const jointIds = hitLine.shape.joints;
          for(const id of jointIds){
            const j = state.joints.get(id);
            if(j) initial.set(id, { x: j.x, y: j.y });
          }
          state.drag = {
            type: 'line',
            id: hitLine.shape.id,
            jointIds: jointIds,
            initial: initial,
            startWorld: { x: w.x, y: w.y },
            pointerId: e.pointerId
          };
        } else {
          svg.setPointerCapture(e.pointerId); 
          state.drag = { type:'pan', start: { x: e.clientX, y: e.clientY }, initialPan: { x: state.view.x, y: state.view.y }, pointerId: e.pointerId }; 
        }
      }
    } else if(state.pendingConstraint){
      // Handle pending constraint - second element selection
      continueFrom = null;
      const constraintType = state.pendingConstraint.type;
      const firstElement = state.pendingConstraint.firstElement;
      
      // Determine what type of element we need for the second click
      const lineOnlyTools = ['hv', 'parallel', 'perp', 'tangent'];
      const jointOnlyTools = ['coincident', 'collinear'];
      
      state.saveState(); // Save state BEFORE making changes
      
      if(constraintType === 'parallel' || constraintType === 'perp'){
        // These tools work on lines
        const hitLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
        if(hitLine && hitLine.shape.type === 'line' && hitLine.shape.id !== firstElement.id){
          addConstraint(state, constraintType === 'parallel' ? 'parallel' : 'perpendicular', {
            shapes: [firstElement.id, hitLine.shape.id]
          });
          state.pendingConstraint = null;
          // Reset to select mode
          document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
          document.getElementById('tool-select').classList.add('active');
          const mt = document.getElementById('modeText');
          if(mt) mt.innerText = 'MODE: SELECT';
        }
      } else if(constraintType === 'coincident'){
        // Coincident works on joints OR joint+line (pointOnLine)
        const hitLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
        
        if(firstElement.type === 'joint'){
          // First element was joint
          if(hitSnap && hitSnap.type === 'joint' && hitSnap.id !== firstElement.id){
            // Joint to joint = coincident
            console.log('[UI] Attempting to add coincident constraint between joints', firstElement.id, hitSnap.id);
            addConstraint(state, 'coincident', { joints: [firstElement.id, hitSnap.id] });
            state.pendingConstraint = null;
            state.currentTool = 'select';
            document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
            document.getElementById('tool-select').classList.add('active');
            const mt = document.getElementById('modeText');
            if(mt) mt.innerText = 'MODE: SELECT';
            render();
          } else if(hitLine && hitLine.shape.type === 'line'){
            // Joint to line = pointOnLine (check joint not part of line)
            if(!hitLine.shape.joints.includes(firstElement.id)){
              addConstraint(state, 'pointOnLine', { joint: firstElement.id, shape: hitLine.shape.id });
              state.pendingConstraint = null;
              state.currentTool = 'select';
              document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
              document.getElementById('tool-select').classList.add('active');
              const mt = document.getElementById('modeText');
              if(mt) mt.innerText = 'MODE: SELECT';
              render();
            }
          }
        } else if(firstElement.type === 'shape'){
          // First element was line - second must be joint
          if(hitSnap && hitSnap.type === 'joint'){
            const lineShape = state.shapes.find(s => s.id === firstElement.id);
            if(lineShape && !lineShape.joints.includes(hitSnap.id)){
              addConstraint(state, 'pointOnLine', { joint: hitSnap.id, shape: firstElement.id });
              state.pendingConstraint = null;
              state.currentTool = 'select';
              document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
              document.getElementById('tool-select').classList.add('active');
              const mt = document.getElementById('modeText');
              if(mt) mt.innerText = 'MODE: SELECT';
              render();
            }
          }
        }
      } else if(constraintType === 'hv'){
        // H/V works on lines/joints
        const hitLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
        if(hitLine && hitLine.shape.type === 'line'){
          const j1 = state.joints.get(hitLine.shape.joints[0]);
          const j2 = state.joints.get(hitLine.shape.joints[1]);
          if(j1 && j2){
            const dx = j2.x - j1.x;
            const dy = j2.y - j1.y;
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const absAngle = Math.abs(angle);
            const isCloserToHorizontal = (absAngle < 45) || (absAngle > 135);
            
            addConstraint(state, isCloserToHorizontal ? 'horizontal' : 'vertical', {
              joints: hitLine.shape.joints.slice()
            });
            state.pendingConstraint = null;
            // Reset to select mode
            document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
            document.getElementById('tool-select').classList.add('active');
            const mt = document.getElementById('modeText');
            if(mt) mt.innerText = 'MODE: SELECT';
          }
        }
      } else if(constraintType === 'collinear'){
        // Collinear works on joints or lines
        if(hitSnap && hitSnap.type === 'joint'){
          // Initialize joints array if needed
          if(!state.pendingConstraint.joints){
            state.pendingConstraint.joints = [firstElement.id];
          }
          
          // Add new joint if not already present
          if(!state.pendingConstraint.joints.includes(hitSnap.id)){
            state.pendingConstraint.joints.push(hitSnap.id);
          }
          
          if(state.pendingConstraint.joints.length >= 3){
            // Can apply collinear now
            addConstraint(state, 'collinear', {
              joints: state.pendingConstraint.joints.slice()
            });
            state.pendingConstraint = null;
            // Reset to select mode
            document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
            document.getElementById('tool-select').classList.add('active');
            const mt = document.getElementById('modeText');
            if(mt) mt.innerText = 'MODE: SELECT';
          } else {
            // Still collecting joints - show how many we have
            const mt = document.getElementById('modeText');
            if(mt) mt.innerText = 'MODE: COLLINEAR - ' + state.pendingConstraint.joints.length + '/3 Points';
          }
        }
      } else if(constraintType === 'tangent'){
        // Tangent works on line + circle pairs
        const hitLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
        const hitCircle = hitLine && hitLine.shape.type === 'circle' ? hitLine.shape : null;
        const hitLineShape = hitLine && hitLine.shape.type === 'line' ? hitLine.shape : null;
        
        const firstIsLine = firstElement.type === 'shape' && state.shapes.find(s => s.id === firstElement.id)?.type === 'line';
        const firstIsCircle = firstElement.type === 'shape' && state.shapes.find(s => s.id === firstElement.id)?.type === 'circle';
        
        if((firstIsLine && hitCircle) || (firstIsCircle && hitLineShape)){
          const lineId = firstIsLine ? firstElement.id : hitLineShape.id;
          const circleId = firstIsCircle ? firstElement.id : hitCircle.id;
          
          addConstraint(state, 'tangent', {
            line: lineId,
            circle: circleId
          });
          state.pendingConstraint = null;
          // Reset to select mode
          document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
          document.getElementById('tool-select').classList.add('active');
          const mt = document.getElementById('modeText');
          if(mt) mt.innerText = 'MODE: SELECT';
        }
      }
    } else if(state.currentTool==='coincident'){
      continueFrom = null;
      // Get fresh snap and line detection for coincident tool
      const coincidentSnap = findSnap(state.joints, state.shapes, svg, state.lastMouse, []);
      const coincidentLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
      
      if(!state.active){ 
        // First click - select joint or line (joint has priority)
        if(coincidentSnap && coincidentSnap.type==='joint'){ 
          state.active = { mode:'coincident', j1: coincidentSnap.id, firstType: 'joint' }; 
          const mt = document.getElementById('modeText');
          if(mt) mt.innerText = 'MODE: COINCIDENT - Click Joint or Line';
        } else if(coincidentLine && coincidentLine.shape.type === 'line'){
          state.active = { mode:'coincident', line1: coincidentLine.shape.id, firstType: 'line' };
          const mt = document.getElementById('modeText');
          if(mt) mt.innerText = 'MODE: COINCIDENT - Click Joint';
        }
      } else { 
        // Second click
        if(state.active.firstType === 'joint'){
          // First was joint - second can be joint (coincident) or line (pointOnLine)
          if(coincidentSnap && coincidentSnap.type==='joint' && coincidentSnap.id !== state.active.j1){ 
            state.saveState();
            addConstraint(state, 'coincident', { joints: [state.active.j1, coincidentSnap.id] }); 
            state.active = null;
            const mt = document.getElementById('modeText');
            if(mt) mt.innerText = 'MODE: COINCIDENT';
            render();
          } else if(coincidentLine && coincidentLine.shape.type === 'line'){
            // Check joint is not part of the line
            if(!coincidentLine.shape.joints.includes(state.active.j1)){
              state.saveState();
              addConstraint(state, 'pointOnLine', { joint: state.active.j1, shape: coincidentLine.shape.id }); 
              state.active = null;
              const mt = document.getElementById('modeText');
              if(mt) mt.innerText = 'MODE: COINCIDENT';
              render();
            }
          }
        } else if(state.active.firstType === 'line'){
          // First was line - second must be joint (pointOnLine)
          if(coincidentSnap && coincidentSnap.type==='joint'){
            const lineShape = state.shapes.find(s => s.id === state.active.line1);
            // Check joint is not part of the line
            if(lineShape && !lineShape.joints.includes(coincidentSnap.id)){
              state.saveState();
              addConstraint(state, 'pointOnLine', { joint: coincidentSnap.id, shape: state.active.line1 }); 
              state.active = null;
              const mt = document.getElementById('modeText');
              if(mt) mt.innerText = 'MODE: COINCIDENT';
              render();
            }
          }
        }
      }
    } else if(state.currentTool==='hv'){
      continueFrom = null;
      const hitLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
      
      if(hitLine && hitLine.shape.type === 'line'){
        // Get line joints
        const j1 = state.joints.get(hitLine.shape.joints[0]);
        const j2 = state.joints.get(hitLine.shape.joints[1]);
        
        if(j1 && j2){
          // Check if line already has horizontal or vertical constraint
          const lineJoints = hitLine.shape.joints;
          const hasHVConstraint = state.constraints.some(c => 
            (c.type === 'horizontal' || c.type === 'vertical') &&
            c.joints && 
            ((c.joints[0] === lineJoints[0] && c.joints[1] === lineJoints[1]) ||
             (c.joints[0] === lineJoints[1] && c.joints[1] === lineJoints[0]))
          );
          
          if(hasHVConstraint){
            // Already has HV constraint, do nothing
            return;
          }
          
          // Calculate line angle
          const dx = j2.x - j1.x;
          const dy = j2.y - j1.y;
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          const absAngle = Math.abs(angle);
          
          // 45° threshold: closer to horizontal (0°/180°) or vertical (90°)
          const isCloserToHorizontal = (absAngle < 45) || (absAngle > 135);
          
          state.saveState(); // Save state BEFORE making changes
          if(isCloserToHorizontal){
            // Apply horizontal constraint
            addConstraint(state, 'horizontal', { joints: hitLine.shape.joints.slice() });
          } else {
            // Apply vertical constraint
            addConstraint(state, 'vertical', { joints: hitLine.shape.joints.slice() });
          }
        }
      }
    } else if(state.currentTool==='parallel'){
      continueFrom = null;
      const hitLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
      
      if(!state.active){
        // First click: select first line
        if(hitLine && hitLine.shape.type === 'line'){
          state.active = { mode: 'parallel', shape1: hitLine.shape.id };
        }
      } else {
        // Second click: select second line
        if(hitLine && hitLine.shape.type === 'line' && hitLine.shape.id !== state.active.shape1){
          state.saveState(); // Save state BEFORE making changes
          addConstraint(state, 'parallel', { shapes: [state.active.shape1, hitLine.shape.id] });
          state.active = null;
        }
      }
    } else if(state.currentTool==='perp'){
      continueFrom = null;
      const hitLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
      
      if(!state.active){
        // First click: select first line
        if(hitLine && hitLine.shape.type === 'line'){
          state.active = { mode: 'perp', shape1: hitLine.shape.id };
        }
      } else {
        // Second click: select second line
        if(hitLine && hitLine.shape.type === 'line' && hitLine.shape.id !== state.active.shape1){
          state.saveState(); // Save state BEFORE making changes
          addConstraint(state, 'perpendicular', { shapes: [state.active.shape1, hitLine.shape.id] });
          state.active = null;
        }
      }
    } else if(state.currentTool==='collinear'){
      continueFrom = null;
      // Collinear: select 3 or more joints to make them lie on same line
      // Can click joints directly OR click lines to add all their joints
      if(!state.active){
        if(hitSnap && hitSnap.type==='joint'){
          state.active = { mode: 'collinear', joints: [hitSnap.id] };
        } else if(hitSnap && hitSnap.type==='line' && hitSnap.shape){
          // Clicked a line - add all its joints
          const lineJoints = hitSnap.shape.joints || [];
          state.active = { mode: 'collinear', joints: lineJoints.slice() };
        }
      } else {
        if(hitSnap && hitSnap.type==='joint' && !state.active.joints.includes(hitSnap.id)){
          state.active.joints.push(hitSnap.id);
          // Need at least 3 joints
          if(state.active.joints.length >= 3){
            // Can optionally apply now, or wait for more clicks
            // Let's apply on each additional joint after 3rd
            state.saveState(); // Save state BEFORE making changes
            addConstraint(state, 'collinear', { joints: state.active.joints.slice() });
            state.active = null; // Reset to start new collinear constraint
          }
        } else if(hitSnap && hitSnap.type==='line' && hitSnap.shape){
          // Clicked a line - add all its joints that aren't already included
          const lineJoints = hitSnap.shape.joints || [];
          lineJoints.forEach(jid => {
            if(!state.active.joints.includes(jid)){
              state.active.joints.push(jid);
            }
          });
          // Need at least 3 joints
          if(state.active.joints.length >= 3){
            state.saveState(); // Save state BEFORE making changes
            addConstraint(state, 'collinear', { joints: state.active.joints.slice() });
            state.active = null; // Reset to start new collinear constraint
          }
        }
      }

    } else if(state.currentTool==='tangent'){
      continueFrom = null;
      const hitLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
      
      if(!state.active){
        // First click: select line or circle
        if(hitLine && hitLine.shape.type === 'line'){
          state.active = { mode: 'tangent', line: hitLine.shape.id };
        } else {
          // Check if clicking on circle
          const hitCircle = state.shapes.find(s => {
            if(s.type !== 'circle') return false;
            const center = state.joints.get(s.joints[0]);
            const radiusPt = state.joints.get(s.joints[1]);
            if(!center || !radiusPt) return false;
            const radius = Math.hypot(radiusPt.x - center.x, radiusPt.y - center.y);
            const dist = Math.hypot(w.x - center.x, w.y - center.y);
            return Math.abs(dist - radius) < 10; // Click near circle perimeter
          });
          if(hitCircle){
            state.active = { mode: 'tangent', circle: hitCircle.id };
          }
        }
      } else {
        // Second click: select the other element
        if(state.active.line && !state.active.circle){
          // Line selected, now need circle
          const hitCircle = state.shapes.find(s => {
            if(s.type !== 'circle') return false;
            const center = state.joints.get(s.joints[0]);
            const radiusPt = state.joints.get(s.joints[1]);
            if(!center || !radiusPt) return false;
            const radius = Math.hypot(radiusPt.x - center.x, radiusPt.y - center.y);
            const dist = Math.hypot(w.x - center.x, w.y - center.y);
            return Math.abs(dist - radius) < 10;
          });
          if(hitCircle){
            state.saveState(); // Save state BEFORE making changes
            addConstraint(state, 'tangent', { line: state.active.line, circle: hitCircle.id });
            state.active = null;
          }
        } else if(state.active.circle && !state.active.line){
          // Circle selected, now need line
          if(hitLine && hitLine.shape.type === 'line'){
            state.saveState(); // Save state BEFORE making changes
            addConstraint(state, 'tangent', { line: hitLine.shape.id, circle: state.active.circle });
            state.active = null;
          }
        }
      }
    } else if(state.currentTool==='dim'){
      continueFrom = null;
      const hitLine = hitLineAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
      const hitCircle = hitCircleAtScreen(state.joints, state.shapes, svg, e.clientX, e.clientY, 10);
      
      if(!state.active){
        // Phase 0: click on line, circle, or first point
        if(hitCircle){
          // Circle mode: clicked on a circle, dimension its radius
          const center = state.joints.get(hitCircle.joints[0]);
          const radiusPt = state.joints.get(hitCircle.joints[1]);
          if(center && radiusPt){
            const radius = getDist(center, radiusPt);
            state.active = { 
              mode: 'dim-circle', 
              joints: hitCircle.joints.slice(),
              shape: hitCircle,
              value: radius,
              offset: 30 // default offset from circle
            };
            svg.setPointerCapture(e.pointerId);
          }
        } else if(hitLine && hitLine.shape.type === 'line'){
          // Line mode: clicked on a line, start dragging to position annotation
          const j1 = state.joints.get(hitLine.shape.joints[0]);
          const j2 = state.joints.get(hitLine.shape.joints[1]);
          if(j1 && j2){
            const dist = getDist(j1, j2);
            state.active = { 
              mode: 'dim-line', 
              joints: hitLine.shape.joints.slice(),
              shape: hitLine.shape,
              value: dist,
              offset: 30 // default offset perpendicular to line
            };
            svg.setPointerCapture(e.pointerId);
          }
        } else if(hitSnap && hitSnap.type === 'joint'){
          // Point-to-point mode: first point selected
          state.active = { mode: 'dim-p2p', j1: hitSnap.id };
        }
      } else if(state.active.mode === 'dim-p2p' && !state.active.j2){
        // Phase 1: selecting second point
        if(hitSnap && hitSnap.type === 'joint' && hitSnap.id !== state.active.j1){
          const j1 = state.joints.get(state.active.j1);
          const j2 = state.joints.get(hitSnap.id);
          if(j1 && j2){
            const dist = getDist(j1, j2);
            state.active.j2 = hitSnap.id;
            state.active.joints = [state.active.j1, hitSnap.id];
            state.active.value = dist;
            state.active.offset = 30;
            svg.setPointerCapture(e.pointerId);
          }
        }
      }
    } else {
      continueFrom = null;
    }
  });

  svg.addEventListener('pointerup',(e)=>{
    // If we were panning, just clean up and don't process any drawing operations
    if(state.drag && state.drag.type === 'pan'){
      if(state.drag.pointerId) try{ svg.releasePointerCapture(state.drag.pointerId); }catch(_){}
      state.drag = null;
      justCreatedActive = false;
      return;
    }
    
    // Skip drawing operations if middle mouse button was released
    if(e.button === 1){
      justCreatedActive = false;
      return;
    }
    
    const w = screenToWorld(svg, e.clientX, e.clientY);
    state.lastMouse = { x: e.clientX, y: e.clientY };
    // Use the snapTarget from pointermove (what user saw during preview) instead of recalculating
    // This ensures the snap feedback matches what actually gets applied
    const hitSnap = state.snapTarget;
    const wasDragging = isDragging;
    dragStartScreen = null;
    
    if(state.active && state.active.mode==='line'){
      // Skip if state.active was just created in pointerdown (user needs to click again to complete)
      if(justCreatedActive){
        justCreatedActive = false;
        isDragging = false;
        return;
      }
      
      // Polyline mode: complete on every click (no double-click needed)
      // Determine endpoint: snap takes priority, then inference, then raw position
      let endPt = w;
      let endId;
      
      if(hitSnap && hitSnap.type === 'joint'){
        // Special handling for snapping to origin - create new point with coincident constraint
        if(hitSnap.id === 'j_origin'){
          endPt = hitSnap.pt;
          endId = state.genJ();
          state.joints.set(endId, {x:endPt.x, y:endPt.y, fixed:false});
          // Create coincident constraint to origin
          addConstraint(state, 'coincident', { joints: [endId, 'j_origin'] });
        } else {
          // Snapping to other existing joint - use it directly
          endId = hitSnap.id;
        }
      } else {
        // Creating new joint - use inferred position if available, otherwise snap or raw position
        if(state.inference && state.inference.pt){
          endPt = state.inference.pt;
        } else if(hitSnap){
          endPt = hitSnap.pt;
        }
        endId = state.genJ();
        state.joints.set(endId, {x:endPt.x, y:endPt.y, fixed:false});
      }
      
      // Save state BEFORE creating the line and constraints
      state.saveState();
      
      // Create shape with proper ID (needed for perpendicular constraint)
      const newShapeId = 's'+Date.now();
      state.shapes.push({ id: newShapeId, type:'line', joints:[state.active.start, endId] }); 
      
      // If snapped to existing joint (not origin), create coincident constraint
      if(hitSnap && hitSnap.type === 'joint' && hitSnap.id !== 'j_origin'){
        addConstraint(state, 'coincident', { joints: [endId, hitSnap.id] });
      }
      // If snapped to a line, add point-on-line constraint
      if(hitSnap && hitSnap.type === 'line' && hitSnap.shape){
        addConstraint(state, 'pointOnLine', { joint: endId, shape: hitSnap.shape.id });
      }

      // Auto-coincident detection for new endpoints created very close to any existing joint
      // This ensures pairs created by drawing (end of a line and start of another) get a persistent coincident constraint
      if(!(hitSnap && hitSnap.type === 'joint')){
        const pt = state.joints.get(endId);
        const nearby = findNearbyJoint(state.joints, pt, endId, 0.01);
        if(nearby){
          console.log('[polyline] Auto-coincident added between', endId, 'and', nearby);
          addConstraint(state, 'coincident', { joints: [endId, nearby] });
        }
      }
      
      // Add inferred constraints (horizontal, vertical, perpendicular)
      // Only add if geometry is already very close to satisfying the constraint (within 0.5° tolerance)
      // This prevents unwanted shifts when inference was used during drawing but final geometry drifted
      if(state.inference){
        const startJoint = state.joints.get(state.active.start);
        const endJoint = state.joints.get(endId);
        if(startJoint && endJoint){
          const dx = endJoint.x - startJoint.x;
          const dy = endJoint.y - startJoint.y;
          const len = Math.hypot(dx, dy);
          
          if(len > 0.1){
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const CONSTRAINT_TOLERANCE = 5; // degrees - match inference threshold for consistent behavior
            
            if(state.inference.type === 'horizontal'){
              const horizontalDiff = Math.min(Math.abs(angle), Math.abs(Math.abs(angle) - 180));
              if(horizontalDiff < CONSTRAINT_TOLERANCE){
                addConstraint(state, 'horizontal', { joints: [state.active.start, endId] });
              }
            } else if(state.inference.type === 'vertical'){
              const verticalDiff = Math.abs(Math.abs(angle) - 90);
              if(verticalDiff < CONSTRAINT_TOLERANCE){
                addConstraint(state, 'vertical', { joints: [state.active.start, endId] });
              }
            } else if(state.inference.type === 'perpendicular' && state.inference.refLine){
              // Check if current line is actually perpendicular to reference line
              const refShape = state.shapes.find(s => s.id === state.inference.refLine.id);
              if(refShape && refShape.joints){
                const ra = state.joints.get(refShape.joints[0]);
                const rb = state.joints.get(refShape.joints[1]);
                if(ra && rb){
                  const rdx = rb.x - ra.x;
                  const rdy = rb.y - ra.y;
                  const refAngle = Math.atan2(rdy, rdx) * 180 / Math.PI;
                  const perpAngle1 = refAngle + 90;
                  const perpAngle2 = refAngle - 90;
                  
                  const normAngle = ((angle % 360) + 360) % 360;
                  const normPerp1 = ((perpAngle1 % 360) + 360) % 360;
                  const normPerp2 = ((perpAngle2 % 360) + 360) % 360;
                  
                  const diff1 = Math.min(Math.abs(normAngle - normPerp1), 360 - Math.abs(normAngle - normPerp1));
                  const diff2 = Math.min(Math.abs(normAngle - normPerp2), 360 - Math.abs(normAngle - normPerp2));
                  
                  if(Math.min(diff1, diff2) < CONSTRAINT_TOLERANCE){
                    addConstraint(state, 'perpendicular', { shapes: [newShapeId, state.inference.refLine.id] });
                  }
                }
              }
            }
          }
        }
      }
      
      // Check if we should end the polyline sequence
      const origin = state.active.polylineOrigin || polylineOrigin;
      const snappedToExistingJoint = hitSnap && hitSnap.type === 'joint';
      
      if(endId === origin && origin !== state.active.start){
        // Shape closed! End polyline but keep line tool active
        continueFrom = null;
        polylineOrigin = null;
      } else if(snappedToExistingJoint && endId !== state.active.start){
        // Ended on an existing point (not the start) - finish polyline but stay in line tool
        continueFrom = null;
        polylineOrigin = null;
      } else {
        // Continue from endpoint for next segment
        // Save state after each segment so undo can remove one segment at a time
        state.saveState();
        continueFrom = endId;
      }
      isDragging = false;
      state.active = null;
      state.inference = null; // Clear inference after using it
    } else if(state.active && state.active.mode==='circle'){
      // For circle: if just clicked (not dragged), wait for second click
      if(!wasDragging && !state.active.waitingForSecondClick){
        state.active.waitingForSecondClick = true;
        isDragging = false;
        return;
      }
      
      const endPt = hitSnap? hitSnap.pt : w; 
      const endId = hitSnap && hitSnap.type==='joint' ? hitSnap.id : state.genJ(); 
      if(!state.joints.has(endId)) state.joints.set(endId,{x:endPt.x,y:endPt.y,fixed:false}); 
      state.saveState(); // Save state BEFORE creating circle
      state.shapes.push({ id:'s'+Date.now(), type:'circle', joints:[state.active.start, endId] });
      // If snapped to existing joint, create coincident constraint
      if(hitSnap && hitSnap.type==='joint' && hitSnap.id !== 'j_origin'){
        addConstraint(state, 'coincident', { joints: [endId, hitSnap.id] });
      }
      // Auto-coincident detection for newly created circle endpoint
      if(!(hitSnap && hitSnap.type === 'joint')){
        const pt = state.joints.get(endId);
        const nearby = findNearbyJoint(state.joints, pt, endId, 0.01);
        if(nearby){
          console.log('[circle] Auto-coincident added between', endId, 'and', nearby);
          addConstraint(state, 'coincident', { joints: [endId, nearby] });
        }
      } 
      // Circle complete - don't continue, wait for new click
      continueFrom = null;
      polylineOrigin = null;
      isDragging = false;
      state.active = null;
    } else if(state.active && state.active.mode==='rect'){
      const rectMode = state.rectMode || 'rect-2pt';
      
      // For rect (2pt and center modes): if just clicked (not dragged), wait for second click
      // 3pt mode always uses clicks
      if(rectMode !== 'rect-3pt' && !wasDragging && !state.active.waitingForSecondClick){
        state.active.waitingForSecondClick = true;
        isDragging = false;
        return;
      }
      
      const endPt = hitSnap? hitSnap.pt : w; 
      const endId = hitSnap && hitSnap.type==='joint' ? hitSnap.id : state.genJ(); 
      if(!state.joints.has(endId)) state.joints.set(endId,{x:endPt.x,y:endPt.y,fixed:false});
      
      if(rectMode === 'rect-3pt' && !state.active.secondPt){
        // 3-point mode: first two points define width, need third for height
        state.saveState(); // Save after first click so user can undo each click
        // If snapped to existing joint, create coincident constraint
        if(hitSnap && hitSnap.type==='joint' && hitSnap.id !== 'j_origin'){
          addConstraint(state, 'coincident', { joints: [endId, hitSnap.id] });
        }
        state.active.secondPt = endId;
        state.active.preview = { type: 'rect-3pt', pt: endPt };
        isDragging = false;
      } else if(rectMode === 'rect-3pt' && state.active.secondPt){
        // 3-point mode: third point defines height
        state.saveState(); // Save state BEFORE creating rectangle
        // If snapped to existing joint, create coincident constraint
        if(hitSnap && hitSnap.type==='joint' && hitSnap.id !== 'j_origin'){
          addConstraint(state, 'coincident', { joints: [endId, hitSnap.id] });
        }
        const rectShapes = makeRectFrom3Points(state.joints, state.active.start, state.active.secondPt, endId, state.genJ);
        rectShapes.forEach(s => state.shapes.push(s));
        continueFrom = null;
        polylineOrigin = null;
        isDragging = false;
        state.active = null;
      } else if(rectMode === 'rect-center'){
        // Center mode: first point is center, second is corner
        state.saveState(); // Save state BEFORE creating rectangle
        // If snapped to existing joint, create coincident constraint
        if(hitSnap && hitSnap.type==='joint' && hitSnap.id !== 'j_origin'){
          addConstraint(state, 'coincident', { joints: [endId, hitSnap.id] });
        }
        const rectShapes = makeRectFromCenter(state.joints, state.active.start, endId, state.genJ);
        rectShapes.forEach(s => state.shapes.push(s));
        continueFrom = null;
        polylineOrigin = null;
        isDragging = false;
        state.active = null;
      } else {
        // Default 2-point corner mode - includes H/V constraints
        state.saveState(); // Save state BEFORE creating rectangle and constraints
        // If snapped to existing joint, create coincident constraint
        if(hitSnap && hitSnap.type==='joint' && hitSnap.id !== 'j_origin'){
          addConstraint(state, 'coincident', { joints: [endId, hitSnap.id] });
        }
        const rectResult = makeRectFromTwoJoints(state.joints, state.active.start, endId, state.genJ);
        rectResult.shapes.forEach(s => state.shapes.push(s));
        rectResult.constraints.forEach(c => addConstraint(state, c.type, c));
        // Auto-coincident detection for rectangle endpoints: check start and end corner joints
        const sPt = state.joints.get(state.active.start);
        const nearS = findNearbyJoint(state.joints, sPt, state.active.start, 0.01);
        if(nearS){ console.log('[rect] Auto-coincident added between', state.active.start, 'and', nearS); addConstraint(state, 'coincident', { joints: [state.active.start, nearS] }); }
        const ePt = state.joints.get(endId);
        const nearE = findNearbyJoint(state.joints, ePt, endId, 0.01);
        if(nearE){ console.log('[rect] Auto-coincident added between', endId, 'and', nearE); addConstraint(state, 'coincident', { joints: [endId, nearE] }); }
        continueFrom = null;
        polylineOrigin = null;
        isDragging = false;
        state.active = null;
      }
    }
    
    if(state.drag && (state.drag.type==='joint' || state.drag.type==='cluster')){
      const other = hitJointAtScreen(state.joints, svg, e.clientX, e.clientY, 14);
      if(other && !state.drag.jointIds.includes(other.id)){ 
        state.saveState(); // Save state before creating constraint
        // Create coincident constraint between dragged joint and target joint
        // The solver will keep them at the same position - no need to merge them
        addConstraint(state, 'coincident', { joints: [state.drag.id, other.id] });
      }
    }
    
    if(state.drag && state.drag.pointerId) try{ svg.releasePointerCapture(state.drag.pointerId); }catch(_){}
    state.drag=null;
    
    // Dimension tool: finalize on release (after dragging to position)
    if(state.active && (state.active.mode === 'dim-line' || state.active.mode === 'dim-circle' || (state.active.mode === 'dim-p2p' && state.active.j2))){
      // Defensive validation: ensure joints array exists and a numeric value is present
      if(!state.active.joints || state.active.joints.length < 2){
        if(state.active.mode === 'dim-line' && state.active.shape && state.active.shape.joints){
          state.active.joints = state.active.shape.joints.slice();
        } else if(state.active.mode === 'dim-circle' && state.active.joints && state.active.joints.length >= 2){
          // OK
        } else if(state.active.mode === 'dim-p2p' && state.active.j1 && state.active.j2){
          state.active.joints = [state.active.j1, state.active.j2];
        } else {
          console.warn('[dim] Missing joints for dimension creation:', state.active);
        }
      }

      // Compute value if missing from active state
      if((state.active.value === undefined || state.active.value === null) && state.active.joints && state.active.joints.length >= 2){
        const j1 = state.joints.get(state.active.joints[0]);
        const j2 = state.joints.get(state.active.joints[1]);
        if(j1 && j2){
          state.active.value = getDist(j1, j2);
        }
      }

      state.saveState(); // Save state BEFORE adding constraint
      console.log('[dim] Adding distance constraint:', { joints: state.active.joints, value: state.active.value, offset: state.active.offset, mode: state.active.mode });
      const added = addConstraint(state, 'distance', {
        joints: state.active.joints ? state.active.joints.slice() : [],
        value: state.active.value,
        offset: state.active.offset || 30,
        isRadius: state.active.mode === 'dim-circle'
      });
      
      // Find the newly added constraint for selection and editing
      if(added){
        const newConstraint = state.constraints[state.constraints.length - 1];
        state.selectItem('constraint', newConstraint);
        // Show dimension input for editing
        showDimInput(svg, state, newConstraint);
      }
      
      try{ svg.releasePointerCapture(e.pointerId); }catch(_){}
      state.active = null;
    }
    
    justCreatedActive = false; // Reset flag at end of pointerup
  });
  
  svg.addEventListener('contextmenu',(e)=>{
    e.preventDefault();
    continueFrom = null;
    polylineOrigin = null;
    state.active = null;
  });
  
  // Handle Delete key to remove selected constraint or shape
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Delete'){
      if(state.selectedConstraint){
        // Remove the selected constraint
        const idx = state.constraints.indexOf(state.selectedConstraint);
        if(idx !== -1){
          state.saveState(); // Save state BEFORE deleting
          // Clear selection flag on the removed constraint
          if(state.selectedConstraint && state.selectedConstraint.__selected) state.selectedConstraint.__selected = false;
          state.constraints.splice(idx, 1);
          state.selectedConstraint = null;
        }
      } else if(state.selectedShape){
        // Remove the selected shape and any constraints applied to it
        state.saveState(); // Save state BEFORE deleting
        const shapeIdx = state.shapes.indexOf(state.selectedShape);
        if(shapeIdx !== -1){
          const deletedShapeId = state.selectedShape.id;
          state.shapes.splice(shapeIdx, 1);
          
          // Remove constraints that reference the deleted shape
          state.constraints = state.constraints.filter(c => {
            // Remove if constraint references this shape
            if(c.shapes && c.shapes.includes(deletedShapeId)) return false;
            if(c.shape === deletedShapeId) return false;
            if(c.line === deletedShapeId) return false;
            if(c.circle === deletedShapeId) return false;
            
            // Keep all other constraints
            return true;
          });
          
          state.selectedShape = null;
        }
      }
    } else if(e.key === 'Escape'){
      // Escape key: exit tool and activate select tool
      state.currentTool = 'select';
      state.active = null;
      continueFrom = null;
      polylineOrigin = null;
      state.clearSelection();
      
      // Update UI to show select tool is active
      document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
      const selectBtn = document.getElementById('tool-select');
      if(selectBtn) selectBtn.classList.add('active');
      
      const modeText = document.getElementById('modeText');
      if(modeText) modeText.innerText = 'MODE: SELECT';
    }
  });
  
  // mouse wheel for zoom
  svg.addEventListener('wheel',(e)=>{
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    // Maintain aspect ratio
    const rect = svg.getBoundingClientRect();
    const aspectRatio = rect.width / rect.height;
    state.view.w *= factor;
    state.view.h = state.view.w / aspectRatio;
    svg.setAttribute('viewBox', `${state.view.x-state.view.w/2} ${state.view.y-state.view.h/2} ${state.view.w} ${state.view.h}`);
  }, {passive:false});
  
  // Expose reset for tool changes
  state.resetPolyline = () => { continueFrom = null; polylineOrigin = null; };
}
