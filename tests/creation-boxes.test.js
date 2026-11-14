// tests/creation-boxes.test.js — TASK 596: the creation tools (polygon, rect, circle) show their value boxes ON THE CANVAS right after the first click,
// through ONE shared path (base-tool openCreationBoxes / followCreationBoxes / cancelCreation + numeric-input-manager's two-field and one-field boxes).
// Real SketchStudio page in the node kit (tests/helpers/node-app.js), real pointer + key events, no stub.
//  polygon: no Sides field in the ribbon; nothing on the canvas before the click; after it, R + N; typing 8 = an octagon preview; Tab, then a size = that radius;
//           Enter places it as ONE undo step; the next polygon starts with 8; Esc cancels; the first typed digit is kept.
//  rect:    after the first click W + H; Tab / Shift+Tab switch with the typed value kept; a typed side locks it while the other follows the cursor; exact sizes; one undo step.
//  circle:  after the first click the DIAMETER box (task 597); a typed diameter gives that diameter (radius = half, the radius dimension as before); one undo step; the first digit is kept.
//  line:    (task 597) after the first click the L + angle boxes; typed length 50 + Tab + angle 30 gives exactly that segment; the chain's next segment has its boxes; one undo step; Esc = the canvas Esc.
//  arc:     (task 597) after the centre click the radius box, after the start click the sweep box; typed values exact; one undo step; Esc = the canvas Esc.
//  square:  (task 597) a typed 40 x 40 rectangle gets its size constraints like a typed 40 x 30 one.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { arcSweepInfo } from '#core/geometry.js';

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
  const edges = () => st.shapes.filter((s) => s.type === 'line' && !s.isConstruction);
  const world = (id) => st.joints.get(id);
  const hist = () => st.shapes.length + ':' + st.joints.size + ':' + st.constraints.length;

  // ───────────────────────────── polygon
  app.tool('polygon');
  assert.strictEqual(doc.getElementById('polygon-sides'), null, 'polygon: no Sides field in the ribbon');
  assert.strictEqual(doc.querySelector('.sk-ribbon-poly'), null, 'polygon: no ribbon wrapper for it either');
  assert(idleBoxes(), 'polygon: before the first click nothing extra shows on the canvas');
  const base = hist();
  clickAt(P(0, 0));
  assert(dualBox(), 'polygon: after the centre click the boxes show');
  let f = dualFields();
  assert.deepStrictEqual(f.map((x) => x.placeholder), ['R', 'N'], 'polygon: size and sides');
  assert.strictEqual(f[1].value, '6', 'polygon: the remembered side count (default 6) is in the sides box');
  assert.strictEqual(doc.activeElement, f[0], 'polygon: the size box has the focus');
  app.move(P(40, 0).x, P(40, 0).y);
  const w0 = { ...world(st.active.start) };
  assert(parseFloat(f[0].value) > 0.2, 'polygon: the size box follows the cursor: ' + f[0].value);
  app.key('Tab');
  assert.strictEqual(doc.activeElement, f[1], 'polygon: Tab goes to the sides box');
  app.type('8');
  assert.strictEqual(st.active.preview.sides, 8, 'polygon: typing 8 gives an octagon preview');
  assert.strictEqual(st.preview.properties.sides, 8);
  app.key('Tab');
  assert.strictEqual(doc.activeElement, f[0], 'polygon: Tab goes back to the size box');
  app.type('25');
  const cur = st.active.preview.pt;
  assert(Math.abs(Math.hypot(cur.x - w0.x, cur.y - w0.y) - 25) < 1e-9, 'polygon: a typed size is the preview radius');
  app.move(P(60, 30).x, P(60, 30).y);   // the cursor turns it, the typed size holds
  const cur2 = st.active.preview.pt;
  assert(Math.abs(Math.hypot(cur2.x - w0.x, cur2.y - w0.y) - 25) < 1e-9, 'polygon: the typed size holds while the cursor moves');
  assert.strictEqual(f[0].value, '25', 'polygon: and keeps its typed text');
  app.enter();
  assert.strictEqual(edges().length, 8, 'polygon: Enter places the octagon');
  const verts = new Set(); for (const s of edges()) s.joints.forEach((j) => verts.add(j));
  for (const j of verts) assert(Math.abs(Math.hypot(world(j).x - w0.x, world(j).y - w0.y) - 25) < 1e-6, 'polygon: every corner is 25 from the centre');
  assert(idleBoxes(), 'polygon: the boxes are gone after placing');
  assert.strictEqual(st.polygonSides, 8, 'polygon: 8 is remembered (state.polygonSides)');
  st.undo();
  assert.strictEqual(hist(), base, 'polygon: ONE undo removes the whole polygon');
  // the next polygon starts with 8; a digit typed straight away is kept; Esc cancels
  clickAt(P(0, 0));
  f = dualFields();
  assert.strictEqual(f[1].value, '8', 'polygon: the next polygon starts with 8');
  app.type('7');
  assert.strictEqual(f[0].value, '7', 'polygon: the first typed digit is kept (not lost)');
  app.esc();
  assert(idleBoxes(), 'polygon: Esc closes the boxes');
  assert.strictEqual(st.active, null, 'polygon: Esc cancels the draw');
  assert.strictEqual(hist(), base, 'polygon: Esc leaves nothing and no undo step');
  assert.strictEqual(st.polygonSides, 8, 'polygon: an Esc keeps the remembered count');
  // Esc inside the box is the SAME Esc as on the canvas: both cancel the draw AND go to Select
  const escState = () => JSON.stringify({ tool: st.currentTool, active: st.active, hist: hist(), boxes: !idleBoxes() });
  app.tool('polygon'); clickAt(P(0, 0)); app.esc(); const viaBox = escState();
  app.tool('polygon'); clickAt(P(0, 0)); doc.activeElement.blur(); app.esc(); const viaCanvas = escState();
  assert.strictEqual(viaBox, viaCanvas, 'Esc in the box = Esc on the canvas: ' + viaBox + ' vs ' + viaCanvas);
  assert.strictEqual(st.currentTool, 'select', 'Esc goes to Select');
  // Enter with no size (cursor still on the centre, nothing typed): a no-op, the box stays open and the draw waits
  app.tool('polygon'); clickAt(P(0, 0)); app.enter();
  assert(dualBox() && st.active && st.active.waitingForSecondClick, 'polygon: Enter with radius 0 keeps the box open and the draw waiting');
  app.type('15'); app.enter();
  assert.strictEqual(edges().length, 8, 'polygon: then a typed R places it (8 = the remembered count)');
  app.undo();
  assert.strictEqual(hist(), base);
  app.tool('polygon');
  // a click places it too (no Enter), at the cursor
  clickAt(P(0, 0)); app.move(P(50, 0).x, P(50, 0).y); app.click(P(50, 0).x, P(50, 0).y);
  assert.strictEqual(edges().length, 8, 'polygon: a second click places it (8 sides, the remembered count)');
  assert(idleBoxes(), 'polygon: boxes gone after the click');
  app.undo();
  assert.strictEqual(hist(), base, 'polygon: one undo');
  console.log('polygon: ok');

  // ───────────────────────────── rect
  app.esc(); app.tool('rect');
  assert(idleBoxes(), 'rect: nothing before the first click');
  clickAt(P(0, 0));
  assert(dualBox(), 'rect: after the first click the W x H boxes show (no digit needed)');
  f = dualFields();
  assert.deepStrictEqual(f.map((x) => x.placeholder), ['W', 'H'], 'rect: W and H');
  assert.strictEqual(doc.activeElement, f[0], 'rect: W has the focus');
  app.type('40');
  assert.strictEqual(f[0].value, '40', 'rect: the first typed digit is kept');
  app.move(P(100, 70).x, P(100, 70).y);
  assert.strictEqual(f[0].value, '40', 'rect: the typed W holds');
  assert(parseFloat(f[1].value) > 0.2 && f[1].value !== '0.0', 'rect: H follows the cursor: ' + f[1].value);
  app.key('Tab');
  assert.strictEqual(doc.activeElement, f[1], 'rect: Tab goes to H');
  app.type('30');
  app.key('Tab', { shift: true });
  assert.strictEqual(doc.activeElement, f[0], 'rect: Shift+Tab goes back to W');
  assert.strictEqual(f[0].value, '40', 'rect: W keeps its typed value'); assert.strictEqual(f[1].value, '30', 'rect: H keeps its typed value');
  app.enter();
  const rl = edges();
  assert.strictEqual(rl.length, 4, 'rect: Enter places the rectangle');
  const xs = new Set(), ys = new Set(); for (const s of rl) for (const j of s.joints) { xs.add(Math.round(world(j).x * 1e6)); ys.add(Math.round(world(j).y * 1e6)); }
  const [xa, xb] = [...xs].sort((a, b) => a - b), [ya, yb] = [...ys].sort((a, b) => a - b);
  assert(Math.abs((xb - xa) / 1e6 - 40) < 1e-4 && Math.abs((yb - ya) / 1e6 - 30) < 1e-4, `rect: exactly 40 x 30 (${(xb - xa) / 1e6} x ${(yb - ya) / 1e6})`);
  assert(idleBoxes(), 'rect: boxes gone after placing');
  app.undo();
  assert.strictEqual(hist(), base, 'rect: ONE undo removes it');
  // typed W only, placed by a click: W exact, H at the cursor
  clickAt(P(0, 0)); f = dualFields(); app.type('40');
  app.move(P(90, 55).x, P(90, 55).y); app.click(P(90, 55).x, P(90, 55).y);
  const w1 = edges().flatMap((s) => s.joints).map((j) => world(j));
  const wx = Math.max(...w1.map((p) => p.x)) - Math.min(...w1.map((p) => p.x)), wy = Math.max(...w1.map((p) => p.y)) - Math.min(...w1.map((p) => p.y));
  assert(Math.abs(wx - 40) < 1e-4, 'rect: a typed W is exact when a click places it: ' + wx);
  assert(Math.abs(wy - 40) > 0.1, 'rect: and H followed the cursor: ' + wy);
  app.undo(); assert.strictEqual(hist(), base);
  // Esc cancels
  clickAt(P(0, 0)); app.esc();
  assert(idleBoxes() && st.active === null && hist() === base, 'rect: Esc cancels, boxes gone, nothing left');
  console.log('rect: ok');

  // ───────────────────────────── circle
  app.esc(); app.tool('circle');
  assert(idleBoxes(), 'circle: nothing before the first click');
  clickAt(P(0, 0));
  assert(dimBox(), 'circle: after the first click the diameter box shows');
  const rb = dimBox();
  assert.strictEqual(doc.activeElement, rb, 'circle: the diameter box has the focus');
  app.move(P(40, 0).x, P(40, 0).y);
  const cc = world(st.active.start), cp = st.active.preview.pt;
  assert(Math.abs(parseFloat(rb.value) - 2 * Math.hypot(cp.x - cc.x, cp.y - cc.y)) < 0.06 && parseFloat(rb.value) > 0.4, 'circle: the box shows the DIAMETER the cursor makes (2 x the radius): ' + rb.value);
  app.type('24');
  assert.strictEqual(rb.value, '24', 'circle: the first typed digit is kept');
  app.enter();
  const circ = st.shapes.filter((s) => s.type === 'circle');
  assert.strictEqual(circ.length, 1, 'circle: Enter places it');
  assert.strictEqual(circ[0].radius, 12, 'circle: a typed diameter 24 gives radius exactly 12');
  const rc = st.constraints.filter((c) => c.shape === circ[0].id && c.type === 'distance');
  assert.strictEqual(rc.length, 1, 'circle: one size constraint');
  assert(rc[0].isRadius === true && rc[0].value === 12, 'circle: the constraint is the existing radius dimension (isRadius, value = the radius): ' + JSON.stringify(rc[0]));
  assert(idleBoxes(), 'circle: box gone');
  app.undo();
  assert.strictEqual(hist(), base, 'circle: ONE undo');
  clickAt(P(0, 0)); app.esc();
  assert(idleBoxes() && st.active === null && hist() === base, 'circle: Esc cancels');
  console.log('circle: ok');

  // ───────────────────────────── line (task 597)
  const lineSegs = () => st.shapes.filter((s) => s.type === 'line' && !s.isConstruction);
  const deg = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  app.esc(); app.tool('line');
  assert(idleBoxes(), 'line: nothing before the first click');
  clickAt(P(0, 0));
  assert(dualBox(), 'line: after the first click the length + angle boxes show (no digit needed)');
  f = dualFields();
  assert.deepStrictEqual(f.map((x) => x.placeholder), ['L', '\u00B0'], 'line: length and angle');
  assert.strictEqual(doc.activeElement, f[0], 'line: the length box has the focus');
  assert.strictEqual(doc.getElementById('live-dim-length'), null, 'line: the old digit-opened length box is gone');
  assert.strictEqual(doc.getElementById('live-dim-angle'), null, 'line: and the old angle box');
  app.move(P(80, 40).x, P(80, 40).y);
  assert(parseFloat(f[0].value) > 0.4 && f[1].value !== '0.0', 'line: the boxes follow the cursor: ' + f[0].value + ' / ' + f[1].value);
  const ls = { ...world(st.active.start) };
  app.type('50');
  assert.strictEqual(f[0].value, '50', 'line: the first typed digit is kept');
  const pv = () => st.active.preview.pt;
  assert(Math.abs(Math.hypot(pv().x - ls.x, pv().y - ls.y) - 50) < 1e-9, 'line: the typed length holds the preview');
  app.move(P(90, -30).x, P(90, -30).y);   // the cursor turns it: the length holds, the angle follows
  assert(Math.abs(Math.hypot(pv().x - ls.x, pv().y - ls.y) - 50) < 1e-9, 'line: the typed length holds while the cursor moves');
  app.key('Tab');
  assert.strictEqual(doc.activeElement, f[1], 'line: Tab goes to the angle box');
  app.type('30');
  assert(Math.abs(deg(ls, pv()) - 30) < 1e-9 && Math.abs(Math.hypot(pv().x - ls.x, pv().y - ls.y) - 50) < 1e-9, 'line: length 50 and angle 30 in the preview');
  app.key('Tab', { shift: true });
  assert.strictEqual(doc.activeElement, f[0], 'line: Shift+Tab goes back to the length');
  assert(f[0].value === '50' && f[1].value === '30', 'line: both keep their typed text');
  app.enter();
  assert.strictEqual(lineSegs().length, 1, 'line: Enter places the segment');
  const seg = lineSegs()[0], sa = world(seg.joints[0]), sb = world(seg.joints[1]);
  assert(Math.abs(Math.hypot(sb.x - sa.x, sb.y - sa.y) - 50) < 1e-9, 'line: exactly length 50: ' + Math.hypot(sb.x - sa.x, sb.y - sa.y));
  assert(Math.abs(deg(sa, sb) - 30) < 1e-9, 'line: exactly angle 30: ' + deg(sa, sb));
  const ld = st.constraints.filter((c) => c.type === 'distance' && c.joints && c.joints.includes(seg.joints[0]) && c.joints.includes(seg.joints[1]));
  assert(ld.length === 1 && ld[0].value === 50, 'line: the typed length is a distance constraint (50): ' + JSON.stringify(ld));
  assert(dualBox() && st.active && st.active.mode === 'line', 'line: the chain goes on: the next segment has its boxes at once');
  app.esc();
  assert(idleBoxes() && st.active === null, 'line: Esc ends the chain and closes the boxes');
  assert.strictEqual(lineSegs().length, 1, 'line: the committed segment stays');
  app.undo();
  assert.strictEqual(hist(), base, 'line: ONE undo removes the segment (and leaves no stray point)');
  // a typed length only, placed by a click: the length is exact, the angle is the cursor's
  app.tool('line'); clickAt(P(0, 0)); f = dualFields(); app.type('50');
  app.move(P(100, 100).x, P(100, 100).y); app.click(P(100, 100).x, P(100, 100).y);
  const seg2 = lineSegs()[0], ca = world(seg2.joints[0]), cb = world(seg2.joints[1]);
  assert(Math.abs(Math.hypot(cb.x - ca.x, cb.y - ca.y) - 50) < 1e-9, 'line: a click places the typed length exactly');
  assert(Math.abs(Math.abs(deg(ca, cb)) - 45) < 3, 'line: along the cursor: ' + deg(ca, cb));
  assert(dualBox(), 'line: and the next segment has its boxes after a click too');
  app.esc(); app.undo(); assert.strictEqual(hist(), base);
  // nothing typed: a click places it at the cursor, no size constraint
  app.tool('line'); clickAt(P(0, 0)); app.move(P(60, 0).x, P(60, 0).y); app.click(P(60, 0).x, P(60, 0).y);
  assert.strictEqual(lineSegs().length, 1, 'line: a plain click-click still draws a line');
  assert.strictEqual(st.constraints.filter((c) => c.type === 'distance' && c.joints && c.joints.includes(lineSegs()[0].joints[0]) && c.joints.includes(lineSegs()[0].joints[1])).length, 0, 'line: with no typed length there is no size constraint');
  app.esc(); app.undo(); assert.strictEqual(hist(), base);
  // Enter with no length (the cursor still on the start, nothing typed): a no-op, the boxes stay
  app.tool('line'); clickAt(P(0, 0)); app.enter();
  assert(dualBox() && st.active, 'line: Enter with no length keeps the boxes open and the draw going');
  app.esc();
  // Esc inside the box is the SAME Esc as on the canvas
  const lineEsc = () => JSON.stringify({ tool: st.currentTool, active: st.active, hist: hist(), boxes: !idleBoxes() });
  app.tool('line'); clickAt(P(0, 0)); app.esc(); const lvBox = lineEsc();
  app.tool('line'); clickAt(P(0, 0)); doc.activeElement.blur(); app.esc(); const lvCanvas = lineEsc();
  assert.strictEqual(lvBox, lvCanvas, 'line: Esc in the box = Esc on the canvas: ' + lvBox + ' vs ' + lvCanvas);
  assert.strictEqual(hist(), base, 'line: Esc leaves nothing');
  console.log('line: ok');

  // ───────────────────────────── arc (task 597): the one arc kind the app has is centre - start - end
  const arcs = () => st.shapes.filter((s) => s.type === 'arc');
  app.esc(); app.tool('arc');
  assert(idleBoxes(), 'arc: nothing before the first click');
  clickAt(P(0, 0));
  assert(dimBox(), 'arc: after the centre click the radius box shows');
  let ab = dimBox();
  assert.strictEqual(doc.activeElement, ab, 'arc: the radius box has the focus');
  app.move(P(70, 0).x, P(70, 0).y);
  assert(parseFloat(ab.value) > 0.4, 'arc: the radius follows the cursor: ' + ab.value);
  app.type('30');
  assert.strictEqual(ab.value, '30', 'arc: the first typed digit is kept');
  const ac = { ...world(st.active.center) };
  app.move(P(90, 20).x, P(90, 20).y);
  assert(Math.abs(Math.hypot(st.active.preview.pt.x - ac.x, st.active.preview.pt.y - ac.y) - 30) < 1e-9, 'arc: the typed radius holds the start point while the cursor moves');
  app.click(P(90, 20).x, P(90, 20).y);   // the start click
  assert(st.active && st.active.phase === 'start', 'arc: the click set the start point');
  const sj = world(st.active.start);
  assert(Math.abs(Math.hypot(sj.x - ac.x, sj.y - ac.y) - 30) < 1e-9, 'arc: the start point is exactly 30 from the centre');
  ab = dimBox();
  assert(ab, 'arc: after the start click the sweep box shows'); assert.strictEqual(doc.activeElement, ab, 'arc: the sweep box has the focus');
  app.move(P(60, 80).x, P(60, 80).y); app.move(P(0, 90).x, P(0, 90).y);   // wind the cursor round
  assert(parseFloat(ab.value) > 1, 'arc: the sweep follows the cursor: ' + ab.value);
  app.type('90');
  assert.strictEqual(ab.value, '90');
  app.enter();
  assert.strictEqual(arcs().length, 1, 'arc: Enter places the arc');
  const ar = arcs()[0], [jc, js2, je] = ar.joints.map((j) => world(j));
  assert(Math.abs(Math.hypot(js2.x - jc.x, js2.y - jc.y) - 30) < 1e-9 && Math.abs(Math.hypot(je.x - jc.x, je.y - jc.y) - 30) < 1e-9, 'arc: radius exactly 30');
  const info = arcSweepInfo(jc, js2, je, { sweep: ar.sweep });
  assert(Math.abs(info.span * 180 / Math.PI - 90) < 1e-7, 'arc: sweep exactly 90 degrees: ' + info.span * 180 / Math.PI);
  const rd = st.constraints.filter((c) => c.shape === ar.id && c.type === 'distance' && c.isRadius);
  assert(rd.length === 1 && Math.abs(rd[0].value - 30) < 1e-9, 'arc: the typed radius is the radius dimension (30)');
  assert(idleBoxes() && st.active === null, 'arc: boxes gone after placing');
  app.undo();
  assert.strictEqual(hist(), base, 'arc: ONE undo removes the arc (and its centre / start points)');
  // clicks only (nothing typed): still a plain arc, no radius dimension
  app.tool('arc'); clickAt(P(0, 0)); app.move(P(40, 0).x, P(40, 0).y); app.click(P(40, 0).x, P(40, 0).y); app.move(P(30, 30).x, P(30, 30).y); app.click(P(0, 40).x, P(0, 40).y);
  assert.strictEqual(arcs().length, 1, 'arc: three plain clicks still make an arc');
  assert.strictEqual(st.constraints.filter((c) => c.shape === arcs()[0].id && c.type === 'distance').length, 0, 'arc: no size constraint when nothing was typed');
  app.undo(); assert.strictEqual(hist(), base);
  // Enter with no radius: a no-op, the box stays
  app.tool('arc'); clickAt(P(0, 0)); app.enter();
  assert(dimBox() && st.active && st.active.phase === 'center', 'arc: Enter with no radius keeps the box open');
  app.esc();
  // Esc: in the radius box, in the sweep box, on the canvas: all the same
  const arcEsc = () => JSON.stringify({ tool: st.currentTool, active: st.active, hist: hist(), boxes: !idleBoxes() });
  app.tool('arc'); clickAt(P(0, 0)); app.esc(); const avBox = arcEsc();
  app.tool('arc'); clickAt(P(0, 0)); doc.activeElement.blur(); app.esc(); const avCanvas = arcEsc();
  assert.strictEqual(avBox, avCanvas, 'arc: Esc in the box = Esc on the canvas: ' + avBox + ' vs ' + avCanvas);
  assert.strictEqual(hist(), base, 'arc: Esc leaves nothing');
  app.tool('arc'); clickAt(P(0, 0)); app.move(P(40, 0).x, P(40, 0).y); app.click(P(40, 0).x, P(40, 0).y); assert(dimBox(), 'arc: sweep box up'); app.esc();
  assert(idleBoxes() && st.active === null && hist() === base, 'arc: Esc in the sweep box cancels everything');
  console.log('arc: ok');

  // ───────────────────────────── a typed square (task 597): its size constraints like any other typed size
  const edgeDims = (v) => edges().map((e2) => st.constraints.filter((c) => c.type === 'distance' && c.joints && c.joints.length === 2 && e2.joints.includes(c.joints[0]) && e2.joints.includes(c.joints[1]) && Math.abs(c.value - v) < 1e-9).length);
  for (const how of ['enter', 'click']) {
    app.tool('rect'); clickAt(P(0, 0)); app.type('40'); app.key('Tab'); app.type('40'); app.move(P(100, 100).x, P(100, 100).y);
    if (how === 'enter') app.enter(); else app.click(P(100, 100).x, P(100, 100).y);
    assert.strictEqual(edges().length, 4, 'square (' + how + '): placed');
    assert.deepStrictEqual(edgeDims(40), [1, 1, 1, 1], 'square (' + how + '): every side carries its 40 size constraint');
    app.undo(); assert.strictEqual(hist(), base, 'square (' + how + '): one undo');
    app.tool('rect'); clickAt(P(0, 0)); app.type('40'); app.key('Tab'); app.type('30'); app.move(P(100, 100).x, P(100, 100).y);
    if (how === 'enter') app.enter(); else app.click(P(100, 100).x, P(100, 100).y);
    assert.strictEqual(edgeDims(40).reduce((a, b) => a + b) + edgeDims(30).reduce((a, b) => a + b), 4, 'rect 40 x 30 (' + how + '): the same four size constraints as the square');
    app.undo(); assert.strictEqual(hist(), base);
  }
  console.log('square: ok');

  // picking another tool in the middle of a draw takes the boxes away with the draw, and what was typed is forgotten
  for (const t of ['polygon', 'rect', 'circle', 'line', 'arc']) {
    app.esc(); app.tool(t); clickAt(P(0, 0)); app.type('9');
    assert(!idleBoxes(), t + ': boxes up before the switch');
    app.tool('select');
    assert(idleBoxes(), t + ': picking another tool closes the boxes');
    assert.strictEqual(hist(), base, t + ': and leaves nothing');
    if (t === 'line' || t === 'arc') continue;   // a line / arc click-click is not finished (chain / start phase): nothing more to place
    app.tool(t); clickAt(P(0, 0)); app.move(P(40, 30).x, P(40, 30).y); app.click(P(40, 30).x, P(40, 30).y);
    app.undo(); assert.strictEqual(hist(), base);
  }
  console.log('tool switch: ok');
  // the tools' setups made ONE value box each of #dualInput and #dimInput (duplicate ids break focus and queries)
  assert.strictEqual(doc.querySelectorAll('#dualInput').length, 1, 'exactly one #dualInput');
  assert.strictEqual(doc.querySelectorAll('#dimInput').length, 1, 'exactly one #dimInput');
  assert.strictEqual(doc.querySelectorAll('.sk-dual-input').length, 1, 'exactly one dual box element');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; } else console.log('creation-boxes: ok');
