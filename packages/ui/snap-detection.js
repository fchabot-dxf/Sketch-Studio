﻿import { worldToScreen, screenToWorld, getZoomFactor } from '#ui/coords.js';
import { projectPointOnSegment, getDist, getArcParams, resolveJoints, arcSweepInfo, angleInArcSweep } from '#core/geometry.js';
import { SNAP, AXIS_SNAP_TARGETS, ORIGIN_JOINT_ID } from '#core/constants.js';
import SettingsManager from '#core/settings-manager.js';
import { findInference } from '#core/inference-engine.js';

// Find joint at screen position
export function hitJointAtScreen(joints, svg, screenX, screenY, threshold=14){
  let best = null, bestD = threshold;
  for(const [id, j] of joints.entries()){ 
    const s = worldToScreen(svg, j); 
    const d = Math.hypot(s.x - screenX, s.y - screenY); 
    if(d < bestD){ 
      bestD = d; 
      best = { id, j }; 
    } 
  }
  return best;
}

// Find line at screen position
export function hitLineAtScreen(joints, shapes, svg, screenX, screenY, threshold=8){
  const w = screenToWorld(svg, screenX, screenY);
  let best = null, bestD = threshold;
  for(const s of shapes){
    if(s.type === 'line'){
      const pts = resolveJoints(joints, s.joints);
      if(!pts) continue;
      const [a, b] = pts;
      
      const proj = projectPointOnSegment(w, a, b);
      
      // FIX: Convert the projected point back to screen space to check distance in pixels
      const sc = worldToScreen(svg, proj);
      const d = Math.hypot(sc.x - screenX, sc.y - screenY);
      
      if(d < bestD){ bestD = d; best = { shape: s, pt: proj }; }
    }
  }
  return best;
}

// Find circle at screen position
export function hitCircleAtScreen(joints, shapes, svg, screenX, screenY, threshold=10){
  const w = screenToWorld(svg, screenX, screenY);
  let best = null, bestD = threshold;
  
  for(const s of shapes){
    if(s.type === 'circle'){
      const center = joints.get(s.joints[0]);
      if(!center) continue;
      if(typeof s.radius !== 'number') continue;
      const radius = s.radius;

      const distToCenter = Math.hypot(w.x - center.x, w.y - center.y);

      const dx = w.x - center.x;
      const dy = w.y - center.y;
      const len = Math.hypot(dx, dy);
      const scale = len > 0.0001 ? radius / len : 0; 
      const closestWorldPt = {
        x: center.x + dx * scale,
        y: center.y + dy * scale
      };
      const closestScreenPt = worldToScreen(svg, closestWorldPt);
      const d = Math.hypot(closestScreenPt.x - screenX, closestScreenPt.y - screenY);

      if(d < bestD){ bestD = d; best = { shape: s, pt: closestWorldPt }; }
    }
  }
  return best;
}

// Find all joints in same coincident cluster
export function findCoincidentCluster(jointId, constraints = []){
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

// TASK 562: the ONE touch reach multiplier. A finger is less exact than a mouse, so EVERY pick reach of findSnap (joint, line / shape,
// midpoint inference, X / Y axis) grows by the same factor when the press is a touch: joint 30 -> 60 px, line 20 -> 40 px, midpoint
// 15 -> 30 px, axis 20 -> 40 px. Callers pass snapBoostFor(isTouch); nothing else multiplies a reach.
export const TOUCH_SNAP_BOOST = 2.0;
export function snapBoostFor(isTouch){ return isTouch ? TOUCH_SNAP_BOOST : 1.0; }

export function findSnap(joints, shapes, svg, lastMouse, excludeIds=[], excludeLineSnap=false, useInferenceTolerance=false, dragBoost=1){
  if(!lastMouse) return null;
  const boost = dragBoost || 1;
  const basePointThreshold = SNAP.JOINT_PX;
  const pointThreshold = basePointThreshold * boost;
  const inferencePx = SNAP.INFERENCE_PX * boost;
  const excluded = Array.isArray(excludeIds) ? excludeIds : (excludeIds ? [excludeIds] : []);

  // Evaluate joints
  let bestJoint = null; let bestJointDist = pointThreshold;
  const jointEntries = Array.from(joints.entries());
  for(let i = jointEntries.length - 1; i >= 0; i--){
    const [id, j] = jointEntries[i];
    if(excluded.includes(id)) continue;
    const s = worldToScreen(svg, j);
    const d = Math.hypot(s.x - lastMouse.x, s.y - lastMouse.y);
    if(d < bestJointDist){ bestJointDist = d; bestJoint = { type: 'joint', targetId: id, x: j.x, y: j.y, dist: d }; }
  }

  // Evaluate shapes (lines, circles, arcs)
  let bestShape = null; let bestShapeDist = Infinity;
  if(!excludeLineSnap){
    const lineThreshold = SNAP.LINE_PX * boost;
    const worldMouse = screenToWorld(svg, lastMouse.x, lastMouse.y);

    // Line→Line midpoint candidates: consider the midpoint between two lines' midpoints
    const visibleLines = shapes.filter(s => s.type === 'line' && Array.isArray(s.joints) && s.joints.length >= 2)
                              .map(s => ({ shape: s, a: joints.get(s.joints[0]), b: joints.get(s.joints[1]), aId: s.joints[0], bId: s.joints[1] }))
                              .filter(l => l.a && l.b);

    for (let i = 0; i < visibleLines.length; i++){
        for (let j = i + 1; j < visibleLines.length; j++){
            const L1 = visibleLines[i], L2 = visibleLines[j];
            const m1 = { x: (L1.a.x + L1.b.x) / 2, y: (L1.a.y + L1.b.y) / 2 };
            const m2 = { x: (L2.a.x + L2.b.x) / 2, y: (L2.a.y + L2.b.y) / 2 };
            const midBetween = { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 };
            const midSC = worldToScreen(svg, midBetween);
            const dmid = Math.hypot(midSC.x - lastMouse.x, midSC.y - lastMouse.y);
            if (dmid < inferencePx && dmid < bestShapeDist) {
                // pick best combo of endpoints (one from each line) as anchors
                const combos = [ [L1.aId, L2.aId], [L1.aId, L2.bId], [L1.bId, L2.aId], [L1.bId, L2.bId] ];
                let bestCombo = null, bestComboDist = Infinity;
                for (const [xId, yId] of combos) {
                    const x = joints.get(xId), y = joints.get(yId);
                    if (!x || !y) continue;
                    const mm = { x: (x.x + y.x) / 2, y: (x.y + y.y) / 2 };
                    const mmSC = worldToScreen(svg, mm);
                    const dd = Math.hypot(mmSC.x - midSC.x, mmSC.y - midSC.y);
                    if (dd < bestComboDist) { bestComboDist = dd; bestCombo = [xId, yId]; }
                }
                if (bestCombo) {
                    bestShapeDist = dmid;
                    bestShape = { type: 'midpoint', targetId: null, x: midBetween.x, y: midBetween.y, joints: bestCombo, dist: dmid, pt: midBetween };
                }
            }
        }
    }
    for(const s of shapes){
      if(s.joints && s.joints.some(jid => excluded.includes(jid))) continue;
      let dist = Infinity;
      let snapPt = null;

      if(s.type === 'line') {
        const pts = resolveJoints(joints, s.joints);
        if(!pts) continue;
        const [a, b] = pts;
        snapPt = projectPointOnSegment(worldMouse, a, b);
        const sc = worldToScreen(svg, snapPt);
        dist = Math.hypot(sc.x - lastMouse.x, sc.y - lastMouse.y);

        // Midpoint candidate: treat midpoint as a first-class snap so it participates
        // in the same lock/hysteresis behavior as other snaps (uses SNAP.INFERENCE_PX).
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const midSC = worldToScreen(svg, mid);
        const dmid = Math.hypot(midSC.x - lastMouse.x, midSC.y - lastMouse.y);
        // Bias allowance so midpoint can win even if projection point is slightly closer
        const MIDPOINT_BIAS = 2; // pixels

        // Decide whether midpoint or closest projected point wins for this segment
        let chosen = null; // { type: 'midpoint'|'shape', dist, pt }
        if (dmid < inferencePx && dmid <= dist + MIDPOINT_BIAS && dmid <= lineThreshold) {
          chosen = { type: 'midpoint', dist: dmid, pt: mid };
        } else if (dist < lineThreshold) {
          chosen = { type: 'shape', dist: dist, pt: snapPt };
        }

        if (chosen && chosen.dist < bestShapeDist) {
          bestShapeDist = chosen.dist;
          if (chosen.type === 'midpoint') {
            bestShape = { type: 'midpoint', targetId: s.id, x: mid.x, y: mid.y, shape: s, dist: chosen.dist, pt: mid };
          } else {
            bestShape = { type: 'shape', targetId: s.id, x: snapPt.x, y: snapPt.y, shape: s, dist: chosen.dist };
          }
        }
      } else if (s.type === 'circle') {
        const center = joints.get(s.joints[0]);
        let radius = (typeof s.radius === 'number') ? s.radius : 0;
        if (!radius && s.joints.length >= 2) radius = getDist(center, joints.get(s.joints[1]));
        if (center && radius > 0) {
          const dx = worldMouse.x - center.x;
          const dy = worldMouse.y - center.y;
          const len = Math.hypot(dx, dy);
          if (len > 0.0001) {
            snapPt = { x: center.x + (dx/len)*radius, y: center.y + (dy/len)*radius };
            const sc = worldToScreen(svg, snapPt);
            dist = Math.hypot(sc.x - lastMouse.x, sc.y - lastMouse.y);
          }
        }
      } else if (s.type === 'arc') {
        let center, radius;
        // Center-based arc: joint[0] = center, joint[1] = start, joint[2] = end
        center = joints.get(s.joints[0]);
        const start = joints.get(s.joints[1]);
        const end = joints.get(s.joints[2]);
        if (center && start) radius = getDist(center, start);

        if (center && end && radius > 0) {
          const dx = worldMouse.x - center.x;
          const dy = worldMouse.y - center.y;
          const len = Math.hypot(dx, dy);
          if (len > 0.0001) {
            // TASK 550 (EA-10): the arc is hit only on its DRAWN sweep (geometry.js arcSweepInfo, the renderer's sweep): the nearest point of the
            // arc is the mouse's projection on the circle when that falls inside the sweep, else the nearer end -- never the rest of the circle
            if (angleInArcSweep(arcSweepInfo(center, start, end, { sweep: s.sweep }), Math.atan2(dy, dx))) {
              snapPt = { x: center.x + (dx/len)*radius, y: center.y + (dy/len)*radius };
            } else {
              snapPt = getDist(worldMouse, start) <= getDist(worldMouse, end) ? { x: start.x, y: start.y } : { x: end.x, y: end.y };
            }
            const sc = worldToScreen(svg, snapPt);
            dist = Math.hypot(sc.x - lastMouse.x, sc.y - lastMouse.y);
          }
        }
      }

      // Only accept a 'shape' snap if it's significantly closer than any midpoint preference
      // This prevents tiny projection advantages from overriding a nearby midpoint snap.
      const MIDPOINT_BIAS = 2; // pixels
      if(snapPt && dist < lineThreshold && dist + MIDPOINT_BIAS < bestShapeDist){
        bestShapeDist = dist;
        bestShape = { type: 'shape', targetId: s.id, x: snapPt.x, y: snapPt.y, shape: s, dist };
      }
    }
  }
  // Priority: Joint > Shape (if close enough to joint, joint wins) > X / Y axis. The axis is the last real target: any joint
  // (the origin included), point-on-line or midpoint is a more specific feature and beats it; only the bare grid is below it.
  const JOINT_PRIORITY_RADIUS = 15; 
  if (bestJoint && bestJoint.dist < JOINT_PRIORITY_RADIUS) return bestJoint;
  if(bestJoint && bestShape) return (bestJoint.dist <= bestShape.dist) ? bestJoint : bestShape;
  if(bestJoint) return bestJoint;
  if(bestShape) return bestShape;
  return findAxisSnap(joints, svg, lastMouse, excluded, excludeLineSnap, boost);
}

// The X axis (y = 0) / Y axis (x = 0) snap candidate nearest the pointer, or null. The target point is the pointer's foot on the
// axis (its coordinate across the axis is exactly 0, the one along it is free). It exists only where the host has the origin joint
// the constraint hangs on (the axes are drawn by the shared renderer around that same origin) and only while AXIS_SNAP is on.
function findAxisSnap(joints, svg, lastMouse, excluded, excludeLineSnap, boost = 1){
  if(excludeLineSnap || SettingsManager.get('AXIS_SNAP') === false) return null;
  if(!joints.has(ORIGIN_JOINT_ID) || excluded.includes(ORIGIN_JOINT_ID)) return null;
  const w = screenToWorld(svg, lastMouse.x, lastMouse.y);
  let best = null, bestDist = SNAP.AXIS_PX * boost;
  for(const [type, axis] of Object.entries(AXIS_SNAP_TARGETS)){
    const pt = { x: w.x, y: w.y }; pt[axis.across] = 0;
    const sc = worldToScreen(svg, pt);
    const d = Math.hypot(sc.x - lastMouse.x, sc.y - lastMouse.y);
    if(d < bestDist){ bestDist = d; best = { type, targetId: type, x: pt.x, y: pt.y, pt, dist: d }; }
  }
  return best;
}

export function hitConstraintAtScreen(constraints, svg, screenX, screenY, threshold = 14) {
    const mouseW = screenToWorld(svg, screenX, screenY);
    const zoomFactor = getZoomFactor(svg);
    for (const c of constraints) {
        if (c.__visible === false) continue;
        if (c.glyphPos) {
            const positions = Array.isArray(c.glyphPos) ? c.glyphPos : [c.glyphPos];
            for (const pos of positions) {
                if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') continue;
                const dist = Math.hypot(mouseW.x - pos.x, mouseW.y - pos.y);
                if (dist < threshold * zoomFactor) {
                    return c;
                }
            }
        }
    }
    return null;
}
