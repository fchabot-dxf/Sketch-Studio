(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const SettingsManager = (await import('../src/core/settings-manager.js')).default;
  const { setupSettingsPanel } = await import('../apps/sketchstudio/ui/settings-panel.js');

  // Minimal DOM shim that supports the bits used by setupSettingsPanel
  const elementMap = {};
  global.document = global.document || {};

  // Lightweight createElement that records children/listeners
  document.createElement = (tag) => {
    const el = {
      tagName: (tag || '').toUpperCase(),
      style: {},
      children: [],
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      _listeners: {},
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      addEventListener(evt, cb) { this._listeners[evt] = this._listeners[evt] || []; this._listeners[evt].push(cb); },
      dispatchEvent(ev) { const l = this._listeners && this._listeners[ev.type]; if (l) l.forEach(cb => cb(ev)); },
      setAttribute: () => {},
      getAttribute(name) { return this[name]; }
    };
    return el;
  };

  // Helper to create a label+input pair similar to index.html
  const makeLabeledInput = (id, type = 'number', value = '0', attr = {}) => {
    const label = document.createElement('label');
    label.style = label.style || {};
    label.classList = label.classList || { add: () => {}, remove: () => {}, contains: () => false };
    const span = document.createElement('span');
    const input = document.createElement('input');
    input.id = id; input.type = type; input.value = String(value);
    Object.keys(attr).forEach(k => { input[k] = attr[k]; });
    // parent/child linkage
    label.appendChild(span);
    label.appendChild(input);
    // store in element map
    elementMap[id] = input;
    // expose label via a synthetic id for tests if needed
    elementMap[id + '-label'] = label;
    return input;
  };

  // Build minimal DOM elements consumed by setupSettingsPanel
  elementMap['settings-panel'] = document.createElement('div');
  elementMap['btn-settings-toggle'] = document.createElement('button');
  elementMap['btn-settings-close'] = document.createElement('button');
  elementMap['s-save-project'] = document.createElement('button');
  elementMap['s-reset'] = document.createElement('button');
  elementMap['s-close'] = document.createElement('button');

  // numeric inputs (mirror index.html defaults/attributes)
  makeLabeledInput('s-snap-mag', 'number', 10, { step: '1', min: '0' });
  makeLabeledInput('s-grid-mag', 'number', 10, { step: '1', min: '0' });
  makeLabeledInput('s-grid-size', 'number', 2, { step: '0.5', min: '0.5' });
  makeLabeledInput('s-grid-major', 'number', 10, { step: '1', min: '1' });
  makeLabeledInput('s-line-stroke', 'number', 1.0, { step: '0.1', min: '0.1' });
  makeLabeledInput('s-joint-radius', 'number', 4, { step: '0.1', min: '0.1' });
  makeLabeledInput('s-joint-stroke-mult', 'number', 1.0, { step: '0.1', min: '0.1' });
  makeLabeledInput('s-selection-mult', 'number', 2, { step: '0.1', min: '0.1' });
  makeLabeledInput('s-hover-mult', 'number', 3, { step: '0.1', min: '0.1' });
  makeLabeledInput('s-glyph-icon', 'number', 20, { step: '1', min: '8' });
  makeLabeledInput('s-glyph-infer', 'number', 24, { step: '1', min: '8' });
  makeLabeledInput('s-glyph-offset', 'number', 40, { step: '1', min: '0' });
  makeLabeledInput('s-glow-width', 'number', 20, { step: '1', min: '0' });
  makeLabeledInput('s-dash-length', 'number', 8, { step: '1', min: '1' });
  makeLabeledInput('s-dash-gap', 'number', 8, { step: '1', min: '1' });
  // checkbox
  const cb = document.createElement('input'); cb.id = 's-show-grid'; cb.type = 'checkbox'; cb.checked = true; elementMap['s-show-grid'] = cb;

  // Implement getElementById to return from map
  document.getElementById = (id) => elementMap[id] || null;

  // Run setup (should attach sliders)
  setupSettingsPanel(document.createElement('svg'), null);

  // Assert sliders have been attached for each numeric input
  const keysToCheck = ['s-snap-mag','s-grid-mag','s-grid-size','s-grid-major','s-line-stroke','s-joint-radius','s-joint-stroke-mult','s-selection-mult','s-hover-mult','s-glyph-icon','s-glyph-infer','s-glyph-offset','s-glow-width','s-dash-length','s-dash-gap'];
  keysToCheck.forEach(id => {
    const input = document.getElementById(id);
    assert(input, `expected input ${id} to exist`);
    const label = elementMap[id + '-label'];
    const hasRange = label.children.some(c => c.tagName === 'INPUT' && c.type === 'range');
    assert(hasRange, `slider should be present for ${id}`);
  });

  // Simulate slider interaction for one control and verify SettingsManager updates
  const snapLabel = elementMap['s-snap-mag-label'];
  const snapSlider = snapLabel.children.find(c => c.tagName === 'INPUT' && c.type === 'range');
  assert(snapSlider, 'snap slider found');

  // slider should use the unified accent color
  assert(typeof snapSlider.style === 'object' && String(snapSlider.style.cssText).indexOf('accent-color:#3b82f6') !== -1, 'snap slider accent color should be unified (#3b82f6)');

  // find listener and call it (dispatchEvent is supported by our shim)
  snapSlider.value = '30';
  snapSlider.dispatchEvent({ type: 'input', target: snapSlider });

  // applyLocal should have updated SettingsManager
  assert(Number(SettingsManager.get('SNAP_MAGNETISM')) === 30, 'SNAP_MAGNETISM should update when slider moves');

  console.log('settings-panel sliders tests passed ✅');
})().catch(e => { console.error('settings-panel sliders tests failed ❌', e); process.exit(1); });