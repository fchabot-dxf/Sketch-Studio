// tests/text-845-studio-live.test.js — TASK 845, SketchStudio desktop (1280 x 800, real mouse and keys; tests/helpers/text-845-live.js):
// the Text tool places a text and its box opens there with the keyboard; the letters show while typing; size / font (a single-line font: strokes only) /
// alignment change them at once; OK keeps it (Ctrl+Z / Ctrl+Y one step); a double click edits (Esc puts it back; OK = one step); a font of the user's
// (Load your own font...) is listed and used; the canvas menu offers Edit text and Convert to shapes (then it is ordinary curves: Enter group).
import assert from 'node:assert';
import path from 'node:path';
import { openTextPage, HOSTS } from './helpers/text-845-live.js';
import { sleep } from './helpers/cdp-browser.js';

const t = await openTextPage(HOSTS.sketchstudio);
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const out = {};
try {
  await t.open();
  // F8 (no letter is free: Inkscape's Text key) opens the tool, as its ribbon button does
  await t.keys.f8();
  out.f8 = await t.evalJs(`(() => { const b = document.getElementById('tool-text'); const sec = b && b.closest('.sk-ribbon-group'); return !!b && (b.classList.contains('active') || (!!sec && sec.querySelector('.sk-ribbon-group-label').classList.contains('active'))); })()`);
  assert.ok(out.f8, 'F8 switched to the Text tool');
  out.tip = await t.evalJs(`document.getElementById('tool-text').getAttribute('title') || document.getElementById('tool-text').getAttribute('aria-label')`);
  await t.keys.esc();
  const c = await t.evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.35, y: r.top + r.height * 0.6 }; })()`);
  const ed = await t.placeText(c, 'oeB');
  assert.deepStrictEqual([ed.text, ed.font, ed.label], ['oeB', 'Inter', 'New text'], 'the box: the typed text, the default font');
  const l0 = await t.letters();
  assert.ok(l0.n > 30 && l0.ids.length === 1, 'one text, its letters drawn: ' + JSON.stringify(l0));
  // the box opened beside the press
  assert.ok(Math.abs(ed.box.x - c.x) < 40 && Math.abs(ed.box.y - c.y) < 40, 'the box opened at the press: ' + JSON.stringify([ed.box, c]));
  // size: 10 mm -> 5 mm halves the letters
  await t.typeInto('.sk-text-size', '5');
  const l1 = await t.letters();
  out.sizeRatio = +(l1.box.height / l0.box.height).toFixed(3);
  assert.ok(Math.abs(out.sizeRatio - 0.5) < 0.02, 'size 5 mm: half as tall: ' + out.sizeRatio);
  await t.shot('studio-1-typed.png', { x: Math.max(0, l1.box.x - 30), y: Math.max(0, l1.box.y - 40), width: Math.max(l1.box.width, 300) + 60, height: ed.box.y + ed.box.height - l1.box.y + 60 });
  // alignment: centre puts the anchor in the middle of the line (the letters move left by half their width)
  await t.pressEl('.sk-text-align button[data-align="center"]');
  const l2 = await t.letters();
  assert.ok(Math.abs((l1.box.x - l2.box.x) - (l1.box.width / 2)) < l1.box.width * 0.1, 'centred on the anchor: ' + JSON.stringify([l1.box, l2.box]));
  await t.pressEl('.sk-text-align button[data-align="left"]');
  // a single-line font: strokes only (lines), no profile tint
  await t.pickFont('Hershey Simplex');
  await t.waitFor(`[...document.querySelectorAll('#svgCanvas [data-shape-id]')].filter((e) => /_o\\d+$/.test(e.dataset.shapeId)).every((e) => e.localName === 'line')`, 'the Hershey strokes drawn');
  const lh = await t.letters();
  out.hershey = lh.n;
  await t.shot('studio-2-hershey.png', { x: Math.max(0, lh.box.x - 30), y: Math.max(0, lh.box.y - 40), width: Math.max(lh.box.width, 300) + 60, height: ed.box.y + ed.box.height - lh.box.y + 60 });
  await t.pickFont('Inter');
  await t.waitFor(`[...document.querySelectorAll('#svgCanvas [data-shape-id]')].some((e) => /_o\\d+$/.test(e.dataset.shapeId) && e.localName === 'path')`, 'Inter again');
  // OK: kept, the box closes, the tool stays
  await t.pressEl('.sk-text-ok');
  assert.strictEqual(await t.editor(), null, 'OK closed the box');
  const kept = await t.letters();
  assert.strictEqual(kept.n, l1.n, 'the text kept as typed (Inter, 5 mm)');
  // one undo step
  await t.keys.undo();
  assert.strictEqual((await t.letters()).n, 0, 'Ctrl+Z: the whole text goes (one step)');
  await t.keys.redo();
  assert.strictEqual((await t.letters()).n, kept.n, 'Ctrl+Y: back');
  // Select (Esc), double click a letter: its editor
  await t.keys.esc();
  const p = await t.letterPoint();
  assert.ok(p, 'a point on a letter');
  await t.dblclick(p);
  await t.waitFor(`!!document.querySelector('.sk-text-editor')`, 'a double click on a letter opens its editor');
  const e2 = await t.editor();
  assert.deepStrictEqual([e2.text, e2.label, e2.size], ['oeB', 'Edit text', '5mm'], 'the editor holds the text and its style');
  await sleep(200);
  await t.send('Input.insertText', { text: 'Hi' }); // the whole text was selected: replaced
  await t.waitFor(`(() => { const ids = [...document.querySelectorAll('#svgCanvas [data-shape-id]')].filter((e) => /_o\\d+$/.test(e.dataset.shapeId)); return ids.length && ids.length !== ${kept.n}; })()`, 'the letters follow the edit');
  await t.keys.esc();
  assert.strictEqual(await t.editor(), null, 'Esc closed the box');
  assert.strictEqual((await t.letters()).n, kept.n, 'Esc put the text back as it was');
  await t.dblclick(p);
  await t.waitFor(`!!document.querySelector('.sk-text-editor')`, 'the editor again');
  await sleep(200);
  await t.send('Input.insertText', { text: 'Text' });
  await sleep(400);
  const edited = await t.letters();
  await t.shot('studio-3-edit.png', { x: Math.max(0, edited.box.x - 40), y: Math.max(0, edited.box.y - 40), width: 420, height: 320 });
  await t.pressEl('.sk-text-ok');
  await t.keys.undo();
  assert.strictEqual((await t.letters()).n, kept.n, 'the edit was ONE undo step');
  await t.keys.redo();
  assert.strictEqual((await t.letters()).n, edited.n, 'redo: Text');
  // Load your own font: the file a user picks (the vendored Roboto file stands for it): listed as theirs, used
  await t.dblclick(p);
  await t.waitFor(`!!document.querySelector('.sk-text-editor')`, 'the editor for the font');
  const doc = await t.send('DOM.getDocument', { depth: 0 });
  const input = await t.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.sk-text-editor .sk-text-file' });
  await t.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [path.resolve('packages/ui/vendor/fonts/roboto/roboto-latin-400-normal.woff')] });
  await t.waitFor(`document.querySelector('.sk-text-font').value === 'Roboto (yours)'`, 'the loaded font is chosen');
  out.userFonts = await t.evalJs(`[...document.querySelectorAll('.sk-text-font optgroup')].map((g) => g.label + ': ' + g.children.length)`);
  assert.ok(out.userFonts.includes('Your fonts (this session): 1'), 'listed under Your fonts: ' + out.userFonts);
  await t.pressEl('.sk-text-ok');
  const yours = await t.letters();
  // the canvas menu: Edit text + Convert to shapes (no Enter group); Convert -> ordinary curves
  await t.menuAt(p);
  const ids = await t.menuIds();
  assert.ok(ids.includes('txt-edit') && ids.includes('txt-convert') && !ids.includes('grp-enter'), 'menu: Edit text, Convert to shapes, no Enter group: ' + ids);
  const row = await t.menuRow('txt-convert');
  await t.shot('studio-4-menu.png', { x: Math.max(0, row.x - 160), y: Math.max(0, row.y - 160), width: 340, height: 260 });
  await t.click(row);
  await sleep(300);
  assert.strictEqual((await t.letters()).n, yours.n, 'converted: the same curves on the canvas');
  await t.click({ x: c.x, y: c.y + 200 }); // empty canvas: nothing selected
  await t.menuAt(p);
  const ids2 = await t.menuIds();
  assert.ok(!ids2.includes('txt-edit') && ids2.includes('grp-enter'), 'no longer text: an ordinary group (Enter group): ' + ids2);
  await t.keys.esc();
  console.log('text-845 studio desktop: ALL CHECKS PASSED ' + JSON.stringify(out));
} finally { await t.close(); }
