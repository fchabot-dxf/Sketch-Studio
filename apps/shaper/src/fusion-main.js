// apps/shaper/src/fusion-main.js — TASK 881: the boot of Shaper's FUSION PANEL build (owner turns 3487-3490: the website, without the parts the panel does not
// use). scripts/build-site.cjs `shaper-fusion` writes the panel's index.html from the website's page with this module as its entry; the Fusion add-in
// carries that folder and serves it from its own local server (SA-32), so the panel is always the add-in's own version and needs no network for its files.
// Shaper's page wiring is the website's own (shaper-app.js, one source); what the panel DECLARES here instead of the website's parts (docs/FUSION-PANEL-881.md):
//   Fusion mode always (the panel exists only in Fusion's palette; not read from the address);
//   the plain drawer (#ui/app-shell.js): the stage switcher and Log; no project layer, Google Drive, account, Settings, Download, STL entries, add-in
//   download, About or Rate & feedback (owner turns 3494 / 3503);
//   no STL part (owner turn 3604, TASK 885): no Insert STL in Prepare's toolbar (no INSERT section), no STL card, stl-import.js not loaded;
//   the autosave loop on an in-memory store (the workspace lives in the Fusion design: SA-19's save_project), so nothing is kept in the browser.
// Not loaded at all (the build's module graph proves it, tests/fusion-panel-881-node.test.js): the website's main.js and every module only it reaches.

import { startShaperApp } from './shaper-app.js';
import { mountAppShell, mountPlainSidebar } from '#ui/app-shell.js';
import { createDocumentBuffer } from '#ui/document-buffer-core.js';
import { createProjectStore, createMemoryAdapter } from '#ui/project-store-core.js';

export { currentReviewView, currentExportSim } from './shaper-app.js'; // read by the live tests through this module

startShaperApp({
  fusion: true,
  createDocumentBuffer,
  bufferStore: () => createProjectStore({ adapter: createMemoryAdapter(), legacySource: async () => null, channel: null }), // TASK 855c: the workspace is the Fusion design's
  mountChrome: ({ hostActions, ...decl }) => mountAppShell({
    ...decl,
    mountSidebar: (drawer) => mountPlainSidebar({ appId: decl.appId, actions: hostActions, ...drawer }),
  }),
  menu: (app) => [app.logAction], // owner turn 3494: "only thing i use is log"
});
