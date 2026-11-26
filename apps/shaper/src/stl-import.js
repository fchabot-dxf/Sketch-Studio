// apps/shaper/src/stl-import.js — TASK 790: Shaper's OPEN STL, DECLARED in one importable place (like cut-import.js): the page (main.js) and the node
// test kit both call createStlImporter(). An STL is one more SOURCE of the Fusion add-in's `selection_data` payload: #core/stl-slice.js reads and slices
// it, and the design is REPLACED through the ONE import path a Fusion selection takes (fusion-import.js importFusionSelection: the sketch, the cut plan,
// the stock thickness = the part's height, in ONE undo step). The STL it came from is then the design's STL source (stl-source.js: saved with the
// document), shown by the STL card in Prepare (stl-card.js), whose Up / Units slice it again (one undo step each).
// Shaper only: the other apps' file picks never offer STL (their shared IMPORT_FILE_PICK is SVG / DXF); this file declares Shaper's own.
// TASK 807 (owner turns 2638-2640): an STL is a RELIEF, always: ONE part (its work area) whose record is a Roughing (Terraces) with the part's levels,
// ready to cut. The notice: "Added <file>: a relief, N levels" / "Replaced with <file>: ..." (+ the slicer's warning). A design saved with an STL before
// 807 (its regions were the per-feature import's) is sliced again as a relief when it is opened (reimportOld: the page calls it after a restore).
// TASK 841 (owner turns 3076-3078): INSERT STL = the STL ADDED to the design as one more relief PART (Open STL still replaces it): sliced the same way,
// through the same import as a new selection (addAs) whose shapes go into their OWN Roughing (join: false); everything already in the design stays as it
// is; one undo step; the stock thickness is never changed (a taller part is SAID: "<file> is 1.2 in tall: the stock is 0.75 in"). It lands where
// INSERT_PLACE says (freePlace) and then moves like any shape: its levels follow it (relief-frame.js). Every part has its own STL source (stl-source.js
// list); the card shows the selected relief's (setCurrentStl, from Prepare's focus) and a re-slice replaces THAT part only, where it is now.
// TASK 897 (owner turn 3690): the file may be an STL, an OBJ or a 3MF (mesh-formats.js readMesh, the ONE mesh-reading step: the same triangle list); all that
// follows is this STL path. A 3MF's declared unit is the source's Units (mesh-formats.js); a file of several objects is ONE part (the notice says so). An STL is
// read at once (openFile / insertFile return the result); an OBJ / 3MF loads its reader first (they return a Promise of the result).
import { browserFileSeam } from '#ui/project-file.js';
import { sliceStl, STL_DEFAULTS, orientationForUp, orientationOf, orientedBounds } from '#core/stl-slice.js';
import { computeGeometryBounds } from '#core/geometry-bounds.js';
import { findLoops } from '#core/loop-finder.js';
import { importFusionSelection } from './fusion-import.js';
import { selectionNotice } from './fusion-bridge.js';
import { getStlSource, getStlSources, stlSourceOf, setStlSource, putStlSource, setCurrentStl, rememberMesh, meshOf } from './stl-source.js';
import { getSelections, localSelectionId } from './selection-list.js';
import { regionKeys, regionOf } from './operations-store.js';
import { getStock, tallerNote } from './stock.js'; // TASK 898: the taller note, shared with a Fusion selection's add
import { placement, placementNow, IDENTITY } from './relief-frame.js';
import { mountStlCard } from './stl-card.js';
import { openOrientView } from './orient-view.js'; // TASK 808: the Orient view (click the floor face)
import { readMesh, MESH_FILE_PICK } from './mesh-formats.js'; // TASK 897: STL, OBJ, 3MF

/** The drawer entry's icon: a cube (18 x 18, the drawer's stroke style). */
export const STL_ICON = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5l5.5 3v7L9 15.5l-5.5-3v-7zM3.5 5.5L9 8.5l5.5-3M9 8.5v7"/></svg>';

/** TASK 841: Insert STL's icon: the cube, smaller, with a plus (its 18 x 18 inner markup: the Prepare toolbar's button; the whole svg: the drawer). */
export const STL_INSERT_MARKUP = '<path d="M7.5 5l4.5 2.5v5.5L7.5 15.5 3 13V7.5zM3 7.5L7.5 10 12 7.5M7.5 10v5.5M14.5 1.5v5M12 4h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
export const STL_INSERT_ICON = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none">${STL_INSERT_MARKUP}</svg>`;

/**
 * TASK 841: WHERE an inserted relief lands. Its footprint (the work area's box) is centred in the current view; when it comes closer than `gapMm` to an existing
 * shape's box (a closed shape's box holds its inside too; construction is left out), it goes to the nearest free place to the view's centre, searched on a grid
 * whose step is `stepShare` of the part's smaller side (the view split in at most `maxSteps` steps each way from the centre) with the part's centre inside the
 * view; none free: the view's centre.
 */
export const INSERT_PLACE = Object.freeze({ gapMm: 5, stepShare: 0.25, maxSteps: 64 });

/** freePlace({ w, h }, view { x, y, w, h } (x, y = its centre), boxes [{ minX, minY, maxX, maxY }]) -> { x, y }: the footprint's centre (INSERT_PLACE). */
export function freePlace(size, view, boxes, { gapMm = INSERT_PLACE.gapMm, stepShare = INSERT_PLACE.stepShare, maxSteps = INSERT_PLACE.maxSteps } = {}) {
  const vw = Number(view.w) > 0 ? view.w : size.w, vh = Number(view.h) > 0 ? view.h : vw;
  const free = (x, y) => boxes.every((b) => x + size.w / 2 + gapMm <= b.minX || x - size.w / 2 - gapMm >= b.maxX || y + size.h / 2 + gapMm <= b.minY || y - size.h / 2 - gapMm >= b.maxY);
  const step = Math.max(Math.min(size.w, size.h) * stepShare, Math.max(vw, vh) / 2 / maxSteps, 1e-3);
  const nx = Math.floor(vw / 2 / step), ny = Math.floor(vh / 2 / step);
  const spots = [];
  for (let j = -ny; j <= ny; j++) for (let i = -nx; i <= nx; i++) spots.push([i, j]);
  spots.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
  for (const [i, j] of spots) { const x = view.x + i * step, y = view.y + j * step; if (free(x, y)) return { x, y }; }
  return { x: view.x, y: view.y };
}
// the boxes an inserted relief keeps clear of: every shape's, and every closed shape's (its inside)
function occupiedBoxes(st) {
  const box = (shapes) => computeGeometryBounds(Object.create(st, { shapes: { value: shapes } }), { construction: false });
  const solid = st.shapes.filter((s) => !s.isConstruction), byId = new Map(solid.map((s) => [s.id, s]));
  return [...solid.map((s) => box([s])), ...findLoops(st).map((l) => box(l.edges.map((id) => byId.get(id)).filter(Boolean)))].filter(Boolean);
}
// where a part is now: the placement of the levels' frame of its outline (relief-frame.js), found by its joints (a key its outline was given since does not lose it)
function partPlacement(st, entry) {
  const ids = new Set(entry.shapeIds), joints = new Set(st.shapes.filter((s) => ids.has(s.id)).flatMap((s) => s.joints || []));
  for (const key of regionKeys()) {
    const f = (regionOf(key) || {}).frame;
    if (f && f.joints.some(([id]) => joints.has(id))) return placementNow(st, f) || f.at;
  }
  return IDENTITY;
}

/**
 * createStlImporter({ ensureSketch, getController, prepare, panelEl, showPrepare, afterImport, notice, getView })
 *   -> { openFile(bytes, name), insertFile(bytes, name), reslice({ up } | { unit } | { orient }), orient(), reimportOld(), pickAndOpen(), pickAndInsert() }
 *   ensureSketch(): mounts the sketcher. getController(): the sketcher. prepare: the Prepare stage (prepare-stage.js; the import re-mounts it; TASK 841: its focus
 *   picks the card's relief). panelEl: Prepare's right column (#prepare-panel): the STL card goes first in it. showPrepare(): the mode router's (the result is shown
 *   in Prepare, where its cuts and its card are). afterImport(): the page's refresh after any selection import (the Review card's thickness, the history buttons).
 *   notice(text, isError): Prepare's one-line notice. getView(): TASK 841, the view an inserted relief is centred in ({ x, y, w, h }, world units; default: the
 *   Design canvas's).
 *   Every call returns the import's result ({ ok, message, warnings, regionCount, ..., info: the slice's size / levels / time }) or { ok: false, message }
 *   (a file that is not a readable STL, nothing to cut): the design is then unchanged.
 */
export function createStlImporter({ ensureSketch, getController, prepare, panelEl, showPrepare = () => {}, afterImport = () => {}, notice = () => {}, getView = null }) {
  mountStlCard(panelEl, { onChange: (next) => { const res = reslice(next); if (res && !res.ok) notice(res.message, true); }, onOrient: () => orient() });
  // TASK 841: the card shows the relief Prepare is about (the open operation's shapes, else the selected ones); nothing of a relief in focus: it stays on its part
  prepare.onFocusChange((keys) => {
    const e = getSelections().find((x) => x.kind === 'stl' && x.cutKeys.some((k) => keys.includes(k)) && stlSourceOf(x.id));
    if (e) setCurrentStl(e.id);
  });
  const levelsText = (n) => `a relief, ${n} level${n === 1 ? '' : 's'}`;
  // TASK 841: a part taller than the stock is said, never fixed silently (owner: no infantilising)
  const tallerText = (name, h) => tallerNote(name, h, getStock().thickness);
  /**
   * Slice the mesh and import it: `part` null = the design is REPLACED (Open STL; a source from before the selection list); a part = that part is put in again in
   * place (a re-slice: its own Roughing, the stock as its source says: an opened part sets it, an inserted one leaves it); `at` = TASK 841, a NEW part inserted at
   * that placement. On success the part's STL source is this mesh with these settings.
   */
  const land = (tris, key, { name, up, rotation, floor, unit, part = null, opened = false, at = null, format = 'stl', objects = 1 }) => {
    ensureSketch();
    const sliced = sliceStl(tris, { name, up, unit, rotation });
    if (!sliced.ok) return sliced;
    const st = getController().state;
    const entry = part ? getSelections().find((e) => e.id === part) : null;
    const id = at ? localSelectionId() : entry ? part : null;
    const placed = at || (entry ? partPlacement(st, entry) : null);
    const keep = Boolean(id) && !(entry && opened); // an inserted part never changes the stock; an opened one is the design's own (its height, as Open)
    showPrepare();
    const res = importFusionSelection(sliced.payload, id
      ? { controller: getController(), prepare, onImport: afterImport, addAs: id, place: placed, join: false, stock: keep ? 'keep' : 'part', fit: Boolean(entry && opened) }
      : { controller: getController(), prepare, onImport: afterImport, stock: 'part' }); // TASK 898: Open STL says it (the stock = its height, as before); a Fusion selection's default makes a Stock row
    if (!res.ok) return res;
    const n = sliced.info.sections;
    if (!res.imported) { notice(res.message, false); return { ...res, info: sliced.info }; }
    const src = { name, up, rotation, floor, unit, triangles: sliced.info.triangles, sizeMm: sliced.info.sizeMm, key, part: res.selectionId, opened: !id || opened,
      ...(format !== 'stl' ? { format } : {}) }; // TASK 897: an STL's source is as before (no format: an STL)
    if (id) putStlSource(src); else setStlSource(src); // the card follows (stl-card.js); Open STL: the list is this one source
    setCurrentStl(res.selectionId);
    const said = at ? `Inserted ${name}` : id || res.replaced ? `Replaced with ${name}` : `Added ${name}`;
    const taller = keep ? tallerText(name, sliced.info.sizeMm.z) : null;
    const merged = objects > 1 ? `${objects} objects in the file, sliced as one part` : null; // TASK 897: a file of several objects is one relief
    const message = selectionNotice(`${said}: ${levelsText(n)}${merged ? ` · ${merged}` : ''}${taller ? ` · ${taller}` : ''}`, res.warnings);
    notice(message, false);
    return { ...res, message, info: sliced.info };
  };
  // TASK 897: the file read by its format (mesh-formats.js readMesh), then `then(tris, key, name, settings)`: settings = the slicing defaults (STL_DEFAULTS: +Z up,
  // mm) with the file's declared unit (a 3MF's) and its format / object count
  const read = (bytes, name, then) => {
    const nm = String(name || 'part.stl');
    const go = (mesh) => (mesh.ok ? then(mesh.triangles, rememberMesh(mesh.triangles), nm,
      { ...STL_DEFAULTS, unit: mesh.unit || STL_DEFAULTS.unit, format: mesh.format, objects: mesh.objects }) : mesh);
    const mesh = readMesh(bytes, nm);
    return mesh instanceof Promise ? mesh.then(go) : go(mesh);
  };
  /** A mesh file's bytes (an STL, OBJ or 3MF; or an ASCII STL's text) -> a new design. */
  const openFile = (bytes, name) => read(bytes, name, (tris, key, nm, settings) => land(tris, key, { name: nm, ...settings }));
  /** TASK 841: a mesh file's bytes -> one more relief part of the design (sliced as Open slices it), placed by INSERT_PLACE in the current view. */
  const insertFile = (bytes, name) => read(bytes, name, (tris, key, nm, settings) => {
    ensureSketch();
    const st = getController().state;
    const view = getView ? getView() : st.view;
    const b = orientedBounds(tris, { rotation: orientationForUp(settings.up).rotation, unit: settings.unit }); // its footprint, as the slicer turns it
    const w = b.maxX - b.minX, h = b.maxY - b.minY; // the slicer's part: x 0..w, y -h..0 in the sketch (Y down)
    const c = freePlace({ w, h }, view, occupiedBoxes(st));
    return land(tris, key, { name: nm, ...settings, at: placement(0, c.x - w / 2, c.y + h / 2) });
  });
  // a source sliced again with another Up side / rotation or Units (its part only, where it is now)
  const resliceSource = (s, next = {}) => {
    // TASK 808: ONE orientation (a stored rotation), set two ways: an Up preset (`up`) or a clicked floor face (`orient`: { up, rotation, floor })
    const o = next.orient ? orientationOf(next.orient) : next.up ? orientationForUp(next.up) : { up: s.up, rotation: s.rotation };
    const floor = next.orient ? next.orient.floor || null : next.up ? null : s.floor;
    return land(meshOf(s.key), s.key, { name: s.name, up: o.up, rotation: o.rotation, floor, unit: next.unit || s.unit, part: s.part, opened: Boolean(s.opened), format: s.format || 'stl' });
  };
  /** The card's STL sliced again with another Up side or Units (null when the design has no STL source). */
  const reslice = (next = {}) => {
    const s = getStlSource();
    return s ? resliceSource(s, next) : null;
  };
  /** TASK 808: open the Orient view on the card's mesh; Done with a new floor face slices it again (one undo step). Resolves with the view (null: no STL source). */
  const orient = async () => {
    const s = getStlSource();
    if (!s) return null;
    return openOrientView({ tris: meshOf(s.key), unit: s.unit, rotation: s.rotation, up: s.up,
      onDone: (o) => { const res = resliceSource(s, { orient: o }); if (res && !res.ok) notice(res.message, true); } });
  };
  /** TASK 807: each STL of a design opened with STLs sliced before 807 (stl-source.js `old`) is sliced again as a relief (its Up and Units kept); null when none. */
  const reimportOld = () => {
    let res = null;
    for (const s of getStlSources()) if (s.old) res = resliceSource(s, {});
    return res;
  };
  /** The file chooser (Shaper's mesh pick: STL, OBJ, 3MF); resolves null when it was cancelled. */
  const pickAndOpen = async () => {
    const picked = await browserFileSeam.open(MESH_FILE_PICK);
    return picked ? openFile(picked.bytes, picked.name) : null;
  };
  /** TASK 841: the same chooser, the mesh inserted. */
  const pickAndInsert = async () => {
    const picked = await browserFileSeam.open(MESH_FILE_PICK);
    return picked ? insertFile(picked.bytes, picked.name) : null;
  };
  return { openFile, insertFile, reslice, orient, reimportOld, pickAndOpen, pickAndInsert };
}
