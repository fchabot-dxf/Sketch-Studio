// apps/sketchstudio/ui/wizard-base.js
// Small helper to unify floating wizard/panel layout & styles
export function applyPanelStyle(el, opts = {}) {
  if (!el || typeof el.style === 'undefined') return;

  const useFixed = opts.useFixed !== false; // default true
  const width = typeof opts.width === 'number' ? `${opts.width}px` : (opts.width || '320px');
  const maxHeight = opts.maxHeight || '80vh';
  const padding = (typeof opts.padding === 'number') ? `${opts.padding}px` : (opts.padding || '16px');
  const fontSize = opts.fontSize || '11px';
  const zIndex = (typeof opts.zIndex === 'number') ? opts.zIndex : 99999;

  // Base visual style (keeps existing display unless explicitly provided)
  let base = `
    ${useFixed ? 'position: fixed;' : 'position: relative;'}
    width: ${width};
    max-height: ${maxHeight};
    overflow-y: auto;
    background: #ffffff;
    color: #0f172a;
    padding: ${padding};
    border-radius: 12px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: ${fontSize};
    z-index: ${zIndex};
    box-shadow: 0 10px 30px rgba(2,6,23,0.06);
    border: 1px solid #e6eef8;
  `;

  // Allow top / bottom / left / right overrides when fixed positioning is used
  if (useFixed) {
    if (opts.center) {
      // clear any stray "right/bottom" values from CSS classes and center the panel
      base += ` right: auto; top: 50%; left: 50%; transform: translate(-50%, -50%);`;
    } else {
      // default right positioning for non-centered fixed panels (can be overridden by opts.position)
      base += ` right: ${opts.position && opts.position.right ? opts.position.right : (opts.right || '20px')};`;
      if (opts.position) {
        if (opts.position.top) base += (opts.position.top ? ` top: ${opts.position.top};` : '');
        if (opts.position.bottom) base += (opts.position.bottom ? ` bottom: ${opts.position.bottom};` : '');
      } else {
        if (opts.top) base += ` top: ${opts.top};`;
        if (opts.left) base += ` left: ${opts.left};`;
        if (opts.bottom) base += ` bottom: ${opts.bottom};`;
      }
    }
  }

  // Only set display if caller explicitly provided it
  if (typeof opts.display !== 'undefined') base += ` display: ${opts.display};`;

  // Ensure panel can be targeted by shared wizard CSS rules (when present)
  try { if (el.classList && typeof el.classList.add === 'function') el.classList.add('ss-wizard-panel'); } catch(_) {}

  // Apply composed style (trim whitespace)
  el.style.cssText = base.trim();
}

// Create a standardized wizard panel (panel element + header + close button)
// opts: { id, title, closeId, width, position, padding, display, center }
export const PANEL_STACK_SPACING = 16; // gap (px) reserved for future stacking logic

export function createWizardPanel(opts = {}) {
  const panel = document.createElement('div');
  if (opts.id) panel.id = opts.id;

  // Panels are centered by default. Caller may opt-out via opts.center = false.
  const center = opts.center !== false;

  // Apply base visual styling (fixed positioning by default) and support centering
  applyPanelStyle(panel, { useFixed: true, width: opts.width || 320, maxHeight: opts.maxHeight || '80vh', padding: opts.padding || 12, display: typeof opts.display !== 'undefined' ? opts.display : 'none', center });

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;';
  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600; font-size:13px; color:#60a5fa;';
  title.innerHTML = opts.title || '';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.style.cssText = 'background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;';
  closeBtn.innerText = '×';
  if (opts.closeId) closeBtn.id = opts.closeId;
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // Append to body (centered fixed element)
  if (document && document.body && typeof document.body.appendChild === 'function') document.body.appendChild(panel);

  return { panel, header, closeBtn };
}

// Ensure an existing DOM panel (static in HTML) uses unified wizard layout and optional zone stacking
export function normalizeExistingPanel(panelId, opts = {}) {
  try {
    const el = document.getElementById(panelId);
    if (!el) return null;
    const zone = opts.zone;
    if (zone) {
      const zoneContainer = getOrCreateZoneContainer(zone);
      // move existing element into the zone container so layout is relative to the zone
      try { if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el); } catch(_){}
      zoneContainer.appendChild(el);
      // apply panel styling for zone children (no fixed positioning)
      applyPanelStyle(el, { useFixed: false, width: opts.width || 320, padding: opts.padding || 12 });
      PANEL_REGISTRY[zone] = PANEL_REGISTRY[zone] || [];
      PANEL_REGISTRY[zone].push(el);
      return el;
    }
    applyPanelStyle(el, opts);

    // Normalize common child elements so static HTML panels match the factory-created panels
    try {
      // style any <label> rows to match the slider/row spacing used by createWizardPanel
      if (typeof el.querySelectorAll === 'function') {
        const labels = Array.from(el.querySelectorAll('label'));
        labels.forEach(l => {
          try { if (l && l.style) l.style.cssText = (l.style.cssText || '') + '; display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px;'; } catch(_) {}
        });
        // ensure any existing range inputs inside the static panel use the unified accent color
        const ranges = Array.from(el.querySelectorAll('input[type="range"]'));
        ranges.forEach(r => { try { if (r && r.style) r.style.cssText = (r.style.cssText || '') + '; accent-color:#3b82f6; cursor:pointer;'; } catch(_) {} });

        // Remove explicit Tailwind typography utilities that would override the unified monospace theme
        try {
          const removeClassList = ['text-sm', 'text-slate-700', 'font-bold'];
          const allChildren = Array.from(el.querySelectorAll('*'));
          allChildren.forEach(ch => {
            try {
              if (ch.classList && typeof ch.classList.remove === 'function') removeClassList.forEach(c => { if (ch.classList.contains(c)) ch.classList.remove(c); });
              // clear inline font-size/color if present so ss-wizard-panel rules win
              if (ch.style && (ch.style.fontSize || ch.style.color)) { ch.style.fontSize = null; ch.style.color = null; }
            } catch(_) {}
          });
        } catch(_) {}
      }
    } catch(_) {}

    return el;
  } catch (e) {
    return null;
  }
}

export default { applyPanelStyle, createWizardPanel, normalizeExistingPanel, PANEL_STACK_SPACING };