// tests/dbltap-done-701-live.test.js — TASK 701 (live headless, SketchStudio, REAL touch on a 390 x 844 phone + REAL mouse on a 1280 x 800 desktop).
// A double tap / double click on a pattern's value label opens the pattern dialog on it, and the green check (.sk-done) never takes that
// press's click. The cause (measured on main d938d41): the second press opens the dialog (selection-tools.js, on pointerdown), so the check
// APPEARS at that press's pointerup (input-manager syncDone -> done-button.js), placed beside the pattern's anchor; on a phone whose bottom
// sheet covers the below-right slot it took the above-right slot, which holds the circular label ('N × A°' at centre + (34, -26)), and the
// finger's click (dispatched after pointerup, hit-tested where the finger is) landed on the check: commitPattern closed the dialog at once.
// Per case: a line, the pattern (circular: centre = the line's start; rectangular: Extent 1 mm), OK; then a double tap on the label:
// the check is hidden before and after the first tap, the dialog is open after the second, no click reached .sk-done, and the check
// does not cover the tapped point. Cases: both kinds; touch origins incl. 691's (0.45, 0.30) and the one that failed (0.70, 0.40).
// Screenshots: .evidence/701 (local).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.resolve('.evidence/701');
const TAG = process.env.EVID_TAG || 'run';

const cdp = await launchBrowser({ tag: '701-dbltap-done', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
fs.mkdirSync(EVID, { recursive: true });

try {
  const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const pointers = {
    mouse: {
      tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); },
      down: (p) => mouse('mousePressed', p.x, p.y, 1), up: (p) => mouse('mouseReleased', p.x, p.y, 0), hover: (p) => mouse('mouseMoved', p.x, p.y, 0),
    },
    touch: {
      tap: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); },
      down: (p) => T('touchStart', [p]), up: () => T('touchEnd', []), hover: async () => {},
    },
  };
  const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(250); };
  const doneRect = () => evalJs(`(() => { const e = document.querySelector('.sk-done'); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
  const dialogOpen = () => evalJs(`!!document.querySelector('.sk-pattern-dialog:not([hidden])')`);
  const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const patternLabel = `[...document.querySelectorAll('#svgCanvas .dim-label.pattern-label')]`;
  const shot = async (file, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
    fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
  };

  const runCase = async (kind, pk, fx, fy) => {
    const name = `[${kind} ${pk} (${fx}, ${fy})]`;
    const phone = kind === 'touch';
    const P = pointers[kind];
    await resetBufferLive(cdp);
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await waitForApp('svgCanvas');
    await sleep(400);
    const cr = await evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const R1 = Math.min(cr.w, cr.h) * 0.2;
    const O = { x: Math.round(cr.l + cr.w * fx), y: Math.round(cr.t + cr.h * fy) };

    // the source line, selected; the pattern made with the tool and applied (Enter = OK)
    await evalJs(`document.querySelector('#tool-line').click()`); await sleep(200);
    await P.tap(O); await P.tap({ x: O.x + R1, y: O.y });
    await key('Escape', 'Escape', 27);
    await evalJs(`document.querySelector('#tool-select').click()`); await sleep(200);
    await P.tap({ x: O.x + R1 * 0.6, y: O.y });
    await pressRibbonTool(evalJs, P.tap, pk === 'circular' ? 'tool-circularPattern' : 'tool-rectangularPattern');
    await waitFor(`!!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `${name} the pattern dialog`);
    if (pk === 'circular') {
      const a = await evalJs(`(() => { const e = document.querySelector('#svgCanvas line.shape-elem'); const pt = new DOMPoint(+e.getAttribute('x1'), +e.getAttribute('y1')).matrixTransform(e.getScreenCTM()); return { x: pt.x, y: pt.y }; })()`);
      await P.tap(a);
    } else {
      await evalJs(`(() => { const i = document.querySelector('.sk-pattern-dialog [data-field="Distance 1"]'); i.focus(); i.select(); })()`);
      await send('Input.dispatchKeyEvent', { type: 'char', text: '1' }); await sleep(250);
    }
    await waitFor(`${patternLabel}.length > 0`, `${name} the live pattern's label`);
    await key('Enter', 'Enter', 13);
    await waitFor(`!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `${name} OK closes the dialog`);
    const labelText = await evalJs(`${patternLabel}[0].textContent.trim()`);
    const lab = await centre('#svgCanvas .dim-label.pattern-label');
    assert(lab && lab.x > cr.l && lab.x < cr.l + cr.w && lab.y > cr.t && lab.y < cr.t + cr.h, `${name} the label is on the canvas ${JSON.stringify(lab)}`);
    await sleep(600); // the next press is a fresh one (not paired with the Enter's last press)

    // the double tap, press by press; every click that reaches the page is recorded (capture phase, before any handler)
    await evalJs(`(() => { const log = []; document.documentElement.dataset.t701 = '[]'; document.addEventListener('click', (e) => { log.push(!!(e.target.closest && e.target.closest('.sk-done'))); document.documentElement.dataset.t701 = JSON.stringify(log); }, true); })()`);
    const before = await doneRect();
    await P.hover(lab);
    await P.down(lab); await sleep(40); await P.up(lab); await sleep(80);
    const afterTap1 = await doneRect();
    await P.down(lab); await sleep(40); await P.up(lab); await sleep(400);
    const afterTap2 = await doneRect();
    const open = await dialogOpen();
    const clicks = JSON.parse((await evalJs(`document.documentElement.dataset.t701`)) || '[]');
    const rec = { label: labelText, at: { x: Math.round(lab.x), y: Math.round(lab.y) }, before, afterTap1, afterTap2, dialogOpen: open, clickOnDone: clicks };
    console.log(`${name} ${JSON.stringify(rec)}`);

    const clip = { x: Math.max(0, Math.round(lab.x - 170)), y: Math.max(0, Math.round(lab.y - 120)), width: 340, height: 300 };
    const file = `${TAG}-${kind}-${pk}-${fx}-${fy}.png`;
    await shot(file, { ...clip, width: Math.min(clip.width, (phone ? 390 : 1280) - clip.x), height: Math.min(clip.height, (phone ? 844 : 800) - clip.y) });

    assert.strictEqual(before, null, `${name} the check is hidden before the double tap`);
    assert.strictEqual(afterTap1, null, `${name} the first tap shows no check (no dialog yet)`);
    assert(!clicks.includes(true), `${name} no click of the double tap reached the green check ${JSON.stringify(clicks)}`);
    assert.strictEqual(open, true, `${name} the second tap opens the pattern dialog (and it stays open)`);
    assert(afterTap2, `${name} the check shows with the dialog`);
    const covers = afterTap2.l <= lab.x && lab.x <= afterTap2.r && afterTap2.t <= lab.y && lab.y <= afterTap2.b;
    assert(!covers, `${name} the check does not cover the tapped point ${JSON.stringify({ lab, afterTap2 })}`);
    await key('Escape', 'Escape', 27); // Cancel the edit
  };

  const CASES = [
    ['mouse', 'circular', 0.45, 0.30], ['mouse', 'circular', 0.50, 0.85],
    ['mouse', 'rectangular', 0.45, 0.30], ['mouse', 'rectangular', 0.50, 0.85],
    ['touch', 'circular', 0.45, 0.30], ['touch', 'circular', 0.70, 0.40], ['touch', 'circular', 0.30, 0.25],
    ['touch', 'rectangular', 0.45, 0.30], ['touch', 'rectangular', 0.30, 0.25],
  ];
  const failed = [];
  for (const [kind, pk, fx, fy] of CASES) {
    try { await runCase(kind, pk, fx, fy); } catch (e) { failed.push(e.message); console.log('FAIL ' + e.message); }
  }
  assert.deepStrictEqual(failed, [], `${failed.length} case(s) failed`);
  console.log('dbltap-done-701-live: ALL CHECKS PASSED');
} finally {
  await close();
}
