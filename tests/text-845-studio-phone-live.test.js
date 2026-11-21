// tests/text-845-studio-phone-live.test.js — TASK 845, SketchStudio on a phone (390 x 844, touch; tests/helpers/text-845-live.js): a tap with the Text
// tool places a text and its box docks at the top of the screen (full width, 44 px controls) with the keyboard on the text; OK keeps it; a touch-and-hold
// on a letter opens the menu with Edit text / Convert to shapes; Edit text opens the box; a double tap opens it too.
import assert from 'node:assert';
import { openTextPage, HOSTS } from './helpers/text-845-live.js';
import { sleep } from './helpers/cdp-browser.js';

const t = await openTextPage(HOSTS.sketchstudio, { phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const out = {};
try {
  await t.open();
  const c = await t.evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.25, y: r.top + r.height * 0.7 }; })()`);
  const ed = await t.placeText(c, 'Ab');
  out.box = ed.box;
  assert.ok(ed.box.x <= 10 && ed.box.width >= 360 && ed.box.y <= 12, 'the box docks at the top, full width: ' + JSON.stringify(ed.box));
  out.controls = await t.evalJs(`[...document.querySelectorAll('.sk-text-editor select, .sk-text-editor input[type=text], .sk-text-editor .sk-text-row > button, .sk-text-align button')].map((e) => Math.round(e.getBoundingClientRect().height))`);
  assert.ok(out.controls.every((h) => h >= 44), 'every control is 44 px tall on a finger: ' + out.controls);
  await t.typeInto('.sk-text-size', '12');
  await sleep(300);
  await t.shot('studio-phone-1-typed.png');
  await t.pressEl('.sk-text-ok');
  assert.strictEqual(await t.editor(), null, 'OK closed the box');
  const kept = await t.letters();
  assert.ok(kept.n > 10, 'the text kept: ' + kept.n);
  // the Select tool (its ribbon button), a hold on a letter: the menu
  await t.ribbon('tool-select');
  const p = await t.letterPoint();
  await t.menuAt(p);
  const ids = await t.menuIds();
  assert.ok(ids.includes('txt-edit') && ids.includes('txt-convert') && !ids.includes('grp-enter'), 'the hold menu: Edit text, Convert to shapes: ' + ids);
  out.rowH = (await t.menuRow('txt-edit')).h;
  assert.ok(out.rowH >= 44, 'touch rows 44 px: ' + out.rowH);
  await t.shot('studio-phone-2-menu.png');
  await t.tap(await t.menuRow('txt-edit'));
  await t.waitFor(`!!document.querySelector('.sk-text-editor')`, 'Edit text opens the box');
  const e2 = await t.editor();
  assert.deepStrictEqual([e2.text, e2.label], ['Ab', 'Edit text'], 'the box holds the text');
  await t.pressEl('.sk-text-cancel');
  assert.strictEqual(await t.editor(), null, 'Cancel closed it');
  assert.strictEqual((await t.letters()).n, kept.n, 'nothing changed');
  // a double tap on a letter: the box
  await t.dblclick(p);
  await t.waitFor(`!!document.querySelector('.sk-text-editor')`, 'a double tap opens the box');
  await sleep(200);
  await t.send('Input.insertText', { text: 'Tap' });
  await sleep(400);
  await t.shot('studio-phone-3-edit.png');
  await t.pressEl('.sk-text-ok');
  assert.notStrictEqual((await t.letters()).n, kept.n, 'the edit kept');
  console.log('text-845 studio phone: ALL CHECKS PASSED ' + JSON.stringify(out));
} finally { await t.close(); }
