// tests/export-own-hole-711-live.test.js — TASK 711: the real Fusion solid (tests/fixtures/real-solid-plate-711.json: a 200x120x19 plate with
// R10 corners, 2 d8 through holes, a through slot, pockets at 4 / 6 / 8 / 10 mm, the 4 mm one stepped down to the 10 mm one, the 8 mm one
// around an island) sent to the Shaper page in Fusion mode the way the add-in sends it (fusionJavaScriptHandler.handle('selection_data')),
// then the Export step (stage 'review') -> Generate Shaper SVG: the downloaded file holds exactly 1 Outside cut (the outline), 3 Inside cuts (the 2 circles and the
// slot, once each) and 4 pockets at 4 / 6 / 8 / 10 mm (the 4 mm with the inner step as its hole, the 8 mm with the island as its hole),
// nothing else: no pocket outline as an Inside cut through the plate, no hole written twice. The 3D Review's input (planReliefItems, the
// page's own module) holds the same cuts. Runs in the browser because the outline's arcs need the page's arc sampler (Node draws chords).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/711');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const payload = fs.readFileSync(new URL('./fixtures/real-solid-plate-711.json', import.meta.url), 'utf8');

const cdp = await launchBrowser({ tag: '711-export-holes', width: 900, height: 731 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-711-dl-'));

// The export's elements, each with its cut attributes (a <g> hoists shared attributes; its children inherit them).
function elementsOf(svg) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) { group = attrs(line); continue; }
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    const geom = m[1] === 'circle' ? `circle ${a.cx},${a.cy} r${a.r}` : `${m[1]} ${a.d}`;
    out.push({ cutType: a['shaper:cutType'], depth: a['shaper:cutDepth'], geom, subpaths: m[1] === 'path' ? (a.d.match(/M/g) || []).length : 1 });
  }
  return out;
}

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.adsk = { _sent: [], fusionSendData(a, d) { this._sent.push({ a, d }); return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler`, 'the Fusion handler');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(payload)})`);
  await waitFor(`document.getElementById('prepare-notice') && /8 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the import notice (8 regions)');

  // the Outline region (holes: []) is a derived-loop target, unchanged by task 711
  const outlineKey = await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN].filter(([, r]) => r.cutType === 'exterior').map(([k]) => k))`);
  assert.strictEqual(outlineKey.length, 1, 'one Outside record');
  assert.ok(outlineKey[0].startsWith('loop:'), 'the Outline is a loop:<id> target: ' + outlineKey[0]);

  // the Export step (stage id 'review'; its label comes from packages/ui/stage-names.js) -> Generate Shaper SVG (the user's path).
  // The shared header marks each step button with its stable stage id (data-tab), so the label can change without this test.
  await evalJs(`document.querySelector('.sk-header-tab[data-tab="review"]').click()`);
  await waitFor(`!document.getElementById('view-review').hidden && !!document.getElementById('btn-generate-svg')`, 'the Export stage (review)');
  await evalJs(`document.getElementById('btn-generate-svg').click()`);
  let file = null;
  for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
  assert.ok(file, 'the export downloaded');
  const svg = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'export-live.svg'), svg);
  const els = elementsOf(svg);
  console.log('ELEMENTS ' + JSON.stringify(els.map((e) => `${e.cutType} ${e.depth} ${e.geom.slice(0, 40)}`), null, 1));

  // the depths are in the document unit (Shaper defaults to inch): compare in mm
  const mm = (d) => { const m = /^(-?[\d.]+)\s*(mm|in)$/.exec(d || ''); return m ? Math.round(Number(m[1]) * (m[2] === 'in' ? 25.4 : 1)) : null; };
  const by = (t) => els.filter((e) => e.cutType === t);
  assert.strictEqual(els.length, 8, 'exactly 8 elements (1 outside + 3 inside + 4 pockets), nothing else:\n' + svg);
  assert.strictEqual(by('outside').length, 1, 'one Outside cut: the outline');
  assert.strictEqual(mm(by('outside')[0].depth), 19, 'the outline at 19 mm');
  const inside = by('inside');
  assert.strictEqual(inside.length, 3, 'three Inside cuts (2 circles + the slot), no pocket outline among them:\n' + svg);
  assert.strictEqual(new Set(inside.map((e) => e.geom)).size, 3, 'each Inside cut written once');
  assert.strictEqual(inside.filter((e) => e.geom.startsWith('circle')).length, 2, 'the two d8 holes');
  assert.ok(inside.every((e) => mm(e.depth) === 19), 'the through holes at 19 mm');
  const pockets = by('pocket').map((e) => ({ depth: mm(e.depth), subpaths: e.subpaths })).sort((a, b) => a.depth - b.depth);
  assert.deepStrictEqual(pockets, [
    { depth: 4, subpaths: 2 },  // the stepped pocket, the inner step as its hole
    { depth: 6, subpaths: 1 },
    { depth: 8, subpaths: 2 },  // around the island
    { depth: 10, subpaths: 1 }, // the inner step
  ], 'four pockets at 4 / 6 / 8 / 10 mm');
  assert.strictEqual(new Set(els.map((e) => e.cutType + '|' + e.depth + '|' + e.geom)).size, els.length, 'no element written twice');

  // the 3D Review's input from the same plan, in the page
  const review = await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.planReliefItems(window.__designController.state).map((i) => i.cutType + ' ' + i.cutDepth).sort())`);
  console.log('REVIEW ' + JSON.stringify(review));
  assert.deepStrictEqual(review, ['exterior 19', 'interior 19', 'interior 19', 'interior 19', 'pocket 10', 'pocket 4', 'pocket 6', 'pocket 8'], 'Review: the same 8 cuts');
  console.log('export-own-hole-711-live.test.js: ok');
} finally {
  await close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
