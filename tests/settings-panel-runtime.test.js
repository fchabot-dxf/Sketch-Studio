(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const mod = await import('../src/ui/settings-panel.js');

  // Minimal fake DOM the module expects
  // Ensure a minimal DOM shim exists (test runner may or may not provide one)
  if (typeof global.document === 'undefined' || typeof global.document.createElement !== 'function') {
    global.document = {
      createElement: (tag) => ({ tagName: String(tag).toUpperCase(), style: {}, classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); } }, appendChild(child){ this._children = this._children || []; this._children.push(child); child.parentNode = this; }, innerHTML: '', setAttribute: () => {}, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null }),
      body: { appendChild: () => {} },
      getElementById: () => null
    };
  }

  const settingsEl = document.createElement('div'); settingsEl.id = 'settings-panel';
  const exportEl = document.createElement('div'); exportEl.id = 'export-panel';
  const svg = document.createElement('svg');

  // Build label+input rows similar to the real HTML
  // Create label + numeric input for a row that should receive a slider
  const snapLabel = { tagName: 'LABEL', style: {}, _children: [], appendChild(child){ this._children.push(child); child.parentNode = this; }, querySelector: function(sel){ if (!sel) return null; if (sel === 'input[type="range"]') return this._children.find(c => c.tagName === 'INPUT' && c.type === 'range') || null; if (sel === 'input') return this._children.find(c => c.tagName === 'INPUT') || null; return null; } };
  const snapSpan = { tagName: 'SPAN', textContent: 'Snap Magnetism' };
  const snapInput = { tagName: 'INPUT', id: 's-snap-mag', type: 'number', value: '10', parentNode: snapLabel, addEventListener: () => {}, getAttribute: (k) => (k === 'min' ? null : null), style: {} };
  snapLabel._children.push(snapSpan); snapLabel._children.push(snapInput);

  const showGridLabel = { tagName: 'LABEL', style: {}, _children: [], appendChild(child){ this._children.push(child); child.parentNode = this; }, querySelector: function(sel){ if (!sel) return null; if (sel === 'input[type="range"]') return this._children.find(c => c.tagName === 'INPUT' && c.type === 'range') || null; if (sel === 'input') return this._children.find(c => c.tagName === 'INPUT') || null; return null; } };
  const showGridSpan = { tagName: 'SPAN', textContent: 'Show Grid' };
  const showGridInput = { tagName: 'INPUT', id: 's-show-grid', type: 'checkbox', parentNode: showGridLabel, addEventListener: () => {}, style: {} };
  showGridLabel._children.push(showGridSpan); showGridLabel._children.push(showGridInput);

  // Add a label that deliberately contains a Tailwind utility that should be removed
  const badLabel = { tagName: 'LABEL', style: {}, className: 'items-center text-sm text-slate-700', classList: { _s: new Set(['items-center','text-sm','text-slate-700']), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); } }, _children: [], appendChild(child){ this._children.push(child); child.parentNode = this; }, querySelector: function(sel){ if (!sel) return null; if (sel === 'input[type="range"]') return this._children.find(c => c.tagName === 'INPUT' && c.type === 'range') || null; if (sel === 'input') return this._children.find(c => c.tagName === 'INPUT') || null; return null; } };
  const badSpan = { tagName: 'SPAN', textContent: 'Bad' };
  const badInput = { tagName: 'INPUT', id: 's-line-stroke', type: 'number', value: '1', parentNode: badLabel, addEventListener: () => {}, style: {} };
  badLabel._children.push(badSpan); badLabel._children.push(badInput);

  // Append rows to the fake settings panel (use a simple children array + querySelectorAll)
  settingsEl._children = [snapLabel, showGridLabel, badLabel];
  settingsEl.appendChild = function(c){ this._children.push(c); c.parentNode = this; };
  settingsEl.querySelectorAll = function(sel){
    if (sel === 'label') return this._children.filter(ch => ch.tagName === 'LABEL');
    if (sel === '*') return this._children;
    if (sel === 'input[type="range"]') return this._children.flatMap(ch => (ch._children || []).filter(x => x.tagName === 'INPUT' && x.type === 'range'));
    return [];
  };

  // Provide document.getElementById() so setupSettingsPanel can find elements
  document.getElementById = (id) => {
    if (id === 'settings-panel') return settingsEl;
    if (id === 'export-panel') return exportEl;
    if (id === 's-snap-mag') return snapInput;
    if (id === 's-show-grid') return showGridInput;
    if (id === 's-line-stroke') return badInput;
    if (id === 'btn-settings-toggle') return { addEventListener: () => {} };
    if (id === 'btn-settings-close') return { addEventListener: () => {}, style: {} };
    if (id === 's-save-project') return { addEventListener: () => {}, title: '', setAttribute: () => {} };
    if (id === 's-reset') return { addEventListener: () => {} };
    if (id === 's-close') return { addEventListener: () => {} };
    if (id === 's-save-help') return { className: 'text-xs text-slate-400 mt-1' };
    return null;
  };

  // Call the setup function (this will call normalizeExistingPanel + append sliders)
  mod.setupSettingsPanel(svg, null);

  // 1) Panel should be normalized (class applied or inline font family present)
  assert(settingsEl.classList.contains('ss-wizard-panel') || /'SF Mono'/.test(settingsEl.style.cssText), 'settings-panel should be normalized with ss-wizard-panel / SF Mono');
  assert(exportEl.classList.contains('ss-wizard-panel') || /'SF Mono'/.test(exportEl.style.cssText), 'export-panel should be normalized by setupSettingsPanel');

  // 2) Slider appended for numeric input and label stacked vertically
  const slider = snapLabel.querySelector('input[type="range"]');
  assert(slider, 'numeric input rows must get a slider appended');
  assert(snapLabel.style.flexDirection === 'column', 'label with slider should use vertical stacking (flex-direction: column)');

  // 3) Slider must have unified accent color applied inline by normalization/creation
  assert(/accent-color:?\s*#3b82f6/i.test(slider.style.cssText), 'appended slider must have accent-color:#3b82f6');

  // 4) Checkbox rows must NOT get sliders
  assert(!showGridLabel.querySelector('input[type="range"]'), 'checkbox rows must not receive a slider');

  // 5) Static Tailwind typography classes should be removed from child elements (text-sm, text-slate-700)
  const anyBadClasses = Array.from(settingsEl.querySelectorAll('*')).some(ch => ch.classList && (ch.classList.contains('text-sm') || ch.classList.contains('text-slate-700')));
  assert(!anyBadClasses, 'no child elements should retain text-sm or text-slate-700 after normalization');

  // 6) normalizeExistingPanel should have applied label row normalization (display:flex, gap, margin)
  const labelRows = settingsEl.querySelectorAll('label');
  assert(labelRows.length > 0 && labelRows.every(l => typeof l.style.cssText === 'string' && l.style.cssText.indexOf('display:flex') !== -1), 'label rows should be normalized to flex rows with spacing');

  console.log('settings-panel runtime tests passed ✅');
})().catch(e => { console.error('settings-panel runtime tests failed ❌', e); process.exit(1); });