(async () => {
  const { draw } = await import('../src/svg-renderer.js');
  const SettingsManager = (await import('../src/core/settings-manager.js')).default;
  const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Enable debug overlay + freedom labels
  SettingsManager.set('SHOW_DEBUG_OVERLAY', true);
  SettingsManager.set('SHOW_FREEDOM', true);

  // Mock SVG element
  const makeSVG = () => ({
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: ''
  });

  // Joints: endpoints (j1, j3) and an internal point projected onto the line (j2)
  const joints = new Map();
  joints.set('j1', { x: 0, y: 0 });
  joints.set('j2', { x: 50, y: 0 });
  joints.set('j3', { x: 100, y: 0 });

  // Line shape defined by j1 and j3 (true vertices)
  const shapes = [ { id: 'L1', type: 'line', joints: ['j1','j3'] } ];

  // Point-on-line constraint: j2 lies on L1 but is NOT a defining vertex
  const constraints = [ { type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: 'j2', shape: 'L1' } ];

  const svg = makeSVG();
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);

  // Labels should include (V) for endpoints and (I) for internal point
  const out = svg.innerHTML;
  assert(/j1\s*\(V\)/.test(out), 'j1 should be labeled as (V)');
  assert(/j3\s*\(V\)/.test(out), 'j3 should be labeled as (V)');
  assert(/j2\s*\(I\)/.test(out), 'j2 should be labeled as (I)');

  console.log('debug-label-vertex test passed ✅');
})().catch(e => { console.error('debug-label-vertex test failed ❌', e); process.exit(1); });