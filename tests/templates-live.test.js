// tests/templates-live.test.js -- TASK 651 / 668 (owner rulings): the bank of template drawings in the REAL pages, real mouse and real touch.
// ONE modal opened from three places (the sidebar's Templates..., the "+" tab button, the menu's New design): Blank design first and focused, then every
// template as a card with a non-empty SVG preview whose dimension labels do not overlap each other or the shape; ONE click/tap on a card opens a new
// unsaved tab named after the template; the "Blank design" card makes the empty Untitled; Esc / a press outside / the X make no new design; Undo leaves
// the starting drawing. Phone: full-screen, two cards per row. EVIDENCE_DIR: cropped screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { TEMPLATES } from '#core/templates.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '651', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const shot = async (name, sel) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = await evalJs(`(() => { const e = document.querySelector('${sel}'); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const url = (h) => `http://127.0.0.1:${port}/apps/${h}/index.html`;
  const center = async (sel, i = 0) => {
    const c = await evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    assert(c, sel + ' #' + i + ' not found'); return c;
  };
  const mouse = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
  };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(350); };
  let pointer = mouse;
  const press = async (sel, i = 0) => { await evalJs(`document.querySelectorAll('${sel}')[${i}].scrollIntoView({ block: 'nearest', inline: 'nearest' })`); await sleep(80); const c = await center(sel, i); await pointer(c.x, c.y); };
  const shapes = () => evalJs(`document.querySelectorAll('svg .shape-elem').length`);
  const tabNames = () => evalJs(`[...document.querySelectorAll('.sk-doctab-name')].map((e) => e.textContent)`);
  const modalOpen = () => evalJs(`!!document.querySelector('.sk-tp')`);
  const cards = () => evalJs(`[...document.querySelectorAll('.sk-tp-card')].map((c) => ({ id: c.dataset.template, name: c.querySelector('.sk-tp-name').textContent, desc: c.querySelector('.sk-tp-desc').textContent, kids: c.querySelectorAll('svg *').length, svgBox: (() => { const s = c.querySelector('svg'); if (!s) return null; const r = s.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() }))`);
  const checkLabelsClear = async (where) => {
    const report = await evalJs(`(() => {
      const ov = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      return [...document.querySelectorAll('.sk-tp-card[data-template]')].filter((c) => c.dataset.template !== 'blank').map((c) => {
        const texts = [...c.querySelectorAll('svg text')].map((t) => { const r = t.getBoundingClientRect(); return { text: t.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
        const labelOverlaps = [];
        for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) if (ov(texts[i], texts[j])) labelOverlaps.push([texts[i].text, texts[j].text]);
        const body = c.querySelector('svg g');
        const br = body.getBoundingClientRect();
        const bodyRect = { left: br.left, right: br.right, top: br.top, bottom: br.bottom };
        const insideBodyBbox = texts.filter((t) => ov(t, bodyRect)).map((t) => t.text);
        return { id: c.dataset.template, count: texts.length, labelOverlaps, insideBodyBbox };
      });
    })()`);
    for (const r of report) {
      assert.strictEqual(r.labelOverlaps.length, 0, `${where} ${r.id}: preview labels must not overlap each other (${JSON.stringify(r.labelOverlaps)})`);
      if (r.id === 'hexagon') {
        assert.strictEqual(r.insideBodyBbox.length, 0, `${where} ${r.id}: labels must sit outside the shape (${JSON.stringify(r.insideBodyBbox)})`);
      }
      if (r.id === 'bolt-circle') {
        assert.strictEqual(r.count, 3, `${where} bolt-circle: has 3 labels`);
        const insideCircle = await evalJs(`(() => {
          const card = document.querySelector('.sk-tp-card[data-template="bolt-circle"]');
          const c = card.querySelector('svg g:first-child circle:not([stroke-dasharray])');
          const cr = c.getBoundingClientRect();
          const cx = (cr.left + cr.right) / 2, cy = (cr.top + cr.bottom) / 2, rad = cr.width / 2;
          return [...card.querySelectorAll('svg text')].filter((t) => {
            const tr = t.getBoundingClientRect();
            const nx = Math.max(tr.left, Math.min(cx, tr.right)), ny = Math.max(tr.top, Math.min(cy, tr.bottom));
            return Math.hypot(nx - cx, ny - cy) <= rad;
          }).map((t) => t.textContent);
        })()`);
        assert.strictEqual(insideCircle.length, 0, `${where} bolt-circle: labels must sit outside the outer circle (${JSON.stringify(insideCircle)})`);
      }
      if (r.id === 'star') {
        assert.strictEqual(r.count, 2, `${where} star: has 2 labels`);
        // star's concave shape bbox includes empty outer quadrants, so check each label rect against each solid star edge segment
        const hitEdge = await evalJs(`(() => {
          const card = document.querySelector('.sk-tp-card[data-template="star"]');
          const svg = card.querySelector('svg');
          const ctm = svg.getScreenCTM();
          const pt = (x, y) => ({ x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f });
          const segHitsRect = (p, q, r) => {
            let t0 = 0, t1 = 1;
            const dx = q.x - p.x, dy = q.y - p.y;
            for (const [P, Q] of [[-dx, p.x - r.left], [dx, r.right - p.x], [-dy, p.y - r.top], [dy, r.bottom - p.y]]) {
              if (P === 0) { if (Q < 0) return false; }
              else { const t = Q / P; if (P < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
            }
            return t0 <= t1;
          };
          const edges = [...card.querySelectorAll('svg g:first-child line:not([stroke-dasharray])')].map((l) => [pt(+l.getAttribute('x1'), +l.getAttribute('y1')), pt(+l.getAttribute('x2'), +l.getAttribute('y2'))]);
          return [...card.querySelectorAll('svg text')].filter((t) => { const r = t.getBoundingClientRect(); return edges.some(([p, q]) => segHitsRect(p, q, r)); }).map((t) => t.textContent);
        })()`);
        assert.strictEqual(hitEdge.length, 0, `${where} star: labels must not overlap the star edges (${JSON.stringify(hitEdge)})`);
      }
    }
  };
  const openMenu = async () => {
    const c = await evalJs(`(() => { const e = [...document.querySelectorAll('.sk-sidebar-btn, .sk-sidebar-handle')].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(c, 'menu trigger not found'); await pointer(c.x, c.y); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
  };
  const expectedOrder = ['blank', ...TEMPLATES.map((t) => t.id)];
  try {
    // ---- desktop, mouse ----
    await navigate(url('sketchstudio'), 10000);
    await resetBufferLive(cdp); // the profile is reused between runs: start from one Untitled tab
    await navigate(url('sketchstudio'), 10000);
    await waitFor(`!!document.querySelector('.sk-doctabs') && document.querySelectorAll('.sk-doctab-name').length === 1`, 'the strip');
    assert.deepStrictEqual(await tabNames(), ['Untitled']);

    // 1. the sidebar's Templates...: Blank first and focused, then every template with non-overlapping preview labels
    await openMenu();
    await press('[data-action="templates"]');
    await waitFor(`!!document.querySelector('.sk-tp-card')`, 'the template modal');
    let cs = await cards();
    assert.deepStrictEqual(cs.map((c) => c.id), expectedOrder, 'Templates...: Blank first, then every template of the bank');
    for (const c of cs.slice(1)) { assert(c.kids > 3 && c.svgBox[0] > 150 && c.svgBox[1] > 100, `${c.id}: a large preview drawn as SVG (${c.kids} elements, ${c.svgBox})`); assert(c.name && c.desc, c.id + ': name and one-line description'); }
    assert.strictEqual(await evalJs(`document.activeElement.dataset.template`), 'blank', 'Templates...: the Blank card has focus');
    await checkLabelsClear('desktop');
    await shot('desktop-modal.png', '.sk-tp');
    // 2. Esc closes: no new design
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    assert.strictEqual(await modalOpen(), false, 'Esc closes the modal');
    assert.deepStrictEqual(await tabNames(), ['Untitled'], 'Esc: no new design');
    // 3. ONE click on a card opens it immediately as a new tab named after the template, with its drawing, unsaved
    await openMenu(); await press('[data-action="templates"]'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal');
    await press('.sk-tp-card[data-template="slot"]');
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 2`, 'a new tab on one click');
    assert.strictEqual(await modalOpen(), false, 'the modal closed on one click');
    assert.deepStrictEqual(await tabNames(), ['Untitled', 'Slot'], 'the new tab is named after the template');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent`), 'Slot');
    await waitFor(`document.querySelectorAll('svg .shape-elem').length >= 4`, 'the slot drawn');
    const slotShapes = await shapes();
    assert.strictEqual(slotShapes, 4, 'the slot: two lines and two arcs');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot')`), true, 'the template design is unsaved (the not-saved dot)');
    await sleep(1200); await shot('opened-slot.png', 'body');
    // Undo does not remove the starting drawing (it is the document it began as, not an edit)
    await sendRealKey(send, 'z', 'KeyZ', 90, 2); await sleep(300);
    assert.strictEqual(await shapes(), slotShapes, 'Undo on a fresh template design leaves it');

    // 4. "+": the same modal with Blank first and focused; Enter = the empty Untitled tab
    await press('.sk-doctab-new');
    await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal from +');
    cs = await cards();
    assert.deepStrictEqual(cs.map((c) => c.id), expectedOrder, '"+": Blank design first, then every template');
    assert.strictEqual(await evalJs(`document.activeElement.dataset.template`), 'blank', 'the Blank card has focus');
    await shot('desktop-new-design-modal.png', '.sk-tp');
    await sendRealKey(send, 'Enter', 'Enter', 13, 0, String.fromCharCode(13)); await sleep(500);
    assert.deepStrictEqual(await tabNames(), ['Untitled', 'Slot', 'Untitled'], 'Enter on Blank: the empty Untitled tab');
    assert.strictEqual(await shapes(), 0, 'it is empty');
    // "+" -> a press outside closes it (no new design)
    await press('.sk-doctab-new'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal');
    await pointer(8, 400); await sleep(300);
    assert.strictEqual(await modalOpen(), false, 'a press outside closes it');
    assert.strictEqual((await tabNames()).length, 3, 'outside press: no new design');
    // "+" -> the X
    await press('.sk-doctab-new'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal');
    await press('.sk-tp-x'); await sleep(300);
    assert.strictEqual(await modalOpen(), false, 'the X closes it');
    assert.strictEqual((await tabNames()).length, 3, 'X: no new design');
    // "+" -> ONE click on a template -> a new tab holding it
    await press('.sk-doctab-new'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal');
    await press('.sk-tp-card[data-template="bolt-circle"]');
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 4`, 'the tab on one click');
    assert.deepStrictEqual(await tabNames(), ['Untitled', 'Slot', 'Untitled', 'Bolt circle']);
    await waitFor(`document.querySelectorAll('svg .shape-elem').length >= 8`, 'the bolt circle drawn');
    // the menu's New design: the same modal, Blank first
    await openMenu(); await press('[data-action="new-design"]'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal from New design');
    assert.deepStrictEqual((await cards()).map((c) => c.id), expectedOrder, 'New design: Blank first, then every template');
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    assert.strictEqual((await tabNames()).length, 4, 'Esc: no new design');

    // ---- the other three hosts: the same item, the same modal ----
    for (const host of ['shaper', 'penplotter', 'trace']) {
      await navigate(url(host), 10000);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn, .sk-sidebar-handle')`, host + ': menu');
      await sleep(600);
      await openMenu(); await press('[data-action="templates"]');
      await waitFor(`!!document.querySelector('.sk-tp-card')`, host + ': the modal');
      cs = await cards();
      assert.deepStrictEqual(cs.map((c) => c.id), expectedOrder, host + ': Blank first, then every template');
      assert(cs.slice(1).every((c) => c.kids > 3), host + ': every preview is drawn');
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    }

    // ---- phone, real touch ----
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await navigate(url('sketchstudio'), 10000);
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 1 && !!document.querySelector('.sk-doctab-new')`, 'phone: the strip');
    await press('.sk-doctab-new'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'phone: modal');
    const box = await evalJs(`(() => { const r = document.querySelector('.sk-tp').getBoundingClientRect(); const c = [...document.querySelectorAll('.sk-tp-card')].map((e) => Math.round(e.getBoundingClientRect().top)); return { w: r.width, h: r.height, perRow: c.filter((t) => t === c[0]).length }; })()`);
    assert(box.w === 390 && box.h === 844, 'phone: the modal is full-screen ' + JSON.stringify(box));
    assert.strictEqual(box.perRow, 2, 'phone: two cards per row');
    await checkLabelsClear('phone');
    await shot('phone-modal.png', '.sk-tp');
    // ONE tap opens a template as a new design
    await press('.sk-tp-card[data-template="l-bracket"]');
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 2`, 'phone: a new tab on one tap');
    assert.deepStrictEqual(await tabNames(), ['Untitled', 'L-bracket']);
    await waitFor(`document.querySelectorAll('svg .shape-elem').length >= 8`, 'phone: the bracket drawn');
    await shot('phone-opened.png', 'body');
    // Phone sidebar Templates...: Blank first, ONE tap opens Star
    await openMenu(); await press('[data-action="templates"]'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'phone: Templates...');
    assert.strictEqual((await cards())[0].id, 'blank', 'phone Templates...: Blank first');
    await press('.sk-tp-card[data-template="star"]');
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 3`, 'phone: Star tab on one tap');
    assert.deepStrictEqual(await tabNames(), ['Untitled', 'L-bracket', 'Star']);
    await waitFor(`document.querySelectorAll('svg .shape-elem').length >= 10`, 'phone: the star drawn');
    console.log('templates-live: ok');
  } finally { await cdp.close(); }
})();
