(async () => {
  const fs = await import('fs/promises');
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Settings header should match unified wizard header styling (allows optional gear prefix and uppercase)
  assert(/<div[^>]*id="settings-panel"[\s\S]*?>[\s\S]*?<div[^>]*style="[^"]*color:#60a5fa;[^"]*font-size:13px;[^"]*font-weight:600[^"]*">\s*(?:\u2699\s*)?Settings\s*<\/div>/i.test(html), 'Settings header should use unified wizard title styling');
  assert(/id="btn-settings-close"[^>]*style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;">/i.test(html), 'Settings close button should use wizard close styling');

  // Export header should match as well
  assert(/<div[^>]*id="export-panel"[\s\S]*?>[\s\S]*?<div[^>]*style="color:#60a5fa; font-size:13px; font-weight:600;">\s*Export\s*<\/div>/i.test(html), 'Export header should use unified wizard title styling');
  assert(/id="btn-export-close"[^>]*style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;">/i.test(html), 'Export close button should use wizard close styling');

  console.log('settings-panel HTML header tests passed ✅');
})().catch(e => { console.error('settings-panel HTML tests failed ❌', e); process.exit(1); });