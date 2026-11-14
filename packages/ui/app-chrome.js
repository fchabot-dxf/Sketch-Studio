// packages/ui/app-chrome.js — ONE shared mount for the desktop header, ☰ sidebar menu, document tab strip, and phone peeking handle.
// Each host DECLARES its appId, stages, and menu entries; no host builds its own <header>, stage nav, or phone menu toggle.

import { createAppHeader } from './app-header.js';
import { mountProjectSidebar } from './sidebar-projects.js';

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
  store,
  account,
} = {}) {
  let header = null;
  let sidebar = null;

  const setActiveStage = (id) => {
    if (header) header.setActiveTab(id);
    if (sidebar) sidebar.setActiveStage(id);
  };

  const selectStage = (id) => {
    setActiveStage(id);
    if (onStageChange) onStageChange(id);
  };

  const initial = activeStage ?? (stages[0] && stages[0].id) ?? null;

  sidebar = mountProjectSidebar({
    appId,
    getBuffer,
    importFile,
    hostActions,
    documentTabs,
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
