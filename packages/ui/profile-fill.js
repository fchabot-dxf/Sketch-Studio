// packages/ui/profile-fill.js — SVG "d" strings for every CLOSED profile of a sketch (the PROFILE_FILL look).
// Loops come from the shared loop finder (#core/loop-finder.js, the one Shaper's Prepare uses) and paths from
// #core/loop-geometry.js; nothing here is a second loop algorithm. The result is cached against a geometry
// signature (joint positions, shape topology, coincident constraints), so loops are re-derived only when the geometry
// changed, never per frame while merely hovering/panning.
import { findLoops } from '#core/loop-finder.js';
import { loopToPathD } from '#core/loop-geometry.js';

let cache = { sig: null, ds: [] };

function mix(h, v) { return (Math.imul(h, 31) + v) | 0; }
function mixStr(h, s) { s = String(s); for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i)); return h; }

// A cheap numeric hash over everything findLoops/loopToPathD read.
export function geometrySignature(joints, shapes, constraints) {
  let h = mix(0, joints.size);
  for (const [id, j] of joints) h = mix(mixStr(h, id), mix(Math.round(j.x * 1000), Math.round(j.y * 1000)));
  for (const s of shapes) {
    h = mixStr(mixStr(h, s.id), s.type);
    if (s.isConstruction) h = mix(h, 1);
    if (s.joints) for (const jid of s.joints) h = mixStr(h, jid);
    if (s.type === 'circle') h = mix(h, Math.round((s.radius || 0) * 1000));
    if (s.type === 'arc') h = mix(mix(h, s.largeArc ? 1 : 0), typeof s.sweep === 'boolean' ? (s.sweep ? 2 : 3) : 0);
  }
  for (const c of constraints) {
    if (c && c.type === 'coincident' && Array.isArray(c.joints)) for (const jid of c.joints) h = mixStr(h, jid);
  }
  return h;
}

export function profileFillPaths(joints, shapes, constraints) {
  const sig = geometrySignature(joints, shapes, constraints);
  if (cache.sig !== sig) {
    const state = { joints, shapes, constraints };
    cache = { sig, ds: findLoops(state).map((l) => loopToPathD(l, state)).filter(Boolean) };
  }
  return cache.ds;
}
