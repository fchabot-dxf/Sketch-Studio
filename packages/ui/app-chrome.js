// packages/ui/app-chrome.js — ONE shared mount for the desktop header, ☰ sidebar menu, document tab strip, and phone peeking handle.
// Each host DECLARES its appId, stages, and menu entries; no host builds its own <header>, stage nav, or phone menu toggle.

import { createAppHeader } from './app-header.js';
import { mountProjectSidebar } from './sidebar-projects.js';
import { startAnalytics, track } from './analytics.js'; // TASK 738: the app's visit, and the stage it picks

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
  startAnalytics({ app: appId, host }); // TASK 738: the visit (once per page load; analytics.js sends only from a public page)

  let header = null;
  let sidebar = null;

  // TASK 737: the shown stage is also named on <html data-sk-stage="...">, so a host's CSS DECLARES per stage the surface directly below the document tab strip
  // (--sk-doctab-surface, document-tabs.js: the active tab takes that colour and joins it). Every host switches its stage through here.
  const markStage = (id) => { if (id != null && typeof document !== 'undefined' && document.documentElement) document.documentElement.dataset.skStage = id; };

  const setActiveStage = (id) => {
    if (header) header.setActiveTab(id);
    if (sidebar) sidebar.setActiveStage(id);
    markStage(id);
  };

  const selectStage = (id) => {
    track('stage:' + id); // TASK 738: a stage tab picked (the header or the menu)
    setActiveStage(id);
    if (onStageChange) onStageChange(id);
  };

  const initial = activeStage ?? (stages[0] && stages[0].id) ?? null;
  markStage(initial);

  sidebar = mountProjectSidebar({
    appId,
    getBuffer,
    importFile,
    hostActions,
    documentTabs: projects ? documentTabs : false,
    projects,
    store,
    account,
    stages,
    activeStage: initial,
    onStageChange: selectStage,
  });

  header = createAppHeader({
    leading: sidebar.el,
    tabs: stages,
    activeTab: initial,
    onTabChange: selectStage,
  });

  if (container) header.render(container);
  else if (typeof document !== 'undefined' && document.body) document.body.insertBefore(header.el, document.body.firstChild);

  return {
    header,
    sidebar,
    setActiveStage,
    refreshStatus: () => sidebar.refreshStatus(),
    destroy: () => { header.destroy(); sidebar.destroy(); },
  };
}
