// TASK 630 live: the Fusion default look (factory defaults, no inline tokens) leaves Shaper's cream canvas alone.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';

const cdp = await launchBrowser({ tag: '630-shaper', width: 1400, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, evalJs, waitFor, navigate, close } = cdp;
try {
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the Design tab button');
  await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
  await waitFor(`!!document.querySelector('#design-canvas')`, 'the design canvas');
  const bg = await evalJs(`getComputedStyle(document.querySelector('#design-canvas')).backgroundColor`);
  assert.strictEqual(bg, 'rgb(244, 239, 225)', 'Shaper Design canvas stays cream #F4EFE1 (value before this change)');
  const inline = await evalJs(`document.documentElement.style.getPropertyValue('--sk-canvas-bg') + document.querySelector('#design-canvas').style.getPropertyValue('--sk-canvas-bg')`);
  assert.strictEqual(inline, '', 'the default look sets no inline canvas token');
  console.log('shaper-canvas-default-look-live.test.js passed');
} finally {
  await close();
}
