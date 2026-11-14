// packages/ui/document-tabs.js — TASK 587 (docs/DOCUMENT-TABS-DESIGN.md section 5): the DOCUMENT TAB STRIP, one shared component. A thin row directly
// BELOW a host's header, above its tool ribbon (TASK 602, owner; in every layout, the phone-landscape one included) with one tab per open design, a status
// dot, a close x on each, and a "+" that opens a new design in a new tab. It is pure DOM over the document buffer's tab API (document-buffer.js tabs / activate /
// closeTab / newTab, reached through the declared project actions): it owns no document logic, and no host styling (it themes from the host's own
// --sk-header-* tokens, so a light Sketch and a dark Shaper each get their own look).
//
// Declared, not hand-placed: mountProjectSidebar (sidebar-projects.js) opts in with `documentTabs: true` and inserts the strip immediately AFTER the host's
// <header> (the element that holds the sidebar's button) once that button is in the page.
// Size (TASK 602, owner "tabs can be minimal size"), declared once as the --sk-doctab* tokens below:
//   a mouse (fine pointer): a 26 px row (25 px tabs + the 1 px line under them), 11 px text, an 18 px close x;
//   a finger (coarse pointer, portrait or landscape): a 45 px row: every tab, close x and "+" is a real 44 px target (no enlarged hit areas reaching over the
//   header or the ribbon), kept visually light (11 px text, a 6 px dot, a thin x on a transparent 44 px button).
// Tabs share the row like browser tabs: each is up to --sk-doctab-max wide (1 or 2 tabs show their whole name), they shrink evenly as more open, and
// stop at --sk-doctab-min, after which the row scrolls sideways (the active tab is kept in view). A long name ends in an ellipsis; the tab's title holds
// the whole name.
//
// createDocumentTabs({ getBuffer, store, actions, onChange, doc }) -> { el, refresh, destroy }
//   getBuffer(): the host's document buffer (it may not exist yet: the strip is empty until it does)
//   actions: { activateTab(key), closeTab(key) -> false when the user cancelled, newDesign() }  (project-actions.js: the same declaration the menu uses)
//   onChange(): called when the active design / the tab names changed (the sidebar follows the active tab's name, status and the page title)
// Accessibility: role=tablist "Open designs"; the arrow keys move between tabs (Home / End jump), Enter / Space activate, Delete closes.
// Every width: ONE line; when the tabs reach their minimum width the line scrolls sideways and the active tab is scrolled into view (no second row).

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-doctabs-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-doctabs-styles';
  s.textContent = `
:root { --sk-doctabs-row: 26px; } /* TASK 605: the strip's whole row height (the 25 px tabs + the 1 px line), for a host whose views are placed absolutely under the header (Shaper) */
@media (pointer: coarse) { :root { --sk-doctabs-row: 45px; } }
.sk-doctabs { --sk-doctabs-h: 25px; --sk-doctab-inset: 3px; --sk-doctabs-gap: 2px; --sk-doctab-max: 240px; --sk-doctab-min: 72px; --sk-doctab-x: 18px;
  --sk-doctabs-font: 11px; --sk-doctab-dot: 6px; }
@media (pointer: coarse) { .sk-doctabs { --sk-doctabs-h: 44px; --sk-doctab-inset: 0px; --sk-doctabs-gap: 4px; --sk-doctab-min: 104px; --sk-doctab-x: 44px; } }
.sk-doctabs { display: flex; align-items: flex-end; gap: var(--sk-doctabs-gap); padding: 0 8px; box-sizing: border-box; flex: 0 0 auto;
  height: calc(var(--sk-doctabs-h) + 1px); background: var(--sk-doctabs-bg, var(--sk-header-sep, #e2e8f0)); border-bottom: 1px solid var(--sk-header-sep, #cbd5e1);
  color: var(--sk-header-fg, #334155); font: var(--sk-doctabs-font) system-ui, sans-serif; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.sk-doctabs::-webkit-scrollbar { display: none; }
.sk-doctabs * { box-sizing: border-box; }
.sk-doctab { display: flex; align-items: stretch; flex: 0 1 var(--sk-doctab-max); min-width: var(--sk-doctab-min); height: calc(var(--sk-doctabs-h) - var(--sk-doctab-inset));
  border-radius: 5px 5px 0 0; opacity: 0.8; }
.sk-doctab:hover { background: var(--sk-header-hover, rgba(0,0,0,0.05)); opacity: 1; }
.sk-doctab.active { background: var(--sk-header-bg, #fff); box-shadow: inset 1px 1px 0 var(--sk-header-sep, #cbd5e1), inset -1px 0 0 var(--sk-header-sep, #cbd5e1); opacity: 1; font-weight: 600; }
.sk-doctab-main { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 5px; background: transparent; border: 0; color: inherit; font: inherit;
  cursor: pointer; padding: 0 2px 0 8px; }
.sk-doctab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sk-doctab-dot { flex: 0 0 auto; width: var(--sk-doctab-dot); height: var(--sk-doctab-dot); border-radius: 50%; background: var(--sk-selection, #3B82F6); }
.sk-doctab-dot.failed { background: #dc2626; }
.sk-doctab-dot.saving { background: transparent; border: 1.5px solid currentColor; opacity: 0.6; }
.sk-doctab-x, .sk-doctab-new { flex: 0 0 var(--sk-doctab-x); width: var(--sk-doctab-x); padding: 0; background: transparent; border: 0; color: inherit; font: inherit;
  cursor: pointer; border-radius: 4px; opacity: 0.6; line-height: 1; }
.sk-doctab-x { font-size: 13px; }
.sk-doctab-new { height: calc(var(--sk-doctabs-h) - var(--sk-doctab-inset)); font-size: 15px; }
.sk-doctab-x:hover, .sk-doctab-new:hover { background: var(--sk-header-hover, rgba(0,0,0,0.08)); opacity: 1; }
.sk-doctab-main:focus-visible, .sk-doctab-x:focus-visible, .sk-doctab-new:focus-visible { outline: 2px solid var(--sk-selection, #3B82F6); outline-offset: -2px; }
.sk-doctabs-msg { flex: 0 0 auto; align-self: center; margin: 0 8px 0 auto; padding-left: 12px; font-size: 11px; color: #b45309; white-space: nowrap; }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

export function createDocumentTabs({ getBuffer, store, actions, onChange = () => {}, doc = globalThis.document, pollMs = 500 } = {}) {
  injectStyles();
  const el = doc.createElement('div');
  el.className = 'sk-doctabs'; // the row has its fixed height from the first paint (nothing below it moves when the tabs appear); the tabs are drawn once the stored design has restored
  el.setAttribute('role', 'tablist'); el.setAttribute('aria-label', 'Open designs');
  const msg = doc.createElement('span'); msg.className = 'sk-doctabs-msg'; msg.setAttribute('role', 'status');
  let names = new Map();     // stored design id -> its current name (a rename happens in the store; the buffer's copy is not updated)
  let shown = '';            // the signature of what is drawn: the strip is rebuilt only when it changes
  let lastActive = null;     // `${key}|${designId}|${name}` of the active tab, to tell the sidebar when it changed
  let msgTimer = null;
  let watched = null;        // the buffer whose `ready` we wait on
  let restored = false;      // its first restore is done
  let busy = false;          // an action of this strip is running: its clicks are ignored until it settles

  function say(text) {
    msg.textContent = text;
    clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(() => { msg.textContent = ''; }, 5000);
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); say(''); } catch (e) { say(e && e.message ? e.message : String(e)); } finally { busy = false; refresh(); }
    const a = doc.activeElement; if (a && el.contains(a)) a.blur(); // keys (Ctrl+Z, tool letters) go to the canvas's handlers, not to a strip button
  }

  const nameOf = (t) => (t.designId && names.get(t.designId)) || t.name;
  function dotOf(t) {
    if (t.needsSavePrompt === 'save-failed') return { cls: 'failed', tip: 'Not saved: the last save failed' };
    if (t.needsSavePrompt === 'unsaved') return { cls: '', tip: 'Not saved yet' };
    const st = t.designId && store && store.status ? store.status(t.designId) : null;
    if (st && st.state === 'saving') return { cls: 'saving', tip: 'Saving…' };
    return null;
  }

  function render(list) {
    const focusKey = el.contains(doc.activeElement) && doc.activeElement.closest('[data-key]') ? doc.activeElement.closest('[data-key]').dataset.key : null;
    el.textContent = '';
    for (const t of list) {
      const name = nameOf(t);
      const dot = dotOf(t);
      const wrap = doc.createElement('div'); wrap.className = 'sk-doctab' + (t.active ? ' active' : ''); wrap.dataset.key = t.key; wrap.setAttribute('role', 'presentation');
      const main = doc.createElement('button'); main.type = 'button'; main.className = 'sk-doctab-main'; main.setAttribute('role', 'tab');
      main.setAttribute('aria-selected', t.active ? 'true' : 'false'); main.tabIndex = t.active ? 0 : -1; main.title = dot ? `${name} (${dot.tip})` : name;
      const label = doc.createElement('span'); label.className = 'sk-doctab-name'; label.textContent = name;
      main.appendChild(label);
      if (dot) { const d = doc.createElement('span'); d.className = 'sk-doctab-dot ' + dot.cls; d.setAttribute('aria-hidden', 'true'); main.appendChild(d); }
      main.addEventListener('click', () => run(() => actions.activateTab(t.key)));
      const x = doc.createElement('button'); x.type = 'button'; x.className = 'sk-doctab-x'; x.tabIndex = -1; x.title = 'Close'; x.setAttribute('aria-label', `Close ${name}`); x.textContent = '×';
      x.addEventListener('click', () => run(() => actions.closeTab(t.key)));
      wrap.append(main, x);
      el.appendChild(wrap);
    }
    const plus = doc.createElement('button'); plus.type = 'button'; plus.className = 'sk-doctab-new'; plus.title = 'New design in a new tab'; plus.setAttribute('aria-label', 'New design in a new tab'); plus.textContent = '+';
    plus.addEventListener('click', () => run(() => actions.newDesign()));
    el.append(plus, msg);
    if (focusKey) { const f = el.querySelector(`[data-key="${focusKey}"] .sk-doctab-main`); if (f) f.focus(); }
    const act = el.querySelector('.sk-doctab.active');
    if (act) { // phone width: the one line scrolls; keep the active tab in view (the strip's own scroll only, never the page's)
      const l = act.offsetLeft, r = l + act.offsetWidth;
      if (l < el.scrollLeft) el.scrollLeft = l - 8; else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 8;
    }
  }

  /** Redraw when something changed (cheap to call often: it compares a signature first). */
  function refresh() {
    const b = getBuffer && getBuffer();
    if (!b) return;
    if (watched !== b) { watched = b; b.ready.then(() => { restored = true; refresh(); }); } // the strip (and the sidebar's name) show once the stored design is back: no "Untitled" flash
    if (!restored) return;
    const list = b.tabs();
    const sig = JSON.stringify(list.map((t) => [t.key, nameOf(t), t.active, dotOf(t) && dotOf(t).cls]));
    if (sig !== shown) { shown = sig; render(list); }
    const a = list.find((t) => t.active);
    const now = a ? `${a.key}|${a.designId}|${nameOf(a)}` : '';
    if (now !== lastActive) { lastActive = now; try { onChange(); } catch (e) { console.error('document tabs onChange failed', e); } }
  }

  // The names of stored designs, and the tabs whose design was deleted (Projects, Delete): those tabs close.
  async function syncNames() {
    const b = getBuffer && getBuffer();
    if (!b || !store) return;
    let rows;
    try { rows = await store.listRecent(); } catch (_) { return; } // a failed read just keeps the names we have
    const next = new Map(rows.map((r) => [r.id, r.name]));
    names = next;
    for (const t of b.tabs()) {
      if (!t.designId || next.has(t.designId)) continue;
      if (await store.get(t.designId)) continue; // not in the recent list but still stored (re-checked: a save may have just created it)
      try { await b.closeTab(t.key); } catch (e) { say(e && e.message ? e.message : String(e)); }
    }
    refresh();
  }

  let syncTimer = null; // a burst of store changes (every autosave notifies) is read once, a second after it settles
  const offStore = store ? store.subscribe(() => { refresh(); clearTimeout(syncTimer); syncTimer = setTimeout(syncNames, 300); }) : () => {};
  // the host creates its buffer a moment after the sidebar: look every 50 ms until it exists, then every pollMs
  let timer = setInterval(() => { refresh(); if (restored) { clearInterval(timer); timer = setInterval(refresh, pollMs); } }, Math.min(50, pollMs));
  const onKey = (e) => {
    const mains = [...el.querySelectorAll('.sk-doctab-main')];
    const i = mains.indexOf(doc.activeElement);
    if (i < 0) return;
    let to = -1;
    if (e.key === 'ArrowRight') to = (i + 1) % mains.length;
    else if (e.key === 'ArrowLeft') to = (i - 1 + mains.length) % mains.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = mains.length - 1;
    else if (e.key === 'Delete') { e.preventDefault(); const key = mains[i].closest('[data-key]').dataset.key; run(() => actions.closeTab(key)); return; }
    else return;
    e.preventDefault();
    mains.forEach((m, j) => { m.tabIndex = j === to ? 0 : -1; });
    mains[to].focus();
  };
  el.addEventListener('keydown', onKey);
  syncNames();
  refresh();

  return { el, refresh, destroy() { clearInterval(timer); clearTimeout(syncTimer); offStore(); el.removeEventListener('keydown', onKey); el.remove(); } };
}
