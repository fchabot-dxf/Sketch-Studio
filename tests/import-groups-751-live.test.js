// tests/import-groups-751-live.test.js — TASK 751 in the REAL apps (headless, REAL mouse / touch / keys via CDP).
//  A. SketchStudio, phone 390 x 844, real touch, a drawn rectangle (no groups): a tap selects one edge; TWO taps a realistic few px apart
//     (7 and 10 px, ~180 ms) select its chain (the owner's "I have to triple click": taps 6-10 px apart were two single taps); a slow second
//     tap stays a tap; touch and hold still opens the menu.
//  B. Shaper desktop 1280 x 800, real mouse: a word of letters (O / A / B with holes, an island in a hole, an open chain, a dot) DROPPED on the
//     page lands grouped: a click on a letter selects the whole FILE group; a drag moves every joint by the same vector (lengths unchanged to
//     1e-6); a double click enters it (the letter, outline + hole); a click selects another letter, a drag moves only it; a double click enters
//     the letter (one curve); a click on empty canvas and Esc step out. The browser lists the groups nested; a row click selects that group.
//     Tool picks with the group NOT entered: Coincident picks a member's point, Dimension a member's line, a Line drawn from a member's corner
//     snaps there; the Select tool on the same spot selects the whole group; a constraint button with a group selected says why it is not used.
//     Ctrl+Shift+G dissolves ONE level; a hand-made group (Ctrl+G) of a rectangle + a circle behaves the same.
//     Fact for the owner: a line drawn onto a corner of a letter (a coincident) and then dragged: before TASK 752 it pulled that corner alone (the
//     letter deformed); since TASK 752 the group is a rigid block: it moves whole or the line gives. Coincident between two points of one block: refused.
//  C. Shaper phone 390 x 844, real touch, the same word imported through the drawer: a tap selects the file group, a touch drag moves it
//     rigidly, a double tap (taps 7 px apart) enters, a tap selects a letter, a drag moves only it, a tap on empty canvas steps out, a hold
//     opens the menu.
//  D. Shaper desktop: a DXF with a spline (a bezier, its control points shape data) dropped and dragged as its file group: every sampled point of
//     the curve moves by the same vector; the arc and the circle keep their radius.
// Screenshots (.evidence/751, local): before / after the moves, the entered state (the rest dimmed), the browser's group rows, the deformed letter.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVID = path.resolve('.evidence/751');
fs.mkdirSync(EVID, { recursive: true });
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="60mm" viewBox="0 0 200 60">
  <path id="O" fill="#000000" d="M10 10 H30 V50 H10 Z M15 15 H25 V45 H15 Z"/>
  <path id="A" fill="#000000" d="M40 50 L50 10 L60 50 Z M47 40 L50 28 L53 40 Z"/>
  <path id="B" fill="#000000" d="M70 10 H90 V50 H70 Z M75 15 H85 V27 H75 Z M75 33 H85 V45 H75 Z"/>
  <path id="T" fill="#000000" d="M100 10 H140 V50 H100 Z M105 15 H135 V45 H105 Z"/>
  <rect id="isl" fill="#7F7F7F" x="112" y="22" width="16" height="16"/>
  <polyline id="tail" points="150,10 160,20 170,10" fill="none" stroke="#7F7F7F"/>
  <circle id="dot" fill="#000000" cx="190" cy="15" r="4"/>
</svg>`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-751-'));
const SVG_FILE = path.join(tmp, 'letters.svg');
fs.writeFileSync(SVG_FILE, SVG);

const J = (x, y) => ({ x, y, fixed: false, sketchId: 'sketch-1' });
const RECT_DOC = { version: 3, hosts: {}, geometry: {
  joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['r1', J(10, 10)], ['r2', J(60, 10)], ['r3', J(60, 40)], ['r4', J(10, 40)]],
  shapes: [['E1', 'r1', 'r2'], ['E2', 'r2', 'r3'], ['E3', 'r3', 'r4'], ['E4', 'r4', 'r1']].map(([id, a, b]) => ({ id, type: 'line', joints: [a, b], sketchId: 'sketch-1', isConstruction: false })),
  constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [] } };

const cdp = await launchBrowser({ tag: '751', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, waitForApp, once } = cdp;
const results = {};
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
const tap = async (p, hold = 70) => { await T('touchStart', [p]); await sleep(hold); await T('touchEnd', []); };
const touchDrag = async (a, b, steps = 14) => { await T('touchStart', [a]); await sleep(60); for (let i = 1; i <= steps; i++) { await T('touchMove', [{ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }]); await sleep(25); } await sleep(80); await T('touchEnd', []); await sleep(400); };
const mouse = (type, x, y, buttons, clickCount = 1, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), modifiers, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
const click = async (p, modifiers = 0) => { await mouse('mouseMoved', p.x, p.y, 0, 0, modifiers); await sleep(60); await mouse('mousePressed', p.x, p.y, 1, 1, modifiers); await sleep(50); await mouse('mouseReleased', p.x, p.y, 0, 1, modifiers); await sleep(650); };
const dblclick = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(50); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(90); await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(50); await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(650); };
const mouseDrag = async (a, b, steps = 16) => { await mouse('mouseMoved', a.x, a.y, 0); await sleep(60); await mouse('mousePressed', a.x, a.y, 1); await sleep(60); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, 1); await sleep(25); } await sleep(100); await mouse('mouseReleased', b.x, b.y, 0); await sleep(500); };
const shot = async (name, clip) => {
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) });
  fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64'));
};

// Shaper: the state (window.__designController, the page's own inspection handle) and world <-> screen through the canvas transform
const ST = `window.__designController.state`;
const toS = (x, y) => evalJs(`(() => { const m = document.querySelector('#design-canvas .shape-elem').getScreenCTM(); const p = new DOMPoint(${x}, ${y}).matrixTransform(m); return { x: p.x, y: p.y }; })()`);
const sel = () => evalJs(`[...${ST}.selectedShapes].sort()`);
const groupIds = (name) => evalJs(`import('/packages/core/group-model.js').then((m) => { const st = ${ST}; const g = st.groups.find((x) => x.name === ${JSON.stringify(name)}); return g ? m.shapesInGroup(st, g.id).sort() : null; })`);
const groupId = (name) => evalJs(`(${ST}.groups.find((x) => x.name === ${JSON.stringify(name)}) || {}).id || null`);
const entered = () => evalJs(`${ST}.enteredGroupId`);
// the screen point at t along a line of group `name` (its k-th line)
const onGroupLine = async (name, k = 0, t = 0.5) => {
  const w = await evalJs(`import('/packages/core/group-model.js').then((m) => { const st = ${ST}; const g = st.groups.find((x) => x.name === ${JSON.stringify(name)}); const ids = m.shapesInGroup(st, g.id); const s = st.shapes.filter((x) => ids.includes(x.id) && x.type === 'line')[${k}]; const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return { id: s.id, x: a.x + (b.x - a.x) * ${t}, y: a.y + (b.y - a.y) * ${t} }; })`);
  return { ...(await toS(w.x, w.y)), id: w.id };
};
const jointsOf = (ids) => evalJs(`(() => { const st = ${ST}; const ids = ${JSON.stringify(ids)}; const out = {}; for (const s of st.shapes) if (ids.includes(s.id)) for (const j of s.joints) { const p = st.joints.get(j); out[j] = [p.x, p.y]; } return out; })()`);
const lineLens = (ids) => evalJs(`(() => { const st = ${ST}; const ids = ${JSON.stringify(ids)}; const out = {}; for (const s of st.shapes) if (ids.includes(s.id) && s.type !== 'circle') { const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[s.joints.length - 1]); out[s.id] = Math.hypot(b.x - a.x, b.y - a.y); } else if (ids.includes(s.id)) out[s.id] = s.radius; return out; })()`);
const rigid = (j0, j1, l0, l1) => {
  const ks = Object.keys(j0); const v = [j1[ks[0]][0] - j0[ks[0]][0], j1[ks[0]][1] - j0[ks[0]][1]];
  const spread = Math.max(...ks.map((k) => Math.hypot(j1[k][0] - j0[k][0] - v[0], j1[k][1] - j0[k][1] - v[1])));
  const lenErr = Math.max(...Object.keys(l0).map((k) => Math.abs(l1[k] - l0[k])));
  return { v, spread, lenErr, joints: ks.length };
};
const wordClip = () => evalJs(`(() => { const st = ${ST}; const m = document.querySelector('#design-canvas .shape-elem').getScreenCTM(); const xs = [], ys = [];
  for (const s of st.shapes) for (const j of s.joints) { const p = st.joints.get(j); const r = s.type === 'circle' ? s.radius : 0; for (const [dx, dy] of [[-r, -r], [r, r]]) { const q = new DOMPoint(p.x + dx, p.y + dy).matrixTransform(m); xs.push(q.x); ys.push(q.y); } }
  const x = Math.max(0, Math.min(...xs) - 16), y = Math.max(0, Math.min(...ys) - 16); return { x, y, width: Math.min(innerWidth, Math.max(...xs) + 16) - x, height: Math.min(innerHeight, Math.max(...ys) + 16) - y }; })()`); // the drawing's box on screen

try {
  await installFakeDriveSession(cdp);

  // ── A. SketchStudio phone: the double tap ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 751 tap', { app: 'sketchstudio' }); await s.save(${JSON.stringify(RECT_DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
    await navigate(url, 8000); await waitForApp('svgCanvas'); await sleep(700);
    await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);
    const at = await evalJs(`(() => { const e = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="E1"]'); const m = e.getScreenCTM(); const p = new DOMPoint(+e.getAttribute('x1') * 0.6 + +e.getAttribute('x2') * 0.4, +e.getAttribute('y1')).matrixTransform(m); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
    const selS = () => evalJs(`[...document.querySelectorAll('#svgCanvas line.shape-elem')].filter((e) => /--sk-selection|#017afd/i.test(e.getAttribute('style') || '')).map((e) => e.dataset.shapeId).sort()`);
    const empty = async () => { const c = await evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { x: r.left + 25, y: r.top + 25 }; })()`); await tap(c); await sleep(700); };
    const cases = [];
    for (const [name, off, gap] of [['one tap', null, 0], ['two taps 7 px apart, 180 ms', [5, 5], 180], ['two taps 10 px apart, 220 ms', [6, 8], 220], ['two taps, the second 700 ms later', [3, 2], 700]]) {
      await empty();
      await tap(at); if (off) { await sleep(gap); await tap({ x: at.x + off[0], y: at.y + off[1] }); }
      await sleep(400);
      const s = await selS();
      cases.push({ name, sel: s });
      console.log(`A. ${name}: selected [${s.join(' ')}]`);
    }
    assert.deepStrictEqual(cases[0].sel, ['E1'], 'A. one tap selects one edge');
    assert.deepStrictEqual(cases[1].sel, ['E1', 'E2', 'E3', 'E4'], 'A. two taps 7 px apart select the chain');
    assert.deepStrictEqual(cases[2].sel, ['E1', 'E2', 'E3', 'E4'], 'A. two taps 10 px apart select the chain');
    assert.deepStrictEqual(cases[3].sel, ['E1'], 'A. a slow second tap stays a tap');
    await empty();
    await T('touchStart', [at]); await sleep(750);
    const menuN = await evalJs(`document.querySelectorAll('.sk-context-menu').length`);
    await T('touchEnd', []); await sleep(300);
    console.log('A. touch and hold: menus open = ' + menuN);
    assert.strictEqual(menuN, 1, 'A. touch and hold still opens the context menu');
    await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(200);
    results.A = cases;
  }

  // ── B. Shaper desktop ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000); await waitForApp('design-canvas'); await sleep(700);
    // the word, dropped on the page (TASK 706: a drop anywhere imports, the ONE importer)
    await evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(SVG)}], 'letters.svg', { type: 'image/svg+xml' })); document.body.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    await waitFor(`${ST}.groups.length === 7`, 'the import and its 7 groups'); await sleep(800);
    const names = await evalJs(`${ST}.groups.map((g) => g.name + (g.parentId ? '<' + ${ST}.groups.find((p) => p.id === g.parentId).name : ''))`);
    console.log('B. groups: ' + names.join(', '));
    assert.deepStrictEqual(names, ['O<letters', 'A<letters', 'B<letters', 'T<letters', 'isl<letters', 'tail<letters', 'letters'], 'B. each profile / chain a child group of the file group');
    const file = await groupIds('letters'), O = await groupIds('O'), A = await groupIds('A');
    let p = await onGroupLine('O', 0);
    await click(p);
    assert.deepStrictEqual(await sel(), file, 'B. a click on a letter selects the whole file group');
    const clip = await wordClip();
    await shot('B1-desktop-file-selected-before-move.png', clip);
    const j0 = await jointsOf(file), l0 = await lineLens(file);
    await mouseDrag(p, { x: p.x + 90, y: p.y + 45 });
    const r1 = rigid(j0, await jointsOf(file), l0, await lineLens(file));
    console.log('B. file drag: ' + JSON.stringify(r1));
    assert.ok(Math.hypot(...r1.v) > 3 && r1.spread < 1e-6 && r1.lenErr < 1e-6, 'B. the drag moved every joint of the file by the same vector, every length / radius unchanged');
    await shot('B2-desktop-file-after-move.png', await wordClip());
    p = await onGroupLine('O', 0);
    await dblclick(p);
    assert.deepStrictEqual([await entered(), await sel()], [await groupId('letters'), O], 'B. a double click enters the file: the letter O (outline + hole)');
    await shot('B3-desktop-entered-file-O-selected.png', await wordClip());
    const pa = await onGroupLine('A', 0);
    await click(pa);
    assert.deepStrictEqual(await sel(), A, 'B. inside the file a click selects the letter A');
    const ja = await jointsOf(file);
    await mouseDrag(pa, { x: pa.x, y: pa.y + 60 });
    const jb = await jointsOf(file);
    const movedA = Object.keys(ja).filter((k) => ja[k][0] !== jb[k][0] || ja[k][1] !== jb[k][1]);
    const aJ = Object.keys(await jointsOf(A));
    assert.deepStrictEqual(movedA.sort(), aJ.sort(), 'B. dragging the letter A moved exactly its joints');
    await shot('B4-desktop-letter-A-moved.png', await wordClip());
    p = await onGroupLine('O', 0);
    await dblclick(p);
    assert.deepStrictEqual([await entered(), (await sel()).length], [await groupId('O'), 1], 'B. a double click on the letter enters it: one curve');
    const dimmed = await evalJs(`[...document.querySelectorAll('#design-canvas g.sketch-inactive .shape-elem')].length`);
    console.log('B. entered O: shapes drawn dimmed (g.sketch-inactive, --sk-inactive-sketch-opacity) = ' + dimmed);
    assert.ok(dimmed >= 33, 'B. while O is entered, the rest of the drawing is drawn dimmed');
    await shot('B5a-desktop-entered-letter-O-rest-dimmed.png', await wordClip());
    const emptyP = await toS(100, -20);
    await click(emptyP);
    assert.strictEqual(await entered(), await groupId('letters'), 'B. a click on empty canvas steps out one level');
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    assert.strictEqual(await entered(), null, 'B. Esc steps out one more level');

    // the browser: the groups as nested rows; a row click selects that group
    await evalJs(`(() => { const n = document.querySelector('.sk-sketch-node:last-child .sk-sketch-tw'); if (n && n.classList.contains('is-collapsed')) n.click(); })()`); await sleep(400);
    const rows = await evalJs(`[...document.querySelectorAll('.sk-group-row')].map((r) => r.textContent + '@' + r.style.paddingLeft)`);
    console.log('B. browser rows: ' + rows.join(' | '));
    assert.ok(rows.length === 7 && rows[0].startsWith('▣letters') && rows[1].startsWith('▣O'), 'B. the browser lists the file group and its letters nested');
    const rowB = await evalJs(`(() => { const r = [...document.querySelectorAll('.sk-group-row')].find((x) => x.querySelector('.sk-info-lbl').textContent === 'B'); r.scrollIntoView({ block: 'nearest' }); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await click(rowB);
    assert.deepStrictEqual([await entered(), await sel()], [await groupId('letters'), await groupIds('B')], 'B. a row click selects that group (its parent entered)');
    const panel = await evalJs(`(() => { const r = document.querySelector('.sk-group-row').closest('.sk-sketch-node').getBoundingClientRect(); return { x: r.left - 4, y: r.top - 4, width: r.width + 8, height: Math.min(r.height + 8, 400) }; })()`);
    await shot('B5-desktop-browser-group-rows.png', panel);
    await evalJs(`document.querySelector('.sk-group-row').closest('.sk-sketch-node').querySelector('.sk-sketch-tw').click()`); await sleep(300); // collapse it again (the card floats over the drawing)
    await sendRealKey(send, 'Escape', 'Escape', 27); await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);

    // tool picks with the group NOT entered (the Select tool's rule is the Select tool's only)
    const nCons = await evalJs(`${ST}.constraints.length`);
    const corner = async (name, k) => { const w = await evalJs(`import('/packages/core/group-model.js').then((m) => { const st = ${ST}; const g = st.groups.find((x) => x.name === ${JSON.stringify(name)}); const ids = m.shapesInGroup(st, g.id); const s = st.shapes.filter((x) => ids.includes(x.id) && x.type === 'line')[${k}]; const a = st.joints.get(s.joints[0]); return { id: s.joints[0], x: a.x, y: a.y }; })`); return { ...(await toS(w.x, w.y)), id: w.id }; };
    // a constraint button with the file group selected: the notice
    p = await onGroupLine('O', 1); await click(p);
    assert.deepStrictEqual(await sel(), await groupIds('letters'), 'B. (the file group selected)');
    await pressRibbonTool(evalJs, click, 'tool-coincident'); await sleep(300);
    const notice = await evalJs(`(document.getElementById('notification-container') || {}).textContent || ''`);
    console.log('B. Coincident pressed with the file group selected: notice = ' + JSON.stringify(notice.slice(0, 200)));
    assert.ok(/single curves and points/.test(notice), 'B. the constraint button says a group is not its operand');
    // Coincident: a corner of O and a corner of B (two members of the same un-entered group): picks the points. TASK 752: the file group is ONE
    // rigid block (it only translates), so a coincident between two of its points would deform it: the add is refused (the existing conflict
    // notice), nothing is added (no undo step) and nothing moves
    const cO = await corner('O', 1), cB = await corner('B', 0);
    const fileJ0 = await jointsOf(file);
    await click(cO); await click(cB); await sleep(300);
    const lastC = await evalJs(`(() => { const c = ${ST}.constraints[${ST}.constraints.length - 1]; return { n: ${ST}.constraints.length, type: c && c.type, joints: c && c.joints }; })()`);
    const refusal = await evalJs(`(document.getElementById('notification-container') || {}).textContent || ''`);
    console.log('B. Coincident tool on two member points: ' + JSON.stringify(lastC) + ' notice: ' + JSON.stringify(refusal.slice(-160)));
    assert.ok(lastC.n === nCons && /Coincident rejected/.test(refusal), 'B. the Coincident tool picked the two member points; the block would deform: refused');
    const fileJ1 = await jointsOf(file);
    assert.ok(Object.keys(fileJ0).every((k) => fileJ0[k][0] === fileJ1[k][0] && fileJ0[k][1] === fileJ1[k][1]), 'B. the refused coincident moved nothing');
    // Dimension: a member line of A
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(200);
    await pressRibbonTool(evalJs, click, 'tool-dim'); await sleep(300);
    const la = await onGroupLine('A', 0);
    await click(la);
    const place = { x: la.x - 40, y: la.y }; await mouse('mouseMoved', place.x, place.y, 0); await sleep(200); await click(place);
    await sendRealKey(send, 'Enter', 'Enter', 13); await sleep(400);
    const dim = await evalJs(`(() => { const c = ${ST}.constraints.filter((x) => x.type === 'distance').pop(); const s = ${ST}.shapes.find((x) => x.id === ${JSON.stringify(la.id)}); return c ? { joints: c.joints, line: s.joints } : null; })()`);
    console.log('B. Dimension tool on a member line: ' + JSON.stringify(dim));
    assert.ok(dim && dim.joints.includes(dim.line[0]) && dim.joints.includes(dim.line[1]), 'B. the Dimension tool dimensioned the member line');
    await sendRealKey(send, 'Escape', 'Escape', 27); await sendRealKey(send, 'z', 'KeyZ', 90, 2); await sleep(500);
    // the Select tool on a corner of B (a member's point) selects the whole file group; the Line tool then snaps to that same corner
    const cB2 = (await Promise.all([0, 1, 2, 3].map((k) => corner('B', k)))).sort((u, v) => u.y - v.y)[0]; // B's top corner on screen
    await evalJs(`document.getElementById('tool-select').click()`); await sleep(200);
    await click(cB2);
    assert.deepStrictEqual(await sel(), file, 'B. the Select tool on a corner of B selects the whole file group');
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(200);
    // Line: drawn from empty canvas onto that corner of B: snaps to the member point (a coincident to it, or the same joint)
    await pressRibbonTool(evalJs, click, 'tool-line'); await sleep(300);
    const from = { x: cB2.x - 30, y: cB2.y - 90 }; // above the word on screen: the line lies outside every letter
    const n0 = await evalJs(`${ST}.shapes.length`);
    await click(from); await mouse('mouseMoved', cB2.x + 1, cB2.y + 1, 0); await sleep(250); await click(cB2);
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    const snapped = await evalJs(`(() => { const st = ${ST}; const L = st.shapes[st.shapes.length - 1]; const end = L.joints[1]; const p = st.joints.get(end), q = st.joints.get(${JSON.stringify(cB2.id)}); return { n: st.shapes.length, end, onCorner: end === ${JSON.stringify(cB2.id)} || st.constraints.some((c) => c.type === 'coincident' && c.joints.includes(end) && c.joints.includes(${JSON.stringify(cB2.id)})), d: Math.hypot(p.x - q.x, p.y - q.y), lineId: L.id }; })()`);
    console.log('B. Line drawn onto a corner of B: ' + JSON.stringify(snapped));
    assert.ok(snapped.n === n0 + 1 && snapped.onCorner && snapped.d < 1e-6, 'B. the line snapped to the member point');
    await evalJs(`document.getElementById('tool-select').click()`); await sleep(200);
    // FACT for the owner: drag the outside line: before TASK 752 the coincident pulled the letter's corner alone (the letter deformed); the
    // file group is now a rigid block: it moves whole or the line gives
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(200);
    const Bjoints0 = await jointsOf(await groupIds('B'));
    await shot('B6-fact-before-line-drag.png', await wordClip());
    // a body drag of the line (press its middle: an ungrouped line)
    const mid = await evalJs(`(() => { const st = ${ST}; const L = st.shapes.find((s) => s.id === ${JSON.stringify(snapped.lineId)}); const a = st.joints.get(L.joints[0]), b = st.joints.get(L.joints[1]); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; })()`);
    const ms = await toS(mid.x, mid.y);
    await mouseDrag(ms, { x: ms.x + 40, y: ms.y - 30 });
    const Bjoints1 = await jointsOf(await groupIds('B'));
    const moved = Object.keys(Bjoints0).filter((k) => Math.hypot(Bjoints1[k][0] - Bjoints0[k][0], Bjoints1[k][1] - Bjoints0[k][1]) > 1e-6);
    results.fact1 = { letterBJoints: Object.keys(Bjoints0).length, moved: moved.length, corner: cB2.id, cornerMoved: moved.includes(cB2.id) };
    console.log('B. FACT 1 (an outside line coincident with a corner of B, dragged): ' + JSON.stringify(results.fact1));
    assert.ok(moved.length === 0 || moved.length === Object.keys(Bjoints0).length, 'B. TASK 752: the letter moved whole or not at all (never its corner alone)');
    await shot('B7-fact-after-line-drag.png', await wordClip());
    await sendRealKey(send, 'z', 'KeyZ', 90, 2); await sleep(300); await sendRealKey(send, 'z', 'KeyZ', 90, 2); await sleep(500); // the drag, the line

    // Ctrl+Shift+G on the selected file group dissolves ONE level; then a hand-made group (Ctrl+G) of a rectangle (the island) + a circle (the dot)
    p = await onGroupLine('O', 0); await click(p);
    await sendRealKey(send, 'G', 'KeyG', 71, 2 | 8); await sleep(400);
    const afterUngroup = await evalJs(`${ST}.groups.map((g) => g.name + (g.parentId ? '<' : ''))`);
    console.log('B. Ctrl+Shift+G on the file: groups now ' + afterUngroup.join(', '));
    assert.ok(!afterUngroup.includes('letters') && afterUngroup.includes('O') && !afterUngroup.some((n) => n.endsWith('<')), 'B. one level dissolved: the letters are top-level groups');
    await click(p);
    assert.deepStrictEqual(await sel(), O, 'B. a click on O now selects the letter O');
    const isl = await onGroupLine('isl', 0);
    await click(isl); await sendRealKey(send, 'G', 'KeyG', 71, 2 | 8); await sleep(400); // dissolve the island's group: 4 loose lines
    const dotS = await evalJs(`(() => { const st = ${ST}; const c = st.shapes.find((s) => s.type === 'circle'); const p = st.joints.get(c.joints[0]); return { id: c.id, x: p.x + c.radius, y: p.y }; })()`);
    const dotP = await toS(dotS.x, dotS.y);
    const islLines = await evalJs(`(() => { const st = ${ST}; return st.shapes.filter((s) => s.type === 'line' && !s.userGroupId).map((s) => s.id); })()`);
    assert.strictEqual(islLines.length, 4, 'B. the island is 4 loose lines');
    const islPts = [];
    for (const id of islLines) { const w = await evalJs(`(() => { const st = ${ST}; const s = st.shapes.find((x) => x.id === ${JSON.stringify(id)}); const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; })()`); islPts.push(await toS(w.x, w.y)); }
    await click(islPts[0]); for (const q of islPts.slice(1)) await click(q, 8); await click(dotP, 8);
    assert.deepStrictEqual(await sel(), [...islLines, dotS.id].sort(), 'B. the rectangle + the circle selected');
    await sendRealKey(send, 'g', 'KeyG', 71, 2); await sleep(400);
    const hand = await evalJs(`${ST}.groups[${ST}.groups.length - 1].name`);
    await click(await toS(100, -20));
    await click(islPts[1]);
    assert.deepStrictEqual(await sel(), [...islLines, dotS.id].sort(), 'B. a click on the hand-made group (' + hand + ') selects it whole');
    await dblclick(islPts[1]);
    assert.strictEqual((await sel()).length, 1, 'B. a double click enters the hand-made group: one curve');
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    results.B = 'ok';
  }

  // ── C. Shaper phone: the same word, touch ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000); await waitForApp('design-canvas'); await sleep(700);
    await evalJs(`delete window.showOpenFilePicker`);
    await send('DOM.getDocument', { depth: 0 });
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    const pressSel = async (s) => { const c = await evalJs(`(() => { const r = document.querySelector('${s}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); await tap(c); await sleep(450); };
    await pressSel('.sk-sidebar-chevron');
    const chooser = once('Page.fileChooserOpened');
    await pressSel('.sk-sidebar-item[data-action="import-file"]');
    const ch = await chooser;
    await send('DOM.setFileInputFiles', { files: [SVG_FILE], backendNodeId: ch.backendNodeId });
    await waitFor(`${ST}.groups.length === 7`, 'C. the import and its 7 groups'); await sleep(1500);
    const file = await groupIds('letters'), A = await groupIds('A');
    let p = await onGroupLine('O', 0);
    await tap(p); await sleep(700);
    assert.deepStrictEqual(await sel(), file, 'C. a tap on a letter selects the whole file group');
    await shot('C1-phone-file-selected-before-move.png', await wordClip());
    const j0 = await jointsOf(file), l0 = await lineLens(file);
    await sleep(600);
    await touchDrag(p, { x: p.x + 40, y: p.y + 80 });
    const r1 = rigid(j0, await jointsOf(file), l0, await lineLens(file));
    console.log('C. touch drag of the file: ' + JSON.stringify(r1));
    assert.ok(Math.hypot(...r1.v) > 3 && r1.spread < 1e-6 && r1.lenErr < 1e-6, 'C. the touch drag moved every joint by the same vector, lengths unchanged');
    await shot('C2-phone-file-after-move.png', await wordClip());
    p = await onGroupLine('O', 0);
    await sleep(600);
    await tap(p); await sleep(180); await tap({ x: p.x + 5, y: p.y + 5 }); await sleep(600);
    assert.deepStrictEqual(await entered(), await groupId('letters'), 'C. a double tap (7 px apart) enters the file');
    const pa = await onGroupLine('A', 0);
    await tap(pa); await sleep(700);
    assert.deepStrictEqual(await sel(), A, 'C. inside, a tap selects the letter A');
    const ja = await jointsOf(file);
    await touchDrag(pa, { x: pa.x, y: pa.y + 60 });
    const jb = await jointsOf(file);
    const movedA = Object.keys(ja).filter((k) => ja[k][0] !== jb[k][0] || ja[k][1] !== jb[k][1]);
    assert.deepStrictEqual(movedA.sort(), Object.keys(await jointsOf(A)).sort(), 'C. the touch drag moved only the letter A');
    await shot('C3-phone-entered-letter-A-moved.png', await wordClip());
    const emptyC = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 20 }; })()`);
    await tap(emptyC); await sleep(700);
    assert.strictEqual(await entered(), null, 'C. a tap on empty canvas steps out');
    p = await onGroupLine('O', 0);
    await T('touchStart', [p]); await sleep(750);
    const menuN = await evalJs(`document.querySelectorAll('.sk-context-menu').length`);
    await T('touchEnd', []); await sleep(300);
    assert.strictEqual(menuN, 1, 'C. touch and hold on a grouped letter opens the menu');
    results.C = 'ok';
  }
  // ── D. Shaper desktop: a DXF with a SPLINE (a bezier: its control points are shape data) moves rigidly with its group ─────────────────────────
  {
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000); await waitForApp('design-canvas'); await sleep(700);
    const dxf = fs.readFileSync(path.resolve('tests/fixtures/dxf/part-mm.dxf'), 'utf8');
    await evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(dxf)}], 'part-mm.dxf', { type: 'application/dxf' })); document.body.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    await waitFor(`${ST}.shapes.some((s) => s.type === 'bezier') && ${ST}.groups.length === 2`, 'D. the DXF and its groups'); await sleep(800);
    const geo = () => evalJs(`(() => { const st = ${ST}; const P = (id) => st.joints.get(id); const bz = st.shapes.find((s) => s.type === 'bezier'), arc = st.shapes.find((s) => s.type === 'arc'), c = st.shapes.find((s) => s.type === 'circle');
      const p0 = P(bz.joints[0]), p3 = P(bz.joints[1]); const curve = []; for (let k = 0; k <= 8; k++) { const t = k / 8, u = 1 - t; curve.push([u * u * u * p0.x + 3 * u * u * t * bz.c1[0] + 3 * u * t * t * bz.c2[0] + t * t * t * p3.x, u * u * u * p0.y + 3 * u * u * t * bz.c1[1] + 3 * u * t * t * bz.c2[1] + t * t * t * p3.y]); }
      return { curve, centre: [P(c.joints[0]).x, P(c.joints[0]).y], r: c.radius, arcC: [P(arc.joints[0]).x, P(arc.joints[0]).y], arcR: Math.hypot(P(arc.joints[1]).x - P(arc.joints[0]).x, P(arc.joints[1]).y - P(arc.joints[0]).y) }; })()`);
    const g0 = await geo();
    const L = await evalJs(`(() => { const st = ${ST}; const s = st.shapes.find((x) => x.type === 'line'); const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; })()`);
    const p = await toS(L.x, L.y);
    await click(p);
    assert.strictEqual((await sel()).length, await evalJs(`${ST}.shapes.length`), 'D. a click on the plate selects the whole file group (the spline too)');
    await mouseDrag(p, { x: p.x + 120, y: p.y + 50 });
    const g1 = await geo();
    const v = [g1.centre[0] - g0.centre[0], g1.centre[1] - g0.centre[1]];
    const curveErr = Math.max(...g1.curve.map((q, k) => Math.hypot(q[0] - g0.curve[k][0] - v[0], q[1] - g0.curve[k][1] - v[1])));
    results.D = { v, curveErr, arcCentreErr: Math.hypot(g1.arcC[0] - g0.arcC[0] - v[0], g1.arcC[1] - g0.arcC[1] - v[1]), arcR: [g0.arcR, g1.arcR], circleR: [g0.r, g1.r] };
    console.log('D. DXF group drag: ' + JSON.stringify(results.D));
    assert.ok(Math.hypot(...v) > 3 && curveErr < 1e-6, 'D. every sampled point of the spline moved by the same vector');
    assert.ok(results.D.arcCentreErr < 1e-6 && Math.abs(g1.arcR - g0.arcR) < 1e-9 && g1.r === g0.r, 'D. the arc and the circle moved rigidly, radii unchanged');
  }
  console.log('import-groups-751-live: ALL CHECKS PASSED ' + JSON.stringify(results));
} finally {
  await cdp.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
