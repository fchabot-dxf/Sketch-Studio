// packages/core/document.js — the shared PROJECT DOCUMENT format (PERSIST-1).
//
// A versioned, JSON-safe serialize/deserialize pair over the shared sketch geometry: the same fields
// packages/ui/sketch-state.js's _captureSnapshot/_restoreSnapshot already treat as "the whole model" for
// undo/redo (joints, shapes, constraints, sketches, activeSketchId, groups, vcarves) — that's the
// established, already-battle-tested answer in this codebase to "what does the geometry consist of."
// This module wraps the SAME shape in a versioned envelope with a per-host sidecar, for STORAGE (a file,
// IndexedDB) rather than an in-memory undo stack. NOTE: sketch-state.js's undo/redo snapshot is a
// separate, still-duplicate codec for the same fields — flagged in WORK-LOG as a follow-up cleanup
// candidate, not refactored here (out of scope this turn, touches a working, well-tested system).
//
// `hosts` is deliberately OPAQUE to #core — each host embeds its own side-car data (pen colors, cut
// types, board thickness, …) under hosts.<hostName> and is responsible for reading/writing its own key.
// #core never inspects it; this keeps host-specific state out of the shared geometry, matching the
// existing rule that plotter pen colors etc. stay plotter-side.

import { addConstraintObject } from '#core/constraints.js';
import { DEFAULT_SKETCH_ID, DEFAULT_SKETCH_NAME } from '#core/sketch-model.js';

export const DOCUMENT_VERSION = 1;

/**
 * serializeDocument(state, { hosts }) → a plain, JSON-safe object.
 *   state: the shared sketch state (joints: Map, shapes/constraints: arrays, plus the optional
 *     sketches/groups/vcarves arrays — whichever a given host's state actually carries; a host without
 *     one of those (e.g. no vcarves) simply omits it, matching _captureSnapshot's own `undefined` guards).
 *   hosts: optional { <hostName>: <opaque host data> } — embedded verbatim, never interpreted here.
 */
export function serializeDocument(state, { hosts } = {}) {
  return {
    version: DOCUMENT_VERSION,
    geometry: {
      // Array of [id, {x,y,fixed,...}] pairs — the SAME shape tests/harness/sketch.js's load() already
      // accepts as one of its input forms, and trivially JSON-safe (a Map is not).
      joints: Array.from(state.joints.entries()).map(([id, j]) => [id, { ...j }]),
      shapes: state.shapes.map((s) => ({ ...s, joints: s.joints ? [...s.joints] : [] })),
      constraints: state.constraints.map((c) => ({
        ...c,
        joints: c.joints ? [...c.joints] : undefined,
        shapes: c.shapes ? [...c.shapes] : undefined,
      })),
      sketches: Array.isArray(state.sketches) ? state.sketches.map((s) => ({ ...s })) : undefined,
      activeSketchId: state.activeSketchId,
      groups: Array.isArray(state.groups) ? state.groups.map((g) => ({ ...g })) : undefined,
      vcarves: Array.isArray(state.vcarves)
        ? state.vcarves.map((v) => ({ ...v, vbit: v.vbit ? { ...v.vbit } : undefined }))
        : undefined,
    },
    hosts: hosts || {},
  };
}

/**
 * deserializeDocument(doc, state) → { ok: true, hosts } | { ok: false, reason }
 *   Replaces state's ENTIRE geometry with doc's (lesson: opening a document replaces the whole state,
 *   never blends with what was there — clear every store to default FIRST). Constraints are re-added via
 *   addConstraintObject (the SAME validated-add path undo/redo's _restoreSnapshot already uses — not the
 *   raw engine.addConstraint the load()-only test harness uses, since a persisted document may have
 *   traveled through storage and deserves the same safety net a redo step gets).
 *   A document whose version is NEWER than this build understands is REJECTED (ok:false), never
 *   half-read — the caller decides what to tell the user.
 */
export function deserializeDocument(doc, state) {
  if (!doc || typeof doc !== 'object') return { ok: false, reason: 'not a document object' };
  if (typeof doc.version !== 'number') return { ok: false, reason: 'missing version field' };
  if (doc.version > DOCUMENT_VERSION) {
    return { ok: false, reason: `document version ${doc.version} is newer than this app understands (${DOCUMENT_VERSION})` };
  }
  const g = doc.geometry || {};

  state.joints.clear();
  for (const entry of (g.joints || [])) {
    const [id, j] = Array.isArray(entry) ? entry : [entry.id, entry];
    if (id != null && j) state.joints.set(id, { ...j });
  }

  state.shapes.length = 0;
  state.shapes.push(...(g.shapes || []).map((s) => ({ ...s, joints: s.joints ? [...s.joints] : [] })));

  state.constraints.length = 0;
  for (const c of (g.constraints || [])) {
    const proto = { ...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined };
    addConstraintObject(state, proto);
  }

  if (Array.isArray(state.sketches)) {
    state.sketches.length = 0;
    const restored = g.sketches && g.sketches.length ? g.sketches : [{ id: DEFAULT_SKETCH_ID, name: DEFAULT_SKETCH_NAME, visible: true }];
    state.sketches.push(...restored.map((s) => ({ ...s })));
  }
  if ('activeSketchId' in state) state.activeSketchId = g.activeSketchId || DEFAULT_SKETCH_ID;

  if (Array.isArray(state.groups)) {
    state.groups.length = 0;
    state.groups.push(...(g.groups || []).map((x) => ({ ...x })));
  }
  if (Array.isArray(state.vcarves)) {
    state.vcarves.length = 0;
    state.vcarves.push(...(g.vcarves || []).map((v) => ({ ...v, vbit: v.vbit ? { ...v.vbit } : undefined })));
  }

  // Selection/active-tool state is session UI, not document content — matches _restoreSnapshot clearing it.
  if (state.selectedJoints instanceof Set) state.selectedJoints.clear();
  if (state.selectedConstraints instanceof Set) state.selectedConstraints.clear();
  if (state.selectedShapes instanceof Set) state.selectedShapes.clear();
  state.active = null;

  return { ok: true, hosts: doc.hosts || {} };
}
