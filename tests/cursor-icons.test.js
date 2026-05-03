(async () => {
  const fs = await import('fs/promises');
  const path = '../src/ui/cursor-manager.js';
  const txt = await fs.readFile(new URL(path, import.meta.url), 'utf8');
  const assert = (c,m) => { if(!c) throw new Error(m||'Assertion failed'); };

  assert(/'icon-cog'\s*:\s*\{/.test(txt), 'cursor-manager must define icon-cog in ICONS');
  assert(/'icon-terminal'\s*:\s*\{/.test(txt), 'cursor-manager must define icon-terminal in ICONS');
  // Ensure classic cog preserves a transparent center hole using evenodd fill-rule
  assert(/fill-rule=\"evenodd\"/.test(txt), 'icon-cog should use evenodd to preserve a transparent center hole');
  assert(!/fill=\"#ffffff\"/.test(txt), 'icon-cog must not contain a white-filled center');
  // Ensure the gear artwork from the provided SVG is present (detect inner-circle path)
  assert(/M25 34c/.test(txt), 'icon-cog should include the gear path from the provided SVG');

  console.log('cursor-icons test passed ✅');
})().catch(e => { console.error('cursor-icons test failed ❌', e); process.exit(1); });