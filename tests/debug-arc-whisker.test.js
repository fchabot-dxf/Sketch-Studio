(async () => {
  const { draw } = await import('../src/svg-renderer.js');
  const SettingsManager = (await import('../src/core/settings-manager.js')).default;
  const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Enable debug overlay + freedom whiskers and tightened label spacing
  SettingsManager.set('SHOW_DEBUG_OVERLAY', true);
  SettingsManager.set('SHOW_FREEDOM', true);
  SettingsManager.set('DEBUG_LABEL_LINE_SPACING', 1.1);
  SettingsManager.set('DEBUG_LABEL_INTRA_LINE_SPACING', 0.9);

  // Mock SVG element (1:1 screen/world so scale(1) === 1)
  const makeSVG = () => ({
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: ''
  });

  // Anchor fixed at origin, joint at x=100 (distance 100px -> radius clamp to 40px)
  const joints = new Map();
  joints.set('a', { x: 0, y: 0, fixed: true });
  joints.set('j1', { x: 100, y: 0 });

  const shapes = [];
  const constraints = [ { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a','j1'] } ];

  const svg = makeSVG();
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);

  const out = svg.innerHTML;
  assert(/class="debug-whisker-arc"/.test(out), 'Expected debug-whisker-arc element');

  // parse path: M sx sy A rx ry 0 0 1 ex ey
  const m = out.match(/<path[^>]*class="debug-whisker-arc"[^>]*d="M\s*([\-\d\.]+)\s+([\-\d\.]+)\s+A\s*([\-\d\.]+)\s+([\-\d\.]+)\s+0\s+0\s+1\s*([\-\d\.]+)\s+([\-\d\.]+)"/);
  assert(m, 'Could not parse debug-whisker-arc path');

  const sx = parseFloat(m[1]), sy = parseFloat(m[2]);
  const rx = parseFloat(m[3]);
  const ex = parseFloat(m[5]), ey = parseFloat(m[6]);

  // Zoom is 1 in our mock; distance = 100 => clamped radius = 40
  const expectedR = 40;
  assert(Math.abs(rx - expectedR) < 0.5, `Expected radius ≈ ${expectedR}px (got ${rx})`);

  // Ensure arc whisker stroke is reduced to an ultra-minimal width (screen px)
  const swMatch = out.match(/class="debug-whisker-arc"[^>]*stroke-width="([\d\.]+)"/);
  assert(swMatch, 'debug-whisker-arc stroke-width not found');
  const strokeW = parseFloat(swMatch[1]);
  const expectedStroke = 0.03; // minimum stroke used in renderer (scale(0.03) == 0.03 in test)
  assert(Math.abs(strokeW - expectedStroke) < 0.02, `Expected stroke-width ≈ ${expectedStroke} (got ${strokeW})`);

  // Base angle is 0 (joint at +X). Start point should be at -15°, end at +15°
  const deg15 = 15 * Math.PI / 180;
  const sxExp = expectedR * Math.cos(-deg15);
  const syExp = expectedR * Math.sin(-deg15);
  const exExp = expectedR * Math.cos(deg15);
  const eyExp = expectedR * Math.sin(deg15);

  assert(Math.abs(sx - sxExp) < 0.75, `Start X near expected (${sx} ~= ${sxExp})`);
  assert(Math.abs(sy - syExp) < 0.75, `Start Y near expected (${sy} ~= ${syExp})`);
  assert(Math.abs(ex - exExp) < 0.75, `End X near expected (${ex} ~= ${exExp})`);
  assert(Math.abs(ey - eyExp) < 0.75, `End Y near expected (${ey} ~= ${eyExp})`);

  console.log('debug-arc-whisker test passed ✅');
})().catch(e => { console.error('debug-arc-whisker test failed ❌', e); process.exit(1); });