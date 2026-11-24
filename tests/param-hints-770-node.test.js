// tests/param-hints-770-node.test.js — TASK 770: THE table of the Shaper parameters' labels and hints (apps/shaper/src/param-hints.js) is complete and is the
// one source the card reads:
//  1. the table: every entry has a label and a hint (a non-empty sentence; Finish allowance: one per Loop state); no hint holds a length unit (a document may
//     be inches or mm); every declared choice (each cut type, clearing pattern, cutter shape, hold-part mode) has its entry, its label = its declaration's.
//  2. the cut card (the real createCutPanel in a happy-dom page), in every state that shows a different set of rows (each cut type, Freehand / Spiral / Raster /
//     Morphed with Loop off and on, Hold part Off / Tabs / Onion skin, a stepped cut fixed and adaptive, a Stock): every row shown has a label trigger whose
//     text is its entry's label and whose tooltip text (hint.js hintFor: the text the cursor tooltip shows) is its entry's hint in the card's context; every menu
//     row (the cut types, the clearing patterns, the cutter shapes) shows its choice's NAME only and names its entry in data-hint; the choice buttons (Hold part
//     modes ...) carry their own. TASK 805: NO hint text is laid out in the card (no .sk-hint / .sk-opt-hint / (i) trigger). The markup has no label text of its
//     own (each label is empty until the table fills it).
//  3. every entry is rendered somewhere: the card's rows / menus (2), the Export step's cards (index.html data-hint / data-label, filled by main.js) and the
//     drawer's Download (main.js reads hintLabel('download') / hintText('download')).
import assert from 'node:assert';
import { finishInLoop } from '#core/pocket-clearing.js'; // TASK 835e: who takes the finish allowance off (a Raster loop's wall: the Origin's inside cut)
import fs from 'node:fs';
import { Window } from 'happy-dom';
import { PARAM_HINTS, hintText, hintLabel, choiceId } from '../apps/shaper/src/param-hints.js';
import { hintFor } from '../apps/shaper/src/hint.js';
import { CUT_TYPES, CLEARING_CHOICES, CUTTER_SHAPES } from '../apps/shaper/src/shaper.js';
import { HOLD_PART } from '#core/hold-part.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

// ── 1. the table ──
const UNIT = /\b(mm|cm|in|inch|inches)\b|″|"/; // a hint never names a length unit (the word "in" as a preposition is avoided too: a sentence reads without it)
for (const [id, e] of Object.entries(PARAM_HINTS)) {
  ok(typeof e.label === 'string' && e.label.trim().length > 0, `${id}: a label`);
  const texts = typeof e.hint === 'function' ? [e.hint({ loop: false }), e.hint({ loop: true })] : [e.hint];
  for (const t of texts) {
    ok(typeof t === 'string' && t.trim().length > 10 && /[.:]$/.test(t), `${id}: a hint sentence: ${t}`);
    ok(!/\d+(\.\d+)?\s*(mm|cm|in)\b/.test(t) && !/\b(mm|cm|inch|inches)\b|″/.test(t), `${id}: no length unit in its hint: ${t}`);
  }
  for (const item of e.items || []) ok(PARAM_HINTS[item], `${id}: its item ${item} has an entry`);
}
eq([hintText('finishAllowance', { loop: false }), hintText('finishAllowance', { loop: true })],
  ['Left on the walls by the clearing passes; the Origin’s inside cut takes it off for a clean edge. 0 = none.', 'Left on the walls by the clearing passes; the loop’s turn along the wall takes it off for a clean edge. 0 = none.'],
  'Finish allowance (TASK 766): its hint follows the Loop box');
const CHOICES = { cutType: CUT_TYPES.map((t) => [t.id, t.menuLabel]), clearing: CLEARING_CHOICES.map((c) => [c.id, c.label]), cutterShape: CUTTER_SHAPES.map((s) => [s.id, s.label]), holdPart: HOLD_PART.modes.map((m) => [m.id, m.label]) };
for (const [param, list] of Object.entries(CHOICES)) for (const [id, label] of list) {
  ok(PARAM_HINTS[choiceId(param, id)], `${param} ${id}: an entry`);
  eq(hintLabel(choiceId(param, id)), label, `${param} ${id}: its label is its declaration's`);
}
assert.throws(() => hintText('noSuchParam'), /no entry noSuchParam/, 'an unknown id throws (never a blank hint)'); checks++;

// ── 2. the cut card ──
const win = new Window({ url: 'http://localhost/' });
globalThis.window = win; globalThis.document = win.document;
for (const k of ['Node', 'HTMLElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'getComputedStyle', 'localStorage']) if (!(k in globalThis)) globalThis[k] = win[k];
const { createCutPanel } = await import('../apps/shaper/src/cut-panel.js');
const doc = win.document;
const host = doc.createElement('div');
doc.body.appendChild(host);
const markup = fs.readFileSync(new URL('../apps/shaper/src/cut-panel.js', import.meta.url), 'utf8');
for (const e of Object.values(PARAM_HINTS)) ok(!markup.includes(`>${e.label}<`), `no label text "${e.label}" in the card's markup (the table is its one source)`);
const panel = createCutPanel(host, {});
const seen = new Set();
const slope = (kind) => ({ kind, rings: [{}, {}] }); // (TASK 792: hasSlopeOf removed; Roughing's Contour row reads a slope)  a slope of that kind with 2 rings (the card only reads that it exists)
const press = (el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const visible = (el) => { for (let e = el; e && e !== host; e = e.parentElement) if (e.hidden || e.style.display === 'none' || (e.dataset && 'off' in e.dataset)) return false; return true; }; // TASK 813: a row greyed in place (data-off) is checked below: its tooltip = its reason + the table's text
const STATES = [
  ...CUT_TYPES.filter((t) => !t.slopeKind).map((t) => ({ cutType: t.id })),
  ...['freehand', 'linked', 'raster', 'morphed'].flatMap((c) => [{ cutType: 'pocket', clearing: c }, { cutType: 'pocket', clearing: c, loop: true }]),
  ...['off', 'tabs', 'skin'].flatMap((h) => [{ cutType: 'exterior', holdPart: h }, { cutType: 'interior', holdPart: h }]),
  ...['off', 'tabs', 'skin'].map((h) => ({ cutType: 'online', holdPart: h })), // TASK 775: On line takes the Hold part rows
  ...['pocket', 'inside', 'outside'].flatMap((k) => [{ cutType: 'roughing', slope: slope(k) }, { cutType: 'roughing', slope: slope(k), adaptiveSteps: true }]), // TASK 792: Roughing replaced the stepped types
  { cutType: 'pocket', slope: slope('pocket') }, { cutType: 'interior', slope: slope('inside') }, { cutType: 'exterior', slope: slope('outside') },
  { cutType: 'roughing' }, { cutType: 'contour', stepDepth: 0.25, cutterShape: 'ballnose' }, // TASK 792: a drawn region's Roughing, a part's Contour card
  { cutType: 'roughing', levels: [{ z: 1, loops: [[0, 0, 10, 0, 10, 10]] }] }, { cutType: 'roughing', levels: [{ z: 1, loops: [[0, 0, 10, 0, 10, 10]] }], roughLayout: 'nested' }, // TASK 792: a part with levels: its Layout row
  { cutType: 'contour', stepDepth: 0.25, cutterShape: 'ballnose', levels: [{ z: 1, loops: [[0, 0, 10, 0, 10, 10]] }] }, // TASK 809: a Contour of a part with levels: its Smoothing row
  // TASK 810: Roughing's boundary rows: the Stock greyed (no Stock) / offered, Shape with its Pick (and Cancel pick while picking), a typed offset
  { cutType: 'roughing', levels: [{ z: 1, loops: [[0, 0, 10, 0, 10, 10]] }], boundaryCtx: { hasStock: true } },
  { cutType: 'roughing', levels: [{ z: 1, loops: [[0, 0, 10, 0, 10, 10]] }], boundary: 'shape', boundaryTool: 'inside', boundaryOffset: -2 },
  { cutType: 'roughing', levels: [{ z: 1, loops: [[0, 0, 10, 0, 10, 10]] }], boundary: 'shape', boundaryShape: 'loop:a', boundaryCtx: { hasStock: true, picking: true } },
  { cutType: 'contour', stepDepth: 0.25, cutterShape: 'ballnose', wallsCtx: { shown: true, value: 'sloped', defaultId: 'sloped' } }, // TASK 810: a Contour's Walls (its part has slope rings)
];
for (const { boundaryCtx, wallsCtx, ...record } of STATES) {
  const name = JSON.stringify(record);
  panel.update({ kind: record.cutType === 'contour' ? 'contour' : 'loop', contour: record.cutType === 'roughing' ? { allowed: true, on: true } : null, boundary: boundaryCtx || { hasStock: false, picking: false }, walls: wallsCtx || null, record: { cutDepth: 6, cutOffset: 0, toolDia: 6, ...record } }); // TASK 810: boundary = the Boundary rows' context // TASK 792: a Roughing card shows its Contour row; a Contour is its own card (kind 'contour')
  const rows = [...host.querySelectorAll('.cut-field, .cut-row')].filter(visible);
  ok(rows.length >= 1, name + ': rows shown');
  for (const row of rows) {
    const trig = row.querySelector('[data-hint]');
    ok(trig, `${name} ${row.dataset.row || row.dataset.param || 'type'}: a label with a hint entry`);
    const id = trig.dataset.hint;
    ok(PARAM_HINTS[id], `${name}: the row's entry ${id}`);
    seen.add(id);
    eq(trig.textContent, hintLabel(id), `${name} ${id}: the label is the table's`);
    eq(hintFor(trig), hintText(id, { loop: finishInLoop(record.clearing, record.loop === true), pocket: record.cutType === 'pocket', online: record.cutType === 'online', roughing: record.cutType === 'roughing', contour: record.cutType === 'contour' }), `${name} ${id}: the tooltip text is the table's hint in the card's context`);
    for (const c of row.querySelectorAll('[data-hint]')) { seen.add(c.dataset.hint); eq(c.textContent, hintLabel(c.dataset.hint), `${name}: the element ${c.dataset.hint} shows its name`); if (c !== trig) eq(hintFor(c), hintText(c.dataset.hint), `${name}: its tooltip is its hint`); }
  }
  for (const row of host.querySelectorAll('.cut-row[data-off]')) { // TASK 813: a greyed row stays in place: its label's tooltip is the reason, then the table's text
    const trig = row.querySelector('[data-hint]'), base = hintText(trig.dataset.hint, { loop: finishInLoop(record.clearing, record.loop === true), pocket: record.cutType === 'pocket', online: record.cutType === 'online', roughing: record.cutType === 'roughing', contour: record.cutType === 'contour' });
    ok(hintFor(trig).endsWith(base) && hintFor(trig).length > base.length + 10, `${name} ${row.dataset.row}: the greyed row's tooltip starts with its reason`);
  }
  for (const tab of [...host.querySelectorAll('.cut-tab')].filter(visible)) { // TASK 810: a Roughing / Contour card's tabs: each shows its name, its tooltip is its hint
    const n = tab.querySelector('[data-hint]');
    seen.add(n.dataset.hint);
    eq([n.textContent, hintFor(n)], [hintLabel(n.dataset.hint), hintText(n.dataset.hint)], `${name}: the tab ${n.dataset.hint}: its name and its hint`);
  }
  ok(!host.querySelector('.sk-hint, .sk-hint-trigger, .sk-hint-i, .sk-opt-hint'), `${name}: TASK 805: no hint text or (i) is laid out in the card`);
  // the menus: each row shows its name only (its hint is the tooltip)
  for (const [trigSel, popSel, optSel, param] of [['.cut-type-trigger', '.cut-type-menu', '.cut-type-opt', 'cutType'], ['.cut-shape-trigger', '.cut-shape-pop', '.cut-type-opt', 'cutterShape'], ['.cut-clear-trigger', '.cut-clear-pop', '.cut-clear-opt', 'clearing']]) {
    const t = host.querySelector(trigSel);
    if (!visible(t)) continue;
    press(t);
    const pop = host.querySelector(popSel);
    ok(!pop.hidden, `${name}: ${popSel} opens`);
    for (const opt of pop.querySelectorAll(optSel)) {
      const id = opt.dataset.hint;
      ok(id && id.startsWith(param + ':'), `${name} ${popSel}: a menu row with its hint entry (${id})`);
      eq(opt.querySelector('.cut-opt-name').textContent, hintLabel(id), `${name} ${id}: the menu row's name`);
      ok(!opt.textContent.includes(hintText(id)), `${name} ${id}: the menu row holds no hint text`);
      eq(hintFor(opt), hintText(id), `${name} ${id}: the menu row's tooltip is its hint`);
      seen.add(id);
    }
    press(t);
  }
}
for (const t of CUT_TYPES) ok(seen.has(choiceId('cutType', t.id)), `the cut type menu shows ${t.id}`);
{ // TASK 842: the Bit menu: its Custom row and its "Edit tool table..." show their names, their tooltips are their hints (the table's bits are the user's own names)
  panel.update({ kind: 'loop', boundary: { hasStock: false, picking: false }, record: { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6 } });
  press(host.querySelector('.cut-bit-trigger'));
  for (const id of ['bitCustom', 'toolTableEdit']) {
    const el = host.querySelector(`.cut-bit-pop [data-hint="${id}"]`);
    ok(el, `the Bit menu shows ${id}`);
    eq([(el.querySelector('.cut-opt-name') || el).textContent, hintFor(el)], [hintLabel(id), hintText(id)], `${id}: its name and its hint`);
    seen.add(id);
  }
  press(host.querySelector('.cut-bit-trigger'));
}
{ // TASK S2: the OPEN operation's card: its Shapes (a row's X), Duplicate, OK / Cancel; a Contour's own Wall side (a drawn shape: its Geometry tab)
  panel.update({ mode: 'op', kind: 'loop', title: 'Contour 1 · 1 shape', shapes: [{ key: 'loop:a', label: 'Shape 40 × 40 mm' }], wallSideFree: true, boundary: { hasStock: false, picking: false }, record: { cutType: 'contour', stepDepth: 0.25, cutterShape: 'ballnose' } });
  press(host.querySelector('.cut-tab[data-tab="geometry"]'));
  const els = [...host.querySelectorAll('[data-hint]')].filter(visible);
  for (const id of ['opShapes', 'opRemoveShape', 'opDuplicate', 'opPreview', 'opOk', 'opCancel', 'wallSide', 'wallSide:inside', 'wallSide:outside']) { // TASK 817: + Preview
    const el = els.find((e) => e.dataset.hint === id);
    ok(el, `the open operation's card shows ${id}`);
    eq(hintFor(el), hintText(id), `${id}: its tooltip is its hint`);
    if (id !== 'opRemoveShape') eq(el.textContent, hintLabel(id), `${id}: its name is the table's`); // the X shows its glyph (its name is its aria-label)
    seen.add(id);
  }  // TASK S2 (owner turn 2740): a Contour's Depth row: its ONE depth, live (From model or a stop depth), its hint the owner's words; no Bottom row
  press(host.querySelector('.cut-tab[data-tab="heights"]'));
  const depthLabel = host.querySelector('.cut-row[data-param="cutDepth"] [data-hint]');
  eq([depthLabel.dataset.hint, 'off' in depthLabel.closest('.cut-row').dataset, hintFor(depthLabel), host.querySelector('.cut-depth').placeholder], ['levelsDepth', false, 'From model: each shape to its own model depth. A typed depth: the cut follows the model’s slope and stops flat at that depth.', 'From model'], 'a Contour’s Depth row: live, From model, its tooltip the owner’s words');
  ok(!('bottomDepth' in PARAM_HINTS), 'TASK S2 (owner turn 2740): no Bottom row, no Bottom hint');
  eq(hintText('cutDepth'), 'One flat depth for every shape. From model: each shape’s own model depth (the deepest point of a sloped shape).', 'a flat type’s Depth');
  seen.add('levelsDepth');
}

// ── 3. every entry is rendered somewhere ──
const html = fs.readFileSync(new URL('../apps/shaper/index.html', import.meta.url), 'utf8');
const mainJs = fs.readFileSync(new URL('../apps/shaper/src/main.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../apps/shaper/src/shaper-app.js', import.meta.url), 'utf8'); // TASK 881: the page's wiring is shaper-app.js (shared by the website and the Fusion panel) + main.js (the website's own parts)
const opListJs = fs.readFileSync(new URL('../apps/shaper/src/op-list.js', import.meta.url), 'utf8');
for (const m of html.matchAll(/data-(?:hint|label)="([A-Za-z]+)"/g)) seen.add(m[1]);
for (const m of mainJs.matchAll(/hint(?:Label|Text)\('([A-Za-z]+)'\)/g)) seen.add(m[1]);
for (const m of opListJs.matchAll(/id:\s*'([A-Za-z]+)'/g)) seen.add(m[1]);
for (const m of opListJs.matchAll(/dataset\.hint = '([A-Za-z]+)'/g)) seen.add(m[1]); // TASK S3: a row's out-of-date mark (opOutOfDate)
const stageJs = fs.readFileSync(new URL('../apps/shaper/src/prepare-stage.js', import.meta.url), 'utf8'); // TASK S3: the operations toolbar's Recalculate (its name and tooltip)
for (const m of stageJs.matchAll(/hint(?:Label|Text)\('([A-Za-z]+)'\)/g)) seen.add(m[1]);
const cutPanelJs = fs.readFileSync(new URL('../apps/shaper/src/cut-panel.js', import.meta.url), 'utf8'); // TASK 852d: V-bit / scallop bit notes
for (const m of cutPanelJs.matchAll(/hint(?:Label|Text)\('([A-Za-z]+)'/g)) seen.add(m[1]);
const fusionBridgeJs = fs.readFileSync(new URL('../apps/shaper/src/fusion-bridge.js', import.meta.url), 'utf8'); // TASK 855d: cross-design switch notice
for (const m of fusionBridgeJs.matchAll(/hint(?:Label|Text)\('([A-Za-z]+)'/g)) seen.add(m[1]);
const stlCardJs = fs.readFileSync(new URL('../apps/shaper/src/stl-card.js', import.meta.url), 'utf8'); // TASK 790: the STL card's rows and title
const toolTableJs = fs.readFileSync(new URL('../apps/shaper/src/tool-table-window.js', import.meta.url), 'utf8'); // TASK 842: the Tool table window's labels
for (const m of toolTableJs.matchAll(/data-hint="([A-Za-z]+)"|hint: '([A-Za-z]+)'/g)) seen.add(m[1] || m[2]);
if (toolTableJs.includes('b.dataset.hint = `cutterShape:${t.id}`')) for (const sh of CUTTER_SHAPES) seen.add(choiceId('cutterShape', sh.id)); // its Type buttons: every cutter shape (the tapered ones are offered only there)
for (const m of stlCardJs.matchAll(/data-hint="([A-Za-z]+)"|hintLabel\('([A-Za-z]+)'\)/g)) seen.add(m[1] || m[2]);
// TASK 880: the Export title (its 'export' entry) went with the side panel; the actions are the stage's header actions (main.js EXPORT_ACTIONS), the settings the footer's
for (const id of ['stockThickness', 'material', 'generateSvg', 'syncShaperHub', 'openShaperHub', 'download']) ok(seen.has(id), `the Export step / drawer renders ${id}`);
const settings = html.slice(html.indexOf('<div id="review-settings"'), html.indexOf('</div>', html.indexOf('<div id="review-settings"'))); // the Export step's footer settings
ok(settings.length > 100, 'the footer settings markup');
for (const label of ['Thickness', 'Material', 'Generate Shaper SVG', 'Sync to ShaperHub', 'Open ShaperHub (My Files)']) ok(!settings.includes(`>${label}<`) && !settings.includes(`>${label} `) && !mainJs.includes(`label: '${label}'`), `no label text "${label}" written out (the table's)`);
const unseen = Object.keys(PARAM_HINTS).filter((id) => !seen.has(id));
eq(unseen, [], 'every entry of the table is rendered somewhere');
panel.destroy();
await win.happyDOM.close();
console.log(`param-hints-770-node: ok (${checks} checks, ${Object.keys(PARAM_HINTS).length} entries)`);
