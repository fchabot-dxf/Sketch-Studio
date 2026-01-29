import { worldToScreen, screenToWorld, projectPointOnSegment } from './1-utils.js';
import { SNAP_PX, INFERENCE_SNAP_PX, LINE_SNAP_PX } from './1-utils.js';

export function hitJointAtScreen(joints, svg, screenX, screenY, threshold=14){
  let best=null, bestD=threshold;
  for(const [id,j] of joints.entries()){ const s = worldToScreen(svg, j); const d = Math.hypot(s.x - screenX, s.y - screenY); if(d < bestD){ bestD = d; best = { id, j }; } }
  return best;
}

// Find line at screen position
export function hitLineAtScreen(joints, shapes, svg, screenX, screenY, threshold=8){
  const w = screenToWorld(svg, screenX, screenY);
  let best = null, bestD = threshold;
  for(const s of shapes){
    if(s.type === 'line'){
      const a = joints.get(s.joints[0]), b = joints.get(s.joints[1]);
      if(!a || !b) continue;
      const proj = projectPointOnSegment(w, a, b);
      const sc = worldToScreen(svg, proj);
      const d = Math.hypot(sc.x - screenX, sc.y - screenY);
      if(d < bestD){ bestD = d; best = { shape: s, pt: proj }; }
    }
  }
  return best;
}

// Find circle at screen position (closest point on circumference)
export function hitCircleAtScreen(joints, shapes, svg, screenX, screenY, threshold=10){
  const w = screenToWorld(svg, screenX, screenY);
  let best = null, bestD = threshold;
  for(const s of shapes){
    if(s.type === 'circle'){
      const center = joints.get(s.joints[0]);
      const edge = joints.get(s.joints[1]);
      if(!center || !edge) continue;
      const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
      if(radius <= 1e-6) continue;
      // Project mouse onto circle along radial direction
      const vx = w.x - center.x, vy = w.y - center.y;
      const vlen = Math.hypot(vx, vy);
      const onCirc = vlen > 0 ? { x: center.x + vx * (radius / vlen), y: center.y + vy * (radius / vlen) } : { x: center.x + radius, y: center.y };
      const sc = worldToScreen(svg, onCirc);
      const d = Math.hypot(sc.x - screenX, sc.y - screenY);
      if(d < bestD){ bestD = d; best = { shape: s, pt: onCirc }; }
    }
  }
  return best;
}

// Find all joints in same coincident cluster
export function findCoincidentCluster(jointId, constraints){
  const cluster = new Set([jointId]);
  let changed = true;
  while(changed){
    changed = false;
    for(const c of constraints){
      if(c.type === 'coincident'){
        const [j1, j2] = c.joints;
        if(cluster.has(j1) && !cluster.has(j2)){ cluster.add(j2); changed = true; }
        if(cluster.has(j2) && !cluster.has(j1)){ cluster.add(j1); changed = true; }
      }
    }
  }
  return cluster;
}

export function findSnap(joints, shapes, svg, lastMouse, excludeIds=[], excludeLineSnap=false, useInferenceTolerance=false){
  if(!lastMouse) return null;
  // Use tighter tolerance for inference snaps on points
  const pointThreshold = useInferenceTolerance ? INFERENCE_SNAP_PX : SNAP_PX;
  // Normalize excludeIds to array
  const excluded = Array.isArray(excludeIds) ? excludeIds : (excludeIds ? [excludeIds] : []);
  let best=null; let bestDist=pointThreshold;
  // Always check joint snapping first (higher priority)
  for(const [id,j] of joints.entries()){ 
    if(excluded.includes(id)) continue;
    const s=worldToScreen(svg,j); 
    const d=Math.hypot(s.x-lastMouse.x,s.y-lastMouse.y); 
    if(d<bestDist){ bestDist=d; best={type:'joint',id,pt:{x:j.x,y:j.y}}; } 
  }
  // If joint was found, return it immediately - joints have absolute priority
  if(best && best.type === 'joint'){
    return best;
  }
  // Only check line snapping if not excluded and no joint snap found
  // Use smaller tolerance for lines so joints have priority
  if(!excludeLineSnap){
    const lineThreshold = LINE_SNAP_PX;
    for(const s of shapes){ 
      if(s.type==='line'){ 
        // Skip lines that contain any excluded joint
        if(s.joints.some(jid => excluded.includes(jid))) continue;
        const a=joints.get(s.joints[0]), b=joints.get(s.joints[1]); 
        if(!a||!b) continue; 
        const vp = projectPointOnSegment(screenToWorld(svg,lastMouse.x,lastMouse.y), a, b); 
        const sc = worldToScreen(svg, vp); 
        const d=Math.hypot(sc.x-lastMouse.x, sc.y-lastMouse.y); 
        if(d<lineThreshold){ bestDist=d; best={type:'line',shape:s,pt:vp}; } 
      } 
    }
  }
  return best;
}

// Find inference hints (horizontal, vertical, perpendicular) for line drawing
// Returns {type: 'horizontal'|'vertical'|'perpendicular', pt: {x,y}, refLine?: shape}
export function findInference(startPt, endPt, shapes, joints, snapTarget){
  if(!startPt || !endPt) return null;
  
  const ANGLE_THRESHOLD = 5; // degrees tolerance for snapping to horizontal/vertical/perpendicular
  const dx = endPt.x - startPt.x;
  const dy = endPt.y - startPt.y;
  const len = Math.hypot(dx, dy);
  if(len < 0.1) return null; // Too short to infer direction
  
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  
  // Check horizontal (0° or ±180°)
  const horizontalDiff = Math.min(Math.abs(angle), Math.abs(Math.abs(angle) - 180));
  if(horizontalDiff < ANGLE_THRESHOLD){
    return { type: 'horizontal', pt: { x: endPt.x, y: startPt.y } };
  }
  
  // Check vertical (±90°)
  const verticalDiff = Math.abs(Math.abs(angle) - 90);
  if(verticalDiff < ANGLE_THRESHOLD){
    return { type: 'vertical', pt: { x: startPt.x, y: endPt.y } };
  }
  
  // Check perpendicular to other lines
  // Find reference line: either the line we're snapping to, or the last drawn line
  let refLine = null;
  
  // Priority 1: If snapping to a line, use that
  if(snapTarget && snapTarget.type === 'line'){
    refLine = snapTarget.shape;
  }
  
  // Priority 2: Find most recent line that shares the start point
  if(!refLine){
    for(let i = shapes.length - 1; i >= 0; i--){
      const s = shapes[i];
      if(s.type === 'line'){
        const j1 = s.joints[0];
        const j2 = s.joints[1];
        // Check if this line connects to our start point
        const a = joints.get(j1);
        const b = joints.get(j2);
        if(!a || !b) continue;
        
        // Check if start point is at either end of this line
        const distToA = Math.hypot(startPt.x - a.x, startPt.y - a.y);
        const distToB = Math.hypot(startPt.x - b.x, startPt.y - b.y);
        if(distToA < 0.1 || distToB < 0.1){
          refLine = s;
          break;
        }
      }
    }
  }
  
  // Check perpendicularity to reference line
  if(refLine && refLine.type === 'line'){
    const ra = joints.get(refLine.joints[0]);
    const rb = joints.get(refLine.joints[1]);
    if(ra && rb){
      const rdx = rb.x - ra.x;
      const rdy = rb.y - ra.y;
      const rlen = Math.hypot(rdx, rdy);
      if(rlen > 0.1){
        const refAngle = Math.atan2(rdy, rdx) * 180 / Math.PI;
        const perpAngle1 = refAngle + 90;
        const perpAngle2 = refAngle - 90;
        
        // Normalize angles to -180 to 180
        const normAngle = ((angle % 360) + 540) % 360 - 180;
        const normPerp1 = ((perpAngle1 % 360) + 540) % 360 - 180;
        const normPerp2 = ((perpAngle2 % 360) + 540) % 360 - 180;
        
        const perpDiff1 = Math.abs(normAngle - normPerp1);
        const perpDiff2 = Math.abs(normAngle - normPerp2);
        const minPerpDiff = Math.min(perpDiff1, perpDiff2);
        
        if(minPerpDiff < ANGLE_THRESHOLD){
          // Calculate the perpendicular end point
          const perpAngleRad = (perpDiff1 < perpDiff2 ? perpAngle1 : perpAngle2) * Math.PI / 180;
          const perpPt = {
            x: startPt.x + len * Math.cos(perpAngleRad),
            y: startPt.y + len * Math.sin(perpAngleRad)
          };
          return { type: 'perpendicular', pt: perpPt, refLine };
        }
      }
    }
  }
  
  return null;
}
