import { dbg } from './core/debug.js';
import { worldToScreen, calculateArcPath, perpendicularNormal, resolveJoints, isCoincidentConstraint, getFannedPosition, getLineIntersection } from './core/geometry.js';
import { CONSTRAINT_TYPES, CONSTRAINT_COLORS, TOOL_MODES, INFERENCE_TYPES } from './core/constants.js';
import { SolverConfig } from './core/solver-config.js';
import SettingsManager from './core/settings-manager.js';

export function computeBaseJointRadiusFor(settingVal) { const v = (typeof settingVal === 'number') ? settingVal * 4 : 0; return Math.max(0.4, v); }
import { updateCursor } from './ui/cursor-manager.js';
import { analyzeConstraintStatus } from './core/constraint-status.js';
import { previewSnapConstraint } from './core/snap-constraints.js';
import { computeTrueVertexSet } from './core/joints.js';

export function draw(joints, shapes, svg, active, snapTarget, constraints=[], selectedJoints=new Set(), selectedConstraints=new Set(), currentTool=null, inference=null, selectedShapes=new Set(), hoveredShape=null, hoveredJoint=null, hoveredConstraint=null, activeSnap=null, tempMousePos=null, isDragging=false, renderTarget){ 
  // Update cursor based on tool
  if (svg) {
    updateCursor(svg, currentTool);
  }

  // Analyze constraint status for visualization (Green/Black/Blue)
  // Filter out driven dimensions (reference only) so they don't affect DOF calculation
  const activeConstraints = constraints.filter(c => !c.isDriven && !c.driven);
  const { fixedJoints, constrainedJoints, fixedShapes, constrainedShapes, jointDOFs, lockedAxisX, lockedAxisY, radialLocked, dofSources } = analyzeConstraintStatus({ joints, shapes, constraints: activeConstraints });

  // Accumulate SVG markup and set once at the end to avoid partial-frame renders
  const out = [];
  // Container for overlays that must be drawn last (ensures top-most stacking)
  let lateOverlay = '';
  // Calculate zoom factor to keep stroke widths constant in screen space
  const vb = svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  const zoomX = vb.width / rect.width;
  const zoomY = vb.height / rect.height;
  const zoom = Math.max(zoomX, zoomY); // Use larger zoom to ensure visibility
  
  // Base sizes in screen pixels - will be scaled by inverse zoom
  // Read UI-configurable multipliers from SettingsManager so user changes apply immediately
  const getNum = (key, fallback) => {
    const v = Number(SettingsManager.get(key));
    return Number.isFinite(v) ? v : fallback;
  };
  const LINE_STROKE_MULT = Math.max(0.25, getNum('LINE_STROKE', 1.0));
  const SELECTION_FEEDBACK_MULT = Math.max(0.1, getNum('SELECTION_FEEDBACK_MULT', 2));
  const HOVER_FEEDBACK_MULT = Math.max(0.1, getNum('HOVER_FEEDBACK_MULT', 3));
  const JOINT_RADIUS_SETTING = getNum('JOINT_RADIUS', 4);
  const JOINT_STROKE_MULT = Math.max(0.25, getNum('JOINT_STROKE_MULT', 1.0));
  const GRID_SIZE = getNum('GRID_SIZE', 2);
  const GRID_MAJOR_STEP = getNum('GRID_MAJOR_STEP', 10);

  // Compute base joint radius in screen pixels. Allow JOINT_RADIUS down to 0.1 (=> base >= 0.4)
  function computeBaseJointRadiusFor(settingVal) { const v = (typeof settingVal === 'number') ? settingVal * 4 : 0; return Math.max(0.4, v); }
  const BASE_LINE_STROKE = 6 * LINE_STROKE_MULT;
  const BASE_LINE_STROKE_SELECTED = BASE_LINE_STROKE * SELECTION_FEEDBACK_MULT;
  const BASE_LINE_STROKE_HOVERED = BASE_LINE_STROKE * HOVER_FEEDBACK_MULT;
  const BASE_JOINT_RADIUS = computeBaseJointRadiusFor(JOINT_RADIUS_SETTING); // keep in screen px via multiplier
  const BASE_JOINT_STROKE = BASE_LINE_STROKE * JOINT_STROKE_MULT;
  const BASE_JOINT_STROKE_SELECTED = BASE_JOINT_STROKE * 2;
  const BASE_JOINT_STROKE_HOVERED = BASE_JOINT_STROKE * 3;
  
  // --- UNIFIED VISUAL CONFIGURATION (Screen Pixels) ---
  // GLYPH_BG_DIAMETER_PX is the diameter of the visible background circle (screen px)
  // SYMBOL_SIZE_PX is the actual icon size (screen px) placed inside the background
  const SYMBOL_SIZE_PX = getNum('GLYPH_SYMBOL_SIZE_PX', 20);       // Icon size (screen px)
  // Derive background diameter from symbol size (multiplier 1.6 to match previous defaults)
  const GLYPH_BG_DIAMETER_PX = Math.round(SYMBOL_SIZE_PX * 1.6); // derived background circle size (was 32 when symbol=20) 
  const INFERENCE_SIZE_PX = getNum('GLYPH_INFERENCE_SIZE_PX', 24);    // Inference hint icon size
  const GLYPH_OFFSET_PX = getNum('GLYPH_OFFSET_PX', 40);      // Offset from joints/shapes (increased to avoid overlap)
  const GLOW_WIDTH_PX = getNum('GLOW_WIDTH_PX', 20);        // Width of hover/select highlights

  // Scale function to convert screen-space sizes to world-space
  const scale = (screenSize) => screenSize * zoom;
  
  // Dash pattern size constants in screen pixels (converted to world units with scale())
  const DASH_LENGTH_PX = getNum('DASH_LENGTH_PX', 8);    // Length of dashes in screen pixels
  const DASH_GAP_PX = getNum('DASH_GAP_PX', 8);       // Length of gaps in screen pixels
  
  // Derived sizes
  // glyphSize kept for legacy scale relationships in some calculations (kept similar to prior behavior)
  const glyphSize = scale(9.72);
  // hitZoneRadius matches the background circle radius
  const hitZoneRadius = scale(GLYPH_BG_DIAMETER_PX / 2);
  // Icon pixel size for sprite use (world-space units derived from screen pixels)
  const ICON_PX = scale(SYMBOL_SIZE_PX); // smaller white icon inside the blue circle
  const INFERENCE_ICON_PX = scale(INFERENCE_SIZE_PX); // inference sprite world size

  // Build coincident clusters so closed shapes treat coincident joints as sealed
  const clusterParent = new Map();
  const clusterMembers = new Map();
  const clusterPos = new Map();
  const findCluster = (id) => {
    if (!clusterParent.has(id)) clusterParent.set(id, id);
    const p = clusterParent.get(id);
    if (p !== id) {
      const root = findCluster(p);
      clusterParent.set(id, root);
      return root;
    }
    return p;
  };
  const unionCluster = (a, b) => {
    const ra = findCluster(a);
    const rb = findCluster(b);
    if (ra !== rb) clusterParent.set(rb, ra);
  };

  for (const id of joints.keys()) findCluster(id);
  for (const c of constraints) {
    if (c.type !== CONSTRAINT_TYPES.COINCIDENT || !c.joints || c.joints.length < 2) continue;
    const base = c.joints[0];
    for (let i = 1; i < c.joints.length; i++) unionCluster(base, c.joints[i]);
  }

  for (const id of joints.keys()) {
    const root = findCluster(id);
    if (!clusterMembers.has(root)) clusterMembers.set(root, []);
    clusterMembers.get(root).push(id);
  }
  for (const [root, members] of clusterMembers.entries()) {
    let sx = 0; let sy = 0; let count = 0;
    for (const id of members) {
      const j = joints.get(id);
      if (!j) continue;
      sx += j.x; sy += j.y; count++;
    }
    if (count > 0) clusterPos.set(root, { x: sx / count, y: sy / count });
  }
  const getClusterLeader = (id) => findCluster(id);

  // Helper: Build data-* attributes for constraint glyphs for hit-testing
  function buildDataAttrs(c){
    if(!c) return '';
    const parts = [];
    parts.push(`data-ctype="${c.type}"`);
    if(c.joints && c.joints.length >= 2){ parts.push(`data-cj0="${c.joints[0]}"`); parts.push(`data-cj1="${c.joints[1]}"`); }
    if(c.joint) parts.push(`data-cjoint="${c.joint}"`);
    if(c.shape) parts.push(`data-cshape="${c.shape}"`);
    if(c.shapes && c.shapes.length >= 2){ parts.push(`data-cs0="${c.shapes[0]}"`); parts.push(`data-cs1="${c.shapes[1]}"`); }
    if(c.line) parts.push(`data-cline="${c.line}"`);
    if(c.circle) parts.push(`data-ccircle="${c.circle}"`);
    if(c.joints && c.joints.length > 2) parts.push(`data-cjoints="${c.joints.join(',')}"`);
    return parts.join(' ');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LOCAL HELPERS — extracted from repeated inline patterns
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get construction style attributes for shapes.
   * Construction shapes use dashed orange lines with reduced opacity.
   */
  function getConstructionStyles(shape, strokeWidth, strokeColor, scale) {
    if (!shape.isConstruction) {
      return { attr: '', strokeW: strokeWidth, color: strokeColor };
    }
    return {
      attr: ` stroke-dasharray="${scale(DASH_LENGTH_PX)},${scale(DASH_GAP_PX)}" stroke-opacity="0.5"`,
      strokeW: strokeWidth * 0.8,
      color: '#f97316' // Orange for construction
    };
  }

  /**
   * Determine interaction state for constraint glyphs (hover/selection).
   * @param {object} c - Constraint object
   * @param {object} highlight - Current highlight state {kind, id}
   * @param {Set} selectedConstraints - Set of selected constraints
   * @param {boolean} preview - Is this a preview constraint?
   * @param {object} opts - Options {parent?: constraint}
   * @returns {{isHovered: boolean, isSelected: boolean, active: boolean}}
   */
  function getConstraintInteraction(c, highlight, selectedConstraints, preview, opts = {}) {
    const isHovered = !preview && highlight.kind === 'constraint'
      && (highlight.id === c || (opts.parent && highlight.id === opts.parent));
    const isSelected = !preview && selectedConstraints && selectedConstraints.has(c);
    return { isHovered, isSelected, active: isHovered || isSelected };
  }

  /**
   * Get visual style for constraint glyph based on interaction state.
   * @param {boolean} active - Is glyph hovered or selected?
   * @param {function} scale - Scale function for screen→world conversion
   * @param {number} glyphSize - Base glyph size in world units
   * @returns {{strokeW: number, bgRadius: number, bgOpacity: string}}
   */
  function getGlyphStyle(active, scale, glyphSize) {
    return {
      strokeW: active ? scale(4) : scale(2.5),
      bgRadius: active ? glyphSize + scale(8) : glyphSize + scale(5),
      bgOpacity: active ? '0.95' : '0.85'
    };
  }

  // Unified glyph drawing helper - background first, icon last (ensures consistent layering)
  const drawUnifiedGlyph = (c, x, y, iconId = null, rotateDeg = 0, opts = {}) => {
    // c may be null for non-constraint uses (inference previews)
    const isPreview = !!(opts.isPreview || (c && c.__isPreview));
    const isHovered = !isPreview && c && highlight.kind === 'constraint' && (highlight.id === c || (opts.parent && highlight.id === opts.parent));
    const isSelected = !isPreview && c && selectedConstraints && selectedConstraints.has(c);

    // Resolve colors (allow override via opts) with explicit fallbacks to Unified Blue theme
    const colors = (c && CONSTRAINT_COLORS[c.type]) || { fill: '#60A5FA', stroke: '#2563eb' };
    const bgFill = (opts && opts.bgFill) ? opts.bgFill : colors.fill;
    const bgStroke = (opts && opts.bgStroke) ? opts.bgStroke : colors.stroke;

    // Sync pos for hit testing if we have a constraint object
    try{ if(c) c.glyphPos = { x, y }; }catch(_){ }

    // A: Bottom layer — selection/hover solid disc
    // Selected glyphs get stronger, larger feedback (disc + subtle outline). Hovered glyphs get slightly stronger disc.
    if(!isPreview && (isHovered || isSelected)){
      if (isSelected) {
        out.push(`<circle cx="${x}" cy="${y}" r="${scale(GLYPH_BG_DIAMETER_PX/2 + 10)}" fill="#1e40af" fill-opacity="0.28" stroke="none"/>`);
        // Outer subtle stroked ring to emphasize selection — use 4px screen stroke and nudge radius outward so stroke appears mostly outside
        out.push(`<circle cx="${x}" cy="${y}" r="${scale(GLYPH_BG_DIAMETER_PX/2 + 14)}" fill="none" stroke="#1e40af" stroke-width="${scale(4)}" stroke-opacity="0.22"/>`);
      } else {
        out.push(`<circle cx="${x}" cy="${y}" r="${scale(GLYPH_BG_DIAMETER_PX/2 + 8)}" fill="#1e40af" fill-opacity="0.22" stroke="none"/>`);
      }
    }

    // B: Middle layer — background circle
    // NOTE: Increased stroke width for better visibility (doubled from 1.5 -> 3)
    const bgCircle = `<circle cx="0" cy="0" r="${hitZoneRadius}" fill="${bgFill}" stroke="${bgStroke}" stroke-width="${scale(3)}"/>`;

    // C: Top layer — icon (optional)
    const iconStyleStr = 'style="color: white !important; --icon-accent: white !important; stroke: white !important;"';
    const icon = iconId ? `<use href="#${iconId}" x="${-ICON_PX/2}" y="${-ICON_PX/2}" width="${ICON_PX}" height="${ICON_PX}" ${iconStyleStr}/>` : '';

    // Append any extra custom markup (for collinear dots, tangent mark, equal lines, etc.)
    const extra = opts.extra || '';

    // Data attrs and interaction styling
    const dataAttrs = (typeof buildDataAttrs === 'function' && c) ? buildDataAttrs(c) : '';
    // Preview visuals: explicit opacity and pointer-events so previews are visible but non-interactive
    const opacity = isPreview ? 0.8 : 1.0;
    const groupStyle = isPreview ? 'pointer-events:none' : 'cursor:pointer; pointer-events:all';
    // Force white icon color and accent variables on the group so referenced <symbol> uses them reliably
    const colorOverrides = 'color: white !important; --icon-accent: white !important;';
    const styleStr = `opacity:${opacity}; ${groupStyle}; ${colorOverrides}`;

    out.push(`<g class="constraint-glyph"${dataAttrs ? ' ' + dataAttrs : ''} transform="translate(${x},${y})" style="${styleStr}">${bgCircle}${icon}${extra}</g>`);
  };

  // Update SVG pattern grid stroke widths to maintain constant screen pixel width
  // This replaces the manual JS grid loop and fixes the "zooming in" stroke issue
  try {
    const gridPattern = document.getElementById('grid');
    const gridHeavyPattern = document.getElementById('grid-heavy');
    if(gridPattern && gridHeavyPattern){
      gridPattern.setAttribute('width', GRID_SIZE);
      gridPattern.setAttribute('height', GRID_SIZE);
      gridHeavyPattern.setAttribute('width', GRID_MAJOR_STEP);
      gridHeavyPattern.setAttribute('height', GRID_MAJOR_STEP);

      const minorPath = gridPattern.querySelector('path');
      if(minorPath){
        minorPath.setAttribute('d', `M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`);
        // Clamp stroke width to prevent grid saturation when zooming out
        const minorStroke = Math.min(scale(1), 0.2); // Max 0.2 units (10% of 2)
        minorPath.setAttribute('stroke-width', minorStroke);
      }

      const majorRect = gridHeavyPattern.querySelector('rect');
      if(majorRect){
        majorRect.setAttribute('width', GRID_MAJOR_STEP);
        majorRect.setAttribute('height', GRID_MAJOR_STEP);
      }
      const majorPath = gridHeavyPattern.querySelector('path');
      if(majorPath){
        majorPath.setAttribute('d', `M ${GRID_MAJOR_STEP} 0 L 0 0 0 ${GRID_MAJOR_STEP}`);
        const majorStroke = Math.min(scale(2), 1.0); // Max 1.0 units (10% of 10)
        majorPath.setAttribute('stroke-width', majorStroke);
      }
    }
  } catch(_) {}

  // Closed-shape fills: build simple loops from grouped line shapes
  try {
    const groupLines = new Map();
    for (const s of shapes) {
      if (!s || s.type !== 'line' || !s.groupId || s.isConstruction) continue;
      if (!groupLines.has(s.groupId)) groupLines.set(s.groupId, []);
      groupLines.get(s.groupId).push(s);
    }

    for (const [, lines] of groupLines.entries()) {
      if (lines.length < 3) continue;

      const adj = new Map();
      const addEdge = (a, b) => {
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a).add(b);
        adj.get(b).add(a);
      };

      for (const l of lines) {
        if (!l.joints || l.joints.length < 2) continue;
        const a = getClusterLeader(l.joints[0]);
        const b = getClusterLeader(l.joints[1]);
        if (!a || !b || a === b) continue;
        addEdge(a, b);
      }

      // Require a simple closed loop: every vertex degree == 2
      let isLoop = true;
      for (const [, neighbors] of adj.entries()) {
        if (neighbors.size !== 2) { isLoop = false; break; }
      }
      if (!isLoop || adj.size < 3) continue;

      const start = adj.keys().next().value;
      const points = [];
      let current = start;
      let prev = null;
      let guard = 0;
      const maxSteps = adj.size + 2;

      while (guard < maxSteps) {
        guard++;
        const jp = clusterPos.get(current) || joints.get(current);
        if (!jp) { points.length = 0; break; }
        points.push(`${jp.x},${jp.y}`);
        const neighbors = Array.from(adj.get(current));
        const next = (neighbors[0] !== prev) ? neighbors[0] : neighbors[1];
        if (!next || next === start) break;
        prev = current;
        current = next;
      }

      if (points.length >= 3) {
        const d = `M ${points[0]} L ${points.slice(1).join(' ')} Z`;
        out.push(`<path d="${d}" fill="#60A5FA" fill-opacity="0.2" stroke="none"/>`);
      }
    }
  } catch (_){ }
  
  // Draw origin axes with zoom-scaled stroke
  const originStroke = scale(1.5);
  // X axis (horizontal, red)
  out.push(`<line x1="${vb.x}" y1="0" x2="${vb.x+vb.width}" y2="0" stroke="#ef4444" stroke-width="${originStroke}" stroke-opacity="0.6"/>`);
  // Y axis (vertical, green)  
  out.push(`<line x1="0" y1="${vb.y}" x2="0" y2="${vb.y+vb.height}" stroke="#22c55e" stroke-width="${originStroke}" stroke-opacity="0.6"/>`);

  // Debug overlay: show joint fixed status and ids
  const showDebugOverlay = !!SettingsManager.get('SHOW_DEBUG_OVERLAY');
  if (showDebugOverlay) {
    // Precompute true-vertex set once per frame to avoid per-joint checks inside tight loops
    const trueVertices = computeTrueVertexSet(shapes);
    const showFreedom = !!SettingsManager.get('SHOW_FREEDOM');
    const showHealth = !!SettingsManager.get('SHOW_HEALTH');
    const debugFontPx = Number(SettingsManager.get('DEBUG_LABEL_FONT_SIZE') || 12);
    const fontSize = scale(debugFontPx);
    const labelOffset = scale(Number(SettingsManager.get('DEBUG_OFFSET_X') || 23)); // horizontal gutter for debug labels
    // Allow AI Vision to force denser spacing for OCR/AI use-cases
    let labelClusterSpacing = Number(SettingsManager.get('DEBUG_LABEL_LINE_SPACING') || 1.1); // multiplier for vertical spacing BETWEEN stacked labels (cluster spacing)
    let labelInnerSpacing = Number(SettingsManager.get('DEBUG_LABEL_INTRA_LINE_SPACING') || 0.9); // spacing WITHIN a multi-line label (minimal)
    const AI_VISION = !!SettingsManager.get('AI_VISION');
    if (AI_VISION) { labelInnerSpacing = 0.9; labelClusterSpacing = 1.1; }
    const labelPerSrcGap = Number(SettingsManager.get('DEBUG_LABEL_PER_SRC_GAP') || 1.0); // multiplier for additional 'src:' lines inside a label
    // Group joints by proximity (cluster radius = 16 screen px)
    const clusterRadius = scale(16);
    const jointArr = Array.from(joints.entries());
    const clustered = [];
    for (let i = 0; i < jointArr.length; ++i) {
      const [jid, j] = jointArr[i];
      let found = false;
      for (const cluster of clustered) {
        const [cx, cy] = cluster.center;
        if (Math.hypot(j.x - cx, j.y - cy) < clusterRadius) {
          cluster.joints.push([jid, j]);
          found = true;
          break;
        }
      }
      if (!found) clustered.push({ center: [j.x, j.y], joints: [[jid, j]] });
    }
    // Collect debug label groups (no background) to render at the end for highest z-index
    const debugLabelGroups = [];
    for (const cluster of clustered) {
      const n = cluster.joints.length;
      // Determine if any joint in the cluster is fixed
      let clusterIsFixed = false;
      for (let k = 0; k < n; ++k) {
        const [jid, j] = cluster.joints[k];
        if (!!j.fixed || fixedJoints.has(jid)) {
          clusterIsFixed = true;
          break;
        }
      }
      // Stack vertically, center on cluster center
      const [cx, cy] = cluster.center;
      // First pass: compute per-label metrics so spacing can adapt to content size
      const labelEntries = [];
      for (let k = 0; k < n; ++k) {
        const [jid, j] = cluster.joints[k];
        const dof = jointDOFs && jointDOFs.has(jid) ? jointDOFs.get(jid) : 2;

        // Expose axis locks in the label
        const lockList = [];
        if (lockedAxisX && lockedAxisX.has && lockedAxisX.has(jid)) lockList.push('X');
        if (lockedAxisY && lockedAxisY.has && lockedAxisY.has(jid)) lockList.push('Y');
        const lockStr = lockList.length ? ` [${lockList.join('')}]` : '';

        // Show DOF source(s) for traceability
        const sources = (dofSources && dofSources.has && dofSources.has(jid)) ? dofSources.get(jid) : [];

        // Color by DOF: 0 -> black, 1 -> orange, 2 -> blue
        const color = (dof === 0) ? '#000000' : (dof === 1 ? '#f97316' : '#3b82f6');

        // Primary text + one 'src:' line per source entry
        const showFreedom = !!SettingsManager.get('SHOW_FREEDOM');
        const isVertexFlag = showFreedom ? (trueVertices && trueVertices.has(jid)) : false;
        const vertexMark = showFreedom ? (isVertexFlag ? ' (V)' : ' (I)') : '';
        const primaryText = `${jid}${vertexMark}${clusterIsFixed ? ' F' : ''} d${dof}${lockStr}`;
        const linesArr = (sources && sources.length) ? [primaryText, ...sources.map(s => `src: ${s}`)] : [primaryText];
        const linesCount = linesArr.length;

        // Positioning origin for this label (anchor point at cluster)
        const lx = cx + labelOffset;

        // Measure widest line using offscreen canvas (screen px). In a non-DOM
        // environment (tests), document.createElement isn't available — fall
        // back to a character-count estimate so headless renders still work.
        if (!draw._measureCtx) {
          if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
            const _c = document.createElement('canvas');
            draw._measureCtx = (_c && typeof _c.getContext === 'function') ? _c.getContext('2d') : null;
          }
          if (!draw._measureCtx) draw._measureCtx = null;
        }
        const measureCtx = draw._measureCtx;
        const baseFontPx = debugFontPx; // screen px used for label font
        if (measureCtx) measureCtx.font = `${baseFontPx}px monospace`;
        let maxMeasuredPx = 0;
        for (const ln of linesArr) {
          const wpx = measureCtx
            ? Math.ceil(measureCtx.measureText(ln).width)
            : Math.ceil(ln.length * baseFontPx * 0.6); // rough monospace heuristic
          if (wpx > maxMeasuredPx) maxMeasuredPx = wpx;
        }
        const measuredPx = Math.max(4, maxMeasuredPx);
        const paddingXPx = 4;
        const paddingYPx = 2;

        // World-space sizes for this label
        const labelWidth = (measuredPx + paddingXPx * 2) * zoom;
        const lineHeightWorld = fontSize * labelInnerSpacing; // baseline spacing inside a label
        const labelHeight = (baseFontPx * zoom * linesCount * labelInnerSpacing) + (paddingYPx * 2 * zoom);

        labelEntries.push({ jid, j, color, lx, linesArr, linesCount, labelWidth, labelHeight, baseFontPx, paddingXPx, paddingYPx, lineHeightWorld });
      }

      // Stack labels using each label's computed height so labels with many src lines expand spacing
      const gap = fontSize * Math.max(0, labelClusterSpacing - 1); // world units gap between label blocks
      const totalHeight = labelEntries.reduce((s, e) => s + e.labelHeight, 0) + Math.max(0, labelEntries.length - 1) * gap;
      let cursorY = cy - labelOffset - totalHeight / 2; // top of first label rect (world units)

      // Second pass: render each label at the stacked position
      // Build a single rounded background card for the whole cluster (improves legibility)
      const maxLabelWidth = labelEntries.reduce((m, x) => Math.max(m, x.labelWidth), 0);
      const groupPaddingX = 6 * zoom; // extra horizontal padding around card
      const groupPaddingY = 4 * zoom; // extra vertical padding around card
      const groupRectWidth = maxLabelWidth + groupPaddingX;
      const groupRectHeight = totalHeight + groupPaddingY;
      const groupRectX = cx + labelOffset - (4 * zoom) - (groupPaddingX / 2);
      let groupRectY = cursorY - (groupPaddingY / 2);
      const groupCorner = 0; // simple rectangle (no rounded corners)

      // Determine selection/overlay state for group opacity/positioning
      const clusterIsSelected = cluster.joints.some(jt => (selectedJoints && selectedJoints.has && selectedJoints.has(jt[0])));
      const overlayState = (dbg && dbg.overlay && typeof dbg.overlay.getState === 'function') ? dbg.overlay.getState() : null;
      const groupBgOpacity = clusterIsSelected ? Number((overlayState && typeof overlayState.focusOpacity === 'number') ? overlayState.focusOpacity : 1.0) : 0.5;

      // If overlay is focused, anchor the group to the overlay Y
      if (clusterIsSelected && overlayState && typeof overlayState.currentScreenY === 'number') {
        const screenY = overlayState.currentScreenY;
        const overlayTopWorld = vb.y + (screenY * (vb.height / rect.height)) - totalHeight / 2;
        groupRectY = overlayTopWorld - (groupPaddingY / 2);
      }

      // Push the group background card first (simple rectangle)
      const cardFilter = showHealth ? ` style="filter: drop-shadow(0 0 8px rgba(59,130,246,0.32));"` : '';
      debugLabelGroups.push(`<rect class="debug-joint-label-card" x="${groupRectX}" y="${groupRectY}" width="${groupRectWidth}" height="${groupRectHeight}" fill="#fbbf24" opacity="${groupBgOpacity}"${cardFilter} />`);

      // Optionally render movement whiskers when 'Show Freedom' is enabled
      if (showFreedom) {
        let whiskerMarkup = '';
        const whiskerLen = scale(10);
        const whiskerOffset = scale(2); // start 2px radially away from joint center
        const WHISKER_STROKE_PX = Math.max(0.001, getNum('DEBUG_WHISKER_STROKE_PX', 0.03));
        const WHISKER_STROKE = scale(WHISKER_STROKE_PX);
        for (const [jid, jpt] of cluster.joints) {
          const jdof = jointDOFs && jointDOFs.has(jid) ? jointDOFs.get(jid) : 2;
          const allowX = jdof === 2 || (jdof === 1 && !(lockedAxisX && lockedAxisX.has && lockedAxisX.has(jid))) || (jdof === 1 && !(lockedAxisX && lockedAxisX.has && lockedAxisX.has(jid)) ? true : false);
          const allowY = jdof === 2 || (jdof === 1 && !(lockedAxisY && lockedAxisY.has && lockedAxisY.has(jid))) || (jdof === 1 && !(lockedAxisY && lockedAxisY.has && lockedAxisY.has(jid)) ? true : false);

          // Absolute suppression: do not render any whiskers for fully grounded joints (d0)
          if (jdof === 0) continue;

          // If this joint is radial-locked, render an arc whisker (orbital) later and
          // skip linear whisker rendering here so the arc fully *replaces* linear whiskers.
          const isRadial = (radialLocked && radialLocked.has && radialLocked.has(jid));

          // Basic axis-/vector-aligned whiskers are only rendered when NOT radial-locked
          if (!isRadial) {
            // If joint has exactly 1 DOF try to compute the actual freedom direction (line/tangent/axis)
            let freedomDir = null;
            if (jdof === 1) {
              // axis locks take precedence
              if (lockedAxisX && lockedAxisX.has && lockedAxisX.has(jid)) freedomDir = { x: 1, y: 0 };
              else if (lockedAxisY && lockedAxisY.has && lockedAxisY.has(jid)) freedomDir = { x: 0, y: 1 };
              else {
                // Inspect nearby constraints for a line-like direction (POINT_ON_LINE / COLLINEAR / referenced line shape)
                for (const c of activeConstraints) {
                  if (!c) continue;
                  if (c.type === CONSTRAINT_TYPES.POINT_ON_LINE && (c.joint === jid || (c.joints && c.joints.includes && c.joints.includes(jid)))) {
                    if (c.shape) {
                      const s = shapes.find(sh => sh.id === c.shape);
                      if (s && s.type === 'line' && s.joints && s.joints.length >= 2) {
                        const a = joints.get(s.joints[0]), b = joints.get(s.joints[1]);
                        if (a && b) {
                          const vx = b.x - a.x, vy = b.y - a.y; const m = Math.hypot(vx, vy);
                          if (m > 1e-6) { freedomDir = { x: vx / m, y: vy / m }; break; }
                        }
                      }
                    }
                  }
                  if (c.type === CONSTRAINT_TYPES.COLLINEAR) {
                    // prefer explicit line reference
                    const lineId = c.line || (c.shapes && c.shapes.find(id => shapes.find(s => s.id === id && s.type === 'line')));
                    if (lineId) {
                      const s = shapes.find(sh => sh.id === lineId);
                      if (s && s.type === 'line' && s.joints && s.joints.length >= 2) {
                        const a = joints.get(s.joints[0]), b = joints.get(s.joints[1]);
                        if (a && b) { const vx = b.x - a.x, vy = b.y - a.y; const m = Math.hypot(vx, vy); if (m > 1e-6) { freedomDir = { x: vx / m, y: vy / m }; break; } }
                      }
                    } else if (c.joints && c.joints.length >= 2) {
                      const other = c.joints.find(id => id !== jid);
                      if (other && joints.has(other)) {
                        const ov = joints.get(other); const vx = ov.x - jpt.x, vy = ov.y - jpt.y; const m = Math.hypot(vx, vy);
                        if (m > 1e-6) { freedomDir = { x: vx / m, y: vy / m }; break; }
                      }
                    }
                  }
                }

                // fallback: check dofSources provenance for constraint ids we can resolve
                if (!freedomDir && dofSources && dofSources.has && dofSources.has(jid)) {
                  for (const ds of dofSources.get(jid)) {
                    const matchC = activeConstraints.find(c => `${c.type}:${c.id || 'auto'}` === ds);
                    if (!matchC) continue;
                    if (matchC.type === CONSTRAINT_TYPES.POINT_ON_LINE && matchC.shape) {
                      const s = shapes.find(sh => sh.id === matchC.shape);
                      if (s && s.type === 'line' && s.joints && s.joints.length >= 2) {
                        const a = joints.get(s.joints[0]), b = joints.get(s.joints[1]);
                        if (a && b) { const vx = b.x - a.x, vy = b.y - a.y; const m = Math.hypot(vx, vy); if (m > 1e-6) { freedomDir = { x: vx / m, y: vy / m }; break; } }
                      }
                    }
                    if (matchC.type === CONSTRAINT_TYPES.COLLINEAR && matchC.line) {
                      const s = shapes.find(sh => sh.id === matchC.line);
                      if (s && s.type === 'line' && s.joints && s.joints.length >= 2) {
                        const a = joints.get(s.joints[0]), b = joints.get(s.joints[1]);
                        if (a && b) { const vx = b.x - a.x, vy = b.y - a.y; const m = Math.hypot(vx, vy); if (m > 1e-6) { freedomDir = { x: vx / m, y: vy / m }; break; } }
                      }
                    }
                  }
                }
              }
            }

            // Render whiskers aligned to the freedom vector when we have a single DOF
            if (jdof === 1 && freedomDir) {
              const dx = freedomDir.x, dy = freedomDir.y;
              const sx = jpt.x + dx * whiskerOffset;
              const sy = jpt.y + dy * whiskerOffset;
              // forward direction
              whiskerMarkup += `<line class="debug-whisker" x1="${sx}" y1="${sy}" x2="${sx + dx * whiskerLen}" y2="${sy + dy * whiskerLen}" stroke="#9CA3AF" stroke-opacity="0.6" stroke-width="${WHISKER_STROKE}" stroke-linecap="round" />`; 
              // backward direction
              const bx = jpt.x - dx * whiskerOffset;
              const by = jpt.y - dy * whiskerOffset;
              whiskerMarkup += `<line class="debug-whisker" x1="${bx}" y1="${by}" x2="${bx - dx * whiskerLen}" y2="${by - dy * whiskerLen}" stroke="#9CA3AF" stroke-opacity="0.6" stroke-width="${WHISKER_STROKE}" stroke-linecap="round" />`; 
            } else {
              // Basic axis-aligned whiskers (fallback / 2-DOF case)
              if (allowX) {
                const sx = jpt.x + whiskerOffset;
                // Minimal, unobtrusive stroke for line whiskers
                whiskerMarkup += `<line class="debug-whisker" x1="${sx}" y1="${jpt.y}" x2="${sx + whiskerLen}" y2="${jpt.y}" stroke="#9CA3AF" stroke-opacity="0.6" stroke-width="${WHISKER_STROKE}" stroke-linecap="round" />`;
              }
              if (allowY) {
                const sy = jpt.y - whiskerOffset; // draw upward whisker by default
                whiskerMarkup += `<line class="debug-whisker" x1="${jpt.x}" y1="${sy}" x2="${jpt.x}" y2="${sy - whiskerLen}" stroke="#9CA3AF" stroke-opacity="0.6" stroke-width="${WHISKER_STROKE}" stroke-linecap="round" />`;
              }
            }
          }

          // (Whisker rendering for the freedom vector / axis fallback was
          // duplicated from the inner block above — removed as dead code.
          // The duplicate referenced `freedomDir` which lives in an inner
          // scope and was undefined here, throwing on every render in any
          // sketch with at least one joint and the debug overlay enabled.)

          // Dynamic arc whisker for radial-locked joints (unchanged)
          if (radialLocked && radialLocked.has && radialLocked.has(jid) && jdof > 0) {
            try {
              // Resolve an anchor joint for the radial lock. Prefer provenance recorded in dofSources
              // (e.g. `anchor:<id>`). Fall back to searching nearby distance/radius constraints.
              let anchor = null;

              try {
                if (dofSources && dofSources.has && dofSources.has(jid)) {
                  for (const src of dofSources.get(jid)) {
                    if (typeof src === 'string' && src.startsWith('anchor:')) {
                      const aid = src.split(':')[1];
                      if (aid && joints.has(aid)) { anchor = joints.get(aid); break; }
                    }
                  }
                }
              } catch (_) { /* noop */ }

              if (!anchor) {
                for (const c of activeConstraints) {
                  if (c.type === CONSTRAINT_TYPES.DISTANCE) {
                    if (c.joints && c.joints.includes(jid)) {
                      const other = c.joints.find(id => id !== jid);
                      if (other && joints.has(other)) { anchor = joints.get(other); break; }
                    }
                    if (c.isRadius && c.shape) {
                      const s = shapes.find(sh => sh.id === c.shape);
                      if (s && s.joints && s.joints.length > 1 && s.joints.includes(jid)) {
                        const centerId = s.joints[0];
                        if (centerId && joints.has(centerId)) { anchor = joints.get(centerId); break; }
                      }
                    }
                  }
                }
              }

              if (anchor) {
                const dx = jpt.x - anchor.x;
                const dy = jpt.y - anchor.y;
                const distWorld = Math.hypot(dx, dy);
                if (Number.isFinite(distWorld) && distWorld > 1e-6) {
                  // screen-space distance (px)
                  const distScreen = Math.abs(distWorld / zoom) || 0;
                  // clamp between 10px and 40px (screen space)
                  const radiusPx = Math.max(10, Math.min(40, distScreen));
                  const rWorld = scale(radiusPx);

                  const baseAng = Math.atan2(dy, dx);
                  const angDelta = 15 * (Math.PI / 180); // ±15°
                  const a1 = baseAng - angDelta;
                  const a2 = baseAng + angDelta;

                  const sx = anchor.x + rWorld * Math.cos(a1);
                  const sy = anchor.y + rWorld * Math.sin(a1);
                  const ex = anchor.x + rWorld * Math.cos(a2);
                  const ey = anchor.y + rWorld * Math.sin(a2);

                  const arcD = `M ${sx} ${sy} A ${rWorld} ${rWorld} 0 0 1 ${ex} ${ey}`;
                  // Use an ultra-minimal stroke for arc whiskers
                  whiskerMarkup += `<path class="debug-whisker-arc" d="${arcD}" stroke="#3B82F6" stroke-opacity="1.0" stroke-width="${WHISKER_STROKE}" stroke-linecap="round" fill="none"/>`; 
                }
              }
            } catch (e) { /* defensive: don't fail render on debug visuals */ }
          }
        }
        if (whiskerMarkup) debugLabelGroups.push(`<g class="debug-whisker-group" style="pointer-events:none;">${whiskerMarkup}</g>`);
      }

      // Now render text lines for each label block (no per-label background)
      for (let k = 0; k < labelEntries.length; ++k) {
        const e = labelEntries[k];
        const rectX = e.lx - (e.paddingXPx * zoom);
        let rectY = cursorY;

        if (clusterIsSelected && overlayState && typeof overlayState.currentScreenY === 'number') {
          const screenY = overlayState.currentScreenY;
          const overlayTopWorld = vb.y + (screenY * (vb.height / rect.height)) - totalHeight / 2;
          rectY = overlayTopWorld + labelEntries.slice(0, k).reduce((s, x) => s + x.labelHeight, 0);
        }

        const outLy = rectY + (e.baseFontPx * zoom) - (e.paddingYPx * zoom) / 2 + (fontSize * 0.28);
        const textLines = e.linesArr.map((ln, i) => {
          let lineY = outLy + (i * e.lineHeightWorld);
          if (i === 0 && showFreedom) lineY -= scale(12); // lift primary line when freedom whiskers are shown
          const fillColor = i === 0 ? e.color : '#6b7280';
          return `<text x="${e.lx}" y="${lineY}" fill="${fillColor}" font-size="${fontSize}" font-family="monospace" class="debug-joint-label">${ln}</text>`;
        }).join('');

        // AI Vision / Health reporting: append failing residual(s) (bold red) when present
        let residualMarkup = '';
        try {
          const solverStats = (typeof window !== 'undefined' && window.__lastSolveStats) ? window.__lastSolveStats : null;
          const tol = Number(SolverConfig.VERIFIER_TOLERANCE || 0.001);
          if ((showHealth || AI_VISION) && solverStats && Array.isArray(solverStats.constraintErrors) && dofSources && dofSources.has && dofSources.has(e.jid)) {
            // Look for constraint provenance entries (distance:ID, radius:ID, etc.) and match against solverStats
            const srcs = dofSources.get(e.jid) || [];
            let worst = null;
            for (const s of srcs) {
              if (!s || typeof s !== 'string') continue;
              const parts = s.split(':');
              const cid = parts.length > 1 ? parts.slice(1).join(':') : null;
              if (!cid || cid === 'auto') continue;
              const match = solverStats.constraintErrors.find(x => String(x.id) === String(cid));
              if (match && typeof match.residual === 'number' && match.residual > tol) {
                if (!worst || match.residual > worst) worst = match.residual;
              }
            }
            if (worst) {
              const rStr = worst < 0.0001 ? worst.toExponential(2) : worst.toFixed(4);
              const resY = outLy + (e.linesCount * e.lineHeightWorld) + (showFreedom ? -scale(12) : 0);
              residualMarkup = `<text x="${e.lx}" y="${resY}" fill="#ef4444" font-weight="700" font-size="${fontSize}" font-family="monospace" class="debug-joint-label">res: ${rStr}</text>`;
            }
          }
        } catch (_) {}

        debugLabelGroups.push(`<g class="debug-joint-label-group" style="pointer-events:none;">${textLines}${residualMarkup}</g>`);
        cursorY += e.labelHeight + gap;
      }
    }
    // Do NOT push the debug label groups here — store them to be rendered last so they always sit on top
    if (debugLabelGroups.length > 0) {
      lateOverlay = `<g class="debug-joint-label-overlay" style="pointer-events:none;">${debugLabelGroups.join('')}</g>`;
    }
    // Add style for high z-index (SVG: later in DOM = higher z-order)
    // Guarded for headless/test environments that stub `document` but don't
    // implement getElementById/head — checking the methods explicitly is
    // more robust than `typeof document !== 'undefined'` alone.
    if (typeof document !== 'undefined' &&
        typeof document.getElementById === 'function' &&
        document.head &&
        !document.getElementById('debug-joint-label-style')) {
      const style = document.createElement('style');
      style.id = 'debug-joint-label-style';
      style.innerHTML = `.debug-joint-label { pointer-events: none; }
        svg .debug-joint-label { }
      `;
      document.head.appendChild(style);
    }
  }
  
  // Determine which joints and shapes are part of the selected constraint (for highlighting)
  let constraintJoints = new Set();
  let constraintShapes = new Set();
  if(selectedConstraints && selectedConstraints.size){
    for(const selectedConstraint of selectedConstraints){
      if(selectedConstraint.type === CONSTRAINT_TYPES.COINCIDENT && selectedConstraint.joints){
        for(const jid of selectedConstraint.joints) constraintJoints.add(jid);
        for(const s of shapes){ if(s.joints && s.joints.some(jid => constraintJoints.has(jid))){ constraintShapes.add(s.id); } }
      } else if((selectedConstraint.type === CONSTRAINT_TYPES.HORIZONTAL || selectedConstraint.type === CONSTRAINT_TYPES.VERTICAL) && selectedConstraint.joints){
        for(const jid of selectedConstraint.joints) constraintJoints.add(jid);
        for(const s of shapes){ if(s.joints && s.joints.some(jid => constraintJoints.has(jid))){ constraintShapes.add(s.id); } }
      } else if((selectedConstraint.type === CONSTRAINT_TYPES.PARALLEL || selectedConstraint.type === CONSTRAINT_TYPES.PERPENDICULAR) && selectedConstraint.shapes){
        for(const sid of selectedConstraint.shapes) constraintShapes.add(sid);
      } else if(selectedConstraint.type === CONSTRAINT_TYPES.COLLINEAR && selectedConstraint.joints){
        for(const jid of selectedConstraint.joints) constraintJoints.add(jid);
        for(const s of shapes){ if(s.joints && s.joints.some(jid => constraintJoints.has(jid))){ constraintShapes.add(s.id); } }
      } else if(selectedConstraint.type === CONSTRAINT_TYPES.TANGENT){
        if(selectedConstraint.line) constraintShapes.add(selectedConstraint.line);
        if(selectedConstraint.circle) constraintShapes.add(selectedConstraint.circle);
      } else if(selectedConstraint.type === CONSTRAINT_TYPES.POINT_ON_LINE){
        if(selectedConstraint.joint) constraintJoints.add(selectedConstraint.joint);
        if(selectedConstraint.shape) constraintShapes.add(selectedConstraint.shape);
      } else if(selectedConstraint.type === CONSTRAINT_TYPES.DISTANCE && selectedConstraint.joints){
        for(const jid of selectedConstraint.joints) constraintJoints.add(jid);
        for(const s of shapes){ if(s.joints && s.joints.some(jid => constraintJoints.has(jid))){ constraintShapes.add(s.id); } }
      }
    }
  }
  
  // draw shapes (clickable for selection)
  for(const s of shapes){ 
    const isSelected = selectedShapes && selectedShapes.has(s.id);
    const isHovered = (hoveredShape === s.id) && !hoveredConstraint && !hoveredJoint;
    const isConstraintPart = constraintShapes.has(s.id);
    
    let strokeWidth = scale(BASE_LINE_STROKE);
    let strokeColor = '#60A5FA'; // base blue (paler)
    
    if (fixedShapes.has(s.id)) {
        strokeColor = '#202020'; // Black (Treat Fixed as Constrained for now)
    } else if (constrainedShapes.has(s.id)) {
        strokeColor = '#202020'; // Black
    } else {
        strokeColor = '#60A5FA'; // Blue (paler)
    }

    if(isConstraintPart){
      // Highlight shapes that are part of selected constraint
      strokeWidth = scale(BASE_LINE_STROKE_SELECTED);
      strokeColor = '#3B82F6'; // Fusion Blue
    } else if(isHovered){
      strokeWidth = scale(BASE_LINE_STROKE_HOVERED);
      strokeColor = '#1e40af'; // darker blue
    } else if(isSelected){
      strokeWidth = scale(BASE_LINE_STROKE_SELECTED);
      strokeColor = '#1e40af'; // darker blue
    }
    
    if(s.type==='line'){
      const a = s.joints && s.joints[0] ? joints.get(s.joints[0]) : null;
      const b = s.joints && s.joints[1] ? joints.get(s.joints[1]) : null;
      if(!a || !b) continue;
      if(isHovered || isSelected){
        out.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${strokeColor}" stroke-width="${scale(GLOW_WIDTH_PX)}" stroke-linecap="round" stroke-opacity="0.28"/>`);
      }
      // Use unified construction style helper
      const { attr: constructionAttr, strokeW: effStrokeW, color: effStrokeColor } = getConstructionStyles(s, strokeWidth, strokeColor, scale);
      out.push(`<line class="shape-elem" data-shape-id="${s.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${effStrokeColor}" stroke-width="${effStrokeW}" stroke-linecap="round" style="cursor:pointer"${constructionAttr}/>`);
    } else if(s.type==='circle'){
      const c = s.joints && s.joints[0] ? joints.get(s.joints[0]) : null;
      if(!c) continue;
      // Radius must be stored on the shape now (center-only circles). Legacy radius joint (joints[1]) is ignored.
      let r = 0;
      if (typeof s.radius === 'number') r = s.radius;
      // If radius is missing or non-positive, treat as zero
      if(isNaN(r) || r <= 0) r = 0;
      if(isHovered || isSelected){
        out.push(`<circle cx="${c.x}" cy="${c.y}" r="${r}" fill="none" stroke="${strokeColor}" stroke-width="${scale(GLOW_WIDTH_PX)}" stroke-opacity="0.28"/>`);
      }
      // Use unified construction style helper
      const { attr: constructionAttr, strokeW: effStrokeW, color: effStrokeColor } = getConstructionStyles(s, strokeWidth, strokeColor, scale);
      out.push(`<circle class="shape-elem" data-shape-id="${s.id}" cx="${c.x}" cy="${c.y}" r="${r}" fill="none" stroke="${effStrokeColor}" stroke-width="${effStrokeW}" style="cursor:pointer"${constructionAttr}/>`);
    }
    else if (s.type === 'arc') {
      const [p1, p2, p3] = s.joints.map(id => joints.get(id));
      if (!p1 || !p2 || !p3) continue;

      const opts = { largeArc: s.largeArc, sweep: s.sweep };
      const pathData = calculateArcPath(p1, p2, p3, s.subType, opts);

      // Glow only when the arc shape itself is selected (constraint glyph selection should not add arc glow)
      if (isSelected) {
        out.push(`<path d="${pathData}" fill="none" stroke="${strokeColor}" stroke-width="${scale(GLOW_WIDTH_PX)}" stroke-linecap="round" stroke-opacity="0.28"/>`);
      }
      // Draw thick glow for hovered/selected arcs
      if (isHovered || isSelected) {
        out.push(`<path d="${pathData}" fill="none" stroke="${strokeColor}" stroke-width="${scale(20)}" stroke-linecap="round" stroke-opacity="0.2"/>`);
      }

      // Use unified construction style helper
      const { attr: constructionAttr, strokeW: effStrokeW, color: effStrokeColor } = getConstructionStyles(s, strokeWidth, strokeColor, scale);

      // Draw the actual arc path
      out.push(`<path class="shape-elem" data-shape-id="${s.id}" d="${pathData}" fill="none" stroke="${effStrokeColor}" stroke-width="${effStrokeW}" stroke-linecap="round" style="cursor:pointer"${constructionAttr}/>`);
    }
  }
  
  // Draw preview constraint glyph when setting up a constraint
  if(active && active.mode){
    const constraintModes = [CONSTRAINT_TYPES.COINCIDENT, CONSTRAINT_TYPES.PARALLEL, TOOL_MODES.PERPENDICULAR, TOOL_MODES.HORIZONTAL_VERTICAL, CONSTRAINT_TYPES.COLLINEAR, CONSTRAINT_TYPES.TANGENT, CONSTRAINT_TYPES.EQUAL];
    if(constraintModes.includes(active.mode)){
      // Show preview glyph at first selected element
      if(active.mode === CONSTRAINT_TYPES.COINCIDENT && active.j1){
        const j1 = joints.get(active.j1);
        if(j1){
          const offset = scale(GLYPH_OFFSET_PX);
          const x = j1.x + offset, y = j1.y - offset;
          const previewC = { type: CONSTRAINT_TYPES.COINCIDENT, joints: [active.j1, active.j1], __isPreview: true, __pos: { x, y } };
          // Use unified glyph (default Blue) for preview
          drawUnifiedGlyph(previewC, x, y, 'icon-coincident', 0, { isPreview: true });
        }
      } else if(active.mode === CONSTRAINT_TYPES.PARALLEL && active.shape1){
        const shape = shapes.find(s => s.id === active.shape1);
        if(shape && shape.joints){
          const a = joints.get(shape.joints[0]), b = joints.get(shape.joints[1]);
          if(a && b){
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const { nx, ny, len } = perpendicularNormal(a, b);
            const offset = scale(GLYPH_OFFSET_PX);
            const gx = mx + nx * offset, gy = my + ny * offset;
            const previewC = { type: CONSTRAINT_TYPES.PARALLEL, shapes: [active.shape1, active.shape1], __isPreview: true, __pos: { x: gx, y: gy } };
            // Use unified glyph (default Blue) for preview
            drawUnifiedGlyph(previewC, gx, gy, 'icon-parallel', 0, { isPreview: true });
          }
        }
      } else if(active.mode === TOOL_MODES.PERPENDICULAR && active.shape1){
        const shape = shapes.find(s => s.id === active.shape1);
        if(shape && shape.joints){
          const a = joints.get(shape.joints[0]), b = joints.get(shape.joints[1]);
          if(a && b){
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const { nx, ny, len } = perpendicularNormal(a, b);
            const offset = scale(GLYPH_OFFSET_PX);
            const gx = mx + nx * offset, gy = my + ny * offset;
            const previewC = { type: CONSTRAINT_TYPES.PERPENDICULAR, shapes: [active.shape1, active.shape1], __isPreview: true, __pos: { x: gx, y: gy } };
            // Use unified glyph (default Blue) for preview
            drawUnifiedGlyph(previewC, gx, gy, 'icon-perpendicular', 0, { isPreview: true });
          }
        }
      } else if(active.mode === TOOL_MODES.HORIZONTAL_VERTICAL){
        // H/V will show on the line being evaluated
      } else if(active.mode === CONSTRAINT_TYPES.COLLINEAR && active.joints && active.joints.length > 0){
        const lastJoint = joints.get(active.joints[active.joints.length - 1]);
        if(lastJoint){
          const offset = scale(GLYPH_OFFSET_PX);
          const x = lastJoint.x + offset, y = lastJoint.y - offset;
          const previewC = { type: CONSTRAINT_TYPES.COLLINEAR, joints: active.joints.slice(), __isPreview: true, __pos: { x, y } };
          // Use unified glyph (default Blue) for preview
          drawUnifiedGlyph(previewC, x, y, 'icon-collinear', 0, { isPreview: true });
        }
      } else if(active.mode === CONSTRAINT_TYPES.TANGENT && (active.line || active.circle)){
        // Show on line or circle
        if(active.line){
          const shape = shapes.find(s => s.id === active.line);
          if(shape && shape.joints){
            const a = joints.get(shape.joints[0]), b = joints.get(shape.joints[1]);
            if(a && b){
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              const { nx, ny, len } = perpendicularNormal(a, b);
              const offset = scale(GLYPH_OFFSET_PX);
              const gx = mx + nx * offset, gy = my + ny * offset;
              const symbolSize = glyphSize * 0.6;
              const bgRadius = glyphSize + scale(5);
              const previewC = { type: CONSTRAINT_TYPES.TANGENT, line: active.line, circle: active.circle, __isPreview: true, __pos: { x: gx, y: gy } };
              // Use unified glyph (default Blue) for preview
              drawUnifiedGlyph(previewC, gx, gy, 'icon-tangent', 0, { isPreview: true });
            }
          }
        }
      }
    }
  }
  
  // draw origin first (underneath everything)
  // Check which points are coincident to origin (via constraints, not distance)
  const pointsCoincidentToOrigin = new Set();
  for(const c of constraints){
    if(c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints){
      const [j1, j2] = c.joints;
      if(j1 === 'j_origin') pointsCoincidentToOrigin.add(j2);
      if(j2 === 'j_origin') pointsCoincidentToOrigin.add(j1);
    }
  }

  const origin = joints.get('j_origin');
  const isSnap = activeSnap && activeSnap.type === 'joint' && activeSnap.targetId === 'j_origin';
  const isHover = hoveredJoint === 'j_origin';
  const isSelected = selectedJoints.has('j_origin');
  let originHasCoincident = false;
  for (const c of constraints) {
    if (c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints && c.joints.length >= 2) {
      if (c.joints[0] === 'j_origin' || c.joints[1] === 'j_origin') { originHasCoincident = true; break; }
    }
  }
  // Draw red overlay for joints coincident to origin *beneath* joints (above grid)
  for (const pid of pointsCoincidentToOrigin) {
    const pj = joints.get(pid);
    if (!pj) continue;
    out.push(`<circle cx="${pj.x}" cy="${pj.y}" r="${scale(6)}" fill="#ef4444" style="pointer-events:none; opacity:0.95"/>`);
  }

  // Origin will be rendered as a joint (so it sits in the same z-order as joints and is interactable)
  // We no longer draw the origin here; it will be handled in the joints loop below.
  
  // pointsCoincidentToOrigin computed above (moved up to draw origin beneath joints)

  // --- Coincident visibility: hide joints that are coincident with any other joint
  // However, always keep visible any joint that acts as a circle center or an arc center.
  // Also mark arc endpoints so we can draw larger, easier-to-drag handles.
  const coincidentJoints = new Set();
  const centerJoints = new Set();
  const endpointJoints = new Set();
  for (const s of shapes) {
    if(!s || !s.type) continue;
    if (s.type === 'circle' && s.joints && s.joints[0]) centerJoints.add(s.joints[0]);
    if (s.type === 'arc') {
      if (s.subType === 'CENTER' && s.joints && s.joints[0]) centerJoints.add(s.joints[0]);
      if (s.joints && s.joints[1]) endpointJoints.add(s.joints[1]);
      if (s.joints && s.joints[2]) endpointJoints.add(s.joints[2]);
    }
  }
  for (const c of constraints) {
    if (c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints && c.joints.length >= 2) {
      const [a, b] = c.joints;
      if (a !== 'j_origin') coincidentJoints.add(a);
      if (b !== 'j_origin') coincidentJoints.add(b);
    }
  }
  const isClusterSelected = (id) => {
    if (!selectedJoints || !selectedJoints.has) return false;
    const leader = getClusterLeader(id);
    const members = clusterMembers.get(leader) || [];
    for (const m of members) { if (selectedJoints.has(m)) return true; }
    return false;
  };
  const smartGlyphPosMap = new Map();
  
  // draw joints

  
  // Determine single-frame highlight priority: activeSnap > hovered > (constraint-hover handled separately)
  const highlight = { kind: null, id: null };
  if (activeSnap) { highlight.kind = activeSnap.type; highlight.id = activeSnap.targetId; }
  else if (hoveredJoint) { highlight.kind = 'joint'; highlight.id = hoveredJoint; }
  else if (hoveredConstraint) { highlight.kind = 'constraint'; highlight.id = hoveredConstraint; }

  // Map joint highlights to cluster leaders so the visible leader shows hover/active glow when a follower is hovered
  if (highlight.kind === 'joint' && highlight.id) { highlight.id = getClusterLeader(highlight.id); }

  for(const [id,j] of joints.entries()){ 
    // Render the origin as part of the joint pass so it shares the same z-order and is interactable
    if(id === 'j_origin'){
      // If there are no other joints coincident to origin, origin is 'single' and should behave like an endpoint (visible + handle).
      // If there are coincident joints, hide the origin unless it is hovered/selected/part-of-constraint/activeSnap.
      const originIsSingle = (pointsCoincidentToOrigin.size === 0);
      const isSelectedOrigin = isClusterSelected(id);
      const isHoverOrigin = (hoveredJoint && getClusterLeader(hoveredJoint) === id) && !hoveredConstraint && !hoveredShape;
      const isConstraintPartOrigin = constraintJoints.has(id);

      if (!originIsSingle && originHasCoincident && !isHoverOrigin && !isSelectedOrigin && !isConstraintPartOrigin && !(activeSnap && activeSnap.type === 'joint' && activeSnap.targetId === id)) {
        // Origin is coincident with others and not actively interacted with; hide it like other coincident joints
        continue;
      }

      // Use the same sizing as other joints
      const r = scale(BASE_JOINT_RADIUS);

      // Determine default styling (reuse joint logic) but override fill
      let stroke = '#60A5FA';
      if (fixedJoints.has(id)) stroke = '#202020';
      else if (constrainedJoints.has(id)) stroke = '#202020';

      let strokeW = scale(BASE_JOINT_STROKE);
      if (isConstraintPartOrigin) { stroke = '#3B82F6'; strokeW = scale(BASE_JOINT_STROKE_SELECTED); }
      else if (isHoverOrigin) { stroke = '#1e40af'; strokeW = scale(BASE_JOINT_STROKE_HOVERED); }
      else if (isSelectedOrigin) { stroke = '#1e40af'; strokeW = scale(BASE_JOINT_STROKE_SELECTED); }

      // Use the standard joint fill (no red disc) so origin behaves visually like other joints
      const fill = 'white';

      // Draw glow if highlighted (same rule as joints)
      try {
        const isHighlightOrigin = (highlight.kind === 'joint' && highlight.id === id);
        if (isHighlightOrigin || isSelectedOrigin) {
          const glowR = r;
          const glowStroke = scale(GLOW_WIDTH_PX);
          out.push(`<circle cx="${j.x}" cy="${j.y}" r="${glowR}" stroke="#3B82F6" stroke-width="${glowStroke}" stroke-opacity="0.3" fill="none"/>`);
        }
      } catch (_){ }

      // Draw the origin as a normal joint (white fill) with the shared stroke
      out.push(`<circle cx="${j.x}" cy="${j.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" style="cursor:pointer"/>`);

      // If origin is single, behave like an endpoint: add larger invisible hit-target + subtle ring
      if (originIsSingle) {
        const hitR = r * 1.9;
        out.push(`<circle class="joint-handle" data-joint-id="${id}" cx="${j.x}" cy="${j.y}" r="${hitR}" fill="rgba(0,0,0,0)" style="cursor:pointer"/>`);
        out.push(`<circle cx="${j.x}" cy="${j.y}" r="${r * 1.6}" fill="none" stroke="#9ca3af" stroke-width="${scale(1)}" stroke-opacity="0.12"/>`);
      }

      // continue to next joint (we don't want the regular joint rendering duplicated)
      continue;
    }

    const isSelected = isClusterSelected(id);
    const isHovered = (hoveredJoint && getClusterLeader(hoveredJoint) === id) && !hoveredConstraint && !hoveredShape;
    const isConstraintPart = constraintJoints.has(id);
    // Hide coincident joints unless actively interacted — but keep the cluster leader visible
    const isActiveSnap = (activeSnap && activeSnap.type === 'joint' && activeSnap.targetId === id);
    // Never hide center joints for circles/arcs even if coincident; also never hide the cluster leader
    const isLeader = (getClusterLeader(id) === id);
    const isHiddenCoincident = coincidentJoints.has(id) && !isLeader && !centerJoints.has(id) && !isHovered && !isSelected && !isConstraintPart && !isActiveSnap;
    if (isHiddenCoincident) continue;
    
    // Draw regular point styling with zoom-scaled sizes
    const r = scale(BASE_JOINT_RADIUS);
    let fill = 'white';
    let stroke = '#60A5FA'; // base blue (paler)

    if (fixedJoints.has(id)) {
        fill = 'white';
        stroke = '#202020';
    } else if (constrainedJoints.has(id)) {
        fill = 'white';
        stroke = '#202020';
    } else {
        fill = 'white';
        stroke = '#60A5FA';
    }

    let strokeW = scale(BASE_JOINT_STROKE); // base

    if(isConstraintPart){
      // Highlight joints that belong to a selected constraint: apply thicker stroke but DO NOT add a glow halo
      // (Glow should only appear when the joint/geometry itself is explicitly selected)
      stroke = '#3B82F6'; // Fusion Blue
      strokeW = scale(BASE_JOINT_STROKE_SELECTED);
    } else if(isHovered){
      stroke = '#1e40af'; // darker blue
      strokeW = scale(BASE_JOINT_STROKE_HOVERED);
    } else if(isSelected){
      stroke = '#1e40af'; // darker blue
      strokeW = scale(BASE_JOINT_STROKE_SELECTED);
    }

    // Only draw ONE glow per frame for the active highlight, but allow selected joints to also show glow
    try {
      const isHighlight = (highlight.kind === 'joint' && highlight.id === id);
      if (isHighlight || isClusterSelected(id)) {
        // FIX: Use dynamic radius and scaled stroke width so the glow appears outside the joint
        const glowR = r; // match the joint radius
        const glowStroke = scale(GLOW_WIDTH_PX); // thicker outward stroke for better visibility
        out.push(`<circle cx="${j.x}" cy="${j.y}" r="${glowR}" stroke="#3B82F6" stroke-width="${glowStroke}" stroke-opacity="0.3" fill="none"/>`);
      }
    } catch (_){ }

    // Main joint circle
    out.push(`<circle cx="${j.x}" cy="${j.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" style="cursor:pointer"/>`);

    // If this joint is an arc/circle endpoint, draw an expanded invisible hit-target and subtle ring to make dragging easier
    try {
      if (endpointJoints && endpointJoints.has(id)) {
        // Slightly larger transparent fill for easy mouse capture
        const hitR = r * 1.9;
        out.push(`<circle class="joint-handle" data-joint-id="${id}" cx="${j.x}" cy="${j.y}" r="${hitR}" fill="rgba(0,0,0,0)" style="cursor:pointer"/>`);
        // More visible ring to indicate a draggable handle for arc endpoints
        out.push(`<circle cx="${j.x}" cy="${j.y}" r="${r * 1.6}" fill="none" stroke="#2563eb" stroke-width="${scale(1.5)}" stroke-opacity="0.18"/>`);
      }
    } catch (_){ }
    
    // Check if this joint is coincident to origin (used for other UX flows)
    const isOrigin = pointsCoincidentToOrigin.has(id);
  }
  

  // draw preview (tool previews)
  if(active && active.preview){
    const p = active.preview.pt;
    const previewStroke = '#2563eb';
    const previewOpacity = 0.5;
    const previewDash = `${scale(6)},${scale(6)}`;

    // Arc preview handled independently (does not require active.start/startPt)
    if(active.preview.type === 'arc'){
      const p1 = (active.preview.p1 && joints.has(active.preview.p1)) ? joints.get(active.preview.p1) : null;
      const p2 = (active.preview.p2 && joints.has(active.preview.p2)) ? joints.get(active.preview.p2) : null;
      if (p1) {
        // Draw simple line from first fixed point to cursor while user positions the second point
        out.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p.x}" y2="${p.y}" stroke="${previewStroke}" stroke-width="${scale(2)}" stroke-dasharray="${previewDash}" stroke-opacity="${previewOpacity}"/>`);
      } else if (active.preview.center && typeof active.preview.radius === 'number'){
        const centerJ = (joints.has(active.preview.center)) ? joints.get(active.preview.center) : null;
        const centerPt = centerJ || active.preview.center;
        if(centerPt){
          const radius = active.preview.radius;
          const startAngle = active.preview.startAngle !== undefined ? active.preview.startAngle : Math.atan2((p.y - centerPt.y),(p.x - centerPt.x));
          const endAngle = active.preview.endAngle !== undefined ? active.preview.endAngle : (startAngle + Math.PI);

          const startX = centerPt.x + radius * Math.cos(startAngle);
          const startY = centerPt.y + radius * Math.sin(startAngle);
          const endX = centerPt.x + radius * Math.cos(endAngle);
          const endY = centerPt.y + radius * Math.sin(endAngle);

          // Prioritize explicit winding flags from the tool (fixes flipping during drag)
          let largeArc, sweep;
          if (active.preview.largeArc !== undefined && active.preview.sweep !== undefined) {
            largeArc = active.preview.largeArc ? 1 : 0;
            sweep = active.preview.sweep ? 1 : 0;
          } else {
            largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
            sweep = endAngle > startAngle ? 1 : 0;
          }

          const pathData = `M ${startX},${startY} A ${radius},${radius} 0 ${largeArc},${sweep} ${endX},${endY}`;

          out.push(`<path d="${pathData}" stroke="${previewStroke}" stroke-width="${scale(2)}" stroke-dasharray="${previewDash}" stroke-opacity="${previewOpacity}" fill="none"/>`);
          out.push(`<circle cx="${centerPt.x}" cy="${centerPt.y}" r="${scale(3)}" fill="${previewStroke}" fill-opacity="${previewOpacity}"/>`);
          out.push(`<circle cx="${startX}" cy="${startY}" r="${scale(2)}" fill="${previewStroke}" fill-opacity="${previewOpacity * 0.8}"/>`);
          out.push(`<circle cx="${endX}" cy="${endY}" r="${scale(2)}" fill="${previewStroke}" fill-opacity="${previewOpacity * 0.8}"/>`);
          out.push(`<line x1="${centerPt.x}" y1="${centerPt.y}" x2="${startX}" y2="${startY}" stroke="${previewStroke}" stroke-width="${scale(1)}" stroke-dasharray="${scale(2)},${scale(2)}" stroke-opacity="${previewOpacity * 0.6}"/>`);
        }
      }
    }

    // Resolve active.start safely (ensure joint exists) or fall back to transient startPt
    let a = null;
    if(active.start){ a = joints.has(active.start) ? joints.get(active.start) : null; }
    else if(active.startPt){ a = active.startPt; }
    if(a){
      const p = active.preview.pt;
      const previewStroke = '#2563eb';
      const previewOpacity = 0.5;
      const previewDash = `${scale(6)},${scale(6)}`;
      if(active.preview.type === 'line'){
        out.push(`<line x1="${a.x}" y1="${a.y}" x2="${p.x}" y2="${p.y}" stroke="${previewStroke}" stroke-width="${scale(2)}" stroke-dasharray="${previewDash}" stroke-opacity="${previewOpacity}"/>`);
      } else if(active.preview.type === 'circle'){
        const r = Math.hypot(p.x - a.x, p.y - a.y);
        out.push(`<circle cx="${a.x}" cy="${a.y}" r="${r}" fill="none" stroke="${previewStroke}" stroke-width="${scale(2)}" stroke-dasharray="${previewDash}" stroke-opacity="${previewOpacity}"/>`);
      } else if(active.preview.type === 'polygon'){
        // Draw regular polygon preview using center 'a' and preview point 'p'
        const sides = active.preview.sides || 6;
        const r = Math.hypot(p.x - a.x, p.y - a.y);
        const startAngle = Math.atan2(p.y - a.y, p.x - a.x);
        const pts = [];
        for(let i=0;i<sides;i++){
          const ang = startAngle + (i * 2 * Math.PI / sides);
          pts.push(`${(a.x + Math.cos(ang)*r).toFixed(2)},${(a.y + Math.sin(ang)*r).toFixed(2)}`);
        }
        const ptsStr = pts.join(' ');
        out.push(`<polygon points="${ptsStr}" fill="none" stroke="${previewStroke}" stroke-width="${scale(20)}" stroke-opacity="0.2" stroke-linejoin="round"/>`);
        out.push(`<polygon points="${ptsStr}" fill="none" stroke="${previewStroke}" stroke-width="${scale(2)}" stroke-dasharray="${previewDash}" stroke-opacity="${previewOpacity}"/>`);
      } else if(active.preview.type === 'rect'){
        const minX = Math.min(a.x, p.x);
        const minY = Math.min(a.y, p.y);
        const w = Math.abs(p.x - a.x);
        const h = Math.abs(p.y - a.y);
        
        out.push(`<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="none" stroke="${previewStroke}" stroke-width="${scale(20)}" stroke-opacity="0.2" stroke-linecap="round"/>`);
        out.push(`<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="none" stroke="${previewStroke}" stroke-width="${scale(2)}" stroke-dasharray="${previewDash}" stroke-opacity="${previewOpacity}"/>`);
        
        // Hovering Dimensions
        const fs = scale(12);
        const off = scale(10);
        // Width (Top)
        out.push(`<text x="${minX + w/2}" y="${minY - off}" fill="${previewStroke}" font-size="${fs}" font-weight="bold" text-anchor="middle">${w.toFixed(1)}</text>`);
        // Height (Left)
        out.push(`<text x="${minX - off}" y="${minY + h/2}" fill="${previewStroke}" font-size="${fs}" font-weight="bold" text-anchor="end" dominant-baseline="middle">${h.toFixed(1)}</text>`);

      } else if(active.preview.type === 'rect-center'){
        const dx = p.x - a.x, dy = p.y - a.y;
        const w = Math.abs(dx) * 2;
        const h = Math.abs(dy) * 2;
        const minX = a.x - Math.abs(dx);
        const minY = a.y - Math.abs(dy);
        
        out.push(`<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="none" stroke="${previewStroke}" stroke-width="${scale(20)}" stroke-opacity="0.2" stroke-linecap="round"/>`);
        out.push(`<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="none" stroke="${previewStroke}" stroke-width="${scale(2)}" stroke-dasharray="${previewDash}" stroke-opacity="${previewOpacity}"/>`);
        out.push(`<circle cx="${a.x}" cy="${a.y}" r="${scale(4)}" fill="${previewStroke}" fill-opacity="0.5"/>`);

        // Hovering Dimensions
        const fs = scale(12);
        const off = scale(10);
        // Width (Top)
        out.push(`<text x="${a.x}" y="${minY - off}" fill="${previewStroke}" font-size="${fs}" font-weight="bold" text-anchor="middle">${w.toFixed(1)}</text>`);
        // Height (Left)
        out.push(`<text x="${minX - off}" y="${a.y}" fill="${previewStroke}" font-size="${fs}" font-weight="bold" text-anchor="end" dominant-baseline="middle">${h.toFixed(1)}</text>`);

      // arc preview handled above when present
      } else if(active.preview.type === 'rect-3pt'){
        const b = active.secondPt ? (joints.has(active.secondPt) ? joints.get(active.secondPt) : null) : null;
        if(b){
          const { nx: px, ny: py, len } = perpendicularNormal(a, b);
            if(len > 0.001){
            const h = (p.x - a.x) * px + (p.y - a.y) * py;
            const c3 = { x: b.x + px * h, y: b.y + py * h };
            const c4 = { x: a.x + px * h, y: a.y + py * h };
            out.push(`<polygon points="${a.x},${a.y} ${b.x},${b.y} ${c3.x},${c3.y} ${c4.x},${c4.y}" fill="none" stroke="${previewStroke}" stroke-width="${scale(20)}" stroke-opacity="0.2" stroke-linejoin="round"/>`);
            out.push(`<polygon points="${a.x},${a.y} ${b.x},${b.y} ${c3.x},${c3.y} ${c4.x},${c4.y}" fill="none" stroke="${previewStroke}" stroke-width="${scale(2)}" stroke-dasharray="${previewDash}" stroke-opacity="${previewOpacity}"/>`);
            
            // Hovering Dimensions
            const fs = scale(12);
            const off = scale(15);
            
            // Width (Base a->b)
            const midBase = { x: (a.x + b.x)/2, y: (a.y + b.y)/2 };
            // Normal points towards c4/c3, so reverse it for "outside" label or keep it? 
            // Let's push it "out" away from the rect. If h is positive, normal points in.
            const outDir = h >= 0 ? -1 : 1; 
            out.push(`<text x="${midBase.x + px * off * outDir}" y="${midBase.y + py * off * outDir}" fill="${previewStroke}" font-size="${fs}" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${len.toFixed(1)}</text>`);

            // Height (Side b->c3)
            const midSide = { x: (b.x + c3.x)/2, y: (b.y + c3.y)/2 };
            // Direction of base vector (normalized)
            const bx = (b.x - a.x) / len;
            const by = (b.y - a.y) / len;
            out.push(`<text x="${midSide.x + bx * off}" y="${midSide.y + by * off}" fill="${previewStroke}" font-size="${fs}" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${Math.abs(h).toFixed(1)}</text>`);
          }
        } else {
          out.push(`<line x1="${a.x}" y1="${a.y}" x2="${p.x}" y2="${p.y}" stroke="${previewStroke}" stroke-width="${scale(2)}" stroke-dasharray="${previewDash}" stroke-opacity="${previewOpacity}"/>`);
        }
      }
    }
  }

  if (active && active.type === 'marquee' && active.start && active.end) {
        // Directional Selection Marquee
        const x = Math.min(active.start.x, active.end.x);
        const y = Math.min(active.start.y, active.end.y);
        const w = Math.abs(active.end.x - active.start.x);
        const h = Math.abs(active.end.y - active.start.y);
        
        const isWindow = active.selectMode === 'window';
        // Window (L->R): Purple outline, Orange fill
        // Crossing (R->L): Blue dashed outline, Yellow fill
        const stroke = isWindow ? '#9333ea' : '#3B82F6';
        const fill = isWindow ? '#f97316' : '#eab308';
        const dash = isWindow ? '' : `stroke-dasharray="${scale(8)},${scale(8)}"`;
        
        out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" fill-opacity="0.2" stroke="${stroke}" stroke-width="${scale(1.5)}" ${dash} />`);
  }
  
  // Draw dimension preview while dragging
  if(active && (active.mode === 'dim-line' || (active.mode === 'dim-p2p' && active.j2))){
    const j1 = joints.get(active.joints[0]), j2 = joints.get(active.joints[1]);
    if(j1 && j2){
      const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
      const dx = j2.x - j1.x, dy = j2.y - j1.y;
      const len = Math.hypot(dx, dy);
      const offset = active.offset || SolverConfig.DIMENSION_OFFSET || 30;
      const dist = active.value ? active.value.toFixed(1) : len.toFixed(1);
      
      let nx = 0, ny = -1;
      if(len > 0.01){ nx = -dy / len; ny = dx / len; }
      
      const annotX = mx + nx * offset;
      const annotY = my + ny * offset;
      const ext1End = { x: j1.x + nx * offset, y: j1.y + ny * offset };
      const ext2End = { x: j2.x + nx * offset, y: j2.y + ny * offset };
      const ext1Start = { x: j1.x, y: j1.y };
      const ext2Start = { x: j2.x, y: j2.y };
      
      // Preview extension lines
      out.push(`<line x1="${ext1Start.x}" y1="${ext1Start.y}" x2="${ext1End.x}" y2="${ext1End.y}" stroke="#10b981" stroke-width="${scale(1)}" stroke-dasharray="${scale(4)}"/>`);
      out.push(`<line x1="${ext2Start.x}" y1="${ext2Start.y}" x2="${ext2End.x}" y2="${ext2End.y}" stroke="#10b981" stroke-width="${scale(1)}" stroke-dasharray="${scale(4)}"/>`);
      // Preview dimension line
      out.push(`<line x1="${ext1End.x}" y1="${ext1End.y}" x2="${ext2End.x}" y2="${ext2End.y}" stroke="#10b981" stroke-width="${scale(2)}" stroke-dasharray="${scale(4)}"/>`);
      // Preview text
      const pLabelW = scale(36);
      const pLabelH = scale(14);
      out.push(`<rect x="${annotX - pLabelW/2}" y="${annotY - pLabelH/2 - scale(1)}" width="${pLabelW}" height="${pLabelH}" fill="#10b981" fill-opacity="0.2" rx="${scale(2)}"/>`);
      out.push(`<text x="${annotX}" y="${annotY + scale(3)}" text-anchor="middle" font-size="${scale(11)}" fill="#10b981" font-weight="bold">${dist}</text>`);
    }
  } else if (active && active.mode === 'dim-angle' && active.shapes && active.shapes.length === 2) {
    // Draw Angle Dimension Preview
    const s1 = shapes.find(s => s.id === active.shapes[0]);
    const s2 = shapes.find(s => s.id === active.shapes[1]);
    if (s1 && s2 && s1.joints && s2.joints) {
      const j1 = joints.get(s1.joints[0]), j2 = joints.get(s1.joints[1]);
      const j3 = joints.get(s2.joints[0]), j4 = joints.get(s2.joints[1]);
      if (j1 && j2 && j3 && j4) {
        const int = getLineIntersection(j1, j2, j3, j4);
        if (int) {
          const mp = active.preview && active.preview.pt ? active.preview.pt : (tempMousePos || int);
          const radius = Math.hypot(mp.x - int.x, mp.y - int.y);
          
          const a1 = Math.atan2(j2.y - j1.y, j2.x - j1.x);
          const a2 = Math.atan2(j4.y - j3.y, j4.x - j3.x);
          
          // Determine sector based on mouse position
          const labelAngle = Math.atan2(mp.y - int.y, mp.x - int.x);
          const rays = [a1, a1 + Math.PI, a2, a2 + Math.PI].map(a => {
             let ang = a % (Math.PI * 2);
             if (ang < 0) ang += Math.PI * 2;
             return ang;
          });
          let lAng = labelAngle % (Math.PI * 2);
          if (lAng < 0) lAng += Math.PI * 2;
          
          rays.sort((a, b) => a - b);
          let startAngle = rays[rays.length - 1] - Math.PI * 2;
          let endAngle = rays[0];
          for (let i = 0; i < rays.length - 1; i++) {
              if (lAng >= rays[i] && lAng <= rays[i+1]) {
                  startAngle = rays[i];
                  endAngle = rays[i+1];
                  break;
              }
          }
          
          const sx = int.x + Math.cos(startAngle) * radius;
          const sy = int.y + Math.sin(startAngle) * radius;
          const ex = int.x + Math.cos(endAngle) * radius;
          const ey = int.y + Math.sin(endAngle) * radius;
          
          const previewColor = '#10b981';
          // Normalize delta angle and compute SVG arc flags so the arc follows the sector we chose
          let delta = endAngle - startAngle;
          while (delta < 0) delta += Math.PI * 2;
          while (delta >= Math.PI * 2) delta -= Math.PI * 2;
          const largeArcFlag = (delta > Math.PI) ? 1 : 0;
          const sweepFlag = 1; // draw in positive (CCW) direction from start->end
          out.push(`<path d="M ${sx} ${sy} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${ex} ${ey}" fill="none" stroke="${previewColor}" stroke-width="${scale(1.5)}" stroke-opacity="0.6"/>`);
          // Dashed lines to center
          out.push(`<line x1="${int.x}" y1="${int.y}" x2="${sx}" y2="${sy}" stroke="${previewColor}" stroke-width="${scale(1)}" stroke-dasharray="${scale(4)}" stroke-opacity="0.3"/>`);
          out.push(`<line x1="${int.x}" y1="${int.y}" x2="${ex}" y2="${ey}" stroke="${previewColor}" stroke-width="${scale(1)}" stroke-dasharray="${scale(4)}" stroke-opacity="0.3"/>`);
        }
      }
    }
  }

  // (legacy rubber-band preview removed) — previews handled in the main preview block above
  
  // Use the unified active snap (computed by input-manager) if present, otherwise fall back to snapTarget
  const effectiveSnap = activeSnap || snapTarget;
  // draw snap indicator - show when a snap target is present
  if(effectiveSnap){
    // Normalize snap point into `p` (support .pt, {x,y}, id/targetId resolving)
    let p = null;
    try{
      if (effectiveSnap.pt) p = effectiveSnap.pt;
      else if (typeof effectiveSnap.x === 'number' && typeof effectiveSnap.y === 'number') p = { x: effectiveSnap.x, y: effectiveSnap.y };
      else if (effectiveSnap.targetId && joints && joints.has(effectiveSnap.targetId)) { const j = joints.get(effectiveSnap.targetId); p = { x: j.x, y: j.y }; }
      else if (effectiveSnap.id && joints && joints.has(effectiveSnap.id)) { const j = joints.get(effectiveSnap.id); p = { x: j.x, y: j.y }; }
    }catch(_){ p = null; }

    const isConstraintTool = [CONSTRAINT_TYPES.COINCIDENT, TOOL_MODES.HORIZONTAL_VERTICAL, CONSTRAINT_TYPES.PARALLEL, TOOL_MODES.PERPENDICULAR, CONSTRAINT_TYPES.COLLINEAR, CONSTRAINT_TYPES.TANGENT].includes(currentTool);
    
    if (effectiveSnap.type === 'joint'){
      const canUseJoint = !isConstraintTool || currentTool === CONSTRAINT_TYPES.COINCIDENT;
      if (canUseJoint && p) {
        // If user is actively dragging (snap-on-release), show a double-ring indicator to
        // differentiate from a simple hover/selection. Otherwise draw the small center dot.
        if (isDragging) {
          // Prominent outer ring (much thicker) and darker, matching selection color for strong contrast
          out.push(`<circle cx="${p.x}" cy="${p.y}" r="${scale(18)}" fill="none" stroke="#1e40af" stroke-width="${scale(8)}" stroke-opacity="0.95"/>`);
          // Subtle larger halo to expand visual footprint while remaining unobtrusive
          out.push(`<circle cx="${p.x}" cy="${p.y}" r="${scale(30)}" fill="none" stroke="#1e40af" stroke-width="${scale(2)}" stroke-opacity="0.06"/>`);
        } else {
          // Use the same prominent outer ring even when not actively dragging to keep visuals consistent
          out.push(`<circle cx="${p.x}" cy="${p.y}" r="${scale(18)}" fill="none" stroke="#1e40af" stroke-width="${scale(8)}" stroke-opacity="0.95"/>`);
          out.push(`<circle cx="${p.x}" cy="${p.y}" r="${scale(30)}" fill="none" stroke="#1e40af" stroke-width="${scale(2)}" stroke-opacity="0.06"/>`);
        }
      }
    } else if (effectiveSnap.type === 'line'){
      // Highlight the line being snapped to
      const shape = effectiveSnap.shape;
      if(shape && shape.joints){
        const a = joints.get(shape.joints[0]), b = joints.get(shape.joints[1]);
        if(a && b){
          out.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#2563eb" stroke-width="${scale(4)}" stroke-opacity="0.5"/>`);
        }
      }
      // Only show diamond and X for drawing tools, not constraint tools
      if(!isConstraintTool){
        // Diamond indicator for line snap point
        const diamondSize = 6;
        const diamondStroke = scale(2);
        out.push(`<rect x="${p.x-scale(diamondSize)}" y="${p.y-scale(diamondSize)}" width="${scale(diamondSize*2)}" height="${scale(diamondSize*2)}" fill="#2563eb" fill-opacity="0.3" stroke="#2563eb" stroke-width="${diamondStroke}" transform="rotate(45 ${p.x} ${p.y})"/>`);
        // Small X to indicate coincident will be added
        const xSize = 4;
        const xStroke = scale(2);
        out.push(`<line x1="${p.x-scale(xSize)}" y1="${p.y-scale(xSize)}" x2="${p.x+scale(xSize)}" y2="${p.y+scale(xSize)}" stroke="#2563eb" stroke-width="${xStroke}"/>`);
        out.push(`<line x1="${p.x+scale(xSize)}" y1="${p.y-scale(xSize)}" x2="${p.x-scale(xSize)}" y2="${p.y+scale(xSize)}" stroke="#2563eb" stroke-width="${xStroke}"/>`);
      }
    } else if (effectiveSnap.type === 'grid') {
      // Grid snap indicator: Small solid dot
      if(!isConstraintTool && p){
        out.push(`<circle cx="${p.x}" cy="${p.y}" r="${scale(4)}" fill="#2563eb" stroke="none" opacity="0.8"/>`);
      }
    } else {
      // Generic snap indicator
      if(!isConstraintTool){
        const diamondSize = 6;
        const diamondStroke = scale(2);
        out.push(`<rect x="${p.x-scale(diamondSize)}" y="${p.y-scale(diamondSize)}" width="${scale(diamondSize*2)}" height="${scale(diamondSize*2)}" fill="none" stroke="#2563eb" stroke-width="${diamondStroke}" transform="rotate(45 ${p.x} ${p.y})"/>`);
      }
    }

    // snap-state label removed per UX request; keep only the double-ring indicator above
  }

  // Draw a preview of the constraint that would be created by this snap (red X for coincident, orange diamond for point-on-line)
  try{
    const effectivePreviewSnap = activeSnap || snapTarget;
    if(effectivePreviewSnap && active){
      let previewJointId = null;
      if (active.mode === TOOL_MODES.LINE && active.preview) previewJointId = 'preview_end';
      else if (active.mode === TOOL_MODES.RECT && active.preview) previewJointId = 'preview_corner';
      else if (active.mode === TOOL_MODES.CIRCLE && active.preview) previewJointId = 'preview_radius';
      else previewJointId = '__preview__';

      const preview = previewSnapConstraint(effectivePreviewSnap, previewJointId, { allowPointOnLine: true });
      if (preview) {
        // Normalize preview point (support .pt, x/y, id/targetId)
        let pt = null;
        try{
          if (effectivePreviewSnap.pt) pt = effectivePreviewSnap.pt;
          else if (typeof effectivePreviewSnap.x === 'number' && typeof effectivePreviewSnap.y === 'number') pt = { x: effectivePreviewSnap.x, y: effectivePreviewSnap.y };
          else if (effectivePreviewSnap.targetId && joints && joints.has(effectivePreviewSnap.targetId)) { const j = joints.get(effectivePreviewSnap.targetId); pt = { x: j.x, y: j.y }; }
          else if (effectivePreviewSnap.id && joints && joints.has(effectivePreviewSnap.id)) { const j = joints.get(effectivePreviewSnap.id); pt = { x: j.x, y: j.y }; }
        }catch(_){ pt = null; }

        if(!pt) return;

        if (preview.type === CONSTRAINT_TYPES.COINCIDENT) {
          // Preview coincident using unified glyph (preview mode) with a dummy constraint for hit attributes
          const dummyC = { type: CONSTRAINT_TYPES.COINCIDENT, __isPreview: true };
          drawUnifiedGlyph(dummyC, pt.x, pt.y, 'icon-coincident', 0, { isPreview: true });
        } else if (preview.type === CONSTRAINT_TYPES.POINT_ON_LINE) {
          // Point-on-line preview: show coincident glyph in preview mode (unified Blue)
          const dummyC = { type: CONSTRAINT_TYPES.POINT_ON_LINE, __isPreview: true };
          drawUnifiedGlyph(dummyC, pt.x, pt.y, 'icon-coincident', 0, { isPreview: true });
        }
      }
    }
  }catch(_){ }
  
  // Draw inference hint (horizontal, vertical, perpendicular) - use unified glyphs mapped to constraint types
  if(inference && ((active && active.start) || inference.origin)){
    const start = (active && active.start) ? joints.get(active.start) : inference.origin;
    if(start){
      const offset = scale(GLYPH_OFFSET_PX);
      const ip = inference.pos || inference.pt || { x: start.x, y: start.y };
      let mx = (start.x + ip.x) / 2;
      let my = (start.y + ip.y) / 2;

      if(inference.type === INFERENCE_TYPES.HORIZONTAL) my -= offset;
      else if(inference.type === INFERENCE_TYPES.VERTICAL) mx += offset;
      else if(inference.type === INFERENCE_TYPES.PERPENDICULAR) my -= offset;
      else if(inference.type === INFERENCE_TYPES.TANGENT) my -= offset;

      let cType = null;
      let icon = null;
      let rotation = 0;

      if(inference.type === INFERENCE_TYPES.HORIZONTAL){
        cType = CONSTRAINT_TYPES.HORIZONTAL; icon = 'icon-hv'; rotation = 0;
      } else if(inference.type === INFERENCE_TYPES.VERTICAL){
        cType = CONSTRAINT_TYPES.VERTICAL; icon = 'icon-hv'; rotation = 0;
      } else if(inference.type === INFERENCE_TYPES.PERPENDICULAR){
        cType = CONSTRAINT_TYPES.PERPENDICULAR; icon = 'icon-perpendicular'; rotation = 0;
      } else if(inference.type === INFERENCE_TYPES.PARALLEL){
        cType = CONSTRAINT_TYPES.PARALLEL; icon = 'icon-parallel'; rotation = 0;
      } else if(inference.type === INFERENCE_TYPES.TANGENT){
        cType = CONSTRAINT_TYPES.TANGENT; icon = 'icon-tangent'; rotation = 0;
      }

      if(cType && icon){
        const dummyC = { type: cType, __isPreview: true };
        // Build options for preview. For PARALLEL inference we use a teal hint color; otherwise default to unified blue
        const opts = { isPreview: true };
        drawUnifiedGlyph(dummyC, mx, my, icon, rotation, opts);
      }
    }
  }
  
  // Draw a single constraint glyph (handles preview visuals when c.__isPreview is set)
  function drawConstraintGlyph(svg, c, opts = {}){
    const preview = !!c.__isPreview || !!opts.isPreview;
    const previewAttr = preview ? ' data-preview="1"' : '';
    
    const isGlyphHovered = !preview && highlight.kind === 'constraint' && (highlight.id === c || (opts && opts.parent && highlight.id === opts.parent));
    const isGlyphSelected = !preview && selectedConstraints && selectedConstraints.has(c);

    let clusterLeader = null; let clusterSelected = false;
    

    // Centralized styling: derive fills/strokes from CONSTRAINT_COLORS and unify icon color
    const col = CONSTRAINT_COLORS[c.type] || { fill: '#60A5FA', stroke: '#2563eb' };
    const bgFill = col.fill;
    const bgStroke = col.stroke;
    // Force white icon and accent with !important to override external CSS (selected state etc.)
    const iconStyle = 'style="color: white !important; --icon-accent: white !important;"';
    // Reusable background circle (uses hitZoneRadius derived from GLYPH_BG_DIAMETER_PX)
    const bgCircle = `<circle cx="0" cy="0" r="${hitZoneRadius}" fill="${bgFill}" stroke="${bgStroke}" stroke-width="${scale(1.5)}"/>`; 
    
    if (c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints && c.joints.length >= 2) {
      const leaderA = getClusterLeader(c.joints[0]);
      const leaderB = getClusterLeader(c.joints[1]);
      clusterSelected = isClusterSelected(leaderA) || isClusterSelected(leaderB);
    } else if (c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.joint) {
      const leader = getClusterLeader(c.joint);
      clusterSelected = isClusterSelected(leader);
    }
    // Default: render glyphs; coincident/point-on-line are only visible when their joint is hovered/selected
    let visible = true;
    if (c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints && c.joints.length >= 2) {
      const a = c.joints[0];
      const b = c.joints[1];
      const jointHover = (hoveredJoint === a || hoveredJoint === b);
      const jointSelected = (selectedJoints && (selectedJoints.has(a) || selectedJoints.has(b)));
      visible = preview || isGlyphHovered || isGlyphSelected || jointHover || jointSelected;
    } else if (c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.joint) {
      const jointHover = (hoveredJoint === c.joint);
      const jointSelected = (selectedJoints && selectedJoints.has(c.joint));
      visible = preview || isGlyphHovered || isGlyphSelected || jointHover || jointSelected;
    }
    try{ c.__visible = !!visible; }catch(_){ }

    // Enforce visibility: if the glyph should be hidden (e.g. unselected coincident), do not render it at all.
    if (!visible) { return; }
    
switch(c.type){
      case CONSTRAINT_TYPES.COINCIDENT: {
        const smartPos = smartGlyphPosMap.get(c);
        let posObj;
        if (smartPos) {
          posObj = { x: smartPos.x, y: smartPos.y };
        } else if (c.__pos) {
          posObj = { x: c.__pos.x, y: c.__pos.y };
        } else {
          const j1 = joints.get(c.joints && c.joints[0]) || joints.get(c.joints && c.joints[1]);
          if(!j1) return; const offset = scale(GLYPH_OFFSET_PX);
          posObj = { x: j1.x + offset, y: j1.y - offset };
        }
        // Ensure the computed position is tracked for hit-testing
        try{ c.glyphPos = { x: posObj.x, y: posObj.y }; }catch(_){ }
        const x = posObj.x, y = posObj.y;
        // Respect centralized highlight precedence (computed outside)
        const isHovered = isGlyphHovered;
        const isSelected = isGlyphSelected;
        const stroke = (isHovered || isSelected) ? '#1e40af' : '#2563eb';
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const symbolSize = glyphSize * 0.6;
        // Render coincident glyph with unified helper (bg first, icon last)
        drawUnifiedGlyph(c, posObj.x, posObj.y, 'icon-coincident');
        break;
      }

      case CONSTRAINT_TYPES.HORIZONTAL: {
        const j1 = joints.get(c.joints[0]), j2 = joints.get(c.joints[1]);
        if(!j1 || !j2) return;
        const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
        const { nx, ny } = perpendicularNormal(j1, j2);
        const perpOffset = scale(GLYPH_OFFSET_PX);
        const smartPos = smartGlyphPosMap.get(c);
        const pos = c.__pos ? { x: c.__pos.x, y: c.__pos.y } : (smartPos ? { x: smartPos.x, y: smartPos.y } : { x: mx + nx * perpOffset, y: my + ny * perpOffset });
        try{ c.glyphPos = pos; }catch(_){ }
        const isHovered = !preview && highlight.kind === 'constraint' && (highlight.id === c || (opts && opts.parent && highlight.id === opts.parent));
        const isSelected = !preview && selectedConstraints && selectedConstraints.has(c);
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        // Draw unified horizontal glyph (bg first, icon last)
        drawUnifiedGlyph(c, pos.x, pos.y, 'icon-hv', 0);
        break;
      }

      case CONSTRAINT_TYPES.VERTICAL: {
        const j1 = joints.get(c.joints[0]), j2 = joints.get(c.joints[1]);
        if(!j1 || !j2) return;
        const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
        const { nx, ny } = perpendicularNormal(j1, j2);
        const perpOffset = scale(GLYPH_OFFSET_PX);
        const smartPos = smartGlyphPosMap.get(c);
        const pos = c.__pos ? { x: c.__pos.x, y: c.__pos.y } : (smartPos ? { x: smartPos.x, y: smartPos.y } : { x: mx + nx * perpOffset, y: my + ny * perpOffset });
        try{ c.glyphPos = pos; }catch(_){ }
        const isHovered = !preview && highlight.kind === 'constraint' && (highlight.id === c || (opts && opts.parent && highlight.id === opts.parent));
        const isSelected = !preview && selectedConstraints && selectedConstraints.has(c);
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        // Draw unified vertical glyph (bg first, icon last)
        drawUnifiedGlyph(c, pos.x, pos.y, 'icon-hv', 0);
        break;
      }

      case CONSTRAINT_TYPES.PARALLEL:
      case CONSTRAINT_TYPES.PERPENDICULAR: {
        const s1 = shapes.find(s => s.id === c.shapes[0]);
        if(!s1 || !s1.joints) return;
        const j1 = joints.get(s1.joints[0]), j2 = joints.get(s1.joints[1]);
        if(!j1 || !j2) return;
        const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
        const { nx, ny } = perpendicularNormal(j1, j2);
        const offset = scale(GLYPH_OFFSET_PX);
        let gx = mx + nx * offset, gy = my + ny * offset;
        // Allow explicit placement via c.__pos
        if(c.__pos){ gx = c.__pos.x; gy = c.__pos.y; }
        const pos = { x: gx, y: gy };
        try{ c.glyphPos = pos; }catch(_){ }
        const isHovered = !preview && highlight.kind === 'constraint' && (highlight.id === c || (opts && opts.parent && highlight.id === opts.parent));
        const isSelected = !preview && selectedConstraints && selectedConstraints.has(c);
        const stroke = (isHovered || isSelected) ? '#1e40af' : (c.type === CONSTRAINT_TYPES.PERPENDICULAR ? '#0891b2' : CONSTRAINT_COLORS[CONSTRAINT_TYPES.PERPENDICULAR].stroke);
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = (c.type === CONSTRAINT_TYPES.PERPENDICULAR) ? CONSTRAINT_COLORS[CONSTRAINT_TYPES.PERPENDICULAR].fill : CONSTRAINT_COLORS[CONSTRAINT_TYPES.PARALLEL].fill;
        // Parallel / Perpendicular: use helper to ensure consistent layering
        drawUnifiedGlyph(c, pos.x, pos.y, c.type === CONSTRAINT_TYPES.PARALLEL ? 'icon-parallel' : 'icon-perpendicular');
        break;
      }

      case CONSTRAINT_TYPES.POINT_ON_LINE: {
        const pt = joints.get(c.joint); if(!pt) return;
        const isHovered = isGlyphHovered;
        const isSelected = isGlyphSelected;

        // Draw selection halo (offset upwards to sit above the joint)
        const strokeW = (isHovered || isSelected) ? scale(4) : scale(2.5);
        const bgRadius = (isHovered || isSelected) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';

        const smartPos = smartGlyphPosMap.get(c);
        const pos = c.__pos ? { x: c.__pos.x, y: c.__pos.y } : (smartPos ? { x: smartPos.x, y: smartPos.y } : { x: pt.x, y: pt.y - scale(GLYPH_OFFSET_PX) });
        try{ c.glyphPos = { x: pos.x, y: pos.y }; }catch(_){ }

        // Draw point-on-line using unified helper
        drawUnifiedGlyph(c, pos.x, pos.y, 'icon-coincident');
        break;
      }

      case CONSTRAINT_TYPES.COLLINEAR: {
        // Allow preview-only position via c.__pos or fall back to middle joint
        let px, py;
        let nx = 0, ny = -1;

        if(c.__pos){ px = c.__pos.x; py = c.__pos.y; }
        else {
          if(c.shapes && c.shapes.length >= 2){
             // Position at midpoint of first line
             const s1 = shapes.find(s => s.id === c.shapes[0]);
             if(s1 && s1.joints){
                 const j1 = joints.get(s1.joints[0]), j2 = joints.get(s1.joints[1]);
                 if(j1 && j2){
                     px = (j1.x + j2.x)/2; py = (j1.y + j2.y)/2;
                     const n = perpendicularNormal(j1, j2); nx = n.nx; ny = n.ny;
                 }
             }
          } else if(c.joints && c.joints.length >= 3) {
             const midIdx = Math.floor(c.joints.length / 2);
             const midJoint = joints.get(c.joints[midIdx]); if(!midJoint) return;
             px = midJoint.x; py = midJoint.y;
             // Compute normal from neighbors
             const a = joints.get(c.joints[Math.max(0, midIdx - 1)]);
             const b = joints.get(c.joints[Math.min(c.joints.length - 1, midIdx + 1)]);
             if(a && b){
                const n = perpendicularNormal(a, b); nx = n.nx; ny = n.ny;
             }
          }
        }
        if (px === undefined || py === undefined) return;

        const perpOffset = scale(GLYPH_OFFSET_PX);
        const smartPos = smartGlyphPosMap.get(c);
        const pos = c.__pos ? { x: c.__pos.x, y: c.__pos.y } : (smartPos ? { x: smartPos.x, y: smartPos.y } : { x: px + nx * perpOffset, y: py + ny * perpOffset });
        try{ c.glyphPos = pos; }catch(_){ }
        // Render standard collinear icon
        drawUnifiedGlyph(c, pos.x, pos.y, 'icon-collinear');
        break;
      }

      case CONSTRAINT_TYPES.TANGENT: {
        const lineShape = shapes.find(s => s.id === c.line); const circleShape = shapes.find(s => s.id === c.circle);
        if(!lineShape || !circleShape || !lineShape.joints || !circleShape.joints) return;
        const la = joints.get(lineShape.joints[0]); const lb = joints.get(lineShape.joints[1]); const center = joints.get(circleShape.joints[0]);
        if(!la || !lb || !center) return;
        const mx = (la.x + lb.x) / 2, my = (la.y + lb.y) / 2;
        const { nx, ny } = perpendicularNormal(la, lb);
        const offset = scale(GLYPH_OFFSET_PX);
        const gx = mx + nx * offset, gy = my + ny * offset;
        const isHovered = !preview && highlight.kind === 'constraint' && (highlight.id === c || (opts && opts.parent && highlight.id === opts.parent));
        const isSelected = !preview && selectedConstraints && selectedConstraints.has(c);
        const smartPos = smartGlyphPosMap.get(c);
        const pos = c.__pos ? { x: c.__pos.x, y: c.__pos.y } : (smartPos ? { x: smartPos.x, y: smartPos.y } : { x: gx, y: gy });
        try{ c.glyphPos = pos; }catch(_){ }
        // Render standard tangent icon
        drawUnifiedGlyph(c, pos.x, pos.y, 'icon-tangent');
        break;
      }

      case CONSTRAINT_TYPES.EQUAL: {
        // Equal glyph: midpoint of first shape (usually a line)
        let gx = null, gy = null;
        if (c.__pos) { gx = c.__pos.x; gy = c.__pos.y; }
        else if (c.shapes && c.shapes.length > 0) {
          const s0 = shapes.find(s => s.id === c.shapes[0]);
          if (s0) {
            if (s0.type === 'line' && s0.joints && s0.joints.length >= 2) {
                const a0 = joints.get(s0.joints[0]); const b0 = joints.get(s0.joints[1]);
                if (a0 && b0) { 
                    gx = (a0.x + b0.x)/2; gy = (a0.y + b0.y)/2; 
                    const { nx, ny } = perpendicularNormal(a0, b0);
                    const offset = scale(GLYPH_OFFSET_PX);
                    gx += nx * offset; gy += ny * offset;
                }
            } else if ((s0.type === 'circle' || s0.type === 'arc') && s0.joints && s0.joints.length >= 1) {
                const center = joints.get(s0.joints[0]);
                if (center) {
                    let r = s0.radius;
                    let angle = -Math.PI / 4;
                    if (typeof r !== 'number' && s0.joints.length >= 2) {
                        const rim = joints.get(s0.joints[1]);
                        if (rim) {
                            r = Math.hypot(rim.x - center.x, rim.y - center.y);
                            angle = Math.atan2(rim.y - center.y, rim.x - center.x);
                        }
                    }
                    if (typeof r === 'number' || r > 0) {
                        const offset = scale(GLYPH_OFFSET_PX);
                        gx = center.x + Math.cos(angle) * (r + offset);
                        gy = center.y + Math.sin(angle) * (r + offset);
                    }
                }
            }
          }
        }
        if (gx === null) break;
        const smartPos = smartGlyphPosMap.get(c);
        const pos = c.__pos ? { x: c.__pos.x, y: c.__pos.y } : (smartPos ? { x: smartPos.x, y: smartPos.y } : { x: gx, y: gy });
        try{ c.glyphPos = pos; }catch(_){ }
        const isHoveredE = isGlyphHovered;
        const isSelectedE = isGlyphSelected;
        const bgRadiusE = (isHoveredE || isSelectedE) ? glyphSize + scale(8) : glyphSize + scale(5);
        const bgOpacityE = (isHoveredE || isSelectedE) ? '0.95' : '0.85';
        const bgColorE = CONSTRAINT_COLORS[CONSTRAINT_TYPES.EQUAL].fill;
        if(!preview && (isHoveredE || isSelectedE)) out.push(`<circle cx="0" cy="0" r="${scale(GLYPH_BG_DIAMETER_PX/2 + 6)}" fill="#1e40af" fill-opacity="0.2" stroke="none"/>`);
        const symSize = glyphSize * 0.6;
        const extraEqual = `<circle cx="0" cy="0" r="${bgRadiusE}" fill="${bgFill}" fill-opacity="${bgOpacityE}" stroke="${bgStroke}" stroke-width="${scale(3.5)}"/>` +
                           `<line x1="-${symSize}" y1="-${symSize/3}" x2="${symSize}" y2="-${symSize/3}" stroke="white" stroke-width="${scale(2)}"/>` +
                           `<line x1="-${symSize}" y1="${symSize/3}" x2="${symSize}" y2="${symSize/3}" stroke="white" stroke-width="${scale(2)}"/>`;
        drawUnifiedGlyph(c, pos.x, pos.y, null, 0, { extra: extraEqual });
        break;
      }

      case 'midpoint': {
        // Midpoint glyph: positioned at the midpoint joint (usually index 2) or average of endpoints
        let mx, my;
        if (c.joints && c.joints.length >= 3) {
            const midJ = joints.get(c.joints[2]);
            if (midJ) { mx = midJ.x; my = midJ.y; }
        }
        if (mx === undefined && c.joints && c.joints.length >= 2) {
            const j1 = joints.get(c.joints[0]);
            const j2 = joints.get(c.joints[1]);
            if (j1 && j2) { mx = (j1.x + j2.x)/2; my = (j1.y + j2.y)/2; }
        }
        if (mx === undefined) {
          return;
        }

        const smartPos = smartGlyphPosMap.get(c);
        const pos = c.__pos ? { x: c.__pos.x, y: c.__pos.y } : (smartPos ? { x: smartPos.x, y: smartPos.y } : { x: mx, y: my });
        try{ c.glyphPos = pos; }catch(_){ }

        drawUnifiedGlyph(c, pos.x, pos.y, 'icon-midpoint');
        break;
      }

      default: return;
    }
  }

  // CONSTRAINT GLYPHS - Rendered last so they appear on top of everything
  // glyphSize and hitZoneRadius already defined at top of function

  // Smart Glyph Layout (Anti-overlap): group constraints by visual target and compute glyph positions
  try {
    const buckets = new Map();
    const push = (k, v) => { if(!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(v); };

    for (const c of constraints) {
      // Respect explicit placements: if a constraint already has an explicit __pos, leave it alone
      if (c && c.__pos) { continue; }

      let key = null;
      
      // GLOBAL BUCKETING STRATEGY: Group by visual anchor, regardless of type.
      // Priority: Joint (Cluster) > Shape > Pair

      // 1. Joint-anchored constraints (Coincident, Point-on-Line, etc.)
      // Check if constraint is primarily attached to a single joint (or cluster)
      let primaryJoint = null;
      if (c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints && c.joints.length > 0) primaryJoint = c.joints[0];
      else if (c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.joint) primaryJoint = c.joint;
      else if (c.joint) primaryJoint = c.joint; // Fallback for generic joint constraints

      if (primaryJoint) {
          const leader = getClusterLeader(primaryJoint);
          
          key = `joint:${leader}`;
      }
      
      // 2. Shape-anchored constraints
      if (!key) {
          if (c.shape) key = `shape:${c.shape}`;
          else if (c.shapes && c.shapes.length > 0) key = `shape:${c.shapes[0]}`;
          else if (c.line) key = `shape:${c.line}`;
          else if (c.circle) key = `shape:${c.circle}`;
          // 3. Pair-anchored constraints (Horizontal/Vertical on 2 joints)
          else if (c.joints && c.joints.length >= 2) {
            // Prefer grouping by shape if a line/shape contains both joints
            const aId = c.joints[0], bId = c.joints[1];
            const shapeMatch = shapes.find(s => s.joints && s.joints.length >= 2 && s.joints.includes(aId) && s.joints.includes(bId));
            if (shapeMatch) key = `shape:${shapeMatch.id}`;
            else { const [mn, mx] = [aId, bId].sort(); key = `pair:${mn}|${mx}`; }
          } else {
            key = 'misc';
          }
      }
      push(key, c);
    }

    // Distribute glyphs inside each bucket to avoid overlap
    for (const [k, arr] of buckets) {
      const n = arr.length;
      if (n <= 0) continue;

      if (k.startsWith('shape:')) {
        const sid = k.slice(6);
        const s = shapes.find(ss => ss.id === sid);
        if (s && s.joints && s.joints.length >= 2) {
          // Treat as line: fan around midpoint (radial distribution)
          const jA = joints.get(s.joints[0]), jB = joints.get(s.joints[1]);
          if (jA && jB) {
            const mx = (jA.x + jB.x) / 2, my = (jA.y + jB.y) / 2;
            const r = Math.max(scale(GLYPH_OFFSET_PX), glyphSize * 2);
            for (let i = 0; i < n; i++) {
              const angle = -Math.PI/4 + (i * (2 * Math.PI / n));
              const c = arr[i];
              if (!c.__pos) { smartGlyphPosMap.set(c, { x: mx + Math.cos(angle) * r, y: my + Math.sin(angle) * r }); }
            }
            continue;
          }
        }
        if (s && s.joints && s.joints.length === 1) {
          // Circle: fan radially around center
          const center = joints.get(s.joints[0]);
          const radius = (typeof s.radius === 'number') ? s.radius : Math.max(scale(16), glyphSize * 3);
          for (let i = 0; i < n; i++) {
            const angle = -Math.PI/2 + (i * (2 * Math.PI / n));
            const r = radius + glyphSize * 2;
            const c = arr[i];
            if (!c.__pos) { smartGlyphPosMap.set(c, { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r }); }
          }
          continue;
        }
      }

      // Joint bucket -> fan around joint
      if (k.startsWith('joint:')) {
        const jid = k.substring(6); // Remove 'joint:' prefix (IDs are strings)
        const center = joints.get(jid);
        if (center) {
          // If only 1 glyph, use the standard tight diagonal offset
          if (n === 1) {
             const c = arr[0];
             const offset = scale(GLYPH_OFFSET_PX);
             if (!c.__pos) { smartGlyphPosMap.set(c, { x: center.x + offset, y: center.y - offset }); }
             continue;
          }

          const r = Math.max(scale(GLYPH_OFFSET_PX), glyphSize * 2);
          for (let i = 0; i < n; i++) {
            const angle = -Math.PI/4 + (i * (2 * Math.PI / n)); // Start at -45deg (diagonal)
            const c = arr[i];
            if (!c.__pos) { smartGlyphPosMap.set(c, { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r }); }
          }
          continue;
        }
      }

      // Pair bucket (two joints) - distribute along their line
      if (k.startsWith('pair:')) {
        const parts = k.substring(5).split('|'); 
        const j0 = parts[0], j1 = parts[1];
        const a = joints.get(j0), b = joints.get(j1);
        if (a && b) {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy);
          const ux = len > 0 ? dx / len : 1, uy = len > 0 ? dy / len : 0;
          const spacing = Math.max(ICON_PX * 0.8, scale(12));
          // Calculate normal for offset
          const { nx, ny } = perpendicularNormal(a, b);
          const perpOffset = scale(GLYPH_OFFSET_PX);
          for (let i = 0; i < n; i++) {
            const off = (i - (n - 1) / 2) * spacing;
            const c = arr[i];
            if (!c.__pos) { smartGlyphPosMap.set(c, { x: mx + ux * off + nx * perpOffset, y: my + uy * off + ny * perpOffset }); }
          }
          continue;
        }
      }

      // Fallback: distribute vertically near the view center of the first constraint
      for (let i = 0; i < n; i++) {
        const c = arr[i];
        if (!c.glyphPos && !c.__pos) try { c.glyphPos = { x: (c.__pos ? c.__pos.x : 0) + (i * glyphSize * 1.6), y: (c.__pos ? c.__pos.y : 0) - (i * glyphSize * 1.6) }; } catch (_) {}
      }
    }
  } catch (_){ /* layout pass is best-effort; swallow any errors */ }

  for(const c of constraints){
    if(c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints && c.joints.length >= 2){
      const a = getClusterLeader(c.joints[0]);
      const b = getClusterLeader(c.joints[1]);
      // Default anchor (if not explicitly placed) will be computed dynamically in drawConstraintGlyph
      drawConstraintGlyph(svg, c);
    } else if(c.type === CONSTRAINT_TYPES.MIDPOINT){
      drawConstraintGlyph(svg, c);
    } else if((c.type === CONSTRAINT_TYPES.PARALLEL || c.type === CONSTRAINT_TYPES.EQUAL || c.type === CONSTRAINT_TYPES.COLLINEAR) && c.shapes && c.shapes.length >= 2){
      // Dual-glyph rendering for shape-pair constraints (parallel, equal, collinear)
      // Draw two glyphs - one attached to each shape involved in the parallel constraint
      const s1 = shapes.find(s => s.id === c.shapes[0]);
      const s2 = shapes.find(s => s.id === c.shapes[1]);
      if(s1 && s1.joints && s2 && s2.joints){
        const offset = scale(GLYPH_OFFSET_PX);
        const computePosForShape = (shape) => {
          if (!shape || !shape.joints || shape.joints.length < 1) return null;
          if (shape.type === 'line' && shape.joints.length >= 2) {
            const a = joints.get(shape.joints[0]);
            const b = joints.get(shape.joints[1]);
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const { nx, ny } = perpendicularNormal(a, b);
            return { x: mx + nx * offset, y: my + ny * offset, dir: { x: b.x - a.x, y: b.y - a.y } };
          }
          // Circles/arcs: place glyph just outside radius along a stable angle
          const center = joints.get(shape.joints[0]);
          if (!center) return null;
          let r = shape.radius;
          let angle = -Math.PI / 4;
          if (typeof r !== 'number' && shape.joints.length >= 2) {
            const rim = joints.get(shape.joints[1]);
            if (rim) {
              r = Math.hypot(rim.x - center.x, rim.y - center.y);
              angle = Math.atan2(rim.y - center.y, rim.x - center.x);
            }
          }
          const radius = (typeof r === 'number' && r > 0) ? r : scale(20);
          return { x: center.x + Math.cos(angle) * (radius + offset), y: center.y + Math.sin(angle) * (radius + offset), dir: { x: Math.cos(angle), y: Math.sin(angle) } };
        };

        const p1 = computePosForShape(s1);
        const p2 = computePosForShape(s2);
        if(p1 && p2){
          const c1 = { ...c, __pos: { x: p1.x, y: p1.y } };
          const c2 = { ...c, __pos: { x: p2.x, y: p2.y } };
          try{ c.glyphPos = [{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }]; }catch(_){ }
          drawConstraintGlyph(svg, c1, { parent: c });
          drawConstraintGlyph(svg, c2, { parent: c });
        }
      }
    } else if(c.type === CONSTRAINT_TYPES.PERPENDICULAR && c.shapes && c.shapes.length >= 2){
        // Draw glyph on both shapes participating in perpendicular constraint
        const s1 = shapes.find(s => s.id === c.shapes[0]);
        const s2 = shapes.find(s => s.id === c.shapes[1]);
        if(s1 && s1.joints && s2 && s2.joints){
          const j1a = joints.get(s1.joints[0]), j1b = joints.get(s1.joints[1]);
          const j2a = joints.get(s2.joints[0]), j2b = joints.get(s2.joints[1]);
          if(j1a && j1b && j2a && j2b){
            const mx1 = (j1a.x + j1b.x)/2, my1 = (j1a.y + j1b.y)/2;
            const { nx: nx1, ny: ny1, len: len1 } = perpendicularNormal(j1a, j1b);
            const offset = scale(GLYPH_OFFSET_PX);
            const gx1 = mx1 + nx1 * offset, gy1 = my1 + ny1 * offset;

            const mx2 = (j2a.x + j2b.x)/2, my2 = (j2a.y + j2b.y)/2;
            const { nx: nx2, ny: ny2, len: len2 } = perpendicularNormal(j2a, j2b);
            const gx2 = mx2 + nx2 * offset, gy2 = my2 + ny2 * offset;

            const c1 = { ...c, __pos: { x: gx1, y: gy1 } };
            const c2 = { ...c, __pos: { x: gx2, y: gy2 } };
            try{ c.glyphPos = [{ x: gx1, y: gy1 }, { x: gx2, y: gy2 }]; }catch(_){ }
            drawConstraintGlyph(svg, c1, { parent: c });
            drawConstraintGlyph(svg, c2, { parent: c });
          }
        }
    } else if(c.type === CONSTRAINT_TYPES.DISTANCE){
      // Dimension annotation with leader lines
      let j1 = null, j2 = null;
      if(c.isRadius && c.shape){
        const shape = shapes.find(s => s.id === c.shape);
        if(shape && shape.joints && shape.joints.length >= 1) j1 = joints.get(shape.joints[0]);
      } else if(c.joints && c.joints.length >= 2){
        j1 = joints.get(c.joints[0]); j2 = joints.get(c.joints[1]);
      } else if(c.shapes && c.shapes.length === 2){
        // Line-Line Distance (Parallel)
        const s1 = shapes.find(s => s.id === c.shapes[0]);
        const s2 = shapes.find(s => s.id === c.shapes[1]);
        if(s1 && s2 && s1.joints && s2.joints){
          const l1a = joints.get(s1.joints[0]), l1b = joints.get(s1.joints[1]);
          const l2a = joints.get(s2.joints[0]), l2b = joints.get(s2.joints[1]);
          if(l1a && l1b && l2a && l2b){
            // Project midpoint of s1 onto s2 to get perpendicular distance points
            const mx = (l1a.x + l1b.x)/2, my = (l1a.y + l1b.y)/2;
            j1 = { x: mx, y: my };
            const dx = l2b.x - l2a.x, dy = l2b.y - l2a.y;
            const det = dx*dx + dy*dy;
            if(det > 0.00001){
               const t = ((j1.x - l2a.x)*dx + (j1.y - l2a.y)*dy) / det;
               j2 = { x: l2a.x + t*dx, y: l2a.y + t*dy };
            }
          }
        }
      } else if(c.joint && c.shape){
        // Point-Line Distance
        j1 = joints.get(c.joint);
        const s = shapes.find(s => s.id === c.shape);
        if(j1 && s && s.joints){
           const l1 = joints.get(s.joints[0]), l2 = joints.get(s.joints[1]);
           if(l1 && l2){
             const dx = l2.x - l1.x, dy = l2.y - l1.y;
             const det = dx*dx + dy*dy;
             if(det > 0.00001){
                const t = ((j1.x - l1.x)*dx + (j1.y - l1.y)*dy) / det;
                j2 = { x: l1.x + t*dx, y: l1.y + t*dy };
             }
           }
        }
      }
      if(j1){
        const offset = c.offset || SolverConfig.DIMENSION_OFFSET || 30;
        const cIdx = constraints.indexOf(c);
        const canEdit = currentTool === 'select' || currentTool === TOOL_MODES.DIMENSION;

        if(c.isRadius){
          // Circle radius dimension
          const center = j1;
          const shape = shapes.find(s => s.id === c.shape);
          // Always use actual geometry radius for drawing the arrow so it stays attached to the rim
          const actualRadius = (shape && typeof shape.radius === 'number') ? shape.radius : 0;
          const radius = actualRadius;

          const isPlacing = !!c.__placing;
          const isDrivenFlag = !!(c.isDriven || c.driven);
          const hasValue = (typeof c.value === 'number');
          
          // If driven or placing, show actual geometry value. If driving, show target value.
          const valToShow = (!isDrivenFlag && !isPlacing && hasValue) ? c.value : actualRadius;
          const displayVal = (isDrivenFlag || isPlacing) ? `(${valToShow.toFixed(1)})` : valToShow.toFixed(1);

          // Direction from center to label (use offset as radial distance)
          const angle = (j2 ? Math.atan2(j2.y - center.y, j2.x - center.x) : 0);
          // Prefer explicit placement from import/export: __pos (preferred), then glyphPos, else computed offset
          let labelX, labelY;
          if (c && c.__pos) { labelX = c.__pos.x; labelY = c.__pos.y; }
          else { labelX = center.x + Math.cos(angle) * offset; labelY = center.y + Math.sin(angle) * offset; }

          // Leader line from circle edge to label (ghost appearance when placing)
          const visualOpacity = isPlacing ? 0.4 : 1.0;
          const strokeColor = isPlacing ? '#3B82F6' : '#2563eb';
          const edgeX = center.x + Math.cos(angle) * radius;
          const edgeY = center.y + Math.sin(angle) * radius;

          // Draw leader line
          out.push(`<line x1="${edgeX}" y1="${edgeY}" x2="${labelX}" y2="${labelY}" stroke="${strokeColor}" stroke-width="${scale(1.5)}" stroke-opacity="${visualOpacity}"/>`);

          // Draw radius line
          out.push(`<line x1="${center.x}" y1="${center.y}" x2="${edgeX}" y2="${edgeY}" stroke="${strokeColor}" stroke-width="${scale(1)}" stroke-dasharray="${scale(3)},${scale(2)}" stroke-opacity="${visualOpacity * 0.6}"/>`);

          // Arrow at circle edge
          const arrowSize = scale(6);
          out.push(`<polygon points="${edgeX},${edgeY} ${edgeX - Math.cos(angle)*arrowSize + Math.sin(angle)*arrowSize/2},${edgeY - Math.sin(angle)*arrowSize - Math.cos(angle)*arrowSize/2} ${edgeX - Math.cos(angle)*arrowSize - Math.sin(angle)*arrowSize/2},${edgeY - Math.sin(angle)*arrowSize + Math.cos(angle)*arrowSize/2}" fill="${strokeColor}" opacity="${visualOpacity}"/>`);
          // Label with "R" prefix (wrap in parentheses when driven = false)
          const labelW = scale(50);
          const labelH = scale(18);
          const labelRx = scale(2);
          
          const isSelected = selectedConstraints && selectedConstraints.has(c);
          const labelStrokeColor = isSelected ? '#1e40af' : '#2563eb';
          const labelStrokeWidth = isSelected ? scale(2.5) : scale(1.5);

          if (isSelected) {
            out.push(`<rect x="${labelX - labelW/2}" y="${labelY - labelH/2 - scale(1)}" width="${labelW}" height="${labelH}" fill="none" stroke="${labelStrokeColor}" stroke-width="${scale(GLOW_WIDTH_PX)}" stroke-opacity="0.28" rx="${labelRx}"/>`);
          }
          
          // Driven Toggle Button
          const toggleR = scale(5);
          const toggleX = labelX + labelW/2 + toggleR + scale(4);
          const toggleFill = isDrivenFlag ? 'white' : '#2563eb';
          
          const canEdit = (currentTool === 'select' || currentTool === TOOL_MODES.DIMENSION) && !isDrivenFlag;
          const labelHtml = `<g class="dim-label" data-constraint-idx="${cIdx}" style="cursor:${canEdit ? 'pointer' : 'default'}">
            <rect x="${labelX - labelW/2}" y="${labelY - labelH/2 - scale(1)}" width="${labelW}" height="${labelH}" fill="#9ca3af" fill-opacity="0.9" rx="${labelRx}" stroke="${labelStrokeColor}" stroke-width="${labelStrokeWidth}"/>
            <text x="${labelX}" y="${labelY + scale(4)}" text-anchor="middle" font-size="${scale(11)}" fill="white" font-weight="bold">R ${displayVal}</text>
            <circle class="dim-driven-toggle" data-c-idx="${cIdx}" cx="${toggleX}" cy="${labelY}" r="${toggleR}" fill="${toggleFill}" stroke="#2563eb" stroke-width="${scale(1.5)}" style="cursor:pointer"/>
          </g>`;
          try{ c.glyphPos = { x: labelX, y: labelY }; }catch(_){ }
          if (!c.__editing) { out.push(labelHtml); }
        } else if(j2){
          // Linear dimension (line or point-to-point)
          const mx = (j1.x + j2.x)/2, my = (j1.y + j2.y)/2;
          const dx = j2.x - j1.x, dy = j2.y - j1.y;
          const len = Math.hypot(dx, dy);
          const isPlacing = !!c.__placing;
          const isDrivenFlag = !!(c.isDriven || c.driven);
          const hasValue = (typeof c.value === 'number');
          
          const dimMode = c.dimMode || 'aligned';
          
          let displayVal, nx, ny, annotX, annotY;
          let ext1Start, ext1End, ext2Start, ext2End, dimLineStart, dimLineEnd;
          let adx, ady; // arrow direction
          
          if (dimMode === 'horizontal') {
            // Horizontal: measure X distance, dim line is horizontal, extensions are vertical
            const projDist = Math.abs(j2.x - j1.x);
            const valToShow = (!isDrivenFlag && !isPlacing && hasValue) ? c.value : projDist;
            displayVal = (isDrivenFlag || isPlacing) ? `(${valToShow.toFixed(1)})` : valToShow.toFixed(1);
            
            const midY = (j1.y + j2.y) / 2;
            const dimY = midY + offset;
            
            nx = 0; ny = 1; // extensions go vertical
            ext1Start = { x: j1.x, y: j1.y };
            ext1End = { x: j1.x, y: dimY };
            ext2Start = { x: j2.x, y: j2.y };
            ext2End = { x: j2.x, y: dimY };
            dimLineStart = { x: j1.x, y: dimY };
            dimLineEnd = { x: j2.x, y: dimY };
            annotX = (j1.x + j2.x) / 2;
            annotY = dimY;
            adx = j2.x > j1.x ? 1 : -1; ady = 0;
            
          } else if (dimMode === 'vertical') {
            // Vertical: measure Y distance, dim line is vertical, extensions are horizontal
            const projDist = Math.abs(j2.y - j1.y);
            const valToShow = (!isDrivenFlag && !isPlacing && hasValue) ? c.value : projDist;
            displayVal = (isDrivenFlag || isPlacing) ? `(${valToShow.toFixed(1)})` : valToShow.toFixed(1);
            
            const midX = (j1.x + j2.x) / 2;
            const dimX = midX + offset;
            
            nx = 1; ny = 0; // extensions go horizontal
            ext1Start = { x: j1.x, y: j1.y };
            ext1End = { x: dimX, y: j1.y };
            ext2Start = { x: j2.x, y: j2.y };
            ext2End = { x: dimX, y: j2.y };
            dimLineStart = { x: dimX, y: j1.y };
            dimLineEnd = { x: dimX, y: j2.y };
            annotX = dimX;
            annotY = (j1.y + j2.y) / 2;
            adx = 0; ady = j2.y > j1.y ? 1 : -1;
            
          } else {
            // Aligned (default — existing behavior)
            const valToShow = (!isDrivenFlag && !isPlacing && hasValue) ? c.value : len;
            displayVal = (isDrivenFlag || isPlacing) ? `(${valToShow.toFixed(1)})` : valToShow.toFixed(1);
            
            nx = 0; ny = -1;
            if (len > 0.01) { nx = -dy / len; ny = dx / len; }
            
            if (c && c.__pos) { annotX = c.__pos.x; annotY = c.__pos.y; }
            else { annotX = mx + nx * offset; annotY = my + ny * offset; }
            
            ext1Start = { x: j1.x, y: j1.y };
            ext1End = { x: j1.x + nx * offset, y: j1.y + ny * offset };
            ext2Start = { x: j2.x, y: j2.y };
            ext2End = { x: j2.x + nx * offset, y: j2.y + ny * offset };
            dimLineStart = ext1End;
            dimLineEnd = ext2End;
            adx = dx / len; ady = dy / len;
          }

          // Visual ghosting when placing
          const visualOpacity = isPlacing ? 0.4 : 1.0;
          const strokeColor = isPlacing ? '#3B82F6' : '#2563eb';

          // Draw extension lines
          out.push(`<line x1="${ext1Start.x}" y1="${ext1Start.y}" x2="${ext1End.x}" y2="${ext1End.y}" stroke="${strokeColor}" stroke-width="${scale(1)}" stroke-opacity="${0.6 * visualOpacity}"/>`);
          out.push(`<line x1="${ext2Start.x}" y1="${ext2Start.y}" x2="${ext2End.x}" y2="${ext2End.y}" stroke="${strokeColor}" stroke-width="${scale(1)}" stroke-opacity="${0.6 * visualOpacity}"/>`);

          // Draw dimension line with arrows
          out.push(`<line x1="${dimLineStart.x}" y1="${dimLineStart.y}" x2="${dimLineEnd.x}" y2="${dimLineEnd.y}" stroke="${strokeColor}" stroke-width="${scale(1.5)}" stroke-opacity="${visualOpacity}"/>`);

          // Arrow markers (small triangles at ends)
          const arrowSizeLin = scale(6);
          out.push(`<polygon points="${dimLineStart.x},${dimLineStart.y} ${dimLineStart.x + adx*arrowSizeLin + nx*arrowSizeLin/2},${dimLineStart.y + ady*arrowSizeLin + ny*arrowSizeLin/2} ${dimLineStart.x + adx*arrowSizeLin - nx*arrowSizeLin/2},${dimLineStart.y + ady*arrowSizeLin - ny*arrowSizeLin/2}" fill="${strokeColor}"/>`);
          out.push(`<polygon points="${dimLineEnd.x},${dimLineEnd.y} ${dimLineEnd.x - adx*arrowSizeLin + nx*arrowSizeLin/2},${dimLineEnd.y - ady*arrowSizeLin + ny*arrowSizeLin/2} ${dimLineEnd.x - adx*arrowSizeLin - nx*arrowSizeLin/2},${dimLineEnd.y - ady*arrowSizeLin - ny*arrowSizeLin/2}" fill="${strokeColor}"/>`);

          // Clickable text label with background (only editable in select or dim tool)
          const labelW = scale(40);
          const labelH = scale(18);
          const labelRx = scale(2);
          
          const isSelected = selectedConstraints && selectedConstraints.has(c);
          const labelStrokeColor = isSelected ? '#1e40af' : '#2563eb';
          const labelStrokeWidth = isSelected ? scale(2.5) : scale(1.5);

          if (isSelected) {
            out.push(`<rect x="${annotX - labelW/2}" y="${annotY - labelH/2 - scale(1)}" width="${labelW}" height="${labelH}" fill="none" stroke="${labelStrokeColor}" stroke-width="${scale(GLOW_WIDTH_PX)}" stroke-opacity="0.28" rx="${labelRx}"/>`);
          }

          // Driven Toggle Button
          const toggleR = scale(5);
          const toggleX = annotX + labelW/2 + toggleR + scale(4);
          const toggleFill = isDrivenFlag ? 'white' : '#2563eb';

          const canEdit = (currentTool === 'select' || currentTool === TOOL_MODES.DIMENSION) && !isDrivenFlag;
          const labelHtml = `<g class="dim-label" data-constraint-idx="${cIdx}" style="cursor:${canEdit ? 'pointer' : 'default'}">
            <rect x="${annotX - labelW/2}" y="${annotY - labelH/2 - scale(1)}" width="${labelW}" height="${labelH}" fill="#9ca3af" fill-opacity="0.9" rx="${labelRx}" stroke="${labelStrokeColor}" stroke-width="${labelStrokeWidth}"/>
            <text x="${annotX}" y="${annotY + scale(4)}" text-anchor="middle" font-size="${scale(11)}" fill="white" font-weight="bold">${displayVal}</text>
            <circle class="dim-driven-toggle" data-c-idx="${cIdx}" cx="${toggleX}" cy="${annotY}" r="${toggleR}" fill="${toggleFill}" stroke="#2563eb" stroke-width="${scale(1.5)}" style="cursor:pointer"/>
          </g>`;
          try{ c.glyphPos = { x: annotX, y: annotY }; }catch(_){ }
          if (!c.__editing) { out.push(labelHtml); }
        }
      }
    } else if (c.type === CONSTRAINT_TYPES.ANGLE && c.shapes && c.shapes.length === 2) {
      // Angle Dimension
      const s1 = shapes.find(s => s.id === c.shapes[0]);
      const s2 = shapes.find(s => s.id === c.shapes[1]);
      if (s1 && s2 && s1.joints && s2.joints) {
        const j1 = joints.get(s1.joints[0]), j2 = joints.get(s1.joints[1]);
        const j3 = joints.get(s2.joints[0]), j4 = joints.get(s2.joints[1]);
        if (j1 && j2 && j3 && j4) {
          const int = getLineIntersection(j1, j2, j3, j4);
          if (int) {
            const radius = c.offset || SolverConfig.ANGLE_OFFSET || 40;
            // Determine angles of the two lines relative to intersection
            const a1 = Math.atan2(j2.y - j1.y, j2.x - j1.x);
            const a2 = Math.atan2(j4.y - j3.y, j4.x - j3.x);
            
            // Determine which sector the label is in (glyphPos or default)
            // Use glyphPos to determine sector, but compute actual label position on the arc
            let sectorAngle;
            if (c.glyphPos) {
                sectorAngle = Math.atan2(c.glyphPos.y - int.y, c.glyphPos.x - int.x);
            } else if (c.__pos) {
                sectorAngle = Math.atan2(c.__pos.y - int.y, c.__pos.x - int.x);
            } else {
                sectorAngle = (a1 + a2) / 2;
            }
            
            // Normalize sectorAngle to 0-2PI
            let sAng = sectorAngle % (Math.PI * 2);
            if (sAng < 0) sAng += Math.PI * 2;
            
            // We have 4 rays from intersection: a1, a1+PI, a2, a2+PI.
            const rays = [a1, a1 + Math.PI, a2, a2 + Math.PI].map(a => {
                let ang = a % (Math.PI * 2);
                if (ang < 0) ang += Math.PI * 2;
                return ang;
            });
            
            // Sort rays and find the sector containing the label
            rays.sort((a, b) => a - b);
            let startAngle = rays[rays.length - 1] - Math.PI * 2;
            let endAngle = rays[0];
            for (let i = 0; i < rays.length - 1; i++) {
                if (sAng >= rays[i] && sAng <= rays[i+1]) {
                    startAngle = rays[i];
                    endAngle = rays[i+1];
                    break;
                }
            }
            
            // Compute label position: bisector of the sector, at arc radius
            const bisect = (startAngle + endAngle) / 2;
            const labelX = int.x + Math.cos(bisect) * radius;
            const labelY = int.y + Math.sin(bisect) * radius;
            
            // Draw Arc
            const sx = int.x + Math.cos(startAngle) * radius;
            const sy = int.y + Math.sin(startAngle) * radius;
            const ex = int.x + Math.cos(endAngle) * radius;
            const ey = int.y + Math.sin(endAngle) * radius;
            
            const isPlacing = !!c.__placing;
            const strokeColor = isPlacing ? '#3B82F6' : '#2563eb';
            const visualOpacity = isPlacing ? 0.4 : 1.0;
            
            // Normalize delta to [0, 2PI) and compute proper SVG arc flags so arc visually matches the chosen sector
            let delta = endAngle - startAngle;
            while (delta < 0) delta += Math.PI * 2;
            while (delta >= Math.PI * 2) delta -= Math.PI * 2;
            const largeArcFlag = (delta > Math.PI) ? 1 : 0;
            const sweepFlag = 1;
            out.push(`<path d="M ${sx} ${sy} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${ex} ${ey}" fill="none" stroke="${strokeColor}" stroke-width="${scale(1.5)}" stroke-opacity="${visualOpacity}"/>`);
            
            // Draw Arrows
            const arrowSize = scale(6);
            // Start Arrow
            out.push(`<polygon points="${sx},${sy} ${sx - Math.sin(startAngle)*arrowSize/2 + Math.cos(startAngle)*arrowSize},${sy + Math.cos(startAngle)*arrowSize/2 + Math.sin(startAngle)*arrowSize} ${sx + Math.sin(startAngle)*arrowSize/2 + Math.cos(startAngle)*arrowSize},${sy - Math.cos(startAngle)*arrowSize/2 + Math.sin(startAngle)*arrowSize}" fill="${strokeColor}" opacity="${visualOpacity}"/>`);
            // End Arrow
            out.push(`<polygon points="${ex},${ey} ${ex - Math.sin(endAngle)*arrowSize/2 - Math.cos(endAngle)*arrowSize},${ey + Math.cos(endAngle)*arrowSize/2 - Math.sin(endAngle)*arrowSize} ${ex + Math.sin(endAngle)*arrowSize/2 - Math.cos(endAngle)*arrowSize},${ey - Math.cos(endAngle)*arrowSize/2 - Math.sin(endAngle)*arrowSize}" fill="${strokeColor}" opacity="${visualOpacity}"/>`);
            
            // Label (scaled like linear dimensions)
            const isDrivenFlag = !!(c.isDriven || c.driven);
            const hasValue = (typeof c.value === 'number');
            
            // Use the normalized sector delta for display; prefer stored c.value when present
            const currentAngleDeg = delta * 180 / Math.PI;
            // Always display the smaller equivalent angle (<= 180°)
            const currentAngleShown = (currentAngleDeg > 180) ? (360 - currentAngleDeg) : currentAngleDeg;
            const valToShow = (!isDrivenFlag && !isPlacing && hasValue) ? c.value : currentAngleShown;
            const displayVal = (isDrivenFlag || isPlacing) ? `(${valToShow.toFixed(1)}°)` : valToShow.toFixed(1) + '°';

            const cIdx = constraints.indexOf(c);
            
            const labelW = scale(40);
            const labelH = scale(18);
            const labelRx = scale(2);
            
            const isSelected = selectedConstraints && selectedConstraints.has(c);
            const labelStrokeColor = isSelected ? '#1e40af' : '#2563eb';
            const labelStrokeWidth = isSelected ? scale(2.5) : scale(1.5);

            if (isSelected) {
                out.push(`<rect x="${labelX - labelW/2}" y="${labelY - labelH/2 - scale(1)}" width="${labelW}" height="${labelH}" fill="none" stroke="${labelStrokeColor}" stroke-width="${scale(GLOW_WIDTH_PX)}" stroke-opacity="0.28" rx="${labelRx}"/>`);
            }

            const toggleR = scale(5);
            const toggleX = labelX + labelW/2 + toggleR + scale(4);
            const toggleFill = isDrivenFlag ? 'white' : '#2563eb';
            
            const canEdit = (currentTool === 'select' || currentTool === TOOL_MODES.DIMENSION) && !isDrivenFlag;
            const labelHtml = `<g class="dim-label" data-constraint-idx="${cIdx}" style="cursor:${canEdit ? 'pointer' : 'default'}">
                <rect x="${labelX - labelW/2}" y="${labelY - labelH/2 - scale(1)}" width="${labelW}" height="${labelH}" fill="#9ca3af" fill-opacity="0.9" rx="${labelRx}" stroke="${labelStrokeColor}" stroke-width="${labelStrokeWidth}"/>
                <text x="${labelX}" y="${labelY + scale(4)}" text-anchor="middle" font-size="${scale(11)}" fill="white" font-weight="bold">${displayVal}</text>
                <circle class="dim-driven-toggle" data-c-idx="${cIdx}" cx="${toggleX}" cy="${labelY}" r="${toggleR}" fill="${toggleFill}" stroke="#2563eb" stroke-width="${scale(1.5)}" style="cursor:pointer"/>
            </g>`;
            
            // Store computed label position for hit testing and dragging
            try{ c.glyphPos = { x: labelX, y: labelY }; }catch(_){ }
            if (!c.__editing) { out.push(labelHtml); }
          }
        }
      }
    } else if(c.type === CONSTRAINT_TYPES.POINT_ON_LINE){
      // Small circle with dot for point-on-line constraint
      // FIGURATIVE COINCIDENT: Hidden by default; drawConstraintGlyph will reveal when the attached joint/cluster is selected
      const pt = joints.get(c.joint);
      const shape = shapes.find(s => s.id === c.shape);
      if(pt && shape){
        const isHovered = highlight.kind === 'constraint' && highlight.id === c;
        const isSelected = selectedConstraints && selectedConstraints.has(c);
        const stroke = (isHovered || isSelected) ? '#1e40af' : '#f97316';
        const strokeW = (isHovered || isSelected) ? scale(2.5) : scale(1.5);
        const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
        const bgColor = '#fb923c'; // orange for point-on-line
        drawConstraintGlyph(svg, c);
      }
    } else if(c.type === CONSTRAINT_TYPES.COLLINEAR){
      // Three dots in a line for collinear constraint
      if(c.shapes && c.shapes.length >= 2){
          // Shape-based collinear
          const s1 = shapes.find(s => s.id === c.shapes[0]);
          if(s1 && s1.joints){
             const j1 = joints.get(s1.joints[0]);
             if(j1){
                 // Just trigger the draw call, position logic is inside drawConstraintGlyph
                 drawConstraintGlyph(svg, c);
             }
          }
      }
      else if(c.joints && c.joints.length >= 3){
        // Legacy Joint-based Position at the middle joint
        const midIdx = Math.floor(c.joints.length / 2);
        const midJoint = joints.get(c.joints[midIdx]);
        if(midJoint){
          drawConstraintGlyph(svg, c);
        }
      }
    } else if(c.type === CONSTRAINT_TYPES.TANGENT){
      // Circle touching a line for tangent constraint
      const lineShape = shapes.find(s => s.id === c.line);
      const circleShape = shapes.find(s => s.id === c.circle);
      if(lineShape && circleShape && lineShape.joints && circleShape.joints){
        const la = joints.get(lineShape.joints[0]);
        const lb = joints.get(lineShape.joints[1]);
        const center = joints.get(circleShape.joints[0]);
        if(la && lb && center){
          // Position glyph at the midpoint of the line
          const mx = (la.x + lb.x) / 2, my = (la.y + lb.y) / 2;
          const { nx, ny } = perpendicularNormal(la, lb);
          const offset = scale(GLYPH_OFFSET_PX);
          const gx = mx + nx * offset, gy = my + ny * offset;
          
          const isHovered = highlight.kind === 'constraint' && highlight.id === c;
          const isSelected = selectedConstraints && selectedConstraints.has(c);
          const stroke = (isHovered || isSelected) ? '#1e40af' : '#f59e0b';
          const bgOpacity = (isHovered || isSelected) ? '0.95' : '0.85';
          const bgColor = '#fbbf24'; // yellow for tangent
          const symbolSize = glyphSize * 0.6; // Smaller symbols
          drawConstraintGlyph(svg, c);
        }
      }
    }
    else if(c.type === CONSTRAINT_TYPES.HORIZONTAL && c.joints && c.joints.length >= 2){
      // Horizontal constraint glyph (single midpoint glyph)
      drawConstraintGlyph(svg, c);
    } else if(c.type === CONSTRAINT_TYPES.VERTICAL && c.joints && c.joints.length >= 2){
      // Vertical constraint glyph (single midpoint glyph)
      drawConstraintGlyph(svg, c);
    }

  }

  // Debug: constraint visibility summary (use: ug.debug.enable('renderer'))
  dbg.log('renderer', 'constraints', { total: (constraints || []).length, visible: (constraints || []).filter(c => c && (c.__isPreview || c.__visible !== false)).length });

  // Apply accumulated SVG markup in a single DOM update to avoid partial-frame painting.
  // Ensure overlays that must be on top are appended last (guarantees highest stacking within this SVG)
  if (lateOverlay) out.push(lateOverlay);
  // PERFORMANCE: Skip the expensive innerHTML write if the markup is identical to last frame.
  // This avoids full DOM teardown/rebuild when the model is static (no drag, no hover change).
  const markup = out.join('');
  const target = (renderTarget && renderTarget instanceof Element) ? renderTarget : svg;
  if (target._lastMarkup !== markup) {
    target.innerHTML = markup;
    target._lastMarkup = markup;
  }

}