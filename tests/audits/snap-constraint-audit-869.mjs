// tests/audits/snap-constraint-audit-869.mjs -- TASK 869: an AUDIT TOOL OUTSIDE THE GATE (scripts/gate.cjs finds only *.test.js in tests/,
// packages/core/tests and tests/harness; a full run takes 10 - 12 minutes, past the gate's 90 s per-file limit). Run it by hand:
//   node tests/audits/snap-constraint-audit-869.mjs
// It prints one line per cell of the snap / pick matrix of the shared Design tab and EXITS 0 whatever the cells say (the known-bad cells are
// reported, not failed; the owner may turn cells into assertions later). It fails only when it cannot run (no fixture, a page error).
// The family audited (owner turn 3382): a snap or a pick the app DETECTS whose constraint is never APPLIED (the Rectangle's first corner,
// task 867), or a tool that ends without doing what its picks asked and without a word (the Coincident tool, a point then a line, task 868).
// The real SketchStudio, headless, desktop 1600 x 900, REAL mouse and keys through CDP. The fixture is drawn with the real tools (a line, a
// circle, an arc, a construction line, a rectangle and its Offset, a slanted line, a line and a rectangle to drag), at a user's scale (2 - 3.5
// px per mm, the wheel). The cells (tests/audits/snap-constraint-audit-869-cells.js):
//   1. every drawing tool x every point it places x every snap target kind: the snap marker on hover, the placed point ON the target (screen
//      px) and a constraint holding it there (coincident / pointOnLine / midpoint), the Line tool being the reference;
//   2. every constraint tool x pick pairs (both orders, a rectangle corner, an offset-made line, an axis, some pairs that are not valid):
//      is the constraint made, and if not, is the user told (a notice) or does the tool end silently;
//   3. the Select tool dragging a free line end / a rectangle corner onto each target: the constraint on release.
// Each line: CELL <section> <tool> <point> x <target>: PASS | FAIL-NOSNAP | FAIL-NOCONSTRAINT | FAIL-SILENT | FAIL-OFFTARGET d=<px> ...
// (constraint cells: PASS | REFUSED-TOLD | PASS-TOLD | FAIL-SILENT). Between cells the design goes back to the fixture (Esc, Undo; a reload
// of the fixture if Undo did not bring it back exactly).
// AUDIT_869_ONLY=<regexp> runs the cells whose name matches (e.g. 'constraint coincident', 'draw rect'); AUDIT_869_EVIDENCE=<dir> saves the
// three representative screenshots of docs/SNAP-CONSTRAINT-AUDIT-869.md and the rows as JSON there.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from '../helpers/cdp-browser.js';
import { installFakeDriveSession } from '../helpers/fake-drive-session.js';
import { CREATE_NAMED_DESIGN } from '../helpers/named-design.js';
import { buildFixture, runMatrix } from './snap-constraint-audit-869-cells.js';

const ONLY = process.env.AUDIT_869_ONLY ? new RegExp(process.env.AUDIT_869_ONLY) : null;
const EVIDENCE = process.env.AUDIT_869_EVIDENCE || null;
// the three representative failures photographed (docs/SNAP-CONSTRAINT-AUDIT-869.md)
const SHOTS = { 'draw circle rim x joint': 'circle-rim-on-joint', 'draw polygon vertex x midspan': 'polygon-vertex-on-line', 'constraint hv SL': 'hv-tool-on-slanted-line' };

await (async () => {
  const cdp = await launchBrowser({ tag: '869', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, navigate, waitForApp, flushAutosave } = cdp;
  await installFakeDriveSession(cdp);
  const t0 = Date.now();
  try {
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const open = async () => { await navigate(url, 10000); await waitForApp('svgCanvas'); await sleep(500); };
    // a clean profile with no grid magnet (a free click lands where it is, as tests/drag-target-release-live.test.js), then a NAMED design (task 558: only it is stored)
    await open();
    await evalJs(`(async () => { localStorage.clear(); localStorage.setItem('sketch-studio-settings', JSON.stringify({ GRID_MAGNETISM: 0.001 })); const dbs = indexedDB.databases ? await indexedDB.databases() : []; await Promise.all(dbs.map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); }))); return true; })()`);
    await open();
    await evalJs(CREATE_NAMED_DESIGN('sketchstudio', 'Audit 869'));
    await open();

    let m = null, inv = null;
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const centreOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);
    const frames = (n = 2) => evalJs(`new Promise(r => { let k = ${n}; const f = () => (--k > 0 ? requestAnimationFrame(f) : r(true)); requestAnimationFrame(f); })`);
    const pressAt = async (p) => { await mouse('mouseMoved', p.x, p.y); await sleep(20); await mouse('mousePressed', p.x, p.y, 1); await sleep(20); await mouse('mouseReleased', p.x, p.y); await sleep(80); };
    const KEYS = { Escape: ['Escape', 27], Enter: ['Enter', 13], k: ['KeyK', 75, 'k'], z: ['KeyZ', 90] };
    const d = {
      async view() {
        m = await evalJs(`(() => { const e = document.querySelector('#svgCanvas .shape-elem') || document.querySelector('#svgCanvas'); const k = e.getScreenCTM(); return [k.a, k.b, k.c, k.d, k.e, k.f]; })()`);
        const det = m[0] * m[3] - m[1] * m[2];
        inv = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
      },
      S: (x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }),
      W: (sx, sy) => { const u = sx - m[4], v = sy - m[5]; return { x: inv[0] * u + inv[2] * v, y: inv[1] * u + inv[3] * v }; },
      canvas: () => d._cv,
      onCanvas: (pts) => evalJs(`${JSON.stringify(pts)}.map((p) => { const e = document.elementFromPoint(p.x, p.y); return !!e && !!e.closest('#svgCanvas'); })`),
      async move(x, y, o = {}) { await mouse('mouseMoved', x, y, o.buttons || 0); await sleep(12); },
      async down(x, y) { await mouse('mousePressed', x, y, 1); await sleep(25); },
      async up(x, y) { await mouse('mouseReleased', x, y, 0); await sleep(60); },
      async click(x, y) { await mouse('mouseMoved', x, y); await sleep(25); await mouse('mousePressed', x, y, 1); await sleep(25); await mouse('mouseReleased', x, y); await sleep(70); },
      async wheel(x, y, deltaY) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); await sleep(40); },
      async key(k, mods = {}) { const [code, vk, text] = KEYS[k] || [k, 0]; await sendRealKey(send, code === 'KeyK' || code === 'KeyZ' ? k : code, code, vk, mods.ctrl ? 2 : 0, mods.ctrl ? '' : (text || '')); await sleep(60); },
      async tool(name, mode) {
        let b = await centreOf('#tool-' + name);
        if (!b) { // not in the bar: from its section's dropdown (TASK 647)
          await pressAt(await centreOf(`.sk-ribbon-group:has(#tool-${name}) .sk-ribbon-group-label`)); b = await centreOf(`.sk-ribbon-sect-menu.show [data-id="tool-${name}"]`);
        }
        await pressAt(b);
        if (mode) await pressAt(await centreOf(`.sk-ribbon-menu.show [data-mode="${mode}"]`));
        await mouse('mouseMoved', d._cv.left + 5, d._cv.top + 5); await sleep(30);
      },
      async typeInto(sel, text) { await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select(); })()`); await send('Input.insertText', { text }); await sleep(150); },
      async pressEl(sel) { await pressAt(await centreOf(sel)); await sleep(150); },
      async doc() {
        await flushAutosave();
        const full = await evalJs(`import('/packages/ui/project-store.js').then(async (m) => JSON.stringify((await m.getProjectStore().loadCurrent()).document))`).then(JSON.parse);
        return { joints: full.geometry.joints, shapes: full.geometry.shapes, constraints: full.geometry.constraints, full };
      },
      async markers() {
        await frames(2);
        return evalJs(`(() => { const svg = document.querySelector('#svgCanvas'); const out = [];
          const at = (e, x, y) => { const k = e.getScreenCTM(); return { x: k.a * x + k.c * y + k.e, y: k.b * x + k.d * y + k.f }; };
          for (const e of svg.querySelectorAll('circle')) if (/1e40af/i.test(e.getAttribute('style') || '') && +e.getAttribute('stroke-width') > 0) out.push({ kind: 'ring', ...at(e, +e.getAttribute('cx'), +e.getAttribute('cy')) });
          for (const e of svg.querySelectorAll('rect[transform]')) { const t = /rotate\\(45 ([-\\d.e]+) ([-\\d.e]+)\\)/.exec(e.getAttribute('transform') || ''); if (t && /2563eb/i.test(e.getAttribute('style') || '')) out.push({ kind: 'diamond', ...at(e, +t[1], +t[2]) }); }
          for (const e of svg.querySelectorAll('line[data-snap-axis]')) out.push({ kind: e.dataset.snapAxis, x: 0, y: 0 });
          return out; })()`);
      },
      async markNotices() { await evalJs(`document.querySelectorAll('#notification-container > div').forEach((e) => { e.dataset.audit869 = 'seen'; })`); },
      async newNotices() { await sleep(60); return evalJs(`[...document.querySelectorAll('#notification-container > div')].filter((e) => !e.dataset.audit869).map((e) => { e.dataset.audit869 = 'seen'; return e.textContent.trim().slice(0, 160); })`); },
      async currentTool() { return evalJs(`(() => { const b = document.querySelector('.sk-ribbon-btn.active[data-tool]'); return b ? b.dataset.tool : null; })()`); },
      async restore(doc) {
        await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const n = await s.newDesign('Audit 869 fixture', { app: 'sketchstudio' }); await s.save(${JSON.stringify(doc.full)}, { app: 'sketchstudio', id: n.id }); return n.id; })`);
        await open(); await d.view();
      },
      async afterCell(name, focus) {
        if (!EVIDENCE || !SHOTS[name]) return;
        await frames(3);
        const clip = { x: Math.max(0, focus.x - 170), y: Math.max(0, focus.y - 110), width: 340, height: 220, scale: 3 };
        const shot = await send('Page.captureScreenshot', { format: 'png', clip });
        fs.mkdirSync(EVIDENCE, { recursive: true });
        fs.writeFileSync(path.join(EVIDENCE, SHOTS[name] + '.png'), Buffer.from(shot.data, 'base64'));
      },
    };
    d._cv = await evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);

    const fix = await buildFixture(d);
    await d.view();
    console.log(`fixture: ${fix.joints.length} joints, ${fix.shapes.length} shapes, ${fix.constraints.length} constraints, ${Math.hypot(d.S(1, 0).x - d.S(0, 0).x, d.S(1, 0).y - d.S(0, 0).y).toFixed(3)} px per mm`);
    const rows = await runMatrix(d, { only: ONLY });
    const by = {}; for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
    console.log(`AUDIT 869: ${rows.length} cells ${JSON.stringify(by)} (${((Date.now() - t0) / 1000).toFixed(0)} s; reloads ${rows.filter((r) => r.revert === 'reload').length})`);
    if (EVIDENCE) { fs.mkdirSync(EVIDENCE, { recursive: true }); fs.writeFileSync(path.join(EVIDENCE, `rows-live${ONLY ? '-' + process.env.AUDIT_869_ONLY.replace(/[^a-z0-9]+/gi, '_').slice(0, 40) : ''}.json`), JSON.stringify(rows, null, 1)); }
    console.log('snap-constraint-audit-869.mjs: audit printed (exit 0 whatever the cells say)');
  } finally { await cdp.close(); }
})();
