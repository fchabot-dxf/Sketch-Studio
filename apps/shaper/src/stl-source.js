// apps/shaper/src/stl-source.js — TASK 790: the STLs a Shaper design came from, in ONE place (like stock.js). TASK 841: a LIST, one source per relief PART (an
// Open STL's part, each Insert STL's), keyed by the part = its selection-list.js entry id (`part`; null for a design opened from an STL before the selection list,
// task 795: that source is the whole design). A source: its file name, the Up side / rotation and the Units it was sliced with, its size, and the mesh itself,
// so the STL card (stl-import.js) can slice that part again; `opened` = it came from Open STL (it set the stock thickness, as Open does). An empty list = the
// design came from no STL (drawn, imported from SVG / DXF or from Fusion): there is no STL card then. The CARD's source is the CURRENT one (setCurrentStl: the
// relief selected in Prepare; none chosen, or gone: the last in the list).
//   • the UNDO snapshots (shaper-doc.js capturePrepare) carry the list WITHOUT the meshes ([{ part, name, up, unit, triangles, sizeMm, key, ... }]): a mesh stays
//     in memory under its key for the session, so a snapshot is small and JSON-safe;
//   • the DOCUMENT (shaper-doc.js captureShaperDoc, `stl`) carries the list WITH each mesh as text (#core/stl-slice.js meshToBase64, encoded once per mesh), so a
//     saved design opened again keeps its card and can still be sliced again. A document without an STL writes nothing here (its bytes are unchanged).
//     A document saved before 841 has ONE source there (an object, not a list): applyStlDoc reads it as a list of one (THE migration: its part = the design's
//     STL selection, opened).
//   • TASK 807: a document entry says `relief: true` (the part is the STL's relief); one saved before 807 (its design was the per-feature import) opens with the
//     source marked `old`, and the importer slices it again as a relief (stl-import.js reimportOld).
//   • TASK 897: a source read from an OBJ or a 3MF says its `format` (mesh-formats.js MESH_FORMATS id: the card names it); an STL's says none (a source and a
//     document entry without one are an STL: an STL design's bytes are unchanged). The mesh is kept as triangles, whatever the file was, so a reopened design is
//     sliced again from them, never from the file's own format. (This module is the Fusion panel's too: it keeps the id as given and imports no mesh reader.)
import { meshToBase64, meshFromBase64, STL_UP_SIDES, STL_UNITS, orientationOf, rotationOk } from '#core/stl-slice.js';
import { dbg } from '#core/debug.js';

const MESHES = new Map(); // key -> Float32Array (9 per triangle)
const TEXT = new Map();   // key -> the mesh as base64 (encoded once)
let SOURCES = [];
let CURRENT = null;       // the card's part (setCurrentStl)
let seq = 0;

/** Keep a mesh for this session; returns its key. */
export function rememberMesh(tris, text = null) {
  const key = `stl${++seq}`;
  MESHES.set(key, tris);
  if (text) TEXT.set(key, text);
  return key;
}
export const meshOf = (key) => MESHES.get(key) || null;

const copy = (s) => ({ ...s, rotation: [...s.rotation], floor: s.floor ? [...s.floor] : null, sizeMm: { ...s.sizeMm } });
// a source as stored (its mesh known), or null
function sane(s) {
  if (!s || !MESHES.has(s.key)) return null;
  // TASK 808: the orientation is ONE stored rotation (3x3, 9 numbers); `up` is its Up side when it is a preset (null for a clicked floor face), `floor` the picked normal
  const o = orientationOf(s);
  return { part: typeof s.part === 'string' && s.part ? s.part : null, name: String(s.name), up: o.up, rotation: o.rotation, floor: Array.isArray(s.floor) ? [...s.floor] : null,
    unit: s.unit, triangles: s.triangles, sizeMm: { ...s.sizeMm }, key: s.key, ...(s.opened ? { opened: true } : {}), ...(s.old ? { old: true } : {}),
    ...(typeof s.format === 'string' && s.format && s.format !== 'stl' ? { format: s.format } : {}) }; // TASK 897: an OBJ / 3MF says so
}

/** Every source (copies), in the order the parts came. */
export const getStlSources = () => SOURCES.map(copy);
/** The source of a part (a copy) or null. */
export const stlSourceOf = (part) => { const s = part ? SOURCES.find((x) => x.part === part) : null; return s ? copy(s) : null; };
/** The CARD's source (a copy): the current part's, else the last one; null when the design came from no STL. */
export const getStlSource = () => { const s = (CURRENT && SOURCES.find((x) => x.part === CURRENT)) || SOURCES[SOURCES.length - 1]; return s ? copy(s) : null; };
const LISTENERS = new Set();
/** Call fn() after every change of the sources or of the current one (the STL card: an import, a re-slice, undo / redo, a document opened, a relief selected). */
export function onStlSourceChange(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }
const changed = () => { for (const fn of LISTENERS) fn(); };
/** Replace the whole list (sources whose mesh is not known are left out). */
export function setStlSources(list) {
  SOURCES = (Array.isArray(list) ? list : []).map(sane).filter(Boolean);
  changed();
  return getStlSources();
}
/** The design's ONE source (Open STL: the list cleared to it), or none (null: the design came from no STL). Returns the card's source. */
export function setStlSource(s) { setStlSources(s ? [s] : []); return getStlSource(); }
/** TASK 841: add a part's source, or replace the one of the same part in its place (a re-slice). Returns the card's source. */
export function putStlSource(s) {
  const n = sane(s);
  if (!n) return getStlSource();
  const at = n.part ? SOURCES.findIndex((x) => x.part === n.part) : -1;
  SOURCES = at >= 0 ? SOURCES.map((x, i) => (i === at ? n : x)) : [...SOURCES, n];
  changed();
  return getStlSource();
}
/** TASK 841: a part's source goes (its relief was taken out of the design). */
export function dropStlSource(part) {
  if (!SOURCES.some((x) => x.part === part)) return;
  SOURCES = SOURCES.filter((x) => x.part !== part);
  changed();
}
/** TASK 841: the part the STL card shows (the relief selected in Prepare); the card follows. */
export function setCurrentStl(part) {
  const next = part || null;
  if (next === CURRENT) return;
  CURRENT = next;
  changed();
}

/** What one undo step keeps: the sources without their meshes. */
export const captureStl = () => getStlSources();
export const applyStl = (list) => setStlSources(list || []);

/** The document's part: [{ part, name, up, unit, triangles, sizeMm, format?, mesh, relief, opened? }] or undefined (no STL: nothing is written). */
export function captureStlDoc() {
  if (!SOURCES.length) return undefined;
  return SOURCES.map((s) => {
    let text = TEXT.get(s.key);
    if (!text) { text = meshToBase64(MESHES.get(s.key)); TEXT.set(s.key, text); }
    const { key, old, part, opened, ...meta } = copy(s);
    if (!meta.floor) delete meta.floor; // a preset Up side: the entry says its Up side (+ the rotation, which is the same preset)
    return { ...(part ? { part } : {}), ...meta, mesh: text, ...(old ? {} : { relief: true }), ...(opened ? { opened: true } : {}) };
  });
}
// one stored entry -> a source (its mesh remembered), or null when it cannot be read
function readEntry(d) {
  if (!d || typeof d !== 'object') return null;
  let tris = null;
  try { tris = meshFromBase64(d.mesh); } catch (e) { dbg.warn('shaper', 'the stored STL mesh is not base64', e && e.message); }
  // a document before 808 has `up` only; one with a rotation (a clicked floor face: `up` null) has `rotation` (+ `floor`, the picked normal)
  const oriented = rotationOk(d.rotation) || STL_UP_SIDES.includes(d.up);
  if (!tris || !tris.length || !oriented || !STL_UNITS.some((u) => u.id === d.unit)) {
    dbg.warn('shaper', 'the stored STL could not be read: the design opens without its STL card', { up: d.up, unit: d.unit });
    return null;
  }
  return { part: d.part, name: d.name, up: d.up, rotation: d.rotation, floor: d.floor, unit: d.unit, triangles: tris.length / 9, sizeMm: d.sizeMm || { x: 0, y: 0, z: 0 },
    key: rememberMesh(tris, d.mesh), opened: d.opened === true, old: d.relief !== true, format: d.format };
}
/**
 * Restore the document's part (missing: no STL source; an entry that cannot be read is left out). `selections` = the document's selection list (selection-list.js).
 * THE migration (TASK 841): a document saved before 841 has ONE source (an object): it is a list of one, the part of the design's STL selection (none before
 * 795: null, the whole design), opened (it came from Open STL, the only way an STL came in before 841).
 */
export function applyStlDoc(d, selections = []) {
  const stl = (Array.isArray(selections) ? selections : []).find((e) => e && e.kind === 'stl');
  const list = Array.isArray(d) ? d : d ? [{ ...d, part: stl ? stl.id : null, opened: true }] : [];
  return setStlSources(list.map(readEntry).filter(Boolean));
}
