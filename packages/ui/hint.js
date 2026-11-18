// packages/ui/hint.js — Shared interactive hint & floating tooltip widgets across all Sketch-Studio hosts.
//   mountHint: inline collapsible note (hover/focus on desktop, tap on phone, one open at a time, Esc/outside-press closes; Task 770 contract).
//   mountTooltip: non-blocking floating tooltip on desktop hover/keyboard focus for compact bar/ribbon/footer icon buttons without mutating `title` at rest.

let stylesInjected = false;
function ensureHintStyles(doc) {
  if (stylesInjected || !doc || !doc.head) return;
  if (doc.getElementById('sk-hint-styles')) { stylesInjected = true; return; }
  const s = doc.createElement('style');
  s.id = 'sk-hint-styles';
  s.textContent = `
.sk-hint-trigger::after { content: 'i'; display: inline-block; box-sizing: border-box; width: 12px; height: 12px; margin-left: 5px;
  border: 1px solid currentColor; border-radius: 50%; font: italic 700 8px/10px Georgia, 'Times New Roman', serif;
  text-align: center; text-transform: none; vertical-align: middle; opacity: 0.65; }
.sk-hint-trigger:hover::after, .sk-hint-trigger.is-open::after { opacity: 1; }
.sk-hint-trigger:focus-visible { outline: 2px solid var(--sk-selection, #3B82F6); outline-offset: 1px; border-radius: 4px; }
.sk-hint-i { all: unset; position: relative; display: inline-flex; align-items: center; color: var(--sk-prep-unit, var(--sk-style-muted, #64748b)); cursor: pointer; -webkit-tap-highlight-color: transparent; vertical-align: middle; }
.sk-hint-i::after { margin-left: 0; }
.sk-hint-i::before { content: ''; position: absolute; top: -10px; bottom: -10px; left: -10px; right: -10px; }
.sk-hint-i.is-open::before { bottom: 0; }
.sk-hint { font-size: 11px; line-height: 1.4; color: var(--sk-prep-unit, var(--sk-style-muted, #64748b)); padding: 4px 0 0; overflow-wrap: anywhere; text-transform: none; }
.sk-hint[hidden] { display: none; }
.sk-hint-item { margin-top: 3px; }
.sk-hint-item b { font-weight: 600; color: var(--sk-prep-chip-text, inherit); }
.sk-tooltip { position: fixed; z-index: 10050; max-width: min(260px, calc(100vw - 16px)); padding: 6px 9px; border-radius: 7px;
  background: var(--sk-tooltip-bg, #1e293b); color: var(--sk-tooltip-fg, #f8fafc); border: 1px solid rgba(148,163,184,0.28);
  box-shadow: 0 6px 20px rgba(0,0,0,0.28); font: 12px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif;
  pointer-events: none; box-sizing: border-box; }
.sk-tooltip[hidden] { display: none; }
.sk-tooltip-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-weight: 600; }
.sk-tooltip-key { font-size: 11px; font-weight: 500; opacity: 0.78; white-space: nowrap; }
.sk-tooltip-body { margin-top: 2px; font-size: 11px; line-height: 1.35; opacity: 0.9; }
`;
  doc.head.appendChild(s);
  stylesInjected = true;
}

const docStates = new WeakMap();
function getDocState(doc) {
  let st = docStates.get(doc);
  if (st) return st;
  st = { openHint: null, keyboard: false, activeTip: null, seq: 0 };
  docStates.set(doc, st);
  if (typeof doc.addEventListener === 'function') {
    doc.addEventListener('keydown', (e) => {
      st.keyboard = true;
      if (e.key === 'Escape') {
        if (st.openHint) st.openHint.close();
        if (st.activeTip) st.activeTip.hide();
      }
    }, true);
    doc.addEventListener('pointerdown', (e) => {
      st.keyboard = false;
      if (st.openHint && !st.openHint.contains(e.target)) st.openHint.close();
      if (st.activeTip) st.activeTip.hide();
    }, true);
  }
  return st;
}

/** Inline click/hover/focus hint line inserted right after `after`. */
export function mountHint({
  id = '', label = '', text = '', items = [], getEntry = null,
  trigger = null, labelEl = null, after, fields = [], itemFields = {}, ctx = {}, doc = null, iconOnly = false,
}) {
  const d = doc || (after && after.ownerDocument) || globalThis.document;
  ensureHintStyles(d);
  const st = getDocState(d);
  const n = ++st.seq;
  const own = !trigger;
  if (own) {
    trigger = d.createElement('button');
    trigger.type = 'button';
    trigger.className = 'sk-hint-trigger sk-hint-i';
    if (labelEl) labelEl.after(trigger);
  } else {
    trigger.classList.add('sk-hint-trigger');
  }
  const labelTarget = iconOnly ? null : (labelEl || (own ? null : trigger));
  const el = d.createElement('div');
  el.className = 'sk-hint';
  el.id = `sk-hint-${n}`;
  el.setAttribute('role', 'note');
  el.hidden = true;
  if (after) after.after(el);
  trigger.setAttribute('aria-controls', el.id);
  trigger.setAttribute('aria-expanded', 'false');
  for (const f of fields) if (f) f.setAttribute('aria-describedby', el.id);

  let curId = id;
  let curCtx = ctx;
  let pinned = false;
  const resolveEntry = (c) => {
    if (typeof getEntry === 'function') return getEntry(curId, c);
    return { label, text, items };
  };

  const render = (c) => {
    const entry = resolveEntry(c);
    if (curId) el.dataset.hint = curId;
    if (labelTarget && entry.label) labelTarget.textContent = entry.label;
    if (own) trigger.setAttribute('aria-label', `About ${entry.label || label || 'control'}`);
    el.replaceChildren();
    const main = d.createElement('div');
    main.textContent = entry.text || '';
    el.appendChild(main);
    for (const item of (entry.items || [])) {
      const line = d.createElement('div');
      line.className = 'sk-hint-item';
      if (item.id) {
        line.dataset.hint = item.id;
        line.id = `${el.id}-${String(item.id).replace(/[^a-z0-9-]/gi, '-')}`;
      }
      const b = d.createElement('b');
      b.textContent = item.label;
      line.append(b, ': ' + item.text);
      el.appendChild(line);
      const f = item.id && itemFields[item.id];
      if (f) f.setAttribute('aria-describedby', line.id);
    }
  };

  const show = (pin) => {
    if (st.openHint && st.openHint !== handle) st.openHint.close();
    pinned = pin;
    el.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('is-open');
    st.openHint = handle;
  };
  const close = () => {
    el.hidden = true;
    pinned = false;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('is-open');
    if (st.openHint === handle) st.openHint = null;
  };
  const handle = { close, contains: (node) => trigger.contains(node) || el.contains(node) };
  trigger.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && el.hidden) show(false); });
  trigger.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pinned && !el.hidden) close(); });
  trigger.addEventListener('focus', () => { if (st.keyboard && el.hidden) show(false); });
  trigger.addEventListener('blur', () => { if (!pinned && !el.hidden) close(); });
  trigger.addEventListener('click', (e) => { e.preventDefault(); if (!el.hidden && pinned) close(); else show(true); });
  render(curCtx);

  return {
    el, trigger,
    setId(next, c = curCtx) { if (next !== curId) { curId = next; render(c); } },
    refresh(c) { curCtx = c; render(c); },
    close, isOpen: () => !el.hidden,
  };
}

/**
 * Floating non-blocking tooltip for compact bar/ribbon/footer buttons.
 * Preserves target.title at rest (for shortcut tests / screen readers) and suppresses browser native duplicate during hover.
 */
export function mountTooltip({ target, getContent, delayMs = 320, doc = null }) {
  if (!target || typeof target.addEventListener !== 'function') return { hide() {}, destroy() {} };
  const d = doc || target.ownerDocument || globalThis.document;
  if (!d || !d.body) return { hide() {}, destroy() {} };
  ensureHintStyles(d);
  const st = getDocState(d);

  let box = null;
  let timer = null;
  let stashedTitle = null;

  const suppressNative = () => {
    if (stashedTitle === null && target.hasAttribute && target.hasAttribute('title')) {
      stashedTitle = target.getAttribute('title');
      target.removeAttribute('title');
    }
  };
  const restoreNative = () => {
    if (stashedTitle !== null) {
      target.setAttribute('title', stashedTitle);
      stashedTitle = null;
    }
  };

  function ensureBox() {
    if (box && box.isConnected) return box;
    box = d.createElement('div');
    box.className = 'sk-tooltip';
    box.setAttribute('role', 'tooltip');
    box.hidden = true;
    // TASK 774: inside a modal <dialog> (the browser's top layer) the tooltip goes INTO that dialog, else it would paint under it
    (target.closest('dialog') || d.body).appendChild(box);
    return box;
  }

  function positionBox() {
    if (!box || !target.isConnected) return;
    const r = target.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const vw = (d.defaultView && d.defaultView.innerWidth) || 1280;
    const vh = (d.defaultView && d.defaultView.innerHeight) || 800;
    let left = r.left + r.width / 2 - br.width / 2;
    left = Math.max(8, Math.min(vw - br.width - 8, left));
    let top = r.bottom + 6;
    if (top + br.height > vh - 8 && r.top - br.height - 6 >= 8) top = r.top - br.height - 6;
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  }

  function show() {
    clearTimeout(timer); timer = null;
    if (!target.isConnected) return;
    const info = typeof getContent === 'function' ? getContent() : getContent;
    if (!info || (!info.title && !info.text)) return;
    if (st.activeTip && st.activeTip !== api) st.activeTip.hide();
    suppressNative();
    const b = ensureBox();
    b.replaceChildren();
    const head = d.createElement('div');
    head.className = 'sk-tooltip-head';
    const titleEl = d.createElement('span');
    titleEl.textContent = info.title || '';
    head.appendChild(titleEl);
    if (info.key) {
      const k = d.createElement('span');
      k.className = 'sk-tooltip-key';
      k.textContent = info.key;
      head.appendChild(k);
    }
    b.appendChild(head);
    if (info.text) {
      const body = d.createElement('div');
      body.className = 'sk-tooltip-body';
      body.textContent = info.text;
      b.appendChild(body);
    }
    b.hidden = false;
    positionBox();
    st.activeTip = api;
  }

  function hide() {
    clearTimeout(timer); timer = null;
    restoreNative();
    if (box) box.hidden = true;
    if (st.activeTip === api) st.activeTip = null;
  }

  const onEnter = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    suppressNative();
    clearTimeout(timer);
    timer = setTimeout(show, delayMs);
  };
  const onLeave = (e) => {
    if (e && e.pointerType && e.pointerType !== 'mouse') return;
    hide();
  };
  const onFocus = () => { if (st.keyboard) show(); };

  target.addEventListener('pointerenter', onEnter);
  target.addEventListener('pointerleave', onLeave);
  target.addEventListener('pointerdown', hide);
  target.addEventListener('focus', onFocus);
  target.addEventListener('blur', hide);

  const api = {
    hide,
    destroy() {
      hide();
      target.removeEventListener('pointerenter', onEnter);
      target.removeEventListener('pointerleave', onLeave);
      target.removeEventListener('pointerdown', hide);
      target.removeEventListener('focus', onFocus);
      target.removeEventListener('blur', hide);
      if (box && box.parentNode) box.parentNode.removeChild(box);
    },
  };
  return api;
}
