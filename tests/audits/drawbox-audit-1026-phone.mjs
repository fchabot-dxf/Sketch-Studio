// tests/audits/drawbox-audit-1026-phone.mjs — TASK 1026 (AUDIT ONLY): phone 390x844 subset of the size-box matrix, real TOUCH events (rows B-PH*)
// Run: node tests/audits/drawbox-audit-1026-phone.mjs
import { start, row, f, sleep } from './drawbox-audit-1026-kit.js';
import { resetBufferLive } from '../helpers/reset-buffer.js';

const k = await start({ tag: '1026-phone', view: { cx: 0, cy: 0, vw: 220 } });
const { cdp } = k;
const near = (a, b, t = 0.3) => Math.abs(a - b) <= t;
const lines = (sn) => sn.shapes.filter((s) => s.type === 'line');
const dist = (sn) => sn.cons.filter((c) => c.type === 'distance');

async function phoneFresh() {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await cdp.navigate(k.url, 12000);
  await cdp.waitForApp('svgCanvas');
  await sleep(500);
}
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 2, radiusY: 2, force: 1 })) });
const tap = async (p, settle = 260) => { await touch('touchStart', [p]); await sleep(50); await touch('touchEnd', []); await sleep(settle); };
const cr = async () => cdp.evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
let C = null;
const F = (fx, fy) => ({ x: Math.round(C.l + C.w * fx), y: Math.round(C.t + C.h * fy) });
const tool = async (id, mode = null) => { await k.pickTool(id, mode); await sleep(150); };
const boxRect = (sel) => cdp.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.classList.contains('hidden')) return null; const r = e.getBoundingClientRect(); return r.width ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } : null; })()`);
const tapField = async (i = 0) => {
  const p = await cdp.evalJs(`(() => { const d = document.getElementById('dualInput'); const dv = d && !d.classList.contains('hidden') && d.getBoundingClientRect().width > 0;
    const el = dv ? d.querySelectorAll('input')[${i}] : (document.getElementById('dimInput')); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tap(p, 200);
};
const inView = (r) => !!r && r.l >= 0 && r.t >= 0 && r.r <= 390 && r.b <= 844;
const phoneState = async (id) => {
  const d = await boxRect('#dualInput'), s = await boxRect('#dimInput'), h = await boxRect('#dimHint');
  const foc = await cdp.evalJs(`document.activeElement ? document.activeElement.id || document.activeElement.tagName : null`);
  row(id + '.box', `dual=${JSON.stringify(d)} inView=${inView(d)} single=${JSON.stringify(s)} inView=${inView(s)} hint=${JSON.stringify(h)} focus=${foc}`);
};

try {
  await phoneFresh();
  C = await cr();
  row('B-PH0', `canvas ${JSON.stringify(C)} touch emulation on`);

  const cellP = async (id, name, combo, fn, opts = {}) => {
    if (process.env.ONLY && !new RegExp(process.env.ONLY).test(id)) return;
    await phoneFresh(); C = await cr();
    return k.cell(id, name, combo, fn, { ...opts, fresh: false });
  };
  await cellP('B-PHL1', 'Line (phone)', 'tap start, tap end, nothing typed', async () => { await tool('line'); await tap(F(0.25, 0.5)); await phoneState('B-PHL1'); await tap(F(0.7, 0.45)); }, { check: (fin) => (lines(fin).length === 1 ? null : `lines ${lines(fin).length}`) });
  await cellP('B-PHL2', 'Line (phone)', 'tap start, tap the length box, type 20, Enter', async () => { await tool('line'); await tap(F(0.25, 0.5)); await tapField(0); await cdp.evalJs(`document.querySelector('#dualInput input').select()`); await k.typeText('20'); await phoneState('B-PHL2'); await k.pressKey('Enter'); },
    { check: (fin) => (lines(fin).length === 1 && near(lines(fin)[0].len, 20, 0.05) && dist(fin).length === 1 ? null : `lines ${JSON.stringify(lines(fin).map((l) => f(l.len)))} dims ${dist(fin).length}`) });
  await cellP('B-PHL3', 'Line (phone)', 'tap start, tap the ANGLE box, type 30, Enter (no cursor length)', async () => { await tool('line'); await tap(F(0.25, 0.5)); await tapField(1); await cdp.evalJs(`document.querySelectorAll('#dualInput input')[1].select()`); await k.typeText('30'); await k.pressKey('Enter'); },
    { check: (fin, live) => (lines(fin).length === 0 && live.box.dual ? null : `lines ${lines(fin).length} box ${live.box.dual}`) });
  await cellP('B-PHL4', 'Line (phone)', 'length 20 + angle 30 both typed, Enter', async () => { await tool('line'); await tap(F(0.25, 0.5)); await tapField(0); await cdp.evalJs(`document.querySelector('#dualInput input').select()`); await k.typeText('20'); await k.pressKey('Tab'); await k.typeText('30'); await k.pressKey('Enter'); },
    { check: (fin) => (lines(fin).length === 1 && near(lines(fin)[0].len, 20, 0.05) && near(lines(fin)[0].ang, 30, 0.3) ? null : `lines ${JSON.stringify(lines(fin).map((l) => [f(l.len), f(l.ang)]))}`) });
  await cellP('B-PHL5', 'Line (phone)', 'length 20 typed then Backspace x2 (empty), tap end: unlocks', async () => { await tool('line'); await tap(F(0.25, 0.5)); await tapField(0); await cdp.evalJs(`document.querySelector('#dualInput input').select()`); await k.typeText('20'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await tap(F(0.7, 0.45)); },
    { check: (fin) => (lines(fin).length === 1 && !dist(fin).length ? null : `lines ${lines(fin).length} dims ${dist(fin).length}`) });
  await cellP('B-PHL6', 'Line (phone)', 'length 20 typed, commit by TAP on the canvas', async () => { await tool('line'); await tap(F(0.25, 0.5)); await tapField(0); await cdp.evalJs(`document.querySelector('#dualInput input').select()`); await k.typeText('20'); await tap(F(0.7, 0.45)); },
    { check: (fin) => (lines(fin).length === 1 && near(lines(fin)[0].len, 20, 0.05) ? null : `lines ${JSON.stringify(lines(fin).map((l) => f(l.len)))}`) });
  await cellP('B-PHR1', 'Rect (phone)', 'tap corner, W 20 H 10 typed, Enter', async () => { await tool('rect', 'rect-2pt'); await tap(F(0.25, 0.4)); await phoneState('B-PHR1'); await tapField(0); await cdp.evalJs(`document.querySelector('#dualInput input').select()`); await k.typeText('20'); await k.pressKey('Tab'); await k.typeText('10'); await k.pressKey('Enter'); },
    { check: (fin) => (lines(fin).length === 4 && dist(fin).length === 2 ? null : `lines ${lines(fin).length} dims ${dist(fin).length}`) });
  await cellP('B-PHR2', 'Rect (phone)', 'tap corner, tap again with nothing typed (the tapped point is the opposite corner)', async () => { await tool('rect', 'rect-2pt'); await tap(F(0.25, 0.4)); await tap(F(0.7, 0.6)); }, { check: (fin) => (lines(fin).length === 4 ? null : `lines ${lines(fin).length}`) });
  await cellP('B-PHC1', 'Circle (phone)', 'tap centre, Ø 30 typed in the box, Enter', async () => { await tool('circle'); await tap(F(0.4, 0.4)); await phoneState('B-PHC1'); await tapField(0); await cdp.evalJs(`document.getElementById('dimInput').select()`); await k.typeText('30'); await k.pressKey('Enter'); },
    { check: (fin) => (fin.shapes.some((s) => s.type === 'circle' && near(s.r, 15, 0.05)) ? null : `shapes ${JSON.stringify(fin.shapes.map((s) => [s.type, s.r]))}`) });
  await cellP('B-PHP1', 'Polygon (phone)', 'tap centre, R 20 + N 5 typed, Enter', async () => { await tool('polygon'); await tap(F(0.4, 0.4)); await phoneState('B-PHP1'); await tapField(0); await cdp.evalJs(`document.querySelector('#dualInput input').select()`); await k.typeText('20'); await k.pressKey('Tab'); await k.typeText('5'); await k.pressKey('Enter'); },
    { check: (fin) => (lines(fin).length === 10 && dist(fin).length === 1 ? null : `lines ${lines(fin).length} dims ${dist(fin).length}`) });
  await cellP('B-PHS1', 'Slot (phone)', 'tap start, span 40 typed Enter, width 10 typed Enter', async () => {
    await tool('slot', 'slot-c2c'); await tap(F(0.25, 0.5)); await phoneState('B-PHS1.span'); await tapField(0); await cdp.evalJs(`document.getElementById('dimInput').select()`); await k.typeText('40'); await k.pressKey('Enter');
    await phoneState('B-PHS1.width'); await tapField(0); await cdp.evalJs(`document.getElementById('dimInput').select()`); await k.typeText('10'); await k.pressKey('Enter');
  }, { check: (fin) => (dist(fin).length === 2 ? null : `dims ${dist(fin).length}`) });
  await cellP('B-PHA1', 'Arc (phone)', 'tap centre, radius 20 typed Enter, sweep 90 typed Enter', async () => {
    await tool('arc'); await tap(F(0.4, 0.5)); await phoneState('B-PHA1.radius'); await tapField(0); await cdp.evalJs(`document.getElementById('dimInput').select()`); await k.typeText('20'); await k.pressKey('Enter');
    await phoneState('B-PHA1.sweep'); await tapField(0); await cdp.evalJs(`document.getElementById('dimInput').select()`); await k.typeText('90'); await k.pressKey('Enter');
  }, { check: (fin) => (fin.shapes.some((s) => s.type === 'arc') ? null : `no arc`) });
  await cellP('B-PHF1', 'Fillet (phone)', 'rect by taps, fillet tool, tap the corner, radius box visible and inside the viewport?', async () => {
    await tool('rect', 'rect-2pt'); await tap(F(0.25, 0.4)); await tap(F(0.7, 0.6)); await k.pressKey('Escape'); await k.pressKey('Escape');
    await tool('fillet'); await tap(F(0.25, 0.4)); const r = await boxRect('#fillet-radius-input'); row('B-PHF1.box', `fillet box ${JSON.stringify(r)} inView=${inView(r)}`);
  }, { check: null });
  await cellP('B-PHO1', 'Offset (phone)', 'rect by taps, offset tool, tap a side, distance box visible and inside the viewport?', async () => {
    await tool('rect', 'rect-2pt'); await tap(F(0.25, 0.4)); await tap(F(0.7, 0.6)); await k.pressKey('Escape'); await k.pressKey('Escape');
    await tool('offset'); await tap(F(0.45, 0.4)); const r = await boxRect('#offset-distance-input'); row('B-PHO1.box', `offset box ${JSON.stringify(r)} inView=${inView(r)}`);
  }, { check: null });
} finally { await k.close(); }
