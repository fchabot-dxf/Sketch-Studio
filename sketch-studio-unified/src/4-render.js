import { worldToScreen } from './1-utils.js';
export function draw(joints, shapes, svg, active, snapTarget, constraints=[], selectedJoints=new Set(), selectedConstraint=null, currentTool=null, inference=null, selectedShape=null, hoveredShape=null, hoveredJoint=null, hoveredConstraint=null){ 
  // Toggle snapping class for background color change
  if(snapTarget) svg.classList.add('snapping'); else svg.classList.remove('snapping');
  svg.innerHTML=''; 
  // Calculate zoom factor to keep stroke widths constant in screen space
  const vb = svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  const zoomX = vb.width / rect.width;
  const zoomY = vb.height / rect.height;
  const zoom = Math.max(zoomX, zoomY); // Use larger zoom to ensure visibility
  
  // Base sizes in screen pixels - will be scaled by inverse zoom
  const BASE_LINE_STROKE = 6;
  const BASE_LINE_STROKE_SELECTED = 12;
  const BASE_LINE_STROKE_HOVERED = 18;
  const BASE_JOINT_RADIUS = 18;
  const BASE_JOINT_STROKE = 4;
  const BASE_JOINT_STROKE_SELECTED = 8;
  const BASE_JOINT_STROKE_HOVERED = 12;
  
  // Scale function to convert screen-space sizes to world-space
  const scale = (screenSize) => screenSize * zoom;
  
  // Common glyph sizes used throughout rendering
  const glyphSize = scale(12);
  const hitZoneRadius = scale(20);
  
  // draw grid
  const gridSize = 50;
  const startX = Math.floor(vb.x / gridSize) * gridSize;
  const startY = Math.floor(vb.y / gridSize) * gridSize;
  for(let x = startX; x < vb.x + vb.width; x += gridSize){
    svg.insertAdjacentHTML('beforeend', `<line x1="${x}" y1="${vb.y}" x2="${x}" y2="${vb.y+vb.height}" stroke="#d0d0d0" stroke-width="1" stroke-opacity="0.5"/>`);
  }
  for(let y = startY; y < vb.y + vb.height; y += gridSize){
    svg.insertAdjacentHTML('beforeend', `<line x1="${vb.x}" y1="${y}" x2="${vb.x+vb.width}" y2="${y}" stroke="#d0d0d0" stroke-width="1" stroke-opacity="0.5"/>`);
  }
  
  // Draw origin axes with zoom-scaled stroke
  const originStroke = scale(1.5);
  // X axis (horizontal, red)
  svg.insertAdjacentHTML('beforeend', `<line x1="${vb.x}" y1="0" x2="${vb.x+vb.width}" y2="0" stroke="#ef4444" stroke-width="${originStroke}" stroke-opacity="0.6"/>`);
  // Y axis (vertical, green)  
  svg.insertAdjacentHTML('beforeend', `<line x1="0" y1="${vb.y}" x2="0" y2="${vb.y+vb.height}" stroke="#22c55e" stroke-width="${originStroke}" stroke-opacity="0.6"/>`);
  
  // Determine which joints and shapes are part of the selected constraint (for highlighting)
  let constraintJoints = new Set();
  let constraintShapes = new Set();
  if(selectedConstraint){
    if(selectedConstraint.type === 'coincident' && selectedConstraint.joints){
      // Coincident: highlight the joints and all shapes using those joints
      for(const jid of selectedConstraint.joints){
        constraintJoints.add(jid);
      }
      for(const s of shapes){
        if(s.joints && s.joints.some(jid => constraintJoints.has(jid))){
          constraintShapes.add(s.id);
        }
      }
    } else if((selectedConstraint.type === 'horizontal' || selectedConstraint.type === 'vertical') && selectedConstraint.joints){
      // H/V: highlight the two joints and shapes using them
      for(const jid of selectedConstraint.joints){
        constraintJoints.add(jid);
      }
      for(const s of shapes){
        if(s.joints && s.joints.some(jid => constraintJoints.has(jid))){
          constraintShapes.add(s.id);
        }
      }
    } else if((selectedConstraint.type === 'parallel' || selectedConstraint.type === 'perpendicular') && selectedConstraint.shapes){
      // Parallel/Perpendicular: highlight the two shapes
      for(const sid of selectedConstraint.shapes){
        constraintShapes.add(sid);
      }
    } else if(selectedConstraint.type === 'collinear' && selectedConstraint.joints){
      // Collinear: highlight all three joints and shapes using them
      for(const jid of selectedConstraint.joints){
        constraintJoints.add(jid);
      }
      for(const s of shapes){
        if(s.joints && s.joints.some(jid => constraintJoints.has(jid))){
          constraintShapes.add(s.id);
        }
      }
    } else if(selectedConstraint.type === 'tangent'){
      // Tangent: highlight the line shape and circle shape
      if(selectedConstraint.line) constraintShapes.add(selectedConstraint.line);
      if(selectedConstraint.circle) constraintShapes.add(selectedConstraint.circle);
    } else if(selectedConstraint.type === 'pointOnLine'){
      // Point-on-line: highlight the joint and the line shape
      if(selectedConstraint.joint) constraintJoints.add(selectedConstraint.joint);
      if(selectedConstraint.shape) constraintShapes.add(selectedConstraint.shape);
    } else if(selectedConstraint.type === 'distance' && selectedConstraint.joints){
      // Distance: highlight the two joints and shapes using them
      for(const jid of selectedConstraint.joints){
        constraintJoints.add(jid);
      }
      for(const s of shapes){
        if(s.joints && s.joints.some(jid => constraintJoints.has(jid))){
          constraintShapes.add(s.id);
        }
      }
    }
  }
  
  // draw shapes (clickable for selection)
  for(const s of shapes){ 
    const isSelected = selectedShape && selectedShape.id === s.id;
    const isHovered = hoveredShape && hoveredShape.id === s.id;
    const isConstraintPart = constraintShapes.has(s.id);
    
    let strokeWidth = scale(BASE_LINE_STROKE);
    let strokeColor = '#2563eb'; // base blue
    
    if(isConstraintPart){
      // Highlight shapes that are part of selected constraint
      strokeWidth = scale(BASE_LINE_STROKE_SELECTED);
      strokeColor = '#ef4444'; // red highlight
    } else if(isHovered){
      strokeWidth = scale(BASE_LINE_STROKE_HOVERED);
      strokeColor = '#1e40af'; // darker blue
    } else if(isSelected){
      strokeWidth = scale(BASE_LINE_STROKE_SELECTED);
      strokeColor = '#1e40af'; // darker blue
    }
    
    if(s.type==='line'){ 
      const a=joints.get(s.joints[0]), b=joints.get(s.joints[1]); 
      if(a && b) svg.insertAdjacentHTML('beforeend', `<line class="shape-elem" data-shape-id="${s.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" style="cursor:pointer"/>`); 
    } else if(s.type==='circle'){ 
      const c=joints.get(s.joints[0]), p=joints.get(s.joints[1]); 
      if(c && p){ const r=Math.hypot(p.x-c.x,p.y-c.y); svg.insertAdjacentHTML('beforeend', `<circle class="shape-elem" data-shape-id="${s.id}" cx="${c.x}" cy="${c.y}" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}" style="cursor:pointer"/>`); }
    } 
  }
  
  // Draw preview constraint glyph when setting up a constraint
  if(active && active.mode){
    const constraintModes = ['coincident', 'parallel', 'perp', 'hv', 'collinear', 'tangent'];
    if(constraintModes.includes(active.mode)){
      // Show preview glyph at first selected element
      if(active.mode === 'coincident' && active.j1){
        const j1 = joints.get(active.j1);
        if(j1){
          const offset = scale(10);
          const x = j1.x + offset, y = j1.y - offset;
          const previewC = { type: 'coincident', joints: [active.j1, active.j1], __isPreview: true, __pos: { x, y } };
          drawConstraintGlyph(svg, previewC);
        }
      } else if(active.mode === 'parallel' && active.shape1){
        const shape = shapes.find(s => s.id === active.shape1);
        if(shape && shape.joints){
          const a = joints.get(shape.joints[0]), b = joints.get(shape.joints[1]);
          if(a && b){
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy);
            const nx = len > 0 ? -dy / len : 0;
            const ny = len > 0 ? dx / len : 1;
            const offset = scale(10);
            const gx = mx + nx * offset, gy = my + ny * offset;
            const previewC = { type: 'parallel', shapes: [active.shape1, active.shape1], __isPreview: true, __pos: { x: gx, y: gy } };
            drawConstraintGlyph(svg, previewC);
          }
        }
      } else if(active.mode === 'perp' && active.shape1){
        const shape = shapes.find(s => s.id === active.shape1);
        if(shape && shape.joints){
          const a = joints.get(shape.joints[0]), b = joints.get(shape.joints[1]);
          if(a && b){
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy);
            const nx = len > 0 ? -dy / len : 0;
            const ny = len > 0 ? dx / len : 1;
            const offset = scale(10);
            const gx = mx + nx * offset, gy = my + ny * offset;
            const previewC = { type: 'perpendicular', shapes: [active.shape1, active.shape1], __isPreview: true, __pos: { x: gx, y: gy } };
            drawConstraintGlyph(svg, previewC);
          }
        }
      } else if(active.mode === 'hv'){
        // H/V will show on the line being evaluated
      } else if(active.mode === 'collinear' && active.joints && active.joints.length > 0){
        const lastJoint = joints.get(active.joints[active.joints.length - 1]);
        if(lastJoint){
          const offset = scale(10);
          const x = lastJoint.x + offset, y = lastJoint.y - offset;
          const previewC = { type: 'collinear', joints: active.joints.slice(), __isPreview: true, __pos: { x, y } };
          drawConstraintGlyph(svg, previewC);
        }
      } else if(active.mode === 'tangent' && (active.line || active.circle)){
        // Show on line or circle
        if(active.line){
          const shape = shapes.find(s => s.id === active.line);
          if(shape && shape.joints){
            const a = joints.get(shape.joints[0]), b = joints.get(shape.joints[1]);
            if(a && b){
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              const dx = b.x - a.x, dy = b.y - a.y;
              const len = Math.hypot(dx, dy);
              const nx = len > 0 ? -dy / len : 0;
              const ny = len > 0 ? dx / len : 1;
              const offset = scale(10);
              const gx = mx + nx * offset, gy = my + ny * offset;
              const symbolSize = glyphSize * 0.6;
              const bgRadius = glyphSize + scale(5);
              const previewC = { type: 'tangent', line: active.line, circle: active.circle, __isPreview: true, __pos: { x: gx, y: gy } };
              drawConstraintGlyph(svg, previewC);
            }
          }
        }
      }
    }
  }
  
  // draw origin first (underneath everything)
  const origin = joints.get('j_origin');
  if(origin){
    svg.insertAdjacentHTML('beforeend', `<circle cx="${origin.x}" cy="${origin.y}" r="${scale(6)}" fill="#ef4444" style="cursor:pointer"/>`); 
  }
  
  // Check which points are coincident to origin (via constraints, not distance)
  const pointsCoincidentToOrigin = new Set();
  for(const c of constraints){
    if(c.type === 'coincident' && c.joints){
      const [j1, j2] = c.joints;
      if(j1 === 'j_origin') pointsCoincidentToOrigin.add(j2);
      if(j2 === 'j_origin') pointsCoincidentToOrigin.add(j1);
    }
  }
  
  // draw joints
  const pointsAtOrigin = [];
  
  for(const [id,j] of joints.entries()){ 
    if(id === 'j_origin') continue; // Skip origin, already drawn
    const isSelected = selectedJoints.has(id);
    const isHovered = hoveredJoint && hoveredJoint.id === id;
    const isConstraintPart = constraintJoints.has(id);
    
    // Draw regular point styling with zoom-scaled sizes
    const r = scale(BASE_JOINT_RADIUS);
    const fill = 'white';
    let stroke = '#2563eb'; // base blue
    let strokeW = scale(BASE_JOINT_STROKE); // base
    
    if(isConstraintPart){
      // Highlight joints that are part of selected constraint
      stroke = '#ef4444'; // red highlight
      strokeW = scale(BASE_JOINT_STROKE_SELECTED);
    } else if(isHovered){
      stroke = '#1e40af'; // darker blue
      strokeW = scale(BASE_JOINT_STROKE_HOVERED);
    } else if(isSelected){
      stroke = '#1e40af'; // darker blue
      strokeW = scale(BASE_JOINT_STROKE_SELECTED);
    }
    svg.insertAdjacentHTML('beforeend', `<circle cx="${j.x}" cy="${j.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" style="cursor:pointer"/>`);
    
    // Show snap ring feedback when hovered (unified with active snap target visual)
    if(isHovered){
      svg.insertAdjacentHTML('beforeend', `<circle cx="${j.x}" cy="${j.y}" r="${scale(32)}" fill="#2563eb" fill-opacity="0.15" stroke="none"/>`);
      svg.insertAdjacentHTML('beforeend', `<circle cx="${j.x}" cy="${j.y}" r="${scale(24)}" fill="none" stroke="#2563eb" stroke-width="${scale(3)}"/>`);
    }
    
    // Track if coincident to origin for later overlay
    if(pointsCoincidentToOrigin.has(id)){
      pointsAtOrigin.push(j);
    }
  }
  
  // Draw red overlay circles for points coincident to origin (on top)
  for(const j of pointsAtOrigin){
    svg.insertAdjacentHTML('beforeend', `<circle cx="${j.x}" cy="${j.y}" r="${scale(8)}" fill="#ef4444" style="cursor:pointer; pointer-events:none;"/>`); 
  }
  // draw preview
  if(active && active.preview){ 
    const a=joints.get(active.start);
    if(a){
      const p=active.preview.pt;
      if(active.preview.type==='line'){ 
        svg.insertAdjacentHTML('beforeend', `<line x1="${a.x}" y1="${a.y}" x2="${p.x}" y2="${p.y}" stroke="#10b981" stroke-width="2" stroke-dasharray="6"/>`); 
      } else if(active.preview.type==='circle'){
        const r = Math.hypot(p.x-a.x, p.y-a.y);
        svg.insertAdjacentHTML('beforeend', `<circle cx="${a.x}" cy="${a.y}" r="${r}" fill="none" stroke="#10b981" stroke-width="2" stroke-dasharray="6"/>`);
      } else if(active.preview.type==='rect'){
        svg.insertAdjacentHTML('beforeend', `<rect x="${Math.min(a.x,p.x)}" y="${Math.min(a.y,p.y)}" width="${Math.abs(p.x-a.x)}" height="${Math.abs(p.y-a.y)}" fill="none" stroke="#10b981" stroke-width="2" stroke-dasharray="6"/>`);
      } else if(active.preview.type==='rect-center'){
        // Center point rect preview: a is center, p is corner
        const dx = p.x - a.x, dy = p.y - a.y;
        svg.insertAdjacentHTML('beforeend', `<rect x="${a.x-dx}" y="${a.y-dy}" width="${Math.abs(dx)*2}" height="${Math.abs(dy)*2}" fill="none" stroke="#10b981" stroke-width="2" stroke-dasharray="6"/>`);
        // Show center marker
        svg.insertAdjacentHTML('beforeend', `<circle cx="${a.x}" cy="${a.y}" r="4" fill="#10b981" fill-opacity="0.5"/>`);
      } else if(active.preview.type==='rect-3pt'){
        // 3-point rect: show the first edge being defined
        const b = active.secondPt ? joints.get(active.secondPt) : null;
        if(b){
          // Have 2 points, show projected rectangle
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy); if(len > 0.001){
            const px = -dy/len, py = dx/len;
            const h = (p.x - a.x) * px + (p.y - a.y) * py;
            const c3 = { x: b.x + px * h, y: b.y + py * h };
            const c4 = { x: a.x + px * h, y: a.y + py * h };
            svg.insertAdjacentHTML('beforeend', `<polygon points="${a.x},${a.y} ${b.x},${b.y} ${c3.x},${c3.y} ${c4.x},${c4.y}" fill="none" stroke="#10b981" stroke-width="2" stroke-dasharray="6"/>`);
          }
        } else {
          // Just first edge
          svg.insertAdjacentHTML('beforeend', `<line x1="${a.x}" y1="${a.y}" x2="${p.x}" y2="${p.y}" stroke="#10b981" stroke-width="2" stroke-dasharray="6"/>`);
        }
      }
    }
  }
  
  // Draw dimension preview while dragging
  if(active && (active.mode === 'dim-line' || (active.mode === 'dim-p2p' && active.j2))){
    const j1 = joints.get(active.joints[0]), j2 = joints.get(active.joints[1]);
    if(j1 && j2){
      const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
      const dx = j2.x - j1.x, dy = j2.y - j1.y;
      const len = Math.hypot(dx, dy);
      const offset = active.offset || 30;
      const dist = active.value ? active.value.toFixed(1) : len.toFixed(1);
      
      let nx = 0, ny = -1;
      if(len > 0.01){ nx = -dy / len; ny = dx / len; }
      
      const annotX = mx + nx * offset;
      const annotY = my + ny * offset;
      const ext1End = { x: j1.x + nx * offset, y: j1.y + ny * offset };
      const ext2End = { x: j2.x + nx * offset, y: j2.y + ny * offset };
      const ext1Start = { x: j1.x + nx * 5, y: j1.y + ny * 5 };
      const ext2Start = { x: j2.x + nx * 5, y: j2.y + ny * 5 };
      
      // Preview extension lines
      svg.insertAdjacentHTML('beforeend', `<line x1="${ext1Start.x}" y1="${ext1Start.y}" x2="${ext1End.x}" y2="${ext1End.y}" stroke="#10b981" stroke-width="1" stroke-dasharray="4"/>`);
      svg.insertAdjacentHTML('beforeend', `<line x1="${ext2Start.x}" y1="${ext2Start.y}" x2="${ext2End.x}" y2="${ext2End.y}" stroke="#10b981" stroke-width="1" stroke-dasharray="4"/>`);
      // Preview dimension line
      svg.insertAdjacentHTML('beforeend', `<line x1="${ext1End.x}" y1="${ext1End.y}" x2="${ext2End.x}" y2="${ext2End.y}" stroke="#10b981" stroke-width="2" stroke-dasharray="4"/>`);
      // Preview text
      svg.insertAdjacentHTML('beforeend', `<rect x="${annotX - 18}" y="${annotY - 8}" width="36" height="14" fill="#10b981" fill-opacity="0.2" rx="2"/>`);
      svg.insertAdjacentHTML('beforeend', `<text x="${annotX}" y="${annotY + 3}" text-anchor="middle" font-size="11" fill="#10b981" font-weight="bold">${dist}</text>`);
    }
  }
  
  // draw snap indicator - only when actively drawing/dragging, not just hovering
  if(snapTarget && active){ 
    const p=snapTarget.pt;
    const isConstraintTool = ['coincident', 'hv', 'parallel', 'perp', 'collinear', 'tangent'].includes(currentTool);
    
    if(snapTarget.type === 'joint'){
      // Only show joint highlight for tools that can use joints
      const canUseJoint = !isConstraintTool || currentTool === 'coincident';
      if(canUseJoint){
        // Circle indicator for point snap with glow - bigger highlight
        svg.insertAdjacentHTML('beforeend', `<circle cx="${p.x}" cy="${p.y}" r="${scale(32)}" fill="#2563eb" fill-opacity="0.15" stroke="none"/>`);
        svg.insertAdjacentHTML('beforeend', `<circle cx="${p.x}" cy="${p.y}" r="${scale(24)}" fill="none" stroke="#2563eb" stroke-width="${scale(3)}"/>`);
        svg.insertAdjacentHTML('beforeend', `<circle cx="${p.x}" cy="${p.y}" r="${scale(3)}" fill="#2563eb"/>`);;
      }
    } else if(snapTarget.type === 'line'){
      // Highlight the line being snapped to
      const shape = snapTarget.shape;
      if(shape && shape.joints){
        const a = joints.get(shape.joints[0]), b = joints.get(shape.joints[1]);
        if(a && b){
          svg.insertAdjacentHTML('beforeend', `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#2563eb" stroke-width="${scale(4)}" stroke-opacity="0.5"/>`);
        }
      }
      // Only show diamond and X for drawing tools, not constraint tools
      if(!isConstraintTool){
        // Diamond indicator for line snap point
        const diamondSize = 6;
        const diamondStroke = scale(2);
        svg.insertAdjacentHTML('beforeend', `<rect x="${p.x-scale(diamondSize)}" y="${p.y-scale(diamondSize)}" width="${scale(diamondSize*2)}" height="${scale(diamondSize*2)}" fill="#2563eb" fill-opacity="0.3" stroke="#2563eb" stroke-width="${diamondStroke}" transform="rotate(45 ${p.x} ${p.y})"/>`);
        // Small X to indicate coincident will be added
        const xSize = 4;
        const xStroke = scale(2);
        svg.insertAdjacentHTML('beforeend', `<line x1="${p.x-scale(xSize)}" y1="${p.y-scale(xSize)}" x2="${p.x+scale(xSize)}" y2="${p.y+scale(xSize)}" stroke="#2563eb" stroke-width="${xStroke}"/>`);
        svg.insertAdjacentHTML('beforeend', `<line x1="${p.x+scale(xSize)}" y1="${p.y-scale(xSize)}" x2="${p.x-scale(xSize)}" y2="${p.y+scale(xSize)}" stroke="#2563eb" stroke-width="${xStroke}"/>`);
      }
    } else {
      // Generic snap indicator
      if(!isConstraintTool){
        const diamondSize = 6;
        const diamondStroke = scale(2);
        svg.insertAdjacentHTML('beforeend', `<rect x="${p.x-scale(diamondSize)}" y="${p.y-scale(diamondSize)}" width="${scale(diamondSize*2)}" height="${scale(diamondSize*2)}" fill="none" stroke="#2563eb" stroke-width="${diamondStroke}" transform="rotate(45 ${p.x} ${p.y})"/>`);
      }
    }
  }
  
  // Draw inference hint (horizontal, vertical, perpendicular)
  if(inference && active && active.start){
    const start = joints.get(active.start);
    if(start){
      const iconSize = scale(20);
      const offset = scale(30);
      const strokeW = scale(2.5);
      const circleR = iconSize / 2;
      const circleStroke = scale(2);
      const mx = (start.x + inference.pt.x) / 2;
      const my = (start.y + inference.pt.y) / 2;
      
      if(inference.type === 'horizontal'){
        // H icon with horizontal line
        svg.insertAdjacentHTML('beforeend', `<g transform="translate(${mx},${my - offset})" opacity="0.8">
          <circle cx="0" cy="0" r="${circleR}" fill="#fbbf24" stroke="#f59e0b" stroke-width="${circleStroke}"/>
          <line x1="-${iconSize/3}" y1="0" x2="${iconSize/3}" y2="0" stroke="white" stroke-width="${strokeW}" stroke-linecap="round"/>
        </g>`);
      } else if(inference.type === 'vertical'){
        // V icon with vertical line
        svg.insertAdjacentHTML('beforeend', `<g transform="translate(${mx + offset},${my})" opacity="0.8">
          <circle cx="0" cy="0" r="${circleR}" fill="#10b981" stroke="#059669" stroke-width="${circleStroke}"/>
          <line x1="0" y1="-${iconSize/3}" x2="0" y2="${iconSize/3}" stroke="white" stroke-width="${strokeW}" stroke-linecap="round"/>
        </g>`);
      } else if(inference.type === 'perpendicular'){
        // Perpendicular icon (⊥ symbol) - purple to match constraint
        svg.insertAdjacentHTML('beforeend', `<g transform="translate(${mx},${my - offset})" opacity="0.8">
          <circle cx="0" cy="0" r="${circleR}" fill="#a855f7" stroke="#7c3aed" stroke-width="${circleStroke}"/>
          <line x1="-${iconSize/3}" y1="${iconSize/4}" x2="${iconSize/3}" y2="${iconSize/4}" stroke="white" stroke-width="${strokeW}" stroke-linecap="round"/>
          <line x1="0" y1="${iconSize/4}" x2="0" y2="-${iconSize/3}" stroke="white" stroke-width="${strokeW}" stroke-linecap="round"/>
        </g>`);
      }
    }
  }
  
  // Draw a single constraint glyph (handles preview visuals when c.__isPreview is set)
  function drawConstraintGlyph(svg, c, opts = {}){
    const preview = !!c.__isPreview || !!opts.isPreview;
    const previewAttr = preview ? ' data-preview="1"' : '';
    const groupStyle = preview ? 'opacity:0.5; pointer-events:none' : 'cursor:pointer';
    const makeGroup = (inner, transform) => {
      const tr = transform ? ` transform="${transform}"` : '';
      svg.insertAdjacentHTML('beforeend', `<g class="constraint-glyph"${previewAttr}${tr} style="${groupStyle}">${inner}</g>`);
    };

    switch(c.type){
      case 'coincident': {
        let x, y;
        if(c.__pos){ x = c.__pos.x; y = c.__pos.y; }
        else {
          const j1 = joints.get(c.joints && c.joints[0]) || joints.get(c.joints && c.joints[1]);
          if(!j1) return; const offset = scale(10); x = j1.x + offset; y = j1.y - offset;
        }
        const isHovered = !preview && hoveredConstraint === c;
        const isSelected = !preview && selectedConstraint === c;
        const stroke = (isHovered || isSelected) ? '#1e40af' : '#2563eb';
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const glowHtml = (isHovered || isSelected) ? `<circle cx="0" cy="0" r="${bgRadius + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
        const symbolSize = glyphSize * 0.6;
        const inner = `<circle cx="0" cy="0" r="${hitZoneRadius}" fill="transparent"/>${glowHtml}<circle cx="0" cy="0" r="${bgRadius}" fill="#ef4444" fill-opacity="${bgOpacity}" stroke="#dc2626" stroke-width="${scale(3.5)}"/><line x1="-${symbolSize}" y1="-${symbolSize}" x2="${symbolSize}" y2="${symbolSize}" stroke="white" stroke-width="${strokeW}"/><line x1="${symbolSize}" y1="-${symbolSize}" x2="-${symbolSize}" y2="${symbolSize}" stroke="white" stroke-width="${strokeW}"/>`;
        makeGroup(inner, `translate(${x},${y})`);
        break;
      }

      case 'horizontal': {
        const j1 = joints.get(c.joints[0]), j2 = joints.get(c.joints[1]);
        if(!j1 || !j2) return;
        const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2 + scale(10);
        const isHovered = !preview && hoveredConstraint === c;
        const isSelected = !preview && selectedConstraint === c;
        const stroke = (isHovered || isSelected) ? '#1e40af' : '#059669';
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = '#22c55e';
        const glow = (isHovered || isSelected) ? `<circle cx="${mx}" cy="${my}" r="${bgRadius + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
        const symbolSize = glyphSize * 0.6;
        const inner = `<circle cx="${mx}" cy="${my}" r="${hitZoneRadius}" fill="transparent"/>${glow}<circle cx="${mx}" cy="${my}" r="${bgRadius}" fill="${bgColor}" fill-opacity="${bgOpacity}" stroke="#15803d" stroke-width="${scale(3.5)}"/><line x1="${mx - symbolSize}" y1="${my}" x2="${mx + symbolSize}" y2="${my}" stroke="white" stroke-width="${strokeW}"/>`;
        makeGroup(inner);
        break;
      }

      case 'vertical': {
        const j1 = joints.get(c.joints[0]), j2 = joints.get(c.joints[1]);
        if(!j1 || !j2) return;
        const mx = (j1.x + j2.x)/2 + scale(10), my = (j1.y + j2.y)/2;
        const isHovered = !preview && hoveredConstraint === c;
        const isSelected = !preview && selectedConstraint === c;
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = '#22c55e';
        const glow = (isHovered || isSelected) ? `<circle cx="${mx}" cy="${my}" r="${bgRadius + scale(4)}" fill="#1e40af" fill-opacity="0.15"/>` : '';
        const symbolSize = glyphSize * 0.6;
        const inner = `<circle cx="${mx}" cy="${my}" r="${hitZoneRadius}" fill="transparent"/>${glow}<circle cx="${mx}" cy="${my}" r="${bgRadius}" fill="${bgColor}" fill-opacity="${bgOpacity}" stroke="#0369a1" stroke-width="${scale(3.5)}"/><line x1="${mx}" y1="${my - symbolSize}" x2="${mx}" y2="${my + symbolSize}" stroke="white" stroke-width="${strokeW}"/>`;
        makeGroup(inner);
        break;
      }

      case 'parallel':
      case 'perpendicular': {
        const s1 = shapes.find(s => s.id === c.shapes[0]);
        if(!s1 || !s1.joints) return;
        const j1 = joints.get(s1.joints[0]), j2 = joints.get(s1.joints[1]);
        if(!j1 || !j2) return;
        const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
        const dx = j2.x - j1.x, dy = j2.y - j1.y; const len = Math.hypot(dx, dy);
        const nx = len > 0 ? -dy/len : 0; const ny = len > 0 ? dx/len : 1; const offset = scale(10);
        const gx = mx + nx * offset, gy = my + ny * offset;
        const isHovered = !preview && hoveredConstraint === c;
        const isSelected = !preview && selectedConstraint === c;
        const stroke = (isHovered || isSelected) ? '#1e40af' : (c.type === 'perpendicular' ? '#0891b2' : '#7c3aed');
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = (c.type === 'perpendicular') ? '#a855f7' : '#3b82f6';
        const glow = (isHovered || isSelected) ? `<circle cx="0" cy="0" r="${bgRadius + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
        if(c.type === 'parallel'){
          const symbolSize = glyphSize * 0.6;
          const inner = `<circle cx="0" cy="0" r="${hitZoneRadius}" fill="transparent"/>${glow}<circle cx="0" cy="0" r="${bgRadius}" fill="${bgColor}" fill-opacity="${bgOpacity}" stroke="#ca8a04" stroke-width="${scale(3.5)}"/><line x1="-${symbolSize}" y1="-${symbolSize/3}" x2="${symbolSize}" y2="-${symbolSize/3}" stroke="white" stroke-width="${strokeW}"/><line x1="-${symbolSize}" y1="${symbolSize/3}" x2="${symbolSize}" y2="${symbolSize/3}" stroke="white" stroke-width="${strokeW}"/>`;
          makeGroup(inner, `translate(${gx},${gy})`);
        } else {
          const symbolSize = glyphSize * 0.6;
          const inner = `<circle cx="0" cy="0" r="${hitZoneRadius}" fill="transparent"/>${glow}<circle cx="0" cy="0" r="${bgRadius}" fill="${bgColor}" fill-opacity="${bgOpacity}" stroke="#7c3aed" stroke-width="${scale(3.5)}"/><line x1="-${symbolSize}" y1="${symbolSize}" x2="${symbolSize}" y2="${symbolSize}" stroke="white" stroke-width="${strokeW}"/><line x1="0" y1="${symbolSize}" x2="0" y2="-${symbolSize}" stroke="white" stroke-width="${strokeW}"/>`;
          makeGroup(inner, `translate(${gx},${gy})`);
        }
        break;
      }

      case 'pointOnLine': {
        const pt = joints.get(c.joint); if(!pt) return;
        const isHovered = !preview && hoveredConstraint === c;
        const isSelected = !preview && selectedConstraint === c;
        const strokeW = (isHovered || isSelected) ? scale(2.5) : scale(1.5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = '#fb923c';
        const glow = (isHovered || isSelected) ? `<circle cx="0" cy="-${scale(12)}" r="${scale(9)}" fill="#f97316" fill-opacity="0.15"/>` : '';
        const inner = `<circle cx="0" cy="-${scale(12)}" r="${hitZoneRadius}" fill="transparent"/>${glow}<circle cx="0" cy="-${scale(12)}" r="${scale(7)}" fill="${bgColor}" fill-opacity="${bgOpacity}" stroke="#ea580c" stroke-width="${scale(3)}"/><circle cx="0" cy="-${scale(12)}" r="${scale(1.4)}" fill="white"/>`;
        makeGroup(inner, `translate(${pt.x},${pt.y})`);
        break;
      }

      case 'collinear': {
        // Allow preview-only position via c.__pos or fall back to middle joint
        let px, py;
        if(c.__pos){ px = c.__pos.x; py = c.__pos.y; }
        else {
          if(!c.joints || c.joints.length < 3) return;
          const midIdx = Math.floor(c.joints.length / 2);
          const midJoint = joints.get(c.joints[midIdx]); if(!midJoint) return;
          px = midJoint.x; py = midJoint.y;
        }
        const isHovered = !preview && hoveredConstraint === c;
        const isSelected = !preview && selectedConstraint === c;
        const stroke = (isHovered || isSelected) ? '#1e40af' : '#8b5cf6';
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = '#14b8a6';
        const dotSize = scale(2.5); const spacing = scale(5);
        const glow = (isHovered || isSelected) ? `<circle cx="0" cy="-${scale(12)}" r="${glyphSize + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
        const inner = `<circle cx="0" cy="-${scale(12)}" r="${hitZoneRadius}" fill="transparent"/>${glow}<circle cx="0" cy="-${scale(12)}" r="${glyphSize + scale(5)}" fill="${bgColor}" fill-opacity="${bgOpacity}" stroke="#0d9488" stroke-width="${scale(3.5)}"/><circle cx="${-spacing}" cy="-${scale(12)}" r="${dotSize * 0.6}" fill="white"/><circle cx="0" cy="-${scale(12)}" r="${dotSize * 0.6}" fill="white"/><circle cx="${spacing}" cy="-${scale(12)}" r="${dotSize * 0.6}" fill="white"/>`;
        makeGroup(inner, `translate(${px},${py})`);
        break;
      }

      case 'tangent': {
        const lineShape = shapes.find(s => s.id === c.line); const circleShape = shapes.find(s => s.id === c.circle);
        if(!lineShape || !circleShape || !lineShape.joints || !circleShape.joints) return;
        const la = joints.get(lineShape.joints[0]); const lb = joints.get(lineShape.joints[1]); const center = joints.get(circleShape.joints[0]);
        if(!la || !lb || !center) return;
        const mx = (la.x + lb.x) / 2, my = (la.y + lb.y) / 2;
        const dx = lb.x - la.x, dy = lb.y - la.y; const len = Math.hypot(dx, dy);
        const nx = len > 0 ? -dy/len : 0; const ny = len > 0 ? dx/len : 1; const offset = scale(10);
        const gx = mx + nx * offset, gy = my + ny * offset;
        const isHovered = !preview && hoveredConstraint === c;
        const isSelected = !preview && selectedConstraint === c;
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = '#fbbf24';
        const glow = (isHovered || isSelected) ? `<circle cx="0" cy="0" r="${glyphSize + scale(4)}" fill="#1e40af" fill-opacity="0.15"/>` : '';
        const symbolSize = glyphSize * 0.6;
        const inner = `<circle cx="0" cy="0" r="${hitZoneRadius}" fill="transparent"/>${glow}<circle cx="0" cy="0" r="${glyphSize + scale(5)}" fill="${bgColor}" fill-opacity="${bgOpacity}" stroke="white" stroke-width="${scale(3.5)}"/><circle cx="0" cy="-${scale(3)}" r="${scale(3.5)}" fill="none" stroke="white" stroke-width="${scale(2)}"/><line x1="-${symbolSize}" y1="${scale(6)}" x2="${symbolSize}" y2="${scale(6)}" stroke="white" stroke-width="${scale(2)}"/>`;
        makeGroup(inner, `translate(${gx},${gy})`);
        break;
      }

      default: return;
    }
  }

  // CONSTRAINT GLYPHS - Rendered last so they appear on top of everything
  // glyphSize and hitZoneRadius already defined at top of function
  for(const c of constraints){
    if(c.type === 'coincident' && c.joints && c.joints.length >= 2){
      // Show one glyph per coincident constraint when any of its joints are selected
      const isRelated = c.joints.some(jid => selectedJoints.has(jid)) || selectedConstraint === c;
      if(!isRelated) continue;
      
      // Use whichever joint exists for positioning
      const j1 = joints.get(c.joints[0]) || joints.get(c.joints[1]);
      if(!j1) continue;
      
      const offset = scale(10);
      const x = j1.x + offset, y = j1.y - offset;
      
      const isHovered = hoveredConstraint === c;
      const isSelected = selectedConstraint === c;
      const stroke = (isHovered || isSelected) ? '#1e40af' : '#2563eb';
      const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
      const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
      const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
      const bgColor = '#ef4444'; // red for coincident
      const glowHtml = (isHovered || isSelected) ? `<circle cx="0" cy="0" r="${bgRadius + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
      const symbolSize = glyphSize * 0.6;
      
      drawConstraintGlyph(svg, c);
    } else if(c.type === 'horizontal' && c.joints && c.joints.length >= 2){
      // Horizontal line glyph at midpoint - offset perpendicular (downward)
      const j1 = joints.get(c.joints[0]), j2 = joints.get(c.joints[1]);
      if(j1 && j2){
        const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2 + scale(10); // perpendicular offset
        const isHovered = hoveredConstraint === c;
        const isSelected = selectedConstraint === c;
        const stroke = (isHovered || isSelected) ? '#1e40af' : '#059669';
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = '#22c55e'; // green for horizontal
        const glow = (isHovered || isSelected) ? `<circle cx="${mx}" cy="${my}" r="${bgRadius + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
        const symbolSize = glyphSize * 0.6; // Smaller symbols
        drawConstraintGlyph(svg, c);
      }
    } else if(c.type === 'vertical' && c.joints && c.joints.length >= 2){
      // Vertical line glyph at midpoint - offset perpendicular (rightward)
      const j1 = joints.get(c.joints[0]), j2 = joints.get(c.joints[1]);
      if(j1 && j2){
        const mx = (j1.x + j2.x)/2 + scale(10), my = (j1.y + j2.y)/2; // perpendicular offset
        const isHovered = hoveredConstraint === c;
        const isSelected = selectedConstraint === c;
        const stroke = (isHovered || isSelected) ? '#1e40af' : '#059669';
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = '#22c55e'; // green for vertical
        const glow = (isHovered || isSelected) ? `<circle cx="${mx}" cy="${my}" r="${bgRadius + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
        const symbolSize = glyphSize * 0.6; // Smaller symbols
        drawConstraintGlyph(svg, c);
      }
    } else if(c.type === 'parallel' && c.shapes && c.shapes.length >= 2){
      // Double diagonal lines at midpoint of first shape - offset perpendicular to line
      const s1 = shapes.find(s => s.id === c.shapes[0]);
      if(s1 && s1.joints){
        const j1 = joints.get(s1.joints[0]), j2 = joints.get(s1.joints[1]);
        if(j1 && j2){
          const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
          // Calculate perpendicular direction
          const dx = j2.x - j1.x, dy = j2.y - j1.y;
          const len = Math.hypot(dx, dy);
          const nx = len > 0 ? -dy/len : 0; // perpendicular x
          const ny = len > 0 ? dx/len : 1;  // perpendicular y
          const offset = scale(10);
          const gx = mx + nx * offset, gy = my + ny * offset;
          const isHovered = hoveredConstraint === c;
          const isSelected = selectedConstraint === c;
          const stroke = (isHovered || isSelected) ? '#1e40af' : '#7c3aed';
          const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
          const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
          const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
          const bgColor = '#3b82f6'; // blue for parallel
          const glow = (isHovered || isSelected) ? `<circle cx="0" cy="0" r="${bgRadius + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
          const symbolSize = glyphSize * 0.6; // Smaller symbols
          drawConstraintGlyph(svg, c);
        }
      }
    } else if(c.type === 'perpendicular' && c.shapes && c.shapes.length >= 2){
      // T shape at intersection - offset perpendicular to first line
      const s1 = shapes.find(s => s.id === c.shapes[0]);
      if(s1 && s1.joints){
        const j1 = joints.get(s1.joints[0]), j2 = joints.get(s1.joints[1]);
        if(j1 && j2){
          const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
          // Calculate perpendicular direction
          const dx = j2.x - j1.x, dy = j2.y - j1.y;
          const len = Math.hypot(dx, dy);
          const nx = len > 0 ? -dy/len : 0;
          const ny = len > 0 ? dx/len : 1;
          const offset = scale(10);
          const gx = mx + nx * offset, gy = my + ny * offset;
          const isHovered = hoveredConstraint === c;
          const isSelected = selectedConstraint === c;
          const stroke = (isHovered || isSelected) ? '#1e40af' : '#0891b2';
          const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
          const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
          const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
          const bgColor = '#a855f7'; // purple for perpendicular
          const glow = (isHovered || isSelected) ? `<circle cx="0" cy="0" r="${bgRadius + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
          const symbolSize = glyphSize * 0.6; // Smaller symbols
          drawConstraintGlyph(svg, c);
        }
      }
    } else if(c.type === 'distance' && c.joints && c.joints.length >= 2){
      // Dimension annotation with leader lines
      const j1 = joints.get(c.joints[0]), j2 = joints.get(c.joints[1]);
      if(j1 && j2){
        const offset = c.offset || 30;
        const cIdx = constraints.indexOf(c);
        const canEdit = currentTool === 'select' || currentTool === 'dim';
        
        if(c.isRadius){
          // Circle radius dimension
          const center = j1;
          const radiusPt = j2;
          const radius = Math.hypot(radiusPt.x - center.x, radiusPt.y - center.y);
          const dist = c.value ? c.value.toFixed(1) : radius.toFixed(1);
          
          // Direction from center to label (use offset as radial distance)
          const angle = Math.atan2(radiusPt.y - center.y, radiusPt.x - center.x);
          const labelX = center.x + Math.cos(angle) * offset;
          const labelY = center.y + Math.sin(angle) * offset;
          
          // Leader line from circle edge to label
          const edgeX = center.x + Math.cos(angle) * radius;
          const edgeY = center.y + Math.sin(angle) * radius;
          
          // Draw leader line
          svg.insertAdjacentHTML('beforeend', `<line x1="${edgeX}" y1="${edgeY}" x2="${labelX}" y2="${labelY}" stroke="#2563eb" stroke-width="1.5"/>`);
          
          // Draw radius line
          svg.insertAdjacentHTML('beforeend', `<line x1="${center.x}" y1="${center.y}" x2="${edgeX}" y2="${edgeY}" stroke="#2563eb" stroke-width="1" stroke-dasharray="3,2" stroke-opacity="0.6"/>`);
          
          // Arrow at circle edge
          const arrowSize = 6;
          svg.insertAdjacentHTML('beforeend', `<polygon points="${edgeX},${edgeY} ${edgeX - Math.cos(angle)*arrowSize + Math.sin(angle)*arrowSize/2},${edgeY - Math.sin(angle)*arrowSize - Math.cos(angle)*arrowSize/2} ${edgeX - Math.cos(angle)*arrowSize - Math.sin(angle)*arrowSize/2},${edgeY - Math.sin(angle)*arrowSize + Math.cos(angle)*arrowSize/2}" fill="#2563eb"/>`);
          
          // Label with "R" prefix
          const labelHtml = `<g class="dim-label" data-constraint-idx="${cIdx}" style="cursor:${canEdit ? 'pointer' : 'default'}">
            <rect x="${labelX - 25}" y="${labelY - 10}" width="50" height="18" fill="#9ca3af" fill-opacity="0.9" rx="2" stroke="#2563eb" stroke-width="1.5"/>
            <text x="${labelX}" y="${labelY + 4}" text-anchor="middle" font-size="11" fill="white" font-weight="bold">R ${dist}</text>
          </g>`;
          svg.insertAdjacentHTML('beforeend', labelHtml);
        } else {
          // Linear dimension (line or point-to-point)
          const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
          const dx = j2.x - j1.x, dy = j2.y - j1.y;
          const len = Math.hypot(dx, dy);
          const dist = c.value ? c.value.toFixed(1) : len.toFixed(1);
          
          // Calculate perpendicular direction
          let nx = 0, ny = -1; // default up
          if(len > 0.01){
            nx = -dy / len;
            ny = dx / len;
          }
          
          // Annotation position
          const annotX = mx + nx * offset;
          const annotY = my + ny * offset;
          
          // Extension line endpoints (from joints toward annotation)
          const ext1Start = { x: j1.x + nx * 5, y: j1.y + ny * 5 };
          const ext1End = { x: j1.x + nx * offset, y: j1.y + ny * offset };
          const ext2Start = { x: j2.x + nx * 5, y: j2.y + ny * 5 };
          const ext2End = { x: j2.x + nx * offset, y: j2.y + ny * offset };
          
          // Dimension line (parallel to the measured segment)
          const dimLineStart = ext1End;
          const dimLineEnd = ext2End;
          
          // Draw extension lines
          svg.insertAdjacentHTML('beforeend', `<line x1="${ext1Start.x}" y1="${ext1Start.y}" x2="${ext1End.x}" y2="${ext1End.y}" stroke="#2563eb" stroke-width="1" stroke-opacity="0.6"/>`);
          svg.insertAdjacentHTML('beforeend', `<line x1="${ext2Start.x}" y1="${ext2Start.y}" x2="${ext2End.x}" y2="${ext2End.y}" stroke="#2563eb" stroke-width="1" stroke-opacity="0.6"/>`);
          
          // Draw dimension line with arrows
          svg.insertAdjacentHTML('beforeend', `<line x1="${dimLineStart.x}" y1="${dimLineStart.y}" x2="${dimLineEnd.x}" y2="${dimLineEnd.y}" stroke="#2563eb" stroke-width="1.5"/>`);
          
          // Arrow markers (small triangles at ends)
          const arrowSize = 6;
          const adx = dx / len, ady = dy / len;
          svg.insertAdjacentHTML('beforeend', `<polygon points="${dimLineStart.x},${dimLineStart.y} ${dimLineStart.x + adx*arrowSize + nx*arrowSize/2},${dimLineStart.y + ady*arrowSize + ny*arrowSize/2} ${dimLineStart.x + adx*arrowSize - nx*arrowSize/2},${dimLineStart.y + ady*arrowSize - ny*arrowSize/2}" fill="#2563eb"/>`);
          svg.insertAdjacentHTML('beforeend', `<polygon points="${dimLineEnd.x},${dimLineEnd.y} ${dimLineEnd.x - adx*arrowSize + nx*arrowSize/2},${dimLineEnd.y - ady*arrowSize + ny*arrowSize/2} ${dimLineEnd.x - adx*arrowSize - nx*arrowSize/2},${dimLineEnd.y - ady*arrowSize - ny*arrowSize/2}" fill="#2563eb"/>`);
          
          // Clickable text label with background (only editable in select or dim tool)
          const labelHtml = `<g class="dim-label" data-constraint-idx="${cIdx}" style="cursor:${canEdit ? 'pointer' : 'default'}">
            <rect x="${annotX - 20}" y="${annotY - 10}" width="40" height="18" fill="#9ca3af" fill-opacity="0.9" rx="2" stroke="#2563eb" stroke-width="1.5"/>
            <text x="${annotX}" y="${annotY + 4}" text-anchor="middle" font-size="11" fill="white" font-weight="bold">${dist}</text>
          </g>`;
          svg.insertAdjacentHTML('beforeend', labelHtml);
        }
      }
    } else if(c.type === 'pointOnLine'){
      // Small circle with dot for point-on-line constraint
      // Only show when the joint is selected (same behavior as coincident)
      const isRelated = selectedJoints.has(c.joint);
      if(!isRelated) continue;
      
      const pt = joints.get(c.joint);
      const shape = shapes.find(s => s.id === c.shape);
      if(pt && shape){
        const isHovered = hoveredConstraint === c;
        const isSelected = selectedConstraint === c;
        const stroke = (isHovered || isSelected) ? '#1e40af' : '#f97316';
        const strokeW = (isHovered || isSelected) ? scale(2.5) : scale(1.5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = '#fb923c'; // orange for point-on-line
        const glow = (isHovered || isSelected) ? `<circle cx="0" cy="${-scale(12)}" r="${scale(9)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
        drawConstraintGlyph(svg, c);
      }
    } else if(c.type === 'collinear'){
      // Three dots in a line for collinear constraint
      if(c.joints && c.joints.length >= 3){
        // Position at the middle joint
        const midIdx = Math.floor(c.joints.length / 2);
        const midJoint = joints.get(c.joints[midIdx]);
        if(midJoint){
          const isHovered = hoveredConstraint === c;
          const isSelected = selectedConstraint === c;
          const stroke = (isHovered || isSelected) ? '#1e40af' : '#8b5cf6';
          const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
          const bgColor = '#14b8a6'; // teal for collinear
          const dotSize = scale(2.5);
          const spacing = scale(5);
          const glow = (isHovered || isSelected) ? `<circle cx="0" cy="${-scale(12)}" r="${glyphSize + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
          const jointsStr = c.joints.join(',');
          drawConstraintGlyph(svg, c);
        }
      }
    } else if(c.type === 'tangent'){
      // Circle touching a line for tangent constraint
      const lineShape = shapes.find(s => s.id === c.line);
      const circleShape = shapes.find(s => s.id === c.circle);
      if(lineShape && circleShape && lineShape.joints && circleShape.joints){
        const la = joints.get(lineShape.joints[0]);
        const lb = joints.get(lineShape.joints[1]);
        const center = joints.get(circleShape.joints[0]);
        if(la && lb && center){
          // Position glyph at the midpoint of the line
          const mx = (la.x + lb.x) / 2, my = (la.y + lb.y) / 2;
          const dx = lb.x - la.x, dy = lb.y - la.y;
          const len = Math.hypot(dx, dy);
          const nx = len > 0 ? -dy/len : 0;
          const ny = len > 0 ? dx/len : 1;
          const offset = scale(10);
          const gx = mx + nx * offset, gy = my + ny * offset;
          
          const isHovered = hoveredConstraint === c;
          const isSelected = selectedConstraint === c;
          const stroke = (isHovered || isSelected) ? '#1e40af' : '#f59e0b';
          const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
          const bgColor = '#fbbf24'; // yellow for tangent
          const glow = (isHovered || isSelected) ? `<circle cx="0" cy="0" r="${glyphSize + scale(4)}" fill="${stroke}" fill-opacity="0.15"/>` : '';
          const symbolSize = glyphSize * 0.6; // Smaller symbols
          drawConstraintGlyph(svg, c);
        }
      }
    }
  }
}
