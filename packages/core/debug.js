// ═══════════════════════════════════════════════════════════════════════════════
// DEBUG - Centralized logging with categories and runtime level control
// ═══════════════════════════════════════════════════════════════════════════════
//
// Usage:
//   import { dbg } from '../core/debug.js';
//   dbg.log('solver', 'converged in', k, 'iterations');
//   dbg.warn('constraints', 'duplicate rejected', c);
//
// Runtime control (browser console):
//   ug.debug.enable('solver')      — show logs for 'solver' category
//   ug.debug.enable('*')           — show ALL logs
//   ug.debug.disable('solver')     — mute 'solver'
//   ug.debug.disable('*')          — mute ALL (default)
//   ug.debug.list()                — show which categories have fired
//   ug.debug.level = 'warn'        — only show warn/error (skip log/debug)
//
// Levels (ascending): 'debug' < 'log' < 'warn' < 'error' < 'off'
// Default level: 'warn' — only warnings and errors print by default.
// ═══════════════════════════════════════════════════════════════════════════════

export const LEVEL_ORDER = { debug: 0, log: 1, warn: 2, error: 3, off: 4 };

export const _state = {
    enabled: new Set(),
    level: 'warn',
    seen: new Set(),
};

function shouldPrint(category, level) {
    const minLevel = LEVEL_ORDER[_state.level] ?? LEVEL_ORDER.warn;
    const msgLevel = LEVEL_ORDER[level] ?? LEVEL_ORDER.log;
    if (msgLevel < minLevel) return false;
    if (_state.enabled.has('*') || _state.enabled.has(category)) return true;
    return false;
}

// DIAG-OVERLAY: an additive sink seam (same injection idiom as setConstraintNotifier /
// createEngine({onMetrics})) so a host can CAPTURE every dbg.* call for its own diagnostic ring
// buffer, independent of the console print gate above. CRITICAL: the sink fires on EVERY call,
// print-enabled or not — a mobile bug report needs the log even though nobody enabled that
// category in advance (the user can't know what to enable before the bug happens). Console
// printing keeps its existing gating, completely unchanged.
let _sink = null;
export function setDebugSink(fn) { _sink = typeof fn === 'function' ? fn : null; }

function emit(category, level, args) {
    _state.seen.add(category);
    if (_sink) { try { _sink({ category, level, args }); } catch (_) {} }
    if (shouldPrint(category, level)) console[level](`[${category}]`, ...args);
}

export const dbg = {
    log(category, ...args) { emit(category, 'log', args); },
    debug(category, ...args) { emit(category, 'debug', args); },
    warn(category, ...args) { emit(category, 'warn', args); },
    error(category, ...args) { emit(category, 'error', args); },
};

// NOTE: the window.ug.debug console API + the spring overlay (which need window/
// requestAnimationFrame/SettingsManager) were split out to the shell's debug-overlay module
// (#4) — the shell entry side-effect-imports it. _state + LEVEL_ORDER are exported so that
// overlay's enable/disable/level controls mutate THIS logger's state.
