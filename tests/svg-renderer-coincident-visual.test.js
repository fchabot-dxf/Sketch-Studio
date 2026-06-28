(async () => {
  const { draw } = await import('../apps/sketchstudio/svg-renderer.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
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
  // Draw default (no selection) - should show exactly 3 visible white joint circles
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const whiteCircles = (svg.innerHTML.match(/fill="white"/g) || []).length;
  assert(whiteCircles === 3, `Expected 3 visible white joints, got ${whiteCircles}`);

  // Hover one of the hidden follower joints (e.g., a2) and verify the leader glows (blue halo)
  svg.innerHTML = '';
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, 'a2', null, null, false, null);
  // Glow markup uses stroke="#3B82F6" (Fusion Blue halo). Ensure it's present
  assert(/stroke="#3B82F6"/.test(svg.innerHTML), 'Hovering hidden joint should show leader glow');

  // Select the coincident constraint c1 and assert the corresponding glyph appears (opacity:1)
  svg.innerHTML = '';
  const selectedConstraints = new Set([c1]);
  draw(joints, shapes, svg, null, null, constraints, new Set(), selectedConstraints, null, null, new Set(), null, null, null, null, false, null);
  // Glyph groups for constraints have class including "constraint-glyph" and will have style="opacity:1" when visible
  assert(/class="[^"]*constraint-glyph[^"]*"[\s\S]*opacity:1/.test(svg.innerHTML), 'Selecting a constraint should reveal its glyph (opacity:1)');

  // Delete one coincident constraint (c1) and redraw - corner should "split" increasing visible joints to 4
  svg.innerHTML = '';
  const constraints2 = [c2, c3];
  draw(joints, shapes, svg, null, null, constraints2, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const whiteCircles2 = (svg.innerHTML.match(/fill="white"/g) || []).length;
  assert(whiteCircles2 === 4, `After removing one coincident constraint expected 4 visible joints, got ${whiteCircles2}`);

  console.log('svg-renderer-coincident-visual tests passed ✅');
})().catch(e => { console.error('svg-renderer-coincident-visual tests failed ❌', e); process.exit(1); });