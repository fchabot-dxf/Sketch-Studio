// tests/helpers/go-stage.js — TASK 895: switch the Sketch-Studio shell to a stage (prepare / review / ...) the way a user does. Phone width (<= 640):
// open the sidebar drawer (chevron) and click the stage's drawer entry; wider: click the header tab. Every click aims at settledCentre
// (tests/helpers/settled-centre.js): the drawer slides in, and a click on a rect measured mid-slide misses on a loaded PC. Then waits until the stage's view is shown.
// makeGoStage({ cdp, width, click }): `cdp` is what launchBrowser returns, `click(sel)` is the test's own click-on-selector.
import { settledCentre } from './settled-centre.js';

export function makeGoStage({ cdp, width, click }) {
  return async (tab) => {
    if (width <= 640) {
      if (!await cdp.evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) {
        await settledCentre(cdp, '.sk-sidebar-chevron', 'sidebar chevron');
        await click('.sk-sidebar-chevron');
      }
      await settledCentre(cdp, `.sk-sidebar-stage[data-tab="${tab}"]`, `${tab} drawer entry`);
      await click(`.sk-sidebar-stage[data-tab="${tab}"]`);
    } else {
      await settledCentre(cdp, `.sk-header-tab[data-tab="${tab}"]`, `${tab} header tab`);
      await click(`.sk-header-tab[data-tab="${tab}"]`);
    }
    await cdp.waitFor(`!document.getElementById('view-${tab}').hidden`, `${tab} stage visible`);
  };
}
