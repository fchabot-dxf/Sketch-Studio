(async () => {
  const { draw } = await import('../apps/sketchstudio/svg-renderer.js');
  const SettingsManager = (await import('../src/core/settings-manager.js')).default;
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Enable debug overlay and freedom labels
  SettingsManager.set('SHOW_DEBUG_OVERLAY', true);
  SettingsManager.set('SHOW_FREEDOM', true);

  // Mock DOM and canvas measure
  global.document = global.document || {};
  global.document.createElement = global.document.createElement || ((tag) => {
    if (tag === 'canvas') return { getContext: () => ({ measureText: (s) => ({ width: (String(s).length || 1) * 6 }), font: '' }) };
    return { style: {}, setAttribute: () => {}, appendChild: () => {}, innerText: '' };
  });

  const joints = new Map();
  joints.set('j1', { x: 100, y: 50 });
  const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ width: 800, height: 600 }), innerHTML: '' };

  // Case A: AI_VISION = false -> default spacing
  SettingsManager.set('AI_VISION', false);
  draw(joints, [], svg, null, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const outA = svg.innerHTML;
  const matchesA = Array.from(outA.matchAll(/<text[^>]*class="debug-joint-label"[^>]*y="([\d\.\-]+)"/g)).map(m => parseFloat(m[1]));
  assert(matchesA.length >= 1, 'Expected label text lines at AI_VISION=false');

  // Case B: AI_VISION = true -> tighter spacing; the vertical gap between lines should reduce
  SettingsManager.set('AI_VISION', true);
  svg.innerHTML = '';
  draw(joints, [], svg, null, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const outB = svg.innerHTML;
  const matchesB = Array.from(outB.matchAll(/<text[^>]*class="debug-joint-label"[^>]*y="([\d\.\-]+)"/g)).map(m => parseFloat(m[1]));
  assert(matchesB.length >= 1, 'Expected label text lines at AI_VISION=true');

  // If we have at least two lines, confirm spacing is tighter (or equal) under AI_VISION
  if (matchesA.length >= 2 && matchesB.length >= 2) {
    const gapA = Math.abs(matchesA[1] - matchesA[0]);
    const gapB = Math.abs(matchesB[1] - matchesB[0]);
    assert(gapB <= gapA + 1e-6, `Expected AI_VISION spacing <= normal spacing (${gapB} <= ${gapA})`);
  }

  // Cleanup
  SettingsManager.set('AI_VISION', false);

  console.log('ai-vision label spacing test passed ✅');
})().catch(e => { console.error('ai-vision label spacing test failed ❌', e); process.exit(1); });