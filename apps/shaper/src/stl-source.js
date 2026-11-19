// apps/shaper/src/stl-source.js — TASK 790: the STL a Shaper design came from, in ONE place (like stock.js): its file name, the Up side and the Units
// it was sliced with, its size, and the mesh itself, so the STL card (stl-import.js) can slice it again. null = the design did not come from an STL
// (drawn, imported from SVG / DXF or from Fusion): there is no STL card then.
//   • the UNDO snapshots (shaper-doc.js capturePrepare) carry the source WITHOUT the mesh ({ name, up, unit, triangles, sizeMm, key }): the mesh stays
//     in memory under its key for the session, so a snapshot is small and JSON-safe;
//   • the DOCUMENT (shaper-doc.js captureShaperDoc) carries it WITH the mesh as text (#core/stl-slice.js meshToBase64, encoded once per mesh), so a
//     saved design opened again keeps its card and can still be sliced again. A document without an STL writes nothing here (its bytes are unchanged).
//   • TASK 807: the document's part says `relief: true` (the design is the STL's relief); one saved before 807 (its design was the per-feature import)
//     opens with the source marked `old`, and the importer slices it again as a relief (stl-import.js reimportOld).
import { meshToBase64, meshFromBase64, STL_UP_SIDES, STL_UNITS, orientationOf, rotationOk } from '#core/stl-slice.js';
import { dbg } from '#core/debug.js';

const MESHES = new Map(); // key -> Float32Array (9 per triangle)
const TEXT = new Map();   // key -> the mesh as base64 (encoded once)
let SOURCE = null;
let seq = 0;

/** Keep a mesh for this session; returns its key. */
export function rememberMesh(tris, text = null) {
  const key = `stl${++seq}`;
  MESHES.set(key, tris);
  if (text) TEXT.set(key, text);
  return key;
}
export const meshOf = (key) => MESHES.get(key) || null;

/** The current STL source (a copy) or null. */
export const getStlSource = () => (SOURCE ? { ...SOURCE, rotation: [...SOURCE.rotation], floor: SOURCE.floor ? [...SOURCE.floor] : null, sizeMm: { ...SOURCE.sizeMm } } : null);
const LISTENERS = new Set();
/** Call fn() after every change of the source (the STL card: an import, a new Up / Units, undo / redo, a document opened, a design replaced). */
export function onStlSourceChange(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }
/** Set (a source whose mesh is known) or clear (null) the STL source. */
export function setStlSource(s) {
  // TASK 808: the orientation is ONE stored rotation (3x3, 9 numbers); `up` is its Up side when it is a preset (null for a clicked floor face), `floor` the picked normal
  const o = s ? orientationOf(s) : null;
  SOURCE = s && MESHES.has(s.key) ? { name: String(s.name), up: o.up, rotation: o.rotation, floor: Array.isArray(s.floor) ? [...s.floor] : null, unit: s.unit, triangles: s.triangles, sizeMm: { ...s.sizeMm }, key: s.key, ...(s.old ? { old: true } : {}) } : null;
  for (const fn of LISTENERS) fn();
  return getStlSource();
}

/** What one undo step keeps: the source without its mesh (null when none). */
export const captureStl = () => getStlSource();
export const applyStl = (s) => setStlSource(s || null);

/** The document's part: { name, up, unit, triangles, sizeMm, mesh } or undefined (no STL: nothing is written). */
export function captureStlDoc() {
  if (!SOURCE) return undefined;
  let text = TEXT.get(SOURCE.key);
  if (!text) { text = meshToBase64(MESHES.get(SOURCE.key)); TEXT.set(SOURCE.key, text); }
  const { key, old, ...meta } = getStlSource();
  if (!meta.floor) delete meta.floor; // a preset Up side: the documents' bytes stay as before (+ the rotation, which is the same preset)
  return { ...meta, mesh: text, ...(old ? {} : { relief: true }) };
}
/** Restore the document's part (missing or unreadable: no STL source). */
export function applyStlDoc(d) {
  if (!d) return setStlSource(null);
  let tris = null;
  try { tris = meshFromBase64(d.mesh); } catch (e) { dbg.warn('shaper', 'the stored STL mesh is not base64', e && e.message); }
  // a document before 808 has `up` only; one with a rotation (a clicked floor face: `up` null) has `rotation` (+ `floor`, the picked normal)
  const oriented = rotationOk(d.rotation) || STL_UP_SIDES.includes(d.up);
  if (!tris || !tris.length || !oriented || !STL_UNITS.some((u) => u.id === d.unit)) {
    dbg.warn('shaper', 'the stored STL could not be read: the design opens without its STL card', { up: d.up, unit: d.unit });
    return setStlSource(null);
  }
  return setStlSource({ name: d.name, up: d.up, rotation: d.rotation, floor: d.floor, unit: d.unit, triangles: tris.length / 9, sizeMm: d.sizeMm || { x: 0, y: 0, z: 0 }, key: rememberMesh(tris, d.mesh), old: d.relief !== true });
}
