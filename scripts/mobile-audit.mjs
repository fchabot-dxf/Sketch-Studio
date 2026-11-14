#!/usr/bin/env node
// scripts/mobile-audit.mjs  (TASK 561, audit only, no app code is touched)
// Drives ONE headless Edge/Chrome with CDP touch emulation (Emulation.setDeviceMetricsOverride mobile:true +
// setTouchEmulationEnabled + Input.dispatchTouchEvent) over SketchStudio, Shaper and Pen Plotter, takes the
// screenshots, measures the DOM (tap-target size, gaps, overflow, small text, canvas share, hover-only rules) and
// probes touch-and-hold. Output: <out>/*.png and <out>/measurements.json.
// Usage: node scripts/mobile-audit.mjs [outDir=.evidence/561]
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.evidence', '561'));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const DEVICES = [
  { id: 'p390', w: 390, h: 844, dpr: 3, full: true },
  { id: 'p360', w: 360, h: 740, dpr: 3, full: false },
  { id: 't820', w: 820, h: 1180, dpr: 2, full: false },
];

function findBrowser() {
  for (const c of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe']) if (fs.existsSync(c)) return c;
  return null;
}
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let url = (req.url || '/').split('?')[0]; if (url.endsWith('/')) url += 'index.html';
        const file = path.normalize(path.join(ROOT, decodeURIComponent(url)));
        if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        const data = await fsp.readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
      } catch (e) { res.writeHead(404); res.end('nf'); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---- in-page measurement (returns plain JSON) ----
const MEASURE = `((canvasSel) => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return null; const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return null;
    for (let p = el; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden') return null; }
    if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return { r, off: true }; return { r, off: false }; };
  const nm = (el) => (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') || el.tagName.toLowerCase();
  const lbl = (el) => (el.getAttribute('aria-label') || el.title || el.textContent || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 24);
  const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], summary, label, .tool-btn, .sk-ribbon-btn';
  const all = [...document.querySelectorAll(sel)].map(el => ({ el, v: vis(el) })).filter(x => x.v);
  // a label that wraps an input is the input's tap target: drop the label when it contains a control
  const tap = all.filter(x => !(x.el.tagName === 'LABEL' && x.el.querySelector('input,select,textarea,button')));
  const small = tap.filter(x => x.v.r.width < 44 || x.v.r.height < 44);
  const rec = (x) => ({ n: nm(x.el), t: lbl(x.el), w: Math.round(x.v.r.width * 10) / 10, h: Math.round(x.v.r.height * 10) / 10, onscreen: !x.v.off });
  const onTap = tap.filter(x => !x.v.off);
  // close pairs: both on screen, not nested, gap < 8 css px (touching/overlapping counts as 0)
  const close = [];
  for (let i = 0; i < onTap.length; i++) for (let j = i + 1; j < onTap.length; j++) {
    const a = onTap[i], b = onTap[j]; if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const dx = Math.max(0, Math.max(a.v.r.left, b.v.r.left) - Math.min(a.v.r.right, b.v.r.right));
    const dy = Math.max(0, Math.max(a.v.r.top, b.v.r.top) - Math.min(a.v.r.bottom, b.v.r.bottom));
    const gap = Math.hypot(dx, dy); if (gap < 8) close.push({ a: nm(a.el) + ' ' + lbl(a.el), b: nm(b.el) + ' ' + lbl(b.el), gap: Math.round(gap * 10) / 10 });
  }
  // text under 12 px (visible, on screen, own text node)
  const tiny = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) { const t = n.nodeValue.trim(); if (!t) continue; const p = n.parentElement; if (!p || /^(SCRIPT|STYLE|TITLE)$/.test(p.tagName)) continue;
    if (p.closest('svg') && !p.closest('text')) continue; const v = vis(p); if (!v || v.off) continue;
    const fs = parseFloat(getComputedStyle(p).fontSize); if (fs < 12) { const k = nm(p) + ' ' + fs + 'px'; const e = tiny.get(k) || { k, count: 0, sample: t.slice(0, 20) }; e.count++; tiny.set(k, e); } }
  // horizontal overflow
  const de = document.documentElement;
  const wide = []; for (const el of document.querySelectorAll('body *')) { const v = vis(el); if (!v || v.off) continue; if (v.r.right > vw + 1 || v.r.left < -1) { const sc = el.closest('.sk-ribbon,.no-scrollbar,[class*=overflow]'); wide.push({ n: nm(el), left: Math.round(v.r.left), right: Math.round(v.r.right), insideScroller: !!sc && sc !== el }); } }
  // canvas share
  let canvas = null; const cv = document.querySelector(canvasSel);
  if (cv) { const r = cv.getBoundingClientRect(); const vx = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left)), vy = Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
    let hit = 0, tot = 0, over = {}; for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { const x = Math.max(0, r.left) + (i + 0.5) * vx / 16, y = Math.max(0, r.top) + (j + 0.5) * vy / 16; const e = document.elementFromPoint(x, y); tot++; if (e && cv.contains(e)) hit++; else if (e) { const k = nm(e.closest('[id],[class]') || e); over[k] = (over[k] || 0) + 1; } }
    canvas = { css: Math.round(r.width) + 'x' + Math.round(r.height), pctOfViewport: Math.round(vx * vy / (vw * vh) * 1000) / 10, pctUncovered: Math.round(hit / tot * 1000) / 10, coveredBy: over }; }
  // hover-only: stylesheet rules with :hover that show/hide something, plus title-only controls (a tooltip is hover-only)
  const hov = new Set(); for (const ss of document.styleSheets) { let rules; try { rules = ss.cssRules; } catch (e) { continue; } const walk = (rs) => { for (const r of rs) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText && r.selectorText.includes(':hover') && /(display|visibility|opacity|transform|width|height)\\s*:/.test(r.style.cssText) && !/background|color/.test(r.selectorText.slice(0,0))) hov.add(r.selectorText.slice(0, 80) + ' { ' + r.style.cssText.slice(0, 60) + ' }'); } }; walk(rules); }
  const titleOnly = tap.filter(x => x.el.title && !x.el.getAttribute('aria-label') && !(x.el.textContent || '').trim() && !x.el.querySelector('text')).map(x => nm(x.el) + ' "' + x.el.title.slice(0, 28) + '"');
  return { viewport: vw + 'x' + vh, dpr: devicePixelRatio, docScrollW: de.scrollWidth, docClientW: de.clientWidth, hScroll: de.scrollWidth > de.clientWidth + 1, bodyScrollW: document.body.scrollWidth,
    tappable: tap.length, tappableOnscreen: onTap.length, under44: small.length, under44Onscreen: small.filter(x => !x.v.off).length, under44List: small.map(rec).slice(0, 60),
    minOnscreen: onTap.reduce((m, x) => Math.min(m, x.v.r.width, x.v.r.height), 999),
    closePairs: close.length, closeList: close.slice(0, 25), tinyText: [...tiny.values()].sort((a, b) => b.count - a.count).slice(0, 15), wide: wide.slice(0, 15),
    canvas, hoverRules: [...hov].slice(0, 20), titleOnlyControls: titleOnly.slice(0, 25) };
})`;

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.maxTouch = 0;
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      else if (m.method === 'Runtime.exceptionThrown') this.errors.push('EXC ' + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text).slice(0, 160));
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push('CONSOLE.ERR ' + (m.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 160)); }); }
  send(method, params = {}) { return new Promise((res) => { const id = ++this.id; this.pending.set(id, (m) => res(m.result || m.error || {})); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text }; return r.result ? r.result.value : undefined; }
}

async function closeBrowser(proc, dbgPort) {
  try { const v = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).json(); const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); setTimeout(rej, 2000); }); ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); await sleep(1500); try { ws.close(); } catch (_) {} } catch (_) {}
  try { if (proc.pid) execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (_) {}
}

const results = { device: {}, notes: [] };
const shots = [];

(async () => {
  const browser = findBrowser(); if (!browser) { console.error('no Edge/Chrome'); process.exit(2); }
  const { server, port } = await startServer();
  const dbg = 9300 + Math.floor(Date.now() % 600);
  const userDir = path.join(os.tmpdir(), 'sk-mobile-audit-' + process.pid);
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions', `--remote-debugging-port=${dbg}`, `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${dbg}/json/version`)).ok) break; } catch (_) {} await sleep(250); }
    let page; for (let i = 0; i < 40 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json()).find(t => t.type === 'page'); } catch (_) {} await sleep(200); }
    const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
    const c = new Cdp(ws); await c.send('Runtime.enable'); await c.send('Page.enable');
    const base = `http://127.0.0.1:${port}`;

    // ---------- helpers ----------
    let cur = null;
    const setDevice = async (d) => { cur = d;
      await c.send('Emulation.setDeviceMetricsOverride', { width: d.w, height: d.h, deviceScaleFactor: d.dpr, mobile: true });
      await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await c.send('Emulation.setEmitTouchEventsForMouse', { enabled: false }); };
    const nav = async (url) => { await c.send('Page.navigate', { url }); await sleep(2500); };
    const fresh = async (url) => { await nav(url); await c.ev('try{localStorage.clear();sessionStorage.clear()}catch(e){}'); await nav(url); };
    const shot = async (name) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); const f = `${cur.id}-${name}.png`; fs.writeFileSync(path.join(OUT, f), Buffer.from(r.data, 'base64')); shots.push(f); return f; };
    const rectOf = (sel) => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ inline: 'center', block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top }; })()`);
    const T = (type, pts) => c.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 1, radiusY: 1, force: 1 })) });
    const tap = async (x, y, hold = 40) => { await T('touchStart', [{ x, y }]); await sleep(hold); await T('touchEnd', []); await sleep(120); };
    const tapSel = async (sel) => { const r = await rectOf(sel); if (!r) { results.notes.push(`${cur.id}: tapSel missing ${sel}`); return false; } await sleep(60); const r2 = await rectOf(sel); await tap(r2.x, r2.y); return true; };
    const drag = async (a, b, steps = 12, hold = 0) => { await T('touchStart', [a]); if (hold) await sleep(hold); for (let i = 1; i <= steps; i++) { await T('touchMove', [{ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }]); await sleep(16); } await T('touchEnd', []); await sleep(150); };
    const pinch = async (cx, cy, d0, d1, steps = 12) => { const P = (d) => [{ x: cx - d / 2, y: cy, id: 0 }, { x: cx + d / 2, y: cy, id: 1 }]; await T('touchStart', P(d0)); for (let i = 1; i <= steps; i++) { await T('touchMove', P(d0 + (d1 - d0) * i / steps)); await sleep(16); } await T('touchEnd', []); await sleep(200); };
    const twoPan = async (cx, cy, dx, dy, steps = 12) => { const P = (k) => [{ x: cx - 30 + dx * k, y: cy + dy * k, id: 0 }, { x: cx + 30 + dx * k, y: cy + dy * k, id: 1 }]; await T('touchStart', P(0)); for (let i = 1; i <= steps; i++) { await T('touchMove', P(i / steps)); await sleep(16); } await T('touchEnd', []); await sleep(200); };
    const esc = async () => { await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(150); };
    const measure = async (name, canvasSel) => { const m = await c.ev(`${MEASURE}(${JSON.stringify(canvasSel)})`); (results.device[cur.id] = results.device[cur.id] || {})[name] = m; return m; };
    const vb = (sel) => c.ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); return s ? s.getAttribute('viewBox') : null; })()`);
    const countGeo = (sel) => c.ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); return s ? s.querySelectorAll('line,path,circle,polyline').length : -1; })()`);
    // contextmenu / pointer probe: logs every contextmenu event + whether the shared menu element exists afterwards
    const installProbe = () => c.ev(`(() => { if (window.__probe) return; window.__probe = { ctx: [], pd: [], click: [], t0: 0 }; const P = window.__probe;
      document.addEventListener('contextmenu', e => P.ctx.push({ t: Math.round(performance.now()), target: (e.target.id || e.target.tagName) + '.' + (e.target.getAttribute && e.target.getAttribute('class') || ''), defaultPrevented: false, pt: e.pointerType }), true);
      document.addEventListener('contextmenu', e => { P.ctx[P.ctx.length - 1].defaultPrevented = e.defaultPrevented; });
      document.addEventListener('pointerdown', e => { P.pd.push({ t: performance.now(), type: e.pointerType }); requestAnimationFrame(() => requestAnimationFrame(() => { P.pd[P.pd.length - 1].frame = performance.now(); })); }, true);
      document.addEventListener('pointerup', e => { P.up = performance.now(); }, true);
      document.addEventListener('click', e => { P.click.push({ t: performance.now(), sincePointerUp: P.up ? Math.round((performance.now() - P.up) * 10) / 10 : null }); }, true); })()`);
    const probeReset = () => c.ev('window.__probe && (window.__probe.ctx = [], window.__probe.pd = [], window.__probe.click = [])');
    const probeRead = () => c.ev(`(() => ({ ctx: window.__probe.ctx, menuOpen: !!document.querySelector('.sk-context-menu'), menuItems: [...document.querySelectorAll('.sk-context-item')].map(e => e.textContent), pd: window.__probe.pd.map(p => ({ type: p.type, toFrameMs: p.frame ? Math.round((p.frame - p.t) * 10) / 10 : null })), click: window.__probe.click.slice(0, 3) }))()`);
    const closeMenu = async () => { await c.ev(`document.querySelector('.sk-context-menu') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(100); };

    // the long-press matrix for a host: empty canvas, shape edge, joint, dimension label
    const longPressMatrix = async (host, targets) => {
      const out = {}; await installProbe();
      for (const [k, pt] of Object.entries(targets)) { if (!pt) { out[k] = 'no target'; continue; }
        await probeReset(); await closeMenu();
        await T('touchStart', [pt]); await sleep(700); const during = await probeRead(); await T('touchEnd', []); await sleep(250); const after = await probeRead();
        out[k] = { atPt: pt, duringHold: { ctxEvents: during.ctx.length, menuOpen: during.menuOpen }, afterRelease: { ctxEvents: after.ctx.length, menuOpen: after.menuOpen, items: after.menuItems, ctx: after.ctx } };
        await shot(`${host}-longpress-${k}`); await closeMenu(); await esc(); }
      (results.longPress = results.longPress || {})[`${cur.id}-${host}`] = out; return out; };

    // ===== SketchStudio =====
    const sketchStudio = async (d) => {
      await setDevice(d); await fresh(`${base}/apps/sketchstudio/index.html`);
      await shot('ss-first-screen'); await measure('ss-first-screen', '#svgCanvas');
      results.device[d.id]['ss-first-screen'].consoleErrors = c.errors.slice(0, 5);
      // ribbon: swipe it by touch and read scrollLeft; scrolled states
      const rr = await c.ev(`(() => { const r = document.querySelector('.sk-ribbon'); return r ? { sw: r.scrollWidth, cw: r.clientWidth, sl: r.scrollLeft, top: r.getBoundingClientRect().top, h: r.getBoundingClientRect().height, groups: document.querySelectorAll('.sk-ribbon-group').length } : null; })()`);
      results.device[d.id].ribbon = rr;
      const ry = rr ? rr.top + rr.h / 2 : 100;
      if (rr && rr.sw > rr.cw + 4) {
        await drag({ x: d.w - 20, y: ry - 10 }, { x: 20, y: ry - 10 }, 10); results.device[d.id].ribbon.afterTouchSwipe = await c.ev(`document.querySelector('.sk-ribbon').scrollLeft`);
        await shot('ss-ribbon-after-swipe');
        await c.ev(`document.querySelector('.sk-ribbon').scrollLeft = (document.querySelector('.sk-ribbon').scrollWidth) / 2`); await sleep(150); await shot('ss-ribbon-mid');
        await c.ev(`document.querySelector('.sk-ribbon').scrollLeft = 99999`); await sleep(150); await shot('ss-ribbon-end');
        await c.ev(`document.querySelector('.sk-ribbon').scrollLeft = 0`); await sleep(100);
      }
      await measure('ss-ribbon-all', '#svgCanvas');
      // latency of a ribbon tap (pointerup to click) + canvas pointerdown to next painted frame
      await installProbe(); await probeReset(); await tapSel('#tool-line'); results.device[d.id].latencyRibbonTap = await probeRead();
      await tapSel('#tool-select');
      // CONTROL: does CDP touch emulation fire `contextmenu` on a long press at all? (a plain div outside any app handler)
      if (d.full) { await c.ev(`(() => { const e = document.createElement('div'); e.id = 'lp-control'; e.style.cssText = 'position:fixed;left:150px;top:300px;width:90px;height:90px;background:#fc0;z-index:99999'; document.body.appendChild(e); window.__ctl = []; e.addEventListener('contextmenu', ev => window.__ctl.push(ev.type)); })()`);
        await T('touchStart', [{ x: 195, y: 345 }]); await sleep(900); await T('touchEnd', []); await sleep(200);
        results.longPressControl = await c.ev('window.__ctl'); await c.ev(`document.getElementById('lp-control').remove()`); }
      // sidebar (phones use the peeking .sk-sidebar-handle)
      await tapSel('.sk-sidebar-handle'); await sleep(400); await shot('ss-sidebar-open'); await measure('ss-sidebar-open', '#svgCanvas');
      await tapSel('[data-action="projects"]'); await sleep(900); await shot('ss-projects-modal'); await measure('ss-projects-modal', '#svgCanvas');
      await esc(); await esc(); await c.ev(`document.querySelectorAll('.sk-pm-backdrop,.sk-sidebar-backdrop').forEach(b => b.click())`); await sleep(300);
      if (!d.full) { await drawAndHold(d, 'ss', '#svgCanvas', '#world-group'); return; }
      // Params window
      await tapSel('#btn-parameters'); await sleep(500); await shot('ss-params-window'); await measure('ss-params-window', '#svgCanvas'); await tapSel('.sk-pwin button[aria-label*="lose"], .sk-pwin .sk-dock-close'); await esc();
      // Style panel (opened from ☰ sidebar menu on phones)
      await tapSel('.sk-sidebar-handle'); await sleep(250);
      await tapSel('.sk-sidebar-item[data-action="style"]'); await sleep(400); await shot('ss-style-panel'); await measure('ss-style-panel', '#svgCanvas'); await esc();
      if (await c.ev(`!!document.querySelector('.sk-style-panel') && !document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`)) { await evalJs(`document.querySelector('.sk-style-panel').classList.add('sk-hidden')`); await sleep(200); }
      // Debug panel (opened from ☰ sidebar menu)
      await tapSel('.sk-sidebar-handle'); await sleep(250);
      await tapSel('.sk-sidebar-item[data-action="debug"]'); await sleep(500); await shot('ss-debug-panel'); await measure('ss-debug-panel', '#svgCanvas'); await tapSel('#debug-close-btn'); await sleep(200);
      await drawAndHold(d, 'ss', '#svgCanvas', '#world-group');
    };

    // shared: draw line + rect with touch, select, drag a joint, pinch, two-finger pan, dim edit box, long-press matrix
    const drawAndHold = async (d, host, canvasSel, worldSel) => {
      const cr = await c.ev(`(() => { const r = document.querySelector(${JSON.stringify(canvasSel)}).getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const cx = cr.l + cr.w / 2, cy = cr.t + cr.h / 2; const U = Math.min(cr.w, cr.h) / 4;
      const geo0 = await countGeo(canvasSel); const rec = results.device[d.id]; rec[host + '-draw'] = { geoBefore: geo0 };
      // LINE: click-click, then a drag line
      await tapSel('#tool-line'); await shot(`${host}-line-tool-armed`);
      await installProbe(); await probeReset();
      await tap(cx - U, cy - U); await T('touchStart', [{ x: cx + U, y: cy - U }]); await sleep(30); await T('touchMove', [{ x: cx + U, y: cy - U }]); await shot(`${host}-line-rubberband-finger-down`); await T('touchEnd', []); await sleep(200);
      rec[host + '-draw'].geoAfterLine = await countGeo(canvasSel); await shot(`${host}-line-drawn-click-click`);
      rec[host + '-draw'].canvasPointerdownToFrame = (await probeRead()).pd;
      await tapSel('#tool-select');            // there is no Esc on touch: the only way out of the chain is another tool
      // RECT
      await tapSel('#tool-rect'); await shot(`${host}-rect-tool-armed`);
      await tap(cx - U, cy + U * 0.3); await drag({ x: cx + U, y: cy + U * 1.6 }, { x: cx + U, y: cy + U * 1.6 }, 1, 20); await sleep(200);
      rec[host + '-draw'].geoAfterRect = await countGeo(canvasSel); await shot(`${host}-rect-drawn`);
      await tapSel('#tool-select');
      if (host === 'ss') {
        // dimension edit box + its autocomplete: Dim tool, tap the rect's top edge, tap a placement point
        await tapSel('#tool-dim'); await tap(cx + U * 0.6, cy + U * 0.3); await sleep(150); await tap(cx + U * 0.6, cy - U * 0.3); await sleep(300); await shot('ss-dim-tool-after-placement-tap-1'); await tap(cx + U * 0.6, cy - U * 0.3); await sleep(500); await shot('ss-dim-tool-after-tap');
        rec['ss-dim-tap-tap-result'] = await c.ev(`({ dimLabels: document.querySelectorAll('.dim-label').length, inputVisible: !document.getElementById('dimInput').classList.contains('hidden') })`);
        await tapSel('#tool-select'); await tapSel('#tool-dim'); await drag({ x: cx + U * 0.6, y: cy + U * 0.3 }, { x: cx + U * 0.6, y: cy - U * 0.4 }, 10); await sleep(500); await shot('ss-dim-tool-after-drag');
        rec['ss-dim-input'] = await c.ev(`(() => { const i = document.getElementById('dimInput'); if (!i) return null; const r = i.getBoundingClientRect(); const cs = getComputedStyle(i); return { hidden: i.classList.contains('hidden'), x: r.left, y: r.top, w: r.width, h: r.height, fs: cs.fontSize, type: i.type, inputmode: i.inputMode, autocomplete: i.autocomplete, hasDatalist: !!i.list, value: i.value }; })()`);
        await measure('ss-dim-edit', '#svgCanvas');
        await c.send('Input.insertText', { text: 'wid' }); await sleep(300); await shot('ss-dim-input-typed-wid');
        rec['ss-dim-autocomplete'] = await c.ev(`({ datalists: document.querySelectorAll('datalist').length, suggestDom: [...document.querySelectorAll('[class*=suggest],[class*=autocomplete],[role=listbox]')].length })`);
        for (const t of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type: t, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: String.fromCharCode(13) });
        await sleep(400); await esc(); rec['ss-dim-after-enter-labels'] = await c.ev(`document.querySelectorAll('.dim-label').length`); await shot('ss-dim-after-enter');
        await tapSel('#tool-select');
      }
      // SELECT: tap the first line's midpoint, then a joint; then drag the joint
      await tap(cx, cy - U); await shot(`${host}-select-line-tap`);
      await tap(cx + U, cy - U); await shot(`${host}-select-joint-tap`);
      const vb0 = await vb(canvasSel);
      await drag({ x: cx + U, y: cy - U }, { x: cx + U + 40, y: cy - U - 30 }, 14); await shot(`${host}-drag-joint`);
      rec[host + '-draw'].vbAfterJointDrag = await vb(canvasSel);
      // PINCH out, then two-finger pan
      await pinch(cx, cy, 80, 220); await shot(`${host}-pinch-zoom-in`); rec[host + '-draw'].vbAfterPinch = await vb(canvasSel);
      await twoPan(cx, cy, 90, 60); await shot(`${host}-two-finger-pan`); rec[host + '-draw'].vbAfterPan = await vb(canvasSel);
      rec[host + '-draw'].vbStart = vb0;
      await c.ev(`(() => { const b = document.getElementById('btn-recenter-view'); if (b) b.click(); })()`); await sleep(400);
      // LONG PRESS matrix (select tool)
      const pts = await c.ev(`(() => { const svg = document.querySelector(${JSON.stringify(canvasSel)}); const q = (s) => { const e = svg.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
        const lines = [...svg.querySelectorAll('${worldSel} line, ${worldSel} path')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 20 || r.height > 20; });
        const cr = svg.getBoundingClientRect(); const L = lines.map(e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; });
        const dim = q('.dim-label'); return { shape: L[0] || null, dim, empty: { x: cr.left + 40, y: cr.top + 90 } }; })()`);
      // joint: a vertex of the first drawn line = endpoint (left end)
      const lineEnds = await c.ev(`(() => { const svg = document.querySelector(${JSON.stringify(canvasSel)}); const l = svg.querySelector('${worldSel} line'); if (!l) return null; const m = l.getScreenCTM(); const P = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(m); return { x: q.x, y: q.y }; }; const a = P(+l.getAttribute('x1'), +l.getAttribute('y1')), b = P(+l.getAttribute('x2'), +l.getAttribute('y2')); return { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; })()`);
      const jt = lineEnds && lineEnds.a; if (lineEnds) pts.shape = lineEnds.mid;
      await c.ev(`(() => { const b = document.getElementById('btn-recenter-view'); if (b) b.click(); })()`); await sleep(400);
      await longPressMatrix(host, { emptyCanvas: pts.empty, shapeEdge: pts.shape ? { x: pts.shape.x, y: pts.shape.y } : null, joint: jt, dimension: pts.dim });
      // SYNTHETIC: what Chrome Android fires on a long press (a `contextmenu` PointerEvent, pointerType touch) at the same targets
      { const out = {}; const targets = { shapeEdge: pts.shape && { x: pts.shape.x, y: pts.shape.y }, joint: jt, dimension: pts.dim, emptyCanvas: pts.empty };
        for (const [k, pt] of Object.entries(targets)) { if (!pt) { out[k] = 'no target'; continue; } await closeMenu();
          out[k] = await c.ev(`(() => { const el = document.elementFromPoint(${pt.x}, ${pt.y}); const ev = new PointerEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${pt.x}, clientY: ${pt.y}, pointerType: 'touch', button: 2 }); const notPrevented = el.dispatchEvent(ev); const m = document.querySelector('.sk-context-menu'); const r = m && m.getBoundingClientRect(); return { onEl: el.tagName + (el.getAttribute('class') ? '.' + el.getAttribute('class').split(' ')[0] : ''), defaultPrevented: !notPrevented, menuOpen: !!m, items: [...document.querySelectorAll('.sk-context-item')].map(e => e.textContent), menuRect: r && { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, rowH: m && Math.round(m.querySelector('.sk-context-item').getBoundingClientRect().height) }; })()`);
          await shot(`${host}-synthetic-contextmenu-${k}`); await closeMenu(); }
        (results.syntheticContextMenu = results.syntheticContextMenu || {})[`${cur.id}-${host}`] = out; }
      await tapSel('#tool-select');
    };

    // ===== Shaper =====
    const shaper = async (d) => {
      await setDevice(d); await fresh(`${base}/apps/shaper/index.html`);
      for (const mode of ['explore', 'design', 'vcarve', 'prepare', 'review']) {
        await tapSel('.sk-sidebar-handle'); await sleep(250);
        await tapSel(`.sk-sidebar-stage[data-tab="${mode}"]`); await sleep(900);
        const canvasSel = { explore: '#canvas', design: '#design-canvas', vcarve: '#vcarve-canvas', prepare: '#prepare-canvas', review: '#review-canvas-host' }[mode];
        await shot(`shaper-${mode}`); await measure(`shaper-${mode}`, canvasSel);
        if (d.full && mode === 'design') {
          await tapSel('.sk-sidebar-handle'); await sleep(400); await shot('shaper-sidebar-open'); await esc(); await c.ev(`document.querySelectorAll('.sk-sidebar-backdrop').forEach(b => b.click())`); await sleep(300);
          await tapSel('#btn-parameters'); await sleep(500); await shot('shaper-params-window'); await measure('shaper-params-window', '#design-canvas'); await esc();
          await drawAndHold(d, 'shaper', '#design-canvas', '#design-canvas > g');
          await tapSel('.sk-sidebar-handle'); await sleep(250);
          await tapSel('.sk-sidebar-stage[data-tab="design"]');
        }
      }
    };
    // ===== Pen Plotter =====
    const pen = async (d) => {
      await setDevice(d); await fresh(`${base}/apps/penplotter/index.html`);
      for (const st of ['design', 'toolpath', 'export']) {
        await tapSel('.sk-sidebar-handle'); await sleep(250);
        await tapSel(`.sk-sidebar-stage[data-tab="${st}"]`); await sleep(1000);
        const canvasSel = st === 'design' ? '#design-canvas' : `#stage-${st}`;
        await shot(`pen-${st}`); await measure(`pen-${st}`, canvasSel);
        if (d.full && st === 'design') {
          await tapSel('.sk-sidebar-handle'); await sleep(400); await shot('pen-sidebar-open'); await esc(); await c.ev(`document.querySelectorAll('.sk-sidebar-backdrop').forEach(b => b.click())`); await sleep(300);
          await drawAndHold(d, 'pen', '#design-canvas', '#design-canvas > g');
          await tapSel('.sk-sidebar-handle'); await sleep(250);
          await tapSel('.sk-sidebar-stage[data-tab="design"]');
        }
      }
    };

    for (const d of DEVICES) {
      console.log('device', d.id);
      for (const [name, fn] of [['sketchstudio', sketchStudio], ['shaper', shaper], ['penplotter', pen]]) {
        try { await fn(d); } catch (e) { results.notes.push(`${d.id} ${name} threw: ${e.message}`); console.log('ERR', d.id, name, e.message); }
        results.consoleErrors = c.errors.slice(0, 20);
      }
    }
    results.shots = shots;
    fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(results, null, 1));
    console.log('shots', shots.length, 'notes', results.notes.length);
    ws.close();
  } catch (e) { console.error('mobile-audit error:', e); fs.writeFileSync(path.join(OUT, 'measurements.partial.json'), JSON.stringify(results, null, 1)); process.exitCode = 1; }
  finally { await closeBrowser(proc, dbg); try { server.close(); } catch (_) {} try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {} }
})();
