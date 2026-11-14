// gate: exclusive
// tests/snap-release-slip-live.test.js — TASK 546 (live headless, REAL mouse via CDP): the pointer-up "release jitter" recovery
// (input-manager handlePointerUp: a snap lost < 200 ms before the release is put back) recovers a SLIP, not a MOVE.
//   1. press on the snapped origin with the Polygon tool, flick 120 px away and release fast (< 200 ms): the hexagon is drawn with
//      its corner where the pointer was released (a point no snap locks on). Before task 546 the press point's snap was recovered at the release, the corner
//      landed on the centre (radius 0) and the tool silently drew nothing (tests/polygon-tool-live.test.js failed on it).
//   2. the recovery still does its job: the Line tool locks its end on the origin, the pointer drags out past the release distance (the snap
//      is lost) and back to a point between the lock and the release distance (no fresh lock), and a fast release still ends the line ON the origin.
// Shaper's Design tab on a fresh profile (an empty design whose origin is on screen); the same shared input layer serves every host.

import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '546', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel) => {
      const c = await centerOf(sel); assert(c, sel + ' not found');
      await mouse('mouseMoved', c.x, c.y, 0); await sleep(30); await mouse('mousePressed', c.x, c.y, 1); await sleep(30); await mouse('mouseReleased', c.x, c.y, 0); await sleep(150);
    };
    // a recorder AFTER the canvas handlers (document, bubble phase): each pointer event's page timestamp and whether the origin snap is
    // locked once the input layer has handled it. The recovery window is 200 ms, so each case states that it ran inside it.
    const arm = () => evalJs(`(() => { window.__r546 = []; const rec = (e) => { const t = window.__designController.state.snapTarget; window.__r546.push({ type: e.type, t: e.timeStamp, origin: !!(t && t.isLocked && t.targetId === 'j_origin'), none: !t, snap: t ? (t.type + ':' + (t.targetId || '') + (t.isLocked ? ':locked' : '')) : null }); }; for (const ev of ['pointerdown', 'pointermove', 'pointerup']) document.addEventListener(ev, rec); window.__r546.stop = () => { for (const ev of ['pointerdown', 'pointermove', 'pointerup']) document.removeEventListener(ev, rec); }; })()`);
    const record = () => evalJs(`(() => { window.__r546.stop(); return window.__r546.slice(); })()`);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded, sleep(8000)]); await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the Shaper to load');
    await clickEl('.sk-header-tab[data-tab="design"]');
    await waitForApp('design-canvas'); // the Design tab's autosave buffer is created when the tab is first entered
    await waitFor(`!!window.__designController && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'the Shaper Design tab to show');

    const S = 'window.__designController.state';
    const origin = await evalJs(`import('#ui/coords.js').then(({ worldToScreen }) => { const p = worldToScreen(document.querySelector('#design-canvas'), ${S}.joints.get('j_origin')); return { x: Math.round(p.x), y: Math.round(p.y) }; })`);
    // lock = the lock distance, release = the hysteresis distance a held lock survives to, reach = findSnap's joint radius
    const magnet = await evalJs(`Promise.all([import('#ui/snap-magnet.js'), import('#core/constants.js')]).then(([{ getMagnetThreshold }, { SNAP }]) => ({ lock: getMagnetThreshold('snap'), release: getMagnetThreshold('snap', true), reach: SNAP.JOINT_PX }))`);
    const empty = await evalJs(`${S}.shapes.length`);
    assert.strictEqual(empty, 0, 'a fresh profile opens an empty Shaper design');
    console.log('origin on screen', JSON.stringify(origin), 'snap lock / release px', JSON.stringify(magnet));
    // A screen point `r` px from the origin where NO snap locks: outside the lock distance of both axes (the axis snap, task 537) and
    // farthest from every grid point (the grid snap). Each case releases on such a point, so its release has no snap of its own and
    // only the recovery can move it.
    const clearPoint = (r, minAxis = magnet.lock) => evalJs(`Promise.all([import('#ui/coords.js'), import('#ui/canvas-grid.js'), import('#ui/snap-magnet.js'), import('#core/settings-manager.js')]).then(([{ worldToScreen, screenToWorld }, { gridSpacing }, { getMagnetThreshold }, { default: SM }]) => {
      const svg = document.querySelector('#design-canvas');
      const { GRID_SIZE } = gridSpacing(SM.get('DOC_UNIT') || 'mm', { GRID_SIZE: Number(SM.get('GRID_SIZE') || SM.getDefault('GRID_SIZE')), GRID_MAJOR_STEP: Number(SM.get('GRID_MAJOR_STEP') || SM.getDefault('GRID_MAJOR_STEP')), INCH_GRID_DIVISIONS: SM.get('INCH_GRID_DIVISIONS'), INCH_GRID_MAJOR: SM.get('INCH_GRID_MAJOR') });
      let best = null;
      for (let deg = 0; deg < 360; deg++) {
        const x = Math.round(${origin.x} + ${r} * Math.cos(deg * Math.PI / 180)), y = Math.round(${origin.y} + ${r} * Math.sin(deg * Math.PI / 180));
        if (Math.min(Math.abs(x - ${origin.x}), Math.abs(y - ${origin.y})) <= ${minAxis}) continue;
        const w = screenToWorld(svg, x, y), g = worldToScreen(svg, { x: Math.round(w.x / GRID_SIZE) * GRID_SIZE, y: Math.round(w.y / GRID_SIZE) * GRID_SIZE });
        const d = Math.hypot(g.x - x, g.y - y);
        if (!best || d > best.gridPx) best = { x, y, gridPx: d };
      }
      return best && Object.assign(best, { gridMagnet: getMagnetThreshold('grid') });
    })`).then((p) => { assert(p && p.gridPx > p.gridMagnet, 'a point ' + r + ' px from the origin clear of the grid and axis snaps: ' + JSON.stringify(p)); return p; });

    // ---- 1. Polygon: press ON the origin (a locked snap), flick 120 px away to a point with no snap, release fast -> a hexagon with its
    //         corner at the release point
    await clickEl('#tool-polygon');
    await mouse('mouseMoved', origin.x, origin.y, 0); await sleep(60);
    const lockedAtPress = await evalJs(`(() => { const t = ${S}.snapTarget; return !!(t && t.isLocked && t.targetId === 'j_origin'); })()`);
    assert(lockedAtPress, 'hovering the origin locks its snap before the press');
    const end = await clearPoint(120, magnet.release); // a lock held from the flick's first move survives out to the RELEASE distance (task 586: a wider canvas moved the grid phase and picked a point in the 16-32 px band)
    await arm();
    await mouse('mousePressed', origin.x, origin.y, 1);
    await mouse('mouseMoved', Math.round((origin.x + end.x) / 2), Math.round((origin.y + end.y) / 2), 1);
    await mouse('mouseMoved', end.x, end.y, 1);
    await mouse('mouseReleased', end.x, end.y, 0); await sleep(300);
    const r1 = await record();
    const down1 = r1.find((r) => r.type === 'pointerdown'), up1 = r1.find((r) => r.type === 'pointerup');
    assert(down1 && up1 && down1.origin, 'the press is on the locked origin snap: ' + JSON.stringify(r1));
    assert(r1.filter((r) => r.type === 'pointermove').pop().none, 'the release point has no snap of its own: ' + JSON.stringify(r1));
    const flickMs = up1.t - down1.t;
    assert(flickMs < 200, 'the flick ran inside the 200 ms recovery window (press -> release ' + flickMs + ' ms)');
    // the corner (the first radius' far joint) on screen: where the pointer was released, never back on the centre 120 px away
    const poly = await evalJs(`import('#ui/coords.js').then(({ worldToScreen }) => { const s = ${S}; const sides = s.shapes.filter((x) => !x.isConstruction); const radii = s.shapes.filter((x) => x.isConstruction); const v = radii[0] && s.joints.get(radii[0].joints[1]); const p = v && worldToScreen(document.querySelector('#design-canvas'), v); return { sides: sides.length, radii: radii.length, cornerPxFromRelease: p ? Math.hypot(p.x - ${end.x}, p.y - ${end.y}) : null }; })`);
    console.log('flick from the origin: press -> release', Math.round(flickMs), 'ms', JSON.stringify(poly));
    assert.strictEqual(poly.sides, 6, 'a fast flick from the snapped origin draws the hexagon (6 sides): ' + JSON.stringify(poly));
    assert.strictEqual(poly.radii, 6, '6 construction radii');
    assert(poly.cornerPxFromRelease !== null && poly.cornerPxFromRelease < 1, 'the corner is where the pointer was released, not back on the centre: ' + JSON.stringify(poly));
    await clickEl('#btn-undo');
    assert.strictEqual(await evalJs(`${S}.shapes.length`), 0, 'one Undo removes the polygon');

    // ---- 2. Line: lock the end on the origin, drag out past the release distance (the snap is lost), come back to a point between the lock
    //         and the release distance (too far to lock afresh), release fast -> the recovery puts the end ON the origin
    await clickEl('#tool-line');
    const start = { x: origin.x - 200, y: origin.y - 120 };
    // a held lock survives to the release distance; a point between the lock and the release distance does not lock afresh, so only the
    // recovery (release within the release distance of the lost snap, < 200 ms after it was held) can put the end on the origin
    assert(magnet.lock < magnet.release, 'a slip band exists between the lock and the release distance: ' + JSON.stringify(magnet));
    const outAt = await clearPoint(magnet.release + 4);
    const slip = Math.ceil((magnet.lock + magnet.release) / 2);
    const slipAt = await clearPoint(slip);
    await mouse('mouseMoved', start.x, start.y, 0); await sleep(60);
    await mouse('mousePressed', start.x, start.y, 1);
    await mouse('mouseMoved', origin.x - 100, origin.y - 60, 1);
    await arm();
    await mouse('mouseMoved', origin.x, origin.y, 1);
    await mouse('mouseMoved', outAt.x, outAt.y, 1);
    await mouse('mouseMoved', slipAt.x, slipAt.y, 1);
    await mouse('mouseReleased', slipAt.x, slipAt.y, 0); await sleep(300);
    const r2 = await record();
    const moves = r2.filter((r) => r.type === 'pointermove'), up2 = r2.find((r) => r.type === 'pointerup');
    assert(moves.length === 3 && moves[0].origin, 'the line end locks on the origin: ' + JSON.stringify(r2));
    assert(moves[1].none && moves[2].none, `dragging out to ${magnet.release + 4} px (release ${magnet.release} px) loses the snap and the ${slip} px return (lock ${magnet.lock} px) does not lock afresh, so the release relies on the recovery: ` + JSON.stringify(r2));
    const slipMs = up2.t - moves[0].t;
    assert(slipMs < 200, 'the slip ran inside the 200 ms recovery window (lock -> release ' + slipMs + ' ms)');
    const line = await evalJs(`(() => { const s = ${S}; const l = s.shapes.find((x) => x.type === 'line'); if (!l) return null; const o = s.joints.get('j_origin'); const ends = l.joints.map((j) => s.joints.get(j)); const onOrigin = l.joints.some((j, i) => j === 'j_origin' || Math.hypot(ends[i].x - o.x, ends[i].y - o.y) < 1e-6 || s.constraints.some((c) => c.type === 'coincident' && c.joints && c.joints.includes('j_origin') && c.joints.includes(j))); return { lines: s.shapes.filter((x) => x.type === 'line').length, onOrigin }; })()`);
    console.log('slip release on the origin:', JSON.stringify(line));
    assert(line && line.lines >= 1 && line.onOrigin, 'a slip within the release distance still ends the line on the origin: ' + JSON.stringify(line));
    console.log('snap-release-slip-live: ok');
  } finally {
    await cdp.close();
  }
})();
