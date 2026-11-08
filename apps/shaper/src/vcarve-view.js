// apps/shaper/src/vcarve-view.js — the LIVE Vcarve workspace (VCARVE-3b + TASK 432 profile picking). Wires a profile
// region picker (dropdown + direct canvas click via #core/profile-model resolveProfileAtPoint) + V-bit / depth-step /
// max-depth controls writing ONE declared `state.vcarves` record, and a LIVE depth-shaded contour-stack PREVIEW.
// Holes come from the picked profile (combined profile if one covers it, else derived direct holes). Shaper-only.

import { findLoops } from '#core/loop-finder.js';
import { loopPolygon, polyArea } from '#core/loop-geometry.js';
import { resolveProfileViews, resolveProfileForLoop, resolveProfileAtPoint } from '#core/profile-model.js';
import { deriveVcarveContours } from '#core/vcarve.js';
import { VBIT_PRESETS } from './shaper.js';
import { setupPanZoom, updateViewBox } from '#ui/input-handlers/pan-zoom.js';

function clientToWorld(svgEl, cx, cy) {
  try {
    const ctm = svgEl.getScreenCTM && svgEl.getScreenCTM();
    if (ctm && svgEl.createSVGPoint) {
      const pt = svgEl.createSVGPoint();
      pt.x = cx;
      pt.y = cy;
      const w = pt.matrixTransform(ctm.inverse());
      return { x: w.x, y: w.y };
    }
  } catch (_) {}
  return null;
}

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
  const rec = () => state.vcarves[0] || (state.vcarves.push({ id: 'vcarve-1', region: null, vbit: { angle: 90 }, dStep: 0.5, maxDepth: 6 }), state.vcarves[0]);

  // enable + populate the controls (they were disabled placeholders in 3a)
  els.vbit.disabled = els.dstep.disabled = els.maxdepth.disabled = els.recompute.disabled = els.region.disabled = false;
  els.vbit.innerHTML = VBIT_PRESETS.map((v) => `<option value="${v.angle}">${v.angle}°</option>`).join('');

  const shapeById = () => new Map((state.shapes || []).map((s) => [s.id, s]));
  const numFrom = (v, d) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : d; };

  function computeProfilesSnapshot() {
    const sb = shapeById();
    const loops = findLoops(state);
    const loopPolys = Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, state, sb)]));
    const views = resolveProfileViews(state, loops, loopPolys);

    const entries = [];
    const coveredLoops = new Set();

    for (const p of (state.profiles || [])) {
      const v = views.get(p.id);
      if (!v || v.invalid || !v.outerLoopId) continue;
      const boundary = loopPolys[v.outerLoopId] || [];
      if (boundary.length < 3) continue;
      const holePolys = v.innerLoopIds.map((hid) => loopPolys[hid]).filter((hp) => hp && hp.length >= 3);
      const outerArea = Math.abs(polyArea(boundary));
      const holeArea = holePolys.reduce((acc, hp) => acc + Math.abs(polyArea(hp)), 0);
      coveredLoops.add(v.outerLoopId);
      for (const hid of v.innerLoopIds) coveredLoops.add(hid);
      entries.push({
        key: 'profile:' + p.id,
        profileId: p.id,
        outerLoopId: v.outerLoopId,
        holeIds: [...v.innerLoopIds],
        boundary,
        holePolys,
        sortArea: outerArea,
        netArea: Math.max(0, outerArea - holeArea),
        isCombined: true,
        title: p.name || p.id,
      });
    }

    for (const l of loops) {
      if (coveredLoops.has(l.id)) continue;
      const boundary = loopPolys[l.id] || [];
      if (boundary.length < 3) continue;
      const prof = resolveProfileForLoop(l.id, state, loops, loopPolys);
      const holeIds = prof ? [...prof.inners] : [];
      const holePolys = holeIds.map((hid) => loopPolys[hid]).filter((hp) => hp && hp.length >= 3);
      const outerArea = Math.abs(polyArea(boundary));
      const holeArea = holePolys.reduce((acc, hp) => acc + Math.abs(polyArea(hp)), 0);
      entries.push({
        key: l.id,
        profileId: null,
        outerLoopId: l.id,
        holeIds,
        boundary,
        holePolys,
        sortArea: outerArea,
        netArea: Math.max(0, outerArea - holeArea),
        isCombined: false,
        title: null,
      });
    }

    entries.sort((a, b) => b.sortArea - a.sortArea);
    let derivedIdx = 1;
    for (const e of entries) {
      if (!e.isCombined) e.title = `Profile ${derivedIdx++}`;
    }

    const matchEntry = (regionKey) => {
      if (!regionKey) return null;
      const exact = entries.find((e) => e.key === regionKey);
      if (exact) return exact;
      if (regionKey.startsWith('profile:')) {
        const pid = regionKey.slice(8);
        return entries.find((e) => e.profileId === pid) || null;
      }
      // Match combined profile if regionKey is its profileId or one of its member loopIds
      return entries.find((e) => e.profileId === regionKey || e.outerLoopId === regionKey || e.holeIds.includes(regionKey)) || null;
    };

    return { loops, loopPolys, views, entries, matchEntry };
  }

  function populateRegions() {
    const { entries, matchEntry } = computeProfilesSnapshot();

    if (!entries.length) {
      els.region.innerHTML = '<option value="">(no closed profiles)</option>';
      return;
    }

    let html = '<option value="">— pick a profile —</option>';
    for (const it of entries) {
      const holeSuffix = it.holePolys.length ? ` · ${it.holePolys.length} hole${it.holePolys.length === 1 ? '' : 's'}` : '';
      html += `<option value="${it.key}">${it.title} (${it.netArea.toFixed(0)} mm²${holeSuffix})</option>`;
    }
    els.region.innerHTML = html;

    const current = rec().region;
    const matched = matchEntry(current);
    if (matched) {
      rec().region = matched.key;
      els.region.value = matched.key;
    } else if (current) {
      rec().region = null;
      els.region.value = '';
    }
  }

  function syncControls() {
    const r = rec();
    els.vbit.value = String(r.vbit.angle);
    els.dstep.value = r.dStep + ' mm';
    els.maxdepth.value = r.maxDepth + ' mm';
  }

  let lastRegion = null;
  function recompute() {
    const r = rec();
    const { loops, loopPolys, matchEntry } = computeProfilesSnapshot();
    const matched = matchEntry(r.region);
    const activeKey = matched ? matched.key : null;
    const regionChanged = (lastRegion !== activeKey);
    lastRegion = activeKey;

    if (!matched) {
      const allPolys = loops.map((l) => loopPolys[l.id]).filter((p) => p && p.length >= 3);
      renderUnpicked(els.canvas, allPolys, vcarveViewState);
      els.readout.textContent = 'Pick a region to preview.';
      return;
    }

    const { boundary, holePolys } = matched;
    const otherPolys = loops
      .filter((l) => l.id !== matched.outerLoopId && !matched.holeIds.includes(l.id))
      .map((l) => loopPolys[l.id])
      .filter((p) => p && p.length >= 3);
    const contours = deriveVcarveContours(boundary, r, { holes: holePolys });
    render(els.canvas, boundary, contours, r.maxDepth, holePolys, vcarveViewState, regionChanged, otherPolys);
    const maxD = contours.length ? contours[contours.length - 1].depth : 0;
    els.readout.textContent = `${contours.length} contours · max ${maxD.toFixed(2)} mm`;
  }

  function pickAtWorldPoint(wp) {
    if (!wp) return null;
    const { loops, loopPolys, views } = computeProfilesSnapshot();
    const prof = resolveProfileAtPoint(wp, state, loops, loopPolys);
    if (!prof || !prof.outer) return null;
    let nextKey = null;
    if (!prof.isDerived) {
      const v = views.get(prof.id);
      if (!v || v.invalid || !v.outerLoopId) return null;
      nextKey = 'profile:' + prof.id;
    } else {
      nextKey = prof.outer;
    }
    try { state.saveState && state.saveState(); } catch (_) {}
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
    const wp = clientToWorld(els.canvas, e.clientX || 0, e.clientY || 0);
    if (wp) pickAtWorldPoint(wp);
  };
  els.canvas.addEventListener('pointerdown', onCanvasDown);
  els.canvas.addEventListener('pointerup', onCanvasUp);

  els.region.addEventListener('change', () => { try { state.saveState && state.saveState(); } catch (_) {} rec().region = els.region.value || null; recompute(); });
  els.vbit.addEventListener('change', () => { rec().vbit = { angle: Number(els.vbit.value) || 90 }; recompute(); });
  els.dstep.addEventListener('change', () => { rec().dStep = numFrom(els.dstep.value, 0.5); els.dstep.value = rec().dStep + ' mm'; recompute(); });
  els.maxdepth.addEventListener('change', () => { rec().maxDepth = numFrom(els.maxdepth.value, 6); els.maxdepth.value = rec().maxDepth + ' mm'; recompute(); });
  els.recompute.addEventListener('click', recompute);

  function refresh() { populateRegions(); syncControls(); recompute(); }
  refresh();
  return {
    refresh,
    pickAtWorldPoint,
    viewState: vcarveViewState,
    destroy() {
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
function render(canvas, boundary, contours, maxDepth, holePolys = [], vcarveViewState = null, regionChanged = false, otherPolys = []) {
  fitVcarveViewToPoints(canvas, [...boundary, ...holePolys.flat()], vcarveViewState, regionChanged);
  const poly = (pts, attrs) => `<polygon points="${pts.map((p) => p.x.toFixed(3) + ',' + p.y.toFixed(3)).join(' ')}" ${attrs}/>`;
  let s = '';
  for (const op of otherPolys) {
    s += poly(op, 'fill="none" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"');
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
