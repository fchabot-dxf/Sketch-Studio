// apps/penplotter/src/active-layer-panel.js — PP-4b STUB. The real active-layer panel (per-toolpath FILL pattern +
// OUTLINE style pickers) is the FILL stage (PP-5), and must be ADAPTED to the #core/plot object-registries. Several
// modules (toolpath-layers-panel enterTargetEditing, etc.) dynamically `import("./active-layer-panel.js").then(m =>
// m.renderActiveLayerPanel())` to refresh it after a selection change. Until PP-5 ports the real panel, this no-op
// stub makes that dynamic import RESOLVE (instead of throwing "Failed to fetch dynamically imported module").
export function renderActiveLayerPanel() {}
export function installActiveLayerPanel() {}
