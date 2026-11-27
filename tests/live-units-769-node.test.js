// tests/live-units-769-node.test.js -- TASK 769: the values shown and typed WHILE DRAWING follow the document unit (owner turn 2315: an INCH document
// showed "317.5 x 167.6" for a 12.5 x 6.6 in rectangle, and a bare "2" typed in a box drew 2 mm).
//  1. THE box text (boxValueText, packages/ui/numeric-input-manager.js) and THE box parse (parseBoxValue): length in mm / cm / in documents, Decimal and
//     Fractional, the Length / Angle precision settings, an angle, a count; a length's box text is exactly the committed dimension label's text (formatLenLabel)
//  2. the real tools in the node kit (SketchStudio page, the app's own pointer / key listeners): Rectangle (2-point, centre, 3-point), Line, Circle,
//     Polygon, Arc, Slot. In an INCH document the on-canvas live labels and the box read inches, a typed bare 2 is 2 in (50.8 mm), "50mm" is 50 mm,
//     "1 1/2" is 38.1 mm; in a MM document the texts are what they always were (toFixed(1)) and a bare 2 is 2 mm.
//  3. a unit / display change while the box is open re-shows it in the new unit (a typed value keeps its length)
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import SettingsManager, { angleText } from '#core/settings-manager.js';
import * as box from '#ui/numeric-input-manager.js';
import { formatLenLabel } from '#ui/svg-renderer.js';
import { RECT_MODES } from '#core/constants.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m, tol = 1e-9) => { assert.ok(typeof a === 'number' && Math.abs(a - b) < tol, `${m}: ${a} vs ${b}`); checks++; };
const set = (o) => { for (const [k, v] of Object.entries(o)) SettingsManager.set(k, v, { persist: false }); };
const DEFAULTS = { DOC_UNIT: 'mm', INCH_DISPLAY: 'decimal', LENGTH_FRACTION: 16, LENGTH_PRECISION: 3, ANGLE_PRECISION: 1, TRAILING_ZEROS: false };
const IN = 25.4;

// ---- A. the tools in the node kit (first: on the old code it fails here, on what the user sees) ----
const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
  const st = app.state, doc = app.document;
  const S = (wx, wy) => app.toScreen(wx, wy);
  const liveLabels = () => [...app.svg.querySelectorAll('text')].filter((t) => /2563eb/i.test(t.getAttribute('style') || '') && !t.closest('.dim-label')).map((t) => t.textContent);
  const shown = (el) => !!el && el.style.display !== 'none' && !el.classList.contains('hidden');
  const boxes = () => [...doc.querySelectorAll('#dualInput input, #dimInput, #live-dim-width, #live-dim-height')].filter((i) => shown(i) && shown(i.closest('#dualInput') || i)).map((i) => i.value);
  const newShapes = (n0) => st.shapes.slice(n0);
  const lenOf = (s) => { const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return Math.hypot(b.x - a.x, b.y - a.y); };
  const reset = () => { app.esc(); app.esc(); };

  const scene = (unit, disp = 'decimal') => {
    set({ ...DEFAULTS, DOC_UNIT: unit, INCH_DISPLAY: disp });
    const tag = `${unit} ${disp}`;
    const want = (v) => formatLenLabel(v); // the committed dimension label's text
    const L = (v) => v * { mm: 1, cm: 10, in: IN }[unit]; // a bare typed number, in mm

    // Rectangle, 2-point: labels W (top) and H (left), the box W x H; typed 2 Tab 1 Enter
    app.tool('rect'); st.rectMode = RECT_MODES.TWO_POINT;
    const a = S(20, -20), b = S(83.5, -58.1);
    app.click(a.x, a.y); app.move(b.x, b.y);
    let w = Math.abs(st.active.preview.pt.x - st.active.startPt.x), h = Math.abs(st.active.preview.pt.y - st.active.startPt.y);
    eq(liveLabels(), [want(w), want(h)], `${tag} rect 2pt: the on-canvas labels`);
    eq(boxes(), [want(w), want(h)], `${tag} rect 2pt: the box W x H`);
    if (unit === 'in' && disp === 'decimal') eq(liveLabels(), [String(Number((w / IN).toFixed(3))), String(Number((h / IN).toFixed(3)))], 'inch rect: the labels are inches, never the mm number');
    let n0 = st.shapes.length;
    app.type('2'); app.key('Tab'); doc.querySelector('#dualInput input:last-of-type').focus(); app.type('1'); app.enter();
    let made = newShapes(n0).filter((s) => s.type === 'line');
    eq(made.length, 4, `${tag} rect 2pt typed: 4 lines`);
    near(Math.max(...made.map(lenOf)), L(2), `${tag} rect 2pt typed bare 2: the width`);
    near(Math.min(...made.map(lenOf)), L(1), `${tag} rect 2pt typed bare 1: the height`);
    reset();

    // Rectangle, centre: labels; TASK 782: the W x H boxes show from the first click (as in the 2-point mode), so a typed digit goes in the focused width box
    app.tool('rect'); st.rectMode = RECT_MODES.CENTER;
    const c = S(150, -30), d = S(180, -50);
    app.click(c.x, c.y); app.move(d.x, d.y);
    w = 2 * Math.abs(st.active.preview.pt.x - st.joints.get(st.active.start).x); h = 2 * Math.abs(st.active.preview.pt.y - st.joints.get(st.active.start).y);
    eq(liveLabels(), [want(w), want(h)], `${tag} rect centre: the on-canvas labels`);
    n0 = st.shapes.length;
    app.type('2');
    eq(boxes()[0], '2', `${tag} rect centre: the digit went in the width box`);
    w = 2 * Math.abs(st.active.preview.pt.x - st.joints.get(st.active.start).x);
    near(w, L(2), `${tag} rect centre: the typed bare 2 holds the width`);
    reset();

    // Line: the length and angle box; typed 2, Tab, 30, Enter
    app.tool('line');
    const p = S(20, 60), q = S(60, 80);
    app.click(p.x, p.y); app.move(q.x, q.y);
    const sp = st.joints.get(st.active.start), ep = st.active.preview.pt;
    const len = Math.hypot(ep.x - sp.x, ep.y - sp.y), ang = -Math.atan2(ep.y - sp.y, ep.x - sp.x) * 180 / Math.PI;   // TASK 782: the angle box counts counter-clockwise (the world's y points down)
    eq(boxes(), [want(len), angleText(ang, { show: 'bare' })], `${tag} line: the box L / angle`);
    n0 = st.shapes.length;
    app.type('2'); doc.querySelector('#dualInput input:last-of-type').focus(); app.type('30'); app.enter();
    made = newShapes(n0).filter((s) => s.type === 'line');
    eq(made.length, 1, `${tag} line typed: one segment`);
    near(lenOf(made[0]), L(2), `${tag} line typed bare 2: the length`);
    reset();

    // Circle: the diameter box; typed 50mm (a unit) Enter
    app.tool('circle');
    const o = S(150, 60), r = S(170, 60);
    app.click(o.x, o.y); app.move(r.x, r.y);
    const rad = Math.hypot(st.active.preview.pt.x - st.active.startPt.x, st.active.preview.pt.y - st.active.startPt.y); // TASK 1034: the centre is held as a point until the build
    eq(boxes(), [want(2 * rad)], `${tag} circle: the diameter box`);
    n0 = st.shapes.length;
    app.type('50mm'); app.enter();
    made = newShapes(n0).filter((s) => s.type === 'circle');
    near(made[0].radius, 25, `${tag} circle typed 50mm: diameter 50 mm`);
    reset();

    // Polygon: size x sides; typed 1 1/2 Enter
    app.tool('polygon');
    const pc = S(250, 60), pr = S(270, 60);
    app.click(pc.x, pc.y); app.move(pr.x, pr.y);
    const prad = Math.hypot(st.active.preview.pt.x - st.joints.get(st.active.start).x, st.active.preview.pt.y - st.joints.get(st.active.start).y);
    eq(boxes(), [want(prad), '6'], `${tag} polygon: the box R x N`);
    n0 = st.shapes.length;
    app.type('1 1/2'); app.enter();
    made = newShapes(n0).filter((s) => s.type === 'line' && s.isConstruction);
    near(lenOf(made[0]), L(1.5), `${tag} polygon typed 1 1/2: the radius`);
    reset();

    // Arc: the radius box (typed bare 2), then the sweep box (an angle: 90)
    app.tool('arc');
    const ac = S(250, -40), as = S(275, -40);
    app.click(ac.x, ac.y); app.move(as.x, as.y);
    const acw = st.joints.get(st.active.center), cur = st.preview.cursorPoint;
    eq(boxes(), [want(Math.hypot(cur.x - acw.x, cur.y - acw.y))], `${tag} arc: the radius box`);
    n0 = st.shapes.length;
    app.type('2'); app.enter();
    app.move(ac.x, ac.y - 30);
    eq(boxes().length, 1, `${tag} arc: the sweep box`);
    app.type('90'); app.enter();
    made = newShapes(n0).filter((s) => s.type === 'arc');
    eq(made.length, 1, `${tag} arc typed: one arc`);
    const [ctr, s1] = made[0].joints.map((id) => st.joints.get(id));
    near(Math.hypot(s1.x - ctr.x, s1.y - ctr.y), L(2), `${tag} arc typed bare 2: the radius`);
    reset();

    // Slot (centre to centre): the span box, typed bare 2
    app.tool('slot');
    const s0 = S(350, -40), s2 = S(380, -40);
    app.click(s0.x, s0.y); app.move(s2.x, s2.y);
    eq(boxes().length, 1, `${tag} slot: the span box`);
    const sp0 = st.active.picks[0].pt, scur = st.preview.cursorPoint;
    eq(boxes()[0], want(Math.hypot(scur.x - sp0.x, scur.y - sp0.y)), `${tag} slot: the span text`);
    app.type('2'); app.enter();
    eq(st.active && st.active.phase, 'width', `${tag} slot: Enter took the span, the width step`);
    near(Math.hypot(st.active.picks[1].pt.x - st.active.picks[0].pt.x, st.active.picks[1].pt.y - st.active.picks[0].pt.y), L(2), `${tag} slot typed bare 2: the span`);
    reset();
  };
  for (const [unit, disp] of [['in', 'decimal'], ['in', 'fractional'], ['mm', 'decimal'], ['cm', 'decimal']]) scene(unit, disp);

  // ---- A3. a unit / display change while the box is open ----
  set({ ...DEFAULTS, DOC_UNIT: 'in' });
  app.tool('rect'); st.rectMode = RECT_MODES.TWO_POINT;
  const a = S(20, -20), b = S(83.5, -58.1);
  app.click(a.x, a.y); app.move(b.x, b.y);
  const w = Math.abs(st.active.preview.pt.x - st.active.startPt.x), h = Math.abs(st.active.preview.pt.y - st.active.startPt.y);
  app.type('2');
  eq(boxes(), ['2', formatLenLabel(h)], 'inch: a typed 2 and the live height');
  set({ DOC_UNIT: 'mm' }); app.frames();
  eq(boxes(), ['50.8', formatLenLabel(h)], 'switched to mm with the box open: the typed 2 in reads 50.8 (its length kept), the live height in mm');
  eq(liveLabels(), ['50.8', formatLenLabel(h)], 'and the on-canvas labels');
  set({ DOC_UNIT: 'in', INCH_DISPLAY: 'fractional' }); app.frames();
  eq(boxes(), ['2"', formatLenLabel(h)], 'back to inches, Fractional: 2" and the live height as a fraction');
  void w;
  reset();
  set(DEFAULTS);
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error('live-units-769-node: FAILED', failed.stack || failed); process.exit(1); }
const boxValueText = (v, q) => box.boxValueText(v, q), parseBoxValue = (t, q) => box.parseBoxValue(t, q);
set(DEFAULTS);
// ---- B. the one text / the one parse ----
eq(boxValueText(317.5), '317.5', 'mm: a length is its mm text, 3 decimals, trailing zeros hidden');
eq(boxValueText(167.64), '167.64', 'mm: 3 decimals default, trailing zeros hidden');
eq(boxValueText(45, 'angle'), '45', 'an angle: degrees, 1 decimal, trailing zeros hidden');
eq(boxValueText(6, 'count'), '6', 'a count: the whole number');
eq([parseBoxValue('2'), parseBoxValue('12.5'), parseBoxValue('2in'), parseBoxValue('1/2'), parseBoxValue(''), parseBoxValue('abc')], [2, 12.5, 2 * IN, 0.5, NaN, NaN], 'mm: a bare number is mm; a unit converts; nothing / garbage is NaN');
eq([parseBoxValue('30', 'angle'), parseBoxValue('45°', 'angle'), parseBoxValue('-30', 'angle'), parseBoxValue('x', 'angle')], [30, 45, -30, NaN], 'an angle: degrees, the degree sign accepted');
eq([parseBoxValue('6', 'count'), parseBoxValue('', 'count')], [6, NaN], 'a count');
set({ DOC_UNIT: 'cm' });
eq([boxValueText(317.5), parseBoxValue('2'), parseBoxValue('5mm')], ['31.75', 20, 5], 'cm: shown in cm, a bare 2 is 2 cm');
set({ DOC_UNIT: 'in' });
eq([boxValueText(317.5), boxValueText(168.275)], ['12.5', '6.625'], 'inch Decimal (default 3, trailing zeros hidden): 12.5 x 6.625');
eq([parseBoxValue('2'), parseBoxValue('50mm'), parseBoxValue('1 1/2'), parseBoxValue('1 1/2"'), parseBoxValue('3/8 in'), parseBoxValue('2"')], [2 * IN, 50, 1.5 * IN, 1.5 * IN, 0.375 * IN, 2 * IN], 'inch: a bare 2 is 2 in; 50mm is 50 mm; fractions');
set({ TRAILING_ZEROS: true });
eq([boxValueText(317.5), boxValueText(168.275), boxValueText(45, 'angle')], ['12.500', '6.625', '45.0'], 'inch + angle with Show trailing zeros ON');
set({ ANGLE_PRECISION: 0 });
eq(boxValueText(44.6, 'angle'), '45', 'Angle precision 0');
set({ LENGTH_PRECISION: 3, ANGLE_PRECISION: 1, TRAILING_ZEROS: false, INCH_DISPLAY: 'fractional' });
eq([boxValueText(317.5), boxValueText(168.275)], ['12 1/2"', '6 5/8"'], 'inch Fractional: 12 1/2" x 6 5/8" (a fraction carries its inch mark, as the labels)');
near(parseBoxValue(boxValueText(168.275)), 168.275, 'the Fractional text reads back as the same length');
for (const unit of ['mm', 'cm', 'in']) for (const disp of ['decimal', 'fractional']) for (const prec of [0, 3]) {
  set({ DOC_UNIT: unit, INCH_DISPLAY: disp, LENGTH_PRECISION: prec });
  for (const v of [0.4, 3.175, 25.4, 168.275, 317.5, 1234.567]) eq(boxValueText(v), formatLenLabel(v), `the box text IS the dimension label text (${unit} ${disp} ${prec} ${v})`);
}
set(DEFAULTS);

console.log(`live-units-769-node: ok (${checks} checks)`);
