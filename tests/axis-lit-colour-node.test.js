// tests/axis-lit-colour-node.test.js — TASK 630: a lit axis (hovered / picked reference line, and the axis-snap highlight) is drawn bold in its OWN axis
// colour (X red #ef4444, Y green #22c55e, full opacity), never the old #2563eb at 50%. Also: SNAP_MAGNETISM factory default is 10, one source.
import assert from 'node:assert';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { SolverConfig } = await import('../packages/core/solver-config.js');
const { draw } = await import('../packages/ui/svg-renderer.js');
const { getMagnetThreshold } = await import('../packages/ui/snap-magnet.js');

assert.strictEqual(SettingsManager.getDefault('SNAP_MAGNETISM'), 10, 'fresh SNAP_MAGNETISM is 10');
assert.strictEqual(SolverConfig.SNAP_MAGNETISM, 10, 'solver-config is the one source: 10');
assert.strictEqual(getMagnetThreshold('snap'), 10, 'snap-magnet uses 10');

const mk = () => ({ viewBox: { baseVal: { x: -100, y: -100, width: 200, height: 200 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 200, height: 200 }), innerHTML: '' });
const litTag = (svg, attr, id) => svg.innerHTML.match(new RegExp(`<line[^>]*${attr}="${id}"[^>]*>`))[0];
const plain = (svg, colour) => svg.innerHTML.match(new RegExp(`<line[^>]*stroke="${colour}"[^>]*stroke-opacity="0.6"[^>]*>`))[0];

for (const [id, colour] of [['ref_axis_x', '#ef4444'], ['ref_axis_y', '#22c55e']]) {
  const svg = mk();
  draw(new Map(), [], svg, null, null, [], new Set(), new Set(), 'coincident', null, new Set(), id, null, null, null, null, false, null);
  const tag = litTag(svg, 'data-ref-axis', id);
  assert.ok(tag.includes(`stroke="${colour}"`), id + ' lit in its own colour: ' + tag);
  assert.ok(!tag.includes('stroke-opacity') && !/2563eb/i.test(tag), id + ' lit: full opacity, no #2563eb');
  const lw = Number(tag.match(/stroke-width="([\d.]+)"/)[1]);
  assert.ok(lw > Number(plain(svg, colour).match(/stroke-width="([\d.]+)"/)[1]), id + ' lit is bolder than the plain axis');
}

for (const [type, colour] of [['axis-x', '#ef4444'], ['axis-y', '#22c55e']]) {
  const svg = mk();
  draw(new Map(), [], svg, null, { type, pt: { x: 10, y: 10 } }, [], new Set(), new Set(), 'select', null, new Set(), null, null, null, null, null, false, null);
  const tag = litTag(svg, 'data-snap-axis', type);
  assert.ok(tag.includes(`stroke="${colour}"`) && !tag.includes('stroke-opacity') && !/2563eb/i.test(tag), type + ' snap-lit in its own colour: ' + tag);
}
console.log('axis-lit-colour-node.test.js passed');
