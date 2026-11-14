// packages/ui/mobile-drawer.js — the shared MOBILE DRAWER wrapper for a host's side info-panel.
// Below `breakpoint` (default 768, matching Tailwind's own `md` cutoff already used elsewhere in this codebase
// — e.g. apps/sketchstudio/index.html's `md:p-4`), the panel becomes a collapsed-by-default slide-over drawer
// with a header toggle button. At/above `breakpoint` this is a total no-op: every new rule lives inside the
// media query, so desktop rendering is byte-identical to before this component existed. Mirrors
// style-panel.js's open/close idiom (Escape + outside-click + a close-X) for UX consistency with the rest of
// this codebase's overlay chrome.
//
// createMobileDrawer({ panelEl, breakpoint, label, hideOnMobile, side: 'left'|'right' }) → { toggleEl, open, close, toggle, isOpen, destroy }
//   panelEl: the host's EXISTING side-panel container (the <aside> that already holds the mounted info-panel
//     content via the host's own mount code, e.g. createDesignInfoPanel(...).render(panelEl)). This component
//     adds behavior to it in place — it does not move, rebuild, or take ownership of its children.
//   hideOnMobile: optional elements to hide below the breakpoint (e.g. a host's own pre-existing desktop
//     collapse-arrow button, which would otherwise conflict with the drawer's own open/close state).
//   toggleEl: a real button for the HOST to place in ITS OWN header/chrome (mobile-only via CSS — the host
//     doesn't need its own width-detection logic). Not self-mounted/floating: this codebase's convention is
//     app actions live in the panel/header, not as overlays floating over the ribbon/canvas.

// One stylesheet per breakpoint (task 586): the Design browser box is a drawer at <= 640 px (breakpoint 641), a host's own aside at
// < 768 px; each drawer's elements carry `sk-bp-<breakpoint>` so a rule only applies to the drawers of its own breakpoint.
const injectedBreakpoints = new Set();
function injectStyles(breakpoint) {
  if (injectedBreakpoints.has(breakpoint) || typeof document === 'undefined' || !document.head) return;
  const id = 'sk-drawer-styles-' + breakpoint;
  if (document.getElementById(id)) { injectedBreakpoints.add(breakpoint); return; }
  const bp = '.sk-bp-' + breakpoint;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = `
.sk-drawer-toggle { display: none; }
.sk-drawer-close { display: none; }
.sk-drawer-hide-mobile { display: inline-flex; }
@media (max-width: ${breakpoint - 1}px) {
  .sk-drawer-toggle${bp} { display: inline-flex; align-items: center; gap: 6px; background: transparent;
    border: 1px solid currentColor; opacity: 0.75; border-radius: 6px; padding: 4px 10px;
    font: 12px system-ui, sans-serif; cursor: pointer; color: inherit; }
  .sk-drawer-toggle${bp}:hover { opacity: 1; }
  .sk-drawer-toggle-icon${bp} { width: 32px; height: 32px; padding: 0; justify-content: center; opacity: 1; background: var(--sk-browser-solid, #f8fafc); box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
  .sk-drawer-toggle-icon${bp} svg { width: 22px; height: 22px; pointer-events: none; }
  @media (pointer: coarse) { .sk-drawer-toggle-icon${bp} { width: 44px; height: 44px; } .sk-drawer-toggle-icon${bp} svg { width: 28px; height: 28px; } }
  @media (pointer: coarse) { .sk-drawer-toggle${bp} { min-height: 44px; min-width: 44px; justify-content: center; } } /* TASK 581: a finger */
  .sk-drawer-hide-mobile${bp} { display: none !important; }
  .sk-drawer-panel${bp} { position: fixed !important; top: 0; bottom: 0; left: 0; height: 100%; z-index: 9500;
    width: 280px; max-width: 85vw; overflow-y: auto; transform: translateX(-100%);
    transition: transform 0.2s ease; box-shadow: 2px 0 16px rgba(0,0,0,0.35); }
  .sk-drawer-panel${bp}.sk-drawer-open { transform: translateX(0); }
  .sk-drawer-panel${bp}.sk-drawer-right { left: auto; right: 0; transform: translateX(100%); box-shadow: -2px 0 16px rgba(0,0,0,0.35); }
  .sk-drawer-panel${bp}.sk-drawer-right.sk-drawer-open { transform: translateX(0); }
  .sk-drawer-close${bp} { display: block; position: absolute; top: 6px; right: 8px; z-index: 1; background: transparent;
    border: 0; font-size: 16px; line-height: 1; cursor: pointer; color: inherit; opacity: 0.7; padding: 4px; }
  .sk-drawer-close${bp}:hover { opacity: 1; }
  @media (pointer: coarse) { .sk-drawer-close${bp} { min-width: 44px; min-height: 44px; top: 0; right: 0; } } /* TASK 608: a finger */
}
`;
  document.head.appendChild(s);
  injectedBreakpoints.add(breakpoint);
}

export function createMobileDrawer({ panelEl, breakpoint = 768, label = 'Panel', hideOnMobile = [], side = 'left', icon = null } = {}) {
  if (!panelEl) throw new Error('createMobileDrawer: panelEl is required');
  injectStyles(breakpoint);
  panelEl.classList.add('sk-drawer-panel', 'sk-bp-' + breakpoint);
  if (side === 'right') panelEl.classList.add('sk-drawer-right');
  for (const el of hideOnMobile) { if (el) el.classList.add('sk-drawer-hide-mobile', 'sk-bp-' + breakpoint); }

  const closeX = document.createElement('button');
  closeX.type = 'button'; closeX.className = 'sk-drawer-close sk-bp-' + breakpoint; closeX.textContent = '✕'; closeX.title = 'Close';
  panelEl.insertBefore(closeX, panelEl.firstChild);

  const toggleEl = document.createElement('button');
  toggleEl.type = 'button'; toggleEl.className = 'sk-drawer-toggle sk-bp-' + breakpoint; toggleEl.title = label;
  toggleEl.setAttribute('aria-label', label);
  if (icon) { toggleEl.classList.add('sk-drawer-toggle-icon'); toggleEl.innerHTML = icon; } // TASK 618: an icon-only button (the label stays the aria-label / title)
  else toggleEl.textContent = '☰ ' + label;

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
      panelEl.classList.remove('sk-drawer-panel', 'sk-bp-' + breakpoint, 'sk-drawer-open', 'sk-drawer-right');
      for (const el of hideOnMobile) { if (el) el.classList.remove('sk-drawer-hide-mobile', 'sk-bp-' + breakpoint); }
    },
  };
}
