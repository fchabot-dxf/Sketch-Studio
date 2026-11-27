// tests/audits/design-run-audit-1017-kit.js — TASK 1017 (AUDIT ONLY, outside the gate)
// Shared live headless-Chrome (1280x800) CDP driver for Real-Design Audit Parts C and D.
// Drives SketchStudio purely through real pointer/keyboard/ribbon/dialog UI events; reads state read-only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, sendRealKey } from '../helpers/cdp-browser.js';
import { installFakeDriveSession } from '../helpers/fake-drive-session.js';
import { resetBufferLive } from '../helpers/reset-buffer.js';
import { pressRibbonTool } from '../helpers/ribbon-tool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const EVID_DIR = path.join(REPO_ROOT, '.evidence', '1017');
fs.mkdirSync(EVID_DIR, { recursive: true });

export const row = (id, text) => console.log(`ROW ${id} | ${text}`);
export const f = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? (Math.abs(v) < 5e-6 ? '0' : Number(v.toFixed(d)).toString()) : String(v));

const VK_MAP = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Escape: { code: 'Escape', vk: 27, text: '' },
  Tab: { code: 'Tab', vk: 9, text: '' },
  Backspace: { code: 'Backspace', vk: 8, text: '' },
  Delete: { code: 'Delete', vk: 46, text: '' },
  ArrowDown: { code: 'ArrowDown', vk: 40, text: '' },
  ArrowUp: { code: 'ArrowUp', vk: 38, text: '' },
  ' ': { code: 'Space', vk: 32, text: ' ' },
};

export async function startStudio({ tag = '1017', view = { cx: 0, cy: 0, vw: 220 } } = {}) {
  const cdp = await launchBrowser({
    tag,
    width: 1280,
    height: 800,
    args: ['--host-resolver-rules=MAP *googleapis.com ~NOTFOUND, MAP *google.com ~NOTFOUND, MAP *gstatic.com ~NOTFOUND, MAP *shapertools.com ~NOTFOUND'],
  });
  if (!cdp) throw new Error('No headless Chrome/Edge browser installed');
  const fakeDrive = await installFakeDriveSession(cdp);
  const url = `http://127.0.0.1:${cdp.port}/apps/sketchstudio/index.html`;

  async function openFresh() {
    await resetBufferLive(cdp);
    await cdp.navigate(url, 12000);
    await cdp.waitForApp('svgCanvas');
    // Use low grid magnetism like CAD free-pointer work only if needed? NO — test real default settings!
    // Wait a moment for render loop & glyphs
    await sleep(350);
    await setView(view.cx, view.cy, view.vw);
  }

  async function setView(cx, cy, vw) {
    // Drive REAL mouseWheel + middle-mouse pan so state.view stays 100% in sync with svg viewBox!
    const rect = await cdp.evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; })()`);
    for (let i = 0; i < 40; i++) {
      const curW = await cdp.evalJs(`document.getElementById('svgCanvas').viewBox.baseVal.width`);
      if (Math.abs(curW - vw) / vw < 0.08) break;
      const dy = curW < vw ? 120 : -120;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rect.cx, y: rect.cy, deltaX: 0, deltaY: dy });
      await sleep(18);
    }
    await sleep(60);
    // Pan target (cx, cy) to canvas centre via real middle-button drag
    for (let pass = 0; pass < 2; pass++) {
      const cur = await w2s(cx, cy);
      const dx = rect.cx - cur.x, dy = rect.cy - cur.y;
      if (Math.hypot(dx, dy) < 4) break;
      const sx = Math.max(40, Math.min(1240, Math.round(cur.x)));
      const sy = Math.max(160, Math.min(720, Math.round(cur.y)));
      const ex = Math.max(40, Math.min(1240, Math.round(sx + dx)));
      const ey = Math.max(160, Math.min(720, Math.round(sy + dy)));
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: sy, button: 'none', clickCount: 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'middle', buttons: 4, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ex, y: ey, button: 'middle', buttons: 4, clickCount: 0 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex, y: ey, button: 'middle', buttons: 0, clickCount: 1 });
      await sleep(70);
    }
    await sleep(100);
  }

  async function w2s(wx, wy) {
    return cdp.evalJs(`(() => {
      const svg = document.getElementById('svgCanvas');
      const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy};
      const p = pt.matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    })()`);
  }

  async function moveScreen(sx, sy, buttons = 0) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(sx),
      y: Math.round(sy),
      button: buttons ? 'left' : 'none',
      buttons,
      clickCount: 0,
    });
    await sleep(35);
  }

  async function moveW(wx, wy, buttons = 0) {
    const p = await w2s(wx, wy);
    await moveScreen(p.x, p.y, buttons);
    return p;
  }

  async function clickScreen(sx, sy, { clicks = 1, button = 'left', modifiers = 0, settle = 140 } = {}) {
    const rx = Math.round(sx), ry = Math.round(sy);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, button: 'none', clickCount: 0, modifiers });
    await sleep(35);
    const btns = button === 'right' ? 2 : 1;
    for (let k = 1; k <= clicks; k++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button, buttons: btns, clickCount: k, modifiers });
      await sleep(35);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button, buttons: 0, clickCount: k, modifiers });
      if (k < clicks) await sleep(65);
    }
    await sleep(settle);
  }

  async function clickW(wx, wy, opts = {}) {
    const p = await w2s(wx, wy);
    await clickScreen(p.x, p.y, opts);
    return p;
  }

  async function dragScreen(a, b, { steps = 14, settle = 200 } = {}) {
    const ax = Math.round(a.x), ay = Math.round(a.y), bx = Math.round(b.x), by = Math.round(b.y);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ax, y: ay, button: 'none', clickCount: 0 });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ax, y: ay, button: 'left', buttons: 1, clickCount: 1 });
    for (let k = 1; k <= steps; k++) {
      await sleep(18);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(ax + (bx - ax) * k / steps),
        y: Math.round(ay + (by - ay) * k / steps),
        button: 'left',
        buttons: 1,
        clickCount: 0,
      });
    }
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx, y: by, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }

  async function dragW(w1, w2, opts = {}) {
    const a = await w2s(w1[0], w1[1]);
    const b = await w2s(w2[0], w2[1]);
    await dragScreen(a, b, opts);
  }

  async function pressKey(k, { ctrl = false, shift = false, alt = false, settle = 110 } = {}) {
    const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    let code, vk, text;
    if (VK_MAP[k]) {
      ({ code, vk, text } = VK_MAP[k]);
      if (ctrl || alt) text = '';
    } else if (/^[a-zA-Z]$/.test(k)) {
      const up = k.toUpperCase();
      code = 'Key' + up;
      vk = up.charCodeAt(0);
      text = (ctrl || alt) ? '' : (shift ? up : k);
    } else if (/^[0-9]$/.test(k)) {
      code = 'Digit' + k;
      vk = k.charCodeAt(0);
      text = (ctrl || alt) ? '' : k;
    } else {
      code = '';
      vk = k.charCodeAt(0);
      text = (ctrl || alt) ? '' : k;
    }
    await sendRealKey(cdp.send, shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k, code, vk, modifiers, text);
    await sleep(settle);
  }

  async function typeText(str, { settle = 80 } = {}) {
    for (const ch of String(str)) {
      if (/^[a-zA-Z0-9]$/.test(ch)) {
        await pressKey(ch, { shift: /^[A-Z]$/.test(ch), settle: 25 });
      } else {
        await cdp.send('Input.insertText', { text: ch });
        await sleep(25);
      }
    }
    await sleep(settle);
  }

  async function clickTool(toolId) {
    const id = toolId.startsWith('tool-') || toolId.startsWith('btn-') ? toolId : `tool-${toolId}`;
    await pressRibbonTool(cdp.evalJs, (p) => clickScreen(p.x, p.y, { settle: 120 }), id);
    await sleep(80);
  }

  async function clickEl(selector, { settle = 140 } = {}) {
    const pt = await cdp.evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!pt) return false;
    await clickScreen(pt.x, pt.y, { settle });
    return true;
  }

  async function clearToasts() {
    await cdp.evalJs(`document.querySelectorAll('#notification-container [data-level]').forEach(e => e.remove())`);
  }

  async function readState() {
    return cdp.evalJs(`(() => {
      const svg = document.getElementById('svgCanvas');
      const joints = (window.ug && window.ug.debug && window.ug.debug.dof) ? window.ug.debug.dof.logAll() : [];
      const shapes = [...svg.querySelectorAll('.shape-elem[data-shape-id]')].map((el) => {
        const tag = el.tagName.toLowerCase();
        const dash = el.getAttribute('stroke-dasharray') || '';
        const stroke = getComputedStyle(el).stroke || el.getAttribute('stroke') || '';
        const base = {
          id: el.dataset.shapeId,
          tag,
          construction: !!dash && dash !== 'none',
          stroke,
        };
        if (tag === 'line') {
          base.x1 = +el.getAttribute('x1'); base.y1 = +el.getAttribute('y1');
          base.x2 = +el.getAttribute('x2'); base.y2 = +el.getAttribute('y2');
          base.len = Math.hypot(base.x2 - base.x1, base.y2 - base.y1);
        } else if (tag === 'circle') {
          base.cx = +el.getAttribute('cx'); base.cy = +el.getAttribute('cy'); base.r = +el.getAttribute('r');
        } else if (tag === 'path') {
          base.d = el.getAttribute('d');
        }
        return base;
      });
      const labels = [...svg.querySelectorAll('.dim-label[data-constraint-idx]')].map((g) => {
        const t = g.querySelector('text');
        const r = t ? t.getBoundingClientRect() : g.getBoundingClientRect();
        return {
          idx: +g.dataset.constraintIdx,
          text: t ? t.textContent.trim() : g.textContent.trim(),
          cx: Math.round(r.left + r.width / 2),
          cy: Math.round(r.top + r.height / 2),
        };
      });
      const toasts = [...document.querySelectorAll('#notification-container [data-level]')].map((e) => ({
        level: e.dataset.level,
        text: e.textContent.trim(),
      }));
      const activeToolBtn = document.querySelector('.sk-ribbon-btn.active');
      const activeTool = activeToolBtn ? activeToolBtn.id : null;
      const constrBtn = document.querySelector('.sk-construction-btn, [data-action="construction"], button[aria-label*="Construction"]');
      const constructionOn = constrBtn ? constrBtn.getAttribute('aria-pressed') === 'true' || constrBtn.classList.contains('active') : null;
      const undoBtn = document.querySelector('#btn-undo, button[aria-label="Undo"]');
      const redoBtn = document.querySelector('#btn-redo, button[aria-label="Redo"]');
      const dimBox = document.getElementById('dimInput');
      const dimBoxOpen = !!(dimBox && !dimBox.classList.contains('hidden'));
      const dualBox = document.getElementById('dualInput');
      const dualBoxOpen = !!(dualBox && !dualBox.classList.contains('hidden'));
      const offsetBox = document.getElementById('offset-distance-input');
      const offsetBoxOpen = !!(offsetBox && getComputedStyle(offsetBox).display !== 'none');
      const hint = document.getElementById('dimHint');
      const hintText = hint && !hint.classList.contains('hidden') ? hint.textContent.trim() : '';
      const browserRows = [...document.querySelectorAll('.sk-browser .sk-info-row')].map((r) => r.textContent.trim());
      const nonOriginJoints = joints.filter((j) => j.id !== 'j_origin');
      const freeJoints = nonOriginJoints.filter((j) => j.dof > 0);
      const totalDof = nonOriginJoints.reduce((a, j) => a + (j.dof || 0), 0);
      const blueShapes = shapes.filter((s) => /#2b9bd6|43,\s*155,\s*214/i.test(s.stroke)).length;
      return {
        jointCount: nonOriginJoints.length,
        joints: nonOriginJoints,
        freeCount: freeJoints.length,
        totalDof,
        blueShapes,
        fullyConstrained: nonOriginJoints.length > 0 && freeJoints.length === 0 && blueShapes === 0,
        shapes,
        labels,
        toasts,
        activeTool,
        constructionOn,
        canUndo: undoBtn ? !undoBtn.disabled : null,
        canRedo: redoBtn ? !redoBtn.disabled : null,
        dimBoxOpen,
        dimBoxVal: dimBoxOpen ? dimBox.value : null,
        dimBoxReadOnly: dimBoxOpen ? !!dimBox.readOnly : null,
        dualBoxOpen,
        offsetBoxOpen,
        hintText,
        browserRows,
        solve: window.__lastSolveStats || null,
      };
    })()`);
  }

  async function readBufferDoc() {
    return cdp.evalJs(`import('/packages/ui/project-store.js').then(async (m) => {
      const buf = await m.getProjectStore().readBuffer();
      if (!buf || !buf.tabs) return null;
      const tab = buf.tabs[buf.active || 0] || buf.tabs[0];
      return tab ? { name: tab.name, designId: tab.designId, doc: tab.doc } : null;
    })`);
  }

  async function capture(filename, clip = null) {
    const params = clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' };
    const res = await cdp.send('Page.captureScreenshot', params);
    const fullPath = path.join(EVID_DIR, filename);
    const buf = Buffer.from(res.data, 'base64');
    fs.writeFileSync(fullPath, buf);
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    return { path: fullPath, rel: `.evidence/1017/${filename}`, md5 };
  }

  async function captureWorld(filename, wxMin, wyMin, wxMax, wyMax, pad = 40) {
    const p1 = await w2s(wxMin, wyMin);
    const p2 = await w2s(wxMax, wyMax);
    const x = Math.max(0, Math.round(Math.min(p1.x, p2.x) - pad));
    const y = Math.max(0, Math.round(Math.min(p1.y, p2.y) - pad));
    const x2 = Math.min(1280, Math.round(Math.max(p1.x, p2.x) + pad));
    const y2 = Math.min(800, Math.round(Math.max(p1.y, p2.y) + pad));
    return capture(filename, { x, y, width: Math.max(120, x2 - x), height: Math.max(120, y2 - y) });
  }

  return {
    cdp, fakeDrive, url, openFresh, setView, w2s, moveScreen, moveW, clickScreen, clickW,
    dragScreen, dragW, pressKey, typeText, clickTool, clickEl, clearToasts,
    readState, readBufferDoc, capture, captureWorld,
    close: () => cdp.close(),
  };
}
