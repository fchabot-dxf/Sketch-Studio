// tests/undo-redo-ribbon.test.js
// Unit tests for TASK 435:
// 1. canUndo / canRedo and history notification in sketch-state.js
// 2. Built-in Undo / Redo buttons in tool-ribbon.js (Edit group) with live enable/disable
// 3. Shared Redo keyboard shortcuts in input-manager.js (Ctrl+Shift+Z, Ctrl+Y, Meta+Shift+Z, Meta+Y)

(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Setup mock DOM for Node environment
  class MockElement {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.id = '';
      this._className = '';
      this.classList = {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
        toggle(c, force) {
          if (force === true) this._classes.add(c);
          else if (force === false) this._classes.delete(c);
          else if (this._classes.has(c)) this._classes.delete(c);
          else this._classes.add(c);
        }
      };
      this.style = {};
      this.children = [];
      this.parentNode = null;
      this.listeners = new Map();
      this._innerHTML = '';
      this.title = '';
      this.type = '';
      this.disabled = false;
      this.dataset = {};
    }
    set className(val) {
      this._className = val || '';
      this.classList._classes.clear();
      if (val) val.trim().split(/\s+/).forEach((c) => this.classList._classes.add(c));
    }
    get className() { return this._className; }
    set innerHTML(html) {
      this._innerHTML = html;
      this.children = [];
      if (html.includes('<span class="sk-ribbon-lbl">Undo</span>')) {
        const span = new MockElement('span');
        span.className = 'sk-ribbon-lbl';
        span.textContent = 'Undo';
        this.children.push(span);
      } else if (html.includes('<span class="sk-ribbon-lbl">Redo</span>')) {
        const span = new MockElement('span');
        span.className = 'sk-ribbon-lbl';
        span.textContent = 'Redo';
        this.children.push(span);
      }
    }
    get innerHTML() { return this._innerHTML; }
    get textContent() {
      return this._textContent || this.children.map(c => c.textContent).join('');
    }
    set textContent(v) { this._textContent = v; }
    appendChild(child) {
      if (child.nodeType === 11) { // DocumentFragment
        for (const c of [...child.children]) {
          c.parentNode = this;
          this.children.push(c);
        }
        child.children = [];
        return child;
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    append(...children) {
      for (const c of children) this.appendChild(c);
    }
    insertBefore(newChild, refChild) {
      newChild.parentNode = this;
      const idx = this.children.indexOf(refChild);
      if (idx !== -1) this.children.splice(idx, 0, newChild);
      else this.children.push(newChild);
      return newChild;
    }
    remove() {
      if (this.parentNode) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx !== -1) this.parentNode.children.splice(idx, 1);
        this.parentNode = null;
      }
    }
    setAttribute(k, v) { this[k] = v; }
    getAttribute(k) { return this[k] || null; }
    addEventListener(ev, fn) {
      if (!this.listeners.has(ev)) this.listeners.set(ev, []);
      this.listeners.get(ev).push(fn);
    }
    removeEventListener(ev, fn) {
      const arr = this.listeners.get(ev);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
    dispatchEvent(ev) {
      const arr = this.listeners.get(ev.type) || [];
      for (const fn of arr) fn(ev);
    }
    querySelector(sel) {
      const all = this.querySelectorAll(sel);
      return all.length ? all[0] : null;
    }
    querySelectorAll(sel) {
      const res = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (sel.startsWith('#') && c.id === sel.slice(1)) res.push(c);
          else if (sel.startsWith('.') && c.classList.contains(sel.slice(1))) res.push(c);
          else if (c.tagName.toLowerCase() === sel.toLowerCase()) res.push(c);
          walk(c);
        }
      };
      walk(this);
      return res;
    }
  }

  class MockDocFragment {
    constructor() {
      this.nodeType = 11;
      this.children = [];
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    append(...children) {
      for (const c of children) this.appendChild(c);
    }
    insertBefore(newChild, refChild) {
      newChild.parentNode = this;
      const idx = this.children.indexOf(refChild);
      if (idx !== -1) this.children.splice(idx, 0, newChild);
      else this.children.push(newChild);
      return newChild;
    }
  }

  const docListeners = new Map();
  globalThis.document = {
    head: new MockElement('head'),
    body: new MockElement('body'),
    createElement: (tag) => new MockElement(tag),
    createElementNS: (ns, tag) => new MockElement(tag),
    createDocumentFragment: () => new MockDocFragment(),
    getElementById: (id) => {
      const walk = (n) => {
        if (n.id === id) return n;
        for (const c of (n.children || [])) {
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(globalThis.document.body) || (id === 'cursor-symbols' ? new MockElement('svg') : null);
    },
    querySelector: (sel) => globalThis.document.body.querySelector(sel),
    querySelectorAll: (sel) => globalThis.document.body.querySelectorAll(sel),
    addEventListener: (ev, fn) => {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    },
    removeEventListener: (ev, fn) => {
      const arr = docListeners.get(ev);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    dispatchEvent: (ev) => {
      const arr = docListeners.get(ev.type) || [];
      for (const fn of arr) fn(ev);
    }
  };
  globalThis.window = {
    addEventListener: (ev, fn) => {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    },
    removeEventListener: (ev, fn) => {
      const arr = docListeners.get(ev);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
  };

  const { createEngine } = await import('#core/constraint-solver.js');
  const { createSketchState } = await import('#ui/sketch-state.js');
  const { createToolRibbon } = await import('#ui/tool-ribbon.js');
  const { setupKeyboardShortcuts } = await import('#ui/input-manager.js');

  console.log('--- 1. Testing sketch-state canUndo / canRedo & history notification ---');
  {
    const engine = createEngine();
    engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 100, h: 100 });

    assert(state.canUndo() === false, 'Initial state canUndo() must be false');
    assert(state.canRedo() === false, 'Initial state canRedo() must be false');

    let notifyCount = 0;
    const unlisten = state.addHistoryListener(() => { notifyCount++; });

    // Take pre-change snapshot, then modify state
    state.saveState();
    state.joints.set('j1', { x: 10, y: 10 });

    assert(state.canUndo() === true, 'After saveState, canUndo() must be true');
    assert(state.canRedo() === false, 'After saveState, canRedo() must be false');
    assert(notifyCount === 1, `History listener must fire on saveState, got count=${notifyCount}`);

    // Undo restores state to before j1 was added
    state.undo();
    assert(state.canUndo() === false, 'After undo, canUndo() must be false');
    assert(state.canRedo() === true, 'After undo, canRedo() must be true');
    assert(notifyCount === 2, `History listener must fire on undo, got count=${notifyCount}`);
    assert(!state.joints.has('j1'), 'State restored: j1 should no longer be present');

    // Redo restores j1
    state.redo();
    assert(state.canUndo() === true, 'After redo, canUndo() must be true');
    assert(state.canRedo() === false, 'After redo, canRedo() must be false');
    assert(notifyCount === 3, `History listener must fire on redo, got count=${notifyCount}`);
    assert(state.joints.has('j1'), 'State restored: j1 should be restored');

    // Another saveState clears redoStack
    state.undo();
    assert(state.canRedo() === true, 'canRedo is true after undo');
    state.saveState();
    state.joints.set('j2', { x: 20, y: 20 });
    assert(state.canRedo() === false, 'saveState must clear redo branch');

    unlisten();
    state.undo();
    assert(notifyCount === 5, 'Unlisten must prevent subsequent callbacks');
    console.log('✓ sketch-state canUndo/canRedo and notification verified');
  }

  console.log('--- 2. Testing tool-ribbon built-in Edit group & button enable/disable ---');
  {
    const engine = createEngine();
    engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 100, h: 100 });

    const ribbonContainer = new MockElement('div');
    globalThis.document.body.appendChild(ribbonContainer);

    const ribbon = createToolRibbon({
      state,
      extraGroups: [{ label: 'Actions', buttons: [{ id: 'btn-clear', label: 'Clear All' }] }]
    });
    ribbon.render(ribbonContainer);

    const undoBtn = ribbonContainer.querySelector('#btn-undo');
    const redoBtn = ribbonContainer.querySelector('#btn-redo');
    const clearBtn = ribbonContainer.querySelector('#btn-clear');

    assert(undoBtn !== null, '#btn-undo must exist in the ribbon');
    assert(redoBtn !== null, '#btn-redo must exist in the ribbon');
    assert(clearBtn !== null, '#btn-clear must exist in extra group');

    // Check group labels
    const groupLabels = ribbonContainer.querySelectorAll('.sk-ribbon-group-label').map(el => el.textContent);
    assert(groupLabels.includes('Edit'), `Ribbon must include built-in 'Edit' group, got: ${groupLabels.join(',')}`);
    assert(groupLabels.includes('Actions'), `Ribbon must include host 'Actions' group, got: ${groupLabels.join(',')}`);

    // Initially both buttons must be disabled
    assert(undoBtn.disabled === true, 'undoBtn must be disabled initially');
    assert(redoBtn.disabled === true, 'redoBtn must be disabled initially');

    // Add state change
    state.saveState();
    state.joints.set('a', { x: 0, y: 0 });

    // The ribbon automatically updates via state history listener
    assert(undoBtn.disabled === false, 'undoBtn must be enabled after saveState()');
    assert(redoBtn.disabled === true, 'redoBtn must be disabled after saveState()');

    // Click undo button
    undoBtn.dispatchEvent({ type: 'click' });
    assert(undoBtn.disabled === true, 'undoBtn must be disabled after clicking undo');
    assert(redoBtn.disabled === false, 'redoBtn must be enabled after clicking undo');
    assert(!state.joints.has('a'), 'Joint "a" must be undone');

    // Click redo button
    redoBtn.dispatchEvent({ type: 'click' });
    assert(undoBtn.disabled === false, 'undoBtn must be enabled after clicking redo');
    assert(redoBtn.disabled === true, 'redoBtn must be disabled after clicking redo');
    assert(state.joints.has('a'), 'Joint "a" must be restored via redo');

    ribbon.destroy();
    console.log('✓ tool-ribbon Edit group and live enable/disable verified');
  }

  console.log('--- 3. Testing shared Redo shortcuts in input-manager.js ---');
  {
    const engine = createEngine();
    engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 100, h: 100 });
    const svg = new MockElement('svg');
    svg.id = 'svgCanvas';
    globalThis.document.body.appendChild(svg);

    setupKeyboardShortcuts(state, {});

    // Setup state and save
    state.saveState();
    state.joints.set('p1', { x: 1, y: 1 });
    assert(state.canUndo() === true);

    const dispatchKey = (opts) => {
      let defaultPrevented = false;
      const ev = {
        type: 'keydown',
        ctrlKey: !!opts.ctrlKey,
        metaKey: !!opts.metaKey,
        shiftKey: !!opts.shiftKey,
        key: opts.key,
        target: svg,
        preventDefault() { defaultPrevented = true; }
      };
      globalThis.document.dispatchEvent(ev);
      return defaultPrevented;
    };

    // A. Ctrl+Z undo
    let prevented = dispatchKey({ ctrlKey: true, key: 'z' });
    assert(prevented, 'Ctrl+Z must preventDefault');
    assert(!state.joints.has('p1'), 'Ctrl+Z must undo joint p1');
    assert(state.canRedo() === true, 'canRedo must be true after undo');

    // B. Ctrl+Y redo
    prevented = dispatchKey({ ctrlKey: true, key: 'y' });
    assert(prevented, 'Ctrl+Y must preventDefault');
    assert(state.joints.has('p1'), 'Ctrl+Y must redo joint p1');
    assert(state.canRedo() === false, 'canRedo must be false after redo');

    // C. Ctrl+Shift+Z redo
    dispatchKey({ ctrlKey: true, key: 'z' }); // undo first
    assert(!state.joints.has('p1'));
    prevented = dispatchKey({ ctrlKey: true, shiftKey: true, key: 'Z' });
    assert(prevented, 'Ctrl+Shift+Z must preventDefault');
    assert(state.joints.has('p1'), 'Ctrl+Shift+Z must redo joint p1');

    // D. Meta+Shift+Z redo (Mac Cmd+Shift+Z)
    dispatchKey({ ctrlKey: true, key: 'z' }); // undo first
    assert(!state.joints.has('p1'));
    prevented = dispatchKey({ metaKey: true, shiftKey: true, key: 'Z' });
    assert(prevented, 'Meta+Shift+Z must preventDefault');
    assert(state.joints.has('p1'), 'Meta+Shift+Z must redo joint p1');

    // E. Meta+Y redo (Mac Cmd+Y)
    dispatchKey({ ctrlKey: true, key: 'z' }); // undo first
    assert(!state.joints.has('p1'));
    prevented = dispatchKey({ metaKey: true, key: 'y' });
    assert(prevented, 'Meta+Y must preventDefault');
    assert(state.joints.has('p1'), 'Meta+Y must redo joint p1');

    console.log('✓ input-manager shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Cmd) verified');
  }

  console.log('\nAll TASK 435 unit tests passed ✅');
})().catch((err) => {
  console.error('Task 435 unit test failed ❌', err);
  process.exit(1);
});
