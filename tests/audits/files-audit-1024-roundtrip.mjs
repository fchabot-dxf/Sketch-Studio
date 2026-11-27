// tests/audits/files-audit-1024-roundtrip.mjs — TASK 1024 (AUDIT ONLY): Save / Open / Save As / New / Close round trip of a design holding every kind of state.
// Run: node tests/audits/files-audit-1024-roundtrip.mjs      Rows F-01 .. F-19
import fs from 'node:fs';
import path from 'node:path';
import { startKit, row, diffJson, summariseDiff, FIX_DIR, sleep } from './files-audit-1024-kit.js';
import { buildRich } from './files-audit-1024-fixture.js';
import { parseProjectFile } from '../../packages/ui/project-file.js';

const input = JSON.parse(fs.readFileSync(path.join(FIX_DIR, 'rich.sketch.json'), 'utf8'));
const inDoc = input.document;
const k = await startKit({ tag: '1024-rt' });
const kinds = (doc) => { const o = {}; for (const s of doc.geometry.shapes) o[s.type] = (o[s.type] || 0) + 1; return JSON.stringify(o); };
const ctypes = (doc) => { const o = {}; for (const c of doc.geometry.constraints) o[c.type] = (o[c.type] || 0) + 1; return JSON.stringify(o); };
const fieldDiff = (a, b) => {
  const d = diffJson(a.geometry, b.geometry, 'geometry', [], 1e-6);
  return d;
};
try {
  await k.open('sketchstudio');
  row('F-01', `fixture built with the tools: ${kinds(inDoc)} constraints ${ctypes(inDoc)} groups=${(inDoc.geometry.groups || []).length} params=${(inDoc.geometry.parameters || []).length} sketches=${(inDoc.geometry.sketches || []).length}`);

  // ---- open the file through Open... > Local > Choose a file
  const abs = path.join(FIX_DIR, 'rich.sketch.json');
  await k.menu('open-file');
  await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'the Open dialog');
  const dlg0 = await k.dialog();
  const ok = await k.chooseFile(abs);
  await k.waitFor(`document.querySelectorAll('.sk-doctab').length >= 1 && /Rich 1024/.test(document.querySelector('.sk-doctab.active .sk-doctab-name').textContent)`, 'the file opened as a tab').catch(() => {});
  await sleep(900);
  let act = await k.active();
  const toastsOpen = await k.toasts();
  const nShapes = await k.shapes();
  row('F-02', `Open > Local > Choose a file (dialog opened on tab "${dlg0 && dlg0.tab}"): chooser=${ok} active tab=${JSON.stringify(act)} drawn shapes on canvas=${nShapes} (file has ${inDoc.geometry.shapes.length}) toasts=${JSON.stringify(toastsOpen)}`);
  row('F-02b', `dirty dot right after opening, untouched: ${act ? act.dot : 'no tab'} (expected false: nothing was edited)`);
  await k.shotFull('F02-after-open.png').then((e) => row('F-02e', 'evidence ' + e));

  // ---- Save as > Local, read the download, diff against the input
  await k.menu('save-as');
  await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'Save as dialog');
  const sd = await k.dialog();
  row('F-04a', `Save as dialog on a file-home design: name prefilled "${sd && sd.name}", tab ${sd && sd.tab}`);
  await evalSelect(k);
  await k.typeText('RT one'); await k.enter();
  const f1 = await k.waitDownload(1, 'save as');
  if (!f1) row('F-04', 'BUG? no download after Save as > Local > Enter');
  else {
    fs.writeFileSync(path.join(path.resolve(FIX_DIR, '..', '..', '..', '.evidence', '1024'), 'F04-saved-RT-one.sketch.json'), f1.text);
    const pf = parseProjectFile(f1.text);
    const d = fieldDiff(inDoc, pf.document);
    row('F-04', `Save as Local "RT one" -> ${f1.name} (${f1.text.length} bytes) app=${pf.app} name="${pf.name}" document diff vs original: ${summariseDiff(d, 14)}`);
    row('F-04c', `held types after save: ${kinds(pf.document)} | constraints ${ctypes(pf.document)}`);
    const dh = diffJson(inDoc.hosts || {}, pf.document.hosts || {}, 'hosts');
    row('F-04d', `hosts sidecar: input ${JSON.stringify(inDoc.hosts)} -> saved ${JSON.stringify(pf.document.hosts)} (${dh.length} diffs); version in=${inDoc.version} out=${pf.document.version}`);
    // exact order / bytes of the second serialisation: open the downloaded file, save again, compare TEXT
    fs.writeFileSync(path.join(k.dl, 'RT-one-reopen.sketch.json'), f1.text);
    await k.menu('open-file');
    await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'Open dialog 2');
    await k.chooseFile(path.join(k.dl, 'RT-one-reopen.sketch.json'));
    await sleep(1200);
    row('F-05a', `reopened our own saved file as a tab: tabs=${JSON.stringify((await k.tabs()).map((t) => t.name))} shapes=${await k.shapes()} toasts=${JSON.stringify(await k.toasts())}`);
    await k.menu('save-as');
    await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'Save as dialog 2');
    await evalSelect(k); await k.typeText('RT two'); await k.enter();
    const f2 = await k.waitDownload(2, 'save as 2');
    if (f2) {
      const a = JSON.parse(f1.text), b = JSON.parse(f2.text);
      a.name = b.name = 'x';
      const same = JSON.stringify(a.document) === JSON.stringify(b.document);
      const ta = JSON.stringify(JSON.parse(f1.text).document), tb2 = JSON.stringify(JSON.parse(f2.text).document);
      let at = 0; while (at < ta.length && ta[at] === tb2[at]) at++;
      row('F-05c', `first differing character at ${at} of ${ta.length}/${tb2.length}: A=...${ta.slice(Math.max(0, at - 60), at + 80)} | B=...${tb2.slice(Math.max(0, at - 60), at + 80)}`);
      row('F-05', `open our own file -> Save as again: documents byte-identical (same key order, same numbers)=${same}; ${summariseDiff(diffJson(a.document, b.document, 'doc', [], 0), 8)}`);
    } else row('F-05', 'no second download');
  }

  // ---- Ctrl+S on a file home with an edit
  await k.drawLine('svgCanvas', 0.75);
  await sleep(300);
  let a2 = await k.active();
  row('F-06a', `after one more line: active ${JSON.stringify(a2)}`);
  const n0 = k.downloads.length;
  await k.ctrlS();
  const f3 = await k.waitDownload(n0 + 1, 'ctrl+s');
  await sleep(500);
  a2 = await k.active();
  row('F-06', `Ctrl+S on a file-home tab: download=${f3 ? f3.name : 'NONE'} dialog open=${!!(await k.dialog())} dot after=${a2 && a2.dot} (file shapes=${f3 ? JSON.parse(f3.text).document.geometry.shapes.length : '-'} vs ${await k.shapes()} on canvas)`);

  // ---- reload with the tabs open: the buffer (name only for files)
  const before = await k.tabs();
  await k.reload('sketchstudio');
  const after = await k.tabs();
  row('F-07', `reload with ${before.length} tabs: before=${JSON.stringify(before.map((t) => [t.name, t.home, t.dot]))} after=${JSON.stringify(after.map((t) => [t.name, t.home, t.dot]))}`);
  const buf2 = await k.buffer();
  const tb = buf2 && buf2.tabs.find((t) => t.name === 'RT one');
  row('F-07b', `buffer doc after reload vs the original file: ${tb ? summariseDiff(fieldDiff(inDoc, tb.doc), 10) : 'tab RT one missing in the buffer: ' + JSON.stringify(buf2 && buf2.tabs.map((t) => t.name))}`);

  // ---- inch units: is the document unit part of the file?
  const unitBefore = await k.readSetting('DOC_UNIT');
  await k.setting('DOC_UNIT', 'in');
  await sleep(300);
  await k.menu('save-as');
  await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'Save as dialog 3');
  await evalSelect(k); await k.typeText('RT inch'); await k.enter();
  const n1 = k.downloads.length;
  const f4 = await k.waitDownload(Math.max(n1, k.downloads.length) , 'inch save', 6000);
  const last = k.downloads[k.downloads.length - 1];
  const hasUnit = last ? /"(docUnit|unit|units)"\s*:\s*"(in|mm|cm)"/.test(JSON.stringify(JSON.parse(last.text).document.hosts) + JSON.stringify(JSON.parse(last.text).format) ) : null;
  row('F-08', `inch units: device setting DOC_UNIT was ${unitBefore}, set to in, saved "${last && last.name}": file mentions a unit field=${hasUnit}; hosts=${last ? JSON.stringify(JSON.parse(last.text).document.hosts) : '-'}; dimension labels on canvas now ${JSON.stringify(await k.evalJs(`[...document.querySelectorAll('.dim-label text')].slice(0,6).map((t) => t.textContent)`))}`);
  await k.setting('DOC_UNIT', 'mm');
  await sleep(200);
  row('F-08b', `same file, unit back to mm: dimension labels ${JSON.stringify(await k.evalJs(`[...document.querySelectorAll('.dim-label text')].slice(0,6).map((t) => t.textContent)`))} (the unit is a per-device setting, not stored in the document: an inch design opens in whatever unit the device has)`);
  // ---- the opened file tab and a reload (run last: a reload loses this tab)
  await k.open('sketchstudio');
  await k.menu('open-file'); await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'open dlg');
  await k.chooseFile(abs); await sleep(1200);
  row('F-03a', `a file just opened, nothing edited: tabs=${JSON.stringify((await k.tabs()).map((t) => [t.name, t.home, t.dot]))} shapes=${await k.shapes()}`);
  await k.flush();
  const buf1 = await k.buffer();
  row('F-03', `shared buffer right after Open (nothing edited), after pagehide flush: ${JSON.stringify(buf1 && buf1.tabs.map((t) => [t.key, t.name, !!t.doc]))}`);
  await k.reload('sketchstudio');
  const tAfter = await k.tabs();
  row('F-03b', `reload right after Open: tabs=${JSON.stringify(tAfter.map((t) => [t.name, t.home, t.dot]))} shapes=${await k.shapes()} (the file had ${inDoc.geometry.shapes.length}) toasts=${JSON.stringify(await k.toasts())}`);

} finally {
  console.log(`BLOCKED non-local requests: ${k.net.blocked().length} ${JSON.stringify([...new Set(k.net.blocked().map((u) => new URL(u).host))])}`);
  await k.close();
}
async function evalSelect(kk) { await kk.evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`); }
