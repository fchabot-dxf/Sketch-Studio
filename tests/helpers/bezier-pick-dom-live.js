// tests/helpers/bezier-pick-dom-live.js — TASK 762: the Bezier pick and close scenario read from what the page DRAWS (SketchStudio exposes no state;
// Pen Plotter and Trace are run the same way), desktop 1280 x 800, real mouse and keys. Shared by bezier-pick-762-sketchstudio-live (in depth, with
// screenshots) and bezier-pick-762-penplotter-live / -trace-live (the smoke):
//  1. the BEZIER tool draws a corner, a corner, a dragged smooth anchor, then the pointer goes back near the FIRST anchor: the snap marker (the
//     renderer's joint-snap ring) is drawn there; the click closes the outline: the profile tint (path.profile-fill, with the curves' `C`) appears and
//     the path ends (no pending preview);
//  2. Select: the pointer on the BODY of the dragged curve (its drawn path's midpoint, far from its chord) lights that curve (hover), a click selects it;
//  3. Trim pressed on that body: the notice says why (#core/curve-kinds.js CURVE_REFUSALS), nothing is removed.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './cdp-browser.js';
import { installFakeDriveSession } from './fake-drive-session.js';
import { resetBufferLive } from './reset-buffer.js';
import { pressRibbonTool } from './ribbon-tool.js';
import { HOSTS } from './close-path-live.js';

export const TRIM_REFUSAL = 'Trim: not available on a Bezier curve (Trim cuts lines, arcs and circles only)';

/** host: a close-path-live HOSTS entry; shots: write the screenshots (.evidence/762/<host>-*.png). -> the results, or null (no browser). */
export async function runBezierDomScenario(host, { shots = false } = {}) {
  const EVID = path.resolve('.evidence/762');
  fs.mkdirSync(EVID, { recursive: true });
  const cdp = await launchBrowser({ tag: '762-dom-' + host.name, width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return null; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const C = host.canvas;
  const out = {};
  const mouse = (type, p, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const click = async (p) => { await mouse('mouseMoved', p); await sleep(40); await mouse('mousePressed', p, 1); await sleep(40); await mouse('mouseReleased', p); await sleep(450); };
  const drag = async (a, b, steps = 8) => { await mouse('mouseMoved', a); await sleep(40); await mouse('mousePressed', a, 1); await sleep(40); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, 1); await sleep(25); } await mouse('mouseReleased', b); await sleep(450); };
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text).then(() => sleep(300));
  const shot = async (name, clip) => { if (!shots) return null; const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } }); const f = path.join(EVID, name); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('screenshot ' + f); return f; };
  const around = (p, w = 260, h = 200) => ({ x: Math.max(0, p.x - w / 2), y: Math.max(0, p.y - h / 2), width: w, height: h });
  const beziers = () => evalJs(`[...document.querySelectorAll('${C} path.shape-elem[data-shape-id]')].filter((e) => e.dataset.shapeId.startsWith('s_bezier_')).map((e) => e.dataset.shapeId)`);
  const lit = () => evalJs(`[...new Set([...document.querySelectorAll('${C} .shape-elem')].filter((e) => /--sk-selection|#017afd/i.test(e.getAttribute('style') || '')).map((e) => e.dataset.shapeId))]`);
  const notes = () => evalJs(`[...document.querySelectorAll('#notification-container pre')].map((p) => p.textContent)`);
  try {
    await installFakeDriveSession(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}${host.url}`, 10000);
    if (host.show) { await sleep(400); await evalJs(host.show); }
    await waitForApp(host.canvasId); await sleep(500);
    const c = await evalJs(`(() => { const r = document.querySelector('${C}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const A = { x: c.x - 150, y: c.y + 80 }, B = { x: c.x + 150, y: c.y + 80 }, Cc = { x: c.x, y: c.y - 110 };

    // 1. the Bezier tool closes on its first anchor
    await pressRibbonTool(evalJs, click, 'tool-bezier');
    await click(A); await click(B); await drag(Cc, { x: Cc.x - 120, y: Cc.y });
    const near = { x: A.x + 5, y: A.y - 4 };
    await mouse('mouseMoved', near); await sleep(350);
    // the snap marker: the renderer's joint-snap ring (r = 18 px on screen, a thick blue stroke) centred on the first anchor
    out.marker = await evalJs(`(() => { const svg = document.querySelector('${C}'), m = svg.getScreenCTM(); return [...svg.querySelectorAll('circle')].filter((e) => +e.getAttribute('stroke-width') > 0 && /1e40af/i.test(e.getAttribute('style') || '')).map((e) => { const q = svg.createSVGPoint(); q.x = +e.getAttribute('cx'); q.y = +e.getAttribute('cy'); const s = q.matrixTransform(m); return Math.round(Math.hypot(s.x - ${A.x}, s.y - ${A.y})); }); })()`);
    assert.ok(out.marker.length >= 1 && out.marker.some((d) => d <= 2), host.name + ': the closing snap marker is drawn on the first anchor: ' + JSON.stringify(out.marker));
    out.markerShot = await shot(host.name + '-closing-snap-marker.png', around(A, 240, 180));
    await click(near);
    out.curves = (await beziers()).length;
    assert.strictEqual(out.curves, 3, host.name + ': three beziers drawn');
    await waitFor(`[...document.querySelectorAll('${C} path.profile-fill')].some((p) => / C /.test(p.getAttribute('d')))`, host.name + ': the closed outline is tinted (a profile with its curves)');
    out.tint = await evalJs(`[...document.querySelectorAll('${C} path.profile-fill')].filter((p) => / C /.test(p.getAttribute('d'))).length`);
    out.tintShot = await shot(host.name + '-closed-bezier-tinted.png', around(c, 420, 320));
    await key('s', 'KeyS', 83, 0, 's');

    // 2. Select: hover and click on the body of the dragged curve (the one whose drawn midpoint is farthest from its chord)
    const body = await evalJs(`(() => { const svg = document.querySelector('${C}'), m = svg.getScreenCTM(); let best = null;
      for (const e of svg.querySelectorAll('path.shape-elem[data-shape-id]')) { if (!e.dataset.shapeId.startsWith('s_bezier_')) continue; const L = e.getTotalLength(), a = e.getPointAtLength(0), b = e.getPointAtLength(L), p = e.getPointAtLength(L / 2);
        const S = (u) => { const q = svg.createSVGPoint(); q.x = u.x; q.y = u.y; return q.matrixTransform(m); }, sa = S(a), sb = S(b), s = S(p);
        const dx = sb.x - sa.x, dy = sb.y - sa.y, off = Math.abs((s.x - sa.x) * dy - (s.y - sa.y) * dx) / (Math.hypot(dx, dy) || 1);
        if (!best || off > best.off) best = { id: e.dataset.shapeId, off, x: s.x, y: s.y }; } return best; })()`);
    out.bodyOffChordPx = Math.round(body.off);
    assert.ok(out.bodyOffChordPx > 30, host.name + ': the body point is far from its chord (screen px): ' + out.bodyOffChordPx);
    await mouse('mouseMoved', { x: 5, y: 5 }); await sleep(200);
    await mouse('mouseMoved', body); await sleep(350);
    out.hover = await lit();
    assert.deepStrictEqual(out.hover, [body.id], host.name + ': the pointer on the body lights that curve');
    out.hoverShot = await shot(host.name + '-hover-bezier-body.png', around(c, 420, 320));
    await click(body);
    out.selected = await lit();
    assert.deepStrictEqual(out.selected, [body.id], host.name + ': a click on the body selects it');
    await key('Escape', 'Escape', 27);

    // 3. Trim refuses with the reason
    await pressRibbonTool(evalJs, click, 'tool-trim');
    const n0 = (await notes()).length;
    await click(body);
    out.trim = (await notes()).slice(n0);
    out.curvesAfterTrim = (await beziers()).length;
    assert.ok(out.trim.includes(TRIM_REFUSAL), host.name + ': Trim on the body says why: ' + JSON.stringify(out.trim));
    assert.strictEqual(out.curvesAfterTrim, 3, host.name + ': nothing trimmed');
    out.notice = await evalJs(`(() => { const t = [...document.querySelectorAll('#notification-container > div')].find((d) => (d.textContent || '').includes(${JSON.stringify(TRIM_REFUSAL)})); if (!t) return null; const r = t.getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16 }; })()`);
    if (out.notice) out.noticeShot = await shot(host.name + '-trim-refusal-notice.png', out.notice);
    await key('Escape', 'Escape', 27);
    return out;
  } finally { await cdp.close(); }
}

export { HOSTS };
