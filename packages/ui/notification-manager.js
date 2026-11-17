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

/** The rects of the open floating windows that declare themselves toast obstacles (`data-toast-obstacle`, set by the shared window code). */
function obstacleRects() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return [];
    return [...document.querySelectorAll('[data-toast-obstacle]')].map(visibleRect).filter(Boolean);
}

const rectsOverlap = (a, b) => horizOverlaps(a, b) && a.top < b.bottom && b.top < a.bottom;

const MIN_COLUMN_PX = 240; // the narrowest column a stack is reflowed into

/** The free x ranges between the obstacles (each kept CLEARANCE_GAP_PX away), inside the screen. */
function freeColumns(obstacles, vw) {
    const cols = [];
    let cursor = CLEARANCE_GAP_PX;
    for (const o of [...obstacles].sort((p, q) => p.left - q.left)) {
        if (o.left - CLEARANCE_GAP_PX > cursor) cols.push({ left: cursor, right: o.left - CLEARANCE_GAP_PX });
        cursor = Math.max(cursor, o.right + CLEARANCE_GAP_PX);
    }
    if (vw - CLEARANCE_GAP_PX > cursor) cols.push({ left: cursor, right: vw - CLEARANCE_GAP_PX });
    return cols;
}

/**
 * Where the stack goes. Default: bottom centre, above the footer. A visible window that declares `data-toast-obstacle` is never covered; in order:
 *  1. nothing under the default spot: stay there;
 *  2. BESIDE the window(s): the free column nearest the centre that holds the stack's full width;
 *  3. ABOVE the window (its top edge is the floor) when the whole stack fits between there and the top bars;
 *  4. BESIDE, reflowed: a free column of at least 240px, the toasts wrapping to its width (oldest overflow dropped by the trim);
 *  5. ABOVE with the oldest toasts dropped, when at least the newest toast fits;
 *  6. no clear spot (a window nearly the whole screen): the stack is hidden until one exists (the toasts still expire; a refused value also
 *     shows its own message in the window).
 */
function chooseSpot(container, cW, cH, vw, vh, floorY) {
    const home = { centerX: vw / 2, floorY, width: null, hidden: false };
    const obstacles = obstacleRects();
    const at = (cx, w, floor, h) => ({ left: cx - w / 2, right: cx + w / 2, top: floor - h, bottom: floor });
    if (!obstacles.some((o) => rectsOverlap(at(vw / 2, cW, floorY, cH), o))) return home;
    const columns = freeColumns(obstacles, vw);
    const centreIn = (col, w) => Math.min(Math.max(vw / 2, col.left + w / 2), col.right - w / 2);
    const byCentre = (list) => list.sort((p, q) => Math.abs(p.centerX - vw / 2) - Math.abs(q.centerX - vw / 2));
    const wide = byCentre(columns.filter((c) => c.right - c.left >= cW).map((c) => ({ centerX: centreIn(c, cW), floorY, width: null, hidden: false })))[0];
    if (wide) return wide;
    let aboveFloor = floorY;
    for (const o of obstacles) if (horizOverlaps(at(vw / 2, cW, floorY, cH), o)) aboveFloor = Math.min(aboveFloor, o.top - CLEARANCE_GAP_PX);
    const room = aboveFloor - ceilingBottomEdge(vw / 2 - cW / 2, vw / 2 + cW / 2, vh);
    const above = { centerX: vw / 2, floorY: aboveFloor, width: null, hidden: false };
    if (room >= cH) return above;
    const narrow = byCentre(columns.filter((c) => c.right - c.left >= MIN_COLUMN_PX).map((c) => ({ centerX: centreIn(c, c.right - c.left), floorY, width: c.right - c.left, hidden: false })))[0];
    if (narrow) return narrow;
    const newest = container.lastElementChild;
    if (newest && room >= newest.offsetHeight) return above;
    return { ...home, hidden: true };
}

/** Position the toast stack above the host's live footer, clear of open floating windows, and drop oldest overflow on short screens. */
export function layoutNotifications() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const container = document.getElementById('notification-container');
    if (!container) return;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const fTop = footerTopEdge();
    let floorY = fTop !== null ? fTop - CLEARANCE_GAP_PX : vh - DEFAULT_BOTTOM_PX;
    container.style.left = '50%';
    container.style.maxWidth = '';
    container.style.visibility = '';
    container.style.bottom = `${Math.max(DEFAULT_BOTTOM_PX, Math.ceil(vh - floorY))}px`;
    if (!(vh > 0) || !(container.offsetHeight > 0)) return;

    const cW = Math.max(200, container.offsetWidth || 0);
    const spot = chooseSpot(container, cW, container.offsetHeight, vw, vh, floorY);
    floorY = spot.floorY;
    if (spot.width !== null) container.style.maxWidth = `${spot.width}px`;
    if (spot.hidden) container.style.visibility = 'hidden';
    container.style.left = spot.centerX === vw / 2 ? '50%' : `${spot.centerX}px`;
    container.style.bottom = `${Math.max(DEFAULT_BOTTOM_PX, Math.ceil(vh - floorY))}px`;
    const w = spot.width !== null ? spot.width : cW;
    const cLeft = Math.max(0, spot.centerX - w / 2);
    const ceilingY = ceilingBottomEdge(cLeft, cLeft + w, vh);
    const maxH = Math.max(0, floorY - ceilingY);

    // Under flex-direction: column-reverse, firstElementChild is the oldest toast (sits at bottom; trimming pulls newer down).
    while (container.children.length > 1 && container.offsetHeight > maxH) {
        container.firstElementChild.remove();
    }
}

// While toasts show, a window dragged / opened under them moves them: follow it every frame (stops when none show).
let followRaf = null;
function followWindows() {
    followRaf = null;
    const c = typeof document !== 'undefined' ? document.getElementById('notification-container') : null;
    if (!c || !c.children.length || typeof requestAnimationFrame !== 'function') return;
    layoutNotifications();
    followRaf = requestAnimationFrame(followWindows);
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
            width: max-content; /* TASK 698: its width never shrinks when the stack sits beside a window (left > 50%) */
            max-width: calc(100vw - 16px);
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

// TASK 760: options.action = { label, onClick }: ONE button at the end of the toast (the import's "Close them" offer, #ui/close-path-actions.js);
// a press runs onClick and dismisses the toast. Without it the toast is exactly as before.
export function showNotification(message, type = 'info', duration = 3000, { action = null } = {}) {
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
        max-width: min(420px, calc(100vw - 24px), 100%); /* 100%: the stack's own width when it is reflowed beside a window (TASK 698) */
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
    if (followRaf === null && typeof requestAnimationFrame === 'function') followRaf = requestAnimationFrame(followWindows);

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

    if (action && action.label && typeof action.onClick === 'function') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'notif-action-btn';
        btn.textContent = action.label;
        const finger = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
        btn.style.cssText = `margin-left:8px; flex:0 0 auto; background:#ffffff; color:${bg}; border:none; border-radius:4px; padding:4px 12px; min-height:${finger ? 44 : 30}px; font:inherit; font-weight:700; cursor:pointer; user-select:none;`;
        btn.addEventListener('click', (ev) => { ev.stopPropagation(); remove(); action.onClick(); });
        toast.appendChild(btn);
        layoutNotifications();
    }

    setTimeout(remove, duration);
    // Do NOT dismiss on click anymore
}