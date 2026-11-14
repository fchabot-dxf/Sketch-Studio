import assert from 'assert';
import { buildSVG, buildDXF } from '../apps/sketchstudio/ui/export-manager.js';

function makeStateLine() {
  const joints = new Map();
  joints.set('j1', { x: 0, y: 0 });
  joints.set('j2', { x: 10, y: 0 });
  const shapes = [{ type: 'line', joints: ['j1', 'j2'] }];
  return { joints, shapes };
}

function makeStateArc() {
  // center at 0,0 radius 10, start at (10,0), end at (0,10)
  const joints = new Map();
  joints.set('c', { x: 0, y: 0 });
  joints.set('s', { x: 10, y: 0 });
  joints.set('e', { x: 0, y: 10 });
  const shapes = [{ type: 'arc', joints: ['c', 's', 'e'], largeArc: false, sweep: true }];
  return { joints, shapes };
}

// Line SVG test
{
  const state = makeStateLine();
  const svg = buildSVG(state, { precision: 3 });
  assert.ok(svg && svg.includes('<line'), 'SVG should contain a line element');
  assert.ok(svg.includes('x1="0.000"') || svg.includes('x1="0"'), 'Precision should be applied');
  // Cap/Join attributes respect settings
  assert.ok(svg.includes('stroke-linecap="') && svg.includes('stroke-linejoin="'), 'SVG should include stroke-linecap and stroke-linejoin attributes on lines');
}

// SVG stroke width is the declared export constant (1, as before), whatever the LINE_STROKE display knob is (task 614)
{
  const { default: SettingsManager } = await import('#core/settings-manager.js');
  SettingsManager.set('LINE_STROKE', 1.5, { persist: false });
  const svg = buildSVG(makeStateLine(), { precision: 2 });
  assert.ok(svg && svg.includes('stroke-width="1.00"'), 'SVG stroke-width is the export constant, not LINE_STROKE');
  SettingsManager.set('LINE_STROKE', SettingsManager.getDefault('LINE_STROKE'), { persist: false });
  assert.ok(buildSVG(makeStateLine(), { precision: 2 }).includes('stroke-width="1.00"'), 'and a default export is unchanged (1)');
  assert.ok(buildSVG(makeStateLine(), { precision: 2, strokeWidth: 2 }).includes('stroke-width="2.00"'), 'an explicit strokeWidth still wins');
}

// Arc SVG test (path)
{
  const state = makeStateArc();
  const svg = buildSVG(state, { precision: 2, arcApprox: false });
  assert.ok(svg && svg.includes('<path'), 'SVG should contain a path for arc');
  // Should contain A command with radius 10.00
  assert.ok(svg.includes('A 10.00 10.00'), 'Arc radius should be formatted with precision');
}

// Arc SVG test (approx)
{
  const state = makeStateArc();
  const arcSeg = 8;
  const svg = buildSVG(state, { precision: 2, arcApprox: true, arcSeg });
  assert.ok(svg && svg.includes('<polyline'), 'SVG should contain a polyline when arcApprox is true');
  // Count points roughly by commas in points attribute
  const m = svg.match(/points="([^"]+)"/);
  assert.ok(m, 'polyline points attribute found');
  const pts = m[1].trim().split(/\s+/);
  assert.ok(pts.length === arcSeg + 1, 'polyline should have arcSeg+1 points');
}

// DXF Line test
{
  const state = makeStateLine();
  const dxf = buildDXF(state, { precision: 1 });
  assert.ok(dxf && dxf.includes('LINE'), 'DXF should contain a LINE entity');
  assert.ok(dxf.includes('10.') || dxf.includes('10.00') || dxf.includes('10'), 'DXF numeric formatting present');
}

// DXF Arc test
{
  const state = makeStateArc();
  const dxf = buildDXF(state, { precision: 2, arcApprox: false });
  assert.ok(dxf && dxf.includes('ARC'), 'DXF should contain an ARC entity');
  assert.ok(dxf.includes('\n50\n') || dxf.includes('\r\n50\r\n') , 'DXF ARC should include start angle code 50');
}

// Closed polygon export - use 4 lines forming a square (coords make a closed loop)
{
  const joints = new Map();
  joints.set('a', { x: 0, y: 0 });
  joints.set('b', { x: 10, y: 0 });
  joints.set('c', { x: 10, y: 10 });
  joints.set('d', { x: 0, y: 10 });
  const shapes = [
    { id: 'l1', type: 'line', joints: ['a','b'] },
    { id: 'l2', type: 'line', joints: ['b','c'] },
    { id: 'l3', type: 'line', joints: ['c','d'] },
    { id: 'l4', type: 'line', joints: ['d','a'] }
  ];
  const state = { joints, shapes };
  const svg = buildSVG(state, { precision: 2 });
  assert.ok(svg && (svg.includes('<polygon') || svg.includes('Z"')), 'Closed square should export as a polygon (or closed path)');
}

console.log('Export tests passed ✅');
