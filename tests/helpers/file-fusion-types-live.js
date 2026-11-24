// tests/helpers/file-fusion-types-live.js — TASK 882: a Fusion selection makes NO operation any more (apps/shaper/src/fusion-import.js). A live test that is about
// something else and wants the old set-up (each region in the operation of the cut type Fusion hinted) calls this after the selection_data: in the page, every
// region that is in no operation and has a cut type in its source (regions[key].source, what the payload said) is filed through the ONE writer (cut-plan.js
// fileShape) with that type and the depth its record prefills. Then the stage is left and entered again (fileSourceTypesAndRemount) so it shows them.
export async function fileSourceTypes(evalJs, base = '/apps/shaper/src') { // base = where the page serves the Shaper modules (a built site: '/src')
  await evalJs(`Promise.all([import('${base}/cut-plan.js'), import('${base}/operations-store.js')]).then(([c, s]) => {
    for (const k of s.regionKeys()) { const src = (s.regionOf(k) || {}).source; if (src && src.cutType && !s.memberOf(k)) c.fileShape(k, { ...c.freshRecord(k), cutType: src.cutType }, window.__designController.state); }
  })`);
}
/** fileSourceTypes, then another stage and back to the one shown (entering Prepare mounts it from the store; the Review rebuilds). */
export async function fileSourceTypesAndRemount({ evalJs, waitFor, base }) {
  await fileSourceTypes(evalJs, base);
  const here = await evalJs(`(document.querySelector('.sk-header-tab.active') || {}).dataset ? document.querySelector('.sk-header-tab.active').dataset.tab : 'prepare'`);
  const other = here === 'prepare' ? 'review' : 'prepare';
  for (const tab of [other, here]) {
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="${tab}"]').click()`);
    await waitFor(`!document.getElementById('view-${tab}').hidden`, `${tab} shown`);
  }
  await new Promise((r) => setTimeout(r, 500)); // the stage's first paint settles
}
