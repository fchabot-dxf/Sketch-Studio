// tests/offset-fusion-match-667-live.test.js -- TASK 667 live CDP browser test (mouse 1600x900 + touch 390x844 in Pen Plotter Design tab).
// Tests:
// 1. Offset tool exits to Select on OK (Enter on desktop, green check .sk-done on touch).
// 2. Deleting an offset dimension (Delete key on desktop, long-press -> #dim-delete on touch) hides the dim label while keeping
//    the offset constraint with `dimensioned: false` and free scalar unknown `d`.
// 3. Dragging an undimensioned offset copy outward updates `d` and keeps ALL offset pieces uniformly at the same `d`.
// 4. Dragging an undimensioned offset copy inward across its source refuses `d <= 0` and stops before crossing.
// 5. Re-adding a dimension between a parallel source + copy line via the Dimension tool restores the driving dimension (`dimensioned !== false`)
//    and snaps the entire offset chain to the new value; Undo/Redo restores/re-removes cleanly.
// Screenshots saved to .evidence/667/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '667');
const STATE = 'window.__sketch.controller.state';
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

await (async () => {
  const cdp = await launchBrowser({ tag: '667', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => {
      const r = await send('Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip: { x: Math.max(0, clip.x), y: Math.max(0, clip.y), width: Math.max(10, clip.width), height: Math.max(10, clip.height), scale: 1 } } : {}),
      });
      fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
    };
    const key = async (k, code, vk) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
      await sleep(250);
    };
    const typeIn = async (id, text) => {
      await evalJs(`(() => { const i = document.getElementById('${id}'); i.focus(); i.select(); })()`);
      for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await sleep(200);
    };
    const mouse = (type, x, y, buttons, button = 'left') =>
      send('Input.dispatchMouseEvent', {
        type, x, y,
        button: type === 'mouseMoved' && !buttons ? 'none' : button,
        buttons,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      });
    const T = (type, pts) =>
      send('Input.dispatchTouchEvent', {
        type,
        touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1, radiusX: 1, radiusY: 1, force: 1 })),
      });

    const pointers = {
      mouse: {
        tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(260); },
        hover: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(150); },
        rightClick: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 2, 'right'); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 'right'); await sleep(260); },
        drag: async (from, to, steps = 12) => {
          await mouse('mouseMoved', from.x, from.y, 0); await sleep(60);
          await mouse('mousePressed', from.x, from.y, 1); await sleep(60);
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            await mouse('mouseMoved', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 1);
            await sleep(30);
          }
          await mouse('mouseReleased', to.x, to.y, 0); await sleep(260);
        },
      },
      touch: {
        tap: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); },
        hover: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); },
        longPress: async (p) => { await T('touchStart', [p]); await sleep(650); await T('touchEnd', []); await sleep(300); },
        drag: async (from, to, steps = 12) => {
          await T('touchStart', [from]); await sleep(60);
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            await T('touchMove', [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }]);
            await sleep(30);
          }
          await T('touchEnd', []); await sleep(300);
        },
      },
    };

    const currentTool = () => evalJs(`${STATE}.currentTool`);
    const lines = () => evalJs(`JSON.stringify(${STATE}.shapes.filter((s) => s.type === 'line').map((s) => ({ id: s.id, fixed: !!s.fixed, joints: s.joints, a: ${STATE}.joints.get(s.joints[0]), b: ${STATE}.joints.get(s.joints[1]) })))`).then(JSON.parse);
    const offsets = () => evalJs(`JSON.stringify(${STATE}.constraints.map((c, idx) => ({ idx, type: c.type, shapes: c.shapes, pairs: c.pairs, value: c.value, dimensioned: c.dimensioned })).filter((c) => c.type === 'offset'))`).then(JSON.parse);
    const dimLabelCount = () => evalJs(`document.querySelectorAll('.dim-label').length`);
    const dimLabelPos = (idx) => evalJs(`(() => { const el = document.querySelector('.dim-label[data-constraint-idx="' + ${idx} + '"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const toScreen = (w) => evalJs(`(() => { const s = document.querySelector('#design-canvas'); const p = s.createSVGPoint(); p.x = ${w.x}; p.y = ${w.y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
    const centerOf = (sel) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const mid = (l) => ({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 });
    const quarter = (l) => ({ x: l.a.x * 0.75 + l.b.x * 0.25, y: l.a.y * 0.75 + l.b.y * 0.25 });
    const distLineToLine = (src, copy) => {
      const dx = src.b.x - src.a.x, dy = src.b.y - src.a.y, len = Math.hypot(dx, dy);
      return [copy.a, copy.b].map((p) => Math.abs((p.x - src.a.x) * dy - (p.y - src.a.y) * dx) / len);
    };
    const clipForLines = async () => {
      const ls = await lines();
      const xs = ls.flatMap((l) => [l.a.x, l.b.x]), ys = ls.flatMap((l) => [l.a.y, l.b.y]);
      const p0 = await toScreen({ x: Math.min(...xs), y: Math.min(...ys) });
      const p1 = await toScreen({ x: Math.max(...xs), y: Math.max(...ys) });
      return {
        x: Math.min(p0.x, p1.x) - 100,
        y: Math.min(p0.y, p1.y) - 90,
        width: Math.abs(p1.x - p0.x) + 200,
        height: Math.abs(p1.y - p0.y) + 180,
      };
    };

    const run = async (kind) => {
      const P = pointers[kind];
      const tag = `[${kind}]`;
      if (kind === 'touch') {
        await evalJs(`localStorage.clear(); sessionStorage.clear();`);
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
      await Promise.race([loaded, sleep(8000)]);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, `${tag} design tab`);
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, `${tag} design canvas`);
      await evalJs(`if (${STATE}.shapes.length > 0 && window.__sketch?.controller?.clearDocument) window.__sketch.controller.clearDocument();`);
      await sleep(500);

      const tool = (id) => pressRibbonTool(evalJs, P.tap, id).then(() => sleep(200));
      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const M = { x: cr.l + cr.w * 0.5, y: cr.t + cr.h * 0.5 };
      const hw = Math.min(cr.w * 0.14, 90), hh = Math.min(cr.h * 0.11, 65);

      // 1. Draw a 2-point rectangle and lock two adjacent sides (left + bottom) so source stays anchored while testing copy drags.
      await tool('tool-rect');
      await waitFor(`!!document.querySelector('.sk-ribbon-menu.show [data-mode="rect-2pt"]')`, `${tag} Rect 2pt`);
      await P.tap(await centerOf('.sk-ribbon-menu.show [data-mode="rect-2pt"]'));
      await P.tap({ x: M.x - hw, y: M.y - hh });
      await P.tap({ x: M.x + hw, y: M.y + hh });
      await key('Escape', 'Escape', 27);
      const srcRect = await lines();
      assert.strictEqual(srcRect.length, 4, `${tag} source rectangle has 4 sides`);
      const srcIds = new Set(srcRect.map((l) => l.id));
      const srcVertical = srcRect.filter((l) => near(l.a.x, l.b.x, 1e-4)).sort((a, b) => a.a.x - b.a.x);
      const srcHoriz = srcRect.filter((l) => near(l.a.y, l.b.y, 1e-4)).sort((a, b) => a.a.y - b.a.y);
      const srcLeft = srcVertical[0], srcRight = srcVertical[1];
      const hWithSc = await Promise.all(srcHoriz.map(async (l) => ({ l, sy: (await toScreen(mid(l))).y })));
      hWithSc.sort((a, b) => a.sy - b.sy);
      const srcTop = hWithSc[0].l, srcBottom = hWithSc[1].l;

      // Dimension width & height of source rect so source doesn't collapse on drags.
      const dimensionSide = async (side, dx, dy, val) => {
        await tool('tool-dim');
        const m = await toScreen(mid(side));
        await P.tap(m);
        const place = { x: m.x + dx, y: m.y + dy };
        await P.hover(place);
        await P.tap(place);
        await waitFor(`!!document.getElementById('dimInput')`, `${tag} dimInput`);
        await typeIn('dimInput', val);
        await key('Enter', 'Enter', 13);
        await sleep(250);
        await key('Escape', 'Escape', 27);
      };
      await dimensionSide(srcRight, 40, 0, '30');
      await dimensionSide(srcBottom, 0, 35, '40');

      // Lock srcLeft & srcBottom via context menu (rightClick on mouse, longPress on touch) so the source rect is pinned.
      await tool('tool-select');
      const lockSide = async (side) => {
        const sNow = (await lines()).find((l) => l.id === side.id);
        const p = await toScreen(mid(sNow));
        if (kind === 'mouse') { await P.tap(p); await P.rightClick(p); }
        else await P.longPress(p);
        await waitFor(`!!document.querySelector('.sk-context-item[data-id="geo-lock"]')`, `${tag} [data-id="geo-lock"] menu item`);
        await P.tap(await centerOf('.sk-context-item[data-id="geo-lock"]'));
        await sleep(200);
      };
      await lockSide(srcLeft);
      await lockSide(srcBottom);

      // 2. Offset outside by 8 mm, commit with Enter (mouse) or green check .sk-done (touch) -> tool must switch to Select.
      await tool('tool-offset');
      assert.strictEqual(await currentTool(), 'offset', `${tag} entered offset tool`);
      const topNow = (await lines()).find((l) => l.id === srcTop.id);
      const topMidSc = await toScreen(mid(topNow));
      await P.tap(topMidSc);
      await waitFor(`!!document.getElementById('offset-distance-input')`, `${tag} offset distance input`);
      const outSc = { x: topMidSc.x, y: topMidSc.y - 60 };
      await P.hover(outSc);
      await typeIn('offset-distance-input', '8');
      if (kind === 'mouse') {
        await key('Enter', 'Enter', 13);
      } else {
        await waitFor(`(() => { const b = document.querySelector('.sk-done'); return b && !b.hidden; })()`, `${tag} green check .sk-done`);
        await P.tap(await centerOf('.sk-done'));
      }
      await sleep(300);
      assert.strictEqual(await currentTool(), 'select', `${tag} OK ends Offset tool -> returns to select`);
      let offs = await offsets();
      assert.strictEqual(offs.length, 1, `${tag} 1 offset constraint created`);
      assert.strictEqual(offs[0].value, 8, `${tag} offset constraint value = 8`);
      assert.notStrictEqual(offs[0].dimensioned, false, `${tag} offset starts dimensioned`);
      const dimLabelsBefore = await dimLabelCount();
      assert(await dimLabelPos(offs[0].idx), `${tag} offset dim label rendered before delete`);
      await shot(`${kind}-1-before-delete.png`, await clipForLines());

      // 3. Delete ONLY the offset dimension (Delete key on mouse, long-press -> #dim-delete on touch).
      const labPos = await dimLabelPos(offs[0].idx);
      if (kind === 'mouse') {
        await P.tap(labPos);
        await key('Delete', 'Delete', 46);
      } else {
        await P.longPress(labPos);
        await waitFor(`!!document.querySelector('.sk-context-item[data-id="dim-delete"]')`, `${tag} [data-id="dim-delete"] menu item`);
        await P.tap(await centerOf('.sk-context-item[data-id="dim-delete"]'));
      }
      await sleep(300);
      offs = await offsets();
      assert.strictEqual(offs.length, 1, `${tag} offset constraint KEPT after dimension delete`);
      assert.strictEqual(offs[0].dimensioned, false, `${tag} offset constraint marked dimensioned: false`);
      assert.strictEqual(await dimLabelPos(offs[0].idx), null, `${tag} offset dim label removed from DOM`);
      assert.strictEqual(await dimLabelCount(), dimLabelsBefore - 1, `${tag} dim label count decreased by 1`);

      // 4. Drag ONE copy side outward -> distance `d` increases AND all 4 copy sides maintain the exact same `d`.
      const pairIdx = offs[0].shapes.indexOf(srcTop.id);
      const copyTopId = pairIdx >= 0 ? offs[0].shapes[pairIdx + 1] : null;
      assert(copyTopId, `${tag} found copy line paired with srcTop`);
      const copyTop = () => lines().then((ls) => ls.find((l) => l.id === copyTopId));
      const ct0 = await copyTop();
      const ctMid0 = await toScreen(quarter(ct0));
      const srcTopMid0 = await toScreen(quarter(topNow));
      const outDirScY = Math.sign(ctMid0.y - srcTopMid0.y) || -1;
      const dragOutPx = kind === 'mouse' ? 45 : 35;
      await P.drag(ctMid0, { x: ctMid0.x, y: ctMid0.y + outDirScY * dragOutPx });
      await sleep(250);
      offs = await offsets();
      const dAfterOut = offs[0].value;
      assert(dAfterOut > 10, `${tag} dragging undimensioned offset outward increased d (got ${dAfterOut.toFixed(3)} mm)`);
      const allNow = await lines();
      for (let k = 0; k < offs[0].shapes.length; k += 2) {
        const sLine = allNow.find((l) => l.id === offs[0].shapes[k]);
        const cLine = allNow.find((l) => l.id === offs[0].shapes[k + 1]);
        const ds = distLineToLine(sLine, cLine);
        assert(near(ds[0], dAfterOut, 0.05) && near(ds[1], dAfterOut, 0.05),
          `${tag} piece ${cLine.id} maintains uniform d=${dAfterOut.toFixed(3)}: got ${JSON.stringify(ds)}`);
      }
      await shot(`${kind}-2-after-drag-out.png`, await clipForLines());

      // 5. Drag the copy line inward across the source top line -> d stays > 0, never crosses!
      const ctNow = await copyTop();
      const ctMid1 = await toScreen(quarter(ctNow));
      const srcTopNow = (await lines()).find((l) => l.id === srcTop.id);
      const srcTopMid = await toScreen(quarter(srcTopNow));
      // Target well past srcTop toward the opposite side of the source rectangle.
      await P.drag(ctMid1, { x: ctMid1.x, y: srcTopMid.y - outDirScY * 80 }, 16);
      await sleep(250);
      offs = await offsets();
      const dAfterCross = offs[0].value;
      assert(dAfterCross > 0, `${tag} crossing drag kept d > 0 (got ${dAfterCross.toFixed(3)})`);
      const ctAfterCross = await copyTop();
      const ctAfterMidSc = await toScreen(mid(ctAfterCross));
      assert(Math.sign(ctAfterMidSc.y - srcTopMid.y) === outDirScY,
        `${tag} copy stayed on its outer side (screen y ${ctAfterMidSc.y.toFixed(1)} vs src ${srcTopMid.y.toFixed(1)}, dir=${outDirScY})`);
      await shot(`${kind}-3-after-cross-guard.png`, await clipForLines());

      if (kind === 'mouse') {
        // Drag back outward after the crossing guard so recovery after a rejected drag works AND the lines are >1 px apart to click.
        const ctRec = await copyTop();
        const ctRecSc = await toScreen(quarter(ctRec));
        await P.drag(ctRecSc, { x: ctRecSc.x, y: ctRecSc.y + outDirScY * 35 });
        await sleep(250);
        const dRec = (await offsets())[0].value;
        assert(dRec > dAfterCross + 1, `${tag} post-rejection outward drag recovers cleanly (${dAfterCross.toFixed(2)} -> ${dRec.toFixed(2)} mm)`);

        // 6. Re-add dimension via Dimension tool picking source top + copy top -> drives offset to 14 mm + dim label returns; Undo/Redo works.
        await tool('tool-dim');
        const st2 = (await lines()).find((l) => l.id === srcTop.id);
        const ct2 = await copyTop();
        const st2Sc = await toScreen(mid(st2));
        const ct2Sc = await toScreen(mid(ct2));
        await P.tap(st2Sc);
        await P.tap(ct2Sc);
        const placeReadd = { x: ct2Sc.x + 25, y: (st2Sc.y + ct2Sc.y) / 2 };
        await P.hover(placeReadd);
        await P.tap(placeReadd);
        await waitFor(`!!document.getElementById('dimInput')`, `${tag} dimInput on re-add`);
        await typeIn('dimInput', '14');
        await key('Enter', 'Enter', 13);
        await sleep(300);
        await key('Escape', 'Escape', 27);
        offs = await offsets();
        assert.strictEqual(offs.length, 1, `${tag} still 1 offset constraint after re-adding dim`);
        assert.notStrictEqual(offs[0].dimensioned, false, `${tag} offset constraint restored dimensioned !== false`);
        assert(near(offs[0].value, 14, 1e-4), `${tag} offset distance updated to 14 mm (got ${offs[0].value})`);
        assert(await dimLabelPos(offs[0].idx), `${tag} offset dim label restored in DOM`);
        const allReadd = await lines();
        for (let k = 0; k < offs[0].shapes.length; k += 2) {
          const sLine = allReadd.find((l) => l.id === offs[0].shapes[k]);
          const cLine = allReadd.find((l) => l.id === offs[0].shapes[k + 1]);
          const ds = distLineToLine(sLine, cLine);
          assert(near(ds[0], 14, 0.05) && near(ds[1], 14, 0.05), `${tag} all copy pieces snapped to 14 mm: ${JSON.stringify(ds)}`);
        }
        await shot(`${kind}-4-after-readd-dim.png`, await clipForLines());

        // Undo re-add -> back to undimensioned
        await P.tap(await centerOf('#btn-undo'));
        await sleep(300);
        offs = await offsets();
        assert.strictEqual(offs[0].dimensioned, false, `${tag} undo restored undimensioned state`);
        assert.strictEqual(await dimLabelPos(offs[0].idx), null, `${tag} undo removed restored dim label`);
        // Redo re-add -> back to 14 mm dimensioned
        await P.tap(await centerOf('#btn-redo'));
        await sleep(300);
        offs = await offsets();
        assert.notStrictEqual(offs[0].dimensioned, false, `${tag} redo restored dimensioned state`);
        assert(near(offs[0].value, 14, 1e-4), `${tag} redo restored 14 mm`);

        // Empty the sketch via Undo so the next touch reload starts on a blank document.
        const undoBtn = await centerOf('#btn-undo');
        for (let i = 0; i < 20 && await evalJs(`!document.getElementById('btn-undo').disabled`); i++) {
          await P.tap(undoBtn);
          await sleep(120);
        }
        await sleep(400);
        assert.strictEqual(await evalJs(`${STATE}.shapes.length`), 0, `${tag} sketch emptied before touch pass`);
      }

      console.log(`${tag} ok`);
    };

    await run('mouse');
    await run('touch');
    console.log('offset-fusion-match-667-live.test.js: ok');
  } finally {
    await cdp.close();
  }
})();
