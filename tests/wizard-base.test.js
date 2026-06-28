(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const { applyPanelStyle } = await import('../apps/sketchstudio/ui/wizard-base.js');

  // Minimal fake element
  const el = { style: { cssText: '' } };
  applyPanelStyle(el, { width: 300, position: { bottom: '40px', right: '40px' }, display: 'block', padding: 12 });

  const css = el.style.cssText;
  assert(css.indexOf('background: #ffffff') !== -1, 'panel should have white background');
  assert(css.indexOf("'SF Mono'") !== -1, 'panel should use monospace font');
  assert(css.indexOf('width: 300px') !== -1, 'width should be applied');
  assert(css.indexOf('bottom: 40px') !== -1, 'position bottom should be applied');
  assert(css.indexOf('display: block') !== -1, 'display should be applied when provided');

  // Test createWizardPanel factory
  const created = await import('../apps/sketchstudio/ui/wizard-base.js');
  const { createWizardPanel } = created;
  const { panel: p2, header, closeBtn } = createWizardPanel({ id: 'x-test', title: 'Hello', closeId: 'x-close', width: 220, position: { bottom: '10px', right: '10px' }, padding: 8, display: 'block', center: false });
  assert(p2 && p2.id === 'x-test', 'createWizardPanel should create panel with id');
  assert(header && closeBtn && closeBtn.id === 'x-close', 'createWizardPanel should create header and close button');

  // createWizardPanel with no width should default to unified width (320px) and center by default
  const { panel: p3 } = createWizardPanel({ id: 'x-default', title: 'Default' });
  assert(p3 && p3.style && p3.style.cssText.indexOf('width: 320px') !== -1, 'createWizardPanel should default to width: 320px');
  assert(p3.style.cssText.indexOf('top: 50%') !== -1 && p3.style.cssText.indexOf('transform: translate(-50%, -50%)') !== -1, 'createWizardPanel should center panels by default');

  console.log('wizard-base tests passed ✅');
})().catch(e => { console.error('wizard-base tests failed ❌', e); process.exit(1); });