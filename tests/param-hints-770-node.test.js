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
const visible = (el) => { for (let e = el; e && e !== host; e = e.parentElement) if (e.hidden || e.style.display === 'none') return false; return true; };
const STATES = [
  ...CUT_TYPES.filter((t) => !t.slopeKind).map((t) => ({ cutType: t.id })),
  ...['freehand', 'linked', 'raster', 'morphed'].flatMap((c) => [{ cutType: 'pocket', clearing: c }, { cutType: 'pocket', clearing: c, loop: true }]),
  ...['off', 'tabs', 'skin'].flatMap((h) => [{ cutType: 'exterior', holdPart: h }, { cutType: 'interior', holdPart: h }]),
  ...['off', 'tabs', 'skin'].map((h) => ({ cutType: 'online', holdPart: h })), // TASK 775: On line takes the Hold part rows
  { cutType: 'online', leadIn: true }, { cutType: 'online', leadIn: true, leadInSide: 'inside' }, // TASK 775: the Lead-in rows
  ...['linked', 'raster', 'morphed'].map((c) => ({ cutType: 'pocket', clearing: c, loop: true, leadIn: true })),
  ...['pocket', 'inside', 'outside'].flatMap((k) => [{ cutType: 'roughing', slope: slope(k) }, { cutType: 'roughing', slope: slope(k), adaptiveSteps: true }]), // TASK 792: Roughing replaced the stepped types
  { cutType: 'pocket', slope: slope('pocket') }, { cutType: 'interior', slope: slope('inside') }, { cutType: 'exterior', slope: slope('outside') },
  { cutType: 'roughing' }, { cutType: 'contour', stepDepth: 0.25, cutterShape: 'ballnose' }, // TASK 792: a drawn region's Roughing, a part's Contour card
  { cutType: 'roughing', levels: [{ z: 1, loops: [[0, 0, 10, 0, 10, 10]] }] }, { cutType: 'roughing', levels: [{ z: 1, loops: [[0, 0, 10, 0, 10, 10]] }], roughLayout: 'nested' }, // TASK 792: a part with levels: its Layout row
];
for (const record of STATES) {
  const name = JSON.stringify(record);
  panel.update({ kind: record.cutType === 'contour' ? 'contour' : 'loop', contour: record.cutType === 'roughing' ? { allowed: true, on: true } : null, record: { cutDepth: 6, cutOffset: 0, toolDia: 6, ...record } }); // TASK 792: a Roughing card shows its Contour row; a Contour is its own card (kind 'contour')
  const rows = [...host.querySelectorAll('.cut-field, .cut-row')].filter(visible);
  ok(rows.length >= 1, name + ': rows shown');
  for (const row of rows) {
    const trig = row.querySelector('[data-hint]');
    ok(trig, `${name} ${row.dataset.row || row.dataset.param || 'type'}: a label with a hint entry`);
    const id = trig.dataset.hint;
    ok(PARAM_HINTS[id], `${name}: the row's entry ${id}`);
    seen.add(id);
    eq(trig.textContent, hintLabel(id), `${name} ${id}: the label is the table's`);
    eq(hintFor(trig), hintText(id, { loop: record.loop === true, pocket: record.cutType === 'pocket', online: record.cutType === 'online', roughing: record.cutType === 'roughing', contour: record.cutType === 'contour' }), `${name} ${id}: the tooltip text is the table's hint in the card's context`);
    for (const c of row.querySelectorAll('[data-hint]')) { seen.add(c.dataset.hint); eq(c.textContent, hintLabel(c.dataset.hint), `${name}: the element ${c.dataset.hint} shows its name`); if (c !== trig) eq(hintFor(c), hintText(c.dataset.hint), `${name}: its tooltip is its hint`); }
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

// ── 3. every entry is rendered somewhere ──
const html = fs.readFileSync(new URL('../apps/shaper/index.html', import.meta.url), 'utf8');
const mainJs = fs.readFileSync(new URL('../apps/shaper/src/main.js', import.meta.url), 'utf8');
const opListJs = fs.readFileSync(new URL('../apps/shaper/src/op-list.js', import.meta.url), 'utf8');
for (const m of html.matchAll(/data-(?:hint|label)="([A-Za-z]+)"/g)) seen.add(m[1]);
for (const m of mainJs.matchAll(/hint(?:Label|Text)\('([A-Za-z]+)'\)/g)) seen.add(m[1]);
for (const m of opListJs.matchAll(/id:\s*'([A-Za-z]+)'/g)) seen.add(m[1]);
const stlCardJs = fs.readFileSync(new URL('../apps/shaper/src/stl-card.js', import.meta.url), 'utf8'); // TASK 790: the STL card's rows and title
for (const m of stlCardJs.matchAll(/data-hint="([A-Za-z]+)"|hintLabel\('([A-Za-z]+)'\)/g)) seen.add(m[1] || m[2]);
for (const id of ['stockThickness', 'material', 'export', 'generateSvg', 'syncShaperHub', 'openShaperHub', 'download']) ok(seen.has(id), `the Export step / drawer renders ${id}`);
const side = html.slice(html.indexOf('<aside id="review-side">'), html.indexOf('</aside>')); // the Export step's side cards (the Sync dialog's own title is not a label of the table)
ok(side.length > 100, 'the side cards markup');
for (const label of ['Thickness', 'Material', 'Export', 'Generate Shaper SVG', 'Sync to ShaperHub', 'Open ShaperHub (My Files)']) ok(!side.includes(`>${label}<`) && !side.includes(`>${label} `) && !side.includes(`⚡ ${label}`), `no label text "${label}" left in the side cards' markup`);
const unseen = Object.keys(PARAM_HINTS).filter((id) => !seen.has(id));
eq(unseen, [], 'every entry of the table is rendered somewhere');
panel.destroy();
await win.happyDOM.close();
console.log(`param-hints-770-node: ok (${checks} checks, ${Object.keys(PARAM_HINTS).length} entries)`);
