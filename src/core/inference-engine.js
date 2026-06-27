import { INFERENCE_TYPES, ANGLE_SNAP_DEG,  SNAP } from './constants.js';

// Limit parallel/perpendicular inference to nearby references to avoid noisy hints
const MAX_REF_DIST = 10; // world units; keep hints local but usable

function pointToSegmentDistance(p, a, b){
  if(!p || !a || !b) return Infinity;
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const segLenSq = vx*vx + vy*vy;
  if(segLenSq === 0) return Math.hypot(wx, wy);
  let t = (wx*vx + wy*vy) / segLenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t*vx;
  const projY = a.y + t*vy;
  return Math.hypot(p.x - projX, p.y - projY);
}

export function findInference(startPt, endPt, shapes, joints, snapTarget, options = {}){
  if(!startPt || !endPt) return null;

  const dx = endPt.x - startPt.x;
  const dy = endPt.y - startPt.y;
  const len = Math.hypot(dx, dy);
  if(len < 0.1) return null; // Too short to infer direction

  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  // MIDPOINT check: only consider single-line midpoint inference and only when the
  // dragged element is a joint (joint→line). Line→line midpoint inference is disabled.
  const MIDPOINT = SNAP.MIDPOINT;

  const isDraggingJoint = options && options.draggedType === 'joint';
  const draggedJointId = options && options.draggedId;

  // When dragging a joint, check if attached lines are becoming horizontal/vertical first
  if(isDraggingJoint && draggedJointId){
    // Find all lines attached to the dragged joint
    const attachedLines = shapes.filter(s => 
      s && s.type === 'line' && s.joints && 
      (s.joints[0] === draggedJointId || s.joints[1] === draggedJointId)
    );

    for(const attachedLine of attachedLines){
      const j1 = joints.get(attachedLine.joints[0]);
      const j2 = joints.get(attachedLine.joints[1]);
      if(!j1 || !j2) continue;

      // Find which endpoint is fixed (the one that's not being dragged)
      const fixedJoint = (attachedLine.joints[0] === draggedJointId) ? j2 : j1;

      // Vector from fixed endpoint to current drag position
      const dragDx = endPt.x - fixedJoint.x;
      const dragDy = endPt.y - fixedJoint.y;
      const dragAngle = Math.atan2(dragDy, dragDx) * 180 / Math.PI;
      const dragDist = Math.hypot(dragDx, dragDy);

      // FIRST: Check if this line would be parallel/perpendicular to other lines (prefer matching existing lines)
      // Use the SIGNED angle difference (not absolute) so we can tell whether
      // the dragged line is parallel-same or anti-parallel to the reference,
      // and which side of perpendicular it's on. Otherwise the snap pos
      // computed from `otherAngle` flips the dragged line 180°.
      for(const otherShape of shapes){
        if(!otherShape || otherShape === attachedLine) continue;
        if(otherShape.type === 'line' && otherShape.joints && otherShape.joints.length >= 2){
          const oa = joints.get(otherShape.joints[0]);
          const ob = joints.get(otherShape.joints[1]);
          if(!oa || !ob) continue;

          const otherDx = ob.x - oa.x;
          const otherDy = ob.y - oa.y;
          const otherAngle = Math.atan2(otherDy, otherDx) * 180 / Math.PI;

          // Signed difference, normalized to (-180, 180]
          let signedDiff = dragAngle - otherAngle;
          while (signedDiff > 180) signedDiff -= 360;
          while (signedDiff <= -180) signedDiff += 360;
          const absDiff = Math.abs(signedDiff);

          // Parallel: dragged line is within SNAP° of either same-direction (0)
          // or anti-parallel (±180). Pick the matching branch so the dragged
          // line keeps its current orientation.
          const isParaSame = absDiff < ANGLE_SNAP_DEG;
          const isParaOpp  = Math.abs(absDiff - 180) < ANGLE_SNAP_DEG;
          if(isParaSame || isParaOpp){
            const targetAngleDeg = isParaOpp ? (otherAngle + 180) : otherAngle;
            const rad = targetAngleDeg * Math.PI / 180;
            const snapPos = {
              x: fixedJoint.x + dragDist * Math.cos(rad),
              y: fixedJoint.y + dragDist * Math.sin(rad)
            };
            return { type: INFERENCE_TYPES.PARALLEL, pos: snapPos, targetId: otherShape.id, refLine: { id: otherShape.id, p1: oa, p2: ob } };
          }

          // Perpendicular: dragged line is within SNAP° of either +90 or -90
          // from the reference. signedDiff sign tells us which side.
          const isPerpPlus  = Math.abs(signedDiff -  90) < ANGLE_SNAP_DEG;
          const isPerpMinus = Math.abs(signedDiff - (-90)) < ANGLE_SNAP_DEG;
          if(isPerpPlus || isPerpMinus){
            const targetAngleDeg = isPerpPlus ? (otherAngle + 90) : (otherAngle - 90);
            const rad = targetAngleDeg * Math.PI / 180;
            const snapPos = {
              x: fixedJoint.x + dragDist * Math.cos(rad),
              y: fixedJoint.y + dragDist * Math.sin(rad)
            };
            return { type: INFERENCE_TYPES.PERPENDICULAR, pos: snapPos, targetId: otherShape.id, refLine: { id: otherShape.id, p1: oa, p2: ob } };
          }
        }
      }

      // FALLBACK: Check if the dragged line is becoming horizontal
      const horizontalDiff = Math.min(Math.abs(dragAngle), Math.abs(Math.abs(dragAngle) - 180));
      if(horizontalDiff < ANGLE_SNAP_DEG){
        return { type: INFERENCE_TYPES.HORIZONTAL, pos: { x: endPt.x, y: fixedJoint.y }, targetId: null };
      }

      // FALLBACK: Check if the dragged line is becoming vertical
      const verticalDiff = Math.abs(Math.abs(dragAngle) - 90);
      if(verticalDiff < ANGLE_SNAP_DEG){
        return { type: INFERENCE_TYPES.VERTICAL, pos: { x: fixedJoint.x, y: endPt.y }, targetId: null };
      }
    }
  }


  // MIDPOINT inference (joint→line only): runs BEFORE the global parallel /
  // perpendicular / H/V scans because midpoint snapping is more specific —
  // dragging a free joint toward a line's midpoint should win over a
  // coincidentally-parallel cursor displacement. Threshold is inclusive (<=)
  // so geometry that lands exactly on the cap still snaps.
  {
    const draggedIsJointEarly = options && options.draggedType === 'joint';
    if (draggedIsJointEarly && Array.isArray(shapes) && shapes.length > 0) {
      for (const shape of shapes) {
        if (shape && shape.type === 'line' && shape.joints && shape.joints.length >= 2) {
          const a = joints.get(shape.joints[0]);
          const b = joints.get(shape.joints[1]);
          if (!a || !b) continue;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const dmid = Math.hypot(endPt.x - mid.x, endPt.y - mid.y);
          const lineLen = Math.hypot(b.x - a.x, b.y - a.y);
          const MID_THRESH = Math.max(MIDPOINT.MIN, Math.min(MIDPOINT.MAX, lineLen * MIDPOINT.PCT));
          if (dmid <= MID_THRESH) return { type: INFERENCE_TYPES.MIDPOINT, pos: mid, targetId: shape.id, refLine: { id: shape.id, p1: a, p2: b } };
        }
      }
    }
  }

  // Fallback H/V check based on the (startPt → endPt) displacement angle.
  //
  // This is the right signal when *drawing* a new line (startPt is the line's
  // start, endPt is the cursor → displacement IS the line). It is the wrong
  // signal during a *drag* — `startPt` is the joint's initial position and
  // `endPt` is the cursor, so `angle` is the joint's motion direction, not
  // any actual line's orientation. The smart per-attached-line H/V check
  // above (inside the joint-drag block) already handles the drag case
  // correctly, so skip this fallback whenever a drag is in progress.
  if(!options || !options.draggedId){
    // Check horizontal (0° or ±180°)
    const horizontalDiff = Math.min(Math.abs(angle), Math.abs(Math.abs(angle) - 180));
    if(horizontalDiff < ANGLE_SNAP_DEG){
      return { type: INFERENCE_TYPES.HORIZONTAL, pos: { x: endPt.x, y: startPt.y }, targetId: null };
    }

    // Check vertical (±90°)
    const verticalDiff = Math.abs(Math.abs(angle) - 90);
    if(verticalDiff < ANGLE_SNAP_DEG){
      return { type: INFERENCE_TYPES.VERTICAL, pos: { x: startPt.x, y: endPt.y }, targetId: null };
    }
  }

  // Check perpendicular to other lines
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
        const a = joints.get(j1);
        const b = joints.get(j2);
        if(!a || !b) continue;

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

        const normAngle = ((angle % 360) + 540) % 360 - 180;
        const normPerp1 = ((perpAngle1 % 360) + 540) % 360 - 180;
        const normPerp2 = ((perpAngle2 % 360) + 540) % 360 - 180;

        const perpDiff1 = Math.abs(normAngle - normPerp1);
        const perpDiff2 = Math.abs(normAngle - normPerp2);
        const minPerpDiff = Math.min(perpDiff1, perpDiff2);

        if(minPerpDiff < ANGLE_SNAP_DEG){
          const perpAngleRad = (perpDiff1 < perpDiff2 ? perpAngle1 : perpAngle2) * Math.PI / 180;
          const perpPt = {
            x: startPt.x + len * Math.cos(perpAngleRad),
            y: startPt.y + len * Math.sin(perpAngleRad)
          };
          return { type: INFERENCE_TYPES.PERPENDICULAR, pos: perpPt, targetId: refLine.id, refLine };
        }


      }
    }
  }

  // --- GLOBAL PARALLEL SCAN: iterate all visible lines for potential parallel inference ---
  try{
    const currentAngle = Math.atan2(endPt.y - startPt.y, endPt.x - startPt.x) * 180 / Math.PI;
    const normAngle = ((currentAngle % 360) + 360) % 360;
    const isDraggingJoint = options && options.draggedType === 'joint';
    for(const shape of shapes){
      if(!shape) continue;



      // PARALLEL check for lines
      if(shape.type === 'line' && shape.joints && shape.joints.length >= 2){
        const a = joints.get(shape.joints[0]);
        const b = joints.get(shape.joints[1]);
        if(!a || !b) continue;
        // Skip segments that include the start point only when drawing (avoid self-noise)
        // When dragging a joint, we want to check lines attached to it for parallel/perpendicular
        if(!isDraggingJoint){
          const eps = 0.1;
          if(Math.hypot(a.x - startPt.x, a.y - startPt.y) < eps || Math.hypot(b.x - startPt.x, b.y - startPt.y) < eps) continue;
        }

        const refDx = b.x - a.x, refDy = b.y - a.y;
        const refAngle = Math.atan2(refDy, refDx) * 180 / Math.PI;
        const refNorm = ((refAngle % 360) + 360) % 360;
        let diff = Math.abs(normAngle - refNorm);
        if(diff > 180) diff = 360 - diff; // clamp to [0,180]

        // Require proximity to the reference to reduce false positives
        const distStart = pointToSegmentDistance(startPt, a, b);
        const distEnd = pointToSegmentDistance(endPt, a, b);
        if(distStart > MAX_REF_DIST && distEnd > MAX_REF_DIST) continue;

        if(diff < ANGLE_SNAP_DEG || Math.abs(diff - 180) < ANGLE_SNAP_DEG){
          // Project current mouse vector onto reference direction so the hint 'sticks'
          const dx = endPt.x - startPt.x, dy = endPt.y - startPt.y;
          const rad = refAngle * Math.PI / 180;
          const rx = Math.cos(rad), ry = Math.sin(rad);
          const dist = dx * rx + dy * ry; // dot product
          const snapPos = { x: startPt.x + dist * rx, y: startPt.y + dist * ry };
          return { type: INFERENCE_TYPES.PARALLEL, pos: snapPos, targetId: shape.id, refLine: { id: shape.id, p1: a, p2: b } };
        }
      }

      // TANGENT check for circles/arcs — only handle the simple case where startPt lies on the circle/arc perimeter
      if((shape.type === 'circle' || shape.type === 'arc') && shape.joints && shape.joints.length >= 1){
        const center = joints.get(shape.joints[0]);
        if(!center) continue;
        // Radius for circle stored on shape; for arc we derive from center->start joint
        let radius = (typeof shape.radius === 'number') ? shape.radius : null;
        if(shape.type === 'arc' && shape.joints && shape.joints[1]){
          const startJ = joints.get(shape.joints[1]);
          if(startJ) radius = Math.hypot(startJ.x - center.x, startJ.y - center.y);
        }
        if(radius == null) continue;
        const d = Math.hypot(startPt.x - center.x, startPt.y - center.y);
        // Consider startPt 'on' the circle if distance approx equals radius
        if(Math.abs(d - radius) < 0.5){
          // Tangent directions are perpendicular to radius at this point
          const vx = startPt.x - center.x, vy = startPt.y - center.y;
          const angleToPoint = Math.atan2(vy, vx) * 180 / Math.PI;
          const tangentAngle1 = angleToPoint + 90;
          const tangentAngle2 = angleToPoint - 90;
          const normAngleToUse = ((angle % 360) + 360) % 360; // current drawing angle

          const t1 = ((tangentAngle1 % 360) + 360) % 360; const t2 = ((tangentAngle2 % 360) + 360) % 360;
          let diff1 = Math.abs(normAngleToUse - t1); if(diff1 > 180) diff1 = 360 - diff1;
          let diff2 = Math.abs(normAngleToUse - t2); if(diff2 > 180) diff2 = 360 - diff2;
          const minDiff = Math.min(diff1, diff2);
          if (minDiff < ANGLE_SNAP_DEG){
            // Emit inferred tangent, with snap position projected along chosen tangent
            const chosen = (diff1 < diff2) ? tangentAngle1 : tangentAngle2;
            const rad = chosen * Math.PI / 180;
            const pos = { x: startPt.x + len * Math.cos(rad), y: startPt.y + len * Math.sin(rad) };
            return { type: INFERENCE_TYPES.TANGENT, pos, targetId: shape.id, refCircle: { id: shape.id, center, radius } };
          }
        }
      }
    }
  }catch(_){ }

  // (MIDPOINT joint→line check runs earlier — see the block right after the
  // joint-attached-line section. Kept here as a no-op to flag the intent.)

  return null;
}