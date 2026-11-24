// packages/ui/app-shell.js — TASK 881: the app chrome's SHELL, the part every page has: the desktop header (stage tabs, the stage's declared actions),
// the drawer the header's menu button opens, the <html data-sk-stage> mark, and the page's analytics visit. The drawer comes in DECLARED (`mountSidebar`):
//   #ui/app-chrome.js passes the project drawer (sidebar-projects.js: documents, Drive, account; the four websites);
//   a page without the project layer passes mountPlainSidebar below (the host's own items + the stage switcher; Shaper's Fusion panel build), so it loads
//   none of the project, Drive or Google sign-in modules.
// Moved out of app-chrome.js unchanged (TASK 619 / 737 / 738); app-chrome.js is this shell plus the project layer's services (feedback, settings sync).

import { createAppHeader } from './app-header.js';
import { createAppSidebar } from './app-sidebar.js';
import { startAnalytics, track } from './analytics.js'; // TASK 738: the app's visit, and the stage it picks

/**
 * mountAppShell({ appId, container, stages, activeStage, onStageChange, host, mountSidebar }) -> { header, sidebar, setActiveStage, refreshStatus, destroy }
 *   mountSidebar({ stages, activeStage, onStageChange }) -> the drawer (a #ui/app-sidebar.js sidebar): called once, before the header, which holds its button.
 */
export function mountAppShell({
  appId,
  container = null,
  stages = [],
  activeStage = null,
  onStageChange = null,
  host = 'web', // TASK 738: where the app runs, for the analytics: 'web', or 'fusion' (Shaper's Fusion 360 palette)
  mountSidebar,
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

  sidebar = mountSidebar({ stages, activeStage: initial, onStageChange: selectStage });

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

/**
 * The drawer without the project layer: the host's own `actions` (app-sidebar.js items) and the stage switcher; no document name, no status line, no
 * document tab strip, so its phone door (the chevron) sits on the page's corner (TASK 819, as sidebar-projects.js places it when it has no tab strip).
 */
export function mountPlainSidebar({ appId, actions = [], stages = [], activeStage = null, onStageChange = null }) {
  const sidebar = createAppSidebar({ current: appId, docName: null, actions, status: null, stages, activeStage, onStageChange, onRenameDoc: null });
  sidebar.chevron.classList.add('free');
  document.body.appendChild(sidebar.chevron);
  return sidebar;
}
