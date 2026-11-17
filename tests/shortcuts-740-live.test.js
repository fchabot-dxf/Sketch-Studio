// tests/shortcuts-740-live.test.js: TASK 740 (live headless, REAL keys and mouse), SketchStudio and Shaper on a desktop (1600 x 1000).
//  A. every ribbon button's title shows its key, read from THE declaration (shortcuts.js): "Line (L)", "Break (Shift+B)", ...; the footer's
//     Parameters button: "Parameters (Shift+P)".
//  B. every ribbon tool and constraint key, pressed from Select, makes that tool the active one (Mirror and both patterns start their pick:
//     a pattern's dialog opens); S brings Select back.
//  C. Ctrl / Alt + a tool letter is the browser's: Ctrl+D, Ctrl+E, Alt+L change no tool and are not cancelled (defaultPrevented false).
//  D. five constraints by key on prepared geometry: H (a selected line becomes horizontal), E (two selected lines equal), T (armed: click,
//     click), Shift+M Midpoint (armed: a point, then a line), Y Symmetric (armed: two points, then a line); each adds its glyph.
//  E. Shift+P opens the Parameters window and Shift+P closes it; P alone is Polygon.
//  F. Settings > Shortcuts lists every ribbon key and the Parameters key with its caps.
// Screenshots: .evidence/740.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { RIBBON_TOOLS } from '#ui/tool-ribbon.js';
import { shortcutById, shortcutHint, comboCaps } from '#ui/shortcuts.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '740');

await (async () => {
  const cdp = await launchBrowser({ tag: '740', width: 1600, height: 1000 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons, mods = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, modifiers: mods });
    const move = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(80); };
    const click = async (p, mods = 0) => { await move(p.x, p.y); await mouse('mousePressed', p.x, p.y, 1, mods); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, mods); await sleep(250); };
    // a real key: the letter (Shift: modifiers 8, the capital), Ctrl 2, Alt 1
    const press = async (ch, { shift = false, ctrl = false, alt = false } = {}) => {
      const up = ch.toUpperCase();
      const mods = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
      const k = shift ? up : ch;
      await sendRealKey(send, k, 'Key' + up, up.charCodeAt(0), mods, ctrl || alt ? '' : k);
      await sleep(250);
    };
    const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27, 0); await sleep(200); };
    const shot = async (file, sel) => {
      const clip = sel ? await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: Math.min(innerWidth, r.width + 16), height: Math.min(innerHeight, r.height + 16) }; })()`) : null;
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) });
      fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
    };
    const goto = async (url, readyExpr) => { const loaded = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` }); await Promise.race([loaded, sleep(8000)]); await waitFor(readyExpr, url + ' ready'); await sleep(800); };
    const HOSTS = {
      sketchstudio: { url: '/apps/sketchstudio/index.html', enter: null, ready: `!!document.querySelector('#svgCanvas') && !!document.getElementById('tool-line')`, canvas: 'svgCanvas' },
      shaper:       { url: '/apps/shaper/index.html', enter: '.sk-header-tab[data-tab="design"]', ready: `!!document.querySelector('.sk-header-tab[data-tab="design"]')`, canvas: 'design-canvas' },
    };
    const btnId = (t) => t.id || (t.tool ? 'tool-' + t.tool : 'action-' + t.action);
    const isActive = (tool) => evalJs(`(() => { const b = document.getElementById('tool-${tool}'); return !!b && b.classList.contains('active'); })()`);
    const activeTools = () => evalJs(`[...document.querySelectorAll('.sk-ribbon-btn.active')].map((b) => b.id)`);
    const toSelect = async () => { for (let i = 0; i < 4 && !(await isActive('select')); i++) await esc(); assert.strictEqual(await isActive('select'), true, 'Esc brings Select back: ' + JSON.stringify(await activeTools())); };
    const keyOf = (id) => { const c = shortcutById(id).keys[0]; return { ch: c.key, shift: c.shift === true }; };
    const glyphs = (canvas, type) => evalJs(`document.querySelectorAll('#${canvas} .constraint-glyph[data-ctype="${type}"]').length`);
    const scene = (canvas) => evalJs(`({ shapes: document.querySelectorAll('#${canvas} [data-shape-id]').length, glyphs: [...document.querySelectorAll('#${canvas} .constraint-glyph')].map((g) => g.dataset.ctype), selected: !document.getElementById('btn-delete-selection').disabled, tools: [...document.querySelectorAll('.sk-ribbon-btn.active')].map((b) => b.id) })`);

    for (const name of Object.keys(HOSTS)) {
      const h = HOSTS[name];
      await resetBufferLive(cdp); // TASK 684: the open tabs are ONE list for all apps: every phase starts on a fresh Untitled
      await goto(h.url, h.ready);
      if (h.enter) { await evalJs(`document.querySelector(${JSON.stringify(h.enter)}).click()`); await sleep(800); }
      await waitFor(`!!document.getElementById('${h.canvas}') && document.getElementById('${h.canvas}').getBoundingClientRect().width > 100 && !!document.getElementById('tool-line')`, name + ' canvas');
      await sleep(400);
      const mine = RIBBON_TOOLS.filter((t) => shortcutById(t.shortcut).hosts.includes(name));

      // ── A. titles ──
      const titles = await evalJs(`(${JSON.stringify(mine.map(btnId))}).map((id) => { const b = document.getElementById(id); return [id, b ? b.title : null]; })`);
      const want = mine.map((t) => [btnId(t), `${t.title || t.label} (${shortcutHint(t.shortcut, { mac: false })})`]);
      assert.deepStrictEqual(titles, want, name + ': every ribbon button title shows its key');
      assert.strictEqual(await evalJs(`document.getElementById('btn-parameters').title`), 'Parameters (Shift+P)', name + ': the Parameters button title');
      fs.writeFileSync(path.join(EVID, `${name}-titles.json`), JSON.stringify(titles, null, 1));
      if (name === 'shaper') assert(titles.some(([id, t]) => id === 'btn-combine' && t === 'Combine Shapes (Ctrl+Shift+C)'), 'Shaper: Combine keeps its Ctrl+Shift+C title, now from the table');
      console.log(name, 'A ok:', titles.length, 'titles, e.g.', titles.slice(0, 3).map((x) => x[1]).join(' | '));

      // ── B. every tool / constraint key, from Select ──
      const tools = mine.filter((t) => t.tool && t.tool !== 'select');
      for (const t of tools) {
        await toSelect();
        const k = keyOf(t.shortcut);
        await press(k.ch, { shift: k.shift });
        assert.strictEqual(await isActive(t.tool), true, `${name}: ${k.shift ? 'Shift+' : ''}${k.ch.toUpperCase()} makes ${t.tool} the active tool: ` + JSON.stringify(await activeTools()));
        if (t.tool === 'circularPattern' || t.tool === 'rectangularPattern') {
          assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-pattern-dialog').length + ':' + [...document.querySelectorAll('.sk-pattern-dialog')].filter((e) => e.getBoundingClientRect().width > 0).length`), '1:1', `${name}: ${t.tool} opened ONE pattern dialog (its begin ran once)`);
          if (t.tool === 'circularPattern') await shot(`${name}-key-U-circular-pattern.png`);
        }
        if (t.tool === 'mirror') await shot(`${name}-key-M-mirror-ribbon.png`, '.sk-ribbon');
      }
      await toSelect();
      await press('l'); assert.strictEqual(await isActive('line'), true, name + ': L = Line');
      await press('s'); assert.strictEqual(await isActive('select'), true, name + ': S = Select');
      console.log(name, 'B ok:', tools.length, 'tool / constraint keys each made their tool active');

      // ── C. Ctrl / Alt + a letter is the browser's ──
      await evalJs(`(() => { window.addEventListener('keydown', (e) => { document.body.dataset.t740 = (document.body.dataset.t740 || '') + e.key + ':' + e.defaultPrevented + ';'; }); })()`);
      await press('d', { ctrl: true }); await press('e', { ctrl: true }); await press('l', { alt: true });
      assert.strictEqual(await isActive('select'), true, name + ': Ctrl+D / Ctrl+E / Alt+L switch no tool: ' + JSON.stringify(await activeTools()));
      assert.strictEqual(await evalJs(`document.body.dataset.t740`), 'd:false;e:false;l:false;', name + ': and none is cancelled');
      await press('d'); assert.strictEqual(await isActive('dim'), true, name + ': D alone is still Dimension');
      await toSelect();
      console.log(name, 'C ok: Ctrl+D, Ctrl+E, Alt+L go to the browser; D is Dimension');

      // ── D. five constraints by key ──
      const o = await evalJs(`(() => { const s = document.getElementById('${h.canvas}'); const p = s.createSVGPoint(); p.x = 0; p.y = 0; const q = p.matrixTransform(s.getScreenCTM()); const r = s.getBoundingClientRect(); return { x: Math.round(q.x), y: Math.round(q.y), l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
      const at = (dx, dy) => { const p = { x: o.x + dx, y: o.y + dy }; assert(p.x > o.l + 10 && p.x < o.r - 10 && p.y > o.t + 10 && p.y < o.b - 10, `${name}: (${dx}, ${dy}) is on the canvas ` + JSON.stringify(o)); return p; };
      // offsets from the origin that fit both canvases (SketchStudio's origin sits low, Shaper's in the middle), >= 70 px from the axes.
      // the lines are drawn just before their step, in separate places, and every click is aimed at where the line IS (read from the page:
      // drawing infers parallel / horizontal / vertical, and each constraint moves geometry)
      const C = h.canvas;
      const along = (a, b, t) => ({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) });
      const lineIds = () => evalJs(`[...document.querySelectorAll('#${C} line.shape-elem')].map((e) => e.dataset.shapeId)`);
      const endsOf = (id) => evalJs(`(() => { const s = document.getElementById('${C}'); const e = s.querySelector('line.shape-elem[data-shape-id="${id}"]'); const m = e.getScreenCTM(); const pt = (x, y) => { const p = s.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(m); return { x: Math.round(q.x), y: Math.round(q.y) }; }; return [pt(e.x1.baseVal.value, e.y1.baseVal.value), pt(e.x2.baseVal.value, e.y2.baseVal.value)]; })()`);
      const on = async (id, t = 0.35) => { const [a, b] = await endsOf(id); return along(a, b, t); }; // a point ON the line, off its midpoint snap
      const line = async (a, b) => {
        for (const q of [a, b]) assert.strictEqual(await evalJs(`(() => { const e = document.elementFromPoint(${q.x}, ${q.y}); return !!e && !!e.closest('#${C}'); })()`), true, `${name}: ${JSON.stringify(q)} is on the bare canvas (no panel over it)`);
        const was = new Set(await lineIds());
        await evalJs(`document.getElementById('tool-line').click()`); await sleep(150); await click(a); await click(b); await esc(); await toSelect();
        const id = (await lineIds()).find((x) => !was.has(x));
        assert(id, `${name}: a line was drawn from ${JSON.stringify(a)} to ${JSON.stringify(b)}`);
        return id;
      };
      const park = () => move(at(600, 190).x, at(600, 190).y);
      const before = {};
      for (const ty of ['horizontal', 'vertical', 'equal', 'perpendicular', 'midpoint', 'symmetric']) before[ty] = await glyphs(C, ty);
      const countNow = (ty) => glyphs(C, ty);
      // H: the selected slanted line becomes horizontal (applied at once)
      const L1 = await line(at(150, -370), at(300, -330));
      const h0 = await countNow('horizontal');
      await click(await on(L1)); await press('h');
      assert.strictEqual(await countNow('horizontal'), h0 + 1, name + ': H on a selected line added a Horizontal ' + JSON.stringify(await scene(C)));
      await toSelect();
      // E: two selected lines become equal (applied at once)
      const L2 = await line(at(400, -370), at(470, -280)), L3 = await line(at(550, -370), at(700, -290));
      const e0 = await countNow('equal');
      await click(await on(L2)); await click(await on(L3), 8); await press('e');
      assert(await countNow('equal') > e0, name + ': E on two selected lines added an Equal ' + JSON.stringify(await scene(C)));
      await toSelect();
      // T: armed, then the two lines
      const L4 = await line(at(150, -250), at(250, -170)), L5 = await line(at(350, -260), at(380, -150));
      const t0 = await countNow('perpendicular');
      await press('t'); assert.strictEqual(await isActive('perp'), true, name + ': T = Perpendicular');
      await click(await on(L4)); await click(await on(L5));
      assert(await countNow('perpendicular') > t0, name + ': T, click, click added a Perpendicular ' + JSON.stringify(await scene(C)));
      await toSelect();
      // Shift+M: Midpoint armed, then a point and a line
      const L6 = await line(at(450, -140), at(650, -235)), L7 = await line(at(575, -150), at(620, -80)) // its first point starts near L6's middle: the Midpoint moves it a little;
      const m0 = await countNow('midpoint');
      await press('m', { shift: true }); assert.strictEqual(await isActive('midpoint'), true, name + ': Shift+M = Midpoint');
      await click((await endsOf(L7))[0]); await click(await on(L6, 0.25));
      assert(await countNow('midpoint') > m0, name + ': Shift+M, a point, a line added a Midpoint ' + JSON.stringify(await scene(C)));
      await toSelect();
      // Y: Symmetric armed, then two points and the symmetry line
      const P = await line(at(150, 100), at(250, 140)), Q = await line(at(-250, 90), at(-150, 150)), S = await line(at(770, -350), at(775, 180));
      const y0 = await countNow('symmetric');
      await press('y'); assert.strictEqual(await isActive('symmetric'), true, name + ': Y = Symmetric');
      await click((await endsOf(P))[0]); await click((await endsOf(Q))[0]); await click(await on(S));
      assert(await countNow('symmetric') > y0, name + ': Y, two points, a line added a Symmetric ' + JSON.stringify(await scene(C)));
      await toSelect();
      await park(); await sleep(300);
      await shot(`${name}-constraints-by-key.png`, '#' + h.canvas);
      const after = {};
      for (const ty of Object.keys(before)) after[ty] = await glyphs(C, ty);
      fs.writeFileSync(path.join(EVID, `${name}-constraint-glyphs.json`), JSON.stringify({ before, after }, null, 1));
      console.log(name, 'D ok: glyphs before', JSON.stringify(before), 'after', JSON.stringify(after));

      // ── E. Shift+P toggles the Parameters window; P alone is Polygon ──
      const expanded = () => evalJs(`document.getElementById('btn-parameters').getAttribute('aria-expanded')`);
      assert.strictEqual(await expanded(), 'false', name + ': the Parameters window starts closed');
      await press('p', { shift: true });
      await waitFor(`document.getElementById('btn-parameters').getAttribute('aria-expanded') === 'true' && !!document.querySelector('.sk-pwin')`, name + ': Shift+P opens the Parameters window');
      assert.strictEqual(await isActive('select'), true, name + ': Shift+P is not Polygon');
      await shot(`${name}-shift-p-parameters.png`);
      await press('p', { shift: true });
      assert.strictEqual(await expanded(), 'false', name + ': Shift+P again closes it');
      await press('p'); assert.strictEqual(await isActive('polygon'), true, name + ': P = Polygon');
      assert.strictEqual(await expanded(), 'false', name + ': P does not open Parameters');
      await toSelect();
      console.log(name, 'E ok: Shift+P opens / closes Parameters; P = Polygon');

      // ── F. Settings > Shortcuts lists them ──
      await evalJs(`document.getElementById('btn-settings').click()`); await sleep(300);
      await evalJs(`document.getElementById('sk-style-tab-shortcuts').click()`); await sleep(300);
      const rows = await evalJs(`Object.fromEntries([...document.querySelectorAll('.sk-shortcut-row')].map((r) => [r.dataset.id, { keys: [...r.querySelectorAll('kbd')].map((k) => k.textContent), label: r.querySelector('.sk-shortcut-label').textContent }]))`);
      for (const id of [...new Set(mine.map((t) => t.shortcut)), 'view.parameters']) {
        const s = shortcutById(id);
        assert.deepStrictEqual(rows[id], { keys: comboCaps(s.keys[0], { mac: false }), label: s.label }, `${name}: the Shortcuts tab lists ${id}`);
      }
      await shot(`${name}-shortcuts-tab.png`, '.sk-style-panel');
      await evalJs(`(() => { const b = document.querySelector('.sk-style-panel'); b.scrollTop = b.scrollHeight; })()`); await sleep(200);
      await shot(`${name}-shortcuts-tab-end.png`, '.sk-style-panel');
      await evalJs(`document.getElementById('btn-settings').click()`); await sleep(300);
      console.log(name, 'F ok:', Object.keys(rows).length, 'rows listed');
    }
    console.log('shortcuts-740-live: ok');
  } finally { await cdp.close(); }
})();
process.exit(0);
