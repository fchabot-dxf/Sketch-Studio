// apps/shaper/src/export-preview.js — TASK 718: the Export step's 2D view = the Shaper SVG the user downloads, SHOWN (not drawn again): the
// string the page's generateShaperSvgPayload builds (export-payload.js shaperSvgOf, the preview copy) is parsed and its elements are put on a
// pan / zoom canvas unchanged (their fill / stroke / shaper:* attributes are the file's: outside black fill, inside white fill + black stroke,
// pocket grey, online / guide strokes). There is no second renderer of cuts: what a cut looks like here is what the file says.
//  * Each element's cut type and depth are read from its shaper:* attributes, or from the <g> that carries them (the exporter hoists the
//    attributes shared by several elements to a <g>). A stepped cut's "step k of N" cannot be read from the file (two cuts' steps at the same
//    depth are written alike), so the PREVIEW copy carries it: data-step="k/N" on the element (#core/shaper-export `previewData`, from the
//    terrace deriveCuts made); the downloaded file never has it.
//  * TASK 742: a held cut (tabs / onion skin) is plain cuts in the file too (the pass is an outside / inside cut, each gap strip an inside cut);
//    the preview copy carries data-hold="pass" | "skin" | "gap k/N" the same way, so the label and the list say "pass (tabs)", "onion skin", "gap 2 of 4".
//  * TASK 743: the list is the OPERATIONS list: the same operations, in the same order and words, as Prepare's (operations.js planOperations, given with
//    the preview copy). Operations are a DISPLAY grouping (the file is unchanged by them); the preview copy tags each element with its operation's id
//    (data-op, like data-step), which maps the list to the elements: a tool heading ("Change to ¼″ end mill") per run of operations with the same bit, one
//    header per operation (a tap picks all its elements), then its rows (depth, step, hold; the cut type too when the operation writes more than one,
//    e.g. an Outside plate's own holes). Elements of no listed operation (a call without `ops`) keep the grouping by cut type, after the operations.
//  * TASK 745: a programmed pocket is on-line paths + its finish pass (an inside cut, islands as outside cuts) in the file; the preview copy carries data-clear
//    ("linked 2/3" (TASK 749: a Spiral line), "raster 3/22", "cleanup 1/1", "morphed", "loop 1/1" (TASK 750: a closed loop), "wall", "island 1/2"): labels
//    "on line · 6 mm · spiral line 2 of 3", list rows "spiral lines" / "raster passes" / "clean-up ring" / "morphed spiral" / "closed loops" / "wall" / "islands". Display only: the islands and then the clearing paths are
//    painted in FRONT (the wall's white inside-cut fill, written after the paths, would hide them; an island is not moved to the back as other outsides).
//  * TASK 757: a GUIDE (the Stock loop, a Guide) is shown as its outline behind every cut (GUIDE_FILL below): the file's filled board would cover the part.
//  * A tap / click on an element (a press that moves less than 4 px) picks it: a highlight and its label ("pocket · 7.333 mm · step 2 of 4");
//    a tap on empty space clears it. The list (rows by cut type, then depth and step, each with its element count) picks a row's elements.
//  * Pan / zoom are the shared handlers (#ui/input-handlers/pan-zoom.js: wheel, pinch, drag; the same as Prepare). The first build
//    fits; a rebuild (the plan changed) keeps the view, as the 3D view keeps its camera; fit() frames the drawing again.
import { setupPanZoom, updateViewBox } from '#ui/input-handlers/pan-zoom.js';
import { lengthDecimals, lengthFraction, lengthText } from '#core/settings-manager.js';
import { unitInfo } from '#core/units.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPE_TAGS = new Set(['path', 'circle', 'polygon', 'polyline', 'rect', 'ellipse', 'line']);
const TAP_PX = 4;          // a press that moves less than this is a tap (a pick), more is a pan
const SHADE_SHALLOW = 70, SHADE_DEEP = 30; // TASK 719: the pockets' grey lightness (%) at the shallowest / deepest depth of THIS export
const SHADE_OUTSIDE_SHALLOW = 25;           // TASK 719: a stepped outside's terraces: dark grey (25%) at the shallowest step down to the file's black at the deepest
const SHADE_INSIDE_SHALLOW = 90, SHADE_INSIDE_DEEP = 60; // TASK 720: a stepped inside's terraces (the through step stays the file's white)
const OUTSIDE_STEP_OUTLINE = '#9a9a9a';     // their thin light outline (the file's black outside has none, so the ledges would not show)
const POCKET_OUTLINE = '#222';             // the thin outline every pocket gets (the file's pockets have none)
const FIT_MARGIN = 0.06;   // empty space round the drawing on each side after fit(), a fraction of its size
// TASK 757: the preview's one rule for a GUIDE (the Stock loop, a user's Guide): it marks, it never cuts, so it is drawn as its OUTLINE (the file's stroke, no
// fill) BEHIND every cut. The file writes a guide filled (#0068FF fill + stroke, as Shaper Studio writes its guides) and in the plan's order, so the Stock
// (the whole board, written after the outside / inside / on-line cuts) would cover the part. Display only: the download keeps the file's fill and order.
const GUIDE_FILL = 'none';

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

// TASK 743: a paint attribute (fill / stroke) of the element, or of the nearest ancestor that carries it (the <g> the exporter hoisted it to), or null
function paintOf(el, name) {
  for (let e = el; e && e.nodeType === 1 && e.localName !== 'svg'; e = e.parentNode) if (e.hasAttribute(name)) return e.getAttribute(name);
  return null;
}

/** The drawn elements under `root`, in file order: { el, tag, cutType, depth, step: { k, n } | null, hold: { kind: 'pass' | 'skin' | 'gap', k?, n? } | null, op: the operation id (TASK 743, data-op) | null,
 *  clear: TASK 745 { role, k?, n?, pass?, passes? } | null }. */
export function previewItems(root) {
  return [...root.querySelectorAll('*')].filter((el) => SHAPE_TAGS.has(el.localName)).map((el) => {
    const m = /^(\d+)\/(\d+)$/.exec(el.getAttribute('data-step') || '');
    const h = /^(pass|skin)$|^gap (\d+)\/(\d+)$/.exec(el.getAttribute('data-hold') || ''); // TASK 742
    const hold = h ? (h[1] ? { kind: h[1] } : { kind: 'gap', k: Number(h[2]), n: Number(h[3]) }) : null;
    const c = /^(linked|raster|cleanup|island|wall|morphed|loop)(?: (\d+)\/(\d+))?$/.exec(el.getAttribute('data-clear') || ''); // TASK 745 (749: linked, morphed; 750: loop)
    const clear = c ? { role: c[1], ...(c[2] ? { k: Number(c[2]), n: Number(c[3]) } : {}) } : null;
    return { el, tag: el.localName, cutType: cutAttr(el, 'cutType'), depth: cutAttr(el, 'cutDepth'), step: m ? { k: Number(m[1]), n: Number(m[2]) } : null, hold, op: el.getAttribute('data-op') || null, clear };
  });
}
/** TASK 745: a programmed pocket element's words: "spiral line 2 of 3" (TASK 749) | "raster pass 3 of 22" | "clean-up ring" | "morphed spiral" | "closed loop 1 of 2"
 *  (TASK 750) | "wall" | "island 1 of 2"; a list row of them: "spiral lines" | "raster passes" | "clean-up ring" | "morphed spiral" | "closed loops" | "wall" | "islands". */
const CLEAR_ROW = { linked: 'spiral lines', raster: 'raster passes', cleanup: 'clean-up ring', morphed: 'morphed spiral', loop: 'closed loops', wall: 'wall', island: 'islands' };
const CLEAR_PATH_ROLES = new Set(['linked', 'raster', 'cleanup', 'morphed', 'loop']);
function clearText(clear, row = false) {
  if (!clear) return null;
  if (row) return CLEAR_ROW[clear.role];
  const what = clear.role === 'linked' ? `spiral line ${clear.k} of ${clear.n}` : clear.role === 'raster' ? `raster pass ${clear.k} of ${clear.n}` : clear.role === 'cleanup' ? 'clean-up ring'
    : clear.role === 'island' ? `island ${clear.k} of ${clear.n}` : clear.role === 'morphed' ? 'morphed spiral' : clear.role === 'loop' ? `closed loop ${clear.k} of ${clear.n}` : clear.role;
  return what;
}
/** TASK 742: a held element's words: "pass (tabs)" | "onion skin" | "gap 2 of 4" (the element), "gaps" (a list row of them). */
const holdText = (hold, row = false) => (!hold ? null : hold.kind === 'pass' ? 'pass (tabs)' : hold.kind === 'skin' ? 'onion skin' : row ? 'gaps' : `gap ${hold.k} of ${hold.n}`);

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
/** TASK 720: a stepped INSIDE's terraces: light greys (90% shallowest .. 60%) for every step but the deepest, which is the through hole and keeps the file's white. */
export function insideStepShades(items) {
  const list = items.filter((it) => it.cutType === 'inside' && it.step);
  const deepest = Math.max(...list.map((it) => parseFloat(it.depth)).filter(Number.isFinite));
  const { shades, lo, hi } = shadesOf(list.filter((it) => parseFloat(it.depth) < deepest), SHADE_INSIDE_SHALLOW, SHADE_INSIDE_DEEP);
  for (const it of list) if (parseFloat(it.depth) === deepest) shades.set(it.depth, '#FFFFFF');
  return { shades, lo, hi };
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

/**
 * TASK 724: a depth as the file writes it ("0.100 in") shown at the Length precision setting ("0.1 in" at 1); the file's own text while the setting is Auto.
 * TASK 728: the text is the one length-format decider's (lengthText), so an inch document showing fractions reads 1/8". Display only.
 */
export const depthText = (depth) => {
  const m = /^(-?\d+(?:\.\d+)?)\s*(\S*)$/.exec(depth || ''), u = m && unitInfo(m[2] || 'mm');
  if (!m || !u || u.kind !== 'length' || (lengthDecimals(null) === null && !lengthFraction(u.name))) return depth;
  return lengthText(Number(m[1]) * u.f, { unit: u.name, show: m[2] ? 'unit' : 'bare' });
};
/** An element's label: "pocket · 7.333 mm · step 2 of 4" (the depth as the file writes it). */
export const itemLabel = (it) => [it.cutType || 'no cut type', depthText(it.depth) || 'depth unset', it.step ? `step ${it.step.k} of ${it.step.n}` : null, holdText(it.hold), clearText(it.clear)].filter(Boolean).join(' · ');

/**
 * The list: TASK 743: one group per OPERATION of `ops` (operations.js planOperations: their order; { op, count, types, rows }), then one per cut type for the
 * elements of no listed operation ({ op: null, cutType, ... }; all of them when no `ops` is given); in each, one row per cut type + depth + step
 * (+ TASK 742 hold kind) (file order) with its elements.
 */
export function previewRows(items, ops = []) {
  const opById = new Map(ops.map((op) => [op.id, op]));
  const groups = new Map(ops.map((op) => ['op:' + op.id, { op, cutType: null, count: 0, types: new Set(), rows: new Map() }]));
  for (const it of items) {
    const type = it.cutType || 'no cut type';
    const op = it.op ? opById.get(it.op) || null : null;
    const gk = op ? 'op:' + op.id : 'type:' + type;
    if (!groups.has(gk)) groups.set(gk, { op: null, cutType: type, count: 0, types: new Set(), rows: new Map() });
    const g = groups.get(gk);
    g.count++; g.types.add(type);
    const key = `${type}|${it.depth || ''}|${it.step ? it.step.k + '/' + it.step.n : ''}|${it.hold ? it.hold.kind : ''}|${it.clear ? it.clear.role : ''}`; // TASK 742: a held cut's gaps are one row; TASK 745: a programmed pocket's rings at one depth are one row
    if (!g.rows.has(key)) g.rows.set(key, { cutType: type, depth: it.depth, step: it.step, hold: it.hold, clear: it.clear, items: [] });
    g.rows.get(key).items.push(it);
  }
  return [...groups.values()].filter((g) => g.count > 0).map((g) => ({ op: g.op, cutType: g.cutType, count: g.count, types: [...g.types], rows: [...g.rows.values()] }));
}

/**
 * mountExportPreview({ canvas, list, info, getPreview, emptyText }) -> { refresh(sig), fit(), pickRow(i), inspect() }
 *   canvas   the <svg> the file's elements are shown in (its viewBox is the view)
 *   list     the element the cut list is written in
 *   info     the one-line label (the picked element, or the element count; `emptyText` when there is no cut)
 *   getPreview () => { svg: the preview copy of the Shaper SVG, ops: the operations in order (TASK 743) }, or null when no cut is assigned
 */
export function mountExportPreview({ canvas, list, info, getPreview, emptyText }) {
  const doc = canvas.ownerDocument;
  const viewState = { view: null, allowEmptyPan: true, _panZoom: { isPanning: false, lastPanPoint: null, lastTouchDistance: null, touchPoints: new Map(), isPinching: false, lastPinchCenter: null, lastPinchDistance: null } };
  setupPanZoom(canvas, viewState, { attachListeners: true });
  let shading = { shades: new Map(), lo: NaN, hi: NaN }, outsideShading = { shades: new Map() }, insideShading = { shades: new Map() };
  let layer = null, items = [], rows = [], byEl = new Map(), picked = [], pickedLabel = null, lastSig, fitPending = false;
  const rowButtons = [], rowOf = []; // the list's row buttons and the row each one picks (TASK 743: an operation's header is a row of all its elements)

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
    if (row.op) { pick(row.items, `${row.op.label} · ${row.items.length} element${row.items.length === 1 ? '' : 's'}`, i); return; } // TASK 743: an operation
    pick(row.items, itemLabel(row.items[0]) + (row.items.length > 1 ? ` · ${row.items.length} elements` : ''), i);
  }

  const depthKey = (pick) => [...shading.shades.keys()].reduce((a, k) => (pick(parseFloat(k), parseFloat(a)) ? k : a));
  const minDepthKey = () => depthKey((x, y) => x < y);
  const maxDepthKey = () => depthKey((x, y) => x > y);

  function renderList() {
    rowButtons.length = 0; rowOf.length = 0;
    const out = [];
    if (insideShading.shades.size) {
      const lg = doc.createElement('div'); lg.className = 'rv2d-legend';
      lg.textContent = 'inside steps: lighter = shallower, white = through';
      out.push(lg);
    }
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
    let lastTool;
    for (const g of rows) {
      const n = doc.createElement('span'); n.className = 'rv2d-count'; n.textContent = String(g.count);
      if (g.op) { // TASK 743: the tool heading (a run of operations with one bit), then the operation's header: a tap picks every element of it
        if (g.op.heading && g.op.heading !== lastTool) {
          lastTool = g.op.heading;
          const th = doc.createElement('div'); th.className = 'rv2d-tool'; th.textContent = g.op.heading;
          out.push(th);
        }
        const head = doc.createElement('button'); head.type = 'button'; head.className = 'rv2d-op'; head.title = g.op.label; head.dataset.op = g.op.id;
        const name = doc.createElement('span'); name.textContent = [g.op.rowText, g.op.regions, g.op.detail].filter(Boolean).join(' \u00b7 '); // Prepare's row words
        head.append(name, n);
        const i = rowButtons.length, row = { op: g.op, items: g.rows.flatMap((r) => r.items) };
        head.addEventListener('click', () => pickRow(i));
        rowButtons.push(head); rowOf.push(row);
        out.push(head);
      } else {
        lastTool = undefined;
        const head = doc.createElement('div'); head.className = 'rv2d-type';
        const name = doc.createElement('span'); name.textContent = g.cutType;
        head.append(name, n);
        out.push(head);
      }
      for (const row of g.rows) {
        const b = doc.createElement('button'); b.type = 'button'; b.className = 'rv2d-row';
        const t = doc.createElement('span'); t.textContent = [g.types.length > 1 ? row.cutType : null, depthText(row.depth) || 'depth unset', row.step ? `step ${row.step.k} of ${row.step.n}` : null, holdText(row.hold, true), clearText(row.clear, true)].filter(Boolean).join(' · ');
        const c = doc.createElement('span'); c.className = 'rv2d-count'; c.textContent = String(row.items.length);
        const shade = row.cutType === 'pocket' ? shading.shades.get(row.depth) : (row.cutType === 'outside' && row.step ? outsideShading.shades.get(row.depth) : (row.cutType === 'inside' && row.step ? insideShading.shades.get(row.depth) : null));
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
    layer = null; items = []; rows = []; shading = { shades: new Map(), lo: NaN, hi: NaN }; outsideShading = { shades: new Map() }; insideShading = { shades: new Map() }; byEl = new Map(); picked = []; pickedLabel = null;
    const preview = getPreview();
    const text = preview && preview.svg;
    if (text) {
      const root = parseShaperSvg(text, doc);
      layer = doc.createElementNS(SVG_NS, 'g'); layer.setAttribute('class', 'rv2d-doc');
      for (const n of [...root.childNodes]) layer.appendChild(doc.importNode(n, true));
      canvas.appendChild(layer);
      items = previewItems(layer);
      rows = previewRows(items, preview.ops); // TASK 743: the operations, in the user's order
      byEl = new Map(items.map((it) => [it.el, it]));
      // TASK 719: the display's own styling, on the mounted copy only: pockets shaded by depth + outlined (attributes, so the picked class still wins)
      shading = pocketShades(items);
      outsideShading = outsideStepShades(items);
      insideShading = insideStepShades(items);
      for (const it of items) {
        const shade = it.cutType === 'pocket' ? shading.shades.get(it.depth) : null;
        if (shade) { it.el.setAttribute('fill', shade); it.el.setAttribute('stroke', POCKET_OUTLINE); }
        const oShade = it.cutType === 'outside' && it.step ? outsideShading.shades.get(it.depth) : null;
        if (oShade) { it.el.setAttribute('fill', oShade); it.el.setAttribute('stroke', OUTSIDE_STEP_OUTLINE); }
        const iShade = it.cutType === 'inside' && it.step ? insideShading.shades.get(it.depth) : null; // the file's black stroke stays; the file writes the shallow (larger) ring first, so every ring shows
        if (iShade) it.el.setAttribute('fill', iShade);
      }
      // TASK 743: every OUTSIDE element is painted at the BACK, deepest first. The file keeps the plan's order, so an outside cut that comes after the
      // pockets / holes inside it (a plate assigned last, or a plate's own holes hoisted into a <g> written before it: 742's found (1)) would cover them
      // with its black fill; a stepped outside's terraces are nested outlines (a shallow step INSIDE a deeper one, written first: TASK 719), so deepest
      // first shows every ledge. Display only, on the mounted copy: the element keeps the paint it had (copied from the <g> it inherited it from); the
      // picks and the list read `items` (file order), not the DOM order.
      const outs = items.filter((it) => it.cutType === 'outside' && !(it.clear && it.clear.role === 'island')); // TASK 745: a programmed pocket's island goes in front (below)
      if (outs.length) {
        const back = doc.createElementNS(SVG_NS, 'g'); back.setAttribute('class', 'rv2d-back');
        layer.insertBefore(back, layer.firstChild);
        for (const it of [...outs].sort((a, b) => parseFloat(b.depth) - parseFloat(a.depth))) {
          for (const name of ['fill', 'stroke']) { const v = paintOf(it.el, name); if (v !== null && !it.el.hasAttribute(name)) it.el.setAttribute(name, v); }
          back.appendChild(it.el);
        }
      }
      // TASK 757: every GUIDE as its outline (GUIDE_FILL), behind everything: its group goes first, under the outsides' back group above
      const guides = items.filter((it) => it.cutType === 'guide');
      if (guides.length) {
        const gl = doc.createElementNS(SVG_NS, 'g'); gl.setAttribute('class', 'rv2d-guides');
        layer.insertBefore(gl, layer.firstChild);
        for (const it of guides) {
          const stroke = paintOf(it.el, 'stroke'); // the stroke it inherited (copied from its <g>), as the rules above and below keep it
          if (stroke !== null && !it.el.hasAttribute('stroke')) it.el.setAttribute('stroke', stroke);
          it.el.setAttribute('fill', GUIDE_FILL);
          gl.appendChild(it.el);
        }
      }
      // TASK 745: a programmed pocket's islands (outside cuts, black) and then its clearing paths in FRONT of everything (its wall is an inside cut with the
      // file's white fill: the paths written before it and the islands moved back by the rule above would be hidden); display only, the element keeps the
      // paint it inherited (copied from its <g>)
      const front = [...items.filter((it) => it.clear && it.clear.role === 'island'), ...items.filter((it) => it.clear && CLEAR_PATH_ROLES.has(it.clear.role))];
      if (front.length) {
        const top = doc.createElementNS(SVG_NS, 'g'); top.setAttribute('class', 'rv2d-front');
        layer.appendChild(top);
        for (const it of front) {
          for (const name of ['fill', 'stroke']) { const v = paintOf(it.el, name); if (v !== null && !it.el.hasAttribute(name)) it.el.setAttribute(name, v); }
          top.appendChild(it.el);
        }
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
      rows: rows.map((g) => ({ ...(g.op ? { op: g.op.id, label: g.op.label, heading: g.op.heading } : { cutType: g.cutType }), count: g.count, rows: g.rows.map((r) => ({ cutType: r.cutType, depth: r.depth, step: r.step ? `${r.step.k}/${r.step.n}` : null, ...(r.hold ? { hold: r.hold.kind } : {}), ...(r.clear ? { clear: r.clear.role } : {}), count: r.items.length })) })),
      picked: picked.length, label: info.textContent, view: viewState.view ? { ...viewState.view } : null,
    };
  }
  return { refresh, fit, pickRow, inspect };
}
