// tests/board-extent-879-live.test.js — TASK 879, in the real Shaper page (software WebGL), desktop 1280 x 800 (mouse) and phone 390 x 844 (touch):
// the owner's "bromont" (an annular-sector slab from Fusion: an arc r 1524 and an arc r 1085.85 BOTH centred at (0, 0), the part at x -6..127,
// y 1082..1524 mm; one Outside cut; its saved stock { thickness 38.1, width null, height null, margin 12.7 }) in the Export step's 3D view:
//   1. the board (no Stock loop) hugs the part: the part's own box with its Outside cut's swept footprint (the 1/4 in bit beside the outline: 6.35 mm, as
//      buildRelief has always merged the cuts' footprints) + the declared 6 in (152.4 mm) on every side (it was a 1.5 m strip from the origin, the arcs'
//      centre, to the part, with a 1/2 in margin), the stored 12.7 margin not read;
//   2. the downloaded file's page is the part's box (it ran from y 0);
//   3. the Review card says the board is the design bounds + margin.
// Screenshots (.evidence/879/): 879-desktop-export3d.png, 879-phone-export3d.png (the Export 3D view, top, after Fit).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = path.resolve(process.env.EVIDENCE_DIR || '.evidence/879');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const R1 = 1524, R2 = 1085.85, M = 152.4;
const onR = (x, r) => ({ x, y: Math.sqrt(r * r - x * x) });
const A = onR(127, R1), B = onR(-6, R1), C = { x: A.x * R2 / R1, y: A.y * R2 / R1 }, D = { x: B.x * R2 / R1, y: B.y * R2 / R1 };
const PART = { minX: -6, maxX: 127, minY: Math.min(C.y, D.y), maxY: R1 };
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

async function phase({ phone }) {
  const tag = phone ? 'phone' : 'desktop';
  const cdp = await launchBrowser({ tag: `879-${tag}`, width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive({ port, navigate, waitFor });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const press = async (x, y) => {
      if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
      else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
      await sleep(250);
    };
    const clickEl = async (sel) => {
      const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
        return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
      assert.ok(p && p.onTop, `[${tag}] ${sel} is on screen and not covered: ${JSON.stringify(p)}`);
      await press(p.x, p.y);
    };
    const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
    const openMode = async (mode) => {
      for (let i = 0; i < 5; i++) {
        if (await activeStage() === mode) return;
        if (phone) {
          if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-chevron');
          await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
          await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`);
        } else await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
        await sleep(400);
      }
      assert.fail(`[${tag}] could not open the ${mode} stage`);
    };
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    if (phone) await waitFor(`!!document.querySelector('.sk-sidebar-chevron')`, 'shaper app ready (phone)');
    else await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    await evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', 'in'); })`);
    // the bromont outline (as the Fusion import leaves it: the arcs' centre joint at (0, 0), the sketch origin kept)
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const J = ${JSON.stringify({ jc: { x: 0, y: 0 }, jA: A, jB: B, jC: C, jD: D })};
      for (const [k, v] of Object.entries(J)) st.joints.set(k, { ...v });
      st.shapes.push({ id: 'outer', type: 'arc', joints: ['jc', 'jA', 'jB'], sweep: true, largeArc: false }, { id: 'inner', type: 'arc', joints: ['jc', 'jC', 'jD'], sweep: true, largeArc: false },
        { id: 'rA', type: 'line', joints: ['jA', 'jC'] }, { id: 'rB', type: 'line', joints: ['jB', 'jD'] });
    })()`);
    assert.ok(await evalJs(`(() => { const o = window.__designController.state.joints.get('j_origin'); return !!o && o.x === 0 && o.y === 0; })()`), `[${tag}] the sketch origin is at (0, 0)`);
    await openMode('prepare');
    await waitFor(`!!document.getElementById('prepare-canvas').getScreenCTM() && document.getElementById('prepare-canvas').children.length > 0`, 'prepare canvas ready');
    // its one Outside cut, and its saved stock (the old default margin 12.7 in it)
    await evalJs(`(async () => { const plan = await import('/tests/helpers/plan-v2.js'); const { findLoops } = await import('/packages/core/loop-finder.js');
      const loops = findLoops(window.__designController.state); if (loops.length !== 1) throw new Error('loops: ' + loops.length);
      plan.V2_PLAN.set(plan.keyOf('loop', loops[0].id), { cutType: 'exterior', cutDepth: 38.1, cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill', cutterAngle: 90 });
      const S = await import('/apps/shaper/src/stock.js'); S.setStock({ thickness: 38.1, width: null, height: null, margin: 12.7 });
      window.__prepareView.refreshLook(); })()`);
    await openMode('review');
    if (await evalJs(`document.querySelector('#review-view-switch button[data-view="3d"]').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-switch button[data-view="3d"]');
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, 'the 3D view is built');
    const box = await evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentReviewView().inspect().box)`);
    const F = 6.35; // the Outside cut's footprint: the bit (dia 6.35) beside the outline (a polygon of its arcs: within 0.05 mm)
    const want = { minX: PART.minX - F - M, maxX: PART.maxX + F + M, minZ: PART.minY - F - M, maxZ: PART.maxY + F + M, y: -38.1 };
    console.log(`[${tag}] board ${JSON.stringify(box)} (${(box.maxX - box.minX).toFixed(1)} x ${(box.maxZ - box.minZ).toFixed(1)} mm), want ${JSON.stringify(want)}`);
    for (const k of Object.keys(want)) assert.ok(near(box[k], want[k], 0.05), `[${tag}] 1. the board's ${k} = ${want[k]} (the part and its cut + 6 in), got ${box[k]}`);
    const stock = await evalJs(`import('/apps/shaper/src/stock.js').then((S) => S.getStock())`);
    assert.strictEqual(stock.margin, 152.4, `[${tag}] 1. the stored 12.7 margin is not read`);
    const note = await evalJs(`document.getElementById('review-stock-note').textContent`);
    assert.match(note, /design bounds \+ margin/, `[${tag}] 3. the card says what the board is`);
    const head = await evalJs(`import('/apps/shaper/src/export-payload.js').then((m) => import('/tests/helpers/plan-v2.js').then((C) => m.shaperSvgOf(window.__designController.state, C.planEntries()).split('\\n')[0]))`);
    const vb = head.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
    console.log(`[${tag}] file page: viewBox="${vb.join(' ')}"`);
    assert.ok(near(vb[0], PART.minX) && near(vb[1], PART.minY) && near(vb[0] + vb[2], PART.maxX) && near(vb[1] + vb[3], PART.maxY), `[${tag}] 2. the file's page is the part's box: ${vb}`);
    // the screenshot: the top view, fitted
    await clickEl('#review-top'); await sleep(300); await clickEl('#review-fit'); await sleep(600);
    const name = `879-${tag}-export3d.png`;
    let clip = null;
    if (!phone) clip = await evalJs(`(() => { const rs = ['#review-canvas-host', '#review-stock-note'].map((q) => document.querySelector(q).getBoundingClientRect());
      const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 6), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 6);
      return { x, y, width: Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + 6) - x, height: Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + 6) - y, scale: 1 }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  } finally { await cdp.close(); }
}

await phase({ phone: false });
await phase({ phone: true });
console.log('board-extent-879-live: ok');
