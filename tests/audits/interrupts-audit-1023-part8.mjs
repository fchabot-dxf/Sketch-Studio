// tests/audits/interrupts-audit-1023-part8.mjs: TASK 1023 (AUDIT ONLY). RE-RUN of the line-pair constraint tools (Parallel, Perpendicular, Collinear, Equal) and Midpoint under EVERY
// interruption: the first kit picked the origin, not the line, so their "after 1st pick" cells of parts 1-3/6 are void (this part replaces them).
import { startHost, FIX } from './interrupts-audit-1023-kit.js';
import { runMatrix } from './interrupts-audit-1023-matrix.js';
import { sleep } from '../helpers/cdp-browser.js';

const h = await startHost({ host: 'shaper', tag: '1023-p8' });
const only = ['parallel', 'perp', 'collinear', 'equal', 'midpoint'];
try {
  await h.setBrowserCollapsed(false);
  const c = await h.w2s(FIX.EMPTY.x, FIX.EMPTY.y);
  const alt = (spec) => (spec.tool === 'circle' ? 'tool-line' : 'tool-circle');
  const I = [
    ['K-CTL', 'no interruption (control)', async () => {}],
    ['K-ESC', 'Esc', async (hh) => { await hh.pressKey('Escape', { settle: 110 }); }],
    ['K-TLC', 'ribbon->circle', async (hh) => { await hh.clickTool('tool-circle'); }],
    ['K-TLK', 'key(c)', async (hh) => { await hh.pressKey('c', { settle: 110 }); }],
    ['K-REC', 're-click same', async (hh, ctx, pre, spec) => { await hh.clickTool(spec.ribbon); await sleep(80); }],
    ['K-UND', 'Ctrl+Z', async (hh) => { await hh.pressKey('z', { ctrl: true, settle: 110 }); }],
    ['K-RED', 'Ctrl+Y', async (hh) => { await hh.pressKey('y', { ctrl: true, settle: 110 }); }],
    ['K-DEL', 'Delete', async (hh) => { await hh.pressKey('Delete', { settle: 110 }); }],
    ['K-RCK', 'right-click empty', async (hh) => { await hh.clickW(FIX.EMPTY.x, FIX.EMPTY.y, { button: 'right', settle: 140 }); }],
    ['K-WHL', 'wheel-zoom', async (hh) => { await hh.wheelAt(c.x, c.y, -240, 120); }],
    ['K-PAN', 'middle-pan', async (hh) => { await hh.middlePan(c.x, c.y, 60, 30, { settle: 120 }); }],
    ['K-PNF', 'panel-footer', async (hh) => { await hh.clickScreen(640, 780, { settle: 120 }); await hh.moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y); }],
    ['K-PNB', 'panel-sketches-browser', async (hh) => { await hh.clickScreen(120, 175, { settle: 120 }); await hh.moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y); }],
    ['K-PNP', 'panel-parameters', async (hh) => { await hh.clickScreen(174, 780, { settle: 160 }); await hh.clickScreen(174, 780, { settle: 160 }); await hh.moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y); }],
    ['K-BLR', 'blur-focus (synthetic)', async (hh) => { await hh.cdp.evalJs(`window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'));`); await sleep(120); }],
  ];
  for (const [pre, name, fn] of I) await runMatrix(h, pre, name, fn, { only, complete: !['K-ESC', 'K-TLC', 'K-TLK'].includes(pre) });
} finally { await h.close(); }
