// packages/ui/geometry-labels.js — the ONE place that names sketch geometry for the UI ("Line 2", "Arc 1 start") and
// resolves what a constraint binds. No shape-naming existed in the codebase before this (grep: no label/tooltip/Prepare
// naming), so the Design panel and the renderer's constraint highlight share these two helpers.
// Numbering is per shape type, in state.shapes order → stable while the sketch doesn't change.

const SHAPE_BASE = { line: 'Line', arc: 'Arc', circle: 'Circle', bezier: 'Bezier' };
const JOINT_ROLES = { line: ['start', 'end'], arc: ['center', 'start', 'end'], circle: ['center', 'rim'], bezier: ['start', 'end'] };

/** labelGeometry(shapes) → label({ shape: id } | { joint: id }) → string. */
export function labelGeometry(shapes = []) {
  const names = new Map();
  const counts = {};
  for (const s of shapes) {
    const base = SHAPE_BASE[s.type] || (String(s.type || 'Shape').replace(/^./, (ch) => ch.toUpperCase()));
    counts[base] = (counts[base] || 0) + 1;
    names.set(s.id, `${base} ${counts[base]}`);
  }
  const ownerOf = (jid) => shapes.find((s) => Array.isArray(s.joints) && s.joints.includes(jid));
  return (ref) => {
    if (ref && ref.shape != null) return names.get(ref.shape) || String(ref.shape);
    const jid = ref && ref.joint;
    if (jid === 'j_origin') return 'Origin';
    const owner = ownerOf(jid);
    if (!owner) return String(jid);
    const i = owner.joints.indexOf(jid);
    const roles = JOINT_ROLES[owner.type];
    return `${names.get(owner.id)} ${(roles && roles[i]) || `pt ${i + 1}`}`;
  };
}

/** constraintTargets(c, shapes) → { joints:Set, shapes:Set } — the geometry a constraint binds. */
export function constraintTargets(c, shapes = []) {
  const joints = new Set();
  const shapeIds = new Set();
  if (!c) return { joints, shapes: shapeIds };
  if (Array.isArray(c.joints)) c.joints.forEach((j) => joints.add(j));
  if (c.joint) joints.add(c.joint);
  if (Array.isArray(c.shapes)) c.shapes.forEach((s) => shapeIds.add(s));
  for (const k of ['shape', 'line', 'circle']) if (c[k]) shapeIds.add(c[k]);
  if (!shapeIds.size) {
    for (const s of shapes) if (Array.isArray(s.joints) && s.joints.some((j) => joints.has(j))) shapeIds.add(s.id);
  }
  return { joints, shapes: shapeIds };
}

/** constraintGeometryText(c, shapes, label) → what the constraint binds, e.g. "Line 1 end – Arc 1 start". */
export function constraintGeometryText(c, shapes, label) {
  const sep = c.type === 'equal' ? ' = ' : ' – ';
  const joint = (j) => label({ joint: j });
  const segment = (a, b) => {
    const line = shapes.find((s) => Array.isArray(s.joints) && s.joints.length === 2 && s.joints.includes(a) && s.joints.includes(b));
    if (line) return label({ shape: line.id });
    const arc = shapes.find((s) => s.type === 'arc' && s.joints[0] === a && (s.joints[1] === b || s.joints[2] === b));
    if (arc) return `${label({ shape: arc.id })} radius`;
    return `${joint(a)} – ${joint(b)}`;
  };
  if (c.type === 'pointOnLine' && c.joint && c.shape) return `${joint(c.joint)} on ${label({ shape: c.shape })}`;
  const refs = [...(Array.isArray(c.shapes) ? c.shapes : []), ...['shape', 'line', 'circle'].filter((k) => c[k]).map((k) => c[k])];
  if (refs.length) return [...new Set(refs)].map((id) => label({ shape: id })).join(sep);
  const js = Array.isArray(c.joints) ? c.joints : [];
  if (c.type === 'coincident' || js.length < 2) return js.map(joint).join(sep);
  if (js.length === 2) return segment(js[0], js[1]);
  if (js.length === 3 && c.type === 'midpoint') return `${joint(js[2])} on ${segment(js[0], js[1])}`;
  if (js.length === 4) return `${segment(js[0], js[1])}${sep}${segment(js[2], js[3])}`;
  return js.map(joint).join(', ');
}
