// tests/audits/files-audit-1024-export.mjs — TASK 1024 (AUDIT ONLY): SVG and DXF out of SketchStudio (sidebar Download SVG / Download DXF), then our own export re-imported.
// Run: node tests/audits/files-audit-1024-export.mjs      Rows F-80 ..
import fs from 'node:fs';
import path from 'node:path';
import { startKit, row, sleep, FIX_DIR, EVID_DIR } from './files-audit-1024-kit.js';
import { importViaMenu } from '../helpers/import-via-menu.js';

const k = await startKit({ tag: '1024-exp' });
const r2 = (v) => Math.round(v * 1000) / 1000;
const read = () => k.evalJs(`(() => { const out = []; document.querySelectorAll('#svgCanvas .shape-elem[data-shape-id]').forEach((el) => { const t = el.tagName.toLowerCase(); const g = (n) => +el.getAttribute(n); const o = { t, dash: !!(el.getAttribute('stroke-dasharray') && el.getAttribute('stroke-dasharray') !== 'none') }; if (t === 'line') Object.assign(o, { x1: g('x1'), y1: g('y1'), x2: g('x2'), y2: g('y2') }); else if (t === 'circle') Object.assign(o, { cx: g('cx'), cy: g('cy'), r: g('r') }); else o.d = el.getAttribute('d'); out.push(o); }); return out; })()`);
const kinds = (l) => { const o = {}; l.forEach((s) => { o[s.t] = (o[s.t] || 0) + 1; }); return JSON.stringify(o); };
const bbox = (list) => { let a = [Infinity, Infinity, -Infinity, -Infinity]; for (const s of list) { const pts = s.t === 'line' ? [[s.x1, s.y1], [s.x2, s.y2]] : s.t === 'circle' ? [[s.cx - s.r, s.cy - s.r], [s.cx + s.r, s.cy + s.r]] : []; for (const [x, y] of pts) a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; } return a.map(r2); };
const solidBox = (list) => bbox(list.filter((s) => s.t !== 'path'));
const OUT = path.join(EVID_DIR, 'exports'); fs.mkdirSync(OUT, { recursive: true });
try {
  await k.open('sketchstudio');
  await k.menu('open-file'); await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'dlg');
  await k.chooseFile(path.join(FIX_DIR, 'rich.sketch.json')); await sleep(1300);
  const orig = await read();
  row('F-80', `design opened for export: ${kinds(orig)} bbox(lines+circles)=${JSON.stringify(solidBox(orig))} construction shapes=${orig.filter((s) => s.dash).length}`);

  // SVG out
  const n0 = k.downloads.length;
  await k.menu('download-svg');
  const svgDl = await k.waitDownload(n0 + 1, 'svg', 6000);
  if (!svgDl) row('F-81', `Download SVG: no file; toasts=${JSON.stringify(await k.toasts())}`);
  else {
    fs.writeFileSync(path.join(OUT, svgDl.name), svgDl.text);
    const t = svgDl.text;
    const count = (re) => (t.match(re) || []).length;
    row('F-81', `Download SVG -> ${svgDl.name} (${t.length} bytes): <line>=${count(/<line\b/g)} <circle>=${count(/<circle\b/g)} <path>=${count(/<path\b/g)} <text>=${count(/<text\b/g)} dashed=${count(/stroke-dasharray/g)} width/height/viewBox=${JSON.stringify((t.match(/<svg[^>]*>/) || [''])[0].slice(0, 220))} toasts=${JSON.stringify(await k.toasts())}`);
    row('F-81a', `SVG carries dimensions / patterns / groups / params? ids=${JSON.stringify((t.match(/ id="[^"]+"/g) || []).slice(0, 6))} has <g>=${/<g\b/.test(t)} mentions "plate_w"=${/plate_w/.test(t)} units in file: ${JSON.stringify((t.match(/(width|height)="[^"]*"/g) || []).slice(0, 2))}`);
    // re-import our own SVG
    await k.open('sketchstudio');
    fs.writeFileSync(path.join(k.dl, 'own.svg'), t);
    await importViaMenu(k.cdp, path.join(k.dl, 'own.svg')); await sleep(1600);
    const re = await read();
    row('F-82', `re-import our own SVG: ${kinds(re)} (original ${kinds(orig)}) bbox=${JSON.stringify(solidBox(re))} (original ${JSON.stringify(solidBox(orig))}) construction=${re.filter((s) => s.dash).length} (original ${orig.filter((s) => s.dash).length}) toasts=${JSON.stringify(await k.toasts())}`);
    await k.shotFull('F82-svg-reimport.png').then((e) => row('F-82e', 'evidence ' + e));
  }

  // DXF out
  await k.open('sketchstudio');
  await k.menu('open-file'); await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'dlg');
  await k.chooseFile(path.join(FIX_DIR, 'rich.sketch.json')); await sleep(1300);
  const n1 = k.downloads.length;
  await k.menu('download-dxf');
  const dxfDl = await k.waitDownload(n1 + 1, 'dxf', 6000);
  if (!dxfDl) row('F-83', `Download DXF: no file; toasts=${JSON.stringify(await k.toasts())}`);
  else {
    fs.writeFileSync(path.join(OUT, dxfDl.name), dxfDl.text);
    const t = dxfDl.text;
    const ent = {}; const lines = t.split(/\r?\n/); for (let i = 0; i < lines.length - 1; i++) if (lines[i].trim() === '0' && /^(LINE|CIRCLE|ARC|LWPOLYLINE|POLYLINE|SPLINE|TEXT|INSERT|POINT)$/.test(lines[i + 1].trim())) ent[lines[i + 1].trim()] = (ent[lines[i + 1].trim()] || 0) + 1;
    const ins = (t.match(/\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*(\d+)/) || [])[1];
    row('F-83', `Download DXF -> ${dxfDl.name} (${t.length} bytes): entities=${JSON.stringify(ent)} $INSUNITS=${ins === undefined ? 'absent' : ins} layers/linetypes: DASHED=${/DASHED/.test(t)} toasts=${JSON.stringify(await k.toasts())}`);
    await k.open('sketchstudio');
    fs.writeFileSync(path.join(k.dl, 'own.dxf'), t);
    await importViaMenu(k.cdp, path.join(k.dl, 'own.dxf')); await sleep(1600);
    const re = await read();
    row('F-84', `re-import our own DXF: ${kinds(re)} (original ${kinds(orig)}) bbox=${JSON.stringify(solidBox(re))} (original ${JSON.stringify(solidBox(orig))}) construction=${re.filter((s) => s.dash).length} (original ${orig.filter((s) => s.dash).length}) toasts=${JSON.stringify(await k.toasts())}`);
    // orientation: DXF is Y-up: compare the Y of the first line before / after
    row('F-84a', `orientation check, first 3 lines original ${JSON.stringify(orig.filter((s) => s.t === 'line').slice(0, 3).map((s) => [r2(s.x1), r2(s.y1), r2(s.x2), r2(s.y2)]))} vs re-imported ${JSON.stringify(re.filter((s) => s.t === 'line').slice(0, 3).map((s) => [r2(s.x1), r2(s.y1), r2(s.x2), r2(s.y2)]))}`);
    await k.shotFull('F84-dxf-reimport.png').then((e) => row('F-84e', 'evidence ' + e));
  }

  // inch document export: the setting changes the numbers written?
  await k.open('sketchstudio');
  await k.menu('open-file'); await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'dlg');
  await k.chooseFile(path.join(FIX_DIR, 'rich.sketch.json')); await sleep(1300);
  await k.setting('DOC_UNIT', 'in'); await sleep(300);
  const n2 = k.downloads.length;
  await k.menu('download-svg');
  const inSvg = await k.waitDownload(n2 + 1, 'svg-in', 6000);
  const mmSvg = k.downloads.find((d) => d.name === (svgDl && svgDl.name)) || svgDl;
  row('F-85', `Download SVG with the device unit set to inches: header=${inSvg ? JSON.stringify((inSvg.text.match(/<svg[^>]*>/) || [''])[0].slice(0, 220)) : 'none'} vs mm header=${mmSvg ? JSON.stringify((mmSvg.text.match(/<svg[^>]*>/) || [''])[0].slice(0, 220)) : 'none'}; same body=${inSvg && mmSvg ? inSvg.text === mmSvg.text : '-'}`);
  await k.setting('DOC_UNIT', 'mm');

  // Export... panel: file name, type, precision with a name that is odd
  await k.menu('export'); await sleep(600);
  row('F-86', `Export... entry opens the Export view: panel visible=${await k.evalJs(`(() => { const p = document.getElementById('export-panel'); return !!p && p.getBoundingClientRect().height > 0; })()`)} fields=${JSON.stringify(await k.evalJs(`[...document.querySelectorAll('#export-panel input, #export-panel select')].map((e) => (e.id || e.name || e.type) + '=' + e.value).slice(0, 12)`))}`);
  await k.shotFull('F86-export-view.png').then((e) => row('F-86e', 'evidence ' + e));
} finally {
  console.log(`BLOCKED non-local requests: ${k.net.blocked().length}`);
  await k.close();
}
