/**
 * Given a constraint and the list of shapes, returns the joints and shapes affected by the constraint.
 * @param {object} constraint - The constraint object
 * @param {Array} shapes - The array of shape objects
 * @returns {{joints: Set<string>, shapes: Set<string>}}
 */
export function getConstrainedGeometry(constraint, shapes) {
  const constraintJoints = new Set();
  const constraintShapes = new Set();
  if (!constraint) return { joints: constraintJoints, shapes: constraintShapes };
  // Debug: log constraint type and ids
  if (typeof window !== 'undefined' && window.console) {
    console.log('[getConstrainedGeometry] type:', constraint.type, 'joints:', constraint.joints, 'shapes:', constraint.shapes, 'constraint:', constraint);
  }
  if (constraint.type === 'coincident' && constraint.joints) {
    for (const jid of constraint.joints) constraintJoints.add(jid);
    for (const s of shapes) {
      if (s.joints && s.joints.some(jid => constraintJoints.has(jid))) {
        constraintShapes.add(s.id);
      }
    }
  } else if ((constraint.type === 'horizontal' || constraint.type === 'vertical') && constraint.joints) {
    for (const jid of constraint.joints) constraintJoints.add(jid);
    for (const s of shapes) {
      if (s.joints && s.joints.some(jid => constraintJoints.has(jid))) {
        constraintShapes.add(s.id);
      }
    }
  } else if ((constraint.type === 'parallel' || constraint.type === 'perpendicular') && constraint.shapes) {
    for (const sid of constraint.shapes) constraintShapes.add(sid);
  } else if (constraint.type === 'collinear' && constraint.joints) {
    for (const jid of constraint.joints) constraintJoints.add(jid);
    for (const s of shapes) {
      if (s.joints && s.joints.some(jid => constraintJoints.has(jid))) {
        constraintShapes.add(s.id);
      }
    }
  } else if (constraint.type === 'tangent') {
    if (constraint.line) constraintShapes.add(constraint.line);
    if (constraint.circle) constraintShapes.add(constraint.circle);
  } else if (constraint.type === 'pointOnLine') {
    if (constraint.joint) constraintJoints.add(constraint.joint);
    if (constraint.shape) constraintShapes.add(constraint.shape);
  } else if (constraint.type === 'distance' && constraint.joints) {
    for (const jid of constraint.joints) constraintJoints.add(jid);
    for (const s of shapes) {
      if (s.joints && s.joints.some(jid => constraintJoints.has(jid))) {
        constraintShapes.add(s.id);
      }
    }
  }
  return { joints: constraintJoints, shapes: constraintShapes };
}
// Constants
export const SNAP_PX = 50; // Joint snap tolerance for general selection (pixels) - increased for touch
export const INFERENCE_SNAP_PX = 15; // Joint snap tolerance for inference hints (pixels) - more restrictive
export const LINE_SNAP_PX = 20; // Line snap tolerance (pixels)
export const DEFAULT_VIEW = { x:0, y:0, w:1200, h:800 };

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRAINT COLORS - Single source of truth for all constraint visualization
// ═══════════════════════════════════════════════════════════════════════════════
export const CONSTRAINT_COLORS = {
  coincident:    { fill: '#ef4444', stroke: '#dc2626' },  // Red
  horizontal:    { fill: '#22c55e', stroke: '#15803d' },  // Green
  vertical:      { fill: '#22c55e', stroke: '#0369a1' },  // Green (blue stroke for distinction)
  parallel:      { fill: '#3b82f6', stroke: '#ca8a04' },  // Blue
  perpendicular: { fill: '#a855f7', stroke: '#7c3aed' },  // Purple
  collinear:     { fill: '#14b8a6', stroke: '#0d9488' },  // Teal
  tangent:       { fill: '#fbbf24', stroke: '#ca8a04' },  // Yellow
  pointOnLine:   { fill: '#fb923c', stroke: '#ea580c' },  // Orange
  distance:      { fill: '#9ca3af', stroke: '#2563eb' },  // Gray/Blue
};


// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRAINT FACTORY - Single place to create constraint objects
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a constraint object with validation
 * @param {string} type - Constraint type
 * @param {object} params - Constraint parameters
 * @returns {object|null} Constraint object or null if invalid
 */
export function createConstraint(type, params) {
  switch(type) {
    case 'coincident':
      if (!params.joints || params.joints.length < 2) return null;
      if (params.joints[0] === params.joints[1]) return null; // Can't coincident to self
      return { type: 'coincident', joints: params.joints };
    
    case 'pointOnLine':
      if (!params.joint || !params.shape) return null;
      return { type: 'pointOnLine', joint: params.joint, shape: params.shape };
    
    case 'horizontal':
    case 'vertical':
      if (!params.joints || params.joints.length < 2) return null;
      return { type, joints: params.joints.slice() };
    
    case 'parallel':
    case 'perpendicular':
      if (!params.shapes || params.shapes.length < 2) return null;
      return { type, shapes: params.shapes };
    
    case 'collinear':
      if (!params.joints || params.joints.length < 3) return null;
      return { type: 'collinear', joints: params.joints.slice() };
    
    case 'tangent':
      if (!params.line || !params.circle) return null;
      return { type: 'tangent', line: params.line, circle: params.circle };
    
    case 'distance':
      if (!params.joints || params.joints.length < 2) return null;
      return { 
        type: 'distance', 
        joints: params.joints, 
        value: params.value,
        offset: params.offset || 30,
        isRadius: params.isRadius || false
      };
    
    default:
      console.warn('Unknown constraint type:', type);
      return null;
  }
}

/**
 * Check if a constraint already exists (duplicate detection)
 * @param {array} constraints - Existing constraints array
 * @param {string} type - Constraint type to check
 * @param {object} params - Constraint parameters
 * @returns {boolean} True if duplicate exists
 */
export function hasConstraint(constraints, type, params) {
  for (const c of constraints) {
    if (c.type !== type) continue;
    
    switch(type) {
      case 'coincident':
        // Check both orderings
        if (c.joints && params.joints) {
          const [a, b] = c.joints;
          const [x, y] = params.joints;
          if ((a === x && b === y) || (a === y && b === x)) return true;
        }
        break;
      
      case 'pointOnLine':
        if (c.joint === params.joint && c.shape === params.shape) return true;
        break;
      
      case 'horizontal':
      case 'vertical':
        // Same joints in any order
        if (c.joints && params.joints) {
          const cSet = new Set(c.joints);
          if (params.joints.every(j => cSet.has(j)) && params.joints.length === c.joints.length) return true;
        }
        break;
      
      case 'parallel':
      case 'perpendicular':
        if (c.shapes && params.shapes) {
          const [a, b] = c.shapes;
          const [x, y] = params.shapes;
          if ((a === x && b === y) || (a === y && b === x)) return true;
        }
        break;
      
      case 'tangent':
        if (c.line === params.line && c.circle === params.circle) return true;
        break;
    }
  }
  return false;
}

/**
 * Add a constraint to the state if it doesn't already exist
 * @param {object} state - App state with constraints array
 * @param {string} type - Constraint type
 * @param {object} params - Constraint parameters
 * @returns {boolean} True if constraint was added
 */
export function addConstraint(state, type, params) {
  // Ignore preview constraints (synthetic previews should never be persisted)
  if (params && params.__isPreview) {
    console.log('[addConstraint] Ignoring preview constraint:', type, params);
    return false;
  }
  // Check for duplicates
  if (hasConstraint(state.constraints, type, params)) {
    console.log('[addConstraint] Duplicate constraint rejected:', type, params);
    return false;
  }
  // Create validated constraint
  const constraint = createConstraint(type, params);
  if (!constraint) {
    console.warn('[addConstraint] Invalid constraint:', type, params);
    return false;
  }
  console.log('[addConstraint] Adding constraint:', constraint);
  state.constraints.push(constraint);
  return true;
}

export function getDist(p1,p2){ return Math.hypot((p1.x-p2.x),(p1.y-p2.y)); }
export function projectPointOnSegment(pt,a,b){ const dx=b.x-a.x, dy=b.y-a.y; const L2=dx*dx+dy*dy; if(L2===0) return {x:a.x,y:a.y}; let t=((pt.x-a.x)*dx + (pt.y-a.y)*dy)/L2; t=Math.max(0,Math.min(1,t)); return {x:a.x + t*dx, y: a.y + t*dy}; }
export function projectPointOnLine(pt,a,b){ const dx=b.x-a.x, dy=b.y-a.y; const L2=dx*dx+dy*dy; if(L2===0) return {x:a.x,y:a.y}; const t=((pt.x-a.x)*dx + (pt.y-a.y)*dy)/L2; return {x:a.x + t*dx, y: a.y + t*dy}; }

export function screenToWorld(svg, screenX, screenY){ 
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal; 
  // Use the actual rendered size of the SVG
  const scaleX = vb.width / rect.width;
  const scaleY = vb.height / rect.height;
  const localX = screenX - rect.left;
  const localY = screenY - rect.top;
  return { x: vb.x + localX * scaleX, y: vb.y + localY * scaleY }; 
}
export function worldToScreen(svg, pt){ 
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal; 
  const scaleX = rect.width / vb.width;
  const scaleY = rect.height / vb.height;
  const localX = (pt.x - vb.x) * scaleX;
  const localY = (pt.y - vb.y) * scaleY;
  return { x: rect.left + localX, y: rect.top + localY }; 
}

export function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

// Rectangle helper: create 4 joints and 4 line shapes from two opposite corners (2-point mode)
// Returns { shapes: [...], constraints: [...] } with H/V constraints on sides
export function makeRectFromTwoJoints(joints, j1Id, j3Id, genJ){
	const j1 = joints.get(j1Id), j3 = joints.get(j3Id); if(!j1||!j3) return { shapes: [], constraints: [] };
	const j2Id = genJ(), j4Id = genJ();
	joints.set(j2Id, { x: j3.x, y: j1.y, fixed:false }); // top-right
	joints.set(j4Id, { x: j1.x, y: j3.y, fixed:false }); // bottom-left
	const gid = 'rect_' + Date.now();
	const shapes = [
		{ id: 's'+Date.now()+'_1', type:'line', joints:[j1Id,j2Id], groupId:gid }, // top (horizontal)
		{ id: 's'+Date.now()+'_2', type:'line', joints:[j2Id,j3Id], groupId:gid }, // right (vertical)
		{ id: 's'+Date.now()+'_3', type:'line', joints:[j3Id,j4Id], groupId:gid }, // bottom (horizontal)
		{ id: 's'+Date.now()+'_4', type:'line', joints:[j4Id,j1Id], groupId:gid }  // left (vertical)
	];
	// Add H/V constraints for axis-aligned rectangle
	const constraints = [
		{ type: 'horizontal', joints: [j1Id, j2Id] }, // top
		{ type: 'vertical', joints: [j2Id, j3Id] },   // right
		{ type: 'horizontal', joints: [j3Id, j4Id] }, // bottom
		{ type: 'vertical', joints: [j4Id, j1Id] }    // left
	];
	return { shapes, constraints };
}

// Rectangle from center point and corner (center mode)
export function makeRectFromCenter(joints, centerId, cornerId, genJ){
	const center = joints.get(centerId), corner = joints.get(cornerId); if(!center||!corner) return [];
	const dx = corner.x - center.x, dy = corner.y - center.y;
	const j1Id = genJ(), j2Id = genJ(), j3Id = genJ(), j4Id = genJ();
	joints.set(j1Id, { x: center.x - dx, y: center.y - dy, fixed:false }); // top-left
	joints.set(j2Id, { x: center.x + dx, y: center.y - dy, fixed:false }); // top-right
	joints.set(j3Id, { x: center.x + dx, y: center.y + dy, fixed:false }); // bottom-right (corner)
	joints.set(j4Id, { x: center.x - dx, y: center.y + dy, fixed:false }); // bottom-left
	// Remove the corner joint we created temporarily, use j3 position
	joints.delete(cornerId);
	const gid = 'rect_' + Date.now();
	return [ { id: 's'+Date.now()+'_1', type:'line', joints:[j1Id,j2Id], groupId:gid }, { id: 's'+Date.now()+'_2', type:'line', joints:[j2Id,j3Id], groupId:gid }, { id: 's'+Date.now()+'_3', type:'line', joints:[j3Id,j4Id], groupId:gid }, { id: 's'+Date.now()+'_4', type:'line', joints:[j4Id,j1Id], groupId:gid } ];
}

// Rectangle from 3 points: p1-p2 define width edge, p3 defines height
export function makeRectFrom3Points(joints, j1Id, j2Id, j3Id, genJ){
	const j1 = joints.get(j1Id), j2 = joints.get(j2Id), j3 = joints.get(j3Id); if(!j1||!j2||!j3) return [];
	// Vector from j1 to j2 (width direction)
	const dx = j2.x - j1.x, dy = j2.y - j1.y;
	const len = Math.hypot(dx, dy); if(len < 0.001) return [];
	// Unit perpendicular vector
	const px = -dy/len, py = dx/len;
	// Project j3 onto perpendicular to get height
	const h = (j3.x - j1.x) * px + (j3.y - j1.y) * py;
	// Create 4th corner
	const j4Id = genJ();
	joints.set(j4Id, { x: j1.x + px * h, y: j1.y + py * h, fixed:false });
	// Update j3 to be proper corner
	j3.x = j2.x + px * h;
	j3.y = j2.y + py * h;
	const gid = 'rect_' + Date.now();
	return [ { id: 's'+Date.now()+'_1', type:'line', joints:[j1Id,j2Id], groupId:gid }, { id: 's'+Date.now()+'_2', type:'line', joints:[j2Id,j3Id], groupId:gid }, { id: 's'+Date.now()+'_3', type:'line', joints:[j3Id,j4Id], groupId:gid }, { id: 's'+Date.now()+'_4', type:'line', joints:[j4Id,j1Id], groupId:gid } ];
}
