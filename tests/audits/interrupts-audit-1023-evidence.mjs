// tests/audits/interrupts-audit-1023-evidence.mjs: TASK 1023 (AUDIT ONLY). Screenshots of the slot zombie box and the transform-box zombie after a tool switch.
import { startHost, row } from './interrupts-audit-1023-kit.js';

const h = await startHost({ host: 'shaper', tag: '1023-ev' });
try {
  await h.setBrowserCollapsed(true);
  const shot = async (name, sel) => {
    const r = await h.cdp.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.max(0, b.left - 220), y: Math.max(0, b.top - 160), width: 520, height: 320 }; })()`);
    const c = await h.capture(name, r || null);
    row('EV', name, '', '', `${c.rel} md5=${c.md5} boxRect=${JSON.stringify(r)}`);
  };
  await h.resetFixture(); await h.enterStage('slot-c2c', 'boxTyped');
  await shot('slot-box-typed-before-switch.png', '#dimInput');
  await h.clickTool('tool-circle');
  const s = await h.inspect();
  row('EV', 'slot-c2c', 'boxTyped', 'ribbon->circle', `tool=${s.tool} boxes=[${s.openBoxes.join(',')}] active=${s.hasActive}`);
  await shot('slot-box-zombie-after-switch-to-circle.png', '#dimInput');
  await h.resetFixture(); await h.enterStage('transform', 'transformBoxTyped');
  await h.clickTool('tool-circle');
  const t = await h.inspect();
  row('EV', 'transform', 'transformBoxTyped', 'ribbon->circle', `tool=${t.tool} boxes=[${t.openBoxes.join(',')}]`);
  await shot('transform-box-zombie-after-switch-to-circle.png', '#tbox-input');
} finally { await h.close(); }
