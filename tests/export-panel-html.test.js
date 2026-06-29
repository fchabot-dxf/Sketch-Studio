(async () => {
  const fs = await import('fs/promises');
  const html = await fs.readFile(new URL('../apps/sketchstudio/index.html', import.meta.url), 'utf8');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // S7c-2e: #export-panel is now an in-flow Export TAB view (router-owned), not a floating popup. The Export
  // header/title remains; the popup chrome (w-80 / shadow-lg / z-index:99999 / close-x) is gone. (Not covered by
  // export.test.js, which only tests buildSVG/DXF.)

  // Header/title kept (unified wizard styling)
  assert(/<div[^>]*id="export-panel"[\s\S]*?>[\s\S]*?<div[^>]*style="color:#60a5fa; font-size:13px; font-weight:600;">\s*Export\s*<\/div>/i.test(html), 'Export view should keep the unified wizard title styling');

  // The root is an in-flow tab view, not a popup
  const rootMatch = html.match(/<div[^>]*id="export-panel"[^>]*class="([^"]*)"/i);
  const rootClasses = rootMatch ? rootMatch[1] : '';
  assert(/\bflex-1\b/.test(rootClasses), 'Export view root should fill the view area (flex-1)');
  assert(!/\bw-80\b/.test(rootClasses), 'Export view root must not keep the popup width (w-80)');
  assert(!/\bshadow-lg\b/.test(rootClasses), 'Export view root must not keep the popup shadow (shadow-lg)');

  // The popup close-x is dropped; the Export action remains
  assert(!/id="btn-export-close"/.test(html), 'Export popup close-x (#btn-export-close) should be removed');
  assert(/id="btn-export-do"/.test(html), 'Export action (#btn-export-do) should remain');

  console.log('export-panel tab-view tests passed ✅');
})().catch(e => { console.error('export-panel tests failed ❌', e); process.exit(1); });
