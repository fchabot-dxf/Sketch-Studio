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
import { cloneProfiles } from '#core/profile-model.js';
import { cloneParameters, replaceParameters } from '#core/parameters.js';
import { ORIGIN_JOINT_ID, ORIGIN_JOINT } from '#core/constants.js';
import { legacyAngleSector } from '#core/angle-sector.js';

// 2 (TASK 535, owner ruling O2): the version that carries dimension names, dimension formulas and geometry.parameters. Always written;
// a version-1 file still loads (parameters absent -> none, every dimension is named on load) but an older build refuses a version-2 file.
// 3 (TASK 553): driving angle dimensions store their measured `sector` (#core/angle-sector.js). An older build would drop it and re-solve
// such an angle modulo 180, so it refuses a version-3 file by the same newer-version rule; version 1 and 2 files load and are converted.
export const DOCUMENT_VERSION = 3;

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
      profiles: Array.isArray(state.profiles) ? cloneProfiles(state.profiles) : undefined,
      parameters: Array.isArray(state.parameters) ? cloneParameters(state.parameters) : undefined,
      vcarves: Array.isArray(state.vcarves)
        ? state.vcarves.map((v) => ({ ...v, vbit: v.vbit ? { ...v.vbit } : undefined }))
        : undefined,
    },
    hosts: hosts || {},
  };
}

/**
 * validateDocument(doc) → { ok: true } | { ok: false, reason, newer? }
 *   The ONE acceptance check for a stored document (a file, an IndexedDB project, the autosave): an object with a numeric
 *   version this build understands. deserializeDocument runs it first; a file/project loader runs it BEFORE touching any
 *   state so a bad file is refused up front. `newer: true` marks "made by a newer version" (callers word that for the user).
 */
export function validateDocument(doc) {
  if (!doc || typeof doc !== 'object') return { ok: false, reason: 'not a document object' };
  if (typeof doc.version !== 'number') return { ok: false, reason: 'missing version field' };
  if (doc.version > DOCUMENT_VERSION) {
    return { ok: false, newer: true, reason: `document version ${doc.version} is newer than this app understands (${DOCUMENT_VERSION})` };
  }
  return { ok: true };
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
  const valid = validateDocument(doc);
  if (!valid.ok) return valid;
  const g = doc.geometry || {};

  state.joints.clear();
  // TASK 554: every sketch has its origin. Set first, so a document without one (the store's empty "New design", a design saved from
  // it, an older file) loads with it; a stored origin replaces this copy below, keeping its own fields and its place (first).
  state.joints.set(ORIGIN_JOINT_ID, { ...ORIGIN_JOINT });
  for (const entry of (g.joints || [])) {
    const [id, j] = Array.isArray(entry) ? entry : [entry.id, entry];
    if (id != null && j) state.joints.set(id, { ...j });
  }

  state.shapes.length = 0;
  state.shapes.push(...(g.shapes || []).map((s) => ({ ...s, joints: s.joints ? [...s.joints] : [] })));

  state.constraints.length = 0;
  for (const c of (g.constraints || [])) {
    // TASK 553: an angle dimension saved by an older build (no `sector`) is converted here, the one load path, from the loaded geometry
    const proto = legacyAngleSector({ ...c, joints: c.joints ? [...c.joints] : undefined, shapes: c.shapes ? [...c.shapes] : undefined }, state.joints, state.shapes);
    addConstraintObject(state, proto);
  }

  if (Array.isArray(state.sketches)) {
    state.sketches.length = 0;
    const restored = g.sketches && g.sketches.length ? g.sketches : [{ id: DEFAULT_SKETCH_ID, name: DEFAULT_SKETCH_NAME, visible: true }];
    state.sketches.push(...restored.map((s) => ({ ...s })));
  }
  if ('activeSketchId' in state) state.activeSketchId = g.activeSketchId || DEFAULT_SKETCH_ID;
  if ('soloMemory' in state) state.soloMemory = null; // TASK 577: the "show only this sketch" memory belongs to the document it was made in

  if (Array.isArray(state.groups)) {
    state.groups.length = 0;
    state.groups.push(...(g.groups || []).map((x) => ({ ...x })));
  }
  if (Array.isArray(state.profiles)) {
    state.profiles.length = 0;
    state.profiles.push(...cloneProfiles(g.profiles || []));
  }
  if (Array.isArray(state.parameters)) replaceParameters(state.parameters, g.parameters);
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
