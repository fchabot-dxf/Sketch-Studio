// MOVED → src/core/inference-engine.js (WAVE A, slice A1): it is CORE (pure inference),
// was misfiled under ui/. Re-export shim at the OLD path so the 4 shell importers
// (snap-detection, input-manager, selection-tools, line-tool) resolve until they're
// rewritten to #core/ when they move. shell-located → core via the #core/ alias.
// Single named export (findInference), no default → `export *` is complete.
export * from '#core/inference-engine.js';
