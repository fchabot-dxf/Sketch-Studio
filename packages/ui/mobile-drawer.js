// packages/ui/mobile-drawer.js — the shared MOBILE DRAWER wrapper for a host's side info-panel.
// Below `breakpoint` (default 768, matching Tailwind's own `md` cutoff already used elsewhere in this codebase
// — e.g. apps/sketchstudio/index.html's `md:p-4`), the panel becomes a collapsed-by-default slide-over drawer
// with a header toggle button. At/above `breakpoint` this is a total no-op: every new rule lives inside the
// media query, so desktop rendering is byte-identical to before this component existed. Mirrors
// style-panel.js's open/close idiom (Escape + outside-click + a close-X) for UX consistency with the rest of
// this codebase's overlay chrome.
//
// createMobileDrawer({ panelEl, breakpoint, label, hideOnMobile }) → { toggleEl, open, close, toggle, isOpen, destroy }
//   panelEl: the host's EXISTING side-panel container (the <aside> that already holds the mounted info-panel
//     content via the host's own mount code, e.g. createDesignInfoPanel(...).render(panelEl)). This component
//     adds behavior to it in place — it does not move, rebuild, or take ownership of its children.
//   hideOnMobile: optional elements to hide below the breakpoint (e.g. a host's own pre-existing desktop
//     collapse-arrow button, which would otherwise conflict with the drawer's own open/close state).
//   toggleEl: a real button for the HOST to place in ITS OWN header/chrome (mobile-only via CSS — the host
//     doesn't need its own width-detection logic). Not self-mounted/floating: this codebase's convention is
//     app actions live in the panel/header, not as overlays floating over the ribbon/canvas.

let stylesInjected = false;
function injectStyles(breakpoint) {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-drawer-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-drawer-styles';
  s.textContent = `
.sk-drawer-toggle { display: none; }
.sk-drawer-close { display: none; }
.sk-drawer-hide-mobile { display: inline-flex; }
@media (max-width: ${breakpoint - 1}px) {
  .sk-drawer-toggle { display: inline-flex; align-items: center; gap: 6px; background: transparent;
    border: 1px solid currentColor; opacity: 0.75; border-radius: 6px; padding: 4px 10px;
    font: 12px system-ui, sans-serif; cursor: pointer; color: inherit; }
  .sk-drawer-toggle:hover { opacity: 1; }
  .sk-drawer-hide-mobile { display: none !important; }
  .sk-drawer-panel { position: fixed !important; top: 0; bottom: 0; left: 0; height: 100%; z-index: 9500;
    width: 280px; max-width: 85vw; overflow-y: auto; transform: translateX(-100%);
    transition: transform 0.2s ease; box-shadow: 2px 0 16px rgba(0,0,0,0.35); }
  .sk-drawer-panel.sk-drawer-open { transform: translateX(0); }
  .sk-drawer-close { display: block; position: absolute; top: 6px; right: 8px; z-index: 1; background: transparent;
    border: 0; font-size: 16px; line-height: 1; cursor: pointer; color: inherit; opacity: 0.7; padding: 4px; }
  .sk-drawer-close:hover { opacity: 1; }
}
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

export function createMobileDrawer({ panelEl, breakpoint = 768, label = 'Panel', hideOnMobile = [] } = {}) {
  if (!panelEl) throw new Error('createMobileDrawer: panelEl is required');
  injectStyles(breakpoint);
  panelEl.classList.add('sk-drawer-panel');
  for (const el of hideOnMobile) { if (el) el.classList.add('sk-drawer-hide-mobile'); }

  const closeX = document.createElement('button');
  closeX.type = 'button'; closeX.className = 'sk-drawer-close'; closeX.textContent = '✕'; closeX.title = 'Close';
  panelEl.insertBefore(closeX, panelEl.firstChild);

  const toggleEl = document.createElement('button');
  toggleEl.type = 'button'; toggleEl.className = 'sk-drawer-toggle'; toggleEl.title = label;
  toggleEl.setAttribute('aria-label', label);
  toggleEl.textContent = '☰ ' + label;

  let isOpenState = false, escHandler = null, outsideHandler = null;

  function open() {
    if (isOpenState) return;
    isOpenState = true;
    panelEl.classList.remove('collapsed'); // clears a stale desktop collapse-state so the drawer never opens empty
    panelEl.classList.add('sk-drawer-open');
    escHandler = (e) => { if (e.key === 'Escape') close(); };
    outsideHandler = (e) => { if (!panelEl.contains(e.target) && !toggleEl.contains(e.target)) close(); };
    document.addEventListener('keydown', escHandler);
    setTimeout(() => { if (isOpenState) document.addEventListener('click', outsideHandler); }, 0);
  }
  function close() {
    if (!isOpenState) return;
    isOpenState = false;
    panelEl.classList.remove('sk-drawer-open');
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
    if (outsideHandler) { document.removeEventListener('click', outsideHandler); outsideHandler = null; }
  }
  function toggle() { isOpenState ? close() : open(); }

  toggleEl.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  closeX.addEventListener('click', (e) => { e.stopPropagation(); close(); });

  return {
    toggleEl, open, close, toggle, isOpen: () => isOpenState,
    destroy: () => {
      close();
      try { toggleEl.remove(); } catch (_) {}
      try { closeX.remove(); } catch (_) {}
      panelEl.classList.remove('sk-drawer-panel', 'sk-drawer-open');
      for (const el of hideOnMobile) { if (el) el.classList.remove('sk-drawer-hide-mobile'); }
    },
  };
}
