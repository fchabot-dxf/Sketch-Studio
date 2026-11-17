// tests/vcarve-removed-741-node.test.js — TASK 741 (owner turns 2093-2096: "if I just use a V-bit it will make a V-carve, why use a different cut type" -> "Remove then"):
// V-carve is gone from Shaper; a V-groove is a cut with the V-bit cutter shape. What is left of it is the MIGRATION of an old document, checked here:
//   A. #core/document.js deserializeDocument (the ONE place a document is normalised) never loads geometry.vcarves and counts the records that had a region
//      (removedVcarves); the shared state has no such part any more, and a re-save writes none.
//   B. Shaper (node kit: the page's own design-canvas.js / prepare-stage.js / document buffer): an old design with V-carve regions opens with no V-carve in the
//      state; Prepare shows the one-time notice (#prepare-notice, prepare-stage.js removedVcarvesNotice) on its first mount, and not again; those regions are
//      simply unassigned (no cut record); the stored file keeps its V-carve list until the user changes (and so saves) the design.
//   C. the export of that design == the export of the same design with its V-carve list deleted beforehand (byte for byte).
//   D. the stage lists: no 'vcarve' stage in Shaper (web or Fusion palette), so no 'stage:vcarve' analytics event is sent (#ui/analytics-events.js is unchanged:
//      'stage:' is a family over the app's own stage ids).
//   E. the V-bit cutter shape is unchanged: vbitHalfAngleTan (its one home is now #core/cutter-profile.js) and the V groove profile.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { createSketchState as sketchState } from '#core/sketch-state.js';
import { createEngine } from '#core/constraint-solver.js';
import { findLoops } from '#core/loop-finder.js';
import { cutterProfile, cutterTerraces, vbitHalfAngleTan, SHAPE_SLICES } from '#core/cutter-profile.js';
import { CUT_PLAN, cutPlanEntries, keyOf } from '../apps/shaper/src/cut-plan.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { removedVcarvesNotice } from '../apps/shaper/src/prepare-stage.js';
import { SHAPER_STAGES, shaperStagesFor } from '../apps/shaper/src/modes.js';
import { applyShaperUnitDefault } from '../apps/shaper/src/design-canvas.js';

const createSketchState = () => { const e = createEngine(null); e.init(); return sketchState(e, { x: 0, y: 0, w: 100, h: 100 }); }; // a headless sketch state (no DOM)
let checks = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const ok = (c, msg) => { assert.ok(c, msg); checks++; };

// An old Shaper design: two rectangles; the left one was V-carved (a region picked in the removed Vcarve stage), the right one has an Outside cut.
const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]];
const shapes = [];
const rect = (p, x, y, w, h) => {
  const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  pts.forEach(([px, py], i) => joints.push([p + i, { x: px, y: py, sketchId: 'sketch-1' }]));
  pts.forEach((_, i) => shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % 4)], sketchId: 'sketch-1' }));
};
rect('A', 0, 0, 40, 30); rect('B', 60, 0, 30, 30);
const scratch = createSketchState();
deserializeDocument({ version: 3, geometry: { joints, shapes, constraints: [] } }, scratch);
const loopOf = (prefix) => findLoops(scratch).find((l) => l.edges.includes(prefix + 's0')).id;
const loopA = loopOf('A'), loopB = loopOf('B');
const outsideB = { cutType: 'exterior', cutDepth: 6.35, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 };
const VCARVES = [
  { id: 'vcarve-1', region: 'loop:' + loopA, vbit: { angle: 60 }, dStep: 0.5, maxDepth: 6 },
  { id: 'vcarve-2', region: null, vbit: { angle: 90 }, dStep: 0.5, maxDepth: 6 }, // a record with no region picked: it carved nothing, so it is not counted
];
const oldDoc = (withVcarves) => JSON.parse(JSON.stringify({
  version: 3,
  geometry: { joints, shapes, constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
    ...(withVcarves ? { vcarves: VCARVES } : {}) },
  hosts: { shaper: { version: 1, cutPlan: [[keyOf('loop', loopB), outsideB]], stock: { thickness: 19.05, width: null, height: null, margin: 12.7 }, opOrder: [] } },
}));

// ---- A. the one normaliser ------------------------------------------------------------------------------------------------------------------------------
{
  const st = createSketchState();
  ok(!('vcarves' in st), 'the shared sketch state has no V-carve part');
  const r = deserializeDocument(oldDoc(true), st);
  eq([r.ok, r.removedVcarves], [true, 1], 'an old document loads; removedVcarves counts the one record that had a region');
  ok(!('vcarves' in st), 'its V-carve records are not loaded into the state');
  eq(serializeDocument(st).geometry.vcarves, undefined, 'a re-save writes no V-carve list');
  eq(deserializeDocument(oldDoc(false), createSketchState()).removedVcarves, 0, 'a document without V-carves: removedVcarves 0');
  const undoSnap = st._captureSnapshot ? st._captureSnapshot() : null;
  if (undoSnap) ok(!('vcarves' in undoSnap), 'an undo snapshot carries no V-carve part');
}

// ---- B + C. Shaper opens the old design ------------------------------------------------------------------------------------------------------------------
applyShaperUnitDefault();
const openOld = async (withVcarves, name) => {
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', name, oldDoc(withVcarves));
  return open({ host: 'shaper', profile });
};
const openMode = (app, mode) => { app.press(app.document.querySelector(`.sk-header-tab[data-tab="${mode}"]`)); eq(app.document.querySelector('.sk-header-tab.active').dataset.tab, mode, 'the ' + mode + ' tab opens'); };
const notice = (app) => { const el = app.document.getElementById('prepare-notice'); return { hidden: el.hidden, text: el.textContent }; };

let exportOld = null;
{
  const app = await openOld(true, 'Old V-carve design');
  try {
    ok(!('vcarves' in app.state), 'Shaper: the opened design has no V-carve in its state');
    eq(app.modes.current(), 'design', 'Shaper opens the design in Design');
    eq(notice(app).hidden, true, 'the notice is not shown outside Prepare');
    eq([...CUT_PLAN.keys()], [keyOf('loop', loopB)], 'the V-carved region is simply unassigned: the plan has only the Outside cut');
    openMode(app, 'prepare');
    eq(notice(app), { hidden: false, text: removedVcarvesNotice(1) }, 'Prepare shows the one-time notice on its first mount');
    eq(removedVcarvesNotice(1), 'This design had a V-carve region; V-carve was removed. Pick a cut type for it (V-bit cutter shape for a V-groove).', 'the notice text');
    eq(removedVcarvesNotice(3), 'This design had 3 V-carve regions; V-carve was removed. Pick a cut type for them (V-bit cutter shape for a V-groove).', 'the notice text, plural');
    const el = app.document.getElementById('prepare-notice'); el.hidden = true; el.textContent = ''; // as its timer leaves it
    openMode(app, 'design'); openMode(app, 'prepare');
    eq(notice(app), { hidden: true, text: '' }, 'a second Prepare mount shows no notice: it is shown once');
    exportOld = shaperSvgOf(app.state, cutPlanEntries());
    ok(/shaper:cutType="outside"/.test(exportOld) && !/cutType="online"/.test(exportOld), 'the export has the Outside cut and no V-carve paths');
    const stored = await app.storedDoc(); // the autosave's page-hide path: nothing changed, so nothing is written
    eq(stored.geometry.vcarves, VCARVES, 'the stored file keeps its V-carve list until the user saves (an untouched open writes nothing)');
    CUT_PLAN.set(keyOf('loop', loopA), { ...outsideB, cutType: 'online', cutterShape: 'vbit', cutterAngle: 60 }); // the user picks a cut for the region: a V-groove
    const saved = await app.storedDoc();
    eq(saved.geometry.vcarves, undefined, 'once the user changes the design, the save writes no V-carve list');
    eq(saved.hosts.shaper.cutPlan.find(([k]) => k === keyOf('loop', loopA))[1].cutterShape, 'vbit', 'the region is cut with the V-bit cutter shape');
  } finally { await app.close(); }
}
{
  const app = await openOld(false, 'Same design, no V-carve');
  try {
    openMode(app, 'prepare');
    eq(notice(app).hidden, true, 'a design without V-carve regions: no notice');
    const exportNone = shaperSvgOf(app.state, cutPlanEntries());
    eq(exportNone, exportOld, 'C: the export of the old design == the export of the same design with its V-carve list deleted beforehand (byte for byte)');
  } finally { await app.close(); }
}

// ---- D. the stage lists (and so the analytics stage events) ------------------------------------------------------------------------------------------------
eq(SHAPER_STAGES.map((s) => s.id), ['design', 'prepare', 'review'], 'Shaper: Design, Prepare, Export (id review): no V-carve stage');
eq(shaperStagesFor({ fusion: true }).map((s) => s.id), ['prepare', 'review'], 'Shaper in Fusion mode: Prepare, Export');

// ---- E. the V-bit cutter shape is unchanged ------------------------------------------------------------------------------------------------------------------
eq(vbitHalfAngleTan(90), Math.tan(Math.PI / 4), 'tan(45) for a 90 deg V-bit');
eq(vbitHalfAngleTan(60), Math.tan(Math.PI / 6), 'tan(30) for a 60 deg V-bit');
eq(vbitHalfAngleTan(undefined), Math.tan(Math.PI / 4), 'no angle = 90 deg (as before)');
{
  const p = cutterProfile('vbit', 6, 60, 4), t = Math.tan(Math.PI / 6);
  eq([p.shape, p.r, p.xMax], ['vbit', 3, Math.min(3, 4 * t)], 'the V groove: half-width = depth x tan(half angle), capped at the flute radius');
  eq(p.depthAt(1), 4 - 1 / t, 'its depth falls linearly from the line');
  eq(cutterTerraces('vbit', 6, 60, 4).length, SHAPE_SLICES.vbit, 'its terraces (the 3D preview V walls)');
}
console.log(`vcarve-removed-741-node: ${checks} checks pass`);
