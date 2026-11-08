import { state, initLayers, makeToolpath } from '../apps/penplotter/src/state.js';
import { buildGcodeEntries, collectToolpathShapes } from '../apps/penplotter/src/export.js';
import { resolveToolpathShapes } from '../apps/penplotter/src/preview.js';

(async () => {
  state.settings.export_files = 'toolpath'; // these cases assert the per-toolpath file names (TASK 482)
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };

  // 1. Design geometry export: shared sketch with rect + line -> 1 G-code entry with flipped Y
  {
    initLayers();
    state.doc = { w: 200, h: 200 };
    // rect: [10, 20] to [50, 60] (4 connected line shapes)
    // line: [60, 70] to [80, 90] (1 line shape)
    const joints = new Map([
      ['j1', { x: 10, y: 20 }],
      ['j2', { x: 50, y: 20 }],
      ['j3', { x: 50, y: 60 }],
      ['j4', { x: 10, y: 60 }],
      ['j5', { x: 60, y: 70 }],
      ['j6', { x: 80, y: 90 }],
    ]);
    const shapes = [
      { id: 's1', type: 'line', joints: ['j1', 'j2'] },
      { id: 's2', type: 'line', joints: ['j2', 'j3'] },
      { id: 's3', type: 'line', joints: ['j3', 'j4'] },
      { id: 's4', type: 'line', joints: ['j4', 'j1'] },
      { id: 's5', type: 'line', joints: ['j5', 'j6'] },
    ];
    state.coreSketch = { shapes, joints };

    // Default starter toolpath
    assert(state.toolpaths.length === 1, '1 default toolpath exists');
    const tp = state.toolpaths[0];

    // Preview and export share the identical shape resolution
    const exportShapes = collectToolpathShapes(tp);
    const previewShapes = resolveToolpathShapes(tp);
    assert(exportShapes.length === 5, `5 resolved polyline shapes, got ${exportShapes.length}`);
    assert(previewShapes.length === 5, `preview resolved 5 shapes`);
    assert(exportShapes[0].id === previewShapes[0].id, 'preview and export resolve same shape ids');

    // Build G-code entries
    const entries = buildGcodeEntries();
    assert(entries.length === 1, `expected exactly 1 entry, got ${entries.length}`);
    assert(entries[0].name === '1_Outline.gcode', `entry name: ${entries[0].name}`);

    const gcode = entries[0].content;

    // Verify rect pen-down moves with Y flipped (docH = 200):
    // y=20 -> 180, y=60 -> 140
    assert(gcode.includes('G0 X10.000 Y180.000'), 'rect start rapid at (10, 180)');
    assert(gcode.includes('G1 Z-1.000'), 'pen down');
    assert(gcode.includes('G1 X50.000 Y180.000'), 'rect corner (50, 180)');
    assert(gcode.includes('G1 X50.000 Y140.000'), 'rect corner (50, 140)');
    assert(gcode.includes('G1 X10.000 Y140.000'), 'rect corner (10, 140)');
    assert(gcode.includes('G1 X10.000 Y180.000'), 'rect closed loop to (10, 180)');

    // Verify line pen-down moves with Y flipped:
    // y=70 -> 130, y=90 -> 110
    assert(gcode.includes('G0 X60.000 Y130.000'), 'line start rapid at (60, 130)');
    assert(gcode.includes('G1 X80.000 Y110.000'), 'line end at (80, 110)');
    assert(gcode.includes('M30'), 'program end M30');
  }

  // 2. Imported SVG layer export: art layer with shapes still exports as today
  {
    initLayers();
    state.coreSketch = null;
    state.artLayers = [{
      id: 'al_svg',
      name: 'Imported Layer',
      visible: true,
      shapes: [
        { id: 'sh_svg_1', type: 'polyline', points: [[15, 25], [45, 25], [45, 55], [15, 55], [15, 25]] }
      ]
    }];
    const tp = makeToolpath('Imported', 'outline', 'al_svg');
    tp.targetShapeIds = ['sh_svg_1'];
    state.toolpaths = [tp];

    // Parity check
    const exportShapes = collectToolpathShapes(tp);
    const previewShapes = resolveToolpathShapes(tp);
    assert(exportShapes.length === 1 && previewShapes.length === 1, 'imported shape resolved');
    assert(exportShapes[0].id === 'sh_svg_1', 'resolved imported shape id');

    const entries = buildGcodeEntries();
    assert(entries.length === 1, `expected 1 entry for imported layer`);
    assert(entries[0].name === '1_Imported.gcode', `entry name: ${entries[0].name}`);

    const gcode = entries[0].content;
    // y=25 -> 175, y=55 -> 145
    assert(gcode.includes('G0 X15.000 Y175.000'), 'imported start at (15, 175)');
    assert(gcode.includes('G1 X45.000 Y175.000'), 'imported corner (45, 175)');
    assert(gcode.includes('G1 X45.000 Y145.000'), 'imported corner (45, 145)');
    assert(gcode.includes('G1 X15.000 Y145.000'), 'imported corner (15, 145)');
    assert(gcode.includes('G1 X15.000 Y175.000'), 'imported close to (15, 175)');
    assert(gcode.includes('M30'), 'program end M30');
  }

  console.log('penplotter-export.test.js: all assertions passed');
})();
