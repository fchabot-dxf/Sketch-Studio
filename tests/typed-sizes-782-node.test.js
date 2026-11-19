// tests/typed-sizes-782-node.test.js — TASK 782: the drawing tools' typed input (real SketchStudio page in the node kit, real pointer + key events).
//  A  centre-point rectangle: a typed W / H holds at the click AND at Enter, and the same two dimensions the 2-point rectangle keeps are kept
//  B  a click on the first point (a double click) makes NO zero-size shape, in the 2-point / centre / 3-point rectangle, the circle and the arc (the click is ignored, the draw keeps waiting)
//  C  a typed 2-point rectangle gets ONE width and ONE height dimension (it used to get four: two of them reference, with two notices)
//  D  the line's angle box counts counter-clockwise: the cursor up-right on the screen shows +45 and a typed 45 draws up-right
//  E  centre-point slot: the length box is the FULL centre-to-centre length and a typed length is kept as a dimension
//  F  a typed size of 0 or less is refused by the box (red field + hint) and nothing is drawn until it is fixed or cleared
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { RECT_MODES, SLOT_MODES, CONSTRAINT_TYPES } from '#core/constants.js';

const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
  const st = app.state, doc = app.document;
  const O = app.toScreen(0, 0);
  const P = (dx, dy) => ({ x: O.x + 300 + dx, y: O.y + 150 + dy });   // away from the origin, where a click snaps
  const shown = (el) => !!el && !el.classList.contains('hidden') && el.style.display !== 'none';
  const dualBox = () => [...doc.querySelectorAll('.sk-dual-input')].find(shown) || null;
  const dualFields = () => { const b = dualBox(); return b ? [...b.querySelectorAll('input')] : []; };
  const dimBox = () => { const d = doc.getElementById('dimInput'); return shown(d) ? d : null; };
  const idleBoxes = () => !dualBox() && !dimBox();
  const clickAt = (p) => app.click(p.x, p.y);
  const moveTo = (p) => app.move(p.x, p.y);
  const lines = () => st.shapes.filter((s) => s.type === 'line' && !s.isConstruction);
  const world = (id) => st.joints.get(id);
  const lenOf = (s) => Math.hypot(world(s.joints[1]).x - world(s.joints[0]).x, world(s.joints[1]).y - world(s.joints[0]).y);
  const hist = () => st.shapes.length + ':' + st.joints.size + ':' + st.constraints.length;
  const dists = () => st.constraints.filter((c) => c.type === CONSTRAINT_TYPES.DISTANCE && !c.isRadius);
  const toasts = () => { const c = doc.getElementById('notification-container'); return c ? c.children.length : 0; };
  const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
  const nearBox = (a, b, msg) => assert(Math.abs(a - b) < 6e-4, `${msg}: ${a} vs ${b}`);   // a box shows its value rounded to 3 decimals
  const failures = [];
  const section = (name, fn) => { try { fn(); } catch (e) { failures.push(name + ': ' + String(e.message).split('\n')[0]); } };   // every section runs: a failure names the item (A..F)
  let d0, f;
  const reset = () => { app.esc(); app.esc(); while (st.shapes.length) { const n = st.shapes.length; app.undo(); if (st.shapes.length === n) break; } };

  // ───────────────── A: centre-point rectangle, typed sides (click and Enter)
  section('A', () => {
  for (const how of ['click', 'enter']) {
    reset();
    app.tool('rect'); st.rectMode = RECT_MODES.CENTER;
    const d0 = dists().length, t0 = toasts();
    clickAt(P(0, 0));
    assert(dualBox(), `A ${how}: the W x H boxes show after the centre click`);
    moveTo(P(100, 60));
    const f = dualFields();
    assert.deepStrictEqual(f.map((x) => x.placeholder), ['W', 'H'], `A ${how}: W and H`);
    const wBox = parseFloat(f[0].value), hBox = parseFloat(f[1].value);
    const pv = st.active.preview.pt, c = world(st.active.start);
    nearBox(wBox, 2 * Math.abs(pv.x - c.x), `A ${how}: the W box is the FULL width (twice the centre-to-cursor distance)`);
    nearBox(hBox, 2 * Math.abs(pv.y - c.y), `A ${how}: the H box is the FULL height`);
    app.type('4'); app.key('Tab'); app.type('2');
    moveTo(P(150, 120));   // the cursor moves on: the typed sides hold
    if (how === 'click') clickAt(P(150, 120)); else app.enter();
    const made = lines();
    assert.strictEqual(made.length, 4, `A ${how}: four sides`);
    assert.deepStrictEqual(made.map(lenOf).map((v) => +v.toFixed(6)).sort(), [2, 2, 4, 4], `A ${how}: the sides are the typed 4 x 2, not the cursor's`);
    const nd = dists().slice(d0);
    assert.deepStrictEqual(nd.map((d) => d.value).sort(), [2, 4], `A ${how}: ONE width and ONE height dimension`);
    assert(nd.every((d) => !d.isDriven && !d.driven), `A ${how}: both drive`);
    assert.strictEqual(toasts(), t0, `A ${how}: no notice`);
    assert(idleBoxes() && st.active === null, `A ${how}: boxes closed`);
    // the dimensions are on a horizontal and a vertical side (not both on the construction diagonals)
    const sides = nd.map((d) => { const a = world(d.joints[0]), b = world(d.joints[1]); return Math.abs(a.y - b.y) < 1e-9 ? 'h' : (Math.abs(a.x - b.x) < 1e-9 ? 'v' : 'diag'); }).sort();
    assert.deepStrictEqual(sides, ['h', 'v'], `A ${how}: on a horizontal and a vertical side`);
  }
  // nothing typed: no dimensions (as before)
  reset(); app.tool('rect'); st.rectMode = RECT_MODES.CENTER;
  d0 = dists().length; clickAt(P(0, 0)); clickAt(P(100, 60));
  assert.strictEqual(lines().length, 4, 'A plain: placed');
  assert.strictEqual(dists().length, d0, 'A plain: no dimension when nothing was typed');

  });
  // ───────────────── B: a click on the first point places nothing
  section('B', () => {
  const refused = (name, setup, first, again) => {
    reset(); setup();
    clickAt(first); const h1 = hist(); const act = st.active;
    assert(act, `B ${name}: the first click starts the draw`);
    for (let i = 0; i < again; i++) clickAt(first);
    assert.strictEqual(hist(), h1, `B ${name}: the clicks on the same spot add nothing`);
    assert(st.active, `B ${name}: the draw keeps waiting for a real click`);
    app.esc(); app.esc();
  };
  refused('2-point rectangle', () => { app.tool('rect'); st.rectMode = RECT_MODES.TWO_POINT; }, P(0, 0), 2);
  refused('centre rectangle', () => { app.tool('rect'); st.rectMode = RECT_MODES.CENTER; }, P(0, 0), 2);
  refused('3-point rectangle (base)', () => { app.tool('rect'); st.rectMode = RECT_MODES.THREE_POINT; }, P(0, 0), 2);
  refused('circle', () => app.tool('circle'), P(0, 0), 1);
  refused('arc', () => app.tool('arc'), P(0, 0), 2);
  // a 2-point rectangle on the same row / column is flat too
  reset(); app.tool('rect'); st.rectMode = RECT_MODES.TWO_POINT; clickAt(P(0, 0)); const hh = hist(); clickAt(P(100, 0));
  assert.strictEqual(hist(), hh, 'B 2-point: a click in the first point\'s row places nothing (zero height)'); app.esc(); app.esc();
  // 3-point: a third click ON the base line places nothing; a real one does
  reset(); app.tool('rect'); st.rectMode = RECT_MODES.THREE_POINT;
  clickAt(P(0, 0)); clickAt(P(100, 0)); const h3 = hist();
  clickAt(P(50, 0));
  assert.strictEqual(hist(), h3, 'B 3-point: the third click on the base line adds nothing');
  assert.strictEqual(lines().length, 0, 'B 3-point: no flat rectangle');
  clickAt(P(50, 40));
  assert.strictEqual(lines().length, 4, 'B 3-point: a real third click places the rectangle');
  assert(Math.min(...lines().map(lenOf)) > 0.5, 'B 3-point: the height is real');
  // the shapes that already refused still do
  reset(); app.tool('polygon'); clickAt(P(0, 0)); clickAt(P(0, 0));   // the polygon cancels the draw on such a click (its own, older answer): still no shape
  assert.strictEqual(st.shapes.length + st.constraints.length, 0, 'B polygon: a second click on the centre makes nothing');

  });
  // ───────────────── C: a typed 2-point rectangle: ONE width, ONE height, no notices
  section('C', () => {
  for (const how of ['click', 'enter']) {
    reset(); app.tool('rect'); st.rectMode = RECT_MODES.TWO_POINT;
    d0 = dists().length; const t0 = toasts();
    clickAt(P(0, 0)); moveTo(P(100, 60)); app.type('4'); app.key('Tab'); app.type('3');
    if (how === 'click') clickAt(P(100, 60)); else app.enter();
    assert.strictEqual(lines().length, 4, `C ${how}: placed`);
    const nd = dists().slice(d0);
    assert.deepStrictEqual(nd.map((d) => d.value).sort(), [3, 4], `C ${how}: two dimensions, not four`);
    assert(nd.every((d) => !d.isDriven && !d.driven), `C ${how}: none is a reference`);
    assert.strictEqual(toasts(), t0, `C ${how}: no "Dimension added as reference" notice`);
  }

  });
  // ───────────────── D: the line's angle box counts counter-clockwise
  section('D', () => {
  reset(); app.tool('line');
  clickAt(P(0, 0)); moveTo(P(100, -100));   // 45 degrees UP and to the right on the screen
  f = dualFields();
  assert.deepStrictEqual(f.map((x) => x.placeholder), ['L', '°'], 'D: length and angle');
  near(parseFloat(f[1].value), 45, 'D: the cursor up-right shows +45');
  moveTo(P(100, 100));
  near(parseFloat(f[1].value), -45, 'D: the cursor down-right shows -45');
  const l0 = lines().length; const s0 = world(st.active.start);
  app.type('2'); app.key('Tab'); app.type('45'); app.enter();
  assert.strictEqual(lines().length, l0 + 1, 'D: typed 2 / 45 places a segment');
  let seg = lines()[l0], a = world(seg.joints[0]), b = world(seg.joints[1]);
  near(Math.hypot(b.x - a.x, b.y - a.y), 2, 'D: length 2');
  assert(b.x > a.x && b.y < a.y, 'D: a typed 45 goes up-right on the screen (y grows downward)');
  near(b.x - a.x, 2 * Math.SQRT1_2, 'D: dx'); near(a.y - b.y, 2 * Math.SQRT1_2, 'D: dy');
  app.esc(); app.esc();
  reset(); app.tool('line'); clickAt(P(0, 0)); moveTo(P(100, 100)); app.type('2'); app.key('Tab'); app.type('-45'); app.enter();
  seg = lines()[0]; a = world(seg.joints[0]); b = world(seg.joints[1]);
  assert(b.x > a.x && b.y > a.y, 'D: a typed -45 goes down-right on the screen'); app.esc(); app.esc();
  // the other angle boxes: the arc's sweep is an amount (0..360), not a direction; the polygon has no angle box; the dimension angle is between two lines (no direction)

  });
  // ───────────────── E: centre-point slot: the length box is the FULL length
  section('E', () => {
  reset(); app.tool('slot'); st.slotMode = SLOT_MODES.CENTER_POINT;
  clickAt(P(0, 0)); moveTo(P(100, 0));
  let box = dimBox(); assert(box, 'E: the length box shows after the first click');
  const centre = st.active.picks[0].pt, cur = st.tempMousePos;
  assert(Math.hypot(cur.x - centre.x, cur.y - centre.y) > 0.5, 'E: the cursor is away from the centre');
  nearBox(parseFloat(box.value), 2 * Math.hypot(cur.x - centre.x, cur.y - centre.y), 'E: the box is twice the centre-to-cursor distance (the full length)');
  app.type('6'); app.enter();
  assert(st.active && st.active.phase === 'width', 'E: Enter moves on to the width');
  moveTo(P(150, 30)); clickAt(P(150, 30));
  const cl = st.shapes.find((s) => s.type === 'line' && s.isConstruction);
  assert(cl, 'E: the construction centre line');
  near(lenOf(cl), 6, 'E: the slot is the typed 6 long');
  const dd = dists().filter((c) => Math.abs(c.value - 6) < 1e-9);
  assert.strictEqual(dd.length, 1, 'E: the typed length is kept as ONE dimension (6)');
  assert(dd[0].joints.includes(cl.joints[0]) && dd[0].joints.includes(cl.joints[1]), 'E: between the two end centres');
  // no typed length: no length dimension
  reset(); app.tool('slot'); st.slotMode = SLOT_MODES.CENTER_POINT;
  const nd0 = dists().length; clickAt(P(0, 0)); moveTo(P(100, 0)); clickAt(P(100, 0)); moveTo(P(100, 30)); clickAt(P(100, 30));
  assert.strictEqual(dists().length, nd0, 'E: nothing typed: no length dimension');

  });
  // ───────────────── F: typed 0 or less is refused
  section('F', () => {
  const hint = () => doc.getElementById('dimHint');
  const hintShown = () => !!hint() && shown(hint()) && /more than 0/.test(hint().textContent);
  reset(); app.tool('rect'); st.rectMode = RECT_MODES.TWO_POINT;
  clickAt(P(0, 0)); moveTo(P(100, 60)); const hf = hist();
  f = dualFields(); app.type('0'); app.key('Tab'); app.type('2');
  assert.strictEqual(f[0].getAttribute('aria-invalid'), 'true', 'F: the 0 width is marked invalid');
  assert.notStrictEqual(f[1].getAttribute('aria-invalid'), 'true', 'F: the good height is not');
  assert(hintShown(), 'F: the hint says why');
  app.enter();
  assert.strictEqual(hist(), hf, 'F: Enter with a 0 width places nothing'); assert(dualBox(), 'F: the box stays open');
  clickAt(P(100, 60));
  assert.strictEqual(hist(), hf, 'F: a click with a refused size places nothing'); assert(st.active, 'F: the draw is still on');
  app.key('Tab'); app.key('Tab');   // back to W
  app.key('z', { ctrl: true });   // Ctrl+Z restores the box's default (clears the typed 0)
  assert.notStrictEqual(f[0].getAttribute('aria-invalid'), 'true', 'F: cleared: no longer invalid'); assert(!hintShown(), 'F: and no hint');
  app.type('-3');
  assert.strictEqual(f[0].getAttribute('aria-invalid'), 'true', 'F: -3 is invalid'); app.enter();
  assert.strictEqual(hist(), hf, 'F: Enter with -3 places nothing');
  app.esc(); app.esc();
  assert(idleBoxes() && !hintShown(), 'F: Esc closes the box and the hint');
  // fixed: a valid size places
  reset(); app.tool('rect'); st.rectMode = RECT_MODES.TWO_POINT; d0 = dists().length;
  clickAt(P(0, 0)); moveTo(P(100, 60)); f = dualFields(); app.type('-3'); app.enter();
  assert.strictEqual(lines().length, 0, 'F: still nothing');
  app.key('a', { ctrl: true }); app.type('5');   // select all, type: the text is "5"
  assert.notStrictEqual(f[0].getAttribute('aria-invalid'), 'true', 'F: fixed text: valid');
  app.enter();
  assert.strictEqual(lines().length, 4, 'F: a fixed size places the rectangle'); near(Math.max(...lines().map(lenOf)), 5, 'F: at the fixed width');
  // circle and line: one shared check
  reset(); app.tool('circle'); clickAt(P(0, 0)); moveTo(P(60, 0)); app.type('0'); const hc = hist(); app.enter();
  assert.strictEqual(hist(), hc, 'F circle: typed 0 places nothing'); assert.strictEqual(dimBox().getAttribute('aria-invalid'), 'true', 'F circle: the box is invalid'); assert(hintShown(), 'F circle: hint');
  app.esc(); app.esc();
  reset(); app.tool('line'); clickAt(P(0, 0)); moveTo(P(60, 0)); app.type('-2'); const hl = hist(); app.enter();
  assert.strictEqual(hist(), hl, 'F line: typed -2 places nothing'); assert.strictEqual(dualFields()[0].getAttribute('aria-invalid'), 'true', 'F line: the length is invalid');
  // an angle may be negative or 0: no refusal
  app.key('Tab'); app.type('-30');
  assert.notStrictEqual(dualFields()[1].getAttribute('aria-invalid'), 'true', 'F line: a negative ANGLE is fine');
  app.esc(); app.esc();
  });
  if (failures.length) throw new Error('FAILED sections:\n  ' + failures.join('\n  '));
  console.log('typed-sizes-782-node: ok');
} catch (e) { failed = e; }
finally { await app.close(); }
if (failed) { console.error(failed); process.exit(1); }
