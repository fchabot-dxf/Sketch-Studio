// tests/audits/interrupts-audit-1023-kit.js — TASK 1023 (AUDIT ONLY, outside the gate)
// Shared live headless-Chrome CDP driver for Tool Interruptions Audit.
// Drives real pointer, keyboard, wheel, right-click, touch, blur/focus, ribbon, panel, and footer events.
// Reads state read-only (zero changes to packages/ or apps/).
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
export const EVID_DIR = path.join(REPO_ROOT, '.evidence', '1023');
fs.mkdirSync(EVID_DIR, { recursive: true });

export const row = (id, tool, stage, interruption, result) =>
  console.log(`ROW ${id} | ${tool} | ${stage} | ${interruption} | ${result}`);

export const f = (v, d = 2) =>
  typeof v === 'number' && Number.isFinite(v)
    ? (Math.abs(v) < 5e-6 ? '0' : Number(v.toFixed(d)).toString())
    : String(v);

const VK_MAP = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Escape: { code: 'Escape', vk: 27, text: '' },
  Tab: { code: 'Tab', vk: 9, text: '' },
  Backspace: { code: 'Backspace', vk: 8, text: '' },
  Delete: { code: 'Delete', vk: 46, text: '' },
  ArrowDown: { code: 'ArrowDown', vk: 40, text: '' },
  ArrowUp: { code: 'ArrowUp', vk: 38, text: '' },
  F8: { code: 'F8', vk: 119, text: '' },
  ' ': { code: 'Space', vk: 32, text: ' ' },
};

// Fixture world coordinates (view cx=0, cy=0, vw=180; all well inside canvas, clear of SKETCHES browser on left)
export const FIX = {
  // L1: horizontal (-10, 20) -> (40, 20), driving dim d1 = 50 at (15, 36)
  L1_A: { x: -10, y: 20 },
  L1_B: { x: 40, y: 20 },
  L1_MID: { x: 15, y: 20 },
  D1_LBL: { x: 15, y: 36 },
  // L2: vertical (40, 20) -> (40, -20), shares corner (40, 20) with L1!
  L2_B: { x: 40, y: -20 },
  L2_MID: { x: 40, y: 0 },
  CORNER: { x: 40, y: 20 },
  // L3: horizontal (-10, -28) -> (55, -28), crossed by L4 at (15, -28)
  L3_A: { x: -10, y: -28 },
  L3_B: { x: 55, y: -28 },
  L3_LEFT: { x: 2, y: -28 },
  L3_RIGHT: { x: 35, y: -28 },
  // L4: vertical (15, -42) -> (15, -5)
  L4_A: { x: 15, y: -42 },
  L4_B: { x: 15, y: -5 },
  L4_BOT: { x: 15, y: -15 },
  // C1: free circle center (-30, 0), r = 12 (rim at (-18, 0) / (-30, -12))
  C1_C: { x: -30, y: 0 },
  C1_R: 12,
  C1_RIM: { x: -18, y: 0 },
  // L5: tilted line for H/V, parallel, perpendicular, mirror line, etc. (-5, -5) -> (5, 5)
  L5_A: { x: -5, y: -5 },
  L5_B: { x: 5, y: 8 },
  L5_MID: { x: 3, y: 5.4 },   // NOT (0, 1.5): that is within snap range of the origin, so the click picked the origin, not the line
  // G1: user group of 2 lines at bottom-left (-42, 26) -> (-22, 26) -> (-22, 38)
  G1_P1: { x: -42, y: 26 },
  G1_P2: { x: -22, y: 26 },
  G1_P3: { x: -22, y: 38 },
  G1_MID: { x: -32, y: 26 },
  // Empty canvas spots for drawing
  DRAW_P1: { x: 60, y: -10 },
  DRAW_P2: { x: 82, y: 6 },
  DRAW_P3: { x: 70, y: 22 },
  EMPTY: { x: 75, y: -32 },
  EMPTY2: { x: 60, y: 35 },
};

export async function startHost({ host = 'shaper', phone = false, tag = '1023' } = {}) {
  const width = phone ? 390 : 1280;
  const height = phone ? 844 : 800;
  const cdp = await launchBrowser({
    tag: `${tag}-${host}${phone ? '-phone' : ''}`,
    width,
    height,
    args: ['--host-resolver-rules=MAP *googleapis.com ~NOTFOUND, MAP *google.com ~NOTFOUND, MAP *gstatic.com ~NOTFOUND, MAP *shapertools.com ~NOTFOUND'],
  });
  if (!cdp) throw new Error('No headless Chrome/Edge browser installed');
  const fakeDrive = await installFakeDriveSession(cdp);
  const pageErrors = [];
  cdp.ws.addEventListener('message', (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') {
        const ex = m.params.exceptionDetails;
        pageErrors.push(ex?.exception?.description || ex?.text || JSON.stringify(ex));
      }
    } catch (_) {}
  });

  if (phone) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
  } else {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }

  const canvasId = host === 'sketchstudio' ? 'svgCanvas' : 'design-canvas';
  const stateExpr =
    host === 'shaper' ? 'window.__designController.state'
    : host === 'penplotter' ? 'window.__sketch.controller.state'
    : null;

  const url =
    host === 'shaper' ? `http://127.0.0.1:${cdp.port}/apps/shaper/index.html`
    : host === 'penplotter' ? `http://127.0.0.1:${cdp.port}/apps/penplotter/index.html`
    : `http://127.0.0.1:${cdp.port}/apps/sketchstudio/index.html`;

  await resetBufferLive(cdp);
  await cdp.navigate(url, 15000);
  if (host === 'shaper' || host === 'penplotter') {
    await cdp.waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, `${host} design tab`, 12000);
    await cdp.evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    await cdp.waitForApp(canvasId);
    if (stateExpr) {
      await cdp.waitFor(`!!(${stateExpr}) && document.getElementById(${JSON.stringify(canvasId)}).getBoundingClientRect().width > 0`, `${host} controller`, 12000);
    }
  } else {
    await cdp.waitForApp(canvasId);
  }
  await sleep(350);

  // Collapse the floating Sketches browser on desktop if it overlaps negative X, or leave collapsed only when not testing sidebar
  async function setBrowserCollapsed(collapsed) {
    await cdp.evalJs(`(() => {
      const b = document.querySelector('.sk-browser');
      const t = document.querySelector('.sk-browser-toggle');
      if (!b || !t) return;
      const isCol = b.classList.contains('collapsed');
      if (isCol !== ${!!collapsed}) t.click();
    })()`);
    await sleep(60);
  }

  async function w2s(wx, wy) {
    return cdp.evalJs(`(() => {
      const svg = document.getElementById(${JSON.stringify(canvasId)});
      const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy};
      const p = pt.matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    })()`);
  }

  async function moveScreen(sx, sy, buttons = 0, button = 'none') {
    if (phone && buttons === 0) return;   // PHONE: a finger has no hover
    const b = button !== 'none' ? button : (buttons === 1 ? 'left' : buttons === 4 ? 'middle' : buttons === 2 ? 'right' : 'none');
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(sx),
      y: Math.round(sy),
      button: b,
      buttons,
      clickCount: 0,
    });
    await sleep(25);
  }

  async function moveW(wx, wy, buttons = 0) {
    const p = await w2s(wx, wy);
    await moveScreen(p.x, p.y, buttons);
    return p;
  }

  async function clickScreen(sx, sy, { clicks = 1, button = 'left', modifiers = 0, settle = 90 } = {}) {
    if (phone && button === 'left') {   // PHONE: a click is a real finger tap (touchStart + touchEnd), never a mouse event
      for (let k = 0; k < clicks; k++) await tapTouchScreen(sx, sy, { settle: k < clicks - 1 ? 40 : Math.max(settle, 140) });
      return;
    }
    const rx = Math.round(sx), ry = Math.round(sy);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, button: 'none', clickCount: 0, modifiers });
    await sleep(20);
    const btns = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
    for (let k = 1; k <= clicks; k++) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button, buttons: btns, clickCount: k, modifiers });
      await sleep(25);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button, buttons: 0, clickCount: k, modifiers });
      if (k < clicks) await sleep(50);
    }
    await sleep(settle);
  }

  async function clickW(wx, wy, opts = {}) {
    const p = await w2s(wx, wy);
    await clickScreen(p.x, p.y, opts);
    return p;
  }

  async function pressDownW(wx, wy, { button = 'left', modifiers = 0 } = {}) {
    const p = await w2s(wx, wy);
    const rx = Math.round(p.x), ry = Math.round(p.y);
    const btns = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, button: 'none', clickCount: 0, modifiers });
    await sleep(20);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button, buttons: btns, clickCount: 1, modifiers });
    await sleep(30);
    return { x: rx, y: ry };
  }

  async function releaseUpScreen(sx, sy, { button = 'left', settle = 90 } = {}) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(sx), y: Math.round(sy), button, buttons: 0, clickCount: 1 });
    await sleep(settle);
  }

  async function wheelAt(sx, sy, deltaY = -120, settle = 80) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(sx), y: Math.round(sy), deltaX: 0, deltaY });
    await sleep(settle);
  }

  async function middlePan(sx, sy, dx, dy, { settle = 80 } = {}) {
    const ax = Math.round(sx), ay = Math.round(sy);
    const bx = Math.round(sx + dx), by = Math.round(sy + dy);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ax, y: ay, button: 'none', clickCount: 0 });
    await sleep(15);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ax, y: ay, button: 'middle', buttons: 4, clickCount: 1 });
    await sleep(20);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round((ax + bx) / 2), y: Math.round((ay + by) / 2), button: 'middle', buttons: 4, clickCount: 0 });
    await sleep(20);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bx, y: by, button: 'middle', buttons: 4, clickCount: 0 });
    await sleep(20);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx, y: by, button: 'middle', buttons: 0, clickCount: 1 });
    await sleep(settle);
  }

  // Touch helpers (for phone 390x844)
  async function touch(type, pts) {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id || (i + 1), radiusX: 2, radiusY: 2, force: 1 })),
    });
  }
  async function tapTouchScreen(sx, sy, { settle = 140 } = {}) {
    const p = { x: Math.round(sx), y: Math.round(sy), id: 1 };
    await touch('touchStart', [p]);
    await sleep(45);
    await touch('touchEnd', []);
    await sleep(settle);
  }
  async function tapTouchW(wx, wy, opts = {}) {
    const p = await w2s(wx, wy);
    await tapTouchScreen(p.x, p.y, opts);
    return p;
  }

  async function pressKey(k, { ctrl = false, shift = false, alt = false, settle = 85 } = {}) {
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

  async function typeText(str, { settle = 65 } = {}) {
    for (const ch of String(str)) {
      if (/^[a-zA-Z0-9]$/.test(ch)) {
        await pressKey(ch, { shift: /^[A-Z]$/.test(ch), settle: 20 });
      } else {
        await cdp.send('Input.insertText', { text: ch });
        await sleep(20);
      }
    }
    await sleep(settle);
  }

  async function clickTool(toolId, { useTouch = phone } = {}) {
    const id = toolId.startsWith('tool-') || toolId.startsWith('btn-') ? toolId : `tool-${toolId}`;
    const press = useTouch
      ? (p) => tapTouchScreen(p.x, p.y, { settle: 130 })
      : (p) => clickScreen(p.x, p.y, { settle: 90 });
    await pressRibbonTool(cdp.evalJs, press, id);
    await sleep(60);
  }

  // Select a Rect or Slot variant mode via real UI clicks (ribbon button -> variant menu -> variant item)
  async function selectVariant(baseToolId, modeValue) {
    // First ensure tool button is visible or open section dropdown? Rect & Slot are in Create bar by default on 1280x800;
    // clicking the button opens its variant menu if already active or via dropdown indicator; let's check how tool-ribbon opens variant menu!
    const info = await cdp.evalJs(`(() => {
      const b = document.getElementById(${JSON.stringify('tool-' + baseToolId)});
      if (!b) return null;
      return { hidden: b.hidden, active: b.classList.contains('active'), mode: ${stateExpr ? stateExpr + '.' + baseToolId + 'Mode' : 'null'} };
    })()`);
    if (!info) throw new Error('No variant button for ' + baseToolId);
    // Click once to activate (or open menu if already active); if menu not open, click again to open menu
    await clickTool('tool-' + baseToolId);
    let menuOpen = await cdp.evalJs(`!!document.querySelector('.sk-ribbon-menu.show .sk-ribbon-menu-item[data-mode="${modeValue}"]')`);
    if (!menuOpen) {
      // Right-click or second click on the variant button opens its popover
      await clickTool('tool-' + baseToolId);
      await sleep(80);
      menuOpen = await cdp.evalJs(`!!document.querySelector('.sk-ribbon-menu.show .sk-ribbon-menu-item[data-mode="${modeValue}"]')`);
    }
    if (menuOpen) {
      const pt = await cdp.evalJs(`(() => {
        const it = document.querySelector('.sk-ribbon-menu.show .sk-ribbon-menu-item[data-mode="${modeValue}"]');
        if (!it) return null;
        const r = it.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      if (pt) {
        if (phone) await tapTouchScreen(pt.x, pt.y, { settle: 120 });
        else await clickScreen(pt.x, pt.y, { settle: 90 });
      }
    } else if (stateExpr) {
      // Fallback for hidden-in-section variant on narrow phone: set mode after clicking tool
      await cdp.evalJs(`${stateExpr}.${baseToolId}Mode = ${JSON.stringify(modeValue)}`);
    }
    await sleep(60);
  }

  async function clearToasts() {
    await cdp.evalJs(`document.querySelectorAll('#notification-container [data-level]').forEach(e => e.remove())`);
  }

  // Deterministic clean fixture setup (only used BETWEEN cells so every cell starts identically, zero cross-cell bleed)
  async function resetFixture({ cx = 0, cy = 0, vw = 180 } = {}) {
    // First ensure any open overlays/menus/popups/dialogs from a previous buggy cell are closed
    await cdp.evalJs(`(() => {
      document.querySelectorAll('.sk-context-menu, .sk-text-editor, .sk-pattern-dialog, .sk-pat-inline, #fillet-radius-input, #offset-distance-input, #tbox-input, .sk-footer-confirm-backdrop').forEach(e => e.remove());
      const pwin = document.querySelector('.sk-pwin');
      if (pwin && pwin.style.display !== 'none') {
        const closeBtn = pwin.querySelector('.sk-dock-close');
        if (closeBtn) closeBtn.click();
      }
      document.querySelectorAll('.sk-ribbon-menu.show, .sk-ribbon-sect-menu.show').forEach(m => m.classList.remove('show'));
      { const sb = document.querySelector('.sk-sidebar'); const bd = document.querySelector('.sk-sidebar-backdrop'); if (sb && bd && sb.getBoundingClientRect().left >= 0) bd.click(); }
      document.querySelectorAll('#notification-container [data-level]').forEach(e => e.remove());
    })()`);
    // Double Escape + switch to select to clear any module-level tool state
    await pressKey('Escape', { settle: 40 });
    await pressKey('Escape', { settle: 40 });
    await cdp.evalJs(`import('/packages/ui/numeric-input-manager.js').then(m => m.hideInput())`);
    await cdp.evalJs(`import('/packages/ui/input-manager.js').then(m => {
      const st = ${stateExpr || 'null'};
      if (st) m.switchToTool(st, 'select');
    })`);

    if (!stateExpr) {
      // SketchStudio host: reload fresh or clear via UI
      await sleep(80);
      return;
    }

    await cdp.evalJs(`(async () => {
      const st = ${stateExpr};
      const svg = document.getElementById(${JSON.stringify(canvasId)});
      const { addConstraintObject } = await import('/packages/core/constraints.js');
      const { CONSTRAINT_TYPES } = await import('/packages/core/constants.js');
      const { updateViewBox } = await import('/packages/ui/input-handlers/pan-zoom.js');
      const { resetPanZoomState } = await import('/packages/ui/input-handlers/pan-zoom.js');
      const { resetDimensionState } = await import('/packages/ui/input-handlers/dimension-tool.js');
      const { resetConstraintState } = await import('/packages/ui/input-handlers/constraint-tools.js');
      const { resetDrawingState } = await import('/packages/ui/input-handlers/drawing-tools.js');
      const { resetFilletState } = await import('/packages/ui/input-handlers/fillet-tool.js');
      const { resetOffsetState } = await import('/packages/ui/input-handlers/offset-tool.js');
      const { resetPatternState } = await import('/packages/ui/input-handlers/pattern-tool.js');
      const { resetBezierState } = await import('/packages/ui/input-handlers/bezier-tool.js');
      const { resetTrimState } = await import('/packages/ui/input-handlers/trim-tool.js');
      const { resetBreakState } = await import('/packages/ui/input-handlers/break-tool.js');
      const { resetSelectionState } = await import('/packages/ui/input-handlers/selection-tools.js');
      const { cancelTextEditor } = await import('/packages/ui/input-handlers/text-tool.js');
      const { cancelTransformGesture } = await import('/packages/ui/transform-box.js');

      cancelTransformGesture(st);
      cancelTextEditor();
      resetDimensionState(st);
      resetConstraintState(st);
      resetDrawingState(st);
      resetFilletState();
      resetOffsetState();
      resetPatternState();
      resetBezierState(st);
      resetTrimState();
      resetBreakState();
      resetSelectionState();
      resetPanZoomState(st);

      st.clearDocument();
      // Build deterministic fixture geometry
      const j = (id, x, y, fixed = false) => { st.joints.set(id, { x, y, fixed, sketchId: st.activeSketchId }); return id; };
      j('j_l1a', -10, 20); j('j_l1b', 40, 20); j('j_l2b', 40, -20);
      st.shapes.push({ id: 'L1', type: 'line', joints: ['j_l1a', 'j_l1b'], sketchId: st.activeSketchId });
      st.shapes.push({ id: 'L2', type: 'line', joints: ['j_l1b', 'j_l2b'], sketchId: st.activeSketchId });
      addConstraintObject(st, { id: 'c_d1', type: CONSTRAINT_TYPES.DISTANCE, joints: ['j_l1a', 'j_l1b'], value: 50, name: 'd1', dimMode: 'horizontal', offset: 16, glyphPos: { x: 15, y: 36 } });

      j('j_l3a', -10, -28); j('j_l3b', 55, -28);
      st.shapes.push({ id: 'L3', type: 'line', joints: ['j_l3a', 'j_l3b'], sketchId: st.activeSketchId });
      j('j_l4a', 15, -42); j('j_l4b', 15, -5);
      st.shapes.push({ id: 'L4', type: 'line', joints: ['j_l4a', 'j_l4b'], sketchId: st.activeSketchId });

      j('j_c1', -30, 0);
      st.shapes.push({ id: 'C1', type: 'circle', joints: ['j_c1'], radius: 12, sketchId: st.activeSketchId });

      j('j_l5a', -5, -5); j('j_l5b', 5, 8);
      st.shapes.push({ id: 'L5', type: 'line', joints: ['j_l5a', 'j_l5b'], sketchId: st.activeSketchId });

      j('j_g1', -42, 26); j('j_g2', -22, 26); j('j_g3', -22, 38);
      st.groups = [{ id: 'grp_1', name: 'Group 1', sketchId: st.activeSketchId }];
      st.shapes.push({ id: 'G1a', type: 'line', joints: ['j_g1', 'j_g2'], sketchId: st.activeSketchId, userGroupId: 'grp_1' });
      st.shapes.push({ id: 'G1b', type: 'line', joints: ['j_g2', 'j_g3'], sketchId: st.activeSketchId, userGroupId: 'grp_1' });

      // Seed 1 clean undo step + 1 clean redo step so undoDelta & redoStack preservation are observable!
      st.history.length = 0;
      st.redoStack.length = 0;
      st.saveState('seed-1');
      st.saveState('seed-2');
      st.undo(); // history.length === 1, redoStack.length === 1

      st.selectedShapes.clear();
      st.selectedJoints.clear();
      st.selectedConstraints.clear();
      st.enteredGroupId = null;
      st.active = null;
      st.drag = null;
      st.placingConstraint = null;
      st.mirror = null;
      st.currentTool = 'select';
      st.rectMode = 'rect-2pt';
      st.slotMode = 'slot-c2c';

      st.view.x = ${cx}; st.view.y = ${cy}; st.view.w = ${vw};
      updateViewBox(svg, st.view);
      svg.focus();
    })()`);
    await sleep(90);
    await clearToasts();
  }

  async function inspect() {
    const data = await cdp.evalJs(`(async () => {
      const svg = document.getElementById(${JSON.stringify(canvasId)});
      const st = ${stateExpr || 'null'};
      const vis = (el) => !!(el && !el.classList.contains('hidden') && !el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0);
      const dimIn = document.getElementById('dimInput');
      const dualIn = document.getElementById('dualInput');
      const filletIn = document.getElementById('fillet-radius-input');
      const offsetIn = document.getElementById('offset-distance-input');
      const patDlg = document.querySelector('.sk-pattern-dialog');
      const patInl = document.querySelector('.sk-pat-inline');
      const txtEd = document.querySelector('.sk-text-editor');
      const tboxIn = document.getElementById('tbox-input');
      const dimHint = document.getElementById('dimHint');
      const dimComp = document.getElementById('dimComplete');
      const doneBtn = document.querySelector('.sk-done');
      const ctxMenu = document.querySelector('.sk-context-menu');
      const pwin = document.querySelector('.sk-pwin');

      const ae = document.activeElement;
      const focusDesc = ae ? (ae.id ? '#' + ae.id : (ae.className && typeof ae.className === 'string' ? ae.tagName.toLowerCase() + '.' + ae.className.trim().split(/\\s+/)[0] : ae.tagName.toLowerCase())) : 'null';
      const focusVal = ae && ('value' in ae) ? String(ae.value) : null;

      const activeBtn = document.querySelector('.sk-ribbon-btn.active');
      const openBoxes = [];
      if (vis(dimIn)) openBoxes.push('dimInput(' + JSON.stringify(dimIn.value) + ')');
      if (vis(dualIn)) {
        const ins = [...dualIn.querySelectorAll('input')].map(i => i.value);
        openBoxes.push('dualInput(' + JSON.stringify(ins) + ')');
      }
      if (vis(filletIn)) openBoxes.push('fillet(' + JSON.stringify(filletIn.value) + ')');
      if (vis(offsetIn)) openBoxes.push('offset(' + JSON.stringify(offsetIn.value) + ')');
      if (vis(patDlg)) openBoxes.push('patternDlg');
      if (vis(patInl)) openBoxes.push('patternInline');
      if (vis(txtEd)) openBoxes.push('textEditor');
      if (vis(tboxIn)) openBoxes.push('tboxInput(' + JSON.stringify(tboxIn.value) + ')');

      const previewLayer = svg ? svg.querySelector('#preview-layer, .preview-group') : null;
      const ovCount = (id) => { const e = document.getElementById(id); return e ? e.children.length : 0; };
      const previewSvg = svg ? svg.querySelectorAll('.preview-line, .preview-shape, .preview-circle, .preview-rect, .preview-arc, .preview-ghost, .temp-geometry').length : 0;

      // Also inspect constraint-tools pending state & numeric-input-manager isInputActive via dynamic module read-only import
      let nimActive = false;
      try { const nim = await import('/packages/ui/numeric-input-manager.js'); nimActive = !!nim.isInputActive(); } catch (_) {}
      let dimPlacing = false;
      try { const dt = await import('/packages/ui/input-handlers/dimension-tool.js'); dimPlacing = st ? !!dt.isDimensionPlacing(st) : false; } catch (_) {}
      let patOpen = false;
      try { const pt = await import('/packages/ui/input-handlers/pattern-tool.js'); patOpen = !!pt.patternSessionOpen(); } catch (_) {}
      let filletOpen = false;
      try { const ft = await import('/packages/ui/input-handlers/fillet-tool.js'); filletOpen = !!ft.filletInputOpen(); } catch (_) {}
      let offsetOpen = false;
      try { const ot = await import('/packages/ui/input-handlers/offset-tool.js'); offsetOpen = !!ot.offsetInputOpen(); } catch (_) {}

      const toasts = [...document.querySelectorAll('#notification-container [data-level]')].map(e => e.textContent.trim());
      const undoBtn = document.querySelector('#btn-undo, button[aria-label="Undo"]');
      const redoBtn = document.querySelector('#btn-redo, button[aria-label="Redo"]');

      const out = {
        tool: st ? st.currentTool : (activeBtn ? activeBtn.dataset.tool : null),
        ribbonActive: activeBtn ? activeBtn.id : null,
        openBoxes,
        nimActive, filletOpen, offsetOpen, patOpen,
        dimHintOpen: vis(dimHint),
        dimCompOpen: vis(dimComp),
        doneOpen: vis(doneBtn),
        ctxMenuOpen: vis(ctxMenu),
        pwinOpen: vis(pwin),
        focus: focusDesc,
        focusVal,
        hasActive: st ? !!st.active : null,
        activeMode: st && st.active ? (st.active.mode || st.active.type || 'active') : null,
        hasDrag: st ? !!st.drag : null,
        dragType: st && st.drag ? st.drag.type : null,
        hasPlacing: st ? (!!st.placingConstraint || dimPlacing) : dimPlacing,
        hasMirror: st ? !!st.mirror : null,
        mirrorStep: st && st.mirror ? st.mirror.step : null,
        overlays: {
          preview: (previewLayer ? previewLayer.children.length : 0) + previewSvg,
          fillet: ovCount('fillet-tool-overlay'),
          offset: ovCount('offset-tool-overlay'),
          pattern: ovCount('pattern-tool-overlay'),
          trim: ovCount('trim-tool-overlay'),
          break: ovCount('break-tool-overlay'),
        },
        shapes: st ? st.shapes.length : document.querySelectorAll('#' + ${JSON.stringify(canvasId)} + ' .shape-elem').length,
        joints: st ? st.joints.size : null,
        cons: st ? st.constraints.length : null,
        placingCons: st ? st.constraints.filter(c => c.__placing).length : null,
        editingCons: st ? st.constraints.filter(c => c.__editing).length : null,
        newlyCons: st ? st.constraints.filter(c => c.__newlyPlaced).length : null,
        selShapes: st ? st.selectedShapes.size : null,
        selJoints: st ? st.selectedJoints.size : null,
        selCons: st ? st.selectedConstraints.size : null,
        enteredGroup: st ? st.enteredGroupId : null,
        undoLen: st ? st.history.length : null,
        redoLen: st ? st.redoStack.length : null,
        canUndo: undoBtn ? !undoBtn.disabled : (st ? st.canUndo() : null),
        canRedo: redoBtn ? !redoBtn.disabled : (st ? st.canRedo() : null),
        view: st ? { x: +st.view.x.toFixed(2), y: +st.view.y.toFixed(2), w: +st.view.w.toFixed(2) } : null,
        toasts,
      };
      return out;
    })()`);
    data.pageErrors = pageErrors.length;
    return data;
  }

  // Enter a specific (toolKey, stage) using REAL UI events
  // Stages: 'before1st', 'after1st', 'after2nd', 'boxTyped', 'dimPlacing', 'mirrorStep2', 'midDrag', 'transformDrag', 'transformBoxTyped', 'dimEditBoxTyped'
  async function enterStage(toolKey, stage) {
    // 1. Activate tool (with variant if needed)
    if (toolKey === 'rect-2pt') await selectVariant('rect', 'rect-2pt');
    else if (toolKey === 'rect-center') await selectVariant('rect', 'rect-center');
    else if (toolKey === 'rect-3pt') await selectVariant('rect', 'rect-3pt');
    else if (toolKey === 'slot-c2c') await selectVariant('slot', 'slot-c2c');
    else if (toolKey === 'slot-overall') await selectVariant('slot', 'slot-overall');
    else if (toolKey === 'slot-center') await selectVariant('slot', 'slot-center');
    else if (toolKey === 'slot-arc3') await selectVariant('slot', 'slot-arc-3pt');
    else if (toolKey === 'slot-arccenter') await selectVariant('slot', 'slot-arc-center');
    else if (toolKey === 'select-drag' || toolKey === 'transform' || toolKey === 'dim-edit') {
      await clickTool('tool-select');
    } else {
      await clickTool('tool-' + toolKey);
    }

    if (stage === 'before1st') {
      // Hover over relevant target so hover overlays (Trim/Break/Fillet) are also visible
      if (toolKey === 'trim') await moveW(FIX.L3_LEFT.x, FIX.L3_LEFT.y);
      else if (toolKey === 'break') await moveW(FIX.L3_RIGHT.x, FIX.L3_RIGHT.y);
      else if (toolKey === 'fillet') await moveW(FIX.CORNER.x, FIX.CORNER.y);
      else await moveW(FIX.DRAW_P1.x, FIX.DRAW_P1.y);
      await sleep(50);
      return;
    }

    // Draw tools
    if (toolKey === 'line') {
      await clickW(FIX.DRAW_P1.x, FIX.DRAW_P1.y);
      await moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
      if (stage === 'boxTyped') {
        await typeText('25');
      }
      return;
    }
    if (toolKey.startsWith('rect-')) {
      await clickW(FIX.DRAW_P1.x, FIX.DRAW_P1.y);
      await moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
      if (toolKey === 'rect-3pt' && stage === 'after2nd') {
        await clickW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
        await moveW(FIX.DRAW_P3.x, FIX.DRAW_P3.y);
      }
      if (stage === 'boxTyped') {
        await typeText('25');
      }
      return;
    }
    if (toolKey === 'circle') {
      await clickW(FIX.DRAW_P1.x, FIX.DRAW_P1.y);
      await moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
      if (stage === 'boxTyped') {
        await typeText('25');
      }
      return;
    }
    if (toolKey === 'arc') {
      await clickW(FIX.DRAW_P1.x, FIX.DRAW_P1.y); // center
      await moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
      if (stage === 'after2nd') {
        await clickW(FIX.DRAW_P2.x, FIX.DRAW_P2.y); // start
        await moveW(FIX.DRAW_P3.x, FIX.DRAW_P3.y);
      } else if (stage === 'boxTyped') {
        await typeText('18');
      }
      return;
    }
    if (toolKey === 'polygon') {
      await clickW(FIX.DRAW_P1.x, FIX.DRAW_P1.y);
      await moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
      if (stage === 'boxTyped') {
        await typeText('15');
      }
      return;
    }
    if (toolKey.startsWith('slot-')) {
      await clickW(FIX.DRAW_P1.x, FIX.DRAW_P1.y);
      await moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
      if (stage === 'after2nd') {
        await clickW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
        await moveW(FIX.DRAW_P3.x, FIX.DRAW_P3.y);
      } else if (stage === 'boxTyped') {
        await typeText('22');
      }
      return;
    }
    if (toolKey === 'bezier') {
      await clickW(FIX.DRAW_P1.x, FIX.DRAW_P1.y);
      await moveW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
      if (stage === 'after2nd') {
        await clickW(FIX.DRAW_P2.x, FIX.DRAW_P2.y);
        await moveW(FIX.DRAW_P3.x, FIX.DRAW_P3.y);
      }
      return;
    }
    if (toolKey === 'text') {
      await clickW(FIX.DRAW_P1.x, FIX.DRAW_P1.y);
      await sleep(80);
      if (stage === 'boxTyped') {
        await typeText('Hello');
      }
      return;
    }

    // Modify tools
    if (toolKey === 'fillet') {
      if (stage === 'after1st') {
        // Click L1 away from corner -> picks 1st line, waiting for 2nd line
        await clickW(FIX.L1_MID.x, FIX.L1_MID.y);
      } else if (stage === 'boxTyped') {
        // Click corner -> opens #fillet-radius-input
        await clickW(FIX.CORNER.x, FIX.CORNER.y);
        await sleep(80);
        await typeText('8');
      }
      return;
    }
    if (toolKey === 'offset') {
      // Click L1 -> picks chain and opens #offset-distance-input
      await clickW(FIX.L1_MID.x, FIX.L1_MID.y);
      await sleep(80);
      if (stage === 'boxTyped') {
        await typeText('7');
      }
      return;
    }
    if (toolKey === 'mirror') {
      // Step 1: pick L1
      await clickW(FIX.L1_MID.x, FIX.L1_MID.y);
      if (stage === 'mirrorStep2') {
        await pressKey('Enter');
      }
      return;
    }
    if (toolKey === 'circularPattern') {
      await clickW(FIX.L1_MID.x, FIX.L1_MID.y);
      await sleep(60);
      if (stage === 'boxTyped') {
        // Focus quantity input inside .sk-pattern-dialog and type
        await cdp.evalJs(`(() => {
          const inp = document.querySelector('.sk-pattern-dialog input[type="text"], .sk-pattern-dialog input');
          if (inp) { inp.focus(); inp.select(); }
        })()`);
        await typeText('5');
      }
      return;
    }
    if (toolKey === 'rectangularPattern') {
      await clickW(FIX.L1_MID.x, FIX.L1_MID.y);
      await sleep(60);
      if (stage === 'boxTyped') {
        await cdp.evalJs(`(() => {
          const inp = document.querySelector('.sk-pattern-dialog input[type="text"], .sk-pattern-dialog input');
          if (inp) { inp.focus(); inp.select(); }
        })()`);
        await typeText('4');
      }
      return;
    }

    // Dimension tool
    if (toolKey === 'dim') {
      if (stage === 'after1st') {
        // Pick a point (j_l1a) -> pendingDimension waiting for 2nd pick
        await clickW(FIX.L1_A.x, FIX.L1_A.y);
      } else if (stage === 'dimPlacing') {
        // Click L2 -> placingConstraint following mouse
        await clickW(FIX.L2_MID.x, FIX.L2_MID.y);
        await moveW(54, 0);
      } else if (stage === 'boxTyped') {
        await clickW(FIX.L2_MID.x, FIX.L2_MID.y);
        await moveW(54, 0);
        await clickW(54, 0);
        await sleep(80);
        await typeText('35');
      }
      return;
    }

    // Constraint tools (all 9)
    if (toolKey === 'coincident') {
      await clickW(FIX.L3_A.x, FIX.L3_A.y); // pick joint
      return;
    }
    if (toolKey === 'hv') {
      await clickW(FIX.L5_A.x, FIX.L5_A.y); // pick point (2-point H/V)
      return;
    }
    if (toolKey === 'parallel' || toolKey === 'perp' || toolKey === 'collinear' || toolKey === 'equal') {
      await clickW(FIX.L5_MID.x, FIX.L5_MID.y);
      return;
    }
    if (toolKey === 'tangent') {
      await clickW(FIX.C1_RIM.x, FIX.C1_RIM.y);
      return;
    }
    if (toolKey === 'midpoint') {
      await clickW(FIX.L3_A.x, FIX.L3_A.y); // a point first, then the line
      return;
    }
    if (toolKey === 'symmetric') {
      await clickW(FIX.L1_A.x, FIX.L1_A.y);
      if (stage === 'after2nd') {
        await clickW(FIX.L3_A.x, FIX.L3_A.y);
      }
      return;
    }

    // Select drag / Transform / Dim edit
    if (toolKey === 'select-drag' && stage === 'midDrag') {
      // Press & hold on free joint j_l5b and move slightly so state.drag is active!
      const p0 = await pressDownW(FIX.L5_B.x, FIX.L5_B.y);
      const p1 = await w2s(FIX.L5_B.x + 8, FIX.L5_B.y + 4);
      await moveScreen(p1.x, p1.y, 1, 'left');
      return { dragDown: p0, dragCur: p1 };
    }
    if (toolKey === 'transform') {
      // Select group G1 by clicking G1_MID
      await clickW(FIX.G1_MID.x, FIX.G1_MID.y);
      await sleep(70);
      // Compute rotate handle world position from boxLayout: group box is [-42..-22, 26..38] -> cx=-32, y0=26 - pad; let's read rotate handle from svg!
      const rotPt = await cdp.evalJs(`(() => {
        const st = ${stateExpr};
        const svg = document.getElementById(${JSON.stringify(canvasId)});
        return import('/packages/core/transform.js').then(async (tm) => {
          const tb = await import('/packages/ui/transform-box.js');
          const { worldToScreen, getZoomFactor } = await import('/packages/ui/coords.js');
          const box = tm.groupBox(st, 'grp_1');
          const lay = tb.boxLayout(box, getZoomFactor(svg), false);
          return worldToScreen(svg, lay.rotate);
        });
      })()`);
      if (stage === 'transformDrag') {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(rotPt.x), y: Math.round(rotPt.y), button: 'none', clickCount: 0 });
        await sleep(20);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(rotPt.x), y: Math.round(rotPt.y), button: 'left', buttons: 1, clickCount: 1 });
        await sleep(25);
        await moveScreen(rotPt.x + 28, rotPt.y + 6, 1, 'left');
        return { rotPt, dragCur: { x: rotPt.x + 28, y: rotPt.y + 6 } };
      } else if (stage === 'transformBoxTyped') {
        await clickScreen(rotPt.x, rotPt.y, { settle: 100 });
        await typeText('30');
        return { rotPt };
      }
    }
    if (toolKey === 'dim-edit' && stage === 'dimEditBoxTyped') {
      // Double-click existing d1 label at D1_LBL
      const lp = await cdp.evalJs(`(() => { const e = document.querySelector('.dim-label'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await clickScreen(lp.x, lp.y, { clicks: 2, settle: 160 });
      await typeText('45');
      return;
    }
  }

  async function capture(filename, clip = null) {
    const params = clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' };
    const res = await cdp.send('Page.captureScreenshot', params);
    const fullPath = path.join(EVID_DIR, filename);
    const buf = Buffer.from(res.data, 'base64');
    fs.writeFileSync(fullPath, buf);
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    return { path: fullPath, rel: `.evidence/1023/${filename}`, md5 };
  }

  return {
    cdp, fakeDrive, canvasId, stateExpr, pageErrors,
    setBrowserCollapsed, w2s, moveScreen, moveW, clickScreen, clickW,
    pressDownW, releaseUpScreen, wheelAt, middlePan,
    touch, tapTouchScreen, tapTouchW,
    pressKey, typeText, clickTool, selectVariant, clearToasts,
    resetFixture, inspect, enterStage, capture,
    close: () => cdp.close(),
  };
}

export function fmtSnap(s) {
  const boxes = s.openBoxes.length ? s.openBoxes.join(',') : 'none';
  const ov = Object.entries(s.overlays).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(',') || 'none';
  return `tool=${s.tool}(btn:${s.ribbonActive}) boxes=[${boxes}] nim=${s.nimActive} focus=${s.focus} active=${s.hasActive ? s.activeMode : 'no'} drag=${s.hasDrag ? s.dragType : 'no'} placing=${s.hasPlacing} mirror=${s.hasMirror ? s.mirrorStep : 'no'} ov=[${ov}] shapes=${s.shapes} cons=${s.cons}(pl:${s.placingCons},ed:${s.editingCons},nw:${s.newlyCons}) sel=(S:${s.selShapes},J:${s.selJoints},C:${s.selCons}) hist=(U:${s.undoLen},R:${s.redoLen}) done=${s.doneOpen} ctx=${s.ctxMenuOpen} pwin=${s.pwinOpen} toasts=${JSON.stringify(s.toasts)} err=${s.pageErrors}`;
}
