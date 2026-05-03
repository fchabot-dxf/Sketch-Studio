(async () => {
  const { draw } = await import('../src/svg-renderer.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Mock SVG element with minimal API used by renderer
  const makeSVG = () => ({
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: ''
  });

  // Test 1: CENTER arc shape should render a path
  (() => {
    const svg = makeSVG();
    const joints = new Map();
    // c = center, s = start, e = end
    joints.set('c', { x: 0, y: 0 });
    joints.set('s', { x: 50, y: 0 });
    joints.set('e', { x: 25, y: 25 });

    const shapes = [{ id: 's_arc_1', type: 'arc', subType: 'CENTER', joints: ['c','s','e'] }];

    draw(joints, shapes, svg, null, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
    // Be tolerant of attribute ordering; ensure there's a path with both a d="..." and class="shape-elem"
    const hasPath = /class=\"[^\"]*shape-elem[^\"]*\"/.test(svg.innerHTML) && /d=\"/.test(svg.innerHTML);
    assert(hasPath, 'CENTER arc shape should produce an SVG path element');
  })();

  // Test 2: CENTER arc shape should render a path and add radius constraint when created (path presence only)
  (() => {
    const svg = makeSVG();
    const joints = new Map();
    joints.set('c', { x: 100, y: 100 });
    joints.set('s', { x: 110, y: 100 });
    joints.set('e', { x: 100, y: 110 });

    const shapes = [{ id: 's_arc_2', type: 'arc', subType: 'CENTER', joints: ['c','s','e'] }];

    draw(joints, shapes, svg, null, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
    const hasPath = /class=\"[^\"]*shape-elem[^\"]*\"/.test(svg.innerHTML) && /d=\"/.test(svg.innerHTML);
    assert(hasPath, 'CENTER arc shape should produce an SVG path element');
  })();

  // Test 3: Preview arc (start pt + cursor) should draw a line from start to cursor
  (() => {
    const svg = makeSVG();
    const joints = new Map();
    joints.set('j1', { x: 0, y: 0 });

    const shapes = [];
    const active = { mode: 'arc', preview: { type: 'arc', p1: 'j1', pt: { x: 25, y: 30 } } };

    draw(joints, shapes, svg, active, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
    // preview line uses <line>, ensure present
    const hasPreviewLine = /<line[^>]+x1=\"0\"[^>]*x2=\"25\"/.test(svg.innerHTML);
    assert(hasPreviewLine, 'Start-point preview should draw a line to cursor');
  })();

  // Test 4: Preview arc (center+radius) should draw an arc with center indicators
  (() => {
    const svg = makeSVG();
    const joints = new Map();
    joints.set('c', { x: 200, y: 200 });

    const shapes = [];
    const active = { mode: 'arc', preview: { type: 'arc', center: 'c', radius: 40, startAngle: 0, endAngle: Math.PI/2 } };

    draw(joints, shapes, svg, active, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
    const hasCenterDot = /<circle[^>]+cx="200"[^>]*r="3"/.test(svg.innerHTML);
    const hasArcPath = /<path[^>]+d="[^"]+"[^>]*stroke-dasharray/.test(svg.innerHTML) || /<path[^>]+d="[^"]+"[^>]*class="shape-elem"/.test(svg.innerHTML);
    assert(hasCenterDot, 'Center preview should render a center marker');
    assert(hasArcPath, 'Center preview should render an arc path');
  })();

  console.log('svg-renderer arc tests passed ✅');
})().catch(e => { console.error('svg-renderer-arc tests failed ❌', e); process.exit(1); });