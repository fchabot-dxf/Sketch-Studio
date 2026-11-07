(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const SettingsManager = (await import('#core/settings-manager.js')).default;
  const { setupDebugPanel } = await import('../apps/sketchstudio/ui/debug-panel.js');

  // Lightweight mock DOM supporting querySelector, events, element registry, and innerHTML parsing
  const elements = new Map();
  class MockElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.id = '';
      this.style = { cssText: '' };
      this.children = [];
      this.parentNode = null;
      this.attrs = new Map();
      this.listeners = new Map();
      this._innerHTML = '';
      this.checked = false;
    }
    setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') { this.id = v; elements.set(v, this); } }
    getAttribute(k) { return this.attrs.get(k) || null; }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) elements.set(child.id, child);
      return child;
    }
    insertBefore(child, ref) {
      child.parentNode = this;
      const idx = this.children.indexOf(ref);
      if (idx !== -1) this.children.splice(idx, 0, child);
      else this.children.push(child);
      if (child.id) elements.set(child.id, child);
      return child;
    }
    addEventListener(ev, cb) {
      if (!this.listeners.has(ev)) this.listeners.set(ev, []);
      this.listeners.get(ev).push(cb);
    }
    dispatchEvent(ev) {
      const type = typeof ev === 'string' ? ev : ev.type;
      const list = this.listeners.get(type) || [];
      for (const cb of list) cb({ target: this });
    }
    querySelector(sel) {
      for (const child of this.children) {
        if (sel === 'input' && child.tagName === 'INPUT') return child;
        if (sel.startsWith('#') && child.id === sel.slice(1)) return child;
        const found = child.querySelector(sel);
        if (found) return found;
      }
      return null;
    }
    set innerHTML(html) {
      this._innerHTML = html;
      const divMatch = html.match(/<div[^>]*>([\s\S]*?)<\/div>/i);
      if (divMatch) {
        const div = new MockElement('div');
        this.appendChild(div);
        const spanMatches = divMatch[1].matchAll(/<span\b[^>]*\bid="([^"]+)"[^>]*>/gi);
        for (const m of spanMatches) {
          const sp = new MockElement('span');
          sp.id = m[1];
          elements.set(sp.id, sp);
          div.appendChild(sp);
        }
      }
      const inputMatches = html.matchAll(/<input\b([^>]*)>/gi);
      for (const m of inputMatches) {
        const inp = new MockElement('input');
        const attrs = m[1];
        const idMatch = attrs.match(/\bid="([^"]+)"/);
        if (idMatch) { inp.id = idMatch[1]; elements.set(inp.id, inp); }
        const maxMatch = attrs.match(/\bmax="([^"]+)"/);
        if (maxMatch) inp.setAttribute('max', maxMatch[1]);
        const styleMatch = attrs.match(/\bstyle="([^"]+)"/);
        if (styleMatch) inp.style.cssText = styleMatch[1];
        this.appendChild(inp);
      }
    }
    get innerHTML() { return this._innerHTML; }
    contains(other) {
      let p = other;
      while (p) { if (p === this) return true; p = p.parentNode; }
      return false;
    }
  }

  const body = new MockElement('body');
  global.Event = class Event { constructor(type) { this.type = type; } };
  global.document = {
    body,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => elements.get(id) || null,
    addEventListener: () => {}
  };

  // Initialize panel
  setupDebugPanel({});

  // Button must exist in HTML (index.html has it) - just check SettingsManager defaults
  assert(SettingsManager.get('AI_VISION') === false, 'AI_VISION default should be false');

  // Programmatic toggle via SettingsManager should be possible
  SettingsManager.set('AI_VISION', true);
  assert(SettingsManager.get('AI_VISION') === true, 'AI_VISION must be toggleable');

  // NEW: Debug Overlay controls moved here — ensure UI IDs exist and are wired to SettingsManager
  setupDebugPanel({});
  const panelEl = document.getElementById('debug-panel');
  assert(panelEl, 'Debug panel element must be created');

  // Visual style assertion: unified white background + shared font + unified width/border
  assert(panelEl.style.cssText.indexOf('background: #ffffff') !== -1, 'Debug Panel must use white background');
  assert(panelEl.style.cssText.indexOf("'SF Mono'") !== -1, 'Debug Panel must use the unified monospace font');
  assert(panelEl.style.cssText.indexOf('width: 320px') !== -1, 'Debug Panel width must be unified to 320px');
  assert(panelEl.style.cssText.indexOf('border: 1px solid #e6eef8') !== -1, 'Debug Panel must use unified border style');

  const showOverlayEl = document.getElementById('dbg-SHOW_DEBUG_OVERLAY');
  assert(showOverlayEl, 'Show Debug Overlay checkbox must be in Debug Panel');

  // Verify the Show Debug Overlay toggle is the first control in the panel (top placement)
  const firstInput = panelEl.querySelector('input');
  assert(firstInput && firstInput.id === 'dbg-SHOW_DEBUG_OVERLAY', 'Show Debug Overlay should be the first control in Debug Panel');

  // Simulate user toggle via DOM event
  showOverlayEl.checked = true;
  showOverlayEl.dispatchEvent(new Event('change'));
  assert(SettingsManager.get('SHOW_DEBUG_OVERLAY') === true, 'SHOW_DEBUG_OVERLAY should update when checkbox changes');

  const whiskerEl = document.getElementById('dbg-DEBUG_WHISKER_STROKE_PX');
  assert(whiskerEl, 'DEBUG_WHISKER_STROKE_PX slider must be present in Debug Panel');

  // Ensure the slider input max attribute allows up to 3.0
  const whiskerRow = whiskerEl.parentNode.parentNode;
  const whiskerInput = whiskerRow ? whiskerRow.querySelector('input') : null;
  assert(whiskerInput && Number(whiskerInput.getAttribute('max')) === 3, 'DEBUG_WHISKER_STROKE_PX slider max should be 3');

  // Slider color should match the unified wizard accent color
  assert(whiskerInput && typeof whiskerInput.style === 'object' && String(whiskerInput.style.cssText).indexOf('accent-color:#3b82f6') !== -1, 'Debug panel sliders must use unified accent color (#3b82f6)');

  // Revert AI Vision
  SettingsManager.set('AI_VISION', false);

  console.log('debug-panel UI tests passed ✅');
})().catch(e => { console.error('debug-panel UI tests failed ❌', e); process.exit(1); });