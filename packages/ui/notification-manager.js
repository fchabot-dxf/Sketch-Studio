// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION MANAGER - Toast notifications for errors and feedback
// ═══════════════════════════════════════════════════════════════════════════════
// Shared UI (#ui/notification-manager.js). Relocated VERBATIM from apps/sketchstudio/ui in slice S4a.
// TODO(shaper): parameterize the DOM reaches (document.body / createElement / the #notification* ids)
// before Shaper adopts this — it currently writes straight into the document.

export function setupNotifications() {
    if (typeof document === 'undefined') return;
    
    // Create container if it doesn't exist
    if (!document.getElementById('notification-container')) {
        const container = document.createElement('div');
        container.id = 'notification-container';
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
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
    
    // Expose global helper for debugging/console use
    if (typeof window !== 'undefined') {
        window.ug = window.ug || {};
        window.ug.notify = showNotification;
    }
}

export function showNotification(message, type = 'error', duration = 3000) {
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
        max-width: 420px;
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
    toast.appendChild(copyBtn);
    toast.appendChild(iconSpan);
    toast.appendChild(pre);
    document.getElementById('notification-container').appendChild(toast);

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
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        });
    };

    setTimeout(remove, duration);
    // Do NOT dismiss on click anymore
}