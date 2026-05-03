// src/ui/tuning-wizard.js
// @dev-only — Solver tuning panel with live metrics
import { SolverConfig, saveSolverConfig, loadSolverConfig, resetSolverConfig } from '../core/solver-config.js';
import SettingsManager from '../core/settings-manager.js';
import { dbg } from '../core/debug.js';
import { applyPanelStyle, createWizardPanel } from './wizard-base.js';

let panelVisible = false;
let panel = null;
let metricsInterval = null;
let lastSolveStats = { maxDelta: 0, iterations: 0, converged: false };

// Allow external code to update metrics (called from solver or main loop)
export function updateSolverMetrics(stats) {
    lastSolveStats = { ...lastSolveStats, ...stats };
}

// Register global callback for solver to use
if (typeof window !== 'undefined') {
    window.__updateSolverMetrics = updateSolverMetrics;
}

export function setupTuningWizard(state) {
    // Create the panel via the shared factory (keeps header markup consistent)
    const created = createWizardPanel({ id: 'tuning-wizard-panel', title: '⚙ SOLVER TUNING', closeId: 'tuning-close-btn', width: 320, padding: 16, display: 'none', center: true });
    panel = created.panel;
    const header = created.header;

    // Live metrics display
    const metricsDiv = document.createElement('div');
    metricsDiv.id = 'tuning-metrics';
    metricsDiv.style.cssText = `
        background: #1e293b;
        border-radius: 8px;
        padding: 10px;
        margin-bottom: 12px;
        font-family: 'SF Mono', Monaco, monospace;
    `;
    metricsDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span style="color:#94a3b8;">maxDelta</span>
            <span id="metric-maxdelta" style="color:#4ade80;">—</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span style="color:#94a3b8;">Iterations</span>
            <span id="metric-iterations" style="color:#fbbf24;">—</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
            <span style="color:#94a3b8;">Status</span>
            <span id="metric-status" style="color:#94a3b8;">—</span>
        </div>
    `;
    panel.appendChild(metricsDiv);

    // Constraint errors breakdown (collapsible)
    const errorsDiv = document.createElement('div');
    errorsDiv.id = 'tuning-constraint-errors';
    errorsDiv.style.cssText = `
        background: #1e293b;
        border-radius: 8px;
        padding: 10px;
        margin-bottom: 12px;
        font-family: 'SF Mono', Monaco, monospace;
        display: none;
    `;
    errorsDiv.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; cursor:pointer;" id="errors-toggle">
            <span style="color:#f87171; font-weight:600;">⚠ Failing Constraints</span>
            <span style="color:#64748b; font-size:10px;">▼</span>
        </div>
        <div id="errors-list" style="max-height:150px; overflow-y:auto; font-size:10px;"></div>
    `;
    panel.appendChild(errorsDiv);

    // Helper: Create section header
    const createHeader = (text) => {
        const h = document.createElement('div');
        h.innerText = text;
        h.style.cssText = `
            margin-top: 14px;
            margin-bottom: 8px;
            color: #64748b;
            font-weight: 600;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid #334155;
            padding-bottom: 4px;
        `;
        panel.appendChild(h);
    };

    // Helper: Create slider
    const createSlider = (label, key, min, max, step, format = (v) => v) => {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom: 10px;';
        
        const val = SolverConfig[key] ?? min;
        row.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
                <span style="color:#cbd5e1;">${label}</span>
                <span id="val-${key}" style="color:#fbbf24; font-weight:500;">${format(val)}</span>
            </div>
            <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
                   style="width:100%; accent-color:#3b82f6; cursor:pointer;">
        `;
        
        const input = row.querySelector('input');
        input.addEventListener('input', (e) => {
            const newVal = parseFloat(e.target.value);
            SolverConfig[key] = newVal;
            document.getElementById(`val-${key}`).innerText = format(newVal);
            triggerSolve(state);
        });
        
        panel.appendChild(row);
    };

    // ═══════════════════════════════════════════════════════════════════════
    // SLIDERS
    // ═══════════════════════════════════════════════════════════════════════

    createHeader('INTERACTION');
    createSlider('Drag Strength', 'DRAG_STRENGTH', 0.1, 2.0, 0.1);
    createSlider('Constraint Bias', 'CONSTRAINT_BIAS', 0.1, 1.0, 0.1);
    // Magnetism (snap/grid)
    createSlider('Snap Magnetism', 'SNAP_MAGNETISM', 2, 40, 1);
    createSlider('Grid Magnetism', 'GRID_MAGNETISM', 2, 40, 1);



    createHeader('SOLVER (Newton / LM)');
    // Expose only the active solver tuning knobs for the Newton–LM engine
    createSlider('Iterations', 'ITERATIONS', 50, 2000, 50);

    // Levenberg‑Marquardt / Newton tuning (primary knobs)
    createHeader('NEWTON / LM');
    createSlider('LM lambda init', 'LM_LAMBDA_INIT', 1e-6, 0.1, 1e-6, (v)=>v.toExponential(1));
    createSlider('LM lambda ↑', 'LM_LAMBDA_UP', 1.0, 100.0, 1.0);
    createSlider('LM lambda ↓', 'LM_LAMBDA_DOWN', 0.01, 1.0, 0.01);
    createSlider('Newton tol', 'LM_TOL', 1e-9, 1e-4, 1e-9, (v)=>v.toExponential(1));


    createHeader('TOLERANCES');
    createSlider('Verifier Tol', 'VERIFIER_TOLERANCE', 0.0001, 0.05, 0.0001, (v) => v.toFixed(4));
    createSlider('Conflict Thr', 'CONFLICT_THRESHOLD', 0.0001, 0.05, 0.0001, (v) => v.toFixed(4));
    createSlider('Geometry Tol', 'GEOMETRY_TOLERANCE', 0.01, 0.5, 0.01);

    createHeader('SNAP (dev)');
    createSlider('Snap Radius', 'SNAP_RADIUS', 5, 100, 5);

    // Debug-overlay controls removed from the Tuning Wizard — moved to Debug Panel


    // Grouped debug toggles: Tension / Freedom / Health
    const createToggle = (label, key, hint) => {
        const row = document.createElement('div');
        row.style.cssText = 'margin-bottom: 6px; display:flex; justify-content:space-between; align-items:center;';
        const checked = !!SettingsManager.get(key);
        row.innerHTML = `<div style="display:flex; gap:8px; align-items:center;"><span style="color:#94a3b8; font-size:11px">${label}</span>${hint ? `<span style="color:#475569; font-size:10px; opacity:0.8;">${hint}</span>` : ''}</div><input id="val-${key}" type="checkbox" ${checked ? 'checked' : ''} />`;
        row.querySelector('input').addEventListener('change', (e) => { SettingsManager.set(key, !!e.target.checked); });
        panel.appendChild(row);
    };

    // ═══════════════════════════════════════════════════════════════════════
    // BUTTONS
    // ═══════════════════════════════════════════════════════════════════════

    // Solve Now button (prominent)
    const solveBtn = document.createElement('button');
    solveBtn.innerText = '▶ Solve Now';
    solveBtn.style.cssText = `
        width: 100%;
        padding: 10px;
        margin-top: 16px;
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: opacity 0.15s;
    `;
    solveBtn.onclick = () => {
        const iters = SolverConfig.ITERATIONS || 500;
        if (state && state.engine && typeof state.engine.solve === 'function') {
            state.engine.solve(iters);
            // Stats are updated via the global callback, just flash the result
            setTimeout(() => {
                const msg = lastSolveStats.converged ? '✓ Converged' : `⚠ ${lastSolveStats.constraintErrors?.length || 0} failing`;
                flashMessage(msg);
            }, 50);
        }
    };
    panel.appendChild(solveBtn);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:8px; margin-top:10px;';

    const saveBtn = document.createElement('button');
    saveBtn.innerText = '💾 Save';
    saveBtn.style.cssText = btnStyle('#3b82f6');
    saveBtn.onclick = () => {
        saveSolverConfig();
        flashMessage('Settings saved!');
    };

    const resetBtn = document.createElement('button');
    resetBtn.innerText = '↺ Reset';
    resetBtn.style.cssText = btnStyle('#475569');
    resetBtn.onclick = () => {
        resetSolverConfig();
        refreshSliders();
        triggerSolve(state);
        flashMessage('Reset to defaults');
    };

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(resetBtn);
    panel.appendChild(btnRow);

    // Keyboard hint
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:12px; color:#475569; font-size:10px; text-align:center;';
    hint.innerHTML = 'Press <kbd style="background:#334155; padding:2px 6px; border-radius:3px;">T</kbd> or <kbd style="background:#334155; padding:2px 6px; border-radius:3px;">Esc</kbd> to close';
    panel.appendChild(hint);

    document.body.appendChild(panel);

    // ═══════════════════════════════════════════════════════════════════════
    // TOGGLE BUTTON (in header)
    // ═══════════════════════════════════════════════════════════════════════

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'btn-tuning-toggle';
    toggleBtn.className = 'tool-btn flex flex-col items-center justify-center w-12 h-14 rounded text-slate-500';
    toggleBtn.title = 'Solver Tuning (T)';
    toggleBtn.setAttribute('aria-label', 'Solver Tuning');
    toggleBtn.innerHTML = `
        <svg class="w-[18px] h-[18px] mb-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="21" x2="4" y2="14"/>
            <line x1="4" y1="10" x2="4" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12" y2="3"/>
            <line x1="20" y1="21" x2="20" y2="16"/>
            <line x1="20" y1="12" x2="20" y2="3"/>
            <line x1="1" y1="14" x2="7" y2="14"/>
            <line x1="9" y1="8" x2="15" y2="8"/>
            <line x1="17" y1="16" x2="23" y2="16"/>
        </svg>
        <span class="text-[8px] font-black uppercase mt-1 invisible">Tune</span>
    `;
    toggleBtn.onclick = togglePanel;

    // Insert before settings button
    const settingsBtn = document.getElementById('btn-settings-toggle');
    if (settingsBtn && settingsBtn.parentNode) {
        settingsBtn.parentNode.insertBefore(toggleBtn, settingsBtn);
    } else {
        // Fallback: append to body as floating button
        toggleBtn.style.cssText = 'position:fixed; bottom:20px; right:320px; z-index:99998;';
        document.body.appendChild(toggleBtn);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // EVENT HANDLERS
    // ═══════════════════════════════════════════════════════════════════════

    // Close button
    document.getElementById('tuning-close-btn').onclick = () => togglePanel(false);

    // Keyboard: T to toggle, Escape to close
    document.addEventListener('keydown', (e) => {
        // Don't trigger if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        if (e.key === 't' || e.key === 'T') {
            togglePanel();
            e.preventDefault();
        } else if (e.key === 'Escape' && panelVisible) {
            togglePanel(false);
            e.preventDefault();
        }
    });

    // Click outside to close
    document.addEventListener('mousedown', (e) => {
        if (panelVisible && panel && !panel.contains(e.target) && e.target.id !== 'btn-tuning-toggle') {
            togglePanel(false);
        }
    });

    // Start metrics update loop
    startMetricsLoop();

    console.log('[TuningWizard] Initialized. Press T to toggle.');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function btnStyle(bg) {
    return `
        flex: 1;
        padding: 8px;
        background: ${bg};
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 500;
        transition: opacity 0.15s;
    `;
}

function togglePanel(forceState) {
    panelVisible = typeof forceState === 'boolean' ? forceState : !panelVisible;
    if (panel) {
        panel.style.display = panelVisible ? 'block' : 'none';
    }
    // Update button state
    const btn = document.getElementById('btn-tuning-toggle');
    if (btn) {
        btn.classList.toggle('text-blue-400', panelVisible);
        btn.classList.toggle('text-slate-500', !panelVisible);
    }
}

function triggerSolve(state) {
    if (state && state.engine && typeof state.engine.solve === 'function') {
        state.engine.solve(SolverConfig.ITERATIONS || 500);
    }
}

function refreshSliders() {
    Object.keys(SolverConfig).forEach(key => {
        const valEl = document.getElementById(`val-${key}`);
        if (valEl) {
            valEl.innerText = SolverConfig[key];
            const row = valEl.closest('div').parentNode;
            const input = row ? row.querySelector('input') : null;
            if (input) input.value = SolverConfig[key];
        }
    });

    // Refresh SettingsManager-backed debug sliders


}

function flashMessage(msg) {
    const flash = document.createElement('div');
    flash.innerText = msg;
    flash.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #22c55e;
        color: white;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 12px;
        z-index: 999999;
        animation: fadeout 1.5s forwards;
    `;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 1500);
}

function startMetricsLoop() {
    // Update metrics display every 100ms
    metricsInterval = setInterval(() => {
        if (!panelVisible) return;
        
        const maxDeltaEl = document.getElementById('metric-maxdelta');
        const iterEl = document.getElementById('metric-iterations');
        const statusEl = document.getElementById('metric-status');
        const errorsDiv = document.getElementById('tuning-constraint-errors');
        const errorsList = document.getElementById('errors-list');
        
        if (maxDeltaEl) {
            const val = lastSolveStats.maxDelta;
            maxDeltaEl.innerText = val < 0.0001 ? val.toExponential(2) : val.toFixed(6);
            maxDeltaEl.style.color = val < 1e-6 ? '#4ade80' : val < 1e-3 ? '#fbbf24' : '#f87171';
        }
        
        if (iterEl) {
            iterEl.innerText = lastSolveStats.iterations || '—';
        }
        
        if (statusEl) {
            if (lastSolveStats.converged) {
                statusEl.innerText = '✓ Converged';
                statusEl.style.color = '#4ade80';
            } else if (lastSolveStats.maxDelta > 0) {
                statusEl.innerText = '⟳ Solving...';
                statusEl.style.color = '#fbbf24';
            } else {
                statusEl.innerText = '—';
                statusEl.style.color = '#94a3b8';
            }
        }
        
        // Update constraint errors panel
        if (errorsDiv && errorsList) {
            const errors = lastSolveStats.constraintErrors || [];
            const failingErrors = errors.filter(e => !e.satisfied);
            
            if (failingErrors.length > 0) {
                errorsDiv.style.display = 'block';
                errorsList.innerHTML = failingErrors.map(e => {
                    const color = e.residual > 0.01 ? '#f87171' : '#fbbf24';
                    const residualStr = e.residual < 0.0001 ? e.residual.toExponential(2) : e.residual.toFixed(4);
                    const valueStr = e.value !== undefined ? ` (${e.value})` : '';
                    return `
                        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid #334155;">
                            <span style="color:#cbd5e1;">${e.type}${valueStr}</span>
                            <span style="color:${color}; font-weight:500;">${residualStr}</span>
                        </div>
                    `;
                }).join('');
            } else {
                errorsDiv.style.display = 'none';
            }
        }
    }, 100);
}

// Add fadeout animation
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeout {
        0% { opacity: 1; }
        70% { opacity: 1; }
        100% { opacity: 0; }
    }
`;
document.head.appendChild(style);