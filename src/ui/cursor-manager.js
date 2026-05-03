// ═══════════════════════════════════════════════════════════════════════════════
// CURSOR & ICON MANAGER - Single source of truth for UI icons and Cursors
// ═══════════════════════════════════════════════════════════════════════════════

import { dbg } from '../core/debug.js';
import { TOOL_MODES } from '../core/constants.js';

// Central definition of all icons. 
// These paths will be used for BOTH the UI buttons (via <symbol>) and the Cursors (via Data URI).
// Colors like 'currentColor' and 'var(--icon-accent)' work in UI but must be replaced for Cursors.
const ICONS = {
    // --- CONSTRAINT ICONS ---
    'icon-hv': {
        viewBox: '0 0 9 14',
        content: `
            <g stroke="var(--icon-accent, #ef4444)">
                <path d="M3.239,7.53L3.239,0.814"/><path d="M7.467,10.939L0.75,10.939"/>
                <path d="M2.778,4.771L1.147,3.14"/><path d="M4.707,11.401L3.076,13.032"/>
                <path d="M2.749,7.29L1.118,5.659"/><path d="M7.227,11.429L5.596,13.06"/>
                <path d="M3.034,2.369L1.479,0.814"/><path d="M2.306,11.144L0.75,12.7"/>
            </g>
            <g stroke="currentColor"><path d="M4.903,0.707L4.903,7.487"/><path d="M7.487,9.28L0.707,9.28"/></g>`
    },
    'icon-parallel': {
        viewBox: '0 0 13 13',
        content: `<path d="M9.449,0.707L0.707,9.449" stroke="var(--icon-accent, #ef4444)"/>
                  <path d="M11.822,3.298L3.08,12.04" stroke="currentColor"/>`
    },
    'icon-perpendicular': {
        viewBox: '0 0 13 13',
        content: `<path d="M6.169,11.88L0.707,6.418" stroke="var(--icon-accent, #ef4444)"/>
                  <path d="M12.135,0.707L4.276,8.566" stroke="currentColor"/>`
    },
    'icon-coincident': {
        viewBox: '0 0 12 15',
        content: `<g stroke="currentColor"><path d="M1.657,3.308l0,7.289"/><path d="M11.003,13.324l-8.308,0"/><path d="M2.449,9.731l-1.478,0"/></g>
                  <g stroke="var(--icon-accent, #ef4444)"><path d="M1.71,14.262l0,-0.936"/><path d="M1.658,1.643l0,-0.936"/><path d="M0.759,14.262l0,-0.936"/><path d="M0.707,1.643l0,-0.936"/></g>`
    },
    'icon-collinear': {
        viewBox: '0 0 15 12',
        content: `<path d="M13.859,0.707L10.19,4.376" stroke="var(--icon-accent, #ef4444)"/>
                  <g stroke="currentColor"><path d="M8.469,6.125L3.306,11.288"/><path d="M5.01,0.707L0.707,5.01"/><path d="M5.123,0.741L0.82,5.044"/><path d="M5.674,6.34L2.685,3.351"/><path d="M6.033,6.657L6.033,5.305"/><path d="M5.933,6.657L4.582,6.657"/></g>`
    },
    'icon-tangent': {
        viewBox: '0 0 13 13',
        content: `<circle cx="4.488" cy="8.121" r="3.988" stroke="var(--icon-accent, #ef4444)" fill="none"/><path d="M4.122,0.707L12.065,8.651" stroke="currentColor" stroke-linecap="square"/>`
    },
    'icon-equal': {
        viewBox: '0 0 11 5',
        content: `<path d="M10.083,0.707L0.722,0.707" stroke="var(--icon-accent, #ef4444)"/>
                  <path d="M10.068,4.187L0.707,4.187" stroke="currentColor"/>`
    },
    'icon-midpoint': {
        viewBox: '0 0 13 13',
        content: `<path d="M6.5,2 L11.5,11 L1.5,11 Z" stroke="var(--icon-accent, #ef4444)" fill="none"/>`
    },

    // --- Header / UI icons that must survive initCursors() ---
    'icon-cog': {
        // Using user-supplied gear.svg artwork (50x50 viewBox preserves original detail)
        viewBox: '0 0 50 50',
        content: `
            <!-- Outer ring with inner hole (evenodd fill-rule preserves transparent center) -->
            <path d="M25 34c-5 0-9-4-9-9s4-9 9-9 9 4 9 9-4 9-9 9zm0-16c-3.9 0-7 3.1-7 7s3.1 7 7 7 7-3.1 7-7-3.1-7-7-7z" fill="currentColor" fill-rule="evenodd"/>
            <path d="M27.7 44h-5.4l-1.5-4.6c-1-.3-2-.7-2.9-1.2l-4.4 2.2-3.8-3.8 2.2-4.4c-.5-.9-.9-1.9-1.2-2.9L6 27.7v-5.4l4.6-1.5c.3-1 .7-2 1.2-2.9l-2.2-4.4 3.8-3.8 4.4 2.2c.9-.5 1.9-.9 2.9-1.2L22.3 6h5.4l1.5 4.6c1 .3 2 .7 2.9 1.2l4.4-2.2 3.8 3.8-2.2 4.4c.5.9.9 1.9 1.2 2.9l4.6 1.5v5.4l-4.6 1.5c-.3 1-.7 2-1.2 2.9l2.2 4.4-3.8 3.8-4.4-2.2c-.9.5-1.9.9-2.9 1.2L27.7 44z" stroke="currentColor" fill="none"/>
        `
    },

    'icon-terminal': {
        viewBox: '0 0 24 24',
        content: `<polyline points="4 17 10 12 4 7" stroke="currentColor" fill="none"/><line x1="12" y1="19" x2="20" y2="19" stroke="currentColor" fill="none"/>`
    },

    // --- DRAWING TOOL ICONS (Used for Cursors) ---
    'icon-tool-select': {
        viewBox: '0 0 24 24',
        content: `<path d="M5.5 3l11.5 11.5-5.5.5 3.5 8-2.5 1-3.5-8-5 5V3z" fill="white" stroke="black" stroke-width="1" stroke-linejoin="round"/>`
    },
    'icon-tool-pan': {
        viewBox: '0 0 24 24',
        content: `<g stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></g>`
    },
    'icon-tool-line': {
        viewBox: '0 0 24 24',
        content: `<line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
    },
    'icon-tool-rect': {
        viewBox: '0 0 24 24',
        content: `<rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2" fill="none"/>`
    },
    'icon-tool-rect-2pt': {
        viewBox: '0 0 24 24',
        content: `<rect x="4" y="4" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="4" cy="4" r="2" fill="currentColor"/><circle cx="20" cy="20" r="2" fill="currentColor"/>`
    },
    'icon-tool-rect-center': {
        viewBox: '0 0 24 24',
        content: `<rect x="4" y="4" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="20" cy="20" r="2" fill="currentColor"/>`
    },
    'icon-tool-rect-3pt': {
        viewBox: '0 0 24 24',
        content: `<rect x="4" y="4" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="4" cy="4" r="2" fill="currentColor"/><circle cx="20" cy="4" r="2" fill="currentColor"/><circle cx="20" cy="20" r="2" fill="currentColor"/>`
    },
    'icon-tool-arc-3pt': {
        viewBox: '0 0 24 24',
        content: `<path d="M4 12a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="4" r="1.5" fill="currentColor"/><circle cx="20" cy="12" r="1.5" fill="currentColor"/>`
    },
    'icon-tool-arc-cse': {
        viewBox: '0 0 24 24',
        content: `<path d="M18 18 A 12 12 0 0 0 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="18" r="1.5" fill="currentColor"/><circle cx="6" cy="6" r="1.5" fill="currentColor"/>`
    },
    'icon-tool-circle': {
        viewBox: '0 0 24 24',
        content: `<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>`
    },
    'icon-tool-dim': {
        viewBox: '0 0 24 24',
        content: `<path d="M3 6v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 6v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 12h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 8l-4 4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 8l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    }
};

// Map Tool Modes to Icons
const TOOL_CURSOR_MAP = {
    // [TOOL_MODES.SELECT]: 'icon-tool-select', // Use system default cursor (no crosshair)
    [TOOL_MODES.PAN]: 'icon-tool-pan',
    [TOOL_MODES.LINE]: 'icon-tool-line',
    [TOOL_MODES.RECT]: 'icon-tool-rect',
    [TOOL_MODES.CIRCLE]: 'icon-tool-circle',
    [TOOL_MODES.ARC]: 'icon-tool-arc-cse',
    [TOOL_MODES.DIMENSION]: 'icon-tool-dim',
    [TOOL_MODES.COINCIDENT]: 'icon-coincident',
    [TOOL_MODES.HORIZONTAL_VERTICAL]: 'icon-hv',
    [TOOL_MODES.PARALLEL]: 'icon-parallel',
    [TOOL_MODES.PERPENDICULAR]: 'icon-perpendicular',
    [TOOL_MODES.COLLINEAR]: 'icon-collinear',
    [TOOL_MODES.TANGENT]: 'icon-tangent',
    [TOOL_MODES.EQUAL]: 'icon-equal',
    [TOOL_MODES.MIDPOINT]: 'icon-midpoint'
};

/**
 * Initialize Cursors and Icons
 * 1. Injects SVG symbols into the DOM (unifying UI icons).
 * 2. Generates and injects CSS for custom cursors.
 */
export function initCursors() {
    injectSymbols();
    injectCursorStyles();
    dbg.log('cursor', '[cursor-manager] Icons and Cursors initialized.');
}

/**
 * Updates the cursor on the SVG element based on the active tool.
 */
export function updateCursor(svg, toolName) {
    if (!svg) return;
    // Support headless/mock SVG objects used in tests
    if (!svg.classList || typeof svg.classList !== 'object') return;

    // Remove all existing cursor classes
    const classesToRemove = Array.from(svg.classList).filter(c => c.startsWith('cursor-tool-'));
    if (classesToRemove.length > 0) svg.classList.remove(...classesToRemove);

    // Add new cursor class if defined
    if (TOOL_CURSOR_MAP[toolName]) {
        svg.classList.add(`cursor-tool-${toolName}`);
    }
}

// --- INTERNAL HELPERS ---

function injectSymbols() {
    // Find the hidden SVG container or create it
    let container = document.querySelector('svg[aria-hidden="true"]');
    if (!container) {
        container = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        container.style.display = 'none';
        container.setAttribute('aria-hidden', 'true');
        document.body.insertBefore(container, document.body.firstChild);
    }

    // Clear existing defs to ensure we are the source of truth
    let defs = container.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        container.appendChild(defs);
    }
    defs.innerHTML = ''; // Reset

    // Inject symbols
    for (const [id, data] of Object.entries(ICONS)) {
        const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
        symbol.id = id;
        symbol.setAttribute('viewBox', data.viewBox);
        symbol.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        symbol.setAttribute('fill', 'none');
        symbol.setAttribute('stroke-linecap', 'square');
        symbol.setAttribute('stroke-linejoin', 'round');
        symbol.innerHTML = data.content;
        defs.appendChild(symbol);
    }
}

function injectCursorStyles() {
    const styleId = 'unified-cursor-styles';
    if (document.getElementById(styleId)) return;

    let css = '';

    // Define Constraint Tools (Use Arrow Cursor)
    const CONSTRAINT_TOOLS = [
        TOOL_MODES.COINCIDENT, TOOL_MODES.HORIZONTAL_VERTICAL, TOOL_MODES.PARALLEL,
        TOOL_MODES.PERPENDICULAR, TOOL_MODES.COLLINEAR, TOOL_MODES.TANGENT, TOOL_MODES.EQUAL,
        TOOL_MODES.MIDPOINT
    ];

    // Standard Arrow Path (Hotspot at 0,0)
    const arrowPath = `<path d="M0 0 L0 16 L4 12 L8 20 L10 19 L6 11 L11 11 Z" fill="white" stroke="black" stroke-width="1" stroke-linejoin="round"/>`;

    for (const [tool, iconId] of Object.entries(TOOL_CURSOR_MAP)) {
        const iconData = ICONS[iconId];
        if (!iconData) continue;

        const isConstraint = CONSTRAINT_TOOLS.includes(tool);
        let cursorSvg, hotspot;

        if (isConstraint) {
            // --- CONSTRAINT CURSOR: Arrow + Colored Icon ---
            // Preserve Red (#ef4444), Map currentColor to Black
            let content = iconData.content
                .replace(/var\(--icon-accent,[^)]+\)/g, '#ef4444')
                .replace(/currentColor/g, 'black');

            cursorSvg = `
                <svg width='32' height='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'>
                    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="1" dy="1" stdDeviation="1" flood-opacity="0.4"/>
                    </filter>
                    <!-- Icon (Bottom Right, Scaled) -->
                    <g transform="translate(12, 12) scale(0.8)" stroke-width="1">
                        <svg width="20" height="20" viewBox="${iconData.viewBox}">
                            ${content}
                        </svg>
                    </g>
                    <!-- Arrow (Top Left) -->
                    <g filter="url(#shadow)">
                        ${arrowPath}
                    </g>
                </svg>
            `;
            hotspot = '0 0'; // Tip of arrow
        } else {
            // --- DRAWING TOOL CURSOR: Crosshair + Monochrome Icon ---
            // High Contrast Black/White
            let content = iconData.content
                .replace(/var\(--icon-accent,[^)]+\)/g, 'black')
                .replace(/currentColor/g, 'black');

            cursorSvg = `
                <svg width='32' height='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'>
                    <!-- Crosshair -->
                    <path d='M16 9 V23 M9 16 H23' stroke='black' stroke-width='1' fill='none'/>
                    <path d='M16 9 V23 M9 16 H23' stroke='white' stroke-width='1' stroke-opacity='0.5' fill='none'/>
                    
                    <!-- Icon (Bottom Right, Scaled) -->
                    <g transform="translate(16, 16) scale(0.7)" stroke-width="1.5">
                        <svg width="16" height="16" viewBox="${iconData.viewBox}">
                            ${content}
                        </svg>
                    </g>
                </svg>
            `;
            hotspot = '16 16'; // Center of crosshair
        }

        const dataUri = `url("data:image/svg+xml;utf8,${encodeURIComponent(cursorSvg.trim().replace(/\s+/g, ' '))}") ${hotspot}, auto`;
        css += `.cursor-tool-${tool} { cursor: ${dataUri}; }\n`;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
}