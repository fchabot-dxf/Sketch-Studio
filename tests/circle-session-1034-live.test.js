// tests/circle-session-1034-live.test.js — TASK 1034 (input unification trial, plan docs/INPUT-UNIFY-PLAN-1031.md 5.1): the Circle tool in a real
// browser, desktop 1280x800 (mouse) and phone 390x844 (touch). Each case draws a line (its end b is the rim joint), then one circle, and reads the
// saved document back. Inside each group the documents are identical (shapes + constraints, ids normalised):
//   typed diameter 60:   desktop: Enter, click;          phone: tap the box + Enter, tap the canvas
//   nothing typed, rim on b (point-on-circle):  desktop: click-click, click + hover + Enter (C-1), drag-release;  phone: tap-tap, finger drag
// The step log and the one-build counter are read in tests/circle-session-1034-node.test.js (the same code, no browser needed).
// Evidence: .evidence/1034/live-<case>-<tag>.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE_DIR = path.resolve('.evidence/1034');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };

// the document: every id replaced by its order of appearance, numbers rounded, transient fields dropped
function normalised(g) {
  const names = new Map();
  const ids = new Set([...g.joints.map(([id]) => id), ...g.shapes.map((s) => s.id), ...g.constraints.map((c) => c.id).filter(Boolean)]);
  const norm = (v) => {
    if (typeof v === 'string') { if (!ids.has(v)) return v; if (!names.has(v)) names.set(v, `#${names.size}`); return names.get(v); }
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

async function run({ width, height, tag }) {
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1034-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close, flushAutosave } = cdp;
  const mouse = async (type, p) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' || p.held ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const touch = async (type, p) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
  const tap = async (p) => {
    if (isPhone) { await touch('touchStart', p); await sleep(60); await touch('touchEnd', p); }
    else { await mouse('mouseMoved', p); await sleep(50); await mouse('mousePressed', p); await sleep(40); await mouse('mouseReleased', p); }
    await sleep(220);
  };
  const hover = async (p) => { await mouse('mouseMoved', p); await sleep(150); };
  const drag = async (a, b, steps = 10) => {
    if (isPhone) { await touch('touchStart', a); await sleep(40); for (let i = 1; i <= steps; i++) { await touch('touchMove', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }); await sleep(25); } await touch('touchEnd', b); }
    else { await mouse('mouseMoved', a); await sleep(40); await mouse('mousePressed', a); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps, held: true }); await sleep(25); } await mouse('mouseReleased', b); }
    await sleep(250);
  };
  const enter = async () => { await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r'); await sleep(250); };
  const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27, 0, ''); await sleep(150); };
  const type = async (t) => { await send('Input.insertText', { text: t }); await sleep(100); };
  const boxShown = () => evalJs(`(() => { const e = document.getElementById('dimInput'); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; })()`);
  const tapBox = async () => tap(await evalJs(`(() => { const r = document.getElementById('dimInput').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));
  const shot = async (name) => { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVIDENCE_DIR, `live-${name}-${tag}.png`), Buffer.from(data, 'base64')); };
  const readDoc = async () => {
    await flushAutosave();
    return evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const buf = await m.getProjectStore().readBuffer(); const t = buf && buf.tabs ? (buf.tabs[buf.active || 0] || buf.tabs[0]) : null; return t && t.doc ? t.doc.geometry : null; })`);
  };

  // screen points from the canvas rect (each device's own): the line L (its end b), the circle's centre and the rim hover
  let P = null;
  async function freshPage() {
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitForApp('svgCanvas');
    await sleep(300);
    const r = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const at = (fx, fy) => ({ x: Math.round(r.l + r.w * fx), y: Math.round(r.t + r.h * fy) });
    P = { a: at(0.2, 0.72), b: at(0.8, 0.72), centre: at(0.45, 0.45), rim: at(0.62, 0.45) };
    await pressRibbonTool(evalJs, tap, 'tool-line');
    await tap(P.a); if (!isPhone) await hover(P.b); await tap(P.b); await esc(); await esc();
    await pressRibbonTool(evalJs, tap, 'tool-circle');
  }

  async function drawCase(name, fn) {
    await freshPage();
    await fn();
    await shot(name);
    const g = await readDoc();
    const circles = g ? g.shapes.filter((s) => s.type === 'circle').length : -1;
    check(circles === 1, `[${tag}] ${name}: one circle (${circles})`);
    return { name, doc: g ? normalised(g) : null };
  }

  try {
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    const typed = [], untyped = [];
    if (!isPhone) {
      typed.push(await drawCase('typed-enter', async () => { await tap(P.centre); await hover(P.rim); await type('60'); await enter(); }));
      typed.push(await drawCase('typed-click', async () => { await tap(P.centre); await hover(P.rim); await type('60'); await tap(P.rim); }));
      untyped.push(await drawCase('rim-click-click', async () => { await tap(P.centre); await hover(P.b); await tap(P.b); }));
      untyped.push(await drawCase('rim-hover-enter', async () => { await tap(P.centre); await hover(P.b); await enter(); }));
      untyped.push(await drawCase('rim-drag', async () => { await drag(P.centre, P.b); }));
    } else {
      typed.push(await drawCase('typed-tapbox-enter', async () => { await tap(P.centre); check(await boxShown(), `[${tag}] the diameter box opened`); await tapBox(); await type('60'); await enter(); }));
      typed.push(await drawCase('typed-tapbox-tap', async () => { await tap(P.centre); await tapBox(); await type('60'); await tap(P.rim); }));
      untyped.push(await drawCase('rim-tap-tap', async () => { await tap(P.centre); await tap(P.b); }));
      untyped.push(await drawCase('rim-finger-drag', async () => { await drag(P.centre, P.b); }));
    }
    for (const group of [typed, untyped]) {
      for (const c of group.slice(1)) check(JSON.stringify(c.doc) === JSON.stringify(group[0].doc), `[${tag}] ${c.name}: the same document as ${group[0].name}${JSON.stringify(c.doc) === JSON.stringify(group[0].doc) ? '' : `\n${JSON.stringify(c.doc)}\nvs\n${JSON.stringify(group[0].doc)}`}`);
    }
    const A = typed[0].doc, B = untyped[0].doc;
    const ca = A.shapes.find((s) => s.type === 'circle'), cb = B.shapes.find((s) => s.type === 'circle');
    check(ca && ca.radius === 30 && A.constraints.some((c) => c.type === 'distance' && c.isDiameter && c.value === 60), `[${tag}] typed: radius 30 and the diameter dimension 60`);
    check(cb && B.constraints.some((c) => c.type === 'pointOnLine' && JSON.stringify(c).includes(`"${cb.id}"`)), `[${tag}] untyped: b is on the circle (point-on-circle) ${JSON.stringify(B.constraints)}`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('circle-session-1034-live: PASS');
