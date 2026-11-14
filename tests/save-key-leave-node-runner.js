// tests/save-key-leave-node-runner.js — TASK 583 (the node port of tests/save-key-leave-runner.js, TASK 558, owner rulings 2026-11-12), a real host through
// tests/helpers/node-app.js with the shared sidebar mounted (open({ sidebar: true })):
//   Ctrl+S on an unsaved Untitled opens the Save as name prompt (in the sidebar); the typed name stores it.
//   Ctrl+S on a named design writes the pending autosave NOW (before the 1.5 s poll); no prompt.
//   Ctrl+S never reaches the canvas shortcuts (a bare "s" there picks the Select tool).
//   The page's leave-page warning (`beforeunload`) is armed while an unsaved Untitled has content, and NOT for a clean Untitled or a named, saved design.
// What stays in the browser (tests/save-key-leave-live-sketchstudio.test.js): the real leave-page dialog (a page-initiated reload raising it) and the Save as prompt
// taking the keyboard focus after a REAL Ctrl+S. Here the warning is the page's `beforeunload` event, prevented by the buffer exactly while leaving would lose work.
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { HOSTS, leaveWarns } from './unsaved-prompt-node-runner.js';
import { resetBuffer } from './helpers/reset-buffer.js';

export async function runSaveKeyLeave({ host }) {
  const H = { ...HOSTS[host], name: HOSTS[host].name };
  const profile = await createProfile();
  let app = null;
  const q = (sel) => app.document.querySelector(sel);
  const shapes = () => app.document.querySelectorAll(`#${H.canvas} .shape-elem`).length;
  const storedShapes = async (name) => { const r = (await app.store.listRecent({})).find((d) => d.name === name); if (!r) return -1; return (await app.store.get(r.id)).document.geometry.shapes.length; };
  const ctrlS = () => app.key('s', { ctrl: true });
  let n = 0;
  const drawLine = () => {
    const before = shapes();
    app.tool('line');
    const r = app.svg.getBoundingClientRect();
    const dy = 0.08 * (n++);
    app.click(Math.round(r.left + r.width * 0.30), Math.round(r.top + r.height * (0.30 + dy))); app.click(Math.round(r.left + r.width * 0.55), Math.round(r.top + r.height * (0.30 + dy)));
    app.esc();
    assert.strictEqual(shapes(), before + 1, 'the drawn line');
  };
  try {
    // 1. a clean Untitled: no leave-page warning
    console.log(`${host} step 1`);
    app = await open({ host, profile, sidebar: true });
    await resetBuffer(app.store);
    await app.close(); app = await open({ host, profile, sidebar: true });
    app.tool('select');
    assert.strictEqual(leaveWarns(app), false, 'a clean Untitled: no leave-page warning');
    // 2. an unsaved Untitled with content: local buffer keeps it across reload, so leave-page warning is NOT armed
    console.log(`${host} step 2`);
    drawLine();
    assert.strictEqual(leaveWarns(app), false, 'an unsaved Untitled with content lives in the working buffer: no leave-page warning');
    assert.strictEqual(shapes(), 1, 'the drawing is there');
    // 3. Ctrl+S on the unsaved Untitled: the Save as name prompt, in the sidebar; Ctrl+S does not pick the Select tool
    console.log(`${host} step 3`);
    app.tool('line');
    const lineActive = () => q('#tool-line').classList.contains('active');
    const activeBefore = lineActive();
    ctrlS();
    await app.waitFor(() => !!q('.sk-sidebar-ask input'), 'Ctrl+S on an unsaved design: the Save as name prompt', 5000);
    assert.strictEqual(q('.sk-sidebar-ask input').value, 'Untitled', 'the prompt starts from the current name');
    app.key('a', { ctrl: true }); app.type('Saved1'); app.key('Enter');
    await app.waitFor(async () => (await storedShapes('Saved1')) === 1, 'the typed name stores the drawing', 5000);
    assert.strictEqual(await storedShapes('Saved1'), 1, 'the typed name stores the drawing');
    assert.strictEqual(app.document.title, `Saved1 — ${H.name}`, 'and it is the named, current design');
    assert.strictEqual(lineActive(), activeBefore, 'Ctrl+S did not switch the tool');
    // 4. Ctrl+S on the named design: the pending edit is written NOW (the autosave poll is 1.5 s), no prompt
    console.log(`${host} step 4`);
    drawLine();
    ctrlS();
    await app.waitFor(async () => (await storedShapes('Saved1')) === 2, 'Ctrl+S on a named design wrote the new line at once', 1200);
    assert.strictEqual(!!q('.sk-sidebar-ask'), false, 'Ctrl+S on a named design asks nothing');
    assert.strictEqual(await storedShapes('Saved1'), 2, 'Ctrl+S on a named design wrote the new line at once');
    // 5. a named, saved design: no leave-page warning; the reload restores it
    console.log(`${host} step 5`);
    assert.strictEqual(leaveWarns(app), false, 'a named, saved design: no leave-page warning');
    await app.close(); app = await open({ host, profile, sidebar: true });
    assert.strictEqual(shapes(), 2, 'the reload restored the named design');
    console.log(`save-key-leave-node ${host}: ok`);
  } finally {
    if (app) await app.close();
  }
}
