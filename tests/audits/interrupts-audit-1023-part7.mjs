// tests/audits/interrupts-audit-1023-part7.mjs: TASK 1023 (AUDIT ONLY). CONTROL: no interruption at all, then the completion probe. A completion that fails here is the probe's own
// limit (e.g. Slot needs more clicks), not an interruption defect.
import { startHost } from './interrupts-audit-1023-kit.js';
import { runMatrix } from './interrupts-audit-1023-matrix.js';

const h = await startHost({ host: 'shaper', tag: '1023-p7' });
try {
  await h.setBrowserCollapsed(true);
  await runMatrix(h, 'CTL', 'no interruption (control)', async () => {}, { complete: true, skip: (s) => ['select-drag', 'transform', 'dim-edit'].includes(s.tool) });
} finally { await h.close(); }
