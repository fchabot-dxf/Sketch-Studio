// tests/unsaved-prompt-node-runner.js — TASK 583 (the node port of tests/unsaved-prompt-runner.js, TASK 558; owner rulings 2026-11-12): an action that would replace an
// UNSAVED Untitled with content asks "Save… / Don't save / Cancel" (project-actions.js settleUnsaved), in the UI it came from. A real host through
// tests/helpers/node-app.js with the shared sidebar mounted (open({ sidebar: true })): the clicks, the question, the typed name and the store are the app's own.
// For one host and one CHOICE, every entry path:
//   open-projects  the Projects modal: a design tile (the question shows in the modal's question bar)
//   open-recent    the sidebar's Open recent (the Projects modal on its Recent pane; a design tile there)
//   open-file      the sidebar's Open from file (the page's file chooser, answered with a design file)
//   new            the sidebar's New design
//   goto           the sidebar's GO TO another app (leaves the page)
// and checks what each choice must do:
//   save     the Save as name prompt (typing) stores the Untitled under that name, THEN the action goes on
//   discard  the Untitled is thrown away (nothing stored), THEN the action goes on
//   cancel   nothing happens: the drawing stays, nothing is stored, nothing opens, the page stays
// What stays in the browser (tests/save-key-leave-live-sketchstudio.test.js): the real leave-page dialog. Here its LOGIC is asserted: the buffer arms the page's
// `beforeunload` (it prevents the event) exactly while an unsaved Untitled has content, so "no leave-page warning" is "the event is not prevented".
// The test files (unsaved-prompt-<host>-<choice>-node.test.js) only call runUnsavedPrompt({ host, choice }).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

export const HOSTS = {
  sketchstudio: { url: '/apps/sketchstudio/index.html', canvas: 'svgCanvas', name: 'Sketch', goto: 'penplotter', gotoUrl: '/apps/penplotter/' },
  penplotter: { url: '/apps/penplotter/index.html', canvas: 'design-canvas', name: 'Pen Plotter', goto: 'sketchstudio', gotoUrl: '/apps/sketchstudio/' },
};
export const PATHS = ['open-projects', 'open-recent', 'open-file', 'new', 'goto'];

// is the page's leave-page warning armed? (the buffer prevents the cancelable `beforeunload` while leaving would lose work)
export const leaveWarns = (app) => { const e = new app.window.Event('beforeunload', { cancelable: true }); app.window.dispatchEvent(e); return e.defaultPrevented; };

export async function runUnsavedPrompt({ host, choice, paths = PATHS }) {
  const H = HOSTS[host];
  const file = { name: 'FromFile.sketch.json', text: JSON.stringify({ format: 'sketch-studio-project', version: 1, app: host, name: 'FromFile',
    document: { version: 2, geometry: { joints: [['j_origin', { x: 0, y: 0, fixed: true }], ['fa', { x: 0, y: 0 }], ['fb', { x: 5, y: 5 }], ['fc', { x: 9, y: 0 }]], shapes: [{ id: 'f1', type: 'line', joints: ['fa', 'fb'] }, { id: 'f2', type: 'line', joints: ['fb', 'fc'] }], constraints: [] }, hosts: {} } }) };
  const results = {};
  const profile = await createProfile();
  let app = null;
  const appTitle = (n) => `${n} · Sketch Studio`;
  const q = (sel) => app.document.querySelector(sel);
  const pressEl = (sel, what) => { const e = q(sel); assert(e, (what || sel) + ' not found'); app.press(e); };
  const recent = async () => (await app.store.listRecent({})).map((d) => d.name).sort();
  const storedShapes = async (name) => { const r = (await app.store.listRecent({})).find((d) => d.name === name); if (!r) return -1; return (await app.store.get(r.id)).document.geometry.shapes.length; };
  const shapesOnCanvas = (canvas) => app.document.querySelectorAll(`#${canvas} .shape-elem`).length;
  const title = () => app.document.title;
  const pathname = () => app.window.location.pathname;
  const settle = (ms = 80) => app.pause(ms); // "nothing happens" has no event to wait for: a short real pause
  const openApp = async (h) => { app = await open({ host: h, profile, sidebar: true }); app.frames(3); };
  const openSidebar = async () => { if (!q('.sk-sidebar').classList.contains('open')) pressEl('.sk-sidebar-btn', 'the sidebar button'); await settle(); };
  // an unsaved Untitled with one drawn line (tool clicks)
  const drawLine = () => {
    app.tool('line');
    const r = app.svg.getBoundingClientRect();
    app.click(Math.round(r.left + r.width * 0.30), Math.round(r.top + r.height * 0.65)); app.click(Math.round(r.left + r.width * 0.55), Math.round(r.top + r.height * 0.40));
    app.esc();
    assert.strictEqual(shapesOnCanvas(H.canvas), 1, 'the drawn line on the canvas');
  };

  // ---- once: a stored design "Other" to open, then the page shows an unsaved Untitled
  const otherId = await createNamedDesign(profile, host, 'Other');
  const fresh = async () => { if (app) { await app.store.setCurrent(null); await app.close(); } else { const s = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null }); await s.setCurrent(null); } await openApp(host); };

  let afterCancel = false;
  for (const p of paths) {
    if (app) assert.strictEqual(leaveWarns(app), afterCancel, `${p}: leaving the page the previous case left ${afterCancel ? '(an unsaved drawing) raises the leave-page warning' : 'with nothing unsaved raises none'}`);
    await fresh();
    assert.strictEqual(leaveWarns(app), false, `${p}: a fresh page with nothing unsaved raises no leave-page warning`);
    assert.strictEqual(title(), appTitle(H.name), `${p}: the page shows an unsaved Untitled`);
    drawLine();
    assert.strictEqual(leaveWarns(app), true, `${p}: an unsaved Untitled with content arms the leave-page warning`);
    const keptName = 'Kept' + PATHS.indexOf(p);
    // 1. the entry path
    if (p === 'open-projects') {
      await openSidebar(); pressEl('[data-action="projects"]', 'Projects');
      await app.waitFor(() => !!q(`.sk-pm-tile[data-design="${otherId}"]`), 'the Other tile');
      pressEl(`.sk-pm-tile[data-design="${otherId}"]`, 'the Other tile');
    } else if (p === 'open-recent') {
      await openSidebar(); pressEl('[data-action="open-recent"]', 'Open recent');
      await app.waitFor(() => !!q(`.sk-pm-tile[data-design="${otherId}"]`), 'the Other tile in Recent');
      pressEl(`.sk-pm-tile[data-design="${otherId}"]`, 'the Other tile in Recent');
    } else if (p === 'open-file') {
      await openSidebar(); pressEl('[data-action="open-file"]', 'Open from file');
    } else if (p === 'new') {
      await openSidebar(); pressEl('[data-action="new-design"]', 'New design');
    } else if (p === 'goto') {
      await openSidebar(); pressEl(`.sk-sidebar-goto [data-app="${H.goto}"]`, 'GO TO ' + H.goto);
    }
    // 2. THE question, where the action came from
    const bar = (p === 'open-projects' || p === 'open-recent') ? '.sk-pm-ask' : '.sk-sidebar-ask';
    await app.waitFor(() => { const a = q(bar); return !!a && !a.hidden && !!a.querySelector('[data-choice="save"]'); }, `${p}: the Save… / Don't save / Cancel question`, 5000);
    const a = q(bar); const qq = { text: a.textContent, buttons: [...a.querySelectorAll('button')].map((b) => b.textContent) };
    assert.deepStrictEqual(qq.buttons, ['Save…', "Don't save", 'Cancel'], `${p}: the three answers, in order: ${JSON.stringify(qq)}`);
    assert.ok(/not saved/.test(qq.text), `${p}: the question says the design is not saved: ${qq.text}`);
    assert.strictEqual(shapesOnCanvas(H.canvas), 1, `${p}: nothing changed while it asks`);
    if (choice === 'cancel') pressEl(`${bar} button.cancel`, 'Cancel');
    else if (choice === 'discard') pressEl(`${bar} [data-choice="discard"]`, "Don't save");
    else {
      pressEl(`${bar} [data-choice="save"]`, 'Save…');
      await app.waitFor(() => { const b = q(bar); return !!b && !b.hidden && !!b.querySelector('input'); }, `${p}: the Save as name prompt`, 5000);
      const input = q(`${bar} input`); app.press(input); input.focus();
      app.key('a', { ctrl: true }); app.type(keptName); app.key('Enter');
    }
    // 3. the file chooser, when the action goes on
    if (p === 'open-file') {
      if (choice === 'cancel') { await settle(300); assert.strictEqual(app.hasFileChooser(), false, `${p}: Cancel opens no file chooser`); }
      else { await app.waitFor(() => app.hasFileChooser(), `${p}: the file chooser opens after the answer`, 5000); app.chooseFile(file); }
    }
    // 4. what the choice did
    const otherApp = HOSTS[H.goto];
    if (choice !== 'cancel') await app.waitFor(async () => {
      const names = await recent();
      if (p === 'open-projects' || p === 'open-recent') return title() === `Other — ${H.name}`;
      if (p === 'open-file') return names.includes('FromFile') && title() === `FromFile — ${H.name}`;
      if (p === 'new') return choice === 'save' ? names.includes(keptName) && title() === appTitle(H.name) : title() === appTitle(H.name) && shapesOnCanvas(H.canvas) === 0;
      return pathname().startsWith(H.gotoUrl);
    }, `${p}: the action goes on after ${choice}`, 5000);
    else await settle(300);
    if (choice !== 'cancel') assert.strictEqual(leaveWarns(app), false, `${p}: no leave-page warning once the Untitled was saved or discarded`);
    const names = await recent();
    const r = { names, title: title(), path: pathname() };
    if (p === 'goto' && choice !== 'cancel') { // the page left: the other app opens on the same profile
      await app.close(); await openApp(H.goto);
      assert.strictEqual(shapesOnCanvas(otherApp.canvas), choice === 'save' ? 1 : 0, `${p}: ${H.goto} shows ${choice === 'save' ? 'the saved design' : 'an empty Untitled'}`);
      const want = choice === 'save' ? `${keptName} — ${otherApp.name}` : appTitle(otherApp.name);
      await app.waitFor(() => title() === want, `${p}: ${H.goto}'s title follows its current design`, 5000); // the sidebar sets it once the store answers
      r.title = title();
      assert.strictEqual(r.title, choice === 'save' ? `${keptName} — ${otherApp.name}` : appTitle(otherApp.name), `${p}: ${H.goto}'s title`);
    }
    if (choice === 'save') {
      assert.ok(names.includes(keptName), `${p}: Save… stored the Untitled under its name: ${JSON.stringify(names)}`);
      assert.strictEqual(await storedShapes(keptName), 1, `${p}: the stored design holds the drawn line`);
    } else {
      assert.ok(!names.some((n) => n.startsWith('Kept') && n === keptName), `${p}: nothing was stored under a new name: ${JSON.stringify(names)}`);
      assert.ok(!names.includes('Untitled'), `${p}: the Untitled was not stored: ${JSON.stringify(names)}`);
    }
    if (choice === 'cancel') {
      assert.strictEqual(shapesOnCanvas(H.canvas), 1, `${p}: Cancel keeps the drawing`);
      assert.strictEqual(r.title, appTitle(H.name), `${p}: Cancel keeps the unsaved Untitled (title)`);
      assert.ok(r.path.startsWith(H.url.replace('index.html', '')), `${p}: Cancel stays on the page: ${r.path}`);
      assert.ok(!names.includes('FromFile'), `${p}: Cancel opened no file`);
    } else if (p === 'open-projects' || p === 'open-recent') {
      assert.strictEqual(r.title, `Other — ${H.name}`, `${p}: then Other is open`);
      assert.strictEqual(shapesOnCanvas(H.canvas), 0, `${p}: the canvas shows Other (no line)`);
    } else if (p === 'open-file') {
      assert.strictEqual(r.title, `FromFile — ${H.name}`, `${p}: then the file is open`);
      assert.strictEqual(shapesOnCanvas(H.canvas), 2, `${p}: the canvas shows the file's two lines`);
    } else if (p === 'new') {
      assert.strictEqual(r.title, appTitle(H.name), `${p}: then a new unsaved Untitled`);
      assert.strictEqual(shapesOnCanvas(H.canvas), 0, `${p}: the new design is empty`);
    }
    afterCancel = choice === 'cancel';
    results[p] = r;
    console.log(`${host} ${choice} ${p.padEnd(13)} ${JSON.stringify(r)}`);
    if (q('.sk-pm')) { app.key('Escape'); await settle(); }
  }
  if (app) await app.close();
  console.log(`unsaved-prompt-node ${host} ${choice}: ok`);
  return results;
}
