// tests/audits/interrupts-audit-1023-part9.mjs: TASK 1023 (AUDIT ONLY). RE-RUN of "click the Sketches browser" and "open the sidebar, click out" with the target checked in the DOM first
// (the first run clicked fixed coordinates; this run finds the burger in the DOM and checks the sidebar really opened). The Sketches-browser click of the first version is in the part-3 log and was re-run there with a DOM-checked target (P9B rows in p9b.log).
import { startHost, FIX } from './interrupts-audit-1023-kit.js';
import { runMatrix } from './interrupts-audit-1023-matrix.js';

const h = await startHost({ host: 'shaper', tag: '1023-p9' });
const skip = (s, st) => st === 'midDrag' || st === 'transformDrag';
try {
  await h.setBrowserCollapsed(false);
  const probe = (x, y) => h.cdp.evalJs(`(() => { const e = document.elementFromPoint(${x}, ${y}); return e ? (e.closest('.sk-browser') ? 'browser' : e.closest('.sk-sidebar-backdrop') ? 'backdrop' : e.closest('.sk-sidebar') ? 'sidebar' : e.tagName) : null; })()`);
  await runMatrix(h, 'P9S', 'panel-sidebar', async (hh) => {
    const bg = await hh.cdp.evalJs(`(() => { const e = document.querySelector('.sk-sidebar-btn'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await hh.clickScreen(bg.x, bg.y, { settle: 300 });
    const open = await hh.cdp.evalJs(`document.querySelector('.sk-sidebar').getBoundingClientRect().left`);
    const mid = await hh.inspect();
    const on = await probe(900, 400);
    await hh.clickScreen(900, 400, { settle: 200 });
    await hh.moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
    return `|| sidebarLeft=${open} (0 = open) outsideTarget=${on} tool@open=${mid.tool} active@open=${mid.hasActive} boxes@open=[${mid.openBoxes.join(',')}]`;
  }, { skip, complete: true });
} finally { await h.close(); }
