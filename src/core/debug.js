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

export const dbg = {
    log(category, ...args) {
        _state.seen.add(category);
        if (shouldPrint(category, 'log')) console.log(`[${category}]`, ...args);
    },
    debug(category, ...args) {
        _state.seen.add(category);
        if (shouldPrint(category, 'debug')) console.debug(`[${category}]`, ...args);
    },
    warn(category, ...args) {
        _state.seen.add(category);
        if (shouldPrint(category, 'warn')) console.warn(`[${category}]`, ...args);
    },
    error(category, ...args) {
        _state.seen.add(category);
        if (shouldPrint(category, 'error')) console.error(`[${category}]`, ...args);
    },
};

// NOTE: the window.ug.debug console API + the spring overlay (which need window/
// requestAnimationFrame/SettingsManager) were split out to apps/sketchstudio/debug-overlay.js
// (shell, #4) — main.js side-effect-imports it. _state + LEVEL_ORDER are exported so that
// overlay's enable/disable/level controls mutate THIS logger's state.
