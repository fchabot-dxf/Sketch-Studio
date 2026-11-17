// apps/shaper/src/vcarve-view.js — the LIVE Vcarve workspace (VCARVE-3b + TASK 432 profile picking). Wires a profile
// region picker (dropdown + direct canvas click via #core/profile-model resolveProfileAtPoint) + V-bit / depth-step /
// max-depth controls writing ONE declared `state.vcarves` record, and a LIVE depth-shaded contour-stack PREVIEW.
// Holes come from the picked profile (combined profile if one covers it, else derived direct holes). Shaper-only.

import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { resolveProfileAtPoint, resolveTargetKey, listSketchProfiles } from '#core/profile-model.js';
import { deriveVcarveContours, deriveVcarveFootprint } from '#core/vcarve.js';
import { VBIT_PRESETS } from './shaper.js';
import { attachStepper } from './number-stepper.js';
import SettingsManager, { docUnit, isPrecisionKey, lengthText, areaText } from '#core/settings-manager.js';
import { parse as parseUnit, unitNumber } from '#core/units.js';
import { setupPanZoom, updateViewBox } from '#ui/input-handlers/pan-zoom.js';
import { screenToWorld } from '#ui/coords.js';

// TASK 730 / 734: the two numeric fields' − / + steps, in the DOCUMENT unit (inches: 1/64 and 1/32); no app minimum, the value only stays > 0 (positive: the − stops at the smallest positive multiple).
const DSTEP_STEPPER = { step: { mm: 0.5, in: 1 / 64 }, positive: true };
const MAXDEPTH_STEPPER = { step: { mm: 0.5, in: 1 / 32 }, positive: true };

// TASK 734 / 728: the panel's texts are the one length-format decider's (#core/settings-manager.js lengthText / areaText): the doc unit with its unit, the
// panel's usual decimals while Length precision is Auto (trailing zeros dropped: "0.5 mm", "0.0156 in"), an inch fraction in Fractional. The DEPTH STEP is a
// resolution (1/64 in, 0.5 mm: below the 1/16 a fraction would round it to 0"): always decimals. Areas are never fractions.
const AUTO_DECIMALS = { mm: 3, cm: 4, in: 4 };
const AUTO_AREA_DECIMALS = { mm: 0, cm: 2, in: 2 };
const depthText = (mm) => lengthText(mm, { auto: AUTO_DECIMALS[docUnit()] ?? 3, trim: 'auto', show: 'unit' });
const stepText = (mm) => lengthText(mm, { auto: AUTO_DECIMALS[docUnit()] ?? 3, trim: 'auto', show: 'unit', fractions: false });
const docNumber = (mm) => unitNumber(mm, docUnit()); // the steppers step from the exact doc-unit number, never the text

export function mountVcarveView(state) {
  const els = {
    region: document.getElementById('vcarve-region'),
    vbit: document.getElementById('vcarve-vbit'),
    dstep: document.getElementById('vcarve-dstep'),
    maxdepth: document.getElementById('vcarve-maxdepth'),
    recompute: document.getElementById('vcarve-recompute'),
    readout: document.getElementById('vcarve-readout'),
    canvas: document.getElementById('vcarve-canvas'),
  };
  if (!els.canvas) return { refresh() {} };

  const vcarveViewState = {
    view: null,
    allowEmptyPan: true,
    _panZoom: {
      isPanning: false,
      lastPanPoint: null,
      lastTouchDistance: null,
      touchPoints: new Map(),
      isPinching: false,
      lastPinchCenter: null,
      lastPinchDistance: null,
    },
  };
  const panZoomCleanup = setupPanZoom(els.canvas, vcarveViewState, { attachListeners: true });

  if (!Array.isArray(state.vcarves)) state.vcarves = [];
  // ONE record (the tab edits a single vcarve for now); DERIVE the stack — never materialize it.
  // TASK 609: the record is CREATED only when the user sets something up (rec(), used by every write); merely entering the tab READS the defaults (peek()) and
  // leaves the document untouched, so an Untitled the user did nothing in stays clean (no dot, closing asks nothing).
  const newRecord = () => ({ id: 'vcarve-1', region: null, vbit: { angle: 90 }, dStep: 0.5, maxDepth: 6 });
  const peek = () => state.vcarves[0] || newRecord();
  const rec = () => state.vcarves[0] || (state.vcarves.push(newRecord()), state.vcarves[0]);

  // enable + populate the controls (they were disabled placeholders in 3a)
  els.vbit.disabled = els.dstep.disabled = els.maxdepth.disabled = els.recompute.disabled = els.region.disabled = false;
  els.vbit.innerHTML = VBIT_PRESETS.map((v) => `<option value="${v.angle}">${v.angle}°</option>`).join('');

  const shapeById = () => new Map((state.shapes || []).map((s) => [s.id, s]));

  function populateRegions() {
    const entries = listSketchProfiles(state);

    if (!entries.length) {
      els.region.innerHTML = '<option value="">(no closed profiles)</option>';
      return;
    }

    let html = '<option value="">— pick a profile —</option>';
    for (const it of entries) {
      const holeSuffix = it.holePolys.length ? ` · ${it.holePolys.length} hole${it.holePolys.length === 1 ? '' : 's'}` : '';
      html += `<option value="${it.key}">${it.title} (${areaText(it.netArea, { auto: AUTO_AREA_DECIMALS[docUnit()] ?? 0 })}${holeSuffix})</option>`;
    }
    els.region.innerHTML = html;

    const current = peek().region;
    const matched = resolveTargetKey(current, state);
    if (matched && !matched.invalid && matched.outer) {
      const key = matched.profileId ? `profile:${matched.profileId}` : `loop:${matched.outer}`;
      if (key !== current) rec().region = key; // normalise a stored bare id (a stored record exists here: current is non-null)
      els.region.value = key;
    } else if (current) {
      rec().region = null;
      els.region.value = '';
    }
  }

  function syncControls() {
    const r = peek();
    els.vbit.value = String(r.vbit.angle);
    els.dstep.value = stepText(r.dStep);
    els.maxdepth.value = depthText(r.maxDepth);
  }

  let lastRegion = null;
  function recompute() {
    const r = peek();
    const sb = shapeById();
    const loops = findLoops(state);
    const loopPolys = Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, state, sb)]));
    const matched = resolveTargetKey(r.region, state, loops, loopPolys);
    const activeKey = (matched && !matched.invalid && matched.outer)
      ? (matched.profileId ? `profile:${matched.profileId}` : `loop:${matched.outer}`)
      : null;
    const regionChanged = (lastRegion !== activeKey);
    lastRegion = activeKey;

    if (!matched || matched.invalid || !matched.outer) {
      const allPolys = loops.map((l) => loopPolys[l.id]).filter((p) => p && p.length >= 3);
      renderUnpicked(els.canvas, allPolys, vcarveViewState);
      els.readout.textContent = 'Pick a region to preview.';
      return;
    }

    const boundary = loopPolys[matched.outer] || [];
    const holePolys = (matched.inners || []).map((hid) => loopPolys[hid]).filter((hp) => hp && hp.length >= 3);
    const otherPolys = loops
      .filter((l) => l.id !== matched.outer && !(matched.inners || []).includes(l.id))
      .map((l) => loopPolys[l.id])
      .filter((p) => p && p.length >= 3);
    const contours = deriveVcarveContours(boundary, r, { holes: holePolys });
    render(els.canvas, boundary, contours, r.maxDepth, holePolys, vcarveViewState, regionChanged, otherPolys, deriveVcarveFootprint(contours, r));
    const maxD = contours.length ? contours[contours.length - 1].depth : 0;
    els.readout.textContent = `${contours.length} contours · max ${depthText(maxD)}`;
  }

  function pickAtWorldPoint(wp) {
    if (!wp) return null;
    const prof = resolveProfileAtPoint(wp, state);
    if (!prof || !prof.outer) return null;
    const nextKey = prof.isDerived ? `loop:${prof.outer}` : `profile:${prof.id}`;
    const matched = resolveTargetKey(nextKey, state);
    if (!matched || matched.invalid) return null;
    try { state.saveState && state.saveState('vcarve region'); } catch (_) {}
    rec().region = nextKey;
    populateRegions();
    recompute();
    return prof;
  }

  let downPt = null;
  const onCanvasDown = (e) => {
    if (e.button != null && e.button !== 0) { downPt = null; return; }
    downPt = { x: e.clientX || 0, y: e.clientY || 0 };
  };
  const onCanvasUp = (e) => {
    if (!downPt) return;
    const dx = (e.clientX || 0) - downPt.x;
    const dy = (e.clientY || 0) - downPt.y;
    downPt = null;
    if (Math.hypot(dx, dy) >= 4) return; // pan drag, not a click
    const wp = screenToWorld(els.canvas, e.clientX || 0, e.clientY || 0);
    if (wp) pickAtWorldPoint(wp);
  };
  els.canvas.addEventListener('pointerdown', onCanvasDown);
  els.canvas.addEventListener('pointerup', onCanvasUp);

  els.region.addEventListener('change', () => { try { state.saveState && state.saveState('vcarve region'); } catch (_) {} rec().region = els.region.value || null; recompute(); });
  els.vbit.addEventListener('change', () => { rec().vbit = { angle: Number(els.vbit.value) || 90 }; recompute(); });
  // typed and stepped values take the same path: one record write (BASE mm), the field text (document unit), the recompute
  const setDStep = (mm) => { rec().dStep = mm; els.dstep.value = stepText(rec().dStep); recompute(); };
  const setMaxDepth = (mm) => { rec().maxDepth = mm; els.maxdepth.value = depthText(rec().maxDepth); recompute(); };
  // a typed value parses in the document unit exactly as the cut card's fields do; only a positive length is taken (else the field shows the record's value again).
  // A box left as prefilled never commits (724: the shown text is rounded, writing it back would drift the stored value).
  const typed = (input, current, set, text) => {
    if (input.value === text(current())) return;
    const mm = parseUnit(input.value, docUnit());
    if (mm != null && Number.isFinite(mm) && mm > 0) set(mm); else syncControls();
  };
  els.dstep.addEventListener('change', () => typed(els.dstep, () => peek().dStep, setDStep, stepText));
  els.maxdepth.addEventListener('change', () => typed(els.maxdepth, () => peek().maxDepth, setMaxDepth, depthText));
  const units = { unit: docUnit, toDoc: docNumber };
  // a stepped doc-unit number is converted to base mm by the same parse
  const stepTo = (set) => (docNum) => set(parseUnit(String(docNum), docUnit()));
  const steppers = [
    attachStepper(els.dstep, DSTEP_STEPPER, { ...units, read: () => docNumber(peek().dStep), commit: stepTo(setDStep) }, { label: 'depth step' }),
    attachStepper(els.maxdepth, MAXDEPTH_STEPPER, { ...units, read: () => docNumber(peek().maxDepth), commit: stepTo(setMaxDepth) }, { label: 'max depth' }),
  ];
  els.recompute.addEventListener('click', recompute);

  function refresh() { populateRegions(); syncControls(); recompute(); }
  refresh();
  // the document unit (and the Length precision) change the shown text: re-show the fields, the region list and the readout
  const unsub = SettingsManager.subscribe((key) => { if (key === 'DOC_UNIT' || isPrecisionKey(key)) refresh(); });
  return {
    refresh,
    pickAtWorldPoint,
    viewState: vcarveViewState,
    // TASK 605: a document tab keeps its own Vcarve pan / zoom aside (shaper-session.js); null = none yet: the next draw fits the region
    getView: () => (vcarveViewState.view ? { ...vcarveViewState.view } : null),
    setView(v) {
      if (v) { vcarveViewState.view = { ...v }; updateViewBox(els.canvas, vcarveViewState.view); }
      else { vcarveViewState.view = null; recompute(); }
    },
    destroy() {
      unsub();
      for (const st of steppers) st.destroy();
      els.canvas.removeEventListener('pointerdown', onCanvasDown);
      els.canvas.removeEventListener('pointerup', onCanvasUp);
      if (panZoomCleanup && typeof panZoomCleanup.destroy === 'function') panZoomCleanup.destroy();
    },
  };
}

function fitVcarveViewToPoints(canvas, allPts, vcarveViewState, forceFit) {
  if (!allPts.length) return;
  const xs = allPts.map((p) => p.x), ys = allPts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(1e-3, maxX - minX), h = Math.max(1e-3, maxY - minY), m = Math.max(w, h) * 0.12 + 1;
  if (vcarveViewState) {
    if (forceFit || !vcarveViewState.view) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const rect = (canvas.getBoundingClientRect && canvas.getBoundingClientRect()) || null;
      const aspect = (rect && rect.width && rect.height) ? (rect.width / rect.height) : (4 / 3);
      const reqW = Math.max(w + 2 * m, (h + 2 * m) * aspect);
      vcarveViewState.view = { x: cx, y: cy, w: reqW, h: reqW / aspect };
      updateViewBox(canvas, vcarveViewState.view);
    }
  } else {
    canvas.setAttribute('viewBox', `${minX - m} ${minY - m} ${w + 2 * m} ${h + 2 * m}`);
  }
}

function renderUnpicked(canvas, loopPolys, vcarveViewState) {
  if (!loopPolys || !loopPolys.length) {
    canvas.innerHTML = '';
    return;
  }
  fitVcarveViewToPoints(canvas, loopPolys.flat(), vcarveViewState, false);
  const poly = (pts, attrs) => `<polygon points="${pts.map((p) => p.x.toFixed(3) + ',' + p.y.toFixed(3)).join(' ')}" ${attrs}/>`;
  canvas.innerHTML = loopPolys
    .map((pts) => poly(pts, 'fill="none" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"'))
    .join('');
}

// Light poly render on the (cream) Vcarve canvas: the region boundary (dark) + hole boundaries (dark)
// + the nested contours DEPTH-SHADED (deeper = darker). Auto-fits the viewBox to the region bbox.
// Non-scaling strokes keep line weight constant.
function render(canvas, boundary, contours, maxDepth, holePolys = [], vcarveViewState = null, regionChanged = false, otherPolys = [], footprints = []) {
  fitVcarveViewToPoints(canvas, [...boundary, ...holePolys.flat()], vcarveViewState, regionChanged);
  const poly = (pts, attrs) => `<polygon points="${pts.map((p) => p.x.toFixed(3) + ',' + p.y.toFixed(3)).join(' ')}" ${attrs}/>`;
  let s = '';
  for (const op of otherPolys) {
    s += poly(op, 'fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"');
  }
  // TASK 447: each ring's REAL surface width (swept band, from the core derivation), deeper = darker; drawn under the lines.
  for (let i = 0; i < footprints.length; i++) {
    const f = footprints[i];
    if (!f.rings.length) continue;
    const t = maxDepth > 0 ? Math.min(1, f.depth / maxDepth) : 0;
    const L = Math.round(66 - 44 * t);
    s += `<path d="${f.rings.map((ring) => 'M ' + ring.map((p) => p.x.toFixed(3) + ' ' + p.y.toFixed(3)).join(' L ') + ' Z').join(' ')}" fill-rule="${f.fillRule}" fill="hsl(28,50%,${L}%)" fill-opacity="0.12" stroke="none"/>`;
  }
  s += poly(boundary, 'fill="none" stroke="#202020" stroke-width="1.6" vector-effect="non-scaling-stroke"');
  for (const hp of holePolys) {
    s += poly(hp, 'fill="none" stroke="#202020" stroke-width="1.6" vector-effect="non-scaling-stroke"');
  }
  for (const c of contours) {
    const t = maxDepth > 0 ? Math.min(1, c.depth / maxDepth) : 0;
    const L = Math.round(66 - 44 * t); // 66% → 22% lightness (deeper = darker)
    s += poly(c.polygon, `fill="none" stroke="hsl(28,50%,${L}%)" stroke-width="1" vector-effect="non-scaling-stroke"`);
  }
  canvas.innerHTML = s;
}
