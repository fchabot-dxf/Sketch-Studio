// tests/document-tabs-ui-node.test.js — TASK 587 (docs/DOCUMENT-TABS-DESIGN.md slices 2, 3, 4), through the node kit (tests/helpers/node-app.js):
//   A. SketchStudio: two designs as tabs, each keeps its drawing, undo history and VIEW (a switch refits nothing); Ctrl+Z acts on the active tab only.
//   B. Pen Plotter: its Toolpath / Export undo stacks (history.js) ride the tab (the `session` hook), a new tab starts empty.
//   C. Shaper: the cut plan of each tab stays apart through a switch (it rides the sidecar, no session needed).
//   D. The strip (document-tabs.js) over the declared project actions: click, +, close x with THE unsaved question, keyboard, the 11th tab (T7),
//      the same design twice, a renamed / deleted design, the sidebar placing it above the header, the name following the active tab.
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
    assert.strictEqual(strip.el.hidden, true, 'the strip stays hidden until the buffer has restored (no Untitled flash)');
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

// ---- E. mountProjectSidebar({ documentTabs: true }): the strip is its own row above the header; the name follows the active tab --------------------
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
    assert.strictEqual(strip.nextElementSibling, header, 'it is the row immediately above the header');
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
console.log('document-tabs-ui-node: ok');
process.exit(0);
