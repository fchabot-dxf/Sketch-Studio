// packages/ui/app-chrome.js — ONE shared mount for the desktop header, ☰ sidebar menu, document tab strip, and phone drawer chevron.
// Each host DECLARES its appId, stages, and menu entries; no host builds its own <header>, stage nav, or phone menu toggle.
// TASK 881: the header, the drawer's mount and the analytics visit are #ui/app-shell.js (the part a page without the project layer also has: Shaper's
// Fusion panel build); this module is that shell with the PROJECT drawer (sidebar-projects.js) and the project layer's services (feedback, settings sync).

import { mountAppShell } from './app-shell.js';
import { mountProjectSidebar } from './sidebar-projects.js';
import { startFeedback } from './feedback.js'; // TASK 830: the one automatic "Rate & feedback" ask, after the 2nd export
import { getProjectStore } from './project-store.js';
import { getGoogleAccount } from './cloud/google-account.js';
import { startSettingsSync } from './cloud/settings-sync.js'; // TASK 773: the user's settings follow him through his Google Drive

export function mountAppChrome({
  appId,
  container = null,
  stages = [],
  activeStage = null,
  onStageChange = null,
  getBuffer,
  importFile = null,
  hostActions = [],
  documentTabs = true,
  projects = true,
  store,
  account,
  host = 'web', // TASK 738: where the app runs, for the analytics: 'web', or 'fusion' (Shaper's Fusion 360 palette)
} = {}) {
  startFeedback({ appId }); // TASK 830: counts the exports (the declared export features) for the one automatic ask
  // TASK 773: the settings sync (once per page; it reads Drive in the background only while signed in). Only where the app has the projects layer and so the
  // sign-in: Fusion mode (projects: false) keeps its settings on this device.
  if (projects) startSettingsSync({ store: store || getProjectStore(), account: account || getGoogleAccount() });

  return mountAppShell({
    appId, container, stages, activeStage, onStageChange, host,
    mountSidebar: ({ activeStage: initial, onStageChange: selectStage }) => mountProjectSidebar({
      appId,
      getBuffer,
      importFile,
      hostActions,
      host,
      documentTabs: projects ? documentTabs : false,
      projects,
      store,
      account,
      stages,
      activeStage: initial,
      onStageChange: selectStage,
    }),
  });
}
