// tests/joint-display-node.test.js — TASK 622: Fusion-style sketch point (joint) display, visibility rule,
// true-blue hover colour, blue-tinted selected fill, dark outline for all states, and FIXED_JOINT_FILL removal.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { STYLE_SETTING_KEYS, STYLE_TEMPLATES } from '#ui/style-templates.js';

const hexToHsl = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h, s, l, r, g, b };
};

// Parse regular/glow joint <circle> elements rendered by svg-renderer.js (ignoring origin at (0,0), .joint-handle, and faint arc-endpoint rings)
const jointDots = (svg) => {
  const dots = [];
  for (const c of svg.querySelectorAll('circle')) {
    if (c.classList.contains('joint-handle')) continue;
    const cx = Number(c.getAttribute('cx')), cy = Number(c.getAttribute('cy'));
    if (Math.abs(cx) < 1e-6 && Math.abs(cy) < 1e-6) continue; // skip j_origin at (0,0)
    const st = c.getAttribute('style') || '';
    const fill = (st.match(/fill:\s*([^;]+)/) || [])[1]?.trim() || c.getAttribute('fill') || '';
    const stroke = (st.match(/stroke:\s*([^;]+)/) || [])[1]?.trim() || c.getAttribute('stroke') || '';
    const sw = Number(c.getAttribute('stroke-width') || 0);
    if (fill === 'none' && Number(c.getAttribute('stroke-opacity') || 1) === 0.18) continue; // subtle arc endpoint drag ring
    dots.push({ cx, cy, fill, stroke, sw, r: Number(c.getAttribute('r')) });
  }
  return dots;
};
const regularJointDots = (svg) => jointDots(svg).filter((d) => d.fill !== 'none');
const hoverHaloDots = (svg) => jointDots(svg).filter((d) => d.fill === 'none');

// 1. HOVER_COLOR & FIXED_JOINT_FILL checks
const hoverColor = SettingsManager.getDefault('HOVER_COLOR');
assert.strictEqual(hoverColor, '#5B96E8', 'HOVER_COLOR default is true-blue #5B96E8');
assert.notStrictEqual(hoverColor.toUpperCase(), '#5B6CF0', 'old violet #5B6CF0 is gone');
const selHsl = hexToHsl('#3B7DD8'), hovHsl = hexToHsl(hoverColor);
assert(Math.abs(selHsl.h - hovHsl.h) <= 3, `hover hue (${hovHsl.h.toFixed(1)}) matches --sk-selection hue (${selHsl.h.toFixed(1)})`);
assert(hovHsl.b > hovHsl.g && hovHsl.g > hovHsl.r, 'hover colour is true blue (B > G > R, zero violet shift)');
assert(hovHsl.l > selHsl.l, 'hover blue is lighter/softer than --sk-selection so selection stays stronger');

assert.strictEqual(SettingsManager.getDefault('FIXED_JOINT_FILL'), undefined, 'FIXED_JOINT_FILL removed from DEFAULT_SETTINGS');
assert.ok(!STYLE_SETTING_KEYS.includes('FIXED_JOINT_FILL'), 'FIXED_JOINT_FILL removed from STYLE_SETTING_KEYS');
for (const tpl of STYLE_TEMPLATES) {
  assert.ok(!Object.hasOwn(tpl.settings, 'FIXED_JOINT_FILL'), `template ${tpl.id} has no FIXED_JOINT_FILL`);
}

const J = (x, y, fixed = false) => ({ x, y, fixed, sketchId: 'sketch-1' });
const makeDoc = (joints, shapes, constraints = []) => ({
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...joints],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
    constraints,
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [], vcarves: [],
  },
});

// 2. Rectangle (4 closed corners): 0 regular points drawn when away; hover shows corner with HOVER_COLOR; click selects it with blue fill + dark ring
{
  const profile = await createProfile();
  const doc = makeDoc(
    [['r1', J(10, 10)], ['r2', J(50, 10)], ['r3', J(50, 40)], ['r4', J(10, 40)]],
    [
      { id: 'e1', type: 'line', joints: ['r1', 'r2'] },
      { id: 'e2', type: 'line', joints: ['r2', 'r3'] },
      { id: 'e3', type: 'line', joints: ['r3', 'r4'] },
      { id: 'e4', type: 'line', joints: ['r4', 'r1'] },
    ],
    [{ type: 'horizontal', joints: ['r1', 'r2'] }, { type: 'vertical', joints: ['r2', 'r3'] }]
  );
  await createNamedDesign(profile, 'sketchstudio', 'Rect Test', doc);
  const app = await open({ host: 'sketchstudio', profile });
  app.tool('select');
  const away = app.toScreen(-30, -30);
  app.move(away.x, away.y);

  assert.strictEqual(regularJointDots(app.svg).length, 0, 'rectangle draws 0 points when not hovered/selected');

  // Origin still renders at (0,0) with its existing look
  const originDot = [...app.svg.querySelectorAll('circle')].find((c) => Number(c.getAttribute('cx')) === 0 && Number(c.getAttribute('cy')) === 0 && (c.getAttribute('style') || '').includes('--sk-joint-fill'));
  assert.ok(originDot, 'j_origin still draws at (0,0) with its current look');

  // Hover hidden corner r3 (50, 40): revealed, white fill, dark outline, true-blue glow
  const r3s = app.toScreen(50, 40);
  app.move(r3s.x, r3s.y);
  let dots = regularJointDots(app.svg);
  assert.strictEqual(dots.length, 1, 'hovering hidden corner shows 1 point');
  assert.strictEqual(dots[0].cx, 50);
  assert.strictEqual(dots[0].cy, 40);
  assert.match(dots[0].fill, /--sk-joint-fill/, 'hovered unselected point stays white fill');
  assert.match(dots[0].stroke, /--sk-geo-fixed.*#202020/, 'hovered point keeps dark outline');
  const halos = hoverHaloDots(app.svg);
  assert.strictEqual(halos.length, 1, 'hovered point draws 1 outer halo');
  assert.strictEqual(halos[0].stroke.toLowerCase(), hoverColor.toLowerCase(), 'hover halo uses true-blue HOVER_COLOR');

  // Move away -> hidden again
  app.move(away.x, away.y);
  assert.strictEqual(regularJointDots(app.svg).length, 0, 'moving away hides corner again');

  // Click hidden corner r3 -> selected & stays visible with blue-tinted fill and dark ring
  app.click(r3s.x, r3s.y);
  app.move(away.x, away.y);
  assert.ok(app.state.selectedJoints.has('r3'), 'hidden corner stays pickable by real click');
  dots = regularJointDots(app.svg);
  assert.strictEqual(dots.length, 1, 'selected corner stays visible when mouse leaves');
  assert.match(dots[0].fill, /--sk-joint-selected/, 'selected point is filled with blue tint (--sk-joint-selected)');
  assert.match(dots[0].stroke, /--sk-geo-fixed.*#202020/, 'selected point keeps dark ring outline');

  await app.close();
}

// 3. Open 2-line polyline + arc + lone point + free vs fully constrained outline + stale FIXED_JOINT_FILL ignored
{
  const profile = await createProfile();
  profile.storage.set('sketch-studio-settings', JSON.stringify({ FIXED_JOINT_FILL: '#202020' }));
  const doc = makeDoc(
    [
      // Open 2-line polyline: p1 (fully constrained / fixed) - p2 (middle corner) - p3 (free open end)
      ['p1', J(10, 10, true)], ['p2', J(30, 30)], ['p3', J(50, 15)],
      // Arc centered at aC (60, 20) with open ends aS, aE
      ['aC', J(60, 20)], ['aS', J(75, 20)], ['aE', J(60, 35)],
      // Lone point used by no curve
      ['lone1', J(-25, 25)],
    ],
    [
      { id: 'pl1', type: 'line', joints: ['p1', 'p2'] },
      { id: 'pl2', type: 'line', joints: ['p2', 'p3'] },
      { id: 'arc1', type: 'arc', subType: 'CENTER', joints: ['aC', 'aS', 'aE'], radius: 15 },
    ],
    [
      { type: 'distance', joints: ['p1', 'p2'], value: 28.28 },
    ]
  );
  await createNamedDesign(profile, 'sketchstudio', 'Mixed Test', doc);
  const app = await open({ host: 'sketchstudio', profile });
  app.tool('select');
  const away = app.toScreen(-60, -60);
  app.move(away.x, away.y);

  const dots = regularJointDots(app.svg);
  const coords = dots.map((d) => `${d.cx},${d.cy}`).sort();
  // Visible: p1(10,10), p3(50,15), aC(60,20), aS(75,20), aE(60,35), lone1(-25,25); Hidden: p2(30,30)
  assert.deepStrictEqual(coords, ['-25,25', '10,10', '50,15', '60,20', '60,35', '75,20'],
    'polyline shows 2 open ends (middle corner hidden), arc shows center + 2 open ends, lone point shown');

  for (const d of dots) {
    assert.match(d.fill, /--sk-joint-fill/, `point (${d.cx},${d.cy}) has white fill (stale FIXED_JOINT_FILL ignored)`);
    assert.match(d.stroke, /--sk-geo-fixed.*#202020/, `point (${d.cx},${d.cy}) has dark #202020 outline regardless of fixed/constrained/free state`);
  }

  // Hovering hidden polyline middle corner p2 reveals it
  const p2w = app.state.joints.get('p2');
  const p2s = app.toScreen(p2w.x, p2w.y);
  app.move(p2s.x, p2s.y);
  assert.ok(regularJointDots(app.svg).some((d) => Math.hypot(d.cx - p2w.x, d.cy - p2w.y) < 1e-4), 'hovering polyline middle corner shows it');

  await app.close();
}

// 4. Curve end constrained onto another curve (POINT_ON_LINE / MIDPOINT) is hidden; end on ref_axis_x stays open end; circle center shown
{
  const profile = await createProfile();
  const doc = makeDoc(
    [
      ['l1a', J(10, 10)], ['l1b', J(50, 10)],
      ['l2a', J(30, 10)], ['l2b', J(30, 35)], // l2a constrained midpoint onto l1
      ['l3a', J(70, 0)],  ['l3b', J(70, 25)], // l3a constrained pointOnLine onto ref_axis_x (NOT another curve)
      ['l4a', J(90, 10)], ['l4b', J(90, 30)], // l4a constrained pointOnLine onto l1
      ['cc',  J(110, 20)],                    // circle center
    ],
    [
      { id: 'L1', type: 'line', joints: ['l1a', 'l1b'] },
      { id: 'L2', type: 'line', joints: ['l2a', 'l2b'] },
      { id: 'L3', type: 'line', joints: ['l3a', 'l3b'] },
      { id: 'L4', type: 'line', joints: ['l4a', 'l4b'] },
      { id: 'C1', type: 'circle', joints: ['cc'], radius: 10 },
    ],
    [
      { type: 'midpoint', joints: ['l1a', 'l1b', 'l2a'] },
      { type: 'pointOnLine', joint: 'l3a', shape: 'ref_axis_x' },
      { type: 'pointOnLine', joint: 'l4a', shape: 'L1' },
    ]
  );
  await createNamedDesign(profile, 'sketchstudio', 'OnCurve Test', doc);
  const app = await open({ host: 'sketchstudio', profile });
  app.tool('select');
  const away = app.toScreen(-50, -50);
  app.move(away.x, away.y);

  const coords = regularJointDots(app.svg).map((d) => `${d.cx},${d.cy}`).sort();
  assert.deepStrictEqual(coords, ['10,10', '110,20', '30,35', '50,10', '70,0', '70,25', '90,30'],
    'midpoint (30,10) and pointOnLine-on-curve (90,10) ends are hidden; pointOnLine-on-ref-axis (70,0) and circle center (110,20) are shown');

  await app.close();
}

console.log('joint-display-node.test.js passed');
