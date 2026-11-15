// tests/fusion-polish-665-node.test.js — TASK 665: Fusion pong lengthUnits -> session DOC_UNIT + fitViewToExtents avoidEl inset.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { createFusionBridge, mapFusionLengthUnit } from '../apps/shaper/src/fusion-bridge.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import SettingsManager, { docUnit } from '#core/settings-manager.js';
const STORAGE_KEY = 'sketch-studio-settings';
import { fitViewToExtents } from '#ui/input-handlers/pan-zoom.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };

// 1. Unit mapping coverage
eq(mapFusionLengthUnit('mm'), 'mm', 'mm -> mm');
eq(mapFusionLengthUnit('cm'), 'cm', 'cm -> cm');
eq(mapFusionLengthUnit('in'), 'in', 'in -> in');
eq(mapFusionLengthUnit('m'), 'cm', 'm -> cm (nearest metric app unit)');
eq(mapFusionLengthUnit('ft'), 'in', 'ft -> in (nearest imperial app unit)');
eq(mapFusionLengthUnit(' MM '), 'mm', 'case/whitespace insensitive');
eq(mapFusionLengthUnit(undefined), null, 'missing unit -> null');
eq(mapFusionLengthUnit(''), null, 'empty unit -> null');
eq(mapFusionLengthUnit('yd'), null, 'unrecognized unit -> null');
eq(mapFusionLengthUnit(123), null, 'non-string unit -> null');

// 2. pong sets session DOC_UNIT via SettingsManager without touching persisted localStorage preference
const app = await open({ host: 'shaper' });
try {
  // Seed persisted normal-Shaper user preference = 'in'
  SettingsManager.set('DOC_UNIT', 'in', { persist: 'local' });
  const savedBefore = globalThis.localStorage.getItem(STORAGE_KEY);
  ok(JSON.parse(savedBefore).DOC_UNIT === 'in', 'localStorage holds saved DOC_UNIT=in before Fusion session');

  app.modes.showMode('prepare');
  let lastMeta = null;
  const bridge = createFusionBridge({
    globalTarget: null,
    onStatus: (_t, meta) => { lastMeta = meta; },
  });

  // Import a rectangle and select it so Prepare cut card is open
  importFusionSelection({
    source: { kind: 'sketch', name: 'UnitPlate' },
    units: 'mm',
    regions: [{
      id: 'reg_0',
      outer: {
        closed: true,
        segments: [
          { type: 'line', x1: 0, y1: 0, x2: 40, y2: 0 },
          { type: 'line', x1: 40, y1: 0, x2: 40, y2: 30 },
          { type: 'line', x1: 40, y1: 30, x2: 0, y2: 30 },
          { type: 'line', x1: 0, y1: 30, x2: 0, y2: 0 },
        ],
      },
      holes: [],
    }],
    chains: [],
  }, { controller: app.controller, prepare: app.prepare });

  const pv = app.prepare.view();
  const loop = pv.loops[0];
  ok(loop, 'imported loop exists in Prepare');
  pv.setSelection([{ kind: 'loop', id: loop.id, loop }]);
  eq(document.getElementById('prepare-panel').hidden, false, 'cut card opens for selected loop');
  eq(document.querySelector('#prepare-panel .cut-unit').textContent, 'in', 'cut card initially uses saved DOC_UNIT=in');

  // pong with lengthUnits: 'mm' updates DOC_UNIT & open cut card WITHOUT modifying localStorage
  bridge.handle('pong', JSON.stringify({ documentName: 'MetricPart', lengthUnits: 'mm' }));
  eq(docUnit(), 'mm', 'pong(mm) updates session DOC_UNIT to mm');
  eq(lastMeta && lastMeta.lengthUnits, 'mm', 'onStatus receives mapped lengthUnits');
  eq(document.querySelector('#prepare-panel .cut-unit').textContent, 'mm', 'cut card live-relabels unit to mm');
  eq(globalThis.localStorage.getItem(STORAGE_KEY), savedBefore, 'localStorage user preference untouched after pong(mm)');

  // pong without lengthUnits leaves current DOC_UNIT unchanged
  bridge.handle('pong', JSON.stringify({ documentName: 'SameUnits' }));
  eq(docUnit(), 'mm', 'pong without lengthUnits leaves DOC_UNIT unchanged');

  // pong with unrecognized lengthUnits leaves current DOC_UNIT unchanged
  bridge.handle('pong', JSON.stringify({ documentName: 'Weird', lengthUnits: 'cubits' }));
  eq(docUnit(), 'mm', 'pong with unrecognized lengthUnits leaves DOC_UNIT unchanged');

  // pong with m / ft maps cleanly, still leaving localStorage untouched
  bridge.handle('pong', JSON.stringify({ documentName: 'MeterDoc', lengthUnits: 'm' }));
  eq(docUnit(), 'cm', 'pong(m) maps to cm');
  bridge.handle('pong', JSON.stringify({ documentName: 'FootDoc', lengthUnits: 'ft' }));
  eq(docUnit(), 'in', 'pong(ft) maps to in');
  eq(globalThis.localStorage.getItem(STORAGE_KEY), savedBefore, 'localStorage user preference untouched after m/ft pongs');

  // Re-persisting preference check: re-initializing SettingsManager restores saved 'in' even if last pong was 'mm'
  bridge.handle('pong', JSON.stringify({ documentName: 'MetricEnd', lengthUnits: 'mm' }));
  eq(docUnit(), 'mm', 'session ended in mm');
  SettingsManager.load();
  eq(docUnit(), 'in', 'normal Shaper reload from localStorage still gets saved in preference');
} finally {
  await app.close();
}

// 3. fitViewToExtents with avoidEl avoids overlapping overlay, ignores non-overlapping column
{
  const mkRect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
  const state = {
    joints: new Map([
      ['a', { id: 'a', x: 0, y: 0 }],
      ['b', { id: 'b', x: 70, y: 0 }],
      ['c', { id: 'c', x: 70, y: -30 }],
      ['d', { id: 'd', x: 0, y: -30 }],
    ]),
    shapes: [{ id: 's1', type: 'line', joints: ['a', 'b'] }, { id: 's2', type: 'line', joints: ['b', 'c'] }, { id: 's3', type: 'line', joints: ['c', 'd'] }],
  };
  const svg = {
    getBoundingClientRect: () => mkRect(0, 0, 480, 731),
    setAttribute: () => {},
  };

  // Baseline without avoidEl: symmetric view centered on (35, -15)
  const baseView = { x: 0, y: 0, w: 120, h: 90 };
  fitViewToExtents(svg, baseView, state);
  eq(baseView.x, 35, 'baseline view centers X');
  eq(baseView.y, -15, 'baseline view centers Y');

  // With overlapping cut-card panel at right (left=268, width=200 inside 480px canvas):
  const overlapView = { x: 0, y: 0, w: 120, h: 90 };
  const overlayEl = { getBoundingClientRect: () => mkRect(268, 56, 200, 391) };
  fitViewToExtents(svg, overlapView, state, { avoidEl: overlayEl });
  const screenX = (wx) => 240 + (wx - overlapView.x) * (480 / overlapView.w);
  ok(screenX(0) >= 0, `leftmost world x=0 visible on screen (${screenX(0).toFixed(1)}px)`);
  ok(screenX(70) < 268, `rightmost world x=70 clears avoidEl.left=268 (${screenX(70).toFixed(1)}px)`);

  // With non-overlapping side-column panel (left=480, outside svg 0..480): no shrink / shift
  const columnView = { x: 0, y: 0, w: 120, h: 90 };
  const columnEl = { getBoundingClientRect: () => mkRect(480, 0, 200, 731) };
  fitViewToExtents(svg, columnView, state, { avoidEl: columnEl });
  near(columnView.x, baseView.x, 1e-6, 'non-overlapping column keeps X centered');
  near(columnView.w, baseView.w, 1e-6, 'non-overlapping column keeps width unshrunk');
}

console.log(`PASS fusion-polish-665-node: ${checks} assertions`);
