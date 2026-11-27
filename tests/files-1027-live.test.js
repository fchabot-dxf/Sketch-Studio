// tests/files-1027-live.test.js — TASK 1027 (files audit 1024), in a real browser, desktop 1280x800 and phone 390:
//   BUG-307 (F-94): Tab / Shift+Tab inside the aria-modal Save as and Open dialogs never reach the page behind (a focus trap).
//   BUG-306 (F-03 / F-32): a file opened and not edited survives a reload and shows in another app (the open-tabs buffer keeps it like an edited tab).
// The FAKE Google session only, every non-local request blocked (the audit kit). Run: node tests/files-1027-live.test.js
import assert from 'node:assert';
import path from 'node:path';
import { startKit, sleep, FIX_DIR } from './audits/files-audit-1024-kit.js';

const inDialog = (k) => k.evalJs(`(() => { const d = document.querySelector('.sk-fd'); const a = document.activeElement; return !!(d && a && d.closest('[role=dialog]').contains(a)); })()`);
const openDlg = async (k, action, mode) => { await k.menu(action); await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="${mode}"]')`, mode + ' dialog'); await sleep(200); };

async function phase(k, label, phone) {
  await k.phone(phone);
  // ---- F-94: more Tab presses than the dialog has controls, both directions, each dialog
  for (const [action, mode] of [['save-as', 'save'], ['open-file', 'open']]) {
    await k.open('sketchstudio');
    await k.drawLine('svgCanvas', 0.4);
    await openDlg(k, action, mode);
    for (const shift of [false, true]) {
      for (let i = 0; i < 14; i++) {
        await k.key('Tab', { shift });
        assert.ok(await inDialog(k), `${label} ${mode} dialog: after ${shift ? 'Shift+' : ''}Tab #${i + 1} the focus is still inside the dialog (it was: ${JSON.stringify(await k.evalJs(`document.activeElement.className || document.activeElement.tagName`))})`);
      }
    }
    await k.esc(); await sleep(250);
    assert.ok(await k.evalJs(`!document.querySelector('.sk-fd')`), `${label} ${mode} dialog: Esc still closes it`);
  }
  console.log(`${label}: F-94 Tab / Shift+Tab stay inside the Save as and Open dialogs (14 presses each way, each dialog)`);

  // ---- F-03 / F-32: open a file, edit nothing
  await k.open('sketchstudio');
  await openDlg(k, 'open-file', 'open');
  assert.ok(await k.chooseFile(path.join(FIX_DIR, 'rich.sketch.json')), `${label}: the file chooser answered`);
  await k.waitFor(`document.querySelectorAll('#svgCanvas .shape-elem[data-shape-id]').length > 20`, 'the file drawn'); await sleep(500);
  const before = await k.shapes();
  assert.ok((await k.tabs()).some((t) => t.name === 'rich' && t.active && !t.dot), `${label}: the file is the active tab, no dot`);
  await k.reload('sketchstudio');
  const after = await k.tabs();
  assert.ok(after.length === 1 && after[0].name === 'rich', `${label} F-03: after a reload the tab is still there (tabs: ${JSON.stringify(after.map((t) => t.name))})`);
  assert.strictEqual(await k.shapes(), before, `${label} F-03: and it holds the same drawing (${before} shapes)`);
  assert.ok(!after[0].dot, `${label} F-03: still no dot (it was not edited)`);
  await k.flush();
  await k.open('shaper', { reset: false });
  const sh = await k.tabs();
  assert.ok(sh.some((t) => t.name === 'rich' && t.active), `${label} F-32: Shaper shows the opened file as its tab (tabs: ${JSON.stringify(sh.map((t) => t.name))})`);
  assert.ok((await k.shapes('design-canvas')) > 0, `${label} F-32: with its drawing`);
  console.log(`${label}: F-03 / F-32 the opened file survives a reload and follows to Shaper (${before} shapes)`);
}

const k = await startKit({ tag: '1027' });
try {
  await phase(k, 'desktop 1280x800', false);
  await phase(k, 'phone 390', true);
  console.log(`BLOCKED non-local requests: ${k.net.blocked().length}`);
  console.log('files-1027-live: ok');
} finally { await k.close(); }
