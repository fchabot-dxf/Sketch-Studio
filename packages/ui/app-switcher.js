// packages/ui/app-switcher.js — a shared, two-way APP SWITCHER for the app headers (SWITCH-1). The current app's name
// + a chevron; click → a dropdown of the apps (the current one marked); selecting another navigates there. The app
// list is DECLARED as DATA — adding a host later is one entry, not new code. PURE #ui (no app imports); themed via the
// shared --sk-* header/ribbon vars so it fits both Studio (light) and Shaper (dark).

// The roster. RELATIVE sibling paths (SWITCH-2): both apps live at apps/<id>/, so from either app's location
// ../<other>/ resolves to its sibling — correct from ANY server root (local dev served from a subdir, or the deployed
// repo-root site) AND robust to the /shaper redirect. Absolute /apps/<id>/ only worked when the server root == repo root.
export const APPS = [
  { id: 'sketchstudio', name: 'Sketch Studio', href: '../sketchstudio/' },
  { id: 'shaper', name: 'Shaper', href: '../shaper/' },
];

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-appsw-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-appsw-styles';
  s.textContent = `
.sk-appsw { position: relative; display: inline-flex; }
.sk-appsw-btn { display: inline-flex; align-items: center; gap: 6px; background: transparent; color: inherit; cursor: pointer;
  border: 1px solid var(--sk-header-sep, var(--sk-ribbon-sep, rgba(127,127,127,0.35))); border-radius: 6px; padding: 4px 9px;
  font: inherit; font-weight: 700; }
.sk-appsw-btn:hover { background: var(--sk-header-hover, rgba(127,127,127,0.12)); }
.sk-appsw-chev { opacity: 0.6; font-size: 0.8em; }
.sk-appsw-menu { position: absolute; top: calc(100% + 4px); left: 0; min-width: 168px; z-index: 1000;
  background: var(--sk-ribbon-menu-bg, var(--sk-header-bg, #fff)); color: var(--sk-header-fg, inherit);
  border: 1px solid var(--sk-header-sep, var(--sk-ribbon-sep, rgba(127,127,127,0.35))); border-radius: 8px; padding: 4px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.28); }
.sk-appsw-menu[hidden] { display: none; }
.sk-appsw-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent; color: inherit;
  border: 0; border-radius: 6px; padding: 7px 9px; cursor: pointer; font: inherit; }
.sk-appsw-item:hover { background: var(--sk-header-hover, rgba(127,127,127,0.12)); }
.sk-appsw-item.current { font-weight: 700; }
.sk-appsw-check { width: 1em; text-align: center; color: var(--sk-selection, #4c9aff); }
`;
  document.head.appendChild(s); stylesInjected = true;
}

// createAppSwitcher({ current, apps? }) → { el, destroy }
export function createAppSwitcher({ current, apps = APPS } = {}) {
  injectStyles();
  const list = Array.isArray(apps) && apps.length ? apps : APPS;
  const cur = list.find((a) => a.id === current) || list[0];

  const el = document.createElement('div'); el.className = 'sk-appsw';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sk-appsw-btn'; btn.title = 'Switch app';
  btn.innerHTML = `<span class="sk-appsw-name">${cur ? cur.name : 'App'}</span><span class="sk-appsw-chev">▾</span>`;
  const menu = document.createElement('div'); menu.className = 'sk-appsw-menu'; menu.hidden = true;
  for (const a of list) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'sk-appsw-item' + (a.id === current ? ' current' : '');
    item.dataset.app = a.id;
    item.innerHTML = `<span class="sk-appsw-check">${a.id === current ? '✓' : ''}</span><span>${a.name}</span>`;
    item.addEventListener('click', (e) => { e.stopPropagation(); close(); if (a.id !== (cur && cur.id)) location.href = a.href; });
    menu.appendChild(item);
  }
  el.append(btn, menu);

  const onDoc = (e) => { if (!el.contains(e.target)) close(); };
  function close() { menu.hidden = true; el.classList.remove('open'); document.removeEventListener('click', onDoc); }
  function open() { menu.hidden = false; el.classList.add('open'); setTimeout(() => document.addEventListener('click', onDoc), 0); }
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (menu.hidden) open(); else close(); });

  return { el, destroy() { try { close(); el.remove(); } catch (_) {} } };
}
