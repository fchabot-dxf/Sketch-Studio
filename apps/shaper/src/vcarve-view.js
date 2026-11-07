// apps/shaper/src/vcarve-view.js — the LIVE Vcarve workspace (VCARVE-3b). Wires the VCARVE-3a skeleton: a region
// picker (a closed loop) + the V-bit / depth-step / max-depth controls writing ONE declared `state.vcarves` record, and
// a LIVE depth-shaded contour-stack PREVIEW. The HOST computes the boundary polygon (`loopPolygon`, DOM — the S-4a/4e
// purity split); #core/vcarve `vcarveContours` DERIVES the stack (never materialized). Shaper-only.

import { findLoops } from '#core/loop-finder.js';
import { loopPolygon, polyArea } from '#core/loop-geometry.js';
import { holesOfLoop } from '#core/group-model.js';
import { deriveVcarveContours } from '#core/vcarve.js';
import { VBIT_PRESETS } from './shaper.js';


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

  if (!Array.isArray(state.vcarves)) state.vcarves = [];
  // ONE record (the tab edits a single vcarve for now); DERIVE the stack — never materialize it.
  const rec = () => state.vcarves[0] || (state.vcarves.push({ id: 'vcarve-1', region: null, vbit: { angle: 90 }, dStep: 0.5, maxDepth: 6 }), state.vcarves[0]);

  // enable + populate the controls (they were disabled placeholders in 3a)
  els.vbit.disabled = els.dstep.disabled = els.maxdepth.disabled = els.recompute.disabled = els.region.disabled = false;
  els.vbit.innerHTML = VBIT_PRESETS.map((v) => `<option value="${v.angle}">${v.angle}°</option>`).join('');

  const shapeById = () => new Map((state.shapes || []).map((s) => [s.id, s]));
  const numFrom = (v, d) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : d; };

  function populateRegions() {
    const sb = shapeById();
    const loops = findLoops(state);
    const loopPolys = Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, state, sb)]));
    const items = loops
      .map((l) => ({ id: l.id, loop: l, area: Math.abs(polyArea(loopPolys[l.id] || [])) }))
      .sort((a, b) => b.area - a.area);

    items.forEach((it, idx) => { it.num = idx + 1; });
    const itemById = new Map(items.map((it) => [it.id, it]));

    const absorbedBy = new Map(); // holeId -> parentItem
    const holesMap = new Map();   // parentId -> [holeItem, ...]
    for (const it of items) {
      const hids = holesOfLoop(it.loop, loops, state, loopPolys, { excludeNested: true });
      if (hids.length) {
        const holeItems = hids.map((hid) => itemById.get(hid)).filter(Boolean);
        holesMap.set(it.id, holeItems);
        for (const hit of holeItems) absorbedBy.set(hit.id, it);
      }
    }

    if (!items.length) {
      els.region.innerHTML = '<option value="">(no closed loops)</option>';
      return;
    }

    let html = '<option value="">— pick a loop —</option>';
    for (const it of items) {
      if (absorbedBy.has(it.id)) {
        const parent = absorbedBy.get(it.id);
        html += `<option value="${it.id}" disabled>Loop ${it.num} (hole in Loop ${parent.num})</option>`;
      } else {
        const holes = holesMap.get(it.id) || [];
        const holeSuffix = holes.length ? ` · ${holes.length} hole${holes.length === 1 ? '' : 's'}` : '';
        html += `<option value="${it.id}">Loop ${it.num} (${it.area.toFixed(0)} mm²${holeSuffix})</option>`;
      }
    }
    els.region.innerHTML = html;

    const current = rec().region;
    if (current && itemById.has(current) && !absorbedBy.has(current)) {
      els.region.value = current;
    } else if (current && absorbedBy.has(current)) {
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

  function recompute() {
    const r = rec();
    const loops = findLoops(state);
    const loop = loops.find((l) => l.id === r.region);
    if (!loop) { els.canvas.innerHTML = ''; els.readout.textContent = 'Pick a region to preview.'; return; }
    const sb = shapeById();
    const boundary = loopPolygon(loop, state, sb);
    if (!boundary || boundary.length < 3) { els.canvas.innerHTML = ''; els.readout.textContent = 'Region has no boundary.'; return; }
    const loopPolys = Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, state, sb)]));
    const holeIds = holesOfLoop(loop, loops, state, loopPolys, { excludeNested: true });
    const holePolys = holeIds.map((hid) => loopPolys[hid]).filter((p) => p && p.length >= 3);
    const contours = deriveVcarveContours(boundary, r, { holes: holePolys });
    render(els.canvas, boundary, contours, r.maxDepth, holePolys);
    const maxD = contours.length ? contours[contours.length - 1].depth : 0;
    els.readout.textContent = `${contours.length} contours · max ${maxD.toFixed(2)} mm`;
  }

  els.region.addEventListener('change', () => { try { state.saveState && state.saveState(); } catch (_) {} rec().region = els.region.value || null; recompute(); });
  els.vbit.addEventListener('change', () => { rec().vbit = { angle: Number(els.vbit.value) || 90 }; recompute(); });
  els.dstep.addEventListener('change', () => { rec().dStep = numFrom(els.dstep.value, 0.5); els.dstep.value = rec().dStep + ' mm'; recompute(); });
  els.maxdepth.addEventListener('change', () => { rec().maxDepth = numFrom(els.maxdepth.value, 6); els.maxdepth.value = rec().maxDepth + ' mm'; recompute(); });
  els.recompute.addEventListener('click', recompute);

  function refresh() { populateRegions(); syncControls(); recompute(); }
  refresh();
  return { refresh };
}

// Light poly render on the (cream) Vcarve canvas: the region boundary (dark) + hole boundaries (dark)
// + the nested contours DEPTH-SHADED (deeper = darker). Auto-fits the viewBox to the region bbox.
// Non-scaling strokes keep line weight constant.
function render(canvas, boundary, contours, maxDepth, holePolys = []) {
  const allPts = [...boundary, ...holePolys.flat()];
  const xs = allPts.map((p) => p.x), ys = allPts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(1e-3, maxX - minX), h = Math.max(1e-3, maxY - minY), m = Math.max(w, h) * 0.12 + 1;
  canvas.setAttribute('viewBox', `${minX - m} ${minY - m} ${w + 2 * m} ${h + 2 * m}`);
  const poly = (pts, attrs) => `<polygon points="${pts.map((p) => p.x.toFixed(3) + ',' + p.y.toFixed(3)).join(' ')}" ${attrs}/>`;
  let s = poly(boundary, 'fill="none" stroke="#202020" stroke-width="1.6" vector-effect="non-scaling-stroke"');
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
