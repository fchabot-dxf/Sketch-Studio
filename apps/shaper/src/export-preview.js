// apps/shaper/src/export-preview.js — TASK 718: the Export step's 2D view = the Shaper SVG the user downloads, SHOWN (not drawn again): the
// string the page's generateShaperSvgPayload builds (export-payload.js shaperSvgOf, the preview copy) is parsed and its elements are put on a
// pan / zoom canvas unchanged (their fill / stroke / shaper:* attributes are the file's: outside black fill, inside white fill + black stroke,
// pocket grey, online / guide strokes). There is no second renderer of cuts: what a cut looks like here is what the file says.
//  * Each element's cut type and depth are read from its shaper:* attributes, or from the <g> that carries them (the exporter hoists the
//    attributes shared by several elements to a <g>). A stepped cut's "step k of N" cannot be read from the file (two cuts' steps at the same
//    depth are written alike), so the PREVIEW copy carries it: data-step="k/N" on the element (#core/shaper-export `previewData`, from the
//    terrace deriveCuts made); the downloaded file never has it.
//  * A tap / click on an element (a press that moves less than 4 px) picks it: a highlight and its label ("pocket · 7.333 mm · step 2 of 4");
//    a tap on empty space clears it. The list (rows by cut type, then depth and step, each with its element count) picks a row's elements.
//  * Pan / zoom are the shared handlers (#ui/input-handlers/pan-zoom.js: wheel, pinch, drag; the same as Prepare and Vcarve). The first build
//    fits; a rebuild (the plan changed) keeps the view, as the 3D view keeps its camera; fit() frames the drawing again.
import { setupPanZoom, updateViewBox } from '#ui/input-handlers/pan-zoom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPE_TAGS = new Set(['path', 'circle', 'polygon', 'polyline', 'rect', 'ellipse', 'line']);
const TAP_PX = 4;          // a press that moves less than this is a tap (a pick), more is a pan (the Vcarve view's rule)
const SHADE_SHALLOW = 70, SHADE_DEEP = 30; // TASK 719: the pockets' grey lightness (%) at the shallowest / deepest depth of THIS export
const SHADE_OUTSIDE_SHALLOW = 25;           // TASK 719: a stepped outside's terraces: dark grey (25%) at the shallowest step down to the file's black at the deepest
const OUTSIDE_STEP_OUTLINE = '#9a9a9a';     // their thin light outline (the file's black outside has none, so the ledges would not show)
const POCKET_OUTLINE = '#222';             // the thin outline every pocket gets (the file's pockets have none)
const FIT_MARGIN = 0.06;   // empty space round the drawing on each side after fit(), a fraction of its size

/** Parse a Shaper SVG string into its root <svg> element (an XML parse: the shaper: namespace is kept). A string that does not parse throws. */
export function parseShaperSvg(text, doc = document) {
  const xml = new doc.defaultView.DOMParser().parseFromString(text, 'image/svg+xml');
  const root = xml.documentElement;
  if (!root || root.localName !== 'svg' || xml.getElementsByTagName('parsererror').length) throw new Error('the Shaper SVG does not parse');
  return root;
}

// a cut attribute of the element, or of the nearest ancestor that carries it (a <g> the exporter hoisted it to); read by its qualified name as the
// exporter writes it (shaper:cutType ...), which the browser and the node tests' DOM (happy-dom: no attribute namespaces) both match
function cutAttr(el, name) {
  for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
    const v = e.getAttribute('shaper:' + name);
    if (v) return v;
  }
  return null;
}

/** The drawn elements under `root`, in file order: { el, tag, cutType, depth, step: { k, n } | null }. */
export function previewItems(root) {
  return [...root.querySelectorAll('*')].filter((el) => SHAPE_TAGS.has(el.localName)).map((el) => {
    const m = /^(\d+)\/(\d+)$/.exec(el.getAttribute('data-step') || '');
    return { el, tag: el.localName, cutType: cutAttr(el, 'cutType'), depth: cutAttr(el, 'cutDepth'), step: m ? { k: Number(m[1]), n: Number(m[2]) } : null };
  });
}

/**
 * TASK 719: the PREVIEW's shade of each pocket depth: { shades: Map(depth string -> css colour), lo, hi }. Lightness runs linearly from SHADE_SHALLOW (the
 * shallowest pocket of this export) to SHADE_DEEP (the deepest); one depth only = the middle. Display only: the file's own fill stays in the download.
 */
export function pocketShades(items) {
  return shadesOf(items.filter((it) => it.cutType === 'pocket'), SHADE_SHALLOW, SHADE_DEEP);
}
/** The same for a stepped OUTSIDE (its terraces only: a plain outside keeps the file's black): dark greys, SHADE_OUTSIDE_SHALLOW % down to the file's black. */
export function outsideStepShades(items) {
  return shadesOf(items.filter((it) => it.cutType === 'outside' && it.step), SHADE_OUTSIDE_SHALLOW, 0);
}
function shadesOf(list, shallow, deep) {
  const num = (it) => parseFloat(it.depth);
  const ds = list.map(num).filter(Number.isFinite);
  const lo = Math.min(...ds), hi = Math.max(...ds);
  const shades = new Map();
  for (const it of list) {
    const d = num(it);
    if (!Number.isFinite(d) || shades.has(it.depth)) continue;
    const t = hi > lo ? (d - lo) / (hi - lo) : 0.5;
    shades.set(it.depth, `hsl(0, 0%, ${(shallow + (deep - shallow) * t).toFixed(1)}%)`);
  }
  return { shades, lo, hi };
}

/** An element's label: "pocket · 7.333 mm · step 2 of 4" (the depth as the file writes it). */
export const itemLabel = (it) => [it.cutType || 'no cut type', it.depth || 'depth unset', it.step ? `step ${it.step.k} of ${it.step.n}` : null].filter(Boolean).join(' · ');

/** The list: one group per cut type (file order) with its element count, one row per depth + step in it (file order) with its elements. */
export function previewRows(items) {
  const groups = new Map();
  for (const it of items) {
    const type = it.cutType || 'no cut type';
    if (!groups.has(type)) groups.set(type, { cutType: type, count: 0, rows: new Map() });
    const g = groups.get(type);
    g.count++;
    const key = `${it.depth || ''}|${it.step ? it.step.k + '/' + it.step.n : ''}`;
    if (!g.rows.has(key)) g.rows.set(key, { depth: it.depth, step: it.step, items: [] });
    g.rows.get(key).items.push(it);
  }
  return [...groups.values()].map((g) => ({ cutType: g.cutType, count: g.count, rows: [...g.rows.values()] }));
}

/**
 * mountExportPreview({ canvas, list, info, getSvg, emptyText }) -> { refresh(sig), fit(), pickRow(i), inspect() }
 *   canvas   the <svg> the file's elements are shown in (its viewBox is the view)
 *   list     the element the cut list is written in
 *   info     the one-line label (the picked element, or the element count; `emptyText` when there is no cut)
 *   getSvg   () => the preview copy of the Shaper SVG, or null when no cut is assigned
 */
export function mountExportPreview({ canvas, list, info, getSvg, emptyText }) {
  const doc = canvas.ownerDocument;
  const viewState = { view: null, allowEmptyPan: true, _panZoom: { isPanning: false, lastPanPoint: null, lastTouchDistance: null, touchPoints: new Map(), isPinching: false, lastPinchCenter: null, lastPinchDistance: null } };
  setupPanZoom(canvas, viewState, { attachListeners: true });
  let shading = { shades: new Map(), lo: NaN, hi: NaN }, outsideShading = { shades: new Map() };
  let layer = null, items = [], rows = [], byEl = new Map(), picked = [], pickedLabel = null, lastSig, fitPending = false;
  const rowButtons = [], rowOf = []; // the list's row buttons and the row each one picks

  const sized = () => { const r = canvas.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  function fit() {
    if (!layer || !items.length) return;
    if (!sized()) { fitPending = true; return; }  // hidden: framed at the first real size
    fitPending = false;
    const b = layer.getBBox();
    const r = canvas.getBoundingClientRect();
    const aspect = r.width / r.height;
    const m = Math.max(b.width, b.height) * FIT_MARGIN;
    const w = Math.max(b.width + 2 * m, (b.height + 2 * m) * aspect, 1);
    viewState.view = { x: b.x + b.width / 2, y: b.y + b.height / 2, w, h: w / aspect };
    updateViewBox(canvas, viewState.view);
  }
  new ResizeObserver(() => {
    if (!sized()) return;
    if (fitPending) fit();
    else if (viewState.view) updateViewBox(canvas, viewState.view); // keep the scale, follow the new aspect
  }).observe(canvas);

  function showInfo() {
    if (!items.length) info.textContent = emptyText;
    else info.textContent = pickedLabel || `${items.length} element${items.length === 1 ? '' : 's'} · tap one to see its cut`;
  }
  function pick(its, label, rowIndex = -1) {
    for (const it of picked) it.el.classList.remove('rv2d-picked');
    picked = its;
    for (const it of picked) it.el.classList.add('rv2d-picked');
    pickedLabel = its.length ? label : null;
    rowButtons.forEach((b, i) => b.setAttribute('aria-pressed', i === rowIndex ? 'true' : 'false'));
    showInfo();
  }
  const pickItem = (it) => (it ? pick([it], itemLabel(it), rowOf.findIndex((r) => r.items.includes(it))) : pick([], null));
  function pickRow(i) {
    const row = rowOf[i];
    if (!row) return;
    pick(row.items, itemLabel(row.items[0]) + (row.items.length > 1 ? ` · ${row.items.length} elements` : ''), i);
  }

  const depthKey = (pick) => [...shading.shades.keys()].reduce((a, k) => (pick(parseFloat(k), parseFloat(a)) ? k : a));
  const minDepthKey = () => depthKey((x, y) => x < y);
  const maxDepthKey = () => depthKey((x, y) => x > y);

  function renderList() {
    rowButtons.length = 0; rowOf.length = 0;
    const out = [];
    if (outsideShading.shades.size) {
      const lg = doc.createElement('div'); lg.className = 'rv2d-legend';
      lg.textContent = 'outside steps: lighter = shallower, black = deepest';
      out.push(lg);
    }
    if (shading.shades.size) {
      const lg = doc.createElement('div'); lg.className = 'rv2d-legend';
      const sw = doc.createElement('span'); sw.className = 'rv2d-ramp';
      sw.style.background = `linear-gradient(to right, ${shading.shades.get(minDepthKey())}, ${shading.shades.get(maxDepthKey())})`;
      const tx = doc.createElement('span'); tx.textContent = 'pockets: lighter = shallower, darker = deeper';
      lg.append(sw, tx);
      out.push(lg);
    }
    for (const g of rows) {
      const head = doc.createElement('div'); head.className = 'rv2d-type';
      const name = doc.createElement('span'); name.textContent = g.cutType;
      const n = doc.createElement('span'); n.className = 'rv2d-count'; n.textContent = String(g.count);
      head.append(name, n);
      out.push(head);
      for (const row of g.rows) {
        const b = doc.createElement('button'); b.type = 'button'; b.className = 'rv2d-row';
        const t = doc.createElement('span'); t.textContent = [row.depth || 'depth unset', row.step ? `step ${row.step.k} of ${row.step.n}` : null].filter(Boolean).join(' · ');
        const c = doc.createElement('span'); c.className = 'rv2d-count'; c.textContent = String(row.items.length);
        const shade = g.cutType === 'pocket' ? shading.shades.get(row.depth) : (g.cutType === 'outside' && row.step ? outsideShading.shades.get(row.depth) : null);
        if (shade) { const chip = doc.createElement('span'); chip.className = 'rv2d-chip'; chip.style.background = shade; b.append(chip); }
        b.append(t, c);
        const i = rowButtons.length;
        b.addEventListener('click', () => pickRow(i));
        rowButtons.push(b); rowOf.push(row);
        out.push(b);
      }
    }
    list.replaceChildren(...out);
  }

  /** Show the plan's file again unless `sig` (the Review's signature of the plan) is the one shown. Returns inspect(). */
  function refresh(sig) {
    if (sig !== undefined && sig === lastSig) { if (fitPending) fit(); return inspect(); }
    lastSig = sig;
    if (layer) layer.remove();
    layer = null; items = []; rows = []; shading = { shades: new Map(), lo: NaN, hi: NaN }; outsideShading = { shades: new Map() }; byEl = new Map(); picked = []; pickedLabel = null;
    const text = getSvg();
    if (text) {
      const root = parseShaperSvg(text, doc);
      layer = doc.createElementNS(SVG_NS, 'g'); layer.setAttribute('class', 'rv2d-doc');
      for (const n of [...root.childNodes]) layer.appendChild(doc.importNode(n, true));
      canvas.appendChild(layer);
      items = previewItems(layer);
      rows = previewRows(items);
      byEl = new Map(items.map((it) => [it.el, it]));
      // TASK 719: the display's own styling, on the mounted copy only: pockets shaded by depth + outlined (attributes, so the picked class still wins)
      shading = pocketShades(items);
      outsideShading = outsideStepShades(items);
      // a stepped outside's terraces are nested outlines (a shallow step is INSIDE a deeper one) and the file writes the shallow one first, so the deeper
      // would paint over it: stack them deepest first, in place (the first terrace's position), so every ledge shows. The picks / list read items, not the DOM order.
      const terraces = items.filter((it) => it.cutType === 'outside' && it.step);
      if (terraces.length > 1) {
        const first = terraces.find((it) => terraces.every((o) => o === it || !(o.el.compareDocumentPosition(it.el) & 2))); // the earliest in document order
        const marker = doc.createComment('');
        first.el.parentNode.insertBefore(marker, first.el);
        for (const it of [...terraces].sort((a, b) => parseFloat(b.depth) - parseFloat(a.depth))) marker.parentNode.insertBefore(it.el, marker);
        marker.remove();
      }
      for (const it of items) {
        const shade = it.cutType === 'pocket' ? shading.shades.get(it.depth) : null;
        if (shade) { it.el.setAttribute('fill', shade); it.el.setAttribute('stroke', POCKET_OUTLINE); }
        const oShade = it.cutType === 'outside' && it.step ? outsideShading.shades.get(it.depth) : null;
        if (oShade) { it.el.setAttribute('fill', oShade); it.el.setAttribute('stroke', OUTSIDE_STEP_OUTLINE); }
      }
    }
    renderList();
    showInfo();
    if (items.length && !viewState.view) fit();
    return inspect();
  }

  // a tap picks the element under it (the target of the press: a pan captures the pointer, so the release lands on the canvas)
  let press = null, pointers = 0;
  canvas.addEventListener('pointerdown', (e) => {
    pointers++;
    press = pointers === 1 && (e.button == null || e.button === 0) ? { x: e.clientX, y: e.clientY, item: byEl.get(e.target) || null } : null;
  });
  const release = (e) => {
    pointers = Math.max(0, pointers - 1);
    const p = press; press = null;
    if (!p || e.type !== 'pointerup' || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= TAP_PX) return;
    pickItem(p.item);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  function inspect() {
    return {
      elements: items.length,
      rows: rows.map((g) => ({ cutType: g.cutType, count: g.count, rows: g.rows.map((r) => ({ depth: r.depth, step: r.step ? `${r.step.k}/${r.step.n}` : null, count: r.items.length })) })),
      picked: picked.length, label: info.textContent, view: viewState.view ? { ...viewState.view } : null,
    };
  }
  return { refresh, fit, pickRow, inspect };
}
