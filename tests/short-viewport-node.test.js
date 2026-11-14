// tests/short-viewport-node.test.js — TASK 602: the short-viewport (phone landscape) mode is ONE declared query, #ui/short-viewport.js
// SHORT_VIEWPORT_QUERY. The JS-injected stylesheets (tool-ribbon.js, design-browser.js) interpolate the constant; the static sketcher.css cannot,
// so it spells the query: this test fails when any copy drifts from the declaration. It also pins that the query names no device: only the
// viewport's height, its orientation and the pointer.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHORT_VIEWPORT_QUERY } from '../packages/ui/short-viewport.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

assert.strictEqual(SHORT_VIEWPORT_QUERY, '(max-height: 500px) and (orientation: landscape) and (pointer: coarse)');

// sketcher.css: every @media that mentions max-height is the declared query, and there is one
const css = read('packages/ui/sketcher.css');
const shortQueries = [...css.matchAll(/@media\s+([^{]*max-height[^{]*)\{/g)].map((m) => m[1].trim());
assert.deepStrictEqual(shortQueries, [SHORT_VIEWPORT_QUERY], 'sketcher.css spells the declared short-viewport query: ' + JSON.stringify(shortQueries));

// the injected stylesheets use the constant, never a copy
for (const f of ['packages/ui/tool-ribbon.js', 'packages/ui/design-browser.js']) {
  const src = read(f);
  assert(src.includes('@media ${SHORT_VIEWPORT_QUERY}'), f + ' keys its short-viewport rules on the constant');
  assert(!/max-height:\s*500px/.test(src), f + ' has no copy of the query');
}
// no device / browser sniffing anywhere in the mode's code
for (const f of ['packages/ui/short-viewport.js', 'packages/ui/tool-ribbon.js', 'packages/ui/design-browser.js', 'packages/ui/document-tabs.js']) {
  assert(!/userAgent|navigator\.platform|maxTouchPoints/.test(read(f)), f + ' does not sniff the device');
}
console.log('short-viewport-node: ok (one query: ' + SHORT_VIEWPORT_QUERY + ')');
