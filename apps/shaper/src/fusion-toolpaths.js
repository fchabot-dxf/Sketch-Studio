// apps/shaper/src/fusion-toolpaths.js — TASK 799 (SA-13): Automatic live toolpaths in Fusion 360.
//
// Contract (matching D:/APPS/shaper-addin/docs/SELECTION-BRIDGE.md §6 and fusion-bridge.js):
//   Palette -> Add-in:
//     { action: 'toolpaths', revision, frame, paths: [{ op, cutType, toolDia, clearing?, role, z, points: [[x, y], ...], closed }] }
//     { action: 'toolpaths_clear' }
//     - toolDia (mm): operation bit diameter (same value encoded as shaper:toolDia).
//     - clearing: 'freehand' | 'linked' | 'raster' | 'morphed' on pocket paths; omitted on non-pocket cuts.
//     - role: 'wall' | 'island' | 'clearing' | 'cleanup' | 'loop' | 'outline' | 'start' (pocket start marks, walls, islands, clearing/level passes, loops, or outlines).
//
// Frame & coordinate convention:
//   - Sketch-Studio #core world coordinates are in mm with Y-down.
//   - Fusion bridge messages are ALWAYS in mm with Y-up (`y_fusion = -y_palette`), matching `selection_data`.
//   - `frame` is the selection's 3D frame from `selection_data.frame` (`{ units: 'mm', yAxis: 'up', originMm, uAxis, vAxis,
//     normal, topHeightMm }`), where `originMm` lies on the part's top plane (`z = 0` mm) and each path's `z` is the
//     cut depth in mm from the part's top (`z >= 0`, going into the part along `-normal`).
//   - TASK 891 (add-in SA-36): a region may carry its OWN frame (a body of a several-body selection: each body is read in its own frame, its own top =
//     depth 0); a path is in its region's frame, else its selection's, and carries it as `frame` when that is not the message's (`frameByKeyMap`).
//   - One decimation tolerance (`TOOLPATH_DECIMATE_TOL_MM = 0.05` mm) and one debounce (`TOOLPATHS_DEBOUNCE_MS = 300` ms)
//     are declared once here.

import { simplifyPath, POCKET_CLEARING, clearingPattern } from '#core/pocket-clearing.js';
import { planMemberItems, pathsCtx, pathsInputOf, pathsSigOf } from './cut-plan.js';
import { lookup as lookupPaths, resultOf, isOutOfDate, staleOf, isGenerating } from './op-paths.js';
import { STOCK_TYPE_ID } from './shaper.js';
import { FUSION_ACTIONS } from './fusion-bridge.js';

export const TOOLPATHS_DEBOUNCE_MS = 300;
export const TOOLPATH_DECIMATE_TOL_MM = 0.05;
export const TOOLPATH_COORD_PRECISION = 3;

export const DEFAULT_FUSION_FRAME = Object.freeze({
  units: 'mm',
  yAxis: 'up',
  originMm: [0, 0, 0],
  uAxis: [1, 0, 0],
  vAxis: [0, 1, 0],
  normal: [0, 0, 1],
  topHeightMm: 0,
});

const rCoord = (n) => {
  const f = 10 ** TOOLPATH_COORD_PRECISION;
  const v = Math.round(Number(n) * f) / f;
  return v === 0 ? 0 : v;
};

const toXY = (p) => (Array.isArray(p) ? { x: Number(p[0]), y: Number(p[1]) } : { x: Number(p.x), y: Number(p.y) });

function distPointToSeg(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function simplifyClosedRing(pts, tol) {
  const n = pts.length;
  if (n <= 3) return pts.slice();
  let far = 0;
  let maxD2 = -1;
  for (let i = 1; i < n; i++) {
    const dx = pts[i].x - pts[0].x;
    const dy = pts[i].y - pts[0].y;
    const d2 = dx * dx + dy * dy;
    if (d2 > maxD2) {
      maxD2 = d2;
      far = i;
    }
  }
  if (far === 0) return pts.slice(0, 1);
  const firstHalf = simplifyPath(pts.slice(0, far + 1), tol);
  const secondHalf = simplifyPath([...pts.slice(far), pts[0]], tol);
  const out = [...firstHalf, ...secondHalf.slice(1, -1)];
  if (out.length === 2 && n >= 3) {
    let bestIdx = -1;
    let bestD = -1;
    for (let i = 1; i < n; i++) {
      if (i === far) continue;
      const d = distPointToSeg(pts[i], pts[0], pts[far]);
      if (d > bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    if (bestIdx > 0) {
      if (bestIdx < far) return [pts[0], pts[bestIdx], pts[far]];
      return [pts[0], pts[far], pts[bestIdx]];
    }
  }
  return out;
}

/**
 * Decimate a polyline (`{x,y}[]` or `[x,y][]` in Sketch-Studio Y-down world mm) within `tol` mm
 * and convert to Fusion's Y-up 2D plane `[[x_mm, -y_mm], ...]`.
 */
export function decimateToolpathPoints(rawPoints, closed = false, tol = TOOLPATH_DECIMATE_TOL_MM) {
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) return [];
  let pts = rawPoints.map(toXY).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (closed && pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) <= 1e-6) pts = pts.slice(0, -1);
  }
  const minPts = closed ? 3 : 2;
  if (pts.length < minPts) return [];

  const simplified = tol > 0
    ? (closed ? simplifyClosedRing(pts, tol) : simplifyPath(pts, tol))
    : pts;
  if (simplified.length < minPts) return [];

  const out = [];
  for (const p of simplified) {
    const x = rCoord(p.x);
    const y = rCoord(-p.y); // Sketch-Studio Y-down -> Fusion Y-up
    const prev = out[out.length - 1];
    if (prev && prev[0] === x && prev[1] === y) continue;
    out.push([x, y]);
  }
  if (closed && out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (last[0] === first[0] && last[1] === first[1]) out.pop();
  }
  return out.length >= minPts ? out : [];
}

function normalizeFrame(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FUSION_FRAME };
  const vec3 = (v, fallback) => (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n)))
    ? v.map(Number)
    : [...fallback]);
  const originMm = vec3(raw.originMm, DEFAULT_FUSION_FRAME.originMm);
  const uAxis = vec3(raw.uAxis, DEFAULT_FUSION_FRAME.uAxis);
  const vAxis = vec3(raw.vAxis, DEFAULT_FUSION_FRAME.vAxis);
  const normal = vec3(raw.normal, DEFAULT_FUSION_FRAME.normal);
  const topHeightMm = Number.isFinite(Number(raw.topHeightMm))
    ? Number(raw.topHeightMm)
    : originMm[0] * normal[0] + originMm[1] * normal[1] + originMm[2] * normal[2];
  return { units: 'mm', yAxis: 'up', originMm, uAxis, vAxis, normal, topHeightMm };
}

function frameByKeyMap(selections) {
  const byKey = new Map();
  let topFrame = null;
  for (const sel of selections || []) {
    if (!sel || !sel.frame) continue;
    const f = normalizeFrame(sel.frame);
    if (!topFrame) topFrame = f;
    const own = sel.frames || {};
    for (const k of sel.cutKeys || []) byKey.set(k, own[k] ? normalizeFrame(own[k]) : f);
  }
  return { topFrame: topFrame || normalizeFrame(null), byKey };
}

function pathDepthMm(fp, rec) {
  const raw = fp.terrace
    ? fp.terrace.depth
    : (fp.hold && fp.hold.depth != null ? fp.hold.depth : rec && rec.cutDepth);
  if (raw == null || raw === 'unset') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? rCoord(n) : 0;
}

function pathCutType(fp, opType) {
  if (opType === 'roughing' || opType === 'contour' || opType === 'pocket') return opType;
  return String((fp && fp.cutType) || opType || 'online');
}

function pathToolDia(derivedRec, opRec) {
  const raw = (derivedRec && derivedRec.toolDia != null) ? derivedRec.toolDia : (opRec && opRec.toolDia);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function pathClearing(rec, fp) {
  if (!rec || rec.cutType !== 'pocket') return undefined;
  if (fp && fp.clearing && fp.clearing.role === 'refused') return 'freehand';
  return clearingPattern(rec);
}

const CLEARING_ROLES = new Set(['wall', 'island', 'cleanup', 'loop', 'start']);
const CLEARING_PASS_ROLES = new Set(['linked', 'raster', 'morphed']);

function pathRole(fp, tpIdx, cutType) {
  const r = fp && fp.clearing && fp.clearing.role;
  if (CLEARING_ROLES.has(r)) return r;
  if (CLEARING_PASS_ROLES.has(r)) return 'clearing';
  if (fp && fp.kind === 'pocket') return fp.wall && tpIdx === 0 ? 'wall' : 'island';
  if (cutType === 'roughing' || cutType === 'contour') return 'clearing';
  return 'outline';
}

/**
 * Extract decimated 2D toolpaths (Fusion Y-up mm) and real Z depths from derived footprints.
 * Pure function so both the app and unit tests can verify exact payloads.
 */
export function buildToolpathsPayload({
  items,
  derivedOf,
  selections = [],
  tolMm = TOOLPATH_DECIMATE_TOL_MM,
}) {
  const { topFrame, byKey } = frameByKeyMap(selections);
  const topFrameJson = JSON.stringify(topFrame);
  const paths = [];

  for (const it of items || []) {
    const rec = it && it.rec;
    if (!rec || !rec.cutType || rec.cutType === STOCK_TYPE_ID || rec.cutType === 'guide') continue;
    const derived = derivedOf(it);
    if (!derived || !Array.isArray(derived.footprints)) continue;

    const itemFrame = byKey.get(it.key);
    const frameOverride = itemFrame && JSON.stringify(itemFrame) !== topFrameJson ? itemFrame : null;
    const toolDia = pathToolDia(derived.rec, rec);

    for (const fp of derived.footprints) {
      if (!fp) continue;
      const z = pathDepthMm(fp, derived.rec);
      const clearing = pathClearing(rec, fp);

      if (fp.clearing && fp.clearing.role === 'start' && fp.clearing.point) {
        const arm = (Number(fp.clearing.dia) || (toolDia || 3.175) * POCKET_CLEARING.startMarkDiaMult) / 2;
        const cx = fp.clearing.point.x;
        const cy = fp.clearing.point.y;
        for (const seg of [
          [{ x: cx - arm, y: cy }, { x: cx + arm, y: cy }],
          [{ x: cx, y: cy - arm }, { x: cx, y: cy + arm }],
        ]) {
          const pts = decimateToolpathPoints(seg, false, 0);
          if (pts.length >= 2) {
            paths.push({
              op: it.opId,
              cutType: 'guide',
              toolDia,
              ...(clearing !== undefined ? { clearing } : {}),
              role: 'start',
              z,
              points: pts,
              closed: false,
              ...(frameOverride ? { frame: frameOverride } : {}),
            });
          }
        }
        continue;
      }

      if (fp.kind === 'guide') continue;
      const cutType = pathCutType(fp, rec.cutType);

      for (let tpIdx = 0; tpIdx < (fp.toolPaths || []).length; tpIdx++) {
        const tp = fp.toolPaths[tpIdx];
        if (!tp || !Array.isArray(tp.points)) continue;
        const closed = Boolean(tp.closed);
        const points = decimateToolpathPoints(tp.points, closed, tolMm);
        if (points.length < (closed ? 3 : 2)) continue;
        paths.push({
          op: it.opId,
          cutType,
          toolDia,
          ...(clearing !== undefined ? { clearing } : {}),
          role: pathRole(fp, tpIdx, cutType),
          z,
          points,
          closed,
          ...(frameOverride ? { frame: frameOverride } : {}),
        });
      }
    }
  }

  return { frame: topFrame, paths };
}

/**
 * Debounced controller that watches Prepare's ticked operations and automatically pushes
 * `{ action: 'toolpaths', revision, frame, paths }` or `{ action: 'toolpaths_clear' }` to Fusion.
 */
export function createFusionToolpathsSync({
  bridge,
  getState,
  getOpenOpId = () => null,
  getSelections = () => [],
  onSpin = () => {},
  debounceMs = TOOLPATHS_DEBOUNCE_MS,
  tolMm = TOOLPATH_DECIMATE_TOL_MM,
  globalTarget = (typeof window !== 'undefined' ? window : null),
}) {
  const useTargetTimers = globalTarget
    && typeof globalTarget.setTimeout === 'function'
    && typeof globalTarget.clearTimeout === 'function';
  const setT = useTargetTimers ? globalTarget.setTimeout.bind(globalTarget) : setTimeout;
  const clearT = useTargetTimers ? globalTarget.clearTimeout.bind(globalTarget) : clearTimeout;

  let timer = null;
  let revision = 0;
  let lastSentBody = null;
  let hasSentPaths = false;
  let dirty = false;
  let sendingSeq = 0;
  const lastByItem = new Map(); // membership id -> last non-pending derived { rec, cuts, footprints }

  const activeTickedItems = () => planMemberItems({ ticked: true }).filter(
    (it) => it && it.rec && it.rec.cutType && it.rec.cutType !== STOCK_TYPE_ID && it.rec.cutType !== 'guide',
  );

  function evaluateNow() {
    const st = getState();
    const items = activeTickedItems();
    if (!st || !items.length) {
      lastByItem.clear();
      return { pending: false, frame: normalizeFrame(getSelections().find((s) => s && s.frame)?.frame), paths: [] };
    }
    const ctx = pathsCtx(st);
    const openOpId = getOpenOpId();
    let pending = false;

    const derivedByItem = new Map();
    for (const it of items) {
      const input = pathsInputOf(it.planKey, it.rec);
      if (!input) continue;
      const sig = pathsSigOf(it.planKey, it.rec, ctx);
      const isOpenOp = Boolean(openOpId && it.opId === openOpId);
      const hit = lookupPaths(ctx, input.target, input.rec, { request: !isOpenOp, opId: it.opId, item: it.id });
      if (hit !== undefined) {
        if (hit && hit.paths) {
          lastByItem.set(it.id, hit.paths);
          derivedByItem.set(it.id, hit.paths);
        } else {
          lastByItem.delete(it.id);
        }
        continue;
      }
      if (isOpenOp) {
        if (lastByItem.has(it.id)) derivedByItem.set(it.id, lastByItem.get(it.id));
        continue;
      }
      if (isOutOfDate(ctx, input.target, input.rec, it.id, it.opId)) {
        const oldSig = staleOf(it.id);
        const oldHit = oldSig ? resultOf(oldSig) : undefined;
        if (oldHit && oldHit.paths) derivedByItem.set(it.id, oldHit.paths);
        continue;
      }
      if (sig && isGenerating(sig)) pending = true;
      else pending = true;
    }

    const activeIds = new Set(items.map((it) => it.id));
    for (const k of [...lastByItem.keys()]) if (!activeIds.has(k)) lastByItem.delete(k);

    if (pending) return { pending: true, frame: null, paths: null };
    const { frame, paths } = buildToolpathsPayload({
      items,
      derivedOf: (it) => derivedByItem.get(it.id) || null,
      selections: getSelections(),
      tolMm,
    });
    return { pending: false, frame, paths };
  }

  function flush() {
    timer = null;
    if (!bridge || !bridge.canSend()) {
      dirty = false;
      onSpin(false);
      return;
    }
    const res = evaluateNow();
    if (res.pending) {
      onSpin(true);
      return;
    }

    const contentKey = JSON.stringify({ frame: res.frame, paths: res.paths });
    if (contentKey === lastSentBody && (res.paths.length > 0 || !hasSentPaths)) {
      dirty = false;
      onSpin(false);
      return;
    }

    dirty = false;
    lastSentBody = contentKey;
    const seq = ++sendingSeq;

    if (res.paths.length === 0) {
      if (!hasSentPaths) {
        onSpin(false);
        return;
      }
      hasSentPaths = false;
      const sent = bridge.send(FUSION_ACTIONS.TOOLPATHS_CLEAR, {});
      Promise.resolve(sent && sent.promise).finally(() => {
        if (seq === sendingSeq && !dirty && timer === null) onSpin(false);
      });
      return;
    }

    revision += 1;
    hasSentPaths = true;
    const sent = bridge.send(FUSION_ACTIONS.TOOLPATHS, {
      revision,
      frame: res.frame,
      paths: res.paths,
    });
    Promise.resolve(sent && sent.promise).finally(() => {
      if (seq === sendingSeq && !dirty && timer === null) onSpin(false);
    });
  }

  function notify() {
    if (!bridge || !bridge.canSend()) return;
    const res = evaluateNow();
    const contentKey = res.pending ? null : JSON.stringify({ frame: res.frame, paths: res.paths });
    const nothingToSend = !res.pending && (contentKey === lastSentBody || (res.paths.length === 0 && !hasSentPaths));
    if (nothingToSend) {
      lastSentBody = contentKey;
      if (timer !== null) {
        clearT(timer);
        timer = null;
      }
      dirty = false;
      onSpin(false);
      return;
    }
    dirty = true;
    onSpin(true);
    if (timer !== null) clearT(timer);
    timer = setT(flush, debounceMs);
  }

  function clearNow() {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
    dirty = false;
    sendingSeq++;
    onSpin(false);
    if (!bridge || !bridge.canSend()) return;
    if (hasSentPaths) {
      hasSentPaths = false;
      lastSentBody = null;
      bridge.send(FUSION_ACTIONS.TOOLPATHS_CLEAR, {});
    }
  }

  function reset() {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
    dirty = false;
    lastSentBody = null;
    hasSentPaths = false;
    onSpin(false);
  }

  return {
    notify,
    flush,
    clearNow,
    reset,
    isPending: () => dirty || timer !== null,
    getRevision: () => revision,
  };
}
