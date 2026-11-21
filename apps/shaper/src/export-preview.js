// apps/shaper/src/export-preview.js — TASK 718: the Export step's 2D view = the Shaper SVG the user downloads, SHOWN (not drawn again): the
// string the page's generateShaperSvgPayload builds (export-payload.js shaperSvgOf, the preview copy) is parsed and its elements are put on a
// pan / zoom canvas unchanged (their fill / stroke / shaper:* attributes are the file's: outside black fill, inside white fill + black stroke,
// pocket grey, online / guide strokes). There is no second renderer of cuts: what a cut looks like here is what the file says.
//  * Each element's cut type and depth are read from its OWN shaper:* attributes (TASK 802: the exporter writes every attribute on each
//    element, never on a <g>: the Origin reads them from the element). A stepped cut's "step k of N" cannot be read from the file (two cuts' steps at the same
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
//  * TASK 793: the PATHS mode (the third Export view, the toolbar's "Paths"; setMode('paths')): the SAME parsed file, each element drawn as a plain stroke (no
//    fill) in its cut type's colour (CSS .rv2d-t-<cutType>, index.html), so every path the file writes shows; over it the BIT-CENTRE path of every cut
//    (`getPreview().bitPaths`, export-payload.js bitCentrePaths = deriveCutFootprint + deriveCutTravel, the derivation Prepare draws): a thin dashed line for
//    the cuts whose written path is the wall / outline the bit walks beside (outside, inside, a pocket's wall and islands); a programmed pocket's clearing
//    lines and tab strokes ARE their own bit path (the file writes the centre), so only their direction marks are
//    added. Direction marks on every travel path: 777's sparse slow marching dashes (the one TRAVEL_STYLE, prepare-view.js) + static zoom-stable darts.
//    A tap on a bit-centre line picks its element, as a tap on the element does.
//  * Pan / zoom are the shared handlers (#ui/input-handlers/pan-zoom.js: wheel, pinch, drag; the same as Prepare). The first build
//    fits; a rebuild (the plan changed) keeps the view, as the 3D view keeps its camera; fit() frames the drawing again.
import { setupPanZoom, updateViewBox } from '#ui/input-handlers/pan-zoom.js';
import { lengthText } from '#core/settings-manager.js';
import { unitInfo } from '#core/units.js';
import { arrowsAlongPath } from '#core/profile-model.js';
import { exportForm } from '#core/origin-rules.js'; // TASK 803: the attribute prefix and where a cut attribute lives (the element itself) are the Origin rules'
import { TRAVEL_STYLE, TRAVEL_ARROW_SPACING_PX, DART_DIMS, dartSeg, applyTravelStyle } from './prepare-view.js'; // TASK 793: the ONE travel declaration + dart geometry

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPE_TAGS = new Set(['path', 'circle', 'polygon', 'polyline', 'rect', 'ellipse', 'line']);
const PROBE_PX = 7;        // TASK 793: the Paths mode's tap tolerance, screen px
const TAP_PX = 4;          // a press that moves less than this is a tap (a pick), more is a pan
const SHADE_SHALLOW = 70, SHADE_DEEP = 30; // TASK 719: the pockets' grey lightness (%) at the shallowest / deepest depth of THIS export
const SHADE_OUTSIDE_SHALLOW = 25;           // TASK 719: a stepped outside's terraces: dark grey (25%) at the shallowest step down to the file's black at the deepest
const SHADE_INSIDE_SHALLOW = 90, SHADE_INSIDE_DEEP = 60; // TASK 720: a stepped inside's terraces (the through step stays the file's white)
const OUTSIDE_STEP_OUTLINE = '#9a9a9a';     // their thin light outline (the file's black outside has none, so the ledges would not show)
const POCKET_OUTLINE = '#222';             // the thin outline every pocket gets (the file's pockets have none)
const BIT_ONLY_ROLES = new Set(['outside', 'inside', 'wall', 'island']); // TASK 793: travel roles whose bit-centre path is NOT the written path (the others are written: their marks only)
const CLEAR_KIND_ROLES = new Set(['linked', 'raster', 'cleanup', 'morphed', 'loop']);  // the dart size kinds of Prepare (prepare-view.js addTravel)
const dartKind = (role) => (role === 'stroke' ? 'online' : CLEAR_KIND_ROLES.has(role) ? 'clear' : 'wall');
const FIT_MARGIN = 0.06;   // empty space round the drawing on each side after fit(), a fraction of its size
// TASK 757: the preview's one rule for a GUIDE (the Stock loop, a user's Guide): it marks, it never cuts, so it is drawn as its OUTLINE (the file's stroke, no
// fill) BEHIND every cut. The file writes a guide filled (#0068FF fill + stroke, as Shaper Studio writes its guides); a user's Guide in the plan's order (TASK 774:
// the Stock, the whole board, is written FIRST: shaper.js `exportFirst`). Display only: the download keeps the file's fill and order.
const GUIDE_FILL = 'none';

/** Parse a Shaper SVG string into its root <svg> element (an XML parse: the shaper: namespace is kept). A string that does not parse throws. */
export function parseShaperSvg(text, doc = document) {
  const xml = new doc.defaultView.DOMParser().parseFromString(text, 'image/svg+xml');
  const root = xml.documentElement;
  if (!root || root.localName !== 'svg' || xml.getElementsByTagName('parsererror').length) throw new Error('the Shaper SVG does not parse');
  return root;
}

// a cut attribute of the element (TASK 802: always its own, never a parent <g>'s); read by its qualified name as the exporter writes it
// (shaper:cutType ...), which the browser and the node tests' DOM (happy-dom: no attribute namespaces) both match
function cutAttr(el, name) {
  return el.getAttribute(exportForm('attrPrefix') + name) || null;
}

// TASK 743: a paint attribute (fill / stroke) of the element (TASK 802: its own), or null
function paintOf(el, name) {
  return el.hasAttribute(name) ? el.getAttribute(name) : null;
}

/** The drawn elements under `root`, in file order: { el, tag, cutType, depth, step: { k, n } | null, hold: { kind: 'pass' | 'skin' | 'gap' | 'stroke' (TASK 775: an On line
 *  cut's tabs), k?, n? } | null, op: the operation id (TASK 743, data-op) | null, clear: TASK 745 { role, k?, n?, pass?, passes? } | null }. */
export function previewItems(root) {
  return [...root.querySelectorAll('*')].filter((el) => SHAPE_TAGS.has(el.localName)).map((el) => {
    const m = /^(\d+)\/(\d+)$/.exec(el.getAttribute('data-step') || '');
    const h = /^(pass|skin)$|^(gap|stroke) (\d+)\/(\d+)$/.exec(el.getAttribute('data-hold') || ''); // TASK 742; TASK 775: stroke k/N
    const hold = h ? (h[1] ? { kind: h[1] } : { kind: h[2], k: Number(h[3]), n: Number(h[4]) }) : null;
    const c = /^(linked|raster|cleanup|island|wall|morphed|loop|start)(?: (\d+)\/(\d+))?$/.exec(el.getAttribute('data-clear') || ''); // TASK 745 (749: linked, morphed; 750: loop; 778: start mark)
    const clear = c ? { role: c[1], ...(c[2] ? { k: Number(c[2]), n: Number(c[3]) } : {}) } : null;
    return { el, tag: el.localName, cutType: cutAttr(el, 'cutType'), depth: cutAttr(el, 'cutDepth'), step: m ? { k: Number(m[1]), n: Number(m[2]) } : null, hold, op: el.getAttribute('data-op') || null, clear };
  });
}
/** TASK 745: a programmed pocket element's words: "spiral line 2 of 3" (TASK 749) | "raster pass 3 of 22" | "clean-up ring" | "morphed spiral" | "closed loop 1 of 2"
 *  (TASK 750) | "wall" | "island 1 of 2" | "start mark" (TASK 778); a list row of them: "spiral lines" | "raster passes" | "clean-up ring" |
 *  "morphed spiral" | "closed loops" | "wall" | "islands" | "start mark". */
const CLEAR_ROW = { linked: 'spiral lines', raster: 'raster passes', cleanup: 'clean-up ring', morphed: 'morphed spiral', loop: 'closed loops', wall: 'wall', island: 'islands', start: 'start mark' };
const CLEAR_PATH_ROLES = new Set(['linked', 'raster', 'cleanup', 'morphed', 'loop']);
function clearText(clear, row = false) {
  if (!clear) return null;
  if (row) return CLEAR_ROW[clear.role];
  const what = clear.role === 'linked' ? `spiral line ${clear.k} of ${clear.n}` : clear.role === 'raster' ? `raster pass ${clear.k} of ${clear.n}` : clear.role === 'cleanup' ? 'clean-up ring'
    : clear.role === 'island' ? `island ${clear.k} of ${clear.n}` : clear.role === 'morphed' ? 'morphed spiral' : clear.role === 'loop' ? `closed loop ${clear.k} of ${clear.n}` : clear.role === 'start' ? 'start mark' : clear.role;
  return what;
}
/** TASK 742: a held element's words: "pass (tabs)" | "onion skin" | "gap 2 of 4" (the element), "gaps" (a list row of them); TASK 775: an On line cut's tabs:
 *  "stroke 2 of 3 (tabs)", "strokes (tabs)". */
const holdText = (hold, row = false) => (!hold ? null : hold.kind === 'pass' ? 'pass (tabs)' : hold.kind === 'skin' ? 'onion skin'
  : hold.kind === 'stroke' ? (row ? 'strokes (tabs)' : `stroke ${hold.k} of ${hold.n} (tabs)`) : row ? 'gaps' : `gap ${hold.k} of ${hold.n}`);

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
 * TASK 724 / 770: a depth as the file writes it ("0.100 in") shown through the one formatter (lengthText: default 3 decimals, trailing zeros
 * hidden unless TRAILING_ZEROS is ON, or 1/8" in Fractional). Display only.
 */
export const depthText = (depth) => {
  const m = /^(-?\d+(?:\.\d+)?)\s*(\S*)$/.exec(depth || ''), u = m && unitInfo(m[2] || 'mm');
  if (!m || !u || u.kind !== 'length') return depth;
  return lengthText(Number(m[1]) * u.f, { unit: u.name, show: m[2] ? 'unit' : 'bare' });
};
/** An element's label: "pocket · 7.333 mm · step 2 of 4" (the depth as the file writes it). */
export const itemLabel = (it) => [it.cutType || 'no cut type', depthText(it.depth) || 'depth unset', it.step ? `step ${it.step.k} of ${it.step.n}` : null, holdText(it.hold), clearText(it.clear, false)].filter(Boolean).join(' · ');

/**
 * The list: TASK 743: one group per OPERATION of `ops` (operations.js describeOperations: their order; { op, count, types, rows }), then one per cut type for the
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
  let mode = '2d';           // TASK 793: '2d' (the file as the Origin fills it) | 'paths' (every written path as a stroke + the bit-centre paths)
  let top = null, travels = [], arrowLayer = null, lastK = null; // TASK 793: the group holding layer + overlay, the travel paths to mark, the darts' <g>, the zoom they were drawn at
  applyTravelStyle(canvas);
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
    const b = top.getBBox();
    const r = canvas.getBoundingClientRect();
    const aspect = r.width / r.height;
    const m = Math.max(b.width, b.height) * FIT_MARGIN;
    const w = Math.max(b.width + 2 * m, (b.height + 2 * m) * aspect, 1);
    viewState.view = { x: b.x + b.width / 2, y: b.y + b.height / 2, w, h: w / aspect };
    updateViewBox(canvas, viewState.view);
    renderArrows();
  }
  new ResizeObserver(() => {
    if (!sized()) return;
    if (fitPending) fit();
    else if (viewState.view) { updateViewBox(canvas, viewState.view); renderArrows(); } // keep the scale, follow the new aspect
  }).observe(canvas);

  let shownLabel = '';
  function showInfo() {
    shownLabel = !items.length ? emptyText : pickedLabel || `${items.length} element${items.length === 1 ? '' : 's'} · tap one to see its cut`;
    if (mode !== 'paths' || !items.length) { info.textContent = shownLabel; return; }
    // TASK 793: the Paths view's legend (a written path / the bit centre), under the line
    const label = doc.createElement('div'); label.textContent = shownLabel;
    const legend = doc.createElement('div'); legend.className = 'rv2d-paths-legend';
    for (const [cls, text] of [['rv2d-leg-line', 'written path'], ['rv2d-leg-bit', 'bit centre (arrows: travel)']]) {
      const item = doc.createElement('span'); item.className = 'rv2d-leg-item';
      const sw = doc.createElement('span'); sw.className = cls;
      const tx = doc.createElement('span'); tx.textContent = text;
      item.append(sw, tx); legend.append(item);
    }
    info.replaceChildren(label, legend);
  }
  function pick(its, label, rowIndex = -1) {
    for (const it of picked) { it.el.classList.remove('rv2d-picked'); for (const b of it.bits || []) b.classList.remove('rv2d-bit-picked'); }
    picked = its;
    for (const it of picked) { it.el.classList.add('rv2d-picked'); for (const b of it.bits || []) b.classList.add('rv2d-bit-picked'); }
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

  const pointsD = (pts, closed) => `M ${pts.map((q) => `${+q.x.toFixed(4)} ${+q.y.toFixed(4)}`).join(' L ')}${closed ? ' Z' : ''}`;
  /** TASK 793: the Paths mode of the mounted copy: every element a plain stroke (class rv2d-path rv2d-t-<cut type>: CSS, index.html), then the overlay of
   *  `bitPaths` ([{ index (the element's place in the file), travel }], export-payload.js bitCentrePaths). */
  function buildPaths(bitPaths) {
    for (const it of items) it.el.setAttribute('class', `rv2d-path rv2d-t-${it.cutType || 'none'}`);
    const overlay = doc.createElementNS(SVG_NS, 'g'); overlay.setAttribute('class', 'rv2d-paths-overlay');
    top.appendChild(overlay);
    let marchD = '';
    for (const { index, travel } of bitPaths) {
      const it = items[index];
      if (!it) throw new Error(`the Paths view: the file has no element ${index} (it has ${items.length})`);
      it.bits = [];
      for (const t of travel) {
        const d = pointsD(t.path, t.closed);
        marchD += d + ' ';
        travels.push({ t, kind: dartKind(t.role) });
        if (!BIT_ONLY_ROLES.has(t.role)) continue; // the written path is the bit's own: marks only
        const bit = doc.createElementNS(SVG_NS, 'path'); bit.setAttribute('class', 'rv2d-bit-center'); bit.setAttribute('d', d);
        overlay.appendChild(bit); it.bits.push(bit); byEl.set(bit, it);
      }
    }
    if (marchD) { const m = doc.createElementNS(SVG_NS, 'path'); m.setAttribute('class', 'sk-travel rv2d-travel'); m.setAttribute('d', marchD); overlay.appendChild(m); }
    arrowLayer = doc.createElementNS(SVG_NS, 'g'); overlay.appendChild(arrowLayer);
  }
  /** The darts (Prepare's: zoom-stable screen size, one <path> per size kind), redrawn when the zoom changed. */
  function renderArrows(force = false) {
    if (!arrowLayer || !viewState.view) return;
    const r = canvas.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const k = viewState.view.w / r.width; // world units per screen px
    if (!force && lastK !== null && Math.abs(k - lastK) < 1e-9 * Math.max(1, k)) return;
    lastK = k;
    const spacing = k * TRAVEL_ARROW_SPACING_PX, minLen = k * TRAVEL_STYLE.arrowMinPathPx;
    const dByKind = { clear: '', wall: '', online: '' };
    let n = 0;
    for (const { t, kind } of travels) for (const a of arrowsAlongPath(t.path, t.closed, { spacing, minLen })) { dByKind[kind] += dartSeg(a, DART_DIMS[kind], k); n++; }
    arrowCount = n;
    const out = [];
    for (const kind of ['clear', 'wall', 'online']) {
      if (!dByKind[kind]) continue;
      const el = doc.createElementNS(SVG_NS, 'path'); el.setAttribute('class', `sk-travel-arrows${kind === 'clear' ? ' sk-travel-arrows-clear' : kind === 'online' ? ' sk-travel-arrows-online' : ''}`); el.setAttribute('d', dByKind[kind]);
      out.push(el);
    }
    arrowLayer.replaceChildren(...out);
  }
  let arrowCount = 0;
  const onZoom = () => renderArrows();
  canvas.addEventListener('wheel', onZoom); canvas.addEventListener('pointermove', onZoom);

  /** Show the plan's file again unless `sig` (the Review's signature of the plan) is the one shown. Returns inspect(). */
  function refresh(sig) {
    if (sig !== undefined && sig === lastSig) { if (fitPending) fit(); return inspect(); }
    lastSig = sig;
    if (top) top.remove();
    top = null; travels = []; arrowLayer = null; lastK = null;
    layer = null; items = []; rows = []; shading = { shades: new Map(), lo: NaN, hi: NaN }; outsideShading = { shades: new Map() }; insideShading = { shades: new Map() }; byEl = new Map(); picked = []; pickedLabel = null;
    const preview = getPreview();
    const text = preview && preview.svg;
    if (text) {
      const root = parseShaperSvg(text, doc);
      layer = doc.createElementNS(SVG_NS, 'g'); layer.setAttribute('class', 'rv2d-doc');
      for (const n of [...root.childNodes]) layer.appendChild(doc.importNode(n, true));
      top = doc.createElementNS(SVG_NS, 'g'); top.appendChild(layer);
      canvas.appendChild(top);
      items = previewItems(layer);
      rows = previewRows(items, preview.ops); // TASK 743: the operations, in the user's order
      byEl = new Map(items.map((it) => [it.el, it]));
    }
    if (text && mode === 'paths') {
      buildPaths(preview.bitPaths || []);
    } else if (text) {
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
      // first shows every ledge. Display only, on the mounted copy: the element keeps the paint it had (its own); the
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
      // TASK 778: a pocket start mark (data-clear="start") is a guide painted in FRONT of the pocket's wall fill so the blue target stays visible
      const guides = items.filter((it) => it.cutType === 'guide' && !(it.clear && it.clear.role === 'start'));
      if (guides.length) {
        const gl = doc.createElementNS(SVG_NS, 'g'); gl.setAttribute('class', 'rv2d-guides');
        layer.insertBefore(gl, layer.firstChild);
        for (const it of guides) {
          const stroke = paintOf(it.el, 'stroke'); // its stroke, as the rules above and below keep it
          if (stroke !== null && !it.el.hasAttribute('stroke')) it.el.setAttribute('stroke', stroke);
          it.el.setAttribute('fill', GUIDE_FILL);
          gl.appendChild(it.el);
        }
      }
      // TASK 745: a programmed pocket's islands (outside cuts, black) and then its clearing paths in FRONT of everything (its wall is an inside cut with the
      // file's white fill: the paths written before it and the islands moved back by the rule above would be hidden); display only, the element keeps the
      // paint it has. TASK 778: the pocket start mark sits on top (TASK 786: the file itself writes it fill="none", stroke-only).
      const front = [...items.filter((it) => it.clear && it.clear.role === 'island'), ...items.filter((it) => it.clear && CLEAR_PATH_ROLES.has(it.clear.role)), ...items.filter((it) => it.clear && it.clear.role === 'start')];
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
    else renderArrows(true);
    return inspect();
  }

  // TASK 793: a stroke is thin: in the Paths mode a tap that missed every line takes the nearest one within PROBE_PX (four probes round the point)
  const probe = (x, y) => {
    if (mode !== 'paths' || !doc.elementFromPoint) return null;
    for (const [dx, dy] of [[PROBE_PX, 0], [-PROBE_PX, 0], [0, PROBE_PX], [0, -PROBE_PX]]) { const it = byEl.get(doc.elementFromPoint(x + dx, y + dy)); if (it) return it; }
    return null;
  };
  // a tap picks the element under it (the target of the press: a pan captures the pointer, so the release lands on the canvas)
  let press = null, pointers = 0;
  canvas.addEventListener('pointerdown', (e) => {
    pointers++;
    press = pointers === 1 && (e.button == null || e.button === 0) ? { x: e.clientX, y: e.clientY, item: byEl.get(e.target) || probe(e.clientX, e.clientY) } : null;
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
      picked: picked.length, label: mode === 'paths' ? shownLabel : info.textContent, view: viewState.view ? { ...viewState.view } : null,
      ...(mode === 'paths' ? { mode, bitCentre: top ? top.querySelectorAll('.rv2d-bit-center').length : 0, travelPaths: travels.length, darts: arrowCount } : {}),
    };
  }
  /** TASK 793: '2d' | 'paths'. A change rebuilds the view at the next refresh (the same file, drawn the other way). */
  function setMode(next) {
    if (next !== '2d' && next !== 'paths') throw new Error(`export preview: no mode ${next}`);
    if (next === mode) return;
    mode = next; lastSig = undefined;
    canvas.parentNode.setAttribute('data-mode', mode);
  }
  return { refresh, fit, pickRow, inspect, setMode };
}
