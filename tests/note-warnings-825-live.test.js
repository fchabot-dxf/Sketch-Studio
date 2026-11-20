// tests/note-warnings-825-live.test.js — TASK 825 (V1 of docs/VISUAL-BUGS-824.md): the cut card's note area is three lines high ALWAYS (task 813: no layout shift), so a
// warning at the END of a note was hidden below the fold: the tabs shortfall "Only 5 of 8 tabs fit", a pocket's "Leftover: ...". The note lists the WARNING lines
// FIRST (warning colour), then the facts; when lines are hidden below, a fade + a chevron button say so (a phone's overlay scrollbar shows only while scrolling) and the
// button scrolls the area. Measured in the real page, desktop 1280 x 800 and phone 390 x 844 (touch): a 40 mm square Outside with 8 tabs of 10 mm (only 5 fit) and an
// L-shaped Spiral pocket (sharp inside corners: a leftover); every warning line is fully visible WITHOUT scrolling, the area's height is the same for both.
// Screenshots to .evidence/825/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { openOpLive } from './helpers/prepare-open-live.js';
const EVIDENCE_DIR = path.resolve('.evidence/825');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '825-note', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;
async function phase(label, width, height, touch) {
  const out = {};
  {
    if (touch) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    const press = async (x, y) => {
      if (touch) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] });
        await sleep(40);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await sleep(40);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      }
      await sleep(250);
    };
    const clickEl = async (sel) => {
      const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2), hit = document.elementFromPoint(x, y); return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
      assert.ok(p && p.onTop, `${label}: ${sel} is on screen and not covered: ${JSON.stringify(p)}`);
      await press(p.x, p.y);
    };
    const t = { evalJs, waitFor, clickEl };
    const shot = async (name, sel) => {
      const clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left - 24), y: Math.max(0, r.top - 24), width: Math.min(innerWidth, r.width + 48), height: r.height + 48, scale: 2 }; })()`);
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
      fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
      console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
    };
    console.log(label + ': start');
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`!!(window.__designController && window.__designController.state)`, 'ready');
    await evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', 'in'); })`);
    const stage = async (mode) => {
      for (let i = 0; i < 5; i++) {
        if (await evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`) === mode) return;
        if (touch) {
          if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-chevron');
          await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'drawer'); await sleep(300);
          await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`);
        } else await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
        await sleep(400);
      }
      throw new Error('could not open ' + mode);
    };
    await stage('design');
    await evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/tests/helpers/plan-v2.js')]).then(([L, C]) => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const poly = (name, pts) => { pts.forEach(([x, y], i) => st.joints.set(name + 'j' + i, { x, y })); for (let i = 0; i < pts.length; i++) st.shapes.push({ id: name + 's' + i, type: 'line', joints: [name + 'j' + i, name + 'j' + ((i + 1) % pts.length)] }); };
      poly('SQ', [[0, 0], [40, 0], [40, 40], [0, 40]]);
      poly('LL', [[60, 0], [140, 0], [140, 20], [80, 20], [80, 60], [60, 60]]);
      const loops = L.findLoops(st);
      const k = (sid) => 'loop:' + loops.find((l) => l.edges.includes(sid)).id;
      C.V2_PLAN.use(st); C.V2_PLAN.setOrder([]); C.V2_PLAN.clear();
      C.V2_PLAN.set(k('SQs0'), { cutType: 'exterior', cutDepth: 12, cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill', holdPart: 'tabs', tabCount: 8, tabWidth: 10, holdThickness: 3 });
      C.V2_PLAN.set(k('LLs0'), { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill', clearing: 'linked', stepover: 40, finishAllowance: 0.5, loop: false });
    })`);
    await stage('prepare');
    await waitFor(`document.querySelectorAll('#prepare-ops .ops-row').length >= 2`, 'the two operations');
    const noteState = () => evalJs(`(() => { const n = document.querySelector('.cut-note'), nr = n.getBoundingClientRect(), more = document.querySelector('.cut-note-more'), fade = document.querySelector('.cut-note-fade');
      return { clientH: n.clientHeight, scrollH: n.scrollHeight, scrollTop: n.scrollTop, moreShown: !more.hidden && more.getBoundingClientRect().height > 0, fadeShown: !fade.hidden && fade.getBoundingClientRect().height > 0,
        lines: [...n.children].map((d) => { const r = d.getBoundingClientRect(), w = d.querySelector('.cut-note-warn'); return { text: d.textContent, warn: !!w, top: Math.round(r.top - nr.top), bottom: Math.round(r.bottom - nr.top) }; }) }; })()`);
    for (const [name, type, warnWord] of [['tabs', 'exterior', /^Only 5 of 8 tabs fit$/], ['pocket', 'pocket', /^Leftover: /]]) {
      if (await evalJs(`!!(window.__prepareView && window.__prepareView.activeOp())`)) await clickEl('#prepare-panel .cut-ok');
      const id = await evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().find((o) => o.type === ${JSON.stringify(type)}).id)`);
      await openOpLive(t, id);
      await waitFor(`!document.querySelector('.cut-card').hidden && document.querySelectorAll('.cut-note div').length > 0`, `${label} ${name}: the card and its note`);
      await sleep(400);
      const s = await noteState();
      console.log(`${label} ${name}: ` + JSON.stringify(s));
      const warns = s.lines.filter((l) => l.warn);
      assert.ok(warns.some((l) => warnWord.test(l.text)), `${label} ${name}: the warning line is there: ${JSON.stringify(warns)}`);
      for (const l of warns.filter((w) => warnWord.test(w.text))) assert.ok(l.top >= 0 && l.bottom <= s.clientH + 1, `${label} ${name}: the warning "${l.text}" is fully visible without scrolling (${l.top}..${l.bottom} of ${s.clientH})`);
      const firstFacts = s.lines.findIndex((l) => !l.warn);
      assert.ok(firstFacts === -1 || s.lines.slice(firstFacts).every((l) => !l.warn), `${label} ${name}: every warning line comes before every fact line`);
      out[name] = s;
      if (s.scrollH > s.clientH + 1) {
        assert.ok(s.moreShown && s.fadeShown, `${label} ${name}: lines lie below the area: the fade and the chevron say so`);
        await shot(`v1-${label}-${name}-more.png`, '.cut-note-wrap');
        await clickEl('.cut-note-more');
        await sleep(700);
        const s2 = await noteState();
        assert.ok(s2.scrollTop > 0, `${label} ${name}: the chevron scrolls the area (scrollTop ${s2.scrollTop})`);
      } else assert.ok(!s.moreShown && !s.fadeShown, `${label} ${name}: nothing below: no cue`);
      await evalJs(`document.querySelector('.cut-note').scrollTop = 0`);
      await shot(`v1-${label}-${name}.png`, '.cut-note-wrap');
    }
    assert.strictEqual(out.tabs.clientH, out.pocket.clientH, `${label}: the note area is the same height for every note (no layout shift)`);
    assert.ok(out.pocket.scrollH > out.pocket.clientH + 1 || out.tabs.scrollH > out.tabs.clientH + 1, `${label}: (at least one note is longer than the area)`);
  }
}
try {
  await phase('desk', 1280, 800, false);
  await phase('phone', 390, 844, true);
} finally { await close(); }
console.log('note-warnings-825-live: ok');
