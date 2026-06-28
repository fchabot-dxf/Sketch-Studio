(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const setup = await import('../apps/sketchstudio/ui/settings-panel.js');

  // Minimal DOM shim (deterministic, small but compatible with normalizeExistingPanel)
  global.document = global.document || {};
  if (typeof global.document.createElement !== 'function') {
    global.document.createElement = (tag) => ({
      tagName: String(tag).toUpperCase(),
      style: { cssText: '' },
      classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); } },
      _children: [],
      appendChild(c){ this._children.push(c); c.parentNode = this; },
      querySelectorAll(sel){ if (sel === 'label') return this._children.filter(x => x.tagName === 'LABEL'); return []; },
      querySelector(sel){ return this._children.find(x => x.tagName === 'LABEL') || null; },
      setAttribute: () => {},
      addEventListener: () => {},
      innerHTML: ''
    });
    global.document.body = { appendChild: () => {} };
  }

  // Build a realistic settings panel DOM (reuse the working structure from the runtime test)
  const el = document.createElement('div'); el.id = 'settings-panel';

  // Create label + numeric input for a row that should receive a slider
  const snapLabel = { tagName: 'LABEL', style: {}, _children: [], appendChild(child){ this._children.push(child); child.parentNode = this; }, querySelector: function(sel){ if (!sel) return null; if (sel === 'input[type"range"]' || sel === 'input[type="range"]') return this._children.find(c => c.tagName === 'INPUT' && c.type === 'range') || null; if (sel === 'input') return this._children.find(c => c.tagName === 'INPUT') || null; return null; } };
  const snapSpan = { tagName: 'SPAN', textContent: 'Snap Magnetism' };
  const snapInput = { tagName: 'INPUT', id: 's-snap-mag', type: 'number', value: '10', parentNode: snapLabel, addEventListener: () => {}, getAttribute: (k) => (k === 'min' ? null : null), style: {} };
  snapLabel._children.push(snapSpan); snapLabel._children.push(snapInput);

  const showGridLabel = { tagName: 'LABEL', style: {}, _children: [], appendChild(child){ this._children.push(child); child.parentNode = this; }, querySelector: function(sel){ if (!sel) return null; if (sel === 'input[type"range"]' || sel === 'input[type="range"]') return this._children.find(c => c.tagName === 'INPUT' && c.type === 'range') || null; if (sel === 'input') return this._children.find(c => c.tagName === 'INPUT') || null; return null; } };
  const showGridSpan = { tagName: 'SPAN', textContent: 'Show Grid' };
  const showGridInput = { tagName: 'INPUT', id: 's-show-grid', type: 'checkbox', parentNode: showGridLabel, addEventListener: () => {}, style: {} };
  showGridLabel._children.push(showGridSpan); showGridLabel._children.push(showGridInput);

  // Add a label that deliberately contains a Tailwind utility that should be removed
  const badLabel = { tagName: 'LABEL', style: {}, className: 'items-center text-sm text-slate-700', classList: { _s: new Set(['items-center','text-sm','text-slate-700']), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); }, contains(c){ return this._s.has(c); } }, _children: [], appendChild(child){ this._children.push(child); child.parentNode = this; }, querySelector: function(sel){ if (!sel) return null; if (sel === 'input[type"range"]' || sel === 'input[type="range"]') return this._children.find(c => c.tagName === 'INPUT' && c.type === 'range') || null; if (sel === 'input') return this._children.find(c => c.tagName === 'INPUT') || null; return null; } };
  const badSpan = { tagName: 'SPAN', textContent: 'Bad' };
  const badInput = { tagName: 'INPUT', id: 's-line-stroke', type: 'number', value: '1', parentNode: badLabel, addEventListener: () => {}, style: {} };
  badLabel._children.push(badSpan); badLabel._children.push(badInput);

  // Create additional numeric rows to match the real Settings panel
  const gridMagLabel = { tagName: 'LABEL', style: {}, _children: [], appendChild(child){ this._children.push(child); child.parentNode = this; }, querySelector(sel){ if (!sel) return null; if (sel === 'input[type"range"]' || sel === 'input[type="range"]') return this._children.find(c => c.tagName === 'INPUT' && c.type === 'range') || null; if (sel === 'input') return this._children.find(c => c.tagName === 'INPUT') || null; return null; } };
  const gridMagSpan = { tagName: 'SPAN', textContent: 'Grid Magnetism' };
  const gridMagInput = { tagName: 'INPUT', id: 's-grid-mag', type: 'number', value: '10', parentNode: gridMagLabel, addEventListener: () => {}, style: {} };
  gridMagLabel._children.push(gridMagSpan); gridMagLabel._children.push(gridMagInput);

  const gridSizeLabel = { tagName: 'LABEL', style: {}, _children: [], appendChild(child){ this._children.push(child); child.parentNode = this; }, querySelector(sel){ if (!sel) return null; if (sel === 'input[type"range"]' || sel === 'input[type="range"]') return this._children.find(c => c.tagName === 'INPUT' && c.type === 'range') || null; if (sel === 'input') return this._children.find(c => c.tagName === 'INPUT') || null; return null; } };
  const gridSizeSpan = { tagName: 'SPAN', textContent: 'Grid Size' };
  const gridSizeInput = { tagName: 'INPUT', id: 's-grid-size', type: 'number', value: '2', parentNode: gridSizeLabel, addEventListener: () => {}, style: {} };
  gridSizeLabel._children.push(gridSizeSpan); gridSizeLabel._children.push(gridSizeInput);

  const gridMajorLabel = { tagName: 'LABEL', style: {}, _children: [], appendChild(child){ this._children.push(child); child.parentNode = this; }, querySelector(sel){ if (!sel) return null; if (sel === 'input[type"range"]' || sel === 'input[type="range"]') return this._children.find(c => c.tagName === 'INPUT' && c.type === 'range') || null; if (sel === 'input') return this._children.find(c => c.tagName === 'INPUT') || null; return null; } };
  const gridMajorSpan = { tagName: 'SPAN', textContent: 'Grid Major Step' };
  const gridMajorInput = { tagName: 'INPUT', id: 's-grid-major', type: 'number', value: '10', parentNode: gridMajorLabel, addEventListener: () => {}, style: {} };
  gridMajorLabel._children.push(gridMajorSpan); gridMajorLabel._children.push(gridMajorInput);

  // Append rows to the fake settings panel (use a simple children array + querySelectorAll)
  el._children = [showGridLabel, snapLabel, gridMagLabel, gridSizeLabel, gridMajorLabel];
  el.appendChild = function(c){ this._children.push(c); c.parentNode = this; };
  el.querySelectorAll = function(sel){
    if (sel === 'label') return this._children.filter(ch => ch.tagName === 'LABEL');
    if (sel === '*') return this._children;
    if (sel === 'input[type="range"]') return this._children.flatMap(ch => (ch._children || []).filter(x => x.tagName === 'INPUT' && x.type === 'range'));
    return [];
  };

  // Minimal additional elements the module expects
  const exportEl = document.createElement('div'); exportEl.id = 'export-panel';
  // Provide element lookups for the inputs/controls used by setupSettingsPanel
  const inputById = {};
  (el._children || []).forEach(r => {
    const input = (r._children || [])[1];
    if (input && input.id) inputById[input.id] = input;
  });

  document.getElementById = (id) => {
    if (id === 'settings-panel') return el;
    if (id === 'export-panel') return exportEl;
    if (id === 'btn-settings-toggle') return { addEventListener: () => {} };
    if (id === 's-save-project') return { addEventListener: () => {}, title: '', setAttribute: () => {} };
    if (id === 's-reset') return { addEventListener: () => {} };
    if (id === 's-close') return { addEventListener: () => {} };
    if (id === 's-save-help') return { className: 'text-xs text-slate-400 mt-1' };
    if (inputById[id]) return inputById[id];
    return null;
  };

  // Sanity-check that document.getElementById will return our input objects
  // (helps ensure setupSettingsPanel can find the numeric inputs it should attach sliders to)
  // NOTE: these logs are temporary diagnostics to validate the shim
  // console.log('DBG get s-snap-mag ->', !!document.getElementById('s-snap-mag'));
  // console.log('DBG get s-grid-mag ->', !!document.getElementById('s-grid-mag'));
  // console.log('DBG get s-grid-size ->', !!document.getElementById('s-grid-size'));

  // Run setup (this invokes normalizeExistingPanel and appends sliders)
  setup.setupSettingsPanel(document.createElement('svg'), null);

  // Collect canonical snapshot pieces
  const canonicalStyleTokens = (s) => {
    const tokens = [
      'position: fixed', 'width: 320px', 'background: #ffffff', "font-family: 'SF Mono'", 'font-size: 11px', 'border: 1px solid #e6eef8'
    ];
    return tokens.map(t => `${t}:${s.indexOf(t) !== -1}`).join('|');
  };

  const rootStyle = el.style && el.style.cssText ? el.style.cssText : '';
  const headerPresent = el._children && el._children.length ? String(el._children[0].tagName === 'DIV' || true) : 'false';
  const labelOrder = (el._children || []).filter(ch => ch.tagName === 'LABEL').map(l => (l._children && l._children[0] && l._children[0].textContent) || '').join('||');
  // Robustly compute slider count by scanning label children (DOM shim may not support selector queries)
  const sliderCount = (el._children || []).flatMap(ch => (ch._children || []).filter(c => c.tagName === 'INPUT' && c.type === 'range')).length || 0;
  // find first slider style if present (scan nested children)
  const firstSlider = (function(){ for (const lbl of (el._children || [])) { const s = (lbl._children || []).find(c => c.tagName === 'INPUT' && c.type === 'range'); if (s) return (s.style && s.style.cssText) || ''; } return ''; })();

  const snapshot = [
    'ROOT_STYLE_TOKENS:' + canonicalStyleTokens(rootStyle),
    'HAS_SS_WIZARD_CLASS:' + (el.classList && el.classList.contains('ss-wizard-panel')),
    'LABEL_ORDER:' + labelOrder,
    'SLIDER_COUNT:' + sliderCount,
    'FIRST_SLIDER_STYLE:' + firstSlider.trim()
  ].join('\n');

  // Expected snapshot (keeps key visual tokens stable)
  const expected = `ROOT_STYLE_TOKENS:position: fixed:true|width: 320px:true|background: #ffffff:true|font-family: 'SF Mono':true|font-size: 11px:true|border: 1px solid #e6eef8:true
HAS_SS_WIZARD_CLASS:true
LABEL_ORDER:Show Grid||Snap Magnetism||Grid Magnetism||Grid Size||Grid Major Step
SLIDER_COUNT:4
FIRST_SLIDER_STYLE:width:100%; margin-top:6px; accent-color:#3b82f6; cursor:pointer;`;

  // Normalize whitespace for comparison
  const normalize = s => String(s).replace(/\s+/g, ' ').trim();

  assert(normalize(snapshot) === normalize(expected), `Settings panel visual snapshot mismatch:\n--- got ---\n${snapshot}\n--- expected ---\n${expected}`);

  console.log('settings-panel visual snapshot test passed ✅');
})().catch(e => { console.error('settings-panel visual snapshot test failed ❌', e); process.exit(1); });