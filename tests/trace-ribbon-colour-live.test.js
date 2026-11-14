// tests/trace-ribbon-colour-live.test.js — TASK 608 C: Trace's ribbon icons were light grey (#cbd5e1) on the shared ribbon's WHITE default background
// (1.48:1): Trace's :root named the --sk-ribbon-* tokens in comments but never declared them. Now Trace declares them with Shaper's values.
// Reads the computed icon colour and the background it sits on: Trace's icon colour == Shaper's (the other dark host), the WCAG contrast of the
// icon on its background is >= 4.5:1 in Trace, Shaper and SketchStudio.
import assert from 'node:assert';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const cdp = await launchBrowser({ tag: '608c', width: 1200, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, evalJs, navigate } = cdp;
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
try {
  const res = {};
  for (const [name, url, enter] of [
    ['sketchstudio', '/apps/sketchstudio/index.html', null],
    ['shaper', '/apps/shaper/index.html', `document.querySelector('.sk-header-tab[data-tab="design"]').click()`],
    ['trace', '/apps/trace/index.html', `document.querySelector('.sk-header-tab[data-tab="edit"]').click()`]]) {
    await navigate(`http://127.0.0.1:${port}${url}`, 8000); await sleep(800);
    if (enter) { await evalJs(enter); await sleep(800); }
    const r = await evalJs(`(() => { const b = document.querySelector('.sk-ribbon .sk-ribbon-btn:not(.active)'); const ic = b.querySelector('.sk-ribbon-ic'); let bg = null;
      for (let p = b; p; p = p.parentElement) { const c = getComputedStyle(p).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; } } return { color: getComputedStyle(ic).color, bg }; })()`);
    res[name] = { ...r, contrast: +ratio(rgb(r.color), rgb(r.bg)).toFixed(2) };
    console.log(`  ${name}: icon ${r.color} on ${r.bg} = ${res[name].contrast}:1`);
    assert(res[name].contrast >= 4.5, `${name}: ribbon icon contrast ${res[name].contrast}:1 >= 4.5:1`);
  }
  assert.strictEqual(res.trace.color, res.shaper.color, 'Trace ribbon icons use Shaper\'s colour');
  assert.strictEqual(res.trace.bg, res.shaper.bg, 'Trace ribbon uses Shaper\'s background');
  console.log('trace-ribbon-colour-live: ok');
} finally { await cdp.close(); }
