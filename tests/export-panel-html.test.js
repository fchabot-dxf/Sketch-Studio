(async () => {
  const fs = await import('fs/promises');
  const html = await fs.readFile(new URL('../apps/sketchstudio/index.html', import.meta.url), 'utf8');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // The #export-panel SURVIVES S7c-2c (the popup is intact + reused as the Export view). These two checks were
  // split out of the retired settings-panel-html test, which bundled them with now-obsolete #settings-panel
  // asserts. The export-panel styling is NOT covered by export.test.js (that only tests buildSVG/DXF).

  // Export header should use unified wizard title styling
  assert(/<div[^>]*id="export-panel"[\s\S]*?>[\s\S]*?<div[^>]*style="color:#60a5fa; font-size:13px; font-weight:600;">\s*Export\s*<\/div>/i.test(html), 'Export header should use unified wizard title styling');
  // Export close button should use wizard close styling
  assert(/id="btn-export-close"[^>]*style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;">/i.test(html), 'Export close button should use wizard close styling');

  console.log('export-panel HTML header tests passed ✅');
})().catch(e => { console.error('export-panel HTML tests failed ❌', e); process.exit(1); });
