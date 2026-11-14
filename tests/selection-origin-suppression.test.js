// tests/selection-origin-suppression.test.js -- the select tool's hover near the origin and a glyph. TASK 588: the hover is THE click's pick
// (hover-manager selectPick: a joint in snap reach, else a glyph the pointer is ON, else a shape), so ONE target is hovered and it is what a
// click selects. The old hover rule ("the origin yields to a glyph as close or closer", a 24 / 40 px glyph reach) is gone: the click never had
// it (a joint in reach was always picked first), and hover = click.
(async () => {
  const { updateHoverFeedback } = await import('#ui/input-handlers/selection-tools.js');
  const { selectPick } = await import('#ui/hover-manager.js');
  const fs = await import('node:fs'); // task 603: a glyph is picked where its icon is drawn, so the real sheet is loaded
  const { loadGlyphSheet } = await import('#ui/glyph-sheet.js');
  const { DOMParserShim } = await import('./helpers/xml-dom-shim.js');
  await loadGlyphSheet({ fetchFn: async () => ({ ok: true, text: async () => fs.readFileSync(new URL('../assets/constraint-glyphs.svg', import.meta.url), 'utf8') }), parser: new DOMParserShim() });
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // a fake svg with an identity world <-> screen mapping (1 world unit = 1 px)
  const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), viewBox: { baseVal: { x: 0, y: 0, width: 100, height: 100 } } };
  const state = { lastMouse: { x: 10, y: 10 }, constraints: [], joints: new Map(), shapes: [], hoveredJoint: null, hoveredConstraint: null, hoveredShape: null };
  state.joints.set('j_origin', { x: 10, y: 10 });
  const c = { type: 'coincident', joints: ['j_origin', 'j_dummy'], glyphPos: { x: 12, y: 10 } }; // a glyph 2 px from the pointer
  state.constraints.push(c);
  const hitJoint = { id: 'j_origin', j: state.joints.get('j_origin') };

  // the origin in snap reach: the click picks it, so the hover lights it, and only it
  updateHoverFeedback(svg, hitJoint, null, null, state);
  const pick = selectPick(svg, state, hitJoint, null, 10, 10);
  assert(pick && pick.joint && pick.joint.id === 'j_origin', 'the click picks the origin joint in reach');
  assert(state.hoveredJoint === 'j_origin' && !state.hoveredConstraint && !state.hoveredShape, 'the hover lights the origin, and only it');

  // no joint in reach, the pointer ON the glyph: the glyph, for the click and the hover
  updateHoverFeedback(svg, null, null, null, state);
  assert(selectPick(svg, state, null, null, 10, 10).constraint === c, 'the click picks the glyph the pointer is on');
  assert(state.hoveredConstraint === c && !state.hoveredJoint && !state.hoveredShape, 'the hover lights the glyph, and only it');

  console.log('selection-origin-suppression test passed ✅');
})().catch(e => { console.error('selection-origin-suppression tests failed ❌', e); process.exit(1); });
