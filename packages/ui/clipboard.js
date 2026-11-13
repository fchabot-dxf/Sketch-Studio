// packages/ui/clipboard.js — TASK 559: copy / cut / paste of sketch geometry (Ctrl+C / Ctrl+X / Ctrl+V). THE one module; the keys are declared in
// input-manager.js (clipboardKeyAction), the document codec is core's serializeDocument, a pasted constraint goes through addConstraintObject
// (the path undo / load use, so withDimensionState keeps every dimension field), cut deletes through deleteSelection (the path of the Delete key).
//
// RULES (Fusion-like; "to verify in Fusion UI" marks what has not been measured there):
//  WHAT   the selected SHAPES with their own joints (a selected point no shape uses is copied too). A constraint or dimension is copied only when
//         EVERY operand (joint or shape) is inside the copy: a rectangle's H/V and its dimensions travel, a link to outside geometry, to the
//         origin or to an axis does not (a copied point that sat ON the origin comes out as an ordinary free point at its offset position).
//  NAMES  a pasted dimension gets a NEW dN (addConstraint names it). Its formula: a name of a copied dimension is renamed to that dimension's new
//         name; a USER PARAMETER the target document has keeps being read (same document: always); a name the target cannot resolve (a parameter
//         it lacks, a dimension that was not copied) freezes the formula to the dimension's number. (to verify in Fusion UI)
//  WHERE  the copy lands at an OFFSET from the original (PASTE_STEP_MM right and down on screen, i.e. down in the user's Y-up sense) and stays
//         selected so it can be dragged at once; pasting the SAME clipboard again offsets each paste one more step. Follow-the-cursor placement
//         (Fusion) needs a modal placing tool: left as a follow-up. (to verify in Fusion UI: where Fusion lands a plain Ctrl+V)
//  UNDO   one paste = ONE undo step ('paste'); the pasted items are selected afterwards. Cut = copy + the Delete key's step.
//  STORE  the SYSTEM clipboard, as text: a JSON envelope { format, version, document }, so it works across reloads, hosts and tabs. If the browser
//         refuses the clipboard, an in-memory copy is used and the user is told once. Text that is not ours is ignored without a message.
import { serializeDocument, validateDocument } from '#core/document.js';
import { addConstraintObject } from '#core/constraints.js';
import { deleteSelection } from '#core/delete-manager.js';
import { newShapeId } from '#core/shape-id.js';
import { evaluateAll, isDimension, isReferenceDimension, remapExpressionNames } from '#core/parameters.js';
import { userToWorldY } from '#core/units.js';
import { SolverConfig } from '#core/solver-config.js';
import { commitDimensionEdits } from '#ui/dimension-seams.js';

// ── DECLARED: the clipboard format and the paste step ──
export const CLIPBOARD_FORMAT = 'sketch-studio/geometry';
export const CLIPBOARD_VERSION = 1;
export const PASTE_STEP_MM = 10;                       // offset of the first paste; paste n of the same clipboard is n steps from the original
const ORIGIN_JOINT = 'j_origin';
// the constraint fields that name a joint, and those that name a shape (the operands that must ALL be inside the copy)
const JOINT_REFS = ['joints', 'joint'];
const SHAPE_REFS = ['shapes', 'shape', 'line', 'circle'];

const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const refsOf = (c, keys) => keys.flatMap((k) => asList(c[k]));

// ── the keys (declared here, bound in input-manager.js next to the other shortcuts) ──
// Ctrl/Cmd+C copy, Ctrl/Cmd+X cut, Ctrl/Cmd+V paste (no Shift/Alt: Ctrl+Shift+C is Combine). Ctrl+D is NOT bound (the browser's bookmark key).
export function clipboardKeyAction(e) {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return null;
  const k = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  return k === 'c' ? 'copy' : k === 'x' ? 'cut' : k === 'v' ? 'paste' : null;
}
// a key aimed at a text control, or while page text is selected, is the browser's own copy / paste (the dimension box, the Params window, filters)
export function isTextEditingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true || target.id === 'dimInput';
}

// ── copy: the selection -> an envelope, or null (nothing copyable is selected) ──
export function selectionToEnvelope(state) {
  const selected = state.selectedShapes instanceof Set ? state.selectedShapes : new Set();
  const shapes = state.shapes.filter((s) => selected.has(s.id));
  const shapeIds = new Set(shapes.map((s) => s.id));
  const jointIds = new Set();
  for (const s of shapes) {
    for (const j of asList(s.joints)) jointIds.add(j);
    if (s.filletSharp && state.joints.has(s.filletSharp)) jointIds.add(s.filletSharp); // a fillet arc's virtual-sharp corner point
  }
  const used = new Set(state.shapes.flatMap((s) => asList(s.joints)));
  const freeJoints = [...(state.selectedJoints instanceof Set ? state.selectedJoints : [])].filter((j) => j !== ORIGIN_JOINT && state.joints.has(j) && !used.has(j));
  for (const j of freeJoints) jointIds.add(j);
  if (!shapes.length && !freeJoints.length) return null;
  const inside = (c) => {
    const js = refsOf(c, JOINT_REFS), ss = refsOf(c, SHAPE_REFS);
    return js.length + ss.length > 0 && js.every((j) => jointIds.has(j)) && ss.every((s) => shapeIds.has(s));
  };
  // ONE serializer: core's serializeDocument over a sub-document made of the copied part
  const part = {
    joints: new Map([...jointIds].filter((j) => state.joints.has(j)).map((j) => [j, state.joints.get(j)])),
    shapes,
    constraints: state.constraints.filter(inside),
    parameters: [],
  };
  return { format: CLIPBOARD_FORMAT, version: CLIPBOARD_VERSION, document: serializeDocument(part), copied: { shapes: shapes.map((s) => s.id), joints: freeJoints } };
}
// the text on the clipboard: the envelope without the local `copied` bookkeeping
export function envelopeToText(env) {
  return JSON.stringify({ format: env.format, version: env.version, document: env.document });
}

// ── what the clipboard text is: ours, ours but newer, or not ours (never an exception) ──
export function parseClipboardText(text) {
  if (typeof text !== 'string' || !text.includes(CLIPBOARD_FORMAT)) return { ok: false, reason: 'foreign' };
  let env;
  try { env = JSON.parse(text); } catch (err) { return { ok: false, reason: 'foreign', error: err.message }; } // text that merely mentions our marker is not our payload
  if (!env || env.format !== CLIPBOARD_FORMAT) return { ok: false, reason: 'foreign' };
  if (typeof env.version !== 'number' || env.version > CLIPBOARD_VERSION) return { ok: false, reason: 'newer' };
  const valid = validateDocument(env.document);
  if (!valid.ok) return { ok: false, reason: valid.newer ? 'newer' : 'invalid' };
  const g = env.document.geometry || {};
  if (!Array.isArray(g.joints) || !Array.isArray(g.shapes) || !Array.isArray(g.constraints)) return { ok: false, reason: 'invalid' };
  const jointIds = new Set(g.joints.map((e) => e[0]));
  if (!g.shapes.every((s) => asList(s.joints).every((j) => jointIds.has(j)))) return { ok: false, reason: 'invalid' };
  return { ok: true, document: env.document };
}

// ── paste: add a translated copy of `document` to `state`; ONE undo step; select the copy. → { ok, shapes, joints, constraints, frozen:[names] } ──
// step = how many PASTE_STEP_MM the copy is moved right / down; unit = the document unit the formulas are read in.
export function pasteDocument(state, document, { step = 1, unit = 'mm' } = {}) {
  const g = document.geometry;
  const dx = PASTE_STEP_MM * step, dy = userToWorldY(-PASTE_STEP_MM * step); // right, and DOWN on screen (user Y points up)
  const seq = newShapeId('');   // THE shape-id generator (#core/shape-id.js): unique even for two pastes in one millisecond
  const jointMap = new Map(), shapeMap = new Map(), groupMap = new Map();
  for (const [id] of g.joints) jointMap.set(id, state.genJ());
  g.shapes.forEach((s, i) => shapeMap.set(s.id, `s${seq}_${i}`));
  const groupOf = (gid) => { if (!groupMap.has(gid)) groupMap.set(gid, `paste_${seq}_${groupMap.size}`); return groupMap.get(gid); };
  const used = new Set(g.shapes.flatMap((s) => asList(s.joints)));
  const frozen = [];
  const grouped = typeof state.beginUndoGroup === 'function';
  if (grouped) state.beginUndoGroup('paste');
  const out = { ok: true, shapes: [], joints: [], constraints: [], frozen };
  try {
    for (const [id, j] of g.joints) {
      const { sketchId, ...rest } = j; // the copy belongs to the ACTIVE sketch (the joints.set wrap stamps it)
      // the origin (fixed, always there) is never duplicated as a fixed point: its copy is an ordinary free point
      state.joints.set(jointMap.get(id), { ...rest, x: j.x + dx, y: j.y + dy, fixed: id === ORIGIN_JOINT ? false : !!j.fixed });
      if (!used.has(id)) out.joints.push(jointMap.get(id));
    }
    for (const s of g.shapes) {
      const { sketchId, userGroupId, ...rest } = s; // a user group stays with the original
      const copy = { ...rest, id: shapeMap.get(s.id), joints: asList(s.joints).map((j) => jointMap.get(j)) };
      if (s.groupId) copy.groupId = groupOf(s.groupId); // the renderer's closed-shape key: the copy is its own closed shape
      if (Array.isArray(s.c1)) copy.c1 = [s.c1[0] + dx, s.c1[1] + dy]; // a bezier's control points are absolute data
      if (Array.isArray(s.c2)) copy.c2 = [s.c2[0] + dx, s.c2[1] + dy];
      if (s.filletSharp) { if (jointMap.has(s.filletSharp)) copy.filletSharp = jointMap.get(s.filletSharp); else delete copy.filletSharp; }
      state.shapes.push(copy);
      out.shapes.push(copy.id);
    }
    // constraints: ids remapped, the name dropped (addConstraint gives a dimension the next free dN), positions that are data moved
    const before = state.constraints.length;
    const renamed = new Map(); // old dimension name -> the pasted dimension
    for (const src of g.constraints) {
      const { name, glyphPos, __pos, ...rest } = src; // glyphPos / __pos are render caches, re-stamped when drawn
      const c = { ...rest };
      if (src.joints) c.joints = src.joints.map((j) => jointMap.get(j));
      if (src.joint) c.joint = jointMap.get(src.joint);
      if (src.shapes) c.shapes = src.shapes.map((s) => shapeMap.get(s));
      if (src.shape) c.shape = shapeMap.get(src.shape);
      if (src.line) c.line = shapeMap.get(src.line);
      if (src.circle) c.circle = shapeMap.get(src.circle);
      if (src.labelPos) c.labelPos = { x: src.labelPos.x + dx, y: src.labelPos.y + dy };
      const count = state.constraints.length;
      addConstraintObject(state, c);
      if (state.constraints.length > count && isDimension(state.constraints[count]) && name) renamed.set(name, state.constraints[count]);
    }
    out.constraints = state.constraints.slice(before);
    // formulas: see the header (NAMES)
    const known = new Set((state.parameters || []).map((p) => p.name));
    const pending = [];
    for (const c of out.constraints) {
      if (!isDimension(c) || !c.expression) continue;
      const r = remapExpressionNames(c.expression, (n) => (renamed.has(n) ? renamed.get(n).name : known.has(n) ? n : null));
      if (r.ok && !isReferenceDimension(c)) { c.expression = r.text; pending.push(c); } else { delete c.expression; frozen.push(c.name); }
    }
    // a kept formula is read in THIS document: when its value differs from the copied number (another document's parameter), the dimension
    // is driven to it through the batch seam, and frozen instead if the sketch refuses it
    if (pending.length) {
      const ev = evaluateAll(state, { unit });
      const moves = [];
      for (const c of pending) {
        const q = ev.values && ev.values.get(c.name);
        if (!q) { delete c.expression; frozen.push(c.name); } else if (Math.abs(q.v - c.value) > 1e-9) moves.push({ c, value: q.v });
      }
      if (moves.length) {
        const res = commitDimensionEdits(state, moves);
        if (res.reverted) for (const m of moves) { delete m.c.expression; frozen.push(m.c.name); }
      }
    }
    if (state.engine && typeof state.engine.solve === 'function') state.engine.solve(SolverConfig.QUICK_SOLVE || 8);
    // select the copy (the live Sets keep their identity: other code holds them)
    state.selectedShapes.clear(); state.selectedJoints.clear(); state.selectedConstraints.clear();
    for (const id of out.shapes) state.selectedShapes.add(id);
    for (const id of out.joints) state.selectedJoints.add(id);
  } finally {
    if (grouped) state.endUndoGroup();
  }
  return out;
}

// ── the clipboard of ONE document session: reads / writes the system clipboard, keeps the in-memory fallback and the repeat-paste count ──
// io = { writeText(text) -> Promise, readText() -> Promise<string> } (default: navigator.clipboard); notify(message, type); unit() -> the document unit
export function createClipboard({ state, io = defaultIo(), notify = () => {}, unit = () => 'mm' }) {
  let memory = null;       // the text of the last copy of THIS session (the fallback when the system clipboard is refused)
  let useMemory = false;   // the last write was refused: the system clipboard does not hold our copy, so paste reads memory
  let told = false;
  let lastPaste = null;    // { text, n }: pasting the same text again moves each paste one more step
  const refused = (why) => {
    if (told) return;
    told = true;
    notify(`The browser refused clipboard access (${why}): copy and paste work inside this page only.`, 'warning');
  };

  async function copy() {
    const env = selectionToEnvelope(state);
    if (!env) return null;
    const text = envelopeToText(env);
    memory = text; lastPaste = null;
    if (io && io.writeText) {
      try { await io.writeText(text); useMemory = false; } catch (err) { useMemory = true; refused(err && err.message ? err.message : 'write denied'); }
    } else { useMemory = true; refused('no clipboard API'); }
    return env;
  }

  async function cut() {
    const env = await copy();
    if (!env) return false;
    // delete exactly what was copied (the Delete key's own path): the selection is narrowed to it first
    state.selectedShapes.clear(); state.selectedJoints.clear(); state.selectedConstraints.clear();
    for (const id of env.copied.shapes) state.selectedShapes.add(id);
    for (const id of env.copied.joints) state.selectedJoints.add(id);
    deleteSelection(state);
    return true;
  }

  async function paste() {
    let text = null;
    if (useMemory) text = memory;
    else if (io && io.readText) {
      try { text = await io.readText(); } catch (err) { text = memory; if (memory) refused(err && err.message ? err.message : 'read denied'); }
    } else text = memory;
    const parsed = parseClipboardText(text);
    if (!parsed.ok) {
      if (parsed.reason === 'newer') notify('This clipboard was copied by a newer version of the app.', 'warning');
      else if (parsed.reason === 'invalid') notify('The copied geometry could not be read.', 'warning');
      return null; // text that is not ours: nothing happens
    }
    const n = lastPaste && lastPaste.text === text ? lastPaste.n + 1 : 1;
    const res = pasteDocument(state, parsed.document, { step: n, unit: unit() });
    lastPaste = { text, n };
    return res;
  }

  return { copy, cut, paste };
}

function defaultIo() {
  const c = typeof navigator !== 'undefined' ? navigator.clipboard : null;
  return c && c.writeText && c.readText ? { writeText: (t) => c.writeText(t), readText: () => c.readText() } : null;
}
