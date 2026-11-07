(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Set up lightweight DOM shim before importing UI module
  const elements = new Map();
  class MockElement {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.id = '';
      this.style = { cssText: '' };
      this.children = [];
      this.parentNode = null;
      this.listeners = new Map();
      this._innerHTML = '';
      this.classList = { add: () => {}, remove: () => {}, toggle: () => {} };
    }
    setAttribute(k, v) { if (k === 'id') { this.id = v; elements.set(v, this); } }
    getAttribute() { return null; }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) elements.set(child.id, child);
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
    }
    addEventListener(ev, cb) {
      if (!this.listeners.has(ev)) this.listeners.set(ev, []);
      this.listeners.get(ev).push(cb);
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
      const spanMatches = html.matchAll(/<span\b[^>]*\bid="([^"]+)"[^>]*>/gi);
      for (const m of spanMatches) {
        const sp = new MockElement('span');
        sp.id = m[1];
        elements.set(sp.id, sp);
        this.appendChild(sp);
      }
      const inputMatches = html.matchAll(/<input\b([^>]*)>/gi);
      for (const m of inputMatches) {
        const inp = new MockElement('input');
        const idMatch = m[1].match(/\bid="([^"]+)"/);
        if (idMatch) { inp.id = idMatch[1]; elements.set(inp.id, inp); }
        this.appendChild(inp);
      }
    }
    get innerHTML() { return this._innerHTML; }
    contains() { return false; }
  }

  const body = new MockElement('body');
  const head = new MockElement('head');
  global.document = {
    body,
    head,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => elements.get(id) || null,
    querySelector: (sel) => body.querySelector(sel),
    addEventListener: () => {}
  };

  const { setupTuningWizard } = await import('../apps/sketchstudio/ui/tuning-wizard.js');
  const { SolverConfig } = await import('#core/solver-config.js');

  // Minimal fake state for initialization
  const state = { engine: { solve: () => {} } };

  // Ensure panel is created and contains the expected knobs
  setupTuningWizard(state);
  const panel = document.getElementById('tuning-wizard-panel');
  assert(panel, 'Tuning wizard panel should be present');

  // Visual style assertion: unified white background + shared font + unified width/border
  assert(panel.style.cssText.indexOf('background: #ffffff') !== -1, 'Tuning Wizard must use white background');
  assert(panel.style.cssText.indexOf("'SF Mono'") !== -1, 'Tuning Wizard must use the unified monospace font');
  assert(panel.style.cssText.indexOf('width: 320px') !== -1, 'Tuning Wizard width must be unified to 320px');
  assert(panel.style.cssText.indexOf('border: 1px solid #e6eef8') !== -1, 'Tuning Wizard must use unified border style');

  // Exposed (must exist)
  assert(document.getElementById('val-ITERATIONS'), 'ITERATIONS slider should be present');
  assert(document.getElementById('val-LM_LAMBDA_INIT'), 'LM_LAMBDA_INIT slider should be present');
  assert(document.getElementById('val-LM_LAMBDA_UP'), 'LM_LAMBDA_UP slider should be present');
  assert(document.getElementById('val-LM_LAMBDA_DOWN'), 'LM_LAMBDA_DOWN slider should be present');
  assert(document.getElementById('val-LM_TOL'), 'LM_TOL slider should be present');

  // Interaction / magnetism preserved
  assert(document.getElementById('val-DRAG_STRENGTH'), 'DRAG_STRENGTH should be present');
  assert(document.getElementById('val-SNAP_MAGNETISM'), 'SNAP_MAGNETISM should be present');
  assert(document.getElementById('val-GRID_MAGNETISM'), 'GRID_MAGNETISM should be present');
  // Whisker stroke slider moved to Debug Panel — no longer present in Tuning Wizard

  // Removed legacy sliders — these must NOT be present
  assert(!document.getElementById('val-CONSTRAINT_RATE'), 'CONSTRAINT_RATE slider must be removed');
  assert(!document.getElementById('val-RELAXATION'), 'RELAXATION slider must be removed');
  assert(!document.getElementById('val-SANDBOX_ITERATIONS'), 'SANDBOX_ITERATIONS slider must be removed');

  // Cleanup: remove panel from DOM so other tests aren't affected
  try { const p = document.getElementById('tuning-wizard-panel'); if (p && p.parentNode) p.parentNode.removeChild(p); } catch(_){}

  console.log('tuning-wizard UI tests passed ✅');
  process.exit(0);
})().catch(e => { console.error('tuning-wizard UI tests failed ❌', e); process.exit(1); });