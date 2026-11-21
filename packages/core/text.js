// packages/core/text.js — TASK 845: THE TEXT object of the shared Design tab. PURE (no DOM): a font arrives as a FACE (#core/font-faces.js),
// loaded by the UI (#ui/text-fonts.js).
//
// A TEXT is ONE shape { type: 'text' } that keeps the string and its style; its letters are DERIVED from it, never stored as the truth:
//   { id, type: 'text', joints: [anchor], userGroupId, text, font, fontKind, fallback, size, letterSpacing, lineSpacing, align, rotation }
//     anchor       its one joint: the start of the first line's BASELINE (left), its middle (center) or its end (right). A point like any other:
//                  a coincident / a dimension to it moves the whole text (the text's group is a rigid block: #core/group-model.js rigidBlocks).
//     text         the string; '\n' starts a new line (lines go down from the first baseline)
//     font         the font's NAME (a bundled font, or one the user loaded); fontKind 'outline' | 'single' (the face's kind when it was chosen)
//     fallback     the bundled font of that kind it is drawn in when `font` is not available on this device (TEXT_FALLBACK)
//     size         the height of a capital (the font's 'H'), document base mm
//     letterSpacing  extra space between two letters, base mm (0 = the font's own spacing, kerning included)
//     lineSpacing  baseline-to-baseline distance as a factor of the font's own line height (ascender - descender)
//     align        TEXT_ALIGNS: where the anchor is on each line
//     rotation     the baseline's direction, WORLD radians (#core/transform.js: the canvas is y-down, a positive angle turns clockwise on screen)
// THE LETTERS (rebuildTextOutline): the glyph outlines as ordinary curves (lines and cubic beziers, quadratics raised exactly) in the SAME
// user group as the text shape, each carrying `textOutline: true` (their joints too). So everything that reads curves reads them unchanged:
// the loop finder (a letter's outline is a loop, its counters loops inside it: holes), Shaper's Prepare (Pocket / Inside / Outside; a single-line
// font's open strokes: On line), the plotter, the SVG / DXF exports, the profile tint. Their ids derive from the text's id (deterministic: the same
// text in the same font gives the same ids, so a cut assigned to a letter survives a reload). The document never stores them (#core/document.js
// serializeDocument drops every textOutline shape and joint); they are rebuilt from the text whenever it loads (#ui/text-fonts.js syncTextOutlines).
// The text's GROUP (a user group holding the text shape and its letters, named textGroupName) makes it one thing: a click selects it, a drag moves it,
// the transform box turns / scales it (transformText), it is never entered (a double click edits the text) nor ungrouped (Convert to shapes is
// the command that ends it: convertTextToShapes).

import { makeGroup, enteredGroup, textOfGroup } from './group-model.js';
import { newShapeId } from './shape-id.js';

export const TEXT_TYPE = 'text';
export const TEXT_ALIGNS = Object.freeze(['left', 'center', 'right']);
/** A new text's style when the user has chosen none yet (the tool then remembers the last one used). */
export const TEXT_DEFAULTS = Object.freeze({ font: 'Inter', fontKind: 'outline', size: 10, letterSpacing: 0, lineSpacing: 1, align: 'left' });
/** THE bundled font a text is drawn in when its own font is not on this device, per kind (a stored text carries its own `fallback`). */
export const TEXT_FALLBACK = Object.freeze({ outline: 'Inter', single: 'Hershey Simplex' });
/** The fields a text's style is (what the editor changes, what the tool remembers). */
export const TEXT_STYLE_KEYS = Object.freeze(['font', 'fontKind', 'fallback', 'size', 'letterSpacing', 'lineSpacing', 'align']);
const NAME_CHARS = 24; // the group's name shows the first line up to this many characters
const SAME = 1e-9;     // two points closer than this (base mm) are one

export const isText = (s) => !!s && s.type === TEXT_TYPE;
/** A shape or joint that is a text's derived letter (never stored, never picked alone). */
export const isTextOutline = (e) => !!(e && e.textOutline);
/** The text of a shape: the text itself, or the text whose letter it is (same group), else null. */
export function textOf(state, shape) {
  if (isText(shape)) return shape;
  return isTextOutline(shape) && shape.userGroupId ? textOfGroup(state, shape.userGroupId) : null;
}
/** The group's name for a text: Text "first line" (cut at NAME_CHARS). */
export function textGroupName(text) {
  const first = String((text && text.text) || '').split('\n')[0];
  return `Text "${first.length > NAME_CHARS ? first.slice(0, NAME_CHARS - 1) + '…' : first}"`;
}

/**
 * THE LAYOUT: the text's contours in TEXT-LOCAL base mm (x along the baseline, y UP, the anchor at (0, 0)) for `face`.
 * scale = size / capHeight; each glyph at the pen, advanced by its advance + the kerning to the next + letterSpacing; each line placed by the
 * alignment (its width without the last letter's spacing) and lineSpacing * (ascender - descender) below the previous one.
 * -> { contours: [{ closed, start, segs }] (the face's form, in mm), missing: [characters the font has no glyph for] }
 */
export function layoutText(rec, face) {
  const scale = rec.size / face.capHeight;
  const pitch = (rec.lineSpacing ?? 1) * (face.ascender - face.descender) * scale;
  const ls = rec.letterSpacing || 0;
  const contours = [], missing = new Set();
  String(rec.text ?? '').split('\n').forEach((line, li) => {
    const placed = [];
    let pen = 0, prev = null, count = 0;
    for (const ch of Array.from(line)) {
      const g = face.glyphFor(ch);
      count++;
      if (!g) { if (ch.trim()) missing.add(ch); pen += face.missingAdvance * scale + ls; prev = null; continue; }
      if (prev) pen += face.kern(prev.key, g.key) * scale;
      placed.push({ g, x: pen });
      pen += g.advance * scale + ls;
      prev = g;
    }
    const width = pen - (count ? ls : 0);
    const ox = rec.align === 'center' ? -width / 2 : rec.align === 'right' ? -width : 0, oy = -li * pitch;
    for (const { g, x } of placed) {
      const P = (p) => ({ x: ox + x + p.x * scale, y: oy + p.y * scale });
      for (const c of g.contours) contours.push({ closed: c.closed, start: P(c.start), segs: c.segs.map((s) => (s.k === 'L' ? { k: 'L', to: P(s.to) } : { k: 'C', c1: P(s.c1), c2: P(s.c2), to: P(s.to) })) });
    }
  });
  return { contours, missing: [...missing] };
}

/** Text-local mm -> world: the anchor + R(rotation) (x, -y) (local y is up, the canvas y is down). */
export function textToWorld(text, anchor) {
  const c = Math.cos(text.rotation || 0), s = Math.sin(text.rotation || 0);
  return (p) => ({ x: anchor.x + c * p.x + s * p.y, y: anchor.y + s * p.x - c * p.y });
}

/**
 * The text's LETTERS as curves, built from `face` (nothing is changed here): { joints: [[id, joint]], shapes: [shape], missing }.
 * Each contour: a joint at its start and at the end of each segment (a zero-length line is dropped); a closed contour ends ON its first joint
 * (a closing line is added when its last point is not its start), as does an open stroke whose last point IS its start (a single-line font's
 * closed stroke: one loop); each segment a line or a bezier. Ids: <text id>_p<n> (joints), _o<n> (shapes).
 */
export function textOutlineShapes(state, text, face) {
  const A = state.joints.get(text.joints[0]);
  if (!A) return { joints: [], shapes: [], missing: [] };
  const W = textToWorld(text, A);
  const { contours, missing } = layoutText(text, face);
  const sketchId = text.sketchId, gid = text.userGroupId;
  const joints = [], shapes = [];
  let jn = 0, sn = 0;
  const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < SAME;
  const J = (p) => { const id = `${text.id}_p${jn++}`; joints.push([id, { x: p.x, y: p.y, fixed: false, textOutline: true, ...(sketchId ? { sketchId } : {}) }]); return id; };
  const base = () => ({ id: `${text.id}_o${sn++}`, textOutline: true, ...(gid ? { userGroupId: gid } : {}), ...(sketchId ? { sketchId } : {}) });
  for (const c of contours) {
    const start = W(c.start);
    const segs = [];
    let at = start;
    for (const s of c.segs) {
      const to = W(s.to);
      if (s.k === 'L') { if (!same(at, to)) segs.push({ k: 'L', to }); }
      else { const c1 = W(s.c1), c2 = W(s.c2); if (!(same(at, to) && same(at, c1) && same(at, c2))) segs.push({ k: 'C', c1, c2, to }); }
      at = to;
    }
    if (c.closed && segs.length && !same(segs[segs.length - 1].to, start)) segs.push({ k: 'L', to: start }); // the contour's closing line
    const closed = segs.length > 1 && same(segs[segs.length - 1].to, start); // a closed contour, or a stroke that comes back to its start (a Hershey dot)
    if (!segs.length || (c.closed && !closed)) continue; // nothing drawn
    const first = J(start);
    let prev = first;
    segs.forEach((s, i) => {
      const end = closed && i === segs.length - 1 ? first : J(s.to);
      if (s.k === 'L') shapes.push({ ...base(), type: 'line', joints: [prev, end] });
      else shapes.push({ ...base(), type: 'bezier', joints: [prev, end], c1: [s.c1.x, s.c1.y], c2: [s.c2.x, s.c2.y] });
      prev = end;
    });
  }
  return { joints, shapes, missing };
}

/** The text's current letters (the textOutline shapes of its group). */
export function textOutlineOf(state, text) {
  return (state.shapes || []).filter((s) => isTextOutline(s) && text.userGroupId && s.userGroupId === text.userGroupId);
}

// remove the shapes `ids` and the textOutline joints only they used (selection / hover forget them)
function dropOutline(state, shapes) {
  if (!shapes.length) return;
  const ids = new Set(shapes.map((s) => s.id));
  const joints = new Set(shapes.flatMap((s) => s.joints || []));
  for (let i = state.shapes.length - 1; i >= 0; i--) if (ids.has(state.shapes[i].id)) state.shapes.splice(i, 1);
  for (const jid of joints) { const j = state.joints.get(jid); if (j && j.textOutline) state.joints.delete(jid); }
  for (const id of ids) { if (state.selectedShapes) state.selectedShapes.delete(id); if (state.hoveredShape === id) state.hoveredShape = null; if (state.hoverOwner === id) state.hoverOwner = null; }
  for (const jid of joints) { if (state.selectedJoints) state.selectedJoints.delete(jid); if (state.hoveredJoint === jid) state.hoveredJoint = null; }
}

/**
 * THE rebuild: replace the text's letters with the ones `face` gives (textOutlineShapes). A selected text keeps its whole group selected.
 * -> { missing } (characters the font has no glyph for).
 */
export function rebuildTextOutline(state, text, face) {
  const old = textOutlineOf(state, text);
  const wasSelected = !!(state.selectedShapes && state.selectedShapes.has(text.id));
  dropOutline(state, old);
  const built = textOutlineShapes(state, text, face);
  for (const [id, j] of built.joints) state.joints.set(id, j);
  if (built.shapes.length) state.shapes.push(...built.shapes);
  if (wasSelected) for (const s of built.shapes) state.selectedShapes.add(s.id);
  return { missing: built.missing };
}

/**
 * A NEW text at `at` ({x, y}, world), with `style` (TEXT_STYLE_KEYS; the rest from TEXT_DEFAULTS) and `text`; its letters built from `face`.
 * The text shape and its letters are one new user group (inside the group the user has entered). -> the text shape. (No undo step here: the caller's.)
 */
export function addText(state, at, { text = '', rotation = 0, ...style } = {}, face) {
  const anchor = state.genJ();
  state.joints.set(anchor, { x: at.x, y: at.y, fixed: false });
  const rec = { ...TEXT_DEFAULTS, ...style };
  const shape = { id: newShapeId('t'), type: TEXT_TYPE, joints: [anchor], text: String(text), font: rec.font, fontKind: rec.fontKind,
    fallback: rec.fallback || TEXT_FALLBACK[rec.fontKind] || TEXT_FALLBACK.outline, size: rec.size, letterSpacing: rec.letterSpacing,
    lineSpacing: rec.lineSpacing, align: rec.align, rotation };
  state.shapes.push(shape);
  const g = makeGroup(state, [shape.id], textGroupName(shape));
  const inside = enteredGroup(state);
  if (g && inside) g.parentId = inside;
  if (face) rebuildTextOutline(state, shape, face);
  return shape;
}

/** Change the text's string / style (`changes`: text and TEXT_STYLE_KEYS), rename its group, rebuild its letters from `face`. -> { missing }. */
export function editText(state, text, changes, face) {
  for (const k of ['text', ...TEXT_STYLE_KEYS]) if (changes && k in changes) text[k] = k === 'text' ? String(changes[k]) : changes[k];
  const g = (state.groups || []).find((x) => x.id === text.userGroupId);
  if (g) g.name = textGroupName(text);
  return face ? rebuildTextOutline(state, text, face) : { missing: [] };
}

/** Remove the text entirely: its letters, the text shape, its anchor (unless a constraint holds it) and its group when that is left empty.
 *  (The text tool's Cancel of a text it just placed; no undo step here.) */
export function removeText(state, text) {
  dropOutline(state, textOutlineOf(state, text));
  const i = state.shapes.indexOf(text);
  if (i >= 0) state.shapes.splice(i, 1);
  const anchor = text.joints[0];
  if (!(state.constraints || []).some((c) => c && ((c.joints || []).includes(anchor) || c.joint === anchor))) state.joints.delete(anchor);
  const gid = text.userGroupId;
  if (gid && Array.isArray(state.groups) && !(state.shapes || []).some((s) => s.userGroupId === gid)) {
    const g = state.groups.findIndex((x) => x.id === gid);
    if (g >= 0) state.groups.splice(g, 1);
  }
  if (state.selectedShapes) state.selectedShapes.delete(text.id);
}

/** TASK 753's transform on a text (called by #core/transform.js transformShapes for a text shape): its baseline turns by the angle, its size and
 *  letter spacing scale (the letters themselves are member curves: the transform rewrites them with the rest of the group). */
export function transformText(text, { angle = 0, scale = 1 }) {
  text.rotation = (text.rotation || 0) + angle;
  text.size *= scale;
  text.letterSpacing = (text.letterSpacing || 0) * scale;
}

/**
 * CONVERT TO SHAPES: the text's letters become ordinary curves (their textOutline marks go) and the text shape goes; its group stays, an
 * ordinary group named after the string. The anchor point stays only when a constraint holds it (a dimension the user placed); else it goes.
 * After this it is no longer text. (No undo step here: the caller's, ONE for the whole conversion.) -> the curves' ids.
 */
export function convertTextToShapes(state, text) {
  const outline = textOutlineOf(state, text);
  for (const s of outline) { delete s.textOutline; for (const jid of s.joints || []) { const j = state.joints.get(jid); if (j) delete j.textOutline; } }
  const i = state.shapes.indexOf(text);
  if (i >= 0) state.shapes.splice(i, 1);
  const anchor = text.joints[0];
  const held = (state.constraints || []).some((c) => c && ((c.joints || []).includes(anchor) || c.joint === anchor));
  if (!held) state.joints.delete(anchor);
  const g = (state.groups || []).find((x) => x.id === text.userGroupId);
  if (g) g.name = String(text.text || '').split('\n')[0].slice(0, NAME_CHARS) || g.name;
  if (state.selectedShapes) state.selectedShapes.delete(text.id);
  return outline.map((s) => s.id);
}

/**
 * THE operands of a constraint that are a text's insides: a letter (curve or point) or the text shape itself. Only the text's ANCHOR point takes
 * a constraint (#core/constraint-manager.js createConstraint refuses any other with TEXT_CONSTRAINT_REFUSAL).
 */
export const TEXT_CONSTRAINT_REFUSAL = 'Text: only its anchor point takes constraints (its letters are made from the text: Convert to shapes to constrain them)';
export function textConstraintRefusal(state, params) {
  if (!params || !state) return null;
  const ids = (v) => (Array.isArray(v) ? v : v != null ? [v] : []).map((x) => (x && typeof x === 'object' ? x.id : x));
  const joints = [...ids(params.joints), ...ids(params.joint)];
  const shapes = [...ids(params.shapes), ...ids(params.shape), ...ids(params.line), ...ids(params.circle)];
  if (joints.some((id) => isTextOutline(state.joints && state.joints.get && state.joints.get(id)))) return TEXT_CONSTRAINT_REFUSAL;
  const byId = (id) => (state.shapes || []).find((s) => s && s.id === id);
  if (shapes.some((id) => { const s = byId(id); return isText(s) || isTextOutline(s); })) return TEXT_CONSTRAINT_REFUSAL;
  return null;
}
