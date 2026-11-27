// tests/audits/design-run-audit-1016-kit.js — TASK 1016 shared real-UI probe kit (AUDIT ONLY, outside the gate).
// Drives SketchStudio desktop 1280x800 via real pointer & keyboard events through tests/helpers/cdp-browser.js.
// No direct state edits — read-only inspection via DOM + working-buffer snapshot + core analyzers.
// Blocks Google / Drive / ShaperHub / analytics hosts (allows 127.0.0.1 + cdn.tailwindcss.com for real layout).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { launchBrowser, sleep, sendRealKey } from '../helpers/cdp-browser.js';
import { installFakeDriveSession } from '../helpers/fake-drive-session.js';
import { resetBufferLive } from '../helpers/reset-buffer.js';
import { pressRibbonTool } from '../helpers/ribbon-tool.js';
import { analyzeConstraintStatus } from '../../packages/core/constraint-status.js';
import { unsatisfiedConstraints, measureDimension } from '../../packages/core/constraint-verifier.js';
import { NewtonSolver } from '../../packages/core/solver/engine.js';

export const EVID_DIR = path.resolve('.evidence/1016');
fs.mkdirSync(EVID_DIR, { recursive: true });

export function md5Of(filePath) {
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex');
}

export async function blockThirdPartyExceptTailwind(cdp) {
  const blocked = [];
  const allowed = (url) =>
    /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(url) ||
    /^https:\/\/cdn\.tailwindcss\.com(\/|$)/.test(url) ||
    /^(data|blob|about|chrome|edge|devtools):/.test(url);
  cdp.ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = m.params;
    if (allowed(request.url)) { cdp.send('Fetch.continueRequest', { requestId }); return; }
    blocked.push(request.url);
    cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  return { blocked: () => [...blocked] };
}

export async function launchStudio({ tag = '1016', width = 1280, height = 800 } = {}) {
  const cdp = await launchBrowser({ tag, width, height });
  if (!cdp) throw new Error('No Chromium/Edge binary installed');
  await installFakeDriveSession(cdp);
  const net = await blockThirdPartyExceptTailwind(cdp);
  const url = `http://127.0.0.1:${cdp.port}/apps/sketchstudio/index.html`;
  await resetBufferLive(cdp);
  await cdp.navigate(url, 15000);
  await cdp.waitForApp('svgCanvas');
  await sleep(450);
  return { cdp, net, url };
}

// ── Real pointer events ──────────────────────────────────────────────────────
export async function mouseMove(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none', clickCount: 0 });
  await sleep(45);
}

export async function mouseClick(cdp, x, y, { clicks = 1, button = 'left', modifiers = 0, settle = 180 } = {}) {
  const rx = Math.round(x), ry = Math.round(y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, button: 'none', clickCount: 0, modifiers });
  await sleep(40);
  const btns = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
  for (let k = 1; k <= clicks; k++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button, buttons: btns, clickCount: k, modifiers });
    await sleep(35);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button, buttons: 0, clickCount: k, modifiers });
    if (k < clicks) await sleep(65);
  }
  await sleep(settle);
}

export async function mouseDblClick(cdp, x, y, settle = 240) {
  return mouseClick(cdp, x, y, { clicks: 2, settle });
}

export async function mouseRightClick(cdp, x, y, settle = 220) {
  return mouseClick(cdp, x, y, { button: 'right', settle });
}

export async function mouseDrag(cdp, a, b, { button = 'left', steps = 16, settle = 220 } = {}) {
  const ax = Math.round(a.x), ay = Math.round(a.y), bx = Math.round(b.x), by = Math.round(b.y);
  const btns = button === 'middle' ? 4 : button === 'right' ? 2 : 1;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ax, y: ay, button: 'none', clickCount: 0 });
  await sleep(35);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ax, y: ay, button, buttons: btns, clickCount: 1 });
  for (let k = 1; k <= steps; k++) {
    await sleep(18);
    const nx = Math.round(ax + ((bx - ax) * k) / steps);
    const ny = Math.round(ay + ((by - ay) * k) / steps);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nx, y: ny, button, buttons: btns, clickCount: 0 });
  }
  await sleep(35);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx, y: by, button, buttons: 0, clickCount: 1 });
  await sleep(settle);
}

export async function mouseWheel(cdp, x, y, deltaY) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none', clickCount: 0 });
  await sleep(20);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY });
  await sleep(70);
}

// ── Real keyboard events ─────────────────────────────────────────────────────
const SIGN_MAP = {
  ' ': ['Space', 32],
  '+': ['Equal', 187],
  '-': ['Minus', 189],
  '*': ['Digit8', 56],
  '/': ['Slash', 191],
  '=': ['Equal', 187],
  '(': ['Digit9', 57],
  ')': ['Digit0', 48],
  '.': ['Period', 190],
  '_': ['Minus', 189],
};

export async function typeText(cdp, text, delayMs = 28) {
  for (const ch of String(text)) {
    let code, vk;
    if (/[a-z]/i.test(ch)) { code = 'Key' + ch.toUpperCase(); vk = ch.toUpperCase().charCodeAt(0); }
    else if (/\d/.test(ch)) { code = 'Digit' + ch; vk = ch.charCodeAt(0); }
    else if (SIGN_MAP[ch]) { [code, vk] = SIGN_MAP[ch]; }
    else { code = 'Unidentified'; vk = ch.charCodeAt(0); }
    await sendRealKey(cdp.send, ch, code, vk, 0, ch);
    await sleep(delayMs);
  }
  await sleep(120);
}

export const keyEnter = (cdp) => sendRealKey(cdp.send, 'Enter', 'Enter', 13, 0, '\r').then(() => sleep(200));
export const keyTab = (cdp, shift = false) => sendRealKey(cdp.send, 'Tab', 'Tab', 9, shift ? 8 : 0).then(() => sleep(150));
export const keyEsc = (cdp) => sendRealKey(cdp.send, 'Escape', 'Escape', 27).then(() => sleep(180));
export const keyDelete = (cdp) => sendRealKey(cdp.send, 'Delete', 'Delete', 46).then(() => sleep(220));
export const keyBackspace = (cdp) => sendRealKey(cdp.send, 'Backspace', 'Backspace', 8).then(() => sleep(100));
export const ctrlA = (cdp) => sendRealKey(cdp.send, 'a', 'KeyA', 65, 2).then(() => sleep(90));
export const ctrlZ = (cdp) => sendRealKey(cdp.send, 'z', 'KeyZ', 90, 2).then(() => sleep(220));
export const ctrlY = (cdp) => sendRealKey(cdp.send, 'y', 'KeyY', 89, 2).then(() => sleep(220));
export const ctrlS = (cdp) => sendRealKey(cdp.send, 's', 'KeyS', 83, 2).then(() => sleep(260));

export async function pressTool(cdp, id) {
  await pressRibbonTool(cdp.evalJs, (pt) => mouseClick(cdp, pt.x, pt.y, { settle: 160 }), id);
  await sleep(140);
}

export async function clickSelector(cdp, selector, idx = 0, { settle = 200 } = {}) {
  const pt = await cdp.evalJs(`(() => {
    const e = document.querySelectorAll(${JSON.stringify(selector)})[${idx}];
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  })()`);
  if (!pt) throw new Error(`Element not visible: ${selector}[${idx}]`);
  await mouseClick(cdp, pt.x, pt.y, { settle });
  return pt;
}

// ── Coordinates & real wheel/pan framing ─────────────────────────────────────
export async function getCanvasBox(cdp) {
  return cdp.evalJs(`(() => {
    const svg = document.getElementById('svgCanvas');
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { left: r.left, top: r.top, width: r.width, height: r.height, vx: vb.x, vy: vb.y, vw: vb.width, vh: vb.height };
  })()`);
}

export async function w2s(cdp, wx, wy) {
  return cdp.evalJs(`(() => {
    const svg = document.getElementById('svgCanvas');
    const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy};
    const p = pt.matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  })()`);
}

/** Zoom & pan ONLY through real mouseWheel + middle-drag events until world box fits nicely (clear of top-left browser card). */
export async function frameWorldBox(cdp, xMin, yMin, xMax, yMax) {
  const box = await getCanvasBox(cdp);
  // Target usable canvas region: right of the 256px browser card when possible, or centred slightly right
  const usableW = box.width - 280;
  const usableH = box.height - 90;
  const wantW = (xMax - xMin) * 1.35;
  const wantH = (yMax - yMin) * 1.35;
  const wantScale = Math.min(usableW / wantW, usableH / wantH); // px per mm
  const targetVw = box.width / wantScale;

  // 1) Zoom via real mouseWheel at canvas center until vw is within ~12% of targetVw
  const cx = box.left + box.width * 0.58;
  const cy = box.top + box.height * 0.52;
  for (let i = 0; i < 40; i++) {
    const cur = await getCanvasBox(cdp);
    const ratio = cur.vw / targetVw;
    if (ratio > 0.88 && ratio < 1.14) break;
    // positive deltaY zooms OUT (larger vw), negative zooms IN (smaller vw)
    const dy = ratio < 1 ? 140 : -140;
    await mouseWheel(cdp, cx, cy, dy);
  }

  // 2) Pan via real middle-mouse drag so world center lands at (box.left + 260 + usableW/2, box.top + box.height/2)
  const wcx = (xMin + xMax) / 2;
  const wcy = (yMin + yMax) / 2;
  const desiredSx = box.left + 260 + usableW / 2;
  const desiredSy = box.top + box.height * 0.52;
  for (let pass = 0; pass < 3; pass++) {
    const now = await w2s(cdp, wcx, wcy);
    const dx = desiredSx - now.x;
    const dy = desiredSy - now.y;
    if (Math.hypot(dx, dy) < 8) break;
    // Clamp single drag inside canvas
    const startX = Math.max(box.left + 290, Math.min(box.left + box.width - 80, box.left + box.width * 0.6));
    const startY = Math.max(box.top + 80, Math.min(box.top + box.height - 80, box.top + box.height * 0.5));
    const endX = Math.max(box.left + 40, Math.min(box.left + box.width - 40, startX + Math.max(-350, Math.min(350, dx))));
    const endY = Math.max(box.top + 40, Math.min(box.top + box.height - 40, startY + Math.max(-250, Math.min(250, dy))));
    await mouseDrag(cdp, { x: startX, y: startY }, { x: endX, y: endY }, { button: 'middle', steps: 10, settle: 160 });
  }
  await sleep(160);
  return getCanvasBox(cdp);
}

// ── Screenshots (always cropped to legible region) ───────────────────────────
export async function captureClip(cdp, filename, clip = null) {
  const params = clip ? { format: 'png', clip: { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.width), height: Math.round(clip.height), scale: clip.scale || 1 } } : { format: 'png' };
  const res = await cdp.send('Page.captureScreenshot', params);
  const fullPath = path.join(EVID_DIR, filename);
  fs.writeFileSync(fullPath, Buffer.from(res.data, 'base64'));
  return { path: fullPath, rel: `.evidence/1016/${filename}`, md5: md5Of(fullPath) };
}

export async function captureWorld(cdp, filename, xMin, yMin, xMax, yMax, padPx = 65) {
  const p1 = await w2s(cdp, xMin, yMin);
  const p2 = await w2s(cdp, xMax, yMax);
  const x0 = Math.max(0, Math.min(p1.x, p2.x) - padPx);
  const y0 = Math.max(0, Math.min(p1.y, p2.y) - padPx);
  const x1 = Math.min(1280, Math.max(p1.x, p2.x) + padPx);
  const y1 = Math.min(800, Math.max(p1.y, p2.y) + padPx);
  return captureClip(cdp, filename, { x: x0, y: y0, width: Math.max(120, x1 - x0), height: Math.max(120, y1 - y0), scale: 1 });
}

// ── Read-only state & DOM snapshot ───────────────────────────────────────────
export async function readDoc(cdp) {
  // Flush working buffer read-only via pagehide (does not mutate live state or undo/redo stacks)
  await cdp.evalJs(`(() => { window.dispatchEvent(new Event('pagehide')); })()`);
  await sleep(160);
  const raw = await cdp.evalJs(`import('/packages/ui/project-store.js').then(async (m) => {
    const s = m.getProjectStore();
    const buf = await s.readBuffer();
    const activeTab = buf && Array.isArray(buf.tabs) ? (buf.tabs.find((t) => t.key === buf.activeKey) || buf.tabs[0]) : null;
    let doc = activeTab && activeTab.doc ? activeTab.doc : null;
    if (!doc && activeTab && activeTab.designId) {
      const rec = await s.get(activeTab.designId);
      doc = rec && rec.document ? rec.document : null;
    }
    const activeTool = document.querySelector('#toolsRibbon .active, #toolsRibbon [aria-pressed="true"]')?.id || null;
    const dimLabels = [...document.querySelectorAll('#svgCanvas g.dim-label text')].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), cIdx: el.closest('g.dim-label')?.dataset?.constraintIdx ?? null };
    }).filter((d) => d.text);
    const toasts = [...document.querySelectorAll('.sk-toast, #notification-container > *')].map((e) => e.textContent.trim()).filter(Boolean);
    const undoDisabled = !!document.getElementById('btn-undo')?.disabled;
    const redoDisabled = !!document.getElementById('btn-redo')?.disabled;
    const browserText = document.querySelector('.sk-browser')?.innerText?.trim() || '';
    const shapeColors = [...document.querySelectorAll('#svgCanvas [data-shape-id], #svgCanvas .shape-elem')].map((e) => ({
      id: e.dataset.shapeId || e.getAttribute('id') || null,
      tag: e.tagName,
      stroke: e.getAttribute('stroke') || getComputedStyle(e).stroke,
      dash: e.getAttribute('stroke-dasharray') || '',
    }));
    const dimInputOpen = (() => {
      const els = [...document.querySelectorAll('input.dim-input, #fillet-radius-input, .sk-num-box input')].filter((i) => !i.classList.contains('hidden') && i.offsetParent !== null);
      return els.map((i) => ({ id: i.id, value: i.value }));
    })();
    return { doc, activeTab: activeTab ? { key: activeTab.key, name: activeTab.name, designId: activeTab.designId || null } : null, activeTool, dimLabels, toasts, undoDisabled, redoDisabled, browserText, shapeColors, dimInputOpen };
  })`);
  return raw;
}

export function analyzeDoc(doc) {
  if (!doc || !doc.geometry) return { empty: true, shapesCount: 0, jointsCount: 0, constraintsCount: 0, parameters: [], shapes: [], dims: [], patterns: [], constraintTypes: {}, nullity: 0, fullyConstrained: false, freeShapes: [], freeJoints: [], unsatCount: 0, unsatTypes: [] };
  const g = doc.geometry;
  const joints = new Map((g.joints || []).map(([id, j]) => [id, { ...j }]));
  const shapes = (g.shapes || []).map((s) => ({ ...s, joints: [...(s.joints || [])] }));
  const constraints = (g.constraints || []).map((c) => ({ ...c }));
  const parameters = (g.parameters || []).map((p) => ({ ...p }));
  const status = analyzeConstraintStatus({ joints, shapes, constraints, groups: g.groups || null, enteredGroupId: null });
  const unsat = unsatisfiedConstraints(constraints, joints, shapes, 0.01);
  let nullity = null;
  try {
    const jf = new NewtonSolver(joints, constraints, shapes).jointFreedom();
    nullity = jf.nullity;
  } catch (e) {
    nullity = 'err:' + e.message;
  }
  const freeShapes = shapes.filter((s) => !status.fixedShapes.has(s.id)).map((s) => `${s.id}:${s.type}`);
  const freeJoints = [...joints.keys()].filter((id) => id !== 'j_origin' && !status.fixedJoints.has(id));
  const dims = constraints.filter((c) => c.type === 'distance' || c.type === 'angle').map((c) => ({
    name: c.name || null,
    type: c.type,
    mode: c.dimMode || (c.isDiameter ? 'diameter' : c.isRadius ? 'radius' : 'aligned'),
    value: c.value,
    measured: measureDimension(c, joints, shapes),
    expr: c.expression || null,
    driven: !!(c.isDriven || c.driven),
    shape: c.shape || null,
    shapes: c.shapes || null,
    joints: c.joints || null,
  }));
  const patterns = constraints.filter((c) => c.type === 'circularPattern' || c.type === 'rectangularPattern' || c.type === 'circular_pattern' || c.type === 'rectangular_pattern').map((c) => ({
    type: c.type,
    quantity: c.quantity,
    angle: c.angle,
    names: c.names || null,
    expressions: c.expressions || null,
    sources: c.sources,
    instances: (c.instances || []).length,
    centre: c.centre || null,
  }));
  return {
    empty: shapes.length === 0,
    shapesCount: shapes.length,
    jointsCount: joints.size,
    constraintsCount: constraints.length,
    parameters,
    shapes: shapes.map((s) => {
      const pts = (s.joints || []).map((jid) => joints.get(jid)).filter(Boolean).map((p) => [+(p.x.toFixed(3)), +(p.y.toFixed(3))]);
      return { id: s.id, type: s.type, r: s.radius != null ? +s.radius.toFixed(3) : undefined, constr: !!s.isConstruction, fixed: !!s.fixed, fullyConstrained: status.fixedShapes.has(s.id), pts };
    }),
    dims,
    patterns,
    constraintTypes: constraints.reduce((acc, c) => { acc[c.type] = (acc[c.type] || 0) + 1; return acc; }, {}),
    nullity,
    fullyConstrained: shapes.length > 0 && freeShapes.length === 0 && nullity === 0,
    freeShapes,
    freeJoints,
    unsatCount: unsat.length,
    unsatTypes: unsat.map((c) => `${c.type}${c.name ? '(' + c.name + ')' : ''}`),
  };
}

export async function findDimLabelOnScreen(cdp, matchFnOrText) {
  const labels = await cdp.evalJs(`(() => {
    const out = [];
    for (const t of document.querySelectorAll('#svgCanvas g.dim-label text')) {
      const txt = t.textContent.trim();
      if (!txt) continue;
      const r = t.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ text: txt, x: r.left + r.width / 2, y: r.top + r.height / 2, cIdx: t.closest('g.dim-label')?.dataset?.constraintIdx ?? null });
    }
    return out;
  })()`);
  if (typeof matchFnOrText === 'function') return labels.find(matchFnOrText) || null;
  const needle = String(matchFnOrText);
  return labels.find((l) => l.text === needle || l.text.includes(needle)) || null;
}

export function row(id, partStep, verdict, summary) {
  console.log(`ROW ${id} | ${partStep} | ${verdict} | ${summary}`);
}

export async function reopenSavedDesign(cdp, designName) {
  // 1) Close the active saved tab (hover tab to show close x, click x -> SketchStudio opens a blank Untitled tab)
  const closePos = await cdp.evalJs(`(() => {
    const tabs = [...document.querySelectorAll('.sk-doctab')];
    const target = tabs.find((t) => (t.querySelector('.sk-doctab-name')?.textContent || '').includes(${JSON.stringify(designName)}));
    if (!target) return null;
    const xBtn = target.querySelector('.sk-doctab-x');
    const tr = target.getBoundingClientRect();
    const r = (xBtn || target).getBoundingClientRect();
    return { tx: tr.left + tr.width / 2, ty: tr.top + tr.height / 2, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (closePos) {
    await mouseMove(cdp, closePos.tx, closePos.ty);
    await sleep(140);
    await mouseClick(cdp, closePos.x, closePos.y, { settle: 450 });
  }
  const tabsAfterClose = await cdp.evalJs(`[...document.querySelectorAll('.sk-doctab')].map((t) => ({ name: t.querySelector('.sk-doctab-name')?.textContent?.trim(), active: t.classList.contains('active') }))`);
  // 2) Open Menu -> Open recent -> click the saved design's tile (.sk-pm-tile)
  await clickSelector(cdp, '.sk-sidebar-btn', 0, { settle: 350 });
  await clickSelector(cdp, 'button.sk-sidebar-item[data-action="open-recent"]', 0, { settle: 800 });
  const tileInfo = await cdp.evalJs(`(() => {
    const items = [...document.querySelectorAll('.sk-pm-tile')].map((el) => {
      const nameEl = el.querySelector('[data-name]') || el;
      const r = el.getBoundingClientRect();
      return { text: nameEl.textContent.trim(), x: r.left + r.width * 0.35, y: r.top + r.height * 0.5 };
    });
    const match = items.find((i) => i.text.includes(${JSON.stringify(designName)}));
    return { items: items.map((i) => i.text), match: match || null };
  })()`);
  if (!tileInfo.match) {
    await keyEsc(cdp);
    return { opened: false, reason: 'not-in-recent', tabsAfterClose, items: tileInfo.items };
  }
  await mouseClick(cdp, tileInfo.match.x, tileInfo.match.y, { settle: 800 });
  return { opened: true, tabsAfterClose, items: tileInfo.items };
}
