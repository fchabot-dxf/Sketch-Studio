// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION MANAGER - Toast notifications for errors and feedback
// ═══════════════════════════════════════════════════════════════════════════════
// Shared UI (#ui/notification-manager.js). Relocated VERBATIM from apps/sketchstudio/ui in slice S4a.
// TODO(shaper): parameterize the DOM reaches (document.body / createElement / the #notification* ids)
// before Shaper adopts this — it currently writes straight into the document.

const DEFAULT_BOTTOM_PX = 20;
const CLEARANCE_GAP_PX = 8;

const horizOverlaps = (a, b) => a.left < b.right && b.left < a.right;

function visibleRect(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    }
    const r = el.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r : null;
}

function footerTopEdge() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null;
    let top = null;
    for (const el of document.querySelectorAll('.sk-footer, .sk-statusbar')) {
        const r = visibleRect(el);
        if (!r) continue;
        top = top === null ? r.top : Math.min(top, r.top);
        for (const btn of el.querySelectorAll('button')) {
            const br = visibleRect(btn);
            if (br) top = Math.min(top, br.top);
        }
    }
    return top;
}

function ceilingBottomEdge(cLeft, cRight, vh) {
    let ceiling = CLEARANCE_GAP_PX;
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return ceiling;
    for (const el of document.querySelectorAll('.sk-header, .sk-doctabs, .sk-ribbon')) {
        const r = visibleRect(el);
        if (!r || r.height > vh * 0.55 || r.bottom > vh * 0.6) continue;
        if (horizOverlaps(r, { left: cLeft, right: cRight })) ceiling = Math.max(ceiling, r.bottom + CLEARANCE_GAP_PX);
    }
    for (const el of document.querySelectorAll('.sk-ribbon-menu.show, .sk-ribbon-sect-menu.show')) {
        const r = visibleRect(el);
        if (!r) continue;
        if (horizOverlaps(r, { left: cLeft, right: cRight })) ceiling = Math.max(ceiling, r.bottom + CLEARANCE_GAP_PX);
    }
    return ceiling;
}

/** Position the toast stack above the host's live footer and drop oldest overflow on short screens. */
export function layoutNotifications() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const container = document.getElementById('notification-container');
    if (!container) return;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const fTop = footerTopEdge();
    const bottomPx = fTop !== null ? Math.max(DEFAULT_BOTTOM_PX, Math.ceil(vh - fTop + CLEARANCE_GAP_PX)) : DEFAULT_BOTTOM_PX;
    container.style.bottom = `${bottomPx}px`;
    if (!(vh > 0) || !(container.offsetHeight > 0)) return;

    const cW = Math.max(200, container.offsetWidth || 0);
    const cLeft = Math.max(0, (vw - cW) / 2);
    const cRight = cLeft + cW;
    const floorY = fTop !== null ? fTop - CLEARANCE_GAP_PX : vh - DEFAULT_BOTTOM_PX;
    const ceilingY = ceilingBottomEdge(cLeft, cRight, vh);
    const maxH = Math.max(0, floorY - ceilingY);

    // Under flex-direction: column-reverse, firstElementChild is the oldest toast (sits at bottom; trimming pulls newer down).
    while (container.children.length > 1 && container.offsetHeight > maxH) {
        container.firstElementChild.remove();
    }
}

let resizeWired = false;

export function setupNotifications() {
    if (typeof document === 'undefined') return;
    
    // Create container if it doesn't exist
    if (!document.getElementById('notification-container')) {
        const container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = `
            position: fixed;
            bottom: ${DEFAULT_BOTTOM_PX}px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            flex-direction: column-reverse; /* stack upward from bottom */
            align-items: center;
            gap: 10px;
            z-index: 10001;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }
    if (!resizeWired && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        resizeWired = true;
        window.addEventListener('resize', layoutNotifications);
    }
    layoutNotifications();
    
    // Expose global helper for debugging/console use
    if (typeof window !== 'undefined') {
        window.ug = window.ug || {};
        window.ug.notify = showNotification;
    }
}

export function showNotification(message, type = 'info', duration = 3000) {
    // No-op in non-DOM environments (tests, server-side imports). Notifications
    // are pure UI candy; their absence shouldn't crash logic flows.
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const container = document.getElementById('notification-container');
    if (!container) {
        // Try to setup if missing (lazy init)
        setupNotifications();
        if (!document.getElementById('notification-container')) return;
    }

    // Set default duration for all notification types to 10 seconds unless explicitly overridden
    if (duration === 3000) {
        duration = 10000;
    }

    const toast = document.createElement('div');
    toast.setAttribute('data-level', type); // the level the caller asked for (read by tests; no look depends on it)
    
    // Visual styles based on type
    let bg = '#ef4444'; // error (red)
    let text = 'white';
    let icon = '⚠️';
    
    if (type === 'warning') {
        bg = '#f59e0b'; // warning (amber)
        text = 'white';
    } else if (type === 'info') {
        bg = '#3b82f6'; // info (blue)
        text = 'white';
        icon = 'ℹ️';
    } else if (type === 'success') {
        bg = '#22c55e'; // success (green)
        text = 'white';
        icon = '✅';
    }

    toast.style.cssText = `
        background-color: ${bg};
        color: ${text};
        padding: 12px 16px;
        border-radius: 6px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 14px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0;
        transform: translateY(30px); /* start below and slide up */
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: auto;
        min-width: 200px;
        max-width: min(420px, calc(100vw - 24px));
        user-select: text;
        cursor: text;
    `;
    // Build toast DOM safely (avoid innerHTML with unescaped `message`)
    const copyBtn = document.createElement('button');
    copyBtn.className = 'notif-copy-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = `margin-right:8px; background:rgba(255,255,255,0.08); border:none; color:${text}; border-radius:4px; padding:2px 8px; font-size:13px; cursor:pointer; user-select:none;`;

    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;

    const pre = document.createElement('pre');
    pre.tabIndex = 0;
    pre.style.cssText = 'margin:0; background:none; border:none; color:inherit; font:inherit; user-select:text; cursor:text; outline:none; flex:1 1 auto; white-space:pre-wrap;';
    pre.textContent = message; // use textContent to avoid HTML injection

    // Focus the <pre> so Ctrl+C works and attach a copy handler that copies the full message when nothing is selected
    pre.addEventListener('focus', () => { try { pre.select && pre.select(); } catch(_){} });
    pre.addEventListener('copy', (e) => {
        try {
            const sel = (window.getSelection && window.getSelection().toString()) || '';
            if (!sel || sel.length === 0) {
                if (e.clipboardData) {
                    e.clipboardData.setData('text/plain', message);
                    e.preventDefault();
                }
            }
        } catch (_) { /* best-effort */ }
    });

    // Robust copy-button handler: prefer Clipboard API, await it and fall back to execCommand
    copyBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        copyBtn.disabled = true;
        const orig = copyBtn.textContent;
        let ok = false;
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(message);
                ok = true;
            } else {
                const ta = document.createElement('textarea');
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.value = message;
                document.body.appendChild(ta);
                ta.select();
                ok = document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch (err) {
            ok = false;
        }
        copyBtn.textContent = ok ? 'Copied!' : 'Failed';
        setTimeout(() => { copyBtn.textContent = orig; copyBtn.disabled = false; }, 1200);
    });

    // Attach nodes to toast
    if (type === 'error') toast.appendChild(copyBtn); // TASK 616: Copy is for diagnostics; only an error toast carries it
    toast.appendChild(iconSpan);
    toast.appendChild(pre);
    document.getElementById('notification-container').appendChild(toast);
    layoutNotifications();

    // Animate in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    // Dismiss logic
    const remove = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(30px)'; /* slide down on dismiss */
        toast.addEventListener('transitionend', () => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
                layoutNotifications();
            }
        });
    };

    setTimeout(remove, duration);
    // Do NOT dismiss on click anymore
}