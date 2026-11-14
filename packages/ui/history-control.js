// packages/ui/history-control.js: the ONE Undo / Redo control (TASK 618), shared by every host.
// A HISTORY SOURCE is { undo(), redo(), canUndo(), canRedo(), subscribe(fn) -> unsubscribe } (the sketch state's, via input-manager
// sketchHistory(); Pen Plotter's Toolpath / Export stack, via its history.js). A host declares which source the CURRENT stage owns
// (`current()`, null = this stage has no history) and gets a router: the keyboard handlers and the header buttons both call
// router.run(action), so a click does exactly what Ctrl+Z / Ctrl+Y does in that stage (one dispatch, no second path).

/** THE one mapping of the history keys: Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo; null for any other key. */
export function undoRedoKeyAction(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return null;
  const z = e.key === 'z' || e.key === 'Z';
  if (z && !e.shiftKey) return 'undo';
  if ((z && e.shiftKey) || e.key === 'y' || e.key === 'Y') return 'redo';
  return null;
}

/** createHistoryRouter({ current }) -> { run, runKey, canUndo, canRedo, refresh, onChange }.
 *  refresh(): the host calls it when the stage changes (re-binds the source's change events, then tells the listeners). */
export function createHistoryRouter({ current }) {
  const listeners = new Set();
  let bound = null, unsub = null;
  const notify = () => { for (const fn of listeners) fn(); };
  function rebind() {
    const src = current() || null;
    if (src === bound) return;
    if (unsub) unsub();
    bound = src;
    unsub = src ? src.subscribe(notify) : null;
  }
  return {
    run(action) {
      const src = current();
      if (!src) return false;
      src[action]();
      return true;
    },
    /** A keydown: runs the mapped action in the current stage and cancels the browser's own; true when it did. */
    runKey(e) {
      const action = undoRedoKeyAction(e);
      if (!action || !this.run(action)) return false;
      e.preventDefault();
      return true;
    },
    canUndo() { const s = current(); return !!s && s.canUndo(); },
    canRedo() { const s = current(); return !!s && s.canRedo(); },
    refresh() { rebind(); notify(); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

const ICONS = {
  undo: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M3 7v6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  redo: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M21 7v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const BUTTONS = [
  { id: 'btn-undo', action: 'undo', can: 'canUndo', label: 'Undo (Ctrl+Z)' },
  { id: 'btn-redo', action: 'redo', can: 'canRedo', label: 'Redo (Ctrl+Y)' },
];

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  const s = document.createElement('style');
  s.id = 'sk-history-styles';
  s.textContent = `
.sk-history { display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
.sk-history-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; background: transparent;
  color: inherit; border: 1px solid transparent; border-radius: 6px; cursor: pointer; font: inherit; }
.sk-history-btn:hover:not(:disabled) { background: var(--sk-header-hover, rgba(0,0,0,0.08)); }
.sk-history-btn:disabled { opacity: 0.35; cursor: default; }
@media (pointer: coarse) { .sk-history-btn { width: 44px; height: 44px; } }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

/** mountHistoryButtons({ router, header, before }) -> { el, destroy }: the Undo + Redo icon buttons, inserted into `header` before `before`
 *  (an element of the header: the host's right-hand controls), or at its end. The ONE mount every host calls. */
export function mountHistoryButtons({ router, header, before = null }) {
  injectStyles();
  const el = document.createElement('span');
  el.className = 'sk-history';
  const paints = BUTTONS.map((d) => {
    const b = document.createElement('button');
    b.type = 'button'; b.id = d.id; b.className = 'sk-history-btn';
    b.title = d.label; b.setAttribute('aria-label', d.label);
    b.innerHTML = ICONS[d.action];
    b.addEventListener('click', () => router.run(d.action));
    el.appendChild(b);
    return () => { b.disabled = !router[d.can](); };
  });
  const paint = () => paints.forEach((p) => p());
  const off = router.onChange(paint);
  header.insertBefore(el, before && before.parentNode === header ? before : null);
  router.refresh();
  return { el, destroy: () => { off(); el.remove(); } };
}
