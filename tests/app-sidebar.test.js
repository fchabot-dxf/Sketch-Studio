// tests/app-sidebar.test.js — TASK 473: the shared app sidebar in every host. Each host mounts it with ITS OWN actions; GO TO lists the 4
// apps and marks the current one; Esc / outside click close it; focus stays trapped while open; the old app-switcher dropdown is gone.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { APPS, appTitle, appIconDataUri } from '../packages/ui/app-registry.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { CUT_TYPES, effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { findLoops } from '#core/loop-finder.js';
import { deriveCutFootprint } from '#core/profile-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

await (async () => {
  const cdp = await launchBrowser({ tag: '473', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;

  try {
    const key = async (k, code, vk, modifiers = 0, text = '') => { await sendRealKey(send, k, code, vk, modifiers, text); await sleep(200); };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const stageTab = (name) => clickEl(`.stage-btn[data-stage="${name}"]`);

    const hosts = [
      { id: 'shaper', path: '/apps/shaper/index.html', actions: ['new-design', 'save-as', 'duplicate', 'open-recent', 'projects', 'open-file', 'download'] },
      { id: 'penplotter', path: '/apps/penplotter/index.html', actions: ['new-design', 'save-as', 'duplicate', 'open-recent', 'projects', 'open-file', 'download'] },
      { id: 'sketchstudio', path: '/apps/sketchstudio/index.html', actions: ['new-design', 'save-as', 'duplicate', 'open-recent', 'projects', 'open-file', 'download-svg', 'download-dxf'] },
      { id: 'trace', path: '/apps/trace/index.html', actions: ['download-svg', 'download-dxf'] },
    ];
    // ── the registry: names, distinct icons, titles; each index.html's static <title> fallback equals the registry's ──
    assert.deepStrictEqual(APPS.map((a) => a.name), ['Sketch', 'Shaper', 'Pen Plotter', 'Trace']);
    assert.strictEqual(new Set(APPS.map((a) => a.icon)).size, 4, 'the four icons are distinct');
    assert.strictEqual(new Set(APPS.map((a) => a.accent)).size, 4, 'each app has its own accent');
    assert.strictEqual(appTitle('shaper'), 'Shaper · Sketch Studio');
    assert.strictEqual(appTitle('shaper', 'Kitchen door'), 'Kitchen door — Shaper', 'a design name turns the title into "<design> — <app>"');
    for (const a of APPS) {
      const html = fs.readFileSync(path.join(REPO_ROOT, 'apps', a.id, 'index.html'), 'utf8');
      assert.ok(html.includes(`<title>${appTitle(a.id)}</title>`), `${a.id}: the static <title> fallback equals the registry's`);
      assert.ok(!/<link rel="icon"/.test(html), `${a.id}: no favicon hard-coded in index.html`);
    }
    if (process.env.EVIDENCE_DIR) { // the four favicons at 16px and 64px side by side (evidence)
      const row = (px) => `<div style="display:flex;gap:18px;margin:14px">${APPS.map((a) => `<img src="${appIconDataUri(a.id)}" width="${px}" height="${px}">`).join('')}</div>`;
      fs.writeFileSync(path.join(REPO_ROOT, '.evidence', '473', '_icons.html'), `<body style="background:#3F4145;margin:0;font:14px system-ui;color:#fff">${row(16)}${row(64)}<div style="margin:14px;display:flex;gap:30px">${APPS.map((a) => `<span>${a.name}</span>`).join('')}</div></body>`);
    }
    const key2 = async (k, code, vk, mods = 0) => { await sendRealKey(send, k, code, vk, mods); await sleep(150); };
    const SIDEBAR_OPEN = `document.querySelector('.sk-sidebar').classList.contains('open')`;
    for (const host of hosts) {
      await navigate(`http://127.0.0.1:${port}${host.path}`, 10000);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn') && !!document.querySelector('link[rel="icon"]') && !!document.querySelector('.sk-sidebar')`, `${host.id} to mount its sidebar`);
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-appsw').length`), 0, `${host.id}: the app-switcher dropdown is gone`);
      assert.ok([appTitle(host.id), appTitle(host.id, 'Untitled')].includes(await evalJs(`document.title`)), `${host.id}: document.title comes from the registry (with the design name once a design exists)`);
      assert.strictEqual(await evalJs(`document.querySelector('link[rel="icon"]').getAttribute('href')`), appIconDataUri(host.id), `${host.id}: the favicon comes from the registry`);
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-sidebar-btn').length`), 1, `${host.id}: one sidebar button`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, `${host.id}: closed at start`);
      // open with a real click on the header button
      await clickEl('.sk-sidebar-btn');
      await waitFor(`${SIDEBAR_OPEN} && !!document.querySelector('.sk-sidebar [data-section="goto"] [data-app]')`, `${host.id}: the drawer to open`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), true, `${host.id}: the button opens the drawer`);
      const acts = await evalJs(`[...document.querySelectorAll('.sk-sidebar [data-section="actions"] [data-action]')].map((b) => b.dataset.action)`);
      assert.deepStrictEqual(acts, host.actions, `${host.id}: its own actions, no other host's`);
      const goto = await evalJs(`[...document.querySelectorAll('.sk-sidebar [data-section="goto"] [data-app]')].map((b) => [b.dataset.app, b.getAttribute('aria-current') === 'true'])`);
      assert.deepStrictEqual(goto.map((g) => g[0]), ['sketchstudio', 'shaper', 'penplotter', 'trace'], `${host.id}: GO TO lists the 4 apps`);
      assert.deepStrictEqual(goto.filter((g) => g[1]).map((g) => g[0]), [host.id], `${host.id}: GO TO marks the current app`);
      assert.ok(['Untitled', 'Image Trace'].includes(await evalJs(`document.querySelector('.sk-sidebar-doc').textContent`)), `${host.id}: the document name is shown`);
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-sidebar [data-section="goto"] svg').length`), 4, `${host.id}: GO TO shows the four app icons`);
      if (host.id === 'trace') assert.strictEqual(await evalJs(`document.querySelector('[data-action="download-svg"]').disabled`), true, 'trace: Download is disabled until there is a trace');
      if (process.env.EVIDENCE_DIR) { const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 700, height: 800, scale: 1.4 } }); fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `${host.id}-sidebar-open.png`), Buffer.from(s.data, 'base64')); }
      // focus is trapped: Tab many times, the focus never leaves the drawer
      for (let i = 0; i < 12; i++) await key2('Tab', 'Tab', 9);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').contains(document.activeElement)`), true, `${host.id}: focus stays trapped inside the open drawer`);
      await key2('Tab', 'Tab', 9, 8); // shift+Tab
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').contains(document.activeElement)`), true);
      // Esc closes
      await key2('Escape', 'Escape', 27);
      await waitFor(`!(${SIDEBAR_OPEN})`, `${host.id}: Esc to close the drawer`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, `${host.id}: Esc closes`);
      // reopen, click OUTSIDE (the backdrop) closes
      await clickEl('.sk-sidebar-btn');
      await waitFor(SIDEBAR_OPEN, `${host.id}: the drawer to reopen`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), true);
      await click(1100, 500);
      await waitFor(`!(${SIDEBAR_OPEN})`, `${host.id}: the outside click to close the drawer`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, `${host.id}: an outside click closes`);
      console.log(`${host.id}: sidebar ok (${acts.join(', ')})`);
    }
    // ── a second VIEW plugs in (the future Projects browser): registered views swap the drawer body, drill down and come back ──
    {
      await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn')`, 'Shaper to mount its sidebar');
      await evalJs(`(async () => {
        const { createAppSidebar } = await import('/packages/ui/app-sidebar.js');
        const sb = createAppSidebar({ current: 'shaper', docName: 'T', actions: [{ id: 'projects', label: 'Projects', onClick: () => {} }, { id: 'danger', label: 'Danger', confirm: 'Sure?', onClick: () => { window.__ran = (window.__ran || 0) + 1; } }],
          views: { projects: { title: 'Projects', render: (box, { go }) => {
            const list = (title, rows, next) => { box.innerHTML = '<div class="lvl" data-lvl="' + title + '"></div>'; for (const r of rows) { const b = document.createElement('button'); b.className = 'sk-sidebar-item row'; b.textContent = r; b.addEventListener('click', () => next(r)); box.appendChild(b); } };
            list('projects', ['Kitchen', 'Shed'], (p) => list('designs of ' + p, [p + ' A', p + ' B'], () => {}));
          } } } });
        document.body.appendChild(sb.el); window.__sb2 = sb; sb.open();
      })()`);
      await waitFor(`(() => { const b = document.querySelector('.sk-sidebar [data-action="danger"]'); return !!b && window.__sb2.isOpen() && b.getBoundingClientRect().width > 0; })()`, 'the second sidebar to open');
      // an action with `confirm` asks inline first; Cancel returns to the list without running it
      await clickEl('.sk-sidebar [data-action="danger"]');
      await waitFor(`!!document.querySelector('.sk-sidebar .sk-sidebar-confirm')`, 'the confirm prompt');
      assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sidebar .sk-sidebar-confirm')`), true, 'a confirm action asks before running');
      await clickEl('.sk-sidebar-confirm .cancel');
      await waitFor(`!document.querySelector('.sk-sidebar .sk-sidebar-confirm')`, 'Cancel to dismiss the confirm prompt');
      assert.strictEqual(await evalJs(`(window.__ran || 0) === 0 && !!document.querySelector('.sk-sidebar [data-action="danger"]')`), true, 'Cancel runs nothing and restores the row');
      await evalJs(`window.__sb2.showView('projects')`);
      await waitFor(`!!document.querySelector('.sk-sidebar-view')`, 'the projects view to render');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-view').dataset.view`), 'projects', 'the extra view replaced the main body');
      assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sidebar [data-section="goto"]')`), false, 'the main list is not shown while the view is');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-view .lvl').dataset.lvl`), 'projects');
      await clickEl('.sk-sidebar-view .row');
      await waitFor(`document.querySelector('.sk-sidebar-view .lvl').dataset.lvl === 'designs of Kitchen'`, 'the view to drill into a project');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-view .lvl').dataset.lvl`), 'designs of Kitchen', 'drills down a level inside the view');
      await clickEl('.sk-sidebar-back');
      await waitFor(`!!document.querySelector('.sk-sidebar [data-section="goto"]')`, 'the back arrow to return to the main view');
      assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sidebar [data-section="goto"]')`), true, 'the back arrow returns to the main view');
    }
    console.log('app-sidebar: ok');
  } finally {
    await cdp.close();
  }
})();
