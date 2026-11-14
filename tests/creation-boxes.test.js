// tests/creation-boxes.test.js — TASK 596: the creation tools (polygon, rect, circle) show their value boxes ON THE CANVAS right after the first click,
// through ONE shared path (base-tool openCreationBoxes / followCreationBoxes / cancelCreation + numeric-input-manager's two-field and one-field boxes).
// Real SketchStudio page in the node kit (tests/helpers/node-app.js), real pointer + key events, no stub.
//  polygon: no Sides field in the ribbon; nothing on the canvas before the click; after it, R + N; typing 8 = an octagon preview; Tab, then a size = that radius;
//           Enter places it as ONE undo step; the next polygon starts with 8; Esc cancels; the first typed digit is kept.
//  rect:    after the first click W + H; Tab / Shift+Tab switch with the typed value kept; a typed side locks it while the other follows the cursor; exact sizes; one undo step.
//  circle:  after the first click the radius box; a typed radius is exact; one undo step; the first digit is kept.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

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
  assert(dimBox(), 'circle: after the first click the radius box shows');
  const rb = dimBox();
  assert.strictEqual(doc.activeElement, rb, 'circle: the radius box has the focus');
  app.move(P(40, 0).x, P(40, 0).y);
  assert(parseFloat(rb.value) > 0.2, 'circle: the box follows the cursor: ' + rb.value);
  app.type('12');
  assert.strictEqual(rb.value, '12', 'circle: the first typed digit is kept');
  app.enter();
  const circ = st.shapes.filter((s) => s.type === 'circle');
  assert.strictEqual(circ.length, 1, 'circle: Enter places it');
  assert.strictEqual(circ[0].radius, 12, 'circle: exactly the typed radius');
  assert(idleBoxes(), 'circle: box gone');
  app.undo();
  assert.strictEqual(hist(), base, 'circle: ONE undo');
  clickAt(P(0, 0)); app.esc();
  assert(idleBoxes() && st.active === null && hist() === base, 'circle: Esc cancels');
  console.log('circle: ok');

  // picking another tool in the middle of a draw takes the boxes away with the draw, and what was typed is forgotten
  for (const t of ['polygon', 'rect', 'circle']) {
    app.esc(); app.tool(t); clickAt(P(0, 0)); app.type('9');
    assert(!idleBoxes(), t + ': boxes up before the switch');
    app.tool('select');
    assert(idleBoxes(), t + ': picking another tool closes the boxes');
    assert.strictEqual(hist(), base, t + ': and leaves nothing');
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
