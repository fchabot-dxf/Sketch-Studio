(async () => {
  const { draw } = await import('../apps/sketchstudio/svg-renderer.js');
  const SettingsManager = (await import('#core/settings-manager.js')).default;
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  SettingsManager.set('SHOW_DEBUG_OVERLAY', true);
  SettingsManager.set('SHOW_FREEDOM', true);

  // Helper: parse numeric attr
  const n = (s) => parseFloat(String(s || '').trim());

  // --- ARC WHISKER: stroke + radius must remain constant in SCREEN px across zoom ---
  const jointsA = new Map();
  jointsA.set('a', { x: 0, y: 0, fixed: true });
  jointsA.set('j1', { x: 100, y: 0 });
  const constraintsA = [ { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a','j1'] } ];

  const svg = {
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: ''
  };

  // Draw at zoom 1
  draw(jointsA, [], svg, null, null, constraintsA, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const out1 = svg.innerHTML;
  const arcMatch1 = out1.match(/<path[^>]*class="debug-whisker-arc"[^>]*d="M\s*([\-\d\.]+)\s+([\-\d\.]+)\s+A\s*([\-\d\.]+)\s+([\-\d\.]+)\s+[\d\s]+([\-\d\.]+)\s+([\-\d\.]+)"/);
  assert(arcMatch1, 'arc whisker not found at zoom 1');
  const rWorld1 = n(arcMatch1[3]);
  const swMatch1 = out1.match(/class="debug-whisker-arc"[^>]*stroke-width="([\d\.]+)"/);
  assert(swMatch1, 'arc stroke-width not found at zoom 1');
  const strokeW1 = n(swMatch1[1]);
  const zoom1 = svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
  const strokePx1 = strokeW1 / zoom1;
  const radiusPx1 = rWorld1 / zoom1;

  // Now zoom viewport (simulate zoom by doubling viewBox.width)
  svg.viewBox.baseVal.width = 1600; // zoom -> 2
  svg.innerHTML = '';
  draw(jointsA, [], svg, null, null, constraintsA, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const out2 = svg.innerHTML;
  const arcMatch2 = out2.match(/<path[^>]*class="debug-whisker-arc"[^>]*d="M\s*([\-\d\.]+)\s+([\-\d\.]+)\s+A\s*([\-\d\.]+)\s+([\-\d\.]+)\s+[\d\s]+([\-\d\.]+)\s+([\-\d\.]+)"/);
  assert(arcMatch2, 'arc whisker not found at zoom 2');
  const rWorld2 = n(arcMatch2[3]);
  const swMatch2 = out2.match(/class="debug-whisker-arc"[^>]*stroke-width="([\d\.]+)"/);
  assert(swMatch2, 'arc stroke-width not found at zoom 2');
  const strokeW2 = n(swMatch2[1]);
  const zoom2 = svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
  const strokePx2 = strokeW2 / zoom2;
  const radiusPx2 = rWorld2 / zoom2;

  assert(Math.abs(strokePx1 - strokePx2) < 1e-6, `Arc stroke (screen px) changed across zoom: ${strokePx1} vs ${strokePx2}`);
  assert(Math.abs(radiusPx1 - radiusPx2) < 1e-6, `Arc radius (screen px) changed across zoom: ${radiusPx1} vs ${radiusPx2}`);

  // --- LINEAR WHISKER: length should remain same in screen px across zoom ---
  const jointsB = new Map();
  jointsB.set('j1', { x: 100, y: 50 }); // unconstrained -> 2 DOF -> linear whiskers
  const svgB = {
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: ''
  };
  draw(jointsB, [], svgB, null, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const outB1 = svgB.innerHTML;
  const lineMatch1 = outB1.match(/<line[^>]*class="debug-whisker"[^>]*x1="([\d\.\-]+)"[^>]*y1="([\d\.\-]+)"[^>]*x2="([\d\.\-]+)"[^>]*y2="([\d\.\-]+)"/);
  assert(lineMatch1, 'linear whisker not found at zoom 1');
  const [lx1a, ly1a, lx1b, ly1b] = lineMatch1.slice(1).map(n);
  const lenWorld1 = Math.hypot(lx1b - lx1a, ly1b - ly1a);
  const lenPx1 = lenWorld1 / (svgB.viewBox.baseVal.width / svgB.getBoundingClientRect().width);

  // zoom and redraw
  svgB.viewBox.baseVal.width = 1600; svgB.innerHTML = '';
  draw(jointsB, [], svgB, null, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const outB2 = svgB.innerHTML;
  const lineMatch2 = outB2.match(/<line[^>]*class="debug-whisker"[^>]*x1="([\d\.\-]+)"[^>]*y1="([\d\.\-]+)"[^>]*x2="([\d\.\-]+)"[^>]*y2="([\d\.\-]+)"/);
  assert(lineMatch2, 'linear whisker not found at zoom 2');
  const [lx2a, ly2a, lx2b, ly2b] = lineMatch2.slice(1).map(n);
  const lenWorld2 = Math.hypot(lx2b - lx2a, ly2b - ly2a);
  const lenPx2 = lenWorld2 / (svgB.viewBox.baseVal.width / svgB.getBoundingClientRect().width);

  assert(Math.abs(lenPx1 - lenPx2) < 1e-6, `Linear whisker length changed in screen px across zoom: ${lenPx1} vs ${lenPx2}`);

  console.log('whisker-screen-scale test passed ✅');
})().catch(e => { console.error('whisker-screen-scale test failed ❌', e); process.exit(1); });