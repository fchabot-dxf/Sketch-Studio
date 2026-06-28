(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const SettingsManager = (await import('../src/core/settings-manager.js')).default;
  const { setupDebugPanel } = await import('../apps/sketchstudio/ui/debug-panel.js');

  // Lightweight DOM shim
  global.document = global.document || {};
  global.document.createElement = global.document.createElement || (() => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, innerHTML: '' }));
  global.document.body = global.document.body || { appendChild: () => {} };
  global.document.getElementById = global.document.getElementById || (() => null);

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