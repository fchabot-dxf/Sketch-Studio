// tests/helpers/import-via-menu.js — TASK 566: import a file the way a user does: sidebar > "Import SVG / DXF…" > the real file chooser
// (intercepted with Page.setInterceptFileChooserDialog, answered with DOM.setFileInputFiles). Real mouse clicks (the picker needs a user gesture).
// `cdp` is the object launchBrowser returns. Resolves { label } (the entry's text) once the chooser was answered; the caller waits for the import's own result.
// TASK 893: each click waits until its target is shown, inside the viewport and not moving (settledCentre): the drawer's Import entry was clicked a
// fixed 350 ms after the sidebar button, mid-slide on a loaded PC, and the click missed it.
import { settledCentre } from './settled-centre.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickAt(cdp, c) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 }); await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
}

export async function importViaMenu(cdp, file) {
  // force the <input type=file> path of the browser seam so the real chooser can be intercepted
  await cdp.evalJs('delete window.showOpenFilePicker');
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = cdp.once('Page.fileChooserOpened');
  await clickAt(cdp, await settledCentre(cdp, '.sk-sidebar-btn', 'the sidebar button'));
  const entry = await settledCentre(cdp, '[data-action="import-file"]', "the drawer's Import entry");
  const label = await cdp.evalJs(`(document.querySelector('[data-action="import-file"]') || {}).textContent`);
  await clickAt(cdp, entry);
  const fc = await Promise.race([chooser, sleep(5000).then(() => null)]);
  if (!fc) throw new Error('the file chooser did not open');
  await cdp.send('DOM.setFileInputFiles', { files: [file], backendNodeId: fc.backendNodeId });
  return { label: label && label.trim() };
}

export const hasImportEntry = (cdp) => cdp.evalJs(`!!document.querySelector('[data-action="import-file"]')`);
