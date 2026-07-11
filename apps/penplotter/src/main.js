// apps/penplotter/src/main.js — Pen Plotter shell. A DECLARED stage-pipeline router built ENTIRELY by iterating
// STAGES, plus the shared two-way app-switcher. UNIFY-4a: Draw + Sketch MERGED into ONE 'Design' tab (the shared
// #core/#ui sketcher); shell = Design -> Fill -> Toolpath -> Export (4 tabs). The plotter #canvasWrap is re-homed to
// a HIDDEN host so Fill/Toolpath/Export can borrow it (they render #core geometry via UNIFY-2). Design: INTEGRATION.md.
import { createAppSwitcher } from '#ui/app-switcher.js';
import { mountDrawStage } from './draw-stage.js'; // UNIFY-4a: re-homed to a HIDDEN host (owns #canvasWrap); art store DORMANT (UNIFY-7 retires)
import { mountToolpathStage } from './toolpath-stage.js'; // PP-4a: the Toolpath stage (borrows the shared canvas). MERGE-1: now hosts the fill/outline editor inline (active-layer-panel).
import { mountExportStage } from './export-stage.js'; // PP-6: the Export stage (gcode + zip + pen-width sim)
import { mountSketchStage } from './sketch-stage.js'; // UNIFY-4a: the merged 'Design' tab = the shared #core/#ui sketcher

// The pipeline stages, declared as DATA. INTEGRATION.md: "Stages / tabs" is a registry — one entry lights up the
// nav AND (later) its mount(). Adding/reordering a stage is ONE edit here; the nav + the stage bodies + the router
// all DERIVE from this list (single source of truth), so there are no hardcoded tabs or containers to keep in sync.
const STAGES = [
  { id: 'design',   label: 'Design',   part: 'UNIFY-4', blurb: 'Draw + precise + constraint geometry — one #core store, pen colors.' },
  // MERGE-1: Fill folded into Toolpath (one shared state.toolpaths record) — pipeline is Design -> Toolpath -> Export.
  { id: 'toolpath', label: 'Toolpath', part: 'PP-2', blurb: 'Pen, fill/outline, order, optimize, up/down, feeds.' },
  { id: 'export',   label: 'Export',   part: 'PP-2', blurb: 'G-code per pen + a zip.' },
];
const STAGE_KEY = 'penplotter-stage'; // persist the active stage across reloads (mirrors Shaper's MODE_KEY)

// Per-stage MOUNTERS: a stage that needs live wiring registers a mount(view) here; the router calls it ONCE on
// first entry (returning an optional { onEnter } re-run each entry). UNIFY-4a: 'design' = the shared sketcher; the
// retired Draw scaffold is mounted separately into a HIDDEN host at startup (below) — it is NOT a tab.
const STAGE_MOUNT = { design: mountSketchStage, toolpath: mountToolpathStage, export: mountExportStage };
const mounted = {};
let currentStageId = null; // the showing stage; drives the isActive gate + which stage gets onLeave on a switch

// Mount the shared app-switcher (marks Pen Plotter current; navigates to Sketch Studio / Shaper).
const swHost = document.getElementById('app-switcher-host');
if (swHost) swHost.appendChild(createAppSwitcher({ current: 'penplotter' }).el);

// Build the nav buttons AND the stub stage bodies BY ITERATING STAGES (declaration-first — nothing hardcoded).
const nav = document.getElementById('mode-nav');
const stagesHost = document.getElementById('stages');
const btns = new Map();
const views = new Map();
STAGES.forEach((s, i) => {
  const btn = document.createElement('button');
  btn.className = 'stage-btn';
  btn.dataset.stage = s.id;
  btn.innerHTML = s.label + (s.optional ? '<span class="opt">optional</span>' : '');
  btn.addEventListener('click', () => showStage(s.id));
  nav.appendChild(btn);
  btns.set(s.id, btn);

  const view = document.createElement('section');
  view.className = 'stage';
  view.id = 'stage-' + s.id;
  view.hidden = true;
  view.innerHTML =
    '<div class="badge">Stage ' + (i + 1) + ' of ' + STAGES.length + (s.optional ? ' - optional' : '') + '</div>' +
    '<h2>' + s.label + '</h2>' +
    '<p>' + s.blurb + '</p>' +
    '<p class="badge">Coming in ' + s.part + '</p>';
  stagesHost.appendChild(view);
  views.set(s.id, view);
});

// The view-router: show the active stage's body, hide the rest, highlight its tab; persist the choice.
function showStage(id) {
  if (!views.has(id)) id = STAGES[0].id;
  const prev = currentStageId;
  for (const s of STAGES) {
    views.get(s.id).hidden = (s.id !== id);
    btns.get(s.id).classList.toggle('active', s.id === id);
  }
  try { localStorage.setItem(STAGE_KEY, id); } catch (_) { /* storage blocked */ }
  // Pause the stage being LEFT before entering the next — a GENERIC onLeave hook (mirrors Shaper stopping the
  // Design RAF off-tab) so no stage is special-cased in the router; PP-7a's Sketch stage uses it to stop its loop.
  if (prev && prev !== id && mounted[prev] && mounted[prev].onLeave) mounted[prev].onLeave();
  currentStageId = id;
  // Mount-on-first-entry + re-fit-on-entry for stages that wire live content (PP-3a: draw). The view is now
  // visible (hidden toggled above), so a mounter reading the container size gets a real rect. The ctx.isActive
  // closure lets a stage gate global input to itself (PP-7a: the sketcher's document listeners).
  const mounter = STAGE_MOUNT[id];
  if (mounter) {
    if (!mounted[id]) mounted[id] = mounter(views.get(id), { isActive: () => currentStageId === id, navigate: (to) => showStage(to) }) || {};
    if (mounted[id].onEnter) mounted[id].onEnter();
  }
}

// UNIFY-6: pre-mount the DESIGN sketcher at startup so the SHARED view (state.coreSketch.view) exists BEFORE the
// draw host's plotter canvas reads it for pan/zoom convergence. showStage(initial) reuses this instance (mount-once).
if (STAGE_MOUNT.design && !mounted.design) mounted.design = STAGE_MOUNT.design(views.get('design'), { isActive: () => currentStageId === 'design', navigate: (to) => showStage(to) }) || {};

// UNIFY-4a: the plotter #canvasWrap was owned by the retired Draw tab. Re-home it — mount the Draw scaffold ONCE into
// a HIDDEN host at startup so #canvasWrap always exists (+ initDom + initLayers' default toolpath). Fill/Toolpath/
// Export borrow it by re-parenting on entry; they render #core geometry via UNIFY-2. The art store + art tools +
// the transform HUD (the '°' field) live in this hidden host = DORMANT, never shown, until UNIFY-7 retires them.
const drawHost = document.createElement('section');
drawHost.id = 'stage-draw';
drawHost.hidden = true;
stagesHost.appendChild(drawHost);
mounted.draw = mountDrawStage(drawHost, { isActive: () => currentStageId === 'draw', navigate: (to) => showStage(to) }) || {};

// Initial stage: the persisted one if still valid, else the first.
let initial = STAGES[0].id;
try { const saved = localStorage.getItem(STAGE_KEY); if (saved && views.has(saved)) initial = saved; } catch (_) {}
showStage(initial);
