// apps/penplotter/src/main.js — Pen Plotter shell. A DECLARED stage-pipeline router built ENTIRELY by iterating
// STAGES, plus the shared app sidebar. UNIFY-4a: Draw + Sketch MERGED into ONE 'Design' tab (the shared
// #core/#ui sketcher); shell = Design -> Fill -> Toolpath -> Export (4 tabs). The plotter #canvasWrap is re-homed to
// a HIDDEN host so Fill/Toolpath/Export can borrow it (they render #core geometry via UNIFY-2). Design: INTEGRATION.md.
import { SIDEBAR_ICONS } from '#ui/app-sidebar.js';
import { getGoogleAccount } from '#ui/cloud/google-account.js'; // TASK 488: probe the server session once at start (signing in syncs nothing)
getGoogleAccount().init();
import { mountProjectSidebar } from '#ui/sidebar-projects.js'; // TASK 479: project actions + views (store-backed), same entries in every editor // TASK 473: the shared app sidebar (replaces the app-switcher dropdown)
import { applyAppIdentity } from '#ui/app-registry.js'; // TASK 473: tab title + favicon from the registry
applyAppIdentity('penplotter');
import { onExportClick } from './export.js';
import { getDocBuffer, importDrawing } from './sketch-stage.js'; // UNIFY-4a: the merged 'Design' tab = the shared #core/#ui sketcher
import { mountStages } from './stages.js'; // TASK 583: the stage pipeline (list, nav, router, Design + Draw mounts), declared once (the node test kit calls it too)
import { createDiagnosticLog } from '#ui/diagnostic-log.js'; // DIAG-OVERLAY: mobile-usable log + Copy Report

// TASK 473: the shared app sidebar; this host declares ITS actions: Download = the G-code zip export, New = a fresh document.
const swHost = document.getElementById('app-sidebar-host');
if (swHost) {
  swHost.appendChild(mountProjectSidebar({
    appId: 'penplotter', getBuffer: () => getDocBuffer(), importFile: importDrawing, documentTabs: true, // TASK 605: the document tab strip under the header, in every stage // TASK 566: "Import SVG / DXF…" in the file menu
    hostActions: [
      { id: 'download', label: 'Download', icon: SIDEBAR_ICONS.download, tooltip: 'Download the G-code (.zip)', onClick: () => onExportClick() },
    ],
  }).el);
}

// DIAG-OVERLAY: reuses the existing window.__sketch dev/test seam (sketch-stage.js) rather than
// threading a new export through the stage-mount API.
const _diagLog = createDiagnosticLog({ appId: 'penplotter', state: () => window.__sketch && window.__sketch.controller.state });
if (swHost) swHost.parentElement.appendChild(_diagLog.toggleEl);

// The stage pipeline (stages.js): the nav buttons + stage bodies from its declared list, the router, the Design + Draw mounts.
mountStages({ nav: document.getElementById('mode-nav'), stagesHost: document.getElementById('stages') });
