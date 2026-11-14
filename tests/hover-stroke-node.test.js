// tests/hover-stroke-node.test.js — TASK 626: hover and selection feedback = thicker stroke in bright Fusion blue (#017AFD), no glow / halo anywhere; GLOW_WIDTH_PX removed.
import assert from 'node:assert';
import fs from 'node:fs';
import { createProfile, createNamedDesign, open, loadGlyphSheetFromDisk } from './helpers/node-app.js';

await loadGlyphSheetFromDisk();

const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { STYLE_SETTING_KEYS, STYLE_TEMPLATES } = await import('../packages/ui/style-templates.js');
const { draw } = await import('../packages/ui/svg-renderer.js');

// 1. GLOW_WIDTH_PX removed everywhere; bright Fusion blue (#017AFD) vs cyan-blue free line (#2B9BD6)
assert.strictEqual(SettingsManager.getDefault('GLOW_WIDTH_PX'), undefined, 'GLOW_WIDTH_PX removed from DEFAULT_SETTINGS');
assert.ok(!STYLE_SETTING_KEYS.includes('GLOW_WIDTH_PX'), 'GLOW_WIDTH_PX removed from STYLE_SETTING_KEYS');
for (const tpl of STYLE_TEMPLATES) {
  assert.ok(!Object.hasOwn(tpl.settings, 'GLOW_WIDTH_PX'), `template ${tpl.id} has no GLOW_WIDTH_PX`);
}
const panelSrc = fs.readFileSync(new URL('../packages/ui/style-panel.js', import.meta.url), 'utf8');
assert.ok(!panelSrc.includes('GLOW_WIDTH_PX') && !panelSrc.includes('Glow Width'), 'GLOW_WIDTH_PX removed from style-panel CONTROLS');

assert.strictEqual(SettingsManager.getDefault('HOVER_COLOR'), undefined, 'HOVER_COLOR is not a setting (hover is always --sk-selection)');
assert.ok(!STYLE_SETTING_KEYS.includes('HOVER_COLOR'), 'HOVER_COLOR removed from STYLE_SETTING_KEYS');
const cssSrc = fs.readFileSync(new URL('../packages/ui/sketcher.css', import.meta.url), 'utf8');
assert.match(cssSrc, /--sk-constraint-fill:\s*#2B9BD6/i, 'free line token is cyan-blue #2B9BD6');
assert.match(cssSrc, /--sk-selection:\s*#017AFD/i, '--sk-selection token is bright Fusion blue #017AFD');

// 2. Direct renderer check across all 4 curve types (line, circle, arc, bezier), constrained + free, plus joints and glyphs
{
  const joints = new Map([
    ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sk1' }],
    ['c_end', { x: 80, y: 0, fixed: true, sketchId: 'sk1' }],
    ['f1', { x: 10, y: 40, fixed: false, sketchId: 'sk1' }],
    ['f2', { x: 90, y: 40, fixed: false, sketchId: 'sk1' }],
    ['cc', { x: 150, y: 50, fixed: false, sketchId: 'sk1' }],
    ['ac', { x: 250, y: 50, fixed: false, sketchId: 'sk1' }],
    ['as', { x: 280, y: 50, fixed: false, sketchId: 'sk1' }],
    ['ae', { x: 250, y: 80, fixed: false, sketchId: 'sk1' }],
    ['b0', { x: 320, y: 20, fixed: false, sketchId: 'sk1' }],
    ['b1', { x: 380, y: 80, fixed: false, sketchId: 'sk1' }],
  ]);
  const shapes = [
    { id: 'line_constrained', type: 'line', joints: ['j_origin', 'c_end'], sketchId: 'sk1' },
    { id: 'line_free', type: 'line', joints: ['f1', 'f2'], sketchId: 'sk1' },
    { id: 'cir1', type: 'circle', joints: ['cc'], radius: 25, sketchId: 'sk1' },
    { id: 'arc1', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'], radius: 30, sketchId: 'sk1' },
    { id: 'bez1', type: 'bezier', joints: ['b0', 'b1'], c1: [340, 10], c2: [360, 90], sketchId: 'sk1' },
  ];
  const hConstraint = { id: 'c_h', type: 'horizontal', joints: ['f1', 'f2'], sketchId: 'sk1' };
  const constraints = [hConstraint];

  const renderState = ({ selShapes = [], hovShape = null, selJoints = [], hovJoint = null, selCons = [], hovCon = null } = {}) => {
    const svg = {
      viewBox: { baseVal: { x: -20, y: -20, width: 450, height: 150 } },
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 450, height: 150 }),
      innerHTML: '',
    };
    draw(
      joints, shapes, svg, null, null, constraints,
      new Set(selJoints), new Set(selCons), 'select', null,
      new Set(selShapes), hovShape, hovJoint, hovCon, null, null, false, null
    );
    return svg.innerHTML;
  };

  const shapeTag = (html, id) => {
    const m = html.match(new RegExp(`<(?:line|circle|path)[^>]*data-shape-id="${id}"[^>]*>`));
    assert.ok(m, `shape ${id} rendered`);
    const tag = m[0];
    const sw = Number((tag.match(/stroke-width="([^"]+)"/) || [])[1]);
    const style = (tag.match(/style="([^"]+)"/) || [])[1] || '';
    return { tag, sw, style };
  };

  const noGlowUnderStrokes = (html) => {
    assert.ok(!/stroke-opacity="0\.28"/.test(html), 'no 0.28 glow under-stroke element');
    assert.ok(!/stroke-opacity="0\.2"/.test(html), 'no 0.2 arc/bezier glow under-stroke element');
    assert.ok(!/stroke-opacity="0\.4"/.test(html), 'no 0.4 joint hover halo');
    assert.ok(!/fill-opacity="0\.4"/.test(html) && !/fill-opacity="0\.5"/.test(html), 'no glyph halo disc');
  };

  const restHtml = renderState();
  noGlowUnderStrokes(restHtml);
  const restLineSw = shapeTag(restHtml, 'line_free').sw;
  assert.match(shapeTag(restHtml, 'line_constrained').style, /stroke:#8DB84A/i, 'fully locked line at rest is Fusion green (LOCKED_LINE_COLOR)');
  assert.match(shapeTag(restHtml, 'line_free').style, /--sk-constraint-fill.*#60A5FA/, 'free line at rest uses cyan-blue token');

  const hoverMult = SettingsManager.getDefault('HOVER_FEEDBACK_MULT');
  const selMult = SettingsManager.getDefault('SELECTION_FEEDBACK_MULT');

  for (const id of ['line_constrained', 'line_free', 'cir1', 'arc1', 'bez1']) {
    const hHtml = renderState({ hovShape: id });
    noGlowUnderStrokes(hHtml);
    const hShape = shapeTag(hHtml, id);
    assert.ok(Math.abs(hShape.sw - restLineSw * hoverMult) < 1e-6, `${id} hovered stroke-width = ${hoverMult}x rest width`);
    assert.match(hShape.style, /stroke:var\(--sk-selection, #017AFD\)/i, `${id} hovered uses bright Fusion blue token`);

    const sHtml = renderState({ selShapes: [id] });
    noGlowUnderStrokes(sHtml);
    const sShape = shapeTag(sHtml, id);
    assert.ok(Math.abs(sShape.sw - restLineSw * selMult) < 1e-6, `${id} selected stroke-width = ${selMult}x rest width`);
    assert.match(sShape.style, /stroke:var\(--sk-selection, #017AFD\)/i, `${id} selected uses bright Fusion blue token (even when constrained)`);
  }

  // Glyph hover & selection: thicker outline on .fusion-glyph, no halo disc, bound line thicker with no glow
  const glyphSw = (html) => {
    const m = html.match(/<g class="fusion-glyph"[^>]*style="([^"]+)"[^>]*stroke-width="([^"]+)"/);
    assert.ok(m, 'fusion-glyph rendered');
    return { style: m[1], sw: Number(m[2]) };
  };
  const restGlyph = glyphSw(restHtml);

  const hGlyphHtml = renderState({ hovCon: hConstraint });
  noGlowUnderStrokes(hGlyphHtml);
  const hGlyph = glyphSw(hGlyphHtml);
  assert.ok(Math.abs(hGlyph.sw - restGlyph.sw * hoverMult) < 1e-3, 'hovered glyph outline width = HOVER_FEEDBACK_MULT x rest');
  assert.match(hGlyph.style, /stroke:var\(--sk-glyph-hover/, 'hovered glyph outline uses --sk-glyph-hover');
  const boundHov = shapeTag(hGlyphHtml, 'line_free');
  assert.ok(Math.abs(boundHov.sw - restLineSw * hoverMult) < 1e-6, 'bound line on glyph hover uses HOVER_FEEDBACK_MULT x rest');
  assert.match(boundHov.style, /stroke:var\(--sk-glyph-hover/, 'bound line on glyph hover uses --sk-glyph-hover');

  const sGlyphHtml = renderState({ selCons: [hConstraint] });
  noGlowUnderStrokes(sGlyphHtml);
  const sGlyph = glyphSw(sGlyphHtml);
  assert.ok(Math.abs(sGlyph.sw - restGlyph.sw * selMult) < 1e-3, 'selected glyph outline width = SELECTION_FEEDBACK_MULT x rest');
  assert.match(sGlyph.style, /stroke:var\(--sk-glyph-selected/, 'selected glyph outline uses --sk-glyph-selected');
}

// 3. Node-app integration check: real pointer hover & click on lines, points, and glyphs
{
  const profile = await createProfile();
  const doc = {
    version: 3, hosts: {},
    geometry: {
      joints: [
        ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ['r1', { x: 60, y: 0, fixed: false, sketchId: 'sketch-1' }],
        ['r2', { x: 60, y: 40, fixed: false, sketchId: 'sketch-1' }],
        ['r3', { x: 0, y: 40, fixed: false, sketchId: 'sketch-1' }],
        ['p1', { x: 90, y: 10, fixed: false, sketchId: 'sketch-1' }],
        ['p2', { x: 140, y: 10, fixed: false, sketchId: 'sketch-1' }],
      ],
      shapes: [
        { id: 'rE1', type: 'line', joints: ['j_origin', 'r1'], sketchId: 'sketch-1', isConstruction: false },
        { id: 'rE2', type: 'line', joints: ['r1', 'r2'], sketchId: 'sketch-1', isConstruction: false },
        { id: 'rE3', type: 'line', joints: ['r2', 'r3'], sketchId: 'sketch-1', isConstruction: false },
        { id: 'rE4', type: 'line', joints: ['r3', 'j_origin'], sketchId: 'sketch-1', isConstruction: false },
        { id: 'pE1', type: 'line', joints: ['p1', 'p2'], sketchId: 'sketch-1', isConstruction: false },
      ],
      constraints: [
        { type: 'horizontal', joints: ['j_origin', 'r1'] },
        { type: 'vertical', joints: ['r1', 'r2'] },
        { type: 'horizontal', joints: ['r2', 'r3'] },
        { type: 'vertical', joints: ['r3', 'j_origin'] },
        { type: 'distance', joints: ['j_origin', 'r1'], value: 60, offset: -15 },
        { type: 'distance', joints: ['j_origin', 'r3'], value: 40, offset: -15 },
      ],
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [], vcarves: [],
    },
  };
  await createNamedDesign(profile, 'sketchstudio', 'Hover Stroke Test', doc);
  const app = await open({ host: 'sketchstudio', profile });
  app.tool('select');
  const away = app.toScreen(-30, -30);
  app.move(away.x, away.y);

  const getPointAt = (wx, wy) => [...app.svg.querySelectorAll('circle')].find((c) =>
    Math.abs(Number(c.getAttribute('cx')) - wx) < 1e-3 &&
    Math.abs(Number(c.getAttribute('cy')) - wy) < 1e-3 &&
    (c.getAttribute('style') || '').includes('fill:var(--sk-joint-')
  );
  const restOpenDot = getPointAt(90, 10);
  assert.ok(restOpenDot, 'open end p1 visible at rest');
  const restJointSw = Number(restOpenDot.getAttribute('stroke-width'));
  assert.match(restOpenDot.getAttribute('style'), /stroke:var\(--sk-joint-ring, #333333\)/, 'point at rest has the 80% black ring');

  // Hover open end p1: ring thickens to 2x and turns bright Fusion blue, fill stays white
  const p1s = app.toScreen(90, 10);
  app.move(p1s.x, p1s.y);
  const hovOpenDot = getPointAt(90, 10);
  assert.ok(Math.abs(Number(hovOpenDot.getAttribute('stroke-width')) - restJointSw) < 1e-6, 'hovered point ring is the rest width');
  assert.match(hovOpenDot.getAttribute('style'), /fill:var\(--sk-joint-fill, white\)/, 'hovered point keeps white fill');
  assert.match(hovOpenDot.getAttribute('style'), /stroke:var\(--sk-joint-ring, #333333\)/i, 'hovered point ring is the normal rest ring');

  // Click open end p1: ring is 1.5x thicker and bright Fusion blue, fill is blue-tinted
  app.click(p1s.x, p1s.y);
  app.move(away.x, away.y);
  const selOpenDot = getPointAt(90, 10);
  assert.ok(Math.abs(Number(selOpenDot.getAttribute('stroke-width')) - restJointSw * SettingsManager.getDefault('SELECTION_FEEDBACK_MULT')) < 1e-6, 'selected point ring is SELECTION_FEEDBACK_MULT thicker');
  assert.match(selOpenDot.getAttribute('style'), /fill:var\(--sk-joint-selected/, 'selected point has blue-tinted fill');
  assert.match(selOpenDot.getAttribute('style'), /stroke:var\(--sk-selection, #017AFD\)/i, 'selected point ring is bright Fusion blue');

  await app.close();
}

console.log('hover-stroke-node.test.js passed');
