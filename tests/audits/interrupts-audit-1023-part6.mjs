// tests/audits/interrupts-audit-1023-part6.mjs: TASK 1023 (AUDIT ONLY). Re-click the SAME tool's ribbon button at every stage, with the completion probe
// (does the half-made tool still finish after the re-click?). Owner rule: a re-click does NOT exit the tool.
import { startHost } from './interrupts-audit-1023-kit.js';
import { runMatrix } from './interrupts-audit-1023-matrix.js';
import { sleep } from '../helpers/cdp-browser.js';

const h = await startHost({ host: 'shaper', tag: '1023-p6' });
try {
  await h.setBrowserCollapsed(true);
  await runMatrix(h, 'RCC', 're-click-same', async (hh, ctx, pre, spec) => { await hh.clickTool(spec.ribbon); await sleep(80); }, { complete: true, skip: (s) => ['select-drag', 'transform'].includes(s.tool) });
} finally { await h.close(); }
