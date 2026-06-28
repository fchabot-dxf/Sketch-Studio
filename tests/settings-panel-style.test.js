(async () => {
  const fs = await import('fs/promises');
  const html = await fs.readFile(new URL('../apps/sketchstudio/index.html', import.meta.url), 'utf8');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Isolate the settings panel block so we don't accidentally match classes in nearby panels
  const startIdx = html.indexOf('id="settings-panel"');
  const endIdx = html.indexOf('<div id="export-panel"');
  const settingsHtml = (startIdx !== -1 && endIdx !== -1) ? html.slice(startIdx, endIdx) : html;

  // 1) Ensure the settings inner container uses the compact spacing utility only
  assert(/<div[^>]*class="[^"]*space-y-2[^"]*"/i.test(settingsHtml), 'Settings inner container should include "space-y-2"');

  // 2) Ensure legacy typography utilities are NOT present (these override the unified wizard font)
  assert(!/text-sm/i.test(settingsHtml), 'Settings panel must not contain "text-sm"');
  assert(!/text-slate-700/i.test(settingsHtml), 'Settings panel must not contain "text-slate-700"');

  // 3) Ensure labels do not use `items-center` so vertical/column layout aligns left when sliders are injected
  assert(!/items-center/i.test(settingsHtml), 'Label elements inside Settings panel must not include "items-center"');

  // 4) Ensure the settings panel *root* element doesn't keep layout/visual Tailwind utilities
  const rootClassMatch = html.match(/<div[^>]*id="settings-panel"[^>]*class="([^"]*)"/i);
  const rootClasses = rootClassMatch ? rootClassMatch[1] : '';
  assert(!/\bbg-white\b/i.test(rootClasses), 'Settings panel root must not contain "bg-white"');
  assert(!/\bp-4\b/i.test(rootClasses), 'Settings panel root must not contain "p-4"');
  assert(!/\bw-80\b/i.test(rootClasses), 'Settings panel root must not contain "w-80"');
  assert(!/\bborder-slate-200\b/i.test(rootClasses), 'Settings panel root must not contain "border-slate-200"');
  assert(!/\brounded\b/i.test(rootClasses), 'Settings panel root must not contain "rounded"');
  assert(!/\bshadow-lg\b/i.test(rootClasses), 'Settings panel root must not contain "shadow-lg"');

  console.log('settings-panel style tests passed ✅');
})().catch(e => { console.error('settings-panel style tests failed ❌', e); process.exit(1); });