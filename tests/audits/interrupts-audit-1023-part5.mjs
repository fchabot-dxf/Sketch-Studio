// tests/audits/interrupts-audit-1023-part5.mjs: TASK 1023 (AUDIT ONLY). The dimension EDIT box (double-click a label, type) under every interruption (the earlier kit did not open it).
import { startHost, FIX } from './interrupts-audit-1023-kit.js';
import { runMatrix } from './interrupts-audit-1023-matrix.js';

const h = await startHost({ host: 'shaper', tag: '1023-p5' });
const only = ['dim-edit'];
try {
  await h.setBrowserCollapsed(false);
  const c = await h.w2s(FIX.EMPTY.x, FIX.EMPTY.y);
  const I = [
    ['E5-ESC', 'Esc', async (hh) => { await hh.pressKey('Escape', { settle: 110 }); }],
    ['E5-TLC', 'ribbon->circle', async (hh) => { await hh.clickTool('tool-circle'); }],
    ['E5-TLK', 'key(c)', async (hh) => { await hh.pressKey('c', { settle: 110 }); }],
    ['E5-UND', 'Ctrl+Z', async (hh) => { await hh.pressKey('z', { ctrl: true, settle: 110 }); }],
    ['E5-RED', 'Ctrl+Y', async (hh) => { await hh.pressKey('y', { ctrl: true, settle: 110 }); }],
    ['E5-DEL', 'Delete', async (hh) => { await hh.pressKey('Delete', { settle: 110 }); }],
    ['E5-RCK', 'right-click empty', async (hh) => { await hh.clickW(FIX.EMPTY.x, FIX.EMPTY.y, { button: 'right', settle: 140 }); }],
    ['E5-WHL', 'wheel-zoom', async (hh) => { await hh.wheelAt(c.x, c.y, -240, 120); }],
    ['E5-PAN', 'middle-pan', async (hh) => { await hh.middlePan(c.x, c.y, 60, 30, { settle: 120 }); }],
    ['E5-PNF', 'panel-footer', async (hh) => { await hh.clickScreen(640, 780, { settle: 120 }); }],
    ['E5-PNB', 'panel-sketches-browser', async (hh) => { await hh.clickScreen(120, 175, { settle: 120 }); }],
    ['E5-BLR', 'blur-focus (synthetic)', async (hh) => { await hh.cdp.evalJs(`window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'));`); }],
  ];
  for (const [pre, name, fn] of I) await runMatrix(h, pre, name, fn, { only, view: true });
} finally { await h.close(); }
