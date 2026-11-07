import fs from 'fs';
import path from 'path';
import { extractCutRecord, CUT_TYPES } from '../apps/shaper/src/shaper.js';
import { parseSvg } from '../apps/shaper/src/svgio.js';
import { importSvgGeometry, computeImportScale } from '#core/svg-import.js';
import { findLoops } from '#core/loop-finder.js';
import { keyOf, CUT_PLAN } from '../apps/shaper/src/cut-plan.js';
import { exportShaperSVG } from '#core/shaper-export.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

  // Mock DOMParser in Node environment if missing
  if (typeof global.DOMParser === 'undefined') {
    const { JSDOM } = await import('jsdom').catch(() => ({}));
    if (JSDOM) {
      global.DOMParser = new JSDOM().window.DOMParser;
    }
  }

  // 1. extractCutRecord unit tests
  {
    const mockEl = (attrs) => ({
      getAttributeNS: (ns, name) => attrs[`shaper:${name}`] || attrs[name] || null,
      getAttribute: (name) => attrs[name] || null,
    });

    // Case A: Fusion 360 outside cut with inch depth and tool diameter
    const elA = mockEl({
      'shaper:cutType': 'outside',
      'shaper:cutDepth': '0.787 in',
      'shaper:cutOffset': '0in',
      'shaper:toolDia': '0.125in',
      'fill': '#000000',
    });
    const recA = extractCutRecord(elA, 'mm');
    assert(recA !== null, 'recA not null');
    assert(recA.cutType === 'exterior', 'outside maps to exterior');
    assert(near(recA.cutDepth, 0.787 * 25.4), 'depth converted to base mm');
    assert(recA.cutOffset === 0, 'offset is 0');
    assert(near(recA.toolDia, 0.125 * 25.4), 'toolDia converted to base mm');

    // Case B: Fusion 360 pocket with depth only (no toolDia specified)
    const elB = mockEl({
      'shaper:cutType': 'pocket',
      'shaper:cutDepth': '0.25in',
      'fill': '#7F7F7F',
    });
    const recB = extractCutRecord(elB, 'mm');
    assert(recB !== null, 'recB not null');
    assert(recB.cutType === 'pocket', 'cutType is pocket');
    assert(near(recB.cutDepth, 6.35), 'depth is 6.35 mm (1/4 in)');
    assert(near(recB.toolDia, 3.175), 'toolDia defaults to 3.175 mm (1/8 in)');

    // Case C: Color-coded element without shaper:* attrs
    const elC = mockEl({
      'fill': '#FFFFFF',
      'stroke': '#000000',
    });
    const recC = extractCutRecord(elC, 'mm');
    assert(recC !== null, 'recC not null');
    assert(recC.cutType === 'interior', 'white/black stroke classified as interior');
    assert(recC.cutDepth === 'unset', 'depth unset when not specified');
    assert(near(recC.toolDia, 3.175), 'default toolDia');
  }

  // 2. importSvgGeometry preserves descId
  {
    let jSeq = 0;
    const genJ = () => 'j' + (jSeq++);
    const descs = [
      { tag: 'rect', x: 0, y: 0, width: 20, height: 20, descId: 'd_rect' },
      { tag: 'circle', cx: 50, cy: 50, r: 10, descId: 'd_circle' },
      { tag: 'line', x1: 0, y1: 0, x2: 10, y2: 10, descId: 'd_line' },
    ];
    const { shapes } = importSvgGeometry(descs, { genJ, scale: 1 });
    const rectShapes = shapes.filter((s) => s.descId === 'd_rect');
    const circleShapes = shapes.filter((s) => s.descId === 'd_circle');
    const lineShapes = shapes.filter((s) => s.descId === 'd_line');

    assert(rectShapes.length === 4, 'rect has 4 shapes tagged with d_rect');
    assert(circleShapes.length === 1, 'circle has 1 shape tagged with d_circle');
    assert(lineShapes.length === 1, 'line has 1 shape tagged with d_line');
  }

  // 3. Integration with findLoops and CUT_PLAN population
  {
    CUT_PLAN.clear();
    let jSeq = 0;
    const genJ = () => 'j' + (jSeq++);
    const st = {
      joints: new Map(),
      shapes: [],
      constraints: [],
    };

    const descs = [
      {
        tag: 'rect', x: 0, y: 0, width: 40, height: 30, descId: 'desc_pock',
        cutRecord: { cutType: 'pocket', cutDepth: 6.35, cutOffset: 0, toolDia: 3.175 },
      },
      {
        tag: 'line', x1: 50, y1: 0, x2: 50, y2: 30, descId: 'desc_guide',
        cutRecord: { cutType: 'guide', cutDepth: 'unset', cutOffset: 0, toolDia: 3.175 },
      },
    ];

    const { joints, shapes } = importSvgGeometry(descs, { genJ, scale: 1 });
    for (const j of joints) st.joints.set(j.id, { x: j.x, y: j.y });
    for (const s of shapes) st.shapes.push(s);

    const cutRecordByDesc = new Map();
    for (const d of descs) {
      if (d.descId && d.cutRecord) cutRecordByDesc.set(d.descId, d.cutRecord);
    }

    const shapeById = new Map(st.shapes.map((s) => [s.id, s]));
    const loops = findLoops(st);
    assert(loops.length === 1, '1 closed loop found for rect');

    const loop = loops[0];
    const loopDescIds = new Set(loop.edges.map((eid) => shapeById.get(eid).descId));
    assert(loopDescIds.size === 1 && loopDescIds.has('desc_pock'), 'loop edges map to desc_pock');

    // Register loop in CUT_PLAN
    const rec = cutRecordByDesc.get('desc_pock');
    CUT_PLAN.set(keyOf('loop', loop.id), { ...rec });

    // Register open edge in CUT_PLAN
    const lineShape = st.shapes.find((s) => s.descId === 'desc_guide');
    assert(lineShape, 'lineShape exists');
    CUT_PLAN.set(keyOf('edge', lineShape.id), { ...cutRecordByDesc.get('desc_guide') });

    // Verify CUT_PLAN entries
    const loopRec = CUT_PLAN.get(keyOf('loop', loop.id));
    assert(loopRec.cutType === 'pocket', 'loop cutType is pocket');
    assert(loopRec.cutDepth === 6.35, 'loop cutDepth is 6.35mm');

    const edgeRec = CUT_PLAN.get(keyOf('edge', lineShape.id));
    assert(edgeRec.cutType === 'guide', 'edge cutType is guide');

    // Verify re-export generates proper shaper attributes
    const exportEntries = [
      { target: { kind: 'loop', id: loop.id }, rec: loopRec },
      { target: { kind: 'edge', id: lineShape.id }, rec: edgeRec },
    ];
    const exportedSvg = exportShaperSVG({
      state: st,
      entries: exportEntries,
      encoding: CUT_TYPES,
      docUnit: 'in',
    });

    assert(exportedSvg.includes('shaper:cutType="pocket"'), 'exported has cutType pocket');
    assert(exportedSvg.includes('shaper:cutDepth="0.25in"'), 'exported has cutDepth 0.25in');
    assert(exportedSvg.includes('shaper:cutType="guide"'), 'exported has cutType guide');
  }

  console.log('shaper-import tests passed ✅');
})().catch((err) => {
  console.error('shaper-import test failed ❌', err);
  process.exit(1);
});
