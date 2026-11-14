// tests/midpoint-snap-glyph-preview-node.test.js - TASK 631, SketchStudio through tests/helpers/node-app.js: while a point snaps to a line's
// MIDPOINT (the line tool placing its end, a select-tool drag of a free line end) the midpoint constraint glyph is drawn at the snap as a
// preview (opacity 0.8, the one preview path of svg-renderer), moving away removes it, release adds the MIDPOINT constraint in ONE undo step.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { px } from './helpers/node-dom-read.js';
import settings from '#core/settings-manager.js';

const isPreviewGlyph = (g) => /opacity:\s*0\.8/.test(g.getAttribute('style') || '');
const previews = (app) => [...app.svg.querySelectorAll('g.constraint-glyph')].filter(isPreviewGlyph);
const midpoints = (app) => app.state.constraints.filter((c) => c.type === 'midpoint');

let failed = null;
const app = await open({ host: 'sketchstudio' });
try {
  settings.set('AXIS_SNAP', false); settings.set('GRID_MAGNETISM', 0.001);
  const r = app.svg.getBoundingClientRect();
  const c = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const a = { x: c.x - 120, y: c.y - 200 }, b = { x: c.x + 120, y: c.y - 200 }, mid = { x: c.x, y: c.y - 200 };

  // the target line
  app.tool('line'); app.click(a.x, a.y); app.click(b.x, b.y); app.esc();
  assert.equal(previews(app).length, 0, 'no preview glyph without a snap');

  // 1. line tool: the second end hovers the midpoint
  app.tool('line'); app.click(c.x - 60, c.y - 60);
  app.move(mid.x + 40, mid.y + 40); app.move(mid.x + 1, mid.y + 1); app.frames(5);
  let p = previews(app);
  assert.equal(p.length, 1, 'line tool: one midpoint glyph preview at the snap (' + p.length + ')');
  const gp = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(p[0].getAttribute('transform'));
  const m = px(app, +gp[1], +gp[2]);
  assert.ok(Math.hypot(m.x - mid.x, m.y - mid.y) < 50, 'the glyph sits at the snap, offset like inference glyphs (' + m.x.toFixed(0) + ',' + m.y.toFixed(0) + ' vs ' + mid.x + ',' + mid.y + ')');
  app.move(mid.x + 120, mid.y + 120); app.frames(5);
  assert.equal(previews(app).length, 0, 'line tool: moving away removes the preview');
  app.move(mid.x + 1, mid.y + 1); app.frames(5);
  assert.equal(previews(app).length, 1, 'line tool: back on the midpoint, the preview returns');
  app.esc(); app.esc(); app.frames(5);
  assert.equal(previews(app).length, 0, 'line tool: cancelled, no preview');

  // 2. select tool: drag a free line end to the midpoint, check, move away, return, release
  app.tool('line'); app.click(c.x - 100, c.y + 100); app.click(c.x + 100, c.y + 100); app.esc();
  app.tool('select');
  const end = { x: c.x + 100, y: c.y + 100 };
  const steps = (from, to, n = 10) => { for (let i = 1; i <= n; i++) app.move(from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n, { buttons: 1 }); };
  const histBefore = app.state.history ? (app.state.history.undoStack || app.state.history.undo || []).length : null;
  app.move(end.x, end.y); app.down(end.x, end.y);
  steps(end, { x: mid.x + 30, y: mid.y + 50 }); steps({ x: mid.x + 30, y: mid.y + 50 }, { x: mid.x + 2, y: mid.y + 3 }, 6); app.frames(10);
  assert.equal(previews(app).length, 1, 'drag: one midpoint glyph preview while the end sits on the midpoint (' + previews(app).length + ')');
  steps({ x: mid.x + 2, y: mid.y + 3 }, { x: mid.x + 150, y: mid.y + 150 }); app.frames(10);
  assert.equal(previews(app).length, 0, 'drag: moving away removes the preview');
  steps({ x: mid.x + 150, y: mid.y + 150 }, { x: mid.x + 2, y: mid.y + 3 }); app.frames(10);
  assert.equal(previews(app).length, 1, 'drag: back on the midpoint, the preview returns');
  assert.equal(midpoints(app).length, 0, 'nothing added before release');
  app.up(mid.x + 2, mid.y + 3); app.frames(10);
  assert.equal(previews(app).length, 0, 'released: no preview glyph left');
  assert.equal(midpoints(app).length, 1, 'release adds the MIDPOINT constraint (' + midpoints(app).length + ')');
  const mc = midpoints(app)[0];
  assert.ok(app.svg.querySelectorAll('g.constraint-glyph').length >= 1, 'the real midpoint glyph is drawn after release');
  app.undo(); app.frames(5);
  assert.equal(midpoints(app).length, 0, 'one undo removes the MIDPOINT constraint (and the drag with it)');
  void mc; void histBefore;
  console.log('midpoint-snap-glyph-preview-node: ok');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
