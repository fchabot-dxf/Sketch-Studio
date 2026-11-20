// tests/origin-rules-803-node.test.js — TASK 803: the Origin / Studio rules kept once as data (#core/origin-rules.js), their generated index, and the ONE validator.
//   1. the rules data is complete: every rule has an id, a name, targets that exist, a severity, a status, a statement, evidence (a WORK-LOG turn that exists, a file that exists, a url or a note),
//      and `usedBy` entries that resolve to real code ('file#symbol': the symbol appears in the file); every declarative check is a kind the validator knows
//   2. docs/ORIGIN-RULES.md is the CURRENT output of scripts/gen-origin-rules-index.mjs, and holds no statement
//   3. the validator flags a grouped-attribute file, a same-winding compound path, a missing toolDia, a unit-less length, a wrong order, a wrong page, a wrong colour; each finding names its element
//   4. a finding measured on one target is not reported for the other
//   5. EVERY export of the migration corpus (tests/fixtures/opfirst: the designs through the app's own export call) passes with no error and no warning
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import './helpers/node-app.js';
import { loadCase } from './helpers/opfirst-measure.js';
import { ORIGIN_RULES, ORIGIN_TARGETS, CHECK_KINDS, checkOriginRules, formatOriginRuleWarning, exportForm, getTargetCaps, originRuleById } from '#core/origin-rules.js';
import { buildIndex, INDEX_FILE, workLogLine } from '../scripts/gen-origin-rules-index.mjs';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { planEntries } from '../apps/shaper/src/cut-plan.js';
import { applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

// ── 1. the data is complete ──
const log = read('WORK-LOG.md');
const ids = new Set();
ok(ORIGIN_RULES.length >= 20, 'the seed rules are all there');
for (const r of ORIGIN_RULES) {
  ok(r.id && !ids.has(r.id), `${r.id}: a unique id`); ids.add(r.id);
  ok(r.name && r.statement, `${r.id}: a name and a statement`);
  ok(r.targets.length && r.targets.every((t) => ORIGIN_TARGETS[t]), `${r.id}: targets exist`);
  ok(['measured', 'documented', 'assumed'].includes(r.status), `${r.id}: an honest status`);
  ok([null, 'error', 'warn', 'info'].includes(r.sev), `${r.id}: a severity`);
  ok(r.check ? Boolean(r.sev && r.message) : r.sev === null, `${r.id}: a check has a severity and a message; no check, no severity`);
  if (r.check) ok(CHECK_KINDS.includes(r.check.kind), `${r.id}: check kind ${r.check.kind} is known to the validator`);
  ok(Array.isArray(r.evidence) && r.evidence.length > 0, `${r.id}: evidence`);
  for (const e of r.evidence) {
    if (e.log) ok(workLogLine(log, e.log), `${r.id}: WORK-LOG heading "${e.log}" exists`);
    else if (e.file) ok(fs.existsSync(new URL(e.file, ROOT)), `${r.id}: evidence file ${e.file} exists`);
    else ok(e.url || e.note, `${r.id}: an evidence url or note`);
  }
  ok(r.usedBy.length > 0, `${r.id}: usedBy`);
  for (const u of r.usedBy) {
    const [f, sym] = u.split('#');
    ok(fs.existsSync(new URL(f, ROOT)) && sym, `${r.id}: usedBy file ${f} exists`);
    ok(read(f).includes(sym), `${r.id}: ${sym} appears in ${f}`);
  }
}
for (const [id, t] of Object.entries(ORIGIN_TARGETS)) {
  ok(t.id === id && t.name, `target ${id}`);
  for (const [k, f] of Object.entries(t.forms)) ok(f.status && Array.isArray(f.evidence) && f.evidence.length, `target ${id} form ${k}: status + evidence`);
}
eq(getTargetCaps('origin').readsGroupAttrs, false, 'the Origin ignores a parent <g> attributes');
eq(getTargetCaps('studio').autoPass, false, 'a capability a target does not declare is false (never assumed from the other target)');

// ── 2. the generated index is current and holds no statement ──
const index = await buildIndex();
eq(read(INDEX_FILE), index, `${INDEX_FILE} is stale: run node scripts/gen-origin-rules-index.mjs`);
ok(!index.includes('NOT FOUND') && !index.includes('#Lnull'), 'every evidence and entry link resolves');
for (const r of ORIGIN_RULES) { ok(index.includes('`' + r.id + '`'), `index lists ${r.id}`); ok(!index.includes(r.statement), `${r.id}: the index holds no copy of the statement`); }
ok(index.includes('## How to add a rule'), 'the index header says how to add a rule');

// ── 3. the validator ──
const ENC = exportEncoding();
const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="100mm" height="100mm" viewBox="0 0 100 100">';
const GOOD = `${HEAD}
  <path d="M 10 10 L 60 10 L 60 60 L 10 60 Z M 20 20 L 20 50 L 50 50 L 50 20 Z" fill="#000000" shaper:cutType="outside" shaper:cutDepth="0.250 in" shaper:cutOffset="0in" shaper:toolDia="0.250 in"/>
</svg>`;
const run = (svg, o = {}) => checkOriginRules(svg, { targets: ['origin', 'studio'], encoding: ENC, ...o });
const ruleIds = (res) => res.hits.map((h) => h.ruleId);
{
  const g = run(GOOD);
  eq(g.hits, [], 'the hand-made good file breaks nothing (outer wound one way, the hole the other)');
  ok(g.ok && g.clean, 'ok and clean');
  eq(formatOriginRuleWarning(g), '', 'no warning for a clean file');
}
{ // a grouped-attribute file (the cut on the <g>, the way TASK 802 measured to fail on the Origin)
  const grouped = `${HEAD}
  <g shaper:cutType="online" shaper:cutDepth="0.250 in" fill="none" stroke="#7F7F7F">
    <path d="M 10 10 L 60 10"/>
  </g>
</svg>`;
  const r = run(grouped);
  const hit = r.hits.find((h) => h.ruleId === 'per-element-attributes');
  ok(hit && hit.sev === 'error' && !r.ok, 'a grouped-attribute file is an error');
  ok(r.hits.filter((h) => h.ruleId === 'per-element-attributes').length >= 2, 'the <g> that carries shaper:* AND the path that has none are both reported');
  ok(r.hits.some((h) => h.element.startsWith('<path')), 'a finding names its element');
}
{ // a same-winding compound path (the hole wound the SAME way as the outer: the Origin fills it solid)
  const same = GOOD.replace('M 20 20 L 20 50 L 50 50 L 50 20 Z', 'M 20 20 L 50 20 L 50 50 L 20 50 Z');
  const r = run(same);
  eq(ruleIds(r), ['compound-path-winding'], 'only the winding rule');
  ok(r.hits[0].element.startsWith('<path') && !r.ok, 'names the path; an error');
  ok(formatOriginRuleWarning(r).includes('Holes wound opposite') && formatOriginRuleWarning(r).includes('still exported'), 'the Export warning names the rule and says the file is still allowed');
  ok(ruleIds(run(GOOD.replace('fill="#000000"', 'fill="#000000" fill-rule="evenodd"'))).includes('compound-path-winding'), 'a fill-rule evenodd is flagged');
}
{ // a missing toolDia
  const r = run(GOOD.replace(' shaper:toolDia="0.250 in"', ''));
  eq(ruleIds(r), ['tool-dia-present'], 'a cutting element without toolDia');
  eq(r.hits[0].sev, 'warn', 'a warning: the file is allowed');
  ok(r.ok && !r.clean, 'ok (no error) but not clean');
  eq(ruleIds(run(GOOD.replace(' shaper:toolDia="0.250 in"', '').replace('"outside"', '"guide"').replace('fill="#000000"', 'fill="#0068FF" stroke="#0068FF"'))), [], 'a guide needs no toolDia');
}
eq(ruleIds(run(GOOD.replace('0.250 in"/>', '0.250"/>'))), ['param-unit-suffix', 'studio-param-format'], 'a length without a unit (and not in Studio format: info)');
eq(ruleIds(run(GOOD.replace('"0.250 in" shaper:cutOffset', '"0.25 in" shaper:cutOffset'))), ['studio-param-format'], 'a 2-decimal length is a number with a unit (the Studio-format rule is info)');
eq(ruleIds(run(GOOD.replace('shaper:cutDepth="0.250 in" shaper:cutOffset="0in"', 'shaper:cutOffset="0in" shaper:cutDepth="0.250 in"'))), ['shaper-attr-order'], 'Studio attribute order');
eq(ruleIds(run(GOOD.replace('width="100mm"', 'width="50mm"'))), ['page-viewbox-mm'], 'a page that is not the viewBox');
eq(ruleIds(run(GOOD.replace('viewBox="0 0 100 100"', 'viewBox="0 0 40 100"').replace('width="100mm"', 'width="40mm"'))), ['page-viewbox-mm'], 'an element outside the viewBox');
eq(ruleIds(run(GOOD.replace('xmlns:shaper="http://www.shapertools.com/namespaces/shaper" ', ''))), ['shaper-namespace'], 'the missing shaper namespace');
eq(ruleIds(run(GOOD.replace('fill="#000000"', 'fill="#123456"'))), ['cut-type-encoding'], 'a colour that is none of the type encodings');
eq(ruleIds(checkOriginRules(GOOD.replace('fill="#000000"', 'fill="#123456"'))), [], 'without the injected encoding the colours are not checked (named in skipped)');
eq(checkOriginRules(GOOD).skipped, ['cut-type-encoding'], 'skipped names the rule');
// ── 4. targets are never assumed across ──
const REORDERED = GOOD.replace('shaper:cutDepth="0.250 in" shaper:cutOffset="0in"', 'shaper:cutOffset="0in" shaper:cutDepth="0.250 in"');
eq(ruleIds(checkOriginRules(REORDERED, { target: 'origin', encoding: ENC })), [], 'the attribute order is measured on Studio only: not reported for the Origin');
eq(ruleIds(checkOriginRules(REORDERED, { target: 'studio', encoding: ENC })), ['shaper-attr-order'], 'and reported for Studio');
eq(originRuleById('studio-param-format').targets, ['studio'], 'the number format is Studio only');
eq(exportForm('attrOrder'), ['cutType', 'cutDepth', 'cutOffset', 'toolDia'], 'the exporter reads Studio order');
eq(exportForm('paramFormat').decimals, 3, 'and Studio decimals');

// ── 5. every export fixture passes ──
const DIR = new URL('fixtures/opfirst/', import.meta.url);
const cases = JSON.parse(fs.readFileSync(new URL('cases.json', DIR), 'utf8'));
const pool = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('pool.json.gz', DIR))));
const expand = (c) => {
  const sidecar = JSON.parse(JSON.stringify(c.sidecar));
  for (const e of sidecar.cutPlan || []) if (e && e[1] && e[1].levels && e[1].levels.$levels) e[1].levels = pool.levels[e[1].levels.$levels];
  if (sidecar.stl && sidecar.stl.$stl) sidecar.stl = pool.stl[sidecar.stl.$stl];
  return { geometry: pool.geometry[c.geometry], sidecar, settings: c.settings };
};
const failures = [];
let files = 0, withElements = 0, partial = 0;
for (const c of cases) {
  const x = expand(c), state = loadCase(x);
  applyShaperDoc(x.sidecar, state);
  const entries = planEntries();
  if (!entries.length) continue;
  const svg = shaperSvgOf(state, entries);
  files++;
  if (/<(path|circle)\b/.test(svg)) withElements++;
  const r = run(svg);
  for (const h of r.hits) if (h.sev !== 'info') failures.push(`${c.name}: ${h.ruleId} ${h.element} ${h.detail || ''}`);
  if (entries.length > 1) { // TASK 798: a PARTIAL file (the first operation only, on the whole plan's frame: the page, the Stock guide or the frame guide)
    partial++;
    for (const h of run(shaperSvgOf(state, [entries[0]], { frame: entries })).hits) if (h.sev !== 'info') failures.push(`${c.name} (partial): ${h.ruleId} ${h.element} ${h.detail || ''}`);
  }
}
assert.deepEqual(failures.slice(0, 25), [], `${failures.length} rule hits over the corpus exports`); checks++;
ok(files > 400 && withElements > 400, `the corpus exports were checked (${files} files, ${withElements} with elements)`);
ok(partial > 50, `partial files were checked too (${partial})`);
console.log(`origin-rules-803-node: ${checks} checks passed (${ORIGIN_RULES.length} rules, ${files} export files checked)`);
