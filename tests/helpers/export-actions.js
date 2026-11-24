// tests/helpers/export-actions.js -- TASK 880 (owner turn 3484): Shaper's Export view has no side panel. Its three actions are the Export stage's HEADER
// actions (#btn-generate-svg, #btn-sync-shaper, #link-shaper-hub: app-header.js buildStageAction); where the header hides (a phone, a phone in landscape) the
// drawer lists the same actions under its stage buttons (.sk-sidebar-stage-actions [data-action="<id>"]). Its Thickness and Material are the footer's
// controls (#review-settings), folded into one footer button (#btn-footer-controls) where the footer row is short (app-footer.js FOOTER_FOLD_QUERY).
//
// pressExportAction(cdp, click, id): presses the action as a user sees it: the header's button, or (header hidden) the drawer's copy after opening the drawer.
//   click(selector) = the test's own real press (mouse or touch).
// openCutsCard(cdp, click): the 2D / Paths view's Cuts card (over the view) unfolded, its list at the top.
// showExportSettings(cdp, click): makes the footer's Export settings reachable (opens the fold card where they are folded); returns true if it opened it.
const shown = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`;

export async function pressExportAction({ evalJs, waitFor }, click, id) {
  if (await evalJs(shown('#' + id))) { await click('#' + id); return 'header'; }
  await click('.sk-sidebar-chevron');
  const sel = `.sk-sidebar-stage-actions [data-action="${id}"]`;
  await waitFor(shown(sel), 'the drawer lists the Export action ' + id);
  await click(sel);
  return 'drawer';
}

export async function showExportSettings({ evalJs, waitFor }, click) {
  if (await evalJs(shown('#review-settings'))) return false;
  await click('#btn-footer-controls');
  await waitFor(shown('#review-settings'), 'the footer fold card shows the Export settings');
  return true;
}

// openCutsCard(cdp, click): the 2D / Paths view's Cuts card unfolded (it starts folded on a phone, disclosure.js), its list scrolled to the top.
export async function openCutsCard({ evalJs, waitFor }, click) {
  if (await evalJs(`document.getElementById('review-cuts').dataset.open === 'false'`)) {
    await click('#review-cuts-head');
    await waitFor(`document.getElementById('review-cuts').dataset.open === 'true'`, 'the Cuts card unfolds');
  }
  await evalJs(`document.getElementById('review-cuts-list').scrollTop = 0`);
}
