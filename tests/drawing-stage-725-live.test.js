// tests/drawing-stage-725-live.test.js -- TASK 725: SketchStudio's Drawing step in the REAL page (headless, real mouse / touch / keys via CDP).
// A named design with H / V / coincident constraints, a construction diagonal and 4 dimensions (two driving lengths, a driving radius, a driven
// reference length) is stored and reloaded. Then, at 1280 x 800 with the mouse:
//  1. Design | Drawing is the step bar; Drawing (a real click on its step button) shows ONLY the drawing: the 5 solid curves, the 4 dimension labels with
//     the same texts as Design's (unit + display precision), and zero constraint glyphs / point dots / construction / axes / grid; the ribbon, the
//     Sketches browser and the drawer handle are not rendered; nothing covers the drawing but the Fit and Print buttons. (TASK 776, owner turn 2368: the FOOTER shows in
//     Drawing, under the drawing: only Settings, Save and the account avatar; Undo / Redo / Delete / Clear / Parameters / Recenter are not shown; the drawing ends at the footer's top.)
//  2. Read-only: real clicks / a double click on a curve and a label, a drag, and keys (Delete, Backspace, Ctrl+Z, Ctrl+A, l, d, k, 5, Enter, Escape)
//     change nothing: the stored document and Design's history are unchanged.
//  3. Wheel zoom and drag pan move Drawing's view only; Fit frames the drawing with its labels.
//  4. Print: under print media (the browser's beforeprint lays it out) only the drawing + the title line show; Page.printToPDF gives a 1-page PDF
//     (.evidence/725/drawing-print.pdf), landscape for this wide drawing.
//  5. Design (its step button) restores the editing UI and Design's own view (viewBox unchanged).
//  6. The stored step restores on reload (Drawing), and a later Design edit (a line drawn with the real Line tool) shows next time Drawing opens.
// Then at 390 x 844 with touch: the step bar shows in Drawing (no drawer handle), a pinch zooms, Fit, a tap changes nothing, Design restores.
// Screenshots (.evidence/725/).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

const EVIDENCE_DIR = path.resolve('.evidence/725');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const J = (x, y) => ({ x, y, fixed: false, sketchId: 'sketch-1' });
const L = (id, a, b, isConstruction = false) => ({ id, type: 'line', joints: [a, b], sketchId: 'sketch-1', isConstruction });
const DOC = { version: 3, hosts: {}, geometry: {
  joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['r1', J(0, 0)], ['r2', J(60, 0)], ['r3', J(60, 40)], ['r4', J(0, 40)], ['c0', J(30, 20)]],
  shapes: [L('E1', 'r1', 'r2'), L('E2', 'r2', 'r3'), L('E3', 'r3', 'r4'), L('E4', 'r4', 'r1'), L('CL', 'r1', 'r3', true),
    { id: 'C', type: 'circle', joints: ['c0'], radius: 8, sketchId: 'sketch-1', isConstruction: false }],
  constraints: [
    { type: 'coincident', joints: ['j_origin', 'r1'] },
    { type: 'horizontal', joints: ['r1', 'r2'] }, { type: 'vertical', joints: ['r2', 'r3'] }, { type: 'horizontal', joints: ['r3', 'r4'] }, { type: 'vertical', joints: ['r4', 'r1'] },
    { type: 'distance', joints: ['r1', 'r2'], value: 60, offset: -8 },
    { type: 'distance', joints: ['r2', 'r3'], value: 40, offset: -10 },
    { type: 'distance', shape: 'C', isRadius: true, value: 8 },
    { type: 'distance', joints: ['r4', 'c0'], value: Math.hypot(30, 20), driven: true, offset: -4 },
  ],
  sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [] } };

const md5 = (buf) => createHash('md5').update(buf).digest('hex').toUpperCase();
const evidence = [];

const cdp = await launchBrowser({ tag: '725-drawing', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, flushAutosave, close } = cdp;
const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
await installFakeDriveSession(cdp); // the store saves a named design to (fake) Drive, as in chain-select-move-live

const shot = async (name, clip = null) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  const buf = Buffer.from(data, 'base64');
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), buf);
  evidence.push(`${name} md5=${md5(buf)}`);
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name) + ' md5=' + md5(buf));
};
const mouseEv = (type, x, y, buttons = 0, clickCount = 1, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, modifiers, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
const click = async (x, y, clickCount = 1) => { await mouseEv('mouseMoved', x, y); await sleep(40); await mouseEv('mousePressed', x, y, 1, clickCount); await sleep(40); await mouseEv('mouseReleased', x, y, 0, clickCount); await sleep(200); };
const centerOf = async (sel) => {
  const c = await evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 0); if (!e) return null;
    const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(c, sel + ' is on screen');
  return c;
};
const clickEl = async (sel) => { const c = await centerOf(sel); assert.ok(c.onTop, sel + ' is not covered: ' + JSON.stringify(c)); await click(c.x, c.y); };
const KEY = { Delete: ['Delete', 'Delete', 46], Backspace: ['Backspace', 'Backspace', 8], Escape: ['Escape', 'Escape', 27], Enter: ['Enter', 'Enter', 13, '\r'],
  l: ['l', 'KeyL', 76, 'l'], d: ['d', 'KeyD', 68, 'd'], k: ['k', 'KeyK', 75, 'k'], 5: ['5', 'Digit5', 53, '5'], z: ['z', 'KeyZ', 90], a: ['a', 'KeyA', 65] };
const key = (k, mods = 0) => { const [kk, code, vk, text] = KEY[k]; return sendRealKey(send, kk, code, vk, mods, mods ? '' : (text || '')); };

// what the page shows: Drawing's drawing and what is rendered around it
const drawingInfo = () => evalJs(`(() => {
  const v = document.getElementById('drawing-view'), svg = document.getElementById('drawingCanvas'), w = svg.querySelector('.sk-drawing-world');
  const rendered = (sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
  const sr = svg.getBoundingClientRect();
  const labels = [...w.querySelectorAll('.dim-label')].map((g) => { const r = g.getBoundingClientRect(); return { text: g.textContent.trim(), inside: r.width > 0 && r.left >= sr.left && r.right <= sr.right && r.top >= sr.top && r.bottom <= sr.bottom }; });
  // every element drawn over the drawing area, sampled on a grid: only the canvas, its drawing, and the two corner buttons
  const over = new Set();
  for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) { const e = document.elementFromPoint(sr.left + sr.width * i / 10, sr.top + sr.height * j / 10); if (e && !(e === svg || svg.contains(e))) over.add((e.closest('button') || e).id || e.className); }
  return {
    shown: !v.hidden && v.getClientRects().length > 0,
    shapes: [...w.querySelectorAll('.shape-elem')].map((e) => e.dataset.shapeId).sort(),
    labels: labels.map((l) => l.text).sort(), labelsInside: labels.every((l) => l.inside),
    glyphs: w.querySelectorAll('.constraint-glyph').length,
    dots: w.querySelectorAll('circle:not(.shape-elem)').length,
    construction: w.querySelectorAll('[data-shape-id="CL"], .shape-elem[stroke-dasharray]').length,
    axes: w.querySelectorAll('[stroke="#ef4444"], [stroke="#22c55e"], [data-ref-axis]').length,
    grid: svg.querySelectorAll('#infinite-grid, pattern, defs').length,
    joints: w.querySelectorAll('.joint-handle').length,
    ribbon: rendered('#toolsRibbon'), browser: rendered('.sk-browser') || rendered('.sk-browser-corner-btn'), footer: rendered('footer.sk-statusbar'),
    handle: rendered('.sk-sidebar-chevron'), header: rendered('.sk-header'), doctabs: [...document.querySelectorAll('.sk-doctabs')].some((e) => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 5, r.top + r.height / 2); return r.height > 0 && hit && e.contains(hit); }),
    buttons: [...v.querySelectorAll('button')].filter((b) => b.getClientRects().length).map((b) => b.id),
    over: [...over].sort(),
    viewBox: svg.getAttribute('viewBox'),
    designViewBox: document.getElementById('svgCanvas').getAttribute('viewBox'),
    stepBar: [...document.querySelectorAll('.sk-header-tab')].map((t) => t.textContent.trim() + (t.classList.contains('active') ? '*' : '')),
  };
})()`);
// TASK 776: the footer while Drawing shows: which of its buttons are visible, that the drawing ends where the footer starts, and that nothing covers them
const footerInDrawing = () => evalJs(`(() => {
  const f = document.querySelector('footer.sk-statusbar'), fr = f.getBoundingClientRect(), vr = document.getElementById('drawing-view').getBoundingClientRect();
  const vis = [...f.querySelectorAll('button')].filter((b) => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden');
  const hit = (b) => { const r = b.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === b || b.contains(h)); };
  return { ids: vis.map((b) => b.id || b.className.split(' ')[0]), covered: vis.filter((b) => !hit(b)).map((b) => b.id || b.className), drawingBottom: Math.round(vr.bottom), footerTop: Math.round(fr.top), footerBottom: Math.round(fr.bottom), vh: innerHeight,
    save: document.querySelectorAll('.sk-save').length, avatars: document.querySelectorAll('.sk-account').length };
})()`);
const designInfo = () => evalJs(`(() => { const s = document.getElementById('svgCanvas'); return {
  shapes: [...s.querySelectorAll('.shape-elem')].map((e) => e.dataset.shapeId).sort(), labels: [...s.querySelectorAll('.dim-label')].map((g) => g.textContent.trim()).sort(),
  glyphs: s.querySelectorAll('.constraint-glyph').length, ribbon: document.getElementById('toolsRibbon').getClientRects().length > 0, footer: document.querySelector('footer.sk-statusbar').getClientRects().length > 0,
  viewBox: s.getAttribute('viewBox'), undoDisabled: document.getElementById('btn-undo').disabled, drawingShown: !document.getElementById('drawing-view').hidden }; })()`);
const storedDoc = async (id) => { await flushAutosave(); return evalJs(`import('/packages/ui/project-store.js').then(async (m) => JSON.stringify((await m.getProjectStore().get(${JSON.stringify(id)})).document))`); };
const vb = (s) => s.split(/\s+/).map(Number);
const world = (svgId, x, y) => evalJs(`(() => { const svg = document.getElementById('${svgId}'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);

let designId = null;
try {
  // ── seed: a named design (only a named design is stored), reloaded: the app restores and frames it ──
  await navigate(url, 8000); await waitForApp('svgCanvas');
  await evalJs(`(async () => { localStorage.clear(); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); return true; })()`);
  await navigate(url, 8000); await waitForApp('svgCanvas');
  designId = await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 725 plate', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
  await navigate(url, 8000); await waitForApp('svgCanvas');
  await waitFor(`document.querySelectorAll('#svgCanvas .dim-label').length === 4`, 'Design draws the 4 dimensions'); await sleep(500);

  // ── 1. Design first: the editing UI, glyphs, the construction line ──
  const d0 = await designInfo();
  console.log('Design: ' + JSON.stringify(d0));
  assert.deepStrictEqual(d0.shapes, ['C', 'CL', 'E1', 'E2', 'E3', 'E4'], 'Design draws the 5 curves and the construction line');
  assert.ok(d0.glyphs > 0 && d0.ribbon && d0.footer && !d0.drawingShown, 'Design shows its glyphs, ribbon and footer');
  assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.sk-header-tab')].map((t) => t.textContent.trim())`), ['Design', 'Drawing'], 'the step bar is Design | Drawing');
  await shot('design-desktop.png');
  const before = await storedDoc(designId);

  await clickEl('.sk-header-tab[data-tab="drawing"]');
  await waitFor(`!document.getElementById('drawing-view').hidden && document.querySelectorAll('#drawingCanvas .dim-label').length === 4`, 'Drawing shows the drawing');
  await sleep(300);
  const b1 = await drawingInfo();
  console.log('Drawing: ' + JSON.stringify(b1));
  assert.ok(b1.shown, 'Drawing is shown');
  assert.deepStrictEqual(b1.stepBar, ['Design', 'Drawing*'], 'Drawing is the active step');
  assert.deepStrictEqual(b1.shapes, ['C', 'E1', 'E2', 'E3', 'E4'], 'Drawing draws the 5 solid curves, not the construction line');
  assert.deepStrictEqual(b1.labels, d0.labels, 'the 4 dimension labels, with the same texts as Design (document unit + display precision)');
  assert.strictEqual(b1.labels.length, 4, '4 labels');
  assert.ok(b1.labelsInside, 'every label is inside the drawing after the entry fit');
  assert.deepStrictEqual({ glyphs: b1.glyphs, dots: b1.dots, construction: b1.construction, axes: b1.axes, grid: b1.grid, joints: b1.joints }, { glyphs: 0, dots: 0, construction: 0, axes: 0, grid: 0, joints: 0 }, 'no glyph, point, construction, axis or grid');
  assert.deepStrictEqual({ ribbon: b1.ribbon, browser: b1.browser, footer: b1.footer, handle: b1.handle, doctabs: b1.doctabs }, { ribbon: false, browser: false, footer: true, handle: false, doctabs: false }, 'no ribbon, Sketches browser, drawer handle or document tabs; the footer shows (TASK 776)');
  const fd = await footerInDrawing();
  assert.deepStrictEqual(fd.ids, ['btn-settings', 'sk-save', 'sk-account'], 'Drawing footer: only Settings, Save and the account avatar (no Undo / Redo / Delete / Clear / Parameters / Recenter): ' + JSON.stringify(fd));
  assert.deepStrictEqual([fd.covered, fd.save, fd.avatars], [[], 1, 1], 'Drawing footer: nothing covers its buttons; one Save, one avatar');
  assert.ok(fd.drawingBottom <= fd.footerTop + 0.5 && fd.footerBottom >= fd.vh - 0.5, 'the drawing ends at the footer, the footer is at the bottom of the page: ' + JSON.stringify(fd));
  await shot('drawing-desktop-footer.png', { x: 0, y: Math.max(0, fd.footerTop - 6), width: 1280, height: fd.footerBottom - fd.footerTop + 6, scale: 2 });
  assert.deepStrictEqual(b1.buttons, ['btn-drawing-fit', 'btn-drawing-print'], 'Drawing has only Fit and Print');
  assert.ok(b1.over.every((o) => o === 'btn-drawing-fit' || o === 'btn-drawing-print'), 'nothing but Fit / Print over the drawing: ' + JSON.stringify(b1.over));
  assert.strictEqual(b1.designViewBox, d0.viewBox, 'Design\'s view is not touched');
  await shot('drawing-desktop.png');

  // ── 2. read-only: clicks, a double click, a drag, keys ──
  const lineMid = await world('drawingCanvas', 30, 0);
  await click(lineMid.x, lineMid.y); await click(lineMid.x, lineMid.y, 2);
  const lab = await centerOf('#drawingCanvas .dim-label');
  await click(lab.x, lab.y); await click(lab.x, lab.y, 2);
  for (const k of ['Delete', 'Backspace', 'l', 'd', 'k', 5, 'Enter', 'Escape']) { await key(k); await sleep(60); }
  await key('z', 2); await key('a', 2); await sleep(300);
  assert.strictEqual(await evalJs(`!!document.querySelector('.dim-input:not(.hidden), #dimInput:not(.hidden)')`), false, 'no value box opened');
  const afterInput = await storedDoc(designId);
  assert.strictEqual(afterInput, before, 'the stored document is unchanged by clicks and keys in Drawing');
  assert.strictEqual(await evalJs(`document.getElementById('btn-undo').disabled`), true, 'nothing went on Design\'s undo history');

  // ── 3. zoom / pan / Fit (Drawing's own view) ──
  const fitted = vb(b1.viewBox);
  const mid = await centerOf('#drawingCanvas');
  await mouseEv('mouseMoved', mid.x, mid.y);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mid.x, y: mid.y, deltaX: 0, deltaY: -300 }); await sleep(250);
  const zoomed = vb((await drawingInfo()).viewBox);
  assert.ok(zoomed[2] < fitted[2] * 0.9, `wheel zooms in: ${fitted[2]} -> ${zoomed[2]}`);
  await mouseEv('mousePressed', mid.x, mid.y, 1); await sleep(40);
  for (let i = 1; i <= 5; i++) { await mouseEv('mouseMoved', mid.x + i * 20, mid.y + i * 10, 1); await sleep(30); }
  await mouseEv('mouseReleased', mid.x + 100, mid.y + 50); await sleep(250);
  const panned = vb((await drawingInfo()).viewBox);
  assert.ok(Math.abs(panned[0] - zoomed[0]) > 1e-6 && Math.abs(panned[2] - zoomed[2]) < 1e-9, `a drag pans: ${zoomed} -> ${panned}`);
  await shot('drawing-desktop-zoomed.png');
  await clickEl('#btn-drawing-fit'); await sleep(250);
  const b3 = await drawingInfo();
  const refit = vb(b3.viewBox);
  assert.ok(refit.every((v, i) => Math.abs(v - fitted[i]) < 1e-6 * Math.max(1, Math.abs(fitted[i]))), `Fit frames the drawing again: ${fitted} vs ${refit}`);
  assert.ok(b3.labelsInside, 'after Fit every label is inside');
  assert.strictEqual(b3.designViewBox, d0.viewBox, 'zoom / pan / Fit in Drawing leave Design\'s view alone');
  assert.strictEqual(await storedDoc(designId), before, 'zoom / pan / Fit change no document');

  // ── 4. Print ──
  const printed = await evalJs(`(() => { window.__bp = 0; window.addEventListener('beforeprint', () => { window.__bp++; }); return true; })()`);
  assert.ok(printed);
  const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  const pdfBuf = Buffer.from(pdf.data, 'base64');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'drawing-print.pdf'), pdfBuf);
  const pdfText = pdfBuf.toString('latin1');
  const pages = (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const box = (pdfText.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/) || []).slice(1).map(Number);
  console.log(`drawing-print.pdf: ${pdfBuf.length} bytes, pages ${pages}, MediaBox ${JSON.stringify(box)}, beforeprint fired ${await evalJs('window.__bp')} md5=${md5(pdfBuf)}`);
  evidence.push(`drawing-print.pdf md5=${md5(pdfBuf)} pages=${pages} MediaBox=${JSON.stringify(box)}`);
  assert.strictEqual(await evalJs('window.__bp'), 1, 'printing fires the browser\'s beforeprint (the layout for paper)');
  assert.strictEqual(pages, 1, 'the printout is one page');
  assert.ok(box.length === 4 && box[2] > box[3], 'the wide drawing prints landscape: ' + JSON.stringify(box));
  await sleep(200);
  assert.deepStrictEqual(vb((await drawingInfo()).viewBox), refit, 'after printing (afterprint) the screen view is back');
  // the print media itself, as the browser lays it out between beforeprint and afterprint (the events the browser fires around a print are sent here
  // by hand: a media emulation alone does not print)
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  await evalJs(`window.dispatchEvent(new Event('beforeprint'))`); await sleep(300);
  const pm = await evalJs(`(() => {
    const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
    const shownTop = [...document.body.children].filter(visible).map((e) => e.id || e.className);
    const v = document.getElementById('drawing-view'), svg = document.getElementById('drawingCanvas'), t = v.querySelector('.sk-drawing-title');
    const geo = svg.querySelector('.shape-elem'), lab = svg.querySelector('.dim-label text');
    return { shownTop, actions: visible(v.querySelector('.sk-drawing-actions')), title: visible(t) ? t.textContent : null,
      svgW: svg.style.width, svgH: svg.style.height, page: (document.getElementById('sk-drawing-page') || {}).textContent || null,
      geoStroke: getComputedStyle(geo).stroke, labelFill: getComputedStyle(lab).fill, bg: getComputedStyle(v).backgroundColor,
      chrome: [...document.querySelectorAll('.sk-header, .sk-sidebar, .sk-sidebar-chevron, .sk-doctabs, #notification-container, #toolsRibbon, footer')].filter(visible).length,
      labels: svg.querySelectorAll('.dim-label').length, scale: v.dataset.printScale, orientation: v.dataset.printOrientation };
  })()`);
  console.log('print media: ' + JSON.stringify(pm));
  assert.deepStrictEqual(pm.shownTop, ['drawing-view'], 'under print media only the Drawing view is shown');
  assert.strictEqual(pm.chrome, 0, 'no step bar, menu, handle, tabs, toast, ribbon or footer in the printout');
  assert.strictEqual(pm.actions, false, 'no Fit / Print buttons in the printout');
  assert.ok(pm.title && /Task 725 plate/.test(pm.title) && /Units: mm/.test(pm.title) && /Sketch Studio/.test(pm.title) && /Scale \d+:\d+ \(print at 100%\)/.test(pm.title), 'the title line: ' + pm.title);
  assert.strictEqual(pm.orientation, 'landscape', 'the wide drawing is laid out landscape');
  assert.ok(/size: landscape/.test(pm.page), 'the @page size follows: ' + pm.page);
  assert.ok(/mm$/.test(pm.svgW) && /mm$/.test(pm.svgH), 'the drawing is sized in paper mm: ' + pm.svgW + ' x ' + pm.svgH);
  assert.strictEqual(pm.geoStroke, 'rgb(0, 0, 0)', 'black geometry');
  assert.strictEqual(pm.labelFill, 'rgb(0, 0, 0)', 'black dimension text');
  assert.strictEqual(pm.bg, 'rgb(255, 255, 255)', 'on white');
  assert.strictEqual(pm.labels, 4, 'the 4 dimensions are printed');
  await shot('drawing-print-media.png');
  await evalJs(`window.dispatchEvent(new Event('afterprint'))`);
  await send('Emulation.setEmulatedMedia', { media: '' }); await sleep(200);
  assert.deepStrictEqual(vb((await drawingInfo()).viewBox), refit, 'back on screen: the screen view');

  // ── 5. back to Design: the editing UI and Design's own view ──
  await clickEl('.sk-header-tab[data-tab="design"]');
  await waitFor(`document.getElementById('drawing-view').hidden && document.getElementById('toolsRibbon').getClientRects().length > 0`, 'Design shows again');
  await sleep(300);
  const d1 = await designInfo();
  assert.deepStrictEqual(d1, d0, 'Design is as it was (view, glyphs, labels, ribbon, footer, no undo step)');
  assert.strictEqual(await storedDoc(designId), before, 'the document is unchanged after the whole Drawing visit');
  await shot('design-desktop-after-drawing.png');

  // ── 6. the stored step restores; a later Design edit shows next time Drawing opens ──
  await clickEl('.sk-header-tab[data-tab="drawing"]');
  await waitFor(`!document.getElementById('drawing-view').hidden`, 'Drawing again');
  await navigate(url, 8000); await waitForApp('svgCanvas');
  await waitFor(`!document.getElementById('drawing-view').hidden && document.querySelectorAll('#drawingCanvas .dim-label').length === 4`, 'a reload opens on the stored Drawing step, with the restored design');
  await sleep(300);
  const b6 = await drawingInfo();
  assert.deepStrictEqual(b6.stepBar, ['Design', 'Drawing*'], 'the stored step restores');
  assert.ok(b6.labelsInside && b6.shapes.length === 5, 'and is framed with its labels: ' + JSON.stringify(b6));
  await clickEl('.sk-header-tab[data-tab="design"]');
  await waitFor(`document.getElementById('drawing-view').hidden`, 'Design');
  await sleep(300);
  await clickEl('#tool-line');
  const p1 = await world('svgCanvas', 10, 30), p2 = await world('svgCanvas', 25, 30);
  await click(p1.x, p1.y); await click(p2.x, p2.y); await key('Escape'); await sleep(200); await key('Escape'); await sleep(200);
  await waitFor(`document.querySelectorAll('#svgCanvas .shape-elem').length === 7`, 'the real Line tool drew a line in Design');
  await clickEl('.sk-header-tab[data-tab="drawing"]');
  await waitFor(`document.querySelectorAll('#drawingCanvas .shape-elem').length === 6`, 'Drawing shows the new line (the live document)');
  console.log('a line drawn in Design shows in Drawing: ' + JSON.stringify((await drawingInfo()).shapes));
  await clickEl('.sk-header-tab[data-tab="design"]');
  await waitFor(`document.getElementById('drawing-view').hidden`, 'Design');
  await clickEl('#btn-undo'); await waitFor(`document.querySelectorAll('#svgCanvas .shape-elem').length === 6`, 'the line undone');
  await clickEl('#tool-select');
  await flushAutosave();

  // ── 7. phone 390 x 844, touch ──
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const touchEv = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (x, y) => { await touchEv('touchStart', [{ x, y }]); await sleep(50); await touchEv('touchEnd', []); await sleep(350); };
  const tapEl = async (sel) => { const c = await centerOf(sel); assert.ok(c.onTop, sel + ' is not covered: ' + JSON.stringify(c)); await tap(c.x, c.y); };
  await navigate(url, 8000); await waitForApp('svgCanvas');
  await waitFor(`document.querySelectorAll('#svgCanvas .dim-label').length === 4`, 'phone: Design restored'); await sleep(400);
  const dp0 = await designInfo();
  const phoneBefore = await storedDoc(designId);
  assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.sk-header')).display`), 'none', 'phone Design: no header row (the steps are in the drawer)');
  await shot('design-phone.png');
  await tapEl('.sk-sidebar-chevron');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'phone: the drawer opens');
  await sleep(300);
  await tapEl('.sk-sidebar-stage[data-tab="drawing"]');
  await waitFor(`!document.getElementById('drawing-view').hidden && document.querySelectorAll('#drawingCanvas .dim-label').length === 4`, 'phone: Drawing');
  await sleep(400);
  const bp = await drawingInfo();
  console.log('phone Drawing: ' + JSON.stringify(bp));
  assert.ok(bp.header && !bp.handle, 'phone Drawing: the step bar shows (the way back) and no drawer handle');
  const hb = await evalJs(`(() => { const h = document.querySelector('.sk-header').getBoundingClientRect(), v = document.getElementById('drawing-view').getBoundingClientRect(); return { top: h.top, h: h.height, viewTop: v.top }; })()`);
  assert.deepStrictEqual(hb, { top: 0, h: 44, viewTop: 44 }, 'phone Drawing: the 44 px step bar on top, the drawing under it');
  assert.deepStrictEqual(bp.shapes, ['C', 'E1', 'E2', 'E3', 'E4'], 'phone Drawing: the 5 solid curves');
  assert.deepStrictEqual(bp.labels, b1.labels, 'phone Drawing: the same 4 labels');
  assert.ok(bp.labelsInside, 'phone Drawing: framed with its labels');
  assert.deepStrictEqual({ glyphs: bp.glyphs, dots: bp.dots, construction: bp.construction, axes: bp.axes, grid: bp.grid, ribbon: bp.ribbon, browser: bp.browser, footer: bp.footer }, { glyphs: 0, dots: 0, construction: 0, axes: 0, grid: 0, ribbon: false, browser: false, footer: true }, 'phone Drawing: nothing but the drawing (and the footer, TASK 776)');
  const fdp = await footerInDrawing();
  assert.deepStrictEqual(fdp.ids, ['btn-settings', 'sk-save', 'sk-account'], 'phone Drawing footer: only Settings, Save and the account avatar: ' + JSON.stringify(fdp));
  assert.deepStrictEqual([fdp.covered, fdp.save, fdp.avatars], [[], 1, 1], 'phone Drawing footer: nothing covers its buttons');
  assert.ok(fdp.drawingBottom <= fdp.footerTop + 0.5, 'phone: the drawing ends at the footer: ' + JSON.stringify(fdp));
  await shot('drawing-phone-footer.png', { x: 0, y: fdp.footerTop - 6, width: 390, height: fdp.footerBottom - fdp.footerTop + 6, scale: 2 });
  assert.ok(bp.over.every((o) => o === 'btn-drawing-fit' || o === 'btn-drawing-print'), 'phone: nothing but Fit / Print over the drawing: ' + JSON.stringify(bp.over));
  assert.strictEqual(await evalJs(`document.getElementById('btn-drawing-fit').getBoundingClientRect().width`), 44, 'phone: the Fit button is a 44 px finger target');
  await shot('drawing-phone.png');
  const pfit = vb(bp.viewBox);
  const pm2 = await centerOf('#drawingCanvas');
  const lp = await world('drawingCanvas', 30, 0);
  await tap(lp.x, lp.y); await tap(pm2.x, pm2.y);
  // a two-finger pinch out zooms in
  await touchEv('touchStart', [{ x: pm2.x - 40, y: pm2.y }, { x: pm2.x + 40, y: pm2.y }]);
  for (let i = 1; i <= 6; i++) { await touchEv('touchMove', [{ x: pm2.x - 40 - i * 15, y: pm2.y }, { x: pm2.x + 40 + i * 15, y: pm2.y }]); await sleep(40); }
  await touchEv('touchEnd', []); await sleep(300);
  const pz = vb((await drawingInfo()).viewBox);
  assert.ok(pz[2] < pfit[2] * 0.8, `phone: a pinch zooms in: ${pfit[2]} -> ${pz[2]}`);
  await tapEl('#btn-drawing-fit'); await sleep(300);
  const pr = vb((await drawingInfo()).viewBox);
  assert.ok(pr.every((v, i) => Math.abs(v - pfit[i]) < 1e-6 * Math.max(1, Math.abs(pfit[i]))), `phone: Fit frames it again: ${pfit} vs ${pr}`);
  assert.strictEqual(await storedDoc(designId), phoneBefore, 'phone: taps / pinch / Fit change no document');
  await tapEl('.sk-header-tab[data-tab="design"]');
  await waitFor(`document.getElementById('drawing-view').hidden`, 'phone: Design again');
  await sleep(400);
  const dp1 = await designInfo();
  assert.deepStrictEqual(dp1, dp0, 'phone: Design is as it was (its view too)');
  assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.sk-header')).display`), 'none', 'phone Design: the header row is gone again');
  assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.sk-sidebar-chevron')).display`), 'flex', 'phone Design: the drawer handle is back');

  console.log('drawing-stage-725-live: ok');
} finally {
  console.log('EVIDENCE ' + evidence.join(' | '));
  await close();
}
process.exit(0);
