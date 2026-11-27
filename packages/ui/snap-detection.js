﻿import { worldToScreen, screenToWorld, getZoomFactor } from '#ui/coords.js';
import { projectPointOnSegment, projectPointOnLine, getDist, resolveJoints, arcSweepInfo, angleInArcSweep, arcSweepMidpoint } from '#core/geometry.js';
import { SNAP, AXIS_SNAP_TARGETS, ORIGIN_JOINT_ID } from '#core/constants.js';
import SettingsManager from '#core/settings-manager.js';
import { findInference } from '#core/inference-engine.js';
import { referenceEnds } from '#core/reference-lines.js';
import { CURVE_KINDS } from '#core/curve-kinds.js'; // TASK 762: a bezier's body is its declared curve

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
// midpoint inference, X / Y axis) grows by the same factor when the press is a touch: joint 30 -> 60 px, line
// 20 -> 40 px, midpoint 15 -> 30 px, axis 20 -> 40 px. Callers pass snapBoostFor(isTouch); nothing else multiplies a reach.
export const TOUCH_SNAP_BOOST = 2.0;
export function snapBoostFor(isTouch){ return isTouch ? TOUCH_SNAP_BOOST : 1.0; }

// TASK 1020: THE point of curve s nearest the world point w (a line's segment; a built-in reference line's whole, endless line; a circle; an arc's
// DRAWN sweep, else its nearer end; a bezier's declared curve), or null (no such point: a degenerate curve, w on a circle's or arc's centre, or w
// farther than reachPx screen px from a bezier's box). The pointer's hit (findSnap) and the point-on-curve test of its point priority both use it.
function nearestPointOn(s, joints, w, svg, reachPx) {
  if (s.type === 'line') {
    const pts = s.reference ? referenceEnds(s) : resolveJoints(joints, s.joints);
    if (!pts) return null;
    const [a, b] = pts;
    // A built-in reference line (task 539: an axis, offered only while a tool asks for a target) is ENDLESS and has no midpoint
    // (its two stored points are only a direction): the foot of the pointer on the whole line, never a segment end.
    return s.reference ? projectPointOnLine(w, a, b) : projectPointOnSegment(w, a, b);
  }
  if (s.type === 'circle') {
    const center = joints.get(s.joints[0]);
    let radius = (typeof s.radius === 'number') ? s.radius : 0;
    if (!radius && s.joints.length >= 2) radius = getDist(center, joints.get(s.joints[1]));
    if (!center || !(radius > 0)) return null;
    const dx = w.x - center.x, dy = w.y - center.y, len = Math.hypot(dx, dy);
    return len > 0.0001 ? { x: center.x + (dx / len) * radius, y: center.y + (dy / len) * radius } : null;
  }
  if (s.type === 'arc') {
    // Center-based arc: joint[0] = center, joint[1] = start, joint[2] = end
    const center = joints.get(s.joints[0]), start = joints.get(s.joints[1]), end = joints.get(s.joints[2]);
    const radius = (center && start) ? getDist(center, start) : 0;
    if (!center || !end || !(radius > 0)) return null;
    const dx = w.x - center.x, dy = w.y - center.y, len = Math.hypot(dx, dy);
    if (len <= 0.0001) return null;
    // TASK 550 (EA-10): the arc is hit only on its DRAWN sweep (geometry.js arcSweepInfo, the renderer's sweep): the nearest point of the
    // arc is the projection on the circle when that falls inside the sweep, else the nearer end -- never the rest of the circle
    if (angleInArcSweep(arcSweepInfo(center, start, end, { sweep: s.sweep }), Math.atan2(dy, dx))) return { x: center.x + (dx / len) * radius, y: center.y + (dy / len) * radius };
    return getDist(w, start) <= getDist(w, end) ? { x: start.x, y: start.y } : { x: end.x, y: end.y };
  }
  if (s.type === 'bezier') {
    // TASK 762: a BEZIER's body: the point of its curve nearest w, the curve as #core/curve-kinds.js declares it (CURVE_KINDS.bezier.points:
    // sampled at CURVE_TOLERANCE_MM, both end joints included), w projected on each sampled chord. The curve lies inside the box of its
    // four points (the convex hull property): a point farther than the reach from that box cannot hit it, and the curve is not sampled.
    const P = [joints.get(s.joints[0]), joints.get(s.joints[s.joints.length - 1])];
    if (!P[0] || !P[1] || !Array.isArray(s.c1) || !Array.isArray(s.c2)) return null;
    const reach = reachPx * getZoomFactor(svg);
    const xs = [P[0].x, P[1].x, s.c1[0], s.c2[0]], ys = [P[0].y, P[1].y, s.c1[1], s.c2[1]];
    if (w.x < Math.min(...xs) - reach || w.x > Math.max(...xs) + reach || w.y < Math.min(...ys) - reach || w.y > Math.max(...ys) + reach) return null;
    const pts = CURVE_KINDS.bezier.points(s, { joints });
    let nearest = Infinity, q = null;
    for (let i = 1; i < pts.length; i++) {
      const p = projectPointOnSegment(w, pts[i - 1], pts[i]);
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      if (d < nearest) { nearest = d; q = p; }
    }
    return q;
  }
  return null;
}

// TASK 1020 (R1-06, R1-14): a point lies ON a curve when the curve passes within this many screen px of it (a point held on it).
const ON_CURVE_PX = 1;
// TASK 1020: the joints that END curve s (a line's two, an arc's start and end, a bezier's first and last; a circle has none, a centre is no end)
const curveEnds = (s) => (s.type === 'line' || s.type === 'bezier') && Array.isArray(s.joints) ? [s.joints[0], s.joints[s.joints.length - 1]] : (s.type === 'arc' ? [s.joints[1], s.joints[2]] : []);
// TASK 1020 (R2-08): curves OVERLAP at the pointer when their hits lie within this many screen px of the nearest hit; the tie between them goes to
// the better pickRank. It exceeds MIDPOINT_BIAS, so every curve the distance rule could choose is inside the window.
export const OVERLAP_PX = 3;
// TASK 1020 (R2-08): the rank of curve s for the active tool's picks (findSnap `picks`): a curve the tool takes, then a curve the tool has not
// already picked, then a solid curve over a construction line or a built-in reference axis. (Break's own curve pick ties with it too: break-tool.js.)
export function pickRank(s, picks) {
  const takes = !picks || !picks.curve || picks.curve(s);
  const fresh = !picks || !picks.picked || !picks.picked.has(s.id);
  const solid = !s.reference && !s.isConstruction;
  return (takes ? 4 : 0) + (fresh ? 2 : 0) + (solid ? 1 : 0);
}

// THE pick under the pointer: a joint, a curve (its body or its midpoint), else an X / Y axis.
// `picks` (TASK 1020): what the active tool can take, or null for anything (#ui/input-handlers/constraint-tools.js constraintToolPicks):
//   points  false: the tool takes no point, so a point is never the pick (R2-09: Equal / Tangent on a small circle's rim);
//   curve   (s) => true for a curve the tool takes (a curve it does not take is still the pick when no curve it takes overlaps it: the tool refuses it with its reason);
//   picked  the ids of the curves the tool has already picked for this constraint (the next pick prefers another).
export function findSnap(joints, shapes, svg, lastMouse, excludeIds=[], excludeLineSnap=false, useInferenceTolerance=false, dragBoost=1, picks=null){
  if(!lastMouse) return null;
  const boost = dragBoost || 1;
  const basePointThreshold = SNAP.JOINT_PX;
  const pointThreshold = basePointThreshold * boost;
  const inferencePx = SNAP.INFERENCE_PX * boost;
  const excluded = Array.isArray(excludeIds) ? excludeIds : (excludeIds ? [excludeIds] : []);

  // Evaluate joints (none when the active tool takes no point)
  let bestJoint = null; let bestJointDist = pointThreshold;
  const jointEntries = picks && picks.points === false ? [] : Array.from(joints.entries());
  for(let i = jointEntries.length - 1; i >= 0; i--){
    const [id, j] = jointEntries[i];
    if(excluded.includes(id)) continue;
    const s = worldToScreen(svg, j);
    const d = Math.hypot(s.x - lastMouse.x, s.y - lastMouse.y);
    if(d < bestJointDist){ bestJointDist = d; bestJoint = { type: 'joint', targetId: id, x: j.x, y: j.y, dist: d }; }
  }

  // Evaluate shapes (lines, circles, arcs, beziers): every candidate is OFFERED in the shapes' order, then THE distance rule picks one (pickShape)
  let bestShape = null;
  if(!excludeLineSnap){
    const lineThreshold = SNAP.LINE_PX * boost;
    const worldMouse = screenToWorld(svg, lastMouse.x, lastMouse.y);
    const offers = []; // { cand, bias }: the candidate replaces the best so far when cand.dist + bias is below the best's dist
    const screenDist = (p) => { const sc = worldToScreen(svg, p); return Math.hypot(sc.x - lastMouse.x, sc.y - lastMouse.y); };
    const shapeCand = (s, p, dist) => ({ type: 'shape', targetId: s.id, x: p.x, y: p.y, shape: s, dist });

    // ONE midpoint-or-shape rule for a curve (a line's midpoint, an arc's sweep midpoint): the midpoint wins when it is within the inference reach and
    // no more than MIDPOINT_BIAS px farther than the nearest point of the curve, so it participates in the same lock/hysteresis as other snaps.
    const MIDPOINT_BIAS = 2; // pixels
    const offerMidpointOrShape = (s, mid, snapPt, dist) => {
      const dmid = screenDist(mid);
      if (dmid < inferencePx && dmid <= dist + MIDPOINT_BIAS && dmid <= lineThreshold) offers.push({ bias: 0, cand: { type: 'midpoint', targetId: s.id, x: mid.x, y: mid.y, shape: s, dist: dmid, pt: mid } });
      else if (dist < lineThreshold) offers.push({ bias: 0, cand: shapeCand(s, snapPt, dist) });
    };

    for(const s of shapes){
      if(s.joints && s.joints.some(jid => excluded.includes(jid))) continue;
      const snapPt = nearestPointOn(s, joints, worldMouse, svg, lineThreshold);
      const dist = snapPt ? screenDist(snapPt) : Infinity;

      if(s.type === 'line') {
        if(!snapPt) continue;
        if (s.reference) {
          if (dist < lineThreshold) offers.push({ bias: MIDPOINT_BIAS, cand: shapeCand(s, snapPt, dist) });
          continue;
        }
        // Midpoint candidate: a first-class snap (see offerMidpointOrShape)
        const [a, b] = resolveJoints(joints, s.joints);
        offerMidpointOrShape(s, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, snapPt, dist);
      } else if (s.type === 'arc') {
        const center = joints.get(s.joints[0]), start = joints.get(s.joints[1]), end = joints.get(s.joints[2]);
        // Midpoint candidate (UX-27): the middle of the arc's drawn sweep, as a line's midpoint (see offerMidpointOrShape)
        if (center && start && end && getDist(center, start) > 0) offerMidpointOrShape(s, arcSweepMidpoint(center, start, end, { sweep: s.sweep }), snapPt || { x: start.x, y: start.y }, dist);
      }

      // Only accept a 'shape' snap if it's significantly closer than any midpoint preference
      // This prevents tiny projection advantages from overriding a nearby midpoint snap.
      if(snapPt && dist < lineThreshold) offers.push({ bias: MIDPOINT_BIAS, cand: shapeCand(s, snapPt, dist) });
    }
    bestShape = pickShape(offers, picks);
  }
  // Priority: Joint > Shape > X / Y axis. A point within JOINT_PRIORITY_RADIUS beats the curve under the pointer when it ENDS a curve (a line's or
  // an arc's end: drawing relies on that stickiness) or lies ON the curve under the pointer (a point held on it). TASK 1020 (R1-06, R1-14): a point
  // that ends no curve and lies beside the curve under the pointer (a circle's or an arc's centre, a fillet's virtual sharp, a lone point, the
  // origin) competes by distance, so a click on a small circle's rim or on a short fillet arc picks the curve. The axis is the last real target:
  // any joint (the origin included), point-on-line or midpoint is a more specific feature and beats it; only the bare grid is below it.
  const JOINT_PRIORITY_RADIUS = 15;
  if (bestJoint && bestJoint.dist < JOINT_PRIORITY_RADIUS && (!bestShape || shapes.some((s) => curveEnds(s).includes(bestJoint.targetId)) || jointOnCurve(bestJoint, bestShape.shape, joints, svg))) return bestJoint;
  if(bestJoint && bestShape) return (bestJoint.dist <= bestShape.dist) ? bestJoint : bestShape;
  if(bestJoint) return bestJoint;
  if(bestShape) return bestShape;
  return findAxisSnap(joints, svg, lastMouse, excluded, excludeLineSnap, boost);
}

// THE distance rule over findSnap's offered curve candidates, in their order: an offer replaces the best so far when its dist + bias is below the
// best's dist. TASK 1020 (R2-08): where curves OVERLAP at the pointer (hits within OVERLAP_PX of the nearest) with different pickRanks, only the
// best-ranked of them take part, so the tool's kind of curve, then a curve not yet picked, then a solid curve wins (never the shapes' order).
function pickShape(offers, picks) {
  if (!offers.length) return null;
  const near = Math.min(...offers.map((o) => o.cand.dist)) + OVERLAP_PX;
  const ranked = offers.filter((o) => o.cand.dist <= near).map((o) => ({ o, rank: pickRank(o.cand.shape, picks) }));
  const top = Math.max(...ranked.map((r) => r.rank));
  const field = ranked.some((r) => r.rank !== top) ? ranked.filter((r) => r.rank === top).map((r) => r.o) : offers;
  let best = null, bestDist = Infinity;
  for (const { cand, bias } of field) if (cand.dist + bias < bestDist) { best = cand; bestDist = cand.dist; }
  return best;
}

// TASK 1020: the point of joint hit j lies ON curve s (the curve passes within ON_CURVE_PX screen px of it).
function jointOnCurve(j, s, joints, svg) {
  const q = s ? nearestPointOn(s, joints, j, svg, ON_CURVE_PX) : null;
  if (!q) return false;
  const a = worldToScreen(svg, j), b = worldToScreen(svg, q);
  return Math.hypot(a.x - b.x, a.y - b.y) <= ON_CURVE_PX;
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
