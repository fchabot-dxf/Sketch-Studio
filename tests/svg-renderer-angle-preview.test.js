(async () => {
  const { draw } = await import('../src/svg-renderer.js');
  const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  const makeSVG = () => ({ viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), innerHTML: '' });

  // Two lines intersecting at origin: one along +X axis, one rotated +60° CCW.
  const joints = new Map();
  joints.set('a', { x: 0, y: 0 }); // intersection
  joints.set('b', { x: 50, y: 0 }); // line1 endpoint
  joints.set('c', { x: 0, y: 0 });
  joints.set('d', { x: 25, y: 43.30127019 }); // ~60 degrees (sin60*50)

  const shapes = [
    { id: 'L1', type: 'line', joints: ['a','b'] },
    { id: 'L2', type: 'line', joints: ['c','d'] }
  ];

  // Place the preview point deliberately inside the 60° wedge (e.g., 30° ray at radius 30)
  const previewPtInside = { x: Math.cos(Math.PI/6) * 30, y: Math.sin(Math.PI/6) * 30 };
  const activeInside = { mode: 'dim-angle', shapes: ['L1','L2'], preview: { pt: previewPtInside } };

  const svg = makeSVG();
  draw(joints, shapes, svg, activeInside, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);

  // Preview should draw the small arc (large-arc=0) for the interior sector
  const html = svg.innerHTML;
  const arcSmall = /A\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+0\s+0\s+1/.test(html);
  assert(arcSmall, 'Angle preview should draw the small arc (large-arc=0) for an interior sector');

  // Now render an actual ANGLE constraint (with a stored value) and ensure the label shows the normalized/smaller angle
  const c = { type: CONSTRAINT_TYPES.ANGLE, shapes: ['L1','L2'], value: 60, offset: 30, glyphPos: previewPtInside };
  const svgConstraint = makeSVG();
  draw(joints, shapes, svgConstraint, null, null, [c], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const htmlC = svgConstraint.innerHTML;
  assert(/60\.0°/.test(htmlC), 'Rendered ANGLE constraint should display stored value 60.0°');
  const arcSmallC = /A\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+0\s+0\s+1/.test(htmlC);
  assert(arcSmallC, 'Rendered ANGLE constraint should draw the small arc for a 60° value');

  console.log('svg-renderer angle-preview + constraint label checks passed ✅');

  // Also test picking the reflex/exterior sector: put preview outside the small wedge (opposite side)
  const previewPtOutside = { x: -40, y: 0 }; // lies on negative X side => outside the 60° wedge
  const activeOutside = { mode: 'dim-angle', shapes: ['L1','L2'], preview: { pt: previewPtOutside } };
  const svg2 = makeSVG();
  draw(joints, shapes, svg2, activeOutside, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
  const html2 = svg2.innerHTML;
  const hasArc = /A\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+0\s+\d\s+\d/.test(html2);
  assert(hasArc, 'Angle preview outside wedge should render an arc');

  console.log('svg-renderer angle-preview (outside wedge) sanity check passed ✅');

})();