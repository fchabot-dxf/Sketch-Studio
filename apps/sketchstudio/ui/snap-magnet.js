// ═══════════════════════════════════════════════════════════════════════════════
// SNAP MAGNET — Unified magnetism threshold helper
//
// All lock-in / release checks go through here so thresholds, hysteresis,
// and fallback logic live in one place.
// ═══════════════════════════════════════════════════════════════════════════════

import { SolverConfig } from '#core/solver-config.js';
import SettingsManager from '#core/settings-manager.js';

/**
 * Get the effective magnetism threshold (in screen px).
 *
 * @param {'snap'|'grid'} kind  — 'snap' for geometry (joints/lines/midpoints/origin),
 *                                 'grid' for grid intersections.
 * @param {boolean} [hysteresis=false] — If true, widen the threshold by SNAP_RELEASE_MULT
 *                                       to prevent jitter when already locked.
 * @returns {number} threshold in screen pixels
 */
export function getMagnetThreshold(kind = 'snap', hysteresis = false) {
    let base;
    if (kind === 'grid') {
        base = SettingsManager.get('GRID_MAGNETISM')
            || SolverConfig.GRID_MAGNETISM
            || 10;
    } else {
        base = SettingsManager.get('SNAP_MAGNETISM')
            || SolverConfig.SNAP_MAGNETISM
            || 10;
    }
    if (hysteresis) {
        const mult = SolverConfig.SNAP_RELEASE_MULT || 2.0;
        return base * mult;
    }
    return base;
}

/**
 * Check whether a screen-space distance qualifies as "locked" (magnetically attracted).
 *
 * @param {number} dist          — distance in screen pixels between pointer and target
 * @param {'snap'|'grid'} kind   — threshold category
 * @param {boolean} [hysteresis] — widen threshold (use when already locked to same target)
 * @returns {boolean}
 */
export function isWithinMagnet(dist, kind = 'snap', hysteresis = false) {
    return dist <= getMagnetThreshold(kind, hysteresis);
}
