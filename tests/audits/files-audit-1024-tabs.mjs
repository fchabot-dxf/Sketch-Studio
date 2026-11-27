// tests/audits/files-audit-1024-tabs.mjs — TASK 1024 (AUDIT ONLY): document tabs (shared buffer, task 684), close with unsaved changes, two apps, reload, per-tab undo.
// Run: node tests/audits/files-audit-1024-tabs.mjs      Rows F-20 .. F-39
import path from 'node:path';
import { startKit, row, sleep, FIX_DIR } from './files-audit-1024-kit.js';

const k = await startKit({ tag: '1024-tabs' });
const brief = (t) => JSON.stringify(t.map((x) => [x.name, x.active ? 'A' : '', x.home || '', x.dot ? 'dot' : '']));
const newBlank = async () => { await k.press('.sk-doctab-new'); await k.waitFor(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`, 'the template modal'); await k.press('.sk-tp-card[data-template="blank"]'); await sleep(500); };
try {
  await k.open('sketchstudio');
  let tabs = await k.tabs();
  row('F-20', `fresh start: tabs=${brief(tabs)} shapes=${await k.shapes()}`);

  // ---- untouched Untitled: close it
  await k.press('.sk-doctab-x');
  await sleep(500);
  row('F-21', `close the only, untouched Untitled tab (key before ${tabs[0].key}, after ${(await k.tabs())[0].key}): modal=${JSON.stringify(await k.modal())} tabs after=${brief(await k.tabs())}`);

  // ---- two tabs, per-tab drawing and per-tab undo history
  await k.drawLine('svgCanvas', 0.3); await k.drawLine('svgCanvas', 0.5);
  row('F-22a', `tab A: two lines drawn: shapes=${await k.shapes()} undo=${JSON.stringify(await k.undoState())} tabs=${brief(await k.tabs())}`);
  await newBlank();
  tabs = await k.tabs();
  row('F-22b', `"+" > Blank design: tabs=${brief(tabs)} shapes in the new tab=${await k.shapes()} undo=${JSON.stringify(await k.undoState())} (expected a fresh tab: 0 shapes, no undo)`);
  await k.drawLine('svgCanvas', 0.4);
  const sB = await k.shapes();
  // switch back to A by clicking its tab
  await k.press('.sk-doctab:not(.active) .sk-doctab-main');
  await sleep(500);
  row('F-23', `switch to tab A: shapes=${await k.shapes()} (expected 2) tabs=${brief(await k.tabs())} undo=${JSON.stringify(await k.undoState())}`);
  await k.ctrlZ(); await sleep(300);
  row('F-24', `undo in A: shapes=${await k.shapes()} (expected 1)`);
  await k.press('.sk-doctab:not(.active) .sk-doctab-main'); await sleep(500);
  row('F-24b', `switch to B: shapes=${await k.shapes()} (expected ${sB}) undo=${JSON.stringify(await k.undoState())}`);
  await k.ctrlZ(); await sleep(300);
  row('F-24c', `undo in B: shapes=${await k.shapes()} (expected 0); B redo=${JSON.stringify(await k.undoState())}`);
  await k.press('.sk-doctab:not(.active) .sk-doctab-main'); await sleep(500);
  row('F-24d', `back to A: shapes=${await k.shapes()} (expected 1) undo=${JSON.stringify(await k.undoState())}; redo in A (Ctrl+Shift+Z)`);
  await k.ctrlShiftZ(); await sleep(300);
  row('F-24e', `redo in A: shapes=${await k.shapes()} (expected 2)`);

  // ---- close a tab with unsaved changes: Cancel / Don't save / Save...
  const hdr = await k.tabs();
  await k.press('.sk-doctab.active .sk-doctab-x'); await sleep(500);
  const m1 = await k.modal();
  row('F-25', `close the active tab with 2 unsaved lines: modal=${JSON.stringify(m1)}`);
  await k.shot('F25-close-unsaved.png', '[role=dialog]').then((e) => e && row('F-25e', 'evidence ' + e));
  await k.press('[role=dialog] [data-choice="__cancel"]'); await sleep(400);
  row('F-25b', `Cancel: tabs=${brief(await k.tabs())} shapes=${await k.shapes()} modal open=${!!(await k.modal())}`);
  await k.press('.sk-doctab.active .sk-doctab-x'); await sleep(500);
  await k.key('Escape'); await sleep(300);
  row('F-25c', `Esc on the question: tabs=${brief(await k.tabs())} (Esc should be Cancel) modal open=${!!(await k.modal())}`);
  await k.press('.sk-doctab.active .sk-doctab-x'); await sleep(500);
  await k.press('[role=dialog] [data-choice="save"]'); await sleep(700);
  const dd = await k.dialog();
  row('F-26', `Save... on close: Save as dialog opened=${!!dd} ${dd ? JSON.stringify({ tab: dd.tab, name: dd.name }) : ''}`);
  if (dd) { await k.evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`); await k.typeText('Closed tab'); await k.enter(); await k.waitDownload(1, 'close save'); await sleep(800); }
  row('F-26b', `after Save... + name: tabs=${brief(await k.tabs())} downloads=${k.downloads.map((d) => d.name)} (the tab should be closed once saved)`);
  // Don't save
  await k.drawLine('svgCanvas', 0.45); await sleep(300);
  await k.press('.sk-doctab.active .sk-doctab-x'); await sleep(500);
  const m2 = await k.modal();
  if (m2) { await k.press('[role=dialog] [data-choice="discard"]'); await sleep(600); }
  row('F-27', `close the other tab, "Don't save": modal was ${m2 ? JSON.stringify(m2.buttons) : 'none (closed without asking)'}; tabs after=${brief(await k.tabs())} shapes=${await k.shapes()}`);

  // ---- 10-tab limit
  await k.open('sketchstudio');
  let created = 0, limitMsg = null;
  for (let i = 0; i < 12; i++) {
    await k.press('.sk-doctab-new'); const ok = await k.waitFor(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`, 'modal', 3000).catch(() => null);
    if (!ok) { limitMsg = 'modal did not open at tab ' + (i + 1) + ' toasts=' + JSON.stringify(await k.toasts()) + ' note=' + (await k.evalJs(`(document.querySelector('.sk-doctabs-msg') || {}).textContent`)); break; }
    await k.press('.sk-tp-card[data-template="blank"]'); await sleep(350); created++;
    const n = (await k.tabs()).length; if (n < created + 1) { limitMsg = `tab count stuck at ${n}; toasts=${JSON.stringify(await k.toasts())} note=${await k.evalJs(`(document.querySelector('.sk-doctabs-msg') || {}).textContent`)}`; break; }
  }
  tabs = await k.tabs();
  row('F-28', `open tabs one after the other: ${tabs.length} tabs (limit says 10); ${limitMsg || 'no refusal seen'}; strip scroll=${await k.evalJs(`(() => { const e = document.querySelector('.sk-doctabs'); return e.scrollWidth + '/' + e.clientWidth; })()`)}`);
  await k.shotFull('F28-many-tabs.png').then((e) => row('F-28e', 'evidence ' + e));

  // ---- keyboard on the strip
  await k.open('sketchstudio');
  await newBlank(); await newBlank();
  await k.evalJs(`document.querySelector('.sk-doctab.active .sk-doctab-main').focus()`);
  await k.key('ArrowLeft'); await sleep(200);
  const f1 = await k.evalJs(`document.activeElement.closest('.sk-doctab') && document.activeElement.closest('.sk-doctab').dataset.key`);
  await k.key('Enter'); await sleep(500);
  row('F-29', `keyboard: ArrowLeft then Enter on the strip: active=${JSON.stringify((await k.active()) && (await k.active()).key)} focused=${f1}; Delete closes the focused tab: tabs before=${(await k.tabs()).length}`);
  await k.evalJs(`document.querySelector('.sk-doctab.active .sk-doctab-main').focus()`);
  await k.key('Delete'); await sleep(600);
  row('F-29b', `Delete on the focused untouched tab: tabs after=${brief(await k.tabs())} modal=${JSON.stringify(await k.modal())}`);

  // ---- the same document in two apps (shared buffer)
  await k.open('sketchstudio');
  await k.drawLine('svgCanvas', 0.35);
  await k.menu('save-as'); await k.waitFor(`!!document.querySelector('.sk-fd')`, 'dlg');
  await k.evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`); await k.typeText('Shared doc'); await k.enter();
  await k.waitDownload(k.downloads.length + 1, 'shared save', 3000); await sleep(800);
  await k.drawLine('svgCanvas', 0.6); await sleep(300);
  const dotsA = brief(await k.tabs());
  await k.flush();
  await k.navigate(`http://127.0.0.1:${k.port}/apps/shaper/index.html`, 12000);
  await k.waitForApp('design-canvas'); await sleep(900);
  const shapeSel = `document.querySelectorAll('#design-canvas .shape-elem[data-shape-id]').length`;
  row('F-30', `SketchStudio (tab "Shared doc", file home, 2 lines, edited) then open Shaper (same origin): Shaper tabs=${brief(await k.tabs())} shapes in Shaper=${await k.evalJs(shapeSel)} (SketchStudio had: ${dotsA}) toasts=${JSON.stringify(await k.toasts())}`);
  await k.drawLine('design-canvas', 0.8); await sleep(400);
  row('F-30b', `draw a third line in Shaper: shapes=${await k.evalJs(shapeSel)} tabs=${brief(await k.tabs())}`);
  await k.flush();
  await k.navigate(`http://127.0.0.1:${k.port}/apps/sketchstudio/index.html`, 12000);
  await k.waitForApp('svgCanvas'); await sleep(900);
  row('F-30c', `back to SketchStudio: tabs=${brief(await k.tabs())} shapes=${await k.shapes()} (expected 3: the line drawn in Shaper)`);
  // Shaper's undo history is in the page, not the buffer: a reload starts empty
  row('F-30d', `undo available after the app switch: ${JSON.stringify(await k.undoState())} (history stays with the page, documented in document-buffer-core.js)`);

  // ---- reload with several tabs and an unsaved Untitled with content
  await newBlank(); await k.drawLine('svgCanvas', 0.5); await newBlank();
  const pre = brief(await k.tabs());
  await k.reload('sketchstudio');
  row('F-31', `reload with 3 tabs (a file home, an Untitled with a line, an empty one): before=${pre} after=${brief(await k.tabs())} shapes in active=${await k.shapes()}`);
  const act = await k.active();
  // select tab 2 (Untitled with a line): is the line still there?
  const all = await k.tabs();
  const untitled = all.findIndex((t) => /Untitled/.test(t.name) && t.dot);
  if (untitled >= 0) { await k.evalJs(`document.querySelectorAll('.sk-doctab-main')[${untitled}].click()`); await sleep(600); }
  row('F-31b', `after reload, the Untitled tab with content: shapes=${await k.shapes()} (expected 1) active=${JSON.stringify(await k.active())}`);

  // ---- an UNTOUCHED opened file, then another app and back
  await k.open('sketchstudio');
  await k.menu('open-file'); await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'open dlg');
  await k.chooseFile(path.join(FIX_DIR, 'rich.sketch.json')); await sleep(1200);
  row('F-32a', `file just opened (untouched): tabs=${brief(await k.tabs())}`);
  await k.navigate(`http://127.0.0.1:${k.port}/apps/shaper/index.html`, 12000);
  await k.waitForApp('design-canvas'); await sleep(900);
  row('F-32', `open a file in SketchStudio, edit nothing, go to Shaper: tabs there=${brief(await k.tabs())} shapes=${await k.evalJs(`document.querySelectorAll('#design-canvas .shape-elem[data-shape-id]').length`)} (the file had 28; an opened design that is clean is not carried to the other app)`);
} finally {
  console.log(`BLOCKED non-local requests: ${k.net.blocked().length}`);
  await k.close();
}
