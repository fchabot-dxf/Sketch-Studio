// apps/penplotter/src/main.js — Pen Plotter shell (PP-1 scaffold). App #3, "a tab like Shaper": a DECLARED
// 5-stage pipeline router built ENTIRELY by iterating STAGES, plus the shared two-way app-switcher. SKELETON
// ONLY — no engines, no Design tab yet (PP-2..PP-5). Design record: penplotter/INTEGRATION.md. No #core imports.
import { createAppSwitcher } from '#ui/app-switcher.js';
import { mountDrawStage } from './draw-stage.js'; // PP-3a: the Draw stage mounts its canvas on first entry
import { mountToolpathStage } from './toolpath-stage.js'; // PP-4a: the Toolpath stage (borrows the shared canvas)
import { mountFillStage } from './fill-stage.js'; // PP-5: the Fill stage (2nd tab over the same state.toolpaths)
import { mountExportStage } from './export-stage.js'; // PP-6: the Export stage (gcode + zip + pen-width sim)

// The pipeline stages, declared as DATA. INTEGRATION.md: "Stages / tabs" is a registry — one entry lights up the
// nav AND (later) its mount(). Adding/reordering a stage is ONE edit here; the nav + the stage bodies + the router
// all DERIVE from this list (single source of truth), so there are no hardcoded tabs or containers to keep in sync.
const STAGES = [
  { id: 'draw',     label: 'Draw',     part: 'PP-3', blurb: 'Freeform art canvas, SVG import, art layers + pens.' },
  { id: 'sketch',   label: 'Sketch',   part: 'PP-5', blurb: 'Optional precise geometry — the shared #core/#ui Design tab.', optional: true },
  { id: 'fill',     label: 'Fill',     part: 'PP-2', blurb: 'Fill patterns + outline styles per region.' },
  { id: 'toolpath', label: 'Toolpath', part: 'PP-2', blurb: 'Pen assignment, order, optimize, up/down, feeds.' },
  { id: 'export',   label: 'Export',   part: 'PP-2', blurb: 'G-code per pen + a zip.' },
];
const STAGE_KEY = 'penplotter-stage'; // persist the active stage across reloads (mirrors Shaper's MODE_KEY)

// Per-stage MOUNTERS: a stage that needs live wiring registers a mount(view) here; the router calls it ONCE on
// first entry (returning an optional { onEnter } re-run each entry). PP-3a wires 'draw'; other stages stay stubs.
const STAGE_MOUNT = { draw: mountDrawStage, toolpath: mountToolpathStage, fill: mountFillStage, export: mountExportStage };
const mounted = {};

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
  for (const s of STAGES) {
    views.get(s.id).hidden = (s.id !== id);
    btns.get(s.id).classList.toggle('active', s.id === id);
  }
  try { localStorage.setItem(STAGE_KEY, id); } catch (_) { /* storage blocked */ }
  // Mount-on-first-entry + re-fit-on-entry for stages that wire live content (PP-3a: draw). The view is now
  // visible (hidden toggled above), so a mounter reading the container size gets a real rect.
  const mounter = STAGE_MOUNT[id];
  if (mounter) {
    if (!mounted[id]) mounted[id] = mounter(views.get(id)) || {};
    if (mounted[id].onEnter) mounted[id].onEnter();
  }
}

// PP-4a: mount the Draw stage ONCE at startup so the SHARED plotter canvas (#canvasWrap) always exists — the
// Toolpath/Fill/Export stages borrow it by re-parenting on entry, even when the persisted initial stage isn't Draw.
if (STAGE_MOUNT.draw && !mounted.draw) mounted.draw = STAGE_MOUNT.draw(views.get('draw')) || {};

// Initial stage: the persisted one if still valid, else the first.
let initial = STAGES[0].id;
try { const saved = localStorage.getItem(STAGE_KEY); if (saved && views.has(saved)) initial = saved; } catch (_) {}
showStage(initial);
