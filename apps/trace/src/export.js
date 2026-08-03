/**
 * export.js
 * SVG download, DXF download, clipboard copy.
 * Unit-aware: scale is always mm/px internally; output uses user's chosen unit.
 *
 * SVG  → width/height in chosen unit (mm or in) — Shaper Origin reads this directly.
 * DXF  → coordinates in chosen unit, $INSUNITS set accordingly — Fusion 360 / CAM.
 */

const MM_PER_INCH = 25.4;

// ── SVG export ────────────────────────────────────────────────────────────────

export function downloadSVG(svgString, filename, scaleMmPx, imageH, unit = 'mm') {
  if (!svgString) return;
  const scaled = applyScaleToSVG(svgString, scaleMmPx, unit);
  downloadText(scaled, `${filename}.svg`, 'image/svg+xml');
}

export function copySVG(svgString, scaleMmPx, imageH, unit = 'mm') {
  if (!svgString) return Promise.reject('No SVG');
  const scaled = applyScaleToSVG(svgString, scaleMmPx, unit);
  return navigator.clipboard.writeText(scaled);
}

/**
 * Rewrite SVG width/height/viewBox to reflect real-world dimensions.
 * Shaper Origin reads width/height directly — output in user's chosen unit.
 */
function applyScaleToSVG(svgString, scaleMmPx, unit) {
  if (!scaleMmPx) return svgString;

  const parser = new DOMParser();
  const doc    = parser.parseFromString(svgString, 'image/svg+xml');
  const svg    = doc.querySelector('svg');
  if (!svg) return svgString;

  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number) ?? [0, 0, 100, 100];
  const [, , vbW, vbH] = vb;

  // Compute dimensions in mm first, then convert to output unit
  const realWmm = vbW * scaleMmPx;
  const realHmm = vbH * scaleMmPx;

  let realW, realH, unitAttr;
  if (unit === 'in') {
    realW    = (realWmm / MM_PER_INCH).toFixed(6);
    realH    = (realHmm / MM_PER_INCH).toFixed(6);
    unitAttr = 'in';
  } else {
    realW    = realWmm.toFixed(4);
    realH    = realHmm.toFixed(4);
    unitAttr = 'mm';
  }

  svg.setAttribute('width',  `${realW}${unitAttr}`);
  svg.setAttribute('height', `${realH}${unitAttr}`);
  svg.setAttribute('xmlns',  'http://www.w3.org/2000/svg');

  return new XMLSerializer().serializeToString(doc);
}

// ── DXF export ────────────────────────────────────────────────────────────────

// DXF $INSUNITS codes
const DXF_UNITS = { mm: 4, in: 1 };

export function downloadDXF(svgString, filename, scaleMmPx, imageH, unit = 'mm') {
  if (!svgString) return;
  const dxf = svgToDXF(svgString, scaleMmPx ?? 1, unit);
  downloadText(dxf, `${filename}.dxf`, 'application/dxf');
}

function svgToDXF(svgString, scaleMmPx, unit) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(svgString, 'image/svg+xml');
  const svg    = doc.querySelector('svg');
  const vb     = svg?.getAttribute('viewBox')?.split(/[\s,]+/).map(Number) ?? [0,0,100,100];
  const svgH   = vb[3];

  // Scale to chosen output unit
  // scaleMmPx is mm/px; convert to outputUnit/px
  const scaleOut = unit === 'in' ? scaleMmPx / MM_PER_INCH : scaleMmPx;

  const paths    = doc.querySelectorAll('path');
  const entities = [];

  paths.forEach(pathEl => {
    const d = pathEl.getAttribute('d');
    if (!d) return;

    splitSubpaths(d).forEach(sub => {
      const pts = flattenPath(sub);
      if (pts.length < 2) return;

      // Apply scale + flip Y (SVG Y-down → DXF Y-up)
      const scaled = pts.map(([x, y]) => [
        x * scaleOut,
        (svgH - y) * scaleOut,
      ]);

      const closed = sub.trimEnd().toUpperCase().endsWith('Z');
      entities.push(lwpolyline(scaled, closed));
    });
  });

  return buildDXF(entities, DXF_UNITS[unit] ?? 4);
}

// ── Path utilities ────────────────────────────────────────────────────────────

function splitSubpaths(d) {
  return d.split(/(?=[Mm])/).filter(s => s.trim().length > 0);
}

function flattenPath(d, tolerance = 0.5) {
  const cmds   = parsePath(d);
  const points = [];
  let cx = 0, cy = 0, startX = 0, startY = 0;

  for (const cmd of cmds) {
    switch (cmd.type) {
      case 'M':
        cx = cmd.x; cy = cmd.y; startX = cx; startY = cy;
        points.push([cx, cy]);
        break;
      case 'L':
        cx = cmd.x; cy = cmd.y;
        points.push([cx, cy]);
        break;
      case 'H':
        cx = cmd.x;
        points.push([cx, cy]);
        break;
      case 'V':
        cy = cmd.y;
        points.push([cx, cy]);
        break;
      case 'C': {
        const segs = flattenCubic(cx, cy, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y, tolerance);
        segs.forEach(p => points.push(p));
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'Q': {
        // Elevate quadratic to cubic (exact)
        const cx1 = cx + (2/3) * (cmd.x1 - cx);
        const cy1 = cy + (2/3) * (cmd.y1 - cy);
        const cx2 = cmd.x + (2/3) * (cmd.x1 - cmd.x);
        const cy2 = cmd.y + (2/3) * (cmd.y1 - cmd.y);
        const segs = flattenCubic(cx, cy, cx1, cy1, cx2, cy2, cmd.x, cmd.y, tolerance);
        segs.forEach(p => points.push(p));
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'Z':
        points.push([startX, startY]);
        cx = startX; cy = startY;
        break;
    }
  }
  return points;
}

function flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3, tol, depth = 0) {
  const ux = 3*x1 - 2*x0 - x3, uy = 3*y1 - 2*y0 - y3;
  const vx = 3*x2 - 2*x3 - x0, vy = 3*y2 - 2*y3 - y0;
  const flat = Math.max(ux*ux + uy*uy, vx*vx + vy*vy);

  if (flat <= 16 * tol * tol || depth > 8) return [[x3, y3]];

  const x01 = (x0+x1)/2, y01 = (y0+y1)/2;
  const x12 = (x1+x2)/2, y12 = (y1+y2)/2;
  const x23 = (x2+x3)/2, y23 = (y2+y3)/2;
  const x012 = (x01+x12)/2, y012 = (y01+y12)/2;
  const x123 = (x12+x23)/2, y123 = (y12+y23)/2;
  const xm = (x012+x123)/2, ym = (y012+y123)/2;

  return [
    ...flattenCubic(x0,y0,x01,y01,x012,y012,xm,ym,tol,depth+1),
    ...flattenCubic(xm,ym,x123,y123,x23,y23,x3,y3,tol,depth+1),
  ];
}

function parsePath(d) {
  const commands = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let m, cx = 0, cy = 0;

  while ((m = re.exec(d)) !== null) {
    const type  = m[1];
    const args  = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const upper = type.toUpperCase();
    const rel   = type !== type.toUpperCase() && upper !== 'Z';

    switch (upper) {
      case 'M':
        for (let i = 0; i < args.length; i += 2) {
          const x = rel ? cx + args[i] : args[i];
          const y = rel ? cy + args[i+1] : args[i+1];
          commands.push({ type: i === 0 ? 'M' : 'L', x, y });
          cx = x; cy = y;
        }
        break;
      case 'L':
        for (let i = 0; i < args.length; i += 2) {
          const x = rel ? cx + args[i] : args[i];
          const y = rel ? cy + args[i+1] : args[i+1];
          commands.push({ type: 'L', x, y });
          cx = x; cy = y;
        }
        break;
      case 'H':
        for (let i = 0; i < args.length; i++) {
          const x = rel ? cx + args[i] : args[i];
          commands.push({ type: 'H', x });
          cx = x;
        }
        break;
      case 'V':
        for (let i = 0; i < args.length; i++) {
          const y = rel ? cy + args[i] : args[i];
          commands.push({ type: 'V', y });
          cy = y;
        }
        break;
      case 'C':
        for (let i = 0; i < args.length; i += 6) {
          const x1 = rel ? cx+args[i]   : args[i];
          const y1 = rel ? cy+args[i+1] : args[i+1];
          const x2 = rel ? cx+args[i+2] : args[i+2];
          const y2 = rel ? cy+args[i+3] : args[i+3];
          const x  = rel ? cx+args[i+4] : args[i+4];
          const y  = rel ? cy+args[i+5] : args[i+5];
          commands.push({ type: 'C', x1, y1, x2, y2, x, y });
          cx = x; cy = y;
        }
        break;
      case 'Q':
        for (let i = 0; i < args.length; i += 4) {
          const x1 = rel ? cx+args[i]   : args[i];
          const y1 = rel ? cy+args[i+1] : args[i+1];
          const x  = rel ? cx+args[i+2] : args[i+2];
          const y  = rel ? cy+args[i+3] : args[i+3];
          commands.push({ type: 'Q', x1, y1, x, y });
          cx = x; cy = y;
        }
        break;
      case 'Z':
        commands.push({ type: 'Z' });
        break;
    }
  }
  return commands;
}

// ── DXF builders ──────────────────────────────────────────────────────────────

function lwpolyline(pts, closed) {
  let s = `  0\nLWPOLYLINE\n  8\n0\n 70\n${closed ? 1 : 0}\n 90\n${pts.length}\n`;
  pts.forEach(([x, y]) => { s += ` 10\n${x.toFixed(6)}\n 20\n${y.toFixed(6)}\n`; });
  return s;
}

function buildDXF(entities, insunits = 4) {
  return [
    '  0\nSECTION\n  2\nHEADER\n',
    `  9\n$ACADVER\n  1\nAC1015\n`,
    `  9\n$INSUNITS\n 70\n${insunits}\n`,
    '  0\nENDSEC\n',
    '  0\nSECTION\n  2\nENTITIES\n',
    ...entities,
    '  0\nENDSEC\n',
    '  0\nEOF\n',
  ].join('');
}

// ── Utility ───────────────────────────────────────────────────────────────────

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
