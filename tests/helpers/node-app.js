// tests/helpers/node-app.js — TASK 569: THE node test kit. Opens an app's Design canvas in Node (no browser) and drives it through the
// SAME code the page runs: the app's own pointer / key listeners (packages/ui/input-manager.js setupEventListeners and
// setupKeyboardShortcuts, reached by dispatching events on the canvas / document they were added to), the shared tool ribbon's
// buttons (a click on #tool-<name> runs the host's own activation), the host's render loop (solve, then the shared renderer draws:
// it also places the constraint glyphs that clicks hit-test against) and the shared autosave buffer (packages/ui/document-buffer.js)
// on the shared project store (packages/ui/project-store.js) with its in-memory adapter instead of IndexedDB.
//
// What is NOT the browser (one list, so a reviewer sees every difference):
//   - a minimal DOM stand-in below (elements, attributes, a small selector matcher, capture / bubble event dispatch). No layout:
//     getBoundingClientRect is the size the host's canvas has in the real page at 1600 x 900 (measured once, see HOSTS), every other
//     element is 0 x 0. innerHTML is kept as a string and not parsed (the renderer writes the canvas this way; tests read state).
//   - the animation frame: the host's loop runs once after every dispatched event (`framesPerEvent`), not on a 16 ms clock.
//   - time: events follow each other with no pause (the browser tests sleep 40 - 200 ms between them).
//   - the host page wiring (apps/<host>/... main.js / sketch-stage.js are page scripts, not importable): each host's Design canvas is
//     composed here from the SAME shared modules with the options the host passes (HOSTS below names the line it mirrors).
// A test that needs layout, pixels, CSS, focus rules of a real browser, a file chooser, the clipboard or a real reload stays live.

import { worldToScreen } from '#ui/coords.js';

// ------------------------------------------------------------------------------------------------ the DOM stand-in
const SVG_NS = 'http://www.w3.org/2000/svg';

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type; this.bubbles = !!init.bubbles; this.cancelable = init.cancelable !== false; this.defaultPrevented = false;
    this.target = null; this.currentTarget = null; this.eventPhase = 0; this.timeStamp = Date.now(); this.isTrusted = true;
    this._stop = false; this._stopNow = false;
    for (const [k, v] of Object.entries(init)) if (!(k in this) || k === 'target') this[k] = v;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
  composedPath() { return this._path || []; }
}

// One listener table per node; dispatch walks window -> document -> ancestors (capture), the target, then back up (bubble).
class FakeNode {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this._listeners = new Map(); }
  addEventListener(type, fn, opts) {
    if (!fn) return;
    const capture = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
    const once = !!(opts && typeof opts === 'object' && opts.once);
    const list = this._listeners.get(type) || [];
    if (!list.some((l) => l.fn === fn && l.capture === capture)) list.push({ fn, capture, once });
    this._listeners.set(type, list);
  }
  removeEventListener(type, fn, opts) {
    const capture = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
    const list = this._listeners.get(type); if (!list) return;
    const i = list.findIndex((l) => l.fn === fn && l.capture === capture); if (i >= 0) list.splice(i, 1);
  }
  listenerCount(type) { return (this._listeners.get(type) || []).length; }
  _parentForEvents() { return this.parentNode; }
  dispatchEvent(e) {
    // native Event / CustomEvent objects made by app code (pagehide, panzoom:viewportChanged): give them the fields dispatch needs
    if (!(e instanceof FakeEvent)) adoptNativeEvent(e);
    const path = []; for (let n = this._parentForEvents(); n; n = n._parentForEvents()) path.push(n);
    e.target = this; e._path = [this, ...path];
    const run = (node, phase) => {
      const list = (node._listeners.get(e.type) || []).slice();
      e.currentTarget = node; e.eventPhase = phase;
      for (const l of list) {
        if (phase === 1 && !l.capture) continue;
        if (phase === 3 && l.capture) continue;
        if (l.once) node.removeEventListener(e.type, l.fn, l.capture);
        l.fn.call(node, e);
        if (e._stopNow) return;
      }
    };
    for (let i = path.length - 1; i >= 0 && !e._stop; i--) run(path[i], 1);
    if (!e._stop) run(this, 2);
    if (e.bubbles) for (let i = 0; i < path.length && !e._stop; i++) run(path[i], 3);
    e.currentTarget = null; e.eventPhase = 0;
    return !e.defaultPrevented;
  }
}

function adoptNativeEvent(e) {
  const def = (k, v) => Object.defineProperty(e, k, { value: v, writable: true, configurable: true });
  def('target', null); def('currentTarget', null); def('eventPhase', 0); def('_stop', false); def('_stopNow', false);
  const sp = e.stopPropagation.bind(e), sip = e.stopImmediatePropagation.bind(e);
  def('stopPropagation', () => { e._stop = true; sp(); });
  def('stopImmediatePropagation', () => { e._stop = true; e._stopNow = true; sip(); });
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function makeStyle() {
  const props = {};
  return new Proxy(props, {
    get(t, k) {
      if (k === 'setProperty') return (name, v) => { t[camel(name)] = String(v); };
      if (k === 'getPropertyValue') return (name) => t[camel(name)] || '';
      if (k === 'removeProperty') return (name) => { delete t[camel(name)]; };
      if (k === 'cssText') return Object.entries(t).map(([a, b]) => `${a}:${b}`).join(';');
      return k in t ? t[k] : '';
    },
    set(t, k, v) {
      if (k === 'cssText') { for (const key of Object.keys(t)) delete t[key]; for (const decl of String(v).split(';')) { const i = decl.indexOf(':'); if (i > 0) t[camel(decl.slice(0, i).trim())] = decl.slice(i + 1).trim(); } return true; }
      t[k] = v == null ? '' : String(v); return true;
    },
  });
}

class FakeElement extends FakeNode {
  constructor(doc, tag, ns = null) {
    super(doc);
    this.namespaceURI = ns; this.localName = tag; this.tagName = ns === SVG_NS ? tag : tag.toUpperCase(); this.nodeName = this.tagName; this.nodeType = 1;
    this._attrs = new Map(); this.style = makeStyle(); this.dataset = {}; this._html = ''; this._text = '';
    this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.title = ''; this.type = '';
    this._rect = null;
    const el = this;
    this.classList = {
      _set() { return new Set(String(el.getAttribute('class') || '').split(/\s+/).filter(Boolean)); },
      _put(s) { el.setAttribute('class', [...s].join(' ')); },
      add(...c) { const s = this._set(); c.forEach((x) => s.add(x)); this._put(s); },
      remove(...c) { const s = this._set(); c.forEach((x) => s.delete(x)); this._put(s); },
      contains(c) { return this._set().has(c); },
      toggle(c, force) { const s = this._set(); const on = force === undefined ? !s.has(c) : !!force; if (on) s.add(c); else s.delete(c); this._put(s); return on; },
      replace(a, b) { const s = this._set(); if (!s.delete(a)) return false; s.add(b); this._put(s); return true; },
      item(i) { return [...this._set()][i] ?? null; },
      forEach(fn) { [...this._set()].forEach(fn); },
      [Symbol.iterator]() { return this._set()[Symbol.iterator](); },
      get length() { return this._set().size; },
      get value() { return el.getAttribute('class') || ''; },
    };
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  setAttribute(k, v) { this._attrs.set(k, String(v)); if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); }
  setAttributeNS(_ns, k, v) { this.setAttribute(k, v); }
  getAttribute(k) { if (k.startsWith('data-')) { const d = this.dataset[camel(k.slice(5))]; return d === undefined ? null : String(d); } return this._attrs.has(k) ? this._attrs.get(k) : null; }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) { this._attrs.delete(k); if (k.startsWith('data-')) delete this.dataset[camel(k.slice(5))]; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return p.childNodes[i + 1] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(typeof c === 'string' ? this.ownerDocument.createTextNode(c) : c); }
  prepend(...cs) { for (const c of cs.reverse()) this.insertBefore(typeof c === 'string' ? this.ownerDocument.createTextNode(c) : c, this.firstChild); }
  insertBefore(c, ref) { if (!ref) return this.appendChild(c); if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); return c; }
  removeChild(c) {
    const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1);
    const d = this.ownerDocument; if (d && c.contains && c.contains(d.activeElement)) d.activeElement = d.body; // a removed focused element loses focus
    c.parentNode = null; return c;
  }
  replaceChildren(...cs) { for (const c of [...this.childNodes]) this.removeChild(c); this.append(...cs); }
  replaceWith(n) { const p = this.parentNode; if (p) { p.insertBefore(n, this); p.removeChild(this); } }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  after(n) { const p = this.parentNode; if (p) p.insertBefore(n, this.nextSibling); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { for (const c of [...this.childNodes]) this.removeChild(c); this._html = String(v); }
  insertAdjacentHTML(_where, html) { this._html += String(html); }
  get textContent() { return this._text + this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of [...this.childNodes]) this.removeChild(c); this._html = ''; this._text = v == null ? '' : String(v); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get offsetParent() { return this.isConnected && this.style.display !== 'none' ? this.parentNode : null; }
  get offsetWidth() { return this.getBoundingClientRect().width; }
  get offsetHeight() { return this.getBoundingClientRect().height; }
  get clientWidth() { return this.getBoundingClientRect().width; }
  get clientHeight() { return this.getBoundingClientRect().height; }
  getBoundingClientRect() { const r = this._rect || { left: 0, top: 0, width: 0, height: 0 }; return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height }; }
  getClientRects() { return [this.getBoundingClientRect()]; }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  matches(sel) { return matchesSelector(this, sel); }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matchesSelector(n, sel)) return n; return null; }
  querySelectorAll(sel) { const out = []; walk(this, (n) => { if (n !== this && matchesSelector(n, sel)) out.push(n); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
  getElementsByClassName(c) { return this.querySelectorAll('.' + c); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  select() {}
  click() { this.dispatchEvent(new FakeEvent('click', { bubbles: true, button: 0 })); }
  scrollIntoView() {}
  setPointerCapture() {} releasePointerCapture() {} hasPointerCapture() { return false; }
  getBBox() { return { x: 0, y: 0, width: 0, height: 0 }; }
  getComputedTextLength() { return 0; }
  cloneNode() { const c = new FakeElement(this.ownerDocument, this.localName, this.namespaceURI); for (const [k, v] of this._attrs) c.setAttribute(k, v); c._html = this._html; return c; }
  // <svg viewBox> (read by #ui/coords.js screenToWorld / worldToScreen): the live attribute, parsed
  get viewBox() { const v = String(this.getAttribute('viewBox') || '0 0 0 0').trim().split(/[\s,]+/).map(Number); return { baseVal: { x: v[0], y: v[1], width: v[2], height: v[3] } }; }
}

class FakeText extends FakeNode {
  constructor(doc, text) { super(doc); this.nodeType = 3; this._t = String(text); }
  get textContent() { return this._t; }
  set textContent(v) { this._t = String(v); }
}

function walk(root, fn) { for (const c of root.childNodes) { if (c.nodeType === 1) { fn(c); walk(c, fn); } } }

// selectors: lists (a, b), descendant ( ) and child (>) combinators, compounds of tag, #id, .class, [attr], [attr="v"], [attr^="v"]
function matchesSelector(el, sel) { return String(sel).split(',').some((s) => matchComplex(el, s.trim())); }
function matchComplex(el, sel) {
  const parts = sel.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
  const test = (node, i) => {
    if (!node || node.nodeType !== 1 || !matchCompound(node, parts[i])) return false;
    if (i === 0) return true;
    if (parts[i - 1] === '>') return test(node.parentNode, i - 2);
    for (let p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) if (test(p, i - 1)) return true;
    return false;
  };
  return test(el, parts.length - 1);
}
function matchCompound(el, c) {
  const re = /(^[a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([\^*$]?=)"?([^"\]]*)"?)?\]|:not\(([^)]*)\)/g;
  let m, any = false;
  while ((m = re.exec(c))) {
    any = true;
    if (m[1] && m[1] !== '*' && el.localName.toLowerCase() !== m[1].toLowerCase()) return false;
    if (m[2] && el.id !== m[2]) return false;
    if (m[3] && !el.classList.contains(m[3])) return false;
    if (m[4]) { const v = el.getAttribute(m[4]); if (v === null) return false; if (m[5] === '=' && v !== m[6]) return false; if (m[5] === '^=' && !v.startsWith(m[6])) return false; if (m[5] === '*=' && !v.includes(m[6])) return false; if (m[5] === '$=' && !v.endsWith(m[6])) return false; }
    if (m[7] !== undefined && matchesSelector(el, m[7])) return false;
  }
  return any;
}

class FakeDocument extends FakeNode {
  constructor(win) {
    super(null); this.ownerDocument = this; this.nodeType = 9; this.defaultView = win; this.visibilityState = 'visible'; this.hidden = false; this.readyState = 'complete';
    this.documentElement = this.createElement('html'); this.appendChild(this.documentElement);
    this.head = this.createElement('head'); this.body = this.createElement('body');
    this.documentElement.appendChild(this.head); this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }
  _parentForEvents() { return this.defaultView; }
  appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; }
  createElement(tag) { return new FakeElement(this, String(tag).toLowerCase()); }
  createElementNS(ns, tag) { return new FakeElement(this, tag, ns); }
  createTextNode(t) { return new FakeText(this, t); }
  createDocumentFragment() { return new FakeElement(this, '#fragment'); }
  getElementById(id) { let hit = null; walk(this, (n) => { if (!hit && n.id === id) hit = n; }); return hit; }
  querySelectorAll(sel) { const out = []; walk(this, (n) => { if (matchesSelector(n, sel)) out.push(n); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  elementFromPoint() { return null; }
  execCommand() { return false; }
}

class FakeWindow extends FakeNode {
  constructor({ width, height, storage }) {
    super(null);
    this.innerWidth = width; this.innerHeight = height; this.devicePixelRatio = 1; this.scrollX = 0; this.scrollY = 0;
    this.localStorage = storage; this.sessionStorage = memoryStorage();
    this.location = { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '', pathname: '/', search: '', hash: '' };
    this.document = new FakeDocument(this);
  }
  _parentForEvents() { return null; }
  matchMedia(q) {
    const w = this.innerWidth; let ok = true;
    for (const [, kind, px] of String(q).matchAll(/\((max|min)-width:\s*(\d+)px\)/g)) ok = ok && (kind === 'max' ? w <= +px : w >= +px);
    if (/pointer:\s*coarse|hover:\s*none/.test(q)) ok = false;
    return { matches: ok, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  }
  getComputedStyle(el) { return el && el.style ? el.style : makeStyle(); }
  getSelection() { return { toString: () => '', rangeCount: 0, removeAllRanges() {} }; }
  focus() {} blur() {} scrollTo() {}
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

// The animation-frame queue: the host's loop registers its next frame here; the kit runs it after each event (no 16 ms clock).
let rafQueue = new Map(); let rafNext = 1;
function runFrames(n) {
  for (let i = 0; i < n; i++) { const q = rafQueue; rafQueue = new Map(); for (const fn of q.values()) fn(performance.now()); }
}

// Page timers: a page's setTimeout / setInterval die when the page goes away (a toast's 10 s timer must not keep Node running). Every
// timer made while a page is installed is tracked and cleared by app.close().
const nativeSetTimeout = globalThis.setTimeout, nativeSetInterval = globalThis.setInterval, nativeClearTimeout = globalThis.clearTimeout, nativeClearInterval = globalThis.clearInterval;
let pageTimers = new Set();
globalThis.setTimeout = (fn, ms, ...args) => { const t = nativeSetTimeout(() => { pageTimers.delete(t); fn(...args); }, ms); pageTimers.add(t); return t; };
globalThis.setInterval = (fn, ms, ...args) => { const t = nativeSetInterval(fn, ms, ...args); pageTimers.add(t); return t; };
globalThis.clearTimeout = (t) => { pageTimers.delete(t); nativeClearTimeout(t); };
globalThis.clearInterval = (t) => { pageTimers.delete(t); nativeClearInterval(t); };
function clearPageTimers() { for (const t of pageTimers) { nativeClearTimeout(t); nativeClearInterval(t); } pageTimers = new Set(); }

// The PROFILE = what a browser profile keeps across page loads: localStorage and the project store's records (IndexedDB in the page).
// A test makes one profile and opens apps on it one after another (a reload / a switch to another app = close + open on the same profile).
let profileCount = 0;
export async function createProfile() {
  const { createProjectStore, createMemoryAdapter } = await import('#ui/project-store.js');
  return { storage: memoryStorage(), adapter: createMemoryAdapter(), createProjectStore, channelName: 'sketch-studio-projects#' + (++profileCount) };
}

// TASK 558 save rule: a fresh page shows an UNSAVED Untitled and stores nothing until its first named save. A test that reads the autosaved
// design or carries a drawing across apps / reloads first gives the profile a NAMED current design, as tests/helpers/named-design.js
// CREATE_NAMED_DESIGN does in a page (the same steps, on the profile's store): a new named design holding exactly what a fresh page's first
// named save stores (its fixed origin joint, in Sketch 1), made current. The next open() restores it and autosaves into it.
export async function createNamedDesign(profile, app, name = 'Test design') {
  const { emptyDocument } = await import('#ui/project-store.js');
  const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null });
  const d = await store.newDesign(name, { app });
  const doc = emptyDocument(); doc.geometry.joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]];
  await store.save(doc, { app, id: d.id });
  return d.id;
}

// Installs a fresh page (window + document) as the globals the app modules read. Installed at import time too, because some shared
// modules touch document / localStorage while they load (input-manager.js applyVisualSettings, settings-manager.js).
function installPage({ width = 1600, height = 900, storage = memoryStorage() } = {}) {
  const win = new FakeWindow({ width, height, storage });
  win.requestAnimationFrame = (fn) => { const id = rafNext++; rafQueue.set(id, fn); return id; };
  win.cancelAnimationFrame = (id) => { rafQueue.delete(id); };
  for (const k of ['window', 'self']) globalThis[k] = win;
  globalThis.document = win.document;
  globalThis.localStorage = storage; globalThis.sessionStorage = win.sessionStorage;
  globalThis.requestAnimationFrame = win.requestAnimationFrame; globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
  globalThis.getComputedStyle = (el) => win.getComputedStyle(el);
  globalThis.matchMedia = (q) => win.matchMedia(q);
  // ResizeObserver: no layout ever changes here, so it gives only the browser's FIRST observation (each observed element's size, once)
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe(el) { queueMicrotask(() => this.cb([{ target: el, contentRect: el.getBoundingClientRect() }], this)); } unobserve() {} disconnect() {} };
  globalThis.HTMLElement = FakeElement; globalThis.Element = FakeElement; globalThis.SVGElement = FakeElement; globalThis.Node = FakeNode;
  rafQueue = new Map();
  return win;
}
installPage();

// ------------------------------------------------------------------------------------------------ the hosts
// rect = the host canvas's getBoundingClientRect in the real page at 1600 x 900 (measured with tests/helpers/cdp-browser.js, task 569).
const HOSTS = {
  // apps/sketchstudio/index.html + main.js: the page's own <svg id="svgCanvas"> (+ #world-group, the magnifier, #dimInput), setupUI's
  // ribbon in #toolsRibbon, initApp's view (w 20 centred on 1.5, -1.5), setupInput(svg, state), the loop: solve, draw, ribbon refresh.
  sketchstudio: { canvasId: 'svgCanvas', rect: { left: 17, top: 143, width: 1566, height: 701 } },
  // apps/shaper/src/main.js ensureSketch(): mountSketch(#design-canvas, { seedDemo: false, grid: true, profiles: true }); the shared ribbon.
  shaper: { canvasId: 'design-canvas', rect: { left: 0, top: 124, width: 1356, height: 776 }, mount: { seedDemo: false, grid: true, profiles: true } },
  // apps/penplotter/src/sketch-stage.js mountSketchStage(): mountSketch(#design-canvas, { seedDemo: false }); the sidecar is the
  // plotter document (plotter-doc.js capturePlotterDoc / applyPlotterDoc / resetPlotterDoc), the shared ribbon.
  penplotter: { canvasId: 'design-canvas', rect: { left: 0, top: 124, width: 1356, height: 776 }, mount: { seedDemo: false } },
};

let openApp = null; // one app at a time: the engine's store is module-level (packages/core/constraint-solver.js)

/**
 * openApp({ host, profile, framesPerEvent }) -> app. Mounts the host's Design canvas on a fresh page, restores the profile's current
 * design through the real buffer (the page's initial restore) and starts the autosave. Close it (app.close()) before opening the next.
 */
export async function open({ host = 'sketchstudio', profile, framesPerEvent = 1, width = 1600, height = 900 } = {}) {
  const H = HOSTS[host];
  if (!H) throw new Error('node-app: unknown host ' + host);
  if (openApp) throw new Error('node-app: close the open app first (one engine store per process)');
  profile = profile || await createProfile();
  const win = installPage({ width, height, storage: profile.storage });
  const doc = win.document;
  const el = (tag, id, parent = doc.body, ns = null) => { const e = ns ? doc.createElementNS(ns, tag) : doc.createElement(tag); if (id) e.id = id; parent.appendChild(e); return e; };

  const [{ createEngine }, { createSketchState }, { setupInput, switchToTool }, { draw }, { SolverConfig }, { setConstraintNotifier }, { createDocumentBuffer }, { createToolRibbon }, { fitToDrawing }] = await Promise.all([
    import('#core/constraint-solver.js'), import('#ui/sketch-state.js'), import('#ui/input-manager.js'), import('#ui/svg-renderer.js'),
    import('#core/solver-config.js'), import('#core/constraint-manager.js'), import('#ui/document-buffer.js'), import('#ui/tool-ribbon.js'),
    import('#ui/input-handlers/pan-zoom.js'),
  ]);
  // the store's cross-tab channel is a real BroadcastChannel (as in the page), named per profile and closed with the app
  const channel = new BroadcastChannel(profile.channelName);
  const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel });
  const notices = [];
  const saveStatus = el('span', 'save-status');

  let state, engine, svg, frame, ribbon, buffer, sidecar = {};
  if (host === 'sketchstudio') {
    const [{ applyDefaultState }, { setupUI }, { showNotification }] = await Promise.all([
      import('#core/state.js'), import('../../apps/sketchstudio/ui/ui-manager.js'), import('#ui/notification-manager.js'),
    ]);
    el('div', 'app-header-host'); el('div', 'toolsRibbon');
    svg = el('svg', H.canvasId, doc.body, SVG_NS); svg._rect = { ...H.rect };
    const worldGroup = el('g', 'world-group', svg, SVG_NS);
    const mag = el('g', 'magnifier', svg, SVG_NS); el('g', 'mag-content', mag, SVG_NS);
    const dim = el('input', 'dimInput'); dim.className = 'hidden';
    for (const id of ['btn-construct-toggle', 'btn-recenter-view', 'btn-mag-toggle']) el('button', id);
    el('div', 'status-diag-slot'); el('span', 'viewport-size');
    engine = createEngine({});
    setConstraintNotifier((msg, type) => { notices.push(String(msg)); showNotification(msg, type); });
    state = createSketchState(engine, { x: 0, y: 0, w: 100, h: 100 });
    // initApp(): defaults, the empty store, the view, the viewBox from the canvas size
    applyDefaultState(state); engine.init();
    state.view.w = 20; state.view.x = 1.5; state.view.y = -1.5;
    state.view.h = state.view.w / (H.rect.width / H.rect.height);
    svg.setAttribute('viewBox', `${state.view.x - state.view.w / 2} ${state.view.y - state.view.h / 2} ${state.view.w} ${state.view.h}`);
    const ui = setupUI(state);
    ribbon = (ui && ui.ribbon) || null;
    buffer = createDocumentBuffer({ state, app: 'sketchstudio', canvas: svg, store, doc, win,
      onRestored: () => { engine.solve(500); fitToDrawing(svg, state); },
      onStatusChange: (s) => { saveStatus.textContent = s === 'saving' ? 'Saving…' : s === 'saved' ? 'Saved' : ''; } });
    setupInput(svg, state);
    frame = () => { engine.solve(SolverConfig.ITERATIONS || 500); draw(state.joints, state.shapes, svg, state.active, state.snapTarget, state.constraints, state.selectedJoints, state.selectedConstraints, state.currentTool, state.inference, state.selectedShapes, state.hoveredShape, state.hoveredJoint, state.hoveredConstraint, state.activeSnap, state.tempMousePos, state.drag ? true : false, worldGroup); if (ribbon) ribbon.refresh(); };
  } else {
    const { mountSketch } = await import('#ui/sketch-canvas.js');
    svg = el('svg', H.canvasId, doc.body, SVG_NS); svg._rect = { ...H.rect };
    svg.setAttribute('viewBox', '0 0 120 90');
    const controller = mountSketch(svg, { ...H.mount, notify: (m) => notices.push(String(m)) });
    state = controller.state; engine = controller.engine;
    ribbon = createToolRibbon({ state, profiles: !!H.mount.profiles, notify: (m) => notices.push(String(m)) });
    ribbon.render(el('div', 'design-ribbon'));
    if (host === 'penplotter') {
      const pd = await import('../../apps/penplotter/src/plotter-doc.js');
      sidecar = { hostName: 'penplotter', getHostData: pd.capturePlotterDoc, apply: (h) => (h ? pd.applyPlotterDoc(h) : pd.resetPlotterDoc()), plotterDoc: pd };
      // a page load starts the plotter's module state fresh; in one Node process the module (apps/penplotter/src/state.js) lives on, so
      // the previous "page"'s pens and toolpaths are cleared here or a restore could pass without restoring anything
      pd.resetPlotterDoc();
    }
    buffer = createDocumentBuffer({ state, app: host, canvas: svg, store, doc, win, hostName: sidecar.hostName, getHostData: sidecar.getHostData,
      onRestored: ({ hosts }) => { engine.solve(500); if (host === 'shaper') fitToDrawing(svg, state); if (sidecar.apply) sidecar.apply(hosts && hosts[sidecar.hostName]); },
      onStatusChange: (s) => { saveStatus.textContent = s === 'saving' ? 'Saving…' : s === 'saved' ? 'Saved' : ''; } });
    controller.start();
    frame = () => runFrames(1);
  }
  // mountSketch swallows a setupInput failure (sketch-canvas.js): refuse a canvas whose input layer did not attach
  if (!svg.listenerCount('pointerdown')) throw new Error('node-app: the input layer did not attach to the canvas (setupInput failed in this DOM stand-in)');
  await buffer.restore();
  buffer.start();
  frame();

  const frames = (n = framesPerEvent) => { for (let i = 0; i < n; i++) frame(); };
  const pointer = (type, x, y, o = {}) => {
    const e = new FakeEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: o.pointerId ?? 1, pointerType: o.pointerType || 'mouse', isPrimary: true,
      button: o.button ?? (type === 'pointermove' ? -1 : 0), buttons: o.buttons ?? (type === 'pointerup' ? 0 : 1), shiftKey: !!o.shift, ctrlKey: !!o.ctrl, altKey: false, metaKey: false });
    svg.dispatchEvent(e); frames();
    return e;
  };
  // keys go where the browser sends them: the focused element (the document body when nothing is focused), bubbling to document + window
  const KEYCODES = { Escape: 27, Enter: 13, Delete: 46, Backspace: 8, Tab: 9, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
  const key = (k, o = {}) => {
    for (const type of ['keydown', 'keyup']) {
      const target = doc.activeElement || doc.body;
      const e = new FakeEvent(type, { bubbles: true, key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, keyCode: KEYCODES[k] || k.toUpperCase().charCodeAt(0), ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, metaKey: !!o.meta, repeat: false });
      target.dispatchEvent(e); frames();
    }
  };

  const app = {
    host, state, engine, svg, document: doc, window: win, buffer, store, profile, notices, ribbon, sidecar,
    frames,
    /** world -> screen through the app's own transform (#ui/coords.js worldToScreen, the svg's live viewBox) */
    toScreen: (wx, wy) => { const p = worldToScreen(svg, { x: wx, y: wy }); return { x: Math.round(p.x), y: Math.round(p.y) }; },
    move: (x, y, o) => pointer('pointermove', x, y, { buttons: 0, ...o }),
    down: (x, y, o) => pointer('pointerdown', x, y, o),
    up: (x, y, o) => pointer('pointerup', x, y, o),
    click(x, y, o) { this.move(x, y, o); this.down(x, y, o); this.up(x, y, o); },
    drag(a, b, steps = 8, o) { this.move(a.x, a.y, o); this.down(a.x, a.y, o); for (let i = 1; i <= steps; i++) pointer('pointermove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, { buttons: 1, ...o }); this.up(b.x, b.y, o); },
    key,
    esc: () => key('Escape'), enter: () => key('Enter'), undo: () => key('z', { ctrl: true }), redo: () => key('y', { ctrl: true }),
    /** a click on the tool's ribbon button (#tool-<name>): the host's own tool activation */
    tool(name) { const b = doc.getElementById('tool-' + name); if (!b) throw new Error('node-app: no ribbon button #tool-' + name + ' in ' + host); b.click(); frames(); },
    switchToTool: (name) => switchToTool(state, name),
    /** the autosave writes now (the page-hide path, as cdp-browser.js flushAutosave does); returns the stored current design's document */
    async storedDoc() { win.dispatchEvent(new FakeEvent('pagehide')); await buffer.flush(); const d = await store.loadCurrent({ app: host }); return d ? d.document : null; },
    saveStatus: () => saveStatus.textContent,
    /** polls cond() (timers and the app's setTimeout(0) work run in between), like cdp-browser.js waitFor; throws after timeoutMs */
    async waitFor(cond, what, timeoutMs = 2000) {
      const end = Date.now() + timeoutMs;
      for (;;) { if (await cond()) return; if (Date.now() > end) throw new Error('node-app: timed out waiting for ' + what); await new Promise((r) => setTimeout(r, 5)); frames(1); }
    },
    async close() { buffer.stop(); channel.close(); clearPageTimers(); rafQueue = new Map(); openApp = null; },
  };
  openApp = app;
  return app;
}
