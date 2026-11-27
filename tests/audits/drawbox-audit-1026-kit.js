// tests/audits/drawbox-audit-1026-kit.js — TASK 1026 (AUDIT ONLY, outside the gate)
// Shared driver for the draw-time size-box matrix. Wraps the 1017 kit (real pointer / keyboard events in a live headless browser)
// and adds: variant picking, the document read (constraints, parameters), undo counting, box readout.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { startStudio, row, f, REPO_ROOT } from './design-run-audit-1017-kit.js';
import { sleep } from '../helpers/cdp-browser.js';

export { row, f, sleep };
export const EVID = path.join(REPO_ROOT, '.evidence', '1026');
fs.mkdirSync(EVID, { recursive: true });

export async function start(opts = {}) {
  const s = await startStudio({ tag: opts.tag || '1026', view: opts.view || { cx: 0, cy: 0, vw: 220 } });
  const { cdp } = s;

  /** pick a Rect / Slot variant: press the tool, then the menu row. Other tools: just the tool. */
  async function pickTool(tool, mode = null) {
    await s.pressKey('Escape'); await s.pressKey('Escape');
    await s.clickTool(tool);
    if (mode) {
      await sleep(150);
      const ok = await s.clickEl(`.sk-ribbon-menu-item[data-mode="${mode}"]`, { settle: 200 });
      if (!ok) throw new Error('no variant row ' + mode);
    }
    await sleep(80);
  }

  async function doc() {
    await cdp.flushAutosave();
    const d = await s.readBufferDoc();
    return d && d.doc && d.doc.geometry ? d.doc.geometry : null;
  }

  const slim = (c) => {
    const o = { type: c.type };
    for (const k of ['value', 'expression', 'name', 'driven', 'isDriven', 'dimMode', 'isRadius', 'isDiameter', 'joints', 'shapes', 'shape', 'line', 'circle', 'dimensioned']) {
      if (c[k] !== undefined && c[k] !== null && !(Array.isArray(c[k]) && !c[k].length)) o[k] = c[k];
    }
    return o;
  };

  /** the full readout of a cell: geometry from the document (mm), constraints, DOF, box, toasts */
  async function snap() {
    const st = await s.readState();
    const g = await doc();
    const jmap = new Map(g ? g.joints : []);
    const shapes = g ? g.shapes.map((sh) => {
      const J = (sh.joints || []).map((id) => jmap.get(id)).filter(Boolean);
      const o = { id: sh.id, type: sh.type };
      if (sh.type === 'line' && J.length >= 2) { o.p = [J[0].x, J[0].y, J[1].x, J[1].y]; o.len = Math.hypot(J[1].x - J[0].x, J[1].y - J[0].y); o.ang = -Math.atan2(J[1].y - J[0].y, J[1].x - J[0].x) * 180 / Math.PI; }
      else if (sh.type === 'circle') { o.c = J[0] ? [J[0].x, J[0].y] : null; o.r = sh.radius !== undefined ? sh.radius : (J[1] && J[0] ? Math.hypot(J[1].x - J[0].x, J[1].y - J[0].y) : null); }
      else if (sh.type === 'arc') { o.pts = J.map((j) => [j.x, j.y]); o.r = sh.radius; }
      else { o.pts = J.map((j) => [j.x, j.y]); o.extra = { sides: sh.sides, radius: sh.radius, width: sh.width }; }
      return o;
    }) : [];
    const cons = g ? g.constraints.filter((c) => c && c.type !== 'mouse_spring').map(slim) : [];
    const params = g ? g.parameters : [];
    const box = await cdp.evalJs(`(() => {
      const vis = (e) => !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
      const dual = document.getElementById('dualInput'), single = document.getElementById('dimInput');
      const ins = dual ? [...dual.querySelectorAll('input')] : [];
      const ae = document.activeElement;
      const hint = document.getElementById('dimHint');
      return {
        dual: vis(dual), dualVals: vis(dual) ? ins.map((i) => i.value) : null, dualInvalid: vis(dual) ? ins.map((i) => i.getAttribute('aria-invalid')) : null,
        single: vis(single), singleVal: vis(single) ? single.value : null, singleInvalid: vis(single) ? single.getAttribute('aria-invalid') : null,
        focus: ae ? (ae.id || ae.tagName) + (dual && dual.contains(ae) ? '#' + ins.indexOf(ae) : '') : null,
        hint: hint && !hint.classList.contains('hidden') && hint.textContent.trim() ? hint.textContent.trim() : ''
      };
    })()`);
    return { st, shapes, cons, params, box };
  }

  /** how many Ctrl+Z presses until the Undo button is disabled (destroys the document; call LAST in a cell) */
  async function undoSteps(max = 12) {
    await s.pressKey('Escape'); await s.pressKey('Escape');
    let n = 0;
    for (; n < max; n++) {
      const can = await cdp.evalJs(`(() => { const b = document.querySelector('#btn-undo, button[aria-label="Undo"]'); return b ? !b.disabled : null; })()`);
      if (!can) break;
      await s.pressKey('z', { ctrl: true, settle: 140 });
    }
    return n;
  }

  /** compact one-line summary of a snap */
  function sum(sn) {
    const sh = sn.shapes.map((x) => {
      if (x.type === 'line') return `L[len=${f(x.len)} ang=${f(x.ang)} ${f(x.p[0])},${f(x.p[1])}>${f(x.p[2])},${f(x.p[3])}]`;
      if (x.type === 'circle') return `C[r=${f(x.r)} c=${x.c ? f(x.c[0]) + ',' + f(x.c[1]) : '?'}]`;
      return `${x.type}[${(x.pts || []).map((p) => f(p[0]) + ',' + f(p[1])).join(' ')}${x.extra ? ' ' + JSON.stringify(x.extra) : ''}]`;
    }).join(' ');
    const cs = sn.cons.map((c) => {
      let t = c.type;
      if (c.value !== undefined) t += `=${f(c.value)}`;
      if (c.expression) t += `{${c.expression}}`;
      if (c.name) t += `:${c.name}`;
      if (c.driven || c.isDriven) t += '(ref)';
      if (c.isDiameter) t += 'Ø'; else if (c.isRadius) t += 'R';
      if (c.dimMode) t += `/${c.dimMode}`;
      return t;
    }).join(' ');
    const b = sn.box;
    const bx = b.dual ? `dual${JSON.stringify(b.dualVals)}${b.dualInvalid.includes('true') ? '!' : ''}` : b.single ? `single[${b.singleVal}]` : 'closed';
    return `shapes{${sh}} cons{${cs}} dof=${sn.st.totalDof} full=${sn.st.fullyConstrained} box=${bx} focus=${b.focus} hint="${b.hint}" toasts=${JSON.stringify(sn.st.toasts.map((t) => t.text))}`;
  }

  async function shot(name, clip = null) {
    const p = clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' };
    const res = await cdp.send('Page.captureScreenshot', p);
    const buf = Buffer.from(res.data, 'base64');
    fs.writeFileSync(path.join(EVID, name), buf);
    return { name, md5: crypto.createHash('md5').update(buf).digest('hex') };
  }

  /** set the document unit through the app's own settings module */
  async function setDocUnit(u) {
    await cdp.evalJs(`import('/packages/core/settings-manager.js').then((m) => (m.default || m.SettingsManager).set('DOC_UNIT', ${JSON.stringify(u)}))`);
    await sleep(120);
  }

  /** focus + select field i of the open box (a triple-click in the field): the dual box's i-th input, or the single box */
  async function selField(i = 0) {
    await cdp.evalJs(`(() => { const d = document.getElementById('dualInput'); const dv = d && !d.classList.contains('hidden') && d.getBoundingClientRect().width > 0;
      const ext = document.getElementById('fillet-radius-input') || document.getElementById('offset-distance-input');
      const el = dv ? d.querySelectorAll('input')[${i}] : (ext || document.getElementById('dimInput')); if (el) { el.focus(); el.select(); } })()`);
    await sleep(40);
  }

  /** one matrix cell: fresh doc, run fn (the clicks / keys), read LIVE, press Esc, read FINAL + undo count; print one ROW line */
  async function cell(id, tool, combo, fn, { check = null, after = null, fresh = true } = {}) {
    if (process.env.ONLY && !new RegExp(process.env.ONLY).test(id)) return null;   // ONLY=regex: rerun a subset of cells
    if (fresh) await s.openFresh();
    await s.clearToasts();
    let err = null;
    try { await fn(); } catch (e) { err = e.message; }
    const live = await snap();
    if (after) { try { await after(); } catch (e) { err = (err ? err + '; ' : '') + 'after: ' + e.message; } }
    await s.pressKey('Escape'); await s.pressKey('Escape'); await sleep(120);
    const fin = await snap();
    const undo = await undoSteps();
    let verdict = null;
    try { verdict = check ? check(fin, live) : null; } catch (e) { verdict = 'check threw ' + e.message; }
    row(id, `${tool} | ${combo} | ${verdict ? 'DEV: ' + verdict : 'OK'}${err ? ' | ERR ' + err : ''} || LIVE ${sum(live)} || FINAL ${sum(fin)} || undo=${undo}`);
    return { live, fin, undo, verdict };
  }

  return { ...s, pickTool, doc, snap, sum, undoSteps, shot, setDocUnit, selField, cell };
}
