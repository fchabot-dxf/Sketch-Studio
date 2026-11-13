// tests/helpers/node-app.js — TASK 569: THE node test kit. Opens an app's Design canvas in Node (no browser) and drives it through the
// SAME code the page runs: the app's own pointer / key listeners (packages/ui/input-manager.js, reached by dispatching events on the canvas
// / the focused element they were added to), the ribbon's buttons (a click on #tool-<name> runs the host's own tool activation), the host's
// render loop and the shared autosave buffer (packages/ui/document-buffer.js) on the shared project store (packages/ui/project-store.js)
// with its in-memory adapter instead of IndexedDB. The DOM is happy-dom (devDependency, exact version in package.json). Each host's Design
// canvas setup is READ from the host's own declaration module (HOSTS below), the one its page script reads too: nothing is copied here.
//
// The page: a happy-dom Window loaded with the host's real index.html (its scripts are not run: the kit mounts the canvas, as below).
// KIT_OVERRIDES (what happy-dom lacks and the app needs; the ONLY places this differs from a browser page):
//   1. layout: happy-dom has none, so the canvas reports the size it has in the real page at 1600 x 900 (measured with
//      tests/helpers/cdp-browser.js, task 569); every other element is 0 x 0.
//   2. requestAnimationFrame: a queue the kit steps; the host's loop runs once after every dispatched event (`framesPerEvent`), not on a
//      16 ms clock. Events follow each other with no pause (the browser tests sleep 40 - 200 ms between them).
//   3. ResizeObserver: happy-dom's never reports; a browser reports each observed element once when observed (layout never changes here).
//   4. fetch stays Node's: the glyph sheet's relative URL fails at once (the renderer draws without the sheet) instead of going to a network.
//   5. hit testing (task 576): happy-dom has no layout, so a pointer event goes to the canvas, where the app's own hit-testing (snap, glyphs)
//      reads it. The app also reads WHICH ELEMENT a browser's hit test found (e.target.closest('.dim-label')): a test names that element in
//      the `target` option (an element, or a function returning it: the renderer replaces them), as the browser's hit test would find it.
//   6. focus (task 576): a browser cannot focus an <svg> element that has no tabindex (the app calls svg.focus() on every pointerdown and must
//      not take the focus from the value box it just opened); happy-dom can. SVGElement.focus is made to follow the browser's rule.
//   7. clipboard (task 580): happy-dom's navigator.clipboard is not a text clipboard. The page gets the browser tests' one: the system clipboard
//      with the permission granted (CDP grantPermissions), as a text the profile keeps across page loads: `app.clipboard.text` reads / sets it.
//      The app's own seam (packages/ui/clipboard.js defaultIo) reads navigator.clipboard.writeText / readText, so the app runs unchanged.
// KIT API ADDED in task 580 (not overrides; each is what a browser test did through CDP, shared by the files that need it):
//   8. hidden focus (task 580): a browser takes the focus off an element that stops being rendered; see dropFocusIfHidden below (key() and type()).
//   focus (task 580, in the pointer helper): a press on anything but the focused text field blurs the field first, as a browser's mousedown does.
//   type(text): types into the focused text field as a user does (per character: keydown on the field, the value grows, an input event, keyup).
//   pause(ms): a real pause, for the one thing the app measures in time: two clicks on the same label within 500 ms are a double click.
//   press(el): a mouse click on a DOM element (the value box's autocomplete row): pointer + mouse events, and the focus stays where the page's mousedown leaves it.
//   wheel(x, y, deltaY): a WheelEvent on the canvas (the page's own wheel zoom).
//   report(): the Diagnostic Log's own report object (packages/ui/diagnostic-log.js buildReport, what its Copy Report button puts on the clipboard),
//     the page's state as appId = the host. The module is imported right after the page exists, so its key / pointer capture listens on THIS
//     page's document (a module loads once per process: it listens on the first page a process opens).
//   createNamedDesign(profile, app, name, document?): also stores a given document (the owner's file) as the current design.
// The host page script itself (main.js / sketch-stage.js) is not run: its page-only hooks (panels, Prepare, Review, the Freehand ribbon
// button, the header) are absent; open() calls the declared pieces in the page script's order.

import { Window } from 'happy-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { worldToScreen } from '#ui/coords.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SVG_NS = 'http://www.w3.org/2000/svg';

// ------------------------------------------------------------------------------------------------ KIT_OVERRIDES
// 1. layout: the canvas rect in the real page at 1600 x 900 (getBoundingClientRect, measured)
const MEASURED_CANVAS_RECT = {
  sketchstudio: { left: 17, top: 143, width: 1314, height: 701 },
  shaper: { left: 0, top: 124, width: 1356, height: 776 },
  penplotter: { left: 0, top: 124, width: 1356, height: 776 },
};
function giveLayout(el, r) { el.getBoundingClientRect = () => ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height }); }
// 2. the animation-frame queue the kit steps
let rafQueue = new Map(); let rafNext = 1;
const requestFrame = (fn) => { const id = rafNext++; rafQueue.set(id, fn); return id; };
const cancelFrame = (id) => { rafQueue.delete(id); };
function runFrames(n) { for (let i = 0; i < n; i++) { const q = rafQueue; rafQueue = new Map(); for (const fn of q.values()) fn(performance.now()); } }
// 3. ResizeObserver: the first observation only
class FirstObservationResizeObserver { constructor(cb) { this.cb = cb; } observe(el) { queueMicrotask(() => this.cb([{ target: el, contentRect: el.getBoundingClientRect() }], this)); } unobserve() {} disconnect() {} }

// The globals the app modules read, taken from the page's happy-dom Window. Node's own timers come back when the page closes.
const PAGE_GLOBALS = ['window', 'self', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'getComputedStyle', 'matchMedia',
  'Node', 'Element', 'HTMLElement', 'SVGElement', 'HTMLInputElement', 'DocumentFragment', 'Text', 'DOMParser', 'XMLSerializer', 'MutationObserver',
  'Event', 'CustomEvent', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'FocusEvent', 'WheelEvent', 'InputEvent'];
const TIMER_GLOBALS = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
const nodeTimers = Object.fromEntries(TIMER_GLOBALS.map((k) => [k, globalThis[k]]));
const setGlobal = (k, v) => Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true });

function installPage(host, { width, height, storage, clipboard }) {
  const win = new Window({ url: `http://127.0.0.1/apps/${host}/index.html`, width, height, settings: {
    disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true,
    disableIframePageLoading: true } });
  win.document.write(fs.readFileSync(path.join(REPO_ROOT, 'apps', host, 'index.html'), 'utf8'));
  for (const [k, v] of storage) win.localStorage.setItem(k, v);
  for (const k of PAGE_GLOBALS) {
    const v = win[k];
    setGlobal(k, k === 'window' || k === 'self' ? win : (typeof v === 'function' && /^[a-z]/.test(k) ? v.bind(win) : v));
  }
  for (const k of TIMER_GLOBALS) setGlobal(k, win[k].bind(win)); // page timers: cancelled with the page (a 10 s toast must not keep Node running)
  const svgFocus = win.SVGElement.prototype.focus; // override 6
  win.SVGElement.prototype.focus = function (o) { if (this.hasAttribute('tabindex')) svgFocus.call(this, o); };
  win.requestAnimationFrame = requestFrame; win.cancelAnimationFrame = cancelFrame; setGlobal('requestAnimationFrame', requestFrame); setGlobal('cancelAnimationFrame', cancelFrame);
  win.ResizeObserver = FirstObservationResizeObserver; setGlobal('ResizeObserver', FirstObservationResizeObserver);
  // override 7: the system clipboard of the profile, a text, permission granted
  Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { clipboard.text = String(t); }, readText: async () => clipboard.text } });
  rafQueue = new Map();
  return win;
}
// shared modules touch document / localStorage while they load (input-manager.js applyVisualSettings, settings-manager.js): a page exists
// from the start. open() replaces it.
let bootPage = installPage('sketchstudio', { width: 1600, height: 900, storage: new Map(), clipboard: { text: '' } });

// ------------------------------------------------------------------------------------------------ profiles
// The PROFILE = what a browser profile keeps across page loads: localStorage and the project store's records (IndexedDB in the page).
// A test makes one profile and opens apps on it one after another (a reload / a switch to another app = close + open on the same profile).
let profileCount = 0;
export async function createProfile() {
  const { createProjectStore, createMemoryAdapter } = await import('#ui/project-store.js');
  return { storage: new Map(), clipboard: { text: '' }, adapter: createMemoryAdapter(), createProjectStore, channelName: 'sketch-studio-projects#' + (++profileCount) };
}

// TASK 558 save rule: a fresh page shows an UNSAVED Untitled and stores nothing until its first named save. A test that reads the autosaved
// design or carries a drawing across apps / reloads first gives the profile a NAMED current design, as tests/helpers/named-design.js
// CREATE_NAMED_DESIGN does in a page (the same steps, on the profile's store): a new named design holding exactly what a fresh page's first
// named save stores (its fixed origin joint, in Sketch 1), made current. The next open() restores it and autosaves into it.
export async function createNamedDesign(profile, app, name = 'Test design', document = null) {
  const { emptyDocument } = await import('#ui/project-store.js');
  const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null });
  const d = await store.newDesign(name, { app });
  const doc = document || emptyDocument(); if (!document) doc.geometry.joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]];
  await store.save(doc, { app, id: d.id });
  return d.id;
}

// ------------------------------------------------------------------------------------------------ the hosts
// Each host's Design canvas, as its page script sets it up, from the host's declaration module (the page imports the same module).
const HOSTS = {
  // apps/sketchstudio/main.js: initStudioCanvas, setupUI's ribbon, the buffer, setupInput(svg, state), the loop = studioFrame
  async sketchstudio({ win, store }) {
    const [{ createEngine }, { DEFAULT_VIEW }, { createSketchState }, { setupInput }, { setupUI }, { createDocumentBuffer }, D] = await Promise.all([
      import('#core/constraint-solver.js'), import('#core/constants.js'), import('#ui/sketch-state.js'), import('#ui/input-manager.js'),
      import('../../apps/sketchstudio/ui/ui-manager.js'), import('#ui/document-buffer.js'), import('../../apps/sketchstudio/design-canvas.js')]);
    const doc = win.document;
    const svg = doc.getElementById(D.CANVAS_ID); giveLayout(svg, MEASURED_CANVAS_RECT.sketchstudio);
    const worldGroup = doc.getElementById('world-group');
    const engine = createEngine({});
    const state = createSketchState(engine, { ...DEFAULT_VIEW });
    D.initStudioCanvas(state, engine, svg);
    const ui = setupUI(state);
    const ribbon = (ui && ui.ribbon) || null;
    const statusEl = doc.createElement('span'); doc.body.appendChild(statusEl); // main.js puts it in the app header
    const buffer = createDocumentBuffer({ ...D.studioBufferOptions({ state, engine, svg, statusEl }), store, doc, win });
    const restored = buffer.restore(); buffer.start(); // main.js does not wait for the restore: setupInput runs while it is still reading the store
    setupInput(svg, state); // (its 50 px per unit initial zoom applies to the view BEFORE the restore frames the drawing, as on the page)
    await restored;
    const frame = () => { D.studioFrame({ engine, state, svg, worldGroup, ribbon }); runFrames(1); }; // the page's loop is its own rAF tick; the app's other rAF callbacks (the value box takes focus in one) run in the same step (override 2, task 580)
    return { svg, state, engine, ribbon, buffer, statusEl, frame };
  },
  // apps/shaper/src/main.js ensureSketch + buildDesignUI: mountSketch(#design-canvas, DESIGN_CANVAS_OPTIONS), the ribbon, the buffer
  async shaper({ win, store }) {
    const [{ mountSketch }, { createToolRibbon }, { createDocumentBuffer }, D] = await Promise.all([
      import('#ui/sketch-canvas.js'), import('#ui/tool-ribbon.js'), import('#ui/document-buffer.js'), import('../../apps/shaper/src/design-canvas.js')]);
    const doc = win.document;
    const svg = doc.getElementById(D.DESIGN_CANVAS_ID); giveLayout(svg, MEASURED_CANVAS_RECT.shaper);
    const controller = mountSketch(svg, { ...D.DESIGN_CANVAS_OPTIONS });
    const ribbon = createToolRibbon({ state: controller.state, ...D.RIBBON_OPTIONS });
    ribbon.render(doc.getElementById('design-ribbon'));
    const statusEl = doc.getElementById('save-status');
    const buffer = createDocumentBuffer({ ...D.shaperBufferOptions({ controller, canvas: svg, statusEl }), store, doc, win });
    await buffer.restore(); buffer.start();
    controller.start();
    return { svg, state: controller.state, engine: controller.engine, ribbon, buffer, statusEl, frame: () => runFrames(1) };
  },
  // apps/penplotter/src/sketch-stage.js mountSketchStage: mountSketch(the stage's svg, DESIGN_CANVAS_OPTIONS), the buffer, the ribbon. The
  // stage's svg comes from the stage's own template (not in index.html): here a plain <svg> in the page.
  async penplotter({ win, store }) {
    const [{ mountSketch }, { createToolRibbon }, { createDocumentBuffer }, D, plotterDoc] = await Promise.all([
      import('#ui/sketch-canvas.js'), import('#ui/tool-ribbon.js'), import('#ui/document-buffer.js'), import('../../apps/penplotter/src/design-canvas.js'),
      import('../../apps/penplotter/src/plotter-doc.js')]);
    // a page load starts the plotter's module state fresh; in one Node process the module (apps/penplotter/src/state.js) lives on, so the
    // previous "page"'s pens and toolpaths are cleared here or a restore could pass without restoring anything
    plotterDoc.resetPlotterDoc();
    const doc = win.document;
    const svg = doc.createElementNS(SVG_NS, 'svg'); doc.body.appendChild(svg); giveLayout(svg, MEASURED_CANVAS_RECT.penplotter);
    const controller = mountSketch(svg, { ...D.DESIGN_CANVAS_OPTIONS });
    const statusEl = doc.getElementById('save-status');
    const buffer = createDocumentBuffer({ ...D.plotterBufferOptions({ controller, canvas: svg, statusEl }), store, doc, win });
    await buffer.restore(); buffer.start();
    const ribbonEl = doc.createElement('div'); doc.body.appendChild(ribbonEl);
    const ribbon = createToolRibbon({ state: controller.state });
    ribbon.render(ribbonEl);
    controller.start();
    return { svg, state: controller.state, engine: controller.engine, ribbon, buffer, statusEl, plotterDoc, frame: () => runFrames(1) };
  },
};

let current = null; // one app at a time: the engine's store is module-level (packages/core/constraint-solver.js)

/**
 * open({ host, profile, framesPerEvent }) -> app. Loads the host's page, mounts its Design canvas, restores the profile's current design
 * through the real buffer (the page's initial restore) and starts the autosave. Close it (app.close()) before opening the next.
 */
export async function open({ host = 'sketchstudio', profile, framesPerEvent = 1, width = 1600, height = 900 } = {}) {
  if (!HOSTS[host]) throw new Error('node-app: unknown host ' + host);
  if (current) throw new Error('node-app: close the open app first (one engine store per process)');
  profile = profile || await createProfile();
  if (bootPage) { await bootPage.happyDOM.close(); bootPage = null; }
  const win = installPage(host, { width, height, storage: profile.storage, clipboard: profile.clipboard });
  const { buildReport } = await import('#ui/diagnostic-log.js'); // task 580: its capture listens on this page's document (first page of the process)
  const doc = win.document;
  // the store's cross-tab channel is a real BroadcastChannel (as in the page), named per profile and closed with the app
  const channel = new BroadcastChannel(profile.channelName);
  const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel });
  const m = await HOSTS[host]({ win, store });
  const { svg, state, buffer } = m;
  m.frame();

  const frames = (n = framesPerEvent) => { for (let i = 0; i < n; i++) m.frame(); };
  const pointer = (type, x, y, o = {}) => {
    const e = new win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: o.pointerId ?? 1, pointerType: o.pointerType || 'mouse', isPrimary: true,
      button: o.button ?? (type === 'pointermove' ? -1 : 0), buttons: o.buttons ?? (type === 'pointerup' ? 0 : 1), shiftKey: !!o.shift, ctrlKey: !!o.ctrl });
    const t = typeof o.target === 'function' ? o.target() : o.target; // override 5: the element a browser's hit test would find
    // a press on anything that is not the focused text field takes the focus off it (the browser's mousedown default action; none in happy-dom)
    if (type === 'pointerdown' && doc.activeElement && /^(INPUT|TEXTAREA)$/.test(doc.activeElement.tagName) && doc.activeElement !== (t || svg)) doc.activeElement.blur();
    (t || svg).dispatchEvent(e); frames();
    return e;
  };
  // keys go where the browser sends them: the focused element (the body when nothing is focused), bubbling to document + window
  // override 8 (task 580): a browser takes the focus off an element that stops being rendered (the value box hides itself after Enter). happy-dom has no
  // layout and loads no stylesheet, so "not rendered" is the [hidden] attribute, the `hidden` class the apps' CSS maps to display:none, or style display none.
  const dropFocusIfHidden = () => {
    const a = doc.activeElement;
    for (let e = a; e && e !== doc.body; e = e.parentElement) if (e.hidden || (e.classList && e.classList.contains('hidden')) || (e.style && e.style.display === 'none')) { a.blur(); return; }
  };
  const key = (k, o = {}) => {
    for (const type of ['keydown', 'keyup']) {
      dropFocusIfHidden();
      const target = doc.activeElement || doc.body;
      target.dispatchEvent(new win.KeyboardEvent(type, { bubbles: true, cancelable: true, key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, metaKey: !!o.meta }));
      frames();
    }
  };

  const app = {
    host, state, engine: m.engine, svg, document: doc, clipboard: profile.clipboard, window: win, buffer, store, profile, ribbon: m.ribbon, plotterDoc: m.plotterDoc,
    frames,
    /** world -> screen through the app's own transform (#ui/coords.js worldToScreen, the svg's live viewBox) */
    toScreen: (wx, wy) => { const p = worldToScreen(svg, { x: wx, y: wy }); return { x: Math.round(p.x), y: Math.round(p.y) }; },
    move: (x, y, o) => pointer('pointermove', x, y, { buttons: 0, ...o }),
    down: (x, y, o) => pointer('pointerdown', x, y, o),
    up: (x, y, o) => pointer('pointerup', x, y, o),
    click(x, y, o) { this.move(x, y, o); this.down(x, y, o); this.up(x, y, o); },
    /** two clicks on the same spot (the app pairs them by their time, so there is no pause between them) */
    dblclick(x, y, o) { this.move(x, y, o); this.down(x, y, o); this.up(x, y, o); this.down(x, y, o); this.up(x, y, o); },
    /** the right button: press, release, then the `contextmenu` event on the target (the Windows order), which opens the shared menu */
    rightClick(x, y, o = {}) {
      this.move(x, y, o); this.down(x, y, { ...o, button: 2, buttons: 2 }); this.up(x, y, { ...o, button: 2 });
      const t = typeof o.target === 'function' ? o.target() : o.target;
      (t || svg).dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 0 })); frames();
    },
    drag(a, b, steps = 8, o) { this.move(a.x, a.y, o); this.down(a.x, a.y, o); for (let i = 1; i <= steps; i++) pointer('pointermove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, { buttons: 1, ...o }); this.up(b.x, b.y, o); },
    key,
    type(text) {
      dropFocusIfHidden();
      const t = doc.activeElement;
      if (!t || !/^(INPUT|TEXTAREA)$/.test(t.tagName)) throw new Error('node-app: type() needs a focused text field');
      for (const ch of text) {
        const back = ch === '\b'; // '\b' (a backspace character) is the Backspace key
        const k = back ? 'Backspace' : ch;
        const down = new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: k, code: back ? 'Backspace' : /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : ch });
        t.dispatchEvent(down);
        if (!down.defaultPrevented) { // the default action of the key: the text changes
          const at = t.selectionStart ?? t.value.length, end = t.selectionEnd ?? at;
          const from = back && at === end ? Math.max(0, at - 1) : at;
          t.value = t.value.slice(0, from) + (back ? '' : ch) + t.value.slice(end); t.setSelectionRange(from + (back ? 0 : 1), from + (back ? 0 : 1));
          t.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: back ? null : ch, inputType: back ? 'deleteContentBackward' : 'insertText' }));
        }
        t.dispatchEvent(new win.KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: k }));
        frames();
      }
    },
    /** a mouse click on a DOM element (not the canvas): pointerdown, mousedown, pointerup, mouseup, click, as the browser sends them (the focus rule as for the canvas) */
    press(el) {
      const mk = (C, type) => new C(type, { bubbles: true, cancelable: true, button: 0, buttons: type.endsWith('down') ? 1 : 0, isPrimary: true, pointerId: 1, pointerType: 'mouse' });
      el.dispatchEvent(mk(win.PointerEvent, 'pointerdown'));
      const md = mk(win.MouseEvent, 'mousedown'); el.dispatchEvent(md);
      if (!md.defaultPrevented && doc.activeElement && doc.activeElement !== el && /^(INPUT|TEXTAREA)$/.test(doc.activeElement.tagName)) doc.activeElement.blur();
      el.dispatchEvent(mk(win.PointerEvent, 'pointerup')); el.dispatchEvent(mk(win.MouseEvent, 'mouseup')); el.dispatchEvent(mk(win.MouseEvent, 'click')); frames();
    },
    wheel(x, y, deltaY, o = {}) { svg.dispatchEvent(new win.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY, ctrlKey: !!o.ctrl })); frames(); },
    report: () => buildReport({ appId: host, getState: () => state }),
    esc: () => key('Escape'), enter: () => key('Enter'), undo: () => key('z', { ctrl: true }), redo: () => key('y', { ctrl: true }),
    /** a click on the tool's ribbon button (#tool-<name>): the host's own tool activation */
    tool(name) { const b = doc.getElementById('tool-' + name); if (!b) throw new Error('node-app: no ribbon button #tool-' + name + ' in ' + host); b.click(); frames(); },
    /** the autosave writes now (the page-hide path, as cdp-browser.js flushAutosave does); returns the stored current design's document */
    async storedDoc() { win.dispatchEvent(new win.Event('pagehide')); await buffer.flush(); const d = await store.loadCurrent({ app: host }); return d ? d.document : null; },
    saveStatus: () => m.statusEl.textContent,
    /** a real pause (the app pairs clicks into a double click by their time: 500 ms; the kit sends events with no pause, a person does not) */
    async pause(ms) { await new Promise((r) => nodeTimers.setTimeout(r, ms)); frames(1); },
    /** polls cond() (timers and the app's setTimeout(0) work run in between), like cdp-browser.js waitFor; throws after timeoutMs */
    async waitFor(cond, what, timeoutMs = 2000) {
      const end = Date.now() + timeoutMs;
      for (;;) { if (await cond()) return; if (Date.now() > end) throw new Error('node-app: timed out waiting for ' + what); await new Promise((r) => nodeTimers.setTimeout(r, 5)); frames(1); }
    },
    async close() {
      buffer.stop(); channel.close(); rafQueue = new Map();
      profile.storage = new Map(); // what the page kept in localStorage stays in the profile
      for (let i = 0; i < win.localStorage.length; i++) { const k = win.localStorage.key(i); profile.storage.set(k, win.localStorage.getItem(k)); }
      await win.happyDOM.close();
      for (const k of TIMER_GLOBALS) setGlobal(k, nodeTimers[k]);
      current = null;
    },
  };
  current = app;
  return app;
}
