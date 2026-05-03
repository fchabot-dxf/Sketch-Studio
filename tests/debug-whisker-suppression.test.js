(async () => {
  const { draw } = await import('../src/svg-renderer.js');
  const SettingsManager = (await import('../src/core/settings-manager.js')).default;
  const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  SettingsManager.set('SHOW_DEBUG_OVERLAY', true);
  SettingsManager.set('SHOW_FREEDOM', true);

  const makeSVG = () => ({
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: ''
  });

  // Case A: single grounded joint -> no whiskers
  const jointsA = new Map(); jointsA.set('a', { x: 0, y: 0, fixed: true });
  const svgA = makeSVG();
  draw(jointsA, [], svgA, null, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const outA = svgA.innerHTML;
  assert(!/class="debug-whisker"/.test(outA) && !/class="debug-whisker-arc"/.test(outA), 'No whiskers should render for a grounded single joint');

  // Case B: anchored distance -> anchor (fixed) should not render whisker; only the free joint should show arc
  const jointsB = new Map();
  jointsB.set('a', { x: 0, y: 0, fixed: true });
  jointsB.set('j1', { x: 100, y: 0 });
  const constraintsB = [ { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a','j1'] } ];
  const svgB = makeSVG();
  draw(jointsB, [], svgB, null, null, constraintsB, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const outB = svgB.innerHTML;

  // Expect at least one arc for j1 and no linear whiskers anchored at the grounded joint (no whiskers for 'a')
  assert(/class="debug-whisker-arc"/.test(outB), 'Expected arc whisker for free joint j1');
  // Single grounded joint 'a' should not produce its own whisker
  // (we already validated in Case A; here ensure overall whisker count is > 0 but not excessive)
  const totalWhiskers = (outB.match(/class="debug-whisker(-arc)?"/g) || []).length;
  assert(totalWhiskers >= 1 && totalWhiskers < 6, `Unexpected whisker count (got ${totalWhiskers})`);

  console.log('debug-whisker suppression tests passed ✅');
})().catch(e => { console.error('debug-whisker suppression test failed ❌', e); process.exit(1); });