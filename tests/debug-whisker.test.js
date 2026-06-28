(async () => {
  const { draw } = await import('../packages/ui/svg-renderer.js');
  const SettingsManager = (await import('#core/settings-manager.js')).default;
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal DOM shim required by renderer (canvas measurement + head append)
  global.document = global.document || {};
  global.document.head = global.document.head || { appendChild(){} };
  global.document.getElementById = global.document.getElementById || (() => null);
  global.document.createElement = (tag) => {
    if (tag === 'canvas') {
      return { getContext: () => ({ measureText: (s) => ({ width: (s || '').length * 7 }) }) };
    }
    return { getContext: () => null, setAttribute() {}, appendChild() {}, style: {} };
  };

  // Enable debug overlay + freedom whiskers
  SettingsManager.set('SHOW_DEBUG_OVERLAY', true);
  SettingsManager.set('SHOW_FREEDOM', true);

  // Mock SVG element (1:1 screen/world so scale(1) === 1)
  const makeSVG = () => ({
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: ''
  });

  const joints = new Map();
  // Single unconstrained joint (DOF == 2) so both X/Y whiskers should appear
  joints.set('j1', { x: 100, y: 50 });

  const shapes = [];
  const constraints = [];

  const svg = makeSVG();
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);

  const out = svg.innerHTML;
  // At least one whisker line should be rendered
  assert(/class="debug-whisker"/.test(out), 'Expected at least one debug-whisker element');

  // Find a horizontal whisker (x1 > joint.x) and ensure it starts offset from the joint center
  const hMatch = out.match(/<line[^>]*class="debug-whisker"[^>]*x1="([^"]+)"[^>]*y1="([^"]+)"[^>]*x2="([^"]+)"[^>]*y2="([^"]+)"/);
  assert(hMatch, 'Could not parse debug-whisker line element');
  const [ , x1, y1, x2, y2 ] = hMatch.map(v => v);

  const x1f = parseFloat(x1);
  const y1f = parseFloat(y1);
  const x2f = parseFloat(x2);
  const y2f = parseFloat(y2);

  // Whisker should not start exactly at the joint center (offset of ~2px expected)
  assert(x1f !== 100 || y1f !== 50, 'Whisker start should be offset from joint center');
  // Horizontal whisker start should be to the right of the joint
  assert(x1f > 100, `Expected whisker x1 > 100 (got ${x1f})`);
  // Whisker should have non-zero length
  assert(Math.abs(x2f - x1f) > 0 || Math.abs(y2f - y1f) > 0, 'Whisker appears to have zero length');

  console.log('debug-whisker test passed ✅');
})().catch(e => { console.error('debug-whisker test failed ❌', e); process.exit(1); });