// tests/arc-session-1039-live-runner.js — TASK 1039 (the plan's Arc migration, docs/INPUT-UNIFY-PLAN-1031.md 5.2 item 2): the Arc tool, both variants, in a
// real browser, desktop 1280x800 (mouse) and phone 390x844 (touch). NOT a test file: TASK 1043 split the one test (its 90 s file limit hit under merge-gate
// load) into tests/arc-session-1039-desktop-centre-live.test.js, -desktop-3pt-live.test.js and -phone-live.test.js, each calling runArcSession for its
// device and variant(s): the same cases, the same checks. Each case draws a line (its end b is the joint the last point lands on), then one arc,
// and reads the saved document back. Inside each group the documents are identical (shapes + constraints, ids normalised):
//   Center Point Arc, typed radius 12 + sweep 90:   desktop: Enter / Enter, click / click;     phone: tap the box + Enter twice, tap the box + tap the canvas
//   Center Point Arc, nothing typed, end on b (TASK 1045: shared with the line's end):      desktop: click x3, click x2 + hover + Enter, drag-release + click;    phone: tap x3, finger drag + tap
//   3-Point Arc, typed chord 30 + radius 20:         desktop: Enter + click on the side, click + click;    phone: tap the box + Enter + tap the side, tap the box + tap x2
//   3-Point Arc, nothing typed, third point on b:    desktop: click x3, click x2 + hover + Enter, drag-release + click;    phone: tap x3, finger drag + tap
// Desktop: the dashed preview drawn just before the last step is the arc the build makes (its SVG arc: start, radius, flags, end).
// The step log and the one-build counter are read in tests/arc-session-1039-node.test.js (the same code, no browser needed).
// Evidence: .evidence/1039/live-<case>-<tag>.png
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE_DIR = path.resolve('.evidence/1039');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };

// the document: every id replaced by its order of appearance, numbers rounded, transient fields dropped (an arc's group id carries a timestamp)
function normalised(g) {
  const names = new Map();
  const ids = new Set([...g.joints.map(([id]) => id), ...g.shapes.map((s) => s.id), ...g.constraints.map((c) => c.id).filter(Boolean)]);
  const norm = (v) => {
    if (typeof v === 'string') { if (!ids.has(v)) return v.replace(/_\d{10,}_\d+$/, '_N'); if (!names.has(v)) names.set(v, `#${names.size}`); return names.get(v); }
    if (typeof v === 'number') return Math.round(v * 1e4) / 1e4;
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).filter((k) => !k.startsWith('_') && !['glyphPos', 'labelPos', 'offset'].includes(k)).sort().map((k) => [k, norm(v[k])]));
    return v;
  };
  const used = new Set(g.shapes.flatMap((s) => s.joints || []));
  const shapes = norm(g.shapes);
  const joints = norm(g.joints.filter(([id]) => used.has(id)).map(([id, j]) => ({ id, x: j.x, y: j.y })));
  return { shapes, joints, constraints: norm(g.constraints.filter((c) => c.type !== 'mouse_spring')) };
}
// an SVG arc path's numbers: start x, y, radius, large-arc and sweep flags, end x, y (the preview writes "x,y", the shape "x y")
const arcNums = (d) => { const n = (d || '').match(/-?\d+(\.\d+)?(e[-+]?\d+)?/gi); return n && n.length >= 9 ? [n[0], n[1], n[2], n[5], n[6], n[7], n[8]].map(Number) : null; };
const sameArcPath = (a, b) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < 1e-4);

/** the cases of one device (`tag`) for the arc variants named (`variants`: 'centre' = Center Point Arc, '3pt' = 3-Point Arc) in one browser; → the failed checks */
export async function runArcSession({ width, height, tag, variants }) {
  const isPhone = width <= 640;
  const centre = variants.includes('centre'), three = variants.includes('3pt');
  const cdp = await launchBrowser({ tag: `1039-${tag}-${variants.join('-')}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitForApp, navigate, close, flushAutosave } = cdp;
  const mouse = async (type, p) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' || p.held ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const touch = async (type, p) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
  const tap = async (p) => {
    if (isPhone) { await touch('touchStart', p); await sleep(60); await touch('touchEnd', p); }
    else { await mouse('mouseMoved', p); await sleep(50); await mouse('mousePressed', p); await sleep(40); await mouse('mouseReleased', p); }
    await sleep(220);
  };
  const hover = async (p) => { await mouse('mouseMoved', p); await sleep(120); };
  const hoverTo = async (a, b, steps = 6) => { for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }); await sleep(40); } await sleep(120); };
  const drag = async (a, b, steps = 10) => {
    if (isPhone) { await touch('touchStart', a); await sleep(40); for (let i = 1; i <= steps; i++) { await touch('touchMove', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }); await sleep(25); } await touch('touchEnd', b); }
    else { await mouse('mouseMoved', a); await sleep(40); await mouse('mousePressed', a); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps, held: true }); await sleep(25); } await mouse('mouseReleased', b); }
    await sleep(250);
  };
  const enter = async () => { await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r'); await sleep(250); };
  const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27, 0, ''); await sleep(150); };
  const type = async (t) => { await send('Input.insertText', { text: t }); await sleep(120); };
  const boxShown = () => evalJs(`(() => { const e = document.getElementById('dimInput'); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; })()`);
  // a finger taps the box to focus it, then its text is selected (as a tap-and-select would), so the typed value replaces the opening one
  const tapBox = async () => { await tap(await evalJs(`(() => { const r = document.getElementById('dimInput').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`)); await evalJs(`document.getElementById('dimInput').select()`); };
  const shot = async (name) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVIDENCE_DIR, `live-${name}-${tag}.png`), Buffer.from(data, 'base64')); };
  const previewD = () => evalJs(`(() => { const p = [...document.querySelectorAll('#svgCanvas path')].find((e) => e.getAttribute('stroke-dasharray') && / A /.test(e.getAttribute('d') || '')); return p ? p.getAttribute('d') : null; })()`);
  const builtD = () => evalJs(`(() => { const p = [...document.querySelectorAll('#svgCanvas path.shape-elem')].find((e) => / A /.test(e.getAttribute('d') || '')); return p ? p.getAttribute('d') : null; })()`);
  // the preview before the last step, then (after it) the arc built: the same SVG arc; a crop of the preview is the evidence
  let pending = null;
  const notePreview = async (name) => {
    await sleep(120);
    pending = { name, d: await previewD() };
    const b = await evalJs(`(() => { const p = [...document.querySelectorAll('#svgCanvas path')].find((e) => e.getAttribute('stroke-dasharray') && / A /.test(e.getAttribute('d') || '')); if (!p) return null; const r = p.getBoundingClientRect(); return { x: r.left - 40, y: r.top - 40, w: r.width + 80, h: r.height + 80 }; })()`);
    if (b) { const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, b.x), y: Math.max(0, b.y), width: b.w, height: b.h, scale: 2 } }); fs.writeFileSync(path.join(EVIDENCE_DIR, `live-${name}-preview-${tag}.png`), Buffer.from(data, 'base64')); }
  };
  const readDoc = async () => {
    await flushAutosave();
    return evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const buf = await m.getProjectStore().readBuffer(); const t = buf && buf.tabs ? (buf.tabs[buf.active || 0] || buf.tabs[0]) : null; return t && t.doc ? t.doc.geometry : null; })`);
  };

  // screen points from the canvas rect (each device's own): the line (its end b), the arcs' points
  let P = null;
  async function freshPage(mode) {
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitForApp('svgCanvas');
    await sleep(300);
    const r = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const at = (fx, fy) => ({ x: Math.round(r.l + r.w * fx), y: Math.round(r.t + r.h * fy) });
    P = { a: at(0.2, 0.75), b: at(0.8, 0.72), centre: at(0.45, 0.45), start: at(0.62, 0.45), mid: at(0.62, 0.6), down: at(0.45, 0.62), s3: at(0.3, 0.45), e3: at(0.62, 0.45), side: at(0.45, 0.3) };
    await pressRibbonTool(evalJs, tap, 'tool-line');
    await tap(P.a); if (!isPhone) await hover(P.b); await tap(P.b); await esc(); await esc();
    await pressRibbonTool(evalJs, tap, 'tool-arc');
    await sleep(150);
    await evalJs(`document.querySelector('.sk-ribbon-menu-item[data-mode="${mode}"]').click()`);
    await sleep(200);
  }

  async function drawCase(mode, name, fn) {
    await freshPage(mode);
    pending = null;
    await fn();
    await shot(name);
    if (pending) { const d = await builtD(); check(sameArcPath(arcNums(pending.d), arcNums(d)), `[${tag}] ${name}: the preview before the last step is the arc built (${pending.d} | ${d})`); }
    const g = await readDoc();
    const arcs = g ? g.shapes.filter((s) => s.type === 'arc').length : -1;
    check(arcs === 1, `[${tag}] ${name}: one arc (${arcs})`);
    return { name, doc: g ? normalised(g) : null };
  }

  try {
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    const CSE = 'arc-cse', P3 = 'arc-3pt';
    const cTyped = [], cClicks = [], tTyped = [], tClicks = [];
    if (!isPhone && centre) {
      cTyped.push(await drawCase(CSE, 'centre-typed-enter', async () => { await tap(P.centre); await hover(P.start); await type('12'); await enter(); await hoverTo(P.start, P.down); await type('90'); await notePreview('centre-typed-enter'); await enter(); }));
      cTyped.push(await drawCase(CSE, 'centre-typed-click', async () => { await tap(P.centre); await hover(P.start); await type('12'); await tap(P.start); await hoverTo(P.start, P.down); await type('90'); await tap(P.down); }));
      cClicks.push(await drawCase(CSE, 'centre-click-x3', async () => { await tap(P.centre); await hover(P.start); await tap(P.start); await hoverTo(P.start, P.b); await notePreview('centre-click-x3'); await tap(P.b); }));
      cClicks.push(await drawCase(CSE, 'centre-hover-enter', async () => { await tap(P.centre); await hover(P.start); await tap(P.start); await hoverTo(P.start, P.b); await enter(); }));
      cClicks.push(await drawCase(CSE, 'centre-drag-click', async () => { await drag(P.centre, P.start); await hoverTo(P.start, P.b); await tap(P.b); }));
    }
    if (!isPhone && three) {
      tTyped.push(await drawCase(P3, '3pt-typed-enter', async () => { await tap(P.s3); await hover(P.e3); await type('30'); await enter(); await hover(P.side); await type('20'); await notePreview('3pt-typed-enter'); await tap(P.side); }));
      tTyped.push(await drawCase(P3, '3pt-typed-click', async () => { await tap(P.s3); await hover(P.e3); await type('30'); await tap(P.e3); await hover(P.side); await type('20'); await tap(P.side); }));
      tClicks.push(await drawCase(P3, '3pt-click-x3', async () => { await tap(P.s3); await hover(P.e3); await tap(P.e3); await hover(P.b); await notePreview('3pt-click-x3'); await tap(P.b); }));
      tClicks.push(await drawCase(P3, '3pt-hover-enter', async () => { await tap(P.s3); await hover(P.e3); await tap(P.e3); await hover(P.b); await enter(); }));
      tClicks.push(await drawCase(P3, '3pt-drag-click', async () => { await drag(P.s3, P.e3); await hover(P.b); await tap(P.b); }));
    }
    if (isPhone && centre) {
      cTyped.push(await drawCase(CSE, 'centre-tapbox-enter', async () => { await tap(P.centre); check(await boxShown(), `[${tag}] the radius box opened`); await tapBox(); await type('12'); await enter(); await evalJs(`document.getElementById('dimInput').select()`); await type('90'); await enter(); }));
      cTyped.push(await drawCase(CSE, 'centre-tapbox-tap', async () => { await tap(P.centre); await tapBox(); await type('12'); await tap(P.start); await tapBox(); await type('90'); await tap(P.down); }));
      cClicks.push(await drawCase(CSE, 'centre-tap-x3', async () => { await tap(P.centre); await tap(P.start); await tap(P.b); }));
      cClicks.push(await drawCase(CSE, 'centre-finger-drag-tap', async () => { await drag(P.centre, P.start); await tap(P.b); }));
    }
    if (isPhone && three) {
      tTyped.push(await drawCase(P3, '3pt-tapbox-enter-tap', async () => { await tap(P.s3); await tapBox(); await type('30'); await enter(); await evalJs(`document.getElementById('dimInput').select()`); await type('20'); await tap(P.side); }));
      tTyped.push(await drawCase(P3, '3pt-tapbox-tap', async () => { await tap(P.s3); await tapBox(); await type('30'); await tap(P.e3); await tapBox(); await type('20'); await tap(P.side); }));
      tClicks.push(await drawCase(P3, '3pt-tap-x3', async () => { await tap(P.s3); await tap(P.e3); await tap(P.b); }));
      tClicks.push(await drawCase(P3, '3pt-finger-drag-tap', async () => { await drag(P.s3, P.e3); await tap(P.b); }));
    }
    for (const group of [cTyped, cClicks, tTyped, tClicks]) {
      for (const c of group.slice(1)) check(JSON.stringify(c.doc) === JSON.stringify(group[0].doc), `[${tag}] ${c.name}: the same document as ${group[0].name}${JSON.stringify(c.doc) === JSON.stringify(group[0].doc) ? '' : `\n${JSON.stringify(c.doc)}\nvs\n${JSON.stringify(group[0].doc)}`}`);
    }
    const arcOf = (d) => d.shapes.find((s) => s.type === 'arc');
    if (centre) {
      const A = cTyped[0].doc, B = cClicks[0].doc;
      check(A.constraints.some((c) => c.type === 'distance' && c.isRadius && c.value === 12 && c.shape === arcOf(A).id) && arcOf(A).sweep === true, `[${tag}] centre typed: the radius dimension 12, the positive winding ${JSON.stringify(A.constraints)}`);
      // TASK 1045 (Fusion measured 2026-11-27: a drawing tool's new point on an existing curve END point is that point): the arc's end IS the line's end b
      const lineOf = (d) => d.shapes.find((s) => s.type === 'line');
      check(lineOf(B).joints.includes(arcOf(B).joints[2]) && !B.constraints.some((c) => c.type === 'coincident') && arcOf(B).sweep === true, `[${tag}] centre untyped: the end on b (shared: the line's end point), the short way round ${JSON.stringify(B.shapes)} ${JSON.stringify(B.constraints)}`);
    }
    if (three) {
      const C3 = tTyped[0].doc, D3 = tClicks[0].doc;
      check(C3.constraints.some((c) => c.type === 'distance' && c.isRadius && c.value === 20) && C3.constraints.some((c) => c.type === 'distance' && !c.isRadius && c.value === 30), `[${tag}] 3-point typed: the radius 20 and chord 30 dimensions ${JSON.stringify(C3.constraints)}`);
      check(D3.constraints.some((c) => c.type === 'pointOnLine' && c.shape === arcOf(D3).id), `[${tag}] 3-point untyped: b on the arc ${JSON.stringify(D3.constraints)}`);
    }
  } finally {
    await close();
  }
  return failures;
}
