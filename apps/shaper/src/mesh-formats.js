// apps/shaper/src/mesh-formats.js — TASK 897 (owner turn 3690: "native mesh formats instead of STEP"): the 3D MESH FORMATS the Shaper website opens and inserts,
// DECLARED once (MESH_FORMATS). ONE mesh-reading step (readMesh): a picked file -> the same triangle list #core/stl-slice.js parseStl returns (Float32Array, 9 per
// triangle), the format chosen by the file's extension. Everything after it (slicing, Up / Orient, the card, the saved source, Roughing / Contour) is the STL path
// of stl-import.js, unchanged.
//   • STL: parseStl, read at once (readMesh returns its result, as Open STL always did).
//   • OBJ / 3MF: three.js's own loaders (OBJLoader, ThreeMFLoader: mesh-loaders.js), loaded only when such a file is read (a dynamic import: the site's first load
//     does not carry them); readMesh returns a Promise of the result then.
//   • UNITS: STL and OBJ carry none (`unit` null: the card's Units choice applies, mm first, as for an STL); a 3MF declares its unit: it is honoured
//     (mesh-loaders.js THREE_MF_UNITS: the mesh in the card's mm or in).
//   • SEVERAL OBJECTS in one file (an OBJ's objects / groups, a 3MF's build items): merged into ONE mesh, one relief part (`objects` says how many: the notice
//     says so); Insert a file again for another part.
import { parseStl } from '#core/stl-slice.js';

const loaders = () => import('./mesh-loaders.js');

/** The formats, in the order the picker and the messages name them: id (stored with a source that is not an STL), label (the card), file extension, read(bytes). */
export const MESH_FORMATS = Object.freeze([
  Object.freeze({ id: 'stl', label: 'STL', ext: '.stl', read: (bytes) => parseStl(bytes) }),
  Object.freeze({ id: 'obj', label: 'OBJ', ext: '.obj', read: (bytes) => loaders().then((m) => m.readObj(bytes)) }),
  Object.freeze({ id: '3mf', label: '3MF', ext: '.3mf', read: (bytes) => loaders().then((m) => m.read3mf(bytes)) }),
]);
const NAMES = MESH_FORMATS.map((f) => f.label);
const NAMES_TEXT = `${NAMES.slice(0, -1).join(', ')} and ${NAMES[NAMES.length - 1]}`;

/** The format of a file name (by its extension, any case), or null. */
export const meshFormatOf = (name) => { const n = String(name || '').toLowerCase(); return MESH_FORMATS.find((f) => n.endsWith(f.ext)) || null; };
/** A stored format id -> its entry (a source without one is an STL). */
export const meshFormatById = (id) => MESH_FORMATS.find((f) => f.id === (id || 'stl')) || null;

/** Shaper's file pick for Open / Insert 3D mesh: any of the formats, read as bytes. */
export const MESH_FILE_PICK = Object.freeze({ description: `3D mesh (${NAMES.join(', ')})`, mime: 'model/stl', exts: Object.freeze(MESH_FORMATS.map((f) => f.ext)), binary: true });

/**
 * readMesh(bytes, name) -> { ok, triangles, format, unit, objects } | { ok: false, message } — or a Promise of it (OBJ / 3MF: their loader loads first).
 *   format: the MESH_FORMATS id; unit: 'mm' | 'in' when the file declares it (3MF), else null; objects: how many objects the file held (merged into one mesh).
 */
export function readMesh(bytes, name) {
  const fmt = meshFormatOf(name);
  if (!fmt) return { ok: false, message: `${name} is not a file Shaper can open: it opens 3D meshes in ${NAMES_TEXT} files.` };
  const done = (r) => (r.ok ? { ok: true, triangles: r.triangles, format: fmt.id, unit: r.unit || null, objects: r.objects || 1 } : r);
  const out = fmt.read(bytes);
  return out instanceof Promise ? out.then(done) : done(out);
}
