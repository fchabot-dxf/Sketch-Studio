// packages/ui/tool-ribbon.js — the shared, SketchStudio-style tool ribbon (S7a).
// Grouped, icon-over-label tool buttons over the SHARED sketch: Create / Inspect / Constrain. App-agnostic
// chrome — each button wires to the SAME shared tool-switch (switchToTool) the keyboard + the simple palette use,
// so the on-canvas behaviour is unchanged. A host appends its OWN app-specific groups (Edit / Actions / …) via
// `extraGroups`, and `on` surfaces button events. Themed via --sk-* (light defaults → SketchStudio; a dark :root
// → Shaper) from the SAME component. Self-contained: injects its <style> once + inject-IF-MISSING icon symbols
// (reuses cursor-manager's ICONS, the single source of truth) so #icon-* resolve in any host.

import { switchToTool, toggleFixedSelection, selectionLockState, TOOL_BEGIN } from '#ui/input-manager.js';
import { ensureIconSymbols } from '#ui/cursor-manager.js';
import { TOOL_MODES, RECT_MODES, SLOT_MODES } from '#core/constants.js';
import { doCombine, doUncombine } from '#ui/profile-actions.js';
import { listenOutsidePress } from '#ui/outside-press.js';
import { SHORT_VIEWPORT_QUERY, isShortViewport } from '#ui/short-viewport.js';
import { loadSection, saveSection, defaultSection, onRibbonLayoutChange, sameSection } from '#ui/ribbon-layout.js';
import { titleWithShortcut, shortcutHint, onShortcutsChange } from '#ui/shortcuts.js'; // TASK 740: each button's title shows its key, read from THE declaration (TASK 747: and follows the user's keys)
import { mountTooltip } from '#ui/hint.js';
import { RIBBON_HINTS } from '#ui/design-hints.js';

// TASK 647: the ribbon never scrolls. Each section shows the tools that are "in the bar" (the user's checkboxes) and fit, then its NAME, a button
// that opens the section's dropdown (every tool of the section: run it, check it in / out of the bar, hold-drag its grip to reorder). The fit
// aims for MIN_PER_SECTION_PREFERRED tools in every section; where that cannot fit for every section it is MIN_PER_SECTION; the space left is
// shared out in section order (see fit()).
export const MIN_PER_SECTION_PREFERRED = 2;
export const MIN_PER_SECTION = 1;
const HOLD_MS = 300;      // a press on a grip held this long (without moving HOLD_SLOP px) starts the reorder drag; a move before it is a scroll
const HOLD_SLOP = 6;

// Rect variants (the dropdown) — sets state.rectMode + swaps the rect button's icon/label, like ui-manager.
const RECT_VARIANTS = [
  { mode: RECT_MODES.TWO_POINT,   icon: 'icon-tool-rect-2pt',    label: '2-Point (Corner)' },
  { mode: RECT_MODES.CENTER,      icon: 'icon-tool-rect-center', label: 'Center Point' },
  { mode: RECT_MODES.THREE_POINT, icon: 'icon-tool-rect-3pt',    label: '3-Point' },
];
// Slot variants (Fusion 360 Create > Slot order & labels) — reuses the same dropdown mechanism as Rect.
const SLOT_VARIANTS = [
  { mode: SLOT_MODES.CENTER_TO_CENTER, icon: 'icon-tool-slot-c2c',       label: 'Center to Center Slot' },
  { mode: SLOT_MODES.OVERALL,          icon: 'icon-tool-slot-overall',   label: 'Overall Slot' },
  { mode: SLOT_MODES.CENTER_POINT,     icon: 'icon-tool-slot-center',    label: 'Center Point Slot' },
  { mode: SLOT_MODES.THREE_POINT_ARC,  icon: 'icon-tool-slot-arc3',      label: 'Three Point Arc Slot' },
  { mode: SLOT_MODES.CENTER_POINT_ARC, icon: 'icon-tool-slot-arccenter', label: 'Center Point Arc Slot' },
];

// The SHARED sketcher groups (icon = cursor-manager symbol id; label = the SketchStudio button label; shortcut = its id in shortcuts.js, TASK 740:
// the key that does what the button does, shown in the button's title).
// TASK 647: Select is its own section, first, like Fusion's SELECT panel.
const SELECT = [
  { tool: TOOL_MODES.SELECT, icon: 'icon-tool-select',  label: 'Select', shortcut: 'tool.select' },
];
const CREATE = [
  { tool: TOOL_MODES.LINE,    icon: 'icon-tool-line',     label: 'Line', shortcut: 'tool.line' },
  { tool: TOOL_MODES.RECT,    icon: 'icon-tool-rect-2pt', label: 'Rect', variants: RECT_VARIANTS, modeKey: 'rectMode', eventName: 'rectMode', shortcut: 'tool.rect' },
  { tool: TOOL_MODES.SLOT,    icon: 'icon-tool-slot-c2c', label: 'Slot', variants: SLOT_VARIANTS, modeKey: 'slotMode', eventName: 'slotMode', shortcut: 'tool.slot' },
  { tool: TOOL_MODES.CIRCLE,  icon: 'icon-tool-circle',   label: 'Circle', shortcut: 'tool.circle' },
  { tool: TOOL_MODES.POLYGON, icon: 'icon-tool-polygon',  label: 'Polygon', shortcut: 'tool.polygon' }, // TASK 483: regular polygon; TASK 596: its side count is an on-canvas box after the centre click
  { tool: TOOL_MODES.ARC,     icon: 'icon-tool-arc-cse',  label: 'Arc', shortcut: 'tool.arc' }, // single-mode in the source (no dropdown)
  { tool: TOOL_MODES.BEZIER,  icon: 'icon-tool-bezier',   label: 'Bezier', shortcut: 'tool.bezier' }, // UNIFY-3-tool: shared pen tool (all apps)
  { tool: TOOL_MODES.TEXT,    icon: 'icon-tool-text',     label: 'Text', shortcut: 'tool.text' }, // TASK 845: editable text (#ui/input-handlers/text-tool.js)
];
// TRACE-1: Edit/modify tools — trim + break. No cursor-manager symbols yet; icons provided as SVG inline.
const EDIT = [
  { tool: TOOL_MODES.TRIM,  iconSvg: '<path d="M4 12h6M14 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="#ef4444"/>', label: 'Trim', shortcut: 'tool.trim' },
  { tool: TOOL_MODES.BREAK, iconSvg: '<path d="M5 12h5M14 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" stroke="#fbbf24" stroke-width="2" fill="none"/>', label: 'Break', shortcut: 'tool.break' },
  // TASK 760 (owner: "beside Break"): Close path. Switching to it closes the selection's open chains, else waits for a click on one (#ui/close-path-actions.js).
  // Icon: an open outline, its two ends dotted, the closing segment in the warning amber the open-end markers use.
  { tool: TOOL_MODES.CLOSE_PATH, label: 'Close', title: 'Close path: join the two free ends of an open outline', ariaLabel: 'Close Path', shortcut: 'tool.closePath',
    iconSvg: '<path d="M8 19L4 12l4-7h8l4 7-4 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/><path d="M8.5 19h7" stroke="#f59e0b" stroke-width="2" stroke-dasharray="2 1.6"/><circle cx="8" cy="19" r="1.6" fill="currentColor"/><circle cx="16" cy="19" r="1.6" fill="currentColor"/>' },
  { tool: TOOL_MODES.FILLET, iconSvg: '<path d="M5 19V12a7 7 0 0 1 7-7h7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M5 12V5h7" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="2 2" fill="none"/>', label: 'Fillet', shortcut: 'tool.fillet' },
  // TASK 585: Mirror. Switching to it starts its pick (the pre-selection: input-manager.js TOOL_BEGIN). TASK 647 (owner): in Modify after Fillet, not Create
  // (Fusion keeps Mirror under CREATE: a declared divergence).
  { tool: TOOL_MODES.MIRROR, icon: 'icon-tool-mirror',  label: 'Mirror', title: 'Mirror: the objects, then the mirror line, then Enter', shortcut: 'tool.mirror' },
  // TASK 658: Fusion's Circular / Rectangular Pattern (owner ruling: in Modify right after Mirror; Fusion keeps them under CREATE: a declared
  // divergence). Switching to one opens the pattern dialog (TOOL_BEGIN; a pre-selection is the objects). Icons: the source solid, its copies dashed (the Fillet / Offset style).
  { tool: TOOL_MODES.CIRCULAR_PATTERN, label: 'Circular', title: 'Circular Pattern', ariaLabel: 'Circular Pattern', shortcut: 'tool.circularPattern',
    iconSvg: '<circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="4.5" r="2.6" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="18.5" cy="15.8" r="2.6" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="2 1.5" fill="none"/><circle cx="5.5" cy="15.8" r="2.6" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="2 1.5" fill="none"/>' },
  { tool: TOOL_MODES.RECTANGULAR_PATTERN, label: 'Rect Pat', title: 'Rectangular Pattern', ariaLabel: 'Rectangular Pattern', shortcut: 'tool.rectangularPattern',
    iconSvg: '<rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2" fill="none"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="2 1.5" fill="none"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="2 1.5" fill="none"/><rect x="14" y="14" width="7" height="7" rx="1" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="2 1.5" fill="none"/>' },
  // TASK 650: like Fusion's Create > Offset (owner ruling: in Modify). Icon: a curve and its dashed offset, in the Fillet icon's style.
  { tool: TOOL_MODES.OFFSET, iconSvg: '<path d="M4 20V11a7 7 0 0 1 7-7h9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M9 20v-8a3 3 0 0 1 3-3h8" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="2 2" fill="none" stroke-linecap="round"/>', label: 'Offset', title: 'Offset: click a curve (its chain), choose the side, type the distance, Enter', shortcut: 'tool.offset' },
];

// Profile actions (COMBINE / UNCOMBINE): opt-in for hosts declaring profiles: true
const PROFILE_ACTIONS = [
  { action: 'combine', id: 'btn-combine', iconSvg: '<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="8.5" y="8.5" width="7" height="7" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1.5" fill="none"/>', label: 'Combine', title: 'Combine Shapes', shortcut: 'sketch.combine' },
  { action: 'uncombine', id: 'btn-uncombine', iconSvg: '<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2" fill="none"/><rect x="8.5" y="8.5" width="7" height="7" stroke="currentColor" stroke-width="1.4" fill="none"/>', label: 'Uncomb', title: 'Uncombine Profile', shortcut: 'sketch.uncombine' },
];
const INSPECT = [
  { tool: TOOL_MODES.DIMENSION, icon: 'icon-tool-dim', label: 'Dim', shortcut: 'tool.dimension' },
];
const CONSTRAIN = [
  { tool: TOOL_MODES.COINCIDENT,          icon: 'icon-coincident',   label: 'Coinc', shortcut: 'tool.coincident' },
  { tool: TOOL_MODES.HORIZONTAL_VERTICAL, icon: 'icon-hv',           label: 'H/V', shortcut: 'tool.horizontalVertical' },
  { tool: TOOL_MODES.PARALLEL,            icon: 'icon-parallel',     label: 'Para', shortcut: 'tool.parallel' },
  { tool: TOOL_MODES.PERPENDICULAR,       icon: 'icon-perpendicular', label: 'Perp', shortcut: 'tool.perpendicular' },
  { tool: TOOL_MODES.COLLINEAR,           icon: 'icon-collinear',    label: 'Coll', shortcut: 'tool.collinear' },
  { tool: TOOL_MODES.TANGENT,             icon: 'icon-tangent',      label: 'Tang', shortcut: 'tool.tangent' },
  { tool: TOOL_MODES.EQUAL,               icon: 'icon-equal',        label: 'Equal', shortcut: 'tool.equal' },
  { tool: TOOL_MODES.MIDPOINT,            icon: 'icon-midpoint',     label: 'Mid', shortcut: 'tool.midpoint' },
  { tool: TOOL_MODES.SYMMETRIC,           icon: 'icon-symmetric',    label: 'Sym', shortcut: 'tool.symmetric' },   // task 563: entity, entity, then the symmetry line
];
// Lock is an ACTION (not a drawing mode): the same toggleFixedSelection as the F key and the context menu.
const LOCK = { action: 'lock', id: 'btn-lock', icon: 'icon-lock', label: 'Lock', title: 'Lock / Unlock', shortcut: 'sketch.fix' };

// TASK 740: every built-in button, for tests/shortcuts.test.js (each names its shortcut). Not tools of their own: the Rect / Slot variant rows (they
// set the tool's mode; the tool's key opens it with the last mode) and the section names (they open a dropdown).
export const RIBBON_TOOLS = Object.freeze([...SELECT, ...CREATE, ...EDIT, ...PROFILE_ACTIONS, ...INSPECT, ...CONSTRAIN, LOCK]);

// Every #icon-* the ribbon references (for inject-if-missing).
const ICON_IDS = [
  ...SELECT.map(t => t.icon), ...CREATE.map(t => t.icon), ...EDIT.filter(t => t.icon).map(t => t.icon), ...INSPECT.map(t => t.icon), ...CONSTRAIN.map(t => t.icon), LOCK.icon,
  ...RECT_VARIANTS.map(v => v.icon),
  ...SLOT_VARIANTS.map(v => v.icon),
];

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-ribbon-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-ribbon-styles';
  s.textContent = `
.sk-ribbon { display: flex; align-items: stretch; gap: 4px; background: var(--sk-ribbon-bg, #fff);
  padding: 4px 2px; font: 12px system-ui, sans-serif; box-sizing: border-box; overflow: hidden; }
.sk-ribbon * { box-sizing: border-box; }
.sk-ribbon-group { display: flex; flex-direction: column; align-items: center; padding: 0 8px;
  flex-shrink: 0; border-right: 1px solid var(--sk-ribbon-sep, #e2e8f0); }
.sk-ribbon-group:last-child { border-right: 0; }
.sk-ribbon-btns { display: flex; gap: 2px; }
.sk-ribbon-group-label { font-size: 8px; font-weight: 900; text-transform: uppercase; margin-top: 4px;
  color: var(--sk-ribbon-grouplabel, #cbd5e1); letter-spacing: 0.02em; }
/* TASK 647: a section's NAME is the button that opens its dropdown (the caret after the name); a fixed section (Select) has a plain name. */
button.sk-ribbon-group-label { display: flex; align-items: center; justify-content: center; gap: 4px; padding: 0 5px; border: 0; border-radius: 4px;
  background: transparent; font-family: inherit; line-height: normal; cursor: pointer; -webkit-tap-highlight-color: transparent; }
button.sk-ribbon-group-label::after { content: ''; flex-shrink: 0; border-left: 3px solid transparent; border-right: 3px solid transparent; border-top: 4px solid currentColor; }
button.sk-ribbon-group-label:hover, button.sk-ribbon-group-label[aria-expanded="true"] { background: var(--sk-ribbon-hover, #f0f0f0); color: var(--sk-ribbon-fg, #334155); }
button.sk-ribbon-group-label:focus-visible { outline: 2px solid var(--sk-selection, #3B82F6); outline-offset: -2px; }
/* the active tool lives only in this section's dropdown: the section's name is lit */
button.sk-ribbon-group-label.active { background: var(--sk-selection, #3B82F6); color: #fff; }
.sk-ribbon-btn { position: relative; display: flex; flex-direction: column; align-items: center;
  justify-content: center; width: 48px; height: 56px; border-radius: 6px; border: 1px solid transparent;
  background: transparent; color: var(--sk-ribbon-fg, inherit); cursor: pointer; transition: all 0.15s;
  user-select: none; -webkit-tap-highlight-color: transparent; }
.sk-ribbon-btn[hidden] { display: none; } /* TASK 647: a tool that is not in the bar, or does not fit (it is in its section's dropdown) */
.sk-ribbon-btn:hover { background: var(--sk-ribbon-hover, #f0f0f0); }
.sk-ribbon-btn:active { transform: scale(0.95); }
.sk-ribbon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.sk-ribbon-btn:disabled:hover { background: transparent; transform: none; }
.sk-ribbon-btn[aria-pressed="true"] { background: var(--sk-ribbon-hover, #f0f0f0); border-color: var(--sk-ribbon-sep, #cbd5e1);
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.1); }
.sk-ribbon-btn.active { background: var(--sk-selection, #3B82F6); color: #fff;
  border-color: var(--sk-selection-border, #1E40AF); box-shadow: inset 0 2px 4px rgba(0,0,0,0.1); }
.sk-ribbon-btn.active .sk-ribbon-ic { color: #fff; }
.sk-ribbon-ic { width: 18px; height: 18px; display: block; }
.sk-ribbon-lbl { font-size: 8px; font-weight: 900; text-transform: uppercase; margin-top: 4px; white-space: nowrap; }
.sk-ribbon-dd-ind { position: absolute; bottom: 2px; right: 2px; width: 0; height: 0;
  border-left: 3px solid transparent; border-right: 3px solid transparent;
  border-top: 3px solid var(--sk-ribbon-grouplabel, #94a3b8); }
.sk-ribbon-btn.active .sk-ribbon-dd-ind { border-top-color: #fff; }
/* the popovers (TASK 607 Rect variants, TASK 647 section dropdowns): on document.body, placed by placePopover() */
.sk-ribbon-menu, .sk-ribbon-sect-menu { display: none; position: fixed; left: 0; top: 0; z-index: 9999; min-width: 160px; overflow-y: auto;
  padding: 4px 0; background: var(--sk-ribbon-menu-bg, #fff); border: 1px solid var(--sk-ribbon-sep, #cbd5e1);
  border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); font: 12px system-ui, sans-serif; color: var(--sk-ribbon-fg, inherit); }
.sk-ribbon-menu.show, .sk-ribbon-sect-menu.show { display: block; }
.sk-ribbon-menu-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer;
  font-size: 11px; font-weight: 600; white-space: nowrap; color: var(--sk-ribbon-fg, inherit); }
.sk-ribbon-menu-item:hover { background: var(--sk-ribbon-hover, #f3f4f6); }
.sk-ribbon-menu-item.active { background: var(--sk-selection, #3B82F6); color: #fff; }
.sk-ribbon-menu-item svg { width: 16px; height: 16px; flex-shrink: 0; }
/* a section dropdown row: [in the bar checkbox] [the tool: runs it] [grip: hold-drag to reorder] */
.sk-ribbon-sect-menu { touch-action: pan-y; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.sk-ribbon-sect-row { display: flex; align-items: stretch; }
.sk-ribbon-sect-row.dragging { background: var(--sk-ribbon-hover, #f3f4f6); box-shadow: 0 2px 10px rgba(0,0,0,0.2); position: relative; z-index: 1; }
.sk-ribbon-sect-check { display: flex; align-items: center; justify-content: center; width: 32px; flex-shrink: 0; cursor: pointer; }
.sk-ribbon-sect-check input { margin: 0; width: 14px; height: 14px; cursor: inherit; }
.sk-ribbon-sect-item { flex: 1 1 auto; display: flex; align-items: center; gap: 8px; padding: 7px 8px; border: 0; background: transparent;
  font: 600 11px system-ui, sans-serif; color: inherit; text-align: left; white-space: nowrap; cursor: pointer; border-radius: 4px; }
.sk-ribbon-sect-item:hover { background: var(--sk-ribbon-hover, #f3f4f6); }
.sk-ribbon-sect-item.active { background: var(--sk-selection, #3B82F6); color: #fff; }
.sk-ribbon-sect-item:disabled { opacity: 0.4; cursor: not-allowed; }
.sk-ribbon-sect-item svg { width: 16px; height: 16px; flex-shrink: 0; }
.sk-ribbon-grip { display: flex; align-items: center; justify-content: center; width: 28px; flex-shrink: 0; cursor: grab; color: var(--sk-ribbon-grouplabel, #94a3b8); }
.sk-ribbon-sect-row.dragging .sk-ribbon-grip { cursor: grabbing; }
.sk-ribbon-grip svg { width: 12px; height: 16px; }
.sk-ribbon-sect-head { display: none; padding: 6px 12px 2px; font: 800 11px system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.65; } /* the section's name, shown on the phone-landscape rail only (its name button has no text there) */
.sk-ribbon-sect-foot { display: flex; justify-content: flex-end; padding: 2px 6px 0; border-top: 1px solid var(--sk-ribbon-sep, #e2e8f0); margin-top: 4px; }
.sk-ribbon-sect-reset { border: 0; background: transparent; padding: 6px; font: 600 11px system-ui, sans-serif; color: var(--sk-selection, #3B82F6);
  text-decoration: underline; cursor: pointer; }
/* TASK 562: a finger. Buttons >= 44 px (here 62 x 60), labels >= 12 px, menu rows 44 px. Desktop (a mouse) is untouched. */
@media (pointer: coarse) {
  .sk-ribbon-btn { width: 62px; height: 60px; }
  .sk-ribbon-lbl, .sk-ribbon-group-label { font-size: 12px; font-weight: 700; }
  .sk-ribbon-menu-item { min-height: 44px; font-size: 14px; }
  .sk-ribbon-sect-check, .sk-ribbon-grip { width: 44px; min-height: 44px; }
  .sk-ribbon-sect-check input { width: 20px; height: 20px; }
  .sk-ribbon-sect-item { min-height: 44px; font-size: 14px; }
  .sk-ribbon-sect-item svg { width: 20px; height: 20px; }
  .sk-ribbon-sect-reset { min-height: 44px; min-width: 44px; font-size: 14px; }
}
/* TASK 647: a PHONE held upright: icon-only tool buttons (the label stays in the button, visually hidden: still the accessible name),
   44 x 44 targets, tighter spacing; each section's name row is a 44 px tall dropdown button; the fixed Select section has no name row. */
@media (pointer: coarse) and (max-width: 640px) {
  .sk-ribbon { gap: 0; padding: 0; }
  .sk-ribbon-group { padding: 0 1px; }
  .sk-ribbon-btns { gap: 0; }
  .sk-ribbon-btn { width: 44px; height: 44px; }
  .sk-ribbon-ic { width: 24px; height: 24px; }
  .sk-ribbon-lbl { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .sk-ribbon-group-label { margin-top: 0; }
  /* the caret sits UNDER the name (no width: the names are what decides how many tools fit on a phone) */
  button.sk-ribbon-group-label { position: relative; min-height: 44px; min-width: 44px; padding: 0 3px 6px; }
  button.sk-ribbon-group-label::after { position: absolute; left: 50%; bottom: 7px; margin-left: -3px; }
  .sk-ribbon-group[data-fixed] .sk-ribbon-group-label { display: none; }
}
/* TASK 602: a SHORT viewport (a phone in landscape, #ui/short-viewport.js) has width to spare and no height: the ribbon is a vertical ICON RAIL on
   the LEFT of its design frame. render(container) marks the container sk-ribbon-host and the container's parent sk-ribbon-frame (every host's
   Design view: [ribbon container, then the work area]). The frame becomes two columns: the rail, then the work area. Icons only, 44 x 44 buttons; the label stays in the button (visually hidden) so it is
   still the accessible name, and the button's title. TASK 647: the rail never scrolls; each section is a row: its column of shown icons, then its
   NAME written vertically (the 44 px wide dropdown button); the fixed Select section has no name. Nothing changes outside this query.
   display needs !important: each host styles its frame by id (#design-view { display: flex }), and an id beats any class; :not([hidden])
   keeps a host's own hidden frame hidden. */
@media ${SHORT_VIEWPORT_QUERY} {
  .sk-ribbon-frame:not([hidden]) { display: grid !important; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto;
    flex: 1 1 auto; min-height: 0; }
  .sk-ribbon-frame > * { grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; }
  .sk-ribbon-frame > footer { grid-column: 2; grid-row: 2; } /* TASK 618: SketchStudio's status bar (the footer) under the work area, right of the rail */
  .sk-ribbon-frame > .sk-ribbon-host { grid-column: 1; grid-row: 1 / -1; display: flex; flex-direction: column; width: auto; padding: 0 0 0 24px;
    overflow: hidden; border-bottom: 0; border-right: 1px solid var(--sk-ribbon-sep, #e2e8f0); }
  .sk-ribbon { flex: 1 1 auto; flex-direction: column; align-items: stretch; min-height: 0; height: 100%; gap: 0; padding: 2px; }
  .sk-ribbon-group { flex-direction: row; align-items: flex-start; padding: 0; border-right: 0; border-bottom: 1px solid var(--sk-ribbon-sep, #e2e8f0); }
  .sk-ribbon-group:last-child { border-bottom: 0; }
  .sk-ribbon-btns { display: grid; grid-template-columns: repeat(2, 44px); gap: 0; } /* TASK 676: the tools two per row */
  .sk-ribbon-group-label { margin: 0; }
  /* TASK 676: no section name text on the rail (it is the dropdown's header, .sk-ribbon-sect-head): the name button is the caret strip beside the tools */
  button.sk-ribbon-group-label { position: relative; align-self: stretch; font-size: 0; min-width: 44px; min-height: 44px; padding: 0; }
  .sk-ribbon-sect-head { display: block; }
  button.sk-ribbon-group-label::after { position: absolute; left: 50%; margin-left: -3px; top: 50%; margin-top: -2px; }
  .sk-ribbon-group[data-fixed] .sk-ribbon-group-label { display: none; }
  .sk-ribbon-btn { width: 44px; height: 44px; }
  .sk-ribbon-ic { width: 24px; height: 24px; }
  .sk-ribbon-lbl { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
}
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

function iconSvg(iconId, cls = 'sk-ribbon-ic') {
  // The symbol's content carries its own strokes/fills (incl. red --icon-accent parts); the outer svg supplies
  // the inheriting currentColor. width/height on <use> scales each symbol's own viewBox into the 24-box.
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><use href="#${iconId}" width="24" height="24"/></svg>`;
}

const GRIP_SVG = '<svg viewBox="0 0 12 16" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="8" r="1.5"/><circle cx="9" cy="8" r="1.5"/><circle cx="3" cy="13" r="1.5"/><circle cx="9" cy="13" r="1.5"/></g></svg>';

// TASK 607 / 647: THE placement of a ribbon popover (the Rect variants menu, a section dropdown): from its anchor's rect, kept inside the
// viewport: below the anchor in the bar, beside the RAIL (the ribbon `edge`, not just the anchor: the rail has a column of section names right of
// the icons) in the short-viewport rail.
function placePopover(menu, anchor, edge) {
  const r = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, pad = 4;
  menu.style.maxHeight = (vh - 2 * pad) + 'px';
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const beside = isShortViewport();
  const left = beside ? Math.max(r.right, edge.getBoundingClientRect().right) + pad : r.left, top = beside ? r.top : r.bottom + 2;
  menu.style.left = Math.round(Math.max(pad, Math.min(left, vw - w - pad))) + 'px';
  menu.style.top = Math.round(Math.max(pad, Math.min(top, vh - h - pad))) + 'px';
}

// A popover on document.body (a ribbon clips any child). It closes on Esc (focus back to its anchor when the focus was inside), an outside
// press or click (#ui/outside-press.js: a DISABLED button never fires click, so the press counts) and the window resizing; the listeners
// exist only while it is open. onClose runs after every close. "Outside" is read from the event's dispatch path, not its target: a press on a
// control the popover then rebuilds (the dropdown's Reset) has a detached target by the time the click arrives, yet it was inside.
function createPopover(menu, edge, onClose = null) {
  let anchor = null, stopOutside = null;
  const onOutside = (ev) => { const path = ev.composedPath(); if (!path.includes(menu) && !(anchor && path.includes(anchor))) close(); };
  const onKey = (ev) => {
    if (ev.key !== 'Escape') return;
    const back = anchor && menu.contains(document.activeElement) ? anchor : null;
    close(); if (back) back.focus();
  };
  function open(a) {
    anchor = a; menu.classList.add('show'); placePopover(menu, a, edge);
    stopOutside = listenOutsidePress(onOutside); document.addEventListener('keydown', onKey); window.addEventListener('resize', close);
  }
  function close() {
    if (!menu.classList.contains('show')) return;
    menu.classList.remove('show');
    if (stopOutside) { stopOutside(); stopOutside = null; }
    document.removeEventListener('keydown', onKey); window.removeEventListener('resize', close);
    anchor = null;
    if (onClose) onClose();
  }
  return { open, close, isOpen: () => menu.classList.contains('show'), anchor: () => anchor };
}

const px = (v) => parseFloat(v) || 0;

/**
 * createToolRibbon({ state, appId, extraGroups, on, onToolClick }) → { el, render(container), refresh, destroy }
 *   Renders the sections Select | Create | Modify | Inspect | Constrain (+ the host's extraGroups) as icon-over-label .sk-ribbon-btn buttons
 *   (icon only on phones); the rect button gets a 2pt/center/3pt variant dropdown (sets state.rectMode). refresh() syncs .active to state.currentTool.
 *   TASK 647: a section DECLARES { key, label, tools, fixed?, defaultInBar? }: fixed = always shown whole, no dropdown (Select); defaultInBar = how
 *     many of its first tools are "in the bar" by default (all when absent). Every other tool is in the section's dropdown (its name button).
 *   appId: the host's id (the one it gives app-chrome); the user's layout (checkboxes, order) is saved per appId (#ui/ribbon-layout.js).
 *   extraGroups: [{ label, fixed?, defaultInBar?, buttons:[{ icon?|svg?, label?, title?, hint?, id?, event?, onClick? }] }] — host-appended sections.
 *     TASK S3: `fixed` as a built-in section's (every button always shown, in its declared order, no dropdown).
 *   sketchTools: TASK S3: false = none of the sketcher's sections (Select ... Constrain): the ribbon is the host's extraGroups only (Shaper Prepare's operations toolbar).
 *   on(name, detail): optional event hook ('tool' on a tool switch, 'rectMode', 'action' for extra buttons).
 *   (TASK 677: the Parameters window's opener moved from Inspect to the shared footer, #ui/app-footer.js; its opt-out is the footer's.)
 *   onToolClick(tool): optional host override — when given, a tool-button click (and a rect-variant select, after
 *     state.rectMode is set) calls THIS instead of the internal switchToTool, so a host (e.g. SketchStudio) routes
 *     tool activation to its OWN rich handler. When absent, the ribbon uses switchToTool (Shaper/standalone path).
 */
export function createToolRibbon({ state, appId = 'default', extraGroups = [], on = null, onToolClick = null, profiles = false, notify = null, sketchTools = true } = {}) {
  injectStyles();
  if (sketchTools) ensureIconSymbols(ICON_IDS);

  const el = document.createElement('div'); el.className = 'sk-ribbon';
  const toolBtns = []; // { btn, tool } — for active-sync
  const menus = [];    // TASK 607: popovers on document.body, removed in destroy()
  const retitles = []; // TASK 747: each button's title setter, run again when a shortcut's key changes
  const offShortcuts = onShortcutsChange(() => retitles.forEach((f) => f()));

  const fire = (name, detail) => { if (typeof on === 'function') { try { on(name, detail); } catch (_) {} } };
  function selectTool(tool) {
    state.closeDrawStep(); // TASK 549: picking a tool in the middle of a draw cancels it (nothing committed: no orphan point, no undo step)
    if (typeof onToolClick === 'function') {                                              // host owns activation
      try { onToolClick(tool); } catch (_) {}
      if (TOOL_BEGIN[tool]) TOOL_BEGIN[tool](state); // TASK 585 / 740: Mirror / a pattern starts its pick from the state the switch left
    } else { try { switchToTool(state, tool); } catch (_) {} }                          // default: shared tool-switch (it runs TOOL_BEGIN)
    fire('tool', tool);
    refresh();
  }

  const tips = [];
  const sectTips = []; // TASK 774: the tooltips of the OPEN dropdown's rows; fillSection destroys them before it builds the rows again
  const attachTip = (btn, key, titleLabel, shortcutId, extraText) => {
    const desc = extraText || (key && RIBBON_HINTS[key]) || '';
    if (!desc) return;
    tips.push(mountTooltip({
      target: btn,
      getContent: () => ({ title: titleLabel, key: shortcutId ? shortcutHint(shortcutId) : '', text: desc }),
    }));
  };

  // Each tool of a section is an ITEM: { id, label, btn (its bar button), tool?, run(anchor) }. The bar button and the dropdown row both call run.
  function toolItem(t) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-ribbon-btn';
    if (t.id) b.id = t.id;
    else if (t.tool) b.id = 'tool-' + t.tool;
    else if (t.action) b.id = 'action-' + t.action;
    const retitle = () => { b.title = titleWithShortcut(t.title || t.label, t.shortcut); }; // TASK 740: "Line (L)" (every built-in button names its shortcut)
    retitle(); retitles.push(retitle);
    if (t.tool) b.dataset.tool = t.tool;
    if (t.action) b.dataset.action = t.action;
    if (t.ariaLabel) b.setAttribute('aria-label', t.ariaLabel);
    const hintKey = t.tool || t.action;
    attachTip(b, hintKey, t.ariaLabel || t.title || t.label, t.shortcut);
    // Support both symbol-id icons (icon) and raw inline SVG paths (iconSvg) for newer tools
    const icon = t.iconSvg
      ? `<svg class="sk-ribbon-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">${t.iconSvg}</svg>`
      : iconSvg(t.icon);
    b.innerHTML = icon + `<span class="sk-ribbon-lbl">${t.label}</span>`;
    const run = () => {
      if (t.action) {
        if (typeof t.onClick === 'function') t.onClick();
        if (t.action === 'lock') { toggleFixedSelection(state); refresh(); }
        else if (t.action === 'combine') doCombine(state, notify || undefined);
        else if (t.action === 'uncombine') doUncombine(state, notify || undefined);
        fire('action', { id: b.id, action: t.action });
      } else {
        selectTool(t.tool);
      }
    };
    b.addEventListener('click', run);
    if (t.tool) toolBtns.push({ btn: b, tool: t.tool });
    return { id: b.id, label: t.label, btn: b, tool: t.tool || null, hintKey, shortcut: t.shortcut || null, run };
  }
  const variantPops = [];
  function variantItem(t) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-ribbon-btn sk-ribbon-dd';
    b.dataset.tool = t.tool;
    const retitle = () => { b.title = titleWithShortcut(t.label, t.shortcut); }; // TASK 740: "Rect (R)"
    retitle(); retitles.push(retitle);
    if (t.tool) b.id = 'tool-' + t.tool;
    attachTip(b, t.tool, t.label, t.shortcut);
    const activeMode = (state && state[t.modeKey]) || t.variants[0].mode;
    const initialVariant = t.variants.find(v => v.mode === activeMode) || t.variants[0];
    b.innerHTML = iconSvg(initialVariant.icon) + `<span class="sk-ribbon-lbl">${t.label}</span><span class="sk-ribbon-dd-ind"></span>`;
    const useEl = b.querySelector('use');
    toolBtns.push({ btn: b, tool: t.tool });

    const menu = document.createElement('div'); menu.className = 'sk-ribbon-menu';
    const pop = createPopover(menu, el);
    variantPops.push(pop);
    t.variants.forEach((v) => {
      const item = document.createElement('div'); item.className = 'sk-ribbon-menu-item'; item.dataset.mode = v.mode;
      item.innerHTML = iconSvg(v.icon, '') + `<span>${v.label}</span>`;
      if (activeMode === v.mode) item.classList.add('active');
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (state) state[t.modeKey] = v.mode;
        if (useEl) useEl.setAttribute('href', '#' + v.icon);
        menu.querySelectorAll('.sk-ribbon-menu-item').forEach(i => i.classList.toggle('active', i.dataset.mode === v.mode));
        pop.close();
        selectTool(t.tool);
        fire(t.eventName, v.mode);
      });
      menu.appendChild(item);
    });
    // TASK 607: the variants menu is a POPOVER (createPopover), placed from the button's rect; TASK 647: from the section's dropdown it is
    // placed from the section's name button (the tool button may not be in the bar).
    const run = (anchor) => {
      selectTool(t.tool);
      const wasOpen = pop.isOpen() && pop.anchor() === anchor;
      variantPops.forEach(p => p.close());
      if (!wasOpen) pop.open(anchor);
    };
    b.addEventListener('click', (ev) => { ev.stopPropagation(); run(b); });
    menus.push(menu);
    document.body.appendChild(menu);
    return { id: b.id, label: t.label, btn: b, tool: t.tool, hintKey: t.tool, shortcut: t.shortcut || null, run };
  }
  function extraItem(bd, sectionKey, i) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-ribbon-btn';
    b.id = bd.id || ('extra-' + sectionKey + '-' + i); b.title = bd.title || bd.label || '';
    if (bd.hint || (bd.title && bd.title !== bd.label)) attachTip(b, null, bd.label || '', null, bd.hint || bd.title);
    b.innerHTML = (bd.icon ? iconSvg(bd.icon) : (bd.svg || '')) + `<span class="sk-ribbon-lbl">${bd.label || ''}</span>`;
    const run = () => { try { bd.onClick && bd.onClick(); } catch (_) {} fire('action', { id: bd.id, event: bd.event }); };
    b.addEventListener('click', run);
    return { id: b.id, label: bd.label || '', btn: b, tool: null, hintText: bd.hint || (bd.title && bd.title !== bd.label ? bd.title : null), run };
  }

  // TASK 647: the sections, DECLARED (fixed / defaultInBar are data on the section, read by the one layout engine below).
  const SECTION_DECLS = [
    ...(sketchTools ? [ // TASK S3: a host's own toolbar (sketchTools false) has none of the sketcher's sections
      { key: 'select', label: 'Select', fixed: true, tools: SELECT },
      { key: 'create', label: 'Create', tools: CREATE },
      { key: 'modify', label: 'Modify', defaultInBar: 1, tools: profiles ? [...EDIT, ...PROFILE_ACTIONS] : EDIT }, // TRACE-1: trim + break (+ opt-in profile actions)
      { key: 'inspect', label: 'Inspect', defaultInBar: 1, tools: INSPECT },
      { key: 'constrain', label: 'Constrain', tools: [...CONSTRAIN, LOCK] },
    ] : []),
    // app-specific groups (Draw / …) appended by the host behave like the built-in ones
    ...(extraGroups || []).map((g, i) => ({ key: String(g.label || 'group-' + i).toLowerCase(), label: g.label || '', fixed: Boolean(g.fixed), defaultInBar: g.defaultInBar, buttons: g.buttons || [] })),
  ];

  const sections = SECTION_DECLS.map((d) => {
    const items = d.buttons ? d.buttons.map((bd, i) => extraItem(bd, d.key, i)) : d.tools.map((t) => (t.variants ? variantItem(t) : toolItem(t)));
    const g = document.createElement('div'); g.className = 'sk-ribbon-group'; g.dataset.section = d.key;
    if (d.fixed) g.dataset.fixed = '';
    const row = document.createElement('div'); row.className = 'sk-ribbon-btns';
    items.forEach((it) => row.appendChild(it.btn));
    const lab = document.createElement(d.fixed ? 'div' : 'button'); lab.className = 'sk-ribbon-group-label'; lab.textContent = d.label;
    g.append(row, lab); el.appendChild(g);
    const ids = items.map((it) => it.id);
    const defaultInBar = d.defaultInBar == null ? ids.length : d.defaultInBar;
    const sec = { key: d.key, label: d.label, fixed: !!d.fixed, el: g, row, nameEl: lab, items, ids, defaultInBar, limit: null,
      layout: d.fixed ? defaultSection(ids) : loadSection(appId, d.key, ids, defaultInBar) };
    if (!d.fixed) {
      lab.type = 'button'; lab.setAttribute('aria-expanded', 'false');
      lab.addEventListener('click', (ev) => { ev.stopPropagation(); toggleSection(sec, ev.detail === 0); });
    }
    return sec;
  });
  const itemOf = (sec, id) => sec.items.find((it) => it.id === id);
  const lockBtn = el.querySelector('#btn-lock');

  // The bar follows the layout: the section's buttons in the user's order; a tool is shown when it is in the bar and among the first
  // `limit` such (limit null = no fit yet: every tool in the bar shows). The DOM is reordered only when the order changed.
  function applySection(sec) {
    const order = sec.layout.order;
    const now = [...sec.row.children].map((b) => b.id);
    if (now.join('\n') !== order.join('\n')) order.forEach((id) => sec.row.appendChild(itemOf(sec, id).btn));
    let shown = 0;
    order.forEach((id) => {
      const inBar = !sec.layout.off.has(id);
      const show = inBar && (sec.limit == null || shown < sec.limit);
      if (show) shown++;
      itemOf(sec, id).btn.hidden = !show;
    });
  }

  // THE fit: how many tools each section shows, from the available width (the height in the rail) on load and on every resize.
  // Measured, not assumed: one tool slot (the Select button), each section's chrome (padding + border), its name's extent and the gaps.
  // A section's extent is max(its shown icons, its name). Pass 1 raises every section, in section order, toward MIN_PER_SECTION_PREFERRED
  // tools; if that cannot hold for every section, all sections start from MIN_PER_SECTION instead. Pass 2 shares what is left in section order.
  function fit() {
    const cs = getComputedStyle(el);
    const rail = cs.flexDirection === 'column';
    const avail = rail ? el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom) : el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
    const unitRect = sections[0].items[0].btn.getBoundingClientRect();
    const unit = rail ? unitRect.height : unitRect.width;
    if (!(avail > 0) || !(unit > 0)) return; // not laid out (a hidden view): the ResizeObserver calls again once it is
    const sectionGap = px(rail ? cs.rowGap : cs.columnGap);
    const geo = sections.map((sec) => {
      const gs = getComputedStyle(sec.el), rs = getComputedStyle(sec.row);
      const chrome = rail ? px(gs.paddingTop) + px(gs.paddingBottom) + px(gs.borderTopWidth) + px(gs.borderBottomWidth)
        : px(gs.paddingLeft) + px(gs.paddingRight) + px(gs.borderLeftWidth) + px(gs.borderRightWidth);
      const ns = getComputedStyle(sec.nameEl), nr = sec.nameEl.getBoundingClientRect();
      const name = rail ? px(ns.minHeight) + px(ns.marginTop) + px(ns.marginBottom) : nr.width + px(ns.marginLeft) + px(ns.marginRight);
      const n = sec.layout.order.filter((id) => !sec.layout.off.has(id)).length;
      const cols = rail ? getComputedStyle(sec.row).gridTemplateColumns.split(' ').length : 1; // TASK 676: the rail's tools are in columns ('none' = 1)
      return { chrome, gap: px(rail ? rs.rowGap : rs.columnGap), name, n, fixed: sec.fixed, cols };
    });
    const size = (g, k) => { const rows = Math.ceil(k / g.cols); return g.chrome + Math.max(k > 0 ? rows * unit + (rows - 1) * g.gap : 0, g.name); };
    const room = avail - 1; // 1 px for sub-pixel rounding
    const grow = (ks, cap) => {
      let used = ks.reduce((t, k, i) => t + size(geo[i], k), 0) + sectionGap * (geo.length - 1);
      geo.forEach((g, i) => {
        while (ks[i] < Math.min(cap, g.n)) { const d = size(g, ks[i] + 1) - size(g, ks[i]); if (used + d > room) return; ks[i]++; used += d; }
      });
      return ks;
    };
    const start = (min) => geo.map((g) => (g.fixed ? g.n : Math.min(min, g.n)));
    const fits = (ks) => ks.reduce((t, k, i) => t + size(geo[i], k), 0) + sectionGap * (geo.length - 1) <= room;
    const ks = grow(grow(fits(start(MIN_PER_SECTION_PREFERRED)) ? start(MIN_PER_SECTION_PREFERRED) : start(MIN_PER_SECTION), MIN_PER_SECTION_PREFERRED), Infinity);
    sections.forEach((sec, i) => { sec.limit = ks[i]; applySection(sec); });
    refresh();
  }
  function relayout(sec) { applySection(sec); fit(); refresh(); }
  // TASK 773b: the stored layout changed (another device's, arriving from Google Drive; a reset): every section follows it, re-read against its declared
  // tools (an id this app does not have is dropped), except the one whose menu is open: the user is editing it, it follows once the menu closes.
  function followStore() {
    let moved = false;
    for (const sec of sections) {
      if (sec.fixed || sec === openSec) continue;
      const next = loadSection(appId, sec.key, sec.ids, sec.defaultInBar);
      if (sameSection(next, sec.layout)) continue;
      sec.layout = next; applySection(sec); moved = true;
    }
    if (moved) { fit(); refresh(); }
  }
  const offLayout = onRibbonLayoutChange(followStore);
  function save(sec) { saveSection(appId, sec.key, sec.layout); }

  // ── the section dropdown (one popover element, filled for the section it opens on)
  const sectMenu = document.createElement('div'); sectMenu.className = 'sk-ribbon-sect-menu';
  let openSec = null;
  const sectPop = createPopover(sectMenu, el, () => { if (openSec) openSec.nameEl.setAttribute('aria-expanded', 'false'); openSec = null; followStore(); });
  menus.push(sectMenu);
  document.body.appendChild(sectMenu);
  sectMenu.addEventListener('contextmenu', (ev) => ev.preventDefault()); // a long press on a grip must not open the browser's menu

  function toggleSection(sec, byKeyboard) {
    if (openSec === sec) { sectPop.close(); return; }
    sectPop.close();
    openSec = sec; fillSection(sec);
    sec.nameEl.setAttribute('aria-expanded', 'true');
    sectPop.open(sec.nameEl);
    if (byKeyboard) { const first = sectMenu.querySelector('.sk-ribbon-sect-item'); if (first) first.focus(); }
  }
  function fillSection(sec) {
    sectTips.splice(0).forEach((t) => t.destroy());
    sectMenu.innerHTML = '';
    sectMenu.dataset.section = sec.key;
    const head = document.createElement('div'); head.className = 'sk-ribbon-sect-head'; head.textContent = sec.label;
    const list = document.createElement('div'); list.className = 'sk-ribbon-sect-list';
    sec.layout.order.forEach((id) => list.appendChild(sectionRow(sec, itemOf(sec, id))));
    const foot = document.createElement('div'); foot.className = 'sk-ribbon-sect-foot';
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'sk-ribbon-sect-reset'; reset.textContent = 'Reset';
    reset.addEventListener('click', () => {
      sec.layout = defaultSection(sec.ids, sec.defaultInBar); saveSection(appId, sec.key, null);
      fillSection(sec); relayout(sec);
    });
    foot.appendChild(reset);
    sectMenu.append(head, list, foot);
    syncRows();
  }
  function sectionRow(sec, it) {
    const row = document.createElement('div'); row.className = 'sk-ribbon-sect-row'; row.dataset.id = it.id;
    const chkWrap = document.createElement('label'); chkWrap.className = 'sk-ribbon-sect-check';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !sec.layout.off.has(it.id);
    chk.setAttribute('aria-label', it.label + ' in the bar');
    chk.addEventListener('change', () => {
      if (chk.checked) sec.layout.off.delete(it.id); else sec.layout.off.add(it.id);
      save(sec); relayout(sec);
    });
    chkWrap.appendChild(chk);
    const runBtn = document.createElement('button'); runBtn.type = 'button'; runBtn.className = 'sk-ribbon-sect-item'; runBtn.dataset.id = it.id;
    const desc = it.hintText || (it.hintKey && RIBBON_HINTS[it.hintKey]) || '';
    if (desc) sectTips.push(mountTooltip({ target: runBtn, getContent: () => ({ title: it.label, key: it.shortcut ? shortcutHint(it.shortcut) : '', text: desc }) }));
    const ic = it.btn.querySelector('svg');
    if (ic) runBtn.appendChild(ic.cloneNode(true)); // the bar button's own icon (the rect button's shows its current variant)
    const name = document.createElement('span'); name.textContent = it.label; runBtn.appendChild(name);
    runBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const anchor = sec.nameEl;
      sectPop.close();
      it.run(anchor); // exactly the bar button's action (the Rect variants open from the section's name)
    });
    const grip = document.createElement('span'); grip.className = 'sk-ribbon-grip'; grip.setAttribute('aria-hidden', 'true'); grip.innerHTML = GRIP_SVG;
    grip.addEventListener('pointerdown', (ev) => startHold(sec, row, ev));
    row.append(chkWrap, runBtn, grip);
    return row;
  }
  // Keeps an open dropdown's rows in step with the bar (the active tool lit, Lock disabled without a selection).
  function syncRows() {
    if (!openSec) return;
    sectMenu.querySelectorAll('.sk-ribbon-sect-item').forEach((r) => {
      const it = itemOf(openSec, r.dataset.id);
      r.classList.toggle('active', it.btn.classList.contains('active'));
      r.disabled = it.btn.disabled;
    });
  }

  // Hold-then-drag on a grip (mouse and touch): a press held HOLD_MS without moving starts the drag; a move before that is a scroll of the list
  // (touch-action pan-y), which the browser then owns. While dragging, the list does not scroll (touchmove is cancelled) and the row follows
  // the pointer among its section's rows; the bar follows live; the order is saved on release.
  function startHold(sec, row, ev) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    if (ev.pointerType === 'mouse') ev.preventDefault(); // no text selection / focus move while holding
    const pid = ev.pointerId, x0 = ev.clientX, y0 = ev.clientY;
    let dragging = false;
    const list = row.parentElement;
    const noScroll = (e) => { if (dragging) e.preventDefault(); };
    const timer = setTimeout(() => { dragging = true; row.classList.add('dragging'); }, HOLD_MS);
    const onMove = (e) => {
      if (e.pointerId !== pid) return;
      if (!dragging) { if (Math.hypot(e.clientX - x0, e.clientY - y0) > HOLD_SLOP) end(); return; }
      e.preventDefault();
      const rows = [...list.children].filter((r) => r !== row);
      const before = rows.find((r) => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
      if (before ? row.nextElementSibling !== before : list.lastElementChild !== row) {
        list.insertBefore(row, before || null);
        sec.layout.order = [...list.children].map((r) => r.dataset.id);
        relayout(sec);
      }
    };
    const end = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', end);
      sectMenu.removeEventListener('touchmove', noScroll);
      if (dragging) { row.classList.remove('dragging'); save(sec); }
      dragging = false;
    };
    const onUp = (e) => { if (e.pointerId === pid) end(); };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', end);
    sectMenu.addEventListener('touchmove', noScroll, { passive: false });
  }

  // Selection changes arrive through pointer / key input (no selection event exists), so re-sync after them.
  const syncSoon = () => setTimeout(refresh, 0);
  document.addEventListener('pointerup', syncSoon);
  document.addEventListener('keyup', syncSoon);

  // TASK 618: Undo / Redo left the ribbon: one shared control in every host's header (history-control.js).

  const unlistenHistory = (state && typeof state.addHistoryListener === 'function')
    ? state.addHistoryListener(() => refresh())
    : null;

  function refresh() {
    const cur = state && state.currentTool;
    toolBtns.forEach(({ btn, tool }) => btn.classList.toggle('active', tool === cur));
    if (lockBtn) { // (TASK S3: a ribbon without the sketcher's sections has no Lock)
      const lock = state ? selectionLockState(state) : { has: false, locked: false };
      lockBtn.disabled = !lock.has;
      lockBtn.setAttribute('aria-pressed', String(lock.locked));
    }
    // TASK 647: the active tool lives only in its section's dropdown -> the section's name is lit
    sections.forEach((sec) => { if (!sec.fixed) sec.nameEl.classList.toggle('active', sec.items.some((it) => it.tool && it.tool === cur && it.btn.hidden)); });
    syncRows();
  }

  // The fit runs once the ribbon is laid out and again whenever its box changes (a window resize, a rotation, a hidden view shown).
  // Deferred a frame so it never resizes the observed box inside the observer's own callback.
  const fitObserver = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => requestAnimationFrame(fit)) : null;

  sections.forEach(applySection);
  refresh();
  return {
    el,
    // TASK 602: the container is the ribbon's host and its parent the design frame (the short-viewport rail layout above keys on both classes)
    render: (container) => {
      if (container) {
        container.appendChild(el);
        container.classList.add('sk-ribbon-host');
        if (container.parentElement) container.parentElement.classList.add('sk-ribbon-frame');
      }
      if (fitObserver) fitObserver.observe(el);
      refresh(); return el;
    },
    refresh,
    destroy: () => {
      offShortcuts(); offLayout();
      if (unlistenHistory) unlistenHistory();
      sectPop.close();
      [...tips, ...sectTips].forEach((t) => t.destroy());
      document.removeEventListener('pointerup', syncSoon);
      document.removeEventListener('keyup', syncSoon);
      if (fitObserver) fitObserver.disconnect();
      menus.forEach(m => m.remove());
      try { el.remove(); } catch (_) {}
    },
  };
}
