// tests/template-start-672-node.test.js -- TASK 672 (node half of tests/templates-672-live.test.js): the start views of the four new templates and
// of the box frame's corner joint, through the shared sidebar of Shaper's Design tab (tests/helpers/node-app.js open({ sidebar: true })).
//   - the right-angle brace: ONE generic glyph picker per corner (top / bottom-left / bottom-right), frame-calc's options and names for each
//     corner, each glyph = frame-calc's JointDiagram boards (#core/frame-geometry.js calculateFramingGeometry on the 40 x 40 frame); the picks
//     build the drawing
//   - the polygon frame: the sides count (3..12) and ONE joint picker (frame-calc's 3); the glyph is drawn for the typed number of sides
//     (QuadJointGlyph: the interior angle of that N), so it changes with it; Open = the template with those values
//   - the box frame: the corner joint picker (Vertical through / Horizontal through / Mitered); in the Horizontal layout the glyph is the
//     mirrored corner (the other through option's picture)
//   - the stringer's steps and the bench seat's slats are counts; the bench seat's sweep is in degrees and opens as a user parameter in deg
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { buildTemplate, templateById } from '#core/templates.js';
import { calculateFramingGeometry } from '#core/frame-geometry.js';

const profile = await createProfile();
const app = await open({ host: 'shaper', profile, sidebar: true });
try {
  const doc = app.document, st = app.state;
  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => [...doc.querySelectorAll(sel)];
  const pressEl = (sel) => { const e = typeof sel === 'string' ? q(sel) : sel; assert(e, sel + ' not found'); app.press(e); };
  const settle = (ms = 120) => app.pause(ms);
  const openModal = async () => { pressEl('.sk-sidebar-btn'); await settle(); pressEl('[data-action="templates"]'); await settle(); };
  const dontSave = async () => { const b = qa('.sk-sidebar-ask button').find((x) => /Don.t save/.test(x.textContent)); if (b) { app.press(b); await settle(400); } };
  const startOf = async (id) => { await openModal(); pressEl(`.sk-tp-card[data-template="${id}"]`); await settle(); assert(q(`.sk-tp-start[data-template="${id}"]`), `${id}: the start view`); };
  const buttons = (param) => qa(`.sk-tp-field[data-param="${param}"] .sk-tp-choice button`);
  const visible = (param) => buttons(param).filter((b) => !b.hidden);
  const named = (param) => visible(param).map((b) => [b.dataset.value, b.getAttribute('aria-label'), b.getAttribute('aria-pressed')]);
  const pick = async (param, value) => { pressEl(visible(param)[0]); await settle(); pressEl(visible(param).find((b) => b.dataset.value === value)); await settle(); };
  const typeInto = (input, text) => { input.focus(); input.value = ''; app.type(text); };
  const polys = (b) => [...b.querySelectorAll('svg polygon')].map((p) => p.getAttribute('points'));
  const openIt = async () => { pressEl('.sk-tp-open'); await settle(400); await dontSave(); assert.strictEqual(q('.sk-tp-panel'), null, 'Open closed the modal'); };
  const sameJoints = (want, m) => assert.deepStrictEqual([...st.joints].filter(([id]) => id !== 'j_origin').map(([id, j]) => [id, Math.round(j.x * 1e6) / 1e6 || 0, Math.round(j.y * 1e6) / 1e6 || 0]),
    want.joints.map(([id, j]) => [id, j.x || 0, j.y || 0]), m);

  // ---- the right-angle brace: a picker per corner, frame-calc's options and names
  await startOf('right-angle-brace');
  assert.deepStrictEqual(qa('.sk-tp-field').map((r) => r.dataset.param), ['width', 'height', 'thickV', 'thickH', 'thickD', 'topJoint', 'blJoint', 'brJoint'], 'brace: a row per param');
  assert.deepStrictEqual([named('topJoint'), named('blJoint'), named('brJoint')], [[['V-Through', 'Vertical Through Joint', 'true']], [['V-Through', 'Vertical Through Joint', 'true']], [['H-Through', 'Horizontal Through Joint', 'true']]], "brace: collapsed, frame-calc's defaults");
  const want = { topJoint: ['Vertical Through Joint', 'Diagonal Through Joint', 'Mitered Joint'], blJoint: ['Vertical Through Joint', 'Horizontal Through Joint', 'Mitered Joint'], brJoint: ['Horizontal Through Joint', 'Diagonal Through Joint', 'Mitered Joint'] };
  const corner = { topJoint: 'top', blJoint: 'bl', brJoint: 'br' };
  for (const k of Object.keys(want)) {
    pressEl(visible(k)[0]); await settle();
    assert.deepStrictEqual(visible(k).map((b) => b.getAttribute('aria-label')), want[k], `brace ${k}: expanded, frame-calc's options for that corner`);
    for (const b of visible(k)) { // each glyph = frame-calc's JointDiagram: the two boards meeting at that corner, the other corners at the glyph defaults
      const c = corner[k], v = b.dataset.value;
      const { points } = calculateFramingGeometry({ width: 40, height: 40, thickV: 8, thickH: 8, thickD: 8, topJoint: c === 'top' ? v : 'V-Through', blJoint: c === 'bl' ? v : 'V-Through', brJoint: c === 'br' ? v : 'H-Through' });
      const pair = { top: [points.V, points.D], bl: [points.V, points.H], br: [points.H, points.D] }[c].map((x) => Object.values(x).map((p) => `${p.x},${p.y}`).join(' '));
      assert.deepStrictEqual(polys(b), pair, `brace ${k} ${v}: the glyph is frame-calc's two boards`);
    }
    pressEl(visible(k)[0]); await settle(); // a pick of the first one folds it back
  }
  await pick('topJoint', 'D-Through'); await pick('blJoint', 'Miter'); await pick('brJoint', 'D-Through');
  assert.deepStrictEqual([named('topJoint'), named('blJoint'), named('brJoint')].map((x) => x.map((y) => y[0])), [['D-Through'], ['Miter'], ['D-Through']], 'brace: the three picks, collapsed');
  await openIt();
  sameJoints(buildTemplate(templateById('right-angle-brace'), { topJoint: 'D-Through', blJoint: 'Miter', brJoint: 'D-Through' }).geometry, 'brace: the drawing = the template with the picked joints');
  assert.deepStrictEqual(st.parameters.map((p) => [p.name, p.expression]), [['width', '300 mm'], ['height', '600 mm'], ['thick_v', '38 mm'], ['thick_h', '38 mm'], ['thick_d', '38 mm']], 'brace: its user parameters');

  // ---- the polygon frame: sides + ONE joint picker; the glyph follows the sides
  await startOf('polygon-frame');
  const sides = q('.sk-tp-field[data-param="sides"] input');
  assert.ok(sides.step === '1' && sides.min === '3' && sides.max === '12' && sides.value === '6', 'polygon: sides a 3..12 spinner, 6');
  assert.deepStrictEqual(named('joint'), [['Miter', 'Mitered Joint', 'true']], 'polygon: Mitered by default (frame-calc)');
  pressEl(visible('joint')[0]); await settle();
  assert.deepStrictEqual(visible('joint').map((b) => b.getAttribute('aria-label')), ['Clockwise Through', 'Counter-Clockwise Through', 'Mitered Joint'], "polygon: frame-calc's 3 joints");
  const at6 = buttons('joint').map(polys);
  assert.ok(at6.every((p) => p.length === 2), 'polygon: each glyph two cropped boards');
  typeInto(sides, '3'); await settle();
  const at3 = buttons('joint').map(polys);
  assert.ok(at3.every((p, i) => p.length === 2 && p.join() !== at6[i].join()), 'polygon: 3 sides -> every glyph drawn for the 60 degree corner');
  typeInto(sides, '6'); await settle();
  assert.deepStrictEqual(buttons('joint').map(polys), at6, 'polygon: back to 6 -> the 120 degree glyphs again');
  typeInto(sides, '13'); pressEl('.sk-tp-open'); await settle();
  assert.strictEqual(q('.sk-tp-err').textContent, 'Sides must be from 3 to 12', 'polygon: 13 sides refused');
  typeInto(sides, '8');
  await pick('joint', 'CW-Through');
  await openIt();
  sameJoints(buildTemplate(templateById('polygon-frame'), { sides: 8, joint: 'CW-Through' }).geometry, 'polygon: the drawing = 8 sides, Clockwise Through');
  assert.deepStrictEqual(st.parameters.map((p) => p.name), ['side_length', 'thickness'], 'polygon: its user parameters');

  // ---- the box frame's corner joint (and the glyph mirrored by the Horizontal layout)
  await startOf('box-frame');
  assert.deepStrictEqual(named('joint'), [['V-Through', 'Vertical through', 'true']], 'box: Vertical through by default (today\'s build)');
  pressEl(visible('joint')[0]); await settle();
  assert.deepStrictEqual(visible('joint').map((b) => b.getAttribute('aria-label')), ['Vertical through', 'Horizontal through', 'Mitered'], 'box: the 3 corner joints');
  const vert = Object.fromEntries(buttons('joint').map((b) => [b.dataset.value, polys(b)]));
  await pick('layout', 'Horizontal');
  const horiz = Object.fromEntries(buttons('joint').map((b) => [b.dataset.value, polys(b)]));
  assert.deepStrictEqual([horiz['V-Through'], horiz['H-Through'], horiz.Miter].map((p) => p.length), [2, 2, 2], 'box Horizontal: still two boards each');
  assert.deepStrictEqual(horiz['V-Through'], vert['H-Through'], 'box Horizontal: Vertical through (the long boards through) is drawn as the horizontal board through');
  assert.deepStrictEqual(horiz['H-Through'], vert['V-Through'], 'box Horizontal: and the other way round');
  assert.deepStrictEqual(horiz.Miter, vert.Miter, 'box Horizontal: Mitered the same');
  assert.strictEqual(visible('joint').length, 3, 'box: the joint picker stays expanded while the layout changes (its glyphs redrawn in place)');
  pressEl(visible('joint').find((b) => b.dataset.value === 'Miter')); await settle();
  await openIt();
  sameJoints(buildTemplate(templateById('box-frame'), { layout: 'Horizontal', joint: 'Miter' }).geometry, 'box: Horizontal + Mitered');
  assert.strictEqual(st.shapes.filter((s) => { const [a, b] = s.joints.map((id) => st.joints.get(id)); return Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6; }).length, 4, 'box Mitered: four 45 degree seams');

  // ---- the stringer's steps, the bench seat's slats and its sweep in degrees
  await startOf('stair-stringer');
  assert.deepStrictEqual(qa('.sk-tp-field').map((r) => [r.dataset.param, r.querySelector('.sk-tp-unit').textContent]), [['steps', ''], ['rise', 'mm'], ['run', 'mm'], ['boardWidth', 'mm'], ['throat', 'mm']], 'stringer: steps (a count) and four lengths');
  typeInto(q('.sk-tp-field[data-param="steps"] input'), '6');
  await openIt();
  assert.strictEqual(st.shapes.filter((s) => !s.isConstruction).length, 2 * 6 + 3, 'stringer: 6 risers, 6 treads, the plumb cut, the lower edge, the level cut');
  assert.deepStrictEqual(st.parameters.map((p) => [p.name, p.expression]), [['rise', '180 mm'], ['run', '250 mm'], ['board_width', '286 mm'], ['throat', '125 mm']], 'stringer: its user parameters');
  await startOf('curved-bench-seat');
  assert.strictEqual(q('.sk-tp-field[data-param="sweepAngle"] .sk-tp-unit').textContent, 'deg', 'bench: the sweep in degrees');
  typeInto(q('.sk-tp-field[data-param="slats"] input'), '5');
  typeInto(q('.sk-tp-field[data-param="sweepAngle"] input'), '45');
  app.key('Enter'); await settle(400); await dontSave();
  assert.strictEqual(st.shapes.filter((s) => s.type === 'arc').length, 10, 'bench: 5 slats, 10 arcs');
  assert.deepStrictEqual(st.parameters.map((p) => [p.name, p.expression, p.unit]), [['outer_radius', '900 mm', 'mm'], ['inner_radius', '450 mm', 'mm'], ['sweep_angle', '45 deg', 'deg'], ['gap', '10 mm', 'mm']], 'bench: its user parameters, the sweep in deg');
  console.log('template-start-672-node: ok');
} finally { await app.close(); }
