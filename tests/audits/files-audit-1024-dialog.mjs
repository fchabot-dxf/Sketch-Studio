// tests/audits/files-audit-1024-dialog.mjs — TASK 1024 (AUDIT ONLY): the Save as / Open dialog (keyboard, Esc, long / odd / duplicate names, cancel, refusals, Drive tab on the FAKE session, phone 390).
// Run: node tests/audits/files-audit-1024-dialog.mjs      Rows F-90 .. F-119
import fs from 'node:fs';
import path from 'node:path';
import { startKit, row, sleep, FIX_DIR } from './files-audit-1024-kit.js';

const k = await startKit({ tag: '1024-dlg', signedIn: false });
const fx = (n) => path.join(FIX_DIR, n);
const selectName = () => k.evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
const openSave = async () => { await k.menu('save-as'); await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'save dialog'); };
const openOpen = async () => { await k.menu('open-file'); await k.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'open dialog'); };
const gone = () => k.evalJs(`!document.querySelector('.sk-fd')`);
try {
  await k.open('sketchstudio');
  await k.drawLine('svgCanvas', 0.4);

  // ---- keyboard / Esc / outside press / cancel
  await openSave();
  let d = await k.dialog();
  row('F-90', `Save as opens: tab=${d.tab} name="${d.name}" focus=${d.focus} tabs=${JSON.stringify(d.tabs)} buttons=${JSON.stringify(d.buttons)}`);
  await k.shot('F90-save-as.png', '.sk-fd').then((e) => e && row('F-90e', 'evidence ' + e));
  await k.esc(); await sleep(300);
  row('F-91', `Esc closes the Save as dialog: ${await gone()} (tabs after: ${JSON.stringify((await k.tabs()).map((t) => t.name))}, downloads=${k.downloads.length})`);
  await openSave();
  await k.click(5, 400); await sleep(300); // a press outside (left edge of the page, under the backdrop)
  row('F-92', `press outside the dialog: closed=${await gone()}`);
  await openSave(); await k.press('.sk-fd [data-choice="__cancel"]'); await sleep(300);
  row('F-93', `Cancel button: closed=${await gone()} downloads=${k.downloads.length} tab=${JSON.stringify((await k.tabs()).map((t) => t.name))}`);
  // arrows on the tab buttons
  await openSave();
  await k.evalJs(`document.querySelector('.sk-fd [data-fd-tab="local"]').focus()`);
  await k.key('ArrowLeft'); await sleep(200);
  row('F-95', `ArrowLeft on the Local tab: dialog tab=${(await k.dialog()).tab} (expected drive); the choice is remembered: setting FILE_DIALOG_TAB=${await k.readSetting('FILE_DIALOG_TAB')}`);
  await k.key('ArrowRight'); await sleep(150); await k.esc(); await sleep(300);

  // ---- names
  const cases = [
    ['empty', ''],
    ['whitespace', '   '],
    ['long-200', 'L'.repeat(200)],
    ['illegal', 'a/b\\c:d*e?f"g<h>i|j'],
    ['dots-only', '...'],
    ['leading-dot-and-space', ' .hidden name '],
    ['emoji-unicode', 'Sketch ☃ café \u{1F600}'],
    ['reserved-windows', 'CON'],
    ['has-extension', 'plate.sketch.json'],
  ];
  let nth = 0;
  for (const [label, name] of cases) {
    await openSave(); await selectName();
    if (name) await k.typeText(name); else await k.key('Delete');
    if (!name) await k.evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    if (label === 'whitespace') await k.evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.value = '   '; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const n0 = k.downloads.length;
    await k.enter();
    const dl = await k.waitDownload(n0 + 1, label, 2500);
    const dd = await k.dialog();
    const tab = await k.active();
    row(`F-96.${++nth}`, `name case "${label}" (${JSON.stringify(name.length > 40 ? name.slice(0, 20) + '...(' + name.length + ' chars)' : name)}): download=${dl ? JSON.stringify(dl.name.length > 60 ? dl.name.slice(0, 30) + '...(' + dl.name.length + ' chars)' : dl.name) : 'none'} dialog still open=${!!dd} err=${JSON.stringify(dd && dd.err)} active tab name=${JSON.stringify(tab && (tab.name.length > 40 ? tab.name.slice(0, 20) + '...(' + tab.name.length + ' chars)' : tab.name))} home=${tab && tab.home}`);
    if (dd) { await k.esc(); await sleep(250); }
    if (label === 'long-200') await k.shotFull('F96-long-name-tab.png').then((e) => row('F-96e', 'evidence ' + e));
  }

  // Tab key: focus trap
  await openSave(); const seen = [];
  for (let i = 0; i < 9; i++) { await k.key('Tab'); seen.push(await k.evalJs(`(() => { const a = document.activeElement; return a ? (a.closest('.sk-fd') ? 'in:' : 'OUT:') + (a.dataset && (a.dataset.fdTab || a.dataset.choice || a.dataset.fd) || a.className || a.tagName) : null; })()`)); }
  row('F-94', `Tab x9 inside the dialog: focus path=${JSON.stringify(seen)} (expected: never leaves the dialog)`);
  await k.esc(); await sleep(300);
  row('F-94b', `Esc while the focus is OUTSIDE the dialog (after Tab left it): dialog closed=${await gone()}`);
  if (!(await gone())) { await k.evalJs(`document.querySelector('.sk-fd [data-choice="__cancel"]').click()`); await sleep(300); }
  await k.open('sketchstudio'); await k.drawLine('svgCanvas', 0.4);
  // ---- duplicate local names: Save as the same name twice (a different design, same name)
  await k.open('sketchstudio');
  await k.drawLine('svgCanvas', 0.4);
  await openSave(); await selectName(); await k.typeText('Same name'); await k.enter();
  const nA = k.downloads.length; await k.waitDownload(nA + 1, 'dup1', 2500); await sleep(500);
  await k.press('.sk-doctab-new'); await k.waitFor(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`, 'm'); await k.press('.sk-tp-card[data-template="blank"]'); await sleep(500);
  await k.drawLine('svgCanvas', 0.7);
  await openSave(); await selectName(); await k.typeText('Same name'); await k.enter();
  const n2 = k.downloads.length; const dup = await k.waitDownload(n2 + 1, 'dup2', 2500); await sleep(600);
  row('F-97', `duplicate local names: two different designs saved as "Same name": downloads=${JSON.stringify(k.downloads.map((x) => x.name))}; any overwrite question=${JSON.stringify((await k.dialog()) && (await k.dialog()).confirm)}; tabs=${JSON.stringify((await k.tabs()).map((t) => [t.name, t.home]))} (the browser, not the app, decides what a second download of one name becomes: with no File System Access API there is no overwrite warning)`);

  // ---- Open the same file twice
  await openOpen(); await k.chooseFile(fx('rich.sketch.json')); await sleep(1200);
  await openOpen(); await k.chooseFile(fx('rich.sketch.json')); await sleep(1200);
  row('F-98', `Open the same file twice: tabs=${JSON.stringify((await k.tabs()).map((t) => [t.name, t.home, t.active ? 'A' : '']))} (two independent copies of one file; ordinary desktop apps focus the already-open document (unverified))`);

  // ---- refusals
  for (const [id, f, what] of [['F-99', 'not-json.sketch.json', 'not JSON'], ['F-100', 'wrong-format.sketch.json', 'another JSON format'], ['F-101', 'newer-envelope.sketch.json', 'newer envelope version'], ['F-102', 'newer-document.sketch.json', 'newer document version'], ['F-103', 'damaged-document.sketch.json', 'document without a version'], ['F-104', 'empty.sketch.json', 'an empty file'], ['F-105', 'dangling-refs.sketch.json', 'constraint and shape naming a missing joint']]) {
    const before = (await k.tabs()).length;
    await openOpen(); await k.chooseFile(fx(f)); await sleep(1000);
    const dd = await k.dialog(); const toasts = await k.toasts();
    const after = await k.tabs();
    row(id, `Open ${what} (${f}): dialog open=${!!dd} dialog error=${JSON.stringify(dd && dd.err)} toasts=${JSON.stringify(toasts)} tabs ${before}->${after.length} active=${JSON.stringify(after.find((t) => t.active) && after.find((t) => t.active).name)} shapes=${await k.shapes()}`);
    if (dd) { await k.shot(`${id}-dialog.png`, '.sk-fd').then((e) => e && row(id + 'e', 'evidence ' + e)); await k.esc(); await sleep(300); }
    await k.clearToasts();
  }
  // a dropped non-project file / svg opened with Open
  await openOpen(); fs.writeFileSync(path.join(k.dl, 'plain.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10"/></svg>');
  await k.chooseFile(path.join(k.dl, 'plain.svg')); await sleep(1000);
  const dd2 = await k.dialog();
  row('F-106', `Open dialog given a .svg: dialog err=${JSON.stringify(dd2 && dd2.err)} toasts=${JSON.stringify(await k.toasts())} tabs=${JSON.stringify((await k.tabs()).map((t) => t.name))}`);
  if (dd2) { await k.esc(); await sleep(300); }

  // ---- Drive tab on the FAKE session (signed out first: the sign-in button inside the tab)
  await k.open('sketchstudio'); await k.drawLine('svgCanvas', 0.4);
  await openSave(); await k.press('.sk-fd [data-fd-tab="drive"]'); await sleep(400);
  d = await k.dialog();
  row('F-107', `signed out, Drive tab: buttons=${JSON.stringify(d.buttons)} name field shown=${await k.evalJs(`!!document.querySelector('.sk-fd-name') && document.querySelector('.sk-fd-name').offsetParent !== null`)} (a Save with nowhere to go is not offered)`);
  await k.esc(); await sleep(300);
  console.log('BLOCKED non-local requests (signed-out phase):', k.net.blocked().length, JSON.stringify([...new Set(k.net.blocked().map((u) => new URL(u).host))]));
} finally {
  await k.close();
}

// ================= signed-in fake Drive, then phone 390 =================
const k2 = await startKit({ tag: '1024-dlg2', signedIn: true });
try {
  await k2.open('sketchstudio'); await k2.drawLine('svgCanvas', 0.4);
  const sel = () => k2.evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`);
  await k2.menu('save-as'); await k2.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'dlg');
  let d = await k2.dialog();
  row('F-108', `signed in (fake session), Save as: opens on tab=${d.tab} (Drive when ready), destination line=${JSON.stringify(await k2.evalJs(`(document.querySelector('.sk-fd-dest') || {}).textContent`))} buttons=${JSON.stringify(d.buttons)}`);
  await k2.shot('F108-drive-save.png', '.sk-fd').then((e) => e && row('F-108e', 'evidence ' + e));
  await sel(); await k2.typeText('Drive dup'); await k2.enter(); await sleep(1500);
  row('F-109', `Save as to fake Drive "Drive dup": dialog closed=${!(await k2.dialog())} tabs=${JSON.stringify((await k2.tabs()).map((t) => [t.name, t.home, t.dot]))} toasts=${JSON.stringify(await k2.toasts())}`);
  await k2.press('.sk-doctab-new'); await k2.waitFor(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`, 'm'); await k2.press('.sk-tp-card[data-template="blank"]'); await sleep(500);
  await k2.drawLine('svgCanvas', 0.6);
  await k2.menu('save-as'); await k2.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'dlg');
  await sel(); await k2.typeText('Drive dup'); await k2.enter(); await sleep(1500);
  d = await k2.dialog();
  row('F-110', `second DIFFERENT design saved under the SAME Drive name: dialog still open=${!!d} confirm text=${JSON.stringify(d && d.confirm)} buttons=${JSON.stringify(d && d.buttons)} focus=${d && d.focus}`);
  await k2.shot('F110-overwrite.png', '.sk-fd').then((e) => e && row('F-110e', 'evidence ' + e));
  await k2.esc(); await sleep(400);
  row('F-110b', `Esc on the overwrite question: dialog open=${!!(await k2.dialog())}`);
  if (await k2.dialog()) { await k2.press('.sk-fd [data-fd="confirm-cancel"]'); await sleep(300); await k2.esc(); await sleep(300); }
  // Open dialog, Drive tab: lists
  await k2.menu('open-file'); await k2.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'open dlg'); await sleep(1200);
  d = await k2.dialog();
  row('F-111', `Open dialog, signed in: tab=${d.tab} rows=${JSON.stringify(await k2.evalJs(`[...document.querySelectorAll('.sk-fd [data-fd="folder"], .sk-fd [data-fd="design"]')].map((e) => e.textContent.trim())`))}`);
  await k2.shot('F111-drive-open.png', '.sk-fd').then((e) => e && row('F-111e', 'evidence ' + e));
  await k2.esc(); await sleep(300);
  // phone
  await k2.phone(true);
  await k2.open('sketchstudio', { reset: false });
  const fits = async (what) => { const m = await k2.evalJs(`(() => { const dl = document.querySelector('.sk-fd'); if (!dl) return null; const b = dl.getBoundingClientRect(); const t = [...dl.querySelectorAll('[role="tab"], .sk-tp-btn:not([hidden]), input')].filter((e) => e.offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().height)); return { left: Math.round(b.left), right: Math.round(b.right), bottom: Math.round(b.bottom), sw: document.scrollingElement.scrollWidth, vw: innerWidth, vh: innerHeight, minH: Math.min(...t) }; })()`); row('F-112', `phone 390: ${what}: ${JSON.stringify(m)} (fits=${m && m.left >= 0 && m.right <= m.vw && m.sw <= m.vw}; 44px targets=${m && m.minH >= 44})`); };
  await k2.menu('save-as'); await k2.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'dlg'); await sleep(900);
  await fits('Save as (Drive tab, signed in)');
  await k2.shot('F112-phone-save.png', '.sk-fd', 4).then((e) => e && row('F-112e', 'evidence ' + e));
  await k2.press('.sk-fd [data-fd-tab="local"]'); await sleep(300); await fits('Save as (Local tab)');
  await k2.esc(); await sleep(300);
  await k2.menu('open-file'); await k2.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="open"]')`, 'open dlg'); await sleep(1200);
  await fits('Open (Drive tab)');
  await k2.shot('F113-phone-open.png', '.sk-fd', 4).then((e) => e && row('F-113e', 'evidence ' + e));
  await k2.esc(); await sleep(300);
  // phone: long name in the dialog and in the tab
  await k2.menu('save-as'); await k2.waitFor(`!!document.querySelector('.sk-fd[data-file-dialog="save"]')`, 'dlg'); await k2.press('.sk-fd [data-fd-tab="local"]'); await sleep(200);
  await k2.evalJs(`(() => { const i = document.querySelector('.sk-fd input'); i.focus(); i.select(); })()`); await k2.typeText('W'.repeat(60));
  await fits('Save as with a 60-char name typed');
  await k2.press('.sk-fd [data-choice="ok"]'); await sleep(900);
  const tabsP = await k2.evalJs(`(() => { const e = document.querySelector('.sk-doctabs'); return { sw: e.scrollWidth, cw: e.clientWidth, page: document.scrollingElement.scrollWidth, vw: innerWidth }; })()`);
  row('F-114', `phone 390: a 60-char design name in the tab strip: ${JSON.stringify(tabsP)} tabs=${JSON.stringify((await k2.tabs()).map((t) => t.name.length))}`);
  await k2.shotFull('F114-phone-long-name.png').then((e) => row('F-114e', 'evidence ' + e));
  await k2.phone(false);
  console.log('BLOCKED non-local requests (signed-in phase):', k2.net.blocked().length, JSON.stringify([...new Set(k2.net.blocked().map((u) => new URL(u).host))]));
} finally {
  await k2.close();
}
