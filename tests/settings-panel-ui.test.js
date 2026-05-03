(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const mod = await import('../src/ui/settings-panel.js');
  const { applyPanelStyle } = await import('../src/ui/wizard-base.js');

  // Provide a minimal DOM shape the module expects
  global.document = global.document || {};
  const settingsEl = document.createElement('div'); settingsEl.id = 'settings-panel';
  const exportEl = document.createElement('div'); exportEl.id = 'export-panel';

  // insert into the fake DOM so setupSettingsPanel can find them
  document.getElementById = (id) => (id === 'settings-panel' ? settingsEl : (id === 'export-panel' ? exportEl : null));

  // Call setup explicitly (module auto-setup is DOMContentLoaded guarded)
  if (typeof mod.setupSettingsPanel !== 'function') throw new Error('setupSettingsPanel missing');
  mod.setupSettingsPanel(document.createElement('svg'), null);

  // Ensure applyPanelStyle normalization was applied to both panels and they are centered
  assert(settingsEl.style.cssText.indexOf('background: #ffffff') !== -1, 'Settings panel should have white background');
  assert(settingsEl.style.cssText.indexOf("'SF Mono'") !== -1, 'Settings panel should use unified monospace font');
  assert(settingsEl.style.cssText.indexOf('width: 320px') !== -1, 'Settings panel should use unified width');
  assert(settingsEl.style.cssText.indexOf('border: 1px solid #e6eef8') !== -1, 'Settings panel should use unified border style');
  assert(exportEl.style.cssText.indexOf('background: #ffffff') !== -1, 'Export panel should have white background');
  assert(exportEl.style.cssText.indexOf("'SF Mono'") !== -1, 'Export panel should use unified monospace font');
  assert(exportEl.style.cssText.indexOf('width: 320px') !== -1, 'Export panel should use unified width');
  assert(exportEl.style.cssText.indexOf('border: 1px solid #e6eef8') !== -1, 'Export panel should use unified border style');

  // Panels should be centered on-screen after normalization
  assert(settingsEl.style.cssText.indexOf('top: 50%') !== -1 && settingsEl.style.cssText.indexOf('transform: translate(-50%, -50%)') !== -1, 'Settings panel should be centered after normalization');
  assert(exportEl.style.cssText.indexOf('top: 50%') !== -1 && exportEl.style.cssText.indexOf('transform: translate(-50%, -50%)') !== -1, 'Export panel should be centered after normalization');

  console.log('settings-panel UI tests passed ✅');
})().catch(e => { console.error('settings-panel-ui tests failed ❌', e); process.exit(1); });