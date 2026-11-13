// tests/drag-own-midpoint-node.test.js - TASK 576 (node port of tests/drag-own-midpoint-live.test.js, TASK 552), SketchStudio through
// tests/helpers/node-app.js: a line's end is dragged to 50 px from the midpoint of ITS OWN line and the cursor stops. No snap target is within the
// screen threshold, so the drawn end must be exactly under the cursor (gap 0). Until task 552 the drag's midpoint inference compared
// SNAP.MIDPOINT (screen px) with a WORLD distance and included the dragged end's own line: at 78 px per unit the end stuck to the midpoint.
// Two zooms: the default (78 px per unit) and zoomed out. The axis snap and the grid magnet are off so a gap left can only be the midpoint.
// The drawn end is read from the line element the renderer drew (screen px); the zoom is wheel events on the canvas until under 45 px per unit.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { lines } from './helpers/node-dom-read.js';
import { worldToScreen } from '#ui/coords.js';
import settings from '#core/settings-manager.js';

const results = [];
let failed = null;
try {
  for (const zoom of ['default', 'zoomed-out']) {
    const app = await open({ host: 'sketchstudio' });
    try {
      settings.set('AXIS_SNAP', false); settings.set('GRID_MAGNETISM', 0.001);
      const r = app.svg.getBoundingClientRect();
      const c = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      const ppu = () => worldToScreen(app.svg, { x: 1, y: 0 }).x - worldToScreen(app.svg, { x: 0, y: 0 }).x;
      if (zoom === 'zoomed-out') for (let i = 0; i < 80; i++) { if (ppu() < 45) break; app.svg.dispatchEvent(new app.window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, deltaX: 0, deltaY: 500 })); app.frames(); }
      const k = ppu();
      // a short free line well above the origin joint, drawn with the line tool: the 100 px of the default zoom is 1.3 units (its end is
      // 0.64 units from its own midpoint, inside the 1 unit the old world-unit threshold gave), the 50 px line at 37 px per unit is 1.35
      const y = c.y - 200, half = zoom === 'default' ? 50 : 25;
      app.tool('line'); app.click(c.x - half, y - half * 0.5); app.click(c.x + half, y + half * 0.5);
      app.esc();
      app.tool('select');
      const before = lines(app)[0];
      assert.ok(Math.hypot(before[1].x - (c.x + half), before[1].y - (y + half * 0.5)) < 3, `the line end is drawn where it was placed (${zoom})`);
      app.move(c.x + half, y + half * 0.5); app.down(c.x + half, y + half * 0.5);
      // a straight path away from the line's direction (18 degrees up, not along the line: no parallel / H / V rule holds the end); the line stays under
      // twice the old threshold (a half line shorter than 1 unit), so the old rule snapped the end to the line's own midpoint, half the line from the cursor
      const from = { x: c.x + half, y: y + half * 0.5 }, stop = { x: from.x + 0.28 * 2 * half, y: from.y - 0.09 * 2 * half }, n = 12; let cur = from;
      for (let i = 1; i <= n; i++) { cur = { x: from.x + (stop.x - from.x) * i / n, y: from.y + (stop.y - from.y) * i / n }; app.move(cur.x, cur.y, { buttons: 1 }); }
      app.frames(10);
      const after = lines(app)[0];
      const gap = Math.hypot(after[1].x - cur.x, after[1].y - cur.y);
      app.up(cur.x, cur.y);
      results.push(`${zoom} (${k.toFixed(2)} px per unit): the cursor stopped ${Math.hypot(stop.x - from.x, stop.y - from.y).toFixed(0)} px from where the end was grabbed (a ${(2 * half).toFixed(0)} px line), drawn end ${gap.toFixed(2)} px from the cursor`);
      assert.ok(gap < 1, `${zoom}: the dragged end stays under the cursor (gap ${gap.toFixed(2)} px)`);
    } catch (e) { failed = e; } finally { await app.close(); }
    if (failed) break;
  }
  if (!failed) { console.log(results.join('\n')); console.log('drag-own-midpoint-node: ok'); }
} catch (e) { failed = e; }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
