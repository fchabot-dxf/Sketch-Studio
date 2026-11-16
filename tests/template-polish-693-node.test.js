// tests/template-polish-693-node.test.js -- TASK 693 (node + happy-dom):
// 1. Box frame Horizontal layout: Corner joint option labels/titles match their glyph pictures and resulting geometry
//    (Horizontal -> stored 'V-Through' runs horizontal boards full length and is named "Horizontal through"; stored
//    'H-Through' runs vertical ends full height and is named "Vertical through"; stored values stay unchanged).
// 2. Right-angle brace: impossible thickness sums (H*Tv + W*Th + L*Td >= W*H) are refused via buildTemplate / 680's
//    error line with Open disabled (no folded/inverted geometry), while valid near-limit values still build.
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { CORNER_JOINT_TYPES, boxJointInLayout, cornerJointLabel } from '#core/corner-joint.js';
import { buildTemplate, templateById } from '#core/templates.js';

// ---- A. Core declared mapping & stored values ----
assert.deepStrictEqual(
  CORNER_JOINT_TYPES.map((o) => [o.value, o.label]),
  [['V-Through', 'Vertical through'], ['H-Through', 'Horizontal through'], ['Miter', 'Mitered']],
  'stored CORNER_JOINT_TYPES unchanged'
);
assert.strictEqual(boxJointInLayout('V-Through', 'Vertical'), 'V-Through');
assert.strictEqual(boxJointInLayout('V-Through', 'Horizontal'), 'H-Through');
assert.strictEqual(boxJointInLayout('H-Through', 'Horizontal'), 'V-Through');
assert.strictEqual(boxJointInLayout('Miter', 'Horizontal'), 'Miter');
assert.strictEqual(cornerJointLabel('V-Through', 'Vertical'), 'Vertical through');
assert.strictEqual(cornerJointLabel('V-Through', 'Horizontal'), 'Horizontal through');
assert.strictEqual(cornerJointLabel('H-Through', 'Horizontal'), 'Vertical through');
assert.strictEqual(cornerJointLabel('Miter', 'Horizontal'), 'Mitered');

// ---- B. Brace thickness refusal rule in buildTemplate ----
const brace = templateById('right-angle-brace');
for (const [label, params] of [
  ['thickV == width', { thickV: 300 }],
  ['thickV > width', { thickV: 350 }],
  ['thickV crossing diagonal', { thickV: 240 }],
  ['thickH == height', { thickH: 600 }],
  ['thickH > height', { thickH: 700 }],
  ['thickH crossing diagonal', { thickH: 440 }],
  ['thickD crossing corner', { thickD: 218 }],
  ['thickD far too large', { thickD: 250 }],
  ['thickD huge', { thickD: 500 }],
  ['small frame with default 38', { width: 50, height: 50 }],
]) {
  assert.throws(
    () => buildTemplate(brace, params),
    / thickness is too big/,
    `brace refuses ${label}`
  );
}
for (const [label, params] of [
  ['thickV=150', { thickV: 150 }],
  ['thickV=230', { thickV: 230 }],
  ['thickH=300', { thickH: 300 }],
  ['thickD=200', { thickD: 200 }],
  ['thickD=217', { thickD: 217 }],
]) {
  const doc = buildTemplate(brace, params);
  const pts = doc.geometry.joints.map(([, j]) => j);
  assert.ok(pts.every((q) => q.x >= -1e-6 && q.x <= 300 + 1e-6 && q.y <= 1e-6 && q.y >= -600 - 1e-6), `valid ${label} stays within triangle`);
}

// ---- C. Start modal DOM checks (Box frame labels + Brace error line) ----
const profile = await createProfile();
const app = await open({ host: 'shaper', profile, sidebar: true });
try {
  const doc = app.document, st = app.state;
  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => [...doc.querySelectorAll(sel)];
  const pressEl = (sel) => { const e = typeof sel === 'string' ? q(sel) : sel; assert(e, sel + ' not found'); app.press(e); };
  const settle = (ms = 260) => app.pause(ms);
  const dontSave = async () => { const b = qa('.sk-tp-backdrop [role="dialog"] button').find((x) => /Don.t save/.test(x.textContent)); if (b) { app.press(b); await settle(300); } };
  const startOf = async (id) => {
    pressEl('.sk-sidebar-btn'); await settle(120);
    pressEl('[data-action="templates"]'); await settle(120);
    pressEl(`.sk-tp-card[data-template="${id}"]`); await settle(120);
    assert(q(`.sk-tp-start[data-template="${id}"]`), `${id} start view opened`);
  };
  const info = (sel) => qa(`${sel} button`).map((b) => {
    const polys = [...b.querySelectorAll('svg polygon')].map((p) => {
      const coords = p.getAttribute('points').split(' ').map((s) => s.split(',').map(Number));
      const xs = coords.map((q) => q[0]), ys = coords.map((q) => q[1]);
      return { dx: +(Math.max(...xs) - Math.min(...xs)).toFixed(1), dy: +(Math.max(...ys) - Math.min(...ys)).toFixed(1) };
    });
    return { value: b.dataset.value, label: b.getAttribute('aria-label'), title: b.title, hidden: b.hidden, pressed: b.getAttribute('aria-pressed'), hLen: polys[0].dx, vLen: polys[1].dy };
  });

  // 1. Box frame Vertical -> Horizontal -> back to Vertical
  await startOf('box-frame');
  let row = info('.sk-tp-field[data-param="joint"]');
  assert.deepStrictEqual(row.filter((o) => !o.hidden).map((o) => [o.value, o.label, o.title]), [['V-Through', 'Vertical through', 'Vertical through']], 'Vertical default collapsed');

  // Switch layout to Horizontal with joint picker collapsed: collapsed button immediately updates label, title & glyph
  pressEl('.sk-tp-field[data-param="layout"] button:not([hidden])'); await settle(120);
  pressEl('.sk-tp-field[data-param="layout"] button[data-value="Horizontal"]'); await settle(280);
  row = info('.sk-tp-field[data-param="joint"]');
  assert.deepStrictEqual(
    row.filter((o) => !o.hidden).map((o) => [o.value, o.label, o.title, o.hLen, o.vLen]),
    [['V-Through', 'Horizontal through', 'Horizontal through', 32, 24]],
    'Horizontal default keeps stored V-Through while naming & drawing Horizontal through'
  );

  // Expand row picker in Horizontal layout: every option's label & title match its glyph
  pressEl('.sk-tp-field[data-param="joint"] button:not([hidden])'); await settle(120);
  row = info('.sk-tp-field[data-param="joint"]');
  assert.deepStrictEqual(
    row.map((o) => [o.value, o.label, o.title, o.hLen, o.vLen]),
    [
      ['V-Through', 'Horizontal through', 'Horizontal through', 32, 24],
      ['H-Through', 'Vertical through', 'Vertical through', 24, 32],
      ['Miter', 'Mitered', 'Mitered', 32, 32],
    ],
    'Horizontal row options: labels & titles match glyph through boards'
  );

  // Check all 4 corner pickers in Horizontal layout too
  for (let c = 0; c < 4; c++) {
    const cornerOpts = info(`.sk-tp-corner[data-corner="${c}"]`);
    assert.deepStrictEqual(
      cornerOpts.map((o) => [o.value, o.label, o.title, o.hLen, o.vLen]),
      [
        ['V-Through', 'Horizontal through', 'Horizontal through', 32, 24],
        ['H-Through', 'Vertical through', 'Vertical through', 24, 32],
        ['Miter', 'Mitered', 'Mitered', 32, 32],
      ],
      `Horizontal corner ${c} options: labels match glyphs`
    );
  }

  // Pick "Vertical through" (stored H-Through) for row -> preview switches end boards to run full 400 mm vertical height;
  // then switch back to Vertical layout with picker expanded first -> labels swap back!
  pressEl('.sk-tp-field[data-param="joint"] button[data-value="H-Through"]'); await settle(280);
  pressEl('.sk-tp-field[data-param="joint"] button:not([hidden])'); await settle(120);
  pressEl('.sk-tp-field[data-param="layout"] button:not([hidden])'); await settle(120);
  pressEl('.sk-tp-field[data-param="layout"] button[data-value="Vertical"]'); await settle(280);
  row = info('.sk-tp-field[data-param="joint"]');
  assert.deepStrictEqual(
    row.map((o) => [o.value, o.label, o.title, o.pressed]),
    [
      ['V-Through', 'Vertical through', 'Vertical through', 'false'],
      ['H-Through', 'Horizontal through', 'Horizontal through', 'true'],
      ['Miter', 'Mitered', 'Mitered', 'false'],
    ],
    'switching back to Vertical keeps stored selection and restores Vertical-layout names'
  );

  // Switch back to Horizontal, leave stored 'H-Through' selected (Vertical through), Open -> real document has 400 mm vertical through ends
  pressEl('.sk-tp-field[data-param="layout"] button:not([hidden])'); await settle(120);
  pressEl('.sk-tp-field[data-param="layout"] button[data-value="Horizontal"]'); await settle(280);
  pressEl('.sk-tp-open'); await settle(320); await dontSave();
  const fullVEnds = [...st.shapes.values()].filter((s) => {
    if (s.type !== 'line' || s.isConstruction) return false;
    const [a, b] = s.joints.map((id) => st.joints.get(id));
    return Math.abs(a.x - b.x) < 1e-4 && Math.abs(Math.abs(a.y - b.y) - 400) < 1e-4;
  });
  assert.strictEqual(fullVEnds.length, 2, 'Horizontal + "Vertical through" opens with both 400 mm vertical ends running through');

  // 2. Right-angle brace start modal: too-big thickD / thickV / thickH refuse via error line + Open disabled, valid recovers
  await startOf('right-angle-brace');
  const setNum = async (param, val) => {
    const inp = q(`.sk-tp-field[data-param="${param}"] input`);
    inp.focus(); inp.value = ''; app.type(String(val)); await settle(300);
  };
  await setNum('thickD', 250);
  assert.match(q('.sk-tp-err').textContent, / thickness is too big/, 'brace thickD=250 refuses in error line');
  assert.strictEqual(q('.sk-tp-open').disabled, true, 'brace thickD=250 disables Open');
  await setNum('thickD', 38);
  assert.strictEqual(q('.sk-tp-err').textContent, '', 'valid thickD clears error');
  assert.strictEqual(q('.sk-tp-open').disabled, false, 'valid thickD re-enables Open');

  await setNum('thickH', 600);
  assert.match(q('.sk-tp-err').textContent, / thickness is too big/, 'brace thickH=600 refuses in error line');
  assert.strictEqual(q('.sk-tp-open').disabled, true, 'brace thickH=600 disables Open');
  await setNum('thickH', 38);
  await setNum('thickV', 350);
  assert.match(q('.sk-tp-err').textContent, / thickness is too big/, 'brace thickV=350 refuses in error line');
  assert.strictEqual(q('.sk-tp-open').disabled, true, 'brace thickV=350 disables Open');

  console.log('template-polish-693-node: ok');
} finally {
  await app.close();
}
