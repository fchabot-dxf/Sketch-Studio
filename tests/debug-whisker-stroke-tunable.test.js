(async () => {
  const { draw } = await import('../apps/sketchstudio/svg-renderer.js');
  const SettingsManager = (await import('../src/core/settings-manager.js')).default;
  const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Lightweight DOM shim for renderer tests
  global.document = global.document || {
    getElementById: () => null,
    head: { appendChild: () => {} },
    createElement: (tag) => {
      if (tag === 'canvas') {
        return { getContext: () => ({ measureText: (s) => ({ width: (String(s).length || 1) * 6 }), font: '' }) };
      }
      return { style: {}, setAttribute: () => {}, appendChild: () => {}, innerText: '' };
    }
  };

  SettingsManager.set('SHOW_DEBUG_OVERLAY', true);
  SettingsManager.set('SHOW_FREEDOM', true);

  // Mock SVG element (1:1 screen/world so scale(1) === 1)
  const makeSVG = () => ({
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: ''
  });

  // --- ARC whisker respects DEBUG_WHISKER_STROKE_PX ---
  SettingsManager.set('DEBUG_WHISKER_STROKE_PX', 0.12);

  const joints = new Map();
  joints.set('a', { x: 0, y: 0, fixed: true });
  joints.set('j1', { x: 100, y: 0 });
  const constraints = [ { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a','j1'] } ];

  const svg = makeSVG();
  draw(joints, [], svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const out = svg.innerHTML;

  const arcStrokeMatch = out.match(/class="debug-whisker-arc"[^>]*stroke-width="([\d\.]+)"/);
  assert(arcStrokeMatch, 'arc whisker stroke-width not found');
  const arcStroke = parseFloat(arcStrokeMatch[1]);
  assert(Math.abs(arcStroke - 0.12) < 1e-6, `Arc whisker stroke should reflect DEBUG_WHISKER_STROKE_PX (expected 0.12, got ${arcStroke})`);

  // --- LINEAR whisker respects DEBUG_WHISKER_STROKE_PX ---
  const jointsB = new Map();
  jointsB.set('j1', { x: 100, y: 50 }); // unconstrained -> linear whiskers
  const svgB = makeSVG();
  draw(jointsB, [], svgB, null, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const outB = svgB.innerHTML;

  const lineMatch = outB.match(/<line[^>]*class="debug-whisker"[^>]*stroke-width="([\d\.]+)"/);
  assert(lineMatch, 'linear whisker stroke-width not found');
  const lineStroke = parseFloat(lineMatch[1]);
  assert(Math.abs(lineStroke - 0.12) < 1e-6, `Linear whisker stroke should reflect DEBUG_WHISKER_STROKE_PX (expected 0.12, got ${lineStroke})`);

  console.log('debug-whisker-stroke tunable test passed ✅');
})().catch(e => { console.error('debug-whisker-stroke tunable test failed ❌', e); process.exit(1); });