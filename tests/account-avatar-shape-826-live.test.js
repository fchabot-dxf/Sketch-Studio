// tests/account-avatar-shape-826-live.test.js — TASK 826: the account button paints NO shape behind its round circle (the floating phone-landscape footer gave the 35 x 44 button the
// floating buttons' background + shadow, a rounded OVAL whose top and bottom stuck out of the 36 px circle). In every footer style (phone 390 portrait docked, 844 x 390 landscape floating,
// desktop 1280) in Shaper and Pen Plotter, signed in with the FAKE Google only: the button itself has no background and no shadow, the circle is round, and the hit target is the full
// button box (elementFromPoint just inside its top / bottom edge, left / right = the button). Zoomed screenshots go to EVIDENCE_DIR (default .evidence/826).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { blockRemote } from './helpers/block-remote.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve(process.env.EVIDENCE_DIR || '.evidence/826');
fs.mkdirSync(EVID, { recursive: true });
const APPS = [
  { id: 'shaper', url: '/apps/shaper/index.html', canvas: 'design-canvas' },
  { id: 'penplotter', url: '/apps/penplotter/index.html', ready: `!!document.querySelector('.sk-doctab')` },
];
const SIZES = [
  { name: 'phone-390', w: 390, h: 844, touch: true },
  { name: 'landscape-844x390', w: 844, h: 390, touch: true },
  { name: 'desktop-1280', w: 1280, h: 800, touch: false },
];

await (async () => {
  const cdp = await launchBrowser({ tag: '826a', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  try {
    await blockRemote(cdp);
    await installFakeDriveSession(cdp, { signedIn: true });
    await resetBufferLive(cdp);
    for (const s of SIZES) {
      await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 3, mobile: s.touch, screenOrientation: s.w > s.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: s.touch, maxTouchPoints: s.touch ? 5 : 0 });
      for (const app of APPS) {
        await navigate(`http://127.0.0.1:${port}${app.url}`, 15000);
        if (app.canvas) await waitForApp(app.canvas); else await waitFor(app.ready, app.id + ' ready', 15000);
        await waitFor(`!!document.querySelector('.sk-footer-end > .sk-account')`, app.id + ': the avatar', 15000);
        await sleep(300);
        const tag = `${app.id} ${s.name}`;
        const a = await evalJs(`(() => { const b = document.querySelector('.sk-account'), c = b.querySelector('.sk-account-circle'), cs = getComputedStyle(b), cc = getComputedStyle(c), br = b.getBoundingClientRect(), r = c.getBoundingClientRect();
          const at = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === b || b.contains(h)); };
          return { bg: cs.backgroundColor, shadow: cs.boxShadow, radius: cc.borderRadius, circleW: r.width, circleH: r.height, bw: br.width, bh: br.height,
            top: at(br.left + br.width / 2, br.top + 1), bottom: at(br.left + br.width / 2, br.bottom - 1), left: at(br.left + 1, br.top + br.height / 2), right: at(br.right - 1, br.top + br.height / 2),
            clip: { x: Math.max(0, br.left - 40), y: Math.max(0, br.top - 14), width: Math.min(innerWidth, br.right + 12) - Math.max(0, br.left - 40), height: Math.min(innerHeight, br.bottom + 14) - Math.max(0, br.top - 14) } }; })()`);
        const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...a.clip, scale: 3 } });
        fs.writeFileSync(path.join(EVID, `${app.id}-${s.name}.png`), Buffer.from(r.data, 'base64'));
        assert.strictEqual(a.bg, 'rgba(0, 0, 0, 0)', tag + ': the button paints no background ' + JSON.stringify(a));
        assert.strictEqual(a.shadow, 'none', tag + ': the button casts no shadow ' + JSON.stringify(a));
        assert.strictEqual(a.circleW, a.circleH, tag + ': the circle is round ' + JSON.stringify(a));
        assert.ok(a.top && a.bottom && a.left && a.right, tag + ': the hit target is the full button box ' + JSON.stringify(a));
        assert.ok(a.bh >= (s.touch ? 44 : 32) - 0.5, tag + ': button box height ' + a.bh);
        console.log('ok', tag, JSON.stringify({ box: [a.bw, a.bh], circle: a.circleW }));
      }
    }
  } finally { await cdp.close(); }
})();
