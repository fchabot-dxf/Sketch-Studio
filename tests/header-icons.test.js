(async () => {
  const fs = await import('fs/promises');
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  assert(/id="btn-settings-toggle"/.test(html), 'Settings button missing');
  assert(/id="btn-debug-toggle"/.test(html), 'Debug button missing');
  assert(/use href="#icon-cog"/.test(html), 'Settings icon <use> for #icon-cog missing');
  assert(/use href="#icon-terminal"/.test(html), 'Debug icon <use> for #icon-terminal missing');

  console.log('header-icons test passed ✅');
})().catch(e => { console.error('header-icons test failed ❌', e); process.exit(1); });