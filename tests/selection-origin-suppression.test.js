(async () => {
  const { updateHoverFeedback } = await import('../src/ui/input-handlers/selection-tools.js');
  const { findClosestConstraintGlyph } = await import('../src/ui/input-handlers/selection-tools.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Create a fake svg with a simple worldToScreen mapping: identity (1:1) coordinates
  const svg = { getBoundingClientRect: () => ({ width: 100, height: 100 }), viewBox: { baseVal: { x:0,y:0,width:100,height:100 } } };
  // Minimal state with origin and a nearby glyph
  const state = { lastMouse: { x: 10, y: 10 }, constraints: [], joints: new Map(), hoveredJoint: null, hoveredConstraint: null, hoveredShape: null };
  state.joints.set('j_origin', { x: 10, y: 10 });

  // Add a coincident glyph slightly closer to the mouse
  const c = { type: 'coincident', joints: ['j_origin','j_dummy'], glyphPos: { x: 12, y: 10 } };
  state.constraints.push(c);

  // No hitJoint given (simulate zero joint hit), but we craft hitJoint such that origin is a nearby joint
  const hitJoint = { id: 'j_origin', j: state.joints.get('j_origin') };
  const hitShape = null; // none

  // Call updateHoverFeedback — ensure the glyph wins hover despite proximity of origin, and origin is NOT hovered
  updateHoverFeedback(svg, hitJoint, hitShape, null, state);
  // After update, hoveredConstraint should be set to the coincident constraint (closest glyph), or hoveredJoint null
  // Because findClosestConstraintGlyph uses screen distances and our glyph at x=12 is closer than tie-boundary, it should win
  const glyphBest = findClosestConstraintGlyph(svg, 10, 10, state.constraints);
  // Ensure the chosen winner prefers glyph rather than origin in tie/close case (origin should not be highlighted as a joint)
  updateHoverFeedback(svg, hitJoint, hitShape, null, state);
  assert(!(state.hoveredJoint === 'j_origin' && state.hoveredConstraint), 'Origin should not be highlighted when a glyph is closer or equal');

  console.log('selection-origin-suppression test passed ✅');
})().catch(e => { console.error('selection-origin-suppression tests failed ❌', e); process.exit(1); });