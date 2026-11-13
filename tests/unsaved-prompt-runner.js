// tests/unsaved-prompt-runner.js — TASK 558 (owner rulings 2026-11-12): an action that would replace an UNSAVED Untitled with content asks
// "Save… / Don't save / Cancel" (project-actions.js settleUnsaved), in the UI it came from. Live, headless Edge, REAL clicks and keys, in a real
// host. For one host and one CHOICE, every entry path:
//   open-projects  the Projects modal: a design tile (the question shows in the modal's question bar)
//   open-recent    the sidebar's Open recent list
//   open-file      the sidebar's Open from file (the real file chooser, answered with a design file)
//   new            the sidebar's New design
//   goto           the sidebar's GO TO another app (leaves the page)
// and checks what each choice must do:
//   save     the Save as name prompt (real typing) stores the Untitled under that name, THEN the action goes on
//   discard  the Untitled is thrown away (nothing stored), THEN the action goes on
//   cancel   nothing happens: the drawing stays, nothing is stored, nothing opens, the page stays
// The test files (unsaved-prompt-live-<host>-<choice>.test.js) only call runUnsavedPrompt({ host, choice }).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';

export const HOSTS = {
  sketchstudio: { url: '/apps/sketchstudio/index.html', canvas: 'svgCanvas', name: 'Sketch', goto: 'penplotter', gotoUrl: '/apps/penplotter/' },
  penplotter: { url: '/apps/penplotter/index.html', canvas: 'design-canvas', name: 'Pen Plotter', goto: 'sketchstudio', gotoUrl: '/apps/sketchstudio/' },
};
export const PATHS = ['open-projects', 'open-recent', 'open-file', 'new', 'goto'];

export async function runUnsavedPrompt({ host, choice, paths = PATHS }) {
  const H = HOSTS[host];
  const cdp = await launchBrowser({ tag: 'unsaved-' + host + '-' + choice, width: 1400, height: 850 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, navigate } = cdp;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-558-file-'));
  const file = path.join(tmp, 'FromFile.sketch.json');
  fs.writeFileSync(file, JSON.stringify({ format: 'sketch-studio-project', version: 1, app: host, name: 'FromFile',
    document: { version: 2, geometry: { joints: [['j_origin', { x: 0, y: 0, fixed: true }], ['fa', { x: 0, y: 0 }], ['fb', { x: 5, y: 5 }], ['fc', { x: 9, y: 0 }]], shapes: [{ id: 'f1', type: 'line', joints: ['fa', 'fb'] }, { id: 'f2', type: 'line', joints: ['fb', 'fc'] }], constraints: [] }, hosts: {} } }));
  const results = {};
  try {
    await send('DOM.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.showOpenFilePicker; delete window.showSaveFilePicker;' }); // the <input type=file> path
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    // every JS dialog is recorded and answered "leave" (a Cancel case leaves the unsaved drawing behind: the next navigation raises the
    // armed leave-page warning, which is right and is counted below)
    const dialogs = [];
    const armDialog = () => once('Page.javascriptDialogOpening').then(async (d) => { dialogs.push(d.type); await send('Page.handleJavaScriptDialog', { accept: true }); armDialog(); });
    armDialog();
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(30); await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const centre = (sel) => evalJs(`(() => { const e = ${sel.startsWith('[...') ? sel : `document.querySelector(${JSON.stringify(sel)})`}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel, what) => { const c = await centre(sel); assert(c, (what || sel) + ' not found'); await click(c.x, c.y); };
    const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
    const typeText = async (str) => { for (const ch of str) await key(ch, /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : 'Digit' + ch, ch.toUpperCase().charCodeAt(0), 0, ch); };
    const S = '(await import("/packages/ui/project-store.js")).getProjectStore()';
    const recent = () => evalJs(`(async () => JSON.stringify((await ${S}.listRecent({})).map((d) => d.name).sort()))()`).then(JSON.parse);
    const storedShapes = (name) => evalJs(`(async () => { const s = ${S}; const r = (await s.listRecent({})).find((d) => d.name === ${JSON.stringify(name)}); if (!r) return -1; return (await s.get(r.id)).document.geometry.shapes.length; })()`);
    const shapesOnCanvas = (canvas) => evalJs(`document.querySelectorAll('#${canvas} .shape-elem').length`);
    const title = () => evalJs('document.title');
    const appTitle = (n) => `${n} · Sketch Studio`;
    const ready = () => waitFor(`(() => { const c = document.getElementById('${H.canvas}'); return !!c && c.dataset.docReady === '1' && c.getBoundingClientRect().width > 0 && !!document.querySelector('.sk-sidebar-btn'); })()`, host + ' ready', 20000);
    const load = async () => {
      await navigate(`http://127.0.0.1:${port}${H.url}`, 8000);
      if (host === 'penplotter') { await waitFor(`!!document.querySelector('.stage-btn[data-stage="design"]')`, 'pen plotter stages'); await evalJs(`document.querySelector('.stage-btn[data-stage="design"]').click()`); }
      await ready();
    };
    const openSidebar = async () => { if (!(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`))) await clickEl('.sk-sidebar-btn', 'the sidebar button'); await sleep(300); };
    // an unsaved Untitled with one drawn line (real tool clicks)
    const drawLine = async () => {
      await clickEl('#tool-line', 'the Line tool');
      const r = await evalJs(`(() => { const b = document.getElementById('${H.canvas}').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      await click(Math.round(r.x + r.w * 0.30), Math.round(r.y + r.h * 0.65)); await click(Math.round(r.x + r.w * 0.55), Math.round(r.y + r.h * 0.40));
      await key('Escape', 'Escape', 27); await sleep(250);
      await waitFor(`document.querySelectorAll('#${H.canvas} .shape-elem').length === 1`, 'the drawn line on the canvas');
    };

    // ---- once: a stored design "Other" to open, then the page shows an unsaved Untitled
    await load();
    const otherId = await evalJs(CREATE_NAMED_DESIGN(host, 'Other'));
    const fresh = async () => { await evalJs(`(async () => { await ${S}.setCurrent(null); })()`); await load(); };

    let afterCancel = false;
    for (const p of paths) {
      const d0 = dialogs.length;
      await fresh();
      if (afterCancel) assert.deepStrictEqual(dialogs.slice(d0), ['beforeunload'], `${p}: leaving the page the Cancel case left (unsaved drawing) raised the leave-page warning`);
      else assert.strictEqual(dialogs.length, d0, `${p}: leaving a page with nothing unsaved raised no dialog`);
      const d1 = dialogs.length;
      assert.strictEqual(await title(), appTitle(H.name), `${p}: the page shows an unsaved Untitled`);
      await drawLine();
      const keptName = 'Kept' + PATHS.indexOf(p);
      let chooser = null;
      // 1. the entry path
      if (p === 'open-projects') {
        await openSidebar(); await clickEl('[data-action="projects"]', 'Projects');
        await waitFor(`!!document.querySelector('.sk-pm-tile[data-design="${otherId}"]')`, 'the Other tile');
        await clickEl(`.sk-pm-tile[data-design="${otherId}"]`, 'the Other tile');
      } else if (p === 'open-recent') {
        await openSidebar(); await clickEl('[data-action="open-recent"]', 'Open recent');
        await waitFor(`!!document.querySelector('.sk-recent[data-design="${otherId}"]')`, 'the Other row');
        await clickEl(`.sk-recent[data-design="${otherId}"]`, 'the Other row');
      } else if (p === 'open-file') {
        chooser = once('Page.fileChooserOpened');
        await openSidebar(); await clickEl('[data-action="open-file"]', 'Open from file');
      } else if (p === 'new') {
        await openSidebar(); await clickEl('[data-action="new-design"]', 'New design');
      } else if (p === 'goto') {
        await openSidebar(); await clickEl(`.sk-sidebar-goto [data-app="${H.goto}"]`, 'GO TO ' + H.goto);
      }
      // 2. THE question, where the action came from
      const bar = p === 'open-projects' ? '.sk-pm-ask' : '.sk-sidebar-ask';
      await waitFor(`(() => { const a = document.querySelector('${bar}'); return !!a && !a.hidden && !!a.querySelector('[data-choice="save"]'); })()`, `${p}: the Save… / Don't save / Cancel question`, 5000);
      const q = await evalJs(`(() => { const a = document.querySelector('${bar}'); return { text: a.textContent, buttons: [...a.querySelectorAll('button')].map((b) => b.textContent) }; })()`);
      assert.deepStrictEqual(q.buttons, ['Save…', "Don't save", 'Cancel'], `${p}: the three answers, in order: ${JSON.stringify(q)}`);
      assert.ok(/not saved/.test(q.text), `${p}: the question says the design is not saved: ${q.text}`);
      assert.strictEqual(await shapesOnCanvas(H.canvas), 1, `${p}: nothing changed while it asks`);
      if (choice === 'cancel') await clickEl(`${bar} button.cancel`, 'Cancel');
      else if (choice === 'discard') await clickEl(`${bar} [data-choice="discard"]`, "Don't save");
      else {
        await clickEl(`${bar} [data-choice="save"]`, 'Save…');
        await waitFor(`(() => { const a = document.querySelector('${bar}'); return !!a && !a.hidden && !!a.querySelector('input'); })()`, `${p}: the Save as name prompt`, 5000);
        await key('a', 'KeyA', 65, 2); await typeText(keptName); await key('Enter', 'Enter', 13);
      }
      await sleep(700);
      // 3. the file chooser, when the action goes on
      if (p === 'open-file') {
        const fc = await Promise.race([chooser, sleep(choice === 'cancel' ? 1500 : 5000).then(() => null)]);
        if (choice === 'cancel') assert.strictEqual(fc, null, `${p}: Cancel opens no file chooser`);
        else { assert.ok(fc, `${p}: the file chooser opens after the answer`); await send('DOM.setFileInputFiles', { files: [file], backendNodeId: fc.backendNodeId }); await sleep(900); }
      }
      // 4. what the choice did
      const otherApp = HOSTS[H.goto];
      if (p === 'goto' && choice !== 'cancel') {
        await waitFor(`location.pathname.startsWith('${H.gotoUrl}')`, `${p}: the page went to ${H.goto}`, 10000);
        await waitFor(`(() => { const c = document.getElementById('${otherApp.canvas}'); return !!c && c.dataset.docReady === '1'; })()`, `${p}: ${H.goto} restored`, 20000);
      }
      const names = await recent();
      const r = { names, title: await title(), path: await evalJs('location.pathname') };
      if (choice === 'save') {
        assert.ok(names.includes(keptName), `${p}: Save… stored the Untitled under its name: ${JSON.stringify(names)}`);
        assert.strictEqual(await storedShapes(keptName), 1, `${p}: the stored design holds the drawn line`);
      } else {
        assert.ok(!names.some((n) => n.startsWith('Kept') && n === keptName), `${p}: nothing was stored under a new name: ${JSON.stringify(names)}`);
        assert.ok(!names.includes('Untitled'), `${p}: the Untitled was not stored: ${JSON.stringify(names)}`);
      }
      if (choice === 'cancel') {
        assert.strictEqual(await shapesOnCanvas(H.canvas), 1, `${p}: Cancel keeps the drawing`);
        assert.strictEqual(r.title, appTitle(H.name), `${p}: Cancel keeps the unsaved Untitled (title)`);
        assert.ok(r.path.startsWith(H.url.replace('index.html', '')), `${p}: Cancel stays on the page: ${r.path}`);
        assert.ok(!names.includes('FromFile'), `${p}: Cancel opened no file`);
      } else if (p === 'open-projects' || p === 'open-recent') {
        assert.strictEqual(r.title, `Other — ${H.name}`, `${p}: then Other is open`);
        assert.strictEqual(await shapesOnCanvas(H.canvas), 0, `${p}: the canvas shows Other (no line)`);
      } else if (p === 'open-file') {
        assert.strictEqual(r.title, `FromFile — ${H.name}`, `${p}: then the file is open`);
        assert.strictEqual(await shapesOnCanvas(H.canvas), 2, `${p}: the canvas shows the file's two lines`);
      } else if (p === 'new') {
        assert.strictEqual(r.title, appTitle(H.name), `${p}: then a new unsaved Untitled`);
        assert.strictEqual(await shapesOnCanvas(H.canvas), 0, `${p}: the new design is empty`);
      } else if (p === 'goto') {
        assert.strictEqual(await shapesOnCanvas(otherApp.canvas), choice === 'save' ? 1 : 0, `${p}: ${H.goto} shows ${choice === 'save' ? 'the saved design' : 'an empty Untitled'}`);
        assert.strictEqual(r.title, choice === 'save' ? `${keptName} — ${otherApp.name}` : appTitle(otherApp.name), `${p}: ${H.goto}'s title`);
      }
      if (choice !== 'cancel') assert.strictEqual(dialogs.length, d1, `${p}: no leave-page warning once the Untitled was saved or discarded: ${JSON.stringify(dialogs.slice(d1))}`);
      afterCancel = choice === 'cancel';
      results[p] = r;
      console.log(`${host} ${choice} ${p.padEnd(13)} ${JSON.stringify(r)}`);
      if (await evalJs(`!!document.querySelector('.sk-pm')`)) { await key('Escape', 'Escape', 27); await sleep(200); }
    }
    console.log(`unsaved-prompt ${host} ${choice}: ok`);
  } finally {
    await cdp.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return results;
}
