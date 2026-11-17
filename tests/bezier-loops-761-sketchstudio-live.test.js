// tests/bezier-loops-761-sketchstudio-live.test.js — TASK 761, the SketchStudio smoke (desktop 1280 x 800): the DXF spline outline (3 lines + a cubic)
// dropped on the canvas is a closed profile there too:
//  1. the shared profile tint (packages/ui/profile-fill.js, the loop finder's loops) draws it, its path with the cubic `C` (screenshot, zoomed);
//  2. the Export step's SVG writes the bezier as a cubic `C`, its DXF a SPLINE (the page's own Export button, the downloaded files).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve('.evidence/761');
fs.mkdirSync(EVID, { recursive: true });
const DXF = ['0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '100', '21', '0', '0', 'LINE', '8', '0', '10', '100', '20', '0', '11', '100', '21', '50',
  '0', 'SPLINE', '8', '0', '70', '8', '71', '3', '72', '8', '73', '4', ...[0, 0, 0, 0, 1, 1, 1, 1].flatMap((k) => ['40', String(k)]),
  '10', '100', '20', '50', '10', '70', '20', '90', '10', '30', '20', '90', '10', '0', '20', '50',
  '0', 'LINE', '8', '0', '10', '0', '20', '50', '11', '0', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');

const cdp = await launchBrowser({ tag: '761-sketchstudio', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-761-studio-dl-'));
const out = {};
try {
  await installFakeDriveSession(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
  await waitForApp('svgCanvas'); await sleep(400);
  await evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(DXF)}], 'spline-outline-761.dxf', { type: 'application/dxf' })); const c = document.getElementById('svgCanvas');
    c.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); c.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
  await waitFor(`document.querySelectorAll('#svgCanvas [data-shape-id]').length >= 4`, '1: the DXF drawn');
  await waitFor(`[...document.querySelectorAll('#svgCanvas path.profile-fill')].some((p) => / C /.test(p.getAttribute('d')))`, '1: the profile tint of the outline, with its cubic');
  out.tint = await evalJs(`[...document.querySelectorAll('#svgCanvas path.profile-fill')].map((p) => p.getAttribute('d'))`);
  assert.strictEqual(out.tint.length, 1, '1: ONE tinted profile (the outline)');
  const clip = await evalJs(`(() => { const r = document.querySelector('#svgCanvas path.profile-fill').getBoundingClientRect(); return { x: Math.max(0, r.left - 30), y: Math.max(0, r.top - 30), width: r.width + 60, height: r.height + 60, scale: 2 }; })()`);
  const s1 = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(EVID, 'sketchstudio-bezier-profile-tint.png'), Buffer.from(s1.data, 'base64'));
  console.log('screenshot ' + path.join(EVID, 'sketchstudio-bezier-profile-tint.png'));
  // 2. the Export step's button (svg, then dxf): the downloaded files
  const exportAs = async (type) => {
    for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
    await evalJs(`(() => { document.getElementById('export-type').value = '${type}'; document.getElementById('export-filename').value = 'bezier-761'; document.getElementById('btn-export-do').click(); })()`);
    let file = null;
    for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.' + type)); if (f) file = path.join(dlDir, f); else await sleep(100); }
    assert.ok(file, '2: the ' + type + ' downloaded');
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(path.join(EVID, 'sketchstudio-export.' + type), text);
    return text;
  };
  const svg = await exportAs('svg');
  out.svgCubic = (svg.match(/ C /g) || []).length;
  assert.strictEqual(out.svgCubic, 1, '2: the SVG writes the bezier as one cubic C');
  const dxf = await exportAs('dxf');
  out.dxf = ['LINE', 'SPLINE'].map((k) => (dxf.match(new RegExp('\\r?\\n' + k + '\\r?\\n', 'g')) || []).length);
  assert.deepStrictEqual(out.dxf, [3, 1], '2: the DXF writes 3 LINEs and 1 SPLINE');
  console.log(`bezier-loops-761-sketchstudio-live: ALL CHECKS PASSED ${JSON.stringify({ svgCubic: out.svgCubic, dxf: out.dxf, tint: out.tint[0] })}`);
} finally { await cdp.close(); fs.rmSync(dlDir, { recursive: true, force: true }); }
