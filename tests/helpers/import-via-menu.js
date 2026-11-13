// tests/helpers/import-via-menu.js — TASK 566: import a file the way a user does: sidebar > "Import SVG / DXF…" > the real file chooser
// (intercepted with Page.setInterceptFileChooserDialog, answered with DOM.setFileInputFiles). Real mouse clicks (the picker needs a user gesture).
// `cdp` is the object launchBrowser returns. Resolves { label } (the entry's text) once the chooser was answered; the caller waits for the import's own result.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickEl(cdp, sel) {
  const c = await cdp.evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  if (!c) throw new Error(sel + ' not found');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 }); await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
}

export async function importViaMenu(cdp, file) {
  // force the <input type=file> path of the browser seam so the real chooser can be intercepted
  await cdp.evalJs('delete window.showOpenFilePicker');
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = cdp.once('Page.fileChooserOpened');
  await clickEl(cdp, '.sk-sidebar-btn'); await sleep(350);
  const label = await cdp.evalJs(`(document.querySelector('[data-action="import-file"]') || {}).textContent`);
  await clickEl(cdp, '[data-action="import-file"]');
  const fc = await Promise.race([chooser, sleep(5000).then(() => null)]);
  if (!fc) throw new Error('the file chooser did not open');
  await cdp.send('DOM.setFileInputFiles', { files: [file], backendNodeId: fc.backendNodeId });
  return { label: label && label.trim() };
}

export const hasImportEntry = (cdp) => cdp.evalJs(`!!document.querySelector('[data-action="import-file"]')`);
