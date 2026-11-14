// tests/style-panel-tabs.test.js — TASK 481: the Style panel organises its controls into TABS (declared `tab` per control), has one
// Units tab (DOC_UNIT) in every host, the tab is keyboard-accessible and persisted per host, and flipping the unit re-labels the
// Shaper cut panel live. Headless Edge against the real Shaper + SketchStudio pages (real reload for persistence).
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './helpers/cdp-browser.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));




await (async () => {
  const cdp = await launchBrowser({ tag: '481tabs', width: 800, height: 600 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs } = cdp;
  try {
    const goto = async (url) => {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url }); await loaded;
      for (let i = 0; i < 50; i++) { if (await evalJs(`!!document.querySelector('.sk-style-panel')`)) return; await sleep(200); }
      throw new Error('no .sk-style-panel on ' + url);
    };

    const fields = `(() => { const p = document.querySelector('.sk-style-panel'); const o = {};
      p.querySelectorAll('.sk-style-tabpanel').forEach((t) => { o[t.dataset.tab] = { hidden: t.hidden, keys: [...t.querySelectorAll('[data-key]')].map((e) => e.dataset.key) }; });
      o.active = [...p.querySelectorAll('.sk-style-tab')].filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.tab);
      o.templateAboveTabs = !!(p.querySelector('[data-key="STYLE_TEMPLATE"]') && !p.querySelector('.sk-style-tabpanel [data-key="STYLE_TEMPLATE"]'));
      return o; })()`;

    for (const host of ['/apps/shaper/index.html', '/apps/sketchstudio/index.html']) {
      await goto(`http://127.0.0.1:${port}${host}`);
      await evalJs(`localStorage.clear()`);
      await goto(`http://127.0.0.1:${port}${host}`);
      const f = await evalJs(fields);
      assert.deepStrictEqual(f.active, ['lines'], host + ': first tab active by default');
      assert(f.templateAboveTabs, host + ': the Template select sits above the tabs');
      assert.deepStrictEqual(f.lines.keys, ['LINE_STROKE', 'JOINT_RADIUS', 'JOINT_STROKE_MULT', 'SELECTION_FEEDBACK_MULT', 'HOVER_FEEDBACK_MULT', 'DASH_LENGTH_PX', 'DASH_GAP_PX', 'PROFILE_FILL', 'LOCKED_LINE_COLOR'], host + ' lines tab');
      assert.deepStrictEqual(f.grid.keys, ['SHOW_GRID', 'GRID_MODE', 'SNAP_MAGNETISM', 'AXIS_SNAP', 'GRID_MAGNETISM', 'GRID_MAJOR_STEP', 'GRID_SIZE', 'INCH_GRID_MAJOR', 'INCH_GRID_DIVISIONS'], host + ' grid tab');
      assert.deepStrictEqual(f.glyphs.keys, ['GLYPH_SYMBOL_SIZE_PX', 'GLYPH_INFERENCE_SIZE_PX', 'GLYPH_OFFSET_PX', 'GLYPH_OUTLINE_PX', 'DIM_LABEL_BOX', 'LABEL_FONT_FAMILY'], host + ' glyphs tab');
      assert.deepStrictEqual(f.units.keys, ['DOC_UNIT'], host + ': every host has the Units tab with DOC_UNIT');
      assert(!f.lines.hidden && f.grid.hidden && f.glyphs.hidden && f.units.hidden, host + ': only the active tab shows its fields');
      const footBtns = await evalJs(`[...document.querySelectorAll('.sk-style-panel button')].map((b) => b.textContent.trim())`);
      assert(!footBtns.some((t) => /save/i.test(t) && !/preset/i.test(t)), host + ': the Style panel has no Save button (only Save as preset): ' + footBtns);
      assert(footBtns.includes('Reset') && footBtns.includes('Close'), host + ': Reset and Close remain: ' + footBtns);

      // TASK 532: showWhen. The metric pair shows for mm/cm files, the inch pair for inch files; a control without showWhen is
      // unaffected; flipping DOC_UNIT re-draws the REAL grid (pattern spacing) live, and so does each inch setting.
      const grid = `(async () => {
        const S = (await import('/packages/core/settings-manager.js')).default;
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const vis = () => ({ unit: S.get('DOC_UNIT'), ...Object.fromEntries(['GRID_MAJOR_STEP', 'GRID_SIZE', 'INCH_GRID_MAJOR', 'INCH_GRID_DIVISIONS', 'SHOW_GRID', 'GRID_MODE'].map((k) => [k, !document.querySelector('.sk-style-panel [data-row="' + k + '"]').hidden])) });
        const w = async () => { await sleep(400); const g = document.querySelector('#grid'); return g ? g.getAttribute('width') : 'NOGRID svgs=' + document.querySelectorAll('svg').length + ' rect=' + !!document.querySelector('#infinite-grid') + ' shown=' + [...document.querySelectorAll('svg')].map((s) => s.id + ':' + s.getBoundingClientRect().width).join(); };
        const out = {};
        document.querySelector('.sk-header-tab[data-tab="design"]')?.click(); await sleep(500);
        for (const u of ['mm', 'cm', 'in']) { S.set('DOC_UNIT', u, { persist: false }); out['vis_' + u] = vis(); out['w_' + u] = await w(); }
        out.in10 = out.w_in; S.set('INCH_GRID_DIVISIONS', 8, { persist: false }); out.in8 = await w();
        S.set('INCH_GRID_MAJOR', 2, { persist: false }); out.in8m2 = await w();
        S.set('DOC_UNIT', 'mm', { persist: false }); out.mmAgain = await w();
        S.set('DOC_UNIT', 'in', { persist: false });
        const sel = document.querySelector('.sk-style-panel [data-key="INCH_GRID_DIVISIONS"]'); sel.value = '16'; sel.dispatchEvent(new Event('change', { bubbles: true }));
        out.stored16 = S.get('INCH_GRID_DIVISIONS'); out.in16 = await w();
        return out;
      })()`;
      const g = await evalJs(grid);
      const only = (v, on) => ['GRID_MAJOR_STEP', 'GRID_SIZE', 'INCH_GRID_MAJOR', 'INCH_GRID_DIVISIONS'].every((k) => v[k] === on.includes(k)) && v.SHOW_GRID && v.GRID_MODE;
      assert(only(g.vis_mm, ['GRID_MAJOR_STEP', 'GRID_SIZE']) && only(g.vis_cm, ['GRID_MAJOR_STEP', 'GRID_SIZE']), host + ': metric pair for mm/cm: ' + JSON.stringify(g));
      assert(only(g.vis_in, ['INCH_GRID_MAJOR', 'INCH_GRID_DIVISIONS']), host + ': inch pair for inch: ' + JSON.stringify(g));
      assert(g.w_mm === g.mmAgain, host + ': mm grid back to the same spacing ' + JSON.stringify(g));
      assert(g.w_in !== g.w_mm && g.in8 !== g.in10 && g.in8m2 !== g.in8 && g.in16 !== g.in8m2, host + ': grid redraws live on unit / divisions / major: ' + JSON.stringify(g));
      assert.strictEqual(g.stored16, 16, host + ': the select stores a NUMBER');
      await evalJs(`(async () => { const S = (await import('/packages/core/settings-manager.js')).default; S.set('DOC_UNIT', ${host.includes('shaper') ? "'in'" : "'mm'"}, { persist: false }); })()`);

      // keyboard: ArrowRight moves to the next tab and shows its fields
      await evalJs(`document.querySelector('.sk-style-tab[data-tab="lines"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
      const k = await evalJs(fields);
      assert.deepStrictEqual(k.active, ['grid'], host + ': ArrowRight selects the next tab');
      assert(!k.grid.hidden && k.lines.hidden, host + ': Grid & Snap fields are shown');

      // persistence across a real reload, per host
      await evalJs(`document.querySelector('.sk-style-tab[data-tab="units"]').click()`);
      await goto(`http://127.0.0.1:${port}${host}`);
      assert.deepStrictEqual((await evalJs(fields)).active, ['units'], host + ': the last tab is restored after a reload');
    }

    // the Units tab flips DOC_UNIT and the Shaper cut panel re-labels live
    await goto(`http://127.0.0.1:${port}/apps/shaper/index.html`);
    const unitLabels = await evalJs(`(async () => {
      const { createCutPanel } = await import('/apps/shaper/src/cut-panel.js');
      const host = document.createElement('div'); document.body.appendChild(host);
      const cp = createCutPanel(host, {});
      cp.update({ kind: 'region', record: { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: 3.175 } });
      const labels = () => [...host.querySelectorAll('.cut-unit')].map((e) => e.textContent);
      const sel = document.querySelector('.sk-style-panel [data-key="DOC_UNIT"]');
      const out = {};
      sel.value = 'in'; sel.dispatchEvent(new Event('change', { bubbles: true })); out.inch = labels();
      sel.value = 'mm'; sel.dispatchEvent(new Event('change', { bubbles: true })); out.mm = labels();
      out.options = [...sel.options].map((o) => o.textContent);
      return out;
    })()`);
    assert(unitLabels.inch.length > 0 && unitLabels.inch.every((u) => u === 'in'), 'cut-panel unit labels flip to in: ' + unitLabels.inch);
    assert(unitLabels.mm.every((u) => u === 'mm'), 'and back to mm: ' + unitLabels.mm);
    assert(unitLabels.options.includes('Inches') && unitLabels.options.includes('Millimetres'), 'Inches / Millimetres offered: ' + unitLabels.options);
    console.log('style-panel-tabs.test.js passed');
  } finally {
    await cdp.close();
  }
})();
