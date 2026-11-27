// tests/audits/interrupts-audit-1023-part2.mjs: TASK 1023 (AUDIT ONLY). Ctrl+Z, Ctrl+Y, Delete, right-click mid-tool, every tool x stage.
import { startHost, FIX } from './interrupts-audit-1023-kit.js';
import { runMatrix } from './interrupts-audit-1023-matrix.js';
import { sleep } from '../helpers/cdp-browser.js';

const h = await startHost({ host: 'shaper', tag: '1023-p2' });
const noDrag = (s, st) => st === 'midDrag' || st === 'transformDrag';
try {
  await h.setBrowserCollapsed(true);
  console.log('\n=== Ctrl+Z ===');
  await runMatrix(h, 'UND', 'Ctrl+Z', async (hh) => { await hh.pressKey('z', { ctrl: true, settle: 110 }); }, { skip: noDrag });
  console.log('\n=== Ctrl+Y ===');
  await runMatrix(h, 'RED', 'Ctrl+Y', async (hh) => { await hh.pressKey('y', { ctrl: true, settle: 110 }); }, { skip: noDrag });
  console.log('\n=== Delete ===');
  await runMatrix(h, 'DEL', 'Delete', async (hh) => { await hh.pressKey('Delete', { settle: 110 }); }, { skip: noDrag });
  console.log('\n=== Right-click on empty canvas ===');
  await runMatrix(h, 'RCK', 'right-click', async (hh) => {
    await hh.clickW(FIX.EMPTY.x, FIX.EMPTY.y, { button: 'right', settle: 140 });
    const m = await hh.inspect();
    // dismiss the menu with a click on empty footer space, to see what the tool is afterwards
    await hh.clickScreen(640, 780, { settle: 100 });
    const a = await hh.inspect();
    return `|| menuOpenAtRC=${m.ctxMenuOpen} tool@menu=${m.tool} active@menu=${m.hasActive} boxes@menu=[${m.openBoxes.join(',')}] -> afterDismiss tool=${a.tool} ctx=${a.ctxMenuOpen}`;
  }, { skip: noDrag });
} finally { await h.close(); }
