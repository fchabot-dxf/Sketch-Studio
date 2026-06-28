(async () => {
  const { draw } = await import('../apps/sketchstudio/svg-renderer.js');
  const SettingsManager = (await import('../src/core/settings-manager.js')).default;
  const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Setup joints + failing constraint
  const joints = new Map();
  joints.set('a', { x: 0, y: 0, fixed: true });
  joints.set('b', { x: 100, y: 0 });
  const constraints = [ { id: 'C_FAIL', type: CONSTRAINT_TYPES.DISTANCE, joints: ['a','b'], value: 1.0 } ];

  const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ width: 800, height: 600 }), innerHTML: '' };

  // Simulate solver metrics with a failing residual for our constraint ID
  global.window = global.window || {};
  window.__lastSolveStats = { constraintErrors: [ { id: 'C_FAIL', residual: 0.5, satisfied: false } ] };

  // Enable debug overlay + AI vision (health reporting should append res: ...)
  SettingsManager.set('SHOW_DEBUG_OVERLAY', true);
  SettingsManager.set('SHOW_HEALTH', true);
  SettingsManager.set('AI_VISION', true);

  draw(joints, [], svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const out = svg.innerHTML;

  // Expect 'res:' text appended to label output and colored red
  assert(/res:\s*0\.5/.test(out) || /res:\s*0\.5000/.test(out), 'Expected residual text in label');
  assert(/fill="#ef4444"/.test(out), 'Expected residual text to be red (fill="#ef4444")');

  // Cleanup
  SettingsManager.set('AI_VISION', false);
  window.__lastSolveStats = null;

  console.log('debug-ai-health test passed ✅');
})().catch(e => { console.error('debug-ai-health test failed ❌', e); process.exit(1); });