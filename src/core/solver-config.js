// src/core/solver-config.js

const STORAGE_KEY = 'sketch-studio-solver-config';

// 1. Define Factory Defaults (The "Safe" Initial State)
const DEFAULTS = {
    // ── Tolerances (world-space, single source of truth) ─────────────
    VERIFIER_TOLERANCE: 0.001,   // Residual below this = satisfied
    CONFLICT_THRESHOLD: 0.005,   // Sandbox error above this = conflict
    GEOMETRY_TOLERANCE: 0.05,    // Math pre-check: joints "close enough"
    DIMENSION_MATCH_TOL: 0.01,   // Dimension values "equal enough"
    TRIANGLE_INEQ_TOL: 0.01,    // Triangle inequality slack
    SNAP_WORLD_EPS: 0.1,        // Snap-to-constraint proximity (world)
    AUTO_COINCIDENT_TOL: 0.01,   // World-space threshold for auto-coincident on line end

    // ── Solver tuning ────────────────────────────────────────────────
    SANDBOX_ITERATIONS: 50,
    ITERATIONS: 500,             // Loops per frame (full solve)
    QUICK_SOLVE: 8,              // Lightweight re-solve after delete / minor edits
    RELAXATION: 1.0,             // Global Stiffness (1.0 = Rigid)
    DRAG_STRENGTH: 1.0,          // Mouse Pull Force
    CONSTRAINT_BIAS: 0.9,        // 0.9 = Dragged point pulls shape
    CONSTRAINT_RATE: 0.5,        // Error correction aggressiveness (0.1=Soft, 1.0=Hard)

    // ── Snap (screen-space pixels) ───────────────────────────────────
    SNAP_RADIUS: 30,             // Pixel distance to detect a snap candidate
    SNAP_MAGNETISM: 10,          // Pixel distance to "Lock" the snap (Visual Lock)
    SNAP_RELEASE_MULT: 2.0,      // Hysteresis: release = magnetism * this (prevents jitter)
    GRID_MAGNETISM: 10,          // Pixel distance to lock to grid

    // ── Dimensions (world-space) ─────────────────────────────────────
    DIMENSION_OFFSET: 30,        // Default linear dimension offset
    ANGLE_OFFSET: 40,            // Default angle dimension offset

    // ── Newton / LM solver tuning (used by NewtonSolver) ─────────────
    LM_LAMBDA_INIT: 0.001,
    LM_LAMBDA_UP: 10.0,
    LM_LAMBDA_DOWN: 0.1,
    LM_TOL: 1e-6,

    // ── Relaxation pre-pass (steepest-descent before LM) ─────────────
    RELAX_PREPASS_ENABLED: true,
    RELAX_PREPASS_ITERS: 10,
    RELAX_PREPASS_SKIP_RESIDUAL: 1e-3,   // Skip pre-pass if initial residual already below this
    RELAX_PREPASS_HANDOFF: 1e-2          // Hand off to LM once residual drops below this
};

// 2. Try to Load User Settings (localStorage and project config)
let savedConfig = {};
let projectConfig = {};

// Attempt to load project-level config (node: filesystem, browser: fetch not attempted here)
// Guarded with `typeof require` so ESM test environments don't trip a ReferenceError.
try {
    if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof require === 'function') {
        const fs = require('fs');
        const path = require('path');
        const p = path.resolve(process.cwd(), 'sketch-studio.config.json');
        if (fs.existsSync(p)) {
            try { projectConfig = JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { console.warn('[SolverConfig] Could not parse project config:', e); }
        }
    }
} catch (e) {
    // silently skip — environment doesn't expose CommonJS require
}

// Guarded so Node test environments without a `localStorage` global don't warn.
try {
    if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) savedConfig = JSON.parse(raw);
    }
} catch (e) {
    // silently skip — no browser storage available
}

// 3. Export Config (Merge: defaults <- project config <- local overrides)
export const SolverConfig = { ...DEFAULTS, ...projectConfig, ...savedConfig };

// 4. Helper to Save Current State
export function saveSolverConfig() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(SolverConfig));
    } catch (e) {
        console.error('[SolverConfig] Save failed:', e);
    }
}

// 5. Helper to Reset (Factory Defaults)
export function resetSolverConfig() {
    try {
        localStorage.removeItem(STORAGE_KEY);
        Object.assign(SolverConfig, DEFAULTS);
        console.log('[SolverConfig] Reset to defaults');
    } catch (e) { }
}

// 6. Helper to Reload (Re-read from Storage)
export function loadSolverConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const loaded = JSON.parse(raw);
            Object.assign(SolverConfig, DEFAULTS, loaded);
        } else {
            // If nothing saved, revert to defaults
            Object.assign(SolverConfig, DEFAULTS);
        }
        console.log('[SolverConfig] Reloaded settings:', SolverConfig);
    } catch (e) {
        console.error('[SolverConfig] Reload failed:', e);
    }
}