// tests/helpers/ribbon-sections.js — TASK 647 (one file per host and part runs it: tests/ribbon-sections-<host>-<wide|narrow|customise>-live.test.js): the tool ribbon never scrolls; each
// section shows the tools that are in the bar and fit, then its NAME, the button that opens the section's dropdown (every tool of the section, a
// checkbox "in the bar", a grip to reorder). Per host (SketchStudio, Shaper, Pen Plotter, Trace), real mouse on desktop, real touch on phones:
//  A. at 1280 x 800 (mouse), 390 x 844 and 360 x 740 portrait and 844 x 390 landscape (the rail) (touch):
//     - the ribbon does not scroll (scrollWidth <= clientWidth; scrollHeight <= clientHeight in the rail); the rail is a column only in landscape;
//     - Select is its own first section and always shown; every section shows at least one tool; on the desktop every Create / Constrain tool
//       shows and Modify / Inspect show exactly their first tool (declared defaultInBar 1); on touch every shown tool and every section name is
//       >= 44 x 44 px and is the element at its own centre (nothing covers it);
//     - EVERY tool is reachable from its section's dropdown and works from there: a real press on the section's name opens it, a real press on
//       the tool's row runs it exactly like its bar button (a drawing tool becomes the active tool, and when it is not in the bar the section's name
//       is lit; Rect opens its variants menu; Parameters opens its window; Combine / Uncombine give their message; Lock's row is disabled while
//       its bar button is; Pen Plotter's Freehand lights its button); the dropdown closes.
//  B. customising (1280 mouse, then 390 touch): unchecking a tool takes it out of the bar and survives a reload; a hold-drag on a grip moves a
//     tool to the top of its section, the bar follows and the order survives a reload; a quick swipe on a grip (no hold) reorders nothing; Reset
//     restores the declared defaults; the layout is saved under this app only; narrowing the window moves tools into the dropdowns.
import assert from 'node:assert';
import { launchBrowser, sleep, sendRealKey } from './cdp-browser.js';
import { LANDSCAPE_HOSTS } from './phone-landscape.js';

const SIZES = [
  { n: 'desktop 1280x800', w: 1280, h: 800, touch: false },
  { n: 'portrait 390x844', w: 390, h: 844, touch: true },
  { n: 'portrait 360x740', w: 360, h: 740, touch: true },
  { n: 'landscape 844x390', w: 844, h: 390, touch: true, land: true },
];
const MESSAGES = { 'btn-combine': 'Select shapes forming at least 2 closed loops to combine', 'btn-uncombine': 'Select a combined profile to uncombine' };

// part (TASK 650 split: one file per part keeps each run well under the gate's 90 s per-file limit):
//   'wide'      = section A at desktop 1280 and portrait 390;  'narrow' = section A at portrait 360 and landscape 844x390;
//   'customise' = section B (uncheck, hold-drag, reload, Reset, the per-app key, narrowing).
const PARTS = { wide: [0, 1], narrow: [2, 3], customise: [] };
export async function runRibbonSections(hostName, part) {
  if (!PARTS[part]) throw new Error('ribbon-sections: unknown part ' + part);
  const h = LANDSCAPE_HOSTS.find((x) => x.name === hostName);
  if (!h) throw new Error('ribbon-sections: unknown host ' + hostName);
  const cdp = await launchBrowser({ tag: '647-' + hostName, width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  let size = SIZES[0];
  try {
    const metrics = async (s, w = s.w) => {
      size = s;
      await send('Emulation.setDeviceMetricsOverride', s.touch
        ? { width: w, height: s.h, deviceScaleFactor: 2, mobile: true, screenOrientation: s.land ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } }
        : { width: w, height: s.h, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: s.touch, maxTouchPoints: s.touch ? 5 : 0 });
    };
    const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 0, radiusX: 1, radiusY: 1, force: 1 })) });
    const mouse = (type, p, extra = {}) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', ...extra });
    const press = async (p) => {
      if (size.touch) { await touch('touchStart', [p]); await sleep(40); await touch('touchEnd', []); }
      else { await mouse('mouseMoved', p, { button: 'none' }); await mouse('mousePressed', p, { clickCount: 1, buttons: 1 }); await mouse('mouseReleased', p, { clickCount: 1 }); }
      await sleep(200);
    };
    // the centre of an element (scrolled into its scroll box first: a long dropdown scrolls), and whether it is the element there
    const at = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
      return { x, y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, hit: !!hit && (hit === e || e.contains(hit)), toast: !!hit && !!hit.closest('[data-level]'), hitTag: hit ? hit.tagName + '.' + hit.className : null }; })()`);
    // a notification toast (bottom centre, above every popover, 10 s) can cover a dropdown's lower rows on a short screen: wait for it to go
    const pressSel = async (sel, why) => { let p = await at(sel);
      if (p && !p.hit && p.toast) { await waitFor(`!document.querySelector('#notification-container [data-level]')`, 'the toasts to go', 15000); p = await at(sel); }
      assert(p && p.hit, why + ': ' + sel + ' is on screen and uncovered ' + JSON.stringify(p)); await press(p); };
    const nameSel = (key) => `.sk-ribbon-group[data-section="${key}"] .sk-ribbon-group-label`;
    const menuOpen = () => evalJs(`!!document.querySelector('.sk-ribbon-sect-menu.show')`);
    const openSection = async (key, tag) => {
      await pressSel(nameSel(key), tag);
      assert.strictEqual(await evalJs(`(() => { const m = document.querySelector('.sk-ribbon-sect-menu.show'); return !!m && m.dataset.section === ${JSON.stringify(key)} && document.querySelector(${JSON.stringify(nameSel(key))}).getAttribute('aria-expanded') === 'true'; })()`), true, tag + ': a press on the ' + key + ' name opens its dropdown');
    };
    const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(150); };
    const load = async () => {
      await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
      if (h.enter) { await sleep(800); await evalJs(h.enter); }
      await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-group[data-section="constrain"] .sk-ribbon-btn')`, h.name + ': the ribbon');
      await sleep(700); // the fit runs on the ribbon's first layout (ResizeObserver, next frame)
    };
    const layout = () => evalJs(`(() => { const rb = document.querySelector('.sk-ribbon'); const rail = getComputedStyle(rb).flexDirection === 'column';
      const ok = (e) => { const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); return r.width >= 44 && r.height >= 44 && !!hit && (hit === e || e.contains(hit)); };
      return { rail, over: rail ? rb.scrollHeight - rb.clientHeight : rb.scrollWidth - rb.clientWidth,
        secs: [...rb.querySelectorAll('.sk-ribbon-group')].map((g) => { const b = [...g.querySelectorAll('.sk-ribbon-btn')]; const nm = g.querySelector('.sk-ribbon-group-label');
          return { key: g.dataset.section, fixed: g.hasAttribute('data-fixed'), all: b.map((x) => x.id), shown: b.filter((x) => !x.hidden).map((x) => x.id), nameBtn: nm.tagName === 'BUTTON', name: nm.textContent }; }),
        bad: [...rb.querySelectorAll('.sk-ribbon-btn:not([hidden]), button.sk-ribbon-group-label')].filter((e) => !ok(e)).map((e) => e.id || e.textContent) }; })()`);
    const ls = () => evalJs(`JSON.parse(localStorage.getItem('sketch-studio-settings') || '{}').RIBBON_LAYOUT || null`);

    // ── A. every size: no scroll, the sections, every tool from its dropdown
    for (const s of PARTS[part].map((i) => SIZES[i])) {
      await metrics(s);
      await load();
      const tag = `${h.name} ${s.n}`;
      assert.strictEqual(await evalJs(`matchMedia('(pointer: coarse)').matches`), s.touch, tag + ': pointer kind');
      const L = await layout();
      console.log(tag + ': ' + L.secs.map((x) => `${x.key} ${x.shown.length}/${x.all.length}`).join(', ') + `; overflow ${L.over}`);
      assert.strictEqual(L.rail, !!s.land, tag + ': the ribbon is a rail exactly in landscape');
      assert(L.over <= 0, tag + ': the ribbon does not scroll (overflow ' + L.over + ' px)');
      assert.deepStrictEqual([L.secs[0].key, L.secs[0].fixed, L.secs[0].nameBtn, L.secs[0].shown], ['select', true, false, ['tool-select']], tag + ': Select is its own first section, always shown, no dropdown');
      for (const x of L.secs) assert(x.shown.length >= 1, tag + ': section ' + x.key + ' shows a tool');
      for (const x of L.secs.slice(1)) assert(x.nameBtn, tag + ': the ' + x.key + ' name is a button (the dropdown)');
      if (!s.touch) {
        const by = Object.fromEntries(L.secs.map((x) => [x.key, x]));
        assert.deepStrictEqual(by.create.shown, by.create.all, tag + ': every Create tool shows on the desktop');
        assert.deepStrictEqual(by.constrain.shown, by.constrain.all, tag + ': every Constrain tool shows on the desktop');
        assert.deepStrictEqual(by.modify.shown, ['tool-trim'], tag + ': Modify shows its first tool only (defaultInBar 1)');
        assert.deepStrictEqual(by.inspect.shown, ['tool-dim'], tag + ': Inspect shows its first tool only (defaultInBar 1)');
        assert.deepStrictEqual(by.modify.all.slice(0, 5), ['tool-trim', 'tool-break', 'tool-closePath', 'tool-fillet', 'tool-mirror'], tag + ': Modify = Trim, Break, Close path, Fillet, Mirror (owner: Mirror after Fillet; TASK 760: Close path beside Break)');
        assert(!by.create.all.includes('tool-mirror') && !by.create.all.includes('tool-select'), tag + ': Mirror and Select are not in Create');
      } else assert.deepStrictEqual(L.bad, [], tag + ': every shown tool and section name is >= 44 x 44 and uncovered');

      for (const sec of L.secs.filter((x) => !x.fixed)) {
        for (const id of sec.all) {
          const t = `${tag} ${sec.key}/${id}`;
          await openSection(sec.key, t);
          const row = `.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="${id}"]`;
          if (id === 'btn-lock') {
            assert.strictEqual(await evalJs(`document.querySelector('${row}').disabled === document.getElementById('btn-lock').disabled && document.getElementById('btn-lock').disabled`), true, t + ': without a selection Lock is disabled in the dropdown as in the bar');
            await esc();
            assert.strictEqual(await menuOpen(), false, t + ': Esc closes the dropdown');
            continue;
          }
          await pressSel(row, t);
          assert.strictEqual(await menuOpen(), false, t + ': running a tool closes the dropdown');
          const tool = await evalJs(`document.getElementById('${id}').dataset.tool || null`);
          if (id === 'tool-rect' || id === 'tool-slot') {
            const targetMode = id === 'tool-rect' ? 'rect-center' : 'slot-center';
            assert.strictEqual(await evalJs(`!!document.querySelector('.sk-ribbon-menu.show')`), true, t + ': ' + id + ' from the dropdown opens its variants menu');
            await pressSel(`.sk-ribbon-menu.show [data-mode="${targetMode}"]`, t);
            assert.strictEqual(await evalJs(`!document.querySelector('.sk-ribbon-menu.show') && document.querySelector('.sk-ribbon-menu [data-mode="${targetMode}"]').classList.contains('active') && document.getElementById('${id}').classList.contains('active')`), true, t + ': the variant is chosen, ' + id + ' is the active tool');
          } else if (tool) {
            assert.strictEqual(await evalJs(`(() => { const b = document.getElementById('${id}'); const act = [...document.querySelectorAll('.sk-ribbon .sk-ribbon-btn.active')].map((x) => x.id);
              const lit = document.querySelector(${JSON.stringify(nameSel(sec.key))}).classList.contains('active'); return act.length === 1 && act[0] === '${id}' && lit === b.hidden; })()`), true, t + ': the tool is the one active tool; the section name is lit exactly when it is not in the bar');
          } else if (MESSAGES[id]) {
            assert.strictEqual(await evalJs(`document.body.innerText.includes(${JSON.stringify(MESSAGES[id])})`), true, t + ': the action runs (its message with nothing selected)');
          } else if (id === 'freehand-btn') {
            assert.strictEqual(await evalJs(`document.getElementById('freehand-btn').classList.contains('active')`), true, t + ': Freehand runs (its button lit)');
          } else assert.fail(t + ': no check declared for this tool');
        }
      }
      console.log('ok A ' + tag);
    }

    if (part === 'customise') {
    // ── B1. desktop, mouse: uncheck, hold-drag, reload, Reset, the per-app key, narrowing
    await metrics(SIZES[0]); await load();
    let tag = h.name + ' desktop customise';
    await openSection('create', tag);
    await pressSel(`.sk-ribbon-sect-row[data-id="tool-circle"] .sk-ribbon-sect-check input`, tag);
    assert.strictEqual(await evalJs(`document.getElementById('tool-circle').hidden && !document.querySelector('.sk-ribbon-sect-row[data-id="tool-circle"] input').checked`), true, tag + ': an unchecked tool leaves the bar');
    assert.strictEqual(await menuOpen(), true, tag + ': the dropdown stays open while checking');
    await esc();
    const dragTo = async (key, id, why) => {
      const rows = () => evalJs(`[...document.querySelectorAll('.sk-ribbon-sect-menu.show .sk-ribbon-sect-row')].map((r) => r.dataset.id)`);
      const g = await at(`.sk-ribbon-sect-row[data-id="${id}"] .sk-ribbon-grip`);
      const first = await at(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-row:first-child`);
      assert(g && g.hit, why + ': the grip is on screen');
      const target = { x: g.x, y: Math.round(first.top + 3) };
      const steps = 8;
      if (size.touch) {
        await touch('touchStart', [g]); await sleep(450);
        for (let i = 1; i <= steps; i++) { await touch('touchMove', [{ x: g.x, y: Math.round(g.y + (target.y - g.y) * i / steps) }]); await sleep(40); }
        await sleep(100);
        const mid = await rows();
        await touch('touchEnd', []);
        await sleep(250);
        return mid;
      }
      await mouse('mouseMoved', g, { button: 'none' }); await mouse('mousePressed', g, { clickCount: 1, buttons: 1 }); await sleep(450);
      for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', { x: g.x, y: Math.round(g.y + (target.y - g.y) * i / steps) }, { buttons: 1 }); await sleep(40); }
      const mid = await rows();
      await mouse('mouseReleased', target, { clickCount: 1 }); await sleep(250);
      return mid;
    };
    await openSection('constrain', tag);
    const during = await dragTo('constrain', 'btn-lock', tag);
    assert.strictEqual(during[0], 'btn-lock', tag + ': the held row follows the pointer to the top: ' + during.join(','));
    assert.strictEqual(await evalJs(`[...document.querySelectorAll('[data-section="constrain"] .sk-ribbon-btn')].filter((b) => !b.hidden)[0].id`), 'btn-lock', tag + ': the bar follows the new order');
    await esc();
    let saved = await ls();
    assert.deepStrictEqual(Object.keys(saved.apps), [h.name], tag + ': the layout is saved under this app only');
    await load();
    tag = h.name + ' desktop after reload';
    assert.strictEqual(await evalJs(`document.getElementById('tool-circle').hidden`), true, tag + ': the unchecked tool is still out of the bar');
    assert.strictEqual(await evalJs(`[...document.querySelectorAll('[data-section="constrain"] .sk-ribbon-btn')].filter((b) => !b.hidden)[0].id`), 'btn-lock', tag + ': the order survived');
    await openSection('create', tag);
    assert.strictEqual(await evalJs(`document.querySelector('.sk-ribbon-sect-row[data-id="tool-circle"] input').checked`), false, tag + ': its checkbox is still unchecked');
    await pressSel('.sk-ribbon-sect-menu.show .sk-ribbon-sect-reset', tag);
    assert.strictEqual(await evalJs(`!document.getElementById('tool-circle').hidden && document.querySelector('.sk-ribbon-sect-row[data-id="tool-circle"] input').checked && !!document.querySelector('.sk-ribbon-sect-menu.show')`), true, tag + ': Reset puts it back in the bar (the dropdown stays open)');
    await esc();
    await openSection('constrain', tag);
    await pressSel('.sk-ribbon-sect-menu.show .sk-ribbon-sect-reset', tag);
    assert.strictEqual(await evalJs(`[...document.querySelectorAll('.sk-ribbon-sect-menu.show .sk-ribbon-sect-row')][0].dataset.id + ' ' + [...document.querySelectorAll('[data-section="constrain"] .sk-ribbon-btn')][0].id`), 'tool-coincident tool-coincident', tag + ': Reset restores the declared order');
    await esc();
    saved = await ls();
    assert.deepStrictEqual(saved.apps[h.name], {}, tag + ': after Reset nothing is stored for this app (the declared defaults)');
    // narrowing the window moves tools into the dropdowns, the ribbon still does not scroll
    const count = () => evalJs(`[...document.querySelectorAll('.sk-ribbon .sk-ribbon-btn')].filter((b) => !b.hidden).length`);
    const wide = await count();
    await metrics(SIZES[0], 700); await sleep(500);
    const narrow = await count();
    assert(narrow < wide, tag + `: narrowing to 700 px shows fewer tools (${wide} -> ${narrow})`);
    assert.strictEqual(await evalJs(`(() => { const r = document.querySelector('.sk-ribbon'); return r.scrollWidth <= r.clientWidth; })()`), true, tag + ': 700 px: no scroll');
    await metrics(SIZES[0]); await sleep(500);
    assert.strictEqual(await count(), wide, tag + ': widening again brings them back');
    console.log('ok B desktop ' + h.name + ` (tools shown 1280 px: ${wide}, 700 px: ${narrow})`);

    // ── B2. phone portrait, touch: a quick swipe on a grip reorders nothing; a hold-drag does; Reset
    await metrics(SIZES[1]); await load();
    tag = h.name + ' portrait touch';
    await openSection('create', tag);
    const before = await evalJs(`[...document.querySelectorAll('.sk-ribbon-sect-menu.show .sk-ribbon-sect-row')].map((r) => r.dataset.id).join(',')`);
    const g0 = await at('.sk-ribbon-sect-menu.show .sk-ribbon-sect-row:first-child .sk-ribbon-grip');
    await touch('touchStart', [g0]); for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: g0.x, y: g0.y + i * 15 }]); await sleep(20); } await touch('touchEnd', []); await sleep(400);
    assert.strictEqual(await evalJs(`[...document.querySelectorAll('.sk-ribbon-sect-row')].map((r) => r.dataset.id).join(',')`), before, tag + ': a swipe without the hold reorders nothing');
    if (!(await menuOpen())) await openSection('create', tag);
    const last = before.split(',').pop();
    const mid = await dragTo('create', last, tag);
    assert.strictEqual(mid[0], last, tag + ': the held row follows the finger to the top');
    assert.strictEqual(await evalJs(`[...document.querySelectorAll('[data-section="create"] .sk-ribbon-btn')].filter((b) => !b.hidden)[0].id`), last, tag + ': the bar shows it first');
    await esc();
    await load();
    assert.strictEqual(await evalJs(`[...document.querySelectorAll('[data-section="create"] .sk-ribbon-btn')].filter((b) => !b.hidden)[0].id`), last, tag + ': the order survives a reload');
    await openSection('create', tag);
    await pressSel('.sk-ribbon-sect-menu.show .sk-ribbon-sect-reset', tag);
    assert.strictEqual(await evalJs(`[...document.querySelectorAll('.sk-ribbon-sect-row')].map((r) => r.dataset.id).join(',')`), before, tag + ': Reset restores the declared order');
    await esc();
    console.log('ok B portrait ' + h.name);
    }
    console.log(`ribbon-sections ${h.name} ${part}: pass`);
  } finally { await cdp.close(); }
}
