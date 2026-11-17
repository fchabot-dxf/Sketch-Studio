// apps/shaper/src/review-grid.js — TASK 754: the Export step's 3D view stands on the Design canvas's PAPER with the Design canvas's GRID.
// Nothing here declares a colour, a spacing or a style: each one is READ from the declaration the Design canvas itself draws with, so
// "like the Design canvas" stays true when the user changes the grid setting, the document unit or the style template:
//   colours  — the custom properties the Design canvas paints with, resolved ON the Design canvas element (getComputedStyle), so a style
//              template's tokens, set inline on that element (style-templates.js bindTemplateTokens), are followed too:
//              background = --shaper-cream (index.html: #design-canvas { background-color: var(--shaper-cream) }),
//              light / heavy grid = --sk-grid-minor / --sk-grid-major (declared on #design-canvas, read by #ui/canvas-grid.js's stylesheet);
//   style    — the GRID_MODE setting through canvas-grid's normalizeGridMode: 'lines' -> lines, 'points' -> dots, 'off' -> no grid;
//   spacing  — canvas-grid's gridSpacingFromSettings (the renderer's own reader: GRID_SIZE / GRID_MAJOR_STEP, the inch row) and its
//              gridLevel (the same 1-2-5 levels and light-line fade by on-screen spacing), so a grid cell in 3D = a grid cell in Design;
//   sizes    — canvas-grid's GRID_MARK_PX (line widths / dot radii in screen px).
// reviewGridSpec is PURE (the node test calls it); review-view.js draws it with ONE shader plane (gridMaterialSource below).
import { gridSpacingFromSettings, gridLevel, normalizeGridMode, GRID_MARK_PX, MIN_MINOR_PX } from '#ui/canvas-grid.js';

// the Design canvas's colour tokens the 3D view takes (see above): role -> custom property name
export const DESIGN_CANVAS_TOKENS = { background: '--shaper-cream', minor: '--sk-grid-minor', major: '--sk-grid-major' };

// the grid plane fades out with the distance from the board's centre, in board half-diagonals: full up to `from`, gone at `to` (no edge)
export const GRID_FADE = { from: 1.3, to: 4 };

// The colours as the Design canvas resolves them: `style` = getComputedStyle(the Design canvas element). A token that resolves to nothing
// is a broken declaration: it throws (the caller shows the error), never a silent stand-in colour.
export function designCanvasColors(style) {
  const out = {};
  for (const [role, name] of Object.entries(DESIGN_CANVAS_TOKENS)) {
    const v = String(style.getPropertyValue(name) || '').trim();
    if (!v) throw new Error(`review-grid: the Design canvas token ${name} (${role}) resolves to nothing`);
    out[role] = v;
  }
  return out;
}

/**
 * The 3D grid for the current settings and zoom. PURE.
 *   settings  SettingsManager-like { get(key), getDefault(key) }; unit = the document unit ('mm' | 'cm' | 'in')
 *   colors    designCanvasColors(...) -> { background, minor, major }
 *   pxPerMm   screen (CSS) px per world mm where the camera looks at the grid (the level is chosen there, like Design at its zoom)
 * -> { mode, visible, minor, major (world mm, the displayed level), fade (light-line opacity 0..1), base { minor, major } (the setting's
 *    spacing), markPx { minor, major } (line width / dot radius, screen px), colors }
 */
export function reviewGridSpec({ settings, unit, colors, pxPerMm }) {
  const mode = normalizeGridMode(settings.get('GRID_MODE'));
  const sp = gridSpacingFromSettings(settings, unit);
  const lvl = gridLevel({ ...sp, scale: (px) => px / pxPerMm });
  return {
    mode, visible: mode !== 'off', minor: lvl.minor, major: lvl.major, fade: lvl.fade,
    base: { minor: sp.GRID_SIZE, major: sp.GRID_MAJOR_STEP },
    markPx: mode === 'points' ? { ...GRID_MARK_PX.points } : { ...GRID_MARK_PX.lines }, colors,
  };
}

// The shader plane (three.js ShaderMaterial source): every pixel finds its distance to the nearest light / heavy line (or grid point) in
// SCREEN pixels from the world position's derivatives (fwidth), so the marks keep their on-screen size at any zoom / angle and are
// anti-aliased. A family of lines fades out where its cells shrink below half of MIN_MINOR_PX on screen (far away, grazing angles: no
// moire), exactly as the Design grid never draws light lines closer than MIN_MINOR_PX; the light lines also carry gridLevel's fade.
// The plane fades out between GRID_FADE.from and .to (uFadeFrom / uFadeTo, world mm from uCentre).
export const gridMaterialSource = {
  vertexShader: /* glsl */ `
    varying vec2 vXZ;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vXZ = w.xz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uMinorColor;
    uniform vec3 uMajorColor;
    uniform float uMinor, uMajor, uMinorFade, uPoints, uPxRatio, uMarkMinor, uMarkMajor, uFadeFrom, uFadeTo;
    uniform vec2 uCentre;
    varying vec2 vXZ;
    const float MIN_PX = ${MIN_MINOR_PX.toFixed(1)};
    // coverage of the marks of spacing s; mark = line width (lines) or dot radius (points), device px
    float cover(float s, float mark, vec2 fw) {
      vec2 d = abs(fract(vXZ / s - 0.5) - 0.5) * s / max(fw, vec2(1e-6));
      if (uPoints > 0.5) return clamp(mark + 0.5 - length(d), 0.0, 1.0);
      return clamp(0.5 * mark + 0.5 - min(d.x, d.y), 0.0, 1.0);
    }
    // 1 while a cell of spacing s is >= MIN_PX on screen, down to 0 at MIN_PX / 2
    float dense(float s, vec2 fw) {
      float cellPx = s / max(max(fw.x, fw.y), 1e-6) / uPxRatio;
      return clamp((cellPx - 0.5 * MIN_PX) / (0.5 * MIN_PX), 0.0, 1.0);
    }
    void main() {
      vec2 fw = fwidth(vXZ);
      float far = 1.0 - smoothstep(uFadeFrom, uFadeTo, length(vXZ - uCentre));
      float aMaj = cover(uMajor, uMarkMajor * uPxRatio, fw) * dense(uMajor, fw) * far;
      float aMin = cover(uMinor, uMarkMinor * uPxRatio, fw) * dense(uMinor, fw) * uMinorFade * far;
      float a = aMaj + aMin * (1.0 - aMaj);
      if (a <= 0.001) discard;
      gl_FragColor = vec4((uMajorColor * aMaj + uMinorColor * aMin * (1.0 - aMaj)) / a, a);
      #include <colorspace_fragment>
    }`,
};
