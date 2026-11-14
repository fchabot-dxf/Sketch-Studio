// tests/dim-stray-dot-and-label-box.test.js — TASK 627:
// 1. A linear dimension at rest emits no zero-length <line> segment and no visible dot (<circle>) on its dimension line;
//    arrows, extension lines, dimension line, and .dim-label are unchanged.
// 2. Hovered or selected dimension labels (linear, radius, angle) emit NO pale-blue glow <rect> (stroke-opacity="0.28"),
//    and instead change text colour (HOVER_COLOR when hovered, var(--sk-selection, #1e40af) when selected).
import assert from 'node:assert';

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.document = {
  head: { appendChild() {} },
  getElementById: () => null,
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
};

const { draw } = await import('../packages/ui/svg-renderer.js');
const { applyStyleTemplate } = await import('../packages/ui/style-templates.js');
const SettingsManager = (await import('../packages/core/settings-manager.js')).default;

const renderSvg = (joints, shapes, constraints, { selected = new Set(), hovered = null } = {}) => {
  const svg = {
    viewBox: { baseVal: { x: -20, y: -60, width: 100, height: 80 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 500, height: 400 }),
    innerHTML: '',
  };
  draw(
    joints, shapes, svg, null, null, constraints,
    new Set(), selected, 'select', null, new Set(),
    null, null, hovered, null, null, false, null
  );
  return svg.innerHTML;
};

// ── 1. Vertical linear dimension (50.0, x=17, y=0..-50) at rest ──────────────
applyStyleTemplate('default');
assert.strictEqual(SettingsManager.get('DIM_LABEL_BOX'), false, 'default look has DIM_LABEL_BOX=false');

const joints = new Map([
  ['j1', { x: 0, y: 0, fixed: true }],
  ['j2', { x: 0, y: -50, fixed: true }],
]);
const shapes = [{ id: 's1', type: 'line', joints: ['j1', 'j2'] }];
const linDim = { id: 'c1', type: 'distance', joints: ['j1', 'j2'], value: 50, dimMode: 'vertical', offset: 17 };

const restHtml = renderSvg(joints, shapes, [linDim]);

// No zero-length <line> segments anywhere in the rendered output
const lineMatches = [...restHtml.matchAll(/<line\b[^>]*x1="([-\d.e]+)"[^>]*y1="([-\d.e]+)"[^>]*x2="([-\d.e]+)"[^>]*y2="([-\d.e]+)"[^>]*>/g)];
assert(lineMatches.length >= 6, 'renders axes, geometry line, 2 extension lines, and 1 dimension line');
for (const m of lineMatches) {
  const len = Math.hypot(Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2]));
  assert(len > 1e-3, `no zero-length segment emitted (found length=${len} on ${m[0]})`);
}
assert(!restHtml.includes('class="dim-lead"'), 'centred linear dimension at rest emits no dim-lead lines');

// No circle / dot on the dimension line (x=17) at rest
const circleMatches = [...restHtml.matchAll(/<circle\b[^>]*cx="([-\d.e]+)"[^>]*cy="([-\d.e]+)"[^>]*>/g)];
const circlesOnDimLine = circleMatches.filter((m) => Math.abs(Number(m[1]) - 17) < 1e-3);
assert.strictEqual(circlesOnDimLine.length, 0, 'at rest: no circle/dot on the dimension line x=17');
assert(!restHtml.includes('dim-offset-handle'), 'at rest: no .dim-offset-handle');

// Arrows, extension lines, dimension line, and label are intact
const arrows = [...restHtml.matchAll(/<polygon points="([^"]+)"/g)];
assert.strictEqual(arrows.length, 2, 'at rest: 2 dimension arrowheads');
assert(restHtml.includes('x1="0" y1="0" x2="17" y2="0"'), 'top extension line intact');
assert(restHtml.includes('x1="0" y1="-50" x2="17" y2="-50"'), 'bottom extension line intact');
assert(restHtml.includes('x1="17" y1="0" x2="17" y2="-50"'), 'dimension line intact');
assert(!restHtml.includes('<rect'), 'at rest with DIM_LABEL_BOX=false: no <rect> box');

const restLabelText = (restHtml.match(/<g class="dim-label"[\s\S]*?<text([^>]*)>50\.0<\/text>/) || [])[1];
assert(restLabelText && restLabelText.includes('fill:var(--sk-constraint-stroke, #2563eb)'), 'at rest: label text uses --sk-constraint-stroke');

// ── 2. Hovered & selected linear dimension: colour change, no blue glow box ──
const hoverHtml = renderSvg(joints, shapes, [linDim], { hovered: linDim });
assert(!hoverHtml.includes('<rect'), 'hovered linear dimension emits no glow <rect>');
const hoverLabelText = (hoverHtml.match(/<g class="dim-label"[\s\S]*?<text([^>]*)>50\.0<\/text>/) || [])[1];
assert(hoverLabelText && hoverLabelText.includes('fill:#5B96E8'), `hovered label text uses HOVER_COLOR (#5B96E8), got: ${hoverLabelText}`);

const selHtml = renderSvg(joints, shapes, [linDim], { selected: new Set([linDim]) });
assert(!selHtml.includes('<rect'), 'selected linear dimension emits no pale-blue glow <rect>');
assert(!selHtml.includes('stroke-opacity="0.28"'), 'selected linear dimension emits no 0.28 glow');
const selLabelText = (selHtml.match(/<g class="dim-label"[\s\S]*?<text([^>]*)>50\.0<\/text>/) || [])[1];
assert(selLabelText && selLabelText.includes('fill:var(--sk-selection, #1e40af)'), `selected label text uses --sk-selection, got: ${selLabelText}`);
assert(!selHtml.includes('dim-offset-handle'), 'selected linear dimension emits no .dim-offset-handle dot');
const selCirclesOnDimLine = [...selHtml.matchAll(/<circle\b[^>]*cx="([-\d.e]+)"[^>]*cy="([-\d.e]+)"[^>]*>/g)]
  .filter((m) => Math.abs(Number(m[1]) - 17) < 1e-3);
assert.strictEqual(selCirclesOnDimLine.length, 0, 'selected linear dimension emits no circle/dot on its dimension line x=17');

// ── 3. Radius & angle dimensions: hover/selected colour change, no glow box ──
{
  const rJoints = new Map([['c', { x: 0, y: 0, fixed: true }], ['rim', { x: 20, y: 0 }]]);
  const rShapes = [{ id: 'circ', type: 'circle', joints: ['c', 'rim'], radius: 20 }];
  const radDim = { id: 'r1', type: 'distance', isRadius: true, shape: 'circ', value: 20, offset: 30 };

  const rHover = renderSvg(rJoints, rShapes, [radDim], { hovered: radDim });
  const rSel = renderSvg(rJoints, rShapes, [radDim], { selected: new Set([radDim]) });
  assert(!rHover.includes('<rect') && !rSel.includes('<rect'), 'radius dimension emits no glow <rect> when hovered or selected');
  assert(rHover.includes('fill:#5B96E8'), 'hovered radius label uses HOVER_COLOR');
  assert(rSel.includes('fill:var(--sk-selection, #1e40af)'), 'selected radius label uses --sk-selection');
}

{
  const aJoints = new Map([
    ['p1', { x: 0, y: 0, fixed: true }], ['p2', { x: 40, y: 0, fixed: true }],
    ['p3', { x: 0, y: 0, fixed: true }], ['p4', { x: 0, y: -40, fixed: true }],
  ]);
  const aShapes = [
    { id: 'l1', type: 'line', joints: ['p1', 'p2'] },
    { id: 'l2', type: 'line', joints: ['p3', 'p4'] },
  ];
  const angDim = { id: 'a1', type: 'angle', shapes: ['l1', 'l2'], value: 90, offset: 25 };

  const aHover = renderSvg(aJoints, aShapes, [angDim], { hovered: angDim });
  const aSel = renderSvg(aJoints, aShapes, [angDim], { selected: new Set([angDim]) });
  assert(!aHover.includes('<rect') && !aSel.includes('<rect'), 'angle dimension emits no glow <rect> when hovered or selected');
  assert(aHover.includes('fill:#5B96E8'), 'hovered angle label uses HOVER_COLOR');
  assert(aSel.includes('fill:var(--sk-selection, #1e40af)'), 'selected angle label uses --sk-selection');
}

console.log('dim-stray-dot-and-label-box: ok');
