// debug-overlay.js (SHELL) - the DOM/window half of the old core/debug.js, split out (#4).
// The pure dbg logger stays in #core/debug.js; this file wires window.ug.debug + the
// requestAnimationFrame spring overlay + SettingsManager. Side-effect-imported by main.js.
import { _state, LEVEL_ORDER } from '#core/debug.js';
import SettingsManager from '#core/settings-manager.js';

// Overlay state + animation (decoupled from solver loop)
const _overlay = {
    focusedCluster: null,          // id of the joint/cluster leader currently focused
    targetScreenY: 10,             // target screen-space Y for focused label (px)
    currentScreenY: 10,            // animated screen-space Y (px)
    velocityY: 0,                  // velocity used by spring integrator
    w: Number(SettingsManager.get('DEBUG_SPRING_W') || 18),
    offsetX: Number(SettingsManager.get('DEBUG_OFFSET_X') || 23),
    focusOpacity: Number(SettingsManager.get('DEBUG_FOCUS_OPACITY') || 1.0),
    running: false,
    lastTs: null
};

function _startOverlayLoop() {
    if (typeof window === 'undefined') return;
    if (_overlay.running) return;
    _overlay.running = true;
    _overlay.lastTs = performance.now();

    function step(ts) {
        const dt = Math.min(0.032, (ts - (_overlay.lastTs || ts)) / 1000); // clamp dt for stability
        _overlay.lastTs = ts;
        // Critically-damped spring: x'' + 2*w*x' + w^2*(x - target) = 0
        const x = _overlay.currentScreenY;
        const v = _overlay.velocityY;
        const target = _overlay.targetScreenY;
        const w = Math.max(1e-3, _overlay.w);
        const k = w * w;
        const c = 2 * w; // critical damping
        const accel = -k * (x - target) - c * v;
        const nv = v + accel * dt;
        const nx = x + nv * dt;
        _overlay.velocityY = Math.abs(nv) < 1e-3 && Math.abs(nx - target) < 0.25 ? 0 : nv;
        _overlay.currentScreenY = Math.abs(nx - target) < 0.25 ? target : nx;

        // Stop loop if settled and no focused cluster
        if (!_overlay.focusedCluster && Math.abs(_overlay.currentScreenY - _overlay.targetScreenY) < 0.25 && Math.abs(_overlay.velocityY) < 0.1) {
            _overlay.running = false;
            _overlay.lastTs = null;
            return;
        }
        if (_overlay.running) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function _updateOverlayConfigFromSettings() {
    _overlay.w = Number(SettingsManager.get('DEBUG_SPRING_W') || _overlay.w);
    _overlay.offsetX = Number(SettingsManager.get('DEBUG_OFFSET_X') || _overlay.offsetX);
    _overlay.focusOpacity = Number(SettingsManager.get('DEBUG_FOCUS_OPACITY') || _overlay.focusOpacity);
}

// Expose runtime controls on window.ug.debug
if (typeof window !== 'undefined') {
    window.ug = window.ug || {};
    window.ug.debug = window.ug.debug || {};
    Object.assign(window.ug.debug, {
        enable(cat) { _state.enabled.add(cat); console.log(`[debug] enabled '${cat}'`); },
        disable(cat) { _state.enabled.delete(cat); console.log(`[debug] disabled '${cat}'`); },
        list() { return { enabled: [..._state.enabled], seen: [..._state.seen], level: _state.level }; },
        get level() { return _state.level; },
        set level(v) { if (v in LEVEL_ORDER) { _state.level = v; console.log(`[debug] level set to '${v}'`); } else { console.warn(`[debug] unknown level '${v}', use: ${Object.keys(LEVEL_ORDER).join(', ')}`); } },

        // Overlay API (UI-focused; designed to be cheap and independent from the solver loop)
        overlay: {
            setFocus(id) { try { _overlay.focusedCluster = id || null; _overlay.targetScreenY = 10; _startOverlayLoop(); } catch(_){} },
            clearFocus() { try { _overlay.focusedCluster = null; } catch(_){} },
            setOffsetX(v) { _overlay.offsetX = Number(v || 0); SettingsManager.set('DEBUG_OFFSET_X', _overlay.offsetX); },
            setFocusOpacity(v) { _overlay.focusOpacity = Number(v || 1.0); SettingsManager.set('DEBUG_FOCUS_OPACITY', _overlay.focusOpacity); },
            setSpringW(v) { _overlay.w = Number(v || _overlay.w); SettingsManager.set('DEBUG_SPRING_W', _overlay.w); },
            updateTargetY(screenY) { _overlay.targetScreenY = Number(screenY || 10); _startOverlayLoop(); },
            getState() { _updateOverlayConfigFromSettings(); return { focusedCluster: _overlay.focusedCluster, currentScreenY: _overlay.currentScreenY, targetScreenY: _overlay.targetScreenY, offsetX: _overlay.offsetX, focusOpacity: _overlay.focusOpacity, w: _overlay.w }; }
        }
    });

    // Keep overlay config in sync when settings change
    try { SettingsManager.subscribe((k, v) => { if (k && (k.startsWith('DEBUG_') || k === 'SHOW_DEBUG_OVERLAY')) _updateOverlayConfigFromSettings(); }); } catch(_){}
}
