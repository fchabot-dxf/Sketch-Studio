(async () => {
  const { draw } = await import('../packages/ui/svg-renderer.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const SettingsManager = (await import('#core/settings-manager.js')).default;
  const HOVER_COLOR = SettingsManager.getDefault('HOVER_COLOR');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Mock SVG element with minimal API used by renderer
  const makeSVG = () => ({
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: ''
  });

  // Build a triangle with 3 corners, but each corner has 2 solver joints (6 total)
  const joints = new Map();
  joints.set('a1', { x: 0, y: 0 }); joints.set('a2', { x: 0, y: 0 });
  joints.set('b1', { x: 100, y: 0 }); joints.set('b2', { x: 100, y: 0 });
  joints.set('c1', { x: 50, y: 86 }); joints.set('c2', { x: 50, y: 86 });

  // Shapes that reference the joints (three lines forming a triangle)
  const shapes = [
    { id: 's1', type: 'line', joints: ['a1','b1'] },
    { id: 's2', type: 'line', joints: ['b2','c1'] },
    { id: 's3', type: 'line', joints: ['c2','a2'] }
  ];

  // Coincident constraints to pair the corner joints
  const c1 = { type: CONSTRAINT_TYPES.COINCIDENT, joints: ['a1','a2'] };
  const c2 = { type: CONSTRAINT_TYPES.COINCIDENT, joints: ['b1','b2'] };
  const c3 = { type: CONSTRAINT_TYPES.COINCIDENT, joints: ['c1','c2'] };
  const constraints = [c1, c2, c3];

  const svg = makeSVG();
  // Closed triangle: all 3 corners have two curve ends, so Fusion-style point display hides all 3 until hovered
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const whiteCircles = (svg.innerHTML.match(/fill:var\(--sk-joint-fill, white\)/g) || []).length;
  assert(whiteCircles === 0, `Expected 0 visible points on closed triangle, got ${whiteCircles}`);

  // Hover one of the hidden follower joints (e.g., a2) and verify the corner appears with the true-blue hover glow
  svg.innerHTML = '';
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, 'a2', null, null, false, null);
  const hoveredWhite = (svg.innerHTML.match(/fill:var\(--sk-joint-fill, white\)/g) || []).length;
  assert(hoveredWhite === 1, `Hovering hidden corner should reveal 1 point, got ${hoveredWhite}`);
  assert(svg.innerHTML.includes(`stroke:${HOVER_COLOR}`), `Hovering hidden joint should show leader glow (${HOVER_COLOR})`);

  // Select the coincident constraint c1 and assert the corresponding glyph appears (opacity:1)
  svg.innerHTML = '';
  const selectedConstraints = new Set([c1]);
  draw(joints, shapes, svg, null, null, constraints, new Set(), selectedConstraints, null, null, new Set(), null, null, null, null, false, null);
  // Glyph groups for constraints have class including "constraint-glyph" and will have style="opacity:1" when visible
  assert(/class="[^"]*constraint-glyph[^"]*"[\s\S]*opacity:1/.test(svg.innerHTML), 'Selecting a constraint should reveal its glyph (opacity:1)');

  // Delete one coincident constraint (c1) and redraw - split corner yields 2 open ends (other 2 corners remain hidden)
  svg.innerHTML = '';
  const constraints2 = [c2, c3];
  draw(joints, shapes, svg, null, null, constraints2, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const whiteCircles2 = (svg.innerHTML.match(/fill:var\(--sk-joint-fill, white\)/g) || []).length;
  assert(whiteCircles2 === 2, `After removing one coincident constraint expected 2 visible open ends, got ${whiteCircles2}`);

  console.log('svg-renderer-coincident-visual tests passed ✅');
})().catch(e => { console.error('svg-renderer-coincident-visual tests failed ❌', e); process.exit(1); });