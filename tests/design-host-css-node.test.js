// tests/design-host-css-node.test.js - TASK 629 (G6): the host CSS around the shared Design canvas. Pen Plotter's Design colours target its real stage
// (#stage-design); Trace's canvas takes its surface from the --sk-canvas-bg token (no inline background that hides the snapping colour) and defines every
// --sk-* token the shared renderer / grid read from the canvas, plus the .snapping surface.
import assert from 'node:assert';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const pp = read('apps/penplotter/index.html');
assert(/#stage-design\s*\{[^}]*--sk-selection:\s*#1e40af/.test(pp), 'Pen Plotter: the Design selection colour is set on #stage-design');
assert(!pp.includes('#stage-sketch'), 'Pen Plotter: no rule for the retired #stage-sketch');

const html = read('apps/trace/index.html');
const svgTag = /<svg id="design-canvas"[^>]*>/.exec(html)[0];
assert(!/background/i.test(svgTag), 'Trace: no inline background on the Design canvas: ' + svgTag);

const css = read('apps/trace/styles/main.css');
const block = /#design-canvas, #vcarve-canvas\s*\{([^}]*)\}/.exec(css)[1];
assert(/background-color:\s*var\(--sk-canvas-bg\)/.test(block), 'Trace: the canvas surface is the --sk-canvas-bg token');
const read_ = new Set();
for (const f of ['svg-renderer.js', 'canvas-grid.js']) for (const m of read('packages/ui/' + f).matchAll(/'(--sk-[a-z0-9-]+)'/g)) read_.add(m[1]);
for (const t of ['--sk-canvas-bg-snapping', '--sk-dimension', '--sk-dimension-snap']) read_.add(t);
assert(read_.size > 10, 'the renderer reads its tokens: ' + [...read_].join(' '));
const missing = [...read_].filter((t) => !new RegExp(t + '\\s*:').test(block) && !['--sk-profile-fill', '--sk-profile-tint'].includes(t));
assert.deepStrictEqual(missing, [], 'Trace defines every --sk-* token the renderer reads');
assert(/#design-canvas\.snapping\s*\{\s*background-color:\s*var\(--sk-canvas-bg-snapping\)/.test(css), 'Trace: the snapping surface is the --sk-canvas-bg-snapping token');
console.log('PASS design host css');
