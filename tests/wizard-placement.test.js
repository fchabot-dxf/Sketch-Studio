(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const { createWizardPanel, normalizeExistingPanel, PANEL_STACK_SPACING } = await import('../apps/sketchstudio/ui/wizard-base.js');

  // Clean DOM shim for style checks
  global.document = global.document || {};
  document.createElement = document.createElement || ((t) => ({ style: {}, appendChild: () => {}, id: '' }));

  // Create two bottom-right panels and assert they stack vertically (bottom offsets differ by spacing)
  const a = createWizardPanel({ id: 'w-a', title: 'A', zone: 'bottom-right' });
  const b = createWizardPanel({ id: 'w-b', title: 'B', zone: 'bottom-right' });

  // Panels should be centered fixed elements appended to body
  assert(a.panel.parentNode === document.body, 'first panel must be appended into document.body');
  assert(b.panel.parentNode === document.body, 'second panel must be appended into document.body');
  // Panels should be fixed and centered (top:50% + transform)
  assert(a.panel.style.cssText.indexOf('top: 50%') !== -1 && a.panel.style.cssText.indexOf('transform: translate(-50%, -50%)') !== -1, 'panels should be centered on-screen');
  assert(b.panel.style.cssText.indexOf('top: 50%') !== -1 && b.panel.style.cssText.indexOf('transform: translate(-50%, -50%)') !== -1, 'panels should be centered on-screen');

  // Top/Bottom zones removed — createWizardPanel defaults to centered
  const c = createWizardPanel({ id: 'w-c', title: 'C' });
  const d = createWizardPanel({ id: 'w-d', title: 'D' });
  assert(c.panel.parentNode === document.body && d.panel.parentNode === document.body, 'additional panels are appended to body');

  // Test normalizeExistingPanel applies centered style to existing element
  const fake = { id: 'existing-panel', style: { cssText: '' }, parentNode: null, removeChild: () => {}, appendChild: () => {} };
  const realGet = document.getElementById.bind(document);
  document.getElementById = (id) => id === 'existing-panel' ? fake : realGet(id);
  const norm = normalizeExistingPanel('existing-panel', { center: true });
  assert(norm === fake, 'normalizeExistingPanel should return the existing element');
  assert(fake.style.cssText.indexOf('top: 50%') !== -1 && fake.style.cssText.indexOf('transform: translate(-50%, -50%)') !== -1, 'normalizeExistingPanel should center the existing element');
  document.getElementById = realGet;

  console.log('wizard placement tests passed ✅');
})().catch(e => { console.error('wizard-placement tests failed ❌', e); process.exit(1); });