// tests/document-tabs-ui-node.test.js — TASK 587 (docs/DOCUMENT-TABS-DESIGN.md slices 2, 3, 4), through the node kit (tests/helpers/node-app.js):
//   A. SketchStudio: two designs as tabs, each keeps its drawing, undo history and VIEW (a switch refits nothing); Ctrl+Z acts on the active tab only.
//   B. Pen Plotter: its Toolpath / Export undo stacks (history.js) ride the tab (the `session` hook), a new tab starts empty.
//   C. Shaper: the cut plan of each tab stays apart through a switch (it rides the sidecar, no session needed).
//   F-I (TASK 605). F. Pen Plotter: the Toolpath selection is the tab's. G. Shaper: Explore's SVG and Prepare's selection + view, the stage stays. H. the 11th tab and the close question per host. I. Trace: the photo session.
//   D. The strip (document-tabs.js) over the declared project actions: click, +, close x with THE unsaved question, keyboard, the 11th tab (T7),
//      the same design twice, a renamed / deleted design, the sidebar placing it below the header (TASK 602), the name following the active tab.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { createDocumentTabs } from '#ui/document-tabs.js';
import { createProjectActions } from '#ui/project-actions.js';
import { mountProjectSidebar } from '#ui/sidebar-projects.js';

const lineAt = (app, fx0, fy0, fx1, fy1) => {
  const r = app.svg.getBoundingClientRect();
  app.tool('line');
  app.click(Math.round(r.left + r.width * fx0), Math.round(r.top + r.height * fy0));
  app.click(Math.round(r.left + r.width * fx1), Math.round(r.top + r.height * fy1));
  app.esc();
};
const names = (b) => b.tabs().map((t) => t.name);

// ---- A. SketchStudio ----------------------------------------------------------------------------------------------------------------
{
  const profile = await createProfile();
  const idA = await createNamedDesign(profile, 'sketchstudio', 'Alpha');
  const idB = await createNamedDesign(profile, 'sketchstudio', 'Beta');
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const b = app.buffer;
    await b.openTab(idA); // current is Beta (the last created): Alpha opens in its own tab
    assert.deepStrictEqual(names(b), ['Beta', 'Alpha'], 'two tabs, new one at the right end');
    lineAt(app, 0.3, 0.3, 0.6, 0.3); lineAt(app, 0.3, 0.5, 0.6, 0.5);
    const alpha = { shapes: app.state.shapes.length, steps: app.state.history.length };
    assert(alpha.shapes === 2 && alpha.steps >= 2, 'drew two lines in Alpha: ' + JSON.stringify(alpha));
    app.wheel(app.svg.getBoundingClientRect().left + 300, app.svg.getBoundingClientRect().top + 300, -300); // zoom: Alpha's own view
    const viewA = { ...app.state.view };
    await b.activate(b.tabs()[0].key); app.frames(2);
    assert.strictEqual(app.state.shapes.length, 0, 'Beta shows its own (empty) drawing');
    assert.strictEqual(app.state.history.length, 0, "Beta has none of Alpha's undo steps");
    lineAt(app, 0.4, 0.7, 0.7, 0.7);
    const viewB = { ...app.state.view };
    assert.notDeepStrictEqual(viewA, viewB, 'the two tabs have different views (Alpha was zoomed)');
    app.undo(); app.frames(2);
    assert.strictEqual(app.state.shapes.length, 0, 'Ctrl+Z in Beta undid Beta\'s line');
    await b.activate(b.tabs()[1].key); app.frames(2);
    assert.strictEqual(app.state.shapes.length, alpha.shapes, "Alpha's drawing is back");
    assert.strictEqual(app.state.history.length, alpha.steps, "Alpha's undo history is back");
    assert.deepStrictEqual({ ...app.state.view }, viewA, "Alpha's view is back: a switch refits nothing");
    app.undo(); app.frames(2);
    assert.strictEqual(app.state.shapes.length, alpha.shapes - 1, 'Ctrl+Z in Alpha undid ONE of Alpha\'s lines (Beta untouched)');
    // the strip's actions: closing a named tab asks nothing and keeps the other
    await b.closeTab(b.tabs()[0].key);
    assert.deepStrictEqual(names(b), ['Alpha']);
  } finally { await app.close(); }
}

// ---- B. Pen Plotter: the history.js stacks are a tab's session ---------------------------------------------------------------------------
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'penplotter', 'Postcard');
  const pp = await open({ host: 'penplotter', profile });
  try {
    const { snapshot, captureHistorySession } = await import('../apps/penplotter/src/history.js');
    const depth = () => captureHistorySession().undo.length;
    snapshot(); snapshot(); snapshot();
    assert.strictEqual(depth(), 3);
    const view = { ...pp.state.view };
    await pp.buffer.newTab();
    assert.strictEqual(depth(), 0, 'a new tab starts with no toolpath history');
    snapshot();
    assert.strictEqual(depth(), 1);
    await pp.buffer.activate(pp.buffer.tabs()[0].key);
    assert.strictEqual(depth(), 3, "the first tab's toolpath undo steps are back");
    assert.deepStrictEqual({ ...pp.state.view }, view, 'its view is back');
    await pp.buffer.activate(pp.buffer.tabs()[1].key);
    assert.strictEqual(depth(), 1, "the second tab's own stack is back");
  } finally { await pp.close(); }
}

// ---- C. Shaper: nothing to declare, the cut plan rides the sidecar ------------------------------------------------------------------------
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Sign');
  const sh = await open({ host: 'shaper', profile });
  try {
    const { captureShaperDoc } = await import('../apps/shaper/src/shaper-doc.js');
    lineAt(sh, 0.3, 0.3, 0.6, 0.3);
    const planOf = () => JSON.stringify(captureShaperDoc());
    const planA = planOf();
    await sh.buffer.newTab();
    assert.strictEqual(sh.state.shapes.length, 0, 'the new tab is empty');
    await sh.buffer.activate(sh.buffer.tabs()[0].key);
    assert.strictEqual(planOf(), planA, "Sign's cut plan is exactly as it was");
    assert.strictEqual(sh.state.shapes.length, 1);
  } finally { await sh.close(); }
}

// ---- D. the strip -----------------------------------------------------------------------------------------------------------------------
{
  const profile = await createProfile();
  const idA = await createNamedDesign(profile, 'sketchstudio', 'Alpha');
  const idB = await createNamedDesign(profile, 'sketchstudio', 'Beta');
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const { buffer: b, store, document: doc, window: win } = app;
    const asked = []; let answer = null;
    const ask = async (spec) => { asked.push(spec); return typeof answer === 'function' ? answer(spec) : answer; };
    const actions = createProjectActions({ store, getBuffer: () => b, tabs: true, ask });
    const strip = createDocumentTabs({ getBuffer: () => b, store, pollMs: 1e9, doc, actions: { activateTab: actions.activateTab, closeTab: actions.closeTab, newDesign: actions.newDesign } });
    doc.body.appendChild(strip.el);
    const tabEls = () => [...strip.el.querySelectorAll('.sk-doctab-main')];
    const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 5)); strip.refresh(); } };
    const click = async (el) => { el.click(); await settle(); };
    await b.ready; await settle();
    assert.strictEqual(strip.el.getAttribute('role'), 'tablist');
    assert.deepStrictEqual(tabEls().map((e) => e.textContent), ['Beta'], 'one tab: the design shown');

    await actions.openDesign(idA); await settle();
    assert.deepStrictEqual(tabEls().map((e) => e.textContent), ['Beta', 'Alpha'], 'Open opens a new tab');
    assert.strictEqual(asked.length, 0, 'Open over a stored design asks nothing');
    await actions.openDesign(idB); await settle();
    assert.strictEqual(tabEls().length, 2, 'the same design opened again switches to its tab: still two tabs');
    assert(strip.el.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Beta', 'and Beta is the active one');

    // "+" opens an unsaved Untitled; drawing in it marks it (a dot) and closing it asks THE question
    await click(strip.el.querySelector('.sk-doctab-new'));
    assert.deepStrictEqual(tabEls().map((e) => e.textContent), ['Beta', 'Alpha', 'Untitled']);
    assert.strictEqual(strip.el.querySelectorAll('.sk-doctab-dot').length, 0, 'an empty Untitled has no dot');
    lineAt(app, 0.3, 0.3, 0.6, 0.3); await settle();
    assert.strictEqual(strip.el.querySelectorAll('.sk-doctab-dot').length, 1, 'an Untitled with content shows the not-saved dot');
    assert.strictEqual(strip.el.querySelector('.sk-doctab-dot').closest('.sk-doctab').querySelector('.sk-doctab-name').textContent, 'Untitled');

    // Ctrl+Z after a switch acts on the active tab only
    await click(tabEls()[0]);
    assert.strictEqual(app.state.shapes.length, 0, 'Beta shown');
    app.undo(); app.frames(2);
    await click(tabEls()[2]);
    assert.strictEqual(app.state.shapes.length, 1, "Ctrl+Z in Beta did not touch the Untitled's line");

    // close the Untitled: Cancel keeps it, Don't save closes it
    const x = () => [...strip.el.querySelectorAll('.sk-doctab-x')][2];
    answer = null; await click(x());
    assert.strictEqual(asked.at(-1).label, 'This design is not saved.', 'THE question');
    assert.deepStrictEqual(asked.at(-1).options.map((o) => o.label), ['Save…', "Don't save"]);
    assert.strictEqual(tabEls().length, 3, 'Cancel keeps the tab');
    answer = 'discard'; await click(x());
    assert.deepStrictEqual(tabEls().map((e) => e.textContent), ['Beta', 'Alpha'], "Don't save closes it");
    assert.strictEqual(app.state.shapes.length, 0, 'the neighbour (Alpha) is shown');
    // a named tab closes without a question
    const nAsked = asked.length;
    await click([...strip.el.querySelectorAll('.sk-doctab-x')][0]);
    assert.strictEqual(asked.length, nAsked, 'a named design closes without asking');
    assert.deepStrictEqual(tabEls().map((e) => e.textContent), ['Alpha']);
    // the last tab closed -> a fresh Untitled (T6)
    await click(strip.el.querySelector('.sk-doctab-x'));
    assert.deepStrictEqual(tabEls().map((e) => e.textContent), ['Untitled'], 'the last tab closed leaves a fresh Untitled');

    // keyboard: arrows move between tabs, Enter (click) activates
    await actions.openDesign(idA); await actions.openDesign(idB); await settle();
    const key = (el, k) => el.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: k }));
    tabEls()[0].focus(); key(tabEls()[0], 'ArrowRight');
    assert(doc.activeElement === tabEls()[1], 'ArrowRight moves the focus to the next tab');
    key(doc.activeElement, 'ArrowRight');
    assert(doc.activeElement === tabEls()[0], 'and wraps');

    // the 11th tab (T7): the strip says so and nothing opens
    for (let i = b.tabs().length; i < 10; i++) await click(strip.el.querySelector('.sk-doctab-new'));
    assert.strictEqual(tabEls().length, 10);
    await click(strip.el.querySelector('.sk-doctab-new'));
    assert.strictEqual(tabEls().length, 10, 'no 11th tab');
    assert(/Close a tab first/.test(strip.el.querySelector('.sk-doctabs-msg').textContent), 'the strip says: ' + strip.el.querySelector('.sk-doctabs-msg').textContent);
    answer = 'discard';
    while (b.tabs().length > 1) await click([...strip.el.querySelectorAll('.sk-doctab-x')].at(-1));

    // a rename in the store shows in the tab; a deleted design's tab closes (the Projects modal's Delete)
    await actions.openDesign(idB); await settle();
    await store.rename(idB, 'Beta 2'); strip.refresh(); await new Promise((r) => setTimeout(r, 450)); strip.refresh();
    assert(tabEls().map((e) => e.textContent).includes('Beta 2'), 'renamed: ' + tabEls().map((e) => e.textContent));
    await store.remove(idB); await new Promise((r) => setTimeout(r, 450)); strip.refresh();
    assert(!tabEls().map((e) => e.textContent).includes('Beta 2'), 'a deleted design closes its tab: ' + tabEls().map((e) => e.textContent));
    strip.destroy();
  } finally { await app.close(); }
}

// ---- E. mountProjectSidebar({ documentTabs: true }): the strip is its own row below the header (TASK 602); the name follows the active tab --------------------
{
  const profile = await createProfile();
  const idA = await createNamedDesign(profile, 'sketchstudio', 'Alpha');
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const { buffer: b, store, document: doc } = app;
    const header = doc.createElement('header'); doc.body.insertBefore(header, doc.body.firstChild);
    const sb = mountProjectSidebar({ appId: 'sketchstudio', getBuffer: () => b, documentTabs: true, store, account: null });
    header.appendChild(sb.el); // the host appends the button AFTER the mount call
    await new Promise((r) => setTimeout(r, 30));
    const strip = doc.querySelector('.sk-doctabs');
    assert(strip, 'the strip exists');
    assert.strictEqual(strip.previousElementSibling, header, 'it is the row immediately below the header (TASK 602, owner)');
    await b.newTab();
    await new Promise((r) => setTimeout(r, 700));
    assert.strictEqual(sb.el.closest('header'), header);
    assert.strictEqual(doc.title.startsWith('Untitled'), false, 'an unsaved Untitled has no design in the title: ' + doc.title);
    await b.activate(b.tabs()[0].key);
    await new Promise((r) => setTimeout(r, 700));
    assert(/Alpha/.test(doc.title), 'the page title follows the active tab: ' + doc.title);
    assert.strictEqual(b.tabs().length, 2);
  } finally { await app.close(); }
}
// ---- F. TASK 605, Pen Plotter: the Toolpath stage's selection is the tab's (a toolpath id like "toolpath3" exists in two designs) ---------------------------------
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'penplotter', 'Postcard');
  const pp = await open({ host: 'penplotter', profile });
  try {
    const st = pp.plotter;
    st.selectedToolpathIds = new Set(['toolpath1']); st.targetEditingToolpathId = 'toolpath1'; st.selectedPenId = 'pen1'; st.selectedShapeIds = new Set(['s1']);
    await pp.buffer.newTab();
    assert.deepStrictEqual([...st.selectedToolpathIds], [], 'a new tab selects no toolpath');
    assert.strictEqual(st.targetEditingToolpathId, null, 'and edits no toolpath targets');
    assert.strictEqual(st.selectedPenId, null, 'and has no pen folder selected');
    assert.deepStrictEqual([...st.selectedShapeIds], [], 'and no shape');
    st.selectedToolpathIds = new Set(['toolpath2']);
    await pp.buffer.activate(pp.buffer.tabs()[0].key);
    assert.deepStrictEqual([...st.selectedToolpathIds], ['toolpath1'], "the first tab's selected toolpath is back");
    assert.strictEqual(st.targetEditingToolpathId, 'toolpath1'); assert.strictEqual(st.selectedPenId, 'pen1');
    assert.deepStrictEqual([...st.selectedShapeIds], ['s1']);
    await pp.buffer.activate(pp.buffer.tabs()[1].key);
    assert.deepStrictEqual([...st.selectedToolpathIds], ['toolpath2'], "the second tab's own selection is back");
    // the stage stays where it is (it is the app's, not the document's)
    pp.router.showStage('toolpath');
    await pp.buffer.activate(pp.buffer.tabs()[0].key);
    assert.strictEqual(pp.router.currentStageId(), 'toolpath', 'a tab switch from Toolpath stays in Toolpath');
  } finally { await pp.close(); }
}

// ---- G. TASK 605, Shaper: Explore's SVG, Prepare's selection + view come back with their tab ---------------------------------------------------------------
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Sign');
  const sh = await open({ host: 'shaper', profile });
  try {
    const { store: exploreStore } = await import('../apps/shaper/src/store.js');
    const explored = sh.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    exploreStore.doc = explored; exploreStore.selected = null;
    // a closed rectangle: Prepare has one loop to select
    lineAt(sh, 0.3, 0.3, 0.6, 0.3); lineAt(sh, 0.6, 0.3, 0.6, 0.6); lineAt(sh, 0.6, 0.6, 0.3, 0.6); lineAt(sh, 0.3, 0.6, 0.3, 0.3);
    sh.modes.showMode('prepare'); sh.frames(2);
    const view = sh.prepare.view();
    assert(view && view.loops.length >= 1, 'Prepare found the rectangle loop');
    view.setSelection([{ kind: 'loop', id: view.loops[0].id }]);
    view.setView({ x: 12, y: 34, w: 56, h: 78 });
    const picked = view.selectedTargets().map((t) => t.id);
    await sh.buffer.newTab();
    assert.strictEqual(exploreStore.doc, null, 'a new tab has no Explore SVG');
    assert.strictEqual(sh.modes.current(), 'prepare', 'a tab switch from Prepare stays in Prepare');
    assert.deepStrictEqual(sh.prepare.view().selectedTargets(), [], 'a new tab selects nothing in Prepare');
    await sh.buffer.activate(sh.buffer.tabs()[0].key); sh.frames(2);
    assert.strictEqual(sh.modes.current(), 'prepare', 'and back: still Prepare');
    assert.strictEqual(exploreStore.doc, explored, "Explore's SVG is back");
    assert.deepStrictEqual(sh.prepare.view().selectedTargets().map((t) => t.id), picked, "the tab's Prepare selection is back");
    const back = sh.prepare.view().view; // (the view's height follows the canvas's aspect: updateViewBox)
    assert.deepStrictEqual([back.x, back.y, back.w], [12, 34, 56], 'and its Prepare view');
    // left from Design (Prepare not showing): the selection waits for the view's next mount
    sh.modes.showMode('design');
    await sh.buffer.newTab(); await sh.buffer.activate(sh.buffer.tabs()[0].key);
    sh.modes.showMode('prepare'); sh.frames(2);
    assert.deepStrictEqual(sh.prepare.view().selectedTargets().map((t) => t.id), picked, 'switching in Design, the Prepare selection is back when Prepare is entered');
  } finally { await sh.close(); }
}

// ---- H. TASK 605, every host: the 11th tab and the close question go through the one buffer -------------------------------------------------------------------
for (const host of ['shaper', 'penplotter']) {
  const profile = await createProfile();
  await createNamedDesign(profile, host, 'First');
  const app = await open({ host, profile });
  try {
    const b = app.buffer;
    for (let i = b.tabs().length; i < 10; i++) await b.newTab();
    assert.strictEqual(b.tabs().length, 10, host + ': ten tabs');
    await assert.rejects(() => b.newTab(), /Close a tab first/, host + ': the 11th tab is refused');
    assert.strictEqual(b.tabs().length, 10);
    // the active tab is an empty Untitled: closing asks nothing; with content it asks THE question
    assert.strictEqual(b.tabs().at(-1).needsSavePrompt, null, host + ': an empty Untitled closes without a question');
    lineAt(app, 0.3, 0.3, 0.6, 0.3);
    assert.strictEqual(b.tabs().at(-1).needsSavePrompt, 'unsaved', host + ': an Untitled with content asks the unsaved question');
  } finally { await app.close(); }
}

// ---- I. TASK 605, Trace: the photo session (the page has no node kit: the session is pure over its parts) -------------------------------------------------
{
  const { createTraceSession } = await import('../apps/trace/src/trace-session.js');
  const log = [];
  const state = { imageCanvas: null, imageW: 0, imageH: 0, imageName: 'trace', svgString: null, params: { threshold: 128 } };
  let maskOf = null, scaleOf = { mode: 'global', unit: 'mm', globalWidth: '' };
  const preview = { getMask: () => maskOf, setMask: (m) => { maskOf = m; }, clear: () => log.push('clear'), setImage: (c) => log.push('image:' + c.name), setSVG: (v) => log.push('svg:' + v), updateThresholdOverlay: () => {} };
  const scale = { getState: () => ({ ...scaleOf }), setState: (v) => { scaleOf = v ? { ...v } : { mode: 'global', unit: 'mm', globalWidth: '' }; }, setImageSize: () => {} };
  const ui = { cancelTrace: () => log.push('cancel'), showPhotoUi: (has) => log.push('ui:' + has), fallbackName: () => 'fromSidecar', onNoPhoto: () => log.push('nophoto') };
  const session = createTraceSession({ state, preview, scale, ui });
  const photo = { name: 'canvasA' };
  Object.assign(state, { imageCanvas: photo, imageW: 40, imageH: 30, imageName: 'A', svgString: '<svg A/>' }); maskOf = { name: 'maskA' }; scaleOf = { mode: 'global', unit: 'in', globalWidth: '8' };
  const a = session.capture();
  session.restore(undefined); // a new tab
  assert.strictEqual(state.imageCanvas, null, 'a new tab has no photo'); assert.strictEqual(state.svgString, null);
  assert.strictEqual(state.imageName, 'fromSidecar'); assert.strictEqual(scaleOf.globalWidth, '', 'and the scale is back to its first-run state');
  assert(log.includes('clear') && log.includes('nophoto'), 'the preview is cleared and the page is told: ' + log);
  session.restore(a);
  assert.strictEqual(state.imageCanvas, photo, "tab A's photo is back"); assert.strictEqual(state.svgString, '<svg A/>'); assert.strictEqual(state.imageName, 'A');
  assert.deepStrictEqual(maskOf, { name: 'maskA' }, 'its mask'); assert.deepStrictEqual(scaleOf, { mode: 'global', unit: 'in', globalWidth: '8' }, 'its scale');
  assert(log.includes('svg:<svg A/>'), 'its traced SVG is shown again (not re-traced)');
}
console.log('document-tabs-ui-node: ok');
process.exit(0);
