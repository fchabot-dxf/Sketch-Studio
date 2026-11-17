// tests/helpers/bezier-pick-live.js — TASK 762: how a BEZIER is picked compared with a LINE and an ARC, in the real Shaper Design tab (the shared
// Design tab of all four apps; Shaper exposes its sketch state, window.__designController, so every result is read from the state). Headless Edge /
// Chrome via CDP, REAL pointer events: desktop 1280 x 800 (mouse) or phone 390 x 844 (touch). Shared by the bezier-pick-762-*-live test files.
//
// The SCENE (world mm, Y down), rebuilt before every probe with the same ids, so each probe starts from the same drawing:
//   a LINE (0, 0) - (40, 0); an ARC centred (70, 0), radius 10, from (80, 0) to (60, 0) over the top; a CHAIN of two BEZIERS, as the Bezier tool
//   makes them (they share their middle joint): (100, 0) -> (130, 0) bulging up (control points (100, -25) and (130, -25)) and (130, 0) -> (160, 0)
//   bulging down. Each kind is probed at a point of its BODY: the line at (20, 0), the arc at its top (70, -10), the first bezier at t = 0.5
//   (115, -18.75), far from its chord and its end points.
// probe(kind, what) runs one row of the facts table and returns what the state then holds.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './cdp-browser.js';
import { installFakeDriveSession } from './fake-drive-session.js';
import { resetBufferLive } from './reset-buffer.js';
import { pressRibbonTool } from './ribbon-tool.js';

export const ST = 'window.__designController.state';
export const BODY = { line: [20, 0], arc: [70, -10], bezier: [115, -18.75] };
export const SHAPE = { line: 's_l762', arc: 's_a762', bezier: 's_bezier_b762a' };
// the constraint tools of the shared ribbon (constants.js TOOL_MODES -> button id 'tool-' + mode)
export const CONSTRAINT_TOOLS = ['coincident', 'hv', 'parallel', 'perp', 'collinear', 'tangent', 'equal', 'midpoint', 'symmetric'];

// The scene, built in the page from the page's own modules (the same instances the app runs).
const SCENE_JS = `Promise.all([import('/packages/core/shapes.js'), import('/packages/core/constants.js')]).then(([S, K]) => { const st = ${ST};
  for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0; if (st.groups) st.groups.length = 0; st.enteredGroupId = null;
  st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear(); st.pendingConstraint = null;
  const J = (id, x, y) => st.joints.set(id, { x, y, fixed: false });
  J('jl1', 0, 0); J('jl2', 40, 0); st.shapes.push({ id: '${SHAPE.line}', type: 'line', joints: ['jl1', 'jl2'] });
  J('ja0', 70, 0); J('ja1', 80, 0); J('ja2', 60, 0);
  const arc = S.makeArc(st.joints, 'ja0', 'ja1', 'ja2', 'CENTER'); arc.shapes[0].id = '${SHAPE.arc}'; arc.shapes[0].sweep = false; st.shapes.push(arc.shapes[0]);
  for (const c of arc.constraints) st.constraints.push(c);
  J('jb0', 100, 0); J('jb1', 130, 0); J('jb2', 160, 0);
  st.shapes.push({ id: '${SHAPE.bezier}', type: 'bezier', joints: ['jb0', 'jb1'], c1: [100, -25], c2: [130, -25], groupId: 'bezier_b762' });
  st.shapes.push({ id: 's_bezier_b762b', type: 'bezier', joints: ['jb1', 'jb2'], c1: [130, 25], c2: [160, 25], groupId: 'bezier_b762' });
  st.saveState('scene 762'); return st.shapes.length; })`;

/** A fresh browser on the Shaper page's Design tab. phone: 390 x 844 touch. -> the page tools, or null (no browser installed). */
export async function openBezierPickPage({ tag, phone = false, evidence = '.evidence/762' }) {
  const EVID = path.resolve(evidence);
  fs.mkdirSync(EVID, { recursive: true });
  const cdp = await launchBrowser({ tag: '762-' + tag, width: 1280, height: 800 });
  if (!cdp) return null;
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const mouse = (type, p, buttons = 0, clickCount = 1, modifiers = 0, button) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), modifiers, button: button || (type === 'mouseMoved' && !buttons ? 'none' : 'left'), buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (p, hold = 70) => { await T('touchStart', [p]); await sleep(hold); await T('touchEnd', []); await sleep(450); };
  const click = async (p, modifiers = 0) => { await mouse('mouseMoved', p, 0, 0, modifiers); await sleep(40); await mouse('mousePressed', p, 1, 1, modifiers); await sleep(40); await mouse('mouseReleased', p, 0, 1, modifiers); await sleep(450); };
  const press = (p) => (phone ? tap(p) : click(p));
  const drag = async (a, b, steps = 10) => {
    if (phone) { await T('touchStart', [a]); await sleep(60); for (let i = 1; i <= steps; i++) { await T('touchMove', [{ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }]); await sleep(30); } await sleep(60); await T('touchEnd', []); await sleep(450); return; }
    await mouse('mouseMoved', a); await sleep(40); await mouse('mousePressed', a, 1); await sleep(40);
    for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, 1); await sleep(25); }
    await sleep(60); await mouse('mouseReleased', b); await sleep(450);
  };
  const dblclick = async (p) => {
    if (phone) { await T('touchStart', [p]); await sleep(70); await T('touchEnd', []); await sleep(150); await T('touchStart', [{ x: p.x + 4, y: p.y + 4 }]); await sleep(70); await T('touchEnd', []); await sleep(500); return; }
    await mouse('mouseMoved', p); await sleep(40); await mouse('mousePressed', p, 1, 1); await sleep(40); await mouse('mouseReleased', p, 0, 1); await sleep(90);
    await mouse('mousePressed', p, 1, 2); await sleep(40); await mouse('mouseReleased', p, 0, 2); await sleep(500);
  };
  const menuAt = async (p) => {
    if (phone) { await T('touchStart', [p]); await sleep(750); await T('touchEnd', []); await sleep(350); return; }
    await mouse('mouseMoved', p); await sleep(40); await mouse('mousePressed', p, 2, 1, 0, 'right'); await sleep(40); await mouse('mouseReleased', p, 0, 1, 0, 'right'); await sleep(350);
  };
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text).then(() => sleep(300));
  const keys = { esc: () => key('Escape', 'Escape', 27), enter: () => key('Enter', 'Enter', 13), select: () => key('s', 'KeyS', 83, 0, 's') };
  const toScreen = (x, y) => evalJs(`(() => { const svg = document.getElementById('design-canvas'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y }; })()`);
  const pxPerMm = () => evalJs(`document.getElementById('design-canvas').getScreenCTM().a`);
  const notes = () => evalJs(`[...document.querySelectorAll('#notification-container pre')].map((p) => p.textContent)`);
  // the notices shown so far are taken off (a new one may replace an old one in place: counting them would miss it)
  const clearNotes = () => evalJs(`document.querySelectorAll('#notification-container > div').forEach((d) => d.remove())`);
  const ribbon = (id) => pressRibbonTool(evalJs, press, id);
  const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: clip.scale || 2 } } : {}) }); const f = path.join(EVID, name); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('screenshot ' + f); return f; };
  const worldClip = async (x0, y0, x1, y1, pad = 30) => { const a = await toScreen(x0, y0), b = await toScreen(x1, y1); const x = Math.max(0, Math.min(a.x, b.x) - pad), y = Math.max(0, Math.min(a.y, b.y) - pad); return { x, y, width: Math.abs(b.x - a.x) + 2 * pad, height: Math.abs(b.y - a.y) + 2 * pad }; };
  const scene = () => evalJs(SCENE_JS).then(() => sleep(200));
  const snapshot = () => evalJs(`(() => { const st = ${ST}; return { tool: st.currentTool, shapes: st.shapes.map((s) => s.id + ':' + s.type), constraints: st.constraints.map((c) => c.type + (c.shape ? '@' + c.shape : '') + (c.joints ? '[' + c.joints.join(',') + ']' : '') + (c.joint ? '<' + c.joint : '')),
    selected: [...st.selectedShapes].sort(), selJoints: [...st.selectedJoints].sort(), hovered: st.hoveredShape || null, hoveredJoint: st.hoveredJoint || null, hoverOwner: st.hoverOwner || null, menu: !!document.querySelector('.sk-context-menu'),
    active: st.active ? (st.active.mode || st.active.type || 'yes') : null, pending: st.pendingConstraint ? st.pendingConstraint.type : null }; })()`);

  const open = async () => {
    await installFakeDriveSession(cdp);
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await sleep(400); await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    await waitForApp('design-canvas'); await sleep(400);
    await waitFor(`document.getElementById('design-canvas').getBoundingClientRect().width > 0 && !!window.__designController`, 'Design shown');
    await scene();
    // frame the scene: the page's own view (#ui/input-handlers/pan-zoom.js fitToDrawing through the footer's Recenter)
    await press(await evalJs(`(() => { const r = document.getElementById('btn-recenter-view').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
    await sleep(300);
  };

  // ── the probes: each starts from the scene with the Select tool and nothing selected ──
  // PHONE: the view is centred on the probed kind at 8 px / mm (the whole scene at 390 px is ~2.4 px / mm, where a finger's 60 px point reach covers the
  // bezier's body point from its end point): each kind is probed where its body is farther than a finger's reach from every point of it
  const FOCUS = { line: [20, 0], arc: [70, -4], bezier: [125, 0], tool: [130, -8] };
  const focus = (kind, ppm = 8) => evalJs(`(() => { const v = ${ST}.view; v.x = ${FOCUS[kind][0]}; v.y = ${FOCUS[kind][1]}; v.w = document.getElementById('design-canvas').getBoundingClientRect().width / ${ppm}; return true; })()`).then(() => sleep(250));
  const fresh = async (kind) => { await keys.esc(); await keys.esc(); await scene(); if (phone && kind) await focus(kind); await ribbon('tool-select'); await keys.esc(); if (!phone) { await mouse('mouseMoved', { x: 5, y: 5 }); await sleep(150); } };
  const at = (kind) => toScreen(...BODY[kind]);
  const geo = (ids) => evalJs(`(() => { const st = ${ST}; const o = {}; for (const s of st.shapes) if (${JSON.stringify(ids)}.includes(s.id)) o[s.id] = { j: s.joints.map((j) => [st.joints.get(j).x, st.joints.get(j).y].map((v) => +v.toFixed(3))), c1: s.c1 ? s.c1.map((v) => +v.toFixed(3)) : null, c2: s.c2 ? s.c2.map((v) => +v.toFixed(3)) : null }; return o; })()`);

  const probes = {
    async hover(kind) { await fresh(kind); if (phone) return 'n/a (touch has no hover)'; await mouse('mouseMoved', await at(kind)); await sleep(300); const s = await snapshot(); return { hovered: s.hovered, hoverOwner: s.hoverOwner }; },
    async click(kind) { await fresh(kind); await press(await at(kind)); return (await snapshot()).selected; },
    async drag(kind) {
      await fresh(kind); const p = await at(kind), id = SHAPE[kind];
      const before = await geo([id]); await drag(p, { x: p.x, y: p.y + 60 }); const after = await geo([id]); const b = before[id], a = after[id];
      const moved = (u, v) => (u && v ? [+(v[0] - u[0]).toFixed(2), +(v[1] - u[1]).toFixed(2)] : null);
      return { ends: b.j.map((q, i) => moved(q, a.j[i])), c1: moved(b.c1, a.c1), c2: moved(b.c2, a.c2), selected: (await snapshot()).selected };
    },
    async endDrag(kind) { // an END point dragged (the bezier's first end, the line's first end, the arc's start)
      await fresh(kind); const id = SHAPE[kind]; const g = (await geo([id]))[id]; const endIx = kind === 'arc' ? 1 : 0;
      const p = await toScreen(...g.j[endIx]); await drag(p, { x: p.x - 40, y: p.y + 40 }); const a = (await geo([id]))[id];
      const d = (u, v) => (u && v ? [+(v[0] - u[0]).toFixed(2), +(v[1] - u[1]).toFixed(2)] : null);
      return { ends: g.j.map((q, i) => d(q, a.j[i])), c1: d(g.c1, a.c1), c2: d(g.c2, a.c2) };
    },
    async dblclick(kind) { await fresh(kind); await dblclick(await at(kind)); return (await snapshot()).selected; },
    async boxWindow(kind) { // a window box (left to right, drawn upward from below the shape) around the shape's two ends
      await fresh(kind); const id = SHAPE[kind]; const g = (await geo([id]))[id]; const xs = g.j.map((q) => q[0]), ys = g.j.map((q) => q[1]).concat(kind === 'arc' ? [-10] : kind === 'bezier' ? [-20] : []);
      const a = await toScreen(Math.min(...xs) - 3, Math.max(...ys) + 14), b = await toScreen(kind === 'bezier' ? 133 : Math.max(...xs) + 3, Math.min(...ys) - 3);
      await drag(a, b); return (await snapshot()).selected;
    },
    async boxCrossing(kind) { // a crossing box (right to left) over the body only, no end point inside, started 14 mm off the body
      await fresh(kind); const [x, y] = BODY[kind]; const a = await toScreen(x + 3, y - 14), b = await toScreen(x - 3, y + 2); await drag(a, b); return (await snapshot()).selected;
    },
    async menu(kind) { await fresh(kind); await menuAt(await at(kind)); const s = await snapshot(); const ids = await evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].map((r) => r.dataset.id)`); await keys.esc(); return { menu: s.menu, selected: s.selected, items: ids.length }; },
    async tool(kind, tool) { // a ribbon tool, then one press on the body
      await fresh(kind); await ribbon('tool-' + tool); await sleep(150);
      await clearNotes(); const s0 = await snapshot(); await press(await at(kind)); await sleep(250); const s1 = await snapshot(); const nn = await notes();
      const res = { tool: s1.tool, shapes: s1.shapes.length - s0.shapes.length, constraints: s1.constraints.filter((c) => !s0.constraints.includes(c)), notes: nn, selected: s1.selected, active: s1.active, pending: s1.pending };
      await keys.esc(); await keys.esc(); return res;
    },
    async lineSnap(kind, where = 'body') { // the Line tool: a click on empty canvas below, then a click on the target
      await fresh(kind); await ribbon('tool-line'); const [x] = BODY[kind]; await press(await toScreen(x, 15));
      const target = where === 'body' ? await at(kind) : where === 'end' ? await toScreen(...(await geo([SHAPE[kind]]))[SHAPE[kind]].j[0]) : await toScreen(100, -25);
      if (!phone) { await mouse('mouseMoved', target); await sleep(250); }
      const snapNow = await evalJs(`(() => { const s = ${ST}.snapTarget; return s ? s.type + (s.shape ? '@' + s.shape.id : s.targetId ? '@' + s.targetId : '') : null; })()`);
      const s0 = await snapshot(); await press(target); const s1 = await snapshot(); await keys.esc(); await keys.esc();
      const end = await evalJs(`(() => { const st = ${ST}; const l = st.shapes.filter((s) => s.type === 'line').pop(); const j = st.joints.get(l.joints[1]); return [+j.x.toFixed(3), +j.y.toFixed(3)]; })()`);
      return { snapWhileHovering: snapNow, newConstraints: s1.constraints.filter((c) => !s0.constraints.includes(c)), end };
    },
  };

  return { clearNotes, focus, cdp, send, evalJs, waitFor, mouse, T, tap, click, press, drag, dblclick, menuAt, keys, toScreen, pxPerMm, notes, ribbon, shot, worldClip, scene, snapshot, geo, fresh, probes, open, phone, EVID, close: () => cdp.close() };
}

/** The Bezier tool's facts: three anchors (corner, corner, a dragged smooth one), then the pointer back over the FIRST anchor (the snap shown?) and a
 *  press there; what the state then holds (the anchors' joints there, the constraints, findLoops, whether the tool still draws). */
export async function bezierToolFacts(t, { endWith = 'enter', off = [6, -5], shot = null } = {}) {
  const { evalJs, press, drag, mouse, keys, ribbon, toScreen, phone, focus } = t;
  await keys.esc(); await keys.esc();
  if (phone) await focus('tool', 5);
  await evalJs(`(() => { const st = ${ST}; for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k); st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear(); st.saveState('clear 762'); })()`);
  await ribbon('tool-bezier');
  const A = await toScreen(100, 10), B = await toScreen(160, 10), C = await toScreen(130, -30), C2 = await toScreen(110, -30);
  await press(A); await press(B); await drag(C, C2, 8);
  const P = { x: A.x + off[0], y: A.y + off[1] };
  if (!phone) { await mouse('mouseMoved', P); await sleep(300); }
  const snapShown = await evalJs(`(() => { const s = ${ST}.snapTarget; return s ? s.type + '@' + (s.targetId || '') : null; })()`);
  if (shot) await t.shot(shot, { x: A.x - 130, y: A.y - 100, width: 260, height: 180 }); // the closing snap marker on the first anchor, with the pending segment
  await press(P); // `off` px off the anchor (default 6 / 5 px: within the joint snap reach)
  const afterClose = await evalJs(`import('/packages/core/loop-finder.js').then((L) => { const st = ${ST}; const f0 = st.joints.get(st.shapes[0].joints[0]); const at = [...st.joints.entries()].filter(([k, j]) => k !== 'j_origin' && Math.hypot(j.x - f0.x, j.y - f0.y) < 1e-6).map(([k]) => k); // the joints ON the first anchor
    return { shapes: st.shapes.map((s) => s.type), jointsAtFirst: at.length, constraints: st.constraints.map((c) => c.type), loops: L.findLoops(st).map((l) => l.edges.length), drawing: !!(st.active && st.active.mode === 'bezier'), tool: st.currentTool }; })`);
  if (endWith === 'enter') await keys.enter(); else if (endWith === 'esc') await keys.esc();
  const final = await evalJs(`import('/packages/core/loop-finder.js').then((L) => { const st = ${ST}; return { shapes: st.shapes.length, loops: L.findLoops(st).map((l) => l.edges.length), constraints: st.constraints.map((c) => c.type), drawing: !!(st.active && st.active.mode === 'bezier') }; })`);
  return { snapShown, afterClose, final, A };
}
