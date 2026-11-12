// TASK 535 slice 4 — the "fx Parameters" pop-up, read-only. Live headless CDP against the REAL apps, REAL mouse + keyboard events.
//  A. the button: SketchStudio, Shaper (Design), Pen Plotter (Design) have #btn-parameters; Trace (Edit) has NOT (declared opt-out, O14).
//  B. SketchStudio: open / close / Esc / focus in and back; modeless (the canvas still draws); not over the ribbon; empty states; rows appear when a
//     dimension is drawn, disappear on delete and come back on undo; a canvas selection lights its row; typing in the window is no tool shortcut;
//     drag moves it and the position + size are remembered after a reload; the 390 px layout is a full-width bottom sheet.
//  C. Shaper: the dimension rows (every mode: distance, angle, radius, reference) read from the real state; row hover / click drive the canvas
//     through state.hoveredConstraint / selectedConstraints (the canvas line turns Fusion blue); canvas hover / click light the row.
//  D. Pen Plotter: rows read from the plotter's own sketch state.
// EVIDENCE_DIR (optional): screenshots are written there.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '535-4', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  try {
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (type === 'mouseMoved' && !buttons) ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(40); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); await sleep(250); };
    const hover = async (x, y) => { await mouse('mouseMoved', x - 3, y - 3); await sleep(60); await mouse('mouseMoved', x, y); await sleep(250); };
    const drag = async (from, to) => {
      await mouse('mouseMoved', from.x, from.y); await sleep(40); await mouse('mousePressed', from.x, from.y, 1);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8, 1); await sleep(30); }
      await mouse('mouseReleased', to.x, to.y); await sleep(300);
    };
    const key = (k, code, vk, mods = 0) => sendRealKey(send, k, code, vk, mods);
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' is on screen'); await click(c.x, c.y); };
    const rect = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null; })()`);
    const W = '.sk-pwin';
    const winOpen = () => evalJs(`(() => { const e = document.querySelector('${W}'); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; })()`);
    const active = () => evalJs(`(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : null; })()`);
    const focusInWindow = () => evalJs(`(() => { const e = document.querySelector('${W}'); return !!e && e.contains(document.activeElement); })()`);
    const rows = () => evalJs(`JSON.stringify([...document.querySelectorAll('${W} tr.sk-ptable-row')].map(r => ({ kind: r.dataset.kind, name: r.dataset.name, cells: [...r.children].map(c => c.textContent), cls: r.className, sel: r.getAttribute('aria-selected') })))`).then(JSON.parse);
    const emptyTexts = () => evalJs(`JSON.stringify([...document.querySelectorAll('${W} td.pt-empty')].map(e => e.textContent))`).then(JSON.parse);
    const groupHeads = () => evalJs(`JSON.stringify([...document.querySelectorAll('${W} th[scope="rowgroup"]')].map(e => e.textContent))`).then(JSON.parse);
    const btnState = () => evalJs(`(() => { const b = document.getElementById('btn-parameters'); return b ? { label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), popup: b.getAttribute('aria-haspopup'), title: b.title } : null; })()`);
    const shot = async (name, clip) => {
      const p = { format: 'png' };
      if (clip) p.clip = { x: clip.l, y: clip.t, width: clip.w, height: clip.h, scale: 2 };
      const buf = Buffer.from((await send('Page.captureScreenshot', p)).data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      return createHash('md5').update(buf).digest('hex');
    };
    const winClip = async (pad = 40) => { const r = await rect(W); return { l: Math.max(0, r.l - pad), t: Math.max(0, r.t - 90), w: r.w + 2 * pad, h: r.h + 90 + pad }; };

    // ================================================================== B. SketchStudio
    await navigate(url('/apps/sketchstudio/index.html'), 8000);
    await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('tool-line') && !!document.getElementById('btn-parameters'); })()`, 'SketchStudio to load with its Parameters button');
    await sleep(1500);
    assert.deepStrictEqual(await btnState(), { label: 'Parameters', pressed: 'false', popup: 'dialog', title: 'Parameters (fx)' }, 'the button has a label, a title, a pressed state and announces a dialog');
    assert.strictEqual(await evalJs(`document.querySelector('#btn-parameters .sk-ribbon-lbl').textContent`), 'Params');
    assert.strictEqual(await winOpen(), false, 'before the first click no window is shown');
    // open: real click
    await clickEl('#btn-parameters');
    assert.strictEqual(await winOpen(), true, 'the button opens the window');
    assert.strictEqual((await btnState()).pressed, 'true', 'pressed while open');
    assert.deepStrictEqual(await evalJs(`(() => { const e = document.querySelector('${W}'); return { role: e.getAttribute('role'), label: e.getAttribute('aria-label'), table: !!e.querySelector('table[role="grid"] th[scope="col"]') }; })()`), { role: 'dialog', label: 'Parameters', table: true }, 'role=dialog, a title, a real table with column headers');
    assert.strictEqual(await focusInWindow(), true, 'focus moves into the window on open');
    assert.deepStrictEqual(await groupHeads(), ['User parameters(0)', 'Sketch dimensions(0)'], 'two groups');
    const empties = await emptyTexts();
    assert(/name = value/.test(empties[0]) && /Dim tool/.test(empties[1]), 'empty states: ' + JSON.stringify(empties));
    // not over the ribbon
    const ribbon = await rect('#toolsRibbon .sk-ribbon'); const w0 = await rect(W);
    assert(w0.t >= ribbon.b, `the window does not overlap the ribbon (window top ${w0.t} >= ribbon bottom ${ribbon.b})`);
    assert(w0.r <= 1400 && w0.l >= 0 && w0.b <= 800, 'the window is inside the viewport');
    // modeless: the canvas still takes a drawing while the window is open
    const cv = await centerOf('#svgCanvas');
    await clickEl('#tool-line');
    const A = { x: cv.x - 260, y: cv.y + 40 }, B = { x: cv.x - 60, y: cv.y + 40 };
    await click(A.x, A.y); await click(B.x, B.y); await key('Escape', 'Escape', 27); await sleep(300);
    assert.strictEqual(await evalJs(`document.querySelectorAll('#svgCanvas line.shape-elem').length`), 1, 'a line was drawn with the window open (modeless)');
    // draw a dimension: a row appears (live)
    await clickEl('#tool-dim');
    await click(A.x, A.y); await click(B.x, B.y);
    await mouse('mouseMoved', (A.x + B.x) / 2, A.y - 50); await sleep(200); await click((A.x + B.x) / 2, A.y - 50);
    await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the dimension value box', 8000);
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await send('Input.insertText', { text: '150' }); await key('Enter', 'Enter', 13); await sleep(600);
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 1`, 'a dimension row to appear');
    let r = await rows();
    assert.deepStrictEqual(r.map((x) => [x.kind, x.name, x.cells[1], x.cells[2], x.cells[3]]), [['dimension', 'd1', '150.0', '150.0', 'mm']], 'the row: name d1, plain value, value, unit: ' + JSON.stringify(r));
    assert(/Distance/.test(r[0].cells[4]), 'the row says what it measures: ' + r[0].cells[4]);
    assert.deepStrictEqual(await groupHeads(), ['User parameters(0)', 'Sketch dimensions(1)']);
    // canvas selection lights the row; clicking empty canvas clears it
    await clickEl('#tool-select');
    const label = await centerOf('#svgCanvas .dim-label');
    await click(label.x, label.y);
    assert.strictEqual((await rows())[0].sel, 'true', 'selecting the dimension on the canvas selects its row');
    await shot('desktop-sketchstudio-row-selected-full.png');
    await shot('desktop-sketchstudio-window.png', await winClip());
    await key('Escape', 'Escape', 27); // (focus is on the canvas side: this is the app's own Esc, not the window's)
    await click(cv.x + 200, cv.y - 150); await sleep(300);
    assert.strictEqual((await rows())[0].sel, 'false', 'deselecting on the canvas clears the row');
    assert.strictEqual(await winOpen(), true, 'Esc outside the window does not close the window');
    // delete the dimension on the canvas -> the row goes; undo -> it comes back
    await click(label.x, label.y); await key('Delete', 'Delete', 46); await sleep(500);
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 0`, 'the row to disappear after Delete');
    assert(/Dim tool/.test((await emptyTexts())[1]), 'the empty state is back');
    await key('z', 'KeyZ', 90, 2); await sleep(500);
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 1`, 'the row to come back after Undo');
    assert.strictEqual((await rows())[0].name, 'd1', 'undo brings back d1');
    // filter + typing in the window is not a tool shortcut
    await clickEl(`${W} .sk-ptable-filter`);
    assert.strictEqual(await focusInWindow(), true);
    const toolBefore = await evalJs(`document.querySelector('#toolsRibbon .sk-ribbon-btn.active') && document.querySelector('#toolsRibbon .sk-ribbon-btn.active').id`);
    await send('Input.insertText', { text: 'zz' }); await sleep(200);
    for (const [k, code, vk] of [['l', 'KeyL', 76], ['c', 'KeyC', 67]]) await sendRealKey(send, k, code, vk, 0, k);
    await sleep(300);
    assert.strictEqual(await evalJs(`document.querySelector('${W} .sk-ptable-filter').value`), 'zzlc', 'the keys went into the filter box');
    assert.strictEqual(await evalJs(`document.querySelector('#toolsRibbon .sk-ribbon-btn.active') && document.querySelector('#toolsRibbon .sk-ribbon-btn.active').id`), toolBefore, 'no tool shortcut fired from the window');
    assert.strictEqual((await rows()).length, 0, 'the filter hides the row that does not match');
    assert(/No dimension matches/.test((await emptyTexts())[1]), 'and says why');
    await evalJs(`(() => { const f = document.querySelector('${W} .sk-ptable-filter'); f.value = ''; f.dispatchEvent(new Event('input')); })()`);
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 1`, 'the row to return when the filter is cleared');
    // Esc inside the window closes it and focus returns to the button
    await key('Escape', 'Escape', 27); await sleep(200);
    assert.strictEqual(await winOpen(), false, 'Esc with focus in the window closes it');
    assert.strictEqual(await active(), 'btn-parameters', 'focus returns to the button');
    assert.strictEqual((await btnState()).pressed, 'false');
    // reopen with the button, close with the X; the button toggles too
    await clickEl('#btn-parameters'); assert.strictEqual(await winOpen(), true); assert.strictEqual(await focusInWindow(), true);
    await clickEl(`${W} .sk-dock-close`);
    assert.strictEqual(await winOpen(), false, 'the close button closes it'); assert.strictEqual(await active(), 'btn-parameters', 'focus returns after the close button');
    await clickEl('#btn-parameters'); await clickEl('#btn-parameters');
    assert.strictEqual(await winOpen(), false, 'the button toggles');
    await clickEl('#btn-parameters'); assert.strictEqual(await winOpen(), true);

    // drag moves it; resize; both remembered after a reload
    const before = await rect(W);
    const grip = { x: before.r - 70, y: before.t + 14 };
    await drag(grip, { x: grip.x - 220, y: grip.y + 90 });
    const moved = await rect(W);
    assert(Math.abs((moved.l - before.l) + 220) <= 2 && Math.abs((moved.t - before.t) - 90) <= 2, `the header drag moves the window by (-220, +90): ${JSON.stringify(before)} -> ${JSON.stringify(moved)}`);
    assert.strictEqual(await winOpen(), true, 'still open (modeless) after the drag');
    const handle = await centerOf(`${W} .sk-dock-resize`);
    await drag(handle, { x: handle.x + 40, y: handle.y + 30 });
    const sized = await rect(W);
    assert(sized.w === moved.w + 40 && sized.h === moved.h + 30, `the corner drag resizes it: ${JSON.stringify(moved)} -> ${JSON.stringify(sized)}`);
    await shot('desktop-sketchstudio-moved.png');
    await navigate(url('/apps/sketchstudio/index.html'), 8000);
    await waitFor(`!!document.getElementById('btn-parameters')`, 'SketchStudio to reload');
    await sleep(1200);
    await clickEl('#btn-parameters');
    const again = await rect(W);
    assert.deepStrictEqual(again, sized, 'after a reload the window opens where it was left, at its size');

    // desktop evidence: the window with a row, cropped
    await key('Escape', 'Escape', 27);
    // move it back under the ribbon for the picture
    await evalJs(`localStorage.removeItem('sk-parameters')`);
    await navigate(url('/apps/sketchstudio/index.html'), 8000);
    await waitFor(`!!document.getElementById('btn-parameters')`, 'SketchStudio to reload');
    await sleep(1200);

    // ---- the 390 px layout: a full-width bottom sheet
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    await evalJs(`document.getElementById('btn-parameters').scrollIntoView({ inline: 'center' })`); await sleep(200);
    await clickEl('#btn-parameters');
    assert.strictEqual(await winOpen(), true, 'the button opens the window at 390 px');
    const sheet = await rect(W);
    assert(sheet.l === 0 && sheet.r === 390 && sheet.b === 800, `a full-width bottom sheet at 390 px: ${JSON.stringify(sheet)}`);
    const ribbon390 = await rect('#toolsRibbon .sk-ribbon');
    assert(sheet.t >= ribbon390.b, `the sheet does not cover the ribbon (${sheet.t} >= ${ribbon390.b})`);
    assert.deepStrictEqual(await evalJs(`(() => { const t = document.querySelector('${W} table'); const b = document.querySelector('${W} .sk-dock-body'); return { tableFits: t.scrollWidth <= b.clientWidth, pageOverflow: document.documentElement.scrollWidth - 390, unitHidden: getComputedStyle(document.querySelector('${W} th.pt-unit')).display, commentHidden: getComputedStyle(document.querySelector('${W} th.pt-comment')).display }; })()`),
      { tableFits: true, pageOverflow: 0, unitHidden: 'none', commentHidden: 'none' }, 'no horizontal overflow; Unit and Comment merge / hide');
    const gripS = { x: sheet.r - 70, y: sheet.t + 14 };
    await drag(gripS, { x: gripS.x - 100, y: gripS.y - 100 });
    assert.deepStrictEqual(await rect(W), sheet, 'a bottom sheet does not move');
    assert(/^\d+\.\d mm$|d1/.test((await rows()).map(x => x.cells[0]).join(' ')) || (await rows()).length === 0, 'rows readable');
    await shot('narrow-390-sketchstudio-sheet.png', { l: 0, t: 0, w: 390, h: 800 });
    await key('Escape', 'Escape', 27); await sleep(200);
    assert.strictEqual(await winOpen(), false, 'Esc closes the sheet');
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });

    // ================================================================== C. Shaper
    await navigate(url('/apps/shaper/index.html'), 8000);
    await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'Shaper to load');
    await sleep(1200);
    for (let i = 0; i < 5; i++) { await clickEl('[data-mode="design"]'); await sleep(300); if (await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`) === 'design') break; }
    await waitFor(`!!window.__designController && !!document.getElementById('btn-parameters')`, 'the Shaper Design tab with its Parameters button');
    await sleep(1500);
    assert.deepStrictEqual(await btnState(), { label: 'Parameters', pressed: 'false', popup: 'dialog', title: 'Parameters (fx)' }, 'Shaper: the same declared button');
    const seed = () => evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear();
      const J = (id, x, y) => st.joints.set(id, { x, y });
      J('a', -45, -20); J('b', -5, -20); J('c', -5, 10);
      st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] });
      J('cc', 15, 25); J('cr', 23, 25);
      st.shapes.push({ id: 'C1', type: 'circle', joints: ['cc', 'cr'], radius: 8 });
      st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 40, name: 'd1', glyphPos: { x: -25, y: -30 } });
      st.constraints.push({ type: 'angle', shapes: ['L1', 'L2'], value: 90, name: 'd2', glyphPos: { x: -12, y: -10 } });
      st.constraints.push({ type: 'distance', shape: 'C1', value: 8, isRadius: true, name: 'd3', glyphPos: { x: 15, y: 10 } });
      st.constraints.push({ type: 'distance', joints: ['b', 'c'], value: 30, isDriven: true, name: 'd4', glyphPos: { x: 8, y: -5 } });
      return st.constraints.length;
    })()`);
    await seed();
    await clickEl('#btn-parameters');
    assert.strictEqual(await winOpen(), true, 'Shaper: the button opens the window');
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 4`, 'the four seeded dimension rows');
    r = await rows();
    const docUnit = r[0].cells[3]; // Shaper's document unit (its own default): every length row must be in it, converted by the shared formatter
    assert(docUnit === 'in' || docUnit === 'mm', 'a document unit: ' + docUnit);
    const inUnit = (mm) => (mm / (docUnit === 'in' ? 25.4 : 1)).toFixed(1);
    assert.deepStrictEqual(r.map((x) => [x.name, x.cells[1], x.cells[2], x.cells[3], x.cls.includes('pt-reference')]),
      [['d1', inUnit(40), inUnit(40), docUnit, false], ['d2', '90.0', '90.0', 'deg', false], ['d3', inUnit(8), inUnit(8), docUnit, false], ['d4', '(reference)', `(${inUnit(30)})`, docUnit, true]], 'Shaper rows: distance, angle, radius, reference: ' + JSON.stringify(r));
    assert.strictEqual(await evalJs(`document.querySelectorAll('${W} tr.pt-dim')[3].querySelector('.pt-ref').textContent`), 'ref', 'the reference mark');
    const wr = await rect(W); const rb = await rect('#design-ribbon .sk-ribbon');
    assert(wr.t >= rb.b, `Shaper: the window does not overlap the ribbon (${wr.t} >= ${rb.b})`);
    // a formula row carries the fx mark (formulas have no UI producer yet: set it on the state like a loaded file would)
    await evalJs(`(() => { const c = window.__designController.state.constraints[0]; c.expression = '20 mm * 2'; })()`);
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim')[0].querySelector('.pt-fx')`, 'the fx mark on a formula row');
    assert.strictEqual(await evalJs(`document.querySelectorAll('${W} tr.pt-dim')[0].children[1].textContent`), 'fx20 mm * 2', 'the formula text after its fx mark');
    await evalJs(`delete window.__designController.state.constraints[0].expression`);
    await waitFor(`!document.querySelectorAll('${W} tr.pt-dim')[0].querySelector('.pt-fx')`, 'the fx mark to go');
    // row hover -> canvas
    const lineStroke = (id) => evalJs(`(() => { const s = window.__designController.state; const sh = s.shapes.find(x => x.id === '${id}'); const els = [...document.querySelectorAll('#design-canvas .shape-elem')]; const e = els.find(x => x.getAttribute('data-id') === '${id}' || x.getAttribute('data-shape-id') === '${id}') || els[s.shapes.indexOf(sh)]; return e ? (e.getAttribute('stroke') || getComputedStyle(e).stroke) : null; })()`);
    const baseStroke = await lineStroke('L1');
    const rowPt = async (i) => centerOf(`${W} tr.pt-dim:nth-of-type(${i + 1})`);
    const nthRow = async (i) => evalJs(`(() => { const r = document.querySelectorAll('${W} tr.pt-dim')[${i}].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const hovered = () => evalJs(`(() => { const s = window.__designController.state; return s.constraints.indexOf(s.hoveredConstraint); })()`);
    const selected = () => evalJs(`(() => { const s = window.__designController.state; return JSON.stringify([...s.selectedConstraints].map(c => s.constraints.indexOf(c))); })()`).then(JSON.parse);
    assert.strictEqual(await hovered(), -1, 'nothing hovered yet');
    let p = await nthRow(0); await hover(p.x, p.y);
    assert.strictEqual(await hovered(), 0, 'hovering row d1 sets state.hoveredConstraint (the existing highlight seam)');
    await sleep(300);
    const hoverStroke = await lineStroke('L1');
    assert.notStrictEqual(hoverStroke, baseStroke, `the canvas line it measures is highlighted (${baseStroke} -> ${hoverStroke})`);
    await hover(p.x, p.y - 400); await sleep(200); // pointer leaves the row (onto the canvas area)
    assert.strictEqual(await hovered(), -1, 'leaving the row clears the hover');
    p = await nthRow(1); await click(p.x, p.y);
    assert.deepStrictEqual(await selected(), [1], 'clicking row d2 selects that dimension (state.selectedConstraints)');
    assert.strictEqual((await rows())[1].sel, 'true', 'and the row shows selected');
    await shot('desktop-shaper-row-selected-full.png');
    await clickEl(`${W} tr.pt-dim:nth-of-type(2)`).catch(() => {});
    // canvas selection -> row; canvas hover -> row
    await evalJs(`(() => { const s = window.__designController.state; s.selectedConstraints.clear(); })()`); await sleep(300);
    assert.strictEqual((await rows()).every((x) => x.sel !== 'true'), true, 'clearing the canvas selection clears the rows');
    const labelPt = (idx) => evalJs(`(() => { const e = document.querySelector('#design-canvas .dim-label[data-constraint-idx="${idx}"]'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    let lp = await labelPt(2); assert(lp, 'the radius label is on the canvas');
    await clickEl('#tool-select');
    await hover(lp.x, lp.y); await sleep(300);
    assert.strictEqual(await hovered(), 2, 'hovering the radius label on the canvas hovers the constraint');
    assert(/pt-hover/.test((await rows())[2].cls), 'and its row is lit: ' + (await rows())[2].cls);
    await click(lp.x, lp.y);
    assert.deepStrictEqual(await selected(), [2], 'clicking the label on the canvas selects the constraint');
    assert.strictEqual((await rows())[2].sel, 'true', 'and its row shows selected');
    // live: add / delete / undo through the state
    await evalJs(`(() => { const s = window.__designController.state; s.saveState('t'); s.constraints.push({ type: 'distance', joints: ['b', 'c'], value: 12, name: 'd5', isDriven: false, glyphPos: { x: 0, y: 0 } }); })()`);
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 5`, 'the fifth row to appear');
    await evalJs(`(() => { const s = window.__designController.state; s.constraints.pop(); })()`);
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 4`, 'the row to go');
    // the window follows its Design tab: another Shaper tab hides it, coming back shows it
    await clickEl('[data-mode="prepare"]'); await sleep(600);
    assert.strictEqual(await winOpen(), false, 'on another Shaper tab the window is not over it');
    await clickEl('[data-mode="design"]'); await sleep(600);
    assert.strictEqual(await winOpen(), true, 'back on Design the window is back');
    await shot('desktop-shaper-window.png', await winClip());
    // Shaper at 390 px
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    const sh = await rect(W);
    assert(sh && sh.l === 0 && sh.r === 390 && sh.b === 800, `Shaper at 390 px: a full-width bottom sheet ${JSON.stringify(sh)}`);
    assert.strictEqual(await evalJs(`document.documentElement.scrollWidth <= 390`), true, 'Shaper: no page overflow at 390 px');
    await shot('narrow-390-shaper-sheet.png', { l: 0, t: 0, w: 390, h: 800 });
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    await key('Escape', 'Escape', 27);

    // ================================================================== D. Pen Plotter
    await navigate(url('/apps/penplotter/index.html'), 8000);
    await waitFor(`!!window.__sketch && !!document.getElementById('btn-parameters')`, 'Pen Plotter Design with its Parameters button');
    await sleep(1000);
    await clickEl('.stage-btn[data-stage="design"]'); await sleep(500);
    assert.deepStrictEqual(await btnState(), { label: 'Parameters', pressed: 'false', popup: 'dialog', title: 'Parameters (fx)' }, 'Pen Plotter: the same declared button');
    await evalJs(`(() => {
      const st = window.__sketch.controller.state;
      st.clearDocument(); // the shared autosave buffer carried the Shaper drawing over
      st.joints.set('pa', { x: 0, y: 0 }); st.joints.set('pb', { x: 30, y: 0 });
      st.shapes.push({ id: 'PL1', type: 'line', joints: ['pa', 'pb'] });
      st.constraints.push({ type: 'distance', joints: ['pa', 'pb'], value: 30, name: 'd1' });
    })()`);
    await clickEl('#btn-parameters');
    assert.strictEqual(await winOpen(), true, 'Pen Plotter: the button opens the window');
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 1`, 'the Pen Plotter dimension row');
    r = await rows(); assert.deepStrictEqual([r[0].name, r[0].cells[2]], ['d1', '30.0'], 'Pen Plotter row: ' + JSON.stringify(r));
    const pr = await rect(W); const prb = await rect('#design-ribbon .sk-ribbon');
    assert(pr.t >= prb.b, `Pen Plotter: the window does not overlap the ribbon (${pr.t} >= ${prb.b})`);
    await shot('desktop-penplotter-window.png', await winClip());
    await key('Escape', 'Escape', 27);
    await clickEl('.stage-btn[data-stage="toolpath"]'); await sleep(500);
    assert.strictEqual(await evalJs(`!!document.getElementById('btn-parameters') && document.getElementById('btn-parameters').offsetParent === null`), true, 'the Design ribbon is hidden on the Toolpath stage');

    // ================================================================== A. Trace has NO button
    await navigate(url('/apps/trace/index.html'), 8000);
    await waitFor(`!!document.querySelector('.tr-tab[data-tab="edit"]')`, 'Trace to load');
    await clickEl('.tr-tab[data-tab="edit"]');
    await waitFor(`!!document.querySelector('#design-ribbon .sk-ribbon #tool-line')`, 'the Trace Edit ribbon to mount');
    assert.strictEqual(await evalJs(`!!document.getElementById('btn-parameters')`), false, 'Trace: no Parameters button (declared opt-out)');
    assert.strictEqual(await evalJs(`!!document.querySelector('${W}')`), false, 'Trace: no Parameters window either');
    assert.strictEqual(await evalJs(`!!document.querySelector('#design-ribbon #btn-lock') && !!document.querySelector('#design-ribbon #tool-dim')`), true, 'the rest of the shared Inspect group is there');
    console.log('parameters-window-live: ok');
  } finally {
    await cdp.close();
  }
})();
process.exit(0);
