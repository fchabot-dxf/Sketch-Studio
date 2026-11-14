// apps/penplotter/src/main.js — Pen Plotter shell. A DECLARED stage-pipeline router built ENTIRELY by iterating
// STAGES, plus the shared app sidebar. UNIFY-4a: Draw + Sketch MERGED into ONE 'Design' tab (the shared
// #core/#ui sketcher); shell = Design -> Fill -> Toolpath -> Export (4 tabs). The plotter #canvasWrap is re-homed to
// a HIDDEN host so Fill/Toolpath/Export can borrow it (they render #core geometry via UNIFY-2). Design: INTEGRATION.md.
import { mountAppChrome } from '#ui/app-chrome.js';
import { SIDEBAR_ICONS } from '#ui/app-sidebar.js';
import { getGoogleAccount } from '#ui/cloud/google-account.js'; // TASK 488: probe the server session once at start (signing in syncs nothing)
getGoogleAccount().init();
import { applyAppIdentity } from '#ui/app-registry.js'; // TASK 473: tab title + favicon from the registry
applyAppIdentity('penplotter');
import { onExportClick } from './export.js';
import { getDocBuffer, importDrawing } from './sketch-stage.js'; // UNIFY-4a: the merged 'Design' tab = the shared #core/#ui sketcher
import { STAGES, mountStages } from './stages.js'; // TASK 583: the stage pipeline (list, nav, router, Design + Draw mounts), declared once (the node test kit calls it too)
import { mountAppFooter } from '#ui/app-footer.js'; // TASK 618: Undo / Redo, Recenter in the footer
import { createDiagnosticLog } from '#ui/diagnostic-log.js'; // DIAG-OVERLAY: mobile-usable log + Copy Report

// DIAG-OVERLAY: reuses the existing window.__sketch dev/test seam (sketch-stage.js).
const _diagLog = createDiagnosticLog({ appId: 'penplotter', state: () => window.__sketch && window.__sketch.controller.state });

let chrome = null;
const { showStage, currentStageId, history, designView } = mountStages({
  stagesHost: document.getElementById('stages'),
  onActiveChange: (id) => { if (chrome) chrome.setActiveStage(id); },
});
chrome = mountAppChrome({
  appId: 'penplotter',
  stages: STAGES.map(({ id, label }) => ({ id, label })),
  activeStage: currentStageId(),
  onStageChange: (id) => showStage(id),
  getBuffer: () => getDocBuffer(),
  importFile: importDrawing,
  hostActions: [
    { id: 'download', label: 'Download', icon: SIDEBAR_ICONS.download, tooltip: 'Download the G-code (.zip)', onClick: () => onExportClick() },
    { divider: true },
    { id: 'log', label: 'Log', icon: SIDEBAR_ICONS.log, onClick: () => _diagLog.toggle() },
  ],
});
mountAppFooter({ router: history, view: designView }); // TASK 618: no Construction toggle in this host (it has none today)
