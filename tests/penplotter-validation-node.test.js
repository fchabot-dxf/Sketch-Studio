// tests/penplotter-validation-node.test.js — TASK 583 (node port of tests/penplotter-validation-live.test.js, TASK 453): the Pen Plotter inputs keep ONE valid
// value. Document dialog, machine settings, fill spacing, outline passes and pen width: a bad value is clamped or refused and the box SHOWS the value actually
// kept; the exported G-code never holds F0 / NaN. Typing = the kit's type() into the focused box, then Tab (the "change" commit), through
// tests/helpers/node-app.js with the real stages.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { buildGcodeEntries } from '../apps/penplotter/src/export.js';

const app = await open({ host: 'penplotter' });
try {
  const doc = app.document;
  const q = (sel) => doc.querySelector(sel);
  const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
  const P = app.plotter;
  // Typing into a number box: click it, select all, type, then Tab (the "change" commit).
  const typeInto = (el, text) => {
    app.press(el); el.focus();
    app.key('a', { ctrl: true });
    app.type(text === '' ? '\b' : text);
    app.key('Tab');
  };
  const inputOf = (sel) => { const e = q(sel); assert(e, sel + ' not found'); return e; };
  const fieldInput = (text) => { const f = [...doc.querySelectorAll('#activeLayerContent .field')].find((x) => x.textContent.includes(text)); assert(f, text + ' field not found'); return f.querySelector('input'); };

  // ---- Document dialog (Design tab): the box shows the KEPT value
  pressEl('#designDocBtn');
  assert(q('#docModal').style.display !== 'none', 'document dialog open');
  const docRows = [];
  for (const [typed, want, why] of [['-5', 10, 'negative clamps to the minimum'], ['99999', 2000, 'huge clamps to the maximum'], ['', 2000, 'empty keeps the previous'], ['0', 10, 'zero clamps to the minimum'], ['150', 150, 'a valid size is kept']]) {
    typeInto(inputOf('#docW'), typed);
    const shown = +inputOf('#docW').value, kept = P.doc.w;
    docRows.push(`${JSON.stringify(typed)} -> box ${shown}, doc.w ${kept}`);
    assert.strictEqual(kept, want, 'doc width ' + why + ': ' + JSON.stringify(typed) + ' kept ' + kept);
    assert.strictEqual(shown, want, 'the box shows the kept value: ' + shown);
  }
  console.log('document:', docRows.join(' | '));
  pressEl('#docDone');

  // ---- Toolpath tab: machine settings
  pressEl('.stage-btn[data-stage="toolpath"]');
  assert(q('.stage-btn[data-stage="toolpath"]').classList.contains('active') && q('#drawFeed') && q('#addFillTp'), 'toolpath stage ready');
  const setRows = [];
  for (const [id, typed, key_, want] of [
    ['drawFeed', '', 'draw_feed', 2000], ['drawFeed', '-5', 'draw_feed', 1], ['drawFeed', '1234', 'draw_feed', 1234],
    ['zFeed', '0', 'z_feed', 1], ['tol', '0', 'tolerance_mm', 0.001], ['tol', '-1', 'tolerance_mm', 0.001],
    ['penUpZ', '-1', 'pen_up_z', 5],           // == pen down Z (-1): refused, previous kept
  ]) {
    typeInto(inputOf('#' + id), typed);
    const kept = P.settings[key_], shown = +inputOf('#' + id).value;
    setRows.push(`${id} ${JSON.stringify(typed)} -> ${kept}`);
    assert.strictEqual(kept, want, `${id} ${JSON.stringify(typed)} kept ${kept}, wanted ${want}`);
    assert.strictEqual(shown, want, `${id} box shows the kept value ${shown}`);
  }
  console.log('settings:', setRows.join(' | '));
  assert(/must differ/.test(q('#toast').textContent), 'the refusal is explained in the toast');

  // ---- a fill toolpath: spacing and angle
  pressEl('#addFillTp');
  assert([...doc.querySelectorAll('#activeLayerContent .field')].some((f) => f.textContent.includes('Spacing')), 'fill toolpath Spacing field');
  const fills = [];
  for (const [typed, want] of [['0', 0.1], ['-1', 0.1], ['', 0.1], ['500', 100], ['3', 3]]) {
    const sp = fieldInput('Spacing');
    typeInto(sp, typed);
    const kept = P.toolpaths.find((t) => t.id === P.activeToolpathId).fill.spacing, shown = +fieldInput('Spacing').value;
    fills.push(`${JSON.stringify(typed)} -> ${kept}`);
    assert.strictEqual(shown, kept, 'the Spacing box shows the kept value ' + kept + ', not ' + shown);
    if (typed !== '') assert.strictEqual(kept, want, 'spacing ' + typed + ' kept ' + kept);
  }
  console.log('spacing :', fills.join(' | '));

  // ---- outline passes (the default Outline toolpath)
  const row = [...doc.querySelectorAll('#toolpathLayers .tp-layer-row')].find((r) => /Outline/.test(r.textContent));
  assert(row, 'an Outline row');
  app.press(row.querySelector('.tp-layer-name'));
  assert([...doc.querySelectorAll('#activeLayerContent .field')].some((f) => f.textContent.includes('Passes')), 'outline toolpath Passes field');
  const passes = [];
  for (const [typed, want] of [['0', 1], ['-2', 1], ['2.5', 3], ['99', 10]]) {
    typeInto(fieldInput('Passes'), typed);
    const kept = P.toolpaths.find((t) => t.id === P.activeToolpathId).outline.passes;
    passes.push(`${typed} -> ${kept}`);
    assert.strictEqual(kept, want, 'passes ' + typed + ' kept ' + kept);
    assert.strictEqual(+fieldInput('Passes').value, want, 'the Passes box shows the kept value');
  }
  console.log('passes  :', passes.join(' | '));

  // ---- pen width: add a pen, type widths
  pressEl('#addPlotColor');
  assert(q('.pc-row:last-child .pc-width'), 'new pen width box');
  const widths = [];
  for (const [typed, want] of [['-3', 0.05], ['99', 5], ['', 5], ['0.3', 0.3]]) {
    typeInto(inputOf('.pc-row:last-child .pc-width'), typed);
    const kept = P.plotColors[P.plotColors.length - 1].width, shown = +inputOf('.pc-row:last-child .pc-width').value;
    widths.push(`${JSON.stringify(typed)} -> ${kept}`);
    assert.strictEqual(kept, want, 'pen width ' + typed + ' kept ' + kept);
    assert.strictEqual(shown, want, 'the pen width box shows the kept value');
  }
  console.log('pen width:', widths.join(' | '));

  // ---- the exported G-code never contains F0 / NaN even with the settings just typed
  const gcode = buildGcodeEntries().map((e) => e.content);
  assert(gcode.length >= 0 && gcode.every((g) => !/F0\b|NaN/.test(g)), 'no F0 / NaN in the exported G-code');
  console.log('penplotter-validation-node: ok (' + gcode.length + ' G-code files checked)');
} finally {
  await app.close();
}
