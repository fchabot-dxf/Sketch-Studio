(async () => {
  const { draw } = await import('../src/svg-renderer.js');
  const SettingsManager = (await import('../src/core/settings-manager.js')).default;
  const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Enable debug overlay + freedom whiskers
  SettingsManager.set('SHOW_DEBUG_OVERLAY', true);
  SettingsManager.set('SHOW_FREEDOM', true);

  // Mock SVG element (1:1 screen/world so scale(1) === 1)
  const makeSVG = () => ({
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: ''
  });

  // Build a slanted line (0,0) -> (10,10) and a joint constrained onto that line at (5,5)
  const joints = new Map();
  joints.set('a', { x: 0, y: 0 });
  joints.set('b', { x: 10, y: 10 });
  joints.set('j1', { x: 5, y: 5 });

  const shapes = [ { id: 'L1', type: 'line', joints: ['a','b'] } ];
  const constraints = [ { type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: 'j1', shape: 'L1' } ];

  const svg = makeSVG();
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);

  const out = svg.innerHTML;
  // Collect all debug-whisker line elements
  const matches = Array.from(out.matchAll(/<line[^>]*class="debug-whisker"[^>]*x1="([\d\.-]+)"[^>]*y1="([\d\.-]+)"[^>]*x2="([\d\.-]+)"[^>]*y2="([\d\.-]+)"/g));
  assert(matches.length >= 2, 'Expected at least two debug-whisker lines');

  const parsed = matches.map(m => m.slice(1).map(parseFloat));
  // Find those anchored near j1 (5,5)
  const near = (x, y) => Math.hypot(x - 5, y - 5) < 3;
  const candidates = parsed.filter(([x1, y1, x2, y2]) => near(x1, y1) || near(x2, y2));
  assert(candidates.length >= 2, 'Expected at least two whiskers anchored near joint j1');

  // Expected direction is along the line (45°): normalized (1/sqrt(2), 1/sqrt(2))
  const ex = (10 - 0) / Math.hypot(10, 10);
  const ey = (10 - 0) / Math.hypot(10, 10);

  let foundPos = false, foundNeg = false;
  for (const [x1, y1, x2, y2] of candidates) {
    const dx = x2 - x1, dy = y2 - y1; const m = Math.hypot(dx, dy);
    if (m < 1e-6) continue;
    const ux = dx / m, uy = dy / m;
    const dot = ux * ex + uy * ey;
    if (dot > 0.92) foundPos = true;     // aligned +direction
    if (dot < -0.92) foundNeg = true;    // aligned -direction
  }

  assert(foundPos && foundNeg, 'Expected bi-directional whiskers aligned with the line (+ and -)');

  console.log('debug-whisker-align test passed ✅');
})().catch(e => { console.error('debug-whisker-align test failed ❌', e); process.exit(1); });